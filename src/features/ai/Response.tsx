// AI の返答の本文。Markdown を部品に分けて描く(コードブロックは CodeBlock、ほかは無害にした HTML)。
// 流れてくる途中は、閉じていない記号を補ってから描く(書きかけの ** や ` がそのまま見えないように)
import { memo, useMemo, type ReactNode } from "react";
import { toUrl } from "@/features/browser/BrowserDock";
import { openExternal } from "@/features/account/auth";
import { blocks, heal, type Block } from "@/features/ai/markdown";
import { CodeBlock } from "@/features/ai/CodeBlock";

function draw(list: Block[]): ReactNode[] {
  return list.map((b, i) => {
    if (b.t === "html") return <div key={i} className="ai-md" dangerouslySetInnerHTML={{ __html: b.html }} />;
    if (b.t === "code") return <CodeBlock key={i} lang={b.lang} text={b.text} />;
    const items = b.items.map((it, k) => <li key={k}>{draw(it)}</li>);
    return b.ordered ? <ol key={i} className="ai-md-list" start={b.start}>{items}</ol> : <ul key={i} className="ai-md-list">{items}</ul>;
  });
}

// リンクは、デスクトップ版でも PC の既定のブラウザで開く
const click = (e: React.MouseEvent) => {
  const a = (e.target as HTMLElement).closest("a");
  if (!a) return;
  e.preventDefault();
  const u = toUrl(a.getAttribute("href") ?? "");
  if (u) void openExternal(u.href);
};

export const Response = memo(function Response({ text, streaming }: { text: string; streaming: boolean }) {
  const parts = useMemo(() => blocks(streaming ? heal(text) : text), [text, streaming]);
  return <div className="ai-resp" onClick={click}>{draw(parts)}</div>;
});
