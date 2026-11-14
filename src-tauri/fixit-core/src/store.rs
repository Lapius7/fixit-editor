// アプリのデータ(設定・AI の会話履歴など)をフォルダの JSON ファイルに残す。Tauri に依存しない。
// 1 つのキー(例 "fixit:settings:v1")が 1 つのファイル(fixit_settings_v1.json)に対応する。
use std::{collections::HashMap, fs, io::Write, path::{Path, PathBuf}};

const MAX_VALUE: usize = 32 << 20; // 1 つの値の上限(32MB)
const MAX_KEY: usize = 64;

// キーは "fixit:" で始まり、小文字・数字・: - だけ。ファイル名に使うので、パスの区切りなどは通さない
fn valid(key: &str) -> bool {
    key.starts_with("fixit:") && key.len() > 6 && key.len() <= MAX_KEY && key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b':' || b == b'-')
}

fn file_of(dir: &Path, key: &str) -> Result<PathBuf, String> {
    if !valid(key) { return Err("キーが正しくありません".into()); }
    Ok(dir.join(format!("{}.json", key.replace(':', "_"))))
}

fn key_of(name: &str) -> Option<String> {
    let k = name.strip_suffix(".json")?.replace('_', ":");
    if valid(&k) { Some(k) } else { None }
}

// API キーやログインのトークンを含むキー。Windows では DPAPI でユーザーごとに暗号化して書く
const SECRET: &[&str] = &["fixit:ai:v1", "fixit:account:v1", "fixit:gh:v1"];
const SEALED: &str = "dpapi:";
fn secret(key: &str) -> bool { SECRET.contains(&key) }

// 書く前に暗号化する。Windows 以外ではそのまま
fn seal(key: &str, v: &str) -> Result<String, String> {
    if !secret(key) { return Ok(v.to_owned()); }
    #[cfg(windows)]
    { use base64::Engine; return Ok(format!("{SEALED}{}", base64::engine::general_purpose::STANDARD.encode(dpapi::protect(v.as_bytes())?))); }
    #[cfg(not(windows))]
    Ok(v.to_owned())
}

// 読んだ中身を戻す。暗号化したものが戻せない(別のユーザー・別の PC で書いたなど)ときは、無いものとして扱う
fn unseal(raw: String) -> Option<String> {
    let Some(b) = raw.strip_prefix(SEALED) else { return Some(raw) };
    #[cfg(windows)]
    { use base64::Engine; let d = base64::engine::general_purpose::STANDARD.decode(b.trim()).ok()?; return String::from_utf8(dpapi::unprotect(&d).ok()?).ok(); }
    #[cfg(not(windows))]
    { let _ = b; None }
}

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    fn run(data: &[u8], seal: bool) -> Result<Vec<u8>, String> {
        let inp = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: inp は data を指し、呼び出しの間だけ使われる。out は成功時に LocalAlloc された領域を受け取り、写したあとで LocalFree する
        unsafe {
            let ok = if seal {
                CryptProtectData(&inp, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&inp, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            };
            if ok == 0 { return Err(format!("DPAPI に失敗しました({})", std::io::Error::last_os_error())); }
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData as _);
            Ok(v)
        }
    }
    pub fn protect(d: &[u8]) -> Result<Vec<u8>, String> { run(d, true) }
    pub fn unprotect(d: &[u8]) -> Result<Vec<u8>, String> { run(d, false) }
}

// フォルダの中のデータを全部読む。読めないファイルは飛ばす
pub fn load(dir: &Path) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let Ok(rd) = fs::read_dir(dir) else { return m };
    for e in rd.flatten() {
        let Some(name) = e.file_name().to_str().and_then(key_of) else { continue };
        if let Ok(md) = e.metadata() { if !md.is_file() || md.len() as usize > MAX_VALUE { continue; } }
        let Ok(s) = fs::read_to_string(e.path()) else { continue };
        // 前の版が平文で残したものは、ここで暗号化して書き直す
        if cfg!(windows) && secret(&name) && !s.starts_with(SEALED) { let _ = save(dir, &name, Some(&s)); }
        if let Some(v) = unseal(s) { m.insert(name, v); }
    }
    m
}

// 1 つだけ読む。なければ None
pub fn read(dir: &Path, key: &str) -> Option<String> {
    let p = file_of(dir, key).ok()?;
    if fs::metadata(&p).ok()?.len() as usize > MAX_VALUE { return None; }
    unseal(fs::read_to_string(p).ok()?)
}

// 各ファイルの「更新の目印」(更新時刻と大きさ)。ほかのウィンドウが書き換えたかを、中身を読まずに調べるために使う
pub fn stamps(dir: &Path) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let Ok(rd) = fs::read_dir(dir) else { return m };
    for e in rd.flatten() {
        let Some(k) = e.file_name().to_str().and_then(key_of) else { continue };
        let Ok(md) = e.metadata() else { continue };
        if !md.is_file() { continue; }
        let t = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0);
        m.insert(k, format!("{t}-{}", md.len()));
    }
    m
}

// 一時ファイルの名前。ウィンドウ(プロセス)ごと・書き込みごとに変え、同時に書いても衝突させない
fn tmp_of(p: &Path) -> PathBuf {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    p.with_extension(format!("json.{}-{n}.tmp", std::process::id()))
}

// 書く。一時ファイルに書いてから置き換えるので、途中で落ちても元のファイルは壊れない。value が None なら消す
pub fn save(dir: &Path, key: &str, value: Option<&str>) -> Result<(), String> {
    let p = file_of(dir, key)?;
    match value {
        None => match fs::remove_file(&p) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) },
        Some(v) => {
            if v.len() > MAX_VALUE { return Err("データが大きすぎます".into()); }
            let sealed = seal(key, v)?;
            let v = sealed.as_str();
            fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let tmp = tmp_of(&p);
            let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
            f.write_all(v.as_bytes()).and_then(|_| f.sync_all()).map_err(|e| { let _ = fs::remove_file(&tmp); e.to_string() })?;
            drop(f);
            // 他のウィンドウが開いている最中だと置き換えに失敗することがあるので、少し待って数回やり直す
            let mut r = fs::rename(&tmp, &p);
            for _ in 0..5 { if r.is_ok() { break; } std::thread::sleep(std::time::Duration::from_millis(30)); r = fs::rename(&tmp, &p); }
            r.map_err(|e| { let _ = fs::remove_file(&tmp); e.to_string() })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tmp(n: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("fixit-store-test-{}-{}", n, std::process::id())); let _ = fs::remove_dir_all(&d); d }

    #[test]
    fn roundtrip_and_delete() {
        let d = tmp("rt");
        save(&d, "fixit:settings:v1", Some("{\"a\":1}")).unwrap();
        save(&d, "fixit:ai-chats:v1", Some("[]")).unwrap();
        save(&d, "fixit:settings:v1", Some("{\"a\":2}")).unwrap();
        let m = load(&d);
        assert_eq!(m.len(), 2);
        assert_eq!(m["fixit:settings:v1"], "{\"a\":2}");
        assert_eq!(m["fixit:ai-chats:v1"], "[]");
        save(&d, "fixit:settings:v1", None).unwrap();
        save(&d, "fixit:settings:v1", None).unwrap(); // 無いものを消してもエラーにしない
        assert_eq!(load(&d).len(), 1);
        assert!(fs::read_dir(&d).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn rejects_bad_keys() {
        let d = tmp("bad");
        for k in ["../x", "fixit:../x", "settings", "fixit:a/b", "fixit:A", "fixit:a\\b", "fixit:", &format!("fixit:{}", "a".repeat(80))] {
            assert!(save(&d, k, Some("x")).is_err(), "{k}");
        }
        assert!(!d.exists());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn ignores_foreign_files() {
        let d = tmp("foreign");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("notes.txt"), "x").unwrap();
        fs::write(d.join("other.json"), "x").unwrap();
        fs::write(d.join("fixit_settings_v1.json"), "ok").unwrap();
        let m = load(&d);
        assert_eq!(m.len(), 1);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn read_stamps_and_parallel_writes() {
        let d = tmp("par");
        assert_eq!(read(&d, "fixit:settings:v1"), None);
        save(&d, "fixit:settings:v1", Some("{\"a\":1}")).unwrap();
        assert_eq!(read(&d, "fixit:settings:v1").as_deref(), Some("{\"a\":1}"));
        let s1 = stamps(&d)["fixit:settings:v1"].clone();
        save(&d, "fixit:settings:v1", Some("{\"a\":22}")).unwrap();
        assert_ne!(stamps(&d)["fixit:settings:v1"], s1);
        // 同じキーへ同時に書いても、壊れず、どちらかの完全な値が残る
        let hs: Vec<_> = (0..8).map(|i| { let d = d.clone(); std::thread::spawn(move || { for j in 0..30 { save(&d, "fixit:stats:v1", Some(&format!("{{\"v\":{i}{j}}}"))).unwrap(); } }) }).collect();
        for h in hs { h.join().unwrap(); }
        let v = read(&d, "fixit:stats:v1").unwrap();
        assert!(v.starts_with("{\"v\":") && v.ends_with('}'));
        assert!(fs::read_dir(&d).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn secret_keys_roundtrip() {
        let d = tmp("sec");
        save(&d, "fixit:ai:v1", Some("{\"key\":\"sk-1\"}")).unwrap();
        assert_eq!(read(&d, "fixit:ai:v1").as_deref(), Some("{\"key\":\"sk-1\"}"));
        assert_eq!(load(&d)["fixit:ai:v1"], "{\"key\":\"sk-1\"}");
        let raw = fs::read_to_string(d.join("fixit_ai_v1.json")).unwrap();
        assert_eq!(raw.starts_with(SEALED), cfg!(windows));
        // 戻せない暗号文は、無いものとして扱う
        fs::write(d.join("fixit_account_v1.json"), "dpapi:@@@").unwrap();
        assert_eq!(read(&d, "fixit:account:v1"), None);
        assert!(!load(&d).contains_key("fixit:account:v1"));
        // 前の版が平文で残したものは、読み込んだときに暗号化し直す(値は変わらない)
        fs::write(d.join("fixit_account_v1.json"), "{\"t\":\"tok\"}").unwrap();
        assert_eq!(load(&d)["fixit:account:v1"], "{\"t\":\"tok\"}");
        let raw = fs::read_to_string(d.join("fixit_account_v1.json")).unwrap();
        assert_eq!(raw.starts_with(SEALED), cfg!(windows));
        assert_eq!(read(&d, "fixit:account:v1").as_deref(), Some("{\"t\":\"tok\"}"));
        let _ = fs::remove_dir_all(&d);
    }
}
