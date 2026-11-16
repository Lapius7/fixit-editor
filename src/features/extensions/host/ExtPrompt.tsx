import { useEffect, useRef, useState } from "react";
import i18next from "i18next";
import { Search } from "lucide-react";
import { usePrompt, type Prompt } from "./ui";

// 拡張機能からの質問。見出しに拡張の名前を、拡張が変えられない形で必ず出す(「トークンを入力」のような偽の質問への備え)。
export default function ExtPrompt() {
  const p = usePrompt();
  return p ? <Body key={p.ext + p.title} p={p} /> : null;
}

function Body({ p }: { p: Prompt }) {
  const [q, setQ] = useState(p.value), [sel, setSel] = useState(0);
  const field = useRef<HTMLInputElement>(null), list = useRef<HTMLUListElement>(null);
  const hits = p.kind === "pick" ? p.items.map((it, i) => ({ it, i })).filter(({ it }) => !q.trim() || `${it.label} ${it.detail}`.toLowerCase().includes(q.trim().toLowerCase())) : [];
  useEffect(() => field.current?.focus(), []);
  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") p.done(null);
    else if (p.kind === "input") { if (e.key === "Enter") p.done(q); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter" && hits[sel]) p.done(hits[sel].i);
  };
  return (
    <div className="qo-backdrop" onMouseDown={() => p.done(null)}>
      <div className="qo ext-prompt" role="dialog" aria-label={i18next.t("拡張機能からの質問")} onMouseDown={(e) => e.stopPropagation()}>
        <p className="ext-prompt-from">{i18next.t("拡張機能「{{name}}」からの質問", { name: p.name })}</p>
        {p.title && <p className="ext-prompt-title">{p.title}</p>}
        <div className="qo-input">
          {p.kind === "pick" && <Search />}
          <input ref={field} type={p.secret ? "password" : "text"} placeholder={p.placeholder} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} autoComplete="off" spellCheck={false} />
        </div>
        {p.kind === "pick" && (
          <ul ref={list} className="qo-list scroll">
            {hits.map(({ it, i }, n) => (
              <li key={i} data-sel={n === sel} onMouseMove={() => setSel(n)} onClick={() => p.done(i)}>
                <span className="truncate">{it.label}</span>{it.detail && <span className="qo-keys">{it.detail}</span>}
              </li>
            ))}
            {!hits.length && <li className="qo-none">{i18next.t("見つかりません")}</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
