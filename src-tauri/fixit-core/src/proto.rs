// fixit:// プロトコル。起動引数から URL を取り出す処理と、Windows への登録(HKCU\Software\Classes\fixit)。
// 起動引数は他のアプリや Web ページからも渡せるので、URL が付いているときはほかの引数(フォルダなど)を信用しない。
use std::ffi::OsString;

/// URL の長さの上限(これを超えるものは捨てる)
pub const MAX_URL: usize = 512;
const SCHEME: &str = "fixit:";

fn is_url(a: &str) -> bool { a.len() >= SCHEME.len() && a[..SCHEME.len()].eq_ignore_ascii_case(SCHEME) }

/// 引数のどれかが fixit: で始まるか(長さに関係なく)。付いていれば、フォルダ・--new などの引数は見ない
pub fn has_url(args: impl IntoIterator<Item = OsString>) -> bool {
    args.into_iter().any(|a| is_url(&a.to_string_lossy()))
}

/// 最初の fixit: の URL(長さの上限と、制御文字がないことを確かめる)。条件に合わなければ None
pub fn pick_url(args: impl IntoIterator<Item = OsString>) -> Option<String> {
    args.into_iter().map(|a| a.to_string_lossy().into_owned()).find(|a| is_url(a)).filter(|a| a.len() <= MAX_URL && !a.chars().any(|c| c.is_control()))
}

/// 登録するレジストリの項目(キー, 値の名前("" は既定値), 値)。launcher は更新で置き換わっても場所が変わらない起動ファイル
pub fn reg_entries(launcher: &str) -> Vec<(&'static str, &'static str, String)> {
    vec![
        (r"Software\Classes\fixit", "", "URL:Fixit Editor".into()),
        (r"Software\Classes\fixit", "URL Protocol", String::new()),
        (r"Software\Classes\fixit\DefaultIcon", "", format!("\"{launcher}\",0")),
        (r"Software\Classes\fixit\shell\open\command", "", format!("\"{launcher}\" \"%1\"")),
    ]
}

/// reg query の出力から、登録済みの起動ファイルのパス("…" の中身)を取り出す
pub fn registered_path(out: &str) -> Option<String> {
    let a = out.find('"')? + 1;
    let b = out[a..].find('"')? + a;
    Some(out[a..b].to_string())
}

/// 登録を確かめて、無いか、登録先のファイルが消えているときだけ直す(起動のたびに呼んでよい。登録済みなら reg.exe を 1 回呼ぶだけ)。
/// すでに別の場所の fixit.exe(インストール版など)が登録されていて、そのファイルが残っているなら、奪わない。Windows 以外は何もしない
#[cfg(windows)]
pub fn ensure_registered(launcher: &std::path::Path) {
    use std::{os::windows::process::CommandExt, process::Command};
    let l = launcher.display().to_string();
    // 引用符を含むパスは、コマンドの組み立てを壊すので登録しない
    if l.contains('"') || l.contains('%') || !launcher.is_absolute() { return; }
    let run = |args: &[&str]| Command::new("reg").args(args).creation_flags(0x0800_0000).output();
    let cmd_key = r"HKCU\Software\Classes\fixit\shell\open\command";
    if let Ok(o) = run(&["query", cmd_key, "/ve"]) {
        if o.status.success() {
            if let Some(p) = registered_path(&String::from_utf8_lossy(&o.stdout)) { if std::path::Path::new(&p).is_file() { return; } }
        }
    }
    for (k, n, v) in reg_entries(&l) {
        let key = format!("HKCU\\{k}");
        let mut a = vec!["add", key.as_str()];
        if n.is_empty() { a.push("/ve"); } else { a.extend(["/v", n]); }
        a.extend(["/t", "REG_SZ", "/d", v.as_str(), "/f"]);
        let _ = run(&a);
    }
}
#[cfg(not(windows))]
pub fn ensure_registered(_launcher: &std::path::Path) {}

// ---- 動いているウィンドウへの受け渡し ----
// Fixit は 1 ウィンドウ 1 プロセスなので、fixit:// で起動されたプロセスは、動いているウィンドウを探して URL を渡し、自分は終わる。
// 受け渡しは <データ>/win/ のファイルで行う。各ウィンドウは <pid>.beat を 1 秒ごとに書き(中身は最後にフォーカスされた時刻 ms)、
// 渡すときは <pid>.url を置く。受け取った側は読んで消す。受け取られなければ(相手が閉じたなど)、渡した側が自分で開く。
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// この時間より古い beat は、閉じたウィンドウとして扱う
pub const BEAT_FRESH: Duration = Duration::from_secs(4);
const STALE: Duration = Duration::from_secs(300);

pub fn win_dir(data: &Path) -> PathBuf { data.join("win") }
pub fn now_ms() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0) }

/// 渡された文字列が URL として使えるか(長さ・制御文字)。ファイル経由で来たものも同じ基準で確かめ直す
pub fn valid_url(u: &str) -> bool { is_url(u) && u.len() <= MAX_URL && !u.chars().any(|c| c.is_control()) }

/// 自分の beat を書く(focus は最後にフォーカスされた時刻 ms)。古い beat の掃除もここで行う
pub fn beat(data: &Path, pid: u32, focus: u64) {
    let d = win_dir(data);
    if std::fs::create_dir_all(&d).is_err() { return; }
    let _ = std::fs::write(d.join(format!("{pid}.beat")), focus.to_string());
    if let Ok(rd) = std::fs::read_dir(&d) {
        for e in rd.flatten() {
            let old = e.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map_or(false, |a| a > STALE);
            if old { let _ = std::fs::remove_file(e.path()); }
        }
    }
}

/// 終わるとき、自分の beat と、受け取られなかった url を消す
pub fn leave(data: &Path, pid: u32) {
    let d = win_dir(data);
    let _ = std::fs::remove_file(d.join(format!("{pid}.beat")));
    let _ = std::fs::remove_file(d.join(format!("{pid}.url")));
}

/// 動いているウィンドウのうち、最後にフォーカスされたもの(同じなら beat が新しいもの)の pid。self_pid は除く
pub fn pick_target(data: &Path, self_pid: u32) -> Option<u32> {
    let mut best: Option<(u64, SystemTime, u32)> = None;
    for e in std::fs::read_dir(win_dir(data)).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(pid) = name.strip_suffix(".beat").and_then(|p| p.parse::<u32>().ok()) else { continue };
        if pid == self_pid { continue; }
        let Ok(m) = e.metadata() else { continue };
        let Ok(t) = m.modified() else { continue };
        if t.elapsed().map_or(true, |a| a > BEAT_FRESH) { continue; }
        let focus = std::fs::read_to_string(e.path()).ok().and_then(|s| s.trim().parse::<u64>().ok()).unwrap_or(0);
        if best.map_or(true, |(f, bt, _)| (focus, t) > (f, bt)) { best = Some((focus, t, pid)); }
    }
    best.map(|(_, _, p)| p)
}

/// 相手に URL を渡す(一時ファイルに書いてから rename)。渡せたら true
pub fn put_url(data: &Path, pid: u32, url: &str) -> bool {
    if !valid_url(url) { return false; }
    let d = win_dir(data);
    let tmp = d.join(format!("{pid}.url.tmp{}", std::process::id()));
    std::fs::write(&tmp, url).is_ok() && std::fs::rename(&tmp, d.join(format!("{pid}.url"))).is_ok()
}

/// 自分宛ての url があれば読んで消す
pub fn take_url(data: &Path, pid: u32) -> Option<String> {
    let f = win_dir(data).join(format!("{pid}.url"));
    let s = std::fs::read_to_string(&f).ok()?;
    let _ = std::fs::remove_file(&f);
    let s = s.trim().to_string();
    valid_url(&s).then_some(s)
}

/// 起動した側の処理。動いているウィンドウがあれば URL を渡し、受け取られるまで(最大 wait)待つ。受け取られたら true(= このプロセスは終わってよい)
pub fn hand_off(data: &Path, url: &str, wait: Duration) -> bool {
    let me = std::process::id();
    let Some(pid) = pick_target(data, me) else { return false };
    if !put_url(data, pid, url) { return false; }
    let f = win_dir(data).join(format!("{pid}.url"));
    let t0 = std::time::Instant::now();
    while t0.elapsed() < wait {
        if !f.exists() { return true; }
        std::thread::sleep(Duration::from_millis(50));
    }
    // 受け取られなかった。取り消して、自分で開く(消せなかった = 直前に受け取られた)
    std::fs::remove_file(&f).is_err()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn a(v: &[&str]) -> Vec<OsString> { v.iter().map(OsString::from).collect() }

    #[test]
    fn picks_url() {
        assert_eq!(pick_url(a(&["fixit://settings/look"])).as_deref(), Some("fixit://settings/look"));
        assert_eq!(pick_url(a(&["C:/x", "FIXIT://stats"])).as_deref(), Some("FIXIT://stats"));
        assert_eq!(pick_url(a(&["C:/x"])), None);
    }
    #[test]
    fn rejects_long_or_control() {
        assert_eq!(pick_url(a(&[&format!("fixit://{}", "a".repeat(MAX_URL))])), None);
        assert_eq!(pick_url(a(&["fixit://a\nb"])), None);
    }
    #[test]
    fn url_hides_other_args() {
        assert!(has_url(a(&["C:/x", "fixit://stats"])));
        // 長すぎて捨てた URL でも、ほかの引数は見ない
        assert!(has_url(a(&[&format!("fixit://{}", "a".repeat(MAX_URL)), "C:/x"])));
        assert!(!has_url(a(&["C:/x", "--new"])));
    }
    #[test]
    fn reads_registered_path() {
        let out = "\nHKEY_CURRENT_USER\\Software\\Classes\\fixit\\shell\\open\\command\n    (既定)    REG_SZ    \"C:\\a b\\Fixit.exe\" \"%1\"\n";
        assert_eq!(registered_path(out).as_deref(), Some("C:\\a b\\Fixit.exe"));
        assert_eq!(registered_path("none"), None);
    }
    #[test]
    fn reg_command_quotes_launcher() {
        let e = reg_entries(r"C:\Users\a b\Fixit.exe");
        assert!(e.iter().any(|(k, _, v)| k.ends_with(r"open\command") && v == r#""C:\Users\a b\Fixit.exe" "%1""#));
        assert!(e.iter().any(|(_, n, _)| *n == "URL Protocol"));
    }
    fn tmp(n: &str) -> PathBuf { let d = std::env::temp_dir().join(format!("fixit-proto-{n}-{}", std::process::id())); let _ = std::fs::remove_dir_all(&d); d }

    #[test]
    fn picks_focused_live_window() {
        let d = tmp("pick");
        assert_eq!(pick_target(&d, 1), None);
        beat(&d, 100, 5);
        beat(&d, 200, 9);
        beat(&d, 300, 0);
        assert_eq!(pick_target(&d, 1), Some(200)); // 最後にフォーカスされたもの
        assert_eq!(pick_target(&d, 200), Some(100)); // 自分は除く
        leave(&d, 200);
        assert_eq!(pick_target(&d, 1), Some(100));
        let _ = std::fs::remove_dir_all(&d);
    }
    #[test]
    fn ignores_stale_beat() {
        let d = tmp("stale");
        beat(&d, 100, 5);
        let f = win_dir(&d).join("100.beat");
        let old = SystemTime::now() - Duration::from_secs(60);
        std::fs::File::options().write(true).open(&f).unwrap().set_modified(old).unwrap();
        assert_eq!(pick_target(&d, 1), None);
        let _ = std::fs::remove_dir_all(&d);
    }
    #[test]
    fn url_round_trip_and_checks() {
        let d = tmp("rt");
        beat(&d, 100, 1);
        assert!(put_url(&d, 100, "fixit://stats"));
        assert_eq!(take_url(&d, 100).as_deref(), Some("fixit://stats"));
        assert_eq!(take_url(&d, 100), None); // 読んだら消える
        assert!(!put_url(&d, 100, "https://example.com"));
        assert!(!put_url(&d, 100, "fixit://a\nb"));
        // ファイルに直接置かれた不正な中身は読んでも捨てる
        std::fs::write(win_dir(&d).join("100.url"), "C:/Windows/system32/calc.exe").unwrap();
        assert_eq!(take_url(&d, 100), None);
        let _ = std::fs::remove_dir_all(&d);
    }
    #[test]
    fn hand_off_waits_for_receiver() {
        let d = tmp("ho");
        assert!(!hand_off(&d, "fixit://stats", Duration::from_millis(100))); // 相手がいない
        beat(&d, 100, 1);
        // 受け取る側(別スレッド)
        let d2 = d.clone();
        let h = std::thread::spawn(move || { for _ in 0..40 { if let Some(u) = take_url(&d2, 100) { return Some(u); } std::thread::sleep(Duration::from_millis(25)); } None });
        assert!(hand_off(&d, "fixit://stats", Duration::from_secs(2)));
        assert_eq!(h.join().unwrap().as_deref(), Some("fixit://stats"));
        // 誰も受け取らないとき: false を返し、url は残さない
        assert!(!hand_off(&d, "fixit://stats", Duration::from_millis(150)));
        assert!(!win_dir(&d).join("100.url").exists());
        let _ = std::fs::remove_dir_all(&d);
    }
}
