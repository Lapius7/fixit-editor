import { describe, expect, it } from "vitest";
import { blocks, heal } from "./markdown";

describe("heal", () => {
  it("closes bold, code and strike that are still streaming", () => {
    expect(heal("これは **大事")).toBe("これは **大事**");
    expect(heal("`npm")).toBe("`npm`");
    expect(heal("~~古い")).toBe("~~古い~~");
  });
  it("drops a marker that has no content yet", () => {
    expect(heal("これは **")).toBe("これは ");
    expect(heal("実行: `")).toBe("実行: ");
  });
  it("leaves balanced text and open code fences alone", () => {
    expect(heal("**a** and `b`")).toBe("**a** and `b`");
    expect(heal("```ts\nconst a = `x")).toBe("```ts\nconst a = `x");
  });
  it("ignores markers inside closed code blocks and inline code", () => {
    expect(heal("```\n**\n```\nok")).toBe("```\n**\n```\nok");
    expect(heal("`**` で太字")).toBe("`**` で太字");
  });
  it("shows only the text of a half-written link", () => {
    expect(heal("詳しくは [公式](https://exa")).toBe("詳しくは 公式");
    expect(heal("詳しくは [公")).toBe("詳しくは 公");
  });
});

// HTML にする所(DOMPurify)は DOM が要るので、ブラウザで確かめる
describe("blocks", () => {
  it("splits code blocks out with their language", () => {
    const b = blocks("説明\n\n```ts\nconst a = 1;\n```\n\n終わり");
    expect(b.map((x) => x.t)).toEqual(["html", "code", "html"]);
    expect(b[1]).toMatchObject({ t: "code", lang: "ts", text: "const a = 1;", open: false });
  });
  it("marks the last code block open while it streams", () => {
    expect(blocks("```py\nprint(1)").at(-1)).toMatchObject({ t: "code", lang: "py", open: true });
  });
  it("finds code inside list items and keeps the numbering", () => {
    const b = blocks("1. 次を実行:\n\n   ```bash\n   ls -la\n   ```\n2. 次に");
    expect(b).toHaveLength(1);
    const l = b[0];
    expect(l.t).toBe("list");
    if (l.t !== "list") return;
    expect(l.ordered).toBe(true);
    expect(l.items[0].map((x) => x.t)).toEqual(["html", "code"]);
    expect(l.items[0][1]).toMatchObject({ lang: "bash", text: "ls -la" });
  });
});
