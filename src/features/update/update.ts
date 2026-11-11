import { useSyncExternalStore } from "react";
import { IS_TAURI } from "@/shared/chrome";
import { UPDATE_URL } from "@/shared/config";

export type Manifest = { version: string; date: string; notes: string; notes_i18n?: Record<string, string>; file: string; size: number; sha256: string; sig: string; url: string };

// 更新内容を、設定の言語で返す(その言語がなければ notes。notes は日本語)
export function notesFor(m: Manifest, lang: string): string {
  const all = m.notes_i18n && typeof m.notes_i18n === "object" ? m.notes_i18n : {};
  const v = all[lang.split("-")[0]];
  return typeof v === "string" && v.trim() ? v : typeof m.notes === "string" ? m.notes : "";
}

const ver = (v: string) => v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
// a が b より新しければ true(1.10.0 > 1.9.0)
function newer(a: string, b: string): boolean {
  const x = ver(a), y = ver(b);
  for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); }
  return false;
}

// 一時的な失敗(Cloudflare などの 5xx、429、通信の切断)は、少し待って取り直す
const RETRY_WAIT = [800, 2000]; // ms
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchManifest(): Promise<Response | "error"> {
  for (let i = 0; ; i++) {
    const r = await fetch(UPDATE_URL, { cache: "no-store" }).catch(() => null);
    if (r && (r.ok || r.status === 404 || (r.status < 500 && r.status !== 429))) return r;
    if (i >= RETRY_WAIT.length) return "error";
    const after = Number(r?.headers.get("retry-after")) * 1000;
    await sleep(after > 0 && after <= 10_000 ? after : RETRY_WAIT[i]);
  }
}

// 新しい版があれば更新情報を返す。なければ null、確かめられなかったら "error"。アプリ版(exe)だけで動く
async function checkUpdate(): Promise<Manifest | null | "error"> {
  if (!IS_TAURI) return null;
  try {
    const r = await fetchManifest();
    if (r === "error") return "error";
    if (r.status === 404) return null; // まだ何も公開していない
    if (!r.ok) return "error";
    const m = (await r.json()) as Manifest;
    if (!m || typeof m.version !== "string" || !m.sig || !m.sha256 || !m.url) return "error";
    return newer(m.version, __APP_VERSION__) ? m : null;
  } catch {
    return "error";
  }
}

// 更新を適用する。成功するとアプリが再起動するので、戻ってくるのは失敗したときだけ
export async function applyUpdate(m: Manifest): Promise<"no_launcher" | "error"> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("apply_update", { version: m.version, sha256: m.sha256, size: m.size, sig: m.sig, url: m.url });
    return "error";
  } catch (e) {
    return String(e) === "no_launcher" ? "no_launcher" : "error";
  }
}

// ---- 確認の状態(右上の印と設定画面の「更新を確認」が、同じ状態を見る) ----
type St = { found: Manifest | null; checking: boolean };
let st: St = { found: null, checking: false };
const subs = new Set<() => void>();
const put = (n: Partial<St>) => { st = { ...st, ...n }; subs.forEach((f) => f()); };
export const useUpdateState = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st);

// 続けて押されたときは、直前の結果をしばらく使い回す(サーバーへ何度も問い合わせない)
const REUSE_MS = 60_000;
let last: { at: number; r: Manifest | null } | null = null;
let running: Promise<Manifest | null | "error"> | null = null;

/** 新しい版を確かめて、見つかれば右上の印に出す。確認中にもう一度呼ばれたら、同じ確認の結果を返す */
export function runCheck(): Promise<Manifest | null | "error"> {
  if (running) return running;
  if (last && Date.now() - last.at < REUSE_MS) return Promise.resolve(last.r);
  put({ checking: true });
  running = checkUpdate().then((r) => {
    if (r !== "error") last = { at: Date.now(), r };
    put({ checking: false, ...(r === "error" ? {} : { found: r }) });
    running = null;
    return r;
  });
  return running;
}
