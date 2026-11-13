import { describe, expect, it } from "vitest";
import { editsByUri, offsetAt, overlaps } from "./edits";

const r = (l: number, c: number, l2 = l, c2 = c) => ({ start: { line: l, character: c }, end: { line: l2, character: c2 } });

describe("editsByUri", () => {
  it("reads changes", () => {
    const m = editsByUri({ changes: { "file:///a.ts": [{ range: r(0, 0, 0, 1), newText: "x" }] } });
    expect(m?.get("file:///a.ts")).toHaveLength(1);
  });
  it("merges documentChanges for the same file", () => {
    const e = { range: r(0, 0), newText: "x" };
    const m = editsByUri({ documentChanges: [{ textDocument: { uri: "u" }, edits: [e] }, { textDocument: { uri: "u" }, edits: [e] }] });
    expect(m?.get("u")).toHaveLength(2);
  });
  it("rejects file operations", () => {
    expect(editsByUri({ documentChanges: [{ kind: "rename" }] })).toBeNull();
  });
  it("treats null as empty", () => {
    expect(editsByUri(null)?.size).toBe(0);
  });
});

describe("offsetAt", () => {
  it("maps line and column", () => {
    expect(offsetAt("ab\ncd\n", { line: 1, character: 1 })).toBe(4);
    expect(offsetAt("ab\ncd\n", { line: 2, character: 0 })).toBe(6);
  });
  it("clamps", () => {
    expect(offsetAt("ab\ncd", { line: 0, character: 99 })).toBe(2);
    expect(offsetAt("ab\ncd", { line: 9, character: 0 })).toBe(5);
    expect(offsetAt("ab", { line: -1, character: 0 })).toBe(0);
  });
});

describe("overlaps", () => {
  it("detects overlap", () => {
    expect(overlaps([{ from: 0, to: 3 }, { from: 2, to: 4 }])).toBe(true);
    expect(overlaps([{ from: 0, to: 3 }, { from: 3, to: 4 }])).toBe(false);
  });
});
