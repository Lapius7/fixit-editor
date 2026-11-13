// プロバイダーごとの使用量。トークン数(直近 1 回と、リセット後の合計)と、claude が返す 5 時間/週間の使用率。
// 会話の内容は持たない。数字だけを、API キーとは別のキーに保存する
import { useSyncExternalStore } from "react";
import { kvGet, kvSet, kvWatch } from "@/platform/appdata";
import { AI_USAGE_KEY } from "@/shared/config";
import type { Provider } from "@/features/ai/store";

export type Tok = { i: number; o: number; cr: number; cw: number };
/** u は使用率(0〜1)、r はリセット時刻(unix 秒。分からなければ 0) */
export type Lim = { u: number; r: number };
export type Use = { last: Tok | null; total: Tok; n: number; since: number; limits: Record<string, Lim> };
type All = Partial<Record<Provider, Use>>;

const zero = (): Tok => ({ i: 0, o: 0, cr: 0, cw: 0 });
/** 返答ごとのトークン数を足し合わせる(会話の合計や、1 回の返事の中で複数回に分かれて届く分に使う) */
export const addTok = (a: Tok | undefined, b: Partial<Tok>): Tok => { const x = a ?? zero(), y = tok(b); return { i: x.i + y.i, o: x.o + y.o, cr: x.cr + y.cr, cw: x.cw + y.cw }; };

export const blankUse = (): Use => ({ last: null, total: zero(), n: 0, since: Date.now(), limits: {} });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const tok = (v: unknown): Tok => { const t = (v ?? {}) as Record<string, unknown>; return { i: num(t.i), o: num(t.o), cr: num(t.cr), cw: num(t.cw) }; };

function load(): All {
  try {
    const r = JSON.parse(kvGet(AI_USAGE_KEY) ?? "null");
    if (!r || typeof r !== "object") return {};
    const out: All = {};
    for (const [p, raw] of Object.entries(r as Record<string, Record<string, unknown>>)) {
      if (!raw || typeof raw !== "object") continue;
      const limits: Record<string, Lim> = {};
      for (const [id, v] of Object.entries((raw.limits ?? {}) as Record<string, Record<string, unknown>>)) if (v && typeof v.u === "number") limits[id] = { u: Math.min(Math.max(v.u, 0), 1), r: num(v.r) };
      out[p as Provider] = { last: raw.last ? tok(raw.last) : null, total: tok(raw.total), n: num(raw.n), since: num(raw.since) || Date.now(), limits };
    }
    return out;
  } catch { return {}; }
}

let all: All = load();
const subs = new Set<() => void>();
const commit = (next: All) => {
  all = next;
  try { kvSet(AI_USAGE_KEY, JSON.stringify(all)); } catch { /* 保存できなくてもメモリ上では動く */ }
  subs.forEach((f) => f());
};
const cur = (p: Provider) => all[p] ?? blankUse();

export const useUsage = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => all);

/** 1 回の返事で使ったトークン数を足す */
export function recordUsage(p: Provider, t: Partial<Tok>) {
  const u = cur(p), n = tok(t);
  if (!(n.i || n.o || n.cr || n.cw)) return;
  commit({ ...all, [p]: { ...u, last: n, n: u.n + 1, total: { i: u.total.i + n.i, o: u.total.o + n.o, cr: u.total.cr + n.cr, cw: u.total.cw + n.cw } } });
}
/** 5 時間/週間などの使用率を書き換える(id は five_hour / seven_day など。claude が返した名前のまま) */
export function recordLimit(p: Provider, id: string, u: number, r: number) {
  if (!Number.isFinite(u) || !/^[\w-]{1,32}$/.test(id)) return;
  const c = cur(p);
  commit({ ...all, [p]: { ...c, limits: { ...c.limits, [id]: { u: Math.min(Math.max(u, 0), 1), r: num(r) } } } });
}
export const resetUsage = (p: Provider) => commit({ ...all, [p]: blankUse() });

kvWatch(AI_USAGE_KEY, (_f, dirty) => { if (dirty) return; all = load(); subs.forEach((f) => f()); });
