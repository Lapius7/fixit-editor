// サーバーが返す書き換え(WorkspaceEdit)を、ファイルごとの一覧にそろえる道具。画面や通信には依存しない。
import type { Pos } from "./session";

export type TextEdit = { range: { start: Pos; end: Pos }; newText: string };
type DocEdit = { textDocument: { uri: string }; edits: TextEdit[] };
export type WorkspaceEdit = { changes?: Record<string, TextEdit[]>; documentChanges?: (DocEdit | { kind: string })[] };

// ファイルの URI ごとの書き換えにする。ファイルの作成・名前変更・削除がまじるときは null(このエディタでは扱わない)
export function editsByUri(we: WorkspaceEdit | null | undefined): Map<string, TextEdit[]> | null {
  const out = new Map<string, TextEdit[]>();
  const add = (uri: string, list: TextEdit[]) => out.set(uri, [...(out.get(uri) ?? []), ...list]);
  if (!we) return out;
  for (const c of we.documentChanges ?? []) {
    if ("kind" in c) return null;
    add(c.textDocument.uri, c.edits);
  }
  if (!we.documentChanges) for (const [uri, list] of Object.entries(we.changes ?? {})) add(uri, list);
  return out;
}

// 行と列(UTF-16)から、文字列の添字を求める。範囲の外は端に寄せる
export function offsetAt(text: string, p: Pos): number {
  if (p.line < 0) return 0;
  let start = 0;
  for (let i = 0; i < p.line; i++) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return text.length;
    start = nl + 1;
  }
  const end = text.indexOf("\n", start);
  const lineEnd = end === -1 ? text.length : end;
  return Math.min(lineEnd, start + Math.max(0, p.character));
}

// 重なる書き換えがないか(あれば、そのまま適用すると壊れるので止める)
export function overlaps(list: { from: number; to: number }[]): boolean {
  const s = [...list].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < s.length; i++) if (s[i].from < s[i - 1].to) return true;
  return false;
}
