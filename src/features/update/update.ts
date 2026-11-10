import { useSyncExternalStore } from "react";
import { IS_TAURI } from "@/shared/chrome";
import { UPDATE_URL } from "@/shared/config";

export type Manifest = { version: string; date: string; notes: string; file: string; size: number; sha256: string; sig: string; url: string };

const ver = (v: string) => v.split("-")[0].split(".").map((n) => parseInt(n, 10) || 0);
// a が b より新しければ true(1.10.0 > 1.9.0)
function newer(a: string, b: string): boolean {
  const x = ver(a), y = ver(b);
  for (let i = 0; i < 3; i++) { if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0); }
  return false;
}

// 新しい版があれば更新情報を返す。なければ null、確かめられなかったら "error"。アプリ版(exe)だけで動く
async function checkUpdate(): Promise<Manifest | null | "error"> {
  if (!IS_TAURI) return null;
  try {
    const r = await fetch(UPDATE_URL, { cache: "no-store" });
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

/** 新しい版を確かめて、見つかれば右上の印に出す。確認中の二重実行は無視して null を返す */
export async function runCheck(): Promise<Manifest | null | "error"> {
  if (st.checking) return null;
  put({ checking: true });
  const r = await checkUpdate();
  put({ checking: false, ...(r === "error" ? {} : { found: r }) });
  return r;
}
