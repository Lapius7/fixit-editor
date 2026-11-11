import { kvGet, kvSet, kvWatch, mergeById } from "@/platform/appdata";
import { useSyncExternalStore } from "react";
import { connKey, normConn, type Conn } from "@/platform/remote";
import type { Node } from "@/platform/fs";
import type { Lay } from "@/workbench/layout";
import i18next from 'i18next'

// ワークスペース: 開いているフォルダと、タブ・分割・ターミナルの状態に名前をつけて残したもの。
// WSL・SSH は接続先を、PC のフォルダは IndexedDB にハンドルを残して開き直す。
export type RootRef = { kind: "demo" } | { kind: "local"; name: string } | { kind: "wsl" | "ssh" | "pc"; host?: string; path: string; name: string };
export type TermRef = { name?: string; cwd?: string; shell?: string; label?: string; host?: string | null };
export type WsState = {
  tabs: string[]; act: (string | null)[]; fp: number; split: boolean; // act は画面の番号ごと。fp はフォーカスのある画面の番号
  lay?: Lay; // 画面の分け方(なければ split と設定の向き・割合から作る)
  side: boolean; panel: "files" | "search"; term: boolean; terms: TermRef[]; actTerm: number;
  g?: string[][]; // 分割時、それぞれの画面(番号ごと)に属するタブ
  cur?: Record<string, number>; // タブごとのカーソル位置(パス → 文書の先頭からの位置)
  pv?: { mode?: "split" | "preview"; pin?: string | null; r?: number }; // プレビューの表示・固定・幅の割合
};
// 複数のフォルダを同時に開くとき、2 つ目以降の道しるべ。prefix は、ツリー上のパスの先頭につく「/@xxxx」(先頭のフォルダは空)
export type RootEntry = { ref: RootRef; prefix: string };
export type Workspace = WsState & {
  id: string; name: string; color: string; root: RootRef; roots?: RootEntry[]; profile?: string; pinned?: boolean; updated: number;
};
type Store = { list: Workspace[]; current: string | null };

const COLORS = ["#3b6fd9", "#7a5cf0", "#d6479a", "#e0691f", "#2a9d6c", "#5b6473"];
const KEY = "fixit:workspaces:v1";
const uid = () => Math.random().toString(36).slice(2, 9);

function load(raw: string | null = kvGet(KEY)): Store {
  try {
    const r = JSON.parse(raw || "null") as Store | null;
    if (r && Array.isArray(r.list)) return { list: r.list.filter((w) => w && typeof w.id === "string" && w.root), current: typeof r.current === "string" ? r.current : null };
  } catch { /* 読めなければ空から */ }
  return { list: [], current: null };
}
let st: Store = load();
const subs = new Set<() => void>();
const set = (next: Store) => {
  st = next;
  try { kvSet(KEY, JSON.stringify(st)); } catch { /* 保存できない */ }
  subs.forEach((f) => f());
};
export const getWorkspaces = () => st;
export const useWorkspaces = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);
export const findWs = (id: string | null) => st.list.find((w) => w.id === id) ?? null;
// 開いているフォルダの一覧(古い保存形式は、単一のフォルダとして読む)
export const wsRoots = (w: Workspace): RootEntry[] => (w.roots?.length ? w.roots : [{ ref: w.root, prefix: "" }]);
// ハンドルの保存キー。先頭のフォルダはワークスペースの ID そのまま(従来と同じ)
export const handleKey = (id: string, prefix: string) => id + prefix;

export const rootRefOf = (conn: Conn | undefined, name: string, hasHandle: boolean): RootRef =>
  conn ? { kind: conn.kind, host: conn.host, path: conn.path, name } : hasHandle ? { kind: "local", name } : { kind: "demo" };
export const connOf = (r: RootRef): Conn | null => (r.kind === "wsl" || r.kind === "ssh" || r.kind === "pc" ? normConn({ kind: r.kind, host: r.host, path: r.path }) : null);
export const rootLabel = (r: RootRef) => (r.kind === "demo" ? i18next.t("サンプル") : r.kind === "local" ? i18next.t("PC · {{name}}", { name: r.name }) : r.kind === "pc" ? i18next.t("PC · {{path}}", { path: r.path }) : r.kind === "ssh" ? i18next.t("SSH · {{host}}:{{path}}", { host: r.host, path: r.path }) : i18next.t("WSL · {{path}}", { path: r.path }));

// 一覧に出す名前。複数のフォルダを開いているときは「+ 残りの数」をつける
// 複数のフォルダをまとめたものは、数を先に出して 1 つのフォルダと見分けやすくする
export const wsLabel = (w: Workspace) => (w.roots && w.roots.length > 1 ? i18next.t("{{n}} フォルダ: {{first}} ほか", { n: w.roots.length, first: rootLabel(w.root) }) : rootLabel(w.root));

// 保存数の上限を超えたら、固定していない古いものから消す
function trim(list: Workspace[], keep: string, max: number): Workspace[] {
  if (list.length <= max) return list;
  const drop = new Set(
    list.filter((w) => !w.pinned && w.id !== keep).sort((a, b) => a.updated - b.updated).slice(0, list.length - max).map((w) => w.id),
  );
  list.filter((w) => drop.has(w.id)).forEach((w) => wsRoots(w).forEach((o) => delHandle(handleKey(w.id, o.prefix))));
  return list.filter((w) => !drop.has(w.id));
}

export function createWs(name: string, root: RootRef, state: WsState, max = 30, profile?: string): Workspace {
  const w: Workspace = { id: uid(), name: name.trim() || i18next.t("ワークスペース"), color: COLORS[st.list.length % COLORS.length], root, profile, updated: Date.now(), ...state };
  set({ ...st, list: trim([...st.list, w], w.id, max) });
  return w;
}
export const saveState = (id: string, state: WsState) => {
  const w = findWs(id);
  if (!w || JSON.stringify({ ...w, updated: 0 }) === JSON.stringify({ ...w, ...state, updated: 0 })) return;
  set({ ...st, list: st.list.map((x) => (x.id === id ? { ...x, ...state, updated: Date.now() } : x)) });
};
export const patchWs = (id: string, patch: Partial<Pick<Workspace, "name" | "color" | "profile" | "pinned" | "root">>) =>
  set({ ...st, list: st.list.map((x) => (x.id === id ? { ...x, ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() || x.name } : {}) } : x)) });
// 開いているフォルダの一覧を保存する(1 つだけなら roots は持たない)
export function setWsRoots(id: string, list: RootEntry[]) {
  const w = findWs(id);
  if (!w || !list.length) return;
  const multi = list.length > 1 || !!list[0].prefix;
  const gone = wsRoots(w).filter((o) => !list.some((x) => x.prefix === o.prefix));
  gone.forEach((o) => delHandle(handleKey(id, o.prefix)));
  set({ ...st, list: st.list.map((x) => (x.id === id ? { ...x, root: list[0].ref, roots: multi ? list : undefined, updated: Date.now() } : x)) });
}
export const removeWs = (id: string) => { const w = findWs(id); (w ? wsRoots(w) : [{ prefix: "" }]).forEach((o) => delHandle(handleKey(id, o.prefix))); set({ list: st.list.filter((w) => w.id !== id), current: st.current === id ? null : st.current }); };
export const setCurrent = (id: string | null) => { if (st.current !== id) set({ ...st, current: id }); };

// 同じフォルダのワークスペースを探す(WSL・SSH は接続先で、PC のフォルダはハンドルの同一判定で)
export async function matchRoot(root: RootRef, handle?: FileSystemDirectoryHandle): Promise<Workspace | null> {
  if (root.kind === "wsl" || root.kind === "ssh" || root.kind === "pc") {
    const k = connKey(connOf(root)!);
    return st.list.find((w) => { const c = connOf(w.root); return c && connKey(c) === k; }) ?? null;
  }
  if (root.kind === "local" && handle) {
    for (const w of st.list) {
      if (w.root.kind !== "local") continue;
      const h = await getHandle(w.id);
      try { if (h && (await h.isSameEntry(handle))) return w; } catch { /* 比べられない */ }
    }
  }
  return null;
}

// ---- ハンドルの保存(IndexedDB) ----
const db = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open("fixit-ws", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("handles");
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const d = await db();
    return await new Promise<T>((res, rej) => { const q = f(d.transaction("handles", mode).objectStore("handles")); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  } catch { return undefined; }
}
export const putHandle = (id: string, h: FileSystemDirectoryHandle) => tx("readwrite", (s) => s.put(h, id));
export const getHandle = (id: string) => tx<FileSystemDirectoryHandle>("readonly", (s) => s.get(id) as IDBRequest<FileSystemDirectoryHandle>);
const delHandle = (id: string) => tx("readwrite", (s) => s.delete(id));

type Perm = { queryPermission?: (o: object) => Promise<string>; requestPermission?: (o: object) => Promise<string> };
export async function canUse(h: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const p = h as unknown as Perm, o = { mode: "readwrite" };
  try {
    if ((await p.queryPermission?.(o)) === "granted") return true;
    return ask && (await p.requestPermission?.(o)) === "granted";
  } catch { return false; }
}

// 相対パスから、ファイルの Node を作る(開き直し用)。無ければ null
export async function nodeAt(root: FileSystemDirectoryHandle, path: string, prefix = ""): Promise<Node | null> {
  const parts = path.slice(prefix.length).split("/").filter(Boolean);
  if (!parts.length) return null;
  try {
    let dir = root;
    for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
    const name = parts[parts.length - 1];
    return { name, path, kind: "file", handle: await dir.getFileHandle(name), parent: dir };
  } catch { return null; }
}

// ---- 書き出し・読み込み(PC のフォルダはハンドルを持ち出せないので含めない) ----
export const exportWorkspaces = () => JSON.stringify({ fixitWorkspaces: 1, list: st.list.filter((w) => w.root.kind !== "local") }, null, 2);
export function importWorkspaces(text: string, max = 30): number {
  const r = JSON.parse(text);
  if (!r || !Array.isArray(r.list)) throw new Error(i18next.t("ワークスペースのファイルではありません"));
  let n = 0;
  const list = [...st.list];
  for (const w of r.list as Workspace[]) {
    if (!w || typeof w.name !== "string" || !w.root || w.root.kind === "local") continue;
    list.push({ ...w, id: uid(), tabs: Array.isArray(w.tabs) ? w.tabs : [], terms: Array.isArray(w.terms) ? w.terms : [], pinned: false, updated: Date.now() });
    n++;
  }
  set({ ...st, list: trim(list, "", max) });
  return n;
}

export function ago(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return i18next.t("たった今");
  if (s < 3600) return i18next.t("{{arg0}}分前", { arg0: Math.floor(s / 60) });
  if (s < 86400) return i18next.t("{{arg0}}時間前", { arg0: Math.floor(s / 3600) });
  return i18next.t("{{arg0}}日前", { arg0: Math.floor(s / 86400) });
}

// 他のウィンドウが一覧を変えたら取り込む。「いま開いているもの(current)」は、このウィンドウのものを保つ
export function reloadFromStore(f: string | null = kvGet(KEY), dirty = false) {
  const theirs = load(f);
  const list = dirty ? mergeById(st.list, theirs.list, (a, b) => (b.updated > a.updated ? b : a)) : theirs.list;
  st = { list, current: st.current };
  if (dirty) { try { kvSet(KEY, JSON.stringify(st)); } catch { /* 保存できない */ } }
  subs.forEach((f) => f());
}
kvWatch(KEY, (f, dirty) => reloadFromStore(f, dirty));
