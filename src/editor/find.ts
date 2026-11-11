import { MAX_OPEN_BYTES } from "@/shared/config";
import { crawl, isJunk, remoteRoot, skipNames, type Node } from "@/platform/fs";
import { RemoteFile, remoteGrep } from "@/platform/remote";
import { getFile } from "@/platform/load";
import { splitRoot } from "@/workbench/rootpath";

export type Opt = { re: boolean; cs: boolean; word: boolean };
export type Hit = { line: number; from: number; to: number; text: string };
export type FileHits = { node: Node; hits: Hit[] };
// 検索の対象を絞る。inc/exc はカンマか改行で区切ったパターン(*.ts, src/**, node_modules など)
export type Scope = { inc: string; exc: string; open: boolean };
export const NO_SCOPE: Scope = { inc: "", exc: "", open: false };

// ".gitignore" に近い書き方。スラッシュなしは、ファイル名かフォルダ名のどこかに一致すれば当たる。スラッシュありは、根からの道筋に一致
function globs(src: string): ((rel: string) => boolean)[] {
  return src.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).map((g) => {
    const anchored = g.includes("/") && !g.startsWith("**/");
    const body = g.replace(/^\.?\//, "").replace(/^\*\*\//, "").replace(/\/+$/, "");
    const re = new RegExp("^" + body.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*") + "$", "i");
    if (!anchored && !body.includes("/")) return (rel: string) => rel.split("/").some((seg) => re.test(seg));
    if (!anchored) { const fl = new RegExp("(?:^|/)" + re.source.slice(1, -1) + "(?:/|$)", "i"); return (rel: string) => fl.test(rel); }
    return (rel: string) => { const parts = rel.split("/"); for (let i = 1; i <= parts.length; i++) if (re.test(parts.slice(0, i).join("/"))) return true; return false; };
  });
}
export function scopeTest(sc: Scope): ((rel: string) => boolean) | null {
  const inc = globs(sc.inc), exc = globs(sc.exc);
  if (!inc.length && !exc.length) return null;
  return (rel) => (!inc.length || inc.some((f) => f(rel))) && !exc.some((f) => f(rel));
}

const BIN = /\.(png|jpe?g|gif|webp|bmp|ico|avif|pdf|docx?|xlsx?|pptx?|zip|7z|gz|tar|rar|exe|dll|so|bin|woff2?|ttf|otf|mp[34]|webm|mov|wav|ogg|flac|sqlite|db|psd|class|o|iso|msi)$/i;

function matcher(q: string, o: Opt): RegExp | null {
  if (!q) return null;
  try {
    let src = o.re ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (o.word) src = `\\b(?:${src})\\b`;
    return new RegExp(src, o.cs ? "g" : "gi");
  } catch { return null; }
}

// 複数のフォルダを順に探して、結果をまとめる
export async function searchRoots(roots: { nodes: Node[]; prefix: string }[], q: string, o: Opt, live: Map<string, string>, signal: { stop: boolean }, onPart: (r: FileHits[]) => void, sc: Scope = NO_SCOPE): Promise<{ files: number; total: number; capped: boolean }> {
  const done: FileHits[] = [];
  const sum = { files: 0, total: 0, capped: false };
  for (const r of roots) {
    if (signal.stop) break;
    let cur: FileHits[] = [];
    const x = await searchAll(r.nodes, q, o, live, signal, (p) => { cur = p; onPart([...done, ...p]); }, r.prefix, sc);
    sum.files += x.files; sum.total += x.total; sum.capped = sum.capped || x.capped;
    done.push(...cur);
  }
  return sum;
}

// フォルダ全体を探す。開いて編集中のタブは、保存前の内容で探す
async function searchAll(nodes: Node[], q: string, o: Opt, live: Map<string, string>, signal: { stop: boolean }, onPart: (r: FileHits[]) => void, prefix = "", sc: Scope = NO_SCOPE): Promise<{ files: number; total: number; capped: boolean }> {
  const re = matcher(q, o);
  const test = scopeTest(sc);
  const relOf = (p: string) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p).replace(/^\/+/, "");
  const allowed = (p: string) => (!test || test(relOf(p))) && (!sc.open || live.has(p));
  if (!re) return { files: 0, total: 0, capped: false };
  const out: FileHits[] = [];
  let total = 0, capped = false;
  const scan = (text: string): Hit[] => {
    const hits: Hit[] = [];
    text.split("\n").forEach((line, i) => {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) {
        if (!m[0]) { re.lastIndex++; continue; }
        if (hits.length < 200) hits.push({ line: i + 1, from: m.index, to: m.index + m[0].length, text: line });
        total++;
      }
    });
    return hits;
  };
  // WSL・SSH は、向こうで grep して結果だけ受け取る(1ファイルずつ読むと遅いため)
  const rr = remoteRoot(nodes, prefix);
  if (rr) {
    const byPath = new Map<string, FileHits>();
    for (const h of sc.open ? [] : await remoteGrep(rr, q, o, skipNames(), 5000)) {
      const hp = prefix + h.rel;
      if (live.has(hp) || BIN.test(h.handle.name) || isJunk(h.handle.name) || signal.stop || !allowed(hp)) continue;
      re.lastIndex = 0;
      const hits = byPath.get(hp) ?? { node: { name: h.handle.name, path: hp, kind: "file" as const, handle: h.handle as unknown as FileSystemHandle }, hits: [] };
      let m: RegExpExecArray | null;
      while ((m = re.exec(h.text))) {
        if (!m[0]) { re.lastIndex++; continue; }
        hits.hits.push({ line: h.line, from: m.index, to: m.index + m[0].length, text: h.text });
        total++;
      }
      if (hits.hits.length) byPath.set(hp, hits);
    }
    out.push(...byPath.values());
    // 開いて編集中のタブは、保存前の内容で探す
    for (const [path, text] of live) {
      const sp = splitRoot(path);
      if (!path.startsWith("/") || sp.prefix !== prefix || (test && !test(relOf(path)))) continue;
      const hits = scan(text);
      if (hits.length) {
        const name = path.split("/").pop()!;
        const n = findNode(nodes, path) ?? { name, path, kind: "file" as const, handle: new RemoteFile(rr.conn, (rr.path === "/" ? "" : rr.path) + sp.rel, name) as unknown as FileSystemHandle };
        out.push({ node: n, hits });
      }
    }
    onPart([...out]);
    return { files: out.length, total, capped: total > 5000 };
  }
  const list = await crawl(nodes, 5000);
  for (const n of list) {
    if (signal.stop) break;
    if (BIN.test(n.name) || !allowed(n.path)) continue;
    let text = live.get(n.path);
    if (text === undefined) {
      try {
        const f = await getFile(n);
        if (f.size > MAX_OPEN_BYTES) continue;
        text = await f.text();
        if (text.includes("\0")) continue;
      } catch { continue; }
    }
    const hits = scan(text);
    if (hits.length) { out.push({ node: n, hits }); onPart([...out]); }
    if (total > 5000) { capped = true; break; }
  }
  return { files: out.length, total, capped };
}

function findNode(nodes: Node[], path: string): Node | null {
  for (const n of nodes) {
    if (n.path === path) return n;
    if (n.children && path.startsWith(n.path + "/")) { const r = findNode(n.children, path); if (r) return r; }
  }
  return null;
}
