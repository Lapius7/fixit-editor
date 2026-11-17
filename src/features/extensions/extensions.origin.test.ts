import { describe, expect, it } from "vitest";
import { canReplace } from "./registry";
import { localBundle } from "./spec";

const signed = { sig: "s" }, gh = (r: string) => ({ sig: null, src: `github:${r}@HEAD` }), site = { sig: null, src: "site" }, folder = { sig: null };

describe("canReplace(入手元が違う同じ id を、署名のない版で上書きさせない)", () => {
  it("入っていなければ入れられる", () => { expect(canReplace(undefined, gh("a/b"))).toBe(true); expect(canReplace(undefined, folder)).toBe(true); });
  it("署名のない版は、認証済みや別の入手元を上書きできない", () => {
    expect(canReplace(signed, gh("a/b"))).toBe(false);
    expect(canReplace(signed, folder)).toBe(false);
    expect(canReplace(gh("a/b"), gh("c/d"))).toBe(false);
    expect(canReplace(gh("a/b"), folder)).toBe(false);
    expect(canReplace(folder, gh("a/b"))).toBe(false);
    expect(canReplace(site, gh("a/b"))).toBe(false);
    expect(canReplace(gh("a/b"), site)).toBe(false);
  });
  it("同じ入手元の更新と、署名つき(サイト)の置き換えは通る", () => {
    expect(canReplace(gh("a/b"), gh("a/b"))).toBe(true);
    expect(canReplace(gh("a/b"), { sig: null, src: "github:a/b@v2" })).toBe(true); // 同じリポジトリのブランチ・タグ違い
    expect(canReplace(gh("a/b"), { sig: null, src: "github:a/bb@HEAD" })).toBe(false);
    expect(canReplace(folder, folder)).toBe(true);
    expect(canReplace(gh("a/b"), signed)).toBe(true);
    expect(canReplace(signed, signed)).toBe(true);
    expect(canReplace(signed, site)).toBe(true); // サイトの未認証の版を、利用者が選んだとき
    expect(canReplace(folder, site)).toBe(true); // 印のない古いもの
  });
});

describe("localBundle の id(anyId)", () => {
  const j = (id: string) => JSON.stringify({ id, name: "n", version: "1.0.0" });
  it("既定は local. だけ。anyId なら「作者.名前」", () => {
    expect(localBundle(j("lapius7.bg"))).toBe("id");
    expect(typeof localBundle(j("lapius7.bg"), {}, true)).toBe("object");
    expect(typeof localBundle(j("local.x"))).toBe("object");
    expect(localBundle(j("noperiod"), {}, true)).toBe("id");
    expect(localBundle(j("A.b"), {}, true)).toBe("id");
  });
});
