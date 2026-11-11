// 画面全体に、押した所から色の波が広がる演出(WebGL)。ワークスペースを切り替えたときに出す。
// 画面の上に透明な canvas を重ねて描くだけなので、下の操作は止めない。終わったら canvas を外す
import { ms } from "@/features/settings/settings";

type Pt = { x: number; y: number };

// 直前に押した位置。キーボードやコマンドから開いたときは、画面の中央から出す
let last: (Pt & { at: number }) | null = null;
if (typeof window !== "undefined") addEventListener("pointerdown", (e) => { last = { x: e.clientX, y: e.clientY, at: performance.now() }; }, true);
const RECENT = 4000; // ms。これより前に押した位置は使わない

const VS = "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }";
const FS = `
precision highp float;
uniform vec2 uRes;   // 画面の大きさ(画素)
uniform vec2 uO;     // 波の出る所(画素、下が 0)
uniform float uT;    // 進み具合 0〜1
uniform float uMax;  // 画面の一番遠い角までの距離
uniform float uSeed;
uniform float uDark;
uniform float uPx;   // 1 CSS px の画素数
const float TAU = 6.2831853;

float h1(float n) { return fract(sin(n * 127.1 + uSeed) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
// 色の並び(青・紫・赤・橙・水色を順にめぐる)
vec3 pal(float t) {
  vec3 a = vec3(0.55, 0.45, 0.55), b = vec3(0.45, 0.4, 0.4), c = vec3(1.0, 1.0, 1.0), d = vec3(0.0, 0.25, 0.55);
  return clamp(a + b * cos(TAU * (c * t + d)), 0.0, 1.0);
}
float ease(float t) { return 1.0 - pow(1.0 - t, 3.0); }

void main() {
  vec2 q = gl_FragCoord.xy - uO;
  float ang = atan(q.y, q.x) / TAU + 0.5; // 0〜1
  float d = length(q);
  float t = uT;
  float r = ease(t) * uMax * 1.08;
  // 縁を少し波打たせる(進むほど落ち着く)
  float wob = (noise(ang * 9.0 + t * 3.0) - 0.5) * 46.0 * uPx * (1.0 - t * 0.6);
  float e = r + wob - d;          // 0 より大きいと、波がもう通った所
  float band = 170.0 * uPx * (0.6 + 0.4 * t);
  float x = e / band;             // 0〜1 が色の帯

  float fade = 1.0 - smoothstep(0.55, 1.0, t);
  vec4 col = vec4(0.0);
  if (x > 0.0 && x < 1.6) {
    float body = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.12, 1.0, x));
    vec3 c = pal(ang * 1.5 + d / (900.0 * uPx) + t * 0.35 + noise(ang * 5.0 - t) * 0.25);
    float a = body * (uDark > 0.5 ? 0.8 : 0.7) * fade;
    // 帯の後ろに、色が薄く残る
    a += (1.0 - smoothstep(0.0, 1.6, x)) * 0.12 * fade;
    col = vec4(c * a, a);
  }
  // 先頭の細い白い線
  float line = exp(-abs(e) / (1.3 * uPx)) * 0.85 * fade;
  col += vec4(vec3(line), line);

  // 先頭の前を飛ぶ粒
  float N = 140.0;
  float s = floor(ang * N);
  for (int k = -1; k <= 1; k++) {
    float id = s + float(k);
    float pa = (id + h1(id)) / N;
    float pr = r + wob + (12.0 + h1(id + 7.0) * 70.0) * uPx * (0.3 + t);
    vec2 pp = vec2(cos((pa - 0.5) * TAU), sin((pa - 0.5) * TAU)) * pr;
    float size = (0.8 + h1(id + 3.0) * 1.4) * uPx;
    float life = (1.0 - smoothstep(0.25 + h1(id + 5.0) * 0.4, 0.9, t)) * step(0.35, h1(id + 9.0));
    float dot = (1.0 - smoothstep(size * 0.5, size, length(q - pp))) * life;
    vec3 pc = mix(pal(pa * 1.5 + t * 0.35), vec3(1.0), 0.35);
    col += vec4(pc * dot, dot) * 0.9;
  }
  gl_FragColor = vec4(min(col.rgb, vec3(1.0)), min(col.a, 1.0));
}`;

let running: (() => void) | null = null;

// 波を出す。at を省くと、直前に押した位置(なければ画面の中央)から出す
export function wave(at?: Pt) {
  const dur = ms(1300);
  if (dur <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  running?.();
  const o = at ?? (last && performance.now() - last.at < RECENT ? last : { x: innerWidth / 2, y: innerHeight / 2 });
  const cv = document.createElement("canvas");
  cv.className = "fx-wave";
  cv.setAttribute("aria-hidden", "true");
  const px = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(innerWidth * px); cv.height = Math.round(innerHeight * px);
  const gl = cv.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return;
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const u = (n: string) => gl.getUniformLocation(prog, n);
  const ox = o.x * px, oy = cv.height - o.y * px;
  const far = Math.max(...[[0, 0], [cv.width, 0], [0, cv.height], [cv.width, cv.height]].map(([x, y]) => Math.hypot(x - ox, y - oy)));
  gl.uniform2f(u("uRes"), cv.width, cv.height); gl.uniform2f(u("uO"), ox, oy);
  gl.uniform1f(u("uMax"), far); gl.uniform1f(u("uSeed"), Math.random() * 100);
  gl.uniform1f(u("uDark"), document.documentElement.dataset.theme === "dark" ? 1 : 0); gl.uniform1f(u("uPx"), px);
  const tU = u("uT");
  document.body.appendChild(cv);
  const t0 = performance.now();
  let raf = 0;
  const stop = () => { cancelAnimationFrame(raf); cv.remove(); gl.getExtension("WEBGL_lose_context")?.loseContext(); if (running === stop) running = null; };
  running = stop;
  const frame = (now: number) => {
    const t = Math.min(1, (now - t0) / dur);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1f(tU, t); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (t < 1) raf = requestAnimationFrame(frame); else stop();
  };
  raf = requestAnimationFrame(frame);
}
