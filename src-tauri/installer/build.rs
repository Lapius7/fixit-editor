// インストールする本体(Fixit-Editor.exe)を取り込む。アイコンも付ける。
use std::{env, fs, path::PathBuf, process::Command};

fn main() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let app = PathBuf::from(env::var("FIXIT_APP_EXE").expect("FIXIT_APP_EXE にインストールする Fixit-Editor.exe を指定してください"));
    println!("cargo:rerun-if-env-changed=FIXIT_APP_EXE");
    println!("cargo:rerun-if-env-changed=FIXIT_VERSION");
    println!("cargo:rerun-if-changed={}", app.display());
    println!("cargo:rerun-if-changed=ui/index.html");
    println!("cargo:rustc-env=FIXIT_APP_EXE_PATH={}", fs::canonicalize(&app).expect("app exe").display());

    let icon = fs::canonicalize("../icons/icon.ico").expect("icon.ico");
    let rc = out.join("setup.rc");
    fs::write(&rc, format!("1 ICON \"{}\"\n", icon.display().to_string().replace('\\', "/"))).unwrap();
    let o = out.join("setup-res.o");
    let st = Command::new("x86_64-w64-mingw32-windres").args(["-O", "coff", "-i"]).arg(&rc).arg("-o").arg(&o).status().expect("windres");
    assert!(st.success());
    println!("cargo:rustc-link-arg-bins={}", o.display());
    println!("cargo:rerun-if-changed=../icons/icon.ico");
}
