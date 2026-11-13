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
// HTML/XML/Vue/PHP は OpenTag・CloseTag、JSX/TSX は JSXOpenTag・JSXCloseTag(<></> は JSXFragmentTag)。閉じ側に名前がない </> は IncompleteCloseTag
const OPENS = new Set(["OpenTag", "JSXOpenTag", "JSXFragmentTag"]);
const CLOSES = new Set(["CloseTag", "JSXCloseTag", "IncompleteCloseTag"]);
const ELEMS = new Set(["Element", "JSXElement"]);
type SyntaxNode = NonNullable<ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>>;
// タグの文字列から名前の範囲を求める(名前が空なら幅 0)
function nameSpan(state: EditorState, tag: SyntaxNode): Span | null {
  const head = /^<\/?/.exec(state.sliceDoc(tag.from, Math.min(tag.to, tag.from + 2)));
  if (!head) return null;
  const s = tag.from + head[0].length;
  const m = /^[A-Za-z_$][\w:.$-]*/.exec(state.sliceDoc(s, Math.min(tag.to, s + 200)));
  return { from: s, to: s + (m ? m[0].length : 0) };
}
function tagPair(state: EditorState, a: number, b: number): { self: Span; other: Span; isOpen: boolean } | null {
  const tree = syntaxTree(state);
  for (const side of [-1, 1] as const) {
    let n: SyntaxNode | null = tree.resolveInner(a, side);
    while (n && !OPENS.has(n.name) && !CLOSES.has(n.name)) n = n.parent;
    if (!n) continue;
    const self = nameSpan(state, n);
    if (!self || self.from > a || self.to < b) continue;
    const el = n.parent;
    if (!el || !ELEMS.has(el.name)) continue;
    const isOpen = OPENS.has(n.name), want = isOpen ? CLOSES : OPENS;
    let other: Span | null = null;
    for (let c = el.firstChild; c; c = c.nextSibling) if (want.has(c.name)) { other = nameSpan(state, c); break; }
    if (!other) continue;
    // 編集前に名前が一致していない組(<br> が次の </div> と組にされた等)は、別々のタグなので同期しない
    if (state.sliceDoc(self.from, self.to).toLowerCase() !== state.sliceDoc(other.from, other.to).toLowerCase()) continue;
    return { self, other, isOpen };
  }
  return null;
}

// 名前のない <> に対応する </> の位置(入れ子の <> を数えて探す)
function emptyCloseAt(state: EditorState, from: number): number {
  const rest = state.sliceDoc(from, Math.min(state.doc.length, from + 20000));
  let depth = 0;
  for (const m of rest.matchAll(/<\/>|<>/g)) {
    if (m[0] === "<>") depth++;
    else if (depth-- === 0) return from + m.index!;
  }
  return -1;
}

export const tagSync: Extension = EditorState.transactionFilter.of((tr: Transaction) => {
  if (!tr.docChanged || tr.annotation(Transaction.remote) || !(tr.isUserEvent("input") || tr.isUserEvent("delete"))) return tr;
  let hit: { a: number; b: number } | null = null, count = 0;
  tr.changes.iterChangedRanges((fa, ta) => { count++; hit = { a: fa, b: ta }; });
  if (count !== 1 || !hit) return tr;
  const { a, b } = hit as { a: number; b: number };
  // <div> と打って自動で </div> が入るとき、直後に空の </> が残っていたら消す(</div></> にならないように)
  if (tr.isUserEvent("input")) {
    let ins = "", endB = 0;
    tr.changes.iterChanges((_fa, _ta, _fb, tb, text) => { ins = text.toString(); endB = tb; });
    if (/<\/[A-Za-z][\w:.-]*>$/.test(ins) && tr.newDoc.sliceString(endB, endB + 3) === "</>")
      return [tr, { changes: { from: endB, to: endB + 3 }, sequential: true }];
  }
  // 名前が空の開始タグ <> の < を消したら、対になる </> も消す(開始タグを消しきると終了タグも消える)
  // 閉じの > から消してきて、名前も消え <</> になったときも、残った < を消すと </> も消す
  if (tr.isUserEvent("delete") && b - a === 1 && tr.startState.sliceDoc(a, a + 4) === "<</>") {
    return [tr, { changes: { from: tr.changes.mapPos(a + 1, 1), to: tr.changes.mapPos(a + 4, 1) }, sequential: true }];
  }
  if (tr.isUserEvent("delete") && b - a === 1 && tr.startState.sliceDoc(a, a + 2) === "<>") {
    const at = emptyCloseAt(tr.startState, a + 2);
    if (at >= 0) return [tr, { changes: { from: tr.changes.mapPos(at, 1), to: tr.changes.mapPos(at + 3, 1) }, sequential: true }];
    return tr;
  }
  // HTML で名前のない <> に名前を打ち始めたとき(木では Element にならない)、対応する </> にも同じ名前を入れる
  if (tr.isUserEvent("input") && a === b && tr.startState.sliceDoc(a - 1, a + 1) === "<>") {
    const at = emptyCloseAt(tr.startState, a + 1);
    const ins = tr.newDoc.sliceString(a, tr.changes.mapPos(a, 1));
    if (at >= 0 && /^[A-Za-z][\w:.-]*$/.test(ins))
      return [tr, { changes: { from: tr.changes.mapPos(at + 2, 1), to: tr.changes.mapPos(at + 2, 1), insert: ins }, sequential: true }];
  }
  const pair = tagPair(tr.startState, a, b);
  if (!pair) return tr;
  const from = tr.changes.mapPos(pair.self.from, -1), to = tr.changes.mapPos(pair.self.to, 1);
  if (to < from) return tr;
  const name = tr.newDoc.sliceString(from, to);
  if (!/^[A-Za-z_$][\w:.$-]*$/.test(name) && name !== "") return tr;
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
        // 同じ所に重なって見つかった構文エラーは 1 つにまとめる(ホバーに同じ文言が並ばないように)
        const msg = t("構文エラー"), dup = out.find((d) => d.message === msg && d.from <= to && from <= d.to);
        if (dup) { dup.from = Math.min(dup.from, from); dup.to = Math.max(dup.to, to); } else out.push({ from, to, severity: "error", message: msg });
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
