import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { crawl, fuzzy, type Node } from "@/platform/fs";
import { ms, useSettings } from "@/features/settings/settings";
import i18next from 'i18next'
import { Trans } from 'react-i18next'
import { displayDir, displayPath } from "@/workbench/rootpath";

type Props = { roots: { nodes: Node[]; prefix: string }[]; onPick: (n: Node) => void; onClose: () => void; out?: boolean };

export default function QuickOpen({ roots, onPick, onClose, out }: Props) {
  const max = useSettings().quickOpenMax;
  const [files, setFiles] = useState<Node[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [closing, setClosing] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => { Promise.all(roots.map((r) => crawl(r.nodes, undefined, r.prefix))).then((l) => setFiles(l.flat())); }, [roots]);

  const hits = useMemo(() => {
    if (!q.trim()) return files.slice(0, max);
    return files.map((f) => ({ f, s: fuzzy(q, displayPath(f.path)) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, max).map((x) => x.f);
  }, [files, q, max]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, ms(180)); };

  return (
    <div className="qo-backdrop" data-closing={closing || !!out} onMouseDown={() => close()}>
      <div className="qo" role="dialog" aria-label={i18next.t("ファイルを開く")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="qo-input">
          <Search />
          <input autoFocus placeholder={i18next.t("ファイル名を入力")} value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) close(() => onPick(hits[sel]));
            }} />
        </div>
        <ul ref={list} className="qo-list scroll">
          {hits.map((f, i) => (
            <li key={f.path} style={{ ["--i" as string]: i }} data-sel={i === sel} onMouseMove={() => setSel(i)} onClick={() => close(() => onPick(f))}>
              <span className="truncate">{f.name}</span><span className="qo-path truncate">{displayDir(f.path) || "/"}</span>
            </li>
          ))}
          {!hits.length && <li className="qo-none"><Trans i18nKey="見つかりません" /></li>}
        </ul>
      </div>
    </div>
  );
}
