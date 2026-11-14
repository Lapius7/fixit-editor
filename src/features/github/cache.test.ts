import { beforeEach, describe, expect, it, vi } from "vitest";
import { gh, setGhToken } from "./api";

const slug = { owner: "me", repo: "r" };
let calls: { url: string; inm?: string }[] = [];
let etag = '"v1"', body: unknown = { id: 1 }, status = 200;

beforeEach(() => {
  localStorage.clear(); calls = []; etag = '"v1"'; body = { id: 1 }; status = 200;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const inm = (init.headers as Record<string, string>)["If-None-Match"];
    calls.push({ url, inm });
    if (inm && inm === etag) return new Response(null, { status: 304 });
    return new Response(JSON.stringify(body), { status, headers: { etag } });
  }));
  setGhToken("");
  setGhToken("tok_a");
});

describe("GitHub の取得キャッシュ", () => {
  it("2 回目は If-None-Match を付け、304 でも同じ結果を返す", async () => {
    expect(await gh.repo(slug)).toEqual({ id: 1 });
    expect(await gh.repo(slug)).toEqual({ id: 1 });
    expect(calls[0].inm).toBeUndefined();
    expect(calls[1].inm).toBe('"v1"');
  });
  it("中身が変われば新しい結果を返す", async () => {
    await gh.repo(slug);
    etag = '"v2"'; body = { id: 2 };
    expect(await gh.repo(slug)).toEqual({ id: 2 });
    expect(await gh.repo(slug)).toEqual({ id: 2 });
  });
  it("トークンが変わると、覚えた結果を使わない", async () => {
    await gh.repo(slug);
    setGhToken("tok_b");
    await gh.repo(slug);
    expect(calls[1].inm).toBeUndefined();
  });
  it("エラー応答は覚えない", async () => {
    status = 404; body = { message: "Not Found" };
    await expect(gh.repo(slug)).rejects.toThrow();
    status = 200; body = { id: 3 };
    await gh.repo(slug);
    expect(calls[1].inm).toBeUndefined();
  });
});
