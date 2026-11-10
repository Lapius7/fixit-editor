// プロバイダーへの送信。ストリームで本文を受け取り、失敗は AiError(種類つき)にそろえる。
// 画面に出す文言はここに置かず、呼び出し側が kind から選ぶ(多言語のため)。
import Anthropic from "@anthropic-ai/sdk";
import { AI_DEFAULT_MODEL, AI_MAX_TOKENS } from "@/shared/config";
import { IS_TAURI } from "@/shared/chrome";
import type { Effort, Link, Provider } from "@/features/ai/store";

export type Msg = { role: "user" | "assistant"; content: string };
export type AiErrorKind = "auth" | "denied" | "rate" | "network" | "model" | "bad" | "nocli" | "login" | "other";
export class AiError extends Error {
  constructor(public kind: AiErrorKind, public status?: number) { super(kind); }
}
export type Stop = "end" | "refusal" | "length";
export type Req = { provider: Provider; model: string; effort: Effort; key: string; system: string; messages: Msg[]; signal: AbortSignal; onText: (s: string) => void };

type Ev = { type: string; delta?: unknown };
async function pump(events: AsyncIterable<Ev>, onText: (s: string) => void) {
  for await (const e of events) {
    if (e.type !== "content_block_delta") continue;
    const d = e.delta as { type?: string; text?: string } | undefined;
    if (d?.type === "text_delta" && d.text) onText(d.text);
  }
}

async function anthropic(r: Req): Promise<Stop> {
  // ブラウザ(Tauri の WebView を含む)から直接呼ぶので dangerouslyAllowBrowser が要る。キーはこの PC の中にしかない。
  const client = new Anthropic({ apiKey: r.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const base = { model: r.model, max_tokens: AI_MAX_TOKENS, system: r.system, messages: r.messages, ...(r.effort ? { output_config: { effort: r.effort } } : {}) };
  try {
    // 既定モデルでは、断られたときにサーバー側で次のモデルへ切り替える設定(fallbacks)を付ける
    if (r.model === AI_DEFAULT_MODEL.anthropic) {
      const s = client.beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }, { signal: r.signal });
      await pump(s, r.onText);
      const m = await s.finalMessage();
      return m.stop_reason === "refusal" ? "refusal" : m.stop_reason === "max_tokens" ? "length" : "end";
    }
    const s = client.messages.stream(base, { signal: r.signal });
    await pump(s, r.onText);
    const m = await s.finalMessage();
    return m.stop_reason === "refusal" ? "refusal" : m.stop_reason === "max_tokens" ? "length" : "end";
  } catch (e) {
    if (r.signal.aborted || e instanceof Anthropic.APIUserAbortError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("auth", 401);
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("denied", 403);
    if (e instanceof Anthropic.RateLimitError) throw new AiError("rate", 429);
    if (e instanceof Anthropic.NotFoundError) throw new AiError("model", 404);
    if (e instanceof Anthropic.BadRequestError) throw new AiError("bad", 400);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError("network");
    if (e instanceof Anthropic.APIError) throw new AiError("other", e.status);
    throw e;
  }
}

async function openai(r: Req): Promise<Stop> {
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: r.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${r.key}` },
      body: JSON.stringify({ model: r.model, stream: true, messages: [{ role: "system", content: r.system }, ...r.messages] }),
    });
  } catch (e) {
    if (r.signal.aborted) throw e;
    throw new AiError("network");
  }
  if (!res.ok) {
    const k: AiErrorKind = res.status === 401 ? "auth" : res.status === 403 ? "denied" : res.status === 429 ? "rate" : res.status === 404 ? "model" : res.status === 400 ? "bad" : "other";
    throw new AiError(k, res.status);
  }
  if (!res.body) throw new AiError("other");
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", stop: Stop = "end";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let j: { choices?: { delta?: { content?: string; refusal?: string }; finish_reason?: string | null }[] };
        try { j = JSON.parse(data); } catch { continue; }
        const c = j.choices?.[0];
        if (c?.delta?.content) r.onText(c.delta.content);
        if (c?.delta?.refusal) stop = "refusal";
        if (c?.finish_reason === "length") stop = "length";
        if (c?.finish_reason === "content_filter") stop = "refusal";
      }
    }
  } catch (e) {
    if (r.signal.aborted) throw e;
    throw new AiError("network");
  }
  return stop;
}

// exe(Tauri)では、Rust 側(claude_chat)が同じ claude コマンドを動かし、返事をチャンネルで受け取る
async function claudeCliTauri(r: Req): Promise<Stop> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  type Ev = { t: "text"; s: string } | { t: "done"; stop: Stop } | { t: "err"; kind: AiErrorKind };
  let stop: Stop = "end", fail: AiError | null = null;
  const ch = new Channel<Ev>();
  ch.onmessage = (e) => {
    if (e.t === "text") r.onText(e.s);
    else if (e.t === "done") stop = e.stop;
    else if (e.t === "err") fail = new AiError(e.kind === "nocli" || e.kind === "login" || e.kind === "rate" || e.kind === "model" ? e.kind : "other");
  };
  const id = crypto.randomUUID();
  const cancel = () => { void invoke("claude_cancel", { id }); };
  r.signal.addEventListener("abort", cancel, { once: true });
  try {
    await invoke("claude_chat", { id, system: r.system, model: r.model, effort: r.effort, messages: r.messages, onEvent: ch });
  } catch {
    if (r.signal.aborted) throw new DOMException("aborted", "AbortError");
    throw new AiError("other");
  } finally {
    r.signal.removeEventListener("abort", cancel);
  }
  if (r.signal.aborted) throw new DOMException("aborted", "AbortError");
  if (fail) throw fail;
  return stop;
}

// この PC の claude コマンド(Claude のサブスクリプションのログイン)を、dev サーバー経由で呼ぶ。トークンには触れない
async function claudeCli(r: Req): Promise<Stop> {
  if (IS_TAURI) return claudeCliTauri(r);
  let res: Response;
  try {
    res = await fetch("/__claude", {
      method: "POST",
      signal: r.signal,
      headers: { "content-type": "application/json", "X-Fixit": "1" },
      body: JSON.stringify({ system: r.system, model: r.model, effort: r.effort, messages: r.messages }),
    });
  } catch (e) {
    if (r.signal.aborted) throw e;
    throw new AiError("network");
  }
  if (!res.ok || !res.body) throw new AiError(res.status === 404 ? "nocli" : res.status === 429 ? "rate" : res.status === 403 ? "denied" : "other", res.status);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", stop: Stop = "end";
  const handle = (line: string) => {
    if (!line.trim()) return;
    let j: { t?: string; s?: string; stop?: Stop; kind?: AiErrorKind };
    try { j = JSON.parse(line); } catch { return; }
    if (j.t === "text" && j.s) r.onText(j.s);
    else if (j.t === "done" && j.stop) stop = j.stop;
    else if (j.t === "err") throw new AiError(j.kind === "nocli" || j.kind === "login" || j.kind === "rate" || j.kind === "model" ? j.kind : "other");
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    handle(buf);
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (r.signal.aborted) throw e;
    throw new AiError("network");
  }
  return stop;
}

export const streamChat = (r: Req): Promise<Stop> => (r.provider === "anthropic" ? anthropic(r) : r.provider === "claude-cli" ? claudeCli(r) : openai(r));
export const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || e instanceof Anthropic.APIUserAbortError || (e as { name?: string })?.name === "AbortError";

// claude コマンドの接続状態を確かめる。ログインの中身(メール・トークン)は受け取らない。状態の語だけが返る
export async function claudeStatus(): Promise<Exclude<Link, "checking">> {
  const ok = (v: unknown): v is "ready" | "login" | "nocli" | "unknown" => v === "ready" || v === "login" || v === "nocli" || v === "unknown";
  try {
    if (IS_TAURI) {
      const { invoke } = await import("@tauri-apps/api/core");
      const v = await invoke<string>("claude_status");
      return ok(v) ? v : "unknown";
    }
    const res = await fetch("/__claude/status", { headers: { "X-Fixit": "1" } });
    if (!res.ok) return "unknown";
    const v = ((await res.json()) as { state?: unknown }).state;
    return ok(v) ? v : "unknown";
  } catch { return "unknown"; }
}

// ログイン(claude auth login)を、利用者がボタンを押したときだけ動かす。ブラウザでの認証が終わると true。
// ブラウザが開かないときのために、ログイン画面の URL が出たら onUrl で知らせる
export async function claudeLogin(onUrl: (u: string) => void, signal: AbortSignal): Promise<boolean> {
  type Ev = { t: "url"; s: string } | { t: "done" } | { t: "err"; kind: string };
  const handle = (e: Ev) => { if (e.t === "url" && typeof e.s === "string" && e.s.startsWith("https://")) onUrl(e.s); return e.t === "done"; };
  if (IS_TAURI) {
    const { Channel, invoke } = await import("@tauri-apps/api/core");
    const ch = new Channel<Ev>();
    let ok = false;
    ch.onmessage = (e) => { if (handle(e)) ok = true; };
    const id = crypto.randomUUID();
    const cancel = () => { void invoke("claude_cancel", { id }); };
    signal.addEventListener("abort", cancel, { once: true });
    try { await invoke("claude_login", { id, onEvent: ch }); } catch { return false; } finally { signal.removeEventListener("abort", cancel); }
    return ok && !signal.aborted;
  }
  try {
    const res = await fetch("/__claude/login", { method: "POST", signal, headers: { "X-Fixit": "1" } });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", ok = false;
    const line = (l: string) => { if (!l.trim()) return; try { if (handle(JSON.parse(l))) ok = true; } catch { /* 読めない行は捨てる */ } };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const ls = buf.split("\n");
      buf = ls.pop() ?? "";
      ls.forEach(line);
    }
    line(buf);
    return ok;
  } catch { return false; }
}
