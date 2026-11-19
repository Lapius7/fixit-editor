import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ServerResponse } from "node:http";
import { AI_CLI_MAX_SESSIONS, AI_SESSION_IDLE_MS } from "../src/shared/config";

// Claude のサブスクリプション用の「会話ごとに 1 つ動かし続ける claude」(開発サーバー専用。Rust 版は src-tauri/fixit-core/src/claude.rs の Session)。
// VS Code の拡張と同じく、claude を stream-json の双方向で起動したままにして、発言を 1 つずつ流し込む。
// ファイル操作などの道具は、claude から見える MCP サーバー(type: sdk)としてこちらが受け持つ: claude が道具を呼ぶと、
// 制御メッセージ(control_request)が標準出力に出る → 画面へ {t:"tool"} で渡す → 画面が結果を /tool に返す → claude へ返す。
const BIN = process.env.FIXIT_CLAUDE_BIN || "claude";
const SERVER = "fixit";

export type Img = { type: string; data: string };
export type Msg = { role: "user" | "assistant"; content: string; images?: Img[] };
export type ToolSpec = { name: string; description: string; schema: unknown };
export type Open = { sid: string; system: string; model: string; effort: string; messages: Msg[]; resume: number; tools: ToolSpec[] };

type Turn = { res: ServerResponse; stop: "end" | "length" | "refusal"; sent: boolean; n: number };
type Sess = {
  sid: string; p: ChildProcess; sig: string; cwd: string; tools: ToolSpec[];
  turn: Turn | null; known: number; used: number; err: string; buf: string; dead: boolean;
  pending: Map<string, string>; // 画面に渡した道具の呼び出し(cid → claude の request_id)
};
const sessions = new Map<string, Sess>();

const line = (res: ServerResponse, v: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(v) + "\n"); };
const cleanEnv = () => { const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; return env; };
const write = (s: Sess, o: unknown) => { if (!s.dead && s.p.stdin?.writable) s.p.stdin.write(JSON.stringify(o) + "\n"); };

// 履歴を台本の形にして送る(新しく起動したとき、または続きの発言が複数のとき)
const transcript = (m: Msg[]) => (m.length === 1 ? m[0].content : m.map((x) => `<${x.role}>\n${x.content}\n</${x.role}>`).join("\n\n") + "\n\n上の会話の最後の <user> に答えてください。");
const userLine = (m: Msg[]) => {
  const imgs = m.flatMap((x) => x.images ?? []);
  const content = imgs.length ? [...imgs.map((i) => ({ type: "image", source: { type: "base64", media_type: i.type, data: i.data } })), { type: "text", text: transcript(m) }] : transcript(m);
  return { type: "user", message: { role: "user", content } };
};

const classify = (err: string) => (/not logged in|\/login|log in|authenticat|credential|401|oauth/i.test(err) ? "login" : /rate|limit|usage|quota|429|overloaded/i.test(err) ? "rate" : /model/i.test(err) ? "model" : "other");

export function closeSession(sid: string) {
  const s = sessions.get(sid);
  if (s) dispose(s);
}
export function closeAll() { for (const s of [...sessions.values()]) dispose(s); }
function dispose(s: Sess) {
  if (s.dead) return;
  s.dead = true; sessions.delete(s.sid);
  try { s.p.kill("SIGKILL"); } catch { /* 先に終わっていた */ }
  try { rmSync(s.cwd, { recursive: true, force: true }); } catch { /* 一時フォルダは OS が消す */ }
}

// 使われていない会話は閉じる。同時に持つ数にも上限を置く(古いものから閉じる)
const reaper = setInterval(() => { const now = Date.now(); for (const s of [...sessions.values()]) if (!s.turn && now - s.used > AI_SESSION_IDLE_MS) dispose(s); }, 30_000);
reaper.unref();

const endTurn = (s: Sess, v: unknown) => {
  const t = s.turn; if (!t) return;
  s.turn = null; s.used = Date.now();
  line(t.res, v); t.res.end();
};

function handleEvent(s: Sess, e: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const t = s.turn;
  if (e.type === "system" && e.subtype === "init") {
    const m = Array.isArray(e.mcp_servers) ? e.mcp_servers.find((x: { name?: string }) => x?.name === SERVER) : null;
    if (s.tools.length && m?.status !== "connected" && t) { endTurn(s, { t: "err", kind: "other" }); dispose(s); }
    return;
  }
  if (e.type === "control_request" && e.request?.subtype === "mcp_message") return mcp(s, e.request_id, e.request.message);
  if (!t) return;
  if (e.type === "stream_event") {
    const ev = e.event;
    if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) { t.sent = true; line(t.res, { t: "text", s: ev.delta.text }); }
    else if (ev?.type === "message_delta") { const r = ev.delta?.stop_reason; if (r === "max_tokens") t.stop = "length"; else if (r === "refusal") t.stop = "refusal"; }
  } else if (e.type === "rate_limit_event") {
    // 5 時間・週間の使用率。claude が返すものをそのまま画面へ渡す(src-tauri/fixit-core/src/claude.rs と同じ形)
    const info = e.rate_limit_info;
    const ws = info?.unifiedWindows && typeof info.unifiedWindows === "object" ? Object.entries(info.unifiedWindows) : info?.rateLimitType ? [[info.rateLimitType, info]] : [];
    for (const [id, v] of ws as [string, { utilization?: number; resetsAt?: number }][]) if (typeof v?.utilization === "number") line(t.res, { t: "limit", id, u: v.utilization, r: typeof v.resetsAt === "number" ? v.resetsAt : 0 });
  } else if (e.type === "result") {
    const u = e.usage; const n = (k: string) => (typeof u?.[k] === "number" ? u[k] : 0);
    if (u && typeof u === "object") line(t.res, { t: "usage", i: n("input_tokens"), o: n("output_tokens"), cr: n("cache_read_input_tokens"), cw: n("cache_creation_input_tokens") });
    if (e.is_error && !t.sent) { const why = String(e.result ?? "") + "\n" + s.err; endTurn(s, { t: "err", kind: classify(why) }); dispose(s); return; }
    s.known = t.n + 1; // 渡した発言と、この返答が、claude の中に入った
    endTurn(s, { t: "done", stop: t.stop });
  }
}

// claude が MCP で話しかけてくる。どの要求にも必ず返事をする(返さないと止まる)
function mcp(s: Sess, requestId: string, m: { id?: number; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } }) {
  const reply = (r: unknown) => write(s, { type: "control_response", response: { subtype: "success", request_id: requestId, response: { mcp_response: r } } });
  const id = m.id;
  if (id === undefined) return reply({ jsonrpc: "2.0", result: {} }); // 通知
  const ok = (result: unknown) => reply({ jsonrpc: "2.0", id, result });
  if (m.method === "initialize") return ok({ protocolVersion: m.params?.protocolVersion ?? "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: SERVER, version: "1" } });
  if (m.method === "tools/list") return ok({ tools: s.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })) });
  if (m.method === "tools/call") {
    const name = m.params?.name ?? "";
    if (!s.turn || !s.tools.some((t) => t.name === name)) return ok({ isError: true, content: [{ type: "text", text: "This tool is not available now." }] });
    const cid = randomUUID().slice(0, 8);
    s.pending.set(cid, JSON.stringify({ requestId, id }));
    return line(s.turn.res, { t: "tool", cid, name, args: m.params?.arguments ?? {} });
  }
  if (m.method === "ping") return ok({});
  reply({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

// 画面から、道具の結果を受け取って claude に返す
export function toolResult(sid: string, cid: string, text: string, isError: boolean): boolean {
  const s = sessions.get(sid), p = s?.pending.get(cid);
  if (!s || !p) return false;
  s.pending.delete(cid);
  const { requestId, id } = JSON.parse(p) as { requestId: string; id: number };
  write(s, { type: "control_response", response: { subtype: "success", request_id: requestId, response: { mcp_response: { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) } } } } });
  return true;
}

function spawnSession(o: Open, sig: string): Sess {
  const cwd = mkdtempSync(path.join(tmpdir(), "fixit-claude-"));
  const cfg = JSON.stringify({ mcpServers: { [SERVER]: { type: "sdk", name: SERVER } } });
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", o.system];
  if (o.tools.length) args.push("--mcp-config", cfg, "--allowedTools", `mcp__${SERVER}`);
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  const p = spawn(BIN, args, { cwd, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
  const s: Sess = { sid: o.sid, p, sig, cwd, tools: o.tools, turn: null, known: 0, used: Date.now(), err: "", buf: "", dead: false, pending: new Map() };
  p.stderr!.on("data", (d: Buffer) => { if (s.err.length < 4000) s.err += d.toString(); });
  p.stdin!.on("error", () => { /* 先に終わったとき */ });
  p.stdout!.on("data", (d: Buffer) => {
    s.buf += d.toString("utf8");
    let i: number;
    while ((i = s.buf.indexOf("\n")) >= 0) {
      const l = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1);
      let e: Record<string, unknown>; try { e = JSON.parse(l); } catch { continue; }
      handleEvent(s, e);
    }
  });
  p.on("error", (e: NodeJS.ErrnoException) => { endTurn(s, { t: "err", kind: e.code === "ENOENT" ? "nocli" : "other" }); dispose(s); });
  p.on("close", (code) => {
    if (s.turn) endTurn(s, s.turn.sent && code === 0 ? { t: "done", stop: s.turn.stop } : { t: "err", kind: code === 127 ? "nocli" : classify(s.err) });
    dispose(s);
  });
  sessions.set(o.sid, s);
  return s;
}

// 1 回の発言を送り、返事と道具の呼び出しを res に流す。res が閉じられたら(止める)その会話ごと終わらせる
export function runTurn(o: Open, res: ServerResponse): void {
  const old = sessions.get(o.sid);
  const sig = JSON.stringify([o.system, o.model, o.effort, o.tools]);
  let s = old && !old.dead && !old.turn && old.sig === sig && o.resume > 0 && o.resume === old.known && o.resume < o.messages.length ? old : null;
  if (!s) {
    if (old) dispose(old);
    // 上限を超えるときは、使われていない古い会話から閉じる
    const idle = [...sessions.values()].filter((x) => !x.turn).sort((a, b) => a.used - b.used);
    while (sessions.size >= AI_CLI_MAX_SESSIONS && idle.length) dispose(idle.shift()!);
    if (sessions.size >= AI_CLI_MAX_SESSIONS) { line(res, { t: "err", kind: "rate" }); res.end(); return; }
    s = spawnSession(o, sig);
  }
  const sess = s;
  sess.turn = { res, stop: "end", sent: false, n: o.messages.length };
  sess.used = Date.now();
  res.on("close", () => { if (sess.turn?.res === res) { sess.turn = null; dispose(sess); } });
  write(sess, userLine(sess.known > 0 ? o.messages.slice(sess.known) : o.messages));
}
