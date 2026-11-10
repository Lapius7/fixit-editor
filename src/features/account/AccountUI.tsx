import { useEffect, useRef, useState } from "react";
import { ExternalLink, LogIn, LogOut, RefreshCw, Trash2 } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { logout, openLoginPage, refreshProfile, startLogin, useAccount, type Account, type LoginFlow } from "./auth";
import { deleteCloudData, setSyncOn, syncNow, useSync } from "./sync";
import { notify } from "@/shared/notify";

const ACCOUNT_PAGE = "https://account.lapius7.com/";

// アイコン。読み込めないとき・未設定のときは、名前の頭文字
export function Avatar({ user, size = 28 }: { user: Pick<Account, "name" | "avatar">; size?: number }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [user.avatar]);
  const initial = (user.name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <span className="acct-av" style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden>
      {user.avatar && !bad ? <img src={user.avatar} alt="" draggable={false} onError={() => setBad(true)} /> : initial}
    </span>
  );
}

type Phase = { t: "idle" } | { t: "wait"; code: string; url: string } | { t: "fail"; msg: string };

// ログインのボタンと、承認待ちの表示。ブラウザで承認してもらう(パスワードはこのアプリに入れない)
export function LoginBox({ compact }: { compact?: boolean }) {
  const [ph, setPh] = useState<Phase>({ t: "idle" });
  const flow = useRef<LoginFlow | null>(null);
  useEffect(() => () => flow.current?.cancel(), []);

  const start = async () => {
    flow.current?.cancel();
    try {
      const f = await startLogin();
      flow.current = f;
      setPh({ t: "wait", code: f.code, url: f.url });
      void openLoginPage(f.url);
      const res = await f.done;
      if (flow.current !== f) return;
      flow.current = null;
      if (res === "ok") setPh({ t: "idle" });
      else if (res === "cancelled") setPh({ t: "idle" });
      else setPh({ t: "fail", msg: res === "denied" ? i18next.t("ログインが拒否されました") : i18next.t("確認コードの有効期限が切れました。もう一度お試しください") });
    } catch {
      setPh({ t: "fail", msg: i18next.t("ログインを始められませんでした。ネットワークを確かめてください") });
    }
  };
  const cancel = () => { flow.current?.cancel(); flow.current = null; setPh({ t: "idle" }); };

  return (
    <div className="acct-login" data-compact={compact || undefined}>
      {ph.t === "wait" ? (
        <>
          <p className="acct-note"><Trans i18nKey="ブラウザで開いたページに、次の確認コードが出ているか確かめてから、承認してください。" /></p>
          <div className="acct-code" aria-live="polite">{ph.code}</div>
          <div className="acct-row">
            <button className="btn" onClick={() => void openLoginPage(ph.url)}><ExternalLink size={14} /><span><Trans i18nKey="ページをもう一度開く" /></span></button>
            <button className="btn" onClick={cancel}><Trans i18nKey="やめる" /></button>
          </div>
        </>
      ) : (
        <div className="acct-row">
          <button className="btn" data-primary="true" onClick={() => void start()}><LogIn size={14} /><span><Trans i18nKey="Lapount でログイン" /></span></button>
        </div>
      )}
      {ph.t === "fail" && <p className="acct-err" role="alert">{ph.msg}</p>}
    </div>
  );
}

const ago = (t: number) => {
  if (!t) return i18next.t("まだ同期していません");
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? i18next.t("たった今") : m < 60 ? i18next.t("{{n}} 分前", { n: m }) : i18next.t("{{n}} 時間前", { n: Math.round(m / 60) });
};

// 設定の「アカウント」
export function AccountSettings() {
  const user = useAccount();
  const sy = useSync();
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(id); }, []);

  if (!user) {
    return (
      <section className="set-sec">
        <h3><Trans i18nKey="アカウント" /></h3>
        <p className="acct-note"><Trans i18nKey="Lapount アカウントでログインすると、設定・プロファイル・ワークスペースの場所を、ほかの PC とそろえられます。フィードバックにアカウントが紐づき、返信も受け取れます。ログインしなくても、すべての機能を使えます。" /></p>
        <LoginBox />
      </section>
    );
  }
  return (
    <>
      <section className="set-sec">
        <h3><Trans i18nKey="アカウント" /></h3>
        <div className="acct-card">
          <Avatar user={user} size={44} />
          <div className="acct-who">
            <b>{user.name}</b>
            <small>{user.handle ? `@${user.handle}` : user.email}</small>
          </div>
          <button className="btn" onClick={() => void refreshProfile().then(() => notify(i18next.t("名前とアイコンを更新しました")))}><RefreshCw size={14} /><span><Trans i18nKey="更新" /></span></button>
          <button className="btn" onClick={() => void logout()}><LogOut size={14} /><span><Trans i18nKey="ログアウト" /></span></button>
        </div>
        <p className="acct-note">
          <Trans i18nKey="名前とアイコンは、Lapount アカウントのものです。" />{" "}
          <button className="acct-link" onClick={() => void openLoginPage(ACCOUNT_PAGE)}><Trans i18nKey="アカウントのページを開く" /></button>
        </p>
      </section>
      <section className="set-sec">
        <h3><Trans i18nKey="同期" /></h3>
        <div className="acct-line">
          <div>
            <b><Trans i18nKey="設定・プロファイル・ワークスペースを同期する" /></b>
            <small>{sy.error ? i18next.t("同期できませんでした。しばらくして、もう一度お試しください") : sy.busy ? i18next.t("同期しています…") : `${i18next.t("最後の同期")}: ${ago(sy.at)}`}</small>
          </div>
          <button className="switch" role="switch" aria-checked={sy.on} aria-label={i18next.t("設定・プロファイル・ワークスペースを同期する")} onClick={() => setSyncOn(!sy.on)} />
        </div>
        <p className="acct-note"><Trans i18nKey="同期するのは、設定、プロファイル、ワークスペースの名前・色・フォルダの場所(WSL・SSH・PC のパス)です。開いているタブ・分割・ターミナルの状態、AI の API キーと会話、統計、ファイルの中身は送りません。この PC のフォルダ選択で開いたフォルダ(ブラウザ版)は、場所を持たないので同期されません。" /></p>
        <div className="acct-row">
          <button className="btn" disabled={!sy.on || sy.busy} onClick={() => void syncNow()}><RefreshCw size={14} /><span><Trans i18nKey="今すぐ同期" /></span></button>
          <button className="btn" onClick={async () => {
            if (!confirm(i18next.t("クラウドに置いた同期データをすべて消しますか?この PC のデータは消えません。"))) return;
            notify((await deleteCloudData()) ? i18next.t("クラウドの同期データを消しました") : i18next.t("消せませんでした"));
          }}><Trash2 size={14} /><span><Trans i18nKey="クラウドのデータを消す" /></span></button>
        </div>
      </section>
    </>
  );
}
