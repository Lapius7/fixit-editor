// AI の返答(Markdown)を、表示する部品に分ける。コードブロックは React の部品で描き(言語・コピー・色分け)、
// それ以外は HTML にして DOMPurify を通す。流れてくる途中の返答は、閉じていない記号を補ってから描く
import { marked, type Token, type Tokens } from "marked";
import DOMPurify from "dompurify";

// 画像・スタイル・フォームは通さない(画像の URL にコードを載せて外へ送る手口を防ぐ)。
// start は、コードブロックで分かれた番号付きリストの続きの番号
const SAFE = { ALLOWED_TAGS: ["p", "br", "hr", "pre", "code", "strong", "em", "del", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "a", "table", "thead", "tbody", "tr", "th", "td"], ALLOWED_ATTR: ["href", "start"], ALLOW_DATA_ATTR: false };
export const toHtml = (tokens: Token[]) => DOMPurify.sanitize(marked.parser(tokens), SAFE);

// 表示の単位。html はそのまま描き、code は部品で描き、list はコードを含むリストを項目ごとに描く
export type Block =
  | { t: "html"; html: string }
  | { t: "code"; lang: string; text: string; open: boolean }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] };

const hasCode = (k: Token): boolean => k.type === "code" || (k.type === "list" && (k as Tokens.List).items.some((i) => i.tokens.some(hasCode)));

// 閉じたフェンスの数を数え、最後のコードブロックが閉じていないか調べる
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
function openFence(s: string) {
  let open: string | null = null;
  for (const line of s.split("\n")) {
    const m = FENCE.exec(line);
    if (!m) continue;
    if (open == null) open = m[1][0].repeat(m[1].length);
    else if (m[1][0] === open[0] && m[1].length >= open.length && !line.trim().slice(m[1].length)) open = null;
  }
  return open != null;
}

function toBlocks(tokens: Token[], text: string): Block[] {
  const out: Block[] = [];
  let run: Token[] = [];
  const flush = () => { if (run.length) { const html = toHtml(run); if (html.trim()) out.push({ t: "html", html }); run = []; } };
  tokens.forEach((k, i) => {
    if (k.type === "code") {
      flush();
      const c = k as Tokens.Code;
      // 最後のブロックが閉じていなければ、まだ流れてくる途中
      const last = i === tokens.length - 1 || tokens.slice(i + 1).every((x) => x.type === "space");
      out.push({ t: "code", lang: (c.lang ?? "").trim().split(/\s+/)[0] ?? "", text: c.text, open: last && c.codeBlockStyle !== "indented" && openFence(text) });
    } else if (k.type === "list" && hasCode(k)) {
      flush();
      const l = k as Tokens.List;
      out.push({ t: "list", ordered: l.ordered, start: typeof l.start === "number" ? l.start : 1, items: l.items.map((it) => toBlocks(it.tokens, text)) });
    } else run.push(k);
  });
  flush();
  return out;
}

export function blocks(s: string): Block[] {
  return toBlocks(marked.lexer(s), s);
}

// 流れてくる途中の返答で、閉じていない強調・コード・取り消し線・リンクを補う(表示だけに使う。コピーや置き換えは元の文のまま)。
// 開いたままのコードブロックの中は、そのまま(Markdown はブロックの最後まで読む)
export function heal(s: string): string {
  if (!s || openFence(s)) return s;
  // 最後のコードブロックより後ろだけを見る(コードの中の記号は数えない)
  const fences = [...s.matchAll(/^ {0,3}(?:`{3,}|~{3,}).*$/gm)];
  const from = fences.length ? fences[fences.length - 1].index! + fences[fences.length - 1][0].length : 0;
  let tail = s.slice(from);
  // 書きかけのリンク [文字](http... は、文字だけを出す
  tail = tail.replace(/\[([^\]\n]*)\]\([^)\s]*$/, "$1").replace(/\[([^\]\n]*)$/, "$1");
  // 開いただけで中身がまだ無い記号は外し、中身があれば閉じる
  const close = (mark: string, n: number) => {
    if (n % 2 === 0) return;
    const t = tail.trimEnd();
    tail = t.endsWith(mark) ? t.slice(0, -mark.length) : tail + mark;
  };
  close("`", (tail.match(/`/g) ?? []).length);
  // インラインコードの中の記号は数えない
  const plain = () => tail.replace(/`[^`]*`/g, "");
  close("**", (plain().match(/\*\*/g) ?? []).length);
  close("~~", (plain().match(/~~/g) ?? []).length);
  return s.slice(0, from) + tail;
}
