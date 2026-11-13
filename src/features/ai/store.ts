import { kvGet, kvSet, kvWatch } from "@/platform/appdata";
// AI の接続設定(プロバイダー・モデル・API キー・送信の同意)。
// 設定本体(settings.ts)とは別のキーに置く。設定の書き出し・変更履歴・統計には載らない。
import { useSyncExternalStore } from "react";
import { AI_DEFAULT_MODEL, AI_MODEL_HINTS, AI_STORE_KEY } from "@/shared/config";

// "claude-cli" は、この PC の claude コマンド(Claude のサブスクリプションのログイン)を使う方式。API キーは持たない
// "copilot" は GitHub Copilot。keys に入るのは、デバイスログインで得た GitHub のトークン(API キーと同じ扱い)
// "gemini" は Google Gemini(OpenAI 互換の窓口)。"custom" は、自分で決めた OpenAI 互換の接続先(Ollama・LM Studio・OpenRouter など)。接続先は Cfg.base に持つ
export type Provider = "anthropic" | "openai" | "claude-cli" | "copilot" | "gemini" | "custom";
export const PROVIDERS: Provider[] = ["claude-cli", "copilot", "anthropic", "openai", "gemini", "custom"];
export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", "claude-cli": "Claude (サブスク)", copilot: "GitHub Copilot", gemini: "Google Gemini", custom: "OpenAI 互換の接続先" };
// モデル名の後ろに括弧で添える短い名前(例: opus (Claude サブスク))
export const PROVIDER_SHORT: Record<Provider, string> = { anthropic: "Anthropic API", openai: "OpenAI API", "claude-cli": "Claude サブスク", copilot: "GitHub Copilot", gemini: "Gemini API", custom: "OpenAI 互換" };

// 考える量。"" は、モデルの既定に任せる。openai には渡さない
export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["", "low", "medium", "high", "xhigh", "max"];
export const hasEffort = (p: Provider) => p === "anthropic" || p === "claude-cli";

// claude コマンドの場所。"auto" は Windows を先に探し、なければ WSL。アカウントを分けているときに固定する
// AI のファイル操作の承認。ask=すべて確認 / auto=作成・編集は自動、移動・削除は確認 / full=すべて自動
export type AgentMode = "ask" | "auto" | "full";
export const AGENT_MODES: AgentMode[] = ["ask", "auto", "full"];
export const MODE_NAME = { ask: "確認", auto: "自動", full: "完全自動" } as const;
export const MODE_HINT = { ask: "AI の操作は、すべて許可を待ちます", auto: "ファイルの作成と編集は自動で行い、移動・削除・コマンドの実行は許可を待ちます", full: "移動・削除・コマンドの実行も含め、許可を待たずに行います" } as const;
export type Where = "auto" | "windows" | "wsl";
export const WHERES: Where[] = ["auto", "windows", "wsl"];
type Cfg = { provider: Provider; models: Record<Provider, string>; keys: Record<Provider, string>; consent: Record<Provider, boolean>; enabled: Record<Provider, boolean>; effort: Effort; where: Where; base: string; mode: AgentMode };

// OpenAI 互換の接続先の整え方。https か、この PC 内(localhost・127.0.0.1・[::1])の http だけを受ける。末尾の / と /chat/completions は外す。使えなければ ""
export const cleanBase = (v: string): string => {
  try {
    const u = new URL(v.trim());
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return "";
    if (u.username || u.password || u.search || u.hash) return "";
    return (u.origin + u.pathname).replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  } catch { return ""; }
};

const blank = (): Cfg => ({
  provider: "anthropic",
  models: { ...AI_DEFAULT_MODEL },
  keys: { anthropic: "", openai: "", "claude-cli": "", copilot: "", gemini: "", custom: "" },
  consent: { anthropic: false, openai: false, "claude-cli": false, copilot: false, gemini: false, custom: false },
  enabled: { anthropic: false, openai: false, "claude-cli": false, copilot: false, gemini: false, custom: false }, // 初期はすべてオフ。設定の「AI」で、使うものだけオンにする
  effort: "",
  where: "auto",
  base: "",
  mode: "ask", // AI のファイル操作をどこまで確認なしで行うか(初期はすべて確認)
});

const load = (): Cfg => {
  const d = blank();
  try {
    const r = JSON.parse(kvGet(AI_STORE_KEY) ?? "null");
    if (!r || typeof r !== "object") return d;
    if (PROVIDERS.includes(r.provider)) d.provider = r.provider;
    if (EFFORTS.includes(r.effort)) d.effort = r.effort;
    if (WHERES.includes(r.where)) d.where = r.where;
    // 以前の「自動で適用」は、作成・編集だけ自動の「auto」に引き継ぐ
    d.mode = AGENT_MODES.includes(r.mode) ? r.mode : r.autoApply === true ? "auto" : "ask";
    if (typeof r.base === "string" && cleanBase(r.base)) d.base = cleanBase(r.base);
    for (const p of PROVIDERS) {
      if (typeof r.models?.[p] === "string" && r.models[p].trim()) d.models[p] = r.models[p].trim();
      if (typeof r.keys?.[p] === "string") d.keys[p] = r.keys[p];
      d.consent[p] = r.consent?.[p] === true;
      // オンオフの保存がない古い設定は、すでに使っていたもの(キーを入れた・同意した)だけオンにして引き継ぐ
      d.enabled[p] = typeof r.enabled?.[p] === "boolean" ? r.enabled[p] : d.keys[p].length > 0 || d.consent[p] || (p === "custom" && d.base.length > 0);
    }
  } catch { /* 壊れた値は初期値に戻す */ }
  return d;
};

let cfg = load();
const subs = new Set<() => void>();
const commit = (next: Cfg) => {
  cfg = next;
  try { kvSet(AI_STORE_KEY, JSON.stringify(cfg)); } catch { /* 保存できなくてもメモリ上では動く */ }
  subs.forEach((f) => f());
};

export const getAi = () => cfg;
export const useAi = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => cfg);

// 接続先を変えたら同意は取り消す(別の相手に送ることになるため)
export const setBase = (v: string) => commit({ ...cfg, base: cleanBase(v), consent: { ...cfg.consent, custom: false } });
export const setProvider = (provider: Provider) => commit({ ...cfg, provider });
// キーを変えたら、同意はいったん取り消す(別のアカウントや別の相手に送ることになるため)
export const setKey = (p: Provider, v: string) => commit({ ...cfg, keys: { ...cfg.keys, [p]: v.trim() }, consent: { ...cfg.consent, [p]: false } });
// オンにしたとき、使う相手がまだオフのものなら、これに切り替える。オフにしたとき、使う相手がこれなら、オンのほかのものへ移す
export const setEnabled = (p: Provider, on: boolean) => {
  const enabled = { ...cfg.enabled, [p]: on };
  let provider = cfg.provider;
  if (on && !enabled[provider]) provider = p;
  if (!on && provider === p) provider = PROVIDERS.find((x) => enabled[x]) ?? p;
  commit({ ...cfg, enabled, provider });
};
export const setConsent = (p: Provider, v: boolean) => commit({ ...cfg, consent: { ...cfg.consent, [p]: v } });
// 場所を変えたら接続の確認が古くなる。呼び出し側(AiSettings)で確かめ直す
export const setWhere = (where: Where) => commit({ ...cfg, where });
export const setMode = (mode: AgentMode) => commit({ ...cfg, mode });
export const setEffort = (effort: Effort) => commit({ ...cfg, effort });
export const setModel = (p: Provider, m: string) => commit({ ...cfg, models: { ...cfg.models, [p]: m.trim() || AI_DEFAULT_MODEL[p] } });
// 送り先とモデルを一度に切り替える(別のプロバイダーのモデルも選べる)
export const setActive = (provider: Provider, model: string) => commit({ ...cfg, provider, models: { ...cfg.models, [provider]: model.trim() || AI_DEFAULT_MODEL[provider] } });

// claude コマンドの接続状態。保存しない(起動のたびに確かめる)。"unknown" は未確認か確認できなかった状態で、送信は止めない
export type Link = "unknown" | "checking" | "ready" | "login" | "nocli";
let link: Link = "unknown";
const lsubs = new Set<() => void>();
export const getLink = () => link;
export const setLink = (v: Link) => { if (v === link) return; link = v; lsubs.forEach((f) => f()); };
export const useLink = () => useSyncExternalStore((f) => (lsubs.add(f), () => lsubs.delete(f)), () => link);

// 接続の材料がそろっているか(キー方式はキーがある。自分で決める接続先は、接続先とモデル名がある。キーは任意: Ollama などは要らない)
const usable = (c: Cfg, p: Provider) => (p === "custom" ? c.base.length > 0 && c.models.custom.length > 0 : c.keys[p].length > 0);
// 送れる状態か。claude コマンド方式は API キーが要らず、未ログインか claude がないと分かっているときだけ止める
export const ready = (c: Cfg = cfg, l: Link = link) => c.enabled[c.provider] && (c.provider === "claude-cli" ? l !== "login" && l !== "nocli" : usable(c, c.provider));
// 使えるプロバイダー(モデル選択の一覧に出す)。API キーがあるものと、ログイン済みの claude
export const connected = (c: Cfg = cfg, l: Link = link): Provider[] => PROVIDERS.filter((p) => c.enabled[p] && (p === "claude-cli" ? l === "ready" || (l === "unknown" && c.provider === p) : usable(c, p)));
// 一覧に出すモデル。候補に、いま選んでいるモデルを足す(自分で入力した名前も選べるように)
export const modelsOf = (c: Cfg, p: Provider): string[] => {
  const cur = c.models[p];
  const l: string[] = [...AI_MODEL_HINTS[p]];
  if (cur && !l.includes(cur)) l.unshift(cur);
  return p === "claude-cli" && !l.includes("") ? ["", ...l] : l;
};
export const tail = (k: string) => (k.length > 8 ? "…" + k.slice(-4) : "");

// 他のウィンドウが接続設定を変えたら取り込む(こちらに保存前の変更があるときは、こちらを優先する)
kvWatch(AI_STORE_KEY, (_f, dirty) => { if (dirty) return; cfg = load(); subs.forEach((f) => f()); });
