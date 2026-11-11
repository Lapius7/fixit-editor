// 波の色・縁・細い線・粒を、画面の上に重ねた透明な canvas に描く(WebGL2)。
// 描き方は原作の renderer.ts と同じで、画面の写しを読まない所だけが違う
import { DOT_FRAG, DOT_VERT, MAIN_FRAG, VERT } from "./shaders";
import { oklab, type Front, type WaveStyle } from "./model";

type Prog = { p: WebGLProgram; loc: (n: string) => WebGLUniformLocation | null };

function program(gl: WebGL2RenderingContext, vs: string, fs: string): Prog | null {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
  const cache = new Map<string, WebGLUniformLocation | null>();
  return { p, loc: (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n)!; } };
}

export type Dots = { data: Float32Array; count: number };

export class Overlay {
  readonly canvas = document.createElement("canvas");
  private gl: WebGL2RenderingContext;
  private main: Prog;
  private dot: Prog;
  private quad: WebGLBuffer;
  private dots: WebGLBuffer;
  private dotsSize = 0;
  private field = new Float32Array(19);
  private pal = new Float32Array(27);
  private w = 0;
  private h = 0;

  // WebGL2 が使えない環境では null を返す
  static make(): Overlay | null {
    try { return new Overlay(); } catch { return null; }
  }

  private constructor() {
    const gl = this.canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("webgl2");
    const main = program(gl, VERT, MAIN_FRAG);
    const dot = program(gl, DOT_VERT, DOT_FRAG);
    if (!main || !dot) throw new Error("shader");
    this.gl = gl; this.main = main; this.dot = dot;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.dots = gl.createBuffer()!;
    this.canvas.setAttribute("aria-hidden", "true");
    this.fit();
  }

  // 窓の大きさに合わせる(CSS px と、描く画素の数)
  fit() {
    const px = Math.min(devicePixelRatio || 1, 2);
    this.w = innerWidth; this.h = innerHeight;
    const cw = Math.round(this.w * px), ch = Math.round(this.h * px);
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
  }

  get size() { return { w: this.w, h: this.h }; }

  render(front: Front, style: WaveStyle, lumps: Float32Array, dots: Dots | null) {
    const gl = this.gl, m = this.main;
    const pw = this.canvas.width, ph = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.BLEND);
    gl.useProgram(m.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const aPos = gl.getAttribLocation(m.p, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(m.loc("uSize"), this.w, this.h);
    gl.uniform2f(m.loc("uPx"), pw, ph);
    gl.uniform1i(m.loc("uLive"), 1);
    const f = this.field;
    f[0] = front.ox; f[1] = front.oy; f[2] = front.spine; f[3] = front.radius; f[4] = front.squash;
    f[5] = front.time; f[6] = front.energy; f[7] = front.swell; f[8] = front.width; f[9] = front.height;
    f[10] = front.gravity; f[11] = front.glow; f[12] = front.clearRadius; f[13] = front.rim; f[14] = front.tilt;
    f[15] = front.ring ? 1 : 0; f[16] = front.hold; f[17] = front.launched ? 1 : 0; f[18] = front.hairClearRadius;
    gl.uniform1fv(m.loc("uF"), f);
    // 画面の写しは無いので、レンズと写しの読み出しは切る
    gl.uniform1i(m.loc("uContent"), 0);
    gl.uniform1i(m.loc("uRevealed"), 0);
    gl.uniform1i(m.loc("uLens"), 0);
    const colors = style.palette.colors.slice(0, 9);
    colors.forEach((c, i) => this.pal.set(oklab(c), i * 3));
    gl.uniform3fv(m.loc("uPal"), this.pal);
    gl.uniform1i(m.loc("uPalCount"), colors.length);
    gl.uniform3fv(m.loc("uAhead"), oklab(style.palette.ahead));
    gl.uniform3fv(m.loc("uBehind"), oklab(style.palette.behind));
    gl.uniform1f(m.loc("uLead"), style.lead);
    gl.uniform1f(m.loc("uTail"), style.tail);
    gl.uniform1f(m.loc("uStrength"), style.strength);
    gl.uniform1f(m.loc("uRimWidth"), style.rimWidth);
    gl.uniform1f(m.loc("uRimSoftness"), style.rimSoftness);
    gl.uniform1f(m.loc("uCorner"), style.cornerRadius);
    gl.uniform1f(m.loc("uUneven"), style.rimUnevenness);
    gl.uniform1f(m.loc("uPulse"), style.rimPulse);
    gl.uniform1f(m.loc("uHairW"), style.hairlineWidth);
    gl.uniform1f(m.loc("uHairO"), style.hairlineOpacity);
    gl.uniform1f(m.loc("uHairWhite"), style.hairlineWhite);
    gl.uniform3fv(m.loc("uLumps"), lumps);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (dots && dots.count > 0) {
      const d = this.dot;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(d.p);
      gl.uniform2f(d.loc("uSize"), this.w, this.h);
      const scale = pw / this.w;
      gl.uniform1f(d.loc("uScale"), scale);
      gl.uniform1f(d.loc("uPoint"), Math.ceil((style.particleSize + 1) * scale) + 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dots);
      if (this.dotsSize < dots.data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, dots.data.byteLength, gl.DYNAMIC_DRAW);
        this.dotsSize = dots.data.length;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dots.data, 0, dots.count * 3);
      const a = gl.getAttribLocation(d.p, "aDot");
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, dots.count);
    }
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
  }
}
