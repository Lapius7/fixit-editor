// 拡張機能のパネル(右側)。拡張のコードも HTML もここでは動かさず、host/guard.ts の cleanPanel が検査した部品の木を React で描く。
// 見出しは本体が持ち(どの拡張のものかを必ず示す)、拡張は中身しか決められない。
import { useEffect, useState } from "react";
import { PanelsTopLeft, X } from "lucide-react";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";
import { panelAction } from "./runtime";
import { showPanel, usePanels, useShownPanel } from "./ui";

export function ExtDock() {
  const shown = useShownPanel(), panels = usePanels();
  const cur = panels.find((p) => p.key === shown) ?? null;
  const [last, setLast] = useState(cur);
  const [mounted, setMounted] = useState(!!cur);
  useEffect(() => {
    if (cur) { setLast(cur); setMounted(true); return; }
    const h = setTimeout(() => setMounted(false), ms(260));
    return () => clearTimeout(h);
  }, [cur]);
  const p = cur ?? last;
  if (!p || (!cur && !mounted)) return null;
  const send = (action: string, value = "") => panelAction(p.ext, p.id, action, value);
  return (
    <aside className="ai-dock ports-dock ext-dock" data-closing={!cur} aria-label={i18next.t("拡張機能のパネル")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); showPanel(null); } }}>
      <div className="ai-bar">
        <span className="ai-title"><PanelsTopLeft size={15} /><span className="truncate">{i18next.t("拡張機能「{{name}}」", { name: p.name })}</span><span className="ext-dock-sub truncate">{p.title}</span></span>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={() => showPanel(null)}><X /></button>
      </div>
      <div className="ext-dock-body scroll">
        {p.nodes.map((n, i) => {
          if (n.t === "sep") return <hr key={i} className="ext-dock-sep" />;
          if (n.t === "heading") return <h3 key={i} className="ext-dock-h" data-tone={n.tone}>{n.text}</h3>;
          if (n.t === "text") return <p key={i} className="ext-dock-t" data-tone={n.tone}>{n.text}</p>;
          if (n.t === "code") return <pre key={i} className="ext-dock-code" data-tone={n.tone}>{n.text}</pre>;
          if (n.t === "button") return <button key={i} type="button" className="ext-dock-btn" onClick={() => send(n.action)}>{n.text}</button>;
          if (n.t === "input") return <input key={`${i}:${n.value}`} className="ext-dock-in" defaultValue={n.value} placeholder={n.placeholder} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(n.action, e.currentTarget.value); }} />;
          if (n.t !== "list") return null;
          return (
            <ul key={i} className="ext-dock-list">
              {n.items.map((it, j) => (
                <li key={j}>{it.action
                  ? <button type="button" className="ext-dock-row" onClick={() => send(it.action, it.label)}><span className="truncate">{it.label}</span>{it.detail && <span className="ext-dock-detail truncate">{it.detail}</span>}</button>
                  : <div className="ext-dock-row" data-static><span className="truncate">{it.label}</span>{it.detail && <span className="ext-dock-detail truncate">{it.detail}</span>}</div>}</li>
              ))}
            </ul>
          );
        })}
      </div>
    </aside>
  );
}
