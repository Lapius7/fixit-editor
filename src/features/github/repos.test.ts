import { describe, expect, it, vi } from "vitest";

// フォルダの木を用意して、リポジトリの探索だけを確かめる
const tree: Record<string, string[]> = {
  "/w": ["a", "b", "node_modules", ".cache", "notes.txt"],
  "/w/a": [".git", "src"],
  "/w/b": ["c", "d"],
  "/w/b/c": [".git"],
  "/w/b/d": ["x"],
  "/w/node_modules": [".git"],
};
const remote: Record<string, string> = {
  "/w/a": "origin\tgit@github.com:me/a.git (fetch)\norigin\tgit@github.com:me/a.git (push)\n",
  "/w/b/c": "origin\thttps://gitlab.com/me/c.git (fetch)\n",
};
vi.mock("@/platform/remote", () => ({
  RemoteDir: class {
    constructor(public conn: unknown, public path: string) {}
    async *entries() {
      for (const n of tree[this.path] ?? []) yield [n, { kind: n.includes(".") && n !== ".git" ? "file" : "directory" }];
    }
  },
}));
vi.mock("@/features/git/git", () => ({ gitRead: async (_c: unknown, d: string) => remote[d] ?? "" }));

import { defaultRepo, findRepos } from "./repos";

describe("findRepos", () => {
  it("GitHub のリモートを持つリポジトリだけを返し、除外フォルダには入らない", async () => {
    const r = await findRepos({ kind: "wsl", path: "/w" }, "/w");
    expect(r.map((x) => x.rel)).toEqual(["a"]);
    expect(r[0].remotes[0]).toMatchObject({ owner: "me", repo: "a" });
  });
  it("既定は、開いたフォルダそのもの、または 1 件だけのとき", () => {
    const f = { dir: "/w/a", rel: "a", remotes: [] };
    expect(defaultRepo([f], "/w")).toBe(f);
    expect(defaultRepo([f, { ...f, dir: "/w/z" }], "/w")).toBeUndefined();
    expect(defaultRepo([f, { ...f, dir: "/w" }], "/w")?.dir).toBe("/w");
  });
});
