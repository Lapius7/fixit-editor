import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { fixitTheme } from "@/editor/theme";
import { get, isDark } from "@/features/settings/settings";

// コード(選択範囲、なければ全体)を、見たままの色で PNG にする。
// 画面外に読み取り専用のエディタを作り、色のついた文字を1つずつ Canvas に描く
export async function codeToPng(view: EditorView, file: string): Promise<Blob> {
  const sel = view.state.selection.main;
  const doc = (sel.empty ? view.state.doc.toString() : view.state.sliceDoc(sel.from, sel.to)).replace(/\s+$/, "");
  const lang = await LanguageDescription.matchFilename(languages, file)?.load().catch(() => null);
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-99999px;top:0;width:2400px;pointer-events:none";
  document.body.append(host);
  try {
    const ed = new EditorView({
      parent: host,
      state: EditorState.create({ doc, extensions: [fixitTheme, lang ?? [], EditorState.readOnly.of(true), EditorState.tabSize.of(get().tabSize)] }),
    });
    const content = ed.contentDOM, cs = getComputedStyle(content);
    const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    await document.fonts.load(font).catch(() => []);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ctx0 = document.createElement("canvas").getContext("2d")!;
    ctx0.font = font;
    const cw = ctx0.measureText("0").width, fs = parseFloat(cs.fontSize);
    const lh = Math.round(fs * 1.65), pad = 28, scale = 2;
    const ink = getComputedStyle(ed.dom).color || cs.color;
    const bg = isDark(get()) ? "#1b1e26" : "#fbfcfe";
    const ts = get().tabSize;
    type Run = { x: number; y: number; s: string; c: string };
    const runs: Run[] = [];
    let maxCol = 0;
    const lines = [...content.querySelectorAll(".cm-line")];
    lines.forEach((ln, i) => {
      let col = 0;
      const w = document.createTreeWalker(ln, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        let s = "";
        for (const ch of n.textContent ?? "") {
          if (ch === "\t") { const k = ts - (col % ts); s += " ".repeat(k); col += k; } else { s += ch; col += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1; }
        }
        if (!s.trim()) continue;
        const parent = n.parentElement!;
        runs.push({ x: col - [...s].reduce((a, ch) => a + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/.test(ch) ? 2 : 1), 0), y: i, s, c: getComputedStyle(parent).color || ink });
      }
      maxCol = Math.max(maxCol, col);
    });
    const W = Math.ceil(maxCol * cw + pad * 2), H = lines.length * lh + pad * 2;
    const cv = document.createElement("canvas");
    cv.width = W * scale; cv.height = H * scale;
    const c = cv.getContext("2d")!;
    c.scale(scale, scale);
    c.fillStyle = bg || "#fff";
    c.beginPath(); c.roundRect(0, 0, W, H, 14); c.fill();
    c.font = font; c.textBaseline = "alphabetic";
    for (const r of runs) { c.fillStyle = r.c; c.fillText(r.s, pad + r.x * cw, pad + r.y * lh + (lh + fs * 0.72) / 2 - fs * 0.35); }
    ed.destroy();
    return await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
  } finally { host.remove(); }
}

export async function shareShot(blob: Blob, name: string): Promise<"copied" | "saved"> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `${name.replace(/\.[^.]+$/, "")}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return "saved";
  }
}
