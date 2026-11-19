//! 名前.localhost を、この PC の 127.0.0.1:ポート に中継する小さなプロキシ(Portless のような使い方)。
//! Host ヘッダーの名前を見て振り分けるだけで、中身は触らない(WebSocket もそのまま通る)。
//! 管理者権限の要らない固定ポート(既定 1355)で待ち受け、受けるのは 127.0.0.1 / ::1 からだけ。
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;

pub const DEFAULT_PORT: u16 = 1355;
const HEAD_MAX: usize = 64 * 1024;

#[derive(Default)]
struct State {
    port: Option<u16>,
    routes: HashMap<String, u16>,
}
fn st() -> &'static Mutex<State> {
    static S: OnceLock<Mutex<State>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(State::default()))
}

/// 名前は英小文字・数字・ハイフン(間に . を挟んで入れ子も可)。1 つのまとまりは 1〜40 文字
pub fn valid_name(n: &str) -> bool {
    !n.is_empty()
        && n.len() <= 80
        && n.split('.').all(|l| {
            !l.is_empty() && l.len() <= 40 && !l.starts_with('-') && !l.ends_with('-') && l.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

/// 待ち受けを始める(すでに動いていれば、そのポートを返す)
pub fn start(port: u16) -> Result<u16, String> {
    let mut s = st().lock().map_err(|_| "内部エラー".to_string())?;
    if let Some(p) = s.port {
        return Ok(p);
    }
    let v4 = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).map_err(|e| format!("ポート {port} で待ち受けできません: {e}"))?;
    let v6 = TcpListener::bind("[::1]:".to_string() + &port.to_string()).ok();
    for l in std::iter::once(v4).chain(v6) {
        thread::spawn(move || {
            for c in l.incoming().flatten() {
                thread::spawn(move || { let _ = handle(c); });
            }
        });
    }
    s.port = Some(port);
    Ok(port)
}

pub fn running() -> Option<u16> {
    st().lock().ok().and_then(|s| s.port)
}
pub fn set(name: &str, port: u16) -> Result<(), String> {
    if !valid_name(name) {
        return Err("名前は英小文字・数字・ハイフンにしてください".into());
    }
    if port == 0 {
        return Err("ポートが正しくありません".into());
    }
    st().lock().map_err(|_| "内部エラー".to_string())?.routes.insert(name.to_string(), port);
    Ok(())
}
pub fn remove(name: &str) {
    if let Ok(mut s) = st().lock() {
        s.routes.remove(name);
    }
}
pub fn list() -> Vec<(String, u16)> {
    let mut v: Vec<_> = st().lock().map(|s| s.routes.iter().map(|(k, p)| (k.clone(), *p)).collect()).unwrap_or_default();
    v.sort();
    v
}

/// リクエストの先頭から Host の名前(.localhost の手前)を取り出す
pub fn host_name(head: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(head);
    for line in text.split("\r\n").skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            if k.eq_ignore_ascii_case("host") {
                let host = v.trim().to_ascii_lowercase();
                let host = host.rsplit_once(':').filter(|(_, p)| p.bytes().all(|b| b.is_ascii_digit())).map_or(host.as_str(), |(h, _)| h);
                return host.strip_suffix(".localhost").map(str::to_string);
            }
        }
    }
    None
}

fn reply(c: &mut TcpStream, code: &str, body: &str) {
    let b = format!("<!doctype html><meta charset=utf-8><title>{code}</title><body style=\"font:15px/1.6 system-ui;padding:32px\">{body}");
    let _ = write!(c, "HTTP/1.1 {code}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{b}", b.len());
}

fn handle(mut c: TcpStream) -> std::io::Result<()> {
    c.set_read_timeout(Some(Duration::from_secs(10)))?;
    let mut head = Vec::new();
    let mut buf = [0u8; 4096];
    while !head.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = c.read(&mut buf)?;
        if n == 0 || head.len() + n > HEAD_MAX {
            return Ok(());
        }
        head.extend_from_slice(&buf[..n]);
    }
    let Some(name) = host_name(&head) else {
        reply(&mut c, "404 Not Found", "名前.localhost で開いてください。");
        return Ok(());
    };
    let port = st().lock().ok().and_then(|s| s.routes.get(&name).copied());
    let Some(port) = port else {
        let names: String = list().iter().map(|(n, p)| format!("<li>{n}.localhost → :{p}</li>")).collect();
        reply(&mut c, "404 Not Found", &format!("<b>{name}.localhost</b> は登録されていません。<ul>{names}</ul>"));
        return Ok(());
    };
    let Ok(mut up) = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_secs(3)) else {
        reply(&mut c, "502 Bad Gateway", &format!("ポート {port} につながりません。サーバーが起動しているか確かめてください。"));
        return Ok(());
    };
    up.write_all(&head)?;
    c.set_read_timeout(None)?;
    let (mut c2, mut up2) = (c.try_clone()?, up.try_clone()?);
    let t = thread::spawn(move || { let _ = std::io::copy(&mut c2, &mut up2); let _ = up2.shutdown(Shutdown::Write); });
    let _ = std::io::copy(&mut up, &mut c);
    let _ = c.shutdown(Shutdown::Write);
    let _ = t.join();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert!(valid_name("app") && valid_name("my-app2") && valid_name("api.shop"));
        assert!(!valid_name("") && !valid_name("A") && !valid_name("-a") && !valid_name("a_b") && !valid_name("a..b"));
    }
    #[test]
    fn host() {
        assert_eq!(host_name(b"GET / HTTP/1.1\r\nHost: Foo.localhost:1355\r\n\r\n").as_deref(), Some("foo"));
        assert_eq!(host_name(b"GET / HTTP/1.1\r\nhost: a.b.localhost\r\n\r\n").as_deref(), Some("a.b"));
        assert_eq!(host_name(b"GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"), None);
    }
    #[test]
    fn proxies_http() {
        let up = TcpListener::bind("127.0.0.1:0").unwrap();
        let up_port = up.local_addr().unwrap().port();
        thread::spawn(move || {
            for mut c in up.incoming().flatten() {
                let mut b = [0u8; 1024];
                let n = c.read(&mut b).unwrap();
                let body = if String::from_utf8_lossy(&b[..n]).contains("Host: t1.localhost") { "hello" } else { "?" };
                let _ = write!(c, "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            }
        });
        let probe = TcpListener::bind("127.0.0.1:0").unwrap();
        let px = probe.local_addr().unwrap().port();
        drop(probe);
        start(px).unwrap();
        set("t1", up_port).unwrap();
        let get = |host: &str| { let mut c = TcpStream::connect(("127.0.0.1", px)).unwrap(); write!(c, "GET / HTTP/1.1\r\nHost: {host}:{px}\r\n\r\n").unwrap(); let mut s = String::new(); c.read_to_string(&mut s).unwrap(); s };
        assert!(get("t1.localhost").ends_with("hello"));
        assert!(get("nope.localhost").starts_with("HTTP/1.1 404"));
        set("dead", 1).unwrap();
        assert!(get("dead.localhost").starts_with("HTTP/1.1 502"));
        remove("t1");
        assert!(get("t1.localhost").starts_with("HTTP/1.1 404"));
    }
}
