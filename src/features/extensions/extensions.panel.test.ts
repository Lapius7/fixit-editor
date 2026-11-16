import { describe, expect, it } from "vitest";
import { cleanPanel, panelHasAction, panelIdOk } from "./host/guard";

const ok = { title: "t", nodes: [{ t: "heading", text: "h" }, { t: "button", text: "b", action: "go" }, { t: "input", id: "q", action: "find" }, { t: "list", items: [{ label: "a", action: "pick" }, { label: "b" }] }, { t: "sep" }] };

describe("cleanPanel", () => {
  it("正しい形は通し、既定値を補う", () => {
    const p = cleanPanel(ok)!;
    expect(p.nodes).toHaveLength(5);
    expect(p.nodes[0]).toEqual({ t: "heading", text: "h", tone: "" });
    expect(p.nodes[3]).toEqual({ t: "list", items: [{ label: "a", detail: "", action: "pick" }, { label: "b", detail: "", action: "" }] });
  });
  it("形が違う・知らない種類・不正な値は丸ごと拒否", () => {
    for (const bad of [null, [], "x", { nodes: [] }, { title: "", nodes: [] }, { title: "t" },
      { title: "t", nodes: [{ t: "html", text: "<b>" }] },
      { title: "t", nodes: [{ t: "button", text: "b", action: "Bad Action" }] },
      { title: "t", nodes: [{ t: "text", text: "x", tone: "red" }] },
      { title: "t", nodes: [{ t: "text", text: "x".repeat(2001) }] },
      { title: "t", nodes: [{ t: "text", text: "a\u0000b" }] },
      { title: "t", nodes: [null] }]) expect(cleanPanel(bad)).toBeNull();
  });
  it("部品の数の上限(一覧の行も数える)", () => {
    expect(cleanPanel({ title: "t", nodes: Array.from({ length: 400 }, () => ({ t: "sep" })) })).not.toBeNull();
    expect(cleanPanel({ title: "t", nodes: Array.from({ length: 401 }, () => ({ t: "sep" })) })).toBeNull();
    expect(cleanPanel({ title: "t", nodes: [{ t: "list", items: Array.from({ length: 401 }, () => ({ label: "x" })) }] })).toBeNull();
    expect(cleanPanel({ title: "t", nodes: [{ t: "sep" }, { t: "list", items: Array.from({ length: 400 }, () => ({ label: "x" })) }] })).toBeNull();
  });
  it("操作は、パネルに実在する部品のものだけ", () => {
    const p = cleanPanel(ok)!;
    for (const a of ["go", "find", "pick"]) expect(panelHasAction(p, a)).toBe(true);
    for (const a of ["nope", "", 1, null, undefined]) expect(panelHasAction(p, a)).toBe(false);
  });
  it("id の形", () => {
    expect(panelIdOk("main-1_a")).toBe(true);
    for (const v of ["", "A", "a b", "x".repeat(33), 1, null]) expect(panelIdOk(v)).toBe(false);
  });
});
