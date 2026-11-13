// GitHub Copilot の今月の残り枠(プレミアムリクエストなど)を、GitHub に問い合わせて使用量に入れる。
// 会話を送らなくても取れる。api.github.com は CORS を許すので、ブラウザ(exe の画面)から直接呼ぶ。
import { recordLimit } from "@/features/ai/usage";

type Snap = { entitlement?: number; remaining?: number; unlimited?: boolean };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// "2026-12-01" や ISO 日時を、unix 秒にする(読めなければ 0)
const secs = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? Math.floor(t / 1000) : 0; };

/** 取れたら true。ログインが切れた・通信できないときは何も書き換えず false */
export async function refreshCopilotUsage(oauth: string, signal?: AbortSignal): Promise<boolean> {
  if (!oauth) return false;
  try {
    const r = await fetch("https://api.github.com/copilot_internal/user", { headers: { Authorization: `token ${oauth}`, Accept: "application/json" }, signal });
    if (!r.ok) return false;
    const v = (await r.json()) as { quota_snapshots?: Record<string, Snap>; quota_reset_date?: string; limited_user_quotas?: Record<string, number>; monthly_quotas?: Record<string, number>; limited_user_reset_date?: string };
    let any = false;
    // 有料プラン: 項目ごとの契約枠と残り
    const reset = secs(v.quota_reset_date);
    for (const [id, name] of [["premium_interactions", "premium"], ["chat", "chat"]] as const) {
      const s = v.quota_snapshots?.[id], ent = num(s?.entitlement), rem = num(s?.remaining);
      if (!s || s.unlimited || ent === null || rem === null || ent <= 0) continue;
      recordLimit("copilot", name, (ent - rem) / ent, reset); any = true;
    }
    // 無料プラン: 月の枠と残り
    const lr = secs(v.limited_user_reset_date);
    for (const id of ["chat", "completions"]) {
      const ent = num(v.monthly_quotas?.[id]), rem = num(v.limited_user_quotas?.[id]);
      if (ent === null || rem === null || ent <= 0) continue;
      recordLimit("copilot", id === "chat" ? "chat" : "completions", (ent - rem) / ent, lr); any = true;
    }
    return any;
  } catch { return false; }
}
