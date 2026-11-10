import { kvGet, kvSet, kvWatch } from "@/platform/appdata";
// AI の接続設定(プロバイダー・モデル・API キー・送信の同意)。
// 設定本体(settings.ts)とは別のキーに置く。設定の書き出し・変更履歴・統計には載らない。
import { useSyncExternalStore } from "react";
import { AI_DEFAULT_MODEL, AI_MODEL_HINTS, AI_STORE_KEY } from "@/shared/config";

// "claude-cli" は、この PC の claude コマンド(Claude のサブスクリプションのログイン)を使う方式。API キーは持たない
export type Provider = "anthropic" | "openai" | "claude-cli";
export const PROVIDERS: Provider[] = ["claude-cli", "anthropic", "openai"];
export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI", "claude-cli": "Claude (サブスク)" };

// 考える量。"" は、モデルの既定に任せる。openai には渡さない
export type Effort = "" | "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["", "low", "medium", "high", "xhigh", "max"];
export const hasEffort = (p: Provider) => p !== "openai";

type Cfg = { provider: Provider; models: Record<Provider, string>; keys: Record<Provider, string>; consent: Record<Provider, boolean>; enabled: Record<Provider, boolean>; effort: Effort };

const blank = (): Cfg => ({
  provider: "anthropic",
  models: { ...AI_DEFAULT_MODEL },
  keys: { anthropic: "", openai: "", "claude-cli": "" },
  consent: { anthropic: false, openai: false, "claude-cli": false },
  enabled: { anthropic: false, openai: false, "claude-cli": false }, // 初期はすべてオフ。設定の「AI」で、使うものだけオンにする
  effort: "",
});

const load = (): Cfg => {
  const d = blank();
  try {
    const r = JSON.parse(kvGet(AI_STORE_KEY) ?? "null");
    if (!r || typeof r !== "object") return d;
    if (PROVIDERS.includes(r.provider)) d.provider = r.provider;
    if (EFFORTS.includes(r.effort)) d.effort = r.effort;
    for (const p of PROVIDERS) {
      if (typeof r.models?.[p] === "string" && r.models[p].trim()) d.models[p] = r.models[p].trim();
      if (typeof r.keys?.[p] === "string") d.keys[p] = r.keys[p];
      d.consent[p] = r.consent?.[p] === true;
      // オンオフの保存がない古い設定は、すでに使っていたもの(キーを入れた・同意した)だけオンにして引き継ぐ
      d.enabled[p] = typeof r.enabled?.[p] === "boolean" ? r.enabled[p] : d.keys[p].length > 0 || d.consent[p];
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

export const setProvider = (provider: Provider) => commit({ ...cfg, provider });
export const setModel = (p: Provider, v: string) => commit({ ...cfg, models: { ...cfg.models, [p]: v.trim() || AI_DEFAULT_MODEL[p] } });
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
export const setEffort = (effort: Effort) => commit({ ...cfg, effort });
// 送り先とモデルを一度に切り替える(別のプロバイダーのモデルも選べる)
export const setActive = (provider: Provider, model: string) => commit({ ...cfg, provider, models: { ...cfg.models, [provider]: model.trim() || AI_DEFAULT_MODEL[provider] } });

// claude コマンドの接続状態。保存しない(起動のたびに確かめる)。"unknown" は未確認か確認できなかった状態で、送信は止めない
export type Link = "unknown" | "checking" | "ready" | "login" | "nocli";
let link: Link = "unknown";
const lsubs = new Set<() => void>();
export const getLink = () => link;
export const setLink = (v: Link) => { if (v === link) return; link = v; lsubs.forEach((f) => f()); };
export const useLink = () => useSyncExternalStore((f) => (lsubs.add(f), () => lsubs.delete(f)), () => link);

// 送れる状態か。claude コマンド方式は API キーが要らず、未ログインか claude がないと分かっているときだけ止める
export const ready = (c: Cfg = cfg, l: Link = link) => c.enabled[c.provider] && (c.provider === "claude-cli" ? l !== "login" && l !== "nocli" : c.keys[c.provider].length > 0);
// 使えるプロバイダー(モデル選択の一覧に出す)。API キーがあるものと、ログイン済みの claude
export const connected = (c: Cfg = cfg, l: Link = link): Provider[] => PROVIDERS.filter((p) => c.enabled[p] && (p === "claude-cli" ? l === "ready" || (l === "unknown" && c.provider === p) : c.keys[p].length > 0));
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
