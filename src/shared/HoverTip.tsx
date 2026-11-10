// タブやファイル一覧にカーソルを置くと、ファイル名(長くても全部)と場所を、ガラス調のカードで出す。
// 出したい要素に data-tip="名前" data-tip-sub="場所" を付けるだけ。イベントは document でまとめて受ける。
import { useEffect, useRef, useState } from "react";
import { ms } from "@/features/settings/settings";

type Tip = { name: string; sub: string; x: number; y: number; up: boolean };

const FIRST_MS = 1000; // 最初に出すまでの待ち
const NEXT_MS = 300; // 直前に出していたとき(隣へ移ったとき)の待ち
const GAP = 8;

export default function HoverTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [show, setShow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cur = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastShown = useRef(0);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current); cur.current = null;
      setShow((s) => { if (s) lastShown.current = Date.now(); return false; });
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tip]") ?? null;
      if (el === cur.current) return;
      if (!el) return hide();
      clearTimeout(timer.current); cur.current = el;
      const wait = Date.now() - lastShown.current < 400 ? NEXT_MS : FIRST_MS;
      timer.current = setTimeout(() => {
        if (cur.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ name: el.dataset.tip ?? "", sub: el.dataset.tipSub ?? "", x: r.left, y: r.bottom, up: false });
        setShow(true);
        // 実寸が分かってから、はみ出さない位置に直す
        requestAnimationFrame(() => {
          const b = box.current; if (!b || cur.current !== el) return;
          const w = b.offsetWidth, h = b.offsetHeight, rr = el.getBoundingClientRect();
          const up = rr.bottom + GAP + h > innerHeight - 8 && rr.top - GAP - h > 8;
          setTip((t) => t && { ...t, x: Math.max(8, Math.min(rr.left, innerWidth - w - 8)), y: up ? rr.top : rr.bottom, up });
        });
      }, ms(wait));
    };
    const opts = { capture: true, passive: true } as const;
    document.addEventListener("pointerover", over, opts);
    for (const t of ["pointerdown", "wheel", "scroll", "dragstart", "keydown", "contextmenu"]) document.addEventListener(t, hide, opts);
    addEventListener("blur", hide);
    document.documentElement.addEventListener("pointerleave", hide);
    return () => {
      document.removeEventListener("pointerover", over, opts);
      for (const t of ["pointerdown", "wheel", "scroll", "dragstart", "keydown", "contextmenu"]) document.removeEventListener(t, hide, opts);
      removeEventListener("blur", hide);
      document.documentElement.removeEventListener("pointerleave", hide);
      clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  return (
    <div ref={box} className="hovertip" role="tooltip" data-show={show} data-up={tip.up}
      style={{ left: tip.x, top: tip.up ? undefined : tip.y + GAP, bottom: tip.up ? innerHeight - tip.y + GAP : undefined }}
      onTransitionEnd={() => { if (!show) setTip(null); }}>
      <b>{tip.name}</b>
      {tip.sub && tip.sub !== tip.name && <span>{tip.sub}</span>}
    </div>
  );
}
