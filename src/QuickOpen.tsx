import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { crawl, fuzzy, type Node } from "./lib/fs";

type Props = { nodes: Node[]; onPick: (n: Node) => void; onClose: () => void };

export default function QuickOpen({ nodes, onPick, onClose }: Props) {
  const [files, setFiles] = useState<Node[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [closing, setClosing] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => { crawl(nodes).then(setFiles); }, [nodes]);

  const hits = useMemo(() => {
    if (!q.trim()) return files.slice(0, 50);
    return files.map((f) => ({ f, s: fuzzy(q, f.path.slice(1)) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 50).map((x) => x.f);
  }, [files, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, 130); };

  return (
    <div className="qo-backdrop" data-closing={closing} onMouseDown={() => close()}>
      <div className="qo" role="dialog" aria-label="ファイルを開く" onMouseDown={(e) => e.stopPropagation()}>
        <div className="qo-input">
          <Search />
          <input autoFocus placeholder="ファイル名を入力" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              else if (e.key === "Enter" && hits[sel]) close(() => onPick(hits[sel]));
            }} />
        </div>
        <ul ref={list} className="qo-list scroll">
          {hits.map((f, i) => (
            <li key={f.path} data-sel={i === sel} onMouseMove={() => setSel(i)} onClick={() => close(() => onPick(f))}>
              <span className="truncate">{f.name}</span><span className="qo-path truncate">{f.path.slice(1, -f.name.length - 1) || "/"}</span>
            </li>
          ))}
          {!hits.length && <li className="qo-none">見つかりません</li>}
        </ul>
      </div>
    </div>
  );
}
