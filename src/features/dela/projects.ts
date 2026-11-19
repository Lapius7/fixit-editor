// dela(CLI)を、名前ごとの設定ファイル(--config)で調べる・作り直す。
// 設定ファイルには秘密のトークンが入るので、中身はここでは読まない。URL は `dela info --json` の出力から取る。
import { execCmd } from "@/platform/remote";
import type { Conn } from "@/platform/remote";
import { DEFAULT_NAME, cfgFlag, parseVersion, stripAnsi } from "./dela";
import { urlWithName } from "./slots";

// 非ログインのシェルは、pnpm の bin も node(mise・volta・nvm などで入れたもの)も PATH に無いことが多い。
// dela は node で動くので、よくある置き場所を足してから呼ぶ(対話型のシェルは重く、返ってこないことがあるので使わない)
const PATHS = [
  'P="${PNPM_HOME:-$HOME/.local/share/pnpm}:${PNPM_HOME:-$HOME/.local/share/pnpm}/bin:$HOME/.local/share/pnpm/bin:$HOME/.bun/bin:$HOME/.volta/bin:$HOME/.local/share/mise/shims:$HOME/.local/share/fnm/aliases/default/bin:/usr/local/bin"',
  'for d in "$HOME"/.local/share/mise/installs/node/*/bin "$HOME"/.nvm/versions/node/*/bin "$HOME"/.local/share/fnm/node-versions/*/installation/bin; do [ -d "$d" ] && P="$P:$d"; done',
  'export PATH="$P:$PATH"; ',
].join("; ");
const viaShell = (sub: string) => `${PATHS}dela ${sub} 2>&1 </dev/null`;

const URL_ALL = /https:\/\/[a-z0-9][a-z0-9-]*\.try\.lapius7\.si\b[^\s"'<>]*/gi;
export const findUrls = (text: string): string[] => [...new Set((stripAnsi(text).match(URL_ALL) ?? []).map((u) => u.replace(/[.,;:)\]]+$/, "")))];

const tail = (s: string) => stripAnsi(s).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 160);

// dela 0.5 以降の `info --json` / `list --json` の出力から URL を取る(token は出力に含まれない)。古い dela や JSON でない出力は null
const parseJson = (text: string): unknown => { try { return JSON.parse(stripAnsi(text).trim()); } catch { return null; } };
const urlOf = (x: unknown): string[] => { const u = (x as { url?: unknown } | null)?.url; return typeof u === "string" && /^https:\/\//.test(u) ? [u] : []; };
export function urlsFromInfoJson(text: string): string[] | null {
  const j = parseJson(text) as { found?: unknown; running?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.found !== "boolean") return null;
  const run = Array.isArray(j.running) ? j.running.flatMap(urlOf) : [];
  return [...new Set([...urlOf(j), ...run])];
}
export function urlsFromListJson(text: string): string[] | null {
  const j = parseJson(text);
  return Array.isArray(j) ? [...new Set(j.flatMap(urlOf))] : null;
}

export type Info = { ok: boolean; urls: string[]; note: string };
export type SlotInfo = { ok: boolean; found: boolean; url?: string; note: string };

// 名前ごとの URL(まだ公開していなければ found: false)。dela info --json の url は app の形なので、名前に合わせて直す
export async function delaSlotInfo(conn: Conn, dir: string, name: string): Promise<SlotInfo> {
  try {
    const r = await execCmd(conn, dir, viaShell(`info --json ${cfgFlag(name)}`), 30);
    const j = parseJson(r.out) as { found?: unknown; url?: unknown } | null;
    if (!j || typeof j !== "object" || typeof j.found !== "boolean") return { ok: false, found: false, note: tail(r.out) }; // 古い dela など
    if (!j.found) return { ok: true, found: false, note: "" };
    const u = typeof j.url === "string" ? j.url : "";
    return { ok: true, found: true, url: name === DEFAULT_NAME ? u : urlWithName(u, name) ?? u, note: "" };
  } catch (e) { return { ok: false, found: false, note: String((e as Error)?.message ?? e).slice(0, 160) }; }
}

// この名前のサブドメインを作り直す(古い URL は無効になる)。呼び出し側で確認してから呼ぶ
export async function delaSlotRenew(conn: Conn, dir: string, name: string): Promise<boolean> {
  try { return (await execCmd(conn, dir, viaShell(`renew ${cfgFlag(name)}`), 60)).code === 0; } catch { return false; }
}

// 入っている dela の版(入っていない・読めないときは null)
export async function delaVersion(conn: Conn, dir: string): Promise<string | null> {
  try { const r = await execCmd(conn, dir, viaShell("version"), 20); return r.code === 0 ? parseVersion(r.out) : null; } catch { return null; }
}

// 起動中のトンネルの URL(dela list。この PC・接続先で動いている全部が出る。別のターミナルのものも拾う)
export async function delaRunning(conn: Conn, dir: string): Promise<string[]> {
  try {
    const r = await execCmd(conn, dir, viaShell("list --json"), 20);
    return urlsFromListJson(r.out) ?? findUrls(r.out);
  } catch { return []; }
}
