// Fixit Editor のインストーラー。画面は ui/index.html(WebView2 で表示)、実際の処理はこのファイル。
// 起動は launcher 経由(WebView2Loader.dll と一緒に一時フォルダへ展開される)。launcher が FIXIT_LAUNCHER に、
// 起動した exe(Setup.exe)の場所を渡す。アンインストーラーはその Setup.exe の複製(Uninstall.exe)。
// 管理者権限は使わない。現在のユーザー用に %LOCALAPPDATA%\Programs\Fixit Editor へ入れる。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tao::platform::windows::WindowBuilderExtWindows;
use std::{env, fs, io, os::windows::process::CommandExt, path::{Path, PathBuf}, process::Command, thread, time::Duration};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{WebContext, WebViewBuilder};

const APP: &[u8] = include_bytes!(env!("FIXIT_APP_EXE_PATH"));
const ICON: &[u8] = include_bytes!("../../icons/icon.png");
const HTML: &str = include_str!("../ui/index.html");
const VERSION: &str = match option_env!("FIXIT_VERSION") { Some(v) => v, None => env!("CARGO_PKG_VERSION") };

const REG_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\FixitEditor";
const EXE_NAME: &str = "Fixit.exe";
const OLD_EXE_NAME: &str = "Fixit-Editor.exe"; // 旧版の名前。入れ替えるときに消す
const NO_WINDOW: u32 = 0x0800_0000; // CREATE_NO_WINDOW

enum Ev { Js(String), Drag, Min, Exit }

fn var(n: &str) -> PathBuf { env::var_os(n).map(PathBuf::from).unwrap_or_default() }
fn install_dir() -> PathBuf { var("LOCALAPPDATA").join("Programs").join("Fixit Editor") }
fn cache_dir() -> PathBuf { var("LOCALAPPDATA").join("Fixit Editor") }
fn data_dir() -> PathBuf { var("APPDATA").join("Fixit") }

// ---- レジストリ(アプリと機能の一覧に出すための登録) ----
mod reg {
    use std::{ffi::OsStr, os::windows::ffi::OsStrExt, ptr::null_mut};
    #[link(name = "advapi32")]
    extern "system" {
        fn RegCreateKeyExW(h: isize, sub: *const u16, res: u32, class: *const u16, opt: u32, sam: u32, sa: *const u8, out: *mut isize, disp: *mut u32) -> i32;
        fn RegSetValueExW(h: isize, name: *const u16, res: u32, ty: u32, data: *const u8, len: u32) -> i32;
        fn RegCloseKey(h: isize) -> i32;
        fn RegDeleteTreeW(h: isize, sub: *const u16) -> i32;
    }
    const HKCU: isize = 0x8000_0001u32 as i32 as isize;
    fn w(s: &str) -> Vec<u16> { OsStr::new(s).encode_wide().chain(Some(0)).collect() }

    pub enum V<'a> { S(&'a str), N(u32) }
    pub fn set(sub: &str, vals: &[(&str, V)]) -> Result<(), String> {
        unsafe {
            let mut h = 0isize;
            let r = RegCreateKeyExW(HKCU, w(sub).as_ptr(), 0, null_mut(), 0, 0x20006, std::ptr::null(), &mut h, null_mut());
            if r != 0 { return Err(format!("registry {r}")); }
            let mut res = Ok(());
            for (n, v) in vals {
                let r = match v {
                    V::S(s) => { let d = w(s); RegSetValueExW(h, w(n).as_ptr(), 0, 1, d.as_ptr() as *const u8, (d.len() * 2) as u32) }
                    V::N(x) => RegSetValueExW(h, w(n).as_ptr(), 0, 4, x as *const u32 as *const u8, 4),
                };
                if r != 0 { res = Err(format!("registry {r}")); }
            }
            RegCloseKey(h);
            res
        }
    }
    pub fn delete(sub: &str) { unsafe { RegDeleteTreeW(HKCU, w(sub).as_ptr()); } }
}

fn ps(script: &str) -> io::Result<bool> {
    Ok(Command::new("powershell").args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(NO_WINDOW).status()?.success())
}
fn q(p: &Path) -> String { p.display().to_string().replace('\'', "''") }

fn msg_err(e: impl std::fmt::Display) -> String { e.to_string() }

// ---- インストール ----
fn put_exe(dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(msg_err)?;
    let to = dir.join(EXE_NAME);
    let tmp = dir.join(format!("{EXE_NAME}.{}.part", std::process::id()));
    fs::write(&tmp, APP).map_err(msg_err)?;
    if to.exists() && fs::remove_file(&to).is_err() {
        // 起動中の exe は消せないが、名前は変えられる(更新のとき)
        let old = dir.join(format!("{EXE_NAME}.{}.old", std::process::id()));
        if fs::rename(&to, &old).is_err() { let _ = fs::remove_file(&tmp); return Err("running".into()); }
    }
    fs::rename(&tmp, &to).map_err(|e| { let _ = fs::remove_file(&tmp); msg_err(e) })?;
    let _ = fs::remove_file(dir.join(OLD_EXE_NAME)); // 旧版の名前の exe
    // 前回の更新で残った古い exe を片づける
    if let Ok(rd) = fs::read_dir(dir) { for e in rd.flatten() { if e.file_name().to_string_lossy().ends_with(".old") { let _ = fs::remove_file(e.path()); } } }
    // アンインストーラーは、このセットアップの exe(launcher)の複製
    if let Some(me) = env::var_os("FIXIT_LAUNCHER").map(PathBuf::from).filter(|p| p.exists()) {
        let un = dir.join("Uninstall.exe");
        let _ = fs::remove_file(&un);
        fs::copy(&me, &un).map_err(msg_err)?;
    }
    Ok(to)
}

fn shortcuts(exe: &Path, dir: &Path, desktop: bool) -> Result<(), String> {
    let (e, d) = (q(exe), q(dir));
    let script = format!(
        "$s=New-Object -ComObject WScript.Shell; function L($p){{$l=$s.CreateShortcut($p);$l.TargetPath='{e}';$l.WorkingDirectory='{d}';$l.IconLocation='{e},0';$l.Description='Fixit Editor';$l.Save()}}; \
         L((Join-Path ([Environment]::GetFolderPath('Programs')) 'Fixit Editor.lnk')); {}",
        if desktop { "L((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Fixit Editor.lnk'))" } else { "" }
    );
    if ps(&script).map_err(msg_err)? { Ok(()) } else { Err("shortcut".into()) }
}

fn register(dir: &Path, exe: &Path) -> Result<(), String> {
    let un = dir.join("Uninstall.exe");
    let cmd = format!("\"{}\" --uninstall", un.display());
    let mb = (APP.len() / 1024) as u32 + 2048;
    reg::set(REG_KEY, &[
        ("DisplayName", reg::V::S("Fixit Editor")),
        ("DisplayVersion", reg::V::S(VERSION)),
        ("Publisher", reg::V::S("Lapius")),
        ("InstallLocation", reg::V::S(&dir.display().to_string())),
        ("DisplayIcon", reg::V::S(&exe.display().to_string())),
        ("UninstallString", reg::V::S(&cmd)),
        ("NoModify", reg::V::N(1)),
        ("NoRepair", reg::V::N(1)),
        ("EstimatedSize", reg::V::N(mb)),
    ])
}

// ---- アンインストール ----
fn remove_dir_retry(p: &Path) -> Result<(), String> {
    for _ in 0..12 {
        if !p.exists() || fs::remove_dir_all(p).is_ok() { return Ok(()); }
        thread::sleep(Duration::from_millis(300));
    }
    Err("running".into())
}

fn nap() { thread::sleep(Duration::from_millis(350)); }

fn base64(b: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(b.len() * 4 / 3 + 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        o.push(T[(n >> 18) as usize & 63] as char);
        o.push(T[(n >> 12) as usize & 63] as char);
        o.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        o.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    o
}

fn main() {
    let uninstall = env::args().any(|a| a == "--uninstall");
    let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title(if uninstall { "Fixit Editor Uninstall" } else { "Fixit Editor Setup" })
        .with_inner_size(LogicalSize::new(680.0, 400.0))
        .with_resizable(false)
        .with_maximizable(false)
        .with_decorations(false)
        .with_undecorated_shadow(true)
        .build(&event_loop)
        .expect("window");
    if let Some(m) = window.current_monitor() {
        let (s, z, w) = (m.size(), window.outer_size(), m.position());
        window.set_outer_position(tao::dpi::PhysicalPosition::new(w.x + (s.width as i32 - z.width as i32) / 2, w.y + (s.height as i32 - z.height as i32) / 2));
    }

    let html = HTML.replace("{{ICON}}", &format!("data:image/png;base64,{}", base64(ICON)));
    // WebView2 の作業フォルダは、インストール先やダウンロードの横ではなく一時フォルダに置く
    let mut ctx = WebContext::new(Some(env::temp_dir().join("Fixit Setup WebView")));
    let p2 = proxy.clone();
    let webview = WebViewBuilder::new_with_web_context(&mut ctx)
        .with_html(html)
        .with_background_color((233, 224, 255, 255))
        .with_initialization_script("window.send=function(m){window.ipc.postMessage(JSON.stringify(m))};")
        .with_ipc_handler(move |req| {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(req.body()) else { return };
            let js = |m: serde_json::Value| { let _ = p2.send_event(Ev::Js(m.to_string())); };
            match v["t"].as_str().unwrap_or("") {
                "ready" => {
                    let installed = install_dir().join(EXE_NAME).exists();
                    js(serde_json::json!({ "t": "init", "mode": if uninstall { "uninstall" } else { "install" }, "version": VERSION, "dir": install_dir().display().to_string(), "installed": installed }));
                }
                "drag" => { let _ = p2.send_event(Ev::Drag); }
                "min" => { let _ = p2.send_event(Ev::Min); }
                "close" => { let _ = p2.send_event(Ev::Exit); }
                "launch" => {
                    let dir = install_dir();
                    let _ = Command::new(dir.join(EXE_NAME)).current_dir(&dir).spawn();
                    let _ = p2.send_event(Ev::Exit);
                }
                "install" => {
                    let desktop = v["desktop"].as_bool().unwrap_or(false);
                    let p = p2.clone();
                    thread::spawn(move || {
                        let send = |m: serde_json::Value| { let _ = p.send_event(Ev::Js(m.to_string())); };
                        let dir = install_dir();
                        let run = || -> Result<(), String> {
                            send(serde_json::json!({ "t": "step", "i": 0 })); nap();
                            let exe = put_exe(&dir)?;
                            send(serde_json::json!({ "t": "step", "i": 1 })); nap();
                            shortcuts(&exe, &dir, desktop)?;
                            send(serde_json::json!({ "t": "step", "i": 2 })); nap();
                            register(&dir, &exe)?;
                            nap();
                            Ok(())
                        };
                        match run() {
                            Ok(()) => send(serde_json::json!({ "t": "done" })),
                            Err(e) => send(serde_json::json!({ "t": "error", "code": e })),
                        }
                    });
                }
                "uninstall" => {
                    let wipe = v["data"].as_bool().unwrap_or(false);
                    let p = p2.clone();
                    thread::spawn(move || {
                        let send = |m: serde_json::Value| { let _ = p.send_event(Ev::Js(m.to_string())); };
                        let run = || -> Result<(), String> {
                            send(serde_json::json!({ "t": "step", "i": 0 })); nap();
                            let _ = ps("foreach($k in 'Programs','Desktop'){ $f=Join-Path ([Environment]::GetFolderPath($k)) 'Fixit Editor.lnk'; if(Test-Path $f){Remove-Item $f -Force} }");
                            reg::delete(REG_KEY);
                            send(serde_json::json!({ "t": "step", "i": 1 })); nap();
                            remove_dir_retry(&install_dir())?;
                            let c = cache_dir();
                            let _ = fs::remove_dir_all(c.join("bin"));
                            let _ = fs::remove_dir(&c);
                            if wipe { let _ = fs::remove_dir_all(data_dir()); }
                            nap();
                            Ok(())
                        };
                        match run() {
                            Ok(()) => send(serde_json::json!({ "t": "done" })),
                            Err(e) => send(serde_json::json!({ "t": "error", "code": e })),
                        }
                    });
                }
                _ => {}
            }
        })
        .build(&window)
        .expect("webview");

    event_loop.run(move |event, _, flow| {
        *flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(Ev::Js(m)) => { let _ = webview.evaluate_script(&format!("window.fx&&window.fx({m})")); }
            Event::UserEvent(Ev::Drag) => { let _ = window.drag_window(); }
            Event::UserEvent(Ev::Min) => window.set_minimized(true),
            Event::UserEvent(Ev::Exit) => *flow = ControlFlow::Exit,
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *flow = ControlFlow::Exit,
            _ => {}
        }
    });
}
