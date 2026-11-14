import { describe, expect, it } from "vitest";
import { repoNameOf, riskyFiles, validRepoName } from "./create";

describe("create", () => {
  it("フォルダ名から使える名前を作る", () => {
    expect(repoNameOf("my app")).toBe("my-app");
    expect(repoNameOf("大学")).toBe("");
    expect(validRepoName("fixit-editor")).toBe(true);
    expect(validRepoName("a b")).toBe(false);
    expect(validRepoName("..")).toBe(false);
    expect(validRepoName("x.git")).toBe(false);
  });
  it("秘密に見えるファイルを拾う", () => {
    expect(riskyFiles([".env", "src/.env.local", ".env.example", "a/id_rsa", "k.pem", ".delaconfig", "src/a.ts"])).toEqual([".env", "src/.env.local", "a/id_rsa", "k.pem", ".delaconfig"]);
  });
});
