import { describe, expect, it } from "vitest";
import { contribKeys, contribMenu } from "./contrib";
import { keyOk, localBundle, readBundle } from "./spec";

const mf = (c: Record<string, unknown>) => JSON.stringify({ id: "local.k", name: "K", version: "1.0.0", main: "e.js", permissions: { ui: true }, contributes: { commands: [{ id: "go", title: "実行" }], ...c } });
const F = { "e.js": "exports.activate = () => {};" };

describe("ショートカットとメニュー", () => {
  it("組み合わせの書き方: Mod・Alt・F キーのどれかが要る", () => {
    for (const k of ["Mod+Shift+K", "Alt+1", "Mod+Alt+ArrowUp", "F9", "Shift+F9", "Mod+/"]) expect(keyOk(k), k).toBe(true);
    for (const k of ["K", "Shift+K", "Delete", "Ctrl+K", "Mod+", "mod+k", "Mod+KK", "", 5, "Mod+Shift+Alt+K"]) expect(keyOk(k), String(k)).toBe(false);
  });
  it("宣言したコマンドにだけ付けられ、読み込みで保たれる", () => {
    const r = localBundle(mf({ keybindings: [{ command: "go", key: "Mod+Alt+G" }], menus: [{ command: "go", where: "tree" }, { command: "go" }] }), F);
    expect(r).not.toBe("bad");
    if (typeof r === "string") return;
    expect(r.manifest.keybindings).toEqual([{ command: "go", key: "Mod+Alt+G" }]);
    expect(r.manifest.menus).toEqual([{ command: "go", where: "tree" }, { command: "go", where: "editor" }]);
    expect(readBundle(r.raw)?.manifest.keybindings.length).toBe(1);
  });
  it("知らないコマンド・不正なキー・重複・数の超過・場所の誤りは拒否", () => {
    expect(localBundle(mf({ keybindings: [{ command: "nope", key: "Mod+Alt+G" }] }), F)).toBe("bad");
    expect(localBundle(mf({ keybindings: [{ command: "go", key: "G" }] }), F)).toBe("bad");
    expect(localBundle(mf({ keybindings: [{ command: "go", key: "Mod+G" }, { command: "go", key: "Mod+G" }] }), F)).toBe("bad");
    expect(localBundle(mf({ keybindings: Array.from({ length: 21 }, (_, i) => ({ command: "go", key: `Alt+F${i % 12 + 1}` })) }), F)).toBe("bad");
    expect(localBundle(mf({ menus: [{ command: "go", where: "title" }] }), F)).toBe("bad");
    expect(localBundle(mf({ menus: [{ command: "go", where: "tree" }, { command: "go", where: "tree" }] }), F)).toBe("bad");
    expect(localBundle(mf({ keybindings: [{ command: "go", key: "Mod+G", extra: 1 }] }), F)).toBe("bad");
  });
  it("保存された形に余計な項目や欠けがあれば読めない", () => {
    const r = localBundle(mf({}), F);
    if (typeof r === "string") throw new Error("bad");
    const j = JSON.parse(r.raw); delete j.manifest.menus;
    expect(readBundle(JSON.stringify(j))).toBeNull();
  });
  it("一覧から、有効な拡張のものだけを引く(同じキーは先のもの)", () => {
    const mk = (id: string, active: boolean, key: string) => ({ id, active, manifest: { name: id, commands: [], scriptCommands: [{ id: "go", title: "実行" }], keybindings: [{ command: "go", key }], menus: [{ command: "go", where: "tree" }] } }) as never;
    const list = [mk("a.x", true, "Mod+Alt+G"), mk("b.y", true, "Mod+Alt+G"), mk("c.z", false, "Mod+Alt+H")];
    const m = contribKeys(list);
    expect(m.get("Mod+Alt+G")).toBe("ext-a.x-go");
    expect(m.has("Mod+Alt+H")).toBe(false);
    expect(contribMenu(list, "tree").map((x) => x.label)).toEqual(["a.x: 実行", "b.y: 実行"]);
    expect(contribMenu(list, "editor")).toEqual([]);
  });
});
