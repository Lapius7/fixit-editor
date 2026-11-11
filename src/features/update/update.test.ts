import { describe, expect, it } from "vitest";
import { notesFor, type Manifest } from "@/features/update/update";

const base: Manifest = { version: "1.0.5", date: "", notes: "日本語", file: "", size: 0, sha256: "", sig: "", url: "" };

describe("notesFor", () => {
  it("設定の言語の更新内容を返す", () => {
    const m = { ...base, notes_i18n: { ja: "日本語", en: "English", ko: "한국어" } };
    expect(notesFor(m, "en")).toBe("English");
    expect(notesFor(m, "ko-KR")).toBe("한국어");
  });
  it("その言語がなければ notes を返す", () => {
    expect(notesFor({ ...base, notes_i18n: { en: "  " } }, "en")).toBe("日本語");
    expect(notesFor(base, "en")).toBe("日本語");
  });
});
