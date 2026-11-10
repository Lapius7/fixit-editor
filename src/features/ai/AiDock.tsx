// AI チャットのパネル。右側に出す(アプリ内ブラウザと同じ置き場所)。
// 送るのは「利用者が操作したとき」だけ。送る前に、相手と送る範囲を画面に出し、初回は同意を取る。
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Replace, Settings as Cog, Square, Trash2, X, Paperclip, History, SquarePen } from "lucide-react";
import i18next from "i18next";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { toUrl } from "@/features/browser/BrowserDock";
import { AI_MAX_HISTORY_CHARS } from "@/shared/config";
import { AiError, isAbort, streamChat, type AiErrorKind, type Msg, type Stop } from "@/features/ai/providers";
import { actionLabel, actionPrompt, ctxLabel, systemPrompt, withCode, type AiJob, type Ctx } from "@/features/ai/prompts";
import { ms } from "@/features/settings/settings";
import { getAi, hasEffort, ready, PROVIDER_NAME, setConsent, useAi, useLink, type Provider } from "@/features/ai/store";
import { ModelPicker } from "@/features/ai/ModelPicker";
import { refreshLink } from "@/features/ai/link";
import { deleteChat, clearChats, getChats, newChatId, saveChat, setCurChat, useChats, type Chat } from "@/features/ai/chats";

type M = { id: number; role: "user" | "assistant"; content: string; label?: string; ctx?: string; busy?: boolean; err?: AiErrorKind; note?: Stop; job?: AiJob; applied?: "ok" | "stale" };

const ERR: Record<AiErrorKind, string> = {
  auth: "API キーが正しくありません。設定で確かめてください",
  denied: "このキーでは使えません(権限や地域の制限など)",
  rate: "リクエストが多すぎるか、利用枠を超えています。しばらくしてからもう一度試してください",
  network: "接続できませんでした。ネットワークを確かめてください",
  model: "モデルが見つかりません。設定のモデル名を確かめてください",
  bad: "リクエストが受け付けられませんでした。モデル名や入力の長さを確かめてください",
  nocli: "claude コマンドが見つかりません(または、この環境では使えません)。Claude Code を入れてログインしてください",
  login: "claude にログインしていません。設定の「AI」で、ログインしてください",
  other: "AI の応答でエラーが起きました",
};

// 返答は Markdown で来る。画像・スタイル・フォームは通さない(画像の URL にコードを載せて外へ送る手口を防ぐ)
const SAFE = { ALLOWED_TAGS: ["p", "br", "hr", "pre", "code", "strong", "em", "del", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td"], ALLOWED_ATTR: ["href"], ALLOW_DATA_ATTR: false };
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string, SAFE);

function Reply({ m, onReplace, onCopy }: { m: M; onReplace: (m: M) => void; onCopy: (m: M) => void }) {
  const click = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const u = toUrl(a.getAttribute("href") ?? "");
    if (u) window.open(u.href, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="ai-a">
      {m.content && <div className="ai-md" onClick={click} dangerouslySetInnerHTML={{ __html: md(m.content) }} />}
      {m.busy && !m.content && <p className="ai-wait">{i18next.t("考え中…")}</p>}
      {m.note === "refusal" && <p className="ai-warn">{i18next.t("モデルが応答を断りました")}</p>}
      {m.note === "length" && <p className="ai-warn">{i18next.t("長さの上限で途中で切れました")}</p>}
      {m.err && <p className="ai-err" role="alert">{i18next.t(ERR[m.err])}</p>}
      {!m.busy && m.content && (
        <div className="ai-acts">
          <button className="ai-act" onClick={() => onCopy(m)}><Copy size={14} />{i18next.t("コピー")}</button>
          {m.job?.action === "translate" && m.job.scope === "selection" && !m.applied && <button className="ai-act" onClick={() => onReplace(m)}><Replace size={14} />{i18next.t("選択範囲を置き換える")}</button>}
          {m.applied === "ok" && <span className="ai-done"><Check size={14} />{i18next.t("置き換えました")}</span>}
          {m.applied === "stale" && <span className="ai-warn">{i18next.t("元のコードが変わっているため置き換えられません")}</span>}
        </div>
      )}
    </div>
  );
}

export function AiDock({ open, job, getCtx, onClose, onSettings }: { open: boolean; job: AiJob | null; getCtx: () => Ctx | null; onClose: () => void; onSettings: () => void }) {
  const cfg = useAi();
  const link = useLink();
  // 会話の履歴。前回開いていた会話を、そのまま開く
  const init = useRef<{ id: string; msgs: M[] } | null>(null);
  if (!init.current) { const g = getChats(), c = g.chats.find((x) => x.id === g.cur); init.current = { id: c?.id ?? newChatId(), msgs: c ? (c.msgs as M[]) : [] }; }
  const chats = useChats();
  const [chatId, setChatId] = useState(init.current.id);
  const [hist, setHist] = useState(false);
  const loaded = useRef<M[]>(init.current.msgs); // 読み込んだままの状態は、保存し直さない(並び順が変わるため)
  const gen = useRef(0); // 会話を切り替えたら進める。古い送信の結果を、新しい会話に混ぜないため
  const [msgs, setMsgs] = useState<M[]>(init.current.msgs);
  const [text, setText] = useState("");
  const [attach, setAttach] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ p: Provider; go: () => void } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(init.current.msgs.reduce((n, m) => Math.max(n, m.id), 0)), done = useRef(0), list = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs); msgsRef.current = msgs;

  useEffect(() => { if (open) { box.current?.focus(); void refreshLink(); } }, [open]);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = (id: number, f: (m: M) => M) => setMsgs((a) => a.map((x) => (x.id === id ? f(x) : x)));

  // 履歴を API 用に。古い発言から外して、送る量に上限をかける
  const history = (extra: Msg): Msg[] => {
    const h: Msg[] = msgsRef.current.filter((m) => !m.busy && !m.err && m.content).map((m) => ({ role: m.role, content: m.content }));
    h.push(extra);
    let n = h.reduce((s, m) => s + m.content.length, 0);
    while (h.length > 1 && n > AI_MAX_HISTORY_CHARS) n -= h.shift()!.content.length;
    return h;
  };

  const run = async (content: string, shown: string, ctx?: string, j?: AiJob) => {
    const c = getAi(), p = c.provider;
    const uid = ++seq.current, aid = ++seq.current, g = gen.current;
    const pat = (id: number, f: (m: M) => M) => { if (gen.current === g) patch(id, f); };
    const messages = history({ role: "user", content });
    setMsgs((a) => [...a, { id: uid, role: "user", content, label: shown, ctx }, { id: aid, role: "assistant", content: "", busy: true, job: j }]);
    const ac = new AbortController(); abort.current = ac; setBusy(true);
    let acc = "", raf = 0;
    const flush = () => { raf = 0; pat(aid, (m) => ({ ...m, content: acc })); };
    try {
      const stop = await streamChat({ provider: p, model: c.models[p], effort: hasEffort(p) ? c.effort : "", key: c.keys[p], system: systemPrompt(), messages, signal: ac.signal, onText: (s) => { acc += s; if (!raf) raf = requestAnimationFrame(flush); } });
      if (raf) cancelAnimationFrame(raf);
      pat(aid, (m) => ({ ...m, content: acc, busy: false, note: stop === "end" ? undefined : stop }));
    } catch (e) {
      if (raf) cancelAnimationFrame(raf);
      if (isAbort(e, ac.signal)) pat(aid, (m) => ({ ...m, content: acc, busy: false }));
      else pat(aid, (m) => ({ ...m, content: acc, busy: false, err: e instanceof AiError ? e.kind : "other" }));
    } finally { if (gen.current === g) { setBusy(false); abort.current = null; } }
  };

  // 初回は、送る相手と送る内容を示して同意を取る
  const gate = (go: () => void) => {
    const c = getAi();
    if (c.consent[c.provider]) go(); else setPending({ p: c.provider, go });
  };

  useEffect(() => {
    if (!job || job.id === done.current || !open) return;
    done.current = job.id;
    if (!ready(getAi())) return;
    const q = actionPrompt(job.action, job.lang), ctx: Ctx = { name: job.name, text: job.text, scope: job.scope };
    const { content, cut } = withCode(q, ctx);
    gate(() => run(content, actionLabel(job.action, job.lang), ctxLabel(ctx, cut), job));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, open]);

  const send = () => {
    const q = text.trim();
    if (!q || busy || !ready(getAi())) return;
    const c = attach ? getCtx() : null;
    const w = c ? withCode(q, c) : { content: q, cut: false };
    setText("");
    gate(() => run(w.content, q, c ? ctxLabel(c, w.cut) : undefined));
  };

  const copy = (m: M) => { void navigator.clipboard?.writeText(m.content); };
  const replace = (m: M) => {
    const j = m.job; if (!j) return;
    const v = j.view;
    const ok = v.dom.isConnected && v.state.sliceDoc(j.from, j.to) === j.text;
    if (ok) v.dispatch({ changes: { from: j.from, to: j.to, insert: m.content.trim() } });
    patch(m.id, (x) => ({ ...x, applied: ok ? "ok" : "stale" }));
  };

  // 会話が変わるたび(送信が終わっているとき)に保存する。空にしたら、その会話の履歴も消える
  useEffect(() => {
    if (msgs === loaded.current || msgs.some((m) => m.busy)) return;
    saveChat(chatId, msgs.filter((m) => !m.err && (m.role === "user" || m.content)).map(({ id, role, content, label, ctx }) => ({ id, role, content, label, ctx })));
  }, [msgs, chatId]);

  // 会話を切り替える(送信中なら止める)
  const stopAll = () => { gen.current++; abort.current?.abort(); abort.current = null; setBusy(false); setPending(null); };
  const startNew = () => { stopAll(); const c = newChatId(); loaded.current = []; setMsgs([]); setChatId(c); setCurChat(null); setHist(false); };
  const openChat = (c: Chat) => {
    if (c.id === chatId) { setHist(false); return; }
    stopAll(); const m = c.msgs as M[]; loaded.current = m; seq.current = m.reduce((n, x) => Math.max(n, x.id), 0);
    setMsgs(m); setChatId(c.id); setCurChat(c.id); setHist(false);
  };
  const dropChat = (c: Chat) => { if (c.id === chatId) startNew(); deleteChat(c.id); };
  const when = (t: number) => new Date(t).toLocaleString(i18next.language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  // 閉じるときは、縮みきってから外す
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms(260));
    return () => clearTimeout(t);
  }, [open]);
  if (!open && !mounted) return null;
  return (
    <aside className="ai-dock" data-closing={!open} aria-label="AI" onKeyDown={(e) => { if (e.key === "Escape" && hist) { e.stopPropagation(); setHist(false); } }}>
      <div className="ai-bar">
        <span className="ai-title">AI<small>{cfg.models[cfg.provider] || (cfg.provider === "claude-cli" ? "claude" : "")}</small></span>
        <button className="icon-btn" aria-label={i18next.t("新しい会話")} title={i18next.t("新しい会話")} disabled={!msgs.length} onClick={startNew}><SquarePen /></button>
        <button className="icon-btn" data-on={hist} aria-label={i18next.t("会話の履歴")} title={i18next.t("会話の履歴")} aria-expanded={hist} onClick={() => setHist((v) => !v)}><History /></button>
        <button className="icon-btn" aria-label={i18next.t("この会話を消す")} title={i18next.t("この会話を消す")} disabled={!msgs.length} onClick={() => { stopAll(); loaded.current = []; setMsgs([]); }}><Trash2 /></button>
        <button className="icon-btn" aria-label={i18next.t("設定")} title={i18next.t("設定")} onClick={onSettings}><Cog /></button>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      {hist && (
        <>
          <div className="ai-hist-bg" onMouseDown={() => setHist(false)} />
          <div className="ai-hist scroll" role="menu" aria-label={i18next.t("会話の履歴")}>
            {chats.chats.length === 0 ? <p className="ai-hist-empty">{i18next.t("まだ会話の履歴はありません")}</p> : <>
              {chats.chats.map((c) => (
                <div key={c.id} className="ai-hist-row" data-on={c.id === chatId}>
                  <button role="menuitem" className="ai-hist-open" onClick={() => openChat(c)}><span className="truncate">{c.title || i18next.t("(空の会話)")}</span><small>{when(c.at)} · {c.msgs.filter((m) => m.role === "user").length}</small></button>
                  <button className="icon-btn" aria-label={i18next.t("この会話を消す")} title={i18next.t("この会話を消す")} onClick={() => dropChat(c)}><X /></button>
                </div>
              ))}
              <button className="ai-hist-clear" onClick={() => { startNew(); clearChats(); }}>{i18next.t("履歴をすべて消す")}</button>
            </>}
          </div>
        </>
      )}
      <div className="ai-list scroll" ref={list} aria-live="polite">
        {!ready(cfg, link) ? (
          <div className="ai-empty">
            <p>{cfg.provider === "claude-cli"
              ? i18next.t(link === "nocli" ? "claude コマンドが見つかりません。設定の「AI」で、入れ方を確かめてください" : "Claude にログインしていません。設定の「AI」で、ログインしてください")
              : i18next.t("AI を使うには、設定で API キーを入れてください")}</p>
            <button className="btn" onClick={onSettings}>{i18next.t("AI の設定を開く")}</button>
            <ModelPicker />
          </div>
        ) : !msgs.length ? (
          <p className="ai-empty-t">{i18next.t("質問を入力してください。コードについて聞くときは、下の「コードを添える」をオンにします。エディタを右クリックして「AI」から、要約・翻訳・説明もできます")}</p>
        ) : msgs.map((m) => m.role === "user"
          ? <div key={m.id} className="ai-u"><p>{m.label}</p>{m.ctx && <small>{m.ctx}</small>}</div>
          : <Reply key={m.id} m={m} onReplace={replace} onCopy={copy} />)}
      </div>
      {pending && (
        <div className="ai-consent" role="alertdialog" aria-label={i18next.t("送信の確認")}>
          <p>{pending.p === "claude-cli"
            ? i18next.t("選んだコード・入力した文章は、この PC の claude コマンドを通して Anthropic のサーバーに送られます。利用は、あなたの Claude の契約の枠に数えられます。このエディタの開発元には送られません")
            : i18next.t("選んだコード・入力した文章は、{{name}} のサーバーに送られます。送った内容の扱いは、各社の規約に従います。このエディタの開発元には送られません", { name: i18next.t(PROVIDER_NAME[pending.p]) })}</p>
          <div>
            <button className="btn" onClick={() => setPending(null)}>{i18next.t("やめる")}</button>
            <button className="btn" data-primary="true" onClick={() => { const g = pending.go; setConsent(pending.p, true); setPending(null); g(); }}>{i18next.t("同意して送る")}</button>
          </div>
        </div>
      )}
      {ready(cfg, link) && (
        <div className="ai-compose">
          <textarea ref={box} rows={3} value={text} placeholder={i18next.t("AI に質問(Enter で送信、Shift+Enter で改行)")} aria-label={i18next.t("AI に質問")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === "Escape") onClose(); }} />
          <ModelPicker disabled={busy} />
          <div className="ai-row">
            <button className="chipbtn" aria-pressed={attach} onClick={() => setAttach(!attach)} title={i18next.t("選択範囲を、なければファイル全体を、質問と一緒に送ります")}><Paperclip size={14} />{i18next.t("コードを添える")}</button>
            <span className="ai-to" />
            {busy
              ? <button className="icon-btn ai-send" aria-label={i18next.t("止める")} title={i18next.t("止める")} onClick={() => abort.current?.abort()}><Square /></button>
              : <button className="icon-btn ai-send" aria-label={i18next.t("送信")} title={i18next.t("送信")} disabled={!text.trim()} onClick={send}><ArrowUp /></button>}
          </div>
        </div>
      )}
    </aside>
  );
}
