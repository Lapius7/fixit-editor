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
