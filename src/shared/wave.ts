// 画面全体に、押した所から波が広がる演出。ワークスペースを切り替えたときに出す。
// 波の形・色・縁に残る色・細い線・粒は、原作(libraries.dev/waves、MIT)の式をそのまま使う(./waves)。
// 画面の写しは読めないので、原作の「ぼかし」は波の帯の所だけ backdrop-filter をかけて近づける
import { ms } from "@/features/settings/settings";
import { defaultStyle, duration, makeParticles, particleAt, PALETTES, rimLumps, waveFront, type Rect, type WaveStyle } from "./waves/model";
import { Overlay } from "./waves/overlay";

type Pt = { x: number; y: number };

// 直前に押した位置。キーボードやコマンドから開いたときは、画面の中央から出す
let last: (Pt & { at: number }) | null = null;
if (typeof window !== "undefined") addEventListener("pointerdown", (e) => { last = { x: e.clientX, y: e.clientY, at: performance.now() }; }, true);
const RECENT = 4000; // ms。これより前に押した位置は使わない
const SOURCE = 56; // 波の出る所の大きさ(CSS px)。原作の「中央から」の型の丸ボタンに合わせる
export const WINDOW_CORNER = 12; // 窓の角の丸み(CSS px)。縁の色はこの形に沿う
// 原作の見本は 375×509 の枠の中で、ボタンから一番遠い角まで約 500px を広がる。
// 窓は広いので、同じ時間だと波が速く見える。一番遠い角までの距離に合わせて時間を伸ばし、進む速さを原作に近づける
const REF_REACH = 500; // CSS px
const MAX_STRETCH = 2.2; // 伸ばすのはここまで(1920×1080 の中央からで約 9 秒)

// 原作の「中央から」の型。色だけ、原作の見本の虹色(colorful)にする
export const WAVE_STYLE: WaveStyle = { ...defaultStyle("center"), palette: PALETTES.colorful, cornerRadius: WINDOW_CORNER };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let running: (() => void) | null = null;

// 直前に押した位置(古ければ画面の中央)。読み込みを待つ前に取っておくのに使う
export const origin = (): Pt => (last && performance.now() - last.at < RECENT ? { x: last.x, y: last.y } : { x: innerWidth / 2, y: innerHeight / 2 });

// 波を出す。at を省くと、直前に押した位置(なければ画面の中央)から出す
export function wave(at?: Pt) {
  const s = WAVE_STYLE;
  const o = at ?? origin();
  const reach = Math.max(Math.hypot(o.x, o.y), Math.hypot(innerWidth - o.x, o.y), Math.hypot(o.x, innerHeight - o.y), Math.hypot(innerWidth - o.x, innerHeight - o.y));
  const stretch = Math.min(Math.max(reach / REF_REACH, 1), MAX_STRETCH);
  const dur = ms(duration(s) * 1000 * stretch);
  if (dur <= 0 || reduced()) return;
  running?.();
  const ov = Overlay.make();
  if (!ov) return;
  const src: Rect = { x: o.x - SOURCE / 2, y: o.y - SOURCE / 2, w: SOURCE, h: SOURCE };
  ov.canvas.className = "fx-wave";

  // 波の帯の所だけ、下の画面をぼかす(原作の progressive blur の代わり)
  const blur = document.createElement("div");
  blur.className = "fx-wave-blur";
  blur.setAttribute("aria-hidden", "true");
  document.body.append(blur, ov.canvas);

  const parts = makeParticles(s);
  const dots = { data: new Float32Array(Math.max(parts.length, 1) * 3), count: 0 };
  const t0 = performance.now();
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); ov.dispose(); blur.remove(); removeEventListener("resize", fit); if (running === stop) running = null; };
  const fit = () => ov.fit();
  addEventListener("resize", fit);
  running = stop;

  const frame = () => {
    const p = (performance.now() - t0) / dur;
    if (p >= 1) return stop();
    const { w, h } = ov.size;
    const front = waveFront(p, src, w, h, s, o);
    let n = 0;
    if (front.time > 0) {
      for (const part of parts) {
        const at = particleAt(part, front, src, s);
        if (at.a <= 0.002) continue;
        dots.data[n * 3] = at.x;
        dots.data[n * 3 + 1] = at.y;
        dots.data[n * 3 + 2] = Math.floor(part.size * 10) + Math.min(at.a, 0.999);
        n++;
      }
    }
    dots.count = n;
    ov.render(front, s, rimLumps(front.time, w, h, s.cornerRadius, s.rimPulse), dots);
    // ぼかしの強さと場所。原作の式 energy * blur * exp(-(d / 幅)^2) を、輪の内外で幅を変えて mask にする
    const amt = front.energy * s.blur;
    if (amt > 0.3) {
      const r = front.radius;
      const stops = [-2, -1.4, -0.9, -0.5, 0, 0.5, 1, 1.5].map((k) => {
        const d = k * (k < 0 ? s.blurBehind : s.blurAhead);
        return `rgba(0,0,0,${Math.exp(-k * k).toFixed(3)}) ${Math.max(r + d, 0).toFixed(1)}px`;
      });
      blur.style.backdropFilter = `blur(${amt.toFixed(1)}px)`;
      blur.style.maskImage = `radial-gradient(circle at ${front.ox}px ${front.oy}px, ${stops.join(", ")})`;
      blur.style.display = "";
    } else blur.style.display = "none";
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
