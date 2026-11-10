import { ms } from "@/features/settings/settings";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { chips } from "@/features/settings/keys";

export type Item =
  | { type: "sep" }
  | { type: "title"; label: string }
  | { type?: undefined; label: string; icon?: ReactNode; keys?: string; run?: () => void; danger?: boolean; disabled?: boolean; checked?: boolean; sub?: Item[] };

const live = (items: Item[]) => items.map((it, i) => ({ it, i })).filter((x) => x.it.type === undefined && !(x.it as { disabled?: boolean }).disabled);

type MenuProps = { items: Item[]; onDone: () => void; sub?: boolean; onBack?: () => void; anchor?: DOMRect };

function Menu({ items, onDone, sub, onBack, anchor }: MenuProps) {
  const ref = useRef<HTMLUListElement>(null);
  const [sel, setSel] = useState<number>(-1);
  const [open, setOpen] = useState<number>(-1);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const lis = useRef<(HTMLLIElement | null)[]>([]);

  useLayoutEffect(() => {
    const el = ref.current!;
    if (sub && anchor) {
      // 親の枠(overflow で切れる)の外に出すため、画面基準の位置で置く。入場の拡大縮小に左右されないよう実寸で測る
      const w = el.offsetWidth, h = el.offsetHeight;
      const left = anchor.right + 2 + w > innerWidth - 8 ? Math.max(8, anchor.left - 2 - w) : anchor.right + 2;
      setAt({ left, top: Math.max(8, Math.min(anchor.top - 7, innerHeight - 8 - h)) });
    }
    el.focus({ preventScroll: true });
    if (sub) setSel(live(items)[0]?.i ?? -1);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (d: 1 | -1) => {
    const l = live(items);
    if (!l.length) return;
    const at = l.findIndex((x) => x.i === sel);
    setSel(l[(at + d + l.length) % l.length].i);
  };
  const act = (i: number) => {
    const it = items[i];
    if (!it || it.type) return;
    if (it.sub) return setOpen(i);
    onDone();
    it.run?.();
  };

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (k === "ArrowDown") go(1);
    else if (k === "ArrowUp") go(-1);
    else if (k === "Home") setSel(live(items)[0]?.i ?? -1);
    else if (k === "End") setSel(live(items).at(-1)?.i ?? -1);
    else if (k === "Enter" || k === " ") act(sel);
    else if (k === "ArrowRight" && sel >= 0 && (items[sel] as { sub?: Item[] }).sub) setOpen(sel);
    else if ((k === "ArrowLeft" || k === "Escape") && sub) onBack?.();
    else if (k === "Escape") onDone();
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey) {
      const l = live(items).filter((x) => (x.it as { label: string }).label.toLowerCase().startsWith(k.toLowerCase()));
      if (l.length) setSel(l[0].i);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <ul ref={ref} className={sub ? "ctx ctx-sub" : "ctx"} role="menu" tabIndex={-1} onKeyDown={onKey}
      style={sub ? { left: at?.left ?? -9999, top: at?.top ?? 0 } : undefined} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        if (it.type === "sep") return <li key={i} className="ctx-sep" role="separator" />;
        if (it.type === "title") return <li key={i} className="ctx-title truncate">{it.label}</li>;
        return (
          <li key={i} ref={(e) => { lis.current[i] = e; }} role="menuitem" className="ctx-item" data-sel={sel === i} data-danger={it.danger} data-disabled={it.disabled}
            aria-disabled={it.disabled} onMouseEnter={() => { setSel(i); setOpen(it.sub ? i : -1); }}
            onClick={(e) => { e.stopPropagation(); act(i); }}>
            {it.icon ?? <span className="ctx-ph" />}
            <span className="ctx-label truncate">{it.label}</span>
            {it.checked && <span aria-hidden>✓</span>}
            {it.keys && <span className="ctx-kbd">{chips(it.keys).join(" ")}</span>}
            {it.sub && <ChevronRight className="ctx-chev" />}
            {it.sub && open === i && lis.current[i] && createPortal(<Menu items={it.sub} sub anchor={lis.current[i]!.getBoundingClientRect()} onDone={onDone} onBack={() => { setOpen(-1); ref.current?.focus(); }} />, document.querySelector(".ctx-layer") ?? document.body)}
          </li>
        );
      })}
    </ul>
  );
}

type Props = { x: number; y: number; items: Item[]; onClose: () => void; out?: boolean };

export default function ContextMenu({ x, y, items, onClose, out }: Props) {
  const [closing, setClosing] = useState(false);
  const [pos, setPos] = useState({ x, y });
  const box = useRef<HTMLDivElement>(null);

  // 画面の外に出ないように位置を直す
  useLayoutEffect(() => {
    const m = box.current?.querySelector(".ctx") as HTMLElement | null; // 外枠は大きさが 0 なので、メニュー本体を測る
    if (!m) return;
    setPos({ x: Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8)), y: Math.max(8, Math.min(y, innerHeight - m.offsetHeight - 8)) });
  }, [x, y]);

  const done = () => { setClosing(true); setTimeout(onClose, ms(110)); };

  // メニューの外を右クリックしたら、いまのメニューを閉じて、その場所の右クリックとしてやり直す(消えるだけにしない)
  const reopen = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.target !== e.currentTarget) return;
    const layer = e.currentTarget, prev = layer.style.pointerEvents;
    layer.style.pointerEvents = "none";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    layer.style.pointerEvents = prev;
    if (!under || under === document.documentElement || under === document.body) { done(); return; }
    onClose();
    under.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2, view: window }));
  };

  useEffect(() => {
    const h = () => onClose();
    addEventListener("resize", h); addEventListener("blur", h);
    return () => { removeEventListener("resize", h); removeEventListener("blur", h); };
  }, [onClose]);

  return (
    <div ref={box} className="ctx-layer" data-out={out || closing} onMouseDown={(e) => { if (e.target === e.currentTarget && e.button !== 2) done(); }} onContextMenu={(e) => reopen(e)}>
      <div data-closing={closing || !!out} style={{ position: "fixed", left: pos.x, top: pos.y }} className="ctx-wrap">
        <Menu items={items} onDone={done} />
      </div>
    </div>
  );
}
