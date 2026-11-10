import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Crop, FileX2, Pencil, Link2, Maximize, Redo2, RotateCcw, RotateCw, Save, Scaling, SlidersHorizontal, TrianglesCenterlineDashedHorizontal, TrianglesCenterlineDashedVertical, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import i18next from "i18next";
import { notify } from "@/shared/notify";
import { copyImage } from "@/shared/clipimage";
import { ms } from "@/features/settings/settings";
import { ask } from "@/shared/ask";

// 画像ビューア。拡大・縮小・ドラッグ移動と、切り抜き・回転・反転・サイズ変更・色の調整
export const IMAGE_SAVE = "fixit:image-save";

const HIST = 12; // 元に戻せる回数(大きな画像はメモリを使うので多くしない)
const MAX_SIDE = 16384, MAX_AREA = 100_000_000;
const PAD = 24;
const EDITABLE = /\.(png|jpe?g|webp|gif|bmp|avif|ico)$/i;
const SAME_FORMAT = /\.(png|jpe?g|webp)$/i;
const ASPECTS: [string, number | null][] = [["", null], ["1:1", 1], ["4:3", 4 / 3], ["16:9", 16 / 9], ["3:2", 3 / 2]];
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

type Mode = "crop" | "resize" | "adjust" | null;
type Box = { x: number; y: number; w: number; h: number };
type P = { x: number; y: number };
type Adj = { b: number; c: number; s: number; blur: number; gray: boolean; inv: boolean };
const ADJ0: Adj = { b: 100, c: 100, s: 100, blur: 0, gray: false, inv: false };

const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const mk = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const g2 = (c: HTMLCanvasElement) => c.getContext("2d")!;

// 保存する形式。png / jpg / webp はそのまま上書き、それ以外は同じ名前の .png にする
function outFor(name: string): { name: string; type: string } {
  if (SAME_FORMAT.test(name)) {
    const e = name.split(".").pop()!.toLowerCase();
    return { name, type: e === "png" ? "image/png" : e === "webp" ? "image/webp" : "image/jpeg" };
  }
  const dot = name.lastIndexOf(".");
  return { name: `${dot > 0 ? name.slice(0, dot) : name}.png`, type: "image/png" };
}

const filterOf = (a: Adj, k = 1) =>
  `brightness(${a.b}%) contrast(${a.c}%) saturate(${a.s}%)${a.blur ? ` blur(${a.blur * k}px)` : ""}${a.gray ? " grayscale(1)" : ""}${a.inv ? " invert(1)" : ""}`;

// 比率を保って、選択範囲を中心はそのままに合わせ直す
function applyRatio(b: Box, r: number, W: number, H: number): Box {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const w = Math.min(b.w, b.h * r, W, H * r), h = w / r;
  return { x: cl(cx - w / 2, 0, W - w), y: cl(cy - h / 2, 0, H - h), w, h };
}

// ドラッグ中の選択範囲。kind は move / new / 角(nw ne sw se) / 辺(n e s w)
function dragBox(kind: string, b0: Box, p0: P, p: P, r: number | null, W: number, H: number): Box {
  if (kind === "move") return { ...b0, x: cl(b0.x + p.x - p0.x, 0, W - b0.w), y: cl(b0.y + p.y - p0.y, 0, H - b0.h) };
  if (kind === "new" || kind.length === 2) {
    const a = kind === "new" ? p0 : { x: kind.includes("w") ? b0.x + b0.w : b0.x, y: kind.includes("n") ? b0.y + b0.h : b0.y };
    const sx = p.x < a.x ? -1 : 1, sy = p.y < a.y ? -1 : 1;
    let w = Math.abs(p.x - a.x), h = Math.abs(p.y - a.y);
    if (r) { w = Math.min(w, h * r, sx > 0 ? W - a.x : a.x, (sy > 0 ? H - a.y : a.y) * r); h = w / r; }
    return { x: sx > 0 ? a.x : a.x - w, y: sy > 0 ? a.y : a.y - h, w, h };
  }
  const horiz = kind === "e" || kind === "w";
  if (!r) {
    let l = b0.x, t = b0.y, rr = b0.x + b0.w, bb = b0.y + b0.h;
    if (kind === "w") l = p.x; else if (kind === "e") rr = p.x; else if (kind === "n") t = p.y; else bb = p.y;
    return { x: Math.min(l, rr), y: Math.min(t, bb), w: Math.abs(rr - l), h: Math.abs(bb - t) };
  }
  if (horiz) {
    const fx = kind === "e" ? b0.x : b0.x + b0.w, cy = b0.y + b0.h / 2, sg = p.x < fx ? -1 : 1;
    const w = Math.min(Math.abs(p.x - fx), sg > 0 ? W - fx : fx, 2 * Math.min(cy, H - cy) * r), h = w / r;
    return { x: sg > 0 ? fx : fx - w, y: cy - h / 2, w, h };
  }
  const fy = kind === "s" ? b0.y : b0.y + b0.h, cx = b0.x + b0.w / 2, sg = p.y < fy ? -1 : 1;
  const h = Math.min(Math.abs(p.y - fy), sg > 0 ? H - fy : fy, (2 * Math.min(cx, W - cx)) / r), w = h * r;
  return { x: cx - w / 2, y: sg > 0 ? fy : fy - h, w, h };
}

const roundBox = (b: Box, W: number, H: number): Box => {
  const w = cl(Math.round(b.w), 1, W), h = cl(Math.round(b.h), 1, H);
  return { x: cl(Math.round(b.x), 0, W - w), y: cl(Math.round(b.y), 0, H - h), w, h };
};

type Props = { id: string; url: string; name: string; onSave?: (blob: Blob, outName: string) => Promise<void> };
type PaneProps = Props & { edit: boolean; onEdit?: () => void; onDirty?: (d: boolean) => void };

// 開いただけのときは見るだけ。編集は「編集」ボタンのモーダルで行う(外側をクリックしても閉じない)
export default function ImageView(p: Props) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [closing, setClosing] = useState(false);
  const can = !!p.onSave && EDITABLE.test(p.name);
  const close = async (force?: boolean) => {
    if (!force && dirty && !(await ask({ message: i18next.t("編集した内容を破棄しますか?"), ok: i18next.t("破棄する"), danger: true }))) return;
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); setDirty(false); }, ms(180));
  };
  return (
    <>
      <Pane {...p} edit={false} onEdit={can ? () => setOpen(true) : undefined} />
      {open && createPortal(
        <div className="qo-backdrop" data-mid data-closing={closing}>
          <div className="qo dlg ie" role="dialog" aria-modal="true" aria-label={i18next.t("画像を編集")}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
            <div className="ie-head">
              <h2>{i18next.t("画像を編集")}<span className="ie-name">{p.name}</span></h2>
              <button className="btn close-btn" onClick={() => close()}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
            </div>
            <Pane {...p} edit onDirty={setDirty} onSave={async (b, n) => { await p.onSave!(b, n); close(true); }} />
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function Pane({ id, url, name, onSave, edit, onEdit, onDirty }: PaneProps) {
  const editable = edit && !!onSave && EDITABLE.test(name);
  const [st, setSt] = useState<{ items: HTMLCanvasElement[]; i: number } | null>(null);
  const [bad, setBad] = useState(false);
  const orig = useRef<HTMLCanvasElement | null>(null);
  const saved = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [sel, setSel] = useState<Box>({ x: 0, y: 0, w: 1, h: 1 });
  const [asp, setAsp] = useState<number | null>(null);
  const [rs, setRs] = useState({ w: 1, h: 1, lock: true });
  const [adj, setAdj] = useState<Adj>(ADJ0);
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dispRef = useRef<HTMLCanvasElement>(null);
  const anchor = useRef<{ fx: number; fy: number; px: number; py: number } | null>(null);
  const [grab, setGrab] = useState(false);
  const pan = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);

  const cur = st ? st.items[st.i] : null;
  const W = cur?.width ?? 0, H = cur?.height ?? 0;
  const dirty = !!cur && cur !== saved.current;
  const showImg = !cur || cur === orig.current; // 手を加えるまでは元の画像をそのまま出す(GIF の動きと SVG の鮮明さを保つ)
  const out = outFor(name);
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (edit) root.current?.focus(); }, [edit]);
  const [zin, setZin] = useState<string | null>(null);
  const fresh = useRef(false); // 入力欄を押した直後は、全選択を保つ

  // 読み込み(保存して URL が変わったときも、ここでやり直す)
  useEffect(() => {
    let off = false;
    setSt(null); setBad(false); setMode(null); setFit(true);
    const im = new Image();
    im.onload = () => {
      if (off) return;
      const c = mk(im.naturalWidth || 512, im.naturalHeight || 512);
      g2(c).drawImage(im, 0, 0, c.width, c.height);
      orig.current = saved.current = c;
      setSt({ items: [c], i: 0 });
    };
    im.onerror = () => { if (!off) setBad(true); };
    im.src = url;
    return () => { off = true; };
  }, [url]);

  // 表示領域の大きさ
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const on = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    on();
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bad]);

  const ratio = W && box.w ? Math.min((box.w - PAD * 2) / W, (box.h - PAD * 2) / H) : 1;
  const fitS = Math.min(1, ratio);
  const s = fit ? fitS : zoom;
  const dw = Math.max(1, Math.round(W * s)), dh = Math.max(1, Math.round(H * s));
  const sRef = useRef(s);
  sRef.current = s;

  // 手を加えた画像は canvas に描いて見せる
  useLayoutEffect(() => {
    const d = dispRef.current;
    if (!d || !cur) return;
    d.width = cur.width; d.height = cur.height;
    g2(d).drawImage(cur, 0, 0);
  }, [cur, showImg]);

  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const sg = stageRef.current, wr = wrapRef.current;
    if (!sg || !wr || !W) return;
    const r = wr.getBoundingClientRect(), sr = sg.getBoundingClientRect();
    const px = cx ?? sr.left + sr.width / 2, py = cy ?? sr.top + sr.height / 2;
    anchor.current = { fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, px: px - sr.left, py: py - sr.top };
    setFit(false);
    setZoom(cl(z, 0.05, 32));
  };
  // 拡大・縮小のあとも、見ている位置(中心かポインタの下)を動かさない
  useLayoutEffect(() => {
    const a = anchor.current, sg = stageRef.current, wr = wrapRef.current;
    anchor.current = null;
    if (!a || !sg || !wr) return;
    sg.scrollLeft = wr.offsetLeft + a.fx * wr.offsetWidth - a.px;
    sg.scrollTop = wr.offsetTop + a.fy * wr.offsetHeight - a.py;
  }, [zoom, fit]);

  // Ctrl(または ⌘)+ホイールで拡大・縮小
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo(sRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  });

  const down = (e: React.PointerEvent) => {
    if (mode === "crop" || e.button !== 0) return;
    const sg = stageRef.current!;
    pan.current = { x: e.clientX, y: e.clientY, l: sg.scrollLeft, t: sg.scrollTop, moved: false };
    setGrab(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) > 4) p.moved = true;
    if (p.moved) { stageRef.current!.scrollLeft = p.l - dx; stageRef.current!.scrollTop = p.t - dy; }
  };
  const up = () => { pan.current = null; setGrab(false); };

  // 履歴
  const commit = (c: HTMLCanvasElement) => {
    setSt((p) => p && { items: [...p.items.slice(0, p.i + 1), c].slice(-HIST), i: Math.min(p.i + 1, HIST - 1) });
    setMode(null);
  };
  const copy = () => { if (cur) copyImage(cur).then(() => notify(i18next.t("画像をコピーしました")), () => notify(i18next.t("画像をコピーできませんでした"), "error")); };
  const undo = () => setSt((p) => p && p.i > 0 ? { ...p, i: p.i - 1 } : p);
  const redo = () => setSt((p) => p && p.i < p.items.length - 1 ? { ...p, i: p.i + 1 } : p);

  const rotate = (cw: boolean) => {
    if (!cur) return;
    const c = mk(H, W), g = g2(c);
    if (cw) { g.translate(H, 0); g.rotate(Math.PI / 2); } else { g.translate(0, W); g.rotate(-Math.PI / 2); }
    g.drawImage(cur, 0, 0);
    commit(c);
  };
  const flip = (horizontal: boolean) => {
    if (!cur) return;
    const c = mk(W, H), g = g2(c);
    g.translate(horizontal ? W : 0, horizontal ? 0 : H);
    g.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
    g.drawImage(cur, 0, 0);
    commit(c);
  };
  const doCrop = () => {
    if (!cur) return;
    const c = mk(sel.w, sel.h);
    g2(c).drawImage(cur, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
    commit(c);
  };
  const rsOk = rs.w >= 1 && rs.h >= 1 && rs.w <= MAX_SIDE && rs.h <= MAX_SIDE && rs.w * rs.h <= MAX_AREA;
  const doResize = () => {
    if (!cur || !rsOk) return;
    const c = mk(rs.w, rs.h), g = g2(c);
    g.imageSmoothingQuality = "high";
    g.drawImage(cur, 0, 0, rs.w, rs.h);
    commit(c);
  };
  const doAdjust = () => {
    if (!cur) return;
    const c = mk(W, H), g = g2(c);
    if (!("filter" in g)) { notify(i18next.t("この環境では色の調整を使えません"), "error"); return; }
    g.filter = filterOf(adj);
    g.drawImage(cur, 0, 0);
    commit(c);
  };
  const applyMode = () => (mode === "crop" ? doCrop() : mode === "resize" ? doResize() : mode === "adjust" ? doAdjust() : undefined);

  const enter = (m: Exclude<Mode, null>) => {
    if (mode === m) { setMode(null); return; }
    if (!cur) return;
    if (m === "crop") {
      const b = { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.8 };
      setSel(roundBox(asp ? applyRatio(b, asp, W, H) : b, W, H));
    }
    if (m === "resize") setRs((r) => ({ ...r, w: W, h: H }));
    if (m === "adjust") setAdj(ADJ0);
    setMode(m);
  };
  const pickAspect = (r: number | null) => {
    setAsp(r);
    if (r) setSel((b) => roundBox(applyRatio(b, r, W, H), W, H));
  };

  const startCrop = (e: React.PointerEvent, kind: string) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const rect = wrapRef.current!.getBoundingClientRect(), sc = s, b0 = sel, r = asp;
    const pt = (ev: { clientX: number; clientY: number }): P => ({ x: cl((ev.clientX - rect.left) / sc, 0, W), y: cl((ev.clientY - rect.top) / sc, 0, H) });
    const p0 = pt(e);
    const mv = (ev: PointerEvent) => {
      const p = pt(ev);
      if (kind === "new" && Math.hypot(p.x - p0.x, p.y - p0.y) * sc < 3) return;
      setSel(roundBox(dragBox(kind, b0, p0, p, r, W, H), W, H));
    };
    const end = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", end); removeEventListener("pointercancel", end); };
    addEventListener("pointermove", mv); addEventListener("pointerup", end); addEventListener("pointercancel", end);
  };

  const save = async () => {
    if (!cur || !onSave || saving || !dirty) return;
    setSaving(true);
    try {
      let src = cur;
      if (out.type === "image/jpeg") { src = mk(W, H); const g = g2(src); g.fillStyle = "#fff"; g.fillRect(0, 0, W, H); g.drawImage(cur, 0, 0); } // 透明は白で埋める
      const blob = await new Promise<Blob | null>((r) => src.toBlob(r, out.type, 0.92));
      if (!blob) throw new Error(i18next.t("画像を書き出せませんでした"));
      await onSave(blob, out.name);
      if (out.name !== name && orig.current) setSt({ items: [orig.current], i: 0 }); // 別名で保存したときは、元の画像はそのまま
    } catch (e) {
      notify(i18next.t("保存できませんでした: {{m}}", { m: (e as Error).message }), "error");
    } finally { setSaving(false); }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  // Ctrl+S(アプリ全体の保存)から呼ばれる
  useEffect(() => {
    if (!edit) return;
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === id) void saveRef.current(); };
    addEventListener(IMAGE_SAVE, on);
    return () => removeEventListener(IMAGE_SAVE, on);
  }, [id, edit]);

  const key = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement, mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === "Escape" && mode) { e.stopPropagation(); setMode(null); }
    else if (e.key === "Enter" && mode && t.tagName !== "BUTTON") { e.preventDefault(); applyMode(); }
    else if (mod && t.tagName !== "INPUT" && (k === "z" || k === "y")) { e.preventDefault(); e.stopPropagation(); (k === "y" || e.shiftKey) ? redo() : undo(); }
  };

  if (bad) {
    return (
      <div className="view unsupported" role="alert">
        <FileX2 />
        <p className="u-title">{i18next.t("画像を読み込めませんでした")}</p>
        <p className="u-name">{name}</p>
      </div>
    );
  }

  const adjOn = mode === "adjust";
  const style = { width: dw, height: dh, filter: adjOn ? filterOf(adj, s) : undefined };
  const x2 = sel.x + sel.w, y2 = sel.y + sel.h;
  const num = (v: string) => Math.round(Number(v)) || 0;
  const setW = (v: number) => setRs((r) => ({ ...r, w: v, h: r.lock && W ? Math.max(1, Math.round((v * H) / W)) : r.h }));
  const setH = (v: number) => setRs((r) => ({ ...r, h: v, w: r.lock && H ? Math.max(1, Math.round((v * W) / H)) : r.w }));
  const tool = (m: Exclude<Mode, null>, label: string, Icon: typeof Crop) => (
    <button className="icon-btn" aria-label={label} title={label} data-on={mode === m} disabled={!cur} onClick={() => enter(m)}><Icon /></button>
  );
  const act = (label: string, Icon: typeof Crop, fn: () => void, off?: boolean) => (
    <button className="icon-btn" aria-label={label} title={label} disabled={!cur || off} onClick={fn}><Icon /></button>
  );
  // 調整のつまみ。初期値から動かすと値の色が変わり、ダブルクリックで初期値に戻る
  const slider = (k: "b" | "c" | "s" | "blur", label: string, max: number, unit = "%") => {
    const v = adj[k], set = (n: number) => setAdj((a) => ({ ...a, [k]: n }));
    return (
      <label className="iv-rng" data-changed={v !== ADJ0[k] || undefined}>
        <span className="iv-rng-h"><span>{label}</span><output>{v}{unit}</output></span>
        <input type="range" min={0} max={max} step={1} value={v} title={i18next.t("ダブルクリックで元に戻す")} style={{ "--fill": `${(v / max) * 100}%` } as React.CSSProperties}
          onChange={(e) => set(+e.target.value)} onDoubleClick={() => set(ADJ0[k])} />
      </label>
    );
  };
  const check = (k: "gray" | "inv", label: string) => (
    <button className="iv-chk" role="checkbox" aria-checked={adj[k]} onClick={() => setAdj((a) => ({ ...a, [k]: !a[k] }))}>
      <i aria-hidden="true">{adj[k] && <Check />}</i><span>{label}</span>
    </button>
  );
  const adjDirty = (Object.keys(ADJ0) as (keyof Adj)[]).some((k) => adj[k] !== ADJ0[k]);

  return (
    <div className="iv" tabIndex={-1} ref={root} data-edit={edit} onKeyDown={key}>
      <div className="iv-bar">
        <div className="iv-grp">
          {act(i18next.t("縮小"), ZoomOut, () => zoomTo(s / 1.25))}
          <input className="iv-zoom" inputMode="numeric" aria-label={i18next.t("拡大率(数字を入力)")} title={i18next.t("クリックして拡大率を入力")} disabled={!cur}
            value={zin ?? `${Math.round(s * 100)}%`}
            onFocus={(e) => { const el = e.currentTarget; setZin(String(Math.round(s * 100))); fresh.current = true; requestAnimationFrame(() => el.select()); }}
            onMouseUp={(e) => { if (fresh.current) e.preventDefault(); fresh.current = false; }}
            onChange={(e) => setZin(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
            onBlur={() => { const n = Number(zin); if (zin && n > 0) zoomTo(n / 100); setZin(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.stopPropagation(); setZin(""); e.currentTarget.blur(); } }} />
          {act(i18next.t("拡大"), ZoomIn, () => zoomTo(s * 1.25))}
          {act(i18next.t("画面に合わせる"), Maximize, () => setFit(true), fit)}
        </div>
        <span className="iv-info">{cur ? `${W} × ${H} px` : ""}{dirty ? ` · ${i18next.t("編集済み")}` : ""}</span>
        {!edit && onEdit && (
          <div className="iv-grp iv-tools">
            {act(i18next.t("画像をコピー"), Copy, copy)}
            <button className="btn" onClick={onEdit} disabled={!cur}><Pencil />{i18next.t("編集")}</button>
          </div>
        )}
        {editable && (
          <div className="iv-grp iv-tools">
            {tool("crop", i18next.t("切り抜き"), Crop)}
            {act(i18next.t("左に回転"), RotateCcw, () => rotate(false))}
            {act(i18next.t("右に回転"), RotateCw, () => rotate(true))}
            {act(i18next.t("左右反転"), TrianglesCenterlineDashedVertical, () => flip(true))}
            {act(i18next.t("上下反転"), TrianglesCenterlineDashedHorizontal, () => flip(false))}
            {tool("resize", i18next.t("サイズ変更"), Scaling)}
            {tool("adjust", i18next.t("色の調整"), SlidersHorizontal)}
            {act(i18next.t("画像をコピー"), Copy, copy)}
            <i className="iv-sep" aria-hidden="true" />
            {act(i18next.t("元に戻す"), Undo2, undo, !st || st.i === 0)}
            {act(i18next.t("やり直す"), Redo2, redo, !st || st.i >= st.items.length - 1)}
            <button className="btn iv-save" data-primary="true" disabled={!dirty || saving} title={out.name !== name ? i18next.t("{{n}} として保存", { n: out.name }) : undefined} onClick={save}>
              <Save />{saving ? i18next.t("保存中…") : i18next.t("保存")}
            </button>
          </div>
        )}
      </div>

      <div className="iv-stage scroll" ref={stageRef}>
        {cur && (
          <div className="iv-canvas" ref={wrapRef} data-grab={grab} data-pan={dw + PAD * 2 > box.w || dh + PAD * 2 > box.h} data-px={s >= 2} data-crop={mode === "crop"} style={{ width: dw, height: dh }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            {showImg
              ? <img src={url} alt={name} draggable={false} style={style} />
              : <canvas ref={dispRef} style={style} />}
            {mode === "crop" && (
              <>
                <div className="iv-layer" onPointerDown={(e) => startCrop(e, "new")} />
                <div className="iv-dim" style={{ clipPath: `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${sel.x * s}px ${sel.y * s}px, ${sel.x * s}px ${y2 * s}px, ${x2 * s}px ${y2 * s}px, ${x2 * s}px ${sel.y * s}px, ${sel.x * s}px ${sel.y * s}px)` }} />
                <div className="iv-sel" style={{ left: sel.x * s, top: sel.y * s, width: sel.w * s, height: sel.h * s }} onPointerDown={(e) => startCrop(e, "move")}>
                  {HANDLES.map((h) => <i key={h} data-h={h} onPointerDown={(e) => startCrop(e, h)} />)}
                  <span className="iv-sel-size">{sel.w} × {sel.h}</span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {mode && cur && (
        <div className="iv-panel" role="group">
          {mode === "crop" && (
            <div className="seg" role="group" aria-label={i18next.t("縦横の比率")}>
              {ASPECTS.map(([l, r]) => <button key={l || "free"} aria-pressed={asp === r} onClick={() => pickAspect(r)}>{l || i18next.t("自由")}</button>)}
            </div>
          )}
          {mode === "resize" && (
            <>
              <label className="iv-fld"><span>{i18next.t("幅")}</span><input className="field iv-num" type="number" min={1} max={MAX_SIDE} value={rs.w} onChange={(e) => setW(num(e.target.value))} /></label>
              <button className="icon-btn" aria-label={i18next.t("縦横比を固定")} title={i18next.t("縦横比を固定")} data-on={rs.lock} onClick={() => setRs((r) => ({ ...r, lock: !r.lock }))}><Link2 /></button>
              <label className="iv-fld"><span>{i18next.t("高さ")}</span><input className="field iv-num" type="number" min={1} max={MAX_SIDE} value={rs.h} onChange={(e) => setH(num(e.target.value))} /></label>
              <span className="iv-info">px</span>
            </>
          )}
          {mode === "adjust" && (
            <div className="iv-adj">
              <div className="iv-rngs">
                {slider("b", i18next.t("明るさ"), 200)}
                {slider("c", i18next.t("コントラスト"), 200)}
                {slider("s", i18next.t("彩度"), 200)}
                {slider("blur", i18next.t("ぼかし"), 20, "px")}
              </div>
              <div className="iv-adj-side">
                {check("gray", i18next.t("モノクロ"))}
                {check("inv", i18next.t("色を反転"))}
                <button className="btn" disabled={!adjDirty} onClick={() => setAdj(ADJ0)}><RotateCcw />{i18next.t("リセット")}</button>
              </div>
            </div>
          )}
          <div className="iv-acts">
            <button className="btn" onClick={() => setMode(null)}><X />{i18next.t("キャンセル")}</button>
            <button className="btn" data-primary="true" disabled={mode === "resize" && !rsOk} onClick={applyMode}><Check />{mode === "crop" ? i18next.t("切り抜く") : i18next.t("適用")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
