import { describe, expect, it } from "vitest";
import { norm } from "@/platform/load";

describe("norm", () => {
  it("すべての行が CRLF なら LF にして印を付ける", () => {
    expect(norm("a\r\nb\r\n")).toEqual({ text: "a\nb\n", crlf: true });
  });
  it("LF と混ざっていれば、そのまま返す", () => {
    expect(norm("a\r\nb\n")).toEqual({ text: "a\r\nb\n", crlf: false });
  });
});
