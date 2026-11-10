import { kvGet, kvSet } from "@/platform/appdata";
import { get } from "@/features/settings/settings";
import i18next from 'i18next'
import { IS_TAURI } from "@/shared/chrome";

// WSL(このPC)と SSH 先のファイルを、File System Access API のハンドルと同じ形で扱う。
// 実際の読み書きは、開発サーバーの /__fs が行う。
export type Conn = { kind: "wsl" | "ssh" | "pc"; host?: string; path: string }; // pc: この PC のフォルダ(exe のみ。Windows は C:/... の形)

class RemoteError extends Error {
  constructor(message: string, public code = "EIO", public status = 500) { super(message); }
}

export const connLabel = (c: Conn) => (c.kind === "ssh" ? i18next.t("SSH · {{host}}", { host: c.host }) : c.kind === "pc" ? i18next.t("PC") : "WSL");
export const connKey = (c: Conn) => `${c.kind}:${c.host ?? ""}:${c.path}`;
export const sshUrl = (c: Conn, abs: string) => (c.kind === "ssh" ? `ssh://${c.host}${abs}` : abs);

const dirPrefix = (p: string) => (p.endsWith("/") ? p : `${p}/`); // "/" や "C:/" の直下を作るとき、区切りを重ねない
const join = (a: string, b: string) => dirPrefix(a) + b;
const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "/";

// exe(Tauri)では、開発サーバーの代わりに Rust 側(fs_op / fs_write)が同じ操作を行う
async function callTauri(op: string, q: Record<string, string>, body?: BodyInit): Promise<Response> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    if (body === undefined) return new Response(await invoke<ArrayBuffer>("fs_op", { op, q }));
    const buf = await new Response(body).arrayBuffer();
    return new Response(await invoke<ArrayBuffer>("fs_write", buf, { headers: { "x-fixit-q": encodeURIComponent(JSON.stringify({ op, q })) } }));
  } catch (e) {
    const x = e as { error?: string; code?: string; status?: number };
    throw new RemoteError(x?.error ?? String(e), x?.code ?? "EIO", x?.status ?? 500);
  }
}

async function call(c: Conn, op: string, params: Record<string, string> = {}, init: RequestInit = {}): Promise<Response> {
  const q = new URLSearchParams({ kind: c.kind, timeout: String(get().sshTimeout), maxMB: String(get().remoteMaxMB), ...(c.host ? { host: c.host } : {}), ...params });
  if (IS_TAURI) return callTauri(op, Object.fromEntries(q), init.method === "POST" ? (init.body ?? new Blob([])) : undefined);
  let r: Response;
  try { r = await fetch(`/__fs/${op}?${q}`, { ...init, headers: { "X-Fixit": "1" }, cache: "no-store" }); }
  catch { throw new RemoteError(i18next.t("開発サーバーに接続できません"), "ECONN", 0); }
  if (!r.ok) {
    let j: { error?: string; code?: string } = {};
    try { j = await r.json(); } catch { /* 本文なし */ }
    throw new RemoteError(j.error ?? i18next.t("失敗しました(HTTP {{status}})", { status: r.status }), j.code ?? "EIO", r.status);
  }
  return r;
}
const json = async <T,>(c: Conn, op: string, params?: Record<string, string>) => (await call(c, op, params)).json() as Promise<T>;
const post = (c: Conn, op: string, params: Record<string, string>, body?: BodyInit) => call(c, op, params, { method: "POST", body });

export type Entry = { name: string; kind: "dir" | "file"; size: number; mtime: number };

export class RemoteFile {
  readonly kind = "file" as const;
  constructor(readonly conn: Conn, readonly path: string, readonly name: string, public size = 0, public mtime = 0) {}
  async getFile(): Promise<File> {
    const buf = await (await call(this.conn, "read", { path: this.path })).arrayBuffer();
    return new File([buf], this.name, this.mtime ? { lastModified: this.mtime } : {});
  }
  async createWritable() {
    const parts: BlobPart[] = [];
    return {
      write: async (d: unknown) => { parts.push(d as BlobPart); },
      close: async () => { await post(this.conn, "write", { path: this.path }, new Blob(parts)); },
    };
  }
}

export class RemoteDir {
  readonly kind = "directory" as const;
  readonly name: string;
  constructor(readonly conn: Conn, readonly path: string) { this.name = baseName(path); }
  async *entries(): AsyncGenerator<[string, RemoteDir | RemoteFile]> {
    const { entries } = await json<{ entries: Entry[] }>(this.conn, "list", { path: this.path });
    for (const e of entries) yield [e.name, e.kind === "dir" ? new RemoteDir(this.conn, join(this.path, e.name)) : new RemoteFile(this.conn, join(this.path, e.name), e.name, e.size, e.mtime)];
  }
  async getFileHandle(name: string, o?: { create?: boolean }) {
    const p = join(this.path, name);
    const { stat } = await json<{ stat: { kind: string } | null }>(this.conn, "stat", { path: p });
    if (!stat) {
      if (!o?.create) throw new RemoteError(i18next.t("見つかりません"), "ENOENT", 404);
      await post(this.conn, "write", { path: p }, new Blob([]));
    } else if (stat.kind === "dir") throw new RemoteError(i18next.t("フォルダです"), "EISDIR", 400);
    return new RemoteFile(this.conn, p, name);
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    const p = join(this.path, name);
    const { stat } = await json<{ stat: { kind: string } | null }>(this.conn, "stat", { path: p });
    if (!stat) {
      if (!o?.create) throw new RemoteError(i18next.t("見つかりません"), "ENOENT", 404);
      await post(this.conn, "mkdir", { path: p });
    } else if (stat.kind !== "dir") throw new RemoteError(i18next.t("ファイルです"), "ENOTDIR", 400);
    return new RemoteDir(this.conn, p);
  }
  // 別のフォルダへ移す(同じ接続先の中だけ)
  async moveTo(name: string, dest: RemoteDir) { await post(this.conn, "mv", { path: join(this.path, name), to: join(dest.path, name) }); }
  async removeEntry(name: string) { await post(this.conn, "rm", { path: join(this.path, name) }); }
  // 名前の変更(フォルダも可)。同じ名前があれば失敗する
  async rename(from: string, to: string) { await post(this.conn, "mv", { path: join(this.path, from), to: join(this.path, to) }); }
}

export type RemoteHandle = RemoteDir | RemoteFile;
export const isRemote = (h: unknown): h is RemoteHandle => h instanceof RemoteDir || h instanceof RemoteFile;
export const rootHandle = (c: Conn) => new RemoteDir(c, c.path);

export async function homeOf(c: Pick<Conn, "kind" | "host">): Promise<string> {
  return (await json<{ path: string }>({ ...c, path: "/" }, "home")).path;
}
export async function listHosts(): Promise<{ name: string; hostname?: string; user?: string }[]> {
  try { return (await json<{ hosts: { name: string; hostname?: string; user?: string }[] }>({ kind: "wsl", path: "/" }, "hosts")).hosts; } catch { return []; }
}
export async function checkDir(c: Conn): Promise<void> {
  const { stat } = await json<{ stat: { kind: string } | null }>(c, "stat", { path: c.path });
  if (!stat) throw new RemoteError(i18next.t("そのフォルダは見つかりません"), "ENOENT", 404);
  if (stat.kind !== "dir") throw new RemoteError(i18next.t("フォルダではありません"), "ENOTDIR", 400);
}

// 全ファイルの一覧を、SSH 1回でまとめて取る(フォルダを1つずつ開くと遅いため)
export async function remoteFind(root: RemoteDir, skip: string[], limit: number): Promise<{ path: string; handle: RemoteFile }[]> {
  const { files } = await json<{ files: string[] }>(root.conn, "find", { path: root.path, skip: skip.join(","), limit: String(limit) });
  const pre = dirPrefix(root.path);
  return files.filter((f) => f.startsWith(pre)).map((f) => ({ path: "/" + f.slice(pre.length), handle: new RemoteFile(root.conn, f, baseName(f)) }));
}

export type RemoteHit = { path: string; line: number; text: string };
export async function remoteGrep(root: RemoteDir, q: string, o: { re: boolean; cs: boolean; word: boolean }, skip: string[], limit: number): Promise<{ rel: string; handle: RemoteFile; line: number; text: string }[]> {
  let pat = q;
  if (o.re) {
    // grep -E に無い JavaScript の書き方を直す。直せないものは断る
    pat = pat.replace(/\\d/g, "[0-9]").replace(/\\D/g, "[^0-9]").replace(/\(\?:/g, "(");
    if (/\(\?|[*+?}]\?/.test(pat)) throw new RemoteError(i18next.t("この正規表現は、リモートの検索では使えません(先読み・最短一致など)"), "EARG", 400);
  }
  const { hits } = await json<{ hits: RemoteHit[] }>(root.conn, "grep", { path: root.path, q: pat, re: o.re ? "1" : "0", cs: o.cs ? "1" : "0", word: o.word ? "1" : "0", skip: skip.join(","), limit: String(limit) });
  const pre = dirPrefix(root.path);
  return hits.filter((h) => h.path.startsWith(pre)).map((h) => ({ rel: "/" + h.path.slice(pre.length), handle: new RemoteFile(root.conn, h.path, baseName(h.path)), line: h.line, text: h.text }));
}

// ---- 入力の整え ----
// \\wsl$\Distro\x・\\wsl.localhost\Distro\x(スラッシュ区切りも可)→ /x。WSL の UNC パスでなければ null
export function wslUncPath(input: string): string | null {
  const m = /^[\\/]{2}wsl(?:\$|\.localhost)[\\/][^\\/]+((?:[\\/].*)?)$/i.exec(input.trim().replace(/^["']|["']$/g, ""));
  return m ? m[1].replace(/\\/g, "/").replace(/\/+$/, "") || "/" : null;
}
// 開いた場所が WSL の UNC パスなら、PC ではなく WSL の絶対パス(/home/…)として扱う
export const normConn = (c: Conn): Conn => { const w = c.kind === "pc" ? wslUncPath(c.path) : null; return w ? { kind: "wsl", path: w } : c; };

// Windows のパスを WSL のパスにする。C:\x → /mnt/c/x、\\wsl$\Distro\x → /x
function toWslPath(input: string): string {
  let s = input.trim().replace(/^["']|["']$/g, "");
  const unc = wslUncPath(s);
  if (unc) return unc;
  const drive = /^([A-Za-z]):[\\/]?(.*)$/.exec(s);
  if (drive) return `/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`.replace(/\/+$/, "") || "/";
  s = s.replace(/\\/g, "/");
  return s;
}
// ssh://host/path や user@host:/path を分解する
export function parseTarget(input: string): { host?: string; path: string } {
  const s = input.trim();
  const u = /^ssh:\/\/([^/]+)(\/.*)?$/.exec(s);
  if (u) return { host: u[1], path: u[2] ?? "" };
  const sc = /^([A-Za-z0-9._@-]+):(\/.*|~.*)$/.exec(s);
  if (sc && !/^[A-Za-z]$/.test(sc[1])) return { host: sc[1], path: sc[2] };
  return { path: s };
}
export async function resolvePath(c: Pick<Conn, "kind" | "host">, raw: string): Promise<string> {
  let p = c.kind === "wsl" ? toWslPath(raw) : c.kind === "pc" ? raw.trim().replace(/^["']|["']$/g, "").replace(/\\/g, "/") : raw.trim();
  if (!p || p === "~" || p.startsWith("~/")) p = (await homeOf(c)) + (p.slice(1) || "");
  if (!p.startsWith("/") && !(c.kind === "pc" && /^[A-Za-z]:\//.test(p))) throw new RemoteError(i18next.t("絶対パス(/ から始まる形)か ~ で入力してください"), "EARG", 400);
  p = p.length > 1 ? p.replace(/\/+$/, "") : p;
  return /^[A-Za-z]:$/.test(p) ? p + "/" : p;
}

// ---- 最近開いた場所 ----
const RECENT = "fixit:recent-remote:v1";
export const getRecent = (): Conn[] => { try { const seen = new Set<string>(); return (JSON.parse(kvGet(RECENT) ?? "[]") as Conn[]).map(normConn).filter((c) => !seen.has(connKey(c)) && !!seen.add(connKey(c))); } catch { return []; } };
export function pushRecent(c: Conn) {
  const list = [c, ...getRecent().filter((x) => connKey(x) !== connKey(c))].slice(0, Math.max(1, get().recentMax));
  try { kvSet(RECENT, JSON.stringify(list)); } catch { /* 保存できない */ }
}
export function dropRecent(c: Conn) {
  try { kvSet(RECENT, JSON.stringify(getRecent().filter((x) => connKey(x) !== connKey(c)))); } catch { /* 保存できない */ }
}

// Git(読み取りだけ)。status は porcelain(-z)の生の文字列。リポジトリでなければ null
export async function gitStatusRaw(c: Conn, dir: string): Promise<string | null> {
  const r = await json<{ repo: boolean; raw?: string }>(c, "gitstatus", { path: dir });
  return r.repo ? r.raw ?? null : null;
}
// HEAD にあるファイルの中身。HEAD に無い(新しいファイル・大きすぎる)ときは null
export async function gitHeadText(c: Conn, file: string): Promise<string | null> {
  return (await json<{ text: string | null }>(c, "githead", { path: file })).text;
}
