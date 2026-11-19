// Emmet の詳細設定(JSON)。設定画面の「Emmet の詳細設定」に書いた JSON を、プラグインの設定に直す。
// 上の階層: attributeQuotes / markupStyle / comments / commentsTemplate / bem / shortHex は、そのままプラグインの設定。
// markup / stylesheet / html / css / jsx などの階層: { snippets, variables, options } で、Emmet 本体の設定(スニペットの追加・上書きなど)。
export const EMMET_JSON_MAX = 20000;

export const EMMET_TEMPLATE = `{
  "attributeQuotes": "double",
  "markupStyle": "html",
  "comments": false,
  "bem": false,
  "shortHex": true,
  "markup": {
    "variables": { "lang": "ja", "locale": "ja-JP", "charset": "UTF-8" },
    "snippets": {
      "!": "!!!+doc",
      "mybtn": "button.btn[type=button]{\${1:ボタン}}"
    },
    "options": { "output.tagCase": "lower" }
  },
  "stylesheet": {
    "snippets": { "ctr": "justify-content:center" }
  }
}`;

const STR = new Set(["attributeQuotes", "markupStyle", "commentsTemplate"]);
const BOOL = new Set(["comments", "bem", "shortHex"]);
const ENUM: Record<string, string[]> = { attributeQuotes: ["single", "double"], markupStyle: ["html", "xhtml", "xml"] };
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type EmmetParsed = { ok: true; opt: Record<string, unknown> } | { ok: false; error: string };

// 空は「初期設定」。書き間違いは、どこが悪いかを返す(適用はしない)
export function parseEmmetJson(text: string): EmmetParsed {
  const t = text.trim();
  if (!t) return { ok: true, opt: {} };
  let j: unknown;
  try { j = JSON.parse(t); } catch (e) { return { ok: false, error: String((e as Error).message).slice(0, 160) }; }
  if (!isObj(j)) return { ok: false, error: "{ } で囲んだオブジェクトにしてください" };
  const opt: Record<string, unknown> = {}, config: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(j)) {
    if (STR.has(k)) {
      if (typeof v !== "string" || (ENUM[k] && !ENUM[k].includes(v))) return { ok: false, error: `"${k}" は ${ENUM[k] ? ENUM[k].map((x) => `"${x}"`).join(" / ") : "文字列"} にしてください` };
      opt[k] = v;
    } else if (BOOL.has(k)) {
      if (typeof v !== "boolean") return { ok: false, error: `"${k}" は true / false にしてください` };
      opt[k] = v;
    } else if (isObj(v)) {
      for (const [g, gv] of Object.entries(v)) {
        if (!["snippets", "variables", "options"].includes(g)) return { ok: false, error: `"${k}.${g}" は使えません(snippets / variables / options のどれか)` };
        if (!isObj(gv)) return { ok: false, error: `"${k}.${g}" は { } にしてください` };
        if (g !== "options" && Object.values(gv).some((x) => typeof x !== "string")) return { ok: false, error: `"${k}.${g}" の値は文字列にしてください` };
      }
      config[k] = v;
    } else return { ok: false, error: `"${k}" は使えません` };
  }
  if (Object.keys(config).length) opt.config = config;
  return { ok: true, opt };
}
