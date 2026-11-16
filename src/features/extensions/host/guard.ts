// 拡張機能の API 呼び出しを検査する純粋な関数。画面にも通信にも触れないので、vitest で拒否の動きを試せる。
// 呼び出しを受ける host/runtime.ts の call は、ここを通ったものだけを実行する。
import { cleanPath } from "@/features/ai/tools";
import { EXT_NET_HEADERS, EXT_NET_REQ_MAX, EXT_PANEL_NODES, EXT_PANEL_TEXT, EXT_PROMPT_MAX_ITEMS, EXT_PROMPT_TEXT, EXT_STATUS_TEXT } from "@/shared/config";
import { argOk, execNameOk, type ExtCommand, type Perms } from "../spec";

/** 開いているフォルダの中の、/ から始まる相対パスに直す。外を指す・秘密の名前・.. は null。/ だけ(フォルダ自体)は allowRoot のときだけ通す */
export function fsPath(p: unknown, allowRoot = false): string | null {
  const c = cleanPath(p);
  if (c === null || (c === "/" && !allowRoot)) return null;
  return c;
}

/** net.fetch の宛先。https で、宣言したホストと完全に一致し、認証情報・ポートを含まないものだけ。それ以外は null */
export function netUrl(u: unknown, hosts: string[]): URL | null {
  if (typeof u !== "string" || u.length > 2000) return null;
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return hosts.includes(url.hostname) ? url : null;
}

export type NetInit = { method: string; headers: Record<string, string>; body: string | null };
/** net.fetch のオプションを許可した形に直す(許可リストにないヘッダー・メソッドは拒否) */
export function netInit(o: unknown): NetInit | null {
  const r = (o && typeof o === "object" ? o : {}) as { method?: unknown; headers?: unknown; body?: unknown };
  const method = r.method === undefined ? "GET" : typeof r.method === "string" ? r.method.toUpperCase() : "";
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return null;
  const headers: Record<string, string> = {};
  if (r.headers !== undefined) {
    if (!r.headers || typeof r.headers !== "object" || Array.isArray(r.headers)) return null;
    for (const [k, v] of Object.entries(r.headers)) {
      if (typeof v !== "string" || v.length > 2000 || /[\r\n]/.test(v) || !EXT_NET_HEADERS.includes(k.toLowerCase())) return null;
      headers[k.toLowerCase()] = v;
    }
  }
  if (r.body !== undefined && r.body !== null && (typeof r.body !== "string" || r.body.length > EXT_NET_REQ_MAX || method === "GET")) return null;
  return { method, headers, body: typeof r.body === "string" ? r.body : null };
}

/** terminal.run の指示。コマンド名は宣言した exec の中、引数は manifest の commands と同じ規則。通れば ExtCommand を返し、buildExtCommand に渡す */
export function termCommand(perms: Perms, cmd: unknown, args: unknown): ExtCommand | null {
  if (!execNameOk(cmd) || !perms.exec.includes(cmd)) return null;
  const a = args === undefined ? [] : args;
  if (!Array.isArray(a) || a.length > 16 || !a.every(argOk)) return null;
  return { id: "run", title: cmd, cmd, args: a as string[] };
}

const txt = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : null);
export type PickItem = { label: string; detail: string };
/** showQuickPick の項目。文字列か {label, detail?} の配列 */
export function pickItems(v: unknown): PickItem[] | null {
  if (!Array.isArray(v) || v.length > EXT_PROMPT_MAX_ITEMS) return null;
  const out: PickItem[] = [];
  for (const x of v) {
    const o = typeof x === "string" ? { label: x, detail: "" } : x && typeof x === "object" ? (x as { label?: unknown; detail?: unknown }) : null;
    if (!o) return null;
    const label = txt(o.label, EXT_PROMPT_TEXT), detail = o.detail === undefined ? "" : txt(o.detail, EXT_PROMPT_TEXT);
    if (!label || detail === null) return null;
    out.push({ label, detail });
  }
  return out;
}
export const promptText = (v: unknown, max = EXT_PROMPT_TEXT) => (v === undefined ? "" : txt(v, max));
export const statusText = (v: unknown) => txt(v, EXT_STATUS_TEXT);

/** 文書の範囲(UTF-16 の位置)。文書の長さの中に収まっていなければ null */
export function range(len: number, from: unknown, to: unknown): [number, number] | null {
  if (typeof from !== "number" || typeof to !== "number" || !Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > len) return null;
  return [from, to];
}

// ---- パネル(右側の宣言だけの画面)。拡張のコードも HTML も動かさず、ここで検査した部品の木を本体が描く ----
export type Tone = "dim" | "error" | "ok" | "";
export type PanelNode =
  | { t: "heading" | "text" | "code"; text: string; tone: Tone }
  | { t: "button"; text: string; action: string }
  | { t: "list"; items: { label: string; detail: string; action: string }[] }
  | { t: "input"; id: string; placeholder: string; value: string; action: string }
  | { t: "sep" };
export type PanelData = { title: string; nodes: PanelNode[] };
const PANEL_ID = /^[a-z0-9_-]{1,32}$/;
export const panelIdOk = (v: unknown): v is string => typeof v === "string" && PANEL_ID.test(v);
const ptext = (v: unknown, min = 1, max = EXT_PANEL_TEXT): string | null => (typeof v === "string" && v.length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : null);

/** パネルの中身の検査。形が違う・数や長さが上限を超える・知らない種類があれば null(一部だけ通すことはしない) */
export function cleanPanel(v: unknown): PanelData | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as { title?: unknown; nodes?: unknown };
  const title = ptext(o.title, 1, 60);
  if (!title || !Array.isArray(o.nodes)) return null;
  const nodes: PanelNode[] = []; let count = 0;
  for (const x of o.nodes) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return null;
    const n = x as Record<string, unknown>;
    if (++count > EXT_PANEL_NODES) return null;
    if (n.t === "sep") { nodes.push({ t: "sep" }); continue; }
    if (n.t === "heading" || n.t === "text" || n.t === "code") {
      const text = ptext(n.text, 0), tone = n.tone === undefined ? "" : n.tone;
      if (text === null || (tone !== "" && tone !== "dim" && tone !== "error" && tone !== "ok")) return null;
      nodes.push({ t: n.t, text, tone }); continue;
    }
    if (n.t === "button") {
      const text = ptext(n.text, 1, 60);
      if (!text || !panelIdOk(n.action)) return null;
      nodes.push({ t: "button", text, action: n.action }); continue;
    }
    if (n.t === "input") {
      const placeholder = ptext(n.placeholder ?? "", 0, 120), value = ptext(n.value ?? "", 0, 1000);
      if (!panelIdOk(n.id) || !panelIdOk(n.action) || placeholder === null || value === null) return null;
      nodes.push({ t: "input", id: n.id, placeholder, value, action: n.action }); continue;
    }
    if (n.t === "list") {
      if (!Array.isArray(n.items) || count + n.items.length > EXT_PANEL_NODES) return null;
      const items: { label: string; detail: string; action: string }[] = [];
      for (const it of n.items) {
        if (!it || typeof it !== "object") return null;
        const r = it as Record<string, unknown>, label = ptext(r.label, 1, 200), detail = ptext(r.detail ?? "", 0, 200), action = r.action === undefined || r.action === "" ? "" : r.action;
        if (!label || detail === null || (action !== "" && !panelIdOk(action))) return null;
        items.push({ label, detail, action: action as string });
      }
      count += items.length; nodes.push({ t: "list", items }); continue;
    }
    return null;
  }
  return { title, nodes };
}
/** 画面が返してくる操作が、いまのパネルに実際にある部品のものか(値は文字列だけ、長さに上限) */
export function panelHasAction(p: PanelData, action: unknown): boolean {
  if (typeof action !== "string" || !action) return false;
  return p.nodes.some((n) => (n.t === "button" || n.t === "input") ? n.action === action : n.t === "list" ? n.items.some((i) => i.action === action) : false);
}
