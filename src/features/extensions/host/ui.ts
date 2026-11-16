// 拡張機能が画面に出すもの(状態バーの項目・質問)の置き場。画面側はここを購読して描くだけ。
// どちらも拡張ごとに管理し、stop() のときに dropUi(id) でまとめて外す。
import { useSyncExternalStore } from "react";
import { shieldExtCss } from "./css";
import type { PanelData, PickItem } from "./guard";

const mk = <T,>(init: T) => {
  let v = init; const subs = new Set<() => void>();
  return { get: () => v, set: (n: T) => { v = n; subs.forEach((f) => f()); }, sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; } };
};

// ---- 状態バー ----
export type StatusItem = { key: string; ext: string; name: string; text: string; tip: string; command: string };
const status = mk<StatusItem[]>([]);
export const useStatusItems = () => useSyncExternalStore(status.sub, status.get);
export function setStatus(ext: string, name: string, id: string, v: { text: string; tip: string; command: string } | null) {
  const key = `${ext}/${id}`, rest = status.get().filter((x) => x.key !== key);
  status.set(v ? [...rest, { key, ext, name, ...v }] : rest);
}
export const countStatus = (ext: string) => status.get().filter((x) => x.ext === ext).length;
export const hasStatus = (ext: string, id: string) => status.get().some((x) => x.key === `${ext}/${id}`);

// ---- 質問(選ぶ・入力する) ----
export type Prompt = { ext: string; name: string; kind: "pick" | "input"; title: string; placeholder: string; value: string; secret: boolean; items: PickItem[]; done: (r: number | string | null) => void };
const prompts = mk<Prompt[]>([]);
export const usePrompt = () => useSyncExternalStore(prompts.sub, () => prompts.get()[0] ?? null);
let shielded = false;
const sync = () => { const on = prompts.get().length > 0; if (on !== shielded) { shielded = on; shieldExtCss(on); } };

/** 質問を出す。同じ拡張が答えを待っている間は、もう 1 つ出せない(質問を重ねて偽の画面にするのを防ぐ)。答えは選んだ番号か入力した文字、取り消しは null */
export function askUser(p: Omit<Prompt, "done">): Promise<number | string | null> {
  if (prompts.get().some((x) => x.ext === p.ext)) return Promise.reject(new Error("another prompt is open"));
  return new Promise((resolve) => {
    const q: Prompt = { ...p, done: (r) => { prompts.set(prompts.get().filter((x) => x !== q)); sync(); resolve(r); } };
    prompts.set([...prompts.get(), q]); sync();
  });
}

// ---- パネル ----
export type PanelEntry = PanelData & { key: string; ext: string; name: string; id: string };
const panels = mk<PanelEntry[]>([]);
const shown = mk<string | null>(null); // いま開いているパネルの key
export const usePanels = () => useSyncExternalStore(panels.sub, panels.get);
export const useShownPanel = () => useSyncExternalStore(shown.sub, shown.get);
export function setPanel(ext: string, name: string, id: string, v: PanelData | null) {
  const key = `${ext}/${id}`, rest = panels.get().filter((x) => x.key !== key);
  panels.set(v ? [...rest, { key, ext, name, id, ...v }] : rest);
  if (!v && shown.get() === key) shown.set(null);
}
export const countPanels = (ext: string) => panels.get().filter((x) => x.ext === ext).length;
export const getPanel = (ext: string, id: string) => panels.get().find((x) => x.key === `${ext}/${id}`);
export const showPanel = (key: string | null) => shown.set(key);

/** 拡張を止めるとき: その拡張の項目と質問を外す(質問は取り消しとして閉じる) */
export function dropUi(ext: string) {
  status.set(status.get().filter((x) => x.ext !== ext));
  if (shown.get()?.startsWith(`${ext}/`)) shown.set(null);
  panels.set(panels.get().filter((x) => x.ext !== ext));
  for (const q of prompts.get().filter((x) => x.ext === ext)) q.done(null);
}
