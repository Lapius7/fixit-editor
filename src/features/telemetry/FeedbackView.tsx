import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ms } from "@/features/settings/settings";
import { notify } from "@/shared/notify";
import { sendFeedback, type FeedbackKind } from "./report";
import { useAccount } from "@/features/account/auth";
import { Avatar } from "@/features/account/AccountUI";
import { loadReplies, markRepliesSeen, useReplies, type MyFeedback } from "@/features/account/replies";

const KINDS: [FeedbackKind, string][] = [["bug", "不具合"], ["idea", "要望"], ["other", "その他"]];
const KIND_NAME: Record<string, string> = { bug: "不具合", idea: "要望", other: "その他" };
const when = (t: number) => new Date(t).toLocaleString(i18next.language, { dateStyle: "medium", timeStyle: "short" });

// 自分が送ったものと、返信
function Mine({ items }: { items: MyFeedback[] }) {
  if (!items.length) return <p className="fb-note"><Trans i18nKey="ログイン中に送ったフィードバックが、ここに並びます。" /></p>;
  return (
    <div className="fb-list overscroll-contain">
      {items.map((f) => (
        <article key={f.id} className="fb-item">
          <header><span>{i18next.t(KIND_NAME[f.kind] ?? "その他")}</span><time>{when(f.ts)}</time></header>
          <p>{f.message}</p>
          {f.replies.map((r) => (
            <div key={r.id} className="fb-reply" data-new={!r.seen || undefined}>
              <header><b><Trans i18nKey="開発者からの返信" /></b><time>{when(r.ts)}</time></header>
              <p>{r.body}</p>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

// 開発者へ送るフィードバック。押したときだけ送る。送る内容は画面に書いてあるものと、版・OS・言語だけ
export default function FeedbackView({ onClose, out }: { onClose: () => void; out?: boolean }) {
  const [closing, setClosing] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const user = useAccount();
  const mine = useReplies();
  const [tab, setTab] = useState<"new" | "mine">("new");
  useEffect(() => { if (user) void loadReplies(); }, [user]);
  useEffect(() => { if (tab === "mine") void markRepliesSeen(); }, [tab, mine.unread]);
  const area = useRef<HTMLTextAreaElement>(null);
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => { area.current?.focus(); }, []);
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const r = await sendFeedback(kind, text.trim(), contact.trim());
    setBusy(false);
    if (r === "ok") { notify(i18next.t("送りました。ありがとうございます"), "success"); void loadReplies(); close(); }
    else notify(r === "rate" ? i18next.t("送りすぎです。しばらくしてからもう一度送ってください") : i18next.t("送れませんでした。ネットワークを確かめてください"), "error");
  };
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={close}>
      <div className="qo dlg fb" role="dialog" aria-label={i18next.t("フィードバックを送る")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="st-head">
          <h2><Trans i18nKey="フィードバックを送る" /></h2>
          <button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
        </header>
        {user && (
          <div className="seg" role="group" aria-label={i18next.t("表示")}>
            <button aria-pressed={tab === "new"} onClick={() => setTab("new")}><Trans i18nKey="新しく送る" /></button>
            <button aria-pressed={tab === "mine"} onClick={() => setTab("mine")}><Trans i18nKey="送ったもの・返信" />{mine.unread > 0 && <b className="fb-badge">{mine.unread}</b>}</button>
          </div>
        )}
        {tab === "mine" && user ? <Mine items={mine.items} /> : <>
        <div className="seg" role="group" aria-label={i18next.t("種類")}>
          {KINDS.map(([k, label]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{i18next.t(label)}</button>)}
        </div>
        <textarea ref={area} className="field fb-text" value={text} maxLength={3000} placeholder={i18next.t("困っていること、直してほしいこと、あったらうれしい機能など")} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); }} />
        <input className="field" value={contact} maxLength={200} placeholder={i18next.t("連絡先(任意。返事がほしいときだけ)")} onChange={(e) => setContact(e.target.value)} />
        <p className="fb-note"><Trans i18nKey="送るのは、ここに書いた内容と、アプリの版・OS・言語だけです。ファイルの中身や名前、パスは送りません。" /></p>
        <p className="fb-who">
          {user ? <><Avatar user={user} size={18} /><span>{i18next.t("{{name}} のアカウントに紐づけて送ります。返信はここで読めます", { name: user.name })}</span></> : <span><Trans i18nKey="ログインしていないので、匿名で送ります。返信がほしいときは、設定の「アカウント」からログインしてください。" /></span>}
        </p>
        </>}
        {tab === "mine" && user ? (
          <div className="dlg-foot"><button className="btn" onClick={close}><Trans i18nKey="閉じる" /></button></div>
        ) : (
          <div className="dlg-foot">
            <button className="btn" onClick={close}><Trans i18nKey="やめる" /></button>
            <button className="btn" data-primary="true" disabled={!text.trim() || busy} onClick={send}><Trans i18nKey={busy ? "送っています…" : "送る"} /></button>
          </div>
        )}
      </div>
    </div>
  );
}
