// dela を、画面に出さない疑似端末(シェル)の中で動かす。出力は公開 URL を拾うためだけに読む。
// アプリを閉じるとき(pagehide)は、動かしているものをすべて止める(Rust 側も、終了時に残りの端末を止める)。
import { IS_TAURI } from "@/shared/chrome";
import { tauriPty, type Sock } from "@/platform/pty";

export type Bg = { stop: (now?: boolean) => void };
type Opts = { id: number; command: string; host?: string; cwd?: string; shell?: string; onOut: (chunk: string) => void; onEnd: () => void };

const live = new Set<Bg>();
if (typeof window !== "undefined") window.addEventListener("pagehide", () => { for (const b of [...live]) b.stop(true); });

export function startBg({ id, command, host, cwd, shell, onOut, onEnd }: Opts): Bg {
  const q = new URLSearchParams({ ...(host ? { host } : {}), ...(cwd ? { cwd } : {}), ...(shell ? { shell } : {}) }).toString();
  const sock: Sock = IS_TAURI ? tauriPty(id, host, cwd, shell) : (() => {
    const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__term${q ? `?${q}` : ""}`);
    w.binaryType = "arraybuffer";
    return w as unknown as Sock;
  })();
  const dec = new TextDecoder();
  let probe: ReturnType<typeof setInterval> | undefined, sent = false, ended = false, tries = 0;
  // シェルが入力を受けられる状態になってから、コマンドを送る(起動中に送ると、rc の読み込みなどで捨てられる)。
  // 計算結果が出力に現れたら準備完了とみなす(打った式そのものには結果の数字が含まれない)。一定回数試しても出なければ、そのまま送る
  const READY = "864192", PROBE = "echo $((7*123456))\r";
  const go = () => { if (sent || ended || sock.readyState !== 1) return; sent = true; clearInterval(probe); sock.send(`${command}; exit\r`); };
  const tick = () => { if (sent || ended || sock.readyState !== 1) return; if (tries++ >= 30) return go(); sock.send(PROBE); };
  const finish = () => { if (ended) return; ended = true; clearInterval(probe); live.delete(bg); onEnd(); };
  const bg: Bg = {
    stop: (now) => {
      if (ended) return;
      ended = true; clearInterval(probe); live.delete(bg);
      if (now) return sock.close(); // アプリを閉じるとき: 待たずに閉じる
      try { if (sock.readyState === 1) sock.send("\u0003"); } catch { /* すでに閉じている */ }
      setTimeout(() => sock.close(), 300); // Ctrl+C が dela に届いてから閉じる
    },
  };
  live.add(bg);
  sock.onopen = () => { probe = setInterval(tick, 1000); };
  sock.onmessage = (e) => {
    const t = typeof e.data === "string" ? e.data : dec.decode(e.data as ArrayBuffer, { stream: true });
    // Windows の ConPTY は、起動時のカーソル位置の問い合わせに返事があるまで表示を始めない。画面がないので、ここで返す
    if (t.includes("\x1b[6n")) sock.send("\x1b[1;1R");
    if (t.includes("\x1b[c") || t.includes("\x1b[0c")) sock.send("\x1b[?1;2c");
    if (!sent && t.includes(READY)) go();
    onOut(t);
  };
  sock.onclose = finish;
  sock.onerror = finish;
  return bg;
}
