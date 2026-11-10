// 設定の「AI」画面。プロバイダーごとにスイッチを並べ、オンにしたものだけ接続の設定(API キー・ログイン)を開く。モデルは AI パネルで選ぶ。キーは設定本体とは別の場所に保存する
import { useEffect, useRef, useState } from "react";
import { Trash2, Check, RefreshCw, LogIn, Copy } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { PROVIDERS, PROVIDER_NAME, setEnabled, setKey, setProvider, tail, useAi, useLink, type Provider } from "@/features/ai/store";
import { login, refreshLink } from "@/features/ai/link";
import { ask } from "@/shared/ask";

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
        <button className="btn" disabled={!saved} onClick={async () => { if (await ask({ message: i18next.t("保存した API キーを消しますか?"), ok: i18next.t("消す"), danger: true })) setKey(p, ""); }}><Trash2 size={14} /><span>{i18next.t("消す")}</span></button>
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

const SUB: Record<Provider, string> = {
  "claude-cli": "Claude のサブスクリプションのログインで使う",
  anthropic: "自分の API キーで使う",
  openai: "自分の API キーで使う",
};

// プロバイダー1つぶん。スイッチをオンにすると、接続の設定が開く(初期はすべてオフ)
function ProviderCard({ p, many }: { p: Provider; many: boolean }) {
  const cfg = useAi();
  const link = useLink();
  const on = cfg.enabled[p];
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.inert = !on; }, [on]);
  const name = i18next.t(PROVIDER_NAME[p]);
  const linked = p === "claude-cli" ? link === "ready" : cfg.keys[p].length > 0;
  const state = !on ? "オフ" : p === "claude-cli" ? (linked ? "ログイン済み" : "未ログイン") : linked ? "API キーを保存済み" : "API キーが未設定";
  const hid = `ai-p-${p}`;
  return (
    <section className="ai-prov" data-on={on} aria-labelledby={hid}>
      <div className="ai-prov-h">
        <div className="ai-prov-t">
          <strong id={hid}>{name}</strong>
          <small>{i18next.t(SUB[p])}</small>
        </div>
        <span className="ai-prov-st" data-ok={on && linked} role="status">{i18next.t(state)}</span>
        <button className="switch" role="switch" aria-checked={on} aria-labelledby={hid} onClick={() => setEnabled(p, !on)} />
      </div>
      <div className="ai-prov-body" data-open={on}>
        <div ref={body}>
          {p === "claude-cli" ? <ClaudeLink /> : <KeyRow p={p} />}
          {many && (
            <div className="ai-set-row">
              <span>{i18next.t("AI パネルで使う")}</span>
              {cfg.provider === p
                ? <span className="ai-prov-cur"><Check size={14} />{i18next.t("使用中")}</span>
                : <button className="btn" onClick={() => setProvider(p)}><span>{i18next.t("これを使う")}</span></button>}
            </div>
          )}
          <ul className="ai-set-list">
            {p === "claude-cli" ? <>
              <li><Trans i18nKey="この PC に入っている claude コマンド(Claude Code)の、あなたのログインを使います。API キーは要りません。未ログインのときは、上の「ログイン」を押します。" /></li>
              <li><Trans i18nKey="Windows の claude コマンドを先に探し、なければ WSL の claude コマンドを使います。" /></li>
              <li><Trans i18nKey="使った分は、あなたの Claude の契約の利用枠に数えられます。ログインのトークンは、このエディタは読みません。" /></li>
            </> : <>
              <li><Trans i18nKey="API キーは、この PC のこのアプリの保存領域に、暗号化せずに入ります。共有の PC では入れないでください。" /></li>
              <li><Trans i18nKey="キーは、設定の書き出し・設定の履歴・統計には含まれません。送られる先は選んだプロバイダーだけです。" /></li>
            </>}
            <li><Trans i18nKey="初めて送るときに、送る相手と内容を確かめる画面が出ます。" /></li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function AiSettings() {
  const cfg = useAi();
  const many = PROVIDERS.filter((x) => cfg.enabled[x]).length > 1;
  return (
    <section className="set-sec ai-set">
      <p className="ai-set-note"><Trans i18nKey="AI パネルと、エディタを右クリックして出る「AI」のメニューで使います。コードは、あなたが操作したときだけ、オンにしたプロバイダーのサーバーに送られます。" /></p>
      {PROVIDERS.map((x) => <ProviderCard key={x} p={x} many={many} />)}
    </section>
  );
}
