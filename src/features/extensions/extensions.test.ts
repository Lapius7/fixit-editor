import { describe, expect, it } from "vitest";
import { buildExtCommand } from "./exports";
import { permsWithin, readBundle } from "./spec";

const man = (over: Record<string, unknown> = {}, perms: Record<string, unknown> = {}) => JSON.stringify({
  format: 1, files: {},
  manifest: { id: "ab.cd", name: "N", version: "1.0.0", description: "", perms: { fsRead: false, fsWrite: false, network: [], exec: [], ...perms }, themes: [], snippets: [], commands: [], ...over },
});

describe("readBundle", () => {
  it("正しい形は読める", () => expect(readBundle(man())?.manifest.id).toBe("ab.cd"));
  it("余計な項目・main・ネットワーク権限は拒否", () => {
    expect(readBundle(man({ main: "x.js" }))).toBeNull();
    expect(readBundle(man({}, { network: ["a.com"] }))).toBeNull();
    expect(readBundle(man({}, { fsWrite: true }))).toBeNull();
  });
  it("テーマは許可した変数・色だけ", () => {
    const th = (dark: Record<string, string>) => man({ themes: [{ id: "t", name: "T", dark, light: {} }] });
    expect(readBundle(th({ "--c-kw": "#fff" }))).not.toBeNull();
    expect(readBundle(th({ "--c-kw": "url(x)" }))).toBeNull();
    expect(readBundle(th({ "--accent": "#fff" }))).toBeNull();
  });
  it("宣言のないコマンド・記号入りの引数は拒否", () => {
    const cmd = (args: string[], exec: string[]) => man({ commands: [{ id: "c", title: "C", cmd: "git", args }] }, { exec });
    expect(readBundle(cmd(["status"], ["git"]))).not.toBeNull();
    expect(readBundle(cmd(["status"], []))).toBeNull();
    expect(readBundle(cmd(["a;rm"], ["git"]))).toBeNull();
    expect(readBundle(cmd(["{file}", "{x}"], ["git"]))).toBeNull();
  });
});

describe("permsWithin", () => {
  const p = (exec: string[]) => ({ fsRead: false, fsWrite: false, network: [], exec });
  it("増えていなければ true、増えれば false", () => {
    expect(permsWithin(p(["git"]), p(["git", "ls"]))).toBe(true);
    expect(permsWithin(p(["git", "rm"]), p(["git"]))).toBe(false);
  });
});

describe("buildExtCommand", () => {
  const c = (args: string[]) => ({ id: "c", title: "C", cmd: "git", args });
  it("置き換えを埋める", () => expect(buildExtCommand(c(["add", "{file}"]), { file: "/a/b/c.md", root: "/a" })).toEqual({ line: "git add /a/b/c.md", dir: "/a" }));
  it("空白を含むパスは引用符で囲む", () => expect(buildExtCommand(c(["{file}"]), { file: "/a b/c.md", root: "/a b" })?.line).toBe('git "/a b/c.md"'));
  it("使えない文字・値なしは null", () => {
    expect(buildExtCommand(c(["{file}"]), { file: '/a/$(x).md', root: "/a" })).toBeNull();
    expect(buildExtCommand(c(["{file}"]), { file: null, root: "/a" })).toBeNull();
  });
});

import { localBundle } from "./spec";
describe("localBundle(自作のフォルダ)", () => {
  const src = (o: Record<string, unknown> = {}) => JSON.stringify({ id: "local.mine", name: "Mine", version: "0.1.0", permissions: { exec: ["git"] }, contributes: { themes: [{ id: "t", name: "T", dark: { "--c-kw": "#fff" } }], snippets: [{ lang: "markdown", label: "a", template: "b" }], commands: [{ id: "s", title: "S", run: { cmd: "git", args: ["status", "{file}"] } }] }, ...o });
  it("作者向けの書き方を、保存する形に直せる", () => {
    const r = localBundle(src());
    expect(typeof r).toBe("object");
    if (typeof r === "object") { expect(r.manifest.commands[0]).toEqual({ id: "s", title: "S", cmd: "git", args: ["status", "{file}"] }); expect(r.manifest.themes[0].light).toEqual({}); expect(JSON.parse(r.raw).files).toEqual({}); }
  });
  it("local. 以外の id は拒否", () => expect(localBundle(src({ id: "alice.mine" }))).toBe("id"));
  it("検査は公開時と同じ(色・exec 宣言・main)", () => {
    expect(localBundle(src({ contributes: { themes: [{ id: "t", name: "T", dark: { "--c-kw": "url(x)" } }] } }))).toBe("bad");
    expect(localBundle(src({ permissions: {} }))).toBe("bad");
    expect(localBundle(src({ main: "x.js" }))).toBe("bad");
    expect(localBundle("not json")).toBe("bad");
  });
});
