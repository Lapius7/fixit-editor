import { kvGet, kvSet, kvWatch, mergeById } from "@/platform/appdata";
// AI の会話の履歴。会話ごとに残し、いつでも戻れるようにする。
// API キーなどの接続設定(store.ts)とは別のキーに置く。設定の書き出し・変更履歴・統計には載らない。
import { useSyncExternalStore } from "react";
import { AI_CHATS_KEY, AI_CHATS_MAX, AI_CHATS_MAX_CHARS, AI_CHATS_MAX_IMAGE_CHARS } from "@/shared/config";

export type SavedImg = { type: string; data: string; name: string };
export type SavedMsg = { id: number; role: "user" | "assistant"; content: string; label?: string; ctx?: string; at?: number; imgs?: SavedImg[] };
export type Chat = { id: string; title: string; at: number; msgs: SavedMsg[] };
type State = { cur: string | null; chats: Chat[] };

// 画像は、種類と中身が文字列のものだけ残す(壊れた履歴で表示が止まらないように)
const imgsOf = (v: unknown): SavedImg[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((i) => i && typeof i.type === "string" && i.type.startsWith("image/") && typeof i.data === "string" && i.data)
    .map((i) => ({ type: i.type as string, data: i.data as string, name: typeof i.name === "string" ? i.name : "" }));
  return out.length ? out : undefined;
};

const load = (raw: string | null = kvGet(AI_CHATS_KEY)): State => {
  try {
    const r = JSON.parse(raw ?? "null");
    if (r && Array.isArray(r.chats)) {
      const chats = (r.chats as Chat[]).filter((c) => c && typeof c.id === "string" && Array.isArray(c.msgs)).map((c) => ({ id: c.id, title: String(c.title ?? ""), at: Number(c.at) || 0, msgs: c.msgs.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ id: Number(m.id) || 0, role: m.role, content: m.content, label: typeof m.label === "string" ? m.label : undefined, ctx: typeof m.ctx === "string" ? m.ctx : undefined, at: Number(m.at) > 0 ? Number(m.at) : undefined, imgs: imgsOf(m.imgs) })) }));
      return { cur: typeof r.cur === "string" && chats.some((c) => c.id === r.cur) ? r.cur : null, chats };
    }
  } catch { /* 読めなければ空から始める */ }
  return { cur: null, chats: [] };
};

let st: State = load();
const subs = new Set<() => void>();
const size = (c: Chat) => c.msgs.reduce((n, m) => n + m.content.length + (m.label?.length ?? 0), 0);
const imgSize = (c: Chat) => c.msgs.reduce((n, m) => n + (m.imgs?.reduce((a, i) => a + i.data.length, 0) ?? 0), 0);
const noImgs = (c: Chat): Chat => (imgSize(c) ? { ...c, msgs: c.msgs.map(({ imgs: _, ...m }) => m) } : c);
const commit = (next: State) => {
  // 数と文字数の上限を超えたら、古い会話(いま開いているものは除く)から消す
  let chats = [...next.chats].sort((a, b) => b.at - a.at).slice(0, AI_CHATS_MAX);
  let total = chats.reduce((n, c) => n + size(c), 0);
  while (total > AI_CHATS_MAX_CHARS && chats.length > 1) {
    let k = chats.length - 1;
    if (chats[k].id === next.cur) k--;
    if (k < 0) break;
    total -= size(chats[k]); chats.splice(k, 1);
  }
  // 画像の量が上限を超えたら、古い会話の画像から外す(文章は残す)。いま開いている会話は最後まで残す
  let imgs = chats.reduce((n, c) => n + imgSize(c), 0);
  for (const cur of [false, true]) {
    for (let k = chats.length - 1; k >= 0 && imgs > AI_CHATS_MAX_IMAGE_CHARS; k--) {
      if ((chats[k].id === next.cur) !== cur) continue;
      imgs -= imgSize(chats[k]); chats[k] = noImgs(chats[k]);
    }
  }
  st = { cur: next.cur, chats };
  try { kvSet(AI_CHATS_KEY, JSON.stringify(st)); } catch {
    // 容量が足りないとき(ブラウザ版)は、画像を外して文章だけでも残す
    chats = chats.map(noImgs); st = { cur: next.cur, chats };
    try { kvSet(AI_CHATS_KEY, JSON.stringify(st)); } catch { /* 保存できなくてもメモリ上では動く */ }
  }
  subs.forEach((f) => f());
};

export const useChats = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);
export const getChats = () => st;
export const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const titleOf = (m: SavedMsg[]) => { const u = m.find((x) => x.role === "user"); return (u?.label ?? u?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 60); };

// いまの会話を保存する(空なら残さない)。cur をこの会話にする
export const saveChat = (id: string, msgs: SavedMsg[]) => {
  if (!msgs.length) { if (st.chats.some((c) => c.id === id)) commit({ cur: st.cur === id ? null : st.cur, chats: st.chats.filter((c) => c.id !== id) }); return; }
  const old = st.chats.find((c) => c.id === id);
  const chat: Chat = { id, title: old?.title || titleOf(msgs), at: Date.now(), msgs };
  commit({ cur: id, chats: [chat, ...st.chats.filter((c) => c.id !== id)] });
};
export const setCurChat = (id: string | null) => { if (st.cur !== id) commit({ ...st, cur: id }); };
export const deleteChat = (id: string) => commit({ cur: st.cur === id ? null : st.cur, chats: st.chats.filter((c) => c.id !== id) });
export const clearChats = () => commit({ cur: null, chats: [] });

// 他のウィンドウが会話を変えたら取り込む。「いま開いている会話(cur)」は、このウィンドウのものを保つ
kvWatch(AI_CHATS_KEY, (f, dirty) => {
  const theirs = load(f);
  const chats = dirty ? mergeById(st.chats, theirs.chats, (a, b) => (b.at > a.at ? b : a)) : theirs.chats;
  st = { cur: chats.some((c) => c.id === st.cur) ? st.cur : null, chats };
  if (dirty) { try { kvSet(AI_CHATS_KEY, JSON.stringify(st)); } catch { /* 保存できない */ } }
  subs.forEach((f) => f());
});
