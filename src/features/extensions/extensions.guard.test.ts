import { describe, expect, it } from "vitest";
import { argOk } from "./spec";
import { fsPath, netInit, netUrl, pickItems, range, termCommand } from "./host/guard";
import { buildExtCommand } from "./exports";
import { localBundle, permsWithin, readBundle, type Perms } from "./spec";

const none: Perms = { fsRead: false, fsWrite: false, network: [], exec: [], ui: false, editorRead: false, editorWrite: false };

describe("permsWithin は権限が 1 つでも増えたら超過とする", () => {
  const fields: [string, Partial<Perms>][] = [["fsRead", { fsRead: true }], ["fsWrite", { fsWrite: true }], ["ui", { ui: true }], ["editorRead", { editorRead: true }], ["editorWrite", { editorWrite: true }], ["network", { network: ["a.example.com"] }], ["exec", { exec: ["git"] }]];
  for (const [name, add] of fields) {
    it(`${name} が増えると超過`, () => expect(permsWithin({ ...none, ...add }, none)).toBe(false));
    it(`${name} が同意済みなら範囲内`, () => expect(permsWithin({ ...none, ...add }, { ...none, ...add })).toBe(true));
  }
  it("古い同意(新しい項目が無い)でも、増えていなければ範囲内", () => {
    expect(permsWithin(none, { fsRead: false, fsWrite: false, network: [], exec: [] })).toBe(true);
    expect(permsWithin({ ...none, editorRead: true }, { fsRead: false, fsWrite: false, network: [], exec: [] })).toBe(false);
  });
  it("network は宣言したホストだけが同意の範囲", () => {
    expect(permsWithin({ ...none, network: ["a.example.com", "b.example.com"] }, { ...none, network: ["a.example.com"] })).toBe(false);
    expect(permsWithin({ ...none, network: ["a.example.com"] }, { ...none, network: ["a.example.com", "b.example.com"] })).toBe(true);
  });
});

describe("format 2 の権限の読み込み", () => {
  const mf = (permissions: unknown) => JSON.stringify({ id: "local.t", name: "T", version: "1.0.0", main: "e.js", permissions });
  const load = (p: unknown) => localBundle(mf(p), { "e.js": "" });
  it("editor・fs・network・exec を読める", () => {
    const r = load({ editorRead: true, editorWrite: true, fsRead: true, fsWrite: true, network: ["api.example.com"], exec: ["git"] });
    expect(typeof r).not.toBe("string");
    if (typeof r !== "string") expect(readBundle(r.raw)?.manifest.perms).toEqual({ fsRead: true, fsWrite: true, network: ["api.example.com"], exec: ["git"], ui: false, editorRead: true, editorWrite: true });
  });
  it.each([["IP"], ["localhost"], ["ポート付き"], ["パス付き"], ["大文字"], ["スキーム付き"], ["ワイルドカード"], ["内部名"]])("network に不正なホスト(%s)は拒否", (k) => {
    const h = ({ IP: "127.0.0.1", localhost: "localhost", "ポート付き": "a.example.com:8080", "パス付き": "a.example.com/x", "大文字": "A.Example.com", "スキーム付き": "https://a.example.com", "ワイルドカード": "*.example.com", "内部名": "db.internal" } as Record<string, string>)[k];
    expect(load({ network: [h] })).toBe("bad");
  });
  it("network の重複・多すぎは拒否", () => {
    expect(load({ network: ["a.example.com", "a.example.com"] })).toBe("bad");
    expect(load({ network: Array.from({ length: 9 }, (_, i) => `h${i}.example.com`) })).toBe("bad");
  });
  it("format 1 は権限を使えない", () => {
    expect(readBundle(JSON.stringify({ format: 1, manifest: { id: "a.b", name: "x", version: "1.0.0", description: "", perms: { fsRead: true, fsWrite: false, network: [], exec: [] }, themes: [], snippets: [], commands: [] }, files: {} }))).toBeNull();
  });
});

describe("fsPath(workspace)", () => {
  it.each([["../x"], ["/a/../b"], ["/.git/config"], ["/.env"], ["/a/id_rsa"], ["C:/x"], ["\\a"], [""], [null], [1]])("%s は拒否", (p) => expect(fsPath(p)).toBeNull());
  it("相対・絶対とも / から始まる形に直す", () => { expect(fsPath("a/b.txt")).toBe("/a/b.txt"); expect(fsPath("/a/./b")).toBe("/a/b"); });
  it("/ はフォルダの一覧だけ通す", () => { expect(fsPath("/")).toBeNull(); expect(fsPath("/", true)).toBe("/"); });
});

describe("netUrl / netInit", () => {
  const hosts = ["api.example.com"];
  it("宣言したホストの https だけ通す", () => expect(netUrl("https://api.example.com/v1?a=1", hosts)?.hostname).toBe("api.example.com"));
  it.each([["http://api.example.com/"], ["https://evil.com/"], ["https://api.example.com.evil.com/"], ["https://sub.api.example.com/"], ["https://user:pw@api.example.com/"], ["https://api.example.com:8443/"], ["https://127.0.0.1/"], ["file:///etc/passwd"], ["//api.example.com/"], ["javascript:1"], [5]])("%s は拒否", (u) => expect(netUrl(u, hosts)).toBeNull());
  it("ヘッダーは許可リストだけ", () => {
    expect(netInit({ headers: { Accept: "x", Authorization: "Bearer a" } })?.headers).toEqual({ accept: "x", authorization: "Bearer a" });
    expect(netInit({ headers: { Cookie: "a=1" } })).toBeNull();
    expect(netInit({ headers: { Host: "evil" } })).toBeNull();
    expect(netInit({ headers: { accept: "a\r\nX: 1" } })).toBeNull();
  });
  it("メソッドと本文の上限", () => {
    expect(netInit({ method: "TRACE" })).toBeNull();
    expect(netInit({ method: "GET", body: "x" })).toBeNull();
    expect(netInit({ method: "POST", body: "x".repeat(100_001) })).toBeNull();
    expect(netInit({ method: "post", body: "{}" })?.method).toBe("POST");
  });
});

describe("termCommand + buildExtCommand(terminal.run)", () => {
  const p = { ...none, exec: ["git"] };
  const ctx = { file: "/w/a.md", root: "/w" };
  it("宣言したコマンドは通り、行になる", () => { const c = termCommand(p, "git", ["status"]); expect(c && buildExtCommand(c, ctx)?.line).toBe("git status"); });
  it("{file} は検査のうえ埋まる", () => { const c = termCommand(p, "git", ["add", "{file}"]); expect(c && buildExtCommand(c, ctx)?.line).toBe("git add /w/a.md"); });
  it.each([["rm"], ["git "], ["/usr/bin/git"], ["git;ls"], [""], [null]])("宣言外・不正なコマンド(%s)は拒否", (c) => expect(termCommand(p, c, [])).toBeNull());
  it.each([["a b"], ["a;b"], ["$(x)"], ["`x`"], ["a|b"], ["a&b"], ["a>b"], ["{evil}"], ["a\nb"], ["\"x\""]])("危険な引数(%s)は拒否", (a) => expect(termCommand(p, "git", [a])).toBeNull());
  it("引数が多すぎ・配列でないものは拒否", () => { expect(termCommand(p, "git", Array(17).fill("a"))).toBeNull(); expect(termCommand(p, "git", "status")).toBeNull(); });
  it("{file} の中身に危険な文字があれば行を作らない", () => { const c = termCommand(p, "git", ["{file}"]); expect(c && buildExtCommand(c, { file: "/w/$(x)", root: "/w" })).toBeNull(); });
  it("argOk は manifest の commands と同じ規則", () => { expect(argOk("a b")).toBe(false); expect(argOk("--x=1")).toBe(true); });
});

describe("pickItems / range", () => {
  it("文字列と {label,detail} を受ける", () => expect(pickItems(["a", { label: "b", detail: "c" }])).toEqual([{ label: "a", detail: "" }, { label: "b", detail: "c" }]));
  it("多すぎ・長すぎ・形が違うものは拒否", () => { expect(pickItems(Array(201).fill("a"))).toBeNull(); expect(pickItems(["x".repeat(201)])).toBeNull(); expect(pickItems([{}])).toBeNull(); expect(pickItems("a")).toBeNull(); });
  it("range は文書の長さの中だけ", () => {
    expect(range(10, 0, 10)).toEqual([0, 10]);
    expect(range(10, 5, 11)).toBeNull(); expect(range(10, -1, 2)).toBeNull(); expect(range(10, 5, 4)).toBeNull(); expect(range(10, 1.5, 2)).toBeNull(); expect(range(10, "0", 1)).toBeNull();
  });
});
