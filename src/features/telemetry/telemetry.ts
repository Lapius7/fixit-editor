import { kvGet, kvSet } from "@/platform/appdata";
import i18next from "i18next";
import { TELEMETRY_STORE_KEY, TELEMETRY_URL } from "@/shared/config";

// 送る内容は、この 5 項目だけ。ファイルの中身・名前・パス・API キー・IP 以外の端末情報は含めない。
//   v   形式の版
//   id  この PC でランダムに作った UUID(端末の固有情報からは作らない。設定を消すと変わる)
//   app アプリの版
//   os  windows / mac / linux / other
//   lang 画面の言語
type Saved = { id: string; day: string };

export const osFamily = (): "windows" | "mac" | "linux" | "other" => {
  const u = navigator.userAgent;
  return /Windows/i.test(u) ? "windows" : /Mac/i.test(u) ? "mac" : /Linux|X11/i.test(u) ? "linux" : "other";
};

const read = (): Saved | null => {
  try { const v = JSON.parse(kvGet(TELEMETRY_STORE_KEY) || "null"); return v && typeof v.id === "string" ? v : null; } catch { return null; }
};

// 1 日 1 回だけ送る。開発中(pnpm dev)は送らない。常にオンで、設定では切り替えられない。失敗しても何も出さず、次の日にまた試す。
export function sendPing(): void {
  if (!import.meta.env.PROD) return;
  const day = new Date().toISOString().slice(0, 10);
  const saved = read();
  if (saved?.day === day) return;
  const id = saved?.id ?? crypto.randomUUID();
  const body = JSON.stringify({ v: 1, id, app: __APP_VERSION__, os: osFamily(), lang: i18next.language });
  fetch(TELEMETRY_URL, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "omit", referrerPolicy: "no-referrer" })
    .then((r) => { if (r.ok) try { kvSet(TELEMETRY_STORE_KEY, JSON.stringify({ id, day })); } catch { /* 保存できなければ次回また送る */ } })
    .catch(() => { /* 送れなくても動かす */ });
}

// この PC の匿名 ID。ping と詳細な利用状況で同じものを使う。無ければ作って残す(端末の固有情報からは作らない)
export function installId(): string {
  const saved = read();
  if (saved) return saved.id;
  const id = crypto.randomUUID();
  try { kvSet(TELEMETRY_STORE_KEY, JSON.stringify({ id, day: "" })); } catch { /* 残せなければ今回かぎり */ }
  return id;
}
