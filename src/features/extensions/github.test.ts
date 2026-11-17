import { describe, expect, it } from "vitest";
import { githubSrc, parseGithubUrl } from "./github";

describe("parseGithubUrl", () => {
  it("リポジトリの URL を読む", () => {
    expect(parseGithubUrl("https://github.com/Lapius7/fixiteditor-bgimgchanger")).toEqual({ owner: "Lapius7", repo: "fixiteditor-bgimgchanger", ref: "HEAD" });
    expect(parseGithubUrl("  github.com/a/b.git/  ")).toEqual({ owner: "a", repo: "b", ref: "HEAD" });
    expect(parseGithubUrl("https://github.com/a/b/tree/v1.2.0")).toEqual({ owner: "a", repo: "b", ref: "v1.2.0" });
    expect(parseGithubUrl("https://github.com/a/b?tab=readme-ov-file#install")).toEqual({ owner: "a", repo: "b", ref: "HEAD" });
    expect(githubSrc({ owner: "a", repo: "b", ref: "HEAD" })).toBe("github:a/b@HEAD");
  });
  it("ほかの場所・形は断る", () => {
    for (const s of ["http://github.com/a/b", "https://evil.com/github.com/a/b", "https://github.com.evil.com/a/b", "https://github.com@evil.com/a/b", "https://github.com/a", "https://github.com/a/b/blob/main/x.js", "https://github.com/a/b/tree/main/sub", "https://github.com/a/b/tree/feat/x", "https://github.com/a/../b", "https://github.com/a/b/tree/..", "https://github.com/a/b/tree/.hidden", "https://github.com/a%2Fb/c", "https://github.com/-/b/c", "lapius7.bgimgchanger", ""]) expect(parseGithubUrl(s), s).toBeNull();
    expect(parseGithubUrl(`https://github.com/${"a".repeat(40)}/b`)).toBeNull();
  });
});
