import { describe, expect, it } from "vitest";
import { addToolDelta, around, applyAnchor, cleanPath, doneCalls, findAnchor, newToolAcc, parseCall, readRange, secretName } from "./tools";

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
