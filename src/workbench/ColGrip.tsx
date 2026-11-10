// 左右の面の境目をつかんで幅を変える持ち手。ダブルクリックで初期値へ戻す。
// dir: 右へ動かすと幅が増えるなら 1(サイドバー)、減るなら -1(右側のパネル)
import { useState } from "react";
import i18next from "i18next";

export function ColGrip({ width, def, min, max, dir, onChange, className }: { width: number; def: number; min: number; max: number; dir: 1 | -1; onChange: (w: number) => void; className?: string }) {
  const [drag, setDrag] = useState(false);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width;
    setDrag(true);
    const mv = (ev: PointerEvent) => onChange(clamp(w0 + dir * (ev.clientX - x0)));
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); setDrag(false); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (d) { e.preventDefault(); onChange(clamp(width + dir * d * (e.shiftKey ? 40 : 10))); }
  };
  return (
    <div className={`col-grip ${className ?? ""}`} data-drag={drag} role="separator" aria-orientation="vertical" tabIndex={0} aria-valuenow={width} aria-valuemin={min} aria-valuemax={max}
      title={i18next.t("ドラッグで幅を変える・ダブルクリックで元の幅に戻す")} onPointerDown={down} onDoubleClick={() => onChange(def)} onKeyDown={key} />
  );
}
