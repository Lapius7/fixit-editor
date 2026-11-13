import { describe, expect, it } from "vitest";
import { reindent } from "./reindent";

const sp = (size: number) => ({ size, spaces: true });

describe("reindent", () => {
  it("4 スペースを 2 スペースに", () => {
    const src = "def f():\n    if x:\n        y()\n    return 1\n";
    expect(reindent(src, "a.py", sp(2))).toBe("def f():\n  if x:\n    y()\n  return 1\n");
  });
  it("2 スペースを 4 スペースに", () => {
    expect(reindent("a:\n  b:\n    c: 1\n", "a.yml", sp(4))).toBe("a:\n    b:\n        c: 1\n");
  });
  it("タブをスペースに、スペースをタブに", () => {
    expect(reindent("a {\n\tb {\n\t\tc;\n\t}\n}\n", "a.css", sp(2))).toBe("a {\n  b {\n    c;\n  }\n}\n");
    expect(reindent("a {\n    b;\n}\n", "a.css", { size: 4, spaces: false })).toBe("a {\n\tb;\n}\n");
  });
  it("揃えの余りは残す", () => {
    expect(reindent("f(a,\n    b)\nx:\n    y\n   * z\n", "a.txt", sp(2))).toBe("f(a,\n  b)\nx:\n  y\n   * z\n");
  });
  it("文字列・コメントの中は触らない", () => {
    const src = 'def f():\n    s = """\n        keep\n    """\n    return s\n';
    expect(reindent(src, "a.py", sp(2))).toBe('def f():\n  s = """\n        keep\n    """\n  return s\n');
    const js = "const a = `\n    x\n`;\nif (a) {\n    b();\n}\n";
    expect(reindent(js, "a.js", sp(2))).toBe("const a = `\n    x\n`;\nif (a) {\n  b();\n}\n");
  });
  it("すでに合っているときや、決められないときは変えない", () => {
    const ok = "a\n  b\n";
    expect(reindent(ok, "a.txt", sp(2))).toBe(ok);
    expect(reindent("a\n b\n", "a.txt", sp(4))).toBe("a\n b\n"); // 1 スペースの段は幅を決められない
    expect(reindent("all:\n    x\n", "Makefile", sp(2))).toBe("all:\n    x\n");
    const mixed = "a\n\tb\n    c\n";
    expect(reindent(mixed, "a.txt", sp(2))).toBe(mixed);
  });
  it("CRLF を保つ", () => {
    expect(reindent("a\r\n    b\r\n", "a.txt", sp(2))).toBe("a\r\n  b\r\n");
  });
});
