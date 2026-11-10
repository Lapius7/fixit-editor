// ブラウザ版(Node)と同じ振る舞いかを、Linux 上で確かめる試験。
// SSH は、PATH の先頭に置いたダミーの ssh(受け取ったコマンドをそのまま sh で動かす)で、クォートの崩れを確かめる。
use fixit_core::fs::{dispatch, Q, Reply};
use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

fn q(kv: &[(&str, &str)]) -> Q { kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect() }
fn dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("fixit-core-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}
fn json(r: Reply) -> serde_json::Value { match r { Reply::Json(v) => v, Reply::Bytes(_) => panic!("json のはず") } }
fn bytes(r: Reply) -> Vec<u8> { match r { Reply::Bytes(b) => b, Reply::Json(_) => panic!("bytes のはず") } }

// `ssh [-o x]... -- host "cmd"` を受けて cmd を sh で動かすダミー
fn fake_ssh() {
    let d = dir("bin");
    let p = d.join("ssh");
    fs::write(&p, "#!/bin/sh\nwhile [ \"$1\" != \"--\" ]; do shift; done\nshift 2\nexec sh -c \"$1\"\n").unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
    let old = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{old}", d.display()));
}

#[test]
fn local_roundtrip_with_awkward_names() {
    let root = dir("local");
    let p = root.join("it's \"q\" $x 日本語");
    let ps = p.to_str().unwrap();
    dispatch("mkdir", &q(&[("kind", "wsl"), ("path", ps)]), None).unwrap();
    let data: Vec<u8> = (0..5000u32).map(|i| (i * 7 % 256) as u8).collect();
    dispatch("write", &q(&[("kind", "wsl"), ("path", &format!("{ps}/b.bin"))]), Some(data.clone())).unwrap();
    let back = bytes(dispatch("read", &q(&[("kind", "wsl"), ("path", &format!("{ps}/b.bin"))]), None).unwrap());
    assert_eq!(back, data);
    let list = json(dispatch("list", &q(&[("kind", "wsl"), ("path", ps)]), None).unwrap());
    assert_eq!(list["entries"][0]["name"], "b.bin");
    assert_eq!(list["entries"][0]["size"], 5000.0);
}

#[test]
fn errors_match_node() {
    let root = dir("err");
    let nope = format!("{}/nope", root.display());
    let e = dispatch("read", &q(&[("kind", "wsl"), ("path", &nope)]), None).err().unwrap();
    assert_eq!((e.status, e.code.as_str()), (404, "ENOENT"));
    let e = dispatch("read", &q(&[("kind", "wsl"), ("path", root.to_str().unwrap())]), None).err().unwrap();
    assert_eq!((e.status, e.code.as_str()), (400, "EISDIR"));
    let e = dispatch("list", &q(&[("kind", "wsl"), ("path", "relative")]), None).err().unwrap();
    assert_eq!(e.status, 400);
    // 存在しないフォルダの find は、エラーではなく空の一覧
    let r = json(dispatch("find", &q(&[("kind", "wsl"), ("path", &nope)]), None).unwrap());
    assert_eq!(r["files"].as_array().unwrap().len(), 0);
    let e = dispatch("rm", &q(&[("kind", "wsl"), ("path", "/")]), None).err().unwrap();
    assert_eq!(e.code, "EARG");
    let e = dispatch("bogus", &q(&[]), None).err().unwrap();
    assert_eq!(e.status, 404);
}

#[test]
fn too_big_is_413() {
    let root = dir("big");
    let f = root.join("big.bin");
    fs::write(&f, vec![0u8; 2 * 1024 * 1024]).unwrap();
    let e = dispatch("read", &q(&[("kind", "wsl"), ("path", f.to_str().unwrap()), ("maxMB", "1")]), None).err().unwrap();
    assert_eq!((e.status, e.code.as_str()), (413, "ETOOBIG"));
}

#[test]
fn ssh_quoting_survives() {
    fake_ssh();
    let root = dir("ssh");
    let p = root.join("a'b \"c\" $d 日本");
    let ps = p.to_str().unwrap();
    let base = [("kind", "ssh"), ("host", "h")];
    let with = |extra: &[(&'static str, &str)]| { let mut v: Vec<(&str, &str)> = base.to_vec(); v.extend_from_slice(extra); q(&v) };
    dispatch("mkdir", &with(&[("path", ps)]), None).unwrap();
    let file = format!("{ps}/f.txt");
    dispatch("write", &with(&[("path", &file)]), Some("こんにちは\n'x'".as_bytes().to_vec())).unwrap();
    assert_eq!(bytes(dispatch("read", &with(&[("path", &file)]), None).unwrap()), "こんにちは\n'x'".as_bytes());
    let g = json(dispatch("grep", &with(&[("path", ps), ("q", "'x'")]), None).unwrap());
    assert_eq!(g["hits"][0]["line"], 2);
    // ホスト名の検査
    let e = dispatch("list", &q(&[("kind", "ssh"), ("host", "-oProxyCommand=x"), ("path", "/")]), None).err().unwrap();
    assert_eq!(e.status, 400);
}
