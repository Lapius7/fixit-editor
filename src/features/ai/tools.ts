// AI がファイルを読み・直すための道具。ここは文字の処理だけ(画面にもファイルにも触れない)。
// 実際に読む・書くのは、呼び出し側が渡す Host。AI の指定したパスは、開いているフォルダの中だけを許す。
import { AI_TOOL_EDIT_CHARS, AI_TOOL_LIST_MAX, AI_TOOL_READ_CHARS, AI_TOOL_READ_LINES, AI_TOOL_READ_MAX_LINES } from "@/shared/config";

export type ToolDef = { name: string; description: string; schema: { type: "object"; properties: Record<string, unknown>; required: string[] } };
export type ToolCall = { id: string; name: string; args: unknown };

export const TOOLS: ToolDef[] = [
  {
    name: "list_files",
    description: "List files and folders in the folder the user opened. Use it to find where things are. Paths look like /src/app.ts.",
    schema: { type: "object", properties: { path: { type: "string", description: "Folder to list. Default: the top folder (/)." }, depth: { type: "integer", description: "How many levels to show (1-4). Default 2." } }, required: [] },
  },
  {
    name: "read_file",
    description: `Read a text file with line numbers. Pass start_line and end_line to read only that range (up to ${AI_TOOL_READ_MAX_LINES} lines). Without a range you get the first ${AI_TOOL_READ_LINES} lines. Unsaved changes in the editor are included.`,
    schema: { type: "object", properties: { path: { type: "string" }, start_line: { type: "integer", description: "First line (1-based)." }, end_line: { type: "integer", description: "Last line (1-based, inclusive)." } }, required: ["path"] },
  },
  {
    name: "edit_file",
    description: "Propose a change to an existing file by replacing old_text with new_text. old_text must match the file exactly (including indentation) and must appear exactly once, so include enough surrounding lines. The user sees the change as a diff and may reject it. Read the file first. One call = one contiguous change; call again for another place.",
    schema: { type: "object", properties: { path: { type: "string" }, old_text: { type: "string", description: "Exact text to replace. Must be unique in the file." }, new_text: { type: "string", description: "Replacement text. Empty string deletes old_text." } }, required: ["path", "old_text", "new_text"] },
  },
];

// ---- パス ----
// 触らせない名前(秘密の鍵・認証情報・Git の中身)。大文字小文字は区別しない(Windows に合わせる)
const SECRET_DIR = new Set([".git", ".ssh", ".gnupg", ".aws"]);
const SECRET_FILE = [/^\.env(\..*)?$/, /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/, /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/, /^\.(npmrc|netrc|pypirc|git-credentials)$/];
export const secretName = (name: string) => { const n = name.toLowerCase(); return SECRET_DIR.has(n) || SECRET_FILE.some((r) => r.test(n)); };

// AI が指定したパスを、/ から始まる形に直す。使えないパスは null(.. ・ \ ・ : ・ NUL ・ 触らせない名前)
export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string" || p.length > 1000 || /[\u0000\\:]/.test(p)) return null;
  const seg = p.split("/").filter((s) => s !== "" && s !== ".");
  if (seg.some((s) => s === ".." || secretName(s))) return null;
  return "/" + seg.join("/");
}

// ---- 読む ----
export const lines = (text: string) => text.split("\n");

export type Read = { out: string; from: number; to: number; total: number };
// 行番号つきで、指定の範囲を返す。範囲外は丸める。長すぎれば途中で切って、続きの読み方を添える
export function readRange(text: string, start?: unknown, end?: unknown): Read {
  const ls = lines(text), total = text === "" ? 0 : text.endsWith("\n") ? ls.length - 1 : ls.length;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : undefined);
  const s = Math.max(1, Math.min(n(start) ?? 1, Math.max(total, 1)));
  const asked = n(end) !== undefined || n(start) !== undefined;
  let e = Math.min(total, n(end) ?? (s + (asked ? AI_TOOL_READ_MAX_LINES : AI_TOOL_READ_LINES) - 1));
  e = Math.max(s, Math.min(e, s + AI_TOOL_READ_MAX_LINES - 1, total));
  const w = String(e).length, rows: string[] = [];
  let chars = 0, last = s - 1;
  for (let i = s; i <= e; i++) {
    const row = `${String(i).padStart(w)}\t${ls[i - 1]}`;
    if (chars + row.length > AI_TOOL_READ_CHARS && rows.length) break;
    rows.push(row); chars += row.length + 1; last = i;
  }
  const more = last < total ? `\n[stopped at line ${last} of ${total}; call read_file again with start_line=${last + 1} to continue]` : "";
  return { out: total === 0 ? "[empty file]" : rows.join("\n") + more, from: s, to: last, total };
}

// ---- 直す ----
export type Anchor = { ok: true; at: number; line: number } | { ok: false; why: "none" | "many" | "empty" | "big" };
// old_text がファイルの中に 1 回だけ出るかを調べる(0 回・2 回以上は、AI に読み直させる)
export function findAnchor(text: string, old: string): Anchor {
  if (!old) return { ok: false, why: "empty" };
  if (old.length > AI_TOOL_EDIT_CHARS) return { ok: false, why: "big" };
  const at = text.indexOf(old);
  if (at < 0) return { ok: false, why: "none" };
  if (text.indexOf(old, at + 1) >= 0) return { ok: false, why: "many" };
  return { ok: true, at, line: text.slice(0, at).split("\n").length };
}
export const ANCHOR_ERR = {
  none: "old_text was not found. The file may have changed or the text differs (whitespace, indentation). Call read_file again and copy the lines exactly.",
  many: "old_text appears more than once. Include more surrounding lines so it matches exactly one place.",
  empty: "old_text is empty. To add text, use a nearby existing line as old_text and include it again in new_text.",
  big: `old_text is too long (limit ${AI_TOOL_EDIT_CHARS} characters). Make smaller edits.`,
} as const;

// 置き換えた結果。見つからない・2 か所以上のときは null(適用の直前に、もう一度確かめるために使う)
export function applyAnchor(text: string, old: string, neu: string): string | null {
  const a = findAnchor(text, old);
  return a.ok ? text.slice(0, a.at) + neu + text.slice(a.at + old.length) : null;
}

// 差分の表示用。変更が行の途中でも、行ごとにそろえる(同じ行の残りを両側に足す)。pre / post は前後の文脈(最大 n 行)
// ファイルの終わりの改行で出る空の行は、文脈に出さない
const ctx = (rows: string[], end: boolean) => (end && rows.at(-1) === "" ? rows.slice(0, -1) : rows).join("\n");
export function around(text: string, at: number, old: string, neu: string, n = 2): { pre: string; old: string; neu: string; post: string; line: number } {
  const before = text.slice(0, at).split("\n"), after = text.slice(at + old.length).split("\n");
  const head = before.at(-1) ?? "", tail = after[0] ?? "";
  return { pre: before.slice(-n - 1, -1).join("\n"), old: head + old + tail, neu: head + neu + tail, post: ctx(after.slice(1, n + 1), after.length - 1 <= n), line: before.length };
}

// ---- 呼び出しの検査 ----
const obj = (a: unknown): Record<string, unknown> => (a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {});
export type Parsed =
  | { k: "list"; path: string; depth: number }
  | { k: "read"; path: string; start?: number; end?: number }
  | { k: "edit"; path: string; old: string; neu: string }
  | { k: "bad"; err: string };

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);

export function parseCall(c: ToolCall): Parsed {
  const a = obj(c.args);
  if (c.name === "list_files") {
    const path = a.path === undefined || a.path === "" ? "/" : cleanPath(a.path);
    if (path === null) return { k: "bad", err: "That path is not allowed." };
    return { k: "list", path, depth: Math.min(4, Math.max(1, int(a.depth) ?? 2)) };
  }
  if (c.name === "read_file" || c.name === "edit_file") {
    const path = cleanPath(a.path);
    if (path === null || path === "/") return { k: "bad", err: "That path is not allowed. Use a file path inside the opened folder, like /src/app.ts." };
    if (c.name === "read_file") return { k: "read", path, start: int(a.start_line), end: int(a.end_line) };
    if (typeof a.old_text !== "string" || typeof a.new_text !== "string") return { k: "bad", err: "old_text and new_text must be strings." };
    if (a.new_text.length > AI_TOOL_EDIT_CHARS) return { k: "bad", err: ANCHOR_ERR.big };
    // エディタの中の改行は LF にそろえてある
    return { k: "edit", path, old: a.old_text.replace(/\r\n/g, "\n"), neu: a.new_text.replace(/\r\n/g, "\n") };
  }
  return { k: "bad", err: `Unknown tool: ${c.name}` };
}

// ---- 一覧 ----
export type Entry = { name: string; dir: boolean };
// 一覧を文字にする(深さの数だけ、host.list をたどる)。出しすぎないよう項目数で打ち切る
export async function listTree(list: (dir: string) => Promise<Entry[] | null>, path: string, depth: number): Promise<string> {
  const out: string[] = []; let cut = false;
  const walk = async (dir: string, d: number, pad: string): Promise<void> => {
    const es = await list(dir);
    if (!es) { if (d === 0) out.push("[folder not found]"); return; }
    for (const e of es) {
      if (out.length >= AI_TOOL_LIST_MAX) { cut = true; return; }
      out.push(`${pad}${e.name}${e.dir ? "/" : ""}`);
      if (e.dir && d + 1 < depth) await walk(`${dir === "/" ? "" : dir}/${e.name}`, d + 1, pad + "  ");
    }
  };
  await walk(path, 0, "");
  if (!out.length) return "[empty folder]";
  return out.join("\n") + (cut ? `\n[stopped after ${AI_TOOL_LIST_MAX} entries; list a subfolder to see more]` : "");
}

// ---- 会話に残す記録 ----
// 画面のカードと履歴に使う。read/list は 1 行、edit は差分つき
// pos: 返答の本文のうち、この操作の前までの文字数(本文の途中にカードを差し込む位置)
type Pos = { pos?: number };
export type Act =
  | ({ id: string; k: "read"; path: string; from?: number; to?: number; err?: string } & Pos)
  | ({ id: string; k: "list"; path: string; n?: number; err?: string } & Pos)
  | ({ id: string; k: "edit"; path: string; line: number; old: string; neu: string; pre: string; post: string; st: "pending" | "applied" | "rejected" | "stale" | "err"; err?: string } & Pos);

// 画面(App)が用意する、フォルダの中身を読む・直す窓口。AI が指定するパスは、ここで開いているフォルダの中に限る
export type FileHost = {
  list(dir: string): Promise<Entry[] | null>;
  read(path: string): Promise<{ text: string } | { err: "none" | "binary" | "big" | "dir" | "denied" }>;
  apply(path: string, old: string, neu: string): Promise<"ok" | "stale" | "fail">;
};

// 次の質問のとき、過去の操作を文字にして AI に伝える(プロバイダーを替えても続けられるように、道具の形ではなく文章で)
export function actsText(acts: Act[] | undefined): string {
  if (!acts?.length) return "";
  const t = acts.map((a) => {
    if (a.k === "read") return a.err ? `- read ${a.path}: ${a.err}` : `- read ${a.path}${a.from ? ` (lines ${a.from}-${a.to})` : ""}`;
    if (a.k === "list") return `- listed ${a.path}`;
    const s = a.st === "applied" ? "applied by the user" : a.st === "rejected" ? "rejected by the user" : a.st === "stale" ? "could not be applied (file had changed)" : a.st === "err" ? `failed: ${a.err ?? ""}` : "pending";
    return `- proposed edit to ${a.path} near line ${a.line}: ${s}`;
  });
  return `\n\n[Tool actions in this reply]\n${t.join("\n")}`;
}

// ---- OpenAI 互換の道具呼び出し(ストリームで少しずつ届く) ----
export type ToolDelta = { index?: number; id?: string; function?: { name?: string; arguments?: string } };
type AccItem = { key: number | undefined; id: string; name: string; raw: string };
export type ToolAcc = { items: AccItem[] };
export const newToolAcc = (): ToolAcc => ({ items: [] });
// 届いた断片を、呼び出しごとにつなぐ。id が新しければ別の呼び出し(Gemini は index がすべて 0 のことがある)。id がなければ index、それもなければ直前のもの
export function addToolDelta(acc: ToolAcc, d: ToolDelta) {
  if (!d || typeof d !== "object") return;
  let it = d.id ? acc.items.find((x) => x.id === d.id) : d.index !== undefined ? acc.items.find((x) => x.key === d.index) : acc.items.at(-1);
  if (!it) { it = { key: d.index, id: d.id ?? "", name: "", raw: "" }; acc.items.push(it); }
  if (d.id && !it.id) it.id = d.id;
  if (d.function?.name) it.name += d.function.name;
  if (typeof d.function?.arguments === "string") it.raw += d.function.arguments;
}
// 引数が JSON として読めたものは args に入れる。読めないものは args が undefined
export function doneCalls(acc: ToolAcc): (ToolCall & { raw: string })[] {
  return acc.items.filter((x) => x.name).map((x, i) => {
    let args: unknown;
    try { args = x.raw.trim() ? JSON.parse(x.raw) : {}; } catch { args = undefined; }
    return { id: x.id || `call_${i}`, name: x.name, raw: args === undefined ? "{}" : x.raw.trim() || "{}", args };
  });
}
