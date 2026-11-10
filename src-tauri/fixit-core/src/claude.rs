// Claude のサブスクリプション(claude.ai のログイン)で AI を使うための橋渡し。server/claude.ts と同じ振る舞い。
// この PC の公式 `claude` コマンドを、ツールなし・空のフォルダ・設定なしで 1 回だけ動かし、返事を流す。
// ログインの情報(トークン)はここからは読まない。API キーの環境変数は渡さない(渡すと API の課金に切り替わるため)。
use crate::run::{no_window, sq};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(5 * 60);
const MAX_RUNNING: usize = 2;
static RUNNING: AtomicUsize = AtomicUsize::new(0);

#[derive(Deserialize, Clone)]
pub struct Msg {
    pub role: String,
    pub content: String,
}

// 画面へ送る 1 件。JSON にすると {"t":"text","s":..} / {"t":"done","stop":..} / {"t":"err","kind":..}
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "lowercase")]
pub enum Event {
    Text { s: String },
    Done { stop: &'static str },
    Err { kind: &'static str },
    // ログイン画面の URL(ブラウザが開かないときに、本人がコピーして開く)
    Url { s: String },
}

// 動いている 1 回分。中断(キャンセル)のために子プロセスを持つ
#[derive(Default)]
pub struct Job {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}
impl Job {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(c) = self.child.lock().unwrap().as_mut() {
            let _ = c.kill();
        }
    }
}

pub fn effort_ok(e: &str) -> bool {
    matches!(e, "" | "low" | "medium" | "high" | "xhigh" | "max")
}

fn model_ok(m: &str) -> bool {
    (1..=64).contains(&m.len()) && m.chars().all(|c| c.is_ascii_alphanumeric() || "._-[]".contains(c))
}

// 1 回の呼び出しに会話を渡すため、履歴を台本の形にして送る
pub fn transcript(m: &[Msg]) -> String {
    if m.len() == 1 {
        return m[0].content.clone();
    }
    let body: Vec<String> = m.iter().map(|x| format!("<{r}>\n{c}\n</{r}>", r = x.role, c = x.content)).collect();
    format!("{}\n\n上の会話の最後の <user> に答えてください。", body.join("\n\n"))
}

fn exe_name() -> &'static str {
    if cfg!(windows) { "claude.exe" } else { "claude" }
}
fn is_file(p: &PathBuf) -> bool {
    p.is_file()
}
// この PC の claude コマンド(実行ファイル)を探す。.cmd の中継は使わない(引数の扱いが崩れるため)
pub fn find_native() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("FIXIT_CLAUDE_BIN").filter(|v| !v.is_empty()) {
        return Some(PathBuf::from(v));
    }
    let mut c: Vec<PathBuf> = vec![];
    if let Some(p) = std::env::var_os("PATH") {
        c.extend(std::env::split_paths(&p).map(|d| d.join(exe_name())));
    }
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    if cfg!(windows) {
        if let Some(a) = var("APPDATA") {
            c.push(a.join("npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe"));
        }
        if let Some(h) = var("USERPROFILE") {
            c.push(h.join(".local/bin/claude.exe"));
            c.push(h.join(".claude/local/claude.exe"));
        }
    } else if let Some(h) = var("HOME") {
        c.push(h.join(".local/bin/claude"));
        c.push(h.join(".claude/local/claude"));
    }
    c.into_iter().find(is_file)
}
fn has_wsl() -> bool {
    cfg!(windows) && std::env::var_os("PATH").map_or(false, |p| std::env::split_paths(&p).any(|d| d.join("wsl.exe").is_file()))
}

fn claude_args(system: &str, model: &str, effort: &str) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    a.push(system.to_string());
    if !model.is_empty() {
        a.push("--model".into());
        a.push(model.to_string());
    }
    if !effort.is_empty() {
        a.push("--effort".into());
        a.push(effort.to_string());
    }
    a
}

fn temp_dir() -> Option<PathBuf> {
    let base = std::env::temp_dir();
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let d = base.join(format!("fixit-claude-{}-{stamp}", std::process::id()));
    std::fs::create_dir(&d).ok()?;
    Some(d)
}

// WSL の中の claude を動かすスクリプト。API キーの環境変数は必ず外す(WSL 側のシェルが持っていても課金が変わらないように)
fn wsl_script(model: &str, effort: &str) -> String {
    let mut m = if model.is_empty() { String::new() } else { format!(" --model {}", sq(model)) };
    if !effort.is_empty() {
        m.push_str(&format!(" --effort {}", sq(effort)));
    }
    format!(
        "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH=\"$HOME/.local/bin:$HOME/.claude/local:$PATH\"; export PATH; command -v claude >/dev/null 2>&1 || exit 127; d=$(mktemp -d) || exit 1; cd \"$d\" || exit 1; claude -p --output-format stream-json --include-partial-messages --verbose --tools '' --no-session-persistence --setting-sources '' --strict-mcp-config --disable-slash-commands --system-prompt \"$FIXIT_SYS\"{m}; rc=$?; cd /; rm -rf \"$d\"; exit $rc"
    )
}

fn classify(err: &str) -> &'static str {
    let e = err.to_lowercase();
    let any = |l: &[&str]| l.iter().any(|k| e.contains(k));
    if any(&["not logged in", "/login", "log in", "authenticat", "credential", "401", "oauth"]) {
        "login"
    } else if any(&["rate", "limit", "usage", "quota", "429", "overloaded"]) {
        "rate"
    } else if e.contains("model") {
        "model"
    } else {
        "other"
    }
}

// 会話を 1 回送り、返事を emit に流す。終わると必ず Done か Err を 1 回出す
pub fn chat(system: &str, model: &str, effort: &str, messages: &[Msg], job: &Job, emit: &mut dyn FnMut(Event)) {
    if messages.is_empty() || messages.iter().any(|m| m.role != "user" && m.role != "assistant") || (!model.is_empty() && !model_ok(model)) || !effort_ok(effort) {
        return emit(Event::Err { kind: "other" });
    }
    if RUNNING.fetch_add(1, Ordering::SeqCst) >= MAX_RUNNING {
        RUNNING.fetch_sub(1, Ordering::SeqCst);
        return emit(Event::Err { kind: "rate" });
    }
    let dir = temp_dir();
    run_inner(system, model, effort, messages, job, dir.as_ref(), emit);
    if let Some(d) = dir {
        let _ = std::fs::remove_dir_all(d);
    }
    RUNNING.fetch_sub(1, Ordering::SeqCst);
}

fn run_inner(system: &str, model: &str, effort: &str, messages: &[Msg], job: &Job, dir: Option<&PathBuf>, emit: &mut dyn FnMut(Event)) {
    let Some(dir) = dir else { return emit(Event::Err { kind: "other" }) };
    let mut cmd = if let Some(bin) = find_native() {
        let mut c = Command::new(bin);
        c.args(claude_args(system, model, effort));
        c
    } else if has_wsl() {
        let mut c = Command::new("wsl.exe");
        c.args(["-e", "sh", "-c", "eval \"$FIXIT_SH\""]);
        c.env("FIXIT_SH", wsl_script(model, effort)).env("FIXIT_SYS", system);
        let wslenv = match std::env::var("WSLENV") {
            Ok(v) if !v.is_empty() => format!("{v}:FIXIT_SH:FIXIT_SYS"),
            _ => "FIXIT_SH:FIXIT_SYS".to_string(),
        };
        c.env("WSLENV", wslenv);
        c
    } else {
        return emit(Event::Err { kind: "nocli" });
    };
    cmd.current_dir(dir).env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN");
    no_window(&mut cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return emit(Event::Err { kind: if e.kind() == std::io::ErrorKind::NotFound { "nocli" } else { "other" } }),
    };
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    *job.child.lock().unwrap() = Some(child);
    if job.cancelled.load(Ordering::SeqCst) {
        job.cancel();
    }

    let text = transcript(messages);
    let w = thread::spawn(move || {
        let _ = stdin.write_all(text.as_bytes());
    });
    let err_t = thread::spawn(move || {
        let mut keep = Vec::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 { break; }
            if keep.len() < 4000 { keep.extend_from_slice(&buf[..n]); }
        }
        String::from_utf8_lossy(&keep).to_string()
    });
    // 時間切れの見張り
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let mut stop: &'static str = "end";
    let mut sent = false;
    let mut err_text = String::new();
    thread::scope(|s| {
        let j = job;
        s.spawn(move || {
            if let Err(mpsc::RecvTimeoutError::Timeout) = done_rx.recv_timeout(TIMEOUT) {
                j.cancel();
            }
        });
        for line in BufReader::new(stdout).split(b'\n') {
            let Ok(line) = line else { break };
            let Ok(e) = serde_json::from_slice::<serde_json::Value>(&line) else { continue };
            let ty = e["type"].as_str().unwrap_or("");
            if ty == "stream_event" {
                let ev = &e["event"];
                match ev["type"].as_str() {
                    Some("content_block_delta") if ev["delta"]["type"] == "text_delta" => {
                        if let Some(t) = ev["delta"]["text"].as_str().filter(|t| !t.is_empty()) {
                            sent = true;
                            emit(Event::Text { s: t.to_string() });
                        }
                    }
                    Some("message_delta") => match ev["delta"]["stop_reason"].as_str() {
                        Some("max_tokens") => stop = "length",
                        Some("refusal") => stop = "refusal",
                        _ => {}
                    },
                    _ => {}
                }
            } else if ty == "result" && e["is_error"] == true {
                err_text = format!("{}\n{}", e["result"].as_str().unwrap_or(""), err_text);
            }
        }
        let _ = done_tx.send(());
    });
    let _ = w.join();
    let code = job.child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code()).unwrap_or(1);
    err_text.push_str(&err_t.join().unwrap_or_default());
    if job.cancelled.load(Ordering::SeqCst) && !sent {
        return emit(Event::Err { kind: "other" });
    }
    if code == 0 || sent {
        emit(Event::Done { stop });
    } else if code == 127 {
        emit(Event::Err { kind: "nocli" });
    } else {
        emit(Event::Err { kind: classify(&err_text) });
    }
}

// claude コマンドを、この PC か WSL で呼ぶ準備。引数は固定の語だけ(利用者の入力は入れない)
fn cli_cmd(args: &[&str]) -> Option<Command> {
    if let Some(bin) = find_native() {
        let mut c = Command::new(bin);
        c.args(args);
        return Some(c);
    }
    if !has_wsl() {
        return None;
    }
    let a = args.iter().map(|x| sq(x)).collect::<Vec<_>>().join(" ");
    let mut c = Command::new("wsl.exe");
    c.args(["-e", "sh", "-c", &format!("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH=\"$HOME/.local/bin:$HOME/.claude/local:$PATH\"; export PATH; command -v claude >/dev/null 2>&1 || exit 127; exec claude {a}")]);
    Some(c)
}

// 接続の状態。"ready"(ログイン済み) / "login"(未ログイン) / "nocli"(claude がない) / "unknown"(確かめられない)
// `claude auth status --json` の loggedIn だけを見る。メールアドレスやトークンは読まない・返さない
pub fn status() -> &'static str {
    let Some(mut cmd) = cli_cmd(&["auth", "status", "--json"]) else { return "nocli" };
    cmd.env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN");
    no_window(&mut cmd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return if e.kind() == std::io::ErrorKind::NotFound { "nocli" } else { "unknown" },
    };
    let start = std::time::Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s.code(),
            Ok(None) if start.elapsed() < Duration::from_secs(20) => thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return "unknown";
            }
        }
    };
    if code == Some(127) {
        return "nocli";
    }
    let mut out = String::new();
    if let Some(o) = child.stdout.take() {
        let _ = o.take(65536).read_to_string(&mut out);
    }
    match serde_json::from_str::<serde_json::Value>(&out) {
        Ok(v) if v["loggedIn"] == true => "ready",
        Ok(v) if v["loggedIn"] == false => "login",
        _ => "unknown",
    }
}

// 出力の 1 行から、claude.ai などのログイン用 URL を取り出す
fn login_url(line: &str) -> Option<String> {
    let i = line.find("https://")?;
    let u: String = line[i..].chars().take_while(|c| !c.is_whitespace() && *c != '"' && *c != '\\').collect();
    let host = u["https://".len()..].split(['/', '?', '#']).next().unwrap_or("");
    let ok = ["claude.ai", "claude.com", "anthropic.com"].iter().any(|d| host == *d || host.ends_with(&format!(".{d}")));
    (ok && u.len() <= 4096).then_some(u)
}

// ログイン(`claude auth login --claudeai`)を、利用者が押したときだけ動かす。ブラウザでの認証を待ち、終わると Done か Err を 1 回出す
pub fn login(job: &Job, emit: &mut dyn FnMut(Event)) {
    let Some(mut cmd) = cli_cmd(&["auth", "login", "--claudeai"]) else { return emit(Event::Err { kind: "nocli" }) };
    cmd.env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN");
    no_window(&mut cmd).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return emit(Event::Err { kind: if e.kind() == std::io::ErrorKind::NotFound { "nocli" } else { "other" } }),
    };
    let stdout = child.stdout.take().unwrap();
    *job.child.lock().unwrap() = Some(child);
    if job.cancelled.load(Ordering::SeqCst) {
        job.cancel();
    }
    let (done_tx, done_rx) = mpsc::channel::<()>();
    thread::scope(|s| {
        let j = job;
        s.spawn(move || {
            if let Err(mpsc::RecvTimeoutError::Timeout) = done_rx.recv_timeout(TIMEOUT) {
                j.cancel();
            }
        });
        for line in BufReader::new(stdout).split(b'\n') {
            let Ok(line) = line else { break };
            if let Some(u) = login_url(&String::from_utf8_lossy(&line)) {
                emit(Event::Url { s: u });
            }
        }
        let _ = done_tx.send(());
    });
    let code = job.child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code()).unwrap_or(1);
    if job.cancelled.load(Ordering::SeqCst) {
        emit(Event::Err { kind: "other" });
    } else if code == 0 {
        emit(Event::Done { stop: "end" });
    } else if code == 127 {
        emit(Event::Err { kind: "nocli" });
    } else {
        emit(Event::Err { kind: "login" });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effort_は決まった語だけ通す() {
        for e in ["", "low", "medium", "high", "xhigh", "max"] {
            assert!(effort_ok(e));
        }
        assert!(!effort_ok("ultra") && !effort_ok("high; rm"));
    }

    #[test]
    fn effort_は引数に渡る() {
        let a = claude_args("sys", "opus", "high");
        assert_eq!(a[a.len() - 2..], ["--effort", "high"]);
        assert!(!claude_args("sys", "", "").iter().any(|x| x == "--effort"));
        assert!(wsl_script("opus", "high").contains(" --effort 'high'") || wsl_script("opus", "high").contains(" --effort high"));
    }

    #[test]
    fn ログインの_url_は_claude_のドメインだけ拾う() {
        assert_eq!(login_url("visit: https://claude.ai/oauth/authorize?code=true&x=1 now").as_deref(), Some("https://claude.ai/oauth/authorize?code=true&x=1"));
        assert!(login_url("https://evil.example/claude.ai").is_none());
        assert!(login_url("https://claude.ai.evil.example/x").is_none());
        assert!(login_url("no url").is_none());
    }
}
