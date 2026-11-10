import { useSyncExternalStore } from "react";
import { kvDel, kvGet, kvSet, kvWatch } from "@/platform/appdata";
import { IS_TAURI } from "@/shared/chrome";
import { LAPOUNT_ANON_KEY, LAPOUNT_CLIENT_ID, LAPOUNT_URL } from "@/shared/config";

// Lapount アカウントでのログイン(デバイスコード方式)。
// セッションは、この PC の中だけに残す(設定の書き出し・同期には載せない)。
export type Account = { id: string; email: string; name: string; handle: string; avatar: string };
type Session = { access: string; refresh: string; exp: number; user: Account };

const KEY = "fixit:account:v1";
const SKEW_MS = 60_000; // 期限の少し前に更新する
const anonHeaders = { apikey: LAPOUNT_ANON_KEY, Authorization: `Bearer ${LAPOUNT_ANON_KEY}`, "Content-Type": "application/json" };

const read = (raw: string | null): Session | null => {
  try {
    const r = JSON.parse(raw || "null");
    if (r && typeof r.access === "string" && typeof r.refresh === "string" && r.user?.id) return r as Session;
  } catch { /* 読めなければ未ログイン */ }
  return null;
};
let sess: Session | null = read(kvGet(KEY));
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const store = (s: Session | null) => {
  sess = s;
  if (s) kvSet(KEY, JSON.stringify(s)); else kvDel(KEY);
  emit();
};

// 他のウィンドウがログイン・更新・ログアウトしたら取り込む
kvWatch(KEY, (raw) => { sess = read(raw); emit(); });

export const getAccount = (): Account | null => (sess ? sess.user : null);
export const subscribeAccount = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const useAccount = (): Account | null => useSyncExternalStore(subscribeAccount, getAccount);

// JWT の exp(ms)。読めなければ 50 分後
const jwtExp = (jwt: string): number => {
  try {
    const p = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof p.exp === "number") return p.exp * 1000;
  } catch { /* 読めない */ }
  return Date.now() + 50 * 60_000;
};

type Meta = Record<string, unknown> | undefined;
const str = (v: unknown) => (typeof v === "string" ? v : "");

// 名前・アイコンは user_profiles が正。空のときだけ user_metadata を使う
async function fetchAccount(access: string, prev?: Account): Promise<Account> {
  const h = { apikey: LAPOUNT_ANON_KEY, Authorization: `Bearer ${access}` };
  const ur = await fetch(`${LAPOUNT_URL}/auth/v1/user`, { headers: h });
  if (!ur.ok) throw Object.assign(new Error(`user ${ur.status}`), { status: ur.status });
  const u = (await ur.json()) as { id: string; email?: string; user_metadata?: Meta };
  let name = "", handle = "", avatar = "";
  try {
    const pr = await fetch(`${LAPOUNT_URL}/rest/v1/user_profiles?select=display_name,handle,avatar_url&user_id=eq.${encodeURIComponent(u.id)}`, { headers: h });
    if (pr.ok) {
      const row = ((await pr.json()) as { display_name?: string; handle?: string; avatar_url?: string }[])[0];
      name = str(row?.display_name); handle = str(row?.handle); avatar = str(row?.avatar_url);
    }
  } catch { /* 取れなければ下で補う */ }
  const m = u.user_metadata;
  return {
    id: u.id,
    email: u.email || prev?.email || "",
    name: name || str(m?.full_name) || str(m?.name) || prev?.name || (u.email || "").split("@")[0],
    handle: handle || prev?.handle || "",
    avatar: avatar || str(m?.avatar_url) || str(m?.picture) || prev?.avatar || "",
  };
}

// アクセストークンの更新は、同時に 1 回だけ行う(更新トークンは使うと入れ替わるため)
let refreshing: Promise<string | null> | null = null;
async function refresh(): Promise<string | null> {
  const s = sess;
  if (!s) return null;
  try {
    const r = await fetch(`${LAPOUNT_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: anonHeaders, body: JSON.stringify({ refresh_token: s.refresh }) });
    if (r.status >= 400 && r.status < 500) {
      // 別のウィンドウが先に更新していれば、その結果を使う
      const disk = read(kvGet(KEY));
      if (disk && disk.refresh !== s.refresh) { sess = disk; emit(); return disk.access; }
      store(null);
      return null;
    }
    if (!r.ok) return null;
    const t = (await r.json()) as { access_token: string; refresh_token: string };
    store({ ...s, access: t.access_token, refresh: t.refresh_token, exp: jwtExp(t.access_token) });
    return t.access_token;
  } catch { return null; } // 通信できないだけなら、ログインは残す
}

// 有効なアクセストークン。未ログイン・更新できないときは null
export async function getToken(): Promise<string | null> {
  if (!sess) return null;
  if (sess.exp - Date.now() > SKEW_MS) return sess.access;
  return (refreshing ??= refresh().finally(() => { refreshing = null; }));
}

// 認証つきの fetch。401 なら 1 回だけ更新して、やり直す
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response | null> {
  let t = await getToken();
  if (!t) return null;
  const go = (tok: string) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${tok}` } });
  let r = await go(t);
  if (r.status === 401 && sess) {
    sess = { ...sess, exp: 0 };
    t = await getToken();
    if (!t) return null;
    r = await go(t);
  }
  return r;
}

// 起動時と、名前・アイコンを変えた後に呼ぶ。プロフィールを取り直す
export async function refreshProfile(): Promise<void> {
  const t = await getToken();
  if (!t || !sess) return;
  try {
    const user = await fetchAccount(t, sess.user);
    if (sess) store({ ...sess, user });
  } catch { /* 取れなければ今のまま */ }
}

export type LoginFlow = { code: string; url: string; done: Promise<"ok" | "denied" | "expired" | "cancelled" | "error">; cancel: () => void };

// ブラウザで承認してもらう。url は開く先、code は画面に出す確認用の文字
export async function startLogin(): Promise<LoginFlow> {
  const r = await fetch(`${LAPOUNT_URL}/functions/v1/oauth-device-code`, { method: "POST", headers: anonHeaders, body: JSON.stringify({ action: "create", client_id: LAPOUNT_CLIENT_ID }) });
  if (!r.ok) throw new Error(`device ${r.status}`);
  const d = (await r.json()) as { device_code: string; user_code: string; verification_uri_complete: string; expires_in: number; interval?: number };
  if (!d.device_code || !d.verification_uri_complete) throw new Error("device");
  let stop = false, wake: (() => void) | null = null;
  const cancel = () => { stop = true; wake?.(); };
  const sleep = (ms: number) => new Promise<void>((res) => { wake = res; setTimeout(res, ms); });
  const interval = Math.max(2, d.interval || 5) * 1000;
  const until = Date.now() + (d.expires_in || 600) * 1000;
  const done = (async (): Promise<"ok" | "denied" | "expired" | "cancelled" | "error"> => {
    while (!stop && Date.now() < until) {
      await sleep(interval);
      if (stop) break;
      try {
        const pr = await fetch(`${LAPOUNT_URL}/functions/v1/oauth-device-code`, { method: "POST", headers: anonHeaders, body: JSON.stringify({ action: "poll", device_code: d.device_code }) });
        const p = (await pr.json()) as { status: string; access_token?: string; refresh_token?: string };
        if (p.status === "pending") continue;
        if (p.status === "denied") return "denied";
        if (p.status === "authorized" && p.access_token && p.refresh_token) {
          const user = await fetchAccount(p.access_token);
          store({ access: p.access_token, refresh: p.refresh_token, exp: jwtExp(p.access_token), user });
          return "ok";
        }
        return "expired"; // expired / invalid / already_used
      } catch { /* 通信の失敗は、次の周期でやり直す */ }
    }
    return stop ? "cancelled" : "expired";
  })();
  return { code: d.user_code, url: d.verification_uri_complete, done, cancel };
}

// http(s) の URL を、OS の既定のブラウザ(開発用のブラウザ版は新しいタブ)で開く
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  await openLoginPage(url);
}

// ログイン画面を開く(アプリ版は OS の既定のブラウザ、開発用のブラウザ版は新しいタブ)
export async function openLoginPage(url: string): Promise<void> {
  if (IS_TAURI) {
    try { await (await import("@tauri-apps/api/core")).invoke("open_url", { url }); return; } catch { /* 開けなければ下へ */ }
  }
  window.open(url, "_blank", "noopener");
}

// ログアウト。この PC のデータは消さない
export async function logout(): Promise<void> {
  const s = sess;
  store(null);
  if (!s) return;
  try { await fetch(`${LAPOUNT_URL}/auth/v1/logout?scope=local`, { method: "POST", headers: { apikey: LAPOUNT_ANON_KEY, Authorization: `Bearer ${s.access}` } }); } catch { /* 手元のログアウトは済んでいる */ }
}
