// 拡張機能が設定する背景画像。見せるのは App の <ExtBackdrop>。画像は blob: URL にして使い、外部の URL は受け付けない。
import { useSyncExternalStore } from "react";

export type Fit = "cover" | "contain" | "center" | "tile";
export type Backdrop = { url: string; opacity: number; blur: number; fit: Fit };
const items = new Map<string, Backdrop>();
let snap: Backdrop | null = null;
const subs = new Set<() => void>();
const emit = () => { snap = [...items.values()].at(-1) ?? null; subs.forEach((f) => f()); };

/** blob は呼び出し側が渡す。URL はここで作り、置き換え・解除のときに解放する */
export function setBackdrop(extId: string, b: { blob: Blob; opacity: number; blur: number; fit: Fit } | null) {
  const old = items.get(extId);
  if (old) URL.revokeObjectURL(old.url);
  items.delete(extId);
  if (b) items.set(extId, { url: URL.createObjectURL(b.blob), opacity: b.opacity, blur: b.blur, fit: b.fit });
  emit();
}
export const useBackdrop = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
