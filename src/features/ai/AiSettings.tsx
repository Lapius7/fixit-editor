// 設定の「AI」画面。プロバイダー・モデル・API キー。キーは設定本体とは別の場所に保存する
import { useEffect, useRef, useState } from "react";
import { Trash2, Check, RefreshCw, LogIn, Copy } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { AI_DEFAULT_MODEL, AI_MODEL_HINTS } from "@/shared/config";
import { PROVIDERS, PROVIDER_NAME, setKey, setModel, setProvider, tail, useAi, useLink, type Provider } from "@/features/ai/store";
import { login, refreshLink } from "@/features/ai/link";

function KeyRow({ p }: { p: Provider }) {
  const cfg = useAi();
  const [v, setV] = useState("");
  const saved = cfg.keys[p];
  return (
    <div className="ai-set-row">
      <label htmlFor={`ai-key-${p}`}>{i18next.t("{{name}} の API キー", { name: i18next.t(PROVIDER_NAME[p]) })}</label>
      <div className="ai-set-line">
        <input id={`ai-key-${p}`} className="field" type="password" autoComplete="off" spellCheck={false} value={v} placeholder={saved ? i18next.t("保存済み({{tail}})。変えるときだけ入力", { tail: tail(saved) }) : "API key"} onChange={(e) => setV(e.target.value)} />
        <button className="btn" disabled={!v.trim()} onClick={() => { setKey(p, v); setV(""); }}><Check size={14} /><span>{i18next.t("保存")}</span></button>
        <button className="btn" disabled={!saved} onClick={() => { if (confirm(i18next.t("保存した API キーを消しますか?"))) setKey(p, ""); }}><Trash2 size={14} /><span>{i18next.t("消す")}</span></button>
      </div>
    </div>
  );
}

// claude コマンドの接続。状態を確かめ、未ログインなら「ログイン」でブラウザの認証を始める(押したときだけ。トークンは読まない)
const LINK_TEXT = { unknown: "確認できませんでした", checking: "確認中…", ready: "接続済み(ログインしています)", login: "未ログイン", nocli: "claude コマンドが見つかりません" } as const;
function ClaudeLink() {
  const link = useLink();
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const ac = useRef<AbortController | null>(null);
  useEffect(() => { void refreshLink(); return () => ac.current?.abort(); }, []);
  const start = async () => {
    const c = new AbortController(); ac.current = c; setBusy(true); setUrl("");
    try { await login(setUrl, c.signal); } finally { setBusy(false); setUrl(""); ac.current = null; }
  };
  return (
    <div className="ai-set-row ai-link">
      <span>{i18next.t("接続")}</span>
      <div className="ai-set-line">
        <span className="ai-link-st" data-state={link} role="status">{i18next.t(LINK_TEXT[link])}</span>
        <button className="btn" disabled={busy || link === "checking"} onClick={() => void refreshLink()}><RefreshCw size={14} /><span>{i18next.t("再確認")}</span></button>
        {(link === "login" || link === "unknown") && !busy && <button className="btn" data-primary="true" onClick={() => void start()}><LogIn size={14} /><span>{i18next.t("ログイン")}</span></button>}
        {busy && <button className="btn" onClick={() => ac.current?.abort()}><span>{i18next.t("やめる")}</span></button>}
      </div>
      {busy && <p className="ai-link-note">{i18next.t("ブラウザが開きます。Claude のアカウントでログインを済ませてください")}</p>}
      {busy && url && (
        <div className="ai-set-line">
          <input className="field" readOnly value={url} aria-label={i18next.t("ログインの URL")} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(url)}><Copy size={14} /><span>{i18next.t("コピー")}</span></button>
        </div>
      )}
      {link === "nocli" && <p className="ai-link-note"><Trans i18nKey="Claude Code を入れてから、もう一度確認してください。Windows の PowerShell では、次のコマンドで入ります: irm https://claude.ai/install.ps1 | iex" /></p>}
    </div>
  );
}

export function AiSettings() {
  const cfg = useAi();
  const p = cfg.provider;
  const [model, setM] = useState<Record<Provider, string>>(cfg.models);
  return (
    <section className="set-sec ai-set">
      <p className="ai-set-note"><Trans i18nKey="AI パネルと、エディタを右クリックして出る「AI」のメニューで使います。コードは、あなたが操作したときだけ、下で選んだプロバイダーのサーバーに送られます。" /></p>
      <div className="ai-set-row">
        <span id="ai-prov">{i18next.t("使うプロバイダー")}</span>
        <div className="seg" role="group" aria-labelledby="ai-prov">
          {PROVIDERS.map((x) => <button key={x} aria-pressed={p === x} onClick={() => setProvider(x)}>{i18next.t(PROVIDER_NAME[x])}</button>)}
        </div>
      </div>
      <div className="ai-set-row">
        <label htmlFor="ai-model">{i18next.t("モデル")}</label>
        <input id="ai-model" className="field" list="ai-models" spellCheck={false} value={model[p]} placeholder={AI_DEFAULT_MODEL[p] || i18next.t("(claude の既定)")}
          onChange={(e) => setM({ ...model, [p]: e.target.value })} onBlur={() => { setModel(p, model[p]); setM({ ...model, [p]: model[p].trim() || AI_DEFAULT_MODEL[p] }); }} />
        <datalist id="ai-models">{AI_MODEL_HINTS[p].map((m) => <option key={m} value={m} />)}</datalist>
      </div>
      {p === "anthropic" && <KeyRow p="anthropic" />}
      {p === "openai" && <KeyRow p="openai" />}
      {p === "claude-cli" && <ClaudeLink />}
      {p === "claude-cli" ? (
        <ul className="ai-set-list">
          <li><Trans i18nKey="この PC に入っている claude コマンド(Claude Code)の、あなたのログインを使います。API キーは要りません。未ログインのときは、上の「ログイン」を押します。" /></li>
          <li><Trans i18nKey="Windows の claude コマンドを先に探し、なければ WSL の claude コマンドを使います。" /></li>
          <li><Trans i18nKey="使った分は、あなたの Claude の契約の利用枠に数えられます。ログインのトークンは、このエディタは読みません。" /></li>
          <li><Trans i18nKey="初めて送るときに、送る相手と内容を確かめる画面が出ます。" /></li>
        </ul>
      ) : (
      <ul className="ai-set-list">
        <li><Trans i18nKey="API キーは、この PC のこのアプリの保存領域に、暗号化せずに入ります。共有の PC では入れないでください。" /></li>
        <li><Trans i18nKey="キーは、設定の書き出し・設定の履歴・統計には含まれません。送られる先は選んだプロバイダーだけです。" /></li>
        <li><Trans i18nKey="初めて送るときに、送る相手と内容を確かめる画面が出ます。キーを変えると、もう一度出ます。" /></li>
        <li><Trans i18nKey="Claude の契約(サブスクリプション)で使うときは、上で「Claude (サブスク)」を選びます。" /></li>
      </ul>
      )}
    </section>
  );
}
