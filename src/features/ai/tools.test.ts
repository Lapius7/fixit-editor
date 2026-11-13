import { describe, expect, it } from "vitest";
import { addToolDelta, around, applyAnchor, cleanPath, doneCalls, findAnchor, newToolAcc, actsText, execResult, parseCall, readRange, searchRe, searchText, secretName } from "./tools";

describe("cleanPath", () => {
  it("normalizes paths inside the folder", () => {
    expect(cleanPath("src/a.ts")).toBe("/src/a.ts");
    expect(cleanPath("/src//./a.ts")).toBe("/src/a.ts");
    expect(cleanPath("")).toBe("/");
  });
  it("rejects escapes and secrets", () => {
    for (const p of ["../x", "/a/../../b", "a\\b", "C:/x", "/.git/config", "/.env", "/app/.env.local", "/k/id_rsa", "/a/server.pem", "/.ssh/known_hosts", "/.npmrc", "a\u0000b"]) expect(cleanPath(p), p).toBeNull();
    expect(cleanPath(1)).toBeNull();
  });
  it("keeps normal names that look similar", () => {
    expect(secretName("environment.ts")).toBe(false);
    expect(secretName("keyboard.ts")).toBe(false);
    expect(cleanPath("/.github/workflows/ci.yml")).toBe("/.github/workflows/ci.yml");
  });
});

describe("readRange", () => {
  const t = Array.from({ length: 1000 }, (_, i) => `l${i + 1}`).join("\n");
  it("numbers lines and tells how to continue", () => {
    const r = readRange(t);
    expect(r.from).toBe(1); expect(r.to).toBe(400); expect(r.out).toContain("start_line=401");
  });
  it("clamps ranges", () => {
    const r = readRange("a\nb\nc", 2, 99);
    expect(r.out).toBe("2\tb\n3\tc"); expect(r.total).toBe(3);
    expect(readRange("").out).toBe("[empty file]");
  });
});

describe("anchors", () => {
  it("needs exactly one match", () => {
    expect(findAnchor("a b a", "b")).toMatchObject({ ok: true, at: 2 });
    expect(findAnchor("a b a", "a")).toEqual({ ok: false, why: "many" });
    expect(findAnchor("a", "z")).toEqual({ ok: false, why: "none" });
    expect(findAnchor("a", "")).toEqual({ ok: false, why: "empty" });
  });
  it("applies and refuses stale", () => {
    expect(applyAnchor("x\ny\nz", "y", "Y!")).toBe("x\nY!\nz");
    expect(applyAnchor("x", "y", "z")).toBeNull();
  });
  it("expands diff to whole lines", () => {
    const d = around("one\nfoo bar baz\nthree\nfour\nfive", 8, "bar", "BAR", 1);
    expect(d).toEqual({ pre: "one", old: "foo bar baz", neu: "foo BAR baz", post: "three", line: 2 });
  });
});

describe("parseCall", () => {
  it("validates arguments", () => {
    expect(parseCall({ id: "1", name: "read_file", args: { path: "/a.ts", start_line: "3" } })).toEqual({ k: "read", path: "/a.ts", start: 3, end: undefined });
    expect(parseCall({ id: "1", name: "read_file", args: { path: "/.env" } }).k).toBe("bad");
    expect(parseCall({ id: "1", name: "edit_file", args: { path: "/a", old_text: "a" } }).k).toBe("bad");
    expect(parseCall({ id: "1", name: "list_files", args: {} })).toEqual({ k: "list", path: "/", depth: 2 });
    expect(parseCall({ id: "1", name: "rm_rf", args: {} }).k).toBe("bad");
  });
});

describe("OpenAI tool call stream", () => {
  it("joins fragments, handles missing ids and invalid JSON", () => {
    const acc = newToolAcc();
    addToolDelta(acc, { index: 0, id: "c1", function: { name: "read_file", arguments: '{"pa' } });
    addToolDelta(acc, { index: 0, function: { arguments: 'th":"/a"}' } });
    addToolDelta(acc, { index: 1, function: { name: "list_files", arguments: "{bad" } });
    const c = doneCalls(acc);
    expect(c[0]).toMatchObject({ id: "c1", name: "read_file", args: { path: "/a" } });
    expect(c[1]).toMatchObject({ name: "list_files", args: undefined, raw: "{}" });
  });
});

describe("parseCall: 作る・移す・消す・検索", () => {
  const c = (name: string, args: unknown) => parseCall({ id: "1", name, args });
  it("create_file は内容を受け取り、改行を LF にそろえる", () => {
    expect(c("create_file", { path: "/a/b.ts", content: "x\r\ny" })).toEqual({ k: "create", path: "/a/b.ts", content: "x\ny" });
    expect(c("create_file", { path: "/a.ts" }).k).toBe("bad");
    expect(c("create_file", { path: "/.env", content: "" }).k).toBe("bad");
    expect(c("create_file", { path: "/a.ts", content: "x".repeat(100_001) }).k).toBe("bad");
  });
  it("create_folder と delete_path はパスだけ", () => {
    expect(c("create_folder", { path: "/src/new" })).toEqual({ k: "mkdir", path: "/src/new" });
    expect(c("delete_path", { path: "/src/old.ts" })).toEqual({ k: "delete", path: "/src/old.ts" });
    expect(c("delete_path", { path: "/" }).k).toBe("bad");
    expect(c("delete_path", { path: "../x" }).k).toBe("bad");
  });
  it("move_path は同じ場所・自分の中・秘密のファイルを断る", () => {
    expect(c("move_path", { from: "/a.ts", to: "/b/a.ts" })).toEqual({ k: "move", path: "/a.ts", to: "/b/a.ts" });
    expect(c("move_path", { from: "/a", to: "/a" }).k).toBe("bad");
    expect(c("move_path", { from: "/a", to: "/a/b" }).k).toBe("bad");
    expect(c("move_path", { from: "/a.ts", to: "/.env" }).k).toBe("bad");
  });
  it("search_files は空の検索語と不正な正規表現を断る", () => {
    expect(c("search_files", { query: "foo" })).toEqual({ k: "search", query: "foo", path: "/", regex: false, icase: false });
    expect(c("search_files", { query: "" }).k).toBe("bad");
    expect(c("search_files", { query: "(", regex: true }).k).toBe("bad");
  });
});

describe("searchText", () => {
  it("記号を含む検索語もそのまま探す", () => {
    expect(searchText("/a.ts", "x\nfoo(1)\ny", searchRe("foo(1)", false, false), 10)).toEqual(["/a.ts:2: foo(1)"]);
  });
  it("大文字小文字の無視と、件数の上限", () => {
    const t = "Foo\nfoo\nFOO";
    expect(searchText("/a", t, searchRe("foo", false, true), 10)).toHaveLength(3);
    expect(searchText("/a", t, searchRe("foo", false, true), 2)).toHaveLength(2);
  });
  it("長い行は切る", () => {
    expect(searchText("/a", "x".repeat(500), searchRe("x", false, false), 1)[0].length).toBeLessThan(230);
  });
});

describe("actsText", () => {
  it("作成・移動・削除・検索の結果を文章にする", () => {
    const t = actsText([
      { id: "1", pos: 0, k: "create", path: "/a.ts", size: 3, st: "applied" },
      { id: "2", pos: 0, k: "move", path: "/a.ts", to: "/b.ts", st: "rejected" },
      { id: "3", pos: 0, k: "delete", path: "/c.ts", st: "err", err: "nope" },
      { id: "4", pos: 0, k: "search", query: "foo", path: "/", n: 2 },
    ]);
    expect(t).toContain("create file /a.ts: done");
    expect(t).toContain("move /a.ts to /b.ts: rejected by the user");
    expect(t).toContain("delete /c.ts: failed: nope");
    expect(t).toContain('searched "foo"');
  });
});

describe("run_command", () => {
  const c = (args: unknown) => parseCall({ id: "1", name: "run_command", args });
  it("検査と、秒数の丸め", () => {
    expect(c({ command: "pnpm test" })).toEqual({ k: "run", cmd: "pnpm test", secs: 30 });
    expect(c({ command: "ls", timeout_seconds: 9999 })).toEqual({ k: "run", cmd: "ls", secs: 120 });
    expect(c({ command: "ls", timeout_seconds: 0 })).toEqual({ k: "run", cmd: "ls", secs: 1 });
    expect(c({ command: "  " }).k).toBe("bad");
    expect(c({}).k).toBe("bad");
    expect(c({ command: "a\0b" }).k).toBe("bad");
    expect(c({ command: "x".repeat(4001) }).k).toBe("bad");
  });
  it("結果の文字。長い出力は先頭と末尾を残す", () => {
    expect(execResult({ code: 0, out: "ok\n", timedOut: false })).toBe("exit code: 0\nok");
    expect(execResult({ code: 124, out: "", timedOut: true })).toBe("[timed out and was stopped]\nexit code: 124\n[no output]");
    const long = `HEAD${"x".repeat(30_000)}TAIL`;
    const r = execResult({ code: 1, out: long, timedOut: false });
    expect(r).toContain("HEAD");
    expect(r.endsWith("TAIL")).toBe(true);
    expect(r).toContain("characters omitted");
    expect(r.length).toBeLessThan(21_000);
  });
  it("会話に残す記録", () => {
    expect(actsText([{ id: "1", k: "run", cmd: "pnpm test", st: "applied", code: 1 }])).toContain("ran command `pnpm test`: exit code 1");
    expect(actsText([{ id: "1", k: "run", cmd: "rm x", st: "rejected" }])).toContain("rejected by the user");
  });
});
