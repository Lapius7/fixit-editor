import { describe, expect, it } from "vitest";
import { byName, fuzzy } from "@/platform/fs";

describe("byName", () => {
  it("大文字と小文字を区別せず、数字は数として並べる", () => {
    const names = ["b.txt", "A.txt", "file10", "file2"].map((name) => ({ name }));
    expect(names.sort(byName).map((n) => n.name)).toEqual(["A.txt", "b.txt", "file2", "file10"]);
  });
});

describe("fuzzy", () => {
  it("文字が順に含まれなければ -1", () => {
    expect(fuzzy("xyz", "src/app/App.tsx")).toBe(-1);
  });
  it("続けて一致するほど点が高い", () => {
    expect(fuzzy("app", "src/app/App.tsx")).toBeGreaterThan(fuzzy("app", "src/a/p/p.ts"));
  });
});
