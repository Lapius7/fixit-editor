// AI へ1回だけ問い合わせる(チャットの画面を通さない)。コミットメッセージの作成などに使う。
// 送り先・モデル・キーは AI の設定(store)のものを使う
import type { AiErrorKind } from "@/features/ai/providers";
import { AiError, streamChat } from "@/features/ai/providers";
import { getAi, hasEffort, ready, setConsent, PROVIDER_NAME, type Effort } from "@/features/ai/store";

// エラーの種類ごとの文言(画面で i18next.t に通す)
export const AI_ERR: Record<AiErrorKind, string> = {
  auth: "API キーが正しくありません。設定で確かめてください",
  denied: "このキーでは使えません(権限や地域の制限など)",
  rate: "リクエストが多すぎるか、利用枠を超えています。しばらくしてからもう一度試してください",
  network: "接続できませんでした。ネットワークを確かめてください",
  model: "モデルが見つかりません。設定のモデル名を確かめてください",
  bad: "リクエストが受け付けられませんでした。モデル名や入力の長さを確かめてください",
  nocli: "claude コマンドが見つかりません(または、この環境では使えません)。Claude Code を入れてログインしてください",
  login: "claude にログインしていません。設定の「AI」で、ログインしてください",
  relogin: "GitHub Copilot のログインが切れました。設定の「AI」で、もう一度ログインしてください",
  nosub: "この GitHub アカウントでは Copilot を使えません。Copilot の契約(無料プランを含む)があるか確かめてください",
  nobase: "OpenAI 互換の接続先が未設定です。設定の「AI」で、接続先の URL を入れてください",
  other: "AI の応答でエラーが起きました",
};

/** 使える状態か(プロバイダーがオンで、キーかログインがある) */
export const aiReady = () => ready(getAi());
/** 送り先に送ってよいと同意済みか */
export const aiConsented = () => { const c = getAi(); return c.consent[c.provider]; };
export const aiConsent = () => setConsent(getAi().provider, true);
export const aiProviderName = () => PROVIDER_NAME[getAi().provider];

/** 1回の問い合わせ。本文は onText で少しずつ届く。effort を省くと、設定の値を使う */
export async function askOnce(o: { system: string; prompt: string; signal: AbortSignal; onText: (s: string) => void; effort?: Effort }) {
  const c = getAi(), p = c.provider;
  if (!ready(c)) throw new AiError("other");
  return streamChat({ provider: p, model: c.models[p], effort: hasEffort(p) ? (o.effort ?? c.effort) : "", key: c.keys[p], system: o.system, messages: [{ role: "user", content: o.prompt }], signal: o.signal, onText: o.onText });
}
export const aiErrText = (e: unknown) => AI_ERR[e instanceof AiError ? e.kind : "other" as AiErrorKind];
