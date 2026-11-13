import { useSyncExternalStore } from "react";

// 撮ったコードの画像を、右下に出して見せるための状態
export type ShotView = { id: number; url: string; blob: Blob; name: string; copied: boolean; busy: boolean; redo: () => Promise<Blob> };

let cur: ShotView | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const showShot = (blob: Blob, name: string, copied: boolean, redo: () => Promise<Blob>) => {
  if (cur) URL.revokeObjectURL(cur.url);
  cur = { id: ++seq, url: URL.createObjectURL(blob), blob, name, copied, busy: false, redo };
  emit();
};
export const patchShot = (p: Partial<ShotView>) => { if (cur) { cur = { ...cur, ...p }; emit(); } };
export const closeShot = () => { if (cur) URL.revokeObjectURL(cur.url); cur = null; emit(); };

export const useShot = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => cur);
