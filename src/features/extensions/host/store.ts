// 拡張機能の設定値と、拡張が使う保存領域。1 つの kv キーに、拡張 id ごとにまとめて持つ(画像の本体は blobs.ts)。
import { useSyncExternalStore } from "react";
import { kvGet, kvSet, kvWatch } from "@/platform/appdata";

export const SETTINGS_KEY = "fixit:ext-settings:v1";
export const MAX_STORAGE_CHARS = 64_000; // 拡張 1 つの storage の合計
export type FileVal = { ref: string; name: string; size: number; at: number };
export type SettingVal = boolean | number | string | FileVal | null;
type Saved = { v: 1; set: Record<string, Record<string, SettingVal>>; data: Record<string, Record<string, string>> };

let saved: Saved = { v: 1, set: {}, data: {} };
let snap = 0;
const subs = new Set<() => void>();
let loaded = false;
function load() {
  if (loaded) return;
  loaded = true;
  try { const j = JSON.parse(kvGet(SETTINGS_KEY) ?? "null"); if (j?.v === 1 && j.set && j.data) saved = j; } catch { /* 読めなければ空 */ }
}
const emit = () => { snap++; subs.forEach((f) => f()); };
const parse = (raw: string | null): Saved | null => { try { const j = JSON.parse(raw ?? "null"); return j?.v === 1 && j.set && j.data ? j : null; } catch { return null; } };
const mergeMap = <T,>(a: Record<string, Record<string, T>>, b: Record<string, Record<string, T>>) => { const o: Record<string, Record<string, T>> = {}; for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) o[id] = { ...a[id], ...b[id] }; return o; };
// 別のウィンドウが書いたら取り込む。こちらに未保存の変更があるときは、拡張・項目ごとにこちらを優先して混ぜる(どちらの変更も残す)
kvWatch(SETTINGS_KEY, (f, dirty) => {
  const other = parse(f);
  if (!other) return;
  if (!loaded) { loaded = true; saved = other; return; }
  saved = dirty ? { v: 1, set: mergeMap(other.set, saved.set), data: mergeMap(other.data, saved.data) } : other;
  if (dirty) persist();
  emit();
});
const persist = () => kvSet(SETTINGS_KEY, JSON.stringify(saved));

export function getSettings(id: string): Record<string, SettingVal> { load(); return saved.set[id] ?? {}; }
export function putSetting(id: string, key: string, v: SettingVal) { load(); (saved.set[id] ??= {})[key] = v; persist(); emit(); }
export function resetSettings(id: string) { load(); delete saved.set[id]; persist(); emit(); }
export function dropExt(id: string) { load(); delete saved.set[id]; delete saved.data[id]; persist(); emit(); }
export const useSettingsVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);

export function dataGet(id: string, k: string): string | null { load(); return saved.data[id]?.[k] ?? null; }
/** 合計が上限を超えるときは false(書かない) */
export function dataSet(id: string, k: string, v: string | null): boolean {
  load();
  const d = (saved.data[id] ??= {});
  if (v === null) delete d[k];
  else {
    const rest = Object.entries(d).reduce((n, [kk, vv]) => n + (kk === k ? 0 : kk.length + vv.length), 0);
    if (rest + k.length + v.length > MAX_STORAGE_CHARS) return false;
    d[k] = v;
  }
  persist();
  return true;
}
export const subscribeSettings = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
