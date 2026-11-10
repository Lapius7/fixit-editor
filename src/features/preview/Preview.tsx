// Markdown / HTML のプレビュー。どちらも sandbox の iframe に入れ、親ページには触れさせない
import { useEffect, useRef, useState } from "react";
import { RotateCw } from "lucide-react";
import { inline, type Source } from "./resolve";
import { marked } from "marked";
import DOMPurify from "dompurify";
import i18next from "i18next";
import { PREVIEW_DELAY_MS } from "@/shared/config";

export type PreviewKind = "md" | "html";

const EXT: Record<string, PreviewKind> = { md: "md", markdown: "md", mdx: "md", html: "html", htm: "html" };
export const previewKind = (name: string): PreviewKind | null => EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;

const MD_CSS = `:root{color-scheme:light dark}body{font:15px/26px "Inter","Noto Sans JP",system-ui,sans-serif;color:#1f2430;background:#fff;max-width:760px;margin:0 auto;padding:28px 32px}
@media(prefers-color-scheme:dark){body{color:#e6e8ee;background:#16181d}a{color:#8ab4ff}code,pre{background:#23262d}td,th{border-color:#3a3f4a}blockquote{border-color:#3a3f4a;color:#aab}}
h1,h2,h3,h4{line-height:1.4}h1,h2{padding-bottom:.25em;border-bottom:1px solid #d5d9e044}code{font:13px/1.6 ui-monospace,Consolas,monospace;background:#f1f3f6;padding:1px 5px;border-radius:4px}pre{background:#f1f3f6;padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse}td,th{border:1px solid #d5d9e0;padding:6px 10px}img{max-width:100%}a{color:#3b6fd9}blockquote{margin:0;padding:0 14px;border-left:3px solid #d5d9e0;color:#5b6270}`;

// 一度に出す HTML の組み立て。Markdown は変換後に DOMPurify で無害化する(iframe の sandbox とは別の二重の備え)
function build(kind: PreviewKind, text: string): string {
  if (kind === "html") return text;
  const body = DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  return `<!doctype html><meta charset="utf-8"><base target="_blank"><style>${MD_CSS}</style>${body}`;
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
  useEffect(() => {
    let live = true;
    const run = async () => {
      let html = build(kind, shown);
      if (kind === "html" && source) html = await inline(html, { ...source, nonce }).catch(() => html);
      if (live) setDoc(withScroll(html, y.current));
    };
    void run();
    return () => { live = false; };
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
    const on = () => setNonce((n) => n + 1);
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
