// 名前.localhost → この PC のポート の中継(Rust の localport)。登録は kv に残し、起動のたびに登録し直す。デスクトップ版だけ
import { IS_TAURI } from "@/shared/chrome";
import { kvGet, kvSet } from "@/platform/appdata";

export type Local = { name: string; port: string };
export const LOCAL_PORT = 1355;
const KEY = "fixit:localport:v1";
export const localAvailable = IS_TAURI;
export const validLocalName = (n: string) => n.length > 0 && n.length <= 40 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(n);
export const localUrl = (name: string, base = LOCAL_PORT) => `http://${name}.localhost:${base}`;

export function loadLocals(): Local[] {
  try {
    const j: unknown = JSON.parse(kvGet(KEY) ?? "[]");
    return Array.isArray(j) ? j.flatMap((e: { name?: unknown; port?: unknown } | null) => typeof e?.name === "string" && validLocalName(e.name) && typeof e.port === "string" && /^\d{1,5}$/.test(e.port) ? [{ name: e.name, port: e.port }] : []) : [];
  } catch { return []; }
}
const save = (l: Local[]) => kvSet(KEY, JSON.stringify(l));

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
// 待ち受けを始めて、保存してある名前をすべて登録する。始められなかったときは理由を返す
export async function ensureLocal(): Promise<{ ok: true; base: number } | { ok: false; error: string }> {
  if (!localAvailable) return { ok: false, error: "" };
  try {
    const base = await call<number>("lp_start", { port: LOCAL_PORT });
    for (const l of loadLocals()) await call("lp_set", { name: l.name, port: Number(l.port) });
    return { ok: true, base };
  } catch (e) { return { ok: false, error: String(e) }; }
}
// 名前とポートを登録する(同じ名前なら、ポートを差し替える)
export async function addLocal(name: string, port: string): Promise<string | null> {
  const r = await ensureLocal();
  if (!r.ok) return r.error || "このアプリでは使えません";
  try { await call("lp_set", { name, port: Number(port) }); } catch (e) { return String(e); }
  save([{ name, port }, ...loadLocals().filter((l) => l.name !== name)]);
  return null;
}
export async function removeLocal(name: string): Promise<void> {
  save(loadLocals().filter((l) => l.name !== name));
  if (localAvailable) await call("lp_remove", { name }).catch(() => {});
}
