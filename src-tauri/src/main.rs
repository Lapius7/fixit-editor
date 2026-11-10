// リリースビルドで、Windows のコンソール窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD, Engine};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::{collections::HashMap, io::{Read, Write}, sync::Mutex, thread};
use fixit_core::{claude, fonts, fs as fxfs, store, update};
use std::sync::Arc;
use tauri::{ipc::{Channel, Request, Response}, AppHandle, Emitter, State};

// ターミナル(疑似端末)。開発サーバーの /__term と同じ役目を、デスクトップ版で受け持つ
struct Pty { master: Box<dyn MasterPty + Send>, writer: Box<dyn Write + Send>, child: Box<dyn portable_pty::Child + Send + Sync> }
#[derive(Default)]
struct Ptys(Mutex<HashMap<String, Pty>>);

fn sq(s: &str) -> String { format!("'{}'", s.replace('\'', "'\\''")) }

fn which(name: &str) -> bool {
    std::env::var_os("PATH").map_or(false, |p| std::env::split_paths(&p).any(|d| d.join(name).exists()))
}


#[derive(serde::Serialize)]
struct ShellInfo { id: String, label: String }

fn git_bash() -> Option<std::path::PathBuf> {
    let mut roots: Vec<std::path::PathBuf> = vec![];
    for k in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(v) = std::env::var_os(k) { roots.push(std::path::PathBuf::from(v)); }
    }
    roots.iter().flat_map(|r| [r.join("Git\\bin\\bash.exe"), r.join("Programs\\Git\\bin\\bash.exe")]).find(|p| p.exists())
}

// 入っているシェルの一覧(ターミナルを追加するとき、選べるようにする)
#[tauri::command(async)]
fn pty_shells() -> Vec<ShellInfo> {
    let mut v = vec![];
    let mut add = |id: &str, label: &str| v.push(ShellInfo { id: id.into(), label: label.into() });
    if which("pwsh.exe") { add("pwsh", "PowerShell 7"); }
    add("powershell", "Windows PowerShell");
    add("cmd", "コマンド プロンプト");
    if git_bash().is_some() { add("gitbash", "Git Bash"); }
    let mut d: Vec<String> = vec![];
    if which("wsl.exe") {
        let mut c = std::process::Command::new("wsl.exe");
        c.args(["-l", "-q"]);
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; c.creation_flags(0x08000000); }
        if let Ok(o) = c.output() {
            // wsl.exe は UTF-16LE で出力する
            let u: Vec<u16> = o.stdout.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
            d = String::from_utf16_lossy(&u).lines().map(|l| l.trim().trim_start_matches('\u{feff}').to_string())
                .filter(|l| !l.is_empty() && !l.starts_with("docker-desktop")).collect();
        }
    }
    if d.is_empty() { add("wsl", "WSL"); }
    for n in d { v.push(ShellInfo { id: format!("wsl:{n}"), label: format!("WSL · {n}") }); }
    v
}

#[tauri::command]
fn pty_open(app: AppHandle, state: State<Ptys>, id: String, host: Option<String>, cwd: Option<String>, shell: Option<String>, cols: u16, rows: u16) -> Result<(), String> {
    let host = host.unwrap_or_default();
    let cwd = cwd.unwrap_or_default();
    let shell = shell.unwrap_or_default();
    if !host.is_empty() && (host.starts_with('-') || !host.chars().all(|c| c.is_ascii_alphanumeric() || "-_.@:".contains(c))) {
        return Err("接続先の名前が正しくありません".into());
    }
    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd;
    if !host.is_empty() {
        cmd = CommandBuilder::new("ssh");
        let remote = format!(
            "sh -c {}",
            sq(&format!("{}exec \"${{SHELL:-/bin/sh}}\" -l", if cwd.is_empty() { String::new() } else { format!("cd {} 2>/dev/null; ", sq(&cwd)) }))
        );
        cmd.args(["-t", "-o", "ConnectTimeout=10", "--", &host, &remote]);
    } else if shell == "wsl" || shell.starts_with("wsl:") || (shell.is_empty() && cwd.starts_with('/')) {
        cmd = CommandBuilder::new("wsl.exe");
        if let Some(d) = shell.strip_prefix("wsl:") {
            if d.is_empty() || d.starts_with('-') || d.contains(['"', '\0', '\r', '\n']) { return Err("ディストリビューション名が正しくありません".into()); }
            cmd.args(["-d", d]);
        }
        if cwd.starts_with('/') { cmd.args(["--cd", &cwd]); } else { cmd.args(["--cd", "~"]); }
    } else {
        let home = std::env::var_os("USERPROFILE");
        match shell.as_str() {
            "cmd" => { cmd = CommandBuilder::new("cmd.exe"); }
            "powershell" => { cmd = CommandBuilder::new("powershell.exe"); cmd.arg("-NoLogo"); }
            "pwsh" => { cmd = CommandBuilder::new("pwsh.exe"); cmd.arg("-NoLogo"); }
            "gitbash" => {
                let b = git_bash().ok_or("Git Bash が見つかりません")?;
                cmd = CommandBuilder::new(b);
                cmd.args(["--login", "-i"]);
            }
            "" => { cmd = CommandBuilder::new(if which("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" }); cmd.arg("-NoLogo"); }
            _ => return Err("そのシェルは使えません".into()),
        }
        // 開いているフォルダが、この PC にある実在のフォルダなら、そこで始める
        let here = cwd.replace('/', std::path::MAIN_SEPARATOR_STR);
        if !cwd.is_empty() && !cwd.starts_with('/') && std::path::Path::new(&here).is_dir() { cmd.cwd(here); }
        else if let Some(h) = home { cmd.cwd(h); }
    }
    cmd.env("TERM", "xterm-256color");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("シェルを起動できませんでした: {e}"))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    state.0.lock().unwrap().insert(id.clone(), Pty { master: pair.master, writer, child });
    let (a, i) = (app.clone(), id.clone());
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => { let _ = a.emit(&format!("pty-data-{i}"), STANDARD.encode(&buf[..n])); }
            }
        }
        let _ = a.emit(&format!("pty-exit-{i}"), ());
    });
    Ok(())
}

#[tauri::command]
fn pty_write(state: State<Ptys>, id: String, data: String) {
    if let Some(p) = state.0.lock().unwrap().get_mut(&id) { let _ = p.writer.write_all(data.as_bytes()); let _ = p.writer.flush(); }
}

#[tauri::command]
fn pty_resize(state: State<Ptys>, id: String, cols: u16, rows: u16) {
    if let Some(p) = state.0.lock().unwrap().get(&id) {
        let _ = p.master.resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 });
    }
}

#[tauri::command]
fn pty_close(state: State<Ptys>, id: String) {
    if let Some(mut p) = state.0.lock().unwrap().remove(&id) { let _ = p.child.kill(); }
}


// ---- ファイル操作(ブラウザ版の /__fs と同じ。中身は fixit-core) ----
#[derive(serde::Serialize)]
struct FsErr { error: String, code: String, status: u16 }
impl From<fxfs::FsError> for FsErr {
    fn from(e: fxfs::FsError) -> Self { FsErr { error: e.message, code: e.code, status: e.status } }
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(Ok(v)) = s.get(i + 1..i + 3).map(|h| u8::from_str_radix(h, 16)) { out.push(v); i += 3; continue; }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
async fn fs_op(op: String, q: HashMap<String, String>) -> Result<Response, FsErr> {
    tauri::async_runtime::spawn_blocking(move || fxfs::dispatch(&op, &q, None))
        .await
        .map_err(|e| FsErr { error: e.to_string(), code: "EIO".into(), status: 500 })?
        .map(|r| Response::new(r.into_bytes()))
        .map_err(Into::into)
}

// 書き込み。本文は生のバイト列で受け、操作とクエリはヘッダー(x-fixit-q)で受ける
#[tauri::command]
async fn fs_write(request: Request<'_>) -> Result<Response, FsErr> {
    let bad = |m: &str| FsErr { error: m.into(), code: "EARG".into(), status: 400 };
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else { return Err(bad("本文がありません")) };
    let body = body.clone();
    let h = request.headers().get("x-fixit-q").and_then(|v| v.to_str().ok()).ok_or_else(|| bad("クエリがありません"))?;
    let v: serde_json::Value = serde_json::from_str(&pct_decode(h)).map_err(|_| bad("クエリが正しくありません"))?;
    let op = v.get("op").and_then(|x| x.as_str()).unwrap_or("write").to_string();
    let q: HashMap<String, String> = v.get("q").and_then(|x| x.as_object()).map(|o| o.iter().filter_map(|(k, x)| x.as_str().map(|s| (k.clone(), s.to_string()))).collect()).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || fxfs::dispatch(&op, &q, Some(body)))
        .await
        .map_err(|e| FsErr { error: e.to_string(), code: "EIO".into(), status: 500 })?
        .map(|r| Response::new(r.into_bytes()))
        .map_err(Into::into)
}

// フォルダを選ぶ(OS の標準ダイアログ)。ブラウザの showDirectoryPicker のような「変更を保存しますか」の確認は出ない
#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow, title: Option<String>) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut d = rfd::FileDialog::new().set_parent(&window);
        if let Some(t) = title { d = d.set_title(t); }
        d.pick_folder().map(|p| p.to_string_lossy().replace('\\', "/"))
    })
    .await
    .ok()
    .flatten()
}

// ---- アプリのデータ(設定・AI の会話履歴など)。%APPDATA%\Fixit の JSON ファイルに残す ----
fn data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().data_dir().map(|d| d.join("Fixit")).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct StoreAll { dir: String, files: HashMap<String, String> }

#[tauri::command]
async fn store_load(app: AppHandle) -> Result<StoreAll, String> {
    let d = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || StoreAll { dir: d.to_string_lossy().into_owned(), files: store::load(&d) }).await.map_err(|e| e.to_string())
}

// 1 つのキーだけ読む(ほかのウィンドウの更新を取り込むとき)
#[tauri::command]
async fn store_read(app: AppHandle, key: String) -> Result<Option<String>, String> {
    let d = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::read(&d, &key)).await.map_err(|e| e.to_string())
}

// 各キーの更新の目印。ほかのウィンドウが書き換えたかを調べる
#[tauri::command]
async fn store_stamps(app: AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    let d = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::stamps(&d)).await.map_err(|e| e.to_string())
}

// value が None のときは、そのキーのファイルを消す
#[tauri::command]
async fn store_save(app: AppHandle, key: String, value: Option<String>) -> Result<(), String> {
    let d = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || store::save(&d, &key, value.as_deref())).await.map_err(|e| e.to_string())?
}

// ---- Claude(サブスク)。ブラウザ版の /__claude と同じ ----
#[derive(Default)]
struct Jobs(Mutex<HashMap<String, Arc<claude::Job>>>);

#[tauri::command]
async fn claude_chat(state: State<'_, Jobs>, id: String, system: String, model: String, effort: String, messages: Vec<claude::Msg>, on_event: Channel<claude::Event>) -> Result<(), String> {
    if messages.is_empty() || messages.iter().any(|m| m.role != "user" && m.role != "assistant") {
        return Err("messages".into());
    }
    let job = Arc::new(claude::Job::default());
    state.0.lock().unwrap().insert(id.clone(), job.clone());
    let j = job.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        claude::chat(&system, &model, &effort, &messages, &j, &mut |e| { let _ = on_event.send(e); });
    })
    .await;
    state.0.lock().unwrap().remove(&id);
    r.map_err(|e| e.to_string())
}

#[tauri::command]
async fn claude_status() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| claude::status().to_string()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn claude_login(state: State<'_, Jobs>, id: String, on_event: Channel<claude::Event>) -> Result<(), String> {
    let job = Arc::new(claude::Job::default());
    state.0.lock().unwrap().insert(id.clone(), job.clone());
    let j = job.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        claude::login(&j, &mut |e| { let _ = on_event.send(e); });
    })
    .await;
    state.0.lock().unwrap().remove(&id);
    r.map_err(|e| e.to_string())
}

#[tauri::command]
fn claude_cancel(state: State<Jobs>, id: String) {
    if let Some(j) = state.0.lock().unwrap().get(&id) { j.cancel(); }
}

// 既定のブラウザで URL を開く。ログイン画面(Lapount)など、決まった https のアドレスだけを許す
const OPEN_ALLOW: [&str; 1] = ["https://account.lapius7.com/"];
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !OPEN_ALLOW.iter().any(|p| url.starts_with(p)) || url.len() > 2048 || url.chars().any(|c| c.is_control() || c == ' ') {
        return Err("not allowed".into());
    }
    #[cfg(windows)]
    let mut c = {
        use std::os::windows::process::CommandExt;
        let mut c = std::process::Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]).creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut c = { let mut c = std::process::Command::new("xdg-open"); c.arg(&url); c };
    c.spawn().map(|_| ()).map_err(|e| e.to_string())
}

// この PC に入っているフォントの家族名(設定の書体の選択肢)。読み込みに時間がかかるので別スレッドで行う
#[tauri::command]
async fn list_fonts() -> Result<Vec<fonts::FontFamily>, String> {
    tauri::async_runtime::spawn_blocking(fonts::list_families).await.map_err(|e| e.to_string())
}

// 更新を適用する。署名とハッシュを確かめた本体だけを起動ファイルと置き換えて、新しい版を起動し直す。
// 起動ファイルの場所は、1 ファイル配布の launcher が FIXIT_LAUNCHER に入れて渡す(それ以外の起動では更新しない)
#[tauri::command]
async fn apply_update(app: AppHandle, version: String, sha256: String, size: u64, sig: String, url: String) -> Result<(), String> {
    let launcher = std::env::var_os("FIXIT_LAUNCHER").map(std::path::PathBuf::from).ok_or("no_launcher")?;
    let l2 = launcher.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = update::download(&url)?;
        update::verify(&version, &sha256, size, &sig, &data)?;
        update::swap(&l2, &data)
    })
    .await
    .map_err(|e| e.to_string())??;
    std::process::Command::new(&launcher).args(std::env::args_os().skip(1)).spawn().map_err(|e| e.to_string())?;
    app.exit(0);
    Ok(())
}

fn main() {
    if let Some(l) = std::env::var_os("FIXIT_LAUNCHER") { update::sweep_old(std::path::Path::new(&l)); }
    tauri::Builder::default()
        .manage(Ptys::default())
        .manage(Jobs::default())
        .invoke_handler(tauri::generate_handler![pty_open, pty_shells, pty_write, pty_resize, pty_close, fs_op, fs_write, pick_folder, claude_chat, claude_status, claude_login, claude_cancel, store_load, store_read, store_stamps, store_save, apply_update, list_fonts, open_url])
        .run(tauri::generate_context!())
        .expect("フィクシットエディタを起動できませんでした");
}
