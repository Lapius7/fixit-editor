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
    // 添えた画像(base64)。文字だけの発言では空
    #[serde(default)]
    pub images: Vec<Img>,
}

#[derive(Deserialize, Clone)]
pub struct Img {
    #[serde(rename = "type")]
    pub kind: String,
    pub data: String,
}

// 画像 1 枚の上限(base64 の文字数)。画面側で 3.5MB 以下に縮めてから送る
const MAX_IMG_B64: usize = 5_000_000;
fn img_ok(i: &Img) -> bool {
    matches!(i.kind.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp")
        && (1..=MAX_IMG_B64).contains(&i.data.len())
        && i.data.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=')
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
    // 使った量(トークン数)。i=入力 o=出力 cr=キャッシュ読み込み cw=キャッシュ書き込み
    Usage { i: u64, o: u64, cr: u64, cw: u64 },
    // 上限の使用率。id は five_hour / seven_day など、u は 0〜1、r は戻る時刻(UNIX 秒)
    Limit { id: String, u: f64, r: u64 },
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

// claude に渡す中身。画像がなければ台本の文字だけ。画像があれば stream-json の 1 行(画像 → 台本の文字の順)にする
pub fn stdin_payload(m: &[Msg]) -> (bool, String) {
    let text = transcript(m);
    if !m.iter().any(|x| !x.images.is_empty()) {
        return (false, text);
    }
    let mut content: Vec<serde_json::Value> = m
        .iter()
        .flat_map(|x| x.images.iter())
        .map(|i| serde_json::json!({ "type": "image", "source": { "type": "base64", "media_type": i.kind, "data": i.data } }))
        .collect();
    content.push(serde_json::json!({ "type": "text", "text": text }));
    let line = serde_json::json!({ "type": "user", "message": { "role": "user", "content": content } });
    (true, format!("{line}\n"))
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
// どの claude を使うか。"" と "auto" は Windows の claude を先に探して、なければ WSL。"windows" と "wsl" は、その片方だけ
pub fn where_ok(w: &str) -> bool {
    matches!(w, "" | "auto" | "windows" | "wsl")
}
enum Target {
    Native(PathBuf),
    Wsl,
}
fn pick(wh: &str) -> Option<Target> {
    if wh != "wsl" {
        if let Some(b) = find_native() {
            return Some(Target::Native(b));
        }
    }
    if wh != "windows" && has_wsl() {
        return Some(Target::Wsl);
    }
    None
}
fn has_wsl() -> bool {
    cfg!(windows) && std::env::var_os("PATH").map_or(false, |p| std::env::split_paths(&p).any(|d| d.join("wsl.exe").is_file()))
}

fn claude_args(system: &str, model: &str, effort: &str, json_in: bool) -> Vec<String> {
    let mut a: Vec<String> = if json_in { vec!["--input-format".into(), "stream-json".into()] } else { vec![] };
    a.extend(["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt"]
        .iter()
        .map(|s| s.to_string()));
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
fn wsl_script(model: &str, effort: &str, json_in: bool) -> String {
    let mut m = if model.is_empty() { String::new() } else { format!(" --model {}", sq(model)) };
    if json_in {
        m.push_str(" --input-format stream-json");
    }
    if !effort.is_empty() {
        m.push_str(&format!(" --effort {}", sq(effort)));
    }
    format!(
        "unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH=\"$HOME/.local/bin:$HOME/.claude/local:$PATH\"; export PATH; command -v claude >/dev/null 2>&1 || exit 127; d=$(mktemp -d) || exit 1; cd \"$d\" || exit 1; claude -p --output-format stream-json --include-partial-messages --verbose --tools '' --no-session-persistence --setting-sources '' --strict-mcp-config --disable-slash-commands --system-prompt \"$FIXIT_SYS\"{m}; rc=$?; cd /; rm -rf \"$d\"; exit $rc"
    )
}

// rate_limit_event の中身から、窓(five_hour / seven_day など)ごとの使用率を取り出す。unifiedWindows がなければ、最上位の 1 つだけ見る
fn limit_events(e: &serde_json::Value) -> Vec<Event> {
    let info = &e["rate_limit_info"];
    if let Some(w) = info["unifiedWindows"].as_object() {
        return w
            .iter()
            .filter_map(|(id, v)| Some(Event::Limit { id: id.clone(), u: v["utilization"].as_f64()?, r: v["resetsAt"].as_u64().unwrap_or(0) }))
            .collect();
    }
    match (info["rateLimitType"].as_str(), info["utilization"].as_f64()) {
        (Some(id), Some(u)) => vec![Event::Limit { id: id.to_string(), u, r: info["resetsAt"].as_u64().unwrap_or(0) }],
        _ => vec![],
    }
}
// result の usage から、1 回の呼び出しで使ったトークン数を取り出す
fn usage_event(e: &serde_json::Value) -> Option<Event> {
    let u = &e["usage"];
    if !u.is_object() {
        return None;
    }
    let n = |k: &str| u[k].as_u64().unwrap_or(0);
    Some(Event::Usage { i: n("input_tokens"), o: n("output_tokens"), cr: n("cache_read_input_tokens"), cw: n("cache_creation_input_tokens") })
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
pub fn chat(system: &str, model: &str, effort: &str, wh: &str, messages: &[Msg], job: &Job, emit: &mut dyn FnMut(Event)) {
    if messages.is_empty() || messages.iter().any(|m| (m.role != "user" && m.role != "assistant") || !m.images.iter().all(img_ok)) || (!model.is_empty() && !model_ok(model)) || !effort_ok(effort) || !where_ok(wh) {
        return emit(Event::Err { kind: "other" });
    }
    if RUNNING.fetch_add(1, Ordering::SeqCst) >= MAX_RUNNING {
        RUNNING.fetch_sub(1, Ordering::SeqCst);
        return emit(Event::Err { kind: "rate" });
    }
    let dir = temp_dir();
    run_inner(system, model, effort, wh, messages, job, dir.as_ref(), emit);
    if let Some(d) = dir {
        let _ = std::fs::remove_dir_all(d);
    }
    RUNNING.fetch_sub(1, Ordering::SeqCst);
}

fn run_inner(system: &str, model: &str, effort: &str, wh: &str, messages: &[Msg], job: &Job, dir: Option<&PathBuf>, emit: &mut dyn FnMut(Event)) {
    let Some(dir) = dir else { return emit(Event::Err { kind: "other" }) };
    let (json_in, text) = stdin_payload(messages);
    let mut cmd = match pick(wh) {
        Some(Target::Native(bin)) => {
            let mut c = Command::new(bin);
            c.args(claude_args(system, model, effort, json_in));
            c
        }
        Some(Target::Wsl) => {
        let mut c = Command::new("wsl.exe");
        c.args(["-e", "sh", "-c", "eval \"$FIXIT_SH\""]);
        c.env("FIXIT_SH", wsl_script(model, effort, json_in)).env("FIXIT_SYS", system);
        let wslenv = match std::env::var("WSLENV") {
            Ok(v) if !v.is_empty() => format!("{v}:FIXIT_SH:FIXIT_SYS"),
            _ => "FIXIT_SH:FIXIT_SYS".to_string(),
        };
        c.env("WSLENV", wslenv);
        c
        }
        None => return emit(Event::Err { kind: "nocli" }),
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
            } else if ty == "rate_limit_event" {
                // 5 時間と週間の使用率。claude が毎回の呼び出しで返すものを、そのまま画面へ渡す
                limit_events(&e).into_iter().for_each(&mut *emit);
            } else if ty == "result" {
                if let Some(u) = usage_event(&e) {
                    emit(u);
                }
                if e["is_error"] == true {
                    err_text = format!("{}\n{}", e["result"].as_str().unwrap_or(""), err_text);
                }
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
fn cli_cmd(args: &[&str], wh: &str) -> Option<Command> {
    if let Target::Native(bin) = pick(wh)? {
        let mut c = Command::new(bin);
        c.args(args);
        return Some(c);
    }
    let a = args.iter().map(|x| sq(x)).collect::<Vec<_>>().join(" ");
    let mut c = Command::new("wsl.exe");
    c.args(["-e", "sh", "-c", &format!("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH=\"$HOME/.local/bin:$HOME/.claude/local:$PATH\"; export PATH; command -v claude >/dev/null 2>&1 || exit 127; exec claude {a}")]);
    Some(c)
}

// 接続の状態。"ready"(ログイン済み) / "login"(未ログイン) / "nocli"(claude がない) / "unknown"(確かめられない)
// `claude auth status --json` の loggedIn だけを見る。メールアドレスやトークンは読まない・返さない
pub fn status(wh: &str) -> &'static str {
    if !where_ok(wh) {
        return "unknown";
    }
    let Some(mut cmd) = cli_cmd(&["auth", "status", "--json"], wh) else { return "nocli" };
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
pub fn login(wh: &str, job: &Job, emit: &mut dyn FnMut(Event)) {
    if !where_ok(wh) {
        return emit(Event::Err { kind: "other" });
    }
    let Some(mut cmd) = cli_cmd(&["auth", "login", "--claudeai"], wh) else { return emit(Event::Err { kind: "nocli" }) };
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

// ---- 使用量(5 時間/週間)を、会話なしで取る ----
// claude のログイン情報(.credentials.json)から、読み取り用のトークンだけを取り出し、Anthropic の使用量の窓口に問い合わせる。
// トークンはこの関数の中だけで使い、画面にも保存にも渡さない。返すのは使用率とリセット時刻だけ。
const USAGE_IDS: [&str; 4] = ["five_hour", "seven_day", "seven_day_opus", "seven_day_sonnet"];

fn token_of(cred: &[u8]) -> Option<String> {
    let v: serde_json::Value = serde_json::from_slice(cred).ok()?;
    let t = v.get("claudeAiOauth")?.get("accessToken")?.as_str()?;
    (!t.is_empty() && t.len() <= 2048 && !t.chars().any(|c| c.is_control() || c == ' ')).then(|| t.to_string())
}

/// { id: { u: 使用率(0〜1), r: リセット時刻(ISO の文字列) } }。数字と日時の形でないものは捨てる
pub fn usage_out(v: &serde_json::Value) -> serde_json::Value {
    let mut m = serde_json::Map::new();
    for id in USAGE_IDS {
        let Some(o) = v.get(id).filter(|x| x.is_object()) else { continue };
        let Some(u) = o.get("utilization").and_then(|x| x.as_f64()).filter(|x| x.is_finite() && *x >= 0.0) else { continue };
        let r = o.get("resets_at").and_then(|x| x.as_str()).filter(|x| x.len() <= 40).unwrap_or("");
        m.insert(id.into(), serde_json::json!({ "u": (u / 100.0).min(1.0), "r": r }));
    }
    serde_json::Value::Object(m)
}

fn cred_native() -> Option<Vec<u8>> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    let mut f = std::fs::File::open(PathBuf::from(home).join(".claude").join(".credentials.json")).ok()?;
    let mut b = Vec::new();
    (&mut f).take(65536).read_to_end(&mut b).ok()?;
    Some(b)
}

fn cred_wsl() -> Option<Vec<u8>> {
    if !has_wsl() {
        return None;
    }
    let mut c = Command::new("wsl.exe");
    c.args(["-e", "sh", "-c", "cat \"$HOME/.claude/.credentials.json\" 2>/dev/null"]);
    let o = no_window(&mut c).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    (o.status.success() && o.stdout.len() <= 65536).then_some(o.stdout)
}

fn fetch_usage(tok: &str) -> Result<serde_json::Value, &'static str> {
    let r = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(30)).build()
        .get("https://api.anthropic.com/api/oauth/usage")
        .set("Authorization", &format!("Bearer {tok}"))
        .set("anthropic-beta", "oauth-2025-04-20")
        .set("Accept", "application/json")
        .set("User-Agent", "Fixit-Editor")
        .call();
    match r {
        Ok(x) => {
            let mut b = Vec::new();
            x.into_reader().take(65536).read_to_end(&mut b).map_err(|_| "network")?;
            serde_json::from_slice(&b).map_err(|_| "other")
        }
        Err(ureq::Error::Status(401 | 403, _)) => Err("login"),
        Err(_) => Err("network"),
    }
}

/// { limits: {...} } か { error: "nocli"|"login"|"network"|"other" }。wh は status と同じ指定
pub fn usage(wh: &str) -> serde_json::Value {
    if !where_ok(wh) {
        return serde_json::json!({ "error": "other" });
    }
    let mut srcs: Vec<Vec<u8>> = Vec::new();
    if wh != "wsl" {
        srcs.extend(cred_native());
    }
    if wh != "windows" && srcs.is_empty() {
        srcs.extend(cred_wsl());
    }
    let mut err = "nocli";
    for c in srcs {
        let Some(t) = token_of(&c) else { continue };
        match fetch_usage(&t) {
            Ok(v) => return serde_json::json!({ "limits": usage_out(&v) }),
            Err(e) => err = e,
        }
    }
    serde_json::json!({ "error": err })
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
        let a = claude_args("sys", "opus", "high", false);
        assert_eq!(a[a.len() - 2..], ["--effort", "high"]);
        assert!(!claude_args("sys", "", "", false).iter().any(|x| x == "--effort"));
        assert!(wsl_script("opus", "high", false).contains(" --effort 'high'") || wsl_script("opus", "high", false).contains(" --effort high"));
    }

    #[test]
    fn 画像があるときだけ_stream_json_で渡す() {
        let t = |c: &str, images: Vec<Img>| Msg { role: "user".into(), content: c.into(), images };
        let (j, s) = stdin_payload(&[t("hi", vec![])]);
        assert!(!j && s == "hi");
        assert!(!claude_args("s", "", "", false).iter().any(|x| x == "--input-format"));
        let img = Img { kind: "image/png".into(), data: "iVBORw0K".into() };
        assert!(img_ok(&img));
        let (j, s) = stdin_payload(&[t("what?", vec![img])]);
        assert!(j && s.ends_with('\n'));
        let v: serde_json::Value = serde_json::from_str(s.trim()).unwrap();
        assert_eq!(v["message"]["content"][0]["source"]["media_type"], "image/png");
        assert_eq!(v["message"]["content"][1]["text"], "what?");
        assert!(claude_args("s", "", "", true).windows(2).any(|w| w == ["--input-format", "stream-json"]));
        assert!(wsl_script("", "", true).contains(" --input-format stream-json"));
        assert!(!img_ok(&Img { kind: "image/svg+xml".into(), data: "AA==".into() }));
        assert!(!img_ok(&Img { kind: "image/png".into(), data: "a\"b".into() }));
    }

    #[test]
    fn 使用率と使用量を取り出す() {
        let j = |v: serde_json::Value| serde_json::to_value(v).unwrap();
        let e: serde_json::Value = serde_json::from_str(r#"{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":{"five_hour":{"utilization":0.72,"resetsAt":1800000000},"seven_day":{"utilization":0.89},"bad":{"status":"x"}}}}"#).unwrap();
        let mut v: Vec<_> = limit_events(&e).iter().map(|x| serde_json::to_value(x).unwrap()).collect();
        v.sort_by_key(|x| x["id"].as_str().unwrap().to_string());
        assert_eq!(v.len(), 2); // utilization のない窓は捨てる
        assert_eq!(v[0], j(serde_json::json!({"t":"limit","id":"five_hour","u":0.72,"r":1800000000u64})));
        assert_eq!(v[1]["r"], 0);
        let one: serde_json::Value = serde_json::from_str(r#"{"rate_limit_info":{"rateLimitType":"seven_day","utilization":0.5,"resetsAt":5}}"#).unwrap();
        assert_eq!(serde_json::to_value(&limit_events(&one)[0]).unwrap()["id"], "seven_day");
        assert!(limit_events(&serde_json::json!({})).is_empty());
        let r: serde_json::Value = serde_json::from_str(r#"{"type":"result","usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":5}}"#).unwrap();
        assert_eq!(serde_json::to_value(usage_event(&r).unwrap()).unwrap(), serde_json::json!({"t":"usage","i":3,"o":4,"cr":5,"cw":0}));
        assert!(usage_event(&serde_json::json!({"type":"result"})).is_none());
    }

    #[test]
    fn 場所の指定は決まった語だけ通す() {
        for w in ["", "auto", "windows", "wsl"] {
            assert!(where_ok(w));
        }
        assert!(!where_ok("mac") && !where_ok("wsl; rm"));
    }

    #[test]
    fn ログインの_url_は_claude_のドメインだけ拾う() {
        assert_eq!(login_url("visit: https://claude.ai/oauth/authorize?code=true&x=1 now").as_deref(), Some("https://claude.ai/oauth/authorize?code=true&x=1"));
        assert!(login_url("https://evil.example/claude.ai").is_none());
        assert!(login_url("https://claude.ai.evil.example/x").is_none());
        assert!(login_url("no url").is_none());
    }

    #[test]
    fn 使用量の返事から使用率とリセット時刻だけ取り出す() {
        let v = serde_json::json!({ "five_hour": { "utilization": 8.0, "resets_at": "2026-11-12T14:40:00+00:00", "limit_dollars": null }, "seven_day": { "utilization": 150.0, "resets_at": null }, "seven_day_opus": null, "x": { "utilization": 1.0 } });
        let o = usage_out(&v);
        assert_eq!(o["five_hour"]["u"], 0.08);
        assert_eq!(o["five_hour"]["r"], "2026-11-12T14:40:00+00:00");
        assert_eq!(o["seven_day"]["u"], 1.0);
        assert_eq!(o["seven_day"]["r"], "");
        assert!(o.get("seven_day_opus").is_none() && o.get("x").is_none());
    }

    #[test]
    fn ログイン情報からトークンだけ取り出す() {
        assert_eq!(token_of(br#"{"claudeAiOauth":{"accessToken":"abc","refreshToken":"zzz"}}"#).as_deref(), Some("abc"));
        assert!(token_of(br#"{"claudeAiOauth":{"accessToken":"a b"}}"#).is_none());
        assert!(token_of(b"not json").is_none() && token_of(b"{}").is_none());
    }
}
