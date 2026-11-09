import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

// 画像の明るいテーマに合わせた配色(Xcode ライト系)
const hl = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: "#9b2393" },
  { tag: [t.typeName, t.className, t.namespace], color: "#8a5a00" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#3b6fd9" },
  { tag: [t.string, t.special(t.string)], color: "#c41a16" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#1c00cf" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6c7986", fontStyle: "italic" },
  { tag: [t.propertyName, t.attributeName], color: "#326d74" },
  { tag: [t.heading], color: "#9b2393", fontWeight: "700" },
  { tag: [t.link, t.url], color: "#3b6fd9", textDecoration: "underline" },
  { tag: [t.meta, t.annotation], color: "#643820" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
]);

const base = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "#26292e", fontSize: "13.5px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", fontVariantLigatures: "none", lineHeight: "22px", overscrollBehavior: "contain" },
  ".cm-content": { padding: "14px 0", caretColor: "#3b6fd9" },
  ".cm-line": { padding: "0 24px 0 8px" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#a0a7b2" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 14px 0 22px", minWidth: "44px" },
  ".cm-activeLine": { backgroundColor: "rgba(59,111,217,.07)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#4a5160" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftWidth: "1.5px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { backgroundColor: "rgba(59,111,217,.22) !important" },
  ".cm-matchingBracket": { backgroundColor: "rgba(59,111,217,.16)", outline: "none" },
  ".cm-panels": { backgroundColor: "rgba(255,255,255,.85)", backdropFilter: "blur(12px)", borderColor: "rgba(0,0,0,.08)" },
  ".cm-foldGutter span": { color: "#a0a7b2", cursor: "pointer", padding: "0 4px", opacity: "0", transition: "opacity .15s cubic-bezier(.2,0,0,1)" },
  ".cm-gutters:hover .cm-foldGutter span, .cm-foldGutter span[title*=nfold]": { opacity: "1" },
  ".cm-foldPlaceholder": { backgroundColor: "rgba(59,111,217,.12)", border: "none", color: "#3b6fd9", borderRadius: "6px", padding: "0 6px", margin: "0 4px" },
  ".cm-tooltip.cm-tooltip-autocomplete": { padding: "4px", backdropFilter: "blur(20px) saturate(1.6)", backgroundColor: "rgba(255,255,255,.82)", animation: "pop .14s cubic-bezier(.2,0,0,1)", transformOrigin: "top left" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)", fontSize: "12.5px", maxHeight: "260px", overscrollBehavior: "contain" },
  ".cm-tooltip-autocomplete > ul > li": { borderRadius: "6px", padding: "2px 8px", lineHeight: "20px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "#3b6fd9", color: "#fff" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "700" },
  ".cm-completionDetail": { opacity: ".6", marginLeft: "10px" },
  ".cm-tooltip": { borderRadius: "10px", border: "none", boxShadow: "0 8px 30px rgba(20,30,60,.18), 0 0 0 1px rgba(0,0,0,.06)", backgroundColor: "rgba(255,255,255,.95)" },
});

export const fixitTheme = [base, syntaxHighlighting(hl)];
