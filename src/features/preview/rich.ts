// Markdown のプレビューで、数式(LaTeX)と Mermaid の図を描く。重いので、使う文書のときだけ読み込む。
// 数式は KaTeX で MathML にする(フォントや CSS を iframe に渡さなくてよい)。図は mermaid で SVG にしてから埋め込む
import { Marked, type Tokens } from "marked";
import markedKatex from "marked-katex-extension";
import katex from "katex";
import DOMPurify from "dompurify";

const KATEX = { throwOnError: false, output: "mathml" as const };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

let seq = 0;
// mermaid の図を SVG にする。書きかけで描けないときは、理由を出す
async function diagram(src: string, dark: boolean): Promise<string> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default", fontFamily: '"Inter","Noto Sans JP",system-ui,sans-serif' });
  const id = `fixit-mmd-${++seq}`;
  try {
    const { svg } = await mermaid.render(id, src);
    return `<figure class="mmd">${DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true }, ADD_TAGS: ["foreignObject"], HTML_INTEGRATION_POINTS: { foreignobject: true } })}</figure>`;
  } catch (e) {
    document.getElementById("d" + id)?.remove(); // 失敗すると mermaid が画面の下に残す要素
    return `<pre class="mmd-err">${esc(e instanceof Error ? e.message : String(e))}</pre>`;
  }
}

// 本文の HTML(無害化したもの)を返す
export async function richMarkdown(text: string, dark: boolean): Promise<string> {
  const charts: string[] = [];
  const md = new Marked();
  md.use(markedKatex(KATEX));
  md.use({
    renderer: {
      code({ text: src, lang }: Tokens.Code) {
        const l = (lang ?? "").trim().split(/\s/)[0].toLowerCase();
        if (l === "mermaid") { charts.push(src); return `<div class="mmd-slot" data-i="${charts.length - 1}"></div>`; }
        if (l === "math" || l === "latex" || l === "tex") return `<div class="math-block">${katex.renderToString(src, { ...KATEX, displayMode: true })}</div>`;
        return false;
      },
    },
  });
  const body = DOMPurify.sanitize(md.parse(text, { async: false }) as string);
  const svgs: string[] = [];
  for (const c of charts) svgs.push(await diagram(c, dark)); // mermaid は 1 つずつ描く
  return body.replace(/<div class="mmd-slot" data-i="(\d+)"><\/div>/g, (_, i: string) => svgs[Number(i)] ?? "");
}

// 数式や図を含むかどうか(含まなければ、軽い通常の変換で足りる)
export const needsRich = (text: string) => /```\s*(mermaid|math|latex|tex)\b|~~~\s*(mermaid|math)\b|\$/i.test(text);
