// AI チャットのパネル。右側に出す(アプリ内ブラウザと同じ置き場所)。
// 送るのは「利用者が操作したとき」だけ。送る前に、相手と送る範囲を画面に出し、初回は同意を取る。
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Copy, Replace, Settings as Cog, Square, Trash2, X, History, SquarePen, ChevronLeft, FileText, Quote as QuoteIcon, FileDown, ImagePlus } from "lucide-react";
import i18next from "i18next";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { toUrl } from "@/features/browser/BrowserDock";
import { openExternal } from "@/features/account/auth";
import { AI_MAX_HISTORY_CHARS, AI_MAX_HISTORY_IMAGES, AI_MAX_IMAGES } from "@/shared/config";
import { AiError, isAbort, streamChat, type AiErrorKind, type Img, type Msg, type Stop } from "@/features/ai/providers";
import { isImageFile, toAiImage, type AiImage, type ImgFail } from "@/features/ai/images";
import { actionLabel, actionPrompt, replaceable, clipLabel, ctxLabel, systemPrompt, withClips, withCode, type AiJob, type Clip, type Ctx } from "@/features/ai/prompts";
import { drag, dragEnd } from "@/workbench/dnd";
import { notify } from "@/shared/notify";
import { copyWithNotice } from "@/platform/clipboard";
import { MAX_OPEN_BYTES } from "@/shared/config";
import { ms } from "@/features/settings/settings";
import { getAi, hasEffort, ready, PROVIDER_NAME, setConsent, useAi, useLink, type Provider } from "@/features/ai/store";
import { ModelPicker } from "@/features/ai/ModelPicker";
import { ImgPeek, type Peek } from "@/features/ai/ImgPeek";
import { refreshLink } from "@/features/ai/link";
import { AI_ERR as ERR } from "@/features/ai/oneshot";
import { deleteChat, getChats, newChatId, saveChat, setCurChat, useChats, type Chat } from "@/features/ai/chats";

type M = { id: number; role: "user" | "assistant"; content: string; label?: string; ctx?: string; imgs?: (Img & { name: string })[]; busy?: boolean; err?: AiErrorKind; note?: Stop; job?: AiJob; applied?: "ok" | "stale" };


// 返答は Markdown で来る。画像・スタイル・フォームは通さない(画像の URL にコードを載せて外へ送る手口を防ぐ)
const SAFE = { ALLOWED_TAGS: ["p", "br", "hr", "pre", "code", "strong", "em", "del", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td"], ALLOWED_ATTR: ["href"], ALLOW_DATA_ATTR: false };
const md = (s: string) => DOMPurify.sanitize(marked.parse(s, { async: false }) as string, SAFE);

// 返答の変換は、その返答の中身が変わったときだけやり直す(流れてくる最中も、ほかの返答は変換し直さない)。
// 置き換え・コピーは渡した m だけを使うので、m が同じなら描き直さなくてよい
const Reply = memo(function Reply({ m, onReplace, onCopy }: { m: M; onReplace: (m: M) => void; onCopy: (m: M) => void }) {
  const html = useMemo(() => (m.content ? md(m.content) : ""), [m.content]);
  const click = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const u = toUrl(a.getAttribute("href") ?? "");
    if (u) void openExternal(u.href); // デスクトップ版でも、PC の既定のブラウザで開く
  };
  return (
    <div className="ai-a">
      {m.content && <div className="ai-md" onClick={click} dangerouslySetInnerHTML={{ __html: html }} />}
      {m.busy && !m.content && <p className="ai-wait">{i18next.t("考え中…")}</p>}
      {m.note === "refusal" && <p className="ai-warn">{i18next.t("モデルが応答を断りました")}</p>}
      {m.note === "length" && <p className="ai-warn">{i18next.t("長さの上限で途中で切れました")}</p>}
      {m.err && <p className="ai-err" role="alert">{i18next.t(ERR[m.err])}</p>}
      {!m.busy && m.content && (
        <div className="ai-acts">
          <button className="ai-act" onClick={() => onCopy(m)}><Copy size={14} />{i18next.t("コピー")}</button>
          {m.job && replaceable(m.job.action) && m.job.scope === "selection" && !m.applied && <button className="ai-act" onClick={() => onReplace(m)}><Replace size={14} />{i18next.t("選択範囲を置き換える")}</button>}
          {m.applied === "ok" && <span className="ai-done"><Check size={14} />{i18next.t("置き換えました")}</span>}
          {m.applied === "stale" && <span className="ai-warn">{i18next.t("元のコードが変わっているため置き換えられません")}</span>}
        </div>
      )}
    </div>
  );
}, (a, b) => a.m === b.m);

const MAX_CLIPS = 8;
const imgFail = (r: ImgFail, name: string) => (r === "big" ? i18next.t("{{name}} は大きすぎて添えられません", { name }) : i18next.t("{{name}} は画像として読めないため、添えられません", { name }));
const imgSrc = (i: Img) => `data:${i.type};base64,${i.data}`;
// 画像として添えるもの(ファイルの中身)
export type AiPic = { name: string; blob: Blob };
// エディタから引用した文・ツリーから添える画像(id が変わるたびに 1 件ふえる)。resolve は、ドラッグされたファイル・タブの中身を読む
export type AiQuote = Clip | (AiPic & { id: number });
// 履歴の並び: 日ごとにまとめる(今日・昨日・それより前は日付)。新しい順のまま
const dayKey = (t: number) => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
function dayGroups(list: Chat[]): [string, Chat[]][] {
  const now = new Date(), today = dayKey(now.getTime()), yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime(), out = new Map<string, Chat[]>();
  for (const c of [...list].sort((a, b) => b.at - a.at)) {
    const k = dayKey(c.at);
    const label = k === today ? i18next.t("今日") : k === yesterday ? i18next.t("昨日")
      : new Date(c.at).toLocaleDateString(i18next.language, { year: new Date(c.at).getFullYear() === new Date().getFullYear() ? undefined : "numeric", month: "long", day: "numeric", weekday: "short" });
    (out.get(label) ?? out.set(label, []).get(label)!).push(c);
  }
  return [...out];
}
// 一覧に添える抜粋: 最後の AI の返事(なければ最初の質問)の先頭
const excerpt = (c: Chat) => {
  const m = [...c.msgs].reverse().find((x) => x.role === "assistant") ?? c.msgs[0];
  return (m?.content ?? "").replace(/```[\s\S]*?```/g, " ").replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "").replace(/[*_`~]+/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
};

export function AiDock({ open, job, quote, resolve, onClose, onSettings }: { open: boolean; job: AiJob | null; quote: AiQuote | null; resolve: (x: NonNullable<typeof drag.node> | string) => Promise<Ctx | AiPic | null>; onClose: () => void; onSettings: () => void }) {
  const cfg = useAi();
  const link = useLink();
  // 会話の履歴。前回開いていた会話を、そのまま開く
  const init = useRef<{ id: string; msgs: M[] } | null>(null);
  if (!init.current) { const g = getChats(), c = g.chats.find((x) => x.id === g.cur); init.current = { id: c?.id ?? newChatId(), msgs: c ? (c.msgs as M[]) : [] }; }
  const chats = useChats();
  const [chatId, setChatId] = useState(init.current.id);
  const [hist, setHist] = useState(false);
  const histBack = useRef<HTMLButtonElement>(null);
  // 履歴のページ: 開いたら「戻る」に合わせ、Esc で閉じる(行を消したあとはフォーカスがパネルの外へ出るため、window で受ける)
  useEffect(() => {
    if (!hist) return;
    histBack.current?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !(e.target as Element | null)?.closest?.("[role=dialog], [role=menu], [role=listbox]")) { e.preventDefault(); setHist(false); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [hist]);
  const loaded = useRef<M[]>(init.current.msgs); // 読み込んだままの状態は、保存し直さない(並び順が変わるため)
  const gen = useRef(0); // 会話を切り替えたら進める。古い送信の結果を、新しい会話に混ぜないため
  const [msgs, setMsgs] = useState<M[]>(init.current.msgs);
  const [text, setText] = useState("");
  const [peek, setPeek] = useState<Peek | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [over, setOver] = useState(false);
  const [imgs, setImgs] = useState<AiImage[]>([]);
  const imgsRef = useRef(imgs); imgsRef.current = imgs;
  const picker = useRef<HTMLInputElement>(null);
  const clipSeq = useRef(0), quoted = useRef(0);
  // 画像を添える。API が受け付ける形と大きさに直してから並べる
  const addImage = async (b: Blob, name: string) => {
    if (imgsRef.current.length >= AI_MAX_IMAGES) { notify(i18next.t("画像を添えられるのは {{n}} 枚までです", { n: AI_MAX_IMAGES }), "error"); return; }
    const r = await toAiImage(b, name);
    if (typeof r === "string") { notify(imgFail(r, name), "error"); return; }
    setImgs((a) => (a.length >= AI_MAX_IMAGES ? a : [...a, { ...r, id: ++clipSeq.current }]));
    requestAnimationFrame(() => box.current?.focus());
  };
  const addClip = (c: Ctx & { lines?: [number, number] }) => {
    setClips((a) => (a.length >= MAX_CLIPS ? (notify(i18next.t("添えられるのは {{n}} 件までです", { n: MAX_CLIPS }), "error"), a) : [...a, { ...c, id: ++clipSeq.current }]));
    requestAnimationFrame(() => box.current?.focus());
  };
  // エディタの右クリックから「AI チャットに引用」されたとき
  useEffect(() => {
    if (!quote || quote.id === quoted.current) return;
    quoted.current = quote.id;
    if ("blob" in quote) void addImage(quote.blob, quote.name); else addClip(quote);
  }, [quote]);
  // ファイル・タブ・OS のファイルを、パネルへドロップして添える
  const hasFiles = (e: React.DragEvent) => !!(drag.node || drag.tab) || e.dataTransfer.types.includes("Files");
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const n = drag.node, t = drag.tab, files = Array.from(e.dataTransfer.files);
    dragEnd();
    if (n || t) {
      if (n && n.kind === "dir") { notify(i18next.t("フォルダは添えられません。ファイルをドロップしてください"), "error"); return; }
      const c = await resolve(n ?? t!);
      if (c && "blob" in c) void addImage(c.blob, c.name); else if (c) addClip(c); else notify(i18next.t("このファイルは文字として読めないため、添えられません"), "error");
      return;
    }
    for (const f of files) {
      if (isImageFile(f, f.name)) { await addImage(f, f.name); continue; }
      if (f.size > MAX_OPEN_BYTES) { notify(i18next.t("{{name}} は大きすぎて添えられません", { name: f.name }), "error"); continue; }
      const head = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
      if (head.includes(0)) { notify(i18next.t("このファイルは文字として読めないため、添えられません"), "error"); continue; }
      addClip({ name: f.name, text: (await f.text()).replace(/\r\n/g, "\n"), scope: "file" });
    }
  };
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ p: Provider; go: () => void } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(init.current.msgs.reduce((n, m) => Math.max(n, m.id), 0)), done = useRef(0), list = useRef<HTMLDivElement>(null), box = useRef<HTMLTextAreaElement>(null);
  const msgsRef = useRef(msgs); msgsRef.current = msgs;

  useEffect(() => { if (open) { box.current?.focus(); void refreshLink(); } }, [open]);
  // 一番下を見ているときだけ、新しい返答に合わせて下へ送る。上を読んでいる間は動かさない(送信したときは下へ戻す)
  const stick = useRef(true);
  useEffect(() => { const el = list.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [msgs]);
  useEffect(() => () => abort.current?.abort(), []);

  const patch = (id: number, f: (m: M) => M) => setMsgs((a) => a.map((x) => (x.id === id ? f(x) : x)));

  // 履歴を API 用に。古い発言から外して、送る量に上限をかける
  // 画像は新しいものから AI_MAX_HISTORY_IMAGES 枚まで載せ、古い発言の画像から外す
  const history = (extra: Msg): Msg[] => {
    const h: Msg[] = msgsRef.current.filter((m) => !m.busy && !m.err && m.content).map((m) => ({ role: m.role, content: m.content, ...(m.imgs?.length ? { images: m.imgs.map(({ type, data }) => ({ type, data })) } : {}) }));
    h.push(extra);
    let n = h.reduce((s, m) => s + m.content.length, 0);
    while (h.length > 1 && n > AI_MAX_HISTORY_CHARS) n -= h.shift()!.content.length;
    let left = AI_MAX_HISTORY_IMAGES;
    for (let i = h.length - 1; i >= 0; i--) {
      const im = h[i].images;
      if (!im) continue;
      const keep = im.slice(Math.max(0, im.length - left));
      left -= keep.length;
      h[i] = keep.length ? { ...h[i], images: keep } : { role: h[i].role, content: h[i].content };
    }
    return h;
  };

  const run = async (content: string, shown: string, ctx?: string, j?: AiJob, pics: AiImage[] = []) => {
    const c = getAi(), p = c.provider;
    const uid = ++seq.current, aid = ++seq.current, g = gen.current;
    const pat = (id: number, f: (m: M) => M) => { if (gen.current === g) patch(id, f); };
    const images = pics.map(({ type, data }) => ({ type, data }));
    const messages = history({ role: "user", content, ...(images.length ? { images } : {}) });
    stick.current = true;
    setMsgs((a) => [...a, { id: uid, role: "user", content, label: shown, ctx, ...(pics.length ? { imgs: pics.map(({ type, data, name }) => ({ type, data, name })) } : {}) }, { id: aid, role: "assistant", content: "", busy: true, job: j }]);
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
  }, [job, open]);

  const send = () => {
    const q = text.trim();
    if (!q || busy || !ready(getAi())) return;
    const sent = clips, pics = imgs;
    const w = sent.length ? withClips(q, sent) : { content: q, cut: false };
    const label = [...sent.map(clipLabel), ...pics.map((p) => i18next.t("画像: {{name}}", { name: p.name }))].join(" / ") || undefined;
    setText(""); setClips([]); setImgs([]);
    gate(() => run(w.content, q, label, undefined, pics));
  };

  const copy = (m: M) => { void copyWithNotice(m.content); };
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
    stick.current = true; setMsgs(m); setChatId(c.id); setCurChat(c.id); setHist(false);
  };
  const dropChat = (c: Chat) => { if (c.id === chatId) startNew(); deleteChat(c.id); notify(i18next.t("会話を消しました"), "success"); };
  const when = (t: number) => new Date(t).toLocaleTimeString(i18next.language, { hour: "2-digit", minute: "2-digit" });

  // 閉じるときは、縮みきってから外す
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms(260));
    return () => clearTimeout(t);
  }, [open]);
  if (!open && !mounted) return null;
  return (
    <aside className="ai-dock" data-closing={!open} data-over={over} data-hist={hist} aria-label="AI"
      onDragOver={(e) => { if (ready(cfg, link) && hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; if (!over) setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setOver(false); }}
      onDrop={(e) => { if (ready(cfg, link) && hasFiles(e)) void onDrop(e); }}
      >
      <div className="ai-bar">
        <span className="ai-title">AI<small>{cfg.models[cfg.provider] || (cfg.provider === "claude-cli" ? "claude" : "")}</small></span>
        <button className="icon-btn" aria-label={i18next.t("新しい会話")} title={i18next.t("新しい会話")} disabled={!msgs.length} onClick={startNew}><SquarePen /></button>
        <button className="icon-btn" data-on={hist} aria-label={i18next.t("会話の履歴")} title={i18next.t("会話の履歴")} aria-pressed={hist} onClick={() => setHist((v) => !v)}><History /></button>
        <button className="icon-btn" aria-label={i18next.t("この会話を消す")} title={i18next.t("この会話を消す")} disabled={!msgs.length} onClick={() => { stopAll(); loaded.current = []; setMsgs([]); }}><Trash2 /></button>
        <button className="icon-btn" aria-label={i18next.t("設定")} title={i18next.t("設定")} onClick={onSettings}><Cog /></button>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      {hist && (
        <section className="ai-hist-page" aria-label={i18next.t("会話の履歴")}>
          <div className="ai-hist-head">
            <button ref={histBack} className="icon-btn" aria-label={i18next.t("戻る")} title={i18next.t("戻る")} onClick={() => setHist(false)}><ChevronLeft /></button>
            <h2>{i18next.t("会話の履歴")}</h2>
            {chats.chats.length > 0 && <small>{i18next.t("{{n}} 件", { n: chats.chats.length })}</small>}
          </div>
          {chats.chats.length === 0 ? <p className="ai-hist-empty">{i18next.t("まだ会話の履歴はありません")}</p> : (
            <div className="ai-hist-list scroll">
              {dayGroups(chats.chats).map(([day, list]) => (
                <div key={day} className="ai-hist-day" role="list" aria-label={day}>
                  <h3>{day}</h3>
                  {list.map((c) => (
                    <div key={c.id} role="listitem" className="ai-hist-row" data-on={c.id === chatId}>
                      <button className="ai-hist-open" onClick={() => openChat(c)}>
                        <span className="ai-hist-t truncate">{c.title || i18next.t("(空の会話)")}</span>
                        {excerpt(c) && <span className="ai-hist-x">{excerpt(c)}</span>}
                        <small>{when(c.at)} · {i18next.t("質問 {{n}} 件", { n: c.msgs.filter((m) => m.role === "user").length })}</small>
                      </button>
                      <button className="icon-btn ai-hist-del" aria-label={i18next.t("この会話を消す")} title={i18next.t("この会話を消す")} onClick={() => dropChat(c)}><Trash2 /></button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      <div className="ai-list scroll" ref={list} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
        {!ready(cfg, link) ? (
          <div className="ai-empty">
            <p>{!cfg.enabled[cfg.provider] ? i18next.t("使うプロバイダーが、設定の「AI」でオフになっています。スイッチをオンにして、連携を設定してください")
              : cfg.provider === "claude-cli"
              ? i18next.t(link === "nocli" ? "claude コマンドが見つかりません。設定の「AI」で、入れ方を確かめてください" : "Claude にログインしていません。設定の「AI」で、ログインしてください")
              : i18next.t("AI を使うには、設定で API キーを入れてください")}</p>
            <button className="btn" onClick={onSettings}>{i18next.t("AI の設定を開く")}</button>
            <ModelPicker />
          </div>
        ) : !msgs.length ? (
          <p className="ai-empty-t">{i18next.t("質問を入力してください。コードは、エディタを右クリックして「AI チャットに引用」で添えられます。画像は、貼り付けやドロップで添えられます。右クリックの「AI」から、要約・翻訳・説明もできます")}</p>
        ) : msgs.map((m) => m.role === "user"
          ? <div key={m.id} className="ai-u">{m.imgs && <div className="ai-u-imgs">{m.imgs.map((i, k) => <button key={k} className="ai-pic-open" title={i.name} aria-label={i18next.t("{{name}} を大きく見る", { name: i.name })} onClick={() => setPeek({ src: imgSrc(i), name: i.name })}><img src={imgSrc(i)} alt="" /></button>)}</div>}<p>{m.label}</p>{m.ctx && <small>{m.ctx}</small>}</div>
          : <Reply key={m.id} m={m} onReplace={replace} onCopy={copy} />)}
      </div>
      {pending && (
        <div className="ai-consent" role="alertdialog" aria-label={i18next.t("送信の確認")}>
          <p>{pending.p === "claude-cli"
            ? i18next.t("選んだコード・画像・入力した文章は、この PC の claude コマンドを通して Anthropic のサーバーに送られます。利用は、あなたの Claude の契約の枠に数えられます。このエディタの開発元には送られません")
            : i18next.t("選んだコード・画像・入力した文章は、{{name}} のサーバーに送られます。送った内容の扱いは、各社の規約に従います。このエディタの開発元には送られません", { name: i18next.t(PROVIDER_NAME[pending.p]) })}</p>
          <div>
            <button className="btn" onClick={() => setPending(null)}>{i18next.t("やめる")}</button>
            <button className="btn" data-primary="true" onClick={() => { const g = pending.go; setConsent(pending.p, true); setPending(null); g(); }}>{i18next.t("同意して送る")}</button>
          </div>
        </div>
      )}
      {ready(cfg, link) && (
        <div className="ai-compose">
          {clips.length + imgs.length > 0 && (
            <div className="ai-clips" role="list" aria-label={i18next.t("添えた資料")}>
              {imgs.map((p) => (
                <span key={p.id} className="ai-pic" role="listitem">
                  <button className="ai-pic-open" title={p.name} aria-label={i18next.t("{{name}} を大きく見る", { name: p.name })} onClick={() => setPeek({ src: imgSrc(p), name: p.name })}><img src={imgSrc(p)} alt="" /></button>
                  <button className="icon-btn ai-pic-x" aria-label={i18next.t("外す")} title={i18next.t("外す")} onClick={() => setImgs((a) => a.filter((x) => x.id !== p.id))}><X /></button>
                </span>
              ))}
              {clips.map((c) => (
                <span key={c.id} className="ai-clip" role="listitem" title={`${clipLabel(c)} · ${i18next.t("{{n}} 行", { n: c.text.split("\n").length })}`}>
                  {c.lines ? <QuoteIcon size={12} /> : <FileText size={12} />}<span className="truncate">{clipLabel(c)}</span>
                  <button className="icon-btn" aria-label={i18next.t("外す")} onClick={() => setClips((a) => a.filter((x) => x.id !== c.id))}><X /></button>
                </span>
              ))}
            </div>
          )}
          <textarea ref={box} rows={3} value={text} placeholder={i18next.t("AI に質問(Enter で送信、Shift+Enter で改行)")} aria-label={i18next.t("AI に質問")} onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              // 画像の貼り付け(スクリーンショットなど)。文字も一緒にあるときは、文字の貼り付けはそのまま通す
              const fs = Array.from(e.clipboardData.files).filter((f) => isImageFile(f, f.name));
              if (!fs.length) return;
              if (!e.clipboardData.getData("text/plain")) e.preventDefault();
              void (async () => { for (const f of fs) await addImage(f, f.name || "image.png"); })();
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === "Escape") onClose(); }} />
          <ModelPicker disabled={busy} />
          <div className="ai-row">
            <button className="chipbtn" onClick={() => picker.current?.click()} title={i18next.t("画像を選んで、質問と一緒に送ります。貼り付けやドロップでも添えられます")}><ImagePlus size={14} />{i18next.t("画像")}</button>
            <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = Array.from(e.target.files ?? []); e.target.value = ""; void (async () => { for (const f of fs) await addImage(f, f.name); })(); }} />
            <span className="ai-to" />
            {busy
              ? <button className="icon-btn ai-send" aria-label={i18next.t("止める")} title={i18next.t("止める")} onClick={() => abort.current?.abort()}><Square /></button>
              : <button className="icon-btn ai-send" aria-label={i18next.t("送信")} title={i18next.t("送信")} disabled={!text.trim()} onClick={send}><ArrowUp /></button>}
          </div>
        </div>
      )}
      {peek && <ImgPeek img={peek} onClose={() => setPeek(null)} />}
      <div className="ai-drop" aria-hidden="true"><FileDown size={22} /><strong>{i18next.t("ここにドロップして添える")}</strong><small>{i18next.t("ファイルの中身や画像を、質問と一緒に送ります")}</small></div>
    </aside>
  );
}
