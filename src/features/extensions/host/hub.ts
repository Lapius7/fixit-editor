// 拡張機能とエディタの間の窓口。Editor.tsx / App.tsx は、ここへ「開いた・変えた・保存した」を知らせ、補完などの問い合わせをここ経由で拡張へ回す。
// React も runtime.ts も読み込まない(runtime.ts が setIo で口を渡す)。拡張に渡す文書は、読む権限(editorRead)を持つ拡張だけに、上限つきで渡す。
import type { EditorView } from "@codemirror/view";
import { secretName } from "@/features/ai/tools";
import { EXT_CHANGE_DEBOUNCE_MS, EXT_CHANGE_TEXT_MAX, EXT_PROVIDER_MAX, EXT_PROVIDER_MS } from "@/shared/config";
import { range } from "./guard";

export type EventKind = "open" | "change" | "save";
export type ProviderKind = "completion" | "hover" | "diagnostics" | "format";
export const EVENT_KINDS: EventKind[] = ["open", "change", "save"];
export const PROVIDER_KINDS: ProviderKind[] = ["completion", "hover", "diagnostics", "format"];

/** runtime.ts が渡す口 */
export type Io = {
  /** editorRead を持ち、その種類を購読している拡張の id */
  listeners(kind: EventKind): string[];
  send(id: string, msg: unknown): void;
  name(id: string): string;
};
let io: Io | null = null;
export const setIo = (x: Io) => { io = x; };

// ---- いま操作しているエディタ ----
type Active = { view: EditorView; path: string };
let active: Active | null = null;
export const setActive = (view: EditorView, path: string) => { active = { view, path }; };
export const clearActive = (view: EditorView) => { if (active?.view === view) active = null; };
export const activeInfo = () => (active && !secretName(baseName(active.path)) ? active : null);
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);
/** 拡張子(小文字、ドットなし)。種類ごとの提供元の絞り込みに使う */
export const extOf = (p: string) => { const n = baseName(p), i = n.lastIndexOf("."); return i > 0 ? n.slice(i + 1).toLowerCase() : ""; };

const cap = (t: string) => (t.length > EXT_CHANGE_TEXT_MAX ? t.slice(0, EXT_CHANGE_TEXT_MAX) : t);

// ---- 読む・書く(権限は runtime.ts が先に確かめる) ----
export const readActive = () => {
  const a = activeInfo();
  return a ? { path: a.path, name: baseName(a.path), ext: extOf(a.path) } : null;
};
export const readText = () => { const a = activeInfo(); return a ? { text: cap(a.view.state.doc.toString()), truncated: a.view.state.doc.length > EXT_CHANGE_TEXT_MAX } : null; };
export const readSelection = () => {
  const a = activeInfo();
  if (!a) return null;
  const m = a.view.state.selection.main;
  return { from: m.from, to: m.to, text: a.view.state.sliceDoc(m.from, Math.min(m.to, m.from + EXT_CHANGE_TEXT_MAX)) };
};
/** 1 回の編集として置き換える(元に戻す 1 回分)。範囲が文書の外・読み取り専用なら拒否 */
export function replaceRange(from: unknown, to: unknown, text: unknown): void {
  const a = activeInfo();
  if (!a) throw new Error("no active file");
  if (typeof text !== "string" || text.length > EXT_CHANGE_TEXT_MAX) throw new Error("invalid text");
  if (a.view.state.readOnly) throw new Error("file is read-only");
  const r = range(a.view.state.doc.length, from, to);
  if (!r) throw new Error("invalid range");
  a.view.dispatch({ changes: { from: r[0], to: r[1], insert: text }, userEvent: "input.extension", scrollIntoView: false });
}
/** 文書全体を、変わった範囲だけ置き換える(カーソルと元に戻す履歴を壊さない) */
export function replaceAll(view: EditorView, next: string) {
  const cur = view.state.doc.toString();
  if (cur === next) return;
  let s = 0; const max = Math.min(cur.length, next.length);
  while (s < max && cur.charCodeAt(s) === next.charCodeAt(s)) s++;
  let e = 0;
  while (e < max - s && cur.charCodeAt(cur.length - 1 - e) === next.charCodeAt(next.length - 1 - e)) e++;
  view.dispatch({ changes: { from: s, to: cur.length - e, insert: next.slice(s, next.length - e) }, userEvent: "input.extension" });
}

// ---- 出来事を知らせる ----
const fire = (kind: EventKind, path: string, text: string | null) => {
  if (!io || secretName(baseName(path))) return;
  for (const id of io.listeners(kind)) io.send(id, { ev: "editor", kind, path, ext: extOf(path), ...(text === null ? {} : { text: cap(text), truncated: text.length > EXT_CHANGE_TEXT_MAX }) });
};
export const noteOpen = (path: string) => fire("open", path, null);
export const noteSave = (path: string, text: string) => fire("save", path, text);
const timers = new Map<string, number>();
/** 文書が変わった。続けて打っている間はまとめ、手を止めてから 1 回だけ渡す(中身は渡すときに取る) */
export function noteChange(path: string, get: () => string) {
  if (!io || !io.listeners("change").length) return;
  window.clearTimeout(timers.get(path));
  timers.set(path, window.setTimeout(() => { timers.delete(path); fire("change", path, get()); }, EXT_CHANGE_DEBOUNCE_MS));
}

// ---- 補完・ホバー・波線・整形の提供元 ----
const provs = new Map<string, Map<ProviderKind, Set<string>>>(); // 拡張 id → 種類 → 拡張子("*" は全部)
export function provide(id: string, kind: unknown, langs: unknown) {
  if (!PROVIDER_KINDS.includes(kind as ProviderKind)) throw new Error("invalid provider");
  const list = Array.isArray(langs) ? langs : ["*"];
  if (list.length > 40 || !list.every((l) => typeof l === "string" && /^(\*|[a-z0-9+#_-]{1,24})$/.test(l))) throw new Error("invalid languages");
  const m = provs.get(id) ?? new Map<ProviderKind, Set<string>>();
  m.set(kind as ProviderKind, new Set(list as string[]));
  provs.set(id, m);
}
export const dropProviders = (id: string) => { provs.delete(id); for (const k of [...pending.keys()]) if (k.startsWith(`${id}\n`)) pending.get(k)?.(null); };
export function providersFor(kind: ProviderKind, path: string): string[] {
  const e = extOf(path), out: string[] = [];
  if (secretName(baseName(path))) return out;
  for (const [id, m] of provs) { const s = m.get(kind); if (s && (s.has("*") || s.has(e)) && Date.now() >= (muted.get(id) ?? 0)) out.push(id); }
  return out;
}

// 問い合わせ。返事がこない拡張は待たず、続けて遅れたら 1 分だけ外す
const pending = new Map<string, (v: unknown) => void>();
const slow = new Map<string, number>(), muted = new Map<string, number>();
let rid = 0;
const MAX_PENDING = 8, MUTE_AFTER = 5, MUTE_MS = 60_000;
export function ask(id: string, kind: ProviderKind, payload: unknown, ms = EXT_PROVIDER_MS): Promise<unknown> {
  if (!io) return Promise.resolve(null);
  let n = 0; for (const k of pending.keys()) if (k.startsWith(`${id}\n`)) n++;
  if (n >= MAX_PENDING) return Promise.resolve(null);
  const key = `${id}\n${++rid}`;
  return new Promise((resolve) => {
    const done = (v: unknown, late = false) => {
      if (!pending.delete(key)) return;
      window.clearTimeout(t);
      if (late) { const c = (slow.get(id) ?? 0) + 1; slow.set(id, c); if (c >= MUTE_AFTER) { slow.set(id, 0); muted.set(id, Date.now() + MUTE_MS); } } else if (v !== null) slow.set(id, 0);
      resolve(v);
    };
    const t = window.setTimeout(() => done(null, true), ms);
    pending.set(key, (v) => done(v));
    io!.send(id, { ev: "provide", rid: rid, key: kind, payload });
  });
}
/** 拡張からの返事(runtime.ts の provide.reply)。番号が合わないものは捨てる */
export const reply = (id: string, n: unknown, v: unknown) => { if (typeof n === "number") pending.get(`${id}\n${n}`)?.(v ?? null); };

// ---- 返事の検査(拡張の言うことは信用しない) ----
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
export type Completion = { label: string; insert: string; detail: string; by: string };
export function cleanCompletions(by: string, v: unknown): Completion[] {
  if (!Array.isArray(v)) return [];
  const out: Completion[] = [];
  for (const x of v.slice(0, EXT_PROVIDER_MAX)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>, label = str(o.label, 80);
    if (!label) continue;
    out.push({ label, insert: str(o.insert, 2000) ?? label, detail: str(o.detail, 80) ?? "", by });
  }
  return out;
}
export const cleanHover = (v: unknown): string | null => { const t = v && typeof v === "object" ? str((v as { text?: unknown }).text, 2000) : str(v, 2000); return t && t.trim() ? t : null; };
export type Diag = { from: number; to: number; message: string; severity: "error" | "warning" | "info"; by: string };
export function cleanDiagnostics(by: string, len: number, v: unknown): Diag[] {
  if (!Array.isArray(v)) return [];
  const out: Diag[] = [];
  for (const x of v.slice(0, EXT_PROVIDER_MAX)) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>, r = range(len, o.from, o.to), message = str(o.message, 300);
    if (!r || !message) continue;
    out.push({ from: r[0], to: Math.max(r[1], Math.min(r[0] + 1, len)), message, severity: o.severity === "error" || o.severity === "info" ? o.severity : "warning", by });
  }
  return out;
}
export const nameOf = (id: string) => io?.name(id) ?? id;
export const sliceCap = cap;

/** 開いているファイルを、整形の提供元に整形してもらって置き換える。none: 提供元なし、failed: 返事なし・不正 */
export async function formatActive(): Promise<"ok" | "none" | "failed"> {
  const a = activeInfo();
  if (!a) return "none";
  const ids = providersFor("format", a.path);
  if (!ids.length) return "none";
  const text = a.view.state.doc.toString();
  if (text.length > EXT_CHANGE_TEXT_MAX) return "failed";
  const out = await ask(ids[0], "format", { path: a.path, ext: extOf(a.path), text }, 4000);
  if (typeof out !== "string" || out.length > EXT_CHANGE_TEXT_MAX || active?.view !== a.view || a.view.state.doc.toString() !== text) return "failed";
  replaceAll(a.view, out);
  return "ok";
}
