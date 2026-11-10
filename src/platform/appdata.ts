// データの置き場所。アプリ版(Tauri)では、設定・AI の会話履歴・統計などを %APPDATA%\Fixit の JSON ファイルに残し、
// localStorage は使わない。起動時にフォルダの内容をメモリに読み込み、書き込みは(待ち時間を置いて)ファイルへ写す。
// ブラウザ版(開発サーバー)では localStorage をそのまま使う。各機能は kvGet / kvSet / kvDel だけを呼ぶ。
import { IS_TAURI } from "@/shared/chrome";

const WAIT_MS = 400;
const POLL_MS = 2000;
const mem = new Map<string, string>();
let app = false; // フォルダから読み込めたときだけ true(読めなかったときは localStorage で動かす)
let dir = "";
let send: (k: string) => void = () => {};

// 他のウィンドウが同じキーを書き換えたときに呼ぶ関数。
// dirty = false: こちらに未保存の変更がない。kvGet(k) がすでに新しい値なので、状態を読み直すだけでよい
// dirty = true : こちらにも未保存の変更がある。kvGet(k) はこちらの値のまま。foreign(他方の値)と混ぜて、kvSet し直す
// prev: こちらが最後にファイルと一致を確かめた値。「こちらの変更分」(いまの状態 − prev)を、foreign に足すときに使う
export type Watch = (foreign: string | null, dirty: boolean, prev: string | null) => void;
const watchers = new Map<string, Watch>();
export const kvWatch = (k: string, f: Watch): void => { watchers.set(k, f); };

// id で重ねて混ぜる。同じ id は pick が選ぶほう(既定はこちら側)。並びはこちら側が先
export function mergeById<T extends { id: string }>(mine: T[], theirs: T[], pick: (a: T, b: T) => T = (a) => a): T[] {
  const b = new Map(theirs.map((x) => [x.id, x]));
  const out = mine.map((x) => { const y = b.get(x.id); b.delete(x.id); return y ? pick(x, y) : x; });
  return [...out, ...b.values()];
}

export const dataDir = () => dir; // データフォルダの場所(アプリ版で読み込めたあと)

export const kvGet = (k: string): string | null => (app ? (mem.get(k) ?? null) : localStorage.getItem(k));
export function kvSet(k: string, v: string): void { if (app) { mem.set(k, v); send(k); } else localStorage.setItem(k, v); }
export function kvDel(k: string): void { if (app) { mem.delete(k); send(k); } else localStorage.removeItem(k); }

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

// 起動の最初に 1 回呼ぶ。本体(設定などを読むモジュール)は、これが終わってから読み込む
export async function initStore(): Promise<void> {
  if (!IS_TAURI) {
    // 開発用のブラウザ版: 別のタブが書いたら取り込む
    addEventListener("storage", (e) => { if (e.key && e.key.startsWith("fixit:") && e.storageArea === localStorage) watchers.get(e.key)?.(e.newValue, false, null); });
    return;
  }
  let invoke: Invoke;
  const stamps = new Map<string, string>(); // 最後に見た各ファイルの更新の目印
  const known = new Map<string, string | null>(); // 最後にファイルと同じだと分かった値(自分が書いた値か、読んだ値)
  try {
    invoke = (await import("@tauri-apps/api/core")).invoke as Invoke;
    // 目印は読み込みより先に取る。その間に他のウィンドウが書いても、最初の確認で拾える
    for (const [k, v] of Object.entries(await invoke<Record<string, string>>("store_stamps"))) stamps.set(k, v);
    const all = await invoke<{ dir: string; files: Record<string, string> }>("store_load");
    dir = all.dir;
    for (const [k, v] of Object.entries(all.files)) { mem.set(k, v); known.set(k, v); }
  } catch { return; }
  app = true;

  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const cancel = (k: string) => { const t = timers.get(k); if (t) clearTimeout(t); timers.delete(k); };

  // 他のウィンドウの値を取り込む
  const foreign = (k: string, disk: string | null, pending = timers.has(k)) => {
    const prev = known.get(k) ?? null;
    known.set(k, disk);
    const w = watchers.get(k), dirty = pending;
    if (!dirty) { if (disk === null) mem.delete(k); else mem.set(k, disk); }
    try { w?.(disk, dirty, prev); } catch { /* 取り込めなくても、こちらの動作は止めない */ }
  };

  const put = (k: string) => { const v = mem.get(k) ?? null; known.set(k, v); return invoke("store_save", { key: k, value: v }); };
  const flush = async (k: string) => {
    timers.delete(k);
    try {
      // 書く前に、ほかのウィンドウが先に書いていないか見る。書いていたら混ぜてから書く(古い内容で上書きしない)
      const disk = await invoke<string | null>("store_read", { key: k });
      if (disk !== (known.get(k) ?? null)) { foreign(k, disk, true); cancel(k); }
      await put(k);
    } catch { /* 保存できないときは次の変更でやり直す */ }
  };
  send = (k) => { cancel(k); timers.set(k, setTimeout(() => void flush(k), WAIT_MS)); };
  // 閉じる・隠れる直前は、確かめずにすぐ書く(確かめている間にウィンドウが閉じてしまうため)
  const flushAll = () => { for (const k of [...timers.keys()]) { cancel(k); void put(k).catch(() => {}); } };

  // 他のウィンドウの変更を、一定の間隔で調べる
  let busy = false;
  const poll = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = await invoke<Record<string, string>>("store_stamps");
      for (const [k, st] of Object.entries(now)) {
        if (stamps.get(k) === st) continue;
        stamps.set(k, st);
        const disk = await invoke<string | null>("store_read", { key: k });
        if (disk !== null && disk !== (known.get(k) ?? null)) foreign(k, disk);
      }
      for (const k of [...known.keys()]) {
        if (known.get(k) != null && !(k in now) && !timers.has(k)) { stamps.delete(k); foreign(k, null); } // 他のウィンドウが消した
      }
    } catch { /* 次の周期でやり直す */ } finally { busy = false; }
  };
  setInterval(() => { if (document.visibilityState === "visible") void poll(); }, POLL_MS);
  addEventListener("focus", () => void poll());

  // 閉じる直前の書き込みを取りこぼさない
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushAll(); else void poll(); });
  window.addEventListener("pagehide", flushAll);
}
