import { describe, expect, it } from "vitest";
import { cleanCompletions, cleanDiagnostics, cleanHover, extOf, provide, providersFor } from "./host/hub";

describe("hub: 拡張の返事の検査", () => {
  it("補完は形の合うものだけ、件数を絞る", () => {
    const r = cleanCompletions("x", [{ label: "a", insert: "A", detail: "d" }, { label: 5 }, 7, null, { label: "b", insert: 3 }, { label: "c".repeat(81) }]);
    expect(r.map((c) => [c.label, c.insert])).toEqual([["a", "A"], ["b", "b"]]);
    expect(cleanCompletions("x", Array.from({ length: 500 }, () => ({ label: "z" }))).length).toBe(100);
    expect(cleanCompletions("x", "no")).toEqual([]);
  });
  it("波線は範囲が文書の中のものだけ", () => {
    const r = cleanDiagnostics("x", 10, [{ from: 0, to: 3, message: "m", severity: "error" }, { from: 99, to: 100, message: "oob" }, { from: 3, to: 1, message: "rev" }, { from: 2, to: 2, message: "empty" }, { from: 0, to: 1 }]);
    expect(r.map((d) => [d.from, d.to, d.severity])).toEqual([[0, 3, "error"], [2, 3, "warning"]]);
  });
  it("ホバーは文字列か {text} だけ", () => {
    expect(cleanHover({ text: "a" })).toBe("a");
    expect(cleanHover("b")).toBe("b");
    expect(cleanHover({ text: " " })).toBeNull();
    expect(cleanHover({ text: "x".repeat(2001) })).toBeNull();
    expect(cleanHover(5)).toBeNull();
  });
  it("提供元は拡張子で絞り、秘密のファイルには問い合わせない", () => {
    provide("e1", "hover", ["md", "py"]);
    expect(providersFor("hover", "/a/b.md")).toEqual(["e1"]);
    expect(providersFor("hover", "/a/b.ts")).toEqual([]);
    provide("e2", "hover", ["*"]);
    expect(providersFor("hover", "/a/.env")).toEqual([]);
    expect(providersFor("hover", "/a/b.ts")).toEqual(["e2"]);
    expect(() => provide("e1", "nope", ["md"])).toThrow();
    expect(() => provide("e1", "hover", ["Bad Lang"])).toThrow();
    expect(extOf("/a/Makefile")).toBe("");
  });
});
