import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, Minus, Plus, RotateCcw } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { DEFS, ms, update, useSettings } from "@/features/settings/settings";
import { Trans } from 'react-i18next'
import i18next from 'i18next'

// 状態バーの項目を押すと、真上にひらく小さな設定パネル
export type PopKind = "goto" | "indent" | "eol" | "wrap" | "zoom" | "lang" | "enc";

type Props = {
  kind: PopKind; view: EditorView | null; eol: "lf" | "crlf"; lang: string;
  onEol: (v: "lf" | "crlf") => void; onClose: () => void; out?: boolean;
};

const FONT_DEF = DEFS.find((d) => d.id === "fontSize")!.def as number;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="sbp-row"><span>{label}</span>{children}</div>;
}

function Seg<T extends string | number | boolean>({ value, items, onPick, label }: { value: T; items: [T, string][]; onPick: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {items.map(([v, t]) => <button key={String(v)} aria-pressed={v === value} onClick={() => onPick(v)}>{t}</button>)}
    </div>
  );
}

function Goto({ view, onClose }: { view: EditorView | null; onClose: () => void }) {
  const [v, setV] = useState("");
  const total = view?.state.doc.lines ?? 1;
  const here = view ? view.state.doc.lineAt(view.state.selection.main.head).number : 1;
  const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(v);
  const bad = v.trim() !== "" && !m;
  const go = () => {
    if (!view || !m) return;
    const line = view.state.doc.line(clamp(+m[1] || 1, 1, total));
    const pos = line.from + clamp((m[2] ? +m[2] : 1) - 1, 0, line.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }), userEvent: "select" });
    onClose();
    view.focus();
  };
  return (
    <>
      <div className="sbp-title"><Trans i18nKey="行へ移動" /></div>
      <input className="field sbp-in" autoFocus inputMode="numeric" spellCheck={false} aria-label={i18next.t("行番号")} placeholder={`${here}`} value={v}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); go(); } }} />
      <p className="sbp-hint" data-bad={bad}>{bad ? i18next.t("数字で入れてください(例: 120 または 120:8)") : i18next.t("1 〜 {{total}} 行。「行:列」でも指定できます", { total })}</p>
    </>
  );
}

export default function StatusPop({ kind, view, eol, lang, onEol, onClose, out }: Props) {
  const s = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; origin: string } | null>(null);
  const [closing, setClosing] = useState(false);

  const close = () => { setClosing(true); setTimeout(onClose, ms(120)); };

  // 押された項目の真上に置く。画面の端からはみ出さないよう寄せる
  useLayoutEffect(() => {
    const a = document.querySelector<HTMLElement>(`[data-pop="${kind}"]`)?.getBoundingClientRect();
    const w = box.current!.offsetWidth;
    const cx = a ? a.left + a.width / 2 : innerWidth / 2;
    const left = clamp(cx - w / 2, 8, innerWidth - w - 8);
    setPos({ left, bottom: innerHeight - (a ? a.top : innerHeight - 30) + 6, origin: `${cx - left}px 100%` });
  }, [kind]);

  let body: ReactNode;
  if (kind === "goto") body = <Goto view={view} onClose={close} />;
  else if (kind === "indent") {
    const sizes = [2, 3, 4, 6, 8];
    if (!sizes.includes(s.tabSize)) sizes.push(s.tabSize);
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="インデント" /></div>
        <Row label={i18next.t("入れるもの")}><Seg label={i18next.t("インデントの種類")} value={s.insertSpaces} items={[[true, i18next.t("スペース")], [false, i18next.t("タブ")]]} onPick={(v) => update({ insertSpaces: v })} /></Row>
        <Row label={i18next.t("幅")}><Seg label={i18next.t("インデントの幅")} value={s.tabSize} items={sizes.sort((x, y) => x - y).map((n) => [n, String(n)] as [number, string])} onPick={(v) => update({ tabSize: v })} /></Row>
      </>
    );
  } else if (kind === "eol") {
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="改行コード" /></div>
        {(["lf", "crlf"] as const).map((v) => (
          <button key={v} className="sbp-opt" data-on={eol === v} onClick={() => { if (eol !== v) onEol(v); close(); }}>
            <span>{v === "lf" ? "LF" : "CRLF"}<small>{v === "lf" ? i18next.t("Mac・Linux") : "Windows"}</small></span>{eol === v && <Check />}
          </button>
        ))}
        <p className="sbp-hint"><Trans i18nKey="変えると、保存したときに反映されます" /></p>
      </>
    );
  } else if (kind === "wrap") {
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="表示" /></div>
        <Row label={i18next.t("長い行を折り返す")}><button className="switch" role="switch" aria-checked={s.wrap} aria-label={i18next.t("長い行を折り返す")} onClick={() => update({ wrap: !s.wrap })} /></Row>
        <Row label={i18next.t("行番号")}><button className="switch" role="switch" aria-checked={s.lineNumbers} aria-label={i18next.t("行番号")} onClick={() => update({ lineNumbers: !s.lineNumbers })} /></Row>
        <Row label={i18next.t("空白文字")}><Seg label={i18next.t("空白文字の表示")} value={s.whitespace} items={[["off", i18next.t("なし")], ["trailing", i18next.t("行末")], ["all", i18next.t("すべて")]]} onPick={(v) => update({ whitespace: v })} /></Row>
      </>
    );
  } else if (kind === "zoom") {
    const set = (n: number) => update({ fontSize: clamp(Math.round(n * 2) / 2, 10, 28) });
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="文字の大きさ" /></div>
        <div className="sbp-zoom">
          <button className="icon-btn" aria-label={i18next.t("小さくする")} onClick={() => set(s.fontSize - 0.5)}><Minus /></button>
          <input type="range" min={10} max={28} step={0.5} value={s.fontSize} aria-label={i18next.t("文字の大きさ")} onChange={(e) => set(+e.target.value)} />
          <button className="icon-btn" aria-label={i18next.t("大きくする")} onClick={() => set(s.fontSize + 0.5)}><Plus /></button>
          <b>{s.fontSize}px</b>
        </div>
        <button className="sbp-opt" disabled={s.fontSize === FONT_DEF} onClick={() => set(FONT_DEF)}><span><Trans i18nKey="標準(" />{FONT_DEF}<Trans i18nKey="px)に戻す" /></span><RotateCcw /></button>
      </>
    );
  } else if (kind === "lang") {
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="言語" /></div>
        <Row label={i18next.t("いまのファイル")}><b>{lang}</b></Row>
        <p className="sbp-hint"><Trans i18nKey="言語は、ファイルの拡張子から自動で選ばれます" /></p>
      </>
    );
  } else {
    body = (
      <>
        <div className="sbp-title"><Trans i18nKey="文字コード" /></div>
        <Row label={i18next.t("読み書き")}><b>UTF-8</b></Row>
      </>
    );
  }

  return (
    <div className="ctx-layer" data-out={out || closing} onMouseDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
      <div ref={box} className="sbp" role="dialog" aria-label={i18next.t("状態バーの設定")} data-closing={closing || !!out} data-kind={kind}
        style={pos ? { left: pos.left, bottom: pos.bottom, transformOrigin: pos.origin } : { left: 0, bottom: 0 }}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); view?.focus(); } }}>
        {body}
      </div>
    </div>
  );
}
