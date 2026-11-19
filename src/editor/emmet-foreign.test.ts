import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { closeBrackets } from "@codemirror/autocomplete";
import * as E from "@emmetio/codemirror6-plugin";
import { emmetExtensions } from "./emmetExt";
import { closeTagInString, openTagBefore } from "./autoclose";

async function make(file: string, text: string) {
  const at = text.indexOf("|"); const doc = text.replace("|", ""); const pos = at < 0 ? doc.length : at;
  const ld = LanguageDescription.matchFilename(languages, file)!; const lang = await ld.load();
  return new EditorView({ state: EditorState.create({ doc, selection: { anchor: pos }, extensions: [lang, closeBrackets(), closeTagInString, ...emmetExtensions(E, "html", "{}")] }), parent: document.body });
}
const type = (v: EditorView, t: string) => { for (const ch of t) { const h = v.state.selection.main.head; const hs = v.state.facet(EditorView.inputHandler); const mk = () => v.state.update({ changes: { from: h, insert: ch }, selection: { anchor: h + 1 }, userEvent: "input.type" }); if (!hs.some((f) => f(v, h, h, ch, mk))) v.dispatch(mk()); } };
const key = (v: EditorView, k: string) => runScopeHandlers(v, new KeyboardEvent("keydown", { key: k }), "editor");

const CASES: [string, string][] = [["a.py", 'html = """\n|\n"""'], ["a.py", "x = '|'"], ["a.go", "s := `\n|`"], ["a.rb", 's = "|"'], ["a.ts", "const h = `\n|`;"], ["a.js", 'const h = "|";'], ["a.rs", 'let s = r#"\n|"#;'], ["a.java", 'String s = "|";']];
describe("HTML 以外のファイルの文字列の中で Emmet", () => {
  for (const [f, head] of CASES) it(`${f}: ${JSON.stringify(head)}`, async () => { const v = await make(f, head); type(v, "ul>li*2"); expect(key(v, "Tab")).toBe(true); expect(v.state.doc.toString()).toMatch(/<ul>[\s\S]*<li><\/li>[\s\S]*<li><\/li>/); });
  it("コード部分(文字列の外)では展開しない", async () => { const v = await make("a.py", "def "); type(v, "ul>li"); key(v, "Tab"); expect(v.state.doc.toString()).toBe("def ul>li"); });
  it("文字列の外の Enter は普通の改行", async () => { const v = await make("a.py", "x = "); type(v, "h1"); expect(key(v, "Enter")).toBe(false); });
  it("文字列の中の Enter で展開", async () => { const v = await make("a.py", "x = '|'"); type(v, "h1"); expect(key(v, "Enter")).toBe(true); expect(v.state.doc.toString()).toBe("x = '<h1></h1>'"); });
});
describe("</ で閉じる", () => {
  it("openTagBefore", () => { expect(openTagBefore("<div><p>a</p><ul><li>")).toBe("li"); expect(openTagBefore("<div><br><img src='a>b'>")).toBe("div"); expect(openTagBefore("<a/><b></b>")).toBeNull(); expect(openTagBefore("<div><span></span>")).toBe("div"); });
  it("Python の文字列の中", async () => { const v = await make("a.py", 'h = """<div><p>x'); type(v, "</"); expect(v.state.doc.toString()).toBe('h = """<div><p>x</p>'); type(v, "</"); expect(v.state.doc.toString()).toBe('h = """<div><p>x</p></div>'); });
  it("文字列の外では何もしない", async () => { const v = await make("a.py", "a = 1 <div>"); type(v, "</"); expect(v.state.doc.toString()).toBe("a = 1 <div></"); });
  it("閉じていないタグが無ければ何もしない", async () => { const v = await make("a.py", 's = "<p>a</p>'); type(v, "</"); expect(v.state.doc.toString()).toBe('s = "<p>a</p></'); });
});
