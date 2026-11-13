// ブラウザ版(開発サーバー)の言語サーバー。デスクトップ版の fixit-core/src/lsp.rs と同じ手順・同じ出来事を、Node で行う。
// 取得: src/editor/lsp/servers.json に決めてある取得元(npm・GitHub Releases・go・gem)から最新版を取り、照合してから ~/.cache/fixit/lsp/<dir>/<版> に置く。
//       画面から受け取るのはサーバーの id だけで、コマンドやパッケージ名は決して受け取らない。
// 通信: /__lsp?root=<絶対パス>&server=<id> の WebSocket。サーバー → 画面は {k:"state"|"msg"|"exit"|"fail"} の JSON、画面 → サーバーは {k:"msg",m} / {k:"stats"}(負荷を聞く。{k:"stat",cpu,mem} が返る) / {k:"stop"}。
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { gunzipSync, inflateRawSync } from "node:zlib";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir, arch, platform } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import servers from "../src/editor/lsp/servers.json";
import { WebSocketServer, type WebSocket } from "ws";

const REGISTRY = "https://registry.npmjs.org";
const MAX_TGZ = 120 * 1024 * 1024;
const MAX_FRAME = 256 * 1024 * 1024;
// 開発サーバー専用。ループバックからの、localhost 系の Origin だけを受け付ける
const OK_ORIGIN = /^https?:\/\/([\w-]+\.)*localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const versionOk = (v: string) => !!v && v.length < 40 && /^[\w.+-]+$/.test(v) && !v.startsWith(".");
const verKey = (v: string) => v.split(/\D+/).filter(Boolean).map(Number);
const cmpVer = (a: string, b: string) => { const x = verKey(a), y = verKey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };

// ---------- サーバーの一覧(src/editor/lsp/servers.json と共有。画面からは id だけを受け取る) ----------
type Install =
  | { kind: "npm-native"; pkg: string; exe: string }
  | { kind: "npm"; pkg: string; entry: string; deps?: boolean }
  | { kind: "github"; repo: string; exe: string; assets: Record<string, string> }
  | { kind: "go"; pkg: string; exe: string }
  | { kind: "gem"; name: string; exe: string };
type Spec = { id: string; dir: string; install: Install; args: string[] };
const SPECS = servers as unknown as Spec[];

type Say = (o: object) => void;
type Launch = { cmd: string; args: string[]; env?: Record<string, string> };
type Info = { version: string; tarball?: string; integrity?: string; asset?: { name: string; url: string; sha256: string } };

const win = platform() === "win32";
const NEED_SUFFIX = "が必要です";
const cacheRoot = (s: Spec) => join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "fixit", "lsp", s.dir);
const plat = () => {
  const o = ({ linux: "linux", darwin: "darwin", win32: "win32" } as Record<string, string>)[platform()];
  const a = ({ x64: "x64", arm64: "arm64" } as Record<string, string>)[arch()];
  return o && a ? `${o}-${a}` : null;
};

// 取得が済んでいれば、起動のしかたを返す
const launchIn = (s: Spec, dir: string): Launch | null => {
  const i = s.install;
  if (i.kind === "npm-native") { const e = join(dir, ...i.exe.split("/")) + (win ? ".exe" : ""); return existsSync(e) ? { cmd: e, args: s.args } : null; }
  if (i.kind === "npm") { const e = join(dir, ...i.entry.split("/")); return existsSync(e) ? { cmd: "node", args: [e, ...s.args] } : null; }
  if (i.kind === "github" || i.kind === "go") { const e = join(dir, i.exe + (win ? ".exe" : "")); return existsSync(e) ? { cmd: e, args: s.args } : null; }
  const e = join(dir, "bin", i.exe + (win ? ".bat" : ""));
  return existsSync(e) ? { cmd: e, args: s.args, env: { GEM_HOME: dir, GEM_PATH: dir } } : null;
};

const run = (cmd: string, args: string[], o: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}) => new Promise<{ code: number | null; out: string; err: string }>((ok, ng) => {
  const c = spawn(cmd, args, { cwd: o.cwd, env: { ...process.env, ...o.env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  const t = setTimeout(() => c.kill(), o.timeout ?? 600000);
  c.stdout.on("data", (d) => { out = (out + d).slice(-20000); });
  c.stderr.on("data", (d) => { err = (err + d).slice(-20000); });
  c.on("error", (e) => { clearTimeout(t); ng(e); });
  c.on("close", (code) => { clearTimeout(t); ok({ code, out, err }); });
});
const lastLine = (s: string) => s.trim().split("\n").pop() ?? "";

// 環境にあるものを使う取得元(Node.js・Go・Ruby)は、先にあるかを確かめる
const TOOLS: Record<string, { cmd: string; args: string[]; name: string }> = {
  node: { cmd: "node", args: ["--version"], name: "Node.js" },
  npm: { cmd: win ? "npm.cmd" : "npm", args: ["--version"], name: "Node.js(npm)" },
  go: { cmd: "go", args: ["version"], name: "Go" },
  gem: { cmd: "gem", args: ["--version"], name: "Ruby(gem)" },
};
const need = async (t: keyof typeof TOOLS) => {
  const x = TOOLS[t];
  try { if ((await run(x.cmd, x.args, { timeout: 15000 })).code !== 0) throw new Error("x"); } catch { throw new Error(`${x.name}${NEED_SUFFIX}(PATH にありません)`); }
};

// ---------- 最新版を調べる ----------
const getJson = async (url: string, headers: Record<string, string> = {}) => {
  const r = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${new URL(url).host} が ${r.status} を返しました`);
  return await r.json() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const npmLatest = async (pkg: string): Promise<Info> => {
  const j = await getJson(`${REGISTRY}/${pkg}/latest`);
  const info: Info = { version: j.version ?? "", tarball: j.dist?.tarball ?? "", integrity: j.dist?.integrity ?? "" };
  if (!versionOk(info.version)) throw new Error("版の形が正しくありません");
  if (!info.tarball!.startsWith(`${REGISTRY}/`)) throw new Error("ダウンロード先が npm のレジストリではありません");
  if (!info.integrity!.startsWith("sha512-")) throw new Error("integrity がありません");
  return info;
};
const latestOf = async (s: Spec, p: string | null): Promise<Info> => {
  const i = s.install;
  if (i.kind === "npm-native") { if (!p) throw new Error("この OS には対応していません"); return npmLatest(i.pkg.replace("{os}-{cpu}", p)); }
  if (i.kind === "npm") { await need("node"); if (i.deps) await need("npm"); return npmLatest(i.pkg); }
  if (i.kind === "github") {
    const want = p ? i.assets[p] : undefined;
    if (!want) throw new Error("この OS には対応していません");
    const j = await getJson(`https://api.github.com/repos/${i.repo}/releases/latest`, { "x-github-api-version": "2022-11-28" });
    const tag = String(j.tag_name ?? "");
    if (!versionOk(tag)) throw new Error("版の形が正しくありません");
    const name = want.replace("{ver}", tag.replace(/^v/, ""));
    const a = (j.assets as { name: string; browser_download_url: string; digest?: string }[] | undefined)?.find((x) => x.name === name);
    if (!a) throw new Error(`配布物 ${name} が見つかりません`);
    if (!a.browser_download_url.startsWith(`https://github.com/${i.repo}/releases/download/`)) throw new Error("ダウンロード先が GitHub のリリースではありません");
    const sha = /^sha256:([0-9a-f]{64})$/.exec(a.digest ?? "");
    if (!sha) throw new Error("配布物の sha256 がありません");
    return { version: tag, asset: { name, url: a.browser_download_url, sha256: sha[1] } };
  }
  if (i.kind === "go") {
    await need("go");
    const r = await run("go", ["list", "-m", "-f", "{{.Version}}", `${i.pkg}@latest`], { cwd: homedir(), timeout: 60000 });
    const v = r.out.trim();
    if (r.code !== 0 || !versionOk(v)) throw new Error(lastLine(r.err) || "版を調べられません");
    return { version: v };
  }
  await need("gem");
  const j = await getJson(`https://rubygems.org/api/v1/versions/${i.name}/latest.json`);
  if (!versionOk(String(j.version ?? ""))) throw new Error("版の形が正しくありません");
  return { version: String(j.version) };
};

// ---------- 取得と展開 ----------
const fetchBuf = async (url: string, say: Say, version: string): Promise<Buffer> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!r.ok || !r.body) throw new Error(`ダウンロードに失敗しました(${r.status})`);
  const total = Number(r.headers.get("content-length")) || 0;
  const chunks: Buffer[] = [];
  let done = 0, last = 0;
  for await (const c of r.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(c)); done += c.length;
    if (done > MAX_TGZ) throw new Error("ダウンロードが大きすぎます");
    if (done - last > 256 * 1024) { last = done; say({ k: "state", s: "download", done, total, version }); }
  }
  return Buffer.concat(chunks);
};

const extract = (buf: Buffer, dest: string) => new Promise<void>((ok, ng) => {
  // `..` や絶対パスを含むものは GNU/bsd tar とも既定で拒否・除去する
  const t = spawn("tar", ["xzf", "-", "-C", dest, "--strip-components=1"], { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  t.stderr.on("data", (d) => { err += d; });
  t.on("error", (e) => ng(e));
  t.on("close", (c) => (c === 0 ? ok() : ng(new Error(err.trim().split("\n").pop() || `tar が失敗しました(${c})`))));
  t.stdin.on("error", () => {});
  t.stdin.end(buf);
});

// zip の中から、ファイル名(base)が一致する 1 つだけを取り出す(ほかは展開しないので、パスをたどる攻撃も受けない)
const unzipOne = (buf: Buffer, base: string): Buffer => {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip の形が正しくありません");
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; k++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString("utf8");
    p += 46 + nl + xl + cl;
    if (name.endsWith("/") || name.split("/").pop() !== base) continue;
    const at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const data = buf.subarray(at, at + csize);
    const out = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (!out || out.length !== usize || usize > MAX_TGZ * 2) throw new Error("zip の中身が正しくありません");
    return out;
  }
  throw new Error(`zip の中に ${base} がありません`);
};

const build = async (s: Spec, info: Info, tmp: string, say: Say) => {
  const i = s.install;
  if (i.kind === "npm-native" || i.kind === "npm") {
    say({ k: "state", s: "download", done: 0, total: 0, version: info.version });
    const buf = await fetchBuf(info.tarball!, say, info.version);
    if (`sha512-${createHash("sha512").update(buf).digest("base64")}` !== info.integrity) throw new Error("ダウンロードした内容が、レジストリの integrity と一致しません");
    say({ k: "state", s: "install", version: info.version });
    await extract(buf, tmp);
    // 依存のある配布物(HTML/CSS・PHP)は、展開したあとに依存だけ取得する。ビルドの手順(スクリプト)は動かさない
    if (i.kind === "npm" && i.deps) {
      const r = await run(TOOLS.npm.cmd, ["install", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock"], { cwd: tmp });
      if (r.code !== 0) throw new Error(`依存の取得に失敗しました: ${lastLine(r.err)}`);
    }
  } else if (i.kind === "github") {
    const a = info.asset!, exe = i.exe + (win ? ".exe" : "");
    say({ k: "state", s: "download", done: 0, total: 0, version: info.version });
    const buf = await fetchBuf(a.url, say, info.version);
    if (createHash("sha256").update(buf).digest("hex") !== a.sha256) throw new Error("ダウンロードした内容が、GitHub の sha256 と一致しません");
    say({ k: "state", s: "install", version: info.version });
    const bin = a.name.endsWith(".gz") ? gunzipSync(buf) : a.name.endsWith(".zip") ? unzipOne(buf, exe) : null;
    if (!bin) throw new Error("配布物の形式に対応していません");
    writeFileSync(join(tmp, exe), bin);
    chmodSync(join(tmp, exe), 0o755);
  } else if (i.kind === "go") {
    say({ k: "state", s: "install", version: info.version });
    const r = await run("go", ["install", `${i.pkg}@${info.version}`], { env: { GOBIN: tmp }, cwd: homedir() });
    if (r.code !== 0) throw new Error(`go install に失敗しました: ${lastLine(r.err)}`);
  } else {
    say({ k: "state", s: "install", version: info.version });
    const r = await run("gem", ["install", i.name, "-v", info.version, "--no-document", "--install-dir", tmp, "--bindir", join(tmp, "bin")]);
    if (r.code !== 0) throw new Error(`gem install に失敗しました: ${lastLine(r.err)}`);
  }
};

// 版ごとのフォルダ(~/.cache/fixit/lsp/<dir>/<版>)に置く。HTML と CSS のように同じ配布物を使うものは、同時に取らず 1 回で済ませる
const locks = new Map<string, Promise<string>>();
const ensureDir = (s: Spec, say: Say): Promise<string> => {
  const busy = locks.get(s.dir);
  if (busy) return busy;
  const p = (async () => {
    const root = cacheRoot(s), i = s.install;
    const newest = () => { try { return readdirSync(root).filter((n) => versionOk(n) && launchIn(s, join(root, n))).sort(cmpVer).pop(); } catch { return undefined; } };
    // GitHub・go・gem は、取得に時間がかかり回数の制限もあるので、確かめるのは 1 日に 1 回にする
    const slow = i.kind === "github" || i.kind === "go" || i.kind === "gem";
    const stamp = join(root, ".checked");
    if (slow) { const v = newest(); try { if (v && Date.now() - statSync(stamp).mtimeMs < 24 * 3600e3) return join(root, v); } catch { /* 初回 */ } }
    let info: Info;
    try { info = await latestOf(s, plat()); } catch (e) {
      const v = newest();
      if (v) return join(root, v);
      const m = (e as Error).message;
      throw new Error(m.includes(NEED_SUFFIX) || m.includes("対応していません") ? m : `言語サーバーを取得できません: ${m}`);
    }
    const dir = join(root, info.version);
    if (!launchIn(s, dir)) {
      if (i.kind === "npm") await need("node");
      const tmp = `${dir}.tmp`;
      rmSync(tmp, { recursive: true, force: true });
      mkdirSync(tmp, { recursive: true });
      try { await build(s, info, tmp, say); } catch (e) { rmSync(tmp, { recursive: true, force: true }); throw e; }
      if (!launchIn(s, tmp)) { rmSync(tmp, { recursive: true, force: true }); throw new Error("展開した中に言語サーバーがありません"); }
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      for (const n of readdirSync(root)) if (n !== ".checked" && join(root, n) !== dir) { try { rmSync(join(root, n), { recursive: true, force: true }); } catch { /* 使用中なら残す */ } }
    }
    if (slow) { const now = new Date(); try { writeFileSync(stamp, ""); utimesSync(stamp, now, now); } catch { /* 記録できなくても動く */ } }
    return dir;
  })();
  locks.set(s.dir, p);
  const done = () => { locks.delete(s.dir); };
  p.then(done, done);
  return p;
};

// メッセージの枠(Content-Length)を切り出す
const frames = (onMsg: (m: string) => void) => {
  let buf = Buffer.alloc(0);
  return (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      const end = buf.indexOf("\r\n\r\n");
      if (end < 0) return;
      const m = /content-length:\s*(\d+)/i.exec(buf.subarray(0, end).toString("latin1"));
      const n = m ? Number(m[1]) : -1;
      if (n < 0 || n > MAX_FRAME) { buf = Buffer.alloc(0); return; }
      if (buf.length < end + 4 + n) return;
      onMsg(buf.subarray(end + 4, end + 4 + n).toString("utf8"));
      buf = buf.subarray(end + 4 + n);
    }
  };
};
const frame = (m: string) => Buffer.concat([Buffer.from(`Content-Length: ${Buffer.byteLength(m)}\r\n\r\n`), Buffer.from(m)]);

// 負荷(Linux の /proc から)。CPU は 1 コアを 100% とした使用率で、前回との差から出す(初回は null)。Linux 以外は両方 null
const procStat = (pid: number, prev: { w: number; c: number } | null) => {
  try {
    const up = Number(readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]);
    const st = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = st.slice(st.lastIndexOf(")") + 1).trim().split(/\s+/);
    const c = (Number(f[11]) + Number(f[12])) / 100;
    const mem = Number(readFileSync(`/proc/${pid}/statm`, "utf8").split(/\s+/)[1]) * 4096;
    if (![up, c, mem].every(Number.isFinite)) return null;
    return { cpu: prev && up > prev.w ? Math.max(0, ((c - prev.c) / (up - prev.w)) * 100) : null, mem, next: { w: up, c } };
  } catch { return null; }
};

export function lspBridge(): Plugin {
  return {
    name: "fixit-lsp",
    apply: "serve",
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        if (!req.url?.startsWith("/__lsp")) return;
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !OK_ORIGIN.test(req.headers.origin ?? "")) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
          const q = new URL(req.url!, "http://localhost").searchParams;
          const root = q.get("root") ?? "";
          const spec = SPECS.find((x) => x.id === (q.get("server") ?? "ts"));
          const say = (o: object) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(o));
          if (!spec) { say({ k: "fail", err: "未対応の言語です" }); ws.close(); return; }
          if (!root.startsWith("/") || /[\0\r\n]/.test(root) || !existsSync(root) || !statSync(root).isDirectory()) { say({ k: "fail", err: "フォルダが見つかりません" }); ws.close(); return; }
          let child: ChildProcess | undefined, stopped = false, prev: { w: number; c: number } | null = null;
          const stop = () => { stopped = true; child?.kill(); };
          ws.on("close", stop);
          ws.on("message", (data) => {
            try {
              const o = JSON.parse(data.toString());
              if (o.k === "stop") stop();
              else if (o.k === "stats") {
                const r = child?.pid ? procStat(child.pid, prev) : null;
                if (r) prev = r.next;
                say({ k: "stat", cpu: r?.cpu ?? null, mem: r?.mem ?? null });
              }
              else if (o.k === "msg" && typeof o.m === "string" && child?.stdin?.writable) child.stdin.write(frame(o.m));
            } catch { /* 壊れたメッセージは捨てる */ }
          });
          say({ k: "state", s: "prepare" });
          ensureDir(spec, say).then((dir) => {
            const l = launchIn(spec, dir);
            if (stopped) return;
            if (!l) { say({ k: "fail", err: "言語サーバーが見つかりません" }); ws.close(); return; }
            child = spawn(l.cmd, l.args, { cwd: root, env: l.env ? { ...process.env, ...l.env } : process.env, stdio: ["pipe", "pipe", "pipe"] });
            let tail = "";
            child.stderr!.on("data", (d) => { tail = (tail + d).slice(-2000); });
            child.stdout!.on("data", frames((m) => say({ k: "msg", m })));
            child.stdin!.on("error", () => {});
            child.on("error", (e) => { say({ k: "fail", err: l.cmd === "node" && (e as NodeJS.ErrnoException).code === "ENOENT" ? `Node.js${NEED_SUFFIX}(PATH にありません)` : `言語サーバーを起動できません: ${e.message}` }); ws.close(); });
            child.on("exit", (code) => { say({ k: "exit", code, err: tail, stopped }); ws.close(); });
            say({ k: "state", s: "ready" });
          }, (e: Error) => { say({ k: "fail", err: e.message }); ws.close(); });
        });
      });
    },
  };
}
