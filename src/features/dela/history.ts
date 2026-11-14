// 公開したポートの履歴。URL だけでは、どのポートで公開していたかが分からないので、フォルダと名前ごとに最後のポートを覚えておく。
// 一時(--temp)の公開は URL が使い捨てなので残さない。
import { kvGet, kvSet } from "@/platform/appdata";

const KEY = "fixit:dela:hist:v1";
const MAX = 60;
export type Hist = Record<string, { port: string; at: number }>;

// フォルダ(接続を含む)と名前で 1 件。名前なし(app-)は空文字
// "app" は名前なしと同じ URL(app-)になるので、同じものとして扱う
export const histKey = (scope: string, dir: string, name = "") => `${scope}\u0000${dir}\u0000${name === "app" ? "" : name}`;

export function loadHist(): Hist {
  try {
    const j = JSON.parse(kvGet(KEY) ?? "{}") as unknown;
    if (!j || typeof j !== "object" || Array.isArray(j)) return {};
    const out: Hist = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      const e = v as { port?: unknown; at?: unknown } | null;
      if (typeof e?.port !== "string" || !/^\d{1,5}$/.test(e.port)) continue;
      const key = k.replace(/\u0000app$/, "\u0000"); // 以前に「app」と打って残った履歴は、名前なしにまとめる
      const at = typeof e.at === "number" ? e.at : 0;
      if (!out[key] || out[key].at < at) out[key] = { port: e.port, at };
    }
    return out;
  } catch { return {}; }
}

export function rememberPublish(scope: string, dir: string, name: string | undefined, port: string): void {
  const h = loadHist();
  h[histKey(scope, dir, name ?? "")] = { port: String(+port), at: Date.now() };
  const keep = Object.entries(h).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
  kvSet(KEY, JSON.stringify(Object.fromEntries(keep)));
}

// プロジェクトの URL(<名前>-<id>)から、同じ id で別の名前のサービスの URL を作る(--name の URL は名前だけが変わる)
export const urlWithName = (u: string, name: string): string | undefined =>
  /^https:\/\/[a-z0-9-]*?-[a-z0-9]{10}\.try\./i.test(u) && /^[a-z0-9-]{1,20}$/.test(name) ? u.replace(/^https:\/\/[a-z0-9-]*?(-[a-z0-9]{10}\.try\.)/i, `https://${name}$1`) : undefined;
// URL の <名前>-<id> から名前を取る。既定の公開(app-)は名前なし
export function nameOfUrl(u: string): string {
  const m = /^https:\/\/([a-z0-9-]*?)-[a-z0-9]{10}\.try\./i.exec(u);
  const n = m?.[1]?.toLowerCase() ?? "";
  return n === "app" ? "" : n;
}
