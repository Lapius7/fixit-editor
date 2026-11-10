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

// 親(grid)の中で、左右の比率(0〜1)を変える持ち手。ダブルクリックで半分ずつに戻す
export function RatioGrip({ ratio, onChange, min = 0.15, max = 0.85 }: { ratio: number; onChange: (r: number) => void; min?: number; max?: number }) {
  const [drag, setDrag] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget, box = el.parentElement!.getBoundingClientRect();
    el.setPointerCapture(e.pointerId);
    setDrag(true);
    const mv = (ev: PointerEvent) => onChange(clamp((ev.clientX - box.left) / box.width));
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); setDrag(false); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (d) { e.preventDefault(); onChange(clamp(ratio + d * (e.shiftKey ? 0.1 : 0.02))); }
  };
  return (
    <div className="col-grip ratio-grip" data-drag={drag} role="separator" aria-orientation="vertical" tabIndex={0} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={Math.round(min * 100)} aria-valuemax={Math.round(max * 100)}
      title={i18next.t("ドラッグで幅を変える・ダブルクリックで元の幅に戻す")} onPointerDown={down} onDoubleClick={() => onChange(0.5)} onKeyDown={key} />
  );
}
