import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Minus, Plus, RotateCcw, Settings2 } from "lucide-react";
import { EditorView } from "@codemirror/view";
import { DEFS, ms, update, useSettings } from "@/features/settings/settings";
import { Trans } from 'react-i18next'
import i18next from 'i18next'
import { LSP_SERVERS, phaseText } from "@/editor/lsp/servers";
import { briefErr, lspStats, restart, useLspRunning, type Running } from "@/editor/lsp/session";
import { LSP_STATS_HIST, LSP_STATS_MS } from "@/shared/config";

// 状態バーの項目を押すと、真上にひらく小さな設定パネル
export type PopKind = "goto" | "indent" | "eol" | "wrap" | "zoom" | "lang" | "enc" | "lsp";

type Props = {
  kind: PopKind; view: EditorView | null; eol: "lf" | "crlf"; lang: string;
  onEol: (v: "lf" | "crlf") => void; onClose: () => void; out?: boolean;
  lspKey?: string | null; onSettings?: (cat: string) => void;
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

// 動いている言語サーバーの負荷を、ひらいている間だけ測り直す(CPU は 1 コアを 100% とした使用率)
type Load = { cpu: number | null; mem: number; hist: number[] };
function useLspLoad(rows: Running[]): Record<string, Load> {
  const [load, setLoad] = useState<Record<string, Load>>({});
  const sig = rows.filter((r) => r.status.phase === "ready" || r.status.phase === "busy").map((r) => r.key).join("\n");
  useEffect(() => {
    if (!sig) { setLoad({}); return; }
    const keys = sig.split("\n");
    let gone = false, busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      const res = await Promise.all(keys.map(async (k) => [k, await lspStats(k)] as const));
      busy = false;
      if (gone) return;
      setLoad((prev) => {
        const next: Record<string, Load> = {};
        for (const [k, r] of res) {
          if (!r) continue;
          const h = prev[k]?.hist ?? [];
          next[k] = { cpu: r.cpu, mem: r.mem, hist: r.cpu === null ? h : [...h, r.cpu].slice(-LSP_STATS_HIST) };
        }
        return next;
      });
    };
    void tick();
    const t = setInterval(() => void tick(), LSP_STATS_MS);
    return () => { gone = true; clearInterval(t); };
  }, [sig]);
  return load;
}

const fmtMem = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`);
const baseOf = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

// CPU の推移(右が最新)。縦は 20% か、これまでの最大のうち大きいほうを上端にする
function Spark({ hist }: { hist: number[] }) {
  const W = 64, H = 16, top = Math.max(20, ...hist);
  const step = W / (LSP_STATS_HIST - 1);
  const pts = hist.map((v, i) => `${(W - (hist.length - 1 - i) * step).toFixed(1)},${(H - 1 - (v / top) * (H - 2)).toFixed(1)}`).join(" ");
  return <svg className="sbp-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">{hist.length > 1 && <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}</svg>;
}

function RunningList() {
  const rows = useLspRunning();
  const load = useLspLoad(rows);
  return (
    <>
      <div className="sbp-title sbp-sub"><Trans i18nKey="動作中のサーバー" /></div>
      {rows.length === 0 && <p className="sbp-hint"><Trans i18nKey="起動している言語サーバーはありません" /></p>}
      {rows.map((r) => {
        const l = load[r.key];
        return (
          <div key={r.key} className="sbp-run" title={r.path}>
            <div className="sbp-run-h">
              <b>{baseOf(r.path)}<i>{r.kind === "wsl" ? "WSL" : "PC"}</i></b>
              <small data-bad={r.status.phase === "error"}>{phaseText(r.status.phase)}</small>
            </div>
            <div className="sbp-run-m">
              <span className="sbp-v"><em>CPU</em>{l ? (l.cpu === null ? "—" : `${l.cpu.toFixed(l.cpu < 10 ? 1 : 0)}%`) : "—"}</span>
              <Spark hist={l?.hist ?? []} />
              <span className="sbp-v"><em><Trans i18nKey="メモリ" /></em>{l ? fmtMem(l.mem) : "—"}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

// 言語サーバー。左に言語の一覧だけを出し、押した言語の設定を右に開く
function LspList({ lspKey, sel, onSel, onSettings }: { lspKey: string | null; sel: string | null; onSel: (id: string | null) => void; onSettings?: (cat: string) => void }) {
  const s = useSettings();
  const run = useLspRunning();
  // 言語ごとの状態。開いているフォルダのものを先に、なければ動いているものの先頭を使う
  const of = (id: string) => run.find((r) => r.server === id && r.key === lspKey) ?? run.find((r) => r.server === id);
  return (
    <>
      <div className="sbp-title"><Trans i18nKey="言語サーバー" /></div>
      <div className="sbp-lsp-list">
        {LSP_SERVERS.map((sv) => {
          const o = s[sv.on], e = of(sv.id)?.status?.phase === "error";
          return (
            <button key={sv.id} className="sbp-lang" data-sel={sv.id === sel} data-on={o} data-bad={o && e} aria-expanded={sv.id === sel} onClick={() => onSel(sv.id === sel ? null : sv.id)}>
              <span>{sv.name}</span><ChevronRight />
            </button>
          );
        })}
      </div>
      <RunningList />
      <button className="sbp-opt" onClick={() => onSettings?.("lsp")}><span><Trans i18nKey="言語サーバーの設定" /></span><Settings2 /></button>
    </>
  );
}

// 言語を押すと、一覧の右に開く小さなウィンドウ。その言語の入り切りと、共通の機能
function LspDetail({ id, lspKey }: { id: string; lspKey: string | null }) {
  const s = useSettings();
  const run = useLspRunning();
  const feats = [["tsLspDiag", i18next.t("エラーの波線")], ["tsLspComplete", i18next.t("補完")], ["tsLspHover", i18next.t("ホバーで型を表示")], ["tsLspDef", i18next.t("定義へ移動")], ["tsLspSig", i18next.t("引数のヒント")], ["tsLspRefs", i18next.t("参照の検索")], ["tsLspRename", i18next.t("名前の変更")], ["tsLspAction", i18next.t("コードアクション")], ["tsLspInlay", i18next.t("インレイヒント")]] as const;
  const cur = LSP_SERVERS.find((x) => x.id === id);
  if (!cur) return null;
  const on = s[cur.on];
  const r = run.find((x) => x.server === id && x.key === lspKey) ?? run.find((x) => x.server === id);
  const st = r?.status;
  return (
    <>
      <div className="sbp-row">
        <span className="sbp-srv-n"><b>{cur.name}</b><small data-bad={on && st?.phase === "error"}>{!on ? phaseText("off") : st ? phaseText(st.phase) : i18next.t("待機中")}{on && st?.version ? ` · ${st.version}` : ""}</small></span>
        <button className="switch" role="switch" aria-checked={on} aria-label={cur.name} onClick={() => update({ [cur.on]: !on })} />
      </div>
      {on && st?.phase === "error" && <div className="sbp-hint" data-bad="true" title={st.err}>{briefErr(st.err)}</div>}
      {on && r && st?.phase === "error" && <button className="sbp-opt" onClick={() => restart(r.key)}><span><Trans i18nKey="再起動" /></span><RotateCcw /></button>}
      {on && <div className="sbp-title sbp-sub"><Trans i18nKey="共通の機能" /></div>}
      {on && feats.map(([fid, label]) => <Row key={fid} label={label}><button className="switch" role="switch" aria-checked={s[fid]} aria-label={label} onClick={() => update({ [fid]: !s[fid] })} /></Row>)}
    </>
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


export default function StatusPop({ kind, view, eol, lang, onEol, onClose, out, lspKey, onSettings }: Props) {
  const s = useSettings();
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; bottom: number; max: number; origin: string } | null>(null);
  const sub = useRef<HTMLDivElement>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number; max: number; origin: string; dir: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [sel, setSel] = useState<string | null>(null);

  const close = () => { setClosing(true); setTimeout(onClose, ms(120)); };

  // 押された項目の真上に置く。画面の端からはみ出さないよう寄せる
  useLayoutEffect(() => {
    const a = document.querySelector<HTMLElement>(`[data-pop="${kind}"]`)?.getBoundingClientRect();
    const w = box.current!.offsetWidth;
    const cx = a ? a.left + a.width / 2 : innerWidth / 2;
    const left = clamp(cx - w / 2, 8, innerWidth - w - 8);
    const bottom = innerHeight - (a ? a.top : innerHeight - 30) + 6;
    // 項目が多いとき(言語サーバーなど)は、画面の上にはみ出さず、中をスクロールする
    setPos({ left, bottom, max: Math.max(160, innerHeight - bottom - 8), origin: `${cx - left}px 100%` });
  }, [kind]);

  // 言語の右に、別の小さなウィンドウを並べる。右に入らなければ左に出し、上下は画面内に収める
  useLayoutEffect(() => {
    if (kind !== "lsp" || !sel || !box.current || !sub.current) { setSubPos(null); return; }
    const m = box.current.getBoundingClientRect();
    const w = sub.current.offsetWidth, h = sub.current.offsetHeight;
    const left = m.right + 8 + w <= innerWidth - 8 ? m.right + 8 : Math.max(8, m.left - w - 8);
    const max = innerHeight - 16;
    // 上端は左のウィンドウにそろえる。入りきらないときだけ上へずらす
    const top = clamp(m.top, 8, Math.max(8, innerHeight - Math.min(h, max) - 8));
    const right = left > m.left;
    setSubPos({ left, top, max, origin: `${right ? "0" : "100%"} 16px`, dir: right ? 1 : -1 });
  }, [kind, sel, pos, s.tsServer, s.pyServer, s.htmlServer, s.cssServer, s.phpServer, s.goServer, s.rsServer, s.rbServer, s.sqlServer]);

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
  } else if (kind === "lsp") body = <LspList lspKey={lspKey ?? null} sel={sel} onSel={setSel} onSettings={(c) => { close(); onSettings?.(c); }} />;
  else if (kind === "lang") {
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
        style={pos ? { left: pos.left, bottom: pos.bottom, maxHeight: pos.max, transformOrigin: pos.origin } : { left: 0, bottom: 0 }}
        onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); view?.focus(); } }}>
        {body}
      </div>
      {kind === "lsp" && sel && (
        <div ref={sub} key={sel} className="sbp sbp-sub-win" role="dialog" aria-label={i18next.t("言語サーバー")} data-closing={closing || !!out}
          style={subPos ? { left: subPos.left, top: subPos.top, maxHeight: subPos.max, transformOrigin: subPos.origin, ['--dx' as string]: `${-8 * subPos.dir}px` } : { left: 0, top: 0, visibility: "hidden" }}
          onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); view?.focus(); } }}>
          <LspDetail id={sel} lspKey={lspKey ?? null} />
        </div>
      )}
    </div>
  );
}
