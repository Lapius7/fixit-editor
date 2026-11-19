// 動かし続ける claude の確認用(開発者向け): 道具の呼び出し → 結果を返す → 続きの質問、を実際の claude で通す。
// 使い方: cargo run -p fixit-core --bin claude-session-test
use fixit_core::claude::{Event, Msg};
use fixit_core::claude_session::{close_all, tool_result, turn, ToolSpec};
use std::sync::{Arc, Mutex};

fn msg(role: &str, c: &str) -> Msg {
    serde_json::from_value(serde_json::json!({ "role": role, "content": c })).unwrap()
}

fn run(m: &[Msg], resume: usize, tools: &[ToolSpec]) -> String {
    let text = Arc::new(Mutex::new(String::new()));
    let t = text.clone();
    let emit: fixit_core::claude_session::Emit = Arc::new(move |e| match e {
        Event::Text { s } => t.lock().unwrap().push_str(&s),
        Event::Tool { cid, name, args } => {
            println!("tool {name} {args}");
            tool_result("s1", &cid, "SECRET_WORD=pineapple", false);
        }
        Event::Done { stop } => println!("done {stop}"),
        Event::Err { kind } => println!("ERR {kind}"),
        _ => {}
    });
    turn("s1", "Be brief.", "haiku", "", &std::env::var("FIXIT_WH").unwrap_or_default(), m, resume, tools, emit);
    let r = text.lock().unwrap().clone();
    r
}

fn main() {
    let tools: Vec<ToolSpec> = serde_json::from_value(serde_json::json!([{ "name": "read_file", "description": "Read a file", "schema": { "type": "object", "properties": { "path": { "type": "string" } }, "required": ["path"] } }])).unwrap();
    let mut m = vec![msg("user", "Use read_file on a.txt and tell me what it says.")];
    let a1 = run(&m, 0, &tools);
    println!("A1: {a1}");
    m.push(msg("assistant", &a1));
    m.push(msg("user", "What was the secret word? One word, no tools."));
    let a2 = run(&m, 2, &tools);
    println!("A2: {a2}");
    close_all();
}
