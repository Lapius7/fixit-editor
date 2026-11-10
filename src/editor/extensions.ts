import { langService } from "@/editor/langsvc";
import { rainbowBrackets, tagSync, diagnostics, minimap } from "@/editor/intel";
import { EditorSelection, EditorState, countColumn, type Extension } from "@codemirror/state";
import { EditorView, RectangleMarker, layer, crosshairCursor, drawSelection, dropCursor, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, highlightTrailingWhitespace, highlightWhitespace, lineNumbers, rectangularSelection, scrollPastEnd } from "@codemirror/view";
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
function wordSource(ctx: CompletionContext): CompletionResult | null {
  const w = ctx.matchBefore(/[\p{L}\p{N}_$]{2,}/u);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const text = ctx.state.doc.toString();
  const seen = new Map<string, number>();
  for (const m of text.matchAll(WORD)) {
    if (m.index === w.from) continue;
    seen.set(m[0], (seen.get(m[0]) ?? 0) + 1);
  }
  const typed = w.text;
  const options = [...seen.entries()]
    .filter(([s]) => s !== typed && s.toLowerCase().startsWith(typed.toLowerCase()))
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

const BLINK: Record<string, number> = { off: 0, slow: 1600, normal: 1200, fast: 600 };
export type EditorOpts = Pick<Settings,
  "tabSize" | "insertSpaces" | "wrap" | "lineNumbers" | "activeLine" | "foldGutter" | "indentGuides" | "bracketMatching" | "matchHighlight" | "rainbowBrackets" | "tagSync" | "diagnostics" | "langService" | "minimap" | "whitespace" | "cursorBlink" |
  "autocomplete" | "autocompleteDelay" | "completeMax" | "completeIcons" | "wordComplete" | "closeBrackets" | "indentOnInput" | "scrollPastEnd" | "spellcheck" | "readOnly">;

// 設定で入り切りする部分。ひとつの Compartment にまとめて、設定が変わるたびに組み直す
export const dynamic = (o: EditorOpts): Extension => [
  indentUnit.of(o.insertSpaces ? " ".repeat(o.tabSize) : "\t"),
  EditorState.tabSize.of(o.tabSize),
  o.wrap ? EditorView.lineWrapping : [],
  o.lineNumbers ? lineNumbers() : [],
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
  trimmedSelection,
  EditorView.contentAttributes.of({ spellcheck: o.spellcheck ? "true" : "false" }),
  EditorState.readOnly.of(o.readOnly),
  EditorView.editable.of(!o.readOnly),
];
