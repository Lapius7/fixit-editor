// GitHub Copilot の接続。ログイン(デバイスフロー)と、会話に使う短い期限のトークンへの交換。
// github.com と api.github.com(交換)はブラウザから直接呼べないので、exe は Rust(copilot_*)、開発サーバーは /__copilot が代わりに送る。
// 会話そのもの(api.githubcopilot.com)は providers.ts がブラウザから直接送る。
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

// ログインを始める。コードと URL を onCode で知らせ、利用者が GitHub で承認するまで待つ(押されたときだけ動かす)
export async function copilotLogin(onCode: (d: Device) => void, signal: AbortSignal): Promise<LoginResult> {
  let d: Device;
  try {
    const r = await call<Device & { error?: string }>("device", {});
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
      try { p = await call<Poll>("poll", { device_code: d.device_code }); bad = 0; } catch { if (++bad >= 3) return { ok: false, why: "network" }; continue; }
      if (p.status === "ok" && p.token) return { ok: true, token: p.token };
      if (p.status === "slow") every += 5000;
      else if (p.status === "denied") return { ok: false, why: "denied" };
      else if (p.status === "expired") return { ok: false, why: "expired" };
      else if (p.status === "other" && ++bad >= 3) return { ok: false, why: "network" };
    }
  } catch { return { ok: false, why: "cancel" }; }
  return { ok: false, why: "expired" };
}

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
