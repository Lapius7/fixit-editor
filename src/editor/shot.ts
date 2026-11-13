import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@/editor/lang";
import { fixitTheme } from "@/editor/theme";
import { get, isDark } from "@/features/settings/settings";
import tokensCss from "@/styles/tokens.css?raw";

// コードを、背景つきのウィンドウ風の PNG にする(選択範囲、なければ全体)。
// 画面外に読み取り専用のエディタを作り、色のついた文字を1つずつ Canvas に描く。
// 色は tokens.css のライト/ダークの値から取るので、画面の配色と関係なく、好きな配色で撮れる

const decls = (css: string) => [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()] as const);
const block = (css: string, head: string) => {
  const i = css.indexOf(head);
  if (i < 0) return "";
  const a = css.indexOf("{", i), b = css.indexOf("\n}", a);
  return css.slice(a + 1, b);
};
const PALETTE = {
  light: decls(block(tokensCss, ":root {")),
  dark: [...decls(block(tokensCss, ":root {")), ...decls(block(tokensCss, ':root[data-theme="dark"] {'))],
};

type Glow = [x: number, y: number, r: number, color: string];
const BACKS: Record<string, { base: string; glows: Glow[] }> = {
  aurora: { base: "#0a1330", glows: [[0.08, 1.02, 0.85, "#22e0a8"], [0.95, 0.0, 0.8, "#6a5cf5"], [0.0, 0.0, 0.5, "#1c8fc0"], [1.0, 1.0, 0.5, "#15305f"]] },
  sunset: { base: "#2a1033", glows: [[0.1, 1.0, 0.9, "#ff7a45"], [0.95, 0.05, 0.8, "#c13fb4"], [0.5, 1.1, 0.6, "#ffb347"]] },
  ocean: { base: "#06203a", glows: [[0.0, 0.0, 0.9, "#1aa6d8"], [1.0, 1.0, 0.85, "#2b5cff"], [0.6, 0.0, 0.4, "#3cd6c4"]] },
  mono: { base: "#26292f", glows: [[0.0, 0.0, 0.9, "#4a505b"], [1.0, 1.0, 0.8, "#15171b"]] },
};

const roundRect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { c.beginPath(); c.roundRect(x, y, w, h, r); };
const wide = (ch: string) => /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch);


export async function codeToPng(view: EditorView, file: string): Promise<Blob> {
  const st = get();
  const sel = view.state.selection.main;
  const doc = (sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to)).replace(/\s+$/, "").replace(/^\n+/, "");
  const firstLine = sel.empty ? 1 : view.state.doc.lineAt(sel.from).number;
  const lang = await LanguageDescription.matchFilename(languages, file)?.load().catch(() => null);
  const dark = st.shotTheme === "app" ? isDark(st) : st.shotTheme === "dark";
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:2400px;pointer-events:none";
  for (const [k, v] of dark ? PALETTE.dark : PALETTE.light) host.style.setProperty(k, v);
  host.style.setProperty("--syn-k", "100%");
  document.body.append(host);
  try {
    const ed = new EditorView({
      parent: host,
      state: EditorState.create({ doc, extensions: [fixitTheme, lang ?? [], EditorState.readOnly.of(true), EditorState.tabSize.of(st.tabSize)] }),
    });
    const content = ed.contentDOM, cs = getComputedStyle(content);
    const size = 15; // 画像の中の文字の大きさ(CSS px)
    const font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    await document.fonts.load(font).catch(() => []);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx0 = document.createElement("canvas").getContext("2d")!;
    ctx0.font = font;
    const cw = ctx0.measureText("0").width, fs = size;
    const lh = Math.round(fs * 1.7), ts = st.tabSize;
    const ink = getComputedStyle(ed.dom).color || cs.color;
    type Run = { x: number; y: number; s: string; c: string };
    const runs: Run[] = [];
    let maxCol = 0;
    const lines = [...content.querySelectorAll(".cm-line")];
    lines.forEach((ln, i) => {
      let col = 0;
      const w = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        let s = "", width = 0;
        for (const ch of n.textContent ?? "") {
          if (ch === "\t") { const k = ts - ((col + width) % ts); s += " ".repeat(k); width += k; } else { s += ch; width += wide(ch) ? 2 : 1; }
        }
        if (s.trim()) runs.push({ x: col, y: i, s, c: getComputedStyle(n.parentElement!).color || ink });
        col += width;
      }
      maxCol = Math.max(maxCol, col);
    });

    // 寸法(CSS px)。外側の余白 → ウィンドウ(上の帯 → コード)
    const scale = 2, out = st.shotPad, chrome = st.shotChrome, bar = chrome ? 46 : 0, padX = 28, padY = chrome ? 14 : 26;
    const numW = st.shotLineNo ? (String(firstLine + lines.length - 1).length + 2) * cw : 0;
    const winW = Math.max(Math.ceil(maxCol * cw + numW + padX * 2), chrome ? 320 : 120);
    const winH = bar + lines.length * lh + padY * 2;
    const W = winW + out * 2, H = winH + out * 2;
    const cv = document.createElement("canvas");
    cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    const c = cv.getContext("2d")!;
    c.scale(scale, scale);

    // 背景
    const back = BACKS[st.shotBg];
    if (back && out > 0) {
      roundRect(c, 0, 0, W, H, 0);
      c.fillStyle = back.base; c.fill();
      for (const [gx, gy, gr, col] of back.glows) {
        const R = gr * Math.max(W, H), g = c.createRadialGradient(gx * W, gy * H, 0, gx * W, gy * H, R);
        g.addColorStop(0, col); g.addColorStop(1, col + "00");
        c.fillStyle = g; c.fillRect(0, 0, W, H);
      }
    }

    // ウィンドウ(影 → 本体 → 縁)
    const wx = out, wy = out, rad = 14;
    const winBg = dark ? "rgba(13, 18, 33, 0.86)" : "rgba(255, 255, 255, 0.92)";
    c.save();
    if (out > 0) { c.shadowColor = "rgba(0,0,0,0.45)"; c.shadowBlur = 40; c.shadowOffsetY = 18; }
    roundRect(c, wx, wy, winW, winH, rad);
    c.fillStyle = back && out > 0 ? winBg : (dark ? "#0d1221" : "#ffffff"); c.fill();
    c.restore();
    roundRect(c, wx + 0.5, wy + 0.5, winW - 1, winH - 1, rad);
    c.strokeStyle = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.10)"; c.lineWidth = 1; c.stroke();

    // 上の帯(三つの丸とファイル名)
    if (chrome) {
      [["#ff5f57", 0], ["#febc2e", 1], ["#28c840", 2]].forEach(([col, i]) => {
        c.beginPath(); c.arc(wx + 24 + (i as number) * 20, wy + bar / 2 + 1, 6, 0, Math.PI * 2); c.fillStyle = col as string; c.fill();
      });
      c.font = `500 13px ${cs.fontFamily}`; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = dark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
      c.fillText(file, wx + winW / 2, wy + bar / 2 + 1, winW - 160);
      c.textAlign = "left";
    }

    // コード
    c.font = font; c.textBaseline = "alphabetic";
    const top = wy + bar + padY, left = wx + padX;
    const base = (i: number) => top + i * lh + (lh + fs * 0.72) / 2 - fs * 0.35;
    if (st.shotLineNo) {
      c.fillStyle = dark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.32)"; c.textAlign = "right";
      for (let i = 0; i < lines.length; i++) c.fillText(String(firstLine + i), left + numW - cw * 1.5, base(i));
      c.textAlign = "left";
    }
    for (const r of runs) { c.fillStyle = r.c; c.fillText(r.s, left + numW + r.x * cw, base(r.y)); }
    ed.destroy();
    return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
  } finally { host.remove(); }
}

/** クリップボードに入れる。入れられなければ false */
export async function copyShot(blob: Blob): Promise<boolean> {
  try { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); return true; } catch { return false; }
}

/** ファイルとして保存する */
export function saveShot(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${name.replace(/\.[^.]+$/, "")}.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
