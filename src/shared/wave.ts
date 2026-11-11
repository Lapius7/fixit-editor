// 画面全体に、下の中央から波が広がる演出。ワークスペースを切り替えたときに出す。
// 波の形・色・縁に残る色・細い線・粒は、原作(libraries.dev/waves、MIT)の式をそのまま使う(./waves)。
// 画面の写しは読めないので、原作の「ぼかし」は波の帯の所だけ backdrop-filter をかけて近づける
import { ms } from "@/features/settings/settings";
import { defaultStyle, duration, makeParticles, particleAt, PALETTES, rimLumps, waveFront, type Rect, type WaveStyle } from "./waves/model";
import { Overlay } from "./waves/overlay";

const SOURCE = 56; // 波の出る所の大きさ(CSS px)。原作の「中央から」の型の丸ボタンに合わせる
const BOTTOM = 40; // 波の出る所の中心から、窓の下端までの距離(CSS px)
export const WINDOW_CORNER = 12; // 窓の角の丸み(CSS px)。縁の色はこの形に沿う

// 原作の「中央から」の型。色は原作の見本の虹色(colorful)にする。
// 広がる速さは原作のまま、縁の色は長く残し、太く強くする
export const WAVE_STYLE: WaveStyle = {
  ...defaultStyle("center"),
  palette: PALETTES.colorful,
  cornerRadius: WINDOW_CORNER,
  linger: 4, // 秒。広がり始めてから縁の色が消え始めるまで(原作 -0.35)
  rimFade: 3.5, // 秒。消えるのにかける時間(原作 2.51)
  rimWidth: 34, // 原作 14
  rimUnevenness: 0.5, // 縁の太さのむら。下げて全周を光らせる(原作 1)
  rimStrength: 1, // 原作 0.6
  hairlineWidth: 2, // 原作 1.5
  hairlineOpacity: 1, // 原作 0.9
};

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let running: (() => void) | null = null;

// 波を出す。画面の下の中央から広がる
export function wave() {
  const s = WAVE_STYLE;
  const o = { x: innerWidth / 2, y: innerHeight - BOTTOM };
  const dur = ms(duration(s) * 1000);
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
