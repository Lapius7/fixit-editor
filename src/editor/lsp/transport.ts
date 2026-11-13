// 言語サーバーとの通信路。デスクトップ版は Rust 側(lsp_start など)、開発サーバーは WebSocket(/__lsp)につなぐ。
// どちらも同じ形のイベントを返す。サーバーの取得・起動は向こうが行い、ここは LSP の JSON をそのまま運ぶだけ。
import { IS_TAURI } from "@/shared/chrome";

export type LspKind = "wsl" | "pc";
export type LspEvent =
  | { k: "state"; s: "prepare" | "download" | "install" | "ready"; done?: number; total?: number; version?: string }
  | { k: "msg"; m: string }
  | { k: "exit"; code: number | null; err?: string; stopped?: boolean }
  | { k: "fail"; err: string }
  | { k: "stat"; cpu: number | null; mem: number | null };
// 負荷。cpu は 1 コアを 100% とした使用率(初回は前回がないので null)、mem は常駐メモリのバイト数
export type LspStat = { cpu: number | null; mem: number };
export type Transport = { send: (m: string) => void; stop: () => void; stats: () => Promise<LspStat | null> };

// 使えるのは、デスクトップ版と開発サーバー(ブラウザ版の配布物には言語サーバーを動かす先がない)
export const LSP_AVAILABLE = IS_TAURI || import.meta.env.DEV;

let seq = 0;

function viaTauri(kind: LspKind, server: string, root: string, on: (e: LspEvent) => void): Transport {
  const id = `l${++seq}-${Date.now().toString(36)}`;
  let dead = false;
  // 起動・送信・停止を 1 本の列にして、順序を守る(起動が済む前の送信も、起動のあとに流れる)
  let chain: Promise<unknown> = (async () => {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const ch = new Channel<string>();
    ch.onmessage = (s) => { if (dead) return; try { on(JSON.parse(s) as LspEvent); } catch { /* 壊れたイベントは捨てる */ } };
    await invoke("lsp_start", { id, kind, server, root, onEvent: ch });
  })().catch((e) => { if (!dead) on({ k: "fail", err: String(e) }); });
  const call = (cmd: string, args: Record<string, unknown>) => {
    chain = chain.then(async () => { const { invoke } = await import("@tauri-apps/api/core"); await invoke(cmd, { id, ...args }); }).catch(() => {});
  };
  return {
    send: (m) => { if (!dead) call("lsp_send", { msg: m }); },
    stop: () => { if (dead) return; dead = true; call("lsp_stop", {}); },
    // 起動が済んでから聞く(送信の列には混ぜない)。失敗は「測れなかった」として null
    stats: async () => {
      if (dead) return null;
      try {
        await chain;
        const { invoke } = await import("@tauri-apps/api/core");
        const r = await invoke<{ cpu: number | null; mem: number } | null>("lsp_stats", { id });
        return r && Number.isFinite(r.mem) ? r : null;
      } catch { return null; }
    },
  };
}

function viaSocket(server: string, root: string, on: (e: LspEvent) => void): Transport {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/__lsp?server=${encodeURIComponent(server)}&root=${encodeURIComponent(root)}`);
  const q: string[] = [];
  const asking: ((r: LspStat | null) => void)[] = [];
  let closed = false;
  ws.onopen = () => { for (const m of q.splice(0)) ws.send(JSON.stringify({ k: "msg", m })); };
  ws.onmessage = (e) => {
    try {
      const ev = JSON.parse(String(e.data)) as LspEvent;
      if (ev.k === "stat") asking.shift()?.(ev.mem === null ? null : { cpu: ev.cpu, mem: ev.mem });
      else on(ev);
    } catch { /* 壊れたイベントは捨てる */ }
  };
  ws.onerror = () => { if (!closed) { closed = true; on({ k: "fail", err: "接続できません" }); } };
  ws.onclose = () => { if (!closed) { closed = true; on({ k: "exit", code: null }); } };
  return {
    send: (m) => { if (ws.readyState === 1) ws.send(JSON.stringify({ k: "msg", m })); else if (ws.readyState === 0) q.push(m); },
    stop: () => {
      closed = true;
      try { if (ws.readyState === 1) ws.send(JSON.stringify({ k: "stop" })); ws.close(); } catch { /* 閉じ済み */ }
      for (const f of asking.splice(0)) f(null);
    },
    stats: () => new Promise<LspStat | null>((res) => {
      if (closed || ws.readyState !== 1) return res(null);
      const done = (r: LspStat | null) => { clearTimeout(t); res(r); };
      const t = setTimeout(() => { const i = asking.indexOf(done); if (i >= 0) asking.splice(i, 1); res(null); }, 3000);
      asking.push(done);
      ws.send(JSON.stringify({ k: "stats" }));
    }),
  };
}

// server は servers.json の id。取得元やコマンドは向こう(Rust・開発サーバー)が持っていて、こちらからは渡さない
export const openTransport = (kind: LspKind, server: string, root: string, on: (e: LspEvent) => void): Transport => (IS_TAURI ? viaTauri(kind, server, root, on) : viaSocket(server, root, on));
