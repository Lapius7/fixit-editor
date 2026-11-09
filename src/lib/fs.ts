import { MAX_OPEN_BYTES, SKIP_DIRS } from "./config";

export type Node = { name: string; path: string; kind: "dir" | "file"; handle?: FileSystemHandle; demo?: string; children?: Node[] };

export const supportsFs = () => "showDirectoryPicker" in window;

export async function pickFolder(): Promise<{ name: string; handle: FileSystemDirectoryHandle }> {
  const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  return { name: handle.name, handle };
}

export async function readDir(dir: FileSystemDirectoryHandle, base = ""): Promise<Node[]> {
  const out: Node[] = [];
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    const isDir = handle.kind === "directory";
    if (isDir && SKIP_DIRS.has(name)) continue;
    out.push({ name, path: `${base}/${name}`, kind: isDir ? "dir" : "file", handle });
  }
  return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, "ja", { numeric: true }) : a.kind === "dir" ? -1 : 1));
}

export async function readFile(h: FileSystemFileHandle): Promise<string> {
  const f = await h.getFile();
  if (f.size > MAX_OPEN_BYTES) throw new Error("ファイルが大きすぎます");
  return f.text();
}

export async function writeFile(h: FileSystemFileHandle, text: string) {
  const w = await (h as any).createWritable();
  await w.write(text);
  await w.close();
}

// クイックオープン用に、全ファイルを集める(上限つき)
export async function crawl(nodes: Node[], limit = 3000, out: Node[] = []): Promise<Node[]> {
  for (const n of nodes) {
    if (out.length >= limit) break;
    if (n.kind === "file") out.push(n);
    else {
      const kids = n.children ?? (n.handle ? await readDir(n.handle as FileSystemDirectoryHandle, n.path) : []);
      await crawl(kids, limit, out);
    }
  }
  return out;
}

// 文字が順に含まれていれば一致。連続や先頭に近いほど高得点
export function fuzzy(query: string, target: string): number {
  const q = query.toLowerCase(), t = target.toLowerCase();
  let ti = 0, score = 0, run = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    run = at === ti ? run + 1 : 0;
    score += 1 + run * 2 - Math.min(at - ti, 5) * 0.2 + (at === 0 || "/._- ".includes(t[at - 1]) ? 3 : 0);
    ti = at + 1;
  }
  return score - t.length * 0.02;
}
