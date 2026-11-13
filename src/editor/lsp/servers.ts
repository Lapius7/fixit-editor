import i18next from "i18next";
import type { Settings } from "@/features/settings/settings";
import type { Phase } from "@/editor/lsp/session";
import registry from "./servers.json";

// 言語サーバーの一覧。中身は servers.json で、開発サーバー(server/lsp.ts)とデスクトップ版(fixit-core の lsp.rs)も同じファイルを読む。
// 言語を足すときは servers.json に 1 件足し、設定(カテゴリ「言語サーバー」)に入り切りの項目(on のキー)を作る
export type LspOnKey = "tsServer" | "pyServer" | "htmlServer" | "cssServer" | "phpServer" | "goServer" | "rsServer" | "rbServer" | "sqlServer";
export type LspServer = {
  id: string;
  // 下のバーに出す短い名前
  short: string;
  name: string;
  // 入り切りの設定キー
  on: LspOnKey;
  // 拡張子 → LSP の languageId
  exts: Record<string, string>;
};

export const LSP_SERVERS: LspServer[] = registry as unknown as LspServer[];

const EXT = new Map<string, { server: LspServer; lang: string }>();
for (const s of LSP_SERVERS) for (const [e, lang] of Object.entries(s.exts)) EXT.set(e, { server: s, lang });

const extOf = (name: string) => {
  const base = name.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i < 0 ? "" : base.slice(i + 1).toLowerCase();
};
// ファイル名から、担当するサーバーと languageId を引く(担当がなければ null)
export const serverOfFile = (name: string) => EXT.get(extOf(name)) ?? null;
export const serverById = (id: string) => LSP_SERVERS.find((s) => s.id === id) ?? null;
// 設定でオンになっているサーバーの id
export const lspOnIds = (s: Pick<Settings, LspOnKey>) => LSP_SERVERS.filter((x) => s[x.on]).map((x) => x.id);

export const lspOptsOf = (s: Pick<Settings, LspOnKey | "tsLspWsl" | "tsLspPc" | "lspIdleMin">) => ({
  on: Object.fromEntries(LSP_SERVERS.map((x) => [x.id, !!s[x.on]])) as Record<string, boolean>,
  wsl: s.tsLspWsl, pc: s.tsLspPc, idleMin: s.lspIdleMin,
});

export const phaseText = (p: Phase) => p === "off" ? i18next.t("オフ") : p === "prepare" ? i18next.t("準備中") : p === "download" ? i18next.t("取得中") : p === "install" ? i18next.t("展開中") : p === "starting" ? i18next.t("起動中") : p === "ready" ? i18next.t("使用中") : p === "busy" ? i18next.t("解析中") : i18next.t("エラー");
