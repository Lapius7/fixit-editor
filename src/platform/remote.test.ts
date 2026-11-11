import { describe, expect, it } from "vitest";
import { parseTarget, toWslPath } from "@/platform/remote";

describe("parseTarget", () => {
  it("ssh:// の形を分ける", () => {
    expect(parseTarget("ssh://user@host/srv/app")).toEqual({ host: "user@host", path: "/srv/app" });
  });
  it("user@host:/path の形を分ける", () => {
    expect(parseTarget("user@host:/srv")).toEqual({ host: "user@host", path: "/srv" });
  });
  it("ドライブ文字は接続先とみなさない", () => {
    expect(parseTarget("C:/Users")).toEqual({ path: "C:/Users" });
  });
});

describe("toWslPath", () => {
  it("Windows のパスを /mnt/<ドライブ> にする", () => {
    expect(toWslPath("C:\\Users\\me\\")).toBe("/mnt/c/Users/me");
  });
  it("引用符を外す", () => {
    expect(toWslPath('"D:\\x"')).toBe("/mnt/d/x");
  });
});
