import { describe, expect, it } from "vitest";
import { MAX_URL, parseFixitUrl } from "./route";

const CATS = ["look", "editor", "ext", "keys"];
const p = (u: string) => parseFixitUrl(u, CATS);

describe("fixit:// の行き先", () => {
  it("設定と分類", () => {
    expect(p("fixit://settings")).toEqual({ k: "settings", cat: null });
    expect(p("fixit://settings/")).toEqual({ k: "settings", cat: null });
    expect(p("fixit://settings/look")).toEqual({ k: "settings", cat: "look" });
    expect(p("FIXIT://Settings/KEYS")).toEqual({ k: "settings", cat: "keys" });
    expect(p("fixit:settings/ext")).toEqual({ k: "settings", cat: "ext" });
  });
  it("知らない分類は通さない", () => {
    expect(p("fixit://settings/nope")).toBeNull();
  });
  it("拡張機能(id は規則に合うものだけ)", () => {
    expect(p("fixit://extensions")).toEqual({ k: "extensions", id: null });
    expect(p("fixit://extensions/lapius7.bgimgchanger")).toEqual({ k: "extensions", id: "lapius7.bgimgchanger" });
    expect(p("fixit://extensions/noid")).toBeNull();
    expect(p("fixit://extensions/a.b.c")).toBeNull();
  });
  it("引数なしの画面", () => {
    expect(p("fixit://stats")).toEqual({ k: "page", page: "stats" });
    expect(p("fixit://theme?x=1#y")).toEqual({ k: "page", page: "theme" });
    expect(p("fixit://stats/extra")).toBeNull();
  });
  it("許可リストにないもの・危険な形は null", () => {
    for (const u of ["fixit://", "fixit:///", "fixit://open", "fixit://C:/Windows", "fixit://settings/../x", "fixit://settings/%2e%2e", "fixit://settings/look/x", "fixit://settings/%zz", "javascript:alert(1)", "http://settings", "", "fixit://sett ings", "fixit://stats\n"]) {
      expect(p(u), u).toBeNull();
    }
  });
  it("長すぎる URL は通さない", () => {
    expect(p(`fixit://settings/${"a".repeat(MAX_URL)}`)).toBeNull();
  });
});
