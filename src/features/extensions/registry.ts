// 入れた拡張機能の保存と状態。外部へ送るのは、サイトの /api/ext/ への取得(GET)だけで、ユーザー・ファイルの情報は含まない。
// 状態の決め方: 署名つきで本文が署名と合えば verified、署名なしでユーザーが許可したものは unverified、
// 失効リストに載れば revoked / blocked(動かさない)、署名が合わなくなれば tampered(動かさない)。
import { useSyncExternalStore } from "react";
import { kvGet, kvSet, kvWatch } from "@/platform/appdata";
import { IS_TAURI } from "@/shared/chrome";
import { dataGet, dropExt } from "./host/store";
import { delBlobsOf } from "./host/blobs";
import { hostRunning, panelAction, runCommand, stop as stopHost } from "./host/runtime";
import { FILE_NAME, MAX_FILE_CHARS, EXT_ID, EXT_VER, LOCAL_PREFIX, cmpVer, localBundle, permsWithin, readBundle, type Manifest, type Perms } from "./spec";

export const EXT_KEY = "fixit:extensions:v1";
const CHECK_MS = 6 * 3600_000; // 失効リストを取り直す間隔

type Saved = { version: string; raw: string; sig: string | null; consent: Perms; enabled: boolean; at: number };
type Revoked = { ts: number; items: string[]; sig: string };
type Store = { v: 1; items: Record<string, Saved>; theme: string | null; rev: Revoked | null; checked: number };
export type Status = "verified" | "unverified" | "revoked" | "blocked" | "tampered" | "needs-consent";
export type Installed = { id: string; manifest: Manifest; version: string; sig: string | null; enabled: boolean; status: Status; active: boolean };
export type Listed = { id: string; owner: string; versions: { version: string; status: "pending" | "verified" | "revoked"; sig: string | null; name: string; description: string; perms: Perms; kinds: { themes: number; snippets: number; commands: number }; size: number; ts: number }[] };

const empty = (): Store => ({ v: 1, items: {}, theme: null, rev: null, checked: 0 });
let store: Store = empty();
let status: Record<string, Status> = {};
let manifests: Record<string, Manifest> = {};
let snap: Installed[] = [];
const subs = new Set<() => void>();

const invoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
export const extAvailable = IS_TAURI || import.meta.env.DEV; // 拡張機能はデスクトップ版だけ(開発サーバーは動作確認用)
const get = (path: string) => invoke<string>("ext_get", { path });

function persist() { kvSet(EXT_KEY, JSON.stringify(store)); }
function rebuild() {
  snap = Object.entries(store.items).filter(([id]) => manifests[id]).map(([id, s]) => {
    const st = status[id] ?? "tampered";
    return { id, manifest: manifests[id], version: s.version, sig: s.sig, enabled: s.enabled, status: st, active: s.enabled && (st === "verified" || st === "unverified") };
  }).sort((a, b) => a.id.localeCompare(b.id));
  subs.forEach((f) => f());
}

/** 保存した 1 件を調べ直す(署名・失効リスト・同意した権限) */
async function judge(id: string, s: Saved): Promise<Status> {
  const b = readBundle(s.raw);
  if (!b || b.manifest.id !== id || b.manifest.version !== s.version) return "tampered";
  manifests[id] = b.manifest;
  const items = store.rev?.items ?? [];
  const key = `${id}@${s.version}`;
  if (items.includes(`block:${key}`)) return "blocked";
  if (s.sig && id.startsWith(LOCAL_PREFIX)) return "tampered"; // 署名つきの local. は、あり得ない
  if (s.sig) {
    try { const [vid, vver] = await invoke<[string, string]>("ext_verify", { raw: s.raw, sig: s.sig }); if (vid !== id || vver !== s.version) return "tampered"; } catch { return "tampered"; }
    if (items.includes(`unverify:${key}`)) return "revoked";
    return "verified";
  }
  // 署名のない版は、許可した権限の範囲に収まっているときだけ動かす
  return permsWithin(b.manifest.perms, s.consent) ? "unverified" : "needs-consent";
}

async function refresh() {
  status = {}; manifests = {};
  for (const [id, s] of Object.entries(store.items)) status[id] = await judge(id, s);
  rebuild();
}

function load(raw: string | null) {
  try { const j = JSON.parse(raw ?? "null"); if (j?.v === 1 && j.items && typeof j.items === "object") store = { ...empty(), ...j }; } catch { /* 読めなければ、いまの値のまま */ }
}
// 別のウィンドウが入れた・消した内容を取り込む(古い写しで上書きしないため)。自分に書き込み待ちがあるときは取り込まない
if (extAvailable) kvWatch(EXT_KEY, (f, dirty) => { if (f === null || dirty) return; load(f); void refresh(); });

export async function initExtensions(): Promise<void> {
  if (!extAvailable) return;
  load(kvGet(EXT_KEY));
  await refresh();
  void checkRevocations().then(autoUpdate);
}

export const useInstalled = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap);
export const activeTheme = () => store.theme;
export function setTheme(v: string | null) { store.theme = v; persist(); rebuild(); }

/** 失効リストを取り、署名が合うものだけ保存する。古いリスト(時刻が戻るもの)は受け付けない */
export async function checkRevocations(force = false): Promise<void> {
  if (!extAvailable || !Object.keys(store.items).length || (!force && Date.now() - store.checked < CHECK_MS)) return; // 入れたものがなければ通信しない
  try {
    const r = JSON.parse(await get("revoked")) as Revoked;
    if (!r || typeof r.ts !== "number" || !Array.isArray(r.items) || typeof r.sig !== "string" || !r.items.every((x) => typeof x === "string")) return;
    if (store.rev && r.ts < store.rev.ts) return;
    await invoke("ext_verify_revoked", { ts: r.ts, items: r.items, sig: r.sig });
    store.rev = { ts: r.ts, items: r.items, sig: r.sig };
    store.checked = Date.now();
    persist();
    await refresh();
  } catch { /* 取れない・署名が合わないときは、いまの状態のまま(次の機会にもう一度) */ }
}

export async function fetchList(): Promise<Listed[]> {
  const j = JSON.parse(await get("list")) as unknown;
  // local. で始まる id は自作用。サイトのものとしては扱わない
  return Array.isArray(j) ? (j as Listed[]).filter((g) => EXT_ID.test(g.id) && !g.id.startsWith(LOCAL_PREFIX) && Array.isArray(g.versions)) : [];
}

/** 本文を取って検査する。署名つきなら署名も確かめる(合わなければ入れない) */
export async function fetchBundle(id: string, version: string, sig: string | null): Promise<{ raw: string; manifest: Manifest } | "bad"> {
  if (!EXT_ID.test(id) || !EXT_VER.test(version) || id.startsWith(LOCAL_PREFIX)) return "bad";
  const raw = await get(`${id}/${version}/bundle`);
  const b = readBundle(raw);
  if (!b || b.manifest.id !== id || b.manifest.version !== version) return "bad";
  if (sig) { try { await invoke("ext_verify", { raw, sig }); } catch { return "bad"; } }
  return { raw, manifest: b.manifest };
}

/** 入れる(同意は呼び出し側で取ってから)。consent は、ユーザーが許可した権限 */
export async function install(id: string, raw: string, sig: string | null, consent: Perms, keepEnabled = true): Promise<void> {
  const b = readBundle(raw); if (!b) return;
  const old = store.items[id];
  store.items[id] = { version: b.manifest.version, raw, sig, consent, enabled: keepEnabled && (old ? old.enabled : true), at: Date.now() };
  persist();
  await refresh();
}
/** 自作のフォルダを読んで、入れる前の確認に渡す形にする。読むのは、選んだフォルダ直下の fixit-extension.json だけ */
export async function readLocal(dir: string): Promise<{ id: string; version: string; sig: null; manifest: Manifest; raw: string } | "bad" | "id" | "missing"> {
  let text: string;
  try { text = await invoke<string>("ext_read_local", { dir }); } catch { return "missing"; }
  // format 2: main のスクリプトも、選んだフォルダの中のものだけ読む(名前の形は readBundle と同じ規則で先に確かめる)
  const files: Record<string, string> = {};
  try {
    const main = (JSON.parse(text) as { main?: unknown }).main;
    if (typeof main === "string") {
      if (!FILE_NAME.test(main) || main.includes("..") || main.startsWith("/") || !main.endsWith(".js")) return "bad";
      const { RemoteFile } = await import("@/platform/remote");
      const f = await new RemoteFile({ kind: "pc", path: dir }, `${dir.replace(/[\\/]+$/, "")}/${main}`, main).getFile();
      if (f.size > MAX_FILE_CHARS * 4) return "bad";
      files[main] = await f.text();
    }
  } catch { return "bad"; }
  const r = localBundle(text, files);
  return typeof r === "string" ? r : { id: r.manifest.id, version: r.manifest.version, sig: null, manifest: r.manifest, raw: r.raw };
}
export const isLocal = (id: string) => id.startsWith(LOCAL_PREFIX);
export const pickFolder = () => invoke<string | null>("pick_folder", { title: null });
export function setEnabled(id: string, on: boolean) { const s = store.items[id]; if (!s) return; s.enabled = on; persist(); rebuild(); }
export function uninstall(id: string) { stopHost(id); dropExt(id); void delBlobsOf(id); delete store.items[id]; if (store.theme?.startsWith(`${id}/`)) store.theme = null; delete status[id]; delete manifests[id]; persist(); rebuild(); }
/** 入れた拡張のファイル(main のスクリプトなど)。保存した本文から取り出す */
export const filesOf = (id: string): Record<string, string> => { const s = store.items[id]; return (s && readBundle(s.raw)?.files) || {}; };
export const consentOf = (id: string): Perms | null => store.items[id]?.consent ?? null;

/** 認証済みの新しい版が出ていて、権限が増えないものだけ自動で入れる(未認証の版や、権限が増える版は入れない) */
export async function autoUpdate(): Promise<void> {
  if (!extAvailable || !Object.keys(store.items).length) return;
  let list: Listed[];
  try { list = await fetchList(); } catch { return; }
  for (const [id, s] of Object.entries(store.items)) {
    if (!s.sig || status[id] !== "verified") continue; // 認証済みで動いているものだけ対象
    const g = list.find((x) => x.id === id);
    const nv = g?.versions.filter((v) => v.status === "verified" && v.sig && cmpVer(v.version, s.version) > 0).sort((a, b) => cmpVer(b.version, a.version))[0];
    if (!nv || !nv.sig) continue;
    const r = await fetchBundle(id, nv.version, nv.sig).catch(() => "bad" as const);
    if (r === "bad" || !permsWithin(r.manifest.perms, s.consent)) continue;
    await install(id, r.raw, nv.sig, s.consent);
  }
}
/** 一覧の上で、新しい版(認証済みかどうかを問わず)があるか */
export const hasNewer = (g: Listed, installed: string) => g.versions.some((v) => cmpVer(v.version, installed) > 0);

// 起動後も数時間おきに、失効リストを取り直す
if (extAvailable && typeof window !== "undefined") setInterval(() => { void checkRevocations().then(autoUpdate); }, CHECK_MS);

// 開発サーバーだけ: 画面の確認(Playwright)用に、署名なしの拡張を直接入れる口。アプリ版には出ない
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __extDev: unknown }).__extDev = {
    install: async (text: string, files: Record<string, string>) => {
      initDev();
      const r = localBundle(text, files);
      if (typeof r === "string") return r;
      await install(r.manifest.id, r.raw, null, r.manifest.perms);
      return r.manifest.id;
    },
    data: (id: string, k: string) => dataGet(id, k),
    setEnabled: (id: string, on: boolean) => setEnabled(id, on),
    runCommand: (id: string, cid: string) => runCommand(id, cid),
    panelAction: (id: string, p: string, a: string, v: string) => panelAction(id, p, a, v),
    running: (id: string) => hostRunning(id),
  };
  let did = false;
  const initDev = () => { if (did) return; did = true; load(kvGet(EXT_KEY)); };
}
