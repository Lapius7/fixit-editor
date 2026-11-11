import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

// OS 標準のセレクトの代わり。右クリックメニュー(.ctx)と同じガラスの見た目で、開閉にアニメーションが付く。
export type Opt = { value: string; label: string; short?: string };
type Props = { value: string; options: Opt[]; onChange: (v: string) => void; label: string; title?: string; disabled?: boolean; className?: string };

const CLOSE_MS = 110;

export function Select({ value, options, onChange, label, title, disabled, className }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [sel, setSel] = useState(-1);
  const [at, setAt] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const typed = useRef({ s: "", t: 0 });
  const id = useId();
  const cur = options.findIndex((o) => o.value === value);

  const close = (focus = true) => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, CLOSE_MS);
    if (focus) btn.current?.focus({ preventScroll: true });
  };
  const pick = (i: number) => { const o = options[i]; if (o) { if (o.value !== value) onChange(o.value); close(); } };

  // 開いた直後に、実寸で置く場所を決める(下に入らなければ上に出す)
  useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    const r = btn.current!.getBoundingClientRect(), el = list.current!;
    const h = el.scrollHeight + 12, room = innerHeight - r.bottom - 10, up = room < Math.min(h, 220) && r.top > room;
    const max = Math.max(120, (up ? r.top : room) - 6);
    const hh = Math.min(h, max);
    const w = Math.max(r.width, 140);
    setAt({ left: Math.max(8, Math.min(r.left, innerWidth - 8 - w)), top: up ? r.top - 4 - hh : r.bottom + 4, width: w, up, max });
    setSel(cur >= 0 ? cur : 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (at) list.current?.focus({ preventScroll: true }); }, [at !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const t = e.target as Node; if (!list.current?.contains(t) && !btn.current?.contains(t)) close(false); };
    const bye = () => close(false);
    addEventListener("pointerdown", away, true); addEventListener("resize", bye); addEventListener("blur", bye);
    return () => { removeEventListener("pointerdown", away, true); removeEventListener("resize", bye); removeEventListener("blur", bye); };
  });

  useEffect(() => { if (open && sel >= 0) list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel, open]);

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key, n = options.length;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (k === "ArrowDown") { stop(); setSel((sel + 1) % n); }
    else if (k === "ArrowUp") { stop(); setSel((sel - 1 + n) % n); }
    else if (k === "Home") { stop(); setSel(0); }
    else if (k === "End") { stop(); setSel(n - 1); }
    else if (k === "Enter" || k === " ") { stop(); pick(sel); }
    else if (k === "Escape") { stop(); close(); }
    else if (k === "Tab") close(false);
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      stop();
      const t = typed.current, now = Date.now();
      t.s = (now - t.t > 700 ? "" : t.s) + k.toLowerCase(); t.t = now;
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(t.s));
      if (hit >= 0) setSel(hit);
    }
  };

  return (
    <>
      <button ref={btn} type="button" className={`sel sel-btn${className ? " " + className : ""}`} disabled={disabled} title={title} aria-label={label}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} data-open={open && !closing}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); } }}>
        <span className="sel-v">{options[cur]?.short ?? options[cur]?.label ?? ""}</span>
        <ChevronDown aria-hidden />
      </button>
      {open && createPortal(
        <ul ref={list} id={id} className="ctx sel-list" role="listbox" tabIndex={-1} aria-label={label} data-closing={closing} data-up={at?.up}
          style={at ? { left: at.left, top: at.top, minWidth: at.width, maxHeight: at.max, transformOrigin: at.up ? "bottom left" : "top left" } : { left: 0, top: 0, visibility: "hidden" }}
          onKeyDown={onKey} onMouseLeave={() => setSel(cur)}>
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value} className="ctx-item" data-sel={i === sel} onMouseMove={() => sel !== i && setSel(i)} onClick={() => pick(i)}>
              <span className="ctx-label">{o.label}</span>
              {o.value === value && <Check aria-hidden />}
            </li>
          ))}
        </ul>, document.body)}
    </>
  );
}
