// ファイル一覧で開いているフォルダの記録。タブの切り替えや再起動でも、開閉の状態を保つ。
import { kvGet, kvSet } from "@/platform/appdata";
import { readDir as readDirRaw, type Node } from "@/platform/fs";
import { dlog } from "@/shared/debuglog";
import { TREE_EXPAND_MAX, TREE_EXPAND_MS, TREE_PREFETCH_MS, TREE_READ_TIMEOUT_MS, TREE_WARM_MAX, TREE_WARM_MS } from "@/shared/config";

// 読み先(WSL・SSH など)が応答しないとき、読み込み中の行が出たままにならないよう、待つ時間に上限を置く。
// 先読みの Promise は使い回されるので、止まったものを残すと、開くたびに同じ止まった読み込みを待つことになる
const readDir: typeof readDirRaw = (h, path) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { dlog("tree", `フォルダの読み込みが ${TREE_READ_TIMEOUT_MS / 1000} 秒で終わらず中止: ${path}`); reject(new Error("timeout")); }, TREE_READ_TIMEOUT_MS);
  readDirRaw(h, path).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});
export { readDir };

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

// 閉じたフォルダの中身を、開かれる前に読んでおく(行に指を載せたとき・親のフォルダを開いたとき)。
// 開いたときにすぐ中身を出せるようにする。古くなった中身は使わず読み直す
const warm = new Map<string, { at: number; p: Promise<Node[]> }>();
const fresh = (path: string) => { const w = warm.get(path); return !!w && Date.now() - w.at < TREE_WARM_MS; };
export function warmDir(n: Node): Promise<unknown> {
  if (n.kind !== "dir" || !n.handle || fresh(n.path)) return Promise.resolve();
  const p = readDir(n.handle as FileSystemDirectoryHandle, n.path);
  p.catch(() => warm.delete(n.path));
  warm.set(n.path, { at: Date.now(), p });
  if (warm.size > 400) warm.delete(warm.keys().next().value as string);
  return p.catch(() => undefined);
}
// 先読みした中身があればそれを、なければ読んで返す
export function readWarm(n: Node): Promise<Node[]> {
  const w = fresh(n.path) ? warm.get(n.path) : undefined;
  warm.delete(n.path);
  return w?.p ?? readDir(n.handle as FileSystemDirectoryHandle, n.path);
}
// 作成・削除などで中身が変わったら、先読みを捨てる
export const dropWarm = () => { warm.clear(); queue.length = 0; };

// 中のフォルダをまとめて先読みする。読む先(SSH など)に負担をかけないよう、同時に読むのは 3 つまで
const SKIP = new Set([".git", "node_modules"]);
const queue: Node[] = [];
let running = 0;
const pump = () => {
  while (running < 3 && queue.length) {
    const n = queue.shift()!;
    if (fresh(n.path)) continue;
    running++;
    void warmDir(n).finally(() => { running--; pump(); });
  }
};
export function warmKids(list: Node[]) {
  for (const n of list.filter((x) => x.kind === "dir" && x.handle && !SKIP.has(x.name) && !isOpen(x.path)).slice(0, TREE_WARM_MAX)) queue.push(n);
  pump();
}

// 右クリックの「中の階層をすべて開く・閉じる」。開くときは、このあと現れる中のフォルダも順に開く
// (中身を読むまで下の階層が分からないため)。重いフォルダは除き、数と時間に上限を置く
type Bulk = { path: string; on: boolean; until: number; left: number };
let bulk: Bulk | null = null;
const bulkSubs = new Set<() => void>();
const under = (p: string, root: string) => p === root || p.startsWith(root + "/");
export const subBulk = (f: () => void) => { bulkSubs.add(f); return () => { bulkSubs.delete(f); }; };
export function setAllOpen(path: string, on: boolean) {
  if (!on) {
    const open = get();
    for (const p of [...open]) if (under(p, path)) open.delete(p);
    clearTimeout(timer);
    timer = setTimeout(() => kvSet(KEY, JSON.stringify([...open])), 300);
  }
  bulk = { path, on, until: Date.now() + TREE_EXPAND_MS, left: TREE_EXPAND_MAX };
  bulkSubs.forEach((f) => f());
}
// このフォルダを一括の操作で開く(true)・閉じる(false)か。対象外は undefined
export function bulkFor(path: string, name: string): boolean | undefined {
  const b = bulk;
  if (!b || Date.now() > b.until || !under(path, b.path)) return undefined;
  if (!b.on) return false;
  if (path !== b.path && SKIP.has(name)) return undefined;
  if (b.left <= 0) return undefined;
  return true;
}
export const bulkTake = () => { if (bulk) bulk.left--; };

// 前に読んだフォルダの中身。行が作り直されたとき、スケルトンに戻さず、これを先に出して裏で読み直す
const last = new Map<string, Node[]>();
export const rememberKids = (path: string, kids: Node[]) => {
  last.delete(path);
  last.set(path, kids);
  if (last.size > 600) last.delete(last.keys().next().value as string);
};
export const recallKids = (path: string) => last.get(path);

// 更新の範囲。フォルダの右クリックからは、そのフォルダより下だけを読み直す(rev が一致するときだけ有効。null は全体)
let scope: { rev: number; path: string } | null = null;
export const setRefreshScope = (rev: number, path: string | null) => { scope = path ? { rev, path } : null; };
export const inRefreshScope = (rev: number, path: string) => !scope || scope.rev !== rev || path === scope.path || path.startsWith(scope.path + "/");
