// ファイル一覧で開いているフォルダの記録。タブの切り替えや再起動でも、開閉の状態を保つ。
import { kvGet, kvSet } from "@/platform/appdata";

const KEY = "fixit:tree-open:v1";
const MAX = 1000;
const read = (): Set<string> => {
  try { const v = JSON.parse(kvGet(KEY) ?? "[]"); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []); } catch { return new Set(); }
};
let loaded: Set<string> | undefined; // 起動時のデータ読み込みのあとで読むため、最初に使うときまで待つ
const get = () => (loaded ??= read());
let timer: ReturnType<typeof setTimeout> | undefined;

export const isOpen = (path: string) => get().has(path);

export function setOpenPath(path: string, on: boolean) {
  const open = get();
  if (on === open.has(path)) return;
  if (on) { open.add(path); if (open.size > MAX) open.delete(open.values().next().value as string); } else open.delete(path);
  clearTimeout(timer);
  timer = setTimeout(() => kvSet(KEY, JSON.stringify([...open])), 300);
}
