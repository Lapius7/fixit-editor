import { describe, expect, it } from "vitest";
import { urlsFromInfoJson, urlsFromListJson } from "./projects";

describe("dela の --json 出力", () => {
  it("info: URL と公開中のサービスをまとめる", () => {
    const t = JSON.stringify({ found: true, id: "abc1234567", url: "https://app-abc1234567.try.lapius7.si", running: [{ url: "https://app-abc1234567.try.lapius7.si" }, { url: "https://test-abc1234567.try.lapius7.si" }] });
    expect(urlsFromInfoJson(t)).toEqual(["https://app-abc1234567.try.lapius7.si", "https://test-abc1234567.try.lapius7.si"]);
    expect(urlsFromInfoJson('{"found":false,"running":[]}')).toEqual([]);
  });
  it("info: 古い dela の文章や壊れた JSON は null(従来の読み方に戻す)", () => {
    expect(urlsFromInfoJson("/home/x/.delaconfig\n    https://app-abc1234567.try.lapius7.si")).toBeNull();
    expect(urlsFromInfoJson("{}")).toBeNull();
  });
  it("list: 配列の URL を重複なしで取る", () => {
    expect(urlsFromListJson('[{"url":"https://a-x.try.lapius7.si"},{"url":"https://a-x.try.lapius7.si"}]')).toEqual(["https://a-x.try.lapius7.si"]);
    expect(urlsFromListJson("[]")).toEqual([]);
    expect(urlsFromListJson("PID  URL")).toBeNull();
  });
});
