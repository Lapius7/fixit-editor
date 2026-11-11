import { IS_TAURI } from "@/shared/chrome"; import { SKIP_DIRS } from "@/shared/config";
import { get } from "@/features/settings/settings";
import { RemoteDir, RemoteFile, isRemote, remoteFind } from "@/platform/remote";
import i18next from 'i18next'

export type Node = { name: string; path: string; kind: "dir" | "file"; handle?: FileSystemHandle; demo?: string; children?: Node[]; parent?: FileSystemDirectoryHandle };

export const supportsFs = () => IS_TAURI || "showDirectoryPicker" in window;
// exe: OS のフォルダ選択ダイアログ(ブラウザの保存確認は出ない)。選んだ絶対パスを返す。キャンセルは null
export async function pickPcFolder(title?: string): Promise<string | null> { const { invoke } = await import("@tauri-apps/api/core"); return invoke<string | null>("pick_folder", { title }); }

export async function pickFolder(): Promise<{ name: string; handle: FileSystemDirectoryHandle }> {
  const handle = await (window as any).showDirectoryPicker({ mode: "readwrite" });
  return { name: handle.name, handle };
}

// 名前の並び: Windows のエクスプローラーと同じく、記号(. _ - など)→数字(2 が 10 より前)→英字(大小を区別しない)→かな→漢字。フォルダが先
const coll = new Intl.Collator("ja", { numeric: true });
// 記号どうしの順は ICU と Windows で違う(ICU は _ が . より先)。最初に違う字が両方とも記号なら、Windows の順で比べる
const SYM = "!#$%&(),.'-;@[]^_`{}~+=";
export const byName = (a: { name: string }, b: { name: string }) => {
  const x = a.name.toLowerCase(), y = b.name.toLowerCase();
  let i = 0; while (i < x.length && x[i] === y[i]) i++;
  const p = SYM.indexOf(x[i] ?? ""), q = SYM.indexOf(y[i] ?? "");
  return p >= 0 && q >= 0 && x[i] && y[i] ? p - q : coll.compare(a.name, b.name);
};
export const nodeOrder = (a: Node, b: Node) => (a.kind === b.kind ? byName(a, b) : a.kind === "dir" ? -1 : 1);

// Windows のエクスプローラーで WSL などへ写すと、代替データストリームが「名前:Zone.Identifier」という普通のファイルになって残る
export const isZoneId = (name: string) => /:Zone\.Identifier$/i.test(name);
export const hideZoneId = () => get().zoneId !== "show";
// 設定が「自動で消す」なら消す(待たない。消せなくても一覧には出さない)
export function dropZoneIds(dir: FileSystemDirectoryHandle, names: string[]) {
  if (get().zoneId === "delete") for (const n of names) void removeEntry(dir, n).catch(() => {});
}

export async function readDir(dir: FileSystemDirectoryHandle, base = ""): Promise<Node[]> {
  const out: Node[] = [], zone: string[] = [];
  for await (const [name, handle] of (dir as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
    const isDir = handle.kind === "directory";
    if (isDir && get().hideBuild && SKIP_DIRS.has(name)) continue;
    if (!isDir && isZoneId(name) && hideZoneId()) { zone.push(name); continue; }
    out.push({ name, path: `${base}/${name}`, kind: isDir ? "dir" : "file", handle, parent: dir });
  }
  dropZoneIds(dir, zone);
  return out.sort(nodeOrder);
}

export async function writeFile(h: FileSystemFileHandle, text: string) {
  const w = await (h as any).createWritable();
  await w.write(text);
  await w.close();
}

// 画像などのバイナリを書く
export async function writeBlob(h: FileSystemFileHandle, blob: Blob) {
  const w = await (h as any).createWritable();
  await w.write(blob);
  await w.close();
}

// 同名のファイルがあるときは、name-2.png のように空いている名前にする(上書きしない)
export async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf("."), b = dot > 0 ? name.slice(0, dot) : name, e = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : `${b}-${i}${e}`;
    try { await dir.getFileHandle(n); } catch { return n; }
  }
}

// フォルダも含めて空いている名前を探す(freeName はファイルしか見ないので、同名のフォルダに混ぜてしまう)
export async function freeEntryName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf("."), b = dot > 0 ? name.slice(0, dot) : name, e = dot > 0 ? name.slice(dot) : "";
  for (let i = 1; ; i++) {
    const n = i === 1 ? name : `${b}-${i}${e}`;
    if (!(await dir.getFileHandle(n).then(() => true, () => false)) && !(await dir.getDirectoryHandle(n).then(() => true, () => false))) return n;
  }
}

// クイックオープン用に、全ファイルを集める(上限つき)
// WSL・SSH は、フォルダを1つずつ開かず、find 1回でまとめて取る
export function remoteRoot(nodes: Node[], prefix = ""): RemoteDir | null {
  const n = nodes[0];
  if (!n || !isRemote(n.handle)) return null;
  const h = n.handle as RemoteDir | RemoteFile;
  const dir = h.path.slice(0, h.path.length - (n.path.length - prefix.length)) || "/";
  return new RemoteDir(h.conn, dir);
}
export const skipNames = () => (get().hideBuild ? [...SKIP_DIRS] : []);

export async function crawl(nodes: Node[], limit = get().crawlLimit, prefix = ""): Promise<Node[]> {
  const rr = remoteRoot(nodes, prefix);
  if (!rr) return crawlLocal(nodes, limit);
  const files = await remoteFind(rr, skipNames(), limit);
  return files.filter((f) => !(hideZoneId() && isZoneId(f.handle.name))).map((f) => ({ name: f.handle.name, path: prefix + f.path, kind: "file" as const, handle: f.handle as unknown as FileSystemHandle }));
}
async function crawlLocal(nodes: Node[], limit: number, out: Node[] = []): Promise<Node[]> {
  for (const n of nodes) {
    if (out.length >= limit) break;
    if (n.kind === "file") out.push(n);
    else {
      const kids = n.children ?? (n.handle ? await readDir(n.handle as FileSystemDirectoryHandle, n.path) : []);
      await crawlLocal(kids, limit, out);
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

// ファイル操作(File System Access API)
export const createFile = (dir: FileSystemDirectoryHandle, name: string) => dir.getFileHandle(name, { create: true });
export const createDir = (dir: FileSystemDirectoryHandle, name: string) => dir.getDirectoryHandle(name, { create: true });
export const removeEntry = (dir: FileSystemDirectoryHandle, name: string) => (dir as any).removeEntry(name, { recursive: true }) as Promise<void>;

// 名前の変更: 新しい名前で書き出してから元を消す(ファイルのみ)
export async function renameFile(dir: FileSystemDirectoryHandle, h: FileSystemFileHandle, to: string) {
  const f = await h.getFile();
  const nh = await dir.getFileHandle(to, { create: true });
  const w = await (nh as any).createWritable();
  await w.write(await f.arrayBuffer());
  await w.close();
  await removeEntry(dir, h.name);
  return nh;
}

// 中身を書き出して写す(フォルダは中も丸ごと)。File System Access API には移動がないため、移すときもこれで写してから元を消す。
// WSL・SSH のハンドル(RemoteDir / RemoteFile)も同じ形なので、そのまま渡せる
export async function copyInto(src: FileSystemHandle, dest: FileSystemDirectoryHandle, name: string): Promise<void> {
  if (src.kind === "file") {
    const f = await (src as FileSystemFileHandle).getFile();
    const w = await ((await dest.getFileHandle(name, { create: true })) as any).createWritable();
    await w.write(await f.arrayBuffer()); await w.close();
    return;
  }
  const d = await dest.getDirectoryHandle(name, { create: true });
  for await (const [n, h] of (src as any).entries() as AsyncIterable<[string, FileSystemHandle]>) await copyInto(h, d, n);
}
export async function moveEntry(from: FileSystemDirectoryHandle, h: FileSystemHandle, dest: FileSystemDirectoryHandle): Promise<FileSystemHandle> {
  if (await dest.getFileHandle(h.name).then(() => true, () => false) || await dest.getDirectoryHandle(h.name).then(() => true, () => false)) throw new Error(i18next.t("同じ名前があります"));
  await copyInto(h, dest, h.name);
  await removeEntry(from, h.name);
  return h.kind === "file" ? dest.getFileHandle(h.name) : dest.getDirectoryHandle(h.name);
}
