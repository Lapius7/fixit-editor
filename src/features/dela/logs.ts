// 公開中の dela が出した文字を、ポートごとに残す(ログ表示用)。画面には出さない端末の出力を、行にして最新の 500 行だけ持つ。
// dela --inspect は、受けたリクエストを 127.0.0.1 の画面(API)に記録する。その場所を出力から拾い、curl で読む。
import { execCmd } from "@/platform/remote";
import type { Conn } from "@/platform/remote";
import { stripAnsi } from "./dela";

const MAX_LINES = 500;
// 端末の準備確認(bg.ts)で送る式と、その結果。dela の出力ではないので除く
const NOISE = /864192|7\*123456/;
type Store = { lines: string[]; cur: string; inspect?: string; v: number; subs: Set<() => void> };
const stores = new Map<number, Store>();
const store = (id: number): Store => {
  let s = stores.get(id);
  if (!s) { s = { lines: [], cur: "", v: 0, subs: new Set() }; stores.set(id, s); }
  return s;
};

// 行の中の \r(同じ行を書き直す表示)は、最後に書かれた分だけを残す
const clean = (p: string) => p.split("\r").filter((x) => x.trim()).pop()?.trimEnd() ?? "";
const INSPECT = /inspect:\s*(http:\/\/127\.0\.0\.1:\d{2,5})/;

export function logAppend(id: number, chunk: string): void {
  const s = store(id);
  const t = stripAnsi(chunk);
  const m = INSPECT.exec(t);
  if (m) s.inspect = m[1];
  const parts = (s.cur + t).split("\n");
  // 書き終えていない最後の行は、あとの出力と続けて読む。\r のあとに字が続くなら、その前は書き直されて消える
  s.cur = (parts.pop() ?? "").replace(/^[^]*\r(?=[^\r])/, "");
  for (const p of parts) { const l = clean(p); if (l && !NOISE.test(l)) s.lines.push(l); }
  if (s.lines.length > MAX_LINES) s.lines.splice(0, s.lines.length - MAX_LINES);
  s.v++;
  for (const f of s.subs) f();
}
export const logLines = (id: number): string[] => { const s = stores.get(id); if (!s) return []; const c = clean(s.cur); return c && !NOISE.test(c) ? [...s.lines, c] : s.lines; };
export const logInspect = (id: number): string | undefined => stores.get(id)?.inspect;
export const logVersion = (id: number): number => stores.get(id)?.v ?? 0;
export const logSubscribe = (id: number, f: () => void): (() => void) => { const s = store(id); s.subs.add(f); return () => { s.subs.delete(f); }; };
export const logClear = (id: number): void => { const s = stores.get(id); if (!s) return; s.lines = []; s.cur = ""; s.v++; for (const f of s.subs) f(); };
export const logDrop = (id: number): void => { stores.delete(id); };

// ---- 受けたリクエスト(dela --inspect の /api/requests) ----
export type Req = { id: number; time: string; method: string; path: string; remote: string; status: number; durationMs: number; reqSize: number; respSize: number; note?: string };

export function parseReqs(text: string): Req[] | null {
  let j: unknown;
  try { j = JSON.parse(stripAnsi(text).trim()); } catch { return null; }
  if (!Array.isArray(j)) return null;
  return j.flatMap((x): Req[] => {
    const r = x as Partial<Req> | null;
    if (!r || typeof r.id !== "number" || typeof r.method !== "string" || typeof r.path !== "string") return [];
    return [{ id: r.id, time: String(r.time ?? ""), method: r.method, path: r.path, remote: String(r.remote ?? ""), status: +(r.status ?? 0), durationMs: +(r.durationMs ?? 0), reqSize: +(r.reqSize ?? 0), respSize: +(r.respSize ?? 0), note: typeof r.note === "string" ? r.note : undefined }];
  });
}
// inspect の場所は dela の出力から取るが、念のため、自分の PC の http://127.0.0.1:<ポート> だけを呼ぶ
export const inspectBase = (u: string | undefined): string | null => (u && /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(u) ? u : null);
export async function fetchReqs(conn: Conn, dir: string, base: string): Promise<Req[] | null> {
  const b = inspectBase(base);
  if (!b) return null;
  try {
    const r = await execCmd(conn, dir, `curl -sS --max-time 3 '${b}/api/requests' 2>&1 </dev/null`, 8);
    return r.code === 0 ? parseReqs(r.out) : null;
  } catch { return null; }
}
export const fmtMs = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);
export const fmtSize = (n: number): string => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);
// 表示する時刻(時:分:秒)。読み取れなければ空
export const fmtTime = (iso: string): string => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleTimeString([], { hour12: false }); };
