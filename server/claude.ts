import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { body, check } from "./fsapi";

// Claude のサブスクリプション(claude.ai のログイン)で AI を使うための橋渡し(開発サーバー専用)。
// この PC の公式 `claude` コマンドを、ツールなし・空のフォルダ・設定なしで 1 回だけ動かし、返事を流す。
// ログインの情報(トークン)はこのコードからは読まない。API キーの環境変数は渡さない(渡すと API の課金に切り替わるため)。
const BIN = process.env.FIXIT_CLAUDE_BIN || "claude";
const MAX_BODY = 4 * 1024 * 1024;
const TIMEOUT_MS = 5 * 60_000;
const MAX_RUNNING = 2;
const MODEL = /^[A-Za-z0-9._\-[\]]{1,64}$/;
const EFFORT = /^(low|medium|high|xhigh|max)?$/;
type Msg = { role: "user" | "assistant"; content: string };
let running = 0;

// 1 回の呼び出しに会話を渡すため、履歴を台本の形にして送る
const transcript = (m: Msg[]) => (m.length === 1 ? m[0].content : m.map((x) => `<${x.role}>\n${x.content}\n</${x.role}>`).join("\n\n") + "\n\n上の会話の最後の <user> に答えてください。");

const line = (res: ServerResponse, v: unknown) => { if (!res.writableEnded) res.write(JSON.stringify(v) + "\n"); };

const cleanEnv = () => { const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; return env; };

// 接続の状態。"ready" / "login" / "nocli" / "unknown"。`claude auth status --json` の loggedIn だけを見る(メールやトークンは読まない・返さない)
function status(): Promise<string> {
  return new Promise((resolve) => {
    let out = "", done = false;
    const end = (v: string) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const p = spawn(BIN, ["auth", "status", "--json"], { env: cleanEnv(), stdio: ["ignore", "pipe", "ignore"] });
    const t = setTimeout(() => { p.kill("SIGKILL"); end("unknown"); }, 20_000);
    p.stdout.on("data", (d: Buffer) => { if (out.length < 65536) out += d.toString("utf8"); });
    p.on("error", (e: NodeJS.ErrnoException) => end(e.code === "ENOENT" ? "nocli" : "unknown"));
    p.on("close", () => { try { const v = JSON.parse(out)?.loggedIn; end(v === true ? "ready" : v === false ? "login" : "unknown"); } catch { end("unknown"); } });
  });
}

// 出力の 1 行から、claude.ai などのログイン用 URL を取り出す
const loginUrl = (l: string) => {
  const m = /https:\/\/[^\s"\\]+/.exec(l);
  if (!m || m[0].length > 4096) return null;
  try { const h = new URL(m[0]).hostname; return ["claude.ai", "claude.com", "anthropic.com"].some((d) => h === d || h.endsWith("." + d)) ? m[0] : null; } catch { return null; }
};

export function claudeBridge(): Plugin {
  return {
    name: "fixit-claude",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__claude", async (req, res) => {
        try {
          check(req);
          if ((req.url ?? "").split("?")[0] === "/status") {
            if (req.method !== "GET") { res.statusCode = 405; res.end(); return; }
            res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
            res.end(JSON.stringify({ state: await status() }));
            return;
          }
          // ログイン(`claude auth login --claudeai`)。押されたときだけ動かし、ブラウザでの認証を待つ
          if ((req.url ?? "").split("?")[0] === "/login") {
            if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
            if (running >= MAX_RUNNING) { res.statusCode = 429; res.end(); return; }
            res.statusCode = 200;
            res.setHeader("content-type", "application/x-ndjson; charset=utf-8"); res.setHeader("cache-control", "no-store");
            running++;
            const p = spawn(BIN, ["auth", "login", "--claudeai"], { env: cleanEnv(), stdio: ["ignore", "pipe", "ignore"] });
            let finished = false, buf = "";
            const fin = () => { if (finished) return false; finished = true; running--; clearTimeout(timer); return true; };
            const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT_MS);
            res.on("close", () => { if (!p.killed && p.exitCode === null) p.kill("SIGKILL"); });
            p.stdout.on("data", (d: Buffer) => {
              buf += d.toString("utf8");
              let i: number;
              while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); const u = loginUrl(l); if (u) line(res, { t: "url", s: u }); }
              if (buf.length > 8192) buf = "";
            });
            p.on("error", (e: NodeJS.ErrnoException) => { if (fin()) { line(res, { t: "err", kind: e.code === "ENOENT" ? "nocli" : "other" }); res.end(); } });
            p.on("close", (code, sig) => { if (fin()) { line(res, code === 0 ? { t: "done", stop: "end" } : { t: "err", kind: sig ? "other" : "login" }); res.end(); } });
            return;
          }
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          const j = JSON.parse((await body(req, MAX_BODY)).toString("utf8")) as { system?: unknown; model?: unknown; effort?: unknown; messages?: unknown };
          const ms = Array.isArray(j.messages) ? j.messages : [];
          if (!ms.length || ms.some((m) => !m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string")) { res.statusCode = 400; res.end(); return; }
          const model = typeof j.model === "string" && j.model ? j.model : "";
          if (model && !MODEL.test(model)) { res.statusCode = 400; res.end(); return; }
          const effort = typeof j.effort === "string" ? j.effort : "";
          if (!EFFORT.test(effort)) { res.statusCode = 400; res.end(); return; }
          if (running >= MAX_RUNNING) { res.statusCode = 429; res.end(); return; }

          res.statusCode = 200;
          res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
          res.setHeader("cache-control", "no-store");
          const cwd = mkdtempSync(path.join(tmpdir(), "fixit-claude-"));
          const env = { ...process.env }; delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
          const args = ["-p", "--output-format", "stream-json", "--include-partial-messages", "--verbose", "--tools", "", "--no-session-persistence", "--setting-sources", "", "--strict-mcp-config", "--disable-slash-commands", "--system-prompt", typeof j.system === "string" ? j.system : ""];
          if (model) args.push("--model", model);
          if (effort) args.push("--effort", effort);
          running++;
          const p = spawn(BIN, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
          let err = "", buf = "", stop: "end" | "length" | "refusal" = "end", sent = false, finished = false;
          const finish = () => { if (finished) return; finished = true; running--; clearTimeout(timer); try { rmSync(cwd, { recursive: true, force: true }); } catch { /* 一時フォルダは OS が消す */ } };
          const timer = setTimeout(() => p.kill("SIGKILL"), TIMEOUT_MS);
          res.on("close", () => { if (!p.killed && p.exitCode === null) p.kill("SIGKILL"); });
          p.stderr.on("data", (d: Buffer) => { if (err.length < 4000) err += d.toString(); });
          p.stdin.on("error", () => { /* 先に終わったとき */ });
          p.stdin.end(transcript(ms as Msg[]));
          p.stdout.on("data", (d: Buffer) => {
            buf += d.toString("utf8");
            let i: number;
            while ((i = buf.indexOf("\n")) >= 0) {
              const l = buf.slice(0, i); buf = buf.slice(i + 1);
              let e: { type?: string; event?: { type?: string; delta?: { type?: string; text?: string; stop_reason?: string } }; is_error?: boolean; result?: string; subtype?: string };
              try { e = JSON.parse(l); } catch { continue; }
              if (e.type === "stream_event" && e.event?.type === "content_block_delta" && e.event.delta?.type === "text_delta" && e.event.delta.text) { sent = true; line(res, { t: "text", s: e.event.delta.text }); }
              else if (e.type === "stream_event" && e.event?.type === "message_delta") { const r = e.event.delta?.stop_reason; if (r === "max_tokens") stop = "length"; else if (r === "refusal") stop = "refusal"; }
              else if (e.type === "result" && e.is_error) err = (e.result ?? "") + "\n" + err;
            }
          });
          p.on("error", (e: NodeJS.ErrnoException) => { finish(); line(res, { t: "err", kind: e.code === "ENOENT" ? "nocli" : "other" }); res.end(); });
          p.on("close", (code) => {
            finish();
            if (code === 0 || sent) line(res, { t: "done", stop });
            else line(res, { t: "err", kind: /not logged in|\/login|log in|authenticat|credential|401|oauth/i.test(err) ? "login" : /rate|limit|usage|quota|429|overloaded/i.test(err) ? "rate" : /model/i.test(err) ? "model" : "other" });
            res.end();
          });
        } catch (e) {
          const code = (e as { status?: number })?.status ?? 400;
          if (!res.headersSent) { res.statusCode = code; res.end(); } else res.end();
        }
      });
    },
  };
}
