import { useSyncExternalStore } from "react";
import { kvDel, kvGet, kvSet, mergeById } from "@/platform/appdata";
import { SYNC_POLL_MS, SYNC_PUSH_DELAY_MS, SYNC_URL } from "@/shared/config";
import { getAccount, authFetch, subscribeAccount } from "./auth";
import { reloadFromStore as reloadSettings, syncExport } from "@/features/settings/settings";
import { reloadFromStore as reloadProfiles } from "@/features/settings/profiles";
import { reloadFromStore as reloadWorkspaces } from "@/features/workspaces/workspaces";
import type { RootRef, Workspace } from "@/features/workspaces/workspaces";

// 設定・プロファイル・ワークスペースを、ログインしたアカウントで端末間そろえる。
// 送るのは、この 3 つのキーだけ(AI のキー・会話・統計・ログインの情報は送らない)。
// 「ワークスペース」は、名前・色・フォルダの場所(WSL・SSH・PC のパス)・プロファイルだけを送る。
// タブ・分割・ターミナルの状態と、ブラウザで開いたフォルダ(場所を持たない)は送らない。
type Mod = {
  kv: string;
  // kv の中身から、送る文字列(first = 比べる用に、毎回変わる値を除いた形)を作る
  out: (raw: string | null, forHash: boolean) => string;
  // 手元と相手を混ぜた結果(kv に書く文字列)。pull = 手元に未送信の変更がなく、相手の内容に合わせるだけ
  merge: (local: string | null, remote: string, how: "pull" | "first" | "conflict") => string;
  reload: () => void;
};

const parse = <T,>(s: string | null, d: T): T => { try { return (JSON.parse(s || "null") as T) ?? d; } catch { return d; } };

const syncable = (r: RootRef | undefined): r is Extract<RootRef, { path: string }> => !!r && (r.kind === "wsl" || r.kind === "ssh" || r.kind === "pc");
type WsOut = Pick<Workspace, "id" | "name" | "color" | "root" | "roots" | "profile" | "pinned" | "updated">;
const wsOut = (w: Workspace): WsOut | null => {
  if (!syncable(w.root)) return null;
  return { id: w.id, name: w.name, color: w.color, root: w.root, roots: w.roots?.filter((e) => syncable(e.ref)), profile: w.profile, pinned: w.pinned, updated: w.updated };
};
const BLANK = { tabs: [], act: [null, null], fp: 0, split: false, side: true, panel: "files", term: false, terms: [], actTerm: 0 } as const;

const MODS: Record<string, Mod> = {
  settings: {
    kv: "fixit:settings:v1",
    out: (raw) => syncExport(raw),
    merge: (local, remote, how) => JSON.stringify(how === "conflict" ? { ...parse(remote, {}), ...parse(local, {}) } : { ...parse(local, {}), ...parse(remote, {}) }),
    reload: reloadSettings,
  },
  profiles: {
    kv: "fixit:profiles:v1",
    out: (raw) => JSON.stringify(parse<{ list?: unknown[] }>(raw, {}).list ?? []),
    merge: (local, remote, how) => {
      const mine = parse<{ active?: string; list?: { id: string; updated: number }[] }>(local, {});
      const theirs = parse<{ id: string; updated: number }[]>(remote, []);
      const list = how === "pull" ? theirs : mergeById(mine.list ?? [], theirs, (a, b) => (b.updated > a.updated ? b : a));
      const active = list.some((p) => p.id === mine.active) ? mine.active : list[0]?.id;
      return JSON.stringify({ active, list });
    },
    reload: () => reloadProfiles(),
  },
  workspaces: {
    kv: "fixit:workspaces:v1",
    // 比べるときは、タブを開くたびに変わる updated を除く
    out: (raw, forHash) => JSON.stringify((parse<{ list?: Workspace[] }>(raw, {}).list ?? []).map(wsOut).filter(Boolean).map((w) => (forHash ? { ...w, updated: 0 } : w))),
    merge: (local, remote, how) => {
      const mine = parse<{ list?: Workspace[]; current?: string | null }>(local, {});
      const theirs = parse<WsOut[]>(remote, []);
      const have = new Map((mine.list ?? []).map((w) => [w.id, w]));
      const fromRemote = (t: WsOut): Workspace => {
        const w = have.get(t.id);
        if (!w) return { ...BLANK, ...t } as unknown as Workspace;
        // 手元のほうが新しい変更なら、手元の名前・色などを残す(タブ類は常に手元のもの)
        return how === "conflict" && w.updated > t.updated ? w : { ...w, ...t, roots: t.roots, profile: t.profile, pinned: t.pinned, updated: Math.max(w.updated, t.updated) };
      };
      const merged = theirs.map(fromRemote);
      const ids = new Set(merged.map((w) => w.id));
      // 手元にだけあるもの: この PC だけで開くフォルダは常に残す。ほかは、取り込むだけなら相手で消されたとみなす
      const rest = (mine.list ?? []).filter((w) => !ids.has(w.id) && (how !== "pull" || !syncable(w.root)));
      return JSON.stringify({ list: [...merged, ...rest], current: mine.current ?? null });
    },
    reload: () => reloadWorkspaces(),
  },
};
const ORDER = ["settings", "profiles", "workspaces"] as const;

/* ---------- 同期の状態(この PC の中だけに残す) ---------- */
type KeySt = { rev: number; base: string }; // rev = 最後に合わせた相手側の版、base = そのときの手元の指紋
type St = { uid: string; on: boolean; at: number; keys: Record<string, KeySt> };
const SKEY = "fixit:sync:v1";
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `${s.length}:${(h >>> 0).toString(36)}`; };
const load = (): St => { const r = parse<Partial<St>>(kvGet(SKEY), {}); return { uid: r.uid ?? "", on: r.on !== false, at: r.at ?? 0, keys: r.keys ?? {} }; };
let st: St = load();
const saveSt = () => { try { kvSet(SKEY, JSON.stringify(st)); } catch { /* 保存できない */ } };

export type SyncView = { on: boolean; busy: boolean; at: number; error: string };
let view: SyncView = { on: st.on, busy: false, at: st.at, error: "" };
const subs = new Set<() => void>();
const setView = (p: Partial<SyncView>) => { view = { ...view, ...p }; subs.forEach((f) => f()); };
export const useSync = (): SyncView => useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => view);

type Remote = Record<string, { rev: number; updated: number; data: string }>;
type PushRes = { rev: number; updated: number; stale?: boolean; data?: string };

const get = async (): Promise<Remote | null> => {
  const r = await authFetch(SYNC_URL);
  if (!r) return null;
  if (!r.ok) throw new Error(`sync ${r.status}`);
  return (await r.json()) as Remote;
};
const push = async (k: string, rev: number, data: string): Promise<PushRes> => {
  const r = await authFetch(`${SYNC_URL}/${k}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev, data }) });
  if (!r) throw new Error("sync login");
  if (r.status === 413) throw new Error("too-large");
  if (!r.ok) throw new Error(`sync ${r.status}`);
  return (await r.json()) as PushRes;
};

// 手元の kv に書いて、各モジュールに読み直させる
const write = (m: Mod, text: string) => { kvSet(m.kv, text); m.reload(); };

async function syncKey(k: string, remote: { rev: number; data: string } | undefined, tries = 0): Promise<void> {
  const m = MODS[k];
  const mine = st.keys[k] ?? { rev: 0, base: "" };
  const cur = () => hash(m.out(kvGet(m.kv), true));
  const changed = !mine.base || cur() !== mine.base;
  const first = !st.keys[k];

  if (remote && remote.rev > mine.rev) {
    if (!changed || (first && k === "settings")) {
      // 相手に合わせるだけ(初めて合わせる設定は、相手を優先する)
      write(m, m.merge(kvGet(m.kv), remote.data, first ? "first" : "pull"));
      st.keys[k] = { rev: remote.rev, base: cur() };
      saveSt();
      return;
    }
    // 手元にも変更がある: 混ぜてから送る
    write(m, m.merge(kvGet(m.kv), remote.data, first ? "first" : "conflict"));
    st.keys[k] = { rev: remote.rev, base: "" };
    return syncKey(k, undefined, tries);
  }
  if (!changed && st.keys[k]) return;

  const body = m.out(kvGet(m.kv), false);
  const res = await push(k, mine.rev, body);
  if (res.stale && res.data !== undefined) {
    if (tries >= 2) throw new Error("conflict");
    return syncKey(k, { rev: res.rev, data: res.data }, tries + 1);
  }
  st.keys[k] = { rev: res.rev, base: cur() };
  saveSt();
}

let running: Promise<void> | null = null;
let again = false;
// 今すぐ同期する。同時に動くのは 1 つだけで、動いている間に呼ばれたら、終わってからもう一度
export function syncNow(): Promise<void> {
  if (!getAccount() || !st.on) return Promise.resolve();
  if (running) { again = true; return running; }
  running = (async () => {
    setView({ busy: true });
    try {
      const acc = getAccount();
      if (acc && st.uid !== acc.id) { st = { ...st, uid: acc.id, keys: {} }; saveSt(); } // 別のアカウントなら、最初から合わせ直す
      const remote = await get();
      if (!remote) return;
      for (const k of ORDER) await syncKey(k, remote[k] && remote[k].data !== undefined ? { rev: remote[k].rev, data: remote[k].data } : undefined);
      st.at = Date.now(); saveSt();
      setView({ at: st.at, error: "" });
    } catch (e) {
      setView({ error: e instanceof Error ? e.message : "error" });
    } finally {
      running = null;
      setView({ busy: false });
      if (again) { again = false; schedule(500); }
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;
const schedule = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => void syncNow(), ms); };

export function setSyncOn(on: boolean) {
  st.on = on; saveSt(); setView({ on });
  if (on) void syncNow();
}

// クラウドに置いた同期データを消す(この PC のデータは消さない)
export async function deleteCloudData(): Promise<boolean> {
  const r = await authFetch(SYNC_URL, { method: "DELETE" });
  if (!r || !r.ok) return false;
  st = { ...st, keys: {}, at: 0 }; saveSt(); setView({ at: 0 });
  return true;
}

let started = false;
// 起動時に 1 回。変更を見張って、止まってから送る。一定の間隔で相手の変更も見に行く
export function startSync() {
  if (started) return;
  started = true;
  const seen = new Map<string, string>(ORDER.map((k) => [k, hash(MODS[k].out(kvGet(MODS[k].kv), true))]));
  setInterval(() => {
    if (!getAccount() || !st.on) return;
    for (const k of ORDER) {
      const h = hash(MODS[k].out(kvGet(MODS[k].kv), true));
      if (h !== seen.get(k)) { seen.set(k, h); schedule(SYNC_PUSH_DELAY_MS); }
    }
  }, 2000);
  setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, SYNC_POLL_MS);
  addEventListener("focus", () => schedule(1500));
  let lastId = getAccount()?.id ?? "";
  subscribeAccount(() => { const id = getAccount()?.id ?? ""; if (id !== lastId) { lastId = id; if (id) schedule(300); } });
  if (getAccount()) schedule(2500);
}
export const _forgetSync = () => { kvDel(SKEY); st = load(); };
