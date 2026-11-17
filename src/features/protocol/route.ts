import { EXT_ID } from "@/features/extensions/spec";

// fixit:// の URL を、画面が開ける「行き先」に直す。他のアプリや Web ページから渡せる文字列なので、
// 許可リストにあるものだけを通し、それ以外は null(何も開かず、通知だけ出す)。ここで何かを実行・保存・読み込みはしない。
export const MAX_URL = 512; // Rust 側(fixit-core/src/proto.rs の MAX_URL)と同じ

/** 引数なしで開ける画面。キー=URL の 1 つ目の部分 */
export const PAGES = ["theme", "stats", "github", "feedback", "workspaces", "update", "ai"] as const;
export type Page = (typeof PAGES)[number];

export type FixitRoute =
  | { k: "settings"; cat: string | null }
  | { k: "extensions"; id: string | null }
  | { k: "page"; page: Page };

const SEG = /^[a-z0-9._-]{1,64}$/;

/** cats: 設定の分類 id の一覧(settings/settings.ts の CATS) */
export function parseFixitUrl(url: string, cats: readonly string[]): FixitRoute | null {
  if (typeof url !== "string" || url.length > MAX_URL) return null;
  const m = /^fixit:(?:\/\/)?([^?#]*)(?:[?#].*)?$/i.exec(url);
  if (!m) return null;
  const segs = m[1].split("/").filter(Boolean);
  if (!segs.length || segs.length > 2) return null;
  const dec: string[] = [];
  for (const s of segs) {
    let d: string;
    try { d = decodeURIComponent(s).toLowerCase(); } catch { return null; }
    if (!SEG.test(d)) return null;
    dec.push(d);
  }
  const [head, arg] = dec;
  if (head === "settings") {
    if (arg === undefined) return { k: "settings", cat: null };
    return cats.includes(arg) ? { k: "settings", cat: arg } : null;
  }
  if (head === "extensions") {
    if (arg === undefined) return { k: "extensions", id: null };
    return EXT_ID.test(arg) ? { k: "extensions", id: arg } : null;
  }
  if (arg === undefined && (PAGES as readonly string[]).includes(head)) return { k: "page", page: head as Page };
  return null;
}
