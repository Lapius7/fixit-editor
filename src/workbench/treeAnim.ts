// エクスプローラーの行が増える・減るときの動き。
// 増える: 縦に伸びながら現れる(名前を打って作ったときは、位置が二度ずれないよう色の光りだけ)。
// 減る: 消す操作を始めた瞬間に畳む。遅い場所(WSL・SSH)でも、すぐに消えたように見える。失敗したら元に戻す。
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

// 設定の「動きの速さ」(0 なら動かさない)
const speed = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sp"));
  return Number.isFinite(v) ? v : 1;
};

const rowOf = (path: string) => document.querySelector<HTMLElement>(`nav.tree .tree-row[data-path="${CSS.escape(path)}"]`)?.closest<HTMLElement>("li") ?? null;

/** 新しく現れた行の動き。soft は高さを動かさず、色の光りだけ */
export const enterRow = (li: HTMLElement, soft: boolean) => {
  const sp = speed();
  if (!sp || !li.animate) return;
  if (soft) {
    const row = li.querySelector<HTMLElement>(":scope > .tree-row");
    row?.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" }, { backgroundColor: "transparent" }], { duration: 900 * sp, easing: EASE });
    return;
  }
  const h = li.offsetHeight;
  li.animate(
    [
      { height: "0px", opacity: 0, transform: "translateX(-8px)", overflow: "hidden" },
      { height: `${h}px`, opacity: 1, transform: "none", overflow: "hidden" },
    ],
    { duration: 240 * sp, easing: EASE },
  );
};

const DUST_MS = 1500; // 砂になって散る長さ(ここに動きの速さを掛ける)
const DUST_PAD = 260; // 右へ流れる分の余白(px)

/** 行の字とアイコンを粒子にして、右へ流しながら消す。止める関数を返す(途中で止めると粒子を消すだけ) */
const dust = (row: HTMLElement, sp: number) => {
  const r = row.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return () => {};
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  type P = { x: number; y: number; c: string; a: number; d: number; l: number; dx: number; dy: number; w: number; f: number; s: number };
  const ps: P[] = [];
  const add = (x: number, y: number, c: string, a = 1) => {
    const k = Math.min(Math.max((x - r.left) / r.width, 0), 1);
    const far = Math.random() ** 2; // 多くは近くで消え、少数が遠くまで流れる
    ps.push({
      x: x + Math.random() - 0.5, y: y + Math.random() - 0.5, c, a,
      d: k * 0.4 + Math.random() * 0.15, // 左から順に崩れはじめる
      l: 0.35 + Math.random() * 0.25,
      dx: 15 + far * 230, dy: -10 - Math.random() * 45 + (Math.random() - 0.5) * 20,
      w: 2 + Math.random() * 7, f: 3 + Math.random() * 6, // 揺れの幅・速さ
      s: Math.random() < 0.8 ? 0.9 : 1.6,
    });
  };
  // 名前: 同じ書体で描き直し、字のある画素だけを粒子にする
  const name = row.querySelector<HTMLElement>(".truncate");
  if (name) {
    const nr = name.getBoundingClientRect(), cs = getComputedStyle(name);
    const w = Math.ceil(nr.width), h = Math.ceil(nr.height);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (g && w > 0 && h > 0) {
      g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      g.textBaseline = "middle";
      g.fillStyle = "#000";
      g.fillText(name.textContent ?? "", 0, h / 2);
      const data = g.getImageData(0, 0, w, h).data;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const al = data[(y * w + x) * 4 + 3]; if (al > 60) add(nr.left + x, nr.top + y, cs.color, al / 255); }
    }
  }
  // アイコン: 色のかたまりを粒にする
  row.querySelectorAll<SVGElement>("svg.ico").forEach((svg) => {
    const ir = svg.getBoundingClientRect(), c = getComputedStyle(svg).color;
    for (let y = 1; y < ir.height - 1; y++) for (let x = 1; x < ir.width - 1; x++) if (Math.random() < 0.5) add(ir.left + x, ir.top + y, c);
  });
  if (ps.length > 12000) ps.length = 12000;
  if (!ps.length) return () => {};
  const cv = document.createElement("canvas");
  const W = r.width + DUST_PAD, H = r.height + 80;
  cv.width = W * dpr; cv.height = H * dpr;
  Object.assign(cv.style, { position: "fixed", left: `${r.left}px`, top: `${r.top - 40}px`, width: `${W}px`, height: `${H}px`, pointerEvents: "none", zIndex: "9999" });
  document.body.appendChild(cv);
  const g = cv.getContext("2d")!;
  g.scale(dpr, dpr);
  const row0 = row.style.visibility;
  row.querySelectorAll<HTMLElement>(":scope > *").forEach((e) => { e.style.visibility = "hidden"; });
  const dur = DUST_MS * sp, t0 = performance.now();
  let raf = 0, stopped = false;
  const stop = () => {
    stopped = true; cancelAnimationFrame(raf); cv.remove();
  };
  const frame = (now: number) => {
    if (stopped) return;
    const t = (now - t0) / dur;
    g.clearRect(0, 0, W, H);
    for (const q of ps) {
      const p = Math.min(Math.max((t - q.d) / q.l, 0), 1);
      if (p >= 1) continue;
      const e = p * p * (3 - 2 * p);
      g.globalAlpha = q.a * (1 - p) ** 1.5;
      g.fillStyle = q.c;
      const sz = q.s * (1 - p * 0.4);
      g.fillRect(q.x - r.left + q.dx * e, q.y - (r.top - 40) + q.dy * e + Math.sin(p * q.f) * q.w * p, sz, sz);
    }
    if (t < 1.2) raf = requestAnimationFrame(frame);
    else cv.remove();
  };
  raf = requestAnimationFrame(frame);
  return () => { stop(); row.style.visibility = row0; row.querySelectorAll<HTMLElement>(":scope > *").forEach((e) => { e.style.removeProperty("visibility"); }); };
};

/** 行(開いているフォルダは中身ごと)を畳んで隠す。
 * 畳んだ行は、一覧から本当に消えるまで隠したままにする(再読み込みが反映される前に戻すと、消えた行が一瞬出直してしまう)。
 * undo は失敗した行だけ元に戻す(paths を省くと全部)。settle は成功したあとの保険で、数秒たっても残っている行だけ戻す */
export const leaveRows = (paths: string[]) => {
  const sp = speed();
  const items = new Map<string, { li: HTMLElement; anim: Animation; undust: () => void }>();
  for (const p of paths) {
    const li = rowOf(p);
    if (!li || !li.animate) continue;
    li.style.pointerEvents = "none";
    const h = li.offsetHeight;
    const row = li.querySelector<HTMLElement>(":scope > .tree-row");
    const undust = row && sp ? dust(row, sp) : () => {};
    const wait = row && sp ? DUST_MS * sp * 0.4 : 0; // 砂が散りはじめてから畳む
    const anim = li.animate(
      [
        { height: `${h}px`, opacity: 1, transform: "none", overflow: "hidden" },
        { height: "0px", opacity: 0, transform: "none", overflow: "hidden" },
      ],
      { duration: 260 * sp, delay: wait, easing: EASE, fill: "both" },
    );
    items.set(p, { li, anim, undust });
  }
  const restore = (keys: string[], onlyConnected = false) => {
    for (const k of keys) {
      const it = items.get(k);
      if (!it || (onlyConnected && !it.li.isConnected)) continue;
      it.anim.cancel();
      it.undust();
      it.li.style.removeProperty("pointer-events");
      items.delete(k);
    }
  };
  return {
    undo: (only?: string[]) => restore(only ?? [...items.keys()]),
    settle: () => { setTimeout(() => restore([...items.keys()], true), 5000); },
  };
};
