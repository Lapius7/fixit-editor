import { useRef, useState } from "react";
import { Moon, Sun, MonitorCog, RotateCcw, Shuffle, Trash2 } from "lucide-react";
import { ACCENTS, CATS, MAX_DOTS, SWATCHES, isChanged, isDark, resetOne, update, useSettings, type AnyDef, type Dot, type Mode } from "@/features/settings/settings";
import i18next from 'i18next'
import { Select } from "@/shared/Select";
import { Trans } from 'react-i18next'

const MODES: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: "light", label: "ライト", icon: <Sun /> },
  { id: "dark", label: "ダーク", icon: <Moon /> },
  { id: "auto", label: "自動", icon: <MonitorCog /> },
];

// 設定画面と、右のテーマパネルで共有する部品
/* 設定の一覧を、定義から自動で並べる */
export function Rows({ defs, flat }: { defs: AnyDef[]; flat?: boolean }) {
  const label = (c: string) => i18next.t(CATS.find((x) => x.id === c)?.label ?? c);
  return (
    <div className="set-rows">
      {defs.map((d, i) => {
        const prev = defs[i - 1];
        const head = flat ? (!prev || prev.cat !== d.cat ? label(d.cat) : null) : d.sec && d.sec !== prev?.sec ? i18next.t(d.sec) : null;
        return (
          <div key={d.id} style={{ display: "contents" }}>
            {head && <h3 className="set-h">{head}</h3>}
            <Row d={d} />
          </div>
        );
      })}
    </div>
  );
}

export function Row({ d }: { d: AnyDef }) {
  const s = useSettings() as unknown as Record<string, unknown>;
  const v = s[d.id];
  const set = (x: unknown) => update({ [d.id]: x } as never);
  const label = <div className="set-l"><span>{i18next.t(d.label)}</span>{d.hint && <small>{i18next.t(d.hint)}</small>}</div>;
  let ctl: React.ReactNode = null;
  if (d.kind === "bool") ctl = <button className="switch" role="switch" aria-checked={v as boolean} aria-label={i18next.t(d.label)} onClick={() => set(!v)} />;
  else if (d.kind === "enum") {
    const o = d.opts ?? [];
    // ボタンに収まらない長さの選択肢は、セレクトにする(CJK の字は幅 2、英数は 1 として数える)
    const w = (t: string) => [...i18next.t(t)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
    const fits = o.length <= 3 ? o.every(([, t]) => w(t) <= 14) : o.every(([, t]) => w(t) <= 8);
    ctl = o.length <= 4 && fits
      ? <div className="seg" role="group" aria-label={i18next.t(d.label)}>{o.map(([k, t]) => <button key={k} aria-pressed={v === k} onClick={() => set(k)}>{i18next.t(t)}</button>)}</div>
      : <Select value={v as string} options={o.map(([k, t]) => ({ value: k, label: i18next.t(t) }))} label={i18next.t(d.label)} onChange={set} />;
  } else {
    const min = d.min ?? 0, max = d.max ?? 100, step = d.step ?? 1, n = v as number;
    const fill = max > min ? ((n - min) / (max - min)) * 100 : 0;
    ctl = (
      <div className="range">
        <input type="range" min={min} max={max} step={step} value={n} aria-label={i18next.t(d.label)} style={{ ["--fill" as string]: `${fill}%` }} onChange={(e) => set(+e.target.value)} />
        <output>{d.def !== undefined && step < 1 ? n.toFixed(1) : n}{d.unit ? i18next.t(d.unit) : ""}</output>
      </div>
    );
  }
  return (
    <div className="set-row" data-changed={isChanged(d)}>
      {label}
      <div className="set-c">
        {ctl}
        <button className="icon-btn set-reset" aria-label={i18next.t("{{label}}を初期値に戻す", { label: i18next.t(d.label) })} title={i18next.t("初期値に戻す")} style={{ visibility: isChanged(d) ? "visible" : "hidden" }} onClick={() => resetOne(d.id)}><RotateCcw /></button>
      </div>
    </div>
  );
}

export function Look() {
  const s = useSettings();
  const [at, setAt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const cur = s.dots[Math.min(at, s.dots.length - 1)];

  const pos = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))), y: Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100))) };
  };
  const setDot = (i: number, p: Partial<Dot>) => update({ dots: s.dots.map((d, j) => (j === i ? { ...d, ...p } : d)) });
  const dark = isDark(s);

  return (
    <>
      <section className="set-sec">
        <h3><Trans i18nKey="テーマ" /></h3>
        <div className="set-row">
          <div><Trans i18nKey="モード" /><small><Trans i18nKey="ライト・ダーク・OS に合わせる" /></small></div>
          <div className="seg" role="group" aria-label={i18next.t("テーマのモード")}>
            {MODES.map((m) => <button key={m.id} aria-pressed={s.mode === m.id} onClick={() => update({ mode: m.id })}>{m.icon}{i18next.t(m.label)}</button>)}
          </div>
        </div>
        <div className="set-row">
          <div><Trans i18nKey="アクセントカラー" /><small><Trans i18nKey="選択・カーソル・ボタンの色" /></small></div>
          <div className="sw-row" style={{ padding: 0 }}>
            {ACCENTS.map((c) => <button key={c} className="sw" aria-label={c} data-on={s.accent === c} style={{ background: c }} onClick={() => update({ accent: c })} />)}
            <label className="sw sw-custom" aria-label={i18next.t("自由に選ぶ")}><input type="color" value={s.accent} onChange={(e) => update({ accent: e.target.value })} /></label>
          </div>
        </div>
      </section>

      <section className="set-sec">
        <h3><Trans i18nKey="背景の色" /></h3>
        <div className="mesh-wrap">
          <div
            ref={box} className="mesh" aria-label={i18next.t("色の点を動かして背景を作る")}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest(".mesh-dot")) return;
              if (s.dots.length >= MAX_DOTS) return;
              const p = pos(e);
              update({ dots: [...s.dots, { ...p, c: SWATCHES[(s.dots.length * 3 + 1) % SWATCHES.length] }] });
              setAt(s.dots.length);
            }}
            onPointerMove={(e) => { if (drag.current !== null) setDot(drag.current, pos(e)); }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            {s.dots.map((d, i) => (
              <button
                key={i} className="mesh-dot" data-on={i === at} aria-label={i18next.t("色の点 {{arg0}}", { arg0: i + 1 })} style={{ left: `${d.x}%`, top: `${d.y}%`, background: d.c }}
                onPointerDown={(e) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = i; setAt(i); }}
                onKeyDown={(e) => {
                  const st = e.shiftKey ? 10 : 2, m: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
                  if (m[e.key]) { e.preventDefault(); setDot(i, { x: Math.min(100, Math.max(0, d.x + m[e.key][0])), y: Math.min(100, Math.max(0, d.y + m[e.key][1])) }); }
                }}
              />
            ))}
          </div>
          <div className="sw-row">
            {SWATCHES.map((c) => <button key={c} className="sw" aria-label={c} data-on={cur?.c.toLowerCase() === c} style={{ background: c }} onClick={() => setDot(at, { c })} />)}
            <label className="sw sw-custom" aria-label={i18next.t("自由に選ぶ")}><input type="color" value={cur?.c ?? "#ffffff"} onChange={(e) => setDot(at, { c: e.target.value })} /></label>
          </div>
          <div className="mesh-tools">
            <button className="btn" onClick={() => update({ dots: s.dots.map((d) => ({ ...d, x: 8 + Math.round(Math.random() * 84), y: 8 + Math.round(Math.random() * 84), c: SWATCHES[1 + Math.floor(Math.random() * (SWATCHES.length - 1))] })) })}>
              <Shuffle size={14} style={{ verticalAlign: -2, marginRight: 6 }} /><Trans i18nKey="ランダム" />
            </button>
            <button className="btn" disabled={s.dots.length <= 1} onClick={() => { update({ dots: s.dots.filter((_, i) => i !== at) }); setAt(0); }}>
              <Trash2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} /><Trans i18nKey="この点を消す" />
            </button>
            <span className="chip" title={dark ? i18next.t("ダークでは暗くなります") : ""}><i style={{ background: cur?.c }} />{cur?.c.toUpperCase()}</span>
          </div>
        </div>
        <p style={{ margin: "8px 2px 0", fontSize: 12, color: "var(--ink-3)" }}><Trans i18nKey="点をドラッグで動かし、空いた所をクリックすると点が増えます(最大" /> {MAX_DOTS}<Trans i18nKey=")。矢印キーでも動かせます。" /></p>
      </section>
    </>
  );
}
