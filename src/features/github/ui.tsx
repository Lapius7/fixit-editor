import { useCallback, useEffect, useRef, useState } from "react";
import i18next from "i18next";
import { Loader2, TriangleAlert } from "lucide-react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openExternal } from "@/features/account/auth";
import { notify } from "@/shared/notify";
import { ghErr, type User } from "./api";

// 読み込み。deps が変わるか reload() で取り直す。古い応答は捨てる
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const v = await fnRef.current();
      if (n === seq.current) { setData(v); setErr(""); }
    } catch (e) {
      if (n === seq.current) setErr(ghErr(e));
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void reload(); }, deps);
  return { data, err, busy, reload, setData };
}

// 書き込み系の操作。失敗は通知に出し、成功したら message(あれば)を出す。戻り値は成功したかどうか
export async function act(fn: () => Promise<unknown>, ok?: string): Promise<boolean> {
  try {
    await fn();
    if (ok) notify(ok, "success");
    return true;
  } catch (e) {
    notify(ghErr(e), "error");
    return false;
  }
}

// big: 画面全体の読み込み。真ん中に、輪と点がゆっくり動くローディングを出す。小さい方は、一覧の中などに出す
export function Busy({ label, big }: { label?: string; big?: boolean }) {
  const text = label ?? i18next.t("読み込み中");
  if (big) return <div className="gh-busy big" role="status" aria-label={text}><span className="gh-loader" aria-hidden><i /><i /><b /></span><span className="gh-busy-label">{text}</span></div>;
  return <div className="gh-busy" role="status"><Loader2 size={16} data-spin="true" /><span>{text}</span></div>;
}

export function Fail({ msg, retry }: { msg: string; retry?: () => void }) {
  return (
    <div className="gh-fail" role="alert">
      <TriangleAlert size={16} />
      <span>{msg}</span>
      {retry && <button className="btn" onClick={retry}>{i18next.t("再読み込み")}</button>}
    </div>
  );
}

export function Empty({ icon, text }: { icon?: React.ReactNode; text: string }) {
  return <div className="gh-empty">{icon}<span>{text}</span></div>;
}

export function Avatar({ u, size = 20 }: { u: User | null | undefined; size?: number }) {
  if (!u) return <span className="gh-av" style={{ width: size, height: size }} />;
  return <img className="gh-av" src={`${u.avatar_url}${u.avatar_url.includes("?") ? "&" : "?"}s=${size * 2}`} width={size} height={size} alt="" title={u.login} draggable={false} />;
}

// 状態の小さな印。tone は色(ok 緑・bad 赤・warn 黄・info 青・mute 灰)
export type Tone = "ok" | "bad" | "warn" | "info" | "mute";
export function Pill({ tone = "mute", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className="gh-pill" data-tone={tone}>{children}</span>;
}

// Actions の実行・ジョブ・ステップの状態を、色と文言にする
export function runTone(status: string, conclusion: string | null): { tone: Tone; label: string } {
  if (status !== "completed") {
    if (status === "queued" || status === "waiting" || status === "pending" || status === "requested") return { tone: "mute", label: i18next.t("待機中") };
    return { tone: "info", label: i18next.t("実行中") };
  }
  switch (conclusion) {
    case "success": return { tone: "ok", label: i18next.t("成功") };
    case "failure": case "timed_out": case "startup_failure": return { tone: "bad", label: i18next.t("失敗") };
    case "cancelled": return { tone: "mute", label: i18next.t("取り消し") };
    case "skipped": return { tone: "mute", label: i18next.t("スキップ") };
    case "action_required": return { tone: "warn", label: i18next.t("確認が必要") };
    default: return { tone: "mute", label: conclusion ?? "-" };
  }
}

export const Dot = ({ tone }: { tone: Tone }) => <i className="gh-dot" data-tone={tone} />;

// 見出し+右側の操作
export function Head({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="gh-head">
      <div className="gh-head-t"><h3>{title}</h3>{sub && <small>{sub}</small>}</div>
      {children && <div className="gh-head-a">{children}</div>}
    </div>
  );
}

// 設定の 1 行(左に名前と説明、右に操作)
export function Row({ title, hint, children, danger }: { title: string; hint?: string; children?: React.ReactNode; danger?: boolean }) {
  return (
    <div className="gh-row" data-danger={danger || undefined}>
      <div className="gh-row-t"><b>{title}</b>{hint && <small>{hint}</small>}</div>
      <div className="gh-row-a">{children}</div>
    </div>
  );
}

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

// 複数行の入力(本文・説明)
export function Area({ value, onChange, placeholder, rows = 5, label }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; label: string }) {
  return <textarea className="field gh-area" rows={rows} value={value} aria-label={label} placeholder={placeholder} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
}

export const bytes = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

// ラベルの色(GitHub は 6 桁の 16 進)から、読める文字色を選ぶ
export function labelStyle(hex: string): React.CSSProperties {
  const h = /^[0-9a-f]{6}$/i.test(hex) ? hex : "888888";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return { background: `#${h}`, color: (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#1f2430" : "#fff" };
}

// 取り返しのつかない操作の前に、名前を打たせて確かめる
export function TypeConfirm({ word, label, onOk, onCancel }: { word: string; label: string; onOk: () => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  const [closing, setClosing] = useState(false);
  const done = (f: () => void) => { setClosing(true); setTimeout(f, 130); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); done(onCancel); } };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  });
  return (
    <div className="qo-backdrop ask-layer" data-mid="true" data-closing={closing}>
      <div className="qo dlg ask" role="alertdialog" aria-modal="true" aria-label={label} onMouseDown={(e) => e.stopPropagation()}>
        <p className="gh-tc">{i18next.t("確かめるため、「{{word}}」と入力してください。", { word })}</p>
        <input className="field" autoFocus value={v} spellCheck={false} aria-label={word} onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && v === word) done(onOk); }} />
        <div className="dlg-foot">
          <button className="btn" onClick={() => done(onCancel)}>{i18next.t("やめる")}</button>
          <button className="btn" data-danger="true" disabled={v !== word} onClick={() => done(onOk)}>{label}</button>
        </div>
      </div>
    </div>
  );
}

// GitHub の Markdown(本文・コメント・リリースノート)を表示する。変換後に無害化し、リンクは外のブラウザで開く
export function Md({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text || "", { async: false, gfm: true, breaks: true }) as string, { FORBID_TAGS: ["style", "form", "input"] });
  return (
    <div className="gh-md selectable" dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => { const a = (e.target as HTMLElement).closest("a"); if (a?.href) { e.preventDefault(); void openExternal(a.href); } }} />
  );
}
