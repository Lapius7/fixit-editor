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
  ".cm-line": { padding: "0 24px 0 var(--pad-x, 8px)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--gutter)" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 22px", minWidth: "44px" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
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
