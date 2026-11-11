import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const syn = (v: string) => `color-mix(in srgb, var(${v}) var(--syn-k, 100%), var(--editor-ink))`;
// 色は CSS 変数(styles.css のライト/ダーク)から取る
const hl = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: syn("--c-kw") },
  { tag: [t.typeName, t.className, t.namespace], color: syn("--c-type") },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: syn("--c-fn") },
  { tag: [t.string, t.special(t.string)], color: syn("--c-str") },
  { tag: [t.number, t.bool, t.null, t.atom], color: syn("--c-num") },
  { tag: [t.comment, t.lineComment, t.blockComment], color: syn("--c-com"), fontStyle: "var(--com-style, italic)" },
  { tag: [t.propertyName, t.attributeName], color: syn("--c-prop") },
  { tag: [t.heading], color: syn("--c-kw"), fontWeight: "700" },
  { tag: [t.link, t.url], color: "var(--accent)", textDecoration: "underline" },
  { tag: [t.meta, t.annotation], color: syn("--c-meta") },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
]);

const E = "cubic-bezier(.2,0,0,1)";
const base = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--editor-ink)", fontSize: "var(--fs)" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontWeight: "var(--code-w, 400)", letterSpacing: "var(--ls, 0)", lineHeight: "var(--lh, 22px)", overscrollBehavior: "contain" },
  ".cm-content": { padding: "var(--pad-y, 14px) 0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0 24px 0 var(--pad-x, 2px)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--gutter)" },
  // 横にスクロールしたとき、行番号とミニマップの下を通る字は、字のほうを隠す(背景と同じ色のまま、固定に見せる)
  "&[data-hmask] .cm-content": { maskImage: "linear-gradient(to right, #0000 var(--cm-l), #000 calc(var(--cm-l) + var(--cm-lf, 0px)), #000 calc(var(--cm-r) - var(--cm-rf, 0px)), #0000 var(--cm-r))", WebkitMaskImage: "linear-gradient(to right, #0000 var(--cm-l), #000 calc(var(--cm-l) + var(--cm-lf, 0px)), #000 calc(var(--cm-r) - var(--cm-rf, 0px)), #0000 var(--cm-r))" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 22px", minWidth: "50px" },
  ".cm-git-gutter": { width: "6px" },
  ".cm-git-gutter .cm-gutterElement": { padding: "0" },
  ".cm-git-mark": { width: "3px", height: "100%", borderRadius: "2px" },
  ".cm-git-add": { background: "var(--git-add)" },
  ".cm-git-mod": { background: "var(--git-mod)" },
  ".cm-git-del": { background: "var(--git-del)", height: "3px", width: "6px", marginTop: "-1px" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
  "&.cm-hasSel": { "--indent-on": "var(--indent)" }, // 範囲を選んでいる間は、いまの階層の濃い縦線を通常の線に戻す(選択と同時に出ない)
  "&.cm-hasSel .cm-activeLine": { backgroundColor: "transparent" }, // 範囲を選んでいるときは、カーソル行の帯を消す(選択の上に濃い帯が重ならない)
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--gutter-active)" },
  "&.cm-focused": { outline: "none" },
  ".cm-selectionLayer": { display: "none" },
  ".cm-selTrim": { zIndex: "-1" },
  ".cm-cursor": { borderLeftWidth: "var(--cur-w, 1.5px)", borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "var(--sel) !important" },
  ".cm-matchingBracket": { backgroundColor: "var(--sel)", outline: "none" },
  ".cm-searchMatch": { backgroundColor: "var(--match)", outline: "none", borderRadius: "3px" },
  ".cm-searchMatch-selected": { backgroundColor: "var(--match-now)" },
  ".cm-panels": { backgroundColor: "transparent", border: "none", color: "var(--ink)" },
  ".cm-foldGutter span": { color: "var(--gutter)", cursor: "pointer", padding: "0 4px", opacity: "0", transition: `opacity .15s ${E}` },
  ".cm-gutters:hover .cm-foldGutter span, .cm-foldGutter span[title*=nfold]": { opacity: "1" },
  ".cm-foldPlaceholder": { backgroundColor: "var(--sel)", border: "none", color: "var(--accent)", borderRadius: "6px", padding: "0 6px", margin: "0 4px" },
  ".cm-tooltip": { borderRadius: "10px", border: "none", color: "var(--ink)", boxShadow: "0 8px 30px var(--shadow-soft), 0 0 0 1px var(--edge)", backgroundColor: "var(--pop)", backdropFilter: "blur(20px) saturate(1.6)" },
  ".cm-tooltip.cm-tooltip-autocomplete": { padding: "4px", animation: `pop .14s ${E}`, transformOrigin: "top left" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "260px", overscrollBehavior: "contain" },
  ".cm-tooltip-autocomplete > ul > li": { borderRadius: "6px", padding: "2px 8px", lineHeight: "20px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent)", color: "#fff" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-completionDetail": { opacity: ".6", marginLeft: "10px" },
});

export const fixitTheme = [base, syntaxHighlighting(hl)];
