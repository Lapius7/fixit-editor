import { readClip, writeClip } from "@/platform/clipboard";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { copyLineDown, copyLineUp, deleteLine, indentLess, indentMore, insertBlankLine, moveLineDown, moveLineUp, redo, selectLine, toggleBlockComment, toggleComment, undo } from "@codemirror/commands";
import { findNext, findPrevious, gotoLine, openSearchPanel, selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { foldAll, foldCode, unfoldAll, unfoldCode } from "@codemirror/language";

export type Run = (v: EditorView) => unknown;

const text = (v: EditorView) => {
  const r = v.state.selection.main;
  return r.empty ? { from: v.state.doc.lineAt(r.head).from, to: Math.min(v.state.doc.length, v.state.doc.lineAt(r.head).to + 1), line: true } : { from: r.from, to: r.to, line: false };
};
const mapSel = (f: (s: string) => string): Run => (v) => {
  v.dispatch(v.state.changeByRange((r) => {
    if (r.empty) return { range: r };
    const t = f(v.state.sliceDoc(r.from, r.to));
    return { changes: { from: r.from, to: r.to, insert: t }, range: EditorSelection.range(r.from, r.from + t.length) };
  }));
  return true;
};
const lines = (f: (l: string[]) => string[]): Run => (v) => {
  const s = v.state, m = s.selection.main;
  const from = m.empty ? 0 : s.doc.lineAt(m.from).from, to = m.empty ? s.doc.length : s.doc.lineAt(m.to).to;
  v.dispatch({ changes: { from, to, insert: f(s.sliceDoc(from, to).split("\n")).join("\n") } });
  return true;
};
const clip = (s: string) => writeClip(s);

export const EDIT: Record<string, Run> = {
  undo, redo, comment: toggleComment, blockComment: toggleBlockComment, indentMore, indentLess,
  dupDown: copyLineDown, dupUp: copyLineUp, moveDown: moveLineDown, moveUp: moveLineUp, deleteLine, blankBelow: insertBlankLine, selectLine,
  find: openSearchPanel, replace: openSearchPanel, findNext, findPrev: findPrevious, gotoLine, selectNext: selectNextOccurrence, selectMatches: selectSelectionMatches,
  fold: foldCode, unfold: unfoldCode, foldAll, unfoldAll,
  upper: mapSel((s) => s.toUpperCase()), lower: mapSel((s) => s.toLowerCase()),
  sortLines: lines((l) => [...l].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }))),
  trimSpace: lines((l) => l.map((x) => x.replace(/[ \t]+$/, ""))),
  copy: (v) => { const t = text(v); clip(v.state.sliceDoc(t.from, t.to)); return true; },
  cut: (v) => { const t = text(v); clip(v.state.sliceDoc(t.from, t.to)); v.dispatch({ changes: { from: t.from, to: t.to } }); return true; },
  paste: async (v) => { const s = await readClip(); if (s) v.dispatch(v.state.replaceSelection(s)); v.focus(); return true; },
};

// CodeMirror 標準のキー割り当てのうち、設定で変えられるようにした機能(標準側からは外す)
export const MANAGED = new Set<unknown>([undo, redo, toggleComment, toggleBlockComment, indentMore, indentLess, copyLineDown, copyLineUp, moveLineDown, moveLineUp, deleteLine, insertBlankLine, selectLine, openSearchPanel, findNext, findPrevious, gotoLine, selectNextOccurrence, selectSelectionMatches, foldCode, unfoldCode, foldAll, unfoldAll]);
