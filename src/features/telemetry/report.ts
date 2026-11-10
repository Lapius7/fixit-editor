import { kvGet, kvSet } from "@/platform/appdata";
import i18next from "i18next";
import { ERROR_URL, FEEDBACK_URL, LINK_URL, USAGE_STORE_KEY, USAGE_URL } from "@/shared/config";
import { get } from "@/features/settings/settings";
import { getStats } from "@/features/stats/stats";
import { installId, osFamily } from "./telemetry";
import { authFetch, getAccount, getToken, subscribeAccount } from "@/features/account/auth";

const post = (url: string, body: unknown, token?: string | null) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body), keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" });

// ---- エラー報告(常に送る。設定項目はない) ----
// 送るのは種類・メッセージ・呼び出し順だけ。パスやユーザー名は、送る前に消す
function scrub(t: string): string {
  return t
    .replace(/file:\/\/\/?[^\s)]*\/([^\s/)]+)/g, "$1")
    .replace(/[A-Za-z]:\\(?:[^\\\s)]+\\)*([^\\\s):]+)/g, "$1")
    .replace(/(?:\/[\w.@~-]+){2,}\/([\w.@~-]+)/g, "$1")
    .replace(/https?:\/\/(?:tauri|[\w.-]+\.localhost)[^\s)]*\/([^\s/)?]+)/g, "$1");
}

const seen = new Set<string>();
function reportError(kind: string, message: string, stack = ""): void {
  if (!import.meta.env.PROD) return;
  const msg = scrub(message).slice(0, 400);
  if (!msg || seen.size >= 5 || seen.has(msg)) return;
  seen.add(msg);
  post(ERROR_URL, { v: 1, app: __APP_VERSION__, os: osFamily(), kind, message: msg, stack: scrub(stack).slice(0, 3000) }).catch(() => { /* 送れなくても動かす */ });
}

export function installErrorHooks(): void {
  addEventListener("error", (e) => reportError("window.error", e.message || "error", e.error?.stack ?? ""));
  addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    reportError("unhandledrejection", r instanceof Error ? r.message : String(r), r instanceof Error ? (r.stack ?? "") : "");
  });
}

// ---- 利用状況(常に送る。記録をやめている間は送らない) ----
// 昨日(確定)と今日(途中)の 2 日ぶんを、起動時とその後 6 時間ごとに送る。サーバー側は同じ日を上書きする。
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function sendUsage(): Promise<void> {
  if (!import.meta.env.PROD || !get().statsOn) return;
  const st = getStats(), now = new Date(), y = new Date(now.getTime() - 86400_000);
  const id = installId();
  // ログイン中は、アカウントに紐づけて送る(サイトのダッシュボードに出る)
  const token = getAccount() ? await getToken() : null;
  let sent: Record<string, string> = {};
  try { sent = JSON.parse(kvGet(USAGE_STORE_KEY) || "{}"); } catch { /* 読めなければ送り直す */ }
  for (const day of [dayKey(y), dayKey(now)]) {
    const d = st.days[day];
    if (!d || (!d.sec && !d.keys)) continue;
    const sig = `${d.sec}:${d.chars}:${d.keys}:${d.saves}`;
    if (sent[day] === sig) continue;
    try {
      const r = await post(USAGE_URL, { v: 1, id, day, sec: d.sec, chars: d.chars, keys: d.keys, saves: d.saves, langs: d.langs }, token);
      if (r.ok) sent[day] = sig;
    } catch { /* 次回また送る */ }
  }
  try { kvSet(USAGE_STORE_KEY, JSON.stringify(Object.fromEntries(Object.entries(sent).slice(-4)))); } catch { /* 残せない */ }
}
// ログインしたら、この端末でログイン前に送った利用状況をアカウントに紐づける(起動時にログイン済みでも 1 回)
let linked = "";
async function linkInstall(): Promise<void> {
  const uid = getAccount()?.id ?? "";
  if (!import.meta.env.PROD || !uid || uid === linked) return;
  try {
    const r = await authFetch(LINK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: installId() }) });
    if (r?.ok) linked = uid;
  } catch { /* 次のログイン・起動でやり直す */ }
}
export function startUsageReports(): void {
  sendUsage();
  setInterval(sendUsage, 6 * 3600_000);
  void linkInstall();
  subscribeAccount(() => { void linkInstall(); });
}

// ---- フィードバック(画面から送る。押したときだけ) ----
export type FeedbackKind = "bug" | "idea" | "other";
export async function sendFeedback(kind: FeedbackKind, message: string, contact: string): Promise<"ok" | "rate" | "fail"> {
  try {
    // ログイン中は、アカウントに紐づけて送る(返信を受け取れる)。トークンが取れなければ匿名で送る
    const token = await getToken();
    const r = await fetch(FEEDBACK_URL, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ app: __APP_VERSION__, os: osFamily(), lang: i18next.language, kind, message, contact }), keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" });
    return r.ok ? "ok" : r.status === 429 ? "rate" : "fail";
  } catch { return "fail"; }
}
