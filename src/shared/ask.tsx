// OS 標準の confirm() の代わりの確認ダイアログ。await ask({ message }) で、続けるなら true を返す。
// 表示は <AskHost /> が 1 つだけ受け持つ(boot.tsx で置く)。Enter で決定、Esc と外側のクリックでやめる。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";

export type AskOptions = { message: string; title?: string; ok?: string; cancel?: string; danger?: boolean };
type Pending = AskOptions & { resolve: (v: boolean) => void };

let queue: Pending[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function ask(o: AskOptions): Promise<boolean> {
  return new Promise((resolve) => { queue = [...queue, { ...o, resolve }]; emit(); });
}

export function AskHost() {
  const cur = useSyncExternalStore((f) => (subs.add(f), () => void subs.delete(f)), () => queue[0] ?? null);
  const [closing, setClosing] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const done = (v: boolean) => {
    if (!cur || closing) return;
    setClosing(true);
    cur.resolve(v);
    setTimeout(() => { queue = queue.slice(1); setClosing(false); emit(); }, ms(160));
  };
  useEffect(() => {
    if (!cur) return;
    const prev = document.activeElement as HTMLElement | null;
    okRef.current?.focus();
    return () => { prev?.focus?.(); };
  }, [cur]);
  useEffect(() => {
    if (!cur) return;
    // 下にあるモーダルの Esc より先に受ける
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
      else if (e.key === "Enter" && !e.isComposing && document.activeElement?.tagName !== "BUTTON") { e.preventDefault(); e.stopImmediatePropagation(); done(true); }
    };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  });
  if (!cur) return null;
  return (
    <div className="qo-backdrop ask-layer" data-mid="true" data-closing={closing} onMouseDown={() => done(false)}>
      <div className="qo dlg ask" role="alertdialog" aria-modal="true" aria-labelledby="ask-t" aria-describedby="ask-m" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="ask-t">{cur.title ?? i18next.t("確認")}</h2>
        <p id="ask-m">{cur.message}</p>
        <div className="dlg-foot">
          <button className="btn" onClick={() => done(false)}>{cur.cancel ?? i18next.t("やめる")}</button>
          <button ref={okRef} className="btn" data-primary={!cur.danger || undefined} data-danger={cur.danger || undefined} onClick={() => done(true)}>{cur.ok ?? i18next.t("続ける")}</button>
        </div>
      </div>
    </div>
  );
}
