// Markdown / HTML のプレビュー。どちらも sandbox の iframe に入れ、親ページには触れさせない
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { inline, type Source } from "./resolve";
import { marked } from "marked";
import DOMPurify from "dompurify";
import i18next from "i18next";
import { PREVIEW_DELAY_MS, PREVIEW_FIRST_MS, PREVIEW_REFOCUS_MS } from "@/shared/config";

export type PreviewKind = "md" | "html" | "mermaid";

const EXT: Record<string, PreviewKind> = { md: "md", markdown: "md", mdx: "md", html: "html", htm: "html", mmd: "mermaid", mermaid: "mermaid" };
export const previewKind = (name: string): PreviewKind | null => EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

const MD_CSS = `:root{color-scheme:light dark}body{font:15px/26px "Inter","Noto Sans JP",system-ui,sans-serif;color:#1f2430;background:#fff;max-width:760px;margin:0 auto;padding:28px 32px}
@media(prefers-color-scheme:dark){body{color:#e6e8ee;background:#16181d}a{color:#8ab4ff}code,pre{background:#23262d}td,th{border-color:#3a3f4a}blockquote{border-color:#3a3f4a;color:#aab}}
h1,h2,h3,h4{line-height:1.4}h1,h2{padding-bottom:.25em;border-bottom:1px solid #d5d9e044}code{font:13px/1.6 ui-monospace,Consolas,monospace;background:#f1f3f6;padding:1px 5px;border-radius:4px}pre{background:#f1f3f6;padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse}td,th{border:1px solid #d5d9e0;padding:6px 10px}img{max-width:100%}a{color:#3b6fd9}blockquote{margin:0;padding:0 14px;border-left:3px solid #d5d9e0;color:#5b6270}
figure.mmd{margin:16px 0;text-align:center}figure.mmd svg{max-width:100%;height:auto}.mmd-err{color:#d9534f;white-space:pre-wrap;background:none;border:1px solid #d9534f55}
math{font-size:1.1em}.math-block,math[display=block]{margin:12px 0;overflow-x:auto;overscroll-behavior:contain}`;

// 一度に出す HTML の組み立て。Markdown は変換後に DOMPurify で無害化する(iframe の sandbox とは別の二重の備え)
function build(kind: PreviewKind, text: string): string {
  if (kind === "html") return text;
  const src = kind === "mermaid" ? "```\n" + text + "\n```" : text; // 図を描けるまでは、元の文をそのまま見せる
  return mdDoc(DOMPurify.sanitize(marked.parse(src, { async: false }) as string));
}
const mdDoc = (body: string) => `<!doctype html><meta charset="utf-8"><base target="_blank"><style>${MD_CSS}</style>${body}`;
const dark = () => matchMedia("(prefers-color-scheme: dark)").matches; // プレビューの色は OS の設定に合わせている(MD_CSS)
// 数式や図があれば、それらを描いた HTML を作る。無ければ null
async function buildRich(kind: PreviewKind, text: string): Promise<string | null> {
  if (kind === "html") return null;
  const src = kind === "mermaid" ? "```mermaid\n" + text + "\n```" : text;
  const m = await import("./rich");
  if (kind === "md" && !m.needsRich(text)) return null;
  return mdDoc(await m.richMarkdown(src, dark()));
}

// 親へ「いまのスクロール位置」を知らせ、作り直したあとにそこへ戻す(Live Server と同じく、書き直しても位置が飛ばない)
const keepScroll = (y: number) => `<script>(function(){var y=${Math.round(y)};function s(){try{parent.postMessage({fixitScroll:scrollY},"*")}catch(e){}}addEventListener("load",function(){scrollTo(0,y);setTimeout(function(){scrollTo(0,y)},60)});addEventListener("scroll",s,{passive:true})})()</script>`;
const withScroll = (doc: string, y: number) => (/<head[^>]*>/i.test(doc) ? doc.replace(/<head[^>]*>/i, (m) => m + keepScroll(y)) : keepScroll(y) + doc);

export type PreviewSource = Omit<Source, "nonce">;

export default function Preview({ kind, text, name, source }: { kind: PreviewKind; text: string; name: string; source?: PreviewSource }) {
  // 打鍵のたびに作り直さないよう、少し待ってから反映する
  const [shown, setShown] = useState(text);
  const [nonce, setNonce] = useState(0); // 読み直しの番号
  const [doc, setDoc] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const y = useRef(0);
  useEffect(() => { const t = setTimeout(() => setShown(text), PREVIEW_DELAY_MS); return () => clearTimeout(t); }, [text]);
  // 参照しているファイルを開いているタブの中身(未保存を含む)が変わったら、作り直す
  const openNow = source ? JSON.stringify(source.open) : "";
  const [openKey, setOpenKey] = useState(openNow);
  useEffect(() => { const t = setTimeout(() => setOpenKey(openNow), PREVIEW_DELAY_MS); return () => clearTimeout(t); }, [openNow]);
  // 作り直しは、新しく始めたものほど番号が大きい。遅れて終わった古い結果で、新しい表示を上書きしない。
  // 新しい作り直しが始まっても、前の結果は捨てずに出す(読み込みが遅い場所で、ずっと真っ白にならないように)
  const seq = useRef(0), shownSeq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    const put = (html: string) => { if (id < shownSeq.current) return; shownSeq.current = id; setDoc(withScroll(html, y.current)); };
    const raw = build(kind, shown);
    if (kind !== "html") {
      // 図と数式は読み込みに時間がかかる。描けるまでは前の表示を残し、何も出ていなければ先に本文だけ出す
      if (kind === "md" && !/[`~$]/.test(shown)) { put(raw); return; }
      const t = shownSeq.current ? 0 : window.setTimeout(() => { if (!shownSeq.current) put(raw); }, PREVIEW_FIRST_MS);
      void buildRich(kind, shown).catch(() => null).then((html) => { clearTimeout(t); put(html ?? raw); });
      return () => clearTimeout(t);
    }
    if (!source) { put(raw); return; }
    // まだ何も出ていなければ、埋め込みを待たずに本文だけ先に出す
    const t = shownSeq.current ? 0 : window.setTimeout(() => { if (!shownSeq.current) put(raw); }, PREVIEW_FIRST_MS);
    void inline(raw, { ...source, nonce }).catch(() => raw).then((html) => { clearTimeout(t); put(html); });
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, shown, openKey, nonce, source?.root, source?.path]);
  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && typeof e.data?.fixitScroll === "number") y.current = e.data.fixitScroll; };
    addEventListener("message", on);
    return () => removeEventListener("message", on);
  }, []);
  // ウィンドウに戻ってきたら、フォルダの中で変わったファイル(別のエディタでの編集など)を読み直す
  useEffect(() => {
    if (kind !== "html" || !source?.root) return;
    let last = 0; // 続けてフォーカスが戻っても、読み直しは間をあける
    const on = () => { const now = Date.now(); if (now - last < PREVIEW_REFOCUS_MS) return; last = now; setNonce((n) => n + 1); };
    addEventListener("focus", on);
    return () => removeEventListener("focus", on);
  }, [kind, source?.root]);
  // HTML は JS を動かせるが、allow-same-origin は付けない(エディタの localStorage などに届かせない)
  return (
    <div className="pv-wrap">
      <iframe ref={frame} className="pv-frame" title={i18next.t("プレビュー") + ": " + name} sandbox={kind === "html" ? "allow-scripts allow-forms allow-modals" : ""} srcDoc={doc} />
      <button className="icon-btn pv-reload" aria-label={i18next.t("プレビューを更新")} title={i18next.t("プレビューを更新")} onClick={() => { y.current = 0; setNonce((n) => n + 1); }}><RotateCw /></button>
    </div>
  );
}
