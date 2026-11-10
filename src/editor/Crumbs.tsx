import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, ListTree } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import i18next from "i18next";
import { outline, trail, flat, type Sym } from "@/editor/outline";

// エディタの上のパンくず(ファイルの場所 › いまいる関数など)と、アウトラインの一覧
export const OUTLINE_EVENT = "fixit:outline";
export const lastFocus: { v: EditorView | null } = { v: null };

const BADGE: Record<string, string> = { function: "ƒ", method: "ƒ", class: "C", interface: "I", type: "T", enum: "E", namespace: "N", rule: "#", tag: "<>", h1: "H1", h2: "H2", h3: "H3", h4: "H4", h5: "H5", h6: "H6" };

type Pop = { x: number; y: number; items: Sym[]; filter: boolean; sel: number } | null;

export default function Crumbs({ view, path, ver }: { view: EditorView | null; path: string; ver: number }) {
  const [pop, setPop] = useState<Pop>(null);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const doc = view?.state.doc, tlen = view ? syntaxTree(view.state).length : 0;
  const syms = useMemo(() => (view ? outline(view.state) : []), [view, doc, tlen]); // eslint-disable-line react-hooks/exhaustive-deps
  void ver;
  const pos = view?.state.selection.main.head ?? 0;
  const tr = useMemo(() => trail(syms, pos), [syms, pos]);
  const parts = path.split("/").filter(Boolean);

  const open = (el: HTMLElement, items: Sym[], filter = false) => {
    const r = el.getBoundingClientRect();
    setQ(""); setPop({ x: Math.max(8, Math.min(r.left, innerWidth - 300)), y: r.bottom + 4, items, filter, sel: 0 });
  };
  const jump = (s: Sym) => {
    setPop(null);
    if (!view) return;
    view.dispatch({ selection: { anchor: s.from }, effects: [(view.constructor as typeof EditorView).scrollIntoView(s.from, { y: "start", yMargin: 60 })], userEvent: "select" });
    view.focus();
  };
  // 「シンボルへ移動」(コマンド)から開く。開くのは、いま操作しているほうの画面だけ
  useEffect(() => {
    const on = () => { if (lastFocus.v !== view || !box.current) return; open(box.current.querySelector<HTMLElement>(".bc-outline") ?? box.current, flat(syms), true); };
    addEventListener(OUTLINE_EVENT, on);
    return () => removeEventListener(OUTLINE_EVENT, on);
  });
  useEffect(() => {
    if (!pop) return;
    const bye = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".bc-pop")) setPop(null); };
    addEventListener("pointerdown", bye, true); addEventListener("blur", () => setPop(null));
    return () => removeEventListener("pointerdown", bye, true);
  }, [pop]);

  const shown = pop ? (q ? pop.items.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())) : pop.items) : [];
  const sel = pop ? Math.min(pop.sel, Math.max(0, shown.length - 1)) : 0;
  const onKey = (e: React.KeyboardEvent) => {
    if (!pop) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setPop({ ...pop, sel: Math.min(shown.length - 1, sel + 1) }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setPop({ ...pop, sel: Math.max(0, sel - 1) }); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[sel]) jump(shown[sel]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPop(null); view?.focus(); }
  };
  useEffect(() => { document.querySelector<HTMLElement>(".bc-pop [data-on=true]")?.scrollIntoView({ block: "nearest" }); }, [sel, pop]);

  return (
    <div ref={box} className="bc" role="navigation" aria-label={i18next.t("パンくず")}>
      <div className="bc-trail">
        {parts.map((p, i) => <span key={i} className="bc-seg" data-last={i === parts.length - 1 && !tr.length}>{i > 0 && <ChevronRight aria-hidden />}<span className="bc-name">{p}</span></span>)}
        {tr.map((s, i) => {
          const sibs = i === 0 ? syms : tr[i - 1].children;
          return (
            <span key={i} className="bc-seg" data-last={i === tr.length - 1}>
              <ChevronRight aria-hidden />
              <button className="bc-sym" onClick={(e) => open(e.currentTarget, sibs)}><i data-k={s.kind}>{BADGE[s.kind] ?? "·"}</i><span className="bc-name">{s.name}</span></button>
            </span>
          );
        })}
      </div>
      {syms.length > 0 && <button className="bc-outline icon-btn" aria-label={i18next.t("アウトライン")} data-tip={i18next.t("アウトライン")} onClick={(e) => open(e.currentTarget, flat(syms), true)}><ListTree /></button>}
      {pop && createPortal(
        <div className="bc-pop ctx" style={{ left: pop.x, top: pop.y }} onKeyDown={onKey}>
          {pop.filter && <input className="bc-q" autoFocus value={q} placeholder={i18next.t("名前で絞り込む")} onChange={(e) => setQ(e.target.value)} />}
          <ul role="listbox">
            {shown.slice(0, 200).map((s, i) => (
              <li key={s.from + s.name} role="option" data-on={i === sel} onMouseMove={() => i !== sel && setPop({ ...pop, sel: i })} onClick={() => jump(s)} style={{ paddingLeft: 8 + (pop.filter && !q ? s.depth * 12 : 0) }}>
                <i data-k={s.kind}>{BADGE[s.kind] ?? "·"}</i><span className="bc-name">{s.name}</span><em>{s.line}</em>
              </li>
            ))}
            {!shown.length && <li className="bc-none">{i18next.t("見つかりません")}</li>}
          </ul>
        </div>, document.body)}
    </div>
  );
}
