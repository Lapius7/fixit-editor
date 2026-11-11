// ファイル一覧で開いているフォルダの記録。タブの切り替えや再起動でも、開閉の状態を保つ。
import { kvGet, kvSet } from "@/platform/appdata";
import { readDir, type Node } from "@/platform/fs";
import { TREE_PREFETCH_MS } from "@/shared/config";

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

// 前に開いていたフォルダの中身を、一覧を出す前にまとめて読んでおく。
// 読まずに出すと、親を描く → 中身を読む → 子を描く…が 1 段ずつ進み、見ている前で順に開いていくように見える。
// 同じ深さのフォルダは並行して読む。時間がかかりすぎるときは、読めた分だけ使い、残りは従来どおり描いてから読む。
// 読んでいる間は、ファイル一覧に読み込み中の行を出している
const pre = new Map<string, Node[]>();

export async function prefetchOpen(nodes: Node[], wait = TREE_PREFETCH_MS): Promise<void> {
  let stop = false;
  pre.clear(); // 前回の読み残しは使わない
  const walk = async (list: Node[]): Promise<void> => {
    const dirs = list.filter((n) => n.kind === "dir" && n.handle && isOpen(n.path));
    await Promise.all(dirs.map(async (d) => {
      if (stop) return;
      const kids = await readDir(d.handle as FileSystemDirectoryHandle, d.path).catch(() => null);
      if (!kids || stop) return;
      pre.set(d.path, kids);
      await walk(kids);
    }));
  };
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([walk(nodes), new Promise<void>((r) => { t = setTimeout(() => { stop = true; r(); }, wait); })]);
  clearTimeout(t);
}

// 先読みした中身を受け取る(1 回きり。古い中身を後で使い回さない)
export function takePrefetched(path: string): Node[] | undefined {
  const v = pre.get(path);
  pre.delete(path);
  return v;
}

// 開いているフォルダのうち、親もすべて開いていて画面に出ているもの(prefix はルートの見出しのパス)
export function shownOpen(prefix: string): string[] {
  const open = get();
  return [...open].filter((p) => {
    if (!p.startsWith(prefix + "/")) return false;
    for (let i = p.lastIndexOf("/"); i > prefix.length; i = p.lastIndexOf("/", i - 1)) if (!open.has(p.slice(0, i))) return false;
    return true;
  });
}
