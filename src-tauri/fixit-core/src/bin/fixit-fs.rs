// 動作確認用の小さな CLI。ブラウザ版の /__fs と同じ操作を、コマンドラインから呼ぶ。
//   fixit-fs <op> key=value ...     (write は標準入力が本文。read は標準出力へ中身)
//   fixit-fs claude [model=..] [effort=..] [system=..] msg=..   (返事を NDJSON で出す)
use fixit_core::{claude, fs};
use std::io::{Read, Write};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(op) = args.next() else {
        eprintln!("使い方: fixit-fs <op> key=value ...");
        std::process::exit(2);
    };
    let mut q = fs::Q::new();
    for a in args {
        if let Some((k, v)) = a.split_once('=') {
            q.insert(k.to_string(), v.to_string());
        }
    }
    if op == "claude-status" {
        println!("{}", claude::status());
        return;
    }
    if op == "claude" {
        let msgs = vec![claude::Msg { role: "user".into(), content: q.get("msg").cloned().unwrap_or_default() }];
        let job = claude::Job::default();
        let mut out = std::io::stdout();
        claude::chat(q.get("system").map(|s| s.as_str()).unwrap_or(""), q.get("model").map(|s| s.as_str()).unwrap_or(""), q.get("effort").map(|s| s.as_str()).unwrap_or(""), &msgs, &job, &mut |e| {
            let _ = writeln!(out, "{}", serde_json::to_string(&e).unwrap());
            let _ = out.flush();
        });
        return;
    }
    let body = if op == "write" {
        let mut b = vec![];
        let _ = std::io::stdin().read_to_end(&mut b);
        Some(b)
    } else {
        None
    };
    match fs::dispatch(&op, &q, body) {
        Ok(r) => {
            let _ = std::io::stdout().write_all(&r.into_bytes());
        }
        Err(e) => {
            let mut j = e.to_json();
            j["status"] = e.status.into();
            println!("{j}");
            std::process::exit(1);
        }
    }
}
