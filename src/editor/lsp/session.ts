// 言語サーバーとの会話(LSP)。フォルダ(接続先)と言語(servers.json の id)の組ごとに 1 つ。
// 開いているタブの中身を、変更だけ(共通部分を除いた 1 か所の差分)で伝える。
import { useSyncExternalStore } from "react";
import { connKey, type Conn } from "@/platform/remote";
import { LSP_BUSY_SHOW_MS, LSP_IDLE_UNIT_MS, LSP_MAX_DOC_CHARS, LSP_REQUEST_TIMEOUT_MS, LSP_SYNC_DELAY_MS } from "@/shared/config";
import { openTransport, type LspEvent, type LspKind, type LspStat, type Transport } from "./transport";
import { addDebugSection, dlog } from "@/shared/debuglog";
import { serverOfFile } from "./servers";

export type Phase = "off" | "prepare" | "download" | "install" | "starting" | "ready" | "busy" | "error";
/** 画面に出すエラーは最初の数行だけにする(Go のスタックトレースなどが全文出ないように) */
export const briefErr = (e?: string, lines = 3, max = 240) => { const t = (e ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, lines).join("\n"); return t.length > max ? `${t.slice(0, max)}…` : t; };
export type Status = { phase: Phase; pct?: number; version?: string; err?: string };
export type TabDoc = { vpath: string; abs: string; conn: Conn; text: string };
export type Pos = { line: number; character: number };

// サーバーが workspace/configuration で聞いてくる設定。インレイヒントの種類だけ全部ひらく(出すかどうかは、こちらの設定で決める)
const TS_PREFS = {
  inlayHints: {
    parameterNames: { enabled: "all", suppressWhenArgumentMatchesName: false },
    parameterTypes: { enabled: true },
    variableTypes: { enabled: true },
    propertyDeclarationTypes: { enabled: true },
    functionLikeReturnTypes: { enabled: true },
    enumMemberValues: { enabled: true },
  },
};

// ---------- パスと URI ----------
export const toUri = (abs: string) => {
  const body = abs.replace(/\\/g, "/").split("/").map((seg, i) => (i === 0 && /^[a-zA-Z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join("/");
  return `file://${body.startsWith("/") ? "" : "/"}${body}`;
};
export const fromUri = (u: string): string | null => {
  if (!u.startsWith("file://")) return null;
  try {
    let p = decodeURIComponent(u.slice(7));
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
    return p;
  } catch { return null; }
};
export const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^([a-zA-Z]):/, (_, d: string) => `${d.toLowerCase()}:`);
const langOf = (path: string) => serverOfFile(path)?.lang ?? "plaintext";
// セッションの識別子(フォルダ × 言語)。状態の表示や再起動はこの値で指す
export const sessionKey = (c: Conn, server: string) => `${connKey(c)}|${server}`;

// 文字列の位置(UTF-16 の添字)を、行と列にする
export const posAt = (text: string, off: number): Pos => {
  let line = 0, start = 0;
  for (let i = text.indexOf("\n"); i !== -1 && i < off; i = text.indexOf("\n", i + 1)) { line++; start = i + 1; }
  return { line, character: off - start };
};

// 変わった部分を 1 か所にまとめる(前と後ろの共通部分を除く)
export const diffOf = (a: string, b: string) => {
  const m = Math.min(a.length, b.length);
  let p = 0;
  while (p < m && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < m - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { p, s };
};

// ---------- 状態の置き場(画面の下のバーが読む) ----------
const OFF: Status = { phase: "off" };
const statuses = new Map<string, Status>();
const subs = new Set<() => void>();
// 動いているサーバーの一覧(下のバーの一覧が読む)。状態が変わるたびに作り直し、変わらない間は同じ配列を返す
export type Running = { key: string; server: string; kind: LspKind; path: string; status: Status };
let running: Running[] = [];
const emit = () => {
  running = [...sessions].map(([key, s]) => ({ key, server: s.server, kind: s.kind, path: s.conn.path, status: statuses.get(key) ?? OFF }));
  subs.forEach((f) => f());
};
const setStatus = (key: string, s: Status | null) => {
  const before = statuses.get(key);
  if (s) statuses.set(key, s); else statuses.delete(key);
  // 状態が変わったときだけ、デバッグログに 1 行残す(進み具合の更新は残さない)
  if (before?.phase !== s?.phase || before?.err !== s?.err) dlog("lsp", `${key} → ${s ? s.phase : "停止"}${s?.version ? ` v${s.version}` : ""}${s?.err ? ` エラー: ${s.err}` : ""}`);
  emit();
};
addDebugSection("言語サーバー", () => running.length ? running.map((r) => `${r.server} ${r.kind} ${r.path} … ${r.status.phase}${r.status.version ? ` v${r.status.version}` : ""}${r.status.err ? ` (${r.status.err})` : ""}`).join("\n") : "(動いていません)");
export const subscribeLsp = (f: () => void) => (subs.add(f), () => { subs.delete(f); });
// push 型の波線が届いたときの知らせ(エディタが波線を取り直す)
const diagSubs = new Set<(key: string, uri: string) => void>();
export const subscribeDiags = (f: (key: string, uri: string) => void) => (diagSubs.add(f), () => { diagSubs.delete(f); });
export const useLspRunning = (): Running[] => useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => running);
// 動いているサーバーの負荷。測れなければ(まだ起動中・終了済み・対応外)null
export const lspStats = (key: string): Promise<LspStat | null> => sessions.get(key)?.stats() ?? Promise.resolve(null);
export const useLspStatus = (key: string | null): Status =>
  useSyncExternalStore((f) => (subs.add(f), () => { subs.delete(f); }), () => (key ? statuses.get(key) ?? OFF : OFF));

// ---------- 1 つのサーバーとの会話 ----------
type Wait = { res: (v: unknown) => void; rej: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

class Session {
  private tp: Transport | null = null;
  private seq = 0;
  private waits = new Map<number, Wait>();
  private ready = false;
  private dead = false;
  private desired = new Map<string, { text: string; lang: string }>();
  private sent = new Map<string, { v: number; text: string }>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private busyN = 0;
  private busyTimer: ReturnType<typeof setTimeout> | null = null;
  private st: Status = { phase: "prepare" };

  // サーバーが勝手に送ってくる波線(publishDiagnostics)。pull に対応しないサーバー(PHP・Ruby・SQL など)が使う
  private pushed = new Map<string, unknown[]>();
  private pullDiag = false;
  private trig = new Set<string>();

  constructor(readonly key: string, readonly conn: Conn, readonly kind: LspKind, readonly server: string) {}
  get pulls() { return this.pullDiag; }
  // 補完をひらく文字(サーバーが initialize で知らせたもの)
  get triggers() { return this.trig; }
  pushedDiags(uri: string): unknown[] { return this.pushed.get(uri) ?? []; }
  stats(): Promise<LspStat | null> { return this.tp ? this.tp.stats() : Promise.resolve(null); }

  get isReady() { return this.ready && !this.dead; }
  private put(s: Status) { this.st = s; setStatus(this.key, s); }
  private shown(): Status { return this.busyTimer === null && this.busyN > 0 && this.st.phase === "ready" ? { ...this.st, phase: "busy" } : this.st; }

  start() {
    this.put({ phase: "prepare" });
    this.tp = openTransport(this.kind, this.server, this.conn.path, (e) => this.onEvent(e));
  }

  stop() {
    // 何度呼んでもよい。サーバーが先に終わっていても、Rust 側の登録を外すために通信路は必ず止める
    this.dead = true; this.ready = false;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.busyTimer) clearTimeout(this.busyTimer);
    this.failAll(new Error("stopped"));
    this.tp?.stop();
    this.tp = null;
  }

  private failAll(e: Error) {
    for (const w of this.waits.values()) { clearTimeout(w.timer); w.rej(e); }
    this.waits.clear();
  }

  private onEvent(e: LspEvent) {
    if (this.dead) return;
    if (e.k === "state") {
      if (e.s === "ready") { this.put({ phase: "starting", version: this.st.version }); void this.init(); return; }
      const pct = e.s === "download" && e.total ? Math.min(99, Math.floor(((e.done ?? 0) / e.total) * 100)) : undefined;
      this.put({ phase: e.s, pct, version: e.version ?? this.st.version });
    } else if (e.k === "msg") {
      this.onMsg(e.m);
    } else if (e.k === "exit") {
      this.ready = false; this.dead = true;
      this.failAll(new Error("exit"));
      if (!e.stopped) this.put({ phase: "error", version: this.st.version, err: e.err?.trim() || (e.code === null ? "" : `exit ${e.code}`) });
    } else if (e.k === "fail") {
      this.ready = false; this.dead = true;
      this.failAll(new Error("fail"));
      this.put({ phase: "error", version: this.st.version, err: e.err });
    }
  }

  private async init() {
    const rootUri = toUri(this.conn.path);
    const kinds = Array.from({ length: 25 }, (_, i) => i + 1);
    try {
      const init = await this.request<{ capabilities?: { diagnosticProvider?: unknown; completionProvider?: { triggerCharacters?: string[] } } } | null>("initialize", {
        processId: null,
        clientInfo: { name: "Fixit Editor" },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: this.conn.path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "/" }],
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            synchronization: { dynamicRegistration: false, didSave: false },
            completion: {
              contextSupport: true,
              completionItem: { snippetSupport: false, documentationFormat: ["markdown", "plaintext"], labelDetailsSupport: true, deprecatedSupport: true, resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] } },
              completionItemKind: { valueSet: kinds },
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            definition: { linkSupport: true },
            signatureHelp: { contextSupport: true, signatureInformation: { documentationFormat: ["markdown", "plaintext"], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true } },
            references: {},
            rename: { prepareSupport: true },
            codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ["quickfix", "refactor", "source"] } }, resolveSupport: { properties: ["edit"] } },
            inlayHint: {},
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
            publishDiagnostics: { relatedInformation: false },
          },
        },
      });
      if (this.dead) return;
      this.pullDiag = !!init?.capabilities?.diagnosticProvider;
      this.trig = new Set(init?.capabilities?.completionProvider?.triggerCharacters ?? []);
      this.notify("initialized", {});
      this.ready = true;
      this.put({ phase: "ready", version: this.st.version });
      this.flush();
    } catch (e) {
      if (this.dead) return;
      this.put({ phase: "error", version: this.st.version, err: String((e as Error).message ?? e) });
      this.stop();
    }
  }

  private onMsg(raw: string) {
    let m: { id?: number | string; method?: string; params?: { items?: unknown[]; uri?: string; diagnostics?: unknown[] }; result?: unknown; error?: { message?: string } };
    try { m = JSON.parse(raw); } catch { return; }
    if (m.id === undefined && m.method === "textDocument/publishDiagnostics") {
      const uri = m.params?.uri;
      if (typeof uri === "string" && this.sent.has(uri)) { this.pushed.set(uri, m.params?.diagnostics ?? []); diagSubs.forEach((f) => f(this.key, uri)); }
    } else if (m.id !== undefined && m.method) {
      // 解析が進んで波線が変わったとき、サーバーが取り直しを頼んでくる(rust-analyzer など)。開いている全ファイルを取り直す
      if (m.method === "workspace/diagnostic/refresh") this.sent.forEach((_, uri) => diagSubs.forEach((f) => f(this.key, uri)));
      // サーバーからの問い合わせには、必ず返事をする(返さないと、サーバーが待ち続ける)
      const result = m.method === "workspace/configuration" ? (m.params?.items ?? []).map((it) => (this.server === "ts" && /^(js\/ts|typescript|javascript)$/.test((it as { section?: string }).section ?? "") ? TS_PREFS : null)) : null;
      this.tp?.send(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
    } else if (typeof m.id === "number") {
      const w = this.waits.get(m.id);
      if (!w) return;
      this.waits.delete(m.id); clearTimeout(w.timer);
      if (m.error) w.rej(new Error(m.error.message ?? "error")); else w.res(m.result);
    }
  }

  notify(method: string, params: unknown) { this.tp?.send(JSON.stringify({ jsonrpc: "2.0", method, params })); }

  request<T = unknown>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((res, rej) => {
      if (this.dead || !this.tp) return rej(new Error("not running"));
      const id = ++this.seq;
      const timer = setTimeout(() => { this.waits.delete(id); rej(new Error("timeout")); }, LSP_REQUEST_TIMEOUT_MS);
      this.waits.set(id, { res: res as (v: unknown) => void, rej, timer });
      signal?.addEventListener("abort", () => {
        if (!this.waits.delete(id)) return;
        clearTimeout(timer); this.notify("$/cancelRequest", { id }); rej(new Error("aborted"));
      }, { once: true });
      this.tp.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  // 解析を待っている間だけ、バーに「解析中」を出す(短い間はちらつくので出さない)
  track<T>(p: Promise<T>): Promise<T> {
    if (++this.busyN === 1 && !this.busyTimer) {
      this.busyTimer = setTimeout(() => { this.busyTimer = null; if (this.busyN > 0 && !this.dead) setStatus(this.key, this.shown()); }, LSP_BUSY_SHOW_MS);
    }
    const done = () => {
      if (--this.busyN > 0) return;
      if (this.busyTimer) { clearTimeout(this.busyTimer); this.busyTimer = null; }
      if (!this.dead && this.st.phase === "ready") setStatus(this.key, this.st);
    };
    p.then(done, done);
    return p;
  }

  // ---------- 文書の同期 ----------
  setDocs(list: { uri: string; text: string; lang: string }[]) {
    const next = new Map<string, { text: string; lang: string }>();
    for (const d of list) if (d.text.length <= LSP_MAX_DOC_CHARS) next.set(d.uri, { text: d.text, lang: d.lang });
    this.desired = next;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, LSP_SYNC_DELAY_MS);
  }

  // 画面のエディタの中身を、いますぐ伝える(問い合わせの直前に呼ぶ)
  setDoc(uri: string, text: string) {
    if (text.length > LSP_MAX_DOC_CHARS) return;
    const d = this.desired.get(uri);
    if (d) d.text = text; else this.desired.set(uri, { text, lang: langOf(uri) });
    this.reconcile(uri);
  }

  private flush() {
    if (!this.ready) return;
    for (const uri of this.desired.keys()) this.reconcile(uri);
    for (const uri of [...this.sent.keys()]) {
      if (this.desired.has(uri)) continue;
      this.sent.delete(uri); this.pushed.delete(uri);
      this.notify("textDocument/didClose", { textDocument: { uri } });
    }
  }

  private reconcile(uri: string) {
    if (!this.ready) return;
    const d = this.desired.get(uri);
    if (!d) return;
    const s = this.sent.get(uri);
    if (!s) {
      this.sent.set(uri, { v: 1, text: d.text });
      this.notify("textDocument/didOpen", { textDocument: { uri, languageId: d.lang, version: 1, text: d.text } });
    } else if (s.text !== d.text) {
      const { p, s: tail } = diffOf(s.text, d.text);
      const range = { start: posAt(s.text, p), end: posAt(s.text, s.text.length - tail) };
      s.v++;
      this.notify("textDocument/didChange", { textDocument: { uri, version: s.v }, contentChanges: [{ range, text: d.text.slice(p, d.text.length - tail) }] });
      s.text = d.text;
    }
  }
}

// ---------- 全体の管理 ----------
const sessions = new Map<string, Session>();
const idle = new Map<string, ReturnType<typeof setTimeout>>();
let byPath = new Map<string, { key: string; uri: string; conn: Conn }>();
let last: { docs: TabDoc[]; o: LspOpts } = { docs: [], o: { on: {}, wsl: true, pc: true, idleMin: 1 } };

const kindOf = (c: Conn): LspKind | null => (c.kind === "wsl" || c.kind === "pc" ? c.kind : null);

// 開いているタブを知らせる。設定がオフの言語は、動いているサーバーを止める(on は言語の id ごとの入り切り)
export type LspOpts = { on: Record<string, boolean>; wsl: boolean; pc: boolean; idleMin: number };
const kindOn = (o: LspOpts, server: string, k: LspKind) => !!o.on[server] && (k === "wsl" ? o.wsl : o.pc);
export function syncTabs(docs: TabDoc[], o: LspOpts) {
  last = { docs, o };
  const groups = new Map<string, { conn: Conn; kind: LspKind; server: string; list: TabDoc[] }>();
  for (const d of docs) {
    const kind = kindOf(d.conn), server = serverOfFile(d.vpath)?.server.id;
    if (!kind || !server) continue;
    const key = sessionKey(d.conn, server);
    (groups.get(key) ?? groups.set(key, { conn: d.conn, kind, server, list: [] }).get(key)!).list.push(d);
  }
  byPath = new Map();
  for (const [key, g] of groups) for (const d of g.list) byPath.set(d.vpath, { key, uri: toUri(d.abs), conn: g.conn });

  for (const [key, g] of groups) {
    const t = idle.get(key);
    if (t) { clearTimeout(t); idle.delete(key); }
    if (!kindOn(o, g.server, g.kind)) { drop(key); setStatus(key, OFF); continue; }
    let s = sessions.get(key);
    if (!s) { s = new Session(key, g.conn, g.kind, g.server); sessions.set(key, s); s.start(); }
    s.setDocs(g.list.map((d) => ({ uri: toUri(d.abs), text: d.text, lang: langOf(d.vpath) })));
  }
  // タブがなくなったフォルダは、しばらくしてから止める(すぐ戻ってくる場合に、取得と起動をやり直さないため)
  for (const key of [...sessions.keys()]) {
    if (groups.has(key) || idle.has(key)) continue;
    idle.set(key, setTimeout(() => { idle.delete(key); if (!groups.has(key)) { drop(key); setStatus(key, null); } }, o.idleMin * LSP_IDLE_UNIT_MS));
  }
  for (const key of [...statuses.keys()]) if (!groups.has(key) && !sessions.has(key)) setStatus(key, null);
}

function drop(key: string) {
  const s = sessions.get(key);
  if (s) { s.stop(); sessions.delete(key); }
}

// エラーのあとにやり直す(自動ではやり直さない)
export function restart(key: string) {
  drop(key);
  syncTabs(last.docs, last.o);
}

export function stopAll() { for (const k of [...sessions.keys()]) drop(k); }
if (typeof window !== "undefined") window.addEventListener("pagehide", stopAll);

// ---------- エディタ側から使う窓口 ----------
export type Handle = { session: Session; uri: string; conn: Conn };
export const lspHandle = (vpath: string): Handle | null => {
  const b = byPath.get(vpath);
  const s = b && sessions.get(b.key);
  return b && s?.isReady ? { session: s, uri: b.uri, conn: b.conn } : null;
};
export const lspReady = (vpath: string) => lspHandle(vpath) !== null;
// 絶対パスから、そのフォルダのタブの仮想パスを探す(定義へ移動で、いま開いているファイルかどうかを調べる)
export const vpathOfUri = (key: string, uri: string): string | null => {
  const abs = fromUri(uri);
  if (!abs) return null;
  const want = normPath(abs);
  for (const [vp, b] of byPath) if (connKey(b.conn) === key) { const a = fromUri(b.uri); if (a && normPath(a) === want) return vp; }
  return null;
};
// いま開いているタブの中身(最後に syncTabs で受け取ったもの)。サーバーが返した別ファイルの位置を、行の文字にするときに使う
export const lspTextOf = (vpath: string): string | undefined => last.docs.find((d) => d.vpath === vpath)?.text;
export type { Session };
