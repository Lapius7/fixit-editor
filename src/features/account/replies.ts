import { useSyncExternalStore } from "react";
import { MY_FEEDBACK_URL, REPLY_POLL_MS } from "@/shared/config";
import { authFetch, getAccount, subscribeAccount } from "./auth";

// 自分が送ったフィードバックと、開発者からの返信。ログイン中だけ取りに行く
export type Reply = { id: number; ts: number; body: string; seen: boolean; mine?: boolean }; // mine: 自分が続けて書き込んだもの
export type MyFeedback = { id: number; ts: number; kind: string; message: string; status: string; replies: Reply[] };
type View = { items: MyFeedback[]; unread: number; loaded: boolean };

let view: View = { items: [], unread: 0, loaded: false };
const subs = new Set<() => void>();
const set = (items: MyFeedback[]) => { view = { items, unread: items.reduce((n, f) => n + f.replies.filter((r) => !r.seen && !r.mine).length, 0), loaded: true }; subs.forEach((f) => f()); };
export const useReplies = (): View => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => view);

export async function loadReplies(): Promise<void> {
  if (!getAccount()) { view = { items: [], unread: 0, loaded: false }; subs.forEach((f) => f()); return; }
  try {
    const r = await authFetch(MY_FEEDBACK_URL);
    if (r && r.ok) set((await r.json()) as MyFeedback[]);
  } catch { /* 次の周期でやり直す */ }
}

// 返信を読んだことにする
export async function markRepliesSeen(): Promise<void> {
  if (!view.unread) return;
  set(view.items.map((f) => ({ ...f, replies: f.replies.map((r) => ({ ...r, seen: true })) })));
  try { await authFetch(`${MY_FEEDBACK_URL}/seen`, { method: "POST" }); } catch { /* 次に開いたときに、また印をつける */ }
}

// 自分のフィードバックに続けて書き込む。開発者の返信を待つ状態に戻る
export async function postReply(id: number, body: string): Promise<"ok" | "rate" | "fail"> {
  try {
    const r = await authFetch(`${MY_FEEDBACK_URL}/${id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body }) });
    if (!r) return "fail";
    if (r.ok) { await loadReplies(); return "ok"; }
    return r.status === 429 ? "rate" : "fail";
  } catch { return "fail"; }
}

let started = false;
export function startReplies() {
  if (started) return;
  started = true;
  let last = getAccount()?.id ?? "";
  subscribeAccount(() => { const id = getAccount()?.id ?? ""; if (id !== last) { last = id; void loadReplies(); } });
  setInterval(() => { if (document.visibilityState === "visible") void loadReplies(); }, REPLY_POLL_MS);
  setTimeout(() => void loadReplies(), 4000);
}
