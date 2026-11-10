// Fixit Editor を 1 ファイルで配る起動ファイル。
// 本体(fixit-editor.exe)と WebView2Loader.dll を内包し、初回だけ %LOCALAPPDATA% に展開して本体を起動する。
// 設定・ワークスペースなどの保存先は本体が決める(展開先には置かない)ので、版が変わっても残る。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{env, fs, io, path::PathBuf, process::Command};

const EXE: &[u8] = include_bytes!(env!("FIXIT_PAYLOAD_EXE"));
const DLL: &[u8] = include_bytes!(env!("FIXIT_PAYLOAD_DLL"));
const ID: &str = env!("FIXIT_PAYLOAD_ID");

fn base() -> PathBuf {
    env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(env::temp_dir).join("Fixit Editor").join("bin")
}

fn ready(dir: &PathBuf) -> bool {
    dir.join(".ok").exists() && dir.join("fixit-editor.exe").exists() && dir.join("WebView2Loader.dll").exists()
}

// 複数のウィンドウを同時に起動しても衝突しないようにする。
// 一時ファイルの名前は起動ごとに変え、置き換えに失敗したら、ほかの起動が展開し終えるのを待つ
fn extract(dir: &PathBuf) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    if ready(dir) { return Ok(()); }
    let pid = std::process::id();
    // 途中で切れたときに壊れたファイルを残さないよう、別名で書いてから置き換える
    for (name, data) in [("WebView2Loader.dll", DLL), ("fixit-editor.exe", EXE)] {
        let tmp = dir.join(format!("{name}.{pid}.part"));
        fs::write(&tmp, data)?;
        let to = dir.join(name);
        let _ = fs::remove_file(&to);
        if let Err(e) = fs::rename(&tmp, &to) {
            let _ = fs::remove_file(&tmp);
            // 先に起動したほうが使っている最中(または展開中)なら、終わるのを待つ
            for _ in 0..40 { if ready(dir) { return Ok(()); } std::thread::sleep(std::time::Duration::from_millis(100)); }
            return Err(e);
        }
    }
    fs::write(dir.join(".ok"), ID)
}

// 古い版の展開先を片づける(今の版と、動作中のものは残す)
fn sweep(base: &PathBuf, keep: &str) {
    let Ok(rd) = fs::read_dir(base) else { return };
    for e in rd.flatten() {
        if e.file_name().to_string_lossy() != keep { let _ = fs::remove_dir_all(e.path()); }
    }
}

fn main() {
    let b = base();
    let dir = b.join(ID);
    if let Err(e) = extract(&dir) {
        msg(&format!("Fixit Editor を準備できませんでした。\n{e}\n{}", dir.display()));
        return;
    }
    sweep(&b, ID);
    if let Err(e) = Command::new(dir.join("fixit-editor.exe")).args(env::args_os().skip(1)).current_dir(&dir).spawn() {
        msg(&format!("Fixit Editor を起動できませんでした。\n{e}"));
    }
}

#[cfg(windows)]
fn msg(t: &str) {
    #[link(name = "user32")]
    extern "system" { fn MessageBoxW(h: isize, text: *const u16, cap: *const u16, ty: u32) -> i32; }
    let w = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    unsafe { MessageBoxW(0, w(t).as_ptr(), w("Fixit Editor").as_ptr(), 0x10); }
}
#[cfg(not(windows))]
fn msg(t: &str) { eprintln!("{t}"); }
