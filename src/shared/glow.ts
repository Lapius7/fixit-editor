// AI が回答を作っている間、窓の一番外側の縁に沿って色をにじませ続ける。
// 色の出し方は波の縁(原作の rim と細い線)と同じで、帯は出さずに縁だけを光らせる
import { rimLumps, type Front } from "./waves/model";
import { Overlay } from "./waves/overlay";
import { WAVE_STYLE } from "./wave";
import { get, subscribe } from "@/features/settings/settings";

// 縁の色。波よりも長く出し続けるので、少し太く、少し控えめにする
const STYLE = { ...WAVE_STYLE, rimWidth: 18, rimStrength: 0.75, hairlineOpacity: 0.7 };
const FADE_IN = 450; // ms
const FADE_OUT = 700; // ms
const FAR = 1e5; // 波の輪をこれより大きくして、縁の色が画面の全周で消えずに残るようにする

let holders = 0;
let cur: { ov: Overlay; raf: number; t0: number; out: number | null; level: number } | null = null;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function front(time: number, w: number, h: number, rim: number): Front {
  return {
    ox: w / 2, oy: h / 2, tilt: 0, spine: 0, radius: FAR, moved: 1, squash: 1, time, energy: 0, swell: 0, width: w, height: h,
    gravity: 0, glow: 0, clearRadius: -FAR, hairClearRadius: -FAR, rim, sparkle: 0, flying: time, launched: true, hasCleared: true,
    ring: true, sideways: false, hold: 0,
  };
}

function start() {
  if (cur) { cur.out = null; return; }
  const ov = Overlay.make();
  if (!ov) return;
  ov.canvas.className = "fx-glow";
  document.body.append(ov.canvas);
  const c = { ov, raf: 0, t0: performance.now(), out: null as number | null, level: 0 };
  cur = c;
  const fit = () => ov.fit();
  addEventListener("resize", fit);
  const still = reduced();
  const frame = () => {
    const now = performance.now();
    const t = (now - c.t0) / 1000;
    const level = c.out == null ? Math.min((now - c.t0) / FADE_IN, 1) : Math.max(c.level - (now - c.out) / FADE_OUT, 0);
    if (c.out == null) c.level = level;
    if (c.out != null && level <= 0) {
      removeEventListener("resize", fit);
      ov.dispose();
      if (cur === c) cur = null;
      return;
    }
    const { w, h } = ov.size;
    // 動きを減らす設定では、縁の色は止めたまま出す
    const time = still ? 0 : t;
    const e = level * level * (3 - 2 * level);
    ov.render(front(time, w, h, STYLE.rimStrength * e), STYLE, rimLumps(time, w, h, STYLE.cornerRadius, STYLE.rimPulse), null);
    c.raf = requestAnimationFrame(frame);
  };
  c.raf = requestAnimationFrame(frame);
}

function stop() {
  if (cur && cur.out == null) cur.out = performance.now();
}

// 光らせ始める。返した関数を呼ぶと止める(何か所から呼ばれても、全部止めるまで光り続ける)
export function glow(): () => void {
  holders++;
  if (get().aiGlow) start();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    holders = Math.max(holders - 1, 0);
    if (holders === 0) stop();
  };
}

// 設定を切り替えたときに、今の状態へ合わせる
function sync() {
  if (holders > 0 && get().aiGlow) start();
  else stop();
}

subscribe(sync);
