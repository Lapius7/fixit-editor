import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { closeBrackets } from "@codemirror/autocomplete";
import * as E from "@emmetio/codemirror6-plugin";
import { emmetExtensions } from "./emmetExt";
import { parseEmmetJson } from "./emmetJson";

type Syn = "html" | "css" | "jsx";
const lang = (s: Syn) => (s === "html" ? html() : s === "css" ? css() : javascript({ jsx: true }));
function make(s: Syn, doc = "", cfgJson: object = {}) {
  return new EditorView({ state: EditorState.create({ doc, extensions: [lang(s), closeBrackets(), ...emmetExtensions(E, s, JSON.stringify(cfgJson))] }), parent: document.body });
}
const type = (v: EditorView, t: string) => { for (const ch of t) { const h = v.state.selection.main.head; const hs = v.state.facet(EditorView.inputHandler); const mk = () => v.state.update({ changes: { from: h, insert: ch }, selection: { anchor: h + 1 }, userEvent: "input.type" }); if (!hs.some((f) => f(v, h, h, ch, mk))) v.dispatch(mk()); } };
const key = (v: EditorView, k: string) => runScopeHandlers(v, new KeyboardEvent("keydown", { key: k }), "editor");
const doc = (v: EditorView) => v.state.doc.toString();
const expand = (s: Syn, abbr: string, via: "Tab" | "Enter" = "Tab", cfg: object = {}) => { const v = make(s, "", cfg); type(v, abbr); const handled = key(v, via); return { out: doc(v), handled, v }; };

describe("HTML の展開", () => {
  const cases: [string, string | RegExp][] = [
    ["h1", "<h1></h1>"], ["p", "<p></p>"], ["div.a#b", '<div class="a" id="b"></div>'], [".box", '<div class="box"></div>'], ["#x", '<div id="x"></div>'],
    ["ul>li*3", /<ul>\s*<li><\/li>\s*<li><\/li>\s*<li><\/li>\s*<\/ul>/], ["ul>li.item$*2", /class="item1"[\s\S]*class="item2"/], ["a[href=#]", /<a href="#"><\/a>/],
    ["input:text", /<input type="text"/], ["img", /<img src="" alt="">/], ["h1{Hello}", "<h1>Hello</h1>"], ["a+b", '<a href=""></a><b></b>'], ["(h1+h2)*2", /<h1>[\s\S]*<h2>[\s\S]*<h1>[\s\S]*<h2>/],
    ["ul>li^p", /<\/ul>\s*<p>/], ["table>tr>td*2", /<td><\/td>\s*<td><\/td>/], ["lorem3", /\w+,? \w+ \w+\./], ["h1>form>input+button[type=submit]", /<button type="submit">/],
    ["btn", "<button></button>"], ["form:post", /method="post"/], ["link:css", /<link rel="stylesheet"/], ["script:src", /<script src="">/], ["br", "<br>"], ["select>option*2", /<option value=""><\/option>/],
  ];
  for (const [abbr, want] of cases) for (const via of ["Tab", "Enter"] as const) it(`${abbr}  (${via})`, () => {
    const r = expand("html", abbr, via); expect(r.handled).toBe(true);
    typeof want === "string" ? expect(r.out).toBe(want) : expect(r.out).toMatch(want);
  });
  it("! で HTML5 の雛形", () => { for (const via of ["Tab", "Enter"] as const) { const r = expand("html", "!", via); expect(r.out).toContain("<!DOCTYPE html>"); expect(r.out).toContain("<body>"); } });
  it("html:5 でも同じ", () => expect(expand("html", "html:5").out).toContain("<!DOCTYPE html>"));
  it("途中まで打って消して打ち直しても効く", () => { const v = make("html"); type(v, "ul>li*3>a[hre"); for (let i = 0; i < 6; i++) key(v, "Backspace"); v.dispatch({ changes: { from: 0, to: doc(v).length } }); type(v, "p"); expect(key(v, "Tab")).toBe(true); expect(doc(v)).toBe("<p></p>"); });
  it("記法の途中でパースできなくなっても、続きを打てば展開できる", () => { const v = make("html"); type(v, "div>a[href="); type(v, "x]"); expect(key(v, "Tab")).toBe(true); expect(doc(v)).toContain('href="x"'); });
  it("文の途中の記法(前に文字がある)", () => { const v = make("html", "<div>\n  "); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, "ul>li"); key(v, "Tab"); expect(doc(v)).toMatch(/<div>\s*<ul>\s*<li><\/li>\s*<\/ul>/); });
  it("Esc で記法の追跡をやめると、Tab は展開しない", () => { const v = make("html"); type(v, "h1"); key(v, "Escape"); key(v, "Tab"); expect(doc(v)).toBe("h1"); });
  it("展開後に追跡は残らず、Enter は普通の改行", () => { const v = make("html"); type(v, "p"); key(v, "Tab"); expect(doc(v)).toBe("<p></p>"); expect(key(v, "Enter")).toBe(false); });
  it("展開後のタブストップへ移る", () => { const v = make("html"); type(v, "a"); key(v, "Tab"); expect(doc(v)).toBe('<a href=""></a>'); });
  it("改行を含む入力は記法にならない", () => { const v = make("html"); type(v, "h1\n"); expect(key(v, "Tab")).toBe(false); });
  it("記号だけ・数字だけは展開しない", () => { for (const a of ["1", ">>", "+"]) { const v = make("html"); type(v, a); key(v, "Enter"); expect(doc(v)).toBe(a); } });
  it("属性値に空白・日本語", () => { const r = expand("html", 'a[title="あ い"]{テスト}'); expect(r.out).toContain('title="あ い"'); expect(r.out).toContain("テスト"); });
});

describe("CSS の展開", () => {
  const cases: [string, string | RegExp][] = [["m10", "margin: 10px;"], ["p10-20", "padding: 10px 20px;"], ["df", "display: flex;"], ["w100p", "width: 100%;"], ["c#f", /color: #fff;/], ["bgc#000", /background-color: #000;/], ["fz14", "font-size: 14px;"], ["jcc", "justify-content: center;"], ["pos:a", "position: absolute;"], ["!", /!important/]];
  for (const [abbr, want] of cases) it(abbr, () => { const v = make("css", "a {\n  "); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, abbr); key(v, "Tab"); typeof want === "string" ? expect(doc(v)).toContain(want) : expect(doc(v)).toMatch(want); });
  it("Enter でも展開", () => { const v = make("css", "a {\n  "); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, "df"); key(v, "Enter"); expect(doc(v)).toContain("display: flex;"); });
});

const jsx = (abbr: string, via: "Tab" | "Enter" = "Tab") => { const v = make("jsx", "const a = (\n  "); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, "<" + abbr); key(v, via); return doc(v); };
describe("JSX の展開", () => {
  it("div.a → className", () => expect(jsx("div.a")).toContain('className="a"'));
  it("ul>li*2", () => expect(jsx("ul>li*2")).toMatch(/<li><\/li>\s*<li><\/li>/));
  it("Enter", () => expect(jsx("h1", "Enter")).toContain("<h1></h1>"));
});

describe("コマンド(展開以外)", () => {
  const run = (cmd: (v: EditorView) => boolean, d: string, at: number, to = at, s: Syn = "html") => { const v = make(s, d); v.dispatch({ selection: { anchor: at, head: to } }); const ok = cmd(v); return { ok, out: doc(v), v }; };
  it("タグを外す(removeTag)", () => { const r = run(E.removeTag, "<div><p>a</p></div>", 8); expect(r.out).toBe("<div>a</div>"); });
  it("タグの開閉を切り替える(splitJoinTag)", () => { expect(run(E.splitJoinTag, "<br>", 2).out).toMatch(/<br ?\/?>/); expect(run(E.splitJoinTag, "<div></div>", 3).out).toMatch(/<div ?\/>/); });
  it("コメントの切り替え(toggleComment)", () => { const r = run(E.toggleComment, "<p>a</p>", 4); expect(r.out).toBe("<!-- <p>a</p> -->"); expect(run(E.toggleComment, r.out, 6).out).toBe("<p>a</p>"); });
  it("数式の計算(evaluateMath)", () => { const r = run(E.evaluateMath, "2+3*4", 5); expect(r.out).toBe("14"); });
  it("数の増減", () => { expect(run(E.incrementNumber1, "a 10 b", 3).out).toBe("a 11 b"); expect(run(E.decrementNumber1, "a 10 b", 3).out).toBe("a 9 b"); expect(run(E.incrementNumber10, "a 10 b", 3).out).toBe("a 20 b"); expect(run(E.incrementNumber01, "a 1.0 b", 3).out).toBe("a 1.1 b"); });
  it("対のタグへ移動(goToTagPair)", () => { const r = run(E.goToTagPair, "<p>a</p>", 1); expect(r.v.state.selection.main.head).toBeGreaterThan(3); });
  it("外側・内側を選ぶ(balance)", () => { const o = run(E.balanceOutward, "<div><p>a</p></div>", 9); expect(o.v.state.selection.main.from).not.toBe(9); const i = run(E.balanceInward, "<div><p>a</p></div>", 0, 19); expect(i.v.state.selection.main.to - i.v.state.selection.main.from).toBeLessThan(19); });
  it("編集点へ移動", () => { const r = run(E.goToNextEditPoint, '<a href=""></a>', 0); expect(r.v.state.selection.main.head).toBe(9); expect(run(E.goToPreviousEditPoint, '<a href=""></a>', 14).v.state.selection.main.head).toBeLessThan(14); });
  it("次・前の項目を選ぶ", () => { expect(run(E.selectNextItem, '<a href="x" id="y"></a>', 0).v.state.selection.main.from).toBeGreaterThan(0); });
});

describe("Emmet の JSON 設定が展開に効く", () => {
  const withJson = (j: string, s: Syn, abbr: string) => { const r = parseEmmetJson(j); if (!r.ok) throw new Error(r.error); return expand(s, abbr, "Tab", JSON.parse(j)).out; };
  it("! のテンプレートを差し替える", () => expect(withJson('{"markup":{"snippets":{"!":"html>body>h1{hi}"}}}', "html", "!")).toMatch(/<html>[\s\S]*<h1>hi<\/h1>/));
  it("変数(lang)が ! の雛形に入る", () => expect(withJson('{"markup":{"variables":{"lang":"ja"}}}', "html", "!")).toContain('lang="ja"'));
  it("自作スニペット", () => expect(withJson('{"markup":{"snippets":{"mybtn":"button.btn[type=button]"}}}', "html", "mybtn")).toMatch(/<button class="btn" type="button">/));
  it("CSS のスニペット", () => { const v = make("css", "a {\n  ", JSON.parse('{"stylesheet":{"snippets":{"ctr":"align-items:center"}}}')); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, "ctr"); key(v, "Tab"); expect(doc(v)).toContain("align-items: center"); });
  it("属性の引用符を single に", () => expect(withJson('{"attributeQuotes":"single"}', "html", "a[href=x]")).toContain("href='x'"));
  it("markupStyle xhtml で <br />", () => expect(withJson('{"markupStyle":"xhtml"}', "html", "br")).toMatch(/<br ?\/>/));
  it("bem", () => expect(withJson('{"bem":true}', "html", "ul.nav>li.-item")).toContain("nav__item"));
  it("comments", () => expect(withJson('{"comments":true}', "html", "div#a.b")).toContain("<!-- /#a.b -->"));
  it("shortHex を false に", () => { const v = make("css", "a {\n  ", { shortHex: false }); v.dispatch({ selection: { anchor: doc(v).length } }); type(v, "c#0"); key(v, "Tab"); expect(doc(v)).toContain("#000000"); });
  it("タグを大文字に", () => expect(withJson('{"markup":{"options":{"output.tagCase":"upper"}}}', "html", "ul>li")).toContain("<UL>"));
});

describe("ショートカット設定から呼べる", () => {
  it("EDIT 経由でタグを外す・数を増やす", async () => {
    const { EDIT } = await import("./edit-cmds");
    const v = make("html", "<div><p>a</p></div>"); v.dispatch({ selection: { anchor: 8 } });
    EDIT.emRemoveTag(v); expect(doc(v)).toBe("<div>a</div>");
    const w = make("html", "x 10"); w.dispatch({ selection: { anchor: 3 } }); EDIT.emInc10(w); expect(doc(w)).toBe("x 20");
  });
  it("キー定義に全 Emmet 操作がある", async () => {
    const { KEYS } = await import("@/features/settings/keys"); const { EMMET_CMDS } = await import("./emmetExt");
    for (const id of EMMET_CMDS) expect(KEYS.some((k) => k.id === id)).toBe(true);
  });
});
