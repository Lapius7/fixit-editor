import { langService } from "@/editor/langsvc";
import { rainbowBrackets, tagSync, diagnostics, minimap } from "@/editor/intel";
import { EditorSelection, EditorState, countColumn, type Extension, type Text } from "@codemirror/state";
import { gitGutter } from "./gitgutter";
import { Decoration, ViewPlugin, type DecorationSet, type ViewUpdate, EditorView, RectangleMarker, layer, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, lineNumbers, rectangularSelection, scrollPastEnd } from "@codemirror/view";
import { highlightSelectionMatches } from "@codemirror/search";
import type { Settings } from "@/features/settings/settings";
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit } from "@codemirror/language";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { keymap } from "@codemirror/view";
import { indentLess, indentMore } from "@codemirror/commands";
import { MANAGED } from "@/editor/edit-cmds";
import { snippetSource } from "@/editor/snippets";

// Tab: 候補が開いていれば確定、範囲選択があれば行ごとにインデント、
// カーソルだけなら次のタブ位置まで空白(またはタブ文字)を入れる。Shift+Tab は逆
const tabKey = (v: EditorView): boolean => {
  if (v.state.readOnly) return false;
  if (v.state.selection.ranges.some((r) => !r.empty)) return indentMore(v);
  const unit = v.state.facet(indentUnit), ts = v.state.tabSize;
  v.dispatch(v.state.changeByRange((r) => {
    const line = v.state.doc.lineAt(r.head);
    const ins = unit.startsWith("\t") ? "\t" : " ".repeat(ts - (countColumn(line.text.slice(0, r.head - line.from), ts) % ts));
    return { changes: { from: r.head, insert: ins }, range: EditorSelection.cursor(r.head + ins.length) };
  }), { userEvent: "input", scrollIntoView: true });
  return true;
};

// 文書内の単語を候補にする(言語ごとの補完に加えて、どの言語でも効く)
const WORD = /[\p{L}\p{N}_$]{3,}/gu;
const SPAN = 200_000; // 大きい文書は、カーソルの前後この文字数だけから集める(1 打鍵ごとに全体を走査しない)
type Counted = { doc: Text; from: number; to: number; words: Map<string, number> };
// 結果はエディタ(view)ごとに持つ。別のファイルの単語が混ざらないように
const countedBy = new WeakMap<object, Counted>();
function wordsNear(doc: Text, pos: number, owner?: object) {
  const counted = owner ? countedBy.get(owner) : undefined;
  const from = Math.max(0, Math.min(pos - SPAN / 2, doc.length - SPAN)), to = Math.min(doc.length, from + SPAN);
  // 同じ文書なら前の結果を使う。大きい文書で範囲が重なるあいだは、打った字の分の古さは気にしない
  if (counted && (counted.doc === doc || (doc.length > SPAN && Math.abs(counted.from - from) < SPAN / 4 && Math.abs(counted.doc.length - doc.length) < 4096))) return counted.words;
  const words = new Map<string, number>();
  for (const m of doc.sliceString(from, to).matchAll(WORD)) words.set(m[0], (words.get(m[0]) ?? 0) + 1);
  if (owner) countedBy.set(owner, { doc, from, to, words });
  return words;
}
function wordSource(ctx: CompletionContext): CompletionResult | null {
  const w = ctx.matchBefore(/[\p{L}\p{N}_$]{2,}/u);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const typed = w.text, low = typed.toLowerCase();
  // カーソルのある単語そのものは候補に出さない(1 回しか出てこない単語だけを除く)
  const line = ctx.state.doc.lineAt(w.from), here = /^[\p{L}\p{N}_$]*/u.exec(line.text.slice(w.from - line.from))?.[0] ?? typed;
  const options = [...wordsNear(ctx.state.doc, ctx.pos, ctx.view).entries()]
    .filter(([s, n]) => s !== typed && !(s === here && n < 2) && s.toLowerCase().startsWith(low))
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 30)
    .map(([label]) => ({ label, type: "text", boost: -1 }));
  return options.length ? { from: w.from, options, validFor: /^[\p{L}\p{N}_$]*$/u } : null;
}

// 切り替えられない部分
export const power: Extension = [
  highlightSpecialChars(),
  dropCursor(),
  rectangularSelection(),
  crosshairCursor(),
  EditorState.allowMultipleSelections.of(true),
  codeFolding(),
  keymap.of([{ key: "Tab", run: acceptCompletion }, { key: "Tab", run: tabKey, shift: indentLess }, ...closeBracketsKeymap, ...completionKeymap, ...foldKeymap.filter((b) => !MANAGED.has(b.run))]),
];

// 選択範囲の背景。CodeMirror の標準は、改行を含む行を右端まで塗るので、
// 「文字のない空白」まで選んだように見える。行末は改行1文字ぶんだけ塗る(VS Code と同じ)
// 範囲を選んでいる間、エディタに cm-hasSel を付ける(テーマ側でカーソル行の帯を消すのに使う)
// 折り返しオフで横にスクロールすると、字が行番号とミニマップの下を通る。字の側をマスクで隠す(位置は CSS 変数で渡す)
const hScrollMask = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    this.on = () => this.sync();
    view.scrollDOM.addEventListener("scroll", this.on, { passive: true });
    // 画面の大きさやミニマップの幅が変わっても、マスクの位置を合わせ直す(古い値のままだと、字がミニマップの下に突き抜ける)
    this.ro = new ResizeObserver(() => this.sync());
    this.ro.observe(view.scrollDOM);
    this.sync();
  }
  ro: ResizeObserver; seen = new Set<Element>();
  on: () => void;
  update(u: ViewUpdate) { if (u.geometryChanged || u.viewportChanged) this.sync(); }
  sync() {
    const sc = this.view.scrollDOM, dom = this.view.dom, over = sc.scrollWidth > sc.clientWidth + 1;
    // class ではなく data 属性で持つ(選択やフォーカスが変わると、CodeMirror が view.dom の class を書き直し、手で付けた class は消える。消えた間、字が行番号とミニマップの上に突き抜けていた)
    if (over) dom.setAttribute("data-hmask", ""); else dom.removeAttribute("data-hmask");
    if (!over) return;
    const gw = (sc.querySelector(".cm-gutters") as HTMLElement | null)?.offsetWidth ?? 0;
    const mw = (dom.querySelector(".cm-minimap-gutter") as HTMLElement | null)?.offsetWidth ?? 0;
    // 端は、その先に字があるときだけ薄くぼかす(左端なら左は切らない。右端なら右は切らない)。切れ目の向きで、動かせる方向が分かる
    const x = sc.scrollLeft, max = sc.scrollWidth - sc.clientWidth, F = 14;
    dom.style.setProperty("--cm-l", `${x}px`);
    dom.style.setProperty("--cm-lf", `${Math.min(F, Math.max(0, x))}px`);
    dom.style.setProperty("--cm-r", `${x + sc.clientWidth - gw - mw}px`);
    dom.style.setProperty("--cm-rf", `${Math.min(F, Math.max(0, max - x))}px`);
  }
  destroy() { this.view.scrollDOM.removeEventListener("scroll", this.on); this.view.dom.removeAttribute("data-hmask"); this.ro.disconnect(); }
});
const hasSelClass = EditorView.editorAttributes.compute(["selection"], (st) => ({ class: st.selection.ranges.some((r) => !r.empty) ? "cm-hasSel" : "" }));
const trimmedSelection = layer({
  above: false,
  class: "cm-selTrim",
  markers(view) {
    const out: RectangleMarker[] = [];
    const sb = view.scrollDOM.getBoundingClientRect();
    const baseL = sb.left - view.scrollDOM.scrollLeft, baseT = sb.top - view.scrollDOM.scrollTop;
    const nl = view.defaultCharacterWidth, lh = view.defaultLineHeight;
    const vp = view.viewport;
    for (const r of view.state.selection.ranges) {
      if (r.empty) continue;
      const to = Math.min(r.to, vp.to);
      let pos = Math.max(r.from, vp.from);
      let guard = 0;
      while (pos <= to && guard++ < 4000) {
        const line = view.state.doc.lineAt(pos);
        let end = view.moveToLineBoundary(EditorSelection.cursor(pos, 1), true).head;
        if (end <= pos) end = line.to;
        const segEnd = Math.min(to, end);
        const a = view.coordsAtPos(pos, 1);
        const z = segEnd > pos ? view.coordsAtPos(segEnd, -1) : a;
        if (a && z) {
          const breaks = r.to > line.to && segEnd >= line.to; // この行の改行まで選んでいる
          const left = a.left;
          const right = (segEnd > pos ? z.right : a.left) + (breaks ? nl : 0);
          // 字の高さではなく行の高さ(line-height)ぶん塗る。行と行のあいだに隙間を作らない(VS Code と同じ)。座標は整数に丸めて、継ぎ目の細い線も出さない
          const mid = (a.top + a.bottom) / 2;
          const top = Math.round(mid - lh / 2 - baseT), bottom = Math.round(mid + lh / 2 - baseT);
          if (right > left) out.push(new RectangleMarker("cm-selectionBackground", left - baseL, top, right - left, bottom - top));
        }
        if (segEnd >= r.to) break;
        pos = segEnd >= line.to ? line.to + 1 : segEnd;
      }
    }
    return out;
  },
  update: (u) => u.docChanged || u.selectionSet || u.viewportChanged || u.geometryChanged || u.focusChanged,
});

// 折り返した行を、その行の字下げの位置にそろえる(インデント線が折り返した文字に重ならない)
const hangingIndent = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(v: EditorView) { this.decorations = this.build(v); }
  update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.geometryChanged) this.decorations = this.build(u.view); }
  build(v: EditorView) {
    const ts = v.state.tabSize, ranges: ReturnType<Decoration["range"]>[] = [];
    for (const { from, to } of v.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = v.state.doc.lineAt(pos);
        const ws = /^[ \t]*/.exec(line.text)![0];
        const cols = countColumn(ws, ts);
        if (cols) ranges.push(Decoration.line({ attributes: { style: `padding-left:calc(var(--pad-x, 2px) + ${cols}ch);text-indent:-${cols}ch` } }).range(line.from));
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges);
  }
}, { decorations: (p) => p.decorations });

const BLINK: Record<string, number> = { off: 0, slow: 1600, normal: 1200, fast: 600 };
export type EditorOpts = Pick<Settings,
  "tabSize" | "insertSpaces" | "wrap" | "lineNumbers" | "activeLine" | "foldGutter" | "indentGuides" | "bracketMatching" | "matchHighlight" | "rainbowBrackets" | "tagSync" | "diagnostics" | "langService" | "minimap" | "whitespace" | "cursorBlink" |
  "autocomplete" | "autocompleteDelay" | "completeMax" | "completeIcons" | "wordComplete" | "closeBrackets" | "indentOnInput" | "scrollPastEnd" | "spellcheck" | "readOnly">;

// 設定で入り切りする部分。ひとつの Compartment にまとめて、設定が変わるたびに組み直す
export const dynamic = (o: EditorOpts): Extension => [
  indentUnit.of(o.insertSpaces ? " ".repeat(o.tabSize) : "\t"),
  EditorState.tabSize.of(o.tabSize),
  o.wrap ? [EditorView.lineWrapping, hangingIndent] : [],
  o.lineNumbers ? lineNumbers() : [],
  gitGutter(),
  o.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
  o.foldGutter ? foldGutter({ openText: "⌄", closedText: "›" }) : [],
  o.indentGuides ? indentationMarkers({
    highlightActiveBlock: true, hideFirstIndent: true, markerType: "fullScope", thickness: 1,
    colors: { light: "var(--indent)", dark: "var(--indent)", activeLight: "var(--indent-on)", activeDark: "var(--indent-on)" },
  }) : [],
  o.bracketMatching ? bracketMatching() : [],
  o.matchHighlight ? highlightSelectionMatches() : [],
  o.rainbowBrackets ? rainbowBrackets : [], o.tagSync ? tagSync : [], o.diagnostics ? diagnostics : [], o.langService ? langService() : [], o.minimap ? minimap : [],
  o.whitespace === "all" ? highlightWhitespace() : o.whitespace === "trailing" ? highlightTrailingWhitespace() : [],
  o.closeBrackets ? closeBrackets() : [],
  o.indentOnInput ? indentOnInput() : [],
  o.autocomplete ? [
    autocompletion({ defaultKeymap: true, icons: o.completeIcons, maxRenderedOptions: o.completeMax, activateOnTypingDelay: o.autocompleteDelay }),
    o.wordComplete ? EditorState.languageData.of(() => [{ autocomplete: wordSource }]) : [],
    EditorState.languageData.of(() => [{ autocomplete: snippetSource }]),
  ] : [],
  o.scrollPastEnd ? scrollPastEnd() : [],
  drawSelection({ cursorBlinkRate: BLINK[o.cursorBlink] ?? 1200 }),
  trimmedSelection, hasSelClass, hScrollMask,
  EditorView.contentAttributes.of({ spellcheck: o.spellcheck ? "true" : "false" }),
  EditorState.readOnly.of(o.readOnly),
  EditorView.editable.of(!o.readOnly),
];
