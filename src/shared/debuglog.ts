// デバッグログ。不具合のとき、利用者がファイルにして渡せるようにする(設定の「このアプリについて」からダウンロード)。
// 自動では送らない。残すのはエラー・警告・主な出来事だけで、ファイルの中身や AI の会話は入れない。
// 最後の 400 件をメモリに持ち、エラーの直後と終了時に保存する。次の起動で「前回の起動」として、落ちたときの記録も渡せる。
import { kvGet, kvSet } from "@/platform/appdata";
import { exportJson } from "@/features/settings/settings";
import { IS_TAURI } from "@/shared/chrome";

type Level = "event" | "warn" | "error";
type Entry = { t: number; lv: Level; msg: string };
type Saved = { start: number; ver: string; entries: Entry[] };

const MAX = 400, MAX_MSG = 1500, KEY = "fixit.debuglog", PREV = "fixit.debuglog.prev";
const entries: Entry[] = [];
const start = Date.now();
const sections = new Map<string, () => string>();
let dirty = false, timer = 0, started = false;

// 利用者のフォルダ名・ユーザー名は、渡すログに残さない
export const scrubLog = (t: string): string => t
  .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"')]+/gi, "C:/Users/<user>")
  .replace(/\/home\/[^/\s"')]+/g, "/home/<user>")
  .replace(/\/Users\/[^/\s"')]+/g, "/Users/<user>")
  .replace(/\\\\wsl(?:\.localhost|\$)\\[^\\\s"')]+/gi, "\\\\wsl\\<distro>");

const text = (a: unknown): string => {
  if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ""}`;
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch { return String(a); }
};

function save() {
  timer = 0;
  if (!dirty) return;
  dirty = false;
  try { kvSet(KEY, JSON.stringify({ start, ver: __APP_VERSION__, entries } satisfies Saved)); } catch { /* 残せなくても動かす */ }
}
const later = () => { dirty = true; if (!timer) timer = window.setTimeout(save, 1000); };

function add(lv: Level, msg: string) {
  entries.push({ t: Date.now(), lv, msg: scrubLog(msg).slice(0, MAX_MSG) });
  if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  if (lv !== "event") later();
}

/** 主な出来事を 1 行で残す(例: dlog("lsp", "起動に失敗: …")) */
export const dlog = (tag: string, msg: string): void => add("event", `[${tag}] ${msg}`);

/** 報告に添える情報(状態の一覧など)を、名前をつけて足す */
export const addDebugSection = (name: string, f: () => string): void => { sections.set(name, f); };

export function startDebugLog(): void {
  if (started) return;
  started = true;
  // 前回の起動の記録を「前回」に回し、今回の記録を新しく始める
  const old = kvGet(KEY);
  if (old) kvSet(PREV, old);
  for (const lv of ["warn", "error"] as const) {
    const orig = console[lv].bind(console);
    console[lv] = (...a: unknown[]) => { orig(...a); try { add(lv, a.map(text).join(" ")); } catch { /* ログのせいで止めない */ } };
  }
  addEventListener("error", (e) => add("error", `window.error: ${e.message}${e.error?.stack ? `\n${e.error.stack}` : ""}`));
  addEventListener("unhandledrejection", (e) => add("error", `unhandledrejection: ${text(e.reason)}`));
  addEventListener("pagehide", save);
  setInterval(save, 30_000);
  dlog("app", `起動 v${__APP_VERSION__} ${IS_TAURI ? "デスクトップ" : "ブラウザ"}`);
  later();
}

const when = (t: number) => new Date(t).toLocaleString("sv-SE").replace(" ", "T");
const block = (title: string, list: Entry[]) => `## ${title}\n${list.length ? list.map((e) => `${when(e.t)} ${e.lv.padEnd(5)} ${e.msg}`).join("\n") : "(なし)"}`;

/** 渡すためのログ本文を作る */
export function buildDebugReport(): string {
  save();
  let prev: Saved | null = null;
  try { prev = JSON.parse(kvGet(PREV) || "null"); } catch { /* 読めなければ省く */ }
  const info = [
    `Fixit Editor v${__APP_VERSION__}`,
    `作成: ${when(Date.now())}  起動から ${Math.round((Date.now() - start) / 1000)} 秒`,
    `環境: ${IS_TAURI ? "デスクトップ" : "ブラウザ"} / ${navigator.platform} / ${navigator.language}`,
    `UA: ${navigator.userAgent}`,
    `画面: ${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
  ].join("\n");
  const extra = [...sections].map(([n, f]) => { try { return `## ${n}\n${f()}`; } catch (e) { return `## ${n}\n(取得できませんでした: ${text(e)})`; } });
  return scrubLog([
    "# Fixit Editor デバッグログ",
    "(ファイルの中身・AI の会話・パスワード類は入っていません。ユーザー名とフォルダ名は伏せてあります)\n",
    "## 基本情報", info, "", ...extra.flatMap((x) => [x, ""]),
    "## 設定", exportJson(), "",
    block("今回の起動", entries), "",
    prev ? block(`前回の起動(v${prev.ver}、${when(prev.start)} 開始)`, prev.entries) : "## 前回の起動\n(記録なし)",
  ].join("\n"));
}

export function downloadDebugLog(): void {
  const a = document.createElement("a");
  const n = new Date(), p = (x: number) => String(x).padStart(2, "0");
  a.href = URL.createObjectURL(new Blob([buildDebugReport()], { type: "text/plain;charset=utf-8" }));
  a.download = `fixit-debug-${__APP_VERSION__}-${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}.log`;
  a.click();
  URL.revokeObjectURL(a.href);
}
