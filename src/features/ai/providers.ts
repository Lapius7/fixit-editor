// プロバイダーへの送信。ストリームで本文を受け取り、失敗は AiError(種類つき)にそろえる。
// 画面に出す文言はここに置かず、呼び出し側が kind から選ぶ(多言語のため)。
import Anthropic from "@anthropic-ai/sdk";
import { AI_DEFAULT_MODEL, AI_MAX_TOKENS, AI_TOOL_ROUNDS } from "@/shared/config";
import { EXEC_TOOL, TOOLS, addToolDelta, doneCalls, newToolAcc, type ToolCall, type ToolDelta } from "@/features/ai/tools";
import { IS_TAURI } from "@/shared/chrome";
import { getAi, type Effort, type Link, type Provider } from "@/features/ai/store";
import { refreshCopilotUsage } from "@/features/ai/copilotUsage";
import { glow } from "@/shared/glow";
import { copilotFetch, copilotSession, forgetCopilot } from "@/features/ai/copilot";
import { recordLimit, recordUsage, type Tok } from "@/features/ai/usage";

// 画像は base64(data: の前置きなし)。type は AI_IMAGE_TYPES のどれか
export type Img = { type: string; data: string };
export type Msg = { role: "user" | "assistant"; content: string; images?: Img[] };
export type AiErrorKind = "auth" | "denied" | "rate" | "network" | "model" | "bad" | "nocli" | "login" | "relogin" | "nosub" | "nobase" | "other";
export class AiError extends Error {
  constructor(public kind: AiErrorKind, public status?: number) { super(kind); }
}
export type Stop = "end" | "refusal" | "length";
export type Req = { provider: Provider; model: string; effort: Effort; key: string; system: string; messages: Msg[]; signal: AbortSignal; onText: (s: string) => void; onUsage?: (t: Partial<Tok>) => void;
  // ファイルの道具。onTool があるときだけ、AI に道具を渡す。結果(文字)を返すまで、次の往復は始まらない(変更の許可待ちもここで待つ)
  onTool?: (c: ToolCall) => Promise<string>;
  // コマンドを動かす道具(run_command)も渡すか
  exec?: boolean;
  // 接続先が道具に対応していなかったとき(道具なしで送り直す前に)知らせる
  onNoTools?: () => void;
};

type Ev = { type: string; delta?: unknown };
async function pump(events: AsyncIterable<Ev>, onText: (s: string) => void) {
  for await (const e of events) {
    if (e.type !== "content_block_delta") continue;
    const d = e.delta as { type?: string; text?: string } | undefined;
    if (d?.type === "text_delta" && d.text) onText(d.text);
  }
}

// 各社の形に組み直す。images をそのまま渡すと未知のキーとして断られるため
const forAnthropic = (ms: Msg[]) => ms.map((m) => ({
  role: m.role,
  content: m.images?.length
    ? [...m.images.map((i) => ({ type: "image" as const, source: { type: "base64" as const, media_type: i.type as "image/png", data: i.data } })), { type: "text" as const, text: m.content }]
    : m.content,
}));
const forOpenAi = (ms: Msg[]) => ms.map((m) => ({
  role: m.role,
  content: m.images?.length ? [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.type};base64,${i.data}` } }))] : m.content,
}));

// 使った量を、プロバイダー全体の合計と、この会話(onUsage)の両方へ渡す
const used = (r: Req, t: Partial<Tok>) => { recordUsage(r.provider, t); r.onUsage?.(t); };


// 道具の往復で、前の往復に本文があったときは、次の本文の前に段落の区切りを入れる
const spaced = (r: Req) => {
  let had = false, now = false;
  return { text: (t: string) => { if (had) { r.onText("\n\n"); had = false; } now = true; r.onText(t); }, end: () => { if (now) had = true; now = false; } };
};
const aborted = () => new DOMException("aborted", "AbortError");

const anthropicUsage = (r: Req, u: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } | undefined) =>
  u && used(r, { i: u.input_tokens ?? 0, o: u.output_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0 });

type Fin = { content: { type: string; id?: string; name?: string; input?: unknown }[]; stop_reason: string | null; usage?: Parameters<typeof anthropicUsage>[1] };

async function anthropic(r: Req): Promise<Stop> {
  // ブラウザ(Tauri の WebView を含む)から直接呼ぶので dangerouslyAllowBrowser が要る。キーはこの PC の中にしかない。
  const client = new Anthropic({ apiKey: r.key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const tools = r.onTool ? (r.exec ? [...TOOLS, EXEC_TOOL] : TOOLS).map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) : undefined;
  const msgs: unknown[] = forAnthropic(r.messages);
  const sp = spaced(r);
  const once = async (last: boolean): Promise<Fin> => {
    const body = { model: r.model, max_tokens: AI_MAX_TOKENS, system: r.system, messages: msgs, ...(r.effort ? { output_config: { effort: r.effort } } : {}), ...(tools ? { tools, ...(last ? { tool_choice: { type: "none" } } : {}) } : {}) };
    // 既定モデルでは、断られたときにサーバー側で次のモデルへ切り替える設定(fallbacks)を付ける
    const s = r.model === AI_DEFAULT_MODEL.anthropic
      ? client.beta.messages.stream({ ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never, { signal: r.signal })
      : client.messages.stream(body as never, { signal: r.signal });
    await pump(s as unknown as AsyncIterable<Ev>, sp.text);
    const m = (await s.finalMessage()) as unknown as Fin;
    anthropicUsage(r, m.usage);
    sp.end();
    return m;
  };
  try {
    for (let round = 0; ; round++) {
      const m = await once(round >= AI_TOOL_ROUNDS);
      const uses = m.content.filter((b) => b.type === "tool_use");
      if (!r.onTool || m.stop_reason !== "tool_use" || !uses.length) return m.stop_reason === "refusal" ? "refusal" : m.stop_reason === "max_tokens" ? "length" : "end";
      // 考える過程のブロックも含め、返ってきた中身をそのまま次の発言として送り返す(欠けると断られる)
      msgs.push({ role: "assistant", content: m.content });
      const results: unknown[] = [];
      for (const u of uses) {
        if (r.signal.aborted) throw aborted();
        const out = await r.onTool({ id: u.id ?? "", name: u.name ?? "", args: u.input });
        results.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      if (r.signal.aborted) throw aborted();
      msgs.push({ role: "user", content: results });
    }
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

// OpenAI 互換の chat/completions(OpenAI と GitHub Copilot で共通)。url と認証・追加のヘッダーだけが違う
async function chatCompletions(r: Req, url: string, headers: Record<string, string>, usage: boolean, send: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<Stop> {
  const msgs: unknown[] = [{ role: "system", content: r.system }, ...forOpenAi(r.messages)];
  const sp = spaced(r);
  let tools = r.onTool ? (r.exec ? [...TOOLS, EXEC_TOOL] : TOOLS).map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.schema } })) : undefined;
  const post = async (withTools: boolean) => {
    let res: Response;
    try {
      res = await send(url, {
        method: "POST",
        signal: r.signal,
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ model: r.model, stream: true, ...(usage ? { stream_options: { include_usage: true } } : {}), ...(withTools && tools ? { tools } : {}), messages: msgs }),
      });
    } catch (e) {
      if (r.signal.aborted) throw e;
      throw new AiError("network");
    }
    return res;
  };
  for (let round = 0; ; round++) {
    const last = round >= AI_TOOL_ROUNDS;
    let res = await post(!last);
    // 道具に対応していない接続先(自分で決めた接続先など)は 400 で断ることがある。道具なしで 1 回だけ送り直す
    if (res.status === 400 && tools && round === 0) { tools = undefined; r.onNoTools?.(); res = await post(false); }
    if (!res.ok) {
      const k: AiErrorKind = res.status === 401 ? "auth" : res.status === 403 ? "denied" : res.status === 429 ? "rate" : res.status === 404 ? "model" : res.status === 400 ? "bad" : "other";
      throw new AiError(k, res.status);
    }
    if (!res.body) throw new AiError("other");
    const reader = res.body.getReader(), dec = new TextDecoder(), acc = newToolAcc();
    let buf = "", stop: Stop = "end", finish: string | null = null, said = "";
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
          let j: { choices?: { delta?: { content?: string; refusal?: string; tool_calls?: ToolDelta[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } | null };
          try { j = JSON.parse(data); } catch { continue; }
          if (j.usage) { const cached = j.usage.prompt_tokens_details?.cached_tokens ?? 0; used(r, { i: Math.max((j.usage.prompt_tokens ?? 0) - cached, 0), o: j.usage.completion_tokens ?? 0, cr: cached }); }
          const c = j.choices?.[0];
          if (c?.delta?.content) { said += c.delta.content; sp.text(c.delta.content); }
          if (c?.delta?.refusal) stop = "refusal";
          if (Array.isArray(c?.delta?.tool_calls)) for (const d of c.delta.tool_calls) addToolDelta(acc, d);
          if (c?.finish_reason) finish = c.finish_reason;
          if (c?.finish_reason === "length") stop = "length";
          if (c?.finish_reason === "content_filter") stop = "refusal";
        }
      }
    } catch (e) {
      if (r.signal.aborted) throw e;
      throw new AiError("network");
    }
    sp.end();
    const calls = r.onTool && !last ? doneCalls(acc) : [];
    // 道具の呼び出しがなければ、これで終わり。(finish_reason が tool_calls でないのに呼び出しが来た接続先もあるので、呼び出しの有無で見る)
    if (!calls.length) return stop;
    msgs.push({ role: "assistant", content: said || null, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })) });
    for (const c of calls) {
      if (r.signal.aborted) throw aborted();
      // 引数の JSON が壊れていたら、道具は動かさず、AI にそう伝えて直させる
      const out = c.args === undefined ? "The arguments were not valid JSON. Call the tool again with a valid JSON object." : await r.onTool!({ id: c.id, name: c.name, args: c.args });
      msgs.push({ role: "tool", tool_call_id: c.id, content: out });
    }
    if (r.signal.aborted) throw aborted();
    void finish;
  }
}

const openai = (r: Req) => chatCompletions(r, "https://api.openai.com/v1/chat/completions", { Authorization: `Bearer ${r.key}` }, true);

// Google Gemini。OpenAI 互換の窓口を、ブラウザ(webview)から直接呼ぶ
const gemini = (r: Req) => chatCompletions(r, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", { Authorization: `Bearer ${r.key}` }, true);

// 自分で決めた OpenAI 互換の接続先。キーは任意(Ollama など)。厳しいサーバーが断らないよう、使用量の要求(stream_options)は付けない
const custom = (r: Req) => {
  const base = getAi().base;
  if (!base) throw new AiError("nobase");
  return chatCompletions(r, `${base}/chat/completions`, r.key ? { Authorization: `Bearer ${r.key}` } : {}, false);
};

// GitHub Copilot。ログインで得たトークンを、短い期限のトークンに替えてから送る。エディタ用の拡張が送るのと同じ形のヘッダーを付ける
async function copilot(r: Req): Promise<Stop> {
  let s = await copilotSession(r.key);
  // api.githubcopilot.com は CORS を通さないので、送信は中継(exe は Rust、開発サーバーは /__copilot/chat)に任せる。ヘッダーは中継側が固定で付ける
  const go = () => chatCompletions(r, `${s.api}/chat/completions`, {}, true, (url, init) => copilotFetch(url, s.token, String(init.body), r.signal));
  try { return await go(); } catch (e) {
    // 期限のトークンが切れていたときだけ、取り直して 1 回やり直す
    if (e instanceof AiError && e.status === 401) {
      forgetCopilot();
      s = await copilotSession(r.key);
      try { return await go(); } catch (e2) { throw e2 instanceof AiError && e2.kind === "auth" ? new AiError("relogin", 401) : e2; }
    }
    throw e;
  }
}

// どの claude を使うか。"auto" は Windows を先に探して WSL に回る。Rust 側(claude.rs の pick)には、指定したときだけ渡す
const claudeWhere = (): string | null => { const w = getAi().where; return w === "windows" || w === "wsl" ? w : null; };

// exe(Tauri)では、Rust 側(claude_chat)が同じ claude コマンドを動かし、返事をチャンネルで受け取る
async function claudeCliTauri(r: Req): Promise<Stop> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  type Ev = { t: "text"; s: string } | { t: "done"; stop: Stop } | { t: "err"; kind: AiErrorKind } | { t: "usage"; i: number; o: number; cr: number; cw: number } | { t: "limit"; id: string; u: number; r: number };
  let stop: Stop = "end", fail: AiError | null = null;
  const ch = new Channel<Ev>();
  ch.onmessage = (e) => {
    if (e.t === "text") r.onText(e.s);
    else if (e.t === "done") stop = e.stop;
    else if (e.t === "usage") used(r, e);
    else if (e.t === "limit") recordLimit("claude-cli", e.id, e.u, e.r);
    else if (e.t === "err") fail = new AiError(e.kind === "nocli" || e.kind === "login" || e.kind === "rate" || e.kind === "model" ? e.kind : "other");
  };
  const id = crypto.randomUUID();
  const cancel = () => { void invoke("claude_cancel", { id }); };
  r.signal.addEventListener("abort", cancel, { once: true });
  try {
    await invoke("claude_chat", { id, system: r.system, model: r.model, effort: r.effort, wh: claudeWhere(), messages: r.messages, onEvent: ch });
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
    let j: { t?: string; s?: string; stop?: Stop; kind?: AiErrorKind; id?: string; u?: number; r?: number; i?: number; o?: number; cr?: number; cw?: number };
    try { j = JSON.parse(line); } catch { return; }
    if (j.t === "text" && j.s) r.onText(j.s);
    else if (j.t === "done" && j.stop) stop = j.stop;
    else if (j.t === "usage") used(r, j);
    else if (j.t === "limit" && j.id && typeof j.u === "number") recordLimit("claude-cli", j.id, j.u, j.r ?? 0);
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

// 回答を作っている間は、窓の縁を光らせる(設定の「アニメーション」で切れる)
export const streamChat = (r: Req): Promise<Stop> => {
  const off = glow();
  const run = (r.provider === "anthropic" ? anthropic(r) : r.provider === "claude-cli" ? claudeCli(r) : r.provider === "copilot" ? copilot(r) : r.provider === "gemini" ? gemini(r) : r.provider === "custom" ? custom(r) : openai(r));
  // Copilot は、返答が終わるたびに残り枠を取り直す(GitHub 側の反映が遅れることがあるため、少し置いてから)
  return run.finally(() => { off(); if (r.provider === "copilot") setTimeout(() => void refreshCopilotUsage(r.key), 3000); });
};
export const isAbort = (e: unknown, signal: AbortSignal) => signal.aborted || e instanceof Anthropic.APIUserAbortError || (e as { name?: string })?.name === "AbortError";

// claude コマンドの接続状態を確かめる。ログインの中身(メール・トークン)は受け取らない。状態の語だけが返る
export async function claudeStatus(): Promise<Exclude<Link, "checking">> {
  const ok = (v: unknown): v is "ready" | "login" | "nocli" | "unknown" => v === "ready" || v === "login" || v === "nocli" || v === "unknown";
  try {
    if (IS_TAURI) {
      const { invoke } = await import("@tauri-apps/api/core");
      const v = await invoke<string>("claude_status", { wh: claudeWhere() });
      return ok(v) ? v : "unknown";
    }
    const res = await fetch("/__claude/status", { headers: { "X-Fixit": "1" } });
    if (!res.ok) return "unknown";
    const v = ((await res.json()) as { state?: unknown }).state;
    return ok(v) ? v : "unknown";
  } catch { return "unknown"; }
}

// 5 時間/週間の使用率を、会話なしで取る。{ id: { u: 0〜1, r: リセット時刻(ISO) } } か、取れなければ null
export async function claudeUsage(): Promise<Record<string, { u: number; r: string }> | null> {
  try {
    let v: { limits?: Record<string, { u: number; r: string }> };
    if (IS_TAURI) {
      const { invoke } = await import("@tauri-apps/api/core");
      v = await invoke("claude_usage", { wh: claudeWhere() });
    } else {
      const res = await fetch("/__claude/usage", { headers: { "X-Fixit": "1" } });
      if (!res.ok) return null;
      v = await res.json();
    }
    return v.limits && typeof v.limits === "object" ? v.limits : null;
  } catch { return null; }
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
    try { await invoke("claude_login", { id, wh: claudeWhere(), onEvent: ch }); } catch { return false; } finally { signal.removeEventListener("abort", cancel); }
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
