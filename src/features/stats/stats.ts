import { kvGet, kvSet, kvWatch } from "@/platform/appdata";
import { useSyncExternalStore } from "react";
import { get as getSettings } from "@/features/settings/settings";
import i18next from 'i18next'

// コーディング時間・タイピングの統計。この PC の中だけに残し、外へは送らない。
export type Day = { sec: number; keys: number; chars: number; del: number; saves: number; langs: Record<string, number>; hours: number[] };
type Store = { days: Record<string, Day>; since: string };

const KEY = "fixit:stats:v1";
const TICK = 5; // 秒
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const blank = (): Day => ({ sec: 0, keys: 0, chars: 0, del: 0, saves: 0, langs: {}, hours: Array(24).fill(0) });

function parse(raw: string | null): Store | null {
  try {
    const r = JSON.parse(raw || "null") as Store | null;
    if (r && r.days && typeof r.days === "object") return r;
  } catch { /* 読めなければ空から */ }
  return null;
}
const load = (): Store => parse(kvGet(KEY)) ?? { days: {}, since: day() };
let st = load();
let ver = 0, dirty = false, last = 0, lang = "";
const subs = new Set<() => void>();
const emit = () => { ver++; subs.forEach((f) => f()); };
const today = () => (st.days[day()] ??= blank());
const on = () => getSettings().statsOn;

function persist() {
  if (!dirty) return;
  dirty = false;
  // 古い日は 400 日で切る
  const keys = Object.keys(st.days).sort();
  if (keys.length > 400) keys.slice(0, keys.length - 400).forEach((k) => delete st.days[k]);
  try { kvSet(KEY, JSON.stringify(st)); } catch { /* 保存できない */ }
}

// 手を動かした印。ここから「離席とみなす時間」のあいだは、作業中として数える
function touch(name?: string) { if (!on()) return; last = Date.now(); if (name) lang = name; }
function noteKey() { if (!on()) return; today().keys++; dirty = true; }
export function noteEdit(typed: number, deleted: number, name?: string) {
  if (!on()) return;
  const d = today(); d.chars += typed; d.del += deleted; dirty = true; touch(name);
}
export function noteSave() { if (!on()) return; today().saves++; dirty = true; }

let started = false;
export function startStats() {
  if (started || typeof window === "undefined") return;
  started = true;
  addEventListener("keydown", (e) => { if ((e.target as HTMLElement | null)?.closest?.(".cm-content")) { noteKey(); touch(); } }, true);
  addEventListener("pointerdown", (e) => { if ((e.target as HTMLElement | null)?.closest?.(".cm-editor")) touch(); }, true);
  setInterval(() => {
    if (!on() || document.visibilityState !== "visible") return;
    const s = getSettings();
    if (Date.now() - last > s.statsIdle * 1000) return;
    const d = today(), h = new Date().getHours();
    d.sec += TICK; d.hours[h] = (d.hours[h] ?? 0) + TICK;
    if (lang) d.langs[lang] = (d.langs[lang] ?? 0) + TICK;
    dirty = true; emit();
  }, TICK * 1000);
  setInterval(persist, 15000);
  addEventListener("pagehide", persist);
}

export const clearStats = () => { st = { days: {}, since: day() }; dirty = true; persist(); emit(); };
export const getStats = () => st;
export const useStats = () => { useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => ver); return st; };

/* ---- 集計 ---- */
export const dur = (sec: number) => {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? i18next.t("1分未満") : i18next.t("0分");
  return m < 60 ? i18next.t("{{m}}分", { m }) : i18next.t("{{arg0}}時間{{arg1}}", { arg0: Math.floor(m / 60), arg1: m % 60 ? `${m % 60}分` : "" });
};
export function lastDays(n: number): { key: string; d: Day; label: string }[] {
  const out: { key: string; d: Day; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const t = new Date(); t.setDate(t.getDate() - i);
    const k = day(t);
    out.push({ key: k, d: st.days[k] ?? blank(), label: `${t.getMonth() + 1}/${t.getDate()}` });
  }
  return out;
}
export function summary() {
  const all = Object.entries(st.days);
  const sum = (f: (d: Day) => number, list = all) => list.reduce((a, [, d]) => a + f(d), 0);
  const wk = new Set(lastDays(7).map((x) => x.key));
  const week = all.filter(([k]) => wk.has(k));
  // 連続日数: 今日(まだなら昨日)からさかのぼって、作業のあった日が続く数
  let streak = 0;
  const t = new Date();
  if (!(st.days[day(t)]?.sec > 0)) t.setDate(t.getDate() - 1);
  while (st.days[day(t)]?.sec > 0) { streak++; t.setDate(t.getDate() - 1); }
  const langs: Record<string, number> = {};
  all.forEach(([, d]) => Object.entries(d.langs).forEach(([k, v]) => (langs[k] = (langs[k] ?? 0) + v)));
  const hours = Array(24).fill(0) as number[];
  all.forEach(([, d]) => d.hours.forEach((v, i) => (hours[i] += v)));
  const td = st.days[day()] ?? blank();
  return {
    today: td, streak, since: st.since, days: all.length,
    weekSec: sum((d) => d.sec, week), totalSec: sum((d) => d.sec), totalChars: sum((d) => d.chars), totalKeys: sum((d) => d.keys),
    langs: Object.entries(langs).sort((a, b) => b[1] - a[1]), hours,
    cpm: td.sec > 60 ? Math.round((td.chars / td.sec) * 60) : 0, // 1 分あたりの入力文字数(今日)
  };
}

/* ---- 他のウィンドウとの同期 ----
   別のウィンドウが統計を書いたら、その内容に「このウィンドウがまだ書いていない分」(いまの値 − 最後にファイルと一致した値 prev)を足す。
   どちらかの分が消えたり、二重に数えたりしない */
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
function combine(theirs: Day | undefined, mine: Day | undefined, prev: Day | undefined): Day {
  const t = theirs ?? blank(), m = mine ?? blank(), p = prev ?? blank();
  const f = (a: number, b: number, c: number) => Math.max(0, num(a) + num(b) - num(c));
  const langs: Record<string, number> = {};
  for (const k of new Set([...Object.keys(t.langs ?? {}), ...Object.keys(m.langs ?? {})])) { const v = f(t.langs?.[k] ?? 0, m.langs?.[k] ?? 0, p.langs?.[k] ?? 0); if (v) langs[k] = v; }
  return { sec: f(t.sec, m.sec, p.sec), keys: f(t.keys, m.keys, p.keys), chars: f(t.chars, m.chars, p.chars), del: f(t.del, m.del, p.del), saves: f(t.saves, m.saves, p.saves), langs, hours: Array.from({ length: 24 }, (_, i) => f(t.hours?.[i] ?? 0, m.hours?.[i] ?? 0, p.hours?.[i] ?? 0)) };
}
kvWatch(KEY, (f, kvDirty, prevRaw) => {
  const theirs = parse(f) ?? { days: {}, since: st.since }, prev = parse(prevRaw);
  const days: Record<string, Day> = {};
  for (const k of new Set([...Object.keys(theirs.days), ...Object.keys(st.days), ...Object.keys(prev?.days ?? {})])) days[k] = combine(theirs.days[k], st.days[k], prev?.days[k]);
  const merged: Store = { days, since: theirs.since };
  const extra = JSON.stringify(merged) !== JSON.stringify(theirs);
  st = merged; emit();
  if (extra || kvDirty) { dirty = true; persist(); }
});
