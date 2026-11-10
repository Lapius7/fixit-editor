import { IS_TAURI } from "@/shared/chrome";

// WebSocket と同じ形で扱える接続。デスクトップ版では Rust 側の疑似端末(pty)につなぐ
export type Sock = {
  readyState: number;
  send: (d: string) => void;
  close: () => void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string | ArrayBuffer }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
};

export type ShellOpt = { id: string; label: string };
// 使えるシェルの一覧。デスクトップ版は PC に入っているもの、開発サーバーは向こうの環境のもの
let shells: Promise<ShellOpt[]> | null = null;
export const listShells = (): Promise<ShellOpt[]> => (shells ??= (async () => {
  try {
    if (IS_TAURI) return await (await import("@tauri-apps/api/core")).invoke<ShellOpt[]>("pty_shells");
    const r = await fetch("/__shells");
    return r.ok ? ((await r.json()) as ShellOpt[]) : [];
  } catch { return []; }
})());

export function tauriPty(id: number, host?: string, cwd?: string, shell?: string, cols = 80, rows = 24): Sock {
  const key = `t${id}-${Date.now().toString(36)}`;
  const s: Sock = { readyState: 0, send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null, onerror: null };
  const offs: (() => void)[] = [];
  let dead = false;
  // 接続が済む前に端末が返す応答(起動直後のカーソル位置の問い合わせへの返事など)は、捨てずに溜めておく。
  // Windows の ConPTY はこの返事が来るまで表示を始めないので、捨てると空白のまま止まる
  const early: string[] = [];
  s.send = (d) => { if (!d.startsWith("\u0000r") && early.length < 64) early.push(d); };
  (async () => {
    if (!IS_TAURI) return;
    const [{ invoke }, { listen }] = await Promise.all([import("@tauri-apps/api/core"), import("@tauri-apps/api/event")]);
    offs.push(await listen<string>(`pty-data-${key}`, (e) => {
      const bin = atob(e.payload), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      s.onmessage?.({ data: u.buffer });
    }));
    offs.push(await listen(`pty-exit-${key}`, () => { s.readyState = 3; s.onclose?.(); }));
    if (dead) return;
    try {
      await invoke("pty_open", { id: key, host: host || null, cwd: cwd || null, shell: shell || null, cols, rows });
    } catch (e) {
      s.readyState = 3; s.onmessage?.({ data: `\r\n\x1b[31m${String(e)}\x1b[0m\r\n` }); s.onclose?.(); return;
    }
    s.readyState = 1;
    s.send = (d) => {
      if (d.startsWith("\u0000r")) { const [c, r] = d.slice(2).split(" ").map(Number); invoke("pty_resize", { id: key, cols: c, rows: r }); }
      else invoke("pty_write", { id: key, data: d });
    };
    s.close = () => { dead = true; invoke("pty_close", { id: key }); offs.forEach((f) => f()); };
    for (const x of early.splice(0)) s.send(x);
    s.onopen?.();
  })().catch(() => s.onerror?.());
  s.close = () => { dead = true; offs.forEach((f) => f()); };
  return s;
}
