import type { Plugin } from "vite";
import { body, check } from "./fsapi";

// GitHub Copilot のログイン(デバイスフロー)の橋渡し(開発サーバー専用)。
// github.com は CORS を許さないので、コードの発行と確認だけをここで行う。src-tauri/fixit-core/src/copilot.rs と同じ動き。
// トークンの交換と会話は、ブラウザから api.github.com / api.githubcopilot.com へ直接送る。
const CLIENT_ID = "Iv1.b507a08c87ecfe98";

const post = async (url: string, form: Record<string, string>) => {
  const r = await fetch(url, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Fixit-Editor" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(30_000) });
  const t = (await r.text()).slice(0, 65536);
  return JSON.parse(t) as Record<string, unknown>;
};
const str = (v: unknown) => (typeof v === "string" && v.length <= 256 ? v : null);

export const deviceOut = (v: Record<string, unknown>) => {
  const d = str(v.device_code), u = str(v.user_code), w = str(v.verification_uri);
  if (!d || !u || !w || !w.startsWith("https://github.com/")) return { error: "other" };
  const n = (x: unknown, def: number, lo: number, hi: number) => Math.min(Math.max(typeof x === "number" ? x : def, lo), hi);
  return { device_code: d, user_code: u, verification_uri: w, interval: n(v.interval, 5, 1, 60), expires_in: n(v.expires_in, 900, 0, 1800) };
};

export const pollOut = (v: Record<string, unknown>) => {
  const t = v.access_token;
  if (typeof t === "string" && t && t.length <= 512) return { status: "ok", token: t };
  const map: Record<string, string> = { authorization_pending: "pending", slow_down: "slow", access_denied: "denied", expired_token: "expired" };
  return { status: map[String(v.error)] ?? "other" };
};

// 交換の返事。src-tauri/fixit-core/src/copilot.rs の token_out と同じ
export const tokenOut = (code: number, v: Record<string, unknown>) => {
  if (code === 401) return { error: "login" };
  if (code === 403 || code === 404) return { error: "nosub" };
  if (code !== 200) return { error: "other" };
  const t = v.token, exp = typeof v.expires_at === "number" ? v.expires_at : 0;
  let api = "https://api.githubcopilot.com";
  const a = (v.endpoints as { api?: unknown } | undefined)?.api;
  if (typeof a === "string" && a.length <= 128) { try { const u = new URL(a); if (u.protocol === "https:" && (u.hostname === "githubcopilot.com" || u.hostname.endsWith(".githubcopilot.com"))) api = u.origin; } catch { /* 既定のまま */ } }
  return typeof t === "string" && t && t.length <= 4096 ? { token: t, expires_at: exp, api } : { error: "other" };
};

export function copilotBridge(): Plugin {
  return {
    name: "fixit-copilot",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__copilot", async (req, res) => {
        const send = (v: unknown, code = 200) => { res.statusCode = code; res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); res.end(JSON.stringify(v)); };
        try {
          check(req);
          if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
          const path = (req.url ?? "").split("?")[0];
          if (path === "/device") { send(deviceOut(await post("https://github.com/login/device/code", { client_id: CLIENT_ID, scope: "read:user" }))); return; }
          if (path === "/poll") {
            const j = JSON.parse((await body(req, 4096)).toString("utf8")) as { device_code?: unknown };
            const d = str(j.device_code);
            if (!d) { send({ error: "bad" }, 400); return; }
            send(pollOut(await post("https://github.com/login/oauth/access_token", { client_id: CLIENT_ID, device_code: d, grant_type: "urn:ietf:params:oauth:grant-type:device_code" })));
            return;
          }
          if (path === "/token") {
            const j = JSON.parse((await body(req, 4096)).toString("utf8")) as { oauth?: unknown };
            const o = typeof j.oauth === "string" ? j.oauth : "";
            if (!o || o.length > 512 || /[\s\x00-\x1f]/.test(o)) { send({ error: "bad" }, 400); return; }
            const r = await fetch("https://api.github.com/copilot_internal/v2/token", { headers: { Authorization: `token ${o}`, Accept: "application/json", "Editor-Version": "Fixit/dev", "Editor-Plugin-Version": "fixit-copilot/dev", "User-Agent": "Fixit-Editor/dev" }, signal: AbortSignal.timeout(30_000) });
            const v = JSON.parse((await r.text()).slice(0, 65536) || "{}") as Record<string, unknown>;
            send(tokenOut(r.status, v));
            return;
          }
          res.statusCode = 404; res.end();
        } catch { send({ error: "network" }, 502); }
      });
    },
  };
}
