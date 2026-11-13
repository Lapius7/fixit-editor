// 設定の「AI」画面。プロバイダーごとにスイッチを並べ、オンにしたものだけ接続の設定(API キー・ログイン)を開く。モデルは AI パネルで選ぶ。キーは設定本体とは別の場所に保存する
import { useEffect, useRef, useState } from "react";
import { Trash2, Check, RefreshCw, LogIn, Copy } from "lucide-react";
import i18next from "i18next";
import { copyWithNotice } from "@/platform/clipboard";
import { Trans } from "react-i18next";
import { PROVIDERS, PROVIDER_NAME, WHERES, AGENT_MODES, MODE_HINT, MODE_NAME, cleanBase, setMode, setBase, setEnabled, setKey, setModel, setProvider, setWhere, tail, useAi, useLink, type Provider, type Where } from "@/features/ai/store";
import { UsageRows } from "@/features/ai/UsageView";
import { IS_TAURI } from "@/shared/chrome";
import { login, refreshLink } from "@/features/ai/link";
import { useUsagePoll } from "@/features/ai/useUsagePoll";
import { copilotLogin, forgetCopilot, type Device } from "@/features/ai/copilot";
import { openExternal } from "@/features/account/auth";
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

// OpenAI 互換の接続先。URL とモデル名を入れる(キーは下の KeyRow。要らないサーバーなら空でよい)
function BaseRow() {
  const cfg = useAi();
  const [v, setV] = useState(cfg.base);
  const [m, setM] = useState(cfg.models.custom);
  const bad = v.trim() !== "" && !cleanBase(v);
  return (
    <>
      <div className="ai-set-row">
        <label htmlFor="ai-base">{i18next.t("接続先の URL")}</label>
        <div className="ai-set-line">
          <input id="ai-base" className="field" type="url" autoComplete="off" spellCheck={false} value={v} aria-invalid={bad} placeholder="https://api.example.com/v1" onChange={(e) => setV(e.target.value)} />
          <button className="btn" disabled={!cleanBase(v) || cleanBase(v) === cfg.base} onClick={() => { setBase(v); setV(cleanBase(v)); }}><Check size={14} /><span>{i18next.t("保存")}</span></button>
        </div>
        {bad && <small className="ai-set-err">{i18next.t("https の URL か、この PC 内の http://localhost の URL を入れてください")}</small>}
      </div>
      <div className="ai-set-row">
        <label htmlFor="ai-model-custom">{i18next.t("モデル名")}</label>
        <div className="ai-set-line">
          <input id="ai-model-custom" className="field" autoComplete="off" spellCheck={false} value={m} placeholder="llama3.1" onChange={(e) => setM(e.target.value)} />
          <button className="btn" disabled={!m.trim() || m.trim() === cfg.models.custom} onClick={() => setModel("custom", m)}><Check size={14} /><span>{i18next.t("保存")}</span></button>
        </div>
      </div>
    </>
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
          <button className="btn" onClick={() => void copyWithNotice(url)}><Copy size={14} /><span>{i18next.t("コピー")}</span></button>
        </div>
      )}
      {link === "nocli" && <p className="ai-link-note"><Trans i18nKey="Claude Code を入れてから、もう一度確認してください。Windows の PowerShell では、次のコマンドで入ります: irm https://claude.ai/install.ps1 | iex" /></p>}
    </div>
  );
}

// claude の場所。WSL と Windows でアカウントを分けているときに固定する(exe のみ。開発サーバーは WSL の claude 固定)
const WHERE_NAME: Record<Where, string> = { auto: "自動", windows: "Windows", wsl: "WSL" };
function WhereRow() {
  const cfg = useAi();
  return (
    <div className="ai-set-row">
      <span id="ai-where">{i18next.t("使う claude")}</span>
      <div className="seg" role="group" aria-labelledby="ai-where">
        {WHERES.map((w) => <button key={w} aria-pressed={cfg.where === w} onClick={() => { if (cfg.where !== w) { setWhere(w); void refreshLink(); } }}>{i18next.t(WHERE_NAME[w])}</button>)}
      </div>
    </div>
  );
}

// GitHub Copilot のログイン(デバイスフロー)。押したときだけ、コードを出して GitHub での承認を待つ。受け取ったトークンは API キーと同じ場所に保存する
const COPILOT_FAIL = { denied: "ログインが断られました", expired: "コードの期限が切れました。もう一度ログインしてください", network: "接続できませんでした。ネットワークを確かめてください", cancel: "" } as const;
function CopilotLink() {
  const cfg = useAi();
  const [dev, setDev] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState("");
  const ac = useRef<AbortController | null>(null);
  useEffect(() => () => ac.current?.abort(), []);
  const saved = cfg.keys.copilot.length > 0;
  const start = async () => {
    const c = new AbortController(); ac.current = c; setBusy(true); setFail(""); setDev(null);
    try {
      const r = await copilotLogin((d) => { setDev(d); void openExternal(d.verification_uri); }, c.signal);
      if (r.ok) { forgetCopilot(); setKey("copilot", r.token); } else setFail(COPILOT_FAIL[r.why]);
    } finally { setBusy(false); setDev(null); ac.current = null; }
  };
  return (
    <div className="ai-set-row ai-link">
      <span>{i18next.t("接続")}</span>
      <div className="ai-set-line">
        <span className="ai-link-st" data-state={saved ? "ready" : "login"} role="status">{i18next.t(saved ? "接続済み(ログインしています)" : "未ログイン")}</span>
        {!busy && <button className="btn" data-primary={!saved || undefined} onClick={() => void start()}><LogIn size={14} /><span>{i18next.t(saved ? "ログインし直す" : "GitHub でログイン")}</span></button>}
        {!busy && saved && <button className="btn" onClick={async () => { if (await ask({ message: i18next.t("ログインの情報を、この PC から消しますか?"), ok: i18next.t("消す"), danger: true })) { forgetCopilot(); setKey("copilot", ""); } }}><Trash2 size={14} /><span>{i18next.t("ログアウト")}</span></button>}
        {busy && <button className="btn" onClick={() => ac.current?.abort()}><span>{i18next.t("やめる")}</span></button>}
      </div>
      {busy && !dev && <p className="ai-link-note">{i18next.t("ログインの準備をしています…")}</p>}
      {busy && dev && (
        <>
          <p className="ai-link-note">{i18next.t("ブラウザで GitHub が開きます。次のコードを入力して、承認してください")}</p>
          <div className="ai-set-line">
            <input className="field ai-devcode" readOnly value={dev.user_code} aria-label={i18next.t("確認用のコード")} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn ai-devbtn" onClick={() => void copyWithNotice(dev.user_code)}><Copy size={14} /><span>{i18next.t("コピー")}</span></button>
          </div>
          <div className="ai-set-line">
            <input className="field" readOnly value={dev.verification_uri} aria-label={i18next.t("ログインの URL")} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn ai-devbtn" onClick={() => void openExternal(dev.verification_uri)}><span>{i18next.t("開く")}</span></button>
          </div>
        </>
      )}
      {fail && <p className="ai-link-note" role="alert">{i18next.t(fail)}</p>}
    </div>
  );
}

const SUB: Record<Provider, string> = {
  copilot: "GitHub のログインで、Copilot の契約を使う",
  "claude-cli": "Claude のサブスクリプションのログインで使う",
  anthropic: "自分の API キーで使う",
  openai: "自分の API キーで使う",
  gemini: "自分の API キーで使う",
  custom: "Ollama・LM Studio・OpenRouter など、OpenAI 互換の接続先を自分で決めて使う",
};

// プロバイダー1つぶん。スイッチをオンにすると、接続の設定が開く(初期はすべてオフ)
function ProviderCard({ p, many }: { p: Provider; many: boolean }) {
  const cfg = useAi();
  const link = useLink();
  const on = cfg.enabled[p];
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => { if (body.current) body.current.inert = !on; }, [on]);
  const name = i18next.t(PROVIDER_NAME[p]);
  const linked = p === "claude-cli" ? link === "ready" : p === "custom" ? cfg.base.length > 0 && cfg.models.custom.length > 0 : cfg.keys[p].length > 0;
  const state = !on ? "オフ" : p === "claude-cli" || p === "copilot" ? (linked ? "ログイン済み" : "未ログイン") : p === "custom" ? (linked ? "接続先を設定済み" : "接続先が未設定") : linked ? "API キーを保存済み" : "API キーが未設定";
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
          {p === "claude-cli" ? <ClaudeLink /> : p === "copilot" ? <CopilotLink /> : p === "custom" ? <><BaseRow /><KeyRow p={p} /></> : <KeyRow p={p} />}
          {p === "claude-cli" && (IS_TAURI || import.meta.env.DEV) && <WhereRow />}
          <UsageRows p={p} />
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
              <li><Trans i18nKey="「使う claude」が自動のときは、Windows の claude コマンドを先に探し、なければ WSL の claude コマンドを使います。Windows と WSL でアカウントを分けているときは、どちらかに固定します。" /></li>
              <li><Trans i18nKey="使った分は、あなたの Claude の契約の利用枠に数えられます。使用率を知るために、claude のログイン情報の読み取り用トークンを、使用量の確認にだけ使います。保存や、会話の送信には使いません。" /></li>
            </> : p === "copilot" ? <>
              <li><Trans i18nKey="GitHub のアカウントでログインし、そのアカウントの Copilot の契約(無料プランを含む)を使います。API キーは要りません。" /></li>
              <li><Trans i18nKey="ログインは、画面に出るコードを GitHub で入力して承認する方式です。パスワードは、このエディタには入りません。" /></li>
              <li><Trans i18nKey="ログインのトークンは、この PC のこのアプリの保存領域に、暗号化せずに入ります。設定の書き出し・設定の履歴・統計には含まれません。共有の PC では入れないでください。" /></li>
              <li><Trans i18nKey="使った分は、あなたの Copilot の利用枠(プレミアムリクエスト)に数えられます。" /></li>
            </> : p === "custom" ? <>
              <li><Trans i18nKey="URL は、/v1 までを入れます(例: Ollama は http://localhost:11434/v1)。チャットの送り先は、その後ろに /chat/completions を付けた URL です。" /></li>
              <li><Trans i18nKey="API キーは、要らないサーバーなら空のままで使えます。入れたキーは、この PC のこのアプリの保存領域に、暗号化せずに入ります。" /></li>
              <li><Trans i18nKey="内容は、ここに入れた URL のサーバーにだけ送られます。信頼できる相手の URL だけを入れてください。サーバーがブラウザからの接続(CORS)を許していないと、つながりません。" /></li>
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
  useUsagePoll();
  const many = PROVIDERS.filter((x) => cfg.enabled[x]).length > 1;
  return (
    <section className="set-sec ai-set">
      <p className="ai-set-note"><Trans i18nKey="AI パネルと、エディタを右クリックして出る「AI」のメニューで使います。コードは、あなたが操作したときだけ、オンにしたプロバイダーのサーバーに送られます。" /></p>
      {PROVIDERS.map((x) => <ProviderCard key={x} p={x} many={many} />)}
      <section className="ai-prov" data-on={cfg.mode !== "ask"} aria-labelledby="ai-auto">
        <div className="ai-prov-h">
          <div className="ai-prov-t">
            <strong id="ai-auto">{i18next.t("AI のファイル操作")}</strong>
            <small>{i18next.t(MODE_HINT[cfg.mode])}</small>
          </div>
          <div className="seg" role="group" aria-labelledby="ai-auto">
            {AGENT_MODES.map((m) => <button key={m} aria-pressed={cfg.mode === m} onClick={() => setMode(m)}>{i18next.t(MODE_NAME[m])}</button>)}
          </div>
        </div>
      </section>
    </section>
  );
}
