import { ms } from "@/features/settings/settings";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { chips } from "@/features/settings/keys";
import { fuzzy } from "@/platform/fs";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

export type Cmd = { id: string; label: string; group: string; keys?: string; icon?: ReactNode; run: () => void };

// コマンドパレット(Ctrl+Shift+P)
export default function Palette({ cmds, onClose, out }: { cmds: Cmd[]; onClose: () => void; out?: boolean }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [closing, setClosing] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  const hits = useMemo(() => {
    const s = q.trim();
    if (!s) return cmds;
    return cmds.map((c) => ({ c, s: Math.max(fuzzy(s, c.label), fuzzy(s, `${c.group} ${c.label}`) - 1) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.c);
  }, [cmds, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, ms(180)); };

  return (
    <div className="qo-backdrop" data-closing={closing || !!out} onMouseDown={() => close()}>
      <div className="qo" role="dialog" aria-label={i18next.t("コマンドパレット")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="qo-input">
          <Search />
          <input autoFocus placeholder={i18next.t("コマンドを入力")} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) close(hits[sel].run);
            }} />
        </div>
        <ul ref={list} className="qo-list scroll">
          {hits.map((c, i) => (
            <li key={c.id} style={{ ["--i" as string]: i }} data-sel={i === sel} onMouseMove={() => setSel(i)} onClick={() => close(c.run)}>
              {c.icon}
              <span className="truncate">{c.label}</span>
              {c.keys && <span className="qo-keys">{chips(c.keys).map((k, j) => <kbd key={j}>{k}</kbd>)}</span>}
            </li>
          ))}
          {!hits.length && <li className="qo-none"><Trans i18nKey="見つかりません" /></li>}
        </ul>
      </div>
    </div>
  );
}
