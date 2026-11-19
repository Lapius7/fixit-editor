import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { closeBrackets } from "@codemirror/autocomplete";
import { abbreviationTracker, emmetConfig } from "@emmetio/codemirror6-plugin";

const make = (doc = "") => new EditorView({ state: EditorState.create({ doc, extensions: [html(), closeBrackets(), emmetConfig.of({ syntax: "html" as never }), abbreviationTracker({ syntax: "html" as never })] }), parent: document.body });
const type = (v: EditorView, t: string) => { for (const ch of t) { const h = v.state.selection.main.head; const hs = v.state.facet(EditorView.inputHandler); if (!hs.some((f) => f(v, h, h, ch, () => v.state.update({ changes: { from: h, insert: ch }, selection: { anchor: h + 1 }, userEvent: "input.type" })))) v.dispatch({ changes: { from: h, insert: ch }, selection: { anchor: h + 1 }, userEvent: "input.type" }); } };
const key = (v: EditorView, k: string) => runScopeHandlers(v, new KeyboardEvent("keydown", { key: k }), "editor");

describe("Emmet を打つ", () => {
  it("長い記法を最後まで打って Enter で展開できる", () => {
    const v = make(); type(v, "h1>form>input+button[type=submit]"); key(v, "Enter");
    expect(v.state.doc.toString()).toContain("<button");
  });
});

import { closeBeforeMore, templateAssist } from "./autoclose";
import { fileName } from "./intel";
describe("テンプレートの補助", () => {
  const mk = (doc: string, at: number) => { const v = new EditorView({ state: EditorState.create({ doc, selection: { anchor: at }, extensions: [html(), closeBrackets(), closeBeforeMore, templateAssist, fileName.of("a.html")] }), parent: document.body }); return v; };
  it("{ before < closes; {% and {{ }} assist", () => {
    let v = mk("<p></p>", 3); type(v, "{"); expect(v.state.doc.toString()).toBe("<p>{}</p>");
    v = mk("<p></p>", 3); type(v, "{%"); expect(v.state.doc.toString()).toBe("<p>{%  %}</p>"); expect(v.state.selection.main.head).toBe(6);
    v = mk("<p></p>", 3); type(v, "{{ "); expect(v.state.doc.toString()).toBe("<p>{{  }}</p>"); expect(v.state.selection.main.head).toBe(6);
    v = mk("<p></p>", 3); type(v, "{#"); expect(v.state.doc.toString()).toBe("<p>{#  #}</p>");
  });
});
