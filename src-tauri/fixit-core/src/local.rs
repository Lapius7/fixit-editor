// この PC のフォルダ(Windows のドライブや Linux のパス)を、シェルを介さず std::fs で直接扱う。
// 返す JSON は fs.rs(WSL / SSH)と同じ。パスは常に「/」区切り(Windows は C:/Users/... の形)。
use crate::fs::{FsError, Q, Reply};
use regex::RegexBuilder;
use serde_json::{json, Value};
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

fn io_err(e: std::io::Error) -> FsError {
    let m = e.to_string();
    match e.kind() {
        ErrorKind::NotFound => FsError::new(m, 404, "ENOENT"),
        ErrorKind::PermissionDenied => FsError::new(m, 403, "EACCES"),
        ErrorKind::AlreadyExists => FsError::new(m, 409, "EEXIST"),
        _ => {
            // フォルダでないパスの下を指したとき(ENOTDIR)は、見つからないものとして扱う
            let raw = e.raw_os_error();
            if raw == Some(20) || raw == Some(267) {
                FsError::new(m, 404, "ENOENT")
            } else {
                FsError::new(m, 500, "EIO")
            }
        }
    }
}

fn need<'a>(q: &'a Q, name: &str) -> Result<&'a str, FsError> {
    match q.get(name) {
        Some(v) if !v.is_empty() => Ok(v),
        _ => Err(FsError::new(format!("{name} がありません"), 400, "EARG")),
    }
}

fn is_drive(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b.len() == 2 || b[2] == b'/')
}

// 絶対パスだけを受ける。Windows の \ は / にそろえ、末尾の / は(ルート以外)落とす
pub fn abs(q: &Q, name: &str) -> Result<String, FsError> {
    let v = need(q, name)?.replace('\\', "/");
    if v.contains('\0') || !(v.starts_with('/') || is_drive(&v)) {
        return Err(FsError::new("絶対パスで指定してください", 400, "EARG"));
    }
    let t = v.trim_end_matches('/');
    Ok(if t.is_empty() { "/".into() } else if is_drive(t) && t.len() == 2 { format!("{t}/") } else { t.into() })
}

fn num(q: &Q, key: &str, default: i64, min: i64, max: i64) -> i64 {
    let n = q.get(key).and_then(|s| s.trim().parse::<f64>().ok()).filter(|n| n.is_finite() && *n != 0.0).map(|n| n as i64).unwrap_or(default);
    n.clamp(min, max)
}

fn join(root: &str, rel: &str) -> String {
    if root.ends_with('/') { format!("{root}{rel}") } else { format!("{root}/{rel}") }
}

fn mtime_ms(m: &fs::Metadata) -> f64 {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

pub fn home() -> String {
    let h = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| "/".into());
    let t = h.replace('\\', "/");
    let t = t.trim_end_matches('/');
    if t.is_empty() { "/".into() } else if is_drive(t) && t.len() == 2 { format!("{t}/") } else { t.into() }
}

// 消してはいけない場所(ルート・ドライブ直下・ホーム)
pub fn protected(p: &str) -> bool {
    p == "/" || (is_drive(p) && p.len() == 3) || p.eq_ignore_ascii_case(&home())
}

fn skips(q: &Q) -> Vec<String> {
    q.get("skip")
        .map(|s| s.as_str())
        .unwrap_or("")
        .split(',')
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "_.@+-".contains(c)))
        .map(String::from)
        .collect()
}

// シンボリックリンクはたどらない(find と同じ)。skip の名前のフォルダには入らない
fn walk(root: &Path, skip: &[String], f: &mut dyn FnMut(&Path, &str) -> bool) {
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), String::new())];
    while let Some((dir, rel)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut kids: Vec<_> = rd.flatten().collect();
        kids.sort_by_key(|e| e.file_name());
        let mut dirs = vec![];
        for e in kids {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(t) = e.file_type() else { continue };
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if t.is_dir() {
                if !skip.iter().any(|s| *s == name) { dirs.push((e.path(), r)); }
            } else if t.is_file() && !f(&e.path(), &r) {
                return;
            }
        }
        // 深さ優先で、名前順に取り出す
        for d in dirs.into_iter().rev() { stack.push(d); }
    }
}

pub fn dispatch(op: &str, q: &Q, body: Option<Vec<u8>>) -> Result<Reply, FsError> {
    let max_mb = num(q, "maxMB", 20, 1, 200) as u64;
    match op {
        "home" => Ok(Reply::Json(json!({ "path": home() }))),
        "list" => {
            let p = abs(q, "path")?;
            let mut out: Vec<Value> = vec![];
            for e in fs::read_dir(&p).map_err(io_err)?.flatten() {
                // リンク先を見て種類を決める(壊れたリンクはファイル扱い)
                let m = fs::metadata(e.path()).or_else(|_| e.metadata());
                let Ok(m) = m else { continue };
                out.push(json!({ "name": e.file_name().to_string_lossy(), "kind": if m.is_dir() { "dir" } else { "file" }, "size": m.len(), "mtime": mtime_ms(&m) }));
            }
            Ok(Reply::Json(json!({ "entries": out })))
        }
        "sig" => {
            let mut out = String::new();
            for p in crate::fs::sig_paths(q)? {
                if let Ok(m) = fs::metadata(&p) { out.push_str(&format!("{}\t{p}\n", mtime_ms(&m))); }
            }
            Ok(Reply::Json(json!({ "sig": out })))
        }
        "stat" => {
            let p = abs(q, "path")?;
            Ok(Reply::Json(match fs::metadata(&p) {
                Ok(m) => json!({ "stat": { "kind": if m.is_dir() { "dir" } else { "file" }, "size": 0, "mtime": 0 } }),
                Err(_) => json!({ "stat": null }),
            }))
        }
        "read" => {
            let p = abs(q, "path")?;
            let m = fs::metadata(&p).map_err(io_err)?;
            if m.is_dir() { return Err(FsError::new("フォルダは読めません", 400, "EISDIR")); }
            if m.len() > max_mb * 1024 * 1024 { return Err(FsError::new("ファイルが大きすぎます", 413, "ETOOBIG")); }
            Ok(Reply::Bytes(fs::read(&p).map_err(io_err)?))
        }
        "write" => {
            let p = abs(q, "path")?;
            let data = body.ok_or_else(|| FsError::new("本文がありません", 400, "EARG"))?;
            fs::write(&p, data).map_err(io_err)?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "mkdir" => {
            fs::create_dir_all(abs(q, "path")?).map_err(io_err)?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "rm" => {
            let p = abs(q, "path")?;
            if protected(&p) {
                return Err(FsError::new("このフォルダは削除できません", 400, "EARG"));
            }
            // リンク自体を消す(先のフォルダの中身は消さない)
            match fs::symlink_metadata(&p) {
                Ok(m) if m.is_dir() => fs::remove_dir_all(&p).map_err(io_err)?,
                Ok(_) => fs::remove_file(&p).map_err(io_err)?,
                Err(_) => {}
            }
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "mv" => {
            let (from, to) = (abs(q, "path")?, abs(q, "to")?);
            if fs::symlink_metadata(&to).is_ok() { return Err(FsError::new("同じ名前があります", 409, "EEXIST")); }
            fs::rename(&from, &to).map_err(io_err)?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "git" => {
            // 履歴・書き込み。引数は git.rs が固定名の操作から組み立てる
            let dir = abs(q, "path")?;
            let p = crate::git::plan(&body.ok_or_else(|| FsError::new("本文がありません", 400, "EARG"))?)?;
            let mut c = std::process::Command::new("git");
            c.args(&p.args).current_dir(&dir).env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0").env("GIT_EDITOR", "true").env("GCM_INTERACTIVE", "never");
            let r = crate::run::run(c, None, std::time::Duration::from_millis(p.ms), 64 * 1024 * 1024)?;
            let mut out = r.out;
            if p.merge {
                out.extend_from_slice(r.err.as_bytes());
            }
            Ok(Reply::Json(json!({ "code": r.code, "out": String::from_utf8_lossy(&out) })))
        }
        "gitstatus" => {
            // 状態は porcelain(-z)の生のまま返す。リポジトリでなければ repo: false
            let dir = abs(q, "path")?;
            let git = |args: &[&str]| -> Option<Vec<u8>> {
                let mut c = std::process::Command::new("git");
                c.args(["-c", "core.quotepath=off"]).args(args).current_dir(&dir);
                let r = crate::run::run(c, None, std::time::Duration::from_secs(30), 64 * 1024 * 1024).ok()?;
                if r.code == 0 { Some(r.out) } else { None }
            };
            let Some(top) = git(&["rev-parse", "--show-toplevel"]) else { return Ok(Reply::Json(json!({ "repo": false }))) };
            let br = git(&["symbolic-ref", "--short", "-q", "HEAD"]).or_else(|| git(&["rev-parse", "--short", "HEAD"])).unwrap_or_default();
            let st = git(&["status", "--porcelain=v1", "-z", "-uall"]).unwrap_or_default();
            let raw = format!("{}\0{}\0{}", String::from_utf8_lossy(&top).trim_end(), String::from_utf8_lossy(&br).trim_end(), String::from_utf8_lossy(&st));
            Ok(Reply::Json(json!({ "repo": true, "raw": raw })))
        }
        "githead" => {
            let p = abs(q, "path")?;
            let (dir, name) = match p.rfind('/') { Some(0) => ("/", &p[1..]), Some(i) => (&p[..i], &p[i + 1..]), None => (".", p.as_str()) };
            let spec = format!("HEAD:./{name}");
            let git = |args: &[&str]| -> Option<Vec<u8>> {
                let mut c = std::process::Command::new("git");
                c.args(args).current_dir(dir);
                let r = crate::run::run(c, None, std::time::Duration::from_secs(30), 64 * 1024 * 1024).ok()?;
                if r.code == 0 { Some(r.out) } else { None }
            };
            let size: u64 = git(&["cat-file", "-s", &spec]).and_then(|o| String::from_utf8_lossy(&o).trim().parse().ok()).unwrap_or(u64::MAX);
            if size >= 2_000_000 { return Ok(Reply::Json(json!({ "text": null }))); }
            Ok(Reply::Json(match git(&["show", &spec]) { Some(o) => json!({ "text": String::from_utf8_lossy(&o) }), None => json!({ "text": null }) }))
        }
        "find" => {
            let root = abs(q, "path")?;
            let limit = num(q, "limit", 5000, 1, 50000) as usize;
            let mut files: Vec<Value> = vec![];
            walk(Path::new(&root), &skips(q), &mut |_, rel| { files.push(Value::String(join(&root, rel))); files.len() < limit });
            Ok(Reply::Json(json!({ "files": files })))
        }
        "grep" => {
            let root = abs(q, "path")?;
            let limit = num(q, "limit", 5000, 1, 50000) as usize;
            let (re, cs, word) = (q.get("re").map_or(false, |s| s == "1"), q.get("cs").map_or(false, |s| s == "1"), q.get("word").map_or(false, |s| s == "1"));
            let src = need(q, "q")?;
            let mut pat = if re { src.to_string() } else { regex::escape(src) };
            if word { pat = format!(r"\b(?:{pat})\b"); }
            let rx = RegexBuilder::new(&pat).case_insensitive(!cs).size_limit(10 << 20).build().map_err(|_| FsError::new("正規表現が正しくありません", 400, "EARG"))?;
            let mut hits: Vec<Value> = vec![];
            walk(Path::new(&root), &skips(q), &mut |path, rel| {
                let Ok(mut f) = fs::File::open(path) else { return true };
                let mut buf = vec![];
                // 大きなファイルは検索しない(grep の -I と同じく、バイナリも対象外)
                if f.by_ref().take(5 << 20).read_to_end(&mut buf).is_err() || buf[..buf.len().min(8192)].contains(&0) { return true; }
                let text = String::from_utf8_lossy(&buf);
                let mut n = 0;
                for (i, line) in text.split('\n').enumerate() {
                    let line = line.strip_suffix('\r').unwrap_or(line);
                    if rx.is_match(line) {
                        hits.push(json!({ "path": join(&root, rel), "line": i + 1, "text": line }));
                        n += 1;
                        if n >= 200 || hits.len() >= limit { break; }
                    }
                }
                hits.len() < limit
            });
            Ok(Reply::Json(json!({ "hits": hits })))
        }
        _ => Err(FsError::new("not found", 404, "ENOENT")),
    }
}
