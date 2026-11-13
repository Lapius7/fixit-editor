// 動作確認用の小さな CLI。言語サーバーを取得・起動して、握手と診断を 1 回やってみる。
//   [LSP_SERVER=ts|py|html|css|php|go|rs|rb|sql] [LSP_LANG=typescript] fixit-lsp <wsl|pc> <作業フォルダの絶対パス> <開くファイルの絶対パス>
use fixit_core::lsp::{self, Kind};
use serde_json::{json, Value};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    if a.len() < 3 {
        eprintln!("使い方: fixit-lsp <wsl|pc> <root> <file>");
        std::process::exit(2);
    }
    let kind = Kind::parse(&a[0]).expect("kind");
    let (root, file) = (a[1].clone(), a[2].clone());
    let (tx, rx) = mpsc::channel::<String>();
    let emit: lsp::Emit = Arc::new(move |s| {
        let _ = tx.send(s);
    });
    let server = std::env::var("LSP_SERVER").unwrap_or_else(|_| "ts".into());
    let lang = std::env::var("LSP_LANG").unwrap_or_else(|_| "typescript".into());
    let srv = lsp::start(kind, &server, root.clone(), emit);
    let uri = |p: &str| if p.starts_with('/') { format!("file://{p}") } else { format!("file:///{p}") };
    let text = std::fs::read_to_string(&file).unwrap_or_default();
    let mut sent = false;
    let t0 = Instant::now();
    let mut diag_asked = false;
    loop {
        let Ok(s) = rx.recv_timeout(Duration::from_secs(120)) else { eprintln!("時間切れ"); break };
        let v: Value = serde_json::from_str(&s).unwrap();
        match v["k"].as_str() {
            Some("state") => eprintln!("[{:?}] state {}", t0.elapsed(), v["s"]),
            Some("fail") => { eprintln!("失敗: {}", v["err"]); std::process::exit(1) }
            Some("exit") => { eprintln!("終了 {}", v); break }
            Some("msg") => {
                let m: Value = serde_json::from_str(v["m"].as_str().unwrap()).unwrap();
                if m["id"] == 1 && m.get("result").is_some() {
                    eprintln!("[{:?}] initialize 応答: 診断={} 補完={}", t0.elapsed(), m["result"]["capabilities"]["diagnosticProvider"].is_object(), m["result"]["capabilities"]["completionProvider"].is_object());
                    srv.send(&json!({"jsonrpc":"2.0","method":"initialized","params":{}}).to_string()).unwrap();
                    srv.send(&json!({"jsonrpc":"2.0","method":"textDocument/didOpen","params":{"textDocument":{"uri":uri(&file),"languageId":lang,"version":1,"text":text}}}).to_string()).unwrap();
                    srv.send(&json!({"jsonrpc":"2.0","id":2,"method":"textDocument/diagnostic","params":{"textDocument":{"uri":uri(&file)}}}).to_string()).unwrap();
                    diag_asked = true;
                } else if m["id"] == 2 {
                    let items = m["result"]["items"].as_array().map(|a| a.len()).unwrap_or(0);
                    eprintln!("[{:?}] 診断 {} 件", t0.elapsed(), items);
                    if let Some(first) = m["result"]["items"].get(0) { eprintln!("  例: {}", first["message"]); }
                    srv.send(&json!({"jsonrpc":"2.0","id":3,"method":"shutdown"}).to_string()).unwrap();
                } else if m["id"] == 3 {
                    srv.send(&json!({"jsonrpc":"2.0","method":"exit"}).to_string()).unwrap();
                } else if m.get("id").is_some() && m.get("method").is_some() {
                    if std::env::var("LSP_TRACE").is_ok() { eprintln!("  server→client: {}", m); }
                    // サーバーからの要求には、必ず空で答える
                    srv.send(&json!({"jsonrpc":"2.0","id":m["id"],"result":Value::Null}).to_string()).unwrap();
                }
            }
            _ => {}
        }
        if v["k"] == "state" && v["s"] == "ready" && !sent {
            sent = true;
            let init = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"processId":null,"rootUri":uri(&root),"capabilities":{"textDocument":{"diagnostic":{"dynamicRegistration":false}}},"workspaceFolders":[{"uri":uri(&root),"name":"w"}]}});
            srv.send(&init.to_string()).unwrap();
        }
    }
    let _ = diag_asked;
    srv.stop();
}
