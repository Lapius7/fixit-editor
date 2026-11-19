// 会話ごとに動かし続ける claude(道具つき)。server/claudeSession.ts と同じ振る舞い。
// claude を stream-json の双方向で起動したままにし、発言を 1 つずつ流し込む。道具(ファイル操作など)は MCP(type: sdk)として
// こちらが受け持つ: claude が呼ぶと制御メッセージが標準出力に出る → 画面へ Event::Tool → 画面が claude_tool で結果を返す → claude へ返す。
use crate::claude::{classify, effort_ok, img_ok, limit_events, model_ok, pick, temp_dir, usage_event, where_ok, Event, Msg, Target};
use crate::run::{no_window, sq};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const SERVER: &str = "fixit";
const MAX_SESSIONS: usize = 4; // 同時に動かし続ける数(使われていない古いものから閉じる)。src/shared/config.ts の AI_CLI_MAX_SESSIONS と同じ
const IDLE: Duration = Duration::from_secs(600); // src/shared/config.ts の AI_SESSION_IDLE_MS と同じ

#[derive(Deserialize, Clone, Debug)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

pub type Emit = Arc<dyn Fn(Event) + Send + Sync>;

struct Turn {
    emit: Emit,
    stop: &'static str,
    sent: bool,
    n: usize,
    done: mpsc::Sender<()>,
}
struct Inner {
    turn: Option<Turn>,
    known: usize,
    used: Instant,
    err: String,
    // 画面に渡した道具の呼び出し(cid → claude の request_id と JSON-RPC の id)
    pending: HashMap<String, (String, Value)>,
}
struct Session {
    sid: String,
    sig: String,
    dir: Option<std::path::PathBuf>,
    tools: Vec<ToolSpec>,
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Child>>,
    inner: Mutex<Inner>,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, Arc<Session>>>> = OnceLock::new();
static CID: AtomicU64 = AtomicU64::new(1);
fn map() -> &'static Mutex<HashMap<String, Arc<Session>>> {
    SESSIONS.get_or_init(|| {
        // 使われていない会話を閉じる見張り
        thread::spawn(|| loop {
            thread::sleep(Duration::from_secs(30));
            let idle: Vec<Arc<Session>> = map().lock().unwrap().values().filter(|s| { let i = s.inner.lock().unwrap(); i.turn.is_none() && i.used.elapsed() > IDLE }).cloned().collect();
            idle.iter().for_each(|s| dispose(s));
        });
        Mutex::new(HashMap::new())
    })
}

fn write(s: &Session, v: &Value) {
    if let Some(i) = s.stdin.lock().unwrap().as_mut() {
        let _ = writeln!(i, "{v}").and_then(|_| i.flush());
    }
}

fn dispose(s: &Arc<Session>) {
    {
        let mut m = map().lock().unwrap();
        if m.get(&s.sid).map_or(false, |x| Arc::ptr_eq(x, s)) {
            m.remove(&s.sid);
        }
    }
    s.stdin.lock().unwrap().take();
    if let Some(c) = s.child.lock().unwrap().as_mut() {
        let _ = c.kill();
    }
    if let Some(d) = &s.dir {
        let _ = std::fs::remove_dir_all(d);
    }
}

pub fn close(sid: &str) {
    let s = map().lock().unwrap().get(sid).cloned();
    if let Some(s) = s {
        dispose(&s);
    }
}
pub fn close_all() {
    let all: Vec<Arc<Session>> = map().lock().unwrap().values().cloned().collect();
    all.iter().for_each(dispose);
}

// 履歴を台本にして、claude に渡す 1 行にする(画像があれば画像 → 文字の順)
fn user_line(m: &[Msg]) -> Value {
    let text = crate::claude::transcript(m);
    let imgs: Vec<Value> = m.iter().flat_map(|x| x.images.iter()).map(|i| json!({ "type": "image", "source": { "type": "base64", "media_type": i.kind, "data": i.data } })).collect();
    let content = if imgs.is_empty() { json!(text) } else { let mut c = imgs; c.push(json!({ "type": "text", "text": text })); json!(c) };
    json!({ "type": "user", "message": { "role": "user", "content": content } })
}

fn end_turn(s: &Session, v: Option<Event>) {
    let t = { let mut i = s.inner.lock().unwrap(); i.used = Instant::now(); i.turn.take() };
    if let Some(t) = t {
        if let Some(v) = v {
            (t.emit)(v);
        }
        let _ = t.done.send(());
    }
}

fn handle(s: &Arc<Session>, e: &Value) {
    let ty = e["type"].as_str().unwrap_or("");
    if ty == "system" && e["subtype"] == "init" {
        let ok = e["mcp_servers"].as_array().and_then(|a| a.iter().find(|x| x["name"] == SERVER)).map_or(false, |x| x["status"] == "connected");
        if !s.tools.is_empty() && !ok {
            end_turn(s, Some(Event::Err { kind: "other" }));
            dispose(s);
        }
        return;
    }
    if ty == "control_request" && e["request"]["subtype"] == "mcp_message" {
        return mcp(s, e["request_id"].as_str().unwrap_or(""), &e["request"]["message"]);
    }
    let emit = { let i = s.inner.lock().unwrap(); i.turn.as_ref().map(|t| t.emit.clone()) };
    let Some(emit) = emit else { return };
    if ty == "stream_event" {
        let ev = &e["event"];
        match ev["type"].as_str() {
            Some("content_block_delta") if ev["delta"]["type"] == "text_delta" => {
                if let Some(t) = ev["delta"]["text"].as_str().filter(|t| !t.is_empty()) {
                    if let Some(t0) = s.inner.lock().unwrap().turn.as_mut() { t0.sent = true; }
                    emit(Event::Text { s: t.to_string() });
                }
            }
            Some("message_delta") => {
                let r = ev["delta"]["stop_reason"].as_str();
                if let Some(t) = s.inner.lock().unwrap().turn.as_mut() {
                    match r { Some("max_tokens") => t.stop = "length", Some("refusal") => t.stop = "refusal", _ => {} }
                }
            }
            _ => {}
        }
    } else if ty == "rate_limit_event" {
        limit_events(e).into_iter().for_each(|x| emit(x));
    } else if ty == "result" {
        if let Some(u) = usage_event(e) {
            emit(u);
        }
        let (sent, stop, n) = { let i = s.inner.lock().unwrap(); i.turn.as_ref().map_or((false, "end", 0), |t| (t.sent, t.stop, t.n)) };
        if e["is_error"] == true && !sent {
            let why = format!("{}\n{}", e["result"].as_str().unwrap_or(""), s.inner.lock().unwrap().err);
            end_turn(s, Some(Event::Err { kind: classify(&why) }));
            dispose(s);
            return;
        }
        s.inner.lock().unwrap().known = n + 1; // 渡した発言と、この返答が、claude の中に入った
        end_turn(s, Some(Event::Done { stop }));
    }
}

// claude が MCP で話しかけてくる。どの要求にも必ず返事をする(返さないと止まる)
fn mcp(s: &Arc<Session>, request_id: &str, m: &Value) {
    let reply = |r: Value| write(s, &json!({ "type": "control_response", "response": { "subtype": "success", "request_id": request_id, "response": { "mcp_response": r } } }));
    let Some(id) = m.get("id").filter(|v| !v.is_null()).cloned() else { return reply(json!({ "jsonrpc": "2.0", "result": {} })) };
    let ok = |result: Value| reply(json!({ "jsonrpc": "2.0", "id": id, "result": result }));
    match m["method"].as_str().unwrap_or("") {
        "initialize" => ok(json!({ "protocolVersion": m["params"]["protocolVersion"].as_str().unwrap_or("2025-11-25"), "capabilities": { "tools": {} }, "serverInfo": { "name": SERVER, "version": "1" } })),
        "tools/list" => ok(json!({ "tools": s.tools.iter().map(|t| json!({ "name": t.name, "description": t.description, "inputSchema": t.schema })).collect::<Vec<_>>() })),
        "tools/call" => {
            let name = m["params"]["name"].as_str().unwrap_or("");
            let emit = { let i = s.inner.lock().unwrap(); i.turn.as_ref().map(|t| t.emit.clone()) };
            match emit {
                Some(emit) if s.tools.iter().any(|t| t.name == name) => {
                    let cid = format!("c{}", CID.fetch_add(1, Ordering::SeqCst));
                    s.inner.lock().unwrap().pending.insert(cid.clone(), (request_id.to_string(), id));
                    emit(Event::Tool { cid, name: name.to_string(), args: m["params"]["arguments"].clone() });
                }
                _ => ok(json!({ "isError": true, "content": [{ "type": "text", "text": "This tool is not available now." }] })),
            }
        }
        "ping" => ok(json!({})),
        _ => reply(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "Method not found" } })),
    }
}

// 画面から、道具の結果を受け取って claude に返す
pub fn tool_result(sid: &str, cid: &str, text: &str, is_error: bool) -> bool {
    let Some(s) = map().lock().unwrap().get(sid).cloned() else { return false };
    let Some((rid, id)) = s.inner.lock().unwrap().pending.remove(cid) else { return false };
    let mut r = json!({ "content": [{ "type": "text", "text": text }] });
    if is_error {
        r["isError"] = json!(true);
    }
    write(&s, &json!({ "type": "control_response", "response": { "subtype": "success", "request_id": rid, "response": { "mcp_response": { "jsonrpc": "2.0", "id": id, "result": r } } } }));
    true
}

fn session_args(system: &str, model: &str, effort: &str, tools: bool) -> Vec<String> {
    let mut a: Vec<String> = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt"].iter().map(|s| s.to_string()).collect();
    a.push(system.to_string());
    if tools {
        a.extend(["--mcp-config".to_string(), mcp_config(), "--allowedTools".to_string(), format!("mcp__{SERVER}")]);
    }
    if !model.is_empty() { a.extend(["--model".to_string(), model.to_string()]); }
    if !effort.is_empty() { a.extend(["--effort".to_string(), effort.to_string()]); }
    a
}
fn mcp_config() -> String {
    json!({ "mcpServers": { SERVER: { "type": "sdk", "name": SERVER } } }).to_string()
}
fn wsl_script(model: &str, effort: &str, tools: bool) -> String {
    let mut x = String::new();
    if tools { x.push_str(&format!(" --mcp-config {} --allowedTools {}", sq(&mcp_config()), sq(&format!("mcp__{SERVER}")))); }
    if !model.is_empty() { x.push_str(&format!(" --model {}", sq(model))); }
    if !effort.is_empty() { x.push_str(&format!(" --effort {}", sq(effort))); }
    format!("unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN; PATH=\"$HOME/.local/bin:$HOME/.claude/local:$PATH\"; export PATH; command -v claude >/dev/null 2>&1 || exit 127; d=$(mktemp -d) || exit 1; cd \"$d\" || exit 1; claude -p --input-format stream-json --output-format stream-json --include-partial-messages --verbose --tools '' --no-session-persistence --setting-sources '' --strict-mcp-config --disable-slash-commands --system-prompt \"$FIXIT_SYS\"{x}; rc=$?; cd /; rm -rf \"$d\"; exit $rc")
}

fn spawn_session(sid: &str, sig: String, system: &str, model: &str, effort: &str, wh: &str, tools: &[ToolSpec]) -> Result<Arc<Session>, &'static str> {
    let dir = temp_dir();
    let Some(d) = dir.as_ref() else { return Err("other") };
    let mut cmd = match pick(wh) {
        Some(Target::Native(bin)) => { let mut c = Command::new(bin); c.args(session_args(system, model, effort, !tools.is_empty())); c }
        Some(Target::Wsl) => {
            let mut c = Command::new("wsl.exe");
            c.args(["-e", "sh", "-c", "eval \"$FIXIT_SH\""]);
            c.env("FIXIT_SH", wsl_script(model, effort, !tools.is_empty())).env("FIXIT_SYS", system);
            let wslenv = match std::env::var("WSLENV") { Ok(v) if !v.is_empty() => format!("{v}:FIXIT_SH:FIXIT_SYS"), _ => "FIXIT_SH:FIXIT_SYS".to_string() };
            c.env("WSLENV", wslenv);
            c
        }
        None => { let _ = std::fs::remove_dir_all(d); return Err("nocli") }
    };
    cmd.current_dir(d).env_remove("ANTHROPIC_API_KEY").env_remove("ANTHROPIC_AUTH_TOKEN");
    no_window(&mut cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => { let _ = std::fs::remove_dir_all(d); return Err(if e.kind() == std::io::ErrorKind::NotFound { "nocli" } else { "other" }) }
    };
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let s = Arc::new(Session { sid: sid.to_string(), sig, dir, tools: tools.to_vec(), stdin: Mutex::new(stdin), child: Mutex::new(Some(child)), inner: Mutex::new(Inner { turn: None, known: 0, used: Instant::now(), err: String::new(), pending: HashMap::new() }) });
    let s2 = s.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 { break; }
            let mut i = s2.inner.lock().unwrap();
            if i.err.len() < 4000 { i.err.push_str(&String::from_utf8_lossy(&buf[..n])); }
        }
    });
    let s3 = s.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).split(b'\n') {
            let Ok(line) = line else { break };
            if let Ok(e) = serde_json::from_slice::<Value>(&line) { handle(&s3, &e); }
        }
        // 標準出力が閉じた = claude が終わった
        let code = s3.child.lock().unwrap().take().and_then(|mut c| c.wait().ok()).and_then(|x| x.code()).unwrap_or(1);
        let (has, sent, stop) = { let i = s3.inner.lock().unwrap(); (i.turn.is_some(), i.turn.as_ref().map_or(false, |t| t.sent), i.turn.as_ref().map_or("end", |t| t.stop)) };
        if has {
            let err = s3.inner.lock().unwrap().err.clone();
            end_turn(&s3, Some(if sent && code == 0 { Event::Done { stop } } else if code == 127 { Event::Err { kind: "nocli" } } else { Event::Err { kind: classify(&err) } }));
        }
        dispose(&s3);
    });
    map().lock().unwrap().insert(sid.to_string(), s.clone());
    Ok(s)
}

// 1 回の発言を送り、返事と道具の呼び出しを emit に流す。終わる(または close で止められる)まで戻らない
pub fn turn(sid: &str, system: &str, model: &str, effort: &str, wh: &str, messages: &[Msg], resume: usize, tools: &[ToolSpec], emit: Emit) {
    let bad = sid.is_empty() || sid.len() > 64 || messages.is_empty() || messages.iter().any(|m| (m.role != "user" && m.role != "assistant") || !m.images.iter().all(img_ok)) || (!model.is_empty() && !model_ok(model)) || !effort_ok(effort) || !where_ok(wh) || tools.iter().any(|t| t.name.is_empty() || t.name.len() > 64 || !t.name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));
    if bad {
        return emit(Event::Err { kind: "other" });
    }
    let sig = format!("{system}\u{0}{model}\u{0}{effort}\u{0}{wh}\u{0}{}", serde_json::to_string(&tools.iter().map(|t| json!([t.name, t.description, t.schema])).collect::<Vec<_>>()).unwrap_or_default());
    let old = map().lock().unwrap().get(sid).cloned();
    let reuse = old.as_ref().filter(|o| { let i = o.inner.lock().unwrap(); i.turn.is_none() && o.sig == sig && resume > 0 && resume == i.known && resume < messages.len() && o.child.lock().unwrap().is_some() }).cloned();
    let s = match reuse {
        Some(s) => s,
        None => {
            if let Some(o) = &old { dispose(o); }
            // 上限を超えるときは、使われていない古い会話から閉じる
            loop {
                let mut idle: Vec<(Instant, Arc<Session>)> = { let m = map().lock().unwrap(); if m.len() < MAX_SESSIONS { break; } m.values().filter_map(|x| { let i = x.inner.lock().unwrap(); i.turn.is_none().then(|| (i.used, x.clone())) }).collect() };
                if idle.is_empty() { return emit(Event::Err { kind: "rate" }); }
                idle.sort_by_key(|x| x.0);
                dispose(&idle[0].1);
            }
            match spawn_session(sid, sig, system, model, effort, wh, tools) { Ok(s) => s, Err(k) => return emit(Event::Err { kind: k }) }
        }
    };
    let (tx, rx) = mpsc::channel();
    let known = {
        let mut i = s.inner.lock().unwrap();
        i.turn = Some(Turn { emit, stop: "end", sent: false, n: messages.len(), done: tx });
        i.used = Instant::now();
        i.known
    };
    write(&s, &user_line(if known > 0 { &messages[known..] } else { messages }));
    let _ = rx.recv(); // 終わる(Done / Err)か、close されて送り手が消えるまで
}
