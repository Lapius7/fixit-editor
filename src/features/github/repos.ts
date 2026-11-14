import { RemoteDir } from "@/platform/remote";
import type { Conn } from "@/platform/remote";
import { gitRead } from "@/features/git/git";
import { parseRemotes, type Remote } from "./api";

// 開いているフォルダの中にある、GitHub のリモートを持つ Git リポジトリ
export type Found = { dir: string; rel: string; remotes: Remote[] };

const SKIP = new Set(["node_modules", "target", "dist", "build", "vendor", "__pycache__", "venv"]);
const DEPTH = 6; // 開いたフォルダから数えて、ここより深くは探さない
const MAX_DIRS = 800; // 調べるフォルダの数の上限(巨大なフォルダで固まらないように)
const MAX_REPOS = 80;

const join = (a: string, b: string) => (a.endsWith("/") ? a + b : `${a}/${b}`);

// フォルダを幅優先でたどり、`.git` があるフォルダを集める。リポジトリの中へは入らない。
// plain: 開いたフォルダの直下にある、リポジトリではないフォルダ(Git 化の候補)
export type Walked = { repos: { dir: string; rel: string }[]; plain: { dir: string; rel: string }[] };
export async function walkRepos(conn: Conn, root: string, signal?: { stop: boolean }): Promise<Walked> {
  const dirs: { dir: string; rel: string }[] = [];
  const plain: { dir: string; rel: string }[] = [];
  let queue = [{ dir: root, rel: "" }];
  let scanned = 0;
  for (let depth = 0; depth <= DEPTH && queue.length && scanned < MAX_DIRS && dirs.length < MAX_REPOS; depth++) {
    const next: typeof queue = [];
    for (let i = 0; i < queue.length; i += 8) {
      if (signal?.stop) return { repos: [], plain: [] };
      await Promise.all(queue.slice(i, i + 8).map(async (q) => {
        if (scanned++ >= MAX_DIRS) return;
        let list: [string, "dir" | "file"][] = [];
        try { for await (const [name, h] of new RemoteDir(conn, q.dir).entries()) list.push([name, h.kind === "directory" ? "dir" : "file"]); } catch { return; }
        if (list.some(([n]) => n === ".git")) { dirs.push(q); return; }
        if (depth === 1) plain.push(q);
        for (const [n, k] of list) if (k === "dir" && !n.startsWith(".") && !SKIP.has(n)) next.push({ dir: join(q.dir, n), rel: q.rel ? `${q.rel}/${n}` : n });
      }));
    }
    queue = next;
  }
  const by = (a: { rel: string }, b: { rel: string }) => a.rel.localeCompare(b.rel);
  return { repos: dirs.slice(0, MAX_REPOS).sort(by), plain: plain.sort(by) };
}

// GitHub のリモートを持つリポジトリだけに絞る
export async function findRepos(conn: Conn, root: string, signal?: { stop: boolean }): Promise<Found[]> {
  const dirs = (await walkRepos(conn, root, signal)).repos;
  const out = await Promise.all(dirs.slice(0, MAX_REPOS).map(async (d): Promise<Found | null> => {
    try {
      const remotes = parseRemotes(await gitRead(conn, d.dir, { cmd: "remotes" }));
      return remotes.length ? { ...d, remotes } : null;
    } catch { return null; }
  }));
  return out.filter((x): x is Found => !!x).sort((a, b) => a.rel.localeCompare(b.rel));
}

// 一覧の中で、既定として開くリポジトリ(開いたフォルダそのもの、または 1 件だけのとき)
export function defaultRepo(found: Found[], root: string): Found | undefined {
  return found.find((f) => f.dir === root) ?? (found.length === 1 ? found[0] : undefined);
}

// ---- 探索結果のキャッシュ(開いたフォルダの .fixit/repos.json) ----
// 先に前回の結果を見せ、裏で探し直して差し替える。壊れていても、書けなくても、使わない・書かないだけで通常どおり動く。
// 中身はパスと owner/repo だけ(GitHub の取得結果は入れない)。.fixit/ には .gitignore を置き、リポジトリに混ざらないようにする。
const DIR = ".fixit", FILE = "repos.json", VER = 1, MAX_AGE = 30 * 24 * 3600 * 1000;

const okRemote = (r: unknown): r is Remote => { const x = r as Remote; return !!x && [x.name, x.url, x.owner, x.repo].every((v) => typeof v === "string" && v.length > 0 && v.length < 500); };
const okFound = (f: unknown): f is Found => { const x = f as Found; return !!x && typeof x.dir === "string" && typeof x.rel === "string" && Array.isArray(x.remotes) && x.remotes.length > 0 && x.remotes.every(okRemote); };

export async function loadCache(conn: Conn, root: string): Promise<Found[] | null> {
  try {
    const d = await new RemoteDir(conn, root).getDirectoryHandle(DIR);
    const j = JSON.parse(await (await (await d.getFileHandle(FILE)).getFile()).text()) as { v?: number; root?: string; at?: number; found?: unknown[] };
    // 版・フォルダ・期限が合わないものは使わない(フォルダごと移した場合、パスが食い違う)
    if (j.v !== VER || j.root !== root || typeof j.at !== "number" || Date.now() - j.at > MAX_AGE || !Array.isArray(j.found)) return null;
    const found = j.found.filter(okFound).filter((f) => f.dir === root || f.dir.startsWith(root.endsWith("/") ? root : root + "/"));
    return found.length ? found : null;
  } catch { return null; }
}

export async function saveCache(conn: Conn, root: string, found: Found[]): Promise<void> {
  try {
    const top = new RemoteDir(conn, root);
    // 見つからなかったときは、フォルダを新しく作らない(あれば空で上書きして、古い結果を消す)
    let d: RemoteDir;
    try { d = await top.getDirectoryHandle(DIR); } catch { if (!found.length) return; d = await top.getDirectoryHandle(DIR, { create: true }); }
    try { await d.getFileHandle(".gitignore"); } catch { const w = await (await d.getFileHandle(".gitignore", { create: true })).createWritable(); await w.write("*\n"); await w.close(); }
    const w = await (await d.getFileHandle(FILE, { create: true })).createWritable();
    await w.write(JSON.stringify({ v: VER, root, at: Date.now(), found }));
    await w.close();
  } catch { /* 読み取り専用のフォルダや、書けない接続先では、キャッシュなしで動く */ }
}

// 再検索の結果に、前回(や作った直後)のキャッシュにあって、今もリモートを持つリポジトリを足す。探索の深さや数の上限の外にあるものを失わないため
export async function mergeKnown(conn: Conn, root: string, found: Found[]): Promise<Found[]> {
  const known = (await loadCache(conn, root)) ?? [];
  const out = [...found];
  for (const k of known) {
    if (out.some((f) => f.dir === k.dir)) continue;
    try {
      const remotes = parseRemotes(await gitRead(conn, k.dir, { cmd: "remotes" }));
      if (remotes.length) out.push({ ...k, remotes });
    } catch { /* フォルダが消えた・Git でなくなった */ }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
