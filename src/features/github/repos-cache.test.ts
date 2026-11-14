import { beforeEach, describe, expect, it, vi } from "vitest";

// 書き込める簡易のファイルシステム(パス → 中身)
const files = new Map<string, string>(), dirs = new Set<string>(["/w"]);
let readOnly = false;
vi.mock("@/platform/remote", () => ({
  RemoteDir: class {
    kind = "directory";
    constructor(public conn: unknown, public path: string) {}
    async *entries() {}
    async getDirectoryHandle(n: string, o?: { create?: boolean }) {
      const p = `${this.path}/${n}`;
      if (!dirs.has(p)) { if (!o?.create) throw new Error("ENOENT"); if (readOnly) throw new Error("EROFS"); dirs.add(p); }
      return new (this.constructor as new (c: unknown, p: string) => this)(this.conn, p);
    }
    async getFileHandle(n: string, o?: { create?: boolean }) {
      const p = `${this.path}/${n}`;
      if (!files.has(p)) { if (!o?.create) throw new Error("ENOENT"); files.set(p, ""); }
      return {
        getFile: async () => ({ text: async () => files.get(p) ?? "" }),
        createWritable: async () => { let s = ""; return { write: async (d: string) => { s += d; }, close: async () => { files.set(p, s); } }; },
      };
    }
  },
}));
vi.mock("@/features/git/git", () => ({ gitRead: async () => "" }));

import { loadCache, saveCache, type Found } from "./repos";

const conn = { kind: "wsl", path: "/w" } as const;
const f: Found = { dir: "/w/a", rel: "a", remotes: [{ name: "origin", url: "git@github.com:me/a.git", owner: "me", repo: "a" }] };
beforeEach(() => { files.clear(); dirs.clear(); dirs.add("/w"); readOnly = false; });

describe("探索結果のキャッシュ", () => {
  it("保存したものを読め、.gitignore も置かれる", async () => {
    await saveCache(conn, "/w", [f]);
    expect(files.get("/w/.fixit/.gitignore")).toBe("*\n");
    expect(await loadCache(conn, "/w")).toEqual([f]);
  });
  it("見つからなかったときは、フォルダを作らない", async () => {
    await saveCache(conn, "/w", []);
    expect(dirs.has("/w/.fixit")).toBe(false);
  });
  it("書けないフォルダでも例外にならず、キャッシュなしで動く", async () => {
    readOnly = true;
    await expect(saveCache(conn, "/w", [f])).resolves.toBeUndefined();
    expect(await loadCache(conn, "/w")).toBeNull();
  });
  it("壊れたファイル・別のフォルダ・古い版は使わない", async () => {
    await saveCache(conn, "/w", [f]);
    files.set("/w/.fixit/repos.json", "{ここは壊れている");
    expect(await loadCache(conn, "/w")).toBeNull();
    files.set("/w/.fixit/repos.json", JSON.stringify({ v: 1, root: "/other", at: Date.now(), found: [f] }));
    expect(await loadCache(conn, "/w")).toBeNull();
    files.set("/w/.fixit/repos.json", JSON.stringify({ v: 99, root: "/w", at: Date.now(), found: [f] }));
    expect(await loadCache(conn, "/w")).toBeNull();
  });
  it("形の合わない項目や、フォルダの外を指す項目は捨てる", async () => {
    files.set("/w/.fixit/repos.json", JSON.stringify({ v: 1, root: "/w", at: Date.now(), found: [f, { dir: "/etc", rel: "x", remotes: f.remotes }, { dir: "/w/b" }, null] }));
    dirs.add("/w/.fixit");
    expect(await loadCache(conn, "/w")).toEqual([f]);
  });
});
