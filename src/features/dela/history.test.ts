import { beforeEach, describe, expect, it } from "vitest";
import { histKey, loadHist, nameOfUrl, rememberPublish, urlWithName } from "./history";

describe("dela 公開履歴", () => {
  beforeEach(() => localStorage.clear());
  it("URL の先頭から名前を取る(app- は名前なし)", () => {
    expect(nameOfUrl("https://app-abcdefghij.try.lapius7.si")).toBe("");
    expect(nameOfUrl("https://test-abcdefghij.try.lapius7.si")).toBe("test");
    expect(nameOfUrl("https://my-api-abcdefghij.try.lapius7.si")).toBe("my-api");
  });
  it("プロジェクトの URL から、別の名前のサービスの URL を作る", () => {
    expect(urlWithName("https://app-ma8nrg87af.try.lapius7.si", "test111")).toBe("https://test111-ma8nrg87af.try.lapius7.si");
    expect(urlWithName("https://my-api-ma8nrg87af.try.lapius7.si", "web")).toBe("https://web-ma8nrg87af.try.lapius7.si");
    expect(urlWithName("https://example.com", "web")).toBeUndefined();
    expect(urlWithName("https://app-ma8nrg87af.try.lapius7.si", "Bad Name")).toBeUndefined();
  });
  it("フォルダと名前ごとに最後のポートを覚える", () => {
    rememberPublish("local:", "/p/a", undefined, "3000");
    rememberPublish("local:", "/p/a", "test", "5173");
    rememberPublish("local:", "/p/a", undefined, "4000");
    const h = loadHist();
    expect(h[histKey("local:", "/p/a")].port).toBe("4000");
    expect(h[histKey("local:", "/p/a", "test")].port).toBe("5173");
  });
  it("壊れた保存値は空として扱う", () => {
    localStorage.setItem("fixit:dela:hist:v1", "[1,2]");
    expect(loadHist()).toEqual({});
    localStorage.setItem("fixit:dela:hist:v1", JSON.stringify({ x: { port: "abc" }, y: { port: "80", at: 1 } }));
    expect(Object.keys(loadHist())).toEqual(["y"]);
  });
});
