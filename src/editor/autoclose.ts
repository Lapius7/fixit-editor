// 標準の閉じタグの自動挿入が働かない 2 つの場面を補う。
//  ・HTML 系(html / vue / php / svelte)で <script>・<style> の > を打ったとき
//  ・JSX / TSX で、直後に別の要素の閉じタグ(</ul> など)があるところに <li> と打ったとき
import { EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { fileName } from "@/editor/intel";

const HTML = /\.(html?|vue|php|svelte)$/i, TPL = /\.(html?|jinja2?|j2|njk|twig|jinja-html)$/i, JSX = /\.(jsx|tsx)$/i;

function closed(doc: string, after: number, name: string): boolean {
  const rest = doc.slice(after, after + 50000).toLowerCase();
  const end = rest.indexOf(`</${name}`);
  if (end < 0) return false;
  const next = rest.indexOf(`<${name}`);
  return next < 0 || next > end;
}

function handler(view: EditorView, from: number, to: number, text: string): boolean {
  const st = view.state;
  if (text !== ">" || from !== to || view.composing || st.readOnly) return false;
  const file = st.facet(fileName);
  const html = HTML.test(file), jsx = JSX.test(file);
  if (!html && !jsx) return false;
  const tr = st.update({ changes: { from, insert: ">" }, selection: { anchor: from + 1 } });
  const head = from + 1;
  const tree = syntaxTree(tr.state);
  let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(head - 1, -1);
  const want = html ? "OpenTag" : "JSXOpenTag";
  while (n && n.name !== want) n = n.parent;
  if (!n || n.to !== head) return false;
  const m = /^<([A-Za-z][\w.:-]*)/.exec(tr.state.sliceDoc(n.from, head));
  if (!m) return false;
  const name = m[1];
  if (/\/>$/.test(tr.state.sliceDoc(n.from, head))) return false;
  const doc = tr.state.doc.toString();
  if (html) {
    if (!/^(script|style)$/i.test(name) || closed(doc, head, name.toLowerCase())) return false;
  } else {
    // 直後が </ のときだけ(それ以外は標準が閉じる)。次の閉じタグが同じ名前なら、すでに閉じている
    const nx = /^<\/([A-Za-z][\w.:-]*)?/.exec(tr.state.sliceDoc(head, head + 40));
    if (!nx || nx[1] === name) return false;
  }
  view.dispatch({ changes: [{ from, insert: ">" }, { from, insert: `</${name}>` }], selection: { anchor: head }, userEvent: "input.type" });
  return true;
}

export const autoCloseExtra: Extension = Prec.high(EditorView.inputHandler.of(handler));

// 標準の括弧の自動閉じは、次の文字が空白か ) ] } : ; > のときだけ働く。HTML の <p>|</p> のように < が続くところや、
// 引用符・カンマ・演算子の前でも閉じるよう、対象を広げる(単語の直前では閉じない)
export const closeBeforeMore: Extension = EditorState.languageData.of(() => [{ closeBrackets: { before: ")]}:;><,.\"'`/=+-*&|!?%#" } }]);

// Jinja / Django / Nunjucks / Twig のテンプレート(Flask の templates など)。{ を閉じたあとに:
//   {| } で % を打つと {% | %}、# を打つと {# | #}、{{| }} でスペースを打つと {{ | }} にする
function tplHandler(view: EditorView, from: number, to: number, text: string): boolean {
  const st = view.state;
  if (from !== to || view.composing || st.readOnly || !TPL.test(st.facet(fileName))) return false;
  const before = st.sliceDoc(Math.max(0, from - 2), from), after = st.sliceDoc(from, from + 2);
  if ((text === "%" || text === "#") && before.endsWith("{") && after.startsWith("}")) {
    const open = `${text} `, close = ` ${text}`;
    view.dispatch({ changes: { from, to: from + 1, insert: `${open}${close}}` }, selection: { anchor: from + open.length }, userEvent: "input.type" });
    return true;
  }
  if (text === " " && before === "{{" && after === "}}") {
    view.dispatch({ changes: { from, insert: "  " }, selection: { anchor: from + 1 }, userEvent: "input.type" });
    return true;
  }
  return false;
}
export const templateAssist: Extension = Prec.high(EditorView.inputHandler.of(tplHandler));
