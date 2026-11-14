// dela の「プロジェクト」(.delaconfig を置くフォルダ)を探す・調べる・作り直す。
// .delaconfig には秘密のトークンが入るので、中身はここでは読まない。URL は `dela info` の出力から取る。
import { RemoteDir, execCmd } from "@/platform/remote";
import type { Conn } from "@/platform/remote";
import { stripAnsi } from "./dela";

// config: そのフォルダに .delaconfig がある / repo: git リポジトリのルート(dela はここに .delaconfig を作る)
export type Proj = { dir: string; rel: string; config: boolean; repo: boolean };

const SKIP = new Set(["node_modules", "target", "dist", "build", "vendor", "__pycache__", "venv"]);
const DEPTH = 4; // 開いたフォルダから数えて、ここより深くは探さない
const MAX_DIRS = 500; // 調べるフォルダの数の上限(巨大なフォルダで固まらないように)
const MAX_FOUND = 60;
const join = (a: string, b: string) => (a.endsWith("/") ? a + b : `${a}/${b}`);

// 非ログインのシェルは、pnpm の bin も node(mise・volta・nvm などで入れたもの)も PATH に無いことが多い。
// dela は node で動くので、よくある置き場所を足してから呼ぶ(対話型のシェルは重く、返ってこないことがあるので使わない)
const PATHS = [
  'P="${PNPM_HOME:-$HOME/.local/share/pnpm}:${PNPM_HOME:-$HOME/.local/share/pnpm}/bin:$HOME/.local/share/pnpm/bin:$HOME/.bun/bin:$HOME/.volta/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/fnm/aliases/default/bin:/usr/local/bin"',
  'for d in "$HOME"/.local/share/mise/installs/node/*/bin "$HOME"/.nvm/versions/node/*/bin "$HOME"/.local/share/fnm/node-versions/*/installation/bin; do [ -d "$d" ] && P="$P:$d"; done',
  'export PATH="$P:$PATH"; ',
].join("; ");
const viaShell = (sub: string) => `${PATHS}dela ${sub} 2>&1 </dev/null`;

// 開いたフォルダ以下で、.delaconfig があるフォルダと git リポジトリを、幅優先で集める。開いたフォルダ自身は rel を "" として含める
export async function findProjects(conn: Conn, root: string, signal?: { stop: boolean }): Promise<Proj[]> {
  const out: Proj[] = [];
  let queue = [{ dir: root, rel: "" }];
  let scanned = 0;
  for (let depth = 0; depth <= DEPTH && queue.length && scanned < MAX_DIRS; depth++) {
    const next: typeof queue = [];
    for (let i = 0; i < queue.length; i += 8) {
      if (signal?.stop) return [];
      await Promise.all(queue.slice(i, i + 8).map(async (q) => {
        if (scanned++ >= MAX_DIRS) return;
        const names: [string, boolean][] = [];
        try { for await (const [name, h] of new RemoteDir(conn, q.dir).entries()) names.push([name, h.kind === "directory"]); } catch { return; }
        const config = names.some(([n, d]) => n === ".delaconfig" && !d);
        const repo = names.some(([n]) => n === ".git");
        if (config || repo || depth === 0) out.push({ ...q, config, repo });
        for (const [n, d] of names) if (d && !n.startsWith(".") && !SKIP.has(n)) next.push({ dir: join(q.dir, n), rel: q.rel ? `${q.rel}/${n}` : n });
      }));
    }
    queue = next;
  }
  // 開いたフォルダを先頭に、あとは .delaconfig があるものを先、名前順
  return out.slice(0, MAX_FOUND).sort((a, b) => (a.rel === "" ? -1 : b.rel === "" ? 1 : +b.config - +a.config || a.rel.localeCompare(b.rel)));
}

const URL_ALL = /https:\/\/[a-z0-9][a-z0-9-]*\.try\.lapius7\.si\b[^\s"'<>]*/gi;
export const findUrls = (text: string): string[] => [...new Set((stripAnsi(text).match(URL_ALL) ?? []).map((u) => u.replace(/[.,;:)\]]+$/, "")))];

const tail = (s: string) => stripAnsi(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 160);

// dela 0.5 以降の `info --json` / `list --json` の出力から URL を取る(token は出力に含まれない)。古い dela や JSON でない出力は null
const parseJson = (text: string): unknown => { try { return JSON.parse(stripAnsi(text).trim()); } catch { return null; } };
const urlOf = (x: unknown): string[] => { const u = (x as { url?: unknown } | null)?.url; return typeof u === "string" && /^https:\/\//.test(u) ? [u] : []; };
export function urlsFromInfoJson(text: string): string[] | null {
  const j = parseJson(text) as { found?: unknown; running?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.found !== "boolean") return null;
  const run = Array.isArray(j.running) ? j.running.flatMap(urlOf) : [];
  return [...new Set([...urlOf(j), ...run])];
}
export function urlsFromListJson(text: string): string[] | null {
  const j = parseJson(text);
  return Array.isArray(j) ? [...new Set(j.flatMap(urlOf))] : null;
}

// そのフォルダ直下に .delaconfig があるか(中身は読まない)
export async function hasDelaConfig(conn: Conn, dir: string): Promise<boolean> {
  try { for await (const [name, h] of new RemoteDir(conn, dir).entries()) if (name === ".delaconfig" && h.kind !== "directory") return true; } catch { /* 読めなければ無いものとする */ }
  return false;
}

export type Info = { ok: boolean; urls: string[]; note: string };
// そのフォルダで `dela info` を動かし、このプロジェクトの URL を取る(サブフォルダなら親の .delaconfig が使われる)
export async function delaInfo(conn: Conn, dir: string): Promise<Info> {
  try {
    // 新しい dela は --json で、公開中の別サービスの URL まで返す。古い dela は引数を無視して文章を出すので、その場合は従来どおり文章から URL を拾う
    const j = await execCmd(conn, dir, viaShell("info --json"), 30);
    const urls = j.code === 0 ? urlsFromInfoJson(j.out) : null;
    if (urls) return { ok: true, urls, note: "" };
    const r = j.code === 0 ? j : await execCmd(conn, dir, viaShell("info"), 30);
    return { ok: r.code === 0, urls: findUrls(r.out), note: tail(r.out) };
  } catch (e) { return { ok: false, urls: [], note: String((e as Error)?.message ?? e).slice(0, 160) }; }
}

// サブドメインを作り直す(古い URL は無効になる)。呼び出し側で確認してから呼ぶ
export async function delaRenew(conn: Conn, dir: string): Promise<Info> {
  try {
    const r = await execCmd(conn, dir, viaShell("renew"), 60);
    return { ok: r.code === 0, urls: findUrls(r.out), note: tail(r.out) };
  } catch (e) { return { ok: false, urls: [], note: String((e as Error)?.message ?? e).slice(0, 160) }; }
}

// 起動中のトンネルの URL(dela list。全プロジェクト分が出る)。どのプロジェクトのものかは、URL の <名前>-<id> の id で分かる
export async function delaRunning(conn: Conn, dir: string): Promise<string[]> {
  try {
    const r = await execCmd(conn, dir, viaShell("list --json"), 20);
    return urlsFromListJson(r.out) ?? findUrls(r.out);
  } catch { return []; }
}
export const urlId = (u: string): string | undefined => /^https:\/\/[a-z0-9-]*?-([a-z0-9]{10})\.try\./i.exec(u)?.[1];
