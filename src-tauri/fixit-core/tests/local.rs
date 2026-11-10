use fixit_core::fs::{dispatch, Reply};
use std::collections::HashMap;

fn q(kv: &[(&str, &str)]) -> HashMap<String, String> {
    let mut m: HashMap<String, String> = kv.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    m.insert("kind".into(), "pc".into());
    m
}
fn js(r: Reply) -> serde_json::Value { serde_json::from_slice(&r.into_bytes()).unwrap() }

#[test]
fn local_roundtrip() {
    let d = std::env::temp_dir().join(format!("fx-local-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    let r = d.to_string_lossy().replace('\\', "/");
    let p = |s: &str| format!("{r}/{s}");
    dispatch("mkdir", &q(&[("path", &p("a b/日本"))]), None).unwrap();
    dispatch("write", &q(&[("path", &p("a b/日本/x.txt"))]), Some(b"hello\nWorld\n".to_vec())).unwrap();
    dispatch("write", &q(&[("path", &p("top.md"))]), Some(vec![0, 1, 2, 255])).unwrap();
    let l = js(dispatch("list", &q(&[("path", &r)]), None).unwrap());
    assert_eq!(l["entries"].as_array().unwrap().len(), 2);
    let b = dispatch("read", &q(&[("path", &p("top.md"))]), None).unwrap().into_bytes();
    assert_eq!(b, vec![0, 1, 2, 255]);
    let f = js(dispatch("find", &q(&[("path", &r), ("skip", "node_modules")]), None).unwrap());
    assert_eq!(f["files"].as_array().unwrap().len(), 2);
    let g = js(dispatch("grep", &q(&[("path", &r), ("q", "world"), ("cs", "0"), ("re", "0"), ("word", "1")]), None).unwrap());
    assert_eq!(g["hits"][0]["line"], 2);
    let e = dispatch("read", &q(&[("path", &p("nope"))]), None).err().unwrap();
    assert_eq!((e.status, e.code.as_str()), (404, "ENOENT"));
    let e = dispatch("mv", &q(&[("path", &p("top.md")), ("to", &p("a b"))]), None).err().unwrap();
    assert_eq!(e.status, 409);
    dispatch("mv", &q(&[("path", &p("top.md")), ("to", &p("t2.md"))]), None).unwrap();
    dispatch("rm", &q(&[("path", &p("a b"))]), None).unwrap();
    assert_eq!(js(dispatch("stat", &q(&[("path", &p("a b"))]), None).unwrap())["stat"], serde_json::Value::Null);
    let _ = std::fs::remove_dir_all(&d);
}

#[test]
fn rm_guard() {
    use fixit_core::local::{home, protected};
    assert!(protected("/"));
    assert!(protected("C:/"));
    assert!(protected("d:/"));
    assert!(protected(&home()));
    assert!(protected(&home().to_uppercase()));
    assert!(!protected("C:/Users/x/proj"));
    assert!(!protected("/tmp/x"));
}
