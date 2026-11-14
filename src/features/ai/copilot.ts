// GitHub Copilot の接続。ログイン(デバイスフロー)と、会話に使う短い期限のトークンへの交換。
// github.com と api.github.com(交換)、会話(api.githubcopilot.com)はブラウザから直接呼べない(CORS)ので、exe は Rust(copilot_*)、開発サーバーは /__copilot が代わりに送る。
import { IS_TAURI } from "@/shared/chrome";
import { AiError } from "@/features/ai/providers";

export type Device = { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
export type Poll = { status: "pending" | "slow" | "denied" | "expired" | "ok" | "other"; token?: string };
export type Session = { token: string; expires_at: number; api: string };

const call = async <T>(cmd: "device" | "poll" | "token", args: Record<string, string>): Promise<T> => {
  if (IS_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Tauri は引数名を camelCase で受け取る(Rust 側の device_code は deviceCode)
    return invoke<T>(`copilot_${cmd}`, cmd === "poll" ? { deviceCode: args.device_code } : args);
  }
  const res = await fetch(`/__copilot/${cmd}`, { method: "POST", headers: { "X-Fixit": "1", "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!res.ok) throw new Error("network");
  return (await res.json()) as T;
};

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((ok, ng) => {
  const t = setTimeout(ok, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); ng(new DOMException("aborted", "AbortError")); }, { once: true });
});

export type LoginResult = { ok: true; token: string } | { ok: false; why: "denied" | "expired" | "network" | "cancel" };

// デバイスフローの待ち合わせ(Copilot と GitHub 管理で共通)。コードと URL を onCode で知らせ、利用者が GitHub で承認するまで待つ
export async function deviceLogin(start: () => Promise<Device & { error?: string }>, poll: (deviceCode: string) => Promise<Poll>, onCode: (d: Device) => void, signal: AbortSignal): Promise<LoginResult> {
  let d: Device;
  try {
    const r = await start();
    if (r.error || !r.device_code) return { ok: false, why: "network" };
    d = r;
  } catch { return { ok: false, why: "network" }; }
  onCode(d);
  const end = Date.now() + d.expires_in * 1000;
  let every = d.interval * 1000;
  let bad = 0;
  try {
    while (Date.now() < end) {
      await wait(every, signal);
      let p: Poll;
      try { p = await poll(d.device_code); bad = 0; } catch { if (++bad >= 3) return { ok: false, why: "network" }; continue; }
      if (p.status === "ok" && p.token) return { ok: true, token: p.token };
      if (p.status === "slow") every += 5000;
      else if (p.status === "denied") return { ok: false, why: "denied" };
      else if (p.status === "expired") return { ok: false, why: "expired" };
      else if (p.status === "other" && ++bad >= 3) return { ok: false, why: "network" };
    }
  } catch { return { ok: false, why: "cancel" }; }
  return { ok: false, why: "expired" };
}

// Copilot のログインを始める(押されたときだけ動かす)
export const copilotLogin = (onCode: (d: Device) => void, signal: AbortSignal) =>
  deviceLogin(() => call<Device & { error?: string }>("device", {}), (c) => call<Poll>("poll", { device_code: c }), onCode, signal);

// GitHub 管理用のログイン(自分の OAuth App)。client_id と scope は画面側の設定から渡す
export const githubLogin = (clientId: string, scope: string, onCode: (d: Device) => void, signal: AbortSignal) => {
  const run = async <T,>(cmd: "device" | "poll", args: Record<string, string>): Promise<T> => {
    if (IS_TAURI) {
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<T>(`gh_${cmd}`, cmd === "poll" ? { clientId, deviceCode: args.device_code } : { clientId, scope });
    }
    const res = await fetch(`/__copilot/gh-${cmd}`, { method: "POST", headers: { "X-Fixit": "1", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, ...args }) });
    if (!res.ok) throw new Error("network");
    return (await res.json()) as T;
  };
  return deviceLogin(() => run<Device & { error?: string }>("device", { scope }), (c) => run<Poll>("poll", { device_code: c }), onCode, signal);
};

// 会話用のトークン。期限の 1 分前まで使い回す(期限は 30 分ほど)
let cache: { oauth: string; s: Session } | null = null;
export async function copilotSession(oauth: string): Promise<Session> {
  if (cache && cache.oauth === oauth && cache.s.expires_at * 1000 - 60_000 > Date.now()) return cache.s;
  let r: Partial<Session> & { error?: string };
  try { r = await call<Partial<Session> & { error?: string }>("token", { oauth }); } catch { throw new AiError("network"); }
  if (r.error === "login") throw new AiError("relogin", 401);
  if (r.error === "nosub") throw new AiError("nosub", 403);
  if (!r.token || !r.api) throw new AiError("other");
  cache = { oauth, s: { token: r.token, expires_at: r.expires_at ?? 0, api: r.api } };
  return cache.s;
}
export const forgetCopilot = () => { cache = null; };

// 会話の送信。api.githubcopilot.com は CORS を通さないので、exe は Rust(copilot_chat)、開発サーバーは /__copilot/chat が代わりに送る。
// 返すのは fetch の Response と同じ形(本文は逐次流れる)。ヘッダーは中継側が固定で付ける。
export async function copilotFetch(url: string, token: string, body: string, signal: AbortSignal): Promise<Response> {
  if (!IS_TAURI) {
    return fetch("/__copilot/chat", { method: "POST", signal, headers: { "X-Fixit": "1", "Content-Type": "application/json" }, body: JSON.stringify({ url, token, body }) });
  }
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  type Ev = { t: "head"; status: number } | { t: "data"; s: string } | { t: "end" } | { t: "err" };
  const id = crypto.randomUUID(), enc = new TextEncoder();
  return new Promise<Response>((ok, ng) => {
    let ctl: ReadableStreamDefaultController<Uint8Array> | null = null, got = false, over = false;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => { ctl = c; }, cancel: () => stop() });
    const stop = () => { if (!over) { over = true; void invoke("claude_cancel", { id }); } };
    signal.addEventListener("abort", () => { stop(); if (!got) ng(new DOMException("aborted", "AbortError")); else { try { ctl?.error(new DOMException("aborted", "AbortError")); } catch { /* 閉じ済み */ } } }, { once: true });
    const ch = new Channel<Ev>();
    ch.onmessage = (e) => {
      if (e.t === "head") { got = true; ok(new Response(stream, { status: e.status })); }
      else if (e.t === "data") { try { ctl?.enqueue(enc.encode(e.s)); } catch { /* 閉じ済み */ } }
      else if (e.t === "end") { over = true; try { ctl?.close(); } catch { /* 閉じ済み */ } }
      else if (e.t === "err") { over = true; if (!got) ng(new Error("network")); else { try { ctl?.error(new Error("network")); } catch { /* 閉じ済み */ } } }
    };
    invoke("copilot_chat", { id, url, token, body, onEvent: ch }).catch(() => { if (!got) ng(new Error("network")); });
  });
}
