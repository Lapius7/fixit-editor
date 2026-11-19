import { describe, expect, it } from "vitest";
import { EMMET_TEMPLATE, parseEmmetJson } from "./emmetJson";

describe("Emmet の JSON 設定", () => {
  it("空は初期設定、例は通る", () => {
    expect(parseEmmetJson("  ")).toEqual({ ok: true, opt: {} });
    expect(parseEmmetJson(EMMET_TEMPLATE).ok).toBe(true);
  });
  it("書き間違いはどこが悪いかを返す", () => {
    for (const t of ["{", "[]", '{"bem":1}', '{"attributeQuotes":"x"}', '{"foo":1}', '{"markup":{"snip":{}}}', '{"markup":{"snippets":{"a":1}}}']) expect(parseEmmetJson(t).ok).toBe(false);
  });
  it("snippets / variables は config に入り、上の階層の値はそのまま渡る", () => {
    const r = parseEmmetJson('{"bem":true,"markup":{"variables":{"lang":"ja"},"snippets":{"!":"!!!+doc"}}}');
    expect(r).toEqual({ ok: true, opt: { bem: true, config: { markup: { variables: { lang: "ja" }, snippets: { "!": "!!!+doc" } } } } });
  });
});
