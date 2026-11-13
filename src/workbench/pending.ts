import { useSyncExternalStore } from "react";

// 貼り付け・ドロップで入れている最中のもの。入り終わるまで、入る先のフォルダに名前つきの読み込み行を出す
export type PendingItem = { name: string; dir: boolean };
type Pending = { id: number; at: string; items: PendingItem[] };

let list: Pending[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** at は入る先のフォルダのパス(一覧の先頭ならルートの prefix)。返す関数を呼ぶと行が消える */
export const beginPending = (at: string, items: PendingItem[]) => {
  const id = ++seq;
  list = [...list, { id, at, items }];
  emit();
  return () => { list = list.filter((p) => p.id !== id); emit(); };
};

const EMPTY: PendingItem[] = [];
const cache = new Map<string, PendingItem[]>();
const snap = (at: string) => {
  const items = list.filter((p) => p.at === at).flatMap((p) => p.items);
  const old = cache.get(at);
  if (!items.length) return EMPTY;
  if (old && old.length === items.length && old.every((n, i) => n.name === items[i].name && n.dir === items[i].dir)) return old;
  cache.set(at, items);
  return items;
};
export const usePending = (at: string | undefined) => useSyncExternalStore(sub, () => (at === undefined ? EMPTY : snap(at)));
