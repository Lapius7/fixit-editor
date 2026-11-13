// 外部コマンドを、時間と出力の上限つきで動かす。
use crate::fs::FsError;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

pub struct Run {
    pub out: Vec<u8>,
    pub err: String,
    pub code: i32,
}

// Windows でコンソール窓を出さない
pub fn no_window(c: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    c
}

// シェルに渡す文字列は、必ず単引用符で包む
pub fn sq(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn run(mut cmd: Command, input: Option<Vec<u8>>, timeout: Duration, max: usize) -> Result<Run, FsError> {
    let name = cmd.get_program().to_string_lossy().to_string();
    no_window(&mut cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| FsError::new(format!("{name} を起動できません: {e}"), 500, "ESPAWN"))?;
    let over = Arc::new(AtomicBool::new(false));

    let mut stdin = child.stdin.take().unwrap();
    let w = thread::spawn(move || {
        if let Some(d) = input {
            let _ = stdin.write_all(&d);
        }
    });
    let mut so = child.stdout.take().unwrap();
    let ov = over.clone();
    let r_out = thread::spawn(move || {
        let mut out = Vec::new();
        let mut buf = [0u8; 65536];
        loop {
            match so.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if out.len() + n > max {
                        ov.store(true, Ordering::SeqCst);
                        break;
                    }
                    out.extend_from_slice(&buf[..n]);
                }
            }
        }
        out
    });
    let mut se = child.stderr.take().unwrap();
    let r_err = thread::spawn(move || {
        let mut keep = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match se.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if keep.len() < 4000 {
                        keep.extend_from_slice(&buf[..n]);
                    }
                }
            }
        }
        String::from_utf8_lossy(&keep).to_string()
    });

    let start = Instant::now();
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {}
            Err(_) => break None,
        }
        if over.load(Ordering::SeqCst) || start.elapsed() > timeout {
            timed_out = !over.load(Ordering::SeqCst);
            let _ = child.kill();
            break child.wait().ok();
        }
        thread::sleep(Duration::from_millis(4));
    };
    let _ = w.join();
    let out = r_out.join().unwrap_or_default();
    let err = r_err.join().unwrap_or_default();
    if over.load(Ordering::SeqCst) {
        return Err(FsError::new("サイズの上限を超えました", 413, "ETOOBIG"));
    }
    if timed_out {
        return Err(FsError::new("時間内に終わりませんでした", 504, "ETIMEDOUT"));
    }
    Ok(Run { out, err, code: status.and_then(|s| s.code()).unwrap_or(1) })
}

/// AI のコマンド実行で、返す出力の最大バイト数(超えた分は先頭を捨てて末尾を残す)
pub const EXEC_CAP: usize = 60_000;

/// exec の本文({"cmd": "...", "secs": 30})を調べる。コマンドは空・長すぎ・NUL 入りを断り、秒数は 1〜120 に収める
pub fn exec_args(body: &[u8]) -> Result<(String, u64), FsError> {
    let v: serde_json::Value = serde_json::from_slice(body).map_err(|_| FsError::new("本文が正しくありません", 400, "EARG"))?;
    let cmd = v.get("cmd").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if cmd.trim().is_empty() || cmd.len() > 4000 || cmd.contains('\0') {
        return Err(FsError::new("コマンドが正しくありません", 400, "EARG"));
    }
    let secs = v.get("secs").and_then(|x| x.as_u64()).unwrap_or(30).clamp(1, 120);
    Ok((cmd, secs))
}

#[cfg(test)]
mod exec_tests {
    use super::*;

    #[test]
    fn exec_args_checks_command_and_clamps_secs() {
        assert_eq!(exec_args(br#"{"cmd":"ls"}"#).unwrap(), ("ls".to_string(), 30));
        assert_eq!(exec_args(br#"{"cmd":"ls","secs":9999}"#).unwrap().1, 120);
        assert_eq!(exec_args(br#"{"cmd":"ls","secs":0}"#).unwrap().1, 1);
        assert!(exec_args(br#"{"cmd":"  "}"#).is_err());
        assert!(exec_args(br#"{}"#).is_err());
        assert!(exec_args(b"nope").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn pc_exec_runs_in_dir_and_reports_code() {
        let mut q = std::collections::HashMap::new();
        q.insert("kind".to_string(), "pc".to_string());
        q.insert("path".to_string(), "/tmp".to_string());
        let body = br#"{"cmd":"pwd; echo err 1>&2; exit 3"}"#.to_vec();
        match crate::local::dispatch("exec", &q, Some(body)).unwrap() {
            crate::fs::Reply::Json(v) => {
                assert_eq!(v["code"], 3);
                assert!(v["out"].as_str().unwrap().contains("/tmp"));
                assert!(v["out"].as_str().unwrap().contains("err"));
            }
            _ => panic!("json expected"),
        }
    }
}
