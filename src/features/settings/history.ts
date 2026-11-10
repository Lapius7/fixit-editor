import { kvGet, kvSet, kvWatch, mergeById } from "@/platform/appdata";
// 設定の変更履歴(Git 風)。差分だけを端末内に残す。API キーなどの秘密は設定に含まれないので、ここにも入らない
import { useSyncExternalStore } from "react";
import { DEFS, fromOtherWindow, get, importJson, subscribe, type Settings } from "@/features/settings/settings";
import { SETTINGS_HISTORY_DELAY_MS, SETTINGS_HISTORY_MAX } from "@/shared/config";

export type Change = [old: unknown, next: unknown]; // 欠けていた値は null
export type Entry = { id: string; t: number; changes: Record<string, Change>; revertOf?: string };

const KEY = "fixit:settings:history:v1";
const uid = () => Math.random().toString(36).slice(2, 10);

// 設定を「項目 id → 値」の平らな形にする。ショートカットは keys.<機能 id> に分ける
function flat(s: Settings): Record<string, unknown> {
  const out: Record<string, unknown> = { mode: s.mode, accent: s.accent, dots: s.dots };
  const v = s as unknown as Record<string, unknown>;
  for (const d of DEFS) out[d.id] = v[d.id];
  for (const [k, x] of Object.entries(s.keys)) out[`keys.${k}`] = x;
  return out;
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, Change> {
  const out: Record<string, Change> = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[id] ?? null) !== JSON.stringify(b[id] ?? null)) out[id] = [a[id] ?? null, b[id] ?? null];
  }
  return out;
}

function load(raw: string | null = kvGet(KEY)): Entry[] {
  try {
    const r = JSON.parse(raw || "[]");
    return Array.isArray(r) ? r.filter((e): e is Entry => !!e && typeof e.id === "string" && typeof e.t === "number" && !!e.changes && typeof e.changes === "object") : [];
  } catch { return []; }
}

let list = load(); // 古い順
let base = flat(get());
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();

const save = () => { try { kvSet(KEY, JSON.stringify(list)); } catch { /* 保存できなくても動かす */ } subs.forEach((f) => f()); };

function flush(revertOf?: string) {
  clearTimeout(timer);
  const now = flat(get()), changes = diff(base, now);
  base = now;
  if (!Object.keys(changes).length) return;
  list = [...list, { id: uid(), t: Date.now(), changes, ...(revertOf ? { revertOf } : {}) }].slice(-SETTINGS_HISTORY_MAX);
  save();
}

subscribe(() => { if (fromOtherWindow()) { clearTimeout(timer); base = flat(get()); return; } clearTimeout(timer); timer = setTimeout(() => flush(), SETTINGS_HISTORY_DELAY_MS); });
addEventListener("pagehide", () => flush());

export const useHistory = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => list);
export const clearHistory = () => { clearTimeout(timer); list = []; base = flat(get()); save(); };

// 今の値が、その履歴の「変更後」のままか(そうでなければ元に戻す意味がない)
export const canRevert = (e: Entry) => { const now = flat(get()); return Object.entries(e.changes).some(([id, [old]]) => JSON.stringify(now[id] ?? null) !== JSON.stringify(old)); };

// 元に戻す。Git の revert と同じで、履歴は消さず「戻した」という新しい履歴を足す
export function revert(e: Entry) {
  clearTimeout(timer); flush(); // 保留中の変更を先に確定する
  const s = get(), next = { ...s, keys: { ...s.keys } } as Settings & Record<string, unknown>;
  for (const [id, [old]] of Object.entries(e.changes)) {
    if (id.startsWith("keys.")) { const k = id.slice(5); if (old === null) delete next.keys[k]; else next.keys[k] = old as string; }
    else if (old !== null) next[id] = old;
  }
  importJson(JSON.stringify(next)); // 値の検査(範囲・型)は読み込みと同じ経路で行う
  flush(e.id);
}

// 他のウィンドウが履歴を足したら取り込む
kvWatch(KEY, (f, dirty) => {
  if (dirty) { list = mergeById(list, load(f)).sort((a, b) => a.t - b.t).slice(-SETTINGS_HISTORY_MAX); try { kvSet(KEY, JSON.stringify(list)); } catch { /* 保存できない */ } }
  else list = load();
  subs.forEach((f) => f());
});
