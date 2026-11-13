// [|] や (|) の間で Enter を押したときに、文法が対応づけを持たない言語(Java の [] など)でも
// 中身の行と閉じ括弧の行に分ける。標準の動作(文法に対応づけがあるとき)はそのまま任せる。
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { NodeProp } from "@lezer/common";
import { getIndentation, indentString, indentUnit, syntaxTree } from "@codemirror/language";

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

function explode(view: EditorView): boolean {
  const st = view.state;
  if (st.readOnly || st.selection.ranges.length !== 1 || !st.selection.main.empty) return false;
  const pos = st.selection.main.head;
  const open = st.sliceDoc(pos - 1, pos), close = st.sliceDoc(pos, pos + 1);
  if (!open || PAIRS[open] !== close) return false;
  const tree = syntaxTree(st);
  const inner = tree.resolveInner(pos, -1);
  // 文字列・コメントの中では何もしない
  if (/String|Comment|Template|Regex/.test(inner.name)) return false;
  // 標準の Enter が展開できる形(文法に閉じ括弧の対応がある)なら、そちらに任せる
  const ctx = tree.resolveInner(pos);
  const before = ctx.childBefore(pos), after = ctx.childAfter(pos);
  const closedBy = before?.type.prop(NodeProp.closedBy);
  if (before && after && before.to <= pos && after.from >= pos && closedBy && closedBy.indexOf(after.name) > -1) return false;
  const line = st.doc.lineAt(pos);
  const base = getIndentation(st, line.from) ?? /^[ \t]*/.exec(line.text)![0].length;
  const unit = st.facet(indentUnit);
  const inner1 = indentString(st, base + unit.length), outer = indentString(st, base);
  const insert = "\n" + inner1 + "\n" + outer;
  view.dispatch({ changes: { from: pos, insert }, selection: EditorSelection.cursor(pos + 1 + inner1.length), scrollIntoView: true, userEvent: "input" });
  return true;
}

export const explodeBrackets: Extension = Prec.high(keymap.of([{ key: "Enter", run: explode }]));
