import { describe, expect, it } from "vitest";
import { cssOk } from "./host/css";
import { valid } from "./host/runtime";
import { rowsOf } from "./ExtensionsView";
import { localBundle, permsWithin, readBundle, type ExtSetting } from "./spec";

const mf = (over: Record<string, unknown> = {}) => JSON.stringify({
  id: "local.t", name: "T", version: "1.0.0", main: "e.js", permissions: { ui: true },
  contributes: { settings: [{ id: "img", label: "画像", kind: "file" }, { id: "op", label: "不透明度", kind: "num", min: 0, max: 1, step: 0.1, default: 0.5 }], commands: [{ id: "go", title: "実行" }] },
  ...over,
});

describe("format 2", () => {
  it("main・ui 権限・設定・スクリプトのコマンドを読める", () => {
    const r = localBundle(mf(), { "e.js": "exports.activate = () => {};" });
    expect(r).not.toBe("bad");
    if (typeof r === "string") return;
    expect(r.manifest.main).toBe("e.js");
    expect(r.manifest.perms.ui).toBe(true);
    expect(r.manifest.settings.map((s) => s.id)).toEqual(["img", "op"]);
    expect(r.manifest.scriptCommands.map((c) => c.id)).toEqual(["go"]);
    expect(readBundle(r.raw)?.format).toBe(2);
  });
  it("main の名前が不正・本体がないときは拒否", () => {
    expect(localBundle(mf({ main: "../x.js" }), { "../x.js": "" })).toBe("bad");
    expect(localBundle(mf(), {})).toBe("bad");
  });
  it("ui 権限は同意の範囲に含まれていなければ超過", () => {
    const base = { fsRead: false, fsWrite: false, network: [], exec: [] };
    expect(permsWithin({ ...base, ui: true }, base)).toBe(false);
    expect(permsWithin({ ...base, ui: true }, { ...base, ui: true })).toBe(true);
    expect(permsWithin(base, base)).toBe(true);
  });
  it("同意の画面には、権限がなくてもスクリプトの行が出る", () => {
    const r = localBundle(mf({ permissions: {} }), { "e.js": "x" });
    if (typeof r === "string") throw new Error(r);
    expect(rowsOf(r.manifest).map((x) => x.key)).toEqual(["script"]);
    const r2 = localBundle(mf(), { "e.js": "x" });
    if (typeof r2 === "string") throw new Error(r2);
    expect(rowsOf(r2.manifest).map((x) => x.key)).toEqual(["script", "ui"]);
  });
});

describe("css・設定値の検査", () => {
  it("外へ出す書き方は拒否", () => {
    for (const t of ["a{background:url(https://x)}", "@import 'x';", "a{background:image-set('x' 1x)}", "a{b:u\\72l(x)}", ":root{--w:url(x)}", "a{b:src(x)}", "a{b:paint(x)}"]) expect(cssOk(t)).toBe(false);
    expect(cssOk("body{--ext:1;color:red}")).toBe(true);
    expect(cssOk("a".repeat(60_001))).toBe(false);
  });
  const s = (o: Partial<ExtSetting>): ExtSetting => ({ id: "x", label: "x", kind: "num", hint: "", def: 0, min: 0, max: 1, step: 0.1, options: [], command: "", ...o });
  it("宣言した範囲の値だけ通す", () => {
    expect(valid(s({}), 0.5)).toBe(true);
    expect(valid(s({}), 2)).toBe(false);
    expect(valid(s({}), NaN)).toBe(false);
    expect(valid(s({ kind: "enum", options: [["a", "A"]] }), "b")).toBe(false);
    expect(valid(s({ kind: "bool" }), "true")).toBe(false);
    expect(valid(s({ kind: "color" }), "url(x)")).toBe(false);
    expect(valid(s({ kind: "file" }), "x")).toBe(false);
  });
});
