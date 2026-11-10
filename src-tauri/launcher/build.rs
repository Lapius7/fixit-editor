// 本体の exe と WebView2Loader.dll を取り込み、内容のハッシュ(展開先の名前)を決める。アイコンも付ける。
use std::{env, fs, path::PathBuf, process::Command};

fn fnv(b: &[u8], mut h: u64) -> u64 {
    for x in b { h ^= *x as u64; h = h.wrapping_mul(0x100000001b3); }
    h
}

fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let dir = PathBuf::from(env::var("FIXIT_PAYLOAD_DIR").expect("FIXIT_PAYLOAD_DIR に fixit-editor.exe と WebView2Loader.dll のフォルダを指定してください"));
    println!("cargo:rerun-if-env-changed=FIXIT_PAYLOAD_DIR");
    let mut h = 0xcbf29ce484222325u64;
    for n in ["fixit-editor.exe", "WebView2Loader.dll"] {
        let p = dir.join(n);
        println!("cargo:rerun-if-changed={}", p.display());
        let b = fs::read(&p).unwrap_or_else(|_| panic!("{} がありません", p.display()));
        h = fnv(&b, h);
        println!("cargo:rustc-env=FIXIT_PAYLOAD_{}={}", if n.ends_with("exe") { "EXE" } else { "DLL" }, p.display());
    }
    println!("cargo:rustc-env=FIXIT_PAYLOAD_ID={h:016x}");

    // アイコン(windres)
    let icon = fs::canonicalize("../icons/icon.ico").expect("icon.ico");
    let rc = out.join("launcher.rc");
    fs::write(&rc, format!("1 ICON \"{}\"\n", icon.display().to_string().replace('\\', "/"))).unwrap();
    let o = out.join("launcher-res.o");
    let st = Command::new("x86_64-w64-mingw32-windres").args(["-O", "coff", "-i"]).arg(&rc).arg("-o").arg(&o).status().expect("windres");
    assert!(st.success());
    println!("cargo:rustc-link-arg-bins={}", o.display());
    println!("cargo:rerun-if-changed=../icons/icon.ico");
}
