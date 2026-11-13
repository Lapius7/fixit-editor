// TypeScript 言語サーバーの機能を CodeMirror につなぐ(エラーの波線・補完・ホバー・定義へ移動)。
// サーバーが使える状態のファイルだけで動く。使えないときは、これまでの Worker の言語サービスが受け持つ。
import { EditorSelection, EditorState, StateEffect, StateField, type ChangeSet, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, hoverTooltip, keymap, showTooltip, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { completionStatus, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import i18next from "i18next";
import { filePath, lspHooks, lspTake, say, type PickItem } from "@/editor/langsvc";
import type { Edit } from "@/editor/ts/client";
import { LSP_INLAY_DELAY_MS, LSP_LINT_DELAY_MS, LSP_REFS_MAX, LSP_SIG_AFTER_COMP_MS, LSP_SIG_DELAY_MS, LSP_SIG_WORD_MS } from "@/shared/config";
import { notify } from "@/shared/notify";
import { fromUri, lspHandle, normPath, lspTextOf, subscribeDiags, subscribeLsp, vpathOfUri, type Handle, type Pos } from "./session";
import { editsByUri, offsetAt, overlaps, type WorkspaceEdit } from "./edits";
import { connKey, type Conn } from "@/platform/remote";

// ---------- 位置の変換(LSP の列は UTF-16 で、CodeMirror の添字と同じ数え方) ----------
const toPos = (doc: Text, off: number): Pos => { const l = doc.lineAt(off); return { line: l.number - 1, character: off - l.from }; };
const toOff = (doc: Text, p: Pos): number => {
  if (p.line < 0) return 0;
  if (p.line >= doc.lines) return doc.length;
  const l = doc.line(p.line + 1);
  return Math.min(l.to, l.from + Math.max(0, p.character));
};
type Range = { start: Pos; end: Pos };

const handleOf = (v: EditorView): Handle | null => {
  const vp = v.state.facet(filePath);
  return vp ? lspHandle(vp) : null;
};
// 問い合わせの直前に、エディタの中身をサーバーへ渡す
const flush = (h: Handle, v: EditorView) => h.session.setDoc(h.uri, v.state.doc.toString());

// ---------- エラーの波線 ----------
type LspDiag = { range: Range; severity?: number; message: string; code?: number | string; source?: string };
const SEV = ["error", "error", "warning", "info", "info"] as const; // LSP: 1 エラー 2 警告 3 情報 4 ヒント

// コードアクションに渡すため、最後に受け取った波線をそのまま持っておく
const lastDiags = new WeakMap<EditorView, LspDiag[]>();

async function pullDiagnostics(v: EditorView): Promise<Diagnostic[]> {
  const h = handleOf(v);
  if (!h) return [];
  flush(h, v);
  const doc = v.state.doc, sv = h.session.server;
  try {
    // 問い合わせに対応するサーバーは pull で取り、対応しないサーバー(PHP・Ruby・SQL など)は届いた波線(push)を使う
    let items = h.session.pulls
      ? (await h.session.track(h.session.request<{ kind?: string; items?: LspDiag[] } | null>("textDocument/diagnostic", { textDocument: { uri: h.uri } })))?.items ?? []
      : h.session.pushedDiags(h.uri) as LspDiag[];
    // 解析の途中で pull が空を返すサーバー(rust-analyzer)のために、空のときは届いている波線で補う
    if (!items.length && h.session.pulls) items = h.session.pushedDiags(h.uri) as LspDiag[];
    const out: Diagnostic[] = [];
    lastDiags.set(v, items);
    for (const d of items) {
      const from = toOff(doc, d.range.start);
      const to = Math.max(from, toOff(doc, d.range.end));
      const code = d.code !== undefined ? ` (${sv === "ts" ? "TS" : ""}${d.code})` : "";
      out.push({ from, to: to === from ? Math.min(doc.length, from + 1) : to, severity: SEV[d.severity ?? 1] ?? "error", message: d.message + code, source: d.source ?? sv });
    }
    return out;
  } catch { return []; }
}

// サーバーが使える状態になったら、打鍵を待たずに波線を取りにいく。
// forceLinting は取得が予約済みのときしか動かない(準備中に空で返し終えたあとは何もしない)ので、再取得の合図を自前のエフェクトで送る
const relintNow = StateEffect.define<null>();
const relint = ViewPlugin.fromClass(class {
  private off: () => void;
  private was: boolean;
  constructor(v: EditorView) {
    this.was = !!handleOf(v);
    const a = subscribeLsp(() => { const now = !!handleOf(v); if (now && !this.was) v.dispatch({ effects: relintNow.of(null) }); this.was = now; });
    // push 型の波線が届いたとき、またはサーバーから取り直しを頼まれたとき、このファイルのぶんだけ取り直す
    const b = subscribeDiags((key, uri) => { const h = handleOf(v); if (h && h.session.key === key && h.uri === uri) v.dispatch({ effects: relintNow.of(null) }); });
    this.off = () => { a(); b(); };
  }
  destroy() { this.off(); }
});

// ---------- 補完 ----------
type Item = {
  label: string; kind?: number; detail?: string; sortText?: string; filterText?: string; insertText?: string; preselect?: boolean;
  labelDetails?: { detail?: string; description?: string };
  textEdit?: { newText: string; range?: Range; replace?: Range; insert?: Range };
  additionalTextEdits?: { range: Range; newText: string }[];
  documentation?: string | { value: string };
  deprecated?: boolean; tags?: number[];
};
const KIND = ["", "text", "method", "function", "class", "property", "variable", "class", "interface", "namespace", "property", "constant", "constant", "enum", "keyword", "text", "constant", "text", "text", "text", "enum", "constant", "class", "property", "keyword", "type"];
const TRIGGERS = new Set([".", "\"", "'", "/", "@", "<", "#"]);

type CompRes = { isIncomplete?: boolean; items?: Item[] } | Item[] | null;

async function completionSource(ctx: CompletionContext): Promise<CompletionResult | null> {
  const v = ctx.view;
  const h = v && handleOf(v);
  if (!v || !h) return null;
  const word = ctx.matchBefore(/[\w$]+/);
  const prev = ctx.pos > 0 ? ctx.state.doc.sliceString(ctx.pos - 1, ctx.pos) : "";
  const trigger = (h.session.server === "ts" ? TRIGGERS : h.session.triggers).has(prev);
  if (!ctx.explicit && !word && !trigger) return null;
  flush(h, v);
  const doc = ctx.state.doc, pos = ctx.pos, from = word ? word.from : pos;
  const ac = new AbortController();
  ctx.addEventListener("abort", () => ac.abort());
  let res: CompRes;
  try {
    res = await h.session.request<CompRes>("textDocument/completion", {
      textDocument: { uri: h.uri }, position: toPos(doc, pos),
      context: !word && trigger ? { triggerKind: 2, triggerCharacter: prev } : { triggerKind: 1 },
    }, ac.signal);
  } catch { return null; }
  const items = Array.isArray(res) ? res : res?.items ?? [];
  const incomplete = !Array.isArray(res) && !!res?.isIncomplete;
  if (!items.length) return null;
  const options = items.map((it): Completion => {
    const edit = it.textEdit;
    const range = edit ? (edit.range ?? edit.replace ?? edit.insert) : undefined;
    const text = edit?.newText ?? it.insertText ?? it.label;
    const n = parseInt(it.sortText ?? "", 10);
    const ld = it.labelDetails;
    const detail = [ld?.detail, ld?.description].filter(Boolean).join(" ") || it.detail;
    return {
      label: it.label,
      detail,
      type: KIND[it.kind ?? 0] || "text",
      boost: Number.isNaN(n) ? 0 : Math.max(-99, 50 - n) + (it.preselect ? 10 : 0),
      apply: (view, _c, f, t) => {
        if (!range) return applyItem(view, h, it, text, { from: f, to: t });
        // 範囲は要求したときの文書での位置。そのあとに打ち足した文字(<d のあとの i など)があれば、範囲の終わりをその分だけ後ろへ寄せる
        const a = toOff(doc, range.start), e = toOff(doc, range.end), typed = t - pos;
        applyItem(view, h, it, text, { from: a, to: Math.max(a, e >= pos ? e + typed : e) });
      },
    };
  });
  return { from, options, filter: true, validFor: incomplete ? undefined : /^[\w$]*$/ };
}

// 先に本体の挿入を反映し、続けて詳細を取り寄せて、import の追加など(additionalTextEdits)を足す
function applyItem(view: EditorView, h: Handle, it: Item, text: string, at: { from: number; to: number }) {
  const before = view.state.doc;
  const main = view.state.changes({ from: at.from, to: Math.max(at.from, at.to), insert: text });
  view.dispatch({ changes: main, selection: EditorSelection.cursor(at.from + text.length), userEvent: "input.complete", scrollIntoView: true });
  const after = view.state.doc;
  void (async () => {
    let r: Item | null;
    try { r = await h.session.request<Item>("completionItem/resolve", it); } catch { return; }
    const extra = r?.additionalTextEdits;
    if (!extra?.length || view.state.doc !== after) return; // 打ち進められていたら、位置がずれるので足さない
    addEdits(view, before, main, extra);
  })();
}

function addEdits(view: EditorView, before: Text, main: ChangeSet, edits: { range: Range; newText: string }[]) {
  const specs = edits.map((e) => {
    const a = toOff(before, e.range.start), b = toOff(before, e.range.end);
    return { from: main.mapPos(a, -1), to: main.mapPos(Math.max(a, b), 1), insert: e.newText };
  });
  view.dispatch({ changes: specs, userEvent: "input.complete" });
}

// ---------- ホバー ----------
type Marked = string | { language?: string; value: string };
const markdownOf = (c: Marked | Marked[] | { kind?: string; value: string } | undefined): string => {
  if (!c) return "";
  if (Array.isArray(c)) return c.map(markdownOf).filter(Boolean).join("\n\n");
  if (typeof c === "string") return c;
  if ("language" in c && c.language) return `\`\`\`${c.language}\n${c.value}\n\`\`\``;
  return c.value;
};

// 説明の文: リンクは文字だけにし、区切り線と余分な空行を除く
// 説明の Markdown を、プレーンな文にする。リンクだけの行(例: [MDN Reference](…))は、押せないので消す
const cleanDoc = (md: string) => md
  .replace(/^\s*\[[^\]]+\]\([^)]*\)\s*$/gm, "")
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/\*\*([^*\n]+)\*\*/g, "$1")
  .replace(/`([^`\n]+)`/g, "$1")
  .replace(/^\s*---+\s*$/gm, "")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

// 型の部分(```で囲まれたところ)と、説明の文に分ける
function renderHover(md: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "lt";
  const sig: string[] = [], doc: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    (inFence ? sig : doc).push(line);
  }
  if (sig.length) { const p = document.createElement("pre"); p.className = "lt-sig"; p.textContent = sig.join("\n").trim(); el.append(p); }
  const text = cleanDoc(doc.join("\n"));
  if (text) { const d = document.createElement("div"); d.className = "lt-doc"; d.textContent = text; el.append(d); }
  return el;
}

// ---------- 定義へ移動 ----------
type Link = { uri?: string; range?: Range; targetUri?: string; targetRange?: Range; targetSelectionRange?: Range };

// 開いていないファイルの定義へ移るための橋。App が差し込む(ファイルを開くのは App の役目)
export const lspUi: { openAt: (conn: Conn, abs: string, line: number, character: number) => Promise<boolean> } = { openAt: async () => false };

async function goDefinition(v: EditorView, pos = v.state.selection.main.head): Promise<boolean> {
  const h = handleOf(v);
  if (!h) return false;
  flush(h, v);
  let r: Link | Link[] | null;
  try { r = await h.session.request<Link | Link[] | null>("textDocument/definition", { textDocument: { uri: h.uri }, position: toPos(v.state.doc, pos) }); }
  catch { notify(i18next.t("定義が見つかりません"), "info"); return true; }
  const first = Array.isArray(r) ? r[0] : r;
  const uri = first?.targetUri ?? first?.uri, range = first?.targetSelectionRange ?? first?.targetRange ?? first?.range;
  if (!uri || !range) { notify(i18next.t("定義が見つかりません"), "info"); return true; }
  await openLoc(v, h, uri, range);
  return true;
}

// 位置へ移る。同じファイルならカーソルを動かし、別のファイルなら開く
async function openLoc(v: EditorView, h: Handle, uri: string, range: Range) {
  const abs = fromUri(uri);
  if (!abs) { notify(i18next.t("プロジェクトの外にある定義です"), "info"); return; }
  const here = fromUri(h.uri);
  if (here && normPath(here) === normPath(abs)) {
    const at = toOff(v.state.doc, range.start);
    v.dispatch({ selection: EditorSelection.cursor(at), effects: EditorView.scrollIntoView(at, { y: "center" }), userEvent: "select" });
    v.focus();
    return;
  }
  if (!(await lspUi.openAt(h.conn, abs, range.start.line, range.start.character))) notify(i18next.t("プロジェクトの外にある定義です"), "info");
}

async function hoverAt(v: EditorView, pos: number) {
  const h = handleOf(v);
  if (!h) return null;
  flush(h, v);
  let r: { contents?: Marked | Marked[] | { kind?: string; value: string }; range?: Range } | null;
  try { r = await h.session.request<typeof r>("textDocument/hover", { textDocument: { uri: h.uri }, position: toPos(v.state.doc, pos) }); } catch { return null; }
  const md = markdownOf(r?.contents).trim();
  if (!md) return null;
  const doc = v.state.doc;
  const from = r?.range ? toOff(doc, r.range.start) : pos, end = r?.range ? toOff(doc, r.range.end) : pos;
  return { pos: from, end, above: true, create: () => ({ dom: renderHover(md) }) };
}

// ---------- 引数のヒント(シグネチャ) ----------
type SigInfo = { label: string; documentation?: string | { value: string }; parameters?: { label: string | [number, number]; documentation?: string | { value: string } }[]; activeParameter?: number };
type SigHelp = { signatures?: SigInfo[]; activeSignature?: number; activeParameter?: number } | null;
type SigData = { pos: number; pre: string; act: string; post: string; doc: string; pdoc: string; i: number; n: number };

const docText = (d: string | { value: string } | undefined) => cleanDoc(typeof d === "string" ? d : d?.value ?? "");

function sigData(r: SigHelp, pos: number): SigData | null {
  const list = r?.signatures ?? [];
  if (!list.length) return null;
  const i = Math.min(list.length - 1, Math.max(0, r?.activeSignature ?? 0));
  const sig = list[i];
  const ai = sig.activeParameter ?? r?.activeParameter ?? 0;
  const p = sig.parameters?.[ai];
  let s = -1, e = -1;
  if (Array.isArray(p?.label)) [s, e] = p.label;
  else if (typeof p?.label === "string") {
    // 文字で渡されたときは、前の引数のあとから探す(関数名と同じ綴りに当たらないように)
    let at = sig.label.indexOf("(") + 1;
    for (let k = 0; k < ai; k++) {
      const q = sig.parameters?.[k]?.label;
      if (typeof q === "string") { const f = sig.label.indexOf(q, at); if (f >= 0) at = f + q.length; }
    }
    s = sig.label.indexOf(p.label, at);
    e = s >= 0 ? s + p.label.length : -1;
  }
  const ok = s >= 0 && e >= s && e <= sig.label.length;
  return {
    pos,
    pre: ok ? sig.label.slice(0, s) : sig.label, act: ok ? sig.label.slice(s, e) : "", post: ok ? sig.label.slice(e) : "",
    doc: docText(sig.documentation), pdoc: docText(p?.documentation), i, n: list.length,
  };
}

function renderSig(d: SigData): HTMLElement {
  const el = document.createElement("div");
  el.className = "lt";
  const pre = document.createElement("pre");
  pre.className = "lt-sig";
  pre.append(d.pre);
  if (d.act) { const b = document.createElement("b"); b.textContent = d.act; pre.append(b); }
  pre.append(d.post);
  if (d.n > 1) { const n = document.createElement("span"); n.className = "lt-n"; n.textContent = `${d.i + 1}/${d.n}`; pre.append(n); }
  el.append(pre);
  return el;
}

const setSig = StateEffect.define<SigData | null>();
const sigField = StateField.define<SigData | null>({
  create: () => null,
  update(d, tr) {
    for (const e of tr.effects) if (e.is(setSig)) return e.value;
    return d && tr.docChanged ? { ...d, pos: tr.changes.mapPos(d.pos) } : d;
  },
  provide: (f) => showTooltip.compute([f], (st) => {
    const d = st.field(f);
    return d ? { pos: d.pos, above: true, strictSide: true, arrow: false, create: () => ({ dom: renderSig(d) }) } : null;
  }),
});

const sigPlugin = ViewPlugin.fromClass(class {
  private timer = 0;
  private ac: AbortController | null = null;
  private comp = false;
  constructor(private v: EditorView) {}
  update(u: ViewUpdate) {
    const open = !!u.state.field(sigField);
    // 補完候補が出ている間(取得中も含む)は隠し、閉じてから少し待って出し直す。補完とのちらつきを防ぐ
    const comp = completionStatus(u.state) !== null;
    const flip = comp !== this.comp;
    if (flip) { this.comp = comp; this.schedule(comp ? 0 : LSP_SIG_AFTER_COMP_MS); }
    let typed = false, word = false;
    if (u.docChanged && u.transactions.some((t) => t.isUserEvent("input"))) {
      // 閉じ括弧の自動挿入で "()" が入っても発火させるため、挿入文字列のどこかに含まれていれば typed とする
      u.changes.iterChanges((_a, _b, _c, _d, ins) => { const t = ins.toString(); if (/[(,<]/.test(t)) typed = true; else if (/\w/.test(t)) word = true; });
    }
    // 補完の状態が変わった更新では、上の予約(隠す・出し直す)を上書きしない
    if (flip && comp) return;
    if (typed) this.schedule(LSP_SIG_DELAY_MS);
    // 単語を打っているときは、補完が開くのを待ってから確かめる(開く前の隙間に出さない)
    else if (open && word) this.schedule(LSP_SIG_WORD_MS);
    else if (open && (u.docChanged || u.selectionSet)) this.schedule(LSP_SIG_DELAY_MS);
  }
  schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), ms);
  }
  async run() {
    const v = this.v, h = handleOf(v);
    if (!h) return;
    this.ac?.abort();
    if (completionStatus(v.state) !== null) { if (v.state.field(sigField)) v.dispatch({ effects: setSig.of(null) }); return; }
    const ac = this.ac = new AbortController();
    flush(h, v);
    const doc = v.state.doc, head = v.state.selection.main.head;
    let r: SigHelp;
    try { r = await h.session.request<SigHelp>("textDocument/signatureHelp", { textDocument: { uri: h.uri }, position: toPos(doc, head), context: { triggerKind: 1, isRetrigger: !!v.state.field(sigField) } }, ac.signal); }
    catch { return; }
    if (v.state.doc !== doc) return; // 打ち進められていたら、次の問い合わせに任せる
    const prev = v.state.field(sigField);
    const d = sigData(r, prev && prev.pos <= head ? prev.pos : head);
    if (d || prev) v.dispatch({ effects: setSig.of(d) });
  }
  destroy() { clearTimeout(this.timer); this.ac?.abort(); }
});

const askSig = (v: EditorView) => {
  if (!handleOf(v)) return false;
  v.plugin(sigPlugin)?.schedule(0);
  return true;
};

// ---------- 書き換え(リネーム・コードアクション)を、このエディタで扱える形にする ----------
const nameOf = (vp: string) => vp.split("/").pop() || vp;

// サーバーの書き換えを、開いているタブへの Edit にする。開いていないファイルや、ファイル操作がまじるときは適用しない(一部だけ変わるのを防ぐ)
function toEdits(v: EditorView, h: Handle, we: WorkspaceEdit | null): Edit[] | "blocked" {
  const by = editsByUri(we);
  if (!by) { notify(i18next.t("ファイルの作成や名前の変更をともなうため、適用できません"), "warning"); return "blocked"; }
  const here = v.state.facet(filePath), key = connKey(h.conn);
  const out: Edit[] = [];
  for (const [uri, list] of by) {
    const vp = uri === h.uri ? here : vpathOfUri(key, uri);
    const text = vp === here ? v.state.doc.toString() : vp ? lspTextOf(vp) : undefined;
    if (!vp || text === undefined) { notify(i18next.t("開いていないファイルにも影響するため、変更しませんでした。先にそのファイルを開いてください"), "warning"); return "blocked"; }
    const mine = list.map((e) => ({ file: vp, from: offsetAt(text, e.range.start), to: offsetAt(text, e.range.end), pre: "", suf: "", text: e.newText }));
    if (overlaps(mine)) { notify(i18next.t("書き換えが重なっているため、適用できません"), "warning"); return "blocked"; }
    out.push(...mine);
  }
  return out;
}

// ---------- 参照 ----------
type Loc = { uri: string; range: Range };

async function findRefs(v: EditorView): Promise<boolean> {
  const h = handleOf(v);
  if (!h) return false;
  flush(h, v);
  let r: Loc[] | null;
  try { r = await h.session.request<Loc[] | null>("textDocument/references", { textDocument: { uri: h.uri }, position: toPos(v.state.doc, v.state.selection.main.head), context: { includeDeclaration: true } }); }
  catch { notify(i18next.t("参照が見つかりません"), "info"); return true; }
  if (!r?.length) { notify(i18next.t("参照が見つかりません"), "info"); return true; }
  const key = connKey(h.conn), here = v.state.facet(filePath);
  const items: PickItem[] = r.slice(0, LSP_REFS_MAX).map((l) => {
    const vp = l.uri === h.uri ? here : vpathOfUri(key, l.uri);
    const text = vp === here ? v.state.doc.toString() : vp ? lspTextOf(vp) : undefined;
    const line = text === undefined ? "" : text.slice(offsetAt(text, { line: l.range.start.line, character: 0 }), offsetAt(text, { line: l.range.start.line + 1, character: 0 })).trim();
    const abs = fromUri(l.uri) ?? l.uri;
    return { label: line, sub: `${nameOf(abs.replace(/\\/g, "/"))}:${l.range.start.line + 1}`, go: () => void openLoc(v, h, l.uri, l.range) };
  });
  say({ kind: "pick", title: i18next.t("参照 ({{n}} 件)", { n: r.length }), items });
  return true;
}

// ---------- リネーム ----------
async function startRename(v: EditorView): Promise<boolean> {
  const h = handleOf(v);
  if (!h) return false;
  flush(h, v);
  const doc = v.state.doc;
  let r: Range | { range?: Range; placeholder?: string; defaultBehavior?: boolean } | null;
  try { r = await h.session.request<typeof r>("textDocument/prepareRename", { textDocument: { uri: h.uri }, position: toPos(doc, v.state.selection.main.head) }); }
  catch (e) { notify((e as Error).message && (e as Error).message !== "timeout" ? (e as Error).message : i18next.t("この位置の名前は変えられません"), "info"); return true; }
  const range = r && "start" in r ? r : r?.range;
  if (!range) { notify(i18next.t("この位置の名前は変えられません"), "info"); return true; }
  const from = toOff(doc, range.start), to = toOff(doc, range.end);
  const name = r && "placeholder" in r && r.placeholder ? r.placeholder : doc.sliceString(from, to);
  say({ kind: "rename", view: v, file: v.state.facet(filePath), name, from, to });
  return true;
}

lspHooks.rename = async (v, pos, name) => {
  const h = handleOf(v);
  if (!h) return null;
  flush(h, v);
  try {
    const we = await h.session.request<WorkspaceEdit | null>("textDocument/rename", { textDocument: { uri: h.uri }, position: toPos(v.state.doc, pos), newName: name });
    return toEdits(v, h, we);
  } catch { return null; }
};

// ---------- コードアクション(Ctrl+.) ----------
type Action = { title: string; kind?: string; edit?: WorkspaceEdit; command?: unknown; disabled?: { reason: string }; data?: unknown };

const kindLabel = (k?: string) => (k?.startsWith("quickfix") ? i18next.t("修正") : k?.startsWith("source") ? i18next.t("ソース") : k?.startsWith("refactor") ? i18next.t("リファクタ") : "");

async function codeActions(v: EditorView): Promise<boolean> {
  const h = handleOf(v);
  if (!h) return false;
  flush(h, v);
  const doc = v.state.doc, sel = v.state.selection.main;
  const diagnostics = (lastDiags.get(v) ?? []).filter((d) => toOff(doc, d.range.start) <= sel.to && toOff(doc, d.range.end) >= sel.from);
  // tsgo は、ソース系(整理・未使用の削除)を only 指定のときしか返さない。通常の問い合わせと並べて投げて合わせる
  const range = { start: toPos(doc, sel.from), end: toPos(doc, sel.to) };
  const ask = (only?: string[]) => h.session.request<(Action | { command: string })[] | null>("textDocument/codeAction", { textDocument: { uri: h.uri }, range, context: { diagnostics, triggerKind: 1, ...(only ? { only } : {}) } }).catch(() => null);
  const got = await Promise.all([ask(), ask(["source"])]);
  const seen = new Set<string>();
  const r = got.flatMap((x) => x ?? []).filter((a) => { const k = "title" in a ? a.title : ""; if (seen.has(k)) return false; seen.add(k); return true; });
  const list = (r ?? []).filter((a): a is Action => typeof a.command !== "string" && !(a as Action).disabled);
  if (!list.length) { notify(i18next.t("使えるコードアクションがありません"), "info"); return true; }
  say({ kind: "pick", title: i18next.t("コードアクション"), items: list.map((a) => ({ label: a.title, sub: kindLabel(a.kind), go: () => void runAction(v, h, a, doc) })) });
  return true;
}

async function runAction(v: EditorView, h: Handle, a: Action, doc: Text) {
  let edit = a.edit;
  if (!edit) { try { edit = (await h.session.request<Action>("codeAction/resolve", a)).edit; } catch { /* 下で知らせる */ } }
  if (!edit) { notify(i18next.t("このコードアクションは実行できません"), "info"); return; }
  if (v.state.doc !== doc) { notify(i18next.t("文書が変わったため、適用しませんでした"), "info"); return; }
  const r = toEdits(v, h, edit);
  if (r === "blocked") return;
  if (r.some((e) => e.file !== v.state.facet(filePath))) { notify(i18next.t("ほかのファイルも書き換えるため、適用できません"), "warning"); return; }
  v.dispatch({ changes: r.map((e) => ({ from: e.from, to: e.to, insert: e.text ?? "" })), userEvent: "input.codeaction", scrollIntoView: true });
  v.focus();
}

// ---------- インレイヒント(型や引数名を薄く添える) ----------
type Hint = { position: Pos; label: string | { value: string }[]; kind?: number; paddingLeft?: boolean; paddingRight?: boolean };
const INLAY_MAX = 48;

class InlayWidget extends WidgetType {
  constructor(readonly text: string, readonly kind: number, readonly pl: boolean, readonly pr: boolean) { super(); }
  eq(o: InlayWidget) { return o.text === this.text && o.kind === this.kind && o.pl === this.pl && o.pr === this.pr; }
  toDOM() {
    const s = document.createElement("span");
    s.className = `cm-inlay ${this.kind === 2 ? "cm-inlay-param" : "cm-inlay-type"}`;
    if (this.pl) s.dataset.pl = "1";
    if (this.pr) s.dataset.pr = "1";
    s.textContent = this.text;
    return s;
  }
  ignoreEvent() { return true; }
}

const setInlay = StateEffect.define<DecorationSet>();
const inlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(d, tr) {
    d = d.map(tr.changes);
    for (const e of tr.effects) if (e.is(setInlay)) d = e.value;
    return d;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const inlayPlugin = ViewPlugin.fromClass(class {
  private timer = 0;
  private ac: AbortController | null = null;
  private off: () => void;
  private was: boolean;
  constructor(private v: EditorView) {
    this.was = !!handleOf(v);
    this.off = subscribeLsp(() => { const now = !!handleOf(v); if (now && !this.was) this.schedule(0); this.was = now; });
    this.schedule(0);
  }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged) this.schedule(LSP_INLAY_DELAY_MS); }
  schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.run(), ms);
  }
  async run() {
    const v = this.v, h = handleOf(v);
    if (!h) return;
    this.ac?.abort();
    const ac = this.ac = new AbortController();
    flush(h, v);
    const doc = v.state.doc, { from, to } = v.viewport;
    let r: Hint[] | null;
    try { r = await h.session.request<Hint[] | null>("textDocument/inlayHint", { textDocument: { uri: h.uri }, range: { start: toPos(doc, from), end: toPos(doc, to) } }, ac.signal); }
    catch { return; }
    if (v.state.doc !== doc) return; // 打ち進められていたら、次の問い合わせに任せる
    const marks = (r ?? []).map((x) => {
      const raw = typeof x.label === "string" ? x.label : x.label.map((p) => p.value).join("");
      const text = raw.length > INLAY_MAX ? raw.slice(0, INLAY_MAX - 1) + "…" : raw;
      return Decoration.widget({ widget: new InlayWidget(text, x.kind ?? 1, !!x.paddingLeft, !!x.paddingRight), side: x.kind === 2 ? -1 : 1 }).range(toOff(doc, x.position));
    });
    v.dispatch({ effects: setInlay.of(Decoration.set(marks, true)) });
  }
  destroy() { clearTimeout(this.timer); this.ac?.abort(); this.off(); }
});

// ---------- まとめ ----------
type LspFeatures = { tsLspDiag: boolean; tsLspComplete: boolean; tsLspHover: boolean; tsLspDef: boolean; tsLspSig: boolean; tsLspRefs: boolean; tsLspRename: boolean; tsLspAction: boolean; tsLspInlay: boolean };
export const lspExtension = (o: LspFeatures): Extension => [
  lspTake.of({ refs: o.tsLspRefs, rename: o.tsLspRename }),
  o.tsLspSig ? [sigField, sigPlugin, keymap.of([
    { key: "Escape", run: (v) => { if (!v.state.field(sigField)) return false; v.dispatch({ effects: setSig.of(null) }); return true; } },
    { key: "Mod-Shift-Space", run: askSig },
  ])] : [],
  o.tsLspRefs ? keymap.of([{ key: "Shift-F12", run: (v) => { if (!handleOf(v)) return false; void findRefs(v); return true; } }]) : [],
  o.tsLspRename ? keymap.of([{ key: "F2", run: (v) => { if (!handleOf(v)) return false; void startRename(v); return true; } }]) : [],
  o.tsLspAction ? keymap.of([{ key: "Mod-.", run: (v) => { if (!handleOf(v)) return false; void codeActions(v); return true; } }]) : [],
  o.tsLspInlay ? [inlayField, inlayPlugin] : [],
  o.tsLspDiag ? [
    linter((v) => pullDiagnostics(v), { delay: LSP_LINT_DELAY_MS, needsRefresh: (u) => u.transactions.some((t) => t.effects.some((e) => e.is(relintNow))) }),
    relint,
  ] : [],
  o.tsLspComplete ? EditorState.languageData.of(() => [{ autocomplete: completionSource }]) : [],
  o.tsLspHover ? hoverTooltip(hoverAt, { hoverTime: 350 }) : [],
  o.tsLspDef ? [
    EditorView.domEventHandlers({
      mousedown: (e, v) => {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || !handleOf(v)) return false;
        const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        e.preventDefault();
        v.dispatch({ selection: { anchor: pos } });
        void goDefinition(v, pos);
        return true;
      },
    }),
    keymap.of([{ key: "F12", run: (v) => { if (!handleOf(v)) return false; void goDefinition(v); return true; } }]),
  ] : [],
];
