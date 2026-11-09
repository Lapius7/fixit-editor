import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, crosshairCursor, dropCursor, highlightSpecialChars, rectangularSelection } from "@codemirror/view";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { codeFolding, foldGutter, foldKeymap } from "@codemirror/language";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { keymap } from "@codemirror/view";

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

export const power: Extension = [
  highlightSpecialChars(),
  dropCursor(),
  rectangularSelection(),
  crosshairCursor(),
  EditorState.allowMultipleSelections.of(true),
  closeBrackets(),
  codeFolding(),
  foldGutter({ openText: "⌄", closedText: "›" }),
  autocompletion({ defaultKeymap: true, icons: false, maxRenderedOptions: 12 }),
  EditorState.languageData.of(() => [{ autocomplete: wordSource }]),
  indentationMarkers({
    highlightActiveBlock: true,
    hideFirstIndent: true,
    markerType: "fullScope",
    thickness: 1,
    colors: { light: "rgba(30,40,70,.10)", dark: "rgba(30,40,70,.10)", activeLight: "rgba(59,111,217,.45)", activeDark: "rgba(59,111,217,.45)" },
  }),
  EditorView.lineWrapping,
  keymap.of([...closeBracketsKeymap, ...completionKeymap, ...foldKeymap]),
];
