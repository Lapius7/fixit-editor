import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// WSL(このPC)と SSH 先のファイルを、ブラウザから読み書きするための開発サーバー用 API。
// 呼び出せるのは、ループバックから来た localhost 系の同一オリジンのページだけ。
const OK_ORIGIN = /^https?:\/\/([\w-]+\.)*localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/;
const OK_HOST = /^([\w-]+\.)*localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
export const SSH_HOST = /^[A-Za-z0-9._@-]+$/;

export type Entry = { name: string; kind: "dir" | "file"; size: number; mtime: number };
export class FsError extends Error {
  constructor(message: string, public status = 500, public code = "EIO") { super(message); }
}

// シェルに渡す文字列は、必ず単引用符で包む
export const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const need = (v: string | null, name: string) => { if (!v) throw new FsError(`${name} がありません`, 400, "EARG"); return v; };
const absPath = (p: string | null) => {
  const v = need(p, "path");
  if (!v.startsWith("/") || v.includes("\0")) throw new FsError("絶対パスで指定してください", 400, "EARG");
  return v.length > 1 ? v.replace(/\/+$/, "") : v;
};
const SKIP_NAME = /^[\w.@+-]+$/;

type Run = { out: Buffer; err: string; code: number };
function run(cmd: string, args: string[], input?: Buffer, timeoutMs = 20000, max = 64 * 1024 * 1024): Promise<Run> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = []; let size = 0, err = "", over = false;
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d: Buffer) => { size += d.length; if (size > max) { over = true; p.kill("SIGKILL"); } else out.push(d); });
    p.stderr.on("data", (d: Buffer) => { if (err.length < 4000) err += d.toString(); });
    p.on("error", (e) => { clearTimeout(timer); reject(new FsError(`${cmd} を起動できません: ${e.message}`, 500, "ESPAWN")); });
    p.on("close", (code, sig) => {
      clearTimeout(timer);
      if (over) return reject(new FsError("サイズの上限を超えました", 413, "ETOOBIG"));
      if (sig === "SIGKILL" && code === null) return reject(new FsError("時間内に終わりませんでした", 504, "ETIMEDOUT"));
      resolve({ out: Buffer.concat(out), err, code: code ?? 1 });
    });
    p.stdin.on("error", () => {});
    p.stdin.end(input);
  });
}

function sshError(err: string): FsError {
  if (/Permission denied|publickey/i.test(err)) return new FsError("SSH の認証に失敗しました。パスワードなしの鍵が要ります(`ssh-add` で鍵を登録するか、IdentityFile を設定してください)", 401, "EAUTH");
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION/i.test(err)) return new FsError("ホスト鍵を確認できません。一度ターミナルで `ssh <ホスト>` を実行して登録してください", 401, "EHOSTKEY");
  if (/Could not resolve hostname|Name or service not known/i.test(err)) return new FsError("ホスト名を解決できません", 502, "EHOST");
  if (/timed out|Connection refused|No route to host|Network is unreachable/i.test(err)) return new FsError("SSH に接続できません", 502, "ECONN");
  return new FsError(err.trim().split("\n").pop() || "SSH の実行に失敗しました", 500, "EIO");
}

// ---- バックエンド ----
export interface Backend {
  home(): Promise<string>;
  list(p: string): Promise<Entry[]>;
  read(p: string, max: number): Promise<Buffer>;
  write(p: string, data: Buffer): Promise<void>;
  mkdir(p: string): Promise<void>;
  rm(p: string): Promise<void>;
  mv(from: string, to: string): Promise<void>;
  stat(p: string): Promise<{ kind: "dir" | "file"; size: number; mtime: number } | null>;
  find(root: string, skip: string[], limit: number): Promise<string[]>;
  grep(root: string, q: string, o: { re: boolean; cs: boolean; word: boolean }, skip: string[], limit: number): Promise<{ path: string; line: number; text: string }[]>;
}

const findScript = (root: string, skip: string[], limit: number) => {
  const prune = skip.length ? `\\( ${skip.map((s) => `-name ${sq(s)}`).join(" -o ")} \\) -prune -o ` : "";
  return `cd -- ${sq(root)} && find . ${prune}-type f -print0 | head -zn ${limit}`;
};
const grepScript = (root: string, q: string, o: { re: boolean; cs: boolean; word: boolean }, skip: string[], limit: number) =>
  `cd -- ${sq(root)} && grep -rnIZ${o.re ? "E" : "F"}${o.cs ? "" : "i"}${o.word ? "w" : ""} ${skip.map((s) => `--exclude-dir=${sq(s)}`).join(" ")} -m 200 -e ${sq(q)} -- . | head -n ${limit}`;
function parseGrep(out: Buffer) {
  const hits: { path: string; line: number; text: string }[] = [];
  for (const row of out.toString("utf8").split("\n")) {
    const z = row.indexOf("\0");
    if (z < 0) continue;
    const m = /^(\d+):([\s\S]*)$/.exec(row.slice(z + 1));
    if (m) hits.push({ path: row.slice(0, z).replace(/^\.\//, ""), line: +m[1], text: m[2] });
  }
  return hits;
}
const parseFind = (root: string, out: Buffer) => out.toString("utf8").split("\0").filter(Boolean).map((r) => path.posix.join(root, r));

class LocalBackend implements Backend {
  async home() { return homedir(); }
  async list(p: string): Promise<Entry[]> {
    const names = await fs.readdir(p, { withFileTypes: true });
    return Promise.all(names.map(async (d) => {
      let st; try { st = await fs.stat(path.join(p, d.name)); } catch { /* 壊れたリンク */ }
      return { name: d.name, kind: (st ? st.isDirectory() : d.isDirectory()) ? "dir" : "file", size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 } as Entry;
    }));
  }
  async read(p: string, max: number) {
    const st = await fs.stat(p);
    if (st.isDirectory()) throw new FsError("フォルダは読めません", 400, "EISDIR");
    if (st.size > max) throw new FsError("ファイルが大きすぎます", 413, "ETOOBIG");
    return fs.readFile(p);
  }
  async write(p: string, data: Buffer) { await fs.writeFile(p, data); }
  async mkdir(p: string) { await fs.mkdir(p, { recursive: true }); }
  async rm(p: string) { await fs.rm(p, { recursive: true, force: true }); }
  async mv(from: string, to: string) {
    if (await fs.stat(to).then(() => true, () => false)) throw new FsError("同じ名前があります", 409, "EEXIST");
    await fs.rename(from, to);
  }
  async stat(p: string) {
    try { const s = await fs.stat(p); return { kind: s.isDirectory() ? "dir" as const : "file" as const, size: s.size, mtime: s.mtimeMs }; } catch { return null; }
  }
  async find(root: string, skip: string[], limit: number) {
    const r = await run("sh", ["-c", findScript(root, skip, limit)], undefined, 30000);
    return parseFind(root, r.out);
  }
  async grep(root: string, q: string, o: { re: boolean; cs: boolean; word: boolean }, skip: string[], limit: number) {
    const r = await run("sh", ["-c", grepScript(root, q, o, skip, limit)], undefined, 60000);
    return parseGrep(r.out).map((h) => ({ ...h, path: path.posix.join(root, h.path) }));
  }
}

export type SshOpts = { timeout: number };
class SshBackend implements Backend {
  constructor(private host: string, private o: SshOpts) {}
  private async sh(script: string, input?: Buffer, ms = 20000, max?: number, okCodes: number[] = [0]) {
    const args = [
      "-o", "BatchMode=yes", "-o", `ConnectTimeout=${this.o.timeout}`,
      "-o", "ControlMaster=auto", "-o", "ControlPath=~/.ssh/cm-%C", "-o", "ControlPersist=10m",
      "--", this.host, `sh -c ${sq(script)}`,
    ];
    const r = await run("ssh", args, input, ms + this.o.timeout * 1000, max);
    if (!okCodes.includes(r.code)) {
      if (r.code === 255) throw sshError(r.err);
      throw new FsError(r.err.trim().split("\n").pop() || `コマンドが失敗しました(${r.code})`, 500, "EIO");
    }
    return r.out;
  }
  async home() { return (await this.sh(`printf %s "$HOME"`)).toString("utf8"); }
  async list(p: string): Promise<Entry[]> {
    const out = await this.sh(`cd -- ${sq(p)} && find . -mindepth 1 -maxdepth 1 -printf '%y%Y\\t%s\\t%T@\\t%f\\0'`);
    const rows: Entry[] = [];
    for (const rec of out.toString("utf8").split("\0")) {
      if (!rec) continue;
      const a = rec.indexOf("\t"), b = rec.indexOf("\t", a + 1), c = rec.indexOf("\t", b + 1);
      if (c < 0) continue;
      rows.push({ kind: rec[1] === "d" ? "dir" : "file", size: +rec.slice(a + 1, b) || 0, mtime: (+rec.slice(b + 1, c) || 0) * 1000, name: rec.slice(c + 1) });
    }
    return rows;
  }
  async read(p: string, max: number) {
    const size = +(await this.sh(`[ -d ${sq(p)} ] && echo d || wc -c < ${sq(p)}`)).toString().trim();
    if (Number.isNaN(size)) throw new FsError("フォルダは読めません", 400, "EISDIR");
    if (size > max) throw new FsError("ファイルが大きすぎます", 413, "ETOOBIG");
    return this.sh(`cat -- ${sq(p)}`, undefined, 60000, max + 1024);
  }
  async write(p: string, data: Buffer) {
    // 一時ファイルに受けてバイト数を確かめてから、元のファイルへ流し込む(権限・所有者・リンクを保つ)
    const script = `t=$(mktemp) || exit 1; cat > "$t"; if [ "$(wc -c < "$t" | tr -d ' ')" = ${data.length} ]; then cat "$t" > ${sq(p)}; rc=$?; else rc=3; fi; rm -f "$t"; exit $rc`;
    await this.sh(script, data, 60000);
  }
  async mkdir(p: string) { await this.sh(`mkdir -p -- ${sq(p)}`); }
  async rm(p: string) { await this.sh(`rm -rf -- ${sq(p)}`); }
  async mv(from: string, to: string) {
    const r = await this.sh(`if [ -e ${sq(to)} ]; then echo exists; else mv -- ${sq(from)} ${sq(to)} && echo ok; fi`);
    if (r.toString().trim() === "exists") throw new FsError("同じ名前があります", 409, "EEXIST");
  }
  async stat(p: string) {
    const r = (await this.sh(`if [ -d ${sq(p)} ]; then echo d; elif [ -e ${sq(p)} ]; then echo f; else echo n; fi`)).toString().trim();
    if (r === "n") return null;
    return { kind: r === "d" ? "dir" as const : "file" as const, size: 0, mtime: 0 };
  }
  async find(root: string, skip: string[], limit: number) {
    return parseFind(root, await this.sh(findScript(root, skip, limit), undefined, 60000, 64 * 1024 * 1024));
  }
  async grep(root: string, q: string, o: { re: boolean; cs: boolean; word: boolean }, skip: string[], limit: number) {
    const out = await this.sh(grepScript(root, q, o, skip, limit), undefined, 90000, 64 * 1024 * 1024, [0, 1, 2]);
    return parseGrep(out).map((h) => ({ ...h, path: path.posix.join(root, h.path) }));
  }
}

// ~/.ssh/config の Host 一覧(ワイルドカードは除く)
async function sshHosts() {
  let text = "";
  try { text = await fs.readFile(path.join(homedir(), ".ssh", "config"), "utf8"); } catch { return []; }
  const hosts: { name: string; hostname?: string; user?: string }[] = [];
  let cur: typeof hosts = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(\w+)\s*[=\s]\s*(.+)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === "host") {
      cur = val.split(/\s+/).filter((h) => !/[*?!]/.test(h) && SSH_HOST.test(h) && !h.startsWith("-")).map((name) => ({ name }));
      hosts.push(...cur);
    } else if (key === "hostname") cur.forEach((h) => (h.hostname = val));
    else if (key === "user") cur.forEach((h) => (h.user = val));
  }
  return hosts;
}

export function check(req: IncomingMessage) {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) throw new FsError("forbidden", 403, "EFORBID");
  if (!OK_HOST.test(req.headers.host ?? "")) throw new FsError("forbidden", 403, "EFORBID");
  const origin = req.headers.origin;
  if (origin !== undefined && !OK_ORIGIN.test(origin)) throw new FsError("forbidden", 403, "EFORBID");
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") throw new FsError("forbidden", 403, "EFORBID");
  if (req.headers["x-fixit"] !== "1") throw new FsError("forbidden", 403, "EFORBID");
}

export function body(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let n = 0;
    req.on("data", (d: Buffer) => { n += d.length; if (n > max) { reject(new FsError("サイズの上限を超えました", 413, "ETOOBIG")); req.destroy(); } else chunks.push(d); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const json = (res: ServerResponse, status: number, v: unknown) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(v));
};

function backendFor(q: URLSearchParams): Backend {
  const kind = q.get("kind") ?? "wsl";
  if (kind === "wsl") return new LocalBackend();
  if (kind !== "ssh") throw new FsError("kind が正しくありません", 400, "EARG");
  const host = q.get("host") ?? "";
  if (!SSH_HOST.test(host) || host.startsWith("-")) throw new FsError("ホスト名が正しくありません", 400, "EARG");
  const t = Math.min(60, Math.max(2, +(q.get("timeout") ?? 10) || 10));
  return new SshBackend(host, { timeout: t });
}

const READ = new Set(["hosts", "home", "list", "read", "stat", "find", "grep"]);
const WRITE = new Set(["write", "mkdir", "rm", "mv"]);

export function fsApi(): Plugin {
  return {
    name: "fixit-fsapi",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__fs", async (req, res) => {
        try {
          check(req);
          const url = new URL(req.url ?? "/", "http://localhost");
          const op = url.pathname.replace(/^\//, "");
          const q = url.searchParams;
          const isWrite = WRITE.has(op);
          if (!isWrite && !READ.has(op)) throw new FsError("not found", 404, "ENOENT");
          if (req.method !== (isWrite ? "POST" : "GET")) throw new FsError("method not allowed", 405, "EMETHOD");
          if (op === "hosts") return json(res, 200, { hosts: await sshHosts() });
          const be = backendFor(q);
          const maxMB = Math.min(200, Math.max(1, +(q.get("maxMB") ?? 20) || 20));
          switch (op) {
            case "home": return json(res, 200, { path: await be.home() });
            case "list": return json(res, 200, { entries: await be.list(absPath(q.get("path"))) });
            case "stat": return json(res, 200, { stat: await be.stat(absPath(q.get("path"))) });
            case "read": {
              const data = await be.read(absPath(q.get("path")), maxMB * 1024 * 1024);
              res.setHeader("content-type", "application/octet-stream");
              res.setHeader("cache-control", "no-store");
              return void res.end(data);
            }
            case "write": await be.write(absPath(q.get("path")), await body(req, 200 * 1024 * 1024)); return json(res, 200, { ok: true });
            case "mkdir": await be.mkdir(absPath(q.get("path"))); return json(res, 200, { ok: true });
            case "rm": {
              const p = absPath(q.get("path"));
              if (p === "/" || p === (await be.home())) throw new FsError("このフォルダは削除できません", 400, "EARG");
              await be.rm(p); return json(res, 200, { ok: true });
            }
            case "mv": await be.mv(absPath(q.get("path")), absPath(q.get("to"))); return json(res, 200, { ok: true });
            case "find":
            case "grep": {
              const skip = (q.get("skip") ?? "").split(",").filter((s) => SKIP_NAME.test(s));
              const limit = Math.min(50000, Math.max(1, +(q.get("limit") ?? 5000) || 5000));
              const root = absPath(q.get("path"));
              if (op === "find") return json(res, 200, { files: await be.find(root, skip, limit) });
              const o = { re: q.get("re") === "1", cs: q.get("cs") === "1", word: q.get("word") === "1" };
              return json(res, 200, { hits: await be.grep(root, need(q.get("q"), "q"), o, skip, limit) });
            }
          }
        } catch (e) {
          const err = e instanceof FsError ? e : Object.assign(new FsError((e as Error).message || "失敗しました", 500, (e as NodeJS.ErrnoException).code || "EIO"), {
            status: (e as NodeJS.ErrnoException).code === "ENOENT" ? 404 : (e as NodeJS.ErrnoException).code === "EACCES" ? 403 : 500,
          });
          json(res, err.status, { error: err.message, code: err.code });
        }
      });
    },
  };
}
