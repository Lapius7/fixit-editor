// WSL の中に常駐するワーカー。
// ファイルの一覧・読み込み・Git などの操作のたびに wsl.exe を起動すると、1回あたり約0.2秒かかる(止まっていた VM の起動ではさらに数秒〜20秒)。
// そこで、シェルを1本だけ立ち上げたままにして、スクリプトを流し込んで結果を受け取る。
//
// Windows 側を重くしないための決まり:
// - ワーカーは最大 3 本。足りなければ、これまでどおり 1 回ごとの起動に任せる
// - 使わなかったワーカーは、設定した時間(既定 5 分)で閉じる(wsl.exe の常駐が残らない)。0 分なら常駐させない
// - 待ちはスレッドの受信で行い、ポーリングで CPU を使わない
use crate::fs::FsError;
use crate::run::{no_window, Run};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const MAX_WORKERS: usize = 3;
// 設定「ワーカーを閉じるまでの時間」(秒)。0 なら使わない
static IDLE_SECS: AtomicU64 = AtomicU64::new(300);
fn idle_limit() -> Duration {
    Duration::from_secs(IDLE_SECS.load(Ordering::SeqCst))
}
// 設定の分を反映する。短くしたときは、すでに空いているワーカーの分も次の確認で閉じる
pub fn set_idle_minutes(m: u64) {
    IDLE_SECS.store(m.min(240) * 60, Ordering::SeqCst);
    if m == 0 {
        if let Some(v) = IDLE.get() {
            if let Ok(mut v) = v.lock() {
                v.clear();
            }
        }
    }
}
// 止まっていた WSL の VM を立ち上げ直す分(新しく起動したワーカーにだけ足す)
const BOOT_MS: u64 = if cfg!(windows) { 45_000 } else { 0 };

// ワーカーの中身(POSIX sh)。1行1リクエスト: `Q <id> <最大バイト数> <スクリプトの base64> <入力の base64 か ->`
// 返事も1行: `R <id> <終了コード か T(大きすぎる)> <標準エラーの base64(先頭 4000 バイト)> <標準出力の base64>`
// 標準入力が閉じたら(wsl.exe が終わったら)自分も終わる
const LOOP: &str = r#"
d=$(mktemp -d 2>/dev/null) || { d=/tmp/fixit-w$$; mkdir -p "$d"; }
trap 'rm -rf "$d"' EXIT
while IFS=' ' read -r k id max s i; do
  [ "$k" = Q ] || continue
  printf %s "$s" | base64 -d > "$d/s"
  if [ "$i" = - ]; then : > "$d/i"; else printf %s "$i" | base64 -d > "$d/i"; fi
  sh "$d/s" < "$d/i" > "$d/o" 2> "$d/e"
  c=$?
  n=$(wc -c < "$d/o")
  [ "$n" -gt "$max" ] && c=T && : > "$d/o"
  printf 'R %s %s %s ' "$id" "$c" "$(head -c 4000 "$d/e" | base64 | tr -d '\n')"
  base64 < "$d/o" | tr -d '\n'
  printf '\n'
done
"#;

struct Worker {
    child: Child,
    tx: mpsc::Sender<Vec<u8>>,
    rx: mpsc::Receiver<String>,
    used: Instant,
}
impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

static IDLE: OnceLock<Mutex<Vec<Worker>>> = OnceLock::new();
static BUSY: AtomicUsize = AtomicUsize::new(0);
static NEXT: AtomicU64 = AtomicU64::new(1);
pub static SPAWNED: AtomicUsize = AtomicUsize::new(0);

fn idle() -> &'static Mutex<Vec<Worker>> {
    IDLE.get_or_init(|| {
        // 使われなくなったワーカーを閉じる。1分に1回起きるだけ
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(60));
            if let Ok(mut v) = idle().lock() {
                v.retain(|w| w.used.elapsed() < idle_limit());
            }
        });
        Mutex::new(Vec::new())
    })
}

fn command() -> Command {
    let mut c = if cfg!(windows) {
        let mut c = Command::new("wsl.exe");
        c.args(["-e", "sh", "-c", "eval \"$FIXIT_LOOP\""]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", "eval \"$FIXIT_LOOP\""]);
        c
    };
    c.env("FIXIT_LOOP", LOOP);
    let wslenv = match std::env::var("WSLENV") {
        Ok(v) if !v.is_empty() => format!("{v}:FIXIT_LOOP"),
        _ => "FIXIT_LOOP".to_string(),
    };
    c.env("WSLENV", wslenv);
    c
}

fn spawn() -> Option<Worker> {
    let mut c = command();
    no_window(&mut c).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = c.spawn().ok()?;
    let mut stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let (tx, wrx) = mpsc::channel::<Vec<u8>>();
    let (rtx, rx) = mpsc::channel::<String>();
    // 書き込みは別のスレッドで行う(大きな入力でこちらが止まらないように)
    std::thread::spawn(move || {
        for m in wrx {
            if stdin.write_all(&m).and_then(|_| stdin.flush()).is_err() {
                break;
            }
        }
    });
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match r.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if rtx.send(String::from_utf8_lossy(&line).trim_end().to_string()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    SPAWNED.fetch_add(1, Ordering::SeqCst);
    Some(Worker { child, tx, rx, used: Instant::now() })
}

pub enum Done {
    Ran(Run),
    Failed(FsError),
    // ワーカーを使えなかった(起動できない・途中で死んだ)。呼び出し側が 1 回ごとの起動でやり直す
    Unavailable,
}

// 空いているワーカーを取る。なければ(上限まで)新しく起動する。bool は新しく起動したか
fn take() -> Option<(Worker, bool)> {
    if IDLE_SECS.load(Ordering::SeqCst) == 0 {
        return None;
    }
    {
        let mut v = idle().lock().ok()?;
        v.retain(|w| w.used.elapsed() < idle_limit());
        if let Some(w) = v.pop() {
            BUSY.fetch_add(1, Ordering::SeqCst);
            return Some((w, false));
        }
        if BUSY.load(Ordering::SeqCst) >= MAX_WORKERS {
            return None;
        }
        // 数え間違いで上限を超えないよう、起動の前に数える
        BUSY.fetch_add(1, Ordering::SeqCst);
    }
    match spawn() {
        Some(w) => Some((w, true)),
        None => {
            BUSY.fetch_sub(1, Ordering::SeqCst);
            None
        }
    }
}

fn give_back(mut w: Worker) {
    w.used = Instant::now();
    BUSY.fetch_sub(1, Ordering::SeqCst);
    if IDLE_SECS.load(Ordering::SeqCst) == 0 {
        return;
    }
    if let Ok(mut v) = idle().lock() {
        v.push(w);
    }
}

pub fn exec(script: &str, input: Option<&[u8]>, ms: u64, max: usize) -> Done {
    for _ in 0..2 {
        let Some((w, fresh)) = take() else { return Done::Unavailable };
        let id = NEXT.fetch_add(1, Ordering::SeqCst);
        let inp = match input {
            Some(d) if !d.is_empty() => B64.encode(d),
            _ => "-".to_string(),
        };
        let req = format!("Q {id} {max} {} {inp}\n", B64.encode(script));
        if w.tx.send(req.into_bytes()).is_err() {
            BUSY.fetch_sub(1, Ordering::SeqCst);
            if fresh {
                return Done::Unavailable;
            }
            continue;
        }
        let limit = Duration::from_millis(if fresh { ms + BOOT_MS } else { ms });
        let start = Instant::now();
        loop {
            let left = limit.saturating_sub(start.elapsed());
            match w.rx.recv_timeout(left) {
                Ok(line) => {
                    let mut p = line.splitn(5, ' ');
                    if p.next() != Some("R") || p.next().and_then(|x| x.parse::<u64>().ok()) != Some(id) {
                        continue; // 前の(時間切れで捨てた)返事が残っていた
                    }
                    let code = p.next().unwrap_or("");
                    let err = p.next().unwrap_or("");
                    let out = p.next().unwrap_or("");
                    if code == "T" {
                        give_back(w);
                        return Done::Failed(FsError::new("サイズの上限を超えました", 413, "ETOOBIG"));
                    }
                    let (Ok(code), Ok(out), Ok(err)) = (code.parse::<i32>(), B64.decode(out), B64.decode(err)) else {
                        BUSY.fetch_sub(1, Ordering::SeqCst);
                        return Done::Unavailable;
                    };
                    give_back(w);
                    return Done::Ran(Run { out, err: String::from_utf8_lossy(&err).to_string(), code });
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // 動き続けているスクリプトごと、ワーカーを閉じる
                    BUSY.fetch_sub(1, Ordering::SeqCst);
                    drop(w);
                    return Done::Failed(FsError::new("時間内に終わりませんでした", 504, "ETIMEDOUT"));
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    BUSY.fetch_sub(1, Ordering::SeqCst);
                    drop(w);
                    if fresh {
                        return Done::Unavailable;
                    }
                    break; // 古いワーカーが死んでいた。新しいワーカーでもう一度
                }
            }
        }
    }
    Done::Unavailable
}

#[cfg(test)]
mod tests {
    use super::*;

    // プールは全体で共有なので、テストは1つずつ動かす
    static ONE: Mutex<()> = Mutex::new(());

    fn ran(d: Done) -> Run {
        match d {
            Done::Ran(r) => r,
            Done::Failed(e) => panic!("failed: {}", e.message),
            Done::Unavailable => panic!("unavailable"),
        }
    }

    #[test]
    fn runs_scripts_and_reuses_the_worker() {
        let _g = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let a = SPAWNED.load(Ordering::SeqCst);
        let r = ran(exec("echo hello; echo oops >&2; exit 3", None, 5000, 1 << 20));
        assert_eq!((r.out.as_slice(), r.err.trim(), r.code), (&b"hello\n"[..], "oops", 3));
        let r = ran(exec("cat", Some(b"in\0put\n"), 5000, 1 << 20));
        assert_eq!(r.out, b"in\0put\n");
        let r = ran(exec("printf 'a b\\nc'", None, 5000, 1 << 20));
        assert_eq!(r.out, b"a b\nc");
        // 3 回とも同じワーカー(並行して動く他のテストがあっても、3 本までしか増えない)
        assert!(SPAWNED.load(Ordering::SeqCst) - a <= MAX_WORKERS);
    }

    #[test]
    fn empty_output_and_special_chars() {
        let _g = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let r = ran(exec("true", None, 5000, 100));
        assert!(r.out.is_empty() && r.code == 0);
        let r = ran(exec("printf '%s' \"it's \\\"q\\\" $HOME\" | wc -c", None, 5000, 100));
        assert!(String::from_utf8_lossy(&r.out).trim().parse::<u32>().unwrap() > 5);
    }

    #[test]
    fn too_big_and_timeout_leave_the_pool_usable() {
        let _g = ONE.lock().unwrap_or_else(|e| e.into_inner());
        match exec("head -c 5000 /dev/zero", None, 5000, 100) {
            Done::Failed(e) => assert_eq!(e.status, 413),
            _ => panic!("expected 413"),
        }
        match exec("sleep 5", None, 200, 100) {
            Done::Failed(e) => assert_eq!(e.status, 504),
            _ => panic!("expected 504"),
        }
        let r = ran(exec("echo ok", None, 5000, 100));
        assert_eq!(r.out, b"ok\n");
    }

    #[test]
    fn parallel_calls_do_not_mix_results() {
        let _g = ONE.lock().unwrap_or_else(|e| e.into_inner());
        let hs: Vec<_> = (0..8)
            .map(|n| {
                std::thread::spawn(move || {
                    // 上限を超える分は Unavailable になる(呼び出し側が 1 回ごとの起動に回す)。返ってきた結果は取り違えない
                    if let Done::Ran(r) = exec(&format!("echo {n}"), None, 5000, 100) {
                        assert_eq!(String::from_utf8_lossy(&r.out).trim(), n.to_string());
                    }
                })
            })
            .collect();
        for h in hs {
            h.join().unwrap();
        }
        assert!(BUSY.load(Ordering::SeqCst) <= MAX_WORKERS);
    }
}
