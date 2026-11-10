// Markdown / HTML のプレビュー。どちらも sandbox の iframe に入れ、親ページには触れさせない
import { useEffect, useMemo, useState } from "react";
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

export default function Preview({ kind, text, name }: { kind: PreviewKind; text: string; name: string }) {
  // 打鍵のたびに作り直さないよう、少し待ってから反映する
  const [shown, setShown] = useState(text);
  useEffect(() => { const t = setTimeout(() => setShown(text), PREVIEW_DELAY_MS); return () => clearTimeout(t); }, [text]);
  const doc = useMemo(() => build(kind, shown), [kind, shown]);
  // HTML は JS を動かせるが、allow-same-origin は付けない(エディタの localStorage などに届かせない)
  return <iframe className="pv-frame" title={i18next.t("プレビュー") + ": " + name} sandbox={kind === "html" ? "allow-scripts allow-forms allow-modals" : ""} srcDoc={doc} />;
}
