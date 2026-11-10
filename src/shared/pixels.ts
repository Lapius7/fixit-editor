// ピクセルの群れが、渦を巻いてほどけ、別の絵に集まり直す演出(テーマ切替と起動画面で使う)
export type Cell = { x: number; y: number; a: number; c?: string };
export type Shape = { w: number; h: number; cells: Cell[] };
type Fly = Cell & { cx: number; cy: number; d: number };

const rnd = (() => { let s = 20240611; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
const cl = (v: number) => Math.min(1, Math.max(0, v));
const eio = (t: number) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const eo = (t: number) => 1 - Math.pow(1 - t, 3);
const ss = (a: number, b: number, t: number) => { const x = cl((t - a) / (b - a)); return x * x * (3 - 2 * x); };

export function textShape(text: string, font: string, cell: number, colors: (i: number, u: number, v: number) => string | undefined): Shape {
  const c = document.createElement("canvas"), x = c.getContext("2d")!;
  x.font = font; const m = x.measureText(text), pw = Math.ceil(m.width) + 8, ph = Math.ceil((m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) + 8);
  c.width = pw; c.height = ph; x.font = font; x.textBaseline = "alphabetic"; x.fillStyle = "#000"; x.fillText(text, 4, m.actualBoundingBoxAscent + 4);
  const d = x.getImageData(0, 0, pw, ph).data, w = Math.ceil(pw / cell), h = Math.ceil(ph / cell), cells: Cell[] = [];
  for (let gy = 0; gy < h; gy++) for (let gx = 0; gx < w; gx++) {
    let s = 0, n = 0;
    for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) { const px = gx * cell + xx, py = gy * cell + yy; if (px < pw && py < ph) { s += d[(py * pw + px) * 4 + 3]; n++; } }
    if (s / n > 110) cells.push({ x: gx, y: gy, a: 1, c: colors(cells.length, gx / Math.max(1, w - 1), gy / Math.max(1, h - 1)) });
  }
  return { w, h, cells };
}

export class PixelField {
  private ctx: CanvasRenderingContext2D; private A: Fly[] = []; private B: Fly[] = []; private colA = "#000"; private colB = "#000";
  private raf = 0; private shape: Shape | null = null; private dpr = Math.min(3, window.devicePixelRatio || 1);
  constructor(cv: HTMLCanvasElement, private cell: number, private w: number, private h: number, private gap = .8) {
    cv.width = Math.round(w * cell * this.dpr); cv.height = Math.round(h * cell * this.dpr);
    cv.style.width = `${w * cell}px`; cv.style.height = `${h * cell}px`;
    this.ctx = cv.getContext("2d")!;
  }
  private fly(s: Shape): Fly[] {
    const R = Math.min(this.w, this.h) * .62, ox = (this.w - s.w) / 2, oy = (this.h - s.h) / 2;
    return s.cells.map((c) => { const t = rnd() * Math.PI * 2, r = R * (.2 + .8 * Math.sqrt(rnd())); return { ...c, x: c.x + ox, y: c.y + oy, cx: this.w / 2 + Math.cos(t) * r * 1.25, cy: this.h / 2 + Math.sin(t) * r, d: rnd() }; });
  }
  show(s: Shape, color: string) { cancelAnimationFrame(this.raf); this.shape = s; this.B = this.fly(s); this.A = []; this.colB = color; this.draw(1); }
  stop() { cancelAnimationFrame(this.raf); }
  morph(s: Shape | null, color: string, dur: number): Promise<void> {
    cancelAnimationFrame(this.raf);
    this.A = this.B.map((p) => ({ ...p, d: rnd() })); this.colA = this.colB;
    this.shape = s; this.B = s ? this.fly(s) : []; this.colB = color;
    if (dur <= 0) { this.draw(1); return Promise.resolve(); }
    return new Promise((res) => {
      const t0 = performance.now();
      const tick = (t: number) => { const p = cl((t - t0) / dur); this.draw(p); if (p < 1) this.raf = requestAnimationFrame(tick); else res(); };
      this.raf = requestAnimationFrame(tick);
    });
  }
  private rot(x: number, y: number, k: number): [number, number] {
    const dx = x - this.w / 2, dy = y - this.h / 2, c = Math.cos(k), s = Math.sin(k);
    return [this.w / 2 + dx * c - dy * s, this.h / 2 + dx * s + dy * c];
  }
  private draw(p: number) {
    const { ctx, cell, dpr } = this, sz = cell * this.gap, off = (cell - sz) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, this.w * cell, this.h * cell);
    const put = (x: number, y: number, a: number, col: string) => { if (a <= .01) return; ctx.globalAlpha = a; ctx.fillStyle = col; ctx.fillRect(x * cell + off, y * cell + off, sz, sz); };
    if (p < 1) for (const f of this.A) {
      const q = cl((p - f.d * .16) / .4), e = eio(q), [cx, cy] = this.rot(f.cx, f.cy, q * 2.4);
      put(f.x + (cx - f.x) * e, f.y + (cy - f.y) * e, f.a * (1 - ss(.35, 1, q)), f.c ?? this.colA);
    }
    for (const f of this.B) {
      const q = cl((p - .2 - f.d * .2) / .6), e = eo(q), [cx, cy] = this.rot(f.cx, f.cy, (1 - q) * -2.4);
      put(cx + (f.x - cx) * e, cy + (f.y - cy) * e, f.a * ss(0, .3, q), f.c ?? this.colB);
    }
    ctx.globalAlpha = 1;
  }
}
