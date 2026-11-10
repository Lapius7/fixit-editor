import { kvGet, kvSet, kvWatch, mergeById } from "@/platform/appdata";
import { useSyncExternalStore } from "react";
import { exportJson, fromOtherWindow, importJson, subscribe } from "@/features/settings/settings";
import i18next from 'i18next'

// プロファイル: 設定(見た目・各項目・ショートカット)ひとまとまりに名前をつけたもの。
// 使っているプロファイルには、設定を変えるたびに自動で書き戻す。
export type Profile = { id: string; name: string; data: string; updated: number };
type Store = { active: string; list: Profile[] };

const KEY = "fixit:profiles:v1";
const uid = () => Math.random().toString(36).slice(2, 9);

function load(raw: string | null = kvGet(KEY)): Store {
  try {
    const r = JSON.parse(raw || "null") as Store | null;
    if (r && Array.isArray(r.list) && r.list.length && r.list.some((p) => p.id === r.active)) {
      return { active: r.active, list: r.list.filter((p) => p && typeof p.id === "string" && typeof p.data === "string") };
    }
  } catch { /* 読めなければ作り直す */ }
  const id = uid();
  return { active: id, list: [{ id, name: i18next.t("標準"), data: exportJson(), updated: Date.now() }] };
}

let st: Store = load();
const subs = new Set<() => void>();
let applying = false;

const save = () => { try { kvSet(KEY, JSON.stringify(st)); } catch { /* 保存できない */ } };
const set = (next: Store) => { st = next; save(); subs.forEach((f) => f()); };
save();

// 設定が変わったら、使っているプロファイルへ書き戻す
let t: ReturnType<typeof setTimeout> | undefined;
const flush = () => {
  clearTimeout(t);
  const data = exportJson();
  const cur = st.list.find((p) => p.id === st.active);
  if (cur && cur.data !== data) set({ ...st, list: st.list.map((p) => (p.id === st.active ? { ...p, data, updated: Date.now() } : p)) });
};
subscribe(() => { if (applying || fromOtherWindow()) return; clearTimeout(t); t = setTimeout(flush, 300); });

export const getProfiles = () => st;
export const useProfiles = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => st);

const apply = (data: string) => { applying = true; try { importJson(data); } finally { applying = false; } };

export function switchProfile(id: string): boolean {
  const p = st.list.find((x) => x.id === id);
  if (!p) return false;
  if (id === st.active) return true;
  flush();
  apply(p.data);
  set({ ...st, active: id });
  return true;
}

function uniqueName(name: string) {
  const base = name.trim() || i18next.t("新しいプロファイル");
  let n = base, i = 2;
  while (st.list.some((p) => p.name === n)) n = `${base} ${i++}`;
  return n;
}

// from: 今の設定 / 初期設定 / 別のプロファイルの中身
export function createProfile(name: string, from: "current" | "default" | { data: string } = "current", activate = true): string {
  flush();
  const id = uid();
  const data = from === "current" ? exportJson() : from === "default" ? "{}" : from.data;
  const p: Profile = { id, name: uniqueName(name), data, updated: Date.now() };
  set({ ...st, list: [...st.list, p] });
  if (activate) switchProfile(id);
  return id;
}

export const duplicateProfile = (id: string) => {
  flush();
  const p = st.list.find((x) => x.id === id);
  return p ? createProfile(i18next.t("{{name}} のコピー", { name: p.name }), { data: p.data }, false) : null;
};

export const renameProfile = (id: string, name: string) => {
  const n = name.trim();
  if (!n) return;
  set({ ...st, list: st.list.map((p) => (p.id === id ? { ...p, name: st.list.some((x) => x.id !== id && x.name === n) ? uniqueName(n) : n } : p)) });
};

export function removeProfile(id: string): boolean {
  if (st.list.length <= 1) return false;
  const rest = st.list.filter((p) => p.id !== id);
  if (id === st.active) { apply(rest[0].data); set({ active: rest[0].id, list: rest }); } else set({ ...st, list: rest });
  return true;
}

export const exportProfile = (id: string) => {
  flush();
  const p = st.list.find((x) => x.id === id);
  return p ? JSON.stringify({ fixitProfile: 1, name: p.name, settings: JSON.parse(p.data) }, null, 2) : "";
};

export function importProfile(text: string): string {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(i18next.t("プロファイルのファイルではありません"));
  const settings = raw.fixitProfile ? raw.settings : raw; // 設定の書き出しファイルも受け付ける
  if (!settings || typeof settings !== "object") throw new Error(i18next.t("プロファイルのファイルではありません"));
  return createProfile(typeof raw.name === "string" ? raw.name : i18next.t("読み込んだプロファイル"), { data: JSON.stringify(settings) }, false);
}

// 一覧に出す小さな見本(色とモード)
export function preview(p: Profile): { accent: string; mode: string } {
  try {
    const r = JSON.parse(p.data);
    return { accent: typeof r.accent === "string" ? r.accent : "#3b6fd9", mode: r.mode === "dark" ? i18next.t("ダーク") : r.mode === "light" ? i18next.t("ライト") : i18next.t("自動") };
  } catch { return { accent: "#3b6fd9", mode: i18next.t("自動") }; }
}

// 他のウィンドウがプロファイルを変えたら取り込む。使うプロファイル(active)は、このウィンドウのものを保つ
kvWatch(KEY, (f, dirty) => {
  const theirs = load(f);
  const list = dirty ? mergeById(st.list, theirs.list, (a, b) => (b.updated > a.updated ? b : a)) : theirs.list;
  st = { active: list.some((p) => p.id === st.active) ? st.active : theirs.active, list };
  if (dirty) save();
  subs.forEach((f) => f());
});
