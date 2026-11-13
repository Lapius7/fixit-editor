// ブラウザ版の server/fsapi.ts(/__fs)と同じ操作・同じ JSON・同じエラーを返す。
// WSL(この PC)と SSH 先を、どちらも「シェルのスクリプトを動かす」方式で扱う。
use crate::run::{run, sq};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::process::Command;
use std::time::Duration;

pub type Q = HashMap<String, String>;

#[derive(Debug, Clone)]
pub struct FsError {
    pub message: String,
    pub status: u16,
    pub code: String,
}
impl FsError {
    pub fn new(message: impl Into<String>, status: u16, code: &str) -> Self {
        FsError { message: message.into(), status, code: code.into() }
    }
    pub fn to_json(&self) -> Value {
        json!({ "error": self.message, "code": self.code })
    }
}

pub enum Reply {
    Json(Value),
    Bytes(Vec<u8>),
}
impl Reply {
    pub fn into_bytes(self) -> Vec<u8> {
        match self {
            Reply::Json(v) => serde_json::to_vec(&v).unwrap_or_default(),
            Reply::Bytes(b) => b,
        }
    }
}

fn is_host(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "._@-".contains(c))
}
fn is_skip(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "_.@+-".contains(c))
}

fn need<'a>(q: &'a Q, name: &str) -> Result<&'a str, FsError> {
    match q.get(name) {
        Some(v) if !v.is_empty() => Ok(v),
        _ => Err(FsError::new(format!("{name} がありません"), 400, "EARG")),
    }
}
// sig のパス一覧(改行区切り、絶対パス、最大 300 件)
pub fn sig_paths(q: &Q) -> Result<Vec<String>, FsError> {
    let v = need(q, "paths")?;
    let ps: Vec<String> = v.split('\n').filter(|s| !s.is_empty()).take(300).map(|s| s.to_string()).collect();
    if ps.iter().any(|p| p.contains('\0') || !(p.starts_with('/') || (p.len() >= 2 && p.as_bytes()[1] == b':'))) {
        return Err(FsError::new("絶対パスで指定してください", 400, "EARG"));
    }
    Ok(ps)
}

fn abs_path(q: &Q, name: &str) -> Result<String, FsError> {
    let v = need(q, name)?;
    if !v.starts_with('/') || v.contains('\0') {
        return Err(FsError::new("絶対パスで指定してください", 400, "EARG"));
    }
    if v.len() > 1 {
        let t = v.trim_end_matches('/');
        Ok(if t.is_empty() { "/".into() } else { t.into() })
    } else {
        Ok(v.into())
    }
}
// JavaScript の +(x) || default と同じ。数でない・0 のときは既定値
fn num(q: &Q, key: &str, default: i64, min: i64, max: i64) -> i64 {
    let n = q.get(key).and_then(|s| s.trim().parse::<f64>().ok()).filter(|n| n.is_finite() && *n != 0.0).map(|n| n as i64).unwrap_or(default);
    n.clamp(min, max)
}
fn posix_join(root: &str, rel: &str) -> String {
    let rel = rel.strip_prefix("./").unwrap_or(rel);
    if root == "/" { format!("/{rel}") } else { format!("{root}/{rel}") }
}

// ---- 実行先 ----
// WSL が止まっていたときに、立ち上がるのを待つ時間
const WSL_BOOT_MS: u64 = 45_000;
#[derive(Clone)]
pub enum Runner {
    Ssh { host: String, timeout: u64 },
    // Windows の exe では wsl.exe 経由、それ以外では直接 sh を動かす
    Wsl,
}

fn ssh_error(err: &str) -> FsError {
    let has = |s: &str| err.to_lowercase().contains(&s.to_lowercase());
    if has("Permission denied") || has("publickey") {
        FsError::new("SSH の認証に失敗しました。パスワードなしの鍵が要ります(`ssh-add` で鍵を登録するか、IdentityFile を設定してください)", 401, "EAUTH")
    } else if has("Host key verification failed") || has("REMOTE HOST IDENTIFICATION") {
        FsError::new("ホスト鍵を確認できません。一度ターミナルで `ssh <ホスト>` を実行して登録してください", 401, "EHOSTKEY")
    } else if has("Could not resolve hostname") || has("Name or service not known") {
        FsError::new("ホスト名を解決できません", 502, "EHOST")
    } else if has("timed out") || has("Connection refused") || has("No route to host") || has("Network is unreachable") {
        FsError::new("SSH に接続できません", 502, "ECONN")
    } else {
        let last = err.trim().lines().last().unwrap_or("");
        FsError::new(if last.is_empty() { "SSH の実行に失敗しました" } else { last }, 500, "EIO")
    }
}

impl Runner {
    // 失敗の標準エラー出力から、ブラウザ版(Node の fs)と同じ種類のエラーを作る
    fn local_error(err: &str, code: i32) -> FsError {
        let last = err.trim().lines().last().unwrap_or("").to_string();
        if err.contains("No such file") || err.contains("can't cd to") || err.contains("Not a directory") {
            FsError::new(if last.is_empty() { "見つかりません".into() } else { last }, 404, "ENOENT")
        } else if err.contains("Permission denied") {
            FsError::new(if last.is_empty() { "権限がありません".into() } else { last }, 403, "EACCES")
        } else {
            FsError::new(if last.is_empty() { format!("コマンドが失敗しました({code})") } else { last }, 500, "EIO")
        }
    }

    // スクリプトを動かして標準出力を返す。ok に入れた終了コードは成功として扱う
    pub fn sh(&self, script: &str, input: Option<Vec<u8>>, ms: u64, max: usize, ok: &[i32]) -> Result<Vec<u8>, FsError> {
        self.sh_code(script, input, ms, max, ok).map(|r| r.0)
    }

    // sh と同じだが、終了コードも返す
    pub fn sh_code(&self, script: &str, input: Option<Vec<u8>>, ms: u64, max: usize, ok: &[i32]) -> Result<(Vec<u8>, i32), FsError> {
        // Windows の exe では、WSL の中に立てたままのワーカーに流す(1回ごとに wsl.exe を起動すると 0.2 秒以上かかる)。使えないときは、下の 1 回ごとの起動に任せる
        if cfg!(windows) && matches!(self, Runner::Wsl) {
            match crate::wslpool::exec(script, input.as_deref(), ms, max) {
                crate::wslpool::Done::Ran(r) => {
                    if ok.contains(&r.code) {
                        return Ok((r.out, r.code));
                    }
                    return Err(Self::local_error(&r.err, r.code));
                }
                crate::wslpool::Done::Failed(e) => return Err(e),
                crate::wslpool::Done::Unavailable => {}
            }
        }
        let (cmd, wait) = match self {
            Runner::Ssh { host, timeout } => {
                let mut c = Command::new("ssh");
                c.args(["-o", "BatchMode=yes", "-o", &format!("ConnectTimeout={timeout}")]);
                // Windows の OpenSSH は ControlMaster に対応していない
                #[cfg(not(windows))]
                c.args(["-o", "ControlMaster=auto", "-o", "ControlPath=~/.ssh/cm-%C", "-o", "ControlPersist=10m"]);
                c.args(["--", host, &format!("sh -c {}", sq(script))]);
                (c, ms + timeout * 1000)
            }
            Runner::Wsl => {
                if cfg!(windows) {
                    // 引数は固定にして、スクリプト本体は環境変数で渡す(パスや検索語を wsl.exe の引数に載せない)
                    let mut c = Command::new("wsl.exe");
                    c.args(["-e", "sh", "-c", "eval \"$FIXIT_SH\""]);
                    c.env("FIXIT_SH", script);
                    let wslenv = match std::env::var("WSLENV") {
                        Ok(v) if !v.is_empty() => format!("{v}:FIXIT_SH"),
                        _ => "FIXIT_SH".to_string(),
                    };
                    c.env("WSLENV", wslenv);
                    // WSL は使っていない間(既定で約 60 秒)に止まり、次の wsl.exe で立ち上げ直す。その起動に 20 秒以上かかることがあるため、
                    // コマンドの持ち時間に起動の分を足す(足さないと、一覧やホームの取得が「時間内に終わりませんでした」になる)
                    (c, ms + WSL_BOOT_MS)
                } else {
                    let mut c = Command::new("sh");
                    c.args(["-c", script]);
                    (c, ms)
                }
            }
        };
        let r = run(cmd, input, Duration::from_millis(wait), max)?;
        if ok.contains(&r.code) {
            return Ok((r.out, r.code));
        }
        match self {
            Runner::Ssh { .. } if r.code == 255 => Err(ssh_error(&r.err)),
            Runner::Ssh { .. } => {
                let last = r.err.trim().lines().last().unwrap_or("").to_string();
                Err(FsError::new(if last.is_empty() { format!("コマンドが失敗しました({})", r.code) } else { last }, 500, "EIO"))
            }
            Runner::Wsl => Err(Self::local_error(&r.err, r.code)),
        }
    }
}

// ---- スクリプト ----
fn find_script(root: &str, skip: &[String], limit: i64) -> String {
    let prune = if skip.is_empty() {
        String::new()
    } else {
        format!("\\( {} \\) -prune -o ", skip.iter().map(|s| format!("-name {}", sq(s))).collect::<Vec<_>>().join(" -o "))
    };
    format!("cd -- {} && find . {}-type f -print0 | head -zn {}", sq(root), prune, limit)
}
struct GrepOpt {
    re: bool,
    cs: bool,
    word: bool,
}
fn grep_script(root: &str, q: &str, o: &GrepOpt, skip: &[String], limit: i64) -> String {
    format!(
        "cd -- {} && grep -rnIZ{}{}{} {} -m 200 -e {} -- . | head -n {}",
        sq(root),
        if o.re { "E" } else { "F" },
        if o.cs { "" } else { "i" },
        if o.word { "w" } else { "" },
        skip.iter().map(|s| format!("--exclude-dir={}", sq(s))).collect::<Vec<_>>().join(" "),
        sq(q),
        limit
    )
}

fn parse_find(root: &str, out: &[u8]) -> Vec<Value> {
    String::from_utf8_lossy(out).split('\0').filter(|s| !s.is_empty()).map(|r| Value::String(posix_join(root, r))).collect()
}
fn parse_grep(root: &str, out: &[u8]) -> Vec<Value> {
    let text = String::from_utf8_lossy(out);
    let mut hits = vec![];
    for row in text.split('\n') {
        let Some(z) = row.find('\0') else { continue };
        let rest = &row[z + 1..];
        let Some(c) = rest.find(':') else { continue };
        let Ok(line) = rest[..c].parse::<u64>() else { continue };
        if rest[..c].is_empty() || !rest[..c].bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let p = row[..z].strip_prefix("./").unwrap_or(&row[..z]);
        hits.push(json!({ "path": posix_join(root, p), "line": line, "text": &rest[c + 1..] }));
    }
    hits
}

fn parse_list(out: &[u8]) -> Vec<Value> {
    let mut rows = vec![];
    for rec in String::from_utf8_lossy(out).split('\0') {
        if rec.is_empty() {
            continue;
        }
        let Some(a) = rec.find('\t') else { continue };
        let Some(b) = rec[a + 1..].find('\t').map(|i| i + a + 1) else { continue };
        let Some(c) = rec[b + 1..].find('\t').map(|i| i + b + 1) else { continue };
        let kind = if rec.as_bytes().get(1) == Some(&b'd') { "dir" } else { "file" };
        let size = rec[a + 1..b].parse::<f64>().unwrap_or(0.0);
        let mtime = rec[b + 1..c].parse::<f64>().unwrap_or(0.0) * 1000.0;
        rows.push(json!({ "name": &rec[c + 1..], "kind": kind, "size": size, "mtime": mtime }));
    }
    rows
}

// ---- 操作 ----
fn home(r: &Runner) -> Result<String, FsError> {
    Ok(String::from_utf8_lossy(&r.sh("printf %s \"$HOME\"", None, 20000, 64 * 1024 * 1024, &[0])?).to_string())
}

pub fn ssh_hosts() -> Value {
    let home = if cfg!(windows) { std::env::var_os("USERPROFILE") } else { std::env::var_os("HOME") };
    let Some(home) = home else { return json!({ "hosts": [] }) };
    let Ok(text) = std::fs::read_to_string(std::path::Path::new(&home).join(".ssh").join("config")) else { return json!({ "hosts": [] }) };
    let mut hosts: Vec<(String, Option<String>, Option<String>)> = vec![];
    let mut cur: Vec<usize> = vec![];
    for raw in text.split('\n') {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let kend = line.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_')).unwrap_or(line.len());
        if kend == 0 || kend == line.len() {
            continue;
        }
        let key = line[..kend].to_lowercase();
        let mut rest = line[kend..].trim_start();
        if let Some(r) = rest.strip_prefix('=') {
            rest = r.trim_start();
        }
        let val = rest.trim();
        if val.is_empty() {
            continue;
        }
        match key.as_str() {
            "host" => {
                cur.clear();
                for h in val.split_whitespace() {
                    if !h.contains(['*', '?', '!']) && is_host(h) && !h.starts_with('-') {
                        hosts.push((h.to_string(), None, None));
                        cur.push(hosts.len() - 1);
                    }
                }
            }
            "hostname" => cur.iter().for_each(|&i| hosts[i].1 = Some(val.to_string())),
            "user" => cur.iter().for_each(|&i| hosts[i].2 = Some(val.to_string())),
            _ => {}
        }
    }
    let v: Vec<Value> = hosts
        .into_iter()
        .map(|(name, hostname, user)| {
            let mut o = serde_json::Map::new();
            o.insert("name".into(), name.into());
            if let Some(h) = hostname { o.insert("hostname".into(), h.into()); }
            if let Some(u) = user { o.insert("user".into(), u.into()); }
            Value::Object(o)
        })
        .collect();
    json!({ "hosts": v })
}

fn runner_for(q: &Q) -> Result<Runner, FsError> {
    match q.get("kind").map(|s| s.as_str()).unwrap_or("wsl") {
        "wsl" => {
            // 常駐ワーカーを閉じるまでの時間(分)。設定の変更はここで反映する
            if let Some(m) = q.get("idle").and_then(|s| s.trim().parse::<u64>().ok()) {
                crate::wslpool::set_idle_minutes(m);
            }
            Ok(Runner::Wsl)
        }
        "ssh" => {
            let host = q.get("host").cloned().unwrap_or_default();
            if !is_host(&host) || host.starts_with('-') {
                return Err(FsError::new("ホスト名が正しくありません", 400, "EARG"));
            }
            Ok(Runner::Ssh { host, timeout: num(q, "timeout", 10, 2, 60) as u64 })
        }
        _ => Err(FsError::new("kind が正しくありません", 400, "EARG")),
    }
}

const READ: [&str; 10] = ["hosts", "home", "list", "read", "stat", "sig", "find", "grep", "gitstatus", "githead"];
const WRITE: [&str; 6] = ["write", "mkdir", "rm", "mv", "git", "exec"];

// body は write のときだけ使う
pub fn dispatch(op: &str, q: &Q, body: Option<Vec<u8>>) -> Result<Reply, FsError> {
    if !READ.contains(&op) && !WRITE.contains(&op) {
        return Err(FsError::new("not found", 404, "ENOENT"));
    }
    if op == "hosts" {
        return Ok(Reply::Json(ssh_hosts()));
    }
    if q.get("kind").map(|s| s.as_str()) == Some("pc") {
        return crate::local::dispatch(op, q, body);
    }
    let r = runner_for(q)?;
    let max_mb = num(q, "maxMB", 20, 1, 200) as usize;
    const BIG: usize = 64 * 1024 * 1024;
    match op {
        "home" => Ok(Reply::Json(json!({ "path": home(&r)? }))),
        "list" => {
            let p = abs_path(q, "path")?;
            let out = r.sh(&format!("cd -- {} && find . -mindepth 1 -maxdepth 1 -printf '%y%Y\\t%s\\t%T@\\t%f\\0'", sq(&p)), None, 20000, BIG, &[0])?;
            Ok(Reply::Json(json!({ "entries": parse_list(&out) })))
        }
        // 開いているフォルダの更新日時をまとめて返す(エクスプローラーを外の変更に追従させるため。中の追加・削除・改名でフォルダの日時が変わる)
        "sig" => {
            let ps = sig_paths(q)?;
            // パスはコマンド行ではなく標準入力で渡す(Windows のコマンド行の長さの上限を超えないように)
            let input = ps.join("\0").into_bytes();
            let out = r.sh("xargs -0 stat -c '%y\t%n' -- 2>/dev/null; true", Some(input), 20000, 4 * 1024 * 1024, &[0])?;
            Ok(Reply::Json(json!({ "sig": String::from_utf8_lossy(&out) })))
        }
        "stat" => {
            let p = abs_path(q, "path")?;
            let out = r.sh(&format!("if [ -d {p} ]; then echo d; elif [ -e {p} ]; then echo f; else echo n; fi", p = sq(&p)), None, 20000, BIG, &[0])?;
            let k = String::from_utf8_lossy(&out).trim().to_string();
            Ok(Reply::Json(if k == "n" { json!({ "stat": null }) } else { json!({ "stat": { "kind": if k == "d" { "dir" } else { "file" }, "size": 0, "mtime": 0 } }) }))
        }
        "read" => {
            let p = abs_path(q, "path")?;
            let max = max_mb * 1024 * 1024;
            // 種類と大きさの確認と中身の取得を、1 回の実行でまとめて行う(終了コード 4: フォルダ、5: 大きすぎ)
            let script = format!("[ -d {p} ] && exit 4; s=$(wc -c < {p}) || exit 1; [ \"$s\" -le {max} ] || exit 5; cat -- {p}", p = sq(&p));
            match r.sh_code(&script, None, 60000, max + 1024, &[0, 4, 5])? {
                (b, 0) => Ok(Reply::Bytes(b)),
                (_, 4) => Err(FsError::new("フォルダは読めません", 400, "EISDIR")),
                _ => Err(FsError::new("ファイルが大きすぎます", 413, "ETOOBIG")),
            }
        }
        "write" => {
            let p = abs_path(q, "path")?;
            let data = body.ok_or_else(|| FsError::new("本文がありません", 400, "EARG"))?;
            // 一時ファイルに受けてバイト数を確かめてから、元のファイルへ流し込む(権限・所有者・リンクを保つ)
            let script = format!(
                "t=$(mktemp) || exit 1; cat > \"$t\"; if [ \"$(wc -c < \"$t\" | tr -d ' ')\" = {} ]; then cat \"$t\" > {}; rc=$?; else rc=3; fi; rm -f \"$t\"; exit $rc",
                data.len(),
                sq(&p)
            );
            r.sh(&script, Some(data), 60000, BIG, &[0])?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "mkdir" => {
            r.sh(&format!("mkdir -p -- {}", sq(&abs_path(q, "path")?)), None, 20000, BIG, &[0])?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "rm" => {
            let p = abs_path(q, "path")?;
            if p == "/" || p == home(&r)? {
                return Err(FsError::new("このフォルダは削除できません", 400, "EARG"));
            }
            r.sh(&format!("rm -rf -- {}", sq(&p)), None, 20000, BIG, &[0])?;
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "mv" => {
            let (from, to) = (abs_path(q, "path")?, abs_path(q, "to")?);
            let out = r.sh(&format!("if [ -e {t} ]; then echo exists; else mv -- {f} {t} && echo ok; fi", f = sq(&from), t = sq(&to)), None, 20000, BIG, &[0])?;
            if String::from_utf8_lossy(&out).trim() == "exists" {
                return Err(FsError::new("同じ名前があります", 409, "EEXIST"));
            }
            Ok(Reply::Json(json!({ "ok": true })))
        }
        "git" => {
            // 履歴・書き込み。引数は git.rs が固定名の操作から組み立てる
            let dir = abs_path(q, "path")?;
            let p = crate::git::plan(&body.ok_or_else(|| FsError::new("本文がありません", 400, "EARG"))?)?;
            let argv = p.args.iter().map(|a| sq(a)).collect::<Vec<_>>().join(" ");
            let redir = if p.merge { "2>&1" } else { "2>/dev/null" };
            let script = format!("cd -- {} 2>/dev/null || {{ echo 'フォルダを開けません'; exit 128; }}; GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_EDITOR=true git {argv} {redir}", sq(&dir));
            let codes: Vec<i32> = (0..=255).collect();
            let (out, code) = r.sh_code(&script, None, p.ms, BIG, &codes)?;
            Ok(Reply::Json(json!({ "code": code, "out": String::from_utf8_lossy(&out) })))
        }
        "gitstatus" => {
            // 状態は porcelain(-z)の生のまま返す。リポジトリでなければ repo: false
            let p = abs_path(q, "path")?;
            let script = format!("cd -- {} 2>/dev/null || {{ printf NOREPO; exit 0; }}; top=$(git rev-parse --show-toplevel 2>/dev/null) || {{ printf NOREPO; exit 0; }}; br=$(git symbolic-ref --short -q HEAD || git rev-parse --short HEAD 2>/dev/null); printf '%s\\0%s\\0' \"$top\" \"$br\"; git -c core.quotepath=off status --porcelain=v1 -z -uall 2>/dev/null", sq(&p));
            let out = r.sh(&script, None, 30000, BIG, &[0])?;
            let o = String::from_utf8_lossy(&out).into_owned();
            Ok(Reply::Json(if o == "NOREPO" { json!({ "repo": false }) } else { json!({ "repo": true, "raw": o }) }))
        }
        "exec" => {
            // AI が頼んだコマンドを、開いているフォルダで 1 回だけ走らせる。標準入力は空、出力は標準・エラーをまとめて末尾を残す
            let dir = abs_path(q, "path")?;
            let (cmd, secs) = crate::run::exec_args(&body.ok_or_else(|| FsError::new("本文がありません", 400, "EARG"))?)?;
            let script = format!(
                "cd -- {d} 2>/dev/null || {{ echo 'フォルダを開けません'; exit 128; }}; o=$(mktemp) || exit 125; timeout -k 2 {secs} sh -c {c} </dev/null >\"$o\" 2>&1; rc=$?; if [ \"$(wc -c <\"$o\")\" -gt {cap} ]; then tail -c {cap} \"$o\"; else cat \"$o\"; fi; rm -f \"$o\"; exit $rc",
                d = sq(&dir), c = sq(&cmd), cap = crate::run::EXEC_CAP
            );
            let codes: Vec<i32> = (0..=255).collect();
            let (out, code) = r.sh_code(&script, None, (secs + 5) * 1000, BIG, &codes)?;
            Ok(Reply::Json(json!({ "code": code, "out": String::from_utf8_lossy(&out), "timedOut": code == 124 })))
        }
        "githead" => {
            let p = abs_path(q, "path")?;
            let (dir, name) = match p.rfind('/') { Some(0) => ("/", &p[1..]), Some(i) => (&p[..i], &p[i + 1..]), None => (".", p.as_str()) };
            let spec = sq(&format!("HEAD:./{name}"));
            let script = format!("cd -- {} 2>/dev/null && s=$(git cat-file -s {spec} 2>/dev/null) && [ \"$s\" -lt 2000000 ] && {{ printf Y; git show {spec}; }} || printf N", sq(dir));
            let out = r.sh(&script, None, 30000, BIG, &[0])?;
            Ok(Reply::Json(if out.first() == Some(&b'Y') { json!({ "text": String::from_utf8_lossy(&out[1..]) }) } else { json!({ "text": null }) }))
        }
        "find" | "grep" => {
            let skip: Vec<String> = q.get("skip").map(|s| s.as_str()).unwrap_or("").split(',').filter(|s| is_skip(s)).map(String::from).collect();
            let limit = num(q, "limit", 5000, 1, 50000);
            let root = abs_path(q, "path")?;
            if op == "find" {
                // ブラウザ版(Node)の WSL/ローカルは終了コードを見ず、存在しないフォルダは空の一覧になる。同じにする
                let ok: &[i32] = if matches!(r, Runner::Wsl) { &[0, 1, 2] } else { &[0] };
                let out = r.sh(&find_script(&root, &skip, limit), None, 60000, BIG, ok)?;
                return Ok(Reply::Json(json!({ "files": parse_find(&root, &out) })));
            }
            let o = GrepOpt { re: q.get("re").map(|s| s == "1").unwrap_or(false), cs: q.get("cs").map(|s| s == "1").unwrap_or(false), word: q.get("word").map(|s| s == "1").unwrap_or(false) };
            let out = r.sh(&grep_script(&root, need(q, "q")?, &o, &skip, limit), None, 90000, BIG, &[0, 1, 2])?;
            Ok(Reply::Json(json!({ "hits": parse_grep(&root, &out) })))
        }
        _ => Err(FsError::new("not found", 404, "ENOENT")),
    }
}
