import { beforeEach, describe, expect, it, vi } from "vitest";

// 画像の上限を小さくして、外し方だけを確かめる
vi.mock("@/shared/config", async (orig) => ({ ...(await orig<object>()), AI_CHATS_MAX_IMAGE_CHARS: 100 }));

const store = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });

const img = (n: number) => ({ type: "image/png", data: "x".repeat(n), name: "a.png" });
const msg = (id: number, imgs?: ReturnType<typeof img>[]) => ({ id, role: "user" as const, content: `m${id}`, at: 1000 + id, imgs });

describe("chat history images", () => {
  beforeEach(() => { vi.resetModules(); store.clear(); });

  it("keeps the time and images of a message", async () => {
    const c = await import("./chats");
    c.saveChat("a", [msg(1, [img(10)])]);
    const m = c.getChats().chats[0].msgs[0];
    expect(m.at).toBe(1001);
    expect(m.imgs).toHaveLength(1);
  });

  it("drops images from the oldest chat first and keeps its text", async () => {
    const c = await import("./chats");
    c.saveChat("old", [msg(1, [img(60)])]);
    await new Promise((r) => setTimeout(r, 5));
    c.saveChat("new", [msg(2, [img(60)])]);
    const by = Object.fromEntries(c.getChats().chats.map((x) => [x.id, x]));
    expect(by.old.msgs[0].imgs).toBeUndefined();
    expect(by.old.msgs[0].content).toBe("m1");
    expect(by.new.msgs[0].imgs).toHaveLength(1);
  });

  it("reads old history without time or images, and ignores broken images", async () => {
    store.set("fixit:ai-chats:v1", JSON.stringify({ cur: null, chats: [{ id: "a", title: "t", at: 1, msgs: [{ id: 1, role: "user", content: "hi" }, { id: 2, role: "user", content: "x", imgs: [{ type: "text/html", data: "<b>" }, 5] }] }] }));
    const c = await import("./chats");
    const [a, b] = c.getChats().chats[0].msgs;
    expect(a.at).toBeUndefined();
    expect(a.imgs).toBeUndefined();
    expect(b.imgs).toBeUndefined();
  });
});

describe("chat history acts", () => {
  beforeEach(() => { vi.resetModules(); store.clear(); });
  it("round-trips tool actions and turns unknown states into rejected", async () => {
    const c = await import("./chats");
    const edit = { id: "1-1", pos: 5, k: "edit" as const, path: "/a.ts", line: 3, old: "a", neu: "b", pre: "", post: "", st: "applied" as const };
    c.saveChat("a", [{ id: 1, role: "assistant", content: "hi", at: 1, acts: [{ id: "1-0", pos: 0, k: "read", path: "/a.ts", from: 1, to: 9 }, edit, { ...edit, id: "1-2", st: "pending" as never }] }]);
    vi.resetModules(); // 保存した文字から読み直す
    const m = (await import("./chats")).getChats().chats[0].msgs[0];
    expect(m.acts).toHaveLength(3);
    expect(m.acts![1]).toMatchObject({ st: "applied", pos: 5 });
    expect(m.acts![2]).toMatchObject({ st: "rejected" });
  });
});
