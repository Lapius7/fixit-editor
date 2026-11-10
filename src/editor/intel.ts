// エディタの補助機能(括弧の色分け、タグ名の同時編集、エラーの波線、ミニマップ)。設定で入り切りできるものをここにまとめる。
import { EditorState, Facet, RangeSetBuilder, Transaction, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { linter, type Diagnostic } from "@codemirror/lint";
import { showMinimap } from "@replit/codemirror-minimap";
import i18next from "i18next";

export const fileName = Facet.define<string, string>({ combine: (v) => v[0] ?? "" });

// ---------- 括弧の色分け ----------
const OPEN = "([{", CLOSE = ")]}";
const COLORS = 4;
const marks = Array.from({ length: COLORS }, (_, i) => Decoration.mark({ class: `cm-rb${i}` }));
const lost = Decoration.mark({ class: "cm-rbX" });

function colorize(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  const doc = view.state.doc;
  // 画面に見える範囲の少し前から数える(深さがずれないように、先頭から数えるのは重いので、いちばん近い行頭から)
  const stack: string[] = [];
  const from = Math.max(0, view.viewport.from - 4000), to = view.viewport.to;
  const text = doc.sliceString(from, to);
  const inText = (pos: number) => {
    const n = tree.resolveInner(pos, 1).name;
    return /String|Comment|Regex|Template|Escape/.test(n) && !/Interpolation/.test(n);
  };
  const out: { at: number; d: number | "x" }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const o = OPEN.indexOf(ch), c = CLOSE.indexOf(ch);
    if (o < 0 && c < 0) continue;
    const pos = from + i;
    if (inText(pos)) continue;
    if (o >= 0) { out.push({ at: pos, d: stack.length % COLORS }); stack.push(ch); }
    else if (stack.length && OPEN.indexOf(stack[stack.length - 1]) === c) { stack.pop(); out.push({ at: pos, d: stack.length % COLORS }); }
    else out.push({ at: pos, d: "x" });
  }
  for (const r of out) if (r.at >= view.viewport.from) b.add(r.at, r.at + 1, r.d === "x" ? lost : marks[r.d]);
  return b.finish();
}

export const rainbowBrackets: Extension = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = colorize(v); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = colorize(u.view); }
}, { decorations: (p) => p.decorations });

// ---------- タグ名の同時編集(<div> の div を直すと </div> も変わる) ----------
type Span = { from: number; to: number };
function tagPair(state: EditorState, a: number, b: number): { self: Span; other: Span; isOpen: boolean } | null {
  const tree = syntaxTree(state);
  let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(a, -1);
  while (n && n.name !== "TagName" && n.name !== "Element") n = n.parent;
  if (!n || n.name !== "TagName" || n.to < b || n.from > a) {
    // 範囲の端が名前の終わりに接しているとき(末尾への入力)
    const m = tree.resolveInner(a, 1);
    n = m.name === "TagName" ? m : null;
    if (!n || n.to < b || n.from > a) return null;
  }
  const tag = n.parent;
  if (!tag || (tag.name !== "OpenTag" && tag.name !== "CloseTag")) return null;
  const el = tag.parent;
  if (!el || el.name !== "Element") return null;
  const find = (name: string) => { for (let c = el.firstChild; c; c = c.nextSibling) if (c.name === name) return c; return null; };
  const otherTag = tag.name === "OpenTag" ? find("CloseTag") : find("OpenTag");
  const otherName = otherTag?.getChild("TagName");
  if (!otherName) return null;
  return { self: { from: n.from, to: n.to }, other: { from: otherName.from, to: otherName.to }, isOpen: tag.name === "OpenTag" };
}

export const tagSync: Extension = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  let hit: { a: number; b: number } | null = null, count = 0;
  tr.changes.iterChangedRanges((fa, ta) => { count++; hit = { a: fa, b: ta }; });
  if (count !== 1 || !hit) return tr;
  const { a, b } = hit as { a: number; b: number };
  const pair = tagPair(tr.startState, a, b);
  if (!pair) return tr;
  const from = tr.changes.mapPos(pair.self.from, -1), to = tr.changes.mapPos(pair.self.to, 1);
  if (to < from) return tr;
  const name = tr.newDoc.sliceString(from, to);
  if (!/^[A-Za-z][\w:.-]*$/.test(name) && name !== "") return tr;
  const of = tr.changes.mapPos(pair.other.from, -1), ot = tr.changes.mapPos(pair.other.to, 1);
  if (tr.newDoc.sliceString(of, ot) === name) return tr;
  return [tr, { changes: { from: of, to: ot, insert: name }, sequential: true }];
});

// ---------- エラーの波線 ----------
const t = (k: string) => i18next.t(k);
const source = (view: EditorView): Diagnostic[] => {
  const out: Diagnostic[] = [];
  const doc = view.state.doc;
  const tree = syntaxTree(view.state);
  let count = 0;
  tree.iterate({
    enter: (n) => {
      if (count > 200) return false;
      if (n.name === "MismatchedCloseTag") { count++; out.push({ from: n.from, to: n.to, severity: "error", message: t("対応する開始タグがありません") }); return false; }
      if (n.type.isError) {
        count++;
        const from = Math.min(n.from, doc.length), to = Math.max(Math.min(n.to, doc.length), Math.min(from + 1, doc.length));
        out.push({ from, to, severity: "error", message: t("構文エラー") });
        return false;
      }
    },
  });
  // JSON は、構文木より正確な位置を JSON.parse から取る
  const name = view.state.facet(fileName);
  if (/\.(json|jsonc?)$/i.test(name) && doc.length && !out.length) {
    try { JSON.parse(doc.toString()); } catch (e) {
      const m = /position (\d+)/.exec(String((e as Error).message));
      const p = m ? Math.min(Number(m[1]), doc.length) : 0;
      out.push({ from: Math.max(0, Math.min(p, doc.length - 1)), to: Math.min(doc.length, p + 1), severity: "error", message: t("JSON の書き方が正しくありません") });
    }
  }
  return out;
};
export const diagnostics: Extension = linter(source, { delay: 450 });

// ---------- ミニマップ ----------
export const minimap: Extension = showMinimap.compute(["doc"], () => ({
  create: () => ({ dom: Object.assign(document.createElement("div"), { className: "fx-minimap" }) }),
  displayText: "characters",
  showOverlay: "always",
}));
