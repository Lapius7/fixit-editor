import { describe, expect, it } from "vitest";
import { diffOf, fromUri, normPath, posAt, toUri } from "./session";

describe("uri", () => {
  it("round-trips posix paths with spaces and Japanese", () => {
    const p = "/home/u/my proj/日本語/a b.ts";
    expect(toUri(p)).toBe("file:///home/u/my%20proj/%E6%97%A5%E6%9C%AC%E8%AA%9E/a%20b.ts");
    expect(fromUri(toUri(p))).toBe(p);
  });
  it("handles Windows drive paths", () => {
    expect(toUri("C:\\work\\a.ts")).toBe("file:///C:/work/a.ts");
    expect(fromUri("file:///C:/work/a.ts")).toBe("C:/work/a.ts");
  });
  it("rejects non-file URIs", () => {
    expect(fromUri("untitled:Untitled-1")).toBeNull();
  });
  it("normalizes drive letter case and slashes", () => {
    expect(normPath("C:\\a\\b")).toBe("c:/a/b");
  });
});

describe("posAt", () => {
  it("returns line and UTF-16 column", () => {
    expect(posAt("ab\ncd\n", 0)).toEqual({ line: 0, character: 0 });
    expect(posAt("ab\ncd\n", 4)).toEqual({ line: 1, character: 1 });
    expect(posAt("ab\ncd\n", 6)).toEqual({ line: 2, character: 0 });
    expect(posAt("😀x", 2)).toEqual({ line: 0, character: 2 });
  });
});

describe("diffOf", () => {
  it("finds the changed middle", () => {
    expect(diffOf("hello world", "hello brave world")).toEqual({ p: 6, s: 5 });
    expect(diffOf("abc", "abc")).toEqual({ p: 3, s: 0 });
    expect(diffOf("", "x")).toEqual({ p: 0, s: 0 });
  });
  it("does not overlap prefix and suffix", () => {
    const { p, s } = diffOf("aaa", "aaaa");
    expect(p + s).toBeLessThanOrEqual(3);
  });
});
