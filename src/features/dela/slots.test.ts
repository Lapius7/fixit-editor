import { beforeEach, describe, expect, it } from "vitest";
import { forgetSlot, loadSlots, nameOfUrl, saveSlot, urlWithName } from "./slots";

describe("公開する名前の記録", () => {
  beforeEach(() => localStorage.clear());
  it("app は記録がなくても出る。使った順に並ぶ", () => {
    expect(loadSlots("local:").map((s) => s.name)).toEqual(["app"]);
    saveSlot("local:", "api", "4000");
    saveSlot("local:", "web", "5173");
    expect(loadSlots("local:").map((s) => s.name)).toEqual(["web", "api", "app"]);
  });
  it("ポートは上書きされ、ポートなしで保存し直しても残る", () => {
    saveSlot("local:", "api", "4000");
    saveSlot("local:", "api");
    expect(loadSlots("local:").find((s) => s.name === "api")?.port).toBe("4000");
    saveSlot("local:", "api", "4001");
    expect(loadSlots("local:").find((s) => s.name === "api")?.port).toBe("4001");
  });
  it("接続ごとに分かれ、外せる", () => {
    saveSlot("ssh:a", "api", "1");
    expect(loadSlots("ssh:b").map((s) => s.name)).toEqual(["app"]);
    forgetSlot("ssh:a", "api");
    expect(loadSlots("ssh:a").map((s) => s.name)).toEqual(["app"]);
  });
  it("URL の名前を差し替える・取り出す", () => {
    expect(urlWithName("https://app-abcdefghij.try.lapius7.si", "api")).toBe("https://api-abcdefghij.try.lapius7.si");
    expect(nameOfUrl("https://api-abcdefghij.try.lapius7.si")).toBe("api");
  });
});
