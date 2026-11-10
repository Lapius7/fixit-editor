import { useSettings } from "@/features/settings/settings";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { searchRoots, type FileHits, type Hit, type Opt } from "@/editor/find";
import type { Node } from "@/platform/fs";
import i18next from 'i18next'

type Props = { roots: { nodes: Node[]; prefix: string }[]; live: Map<string, string>; seed: string; onOpen: (n: Node, h: Hit) => void };

export default function SearchPanel({ roots, live, seed, onOpen }: Props) {
  const searchMax = useSettings().searchMax;
  const [q, setQ] = useState(seed);
  const [o, setO] = useState<Opt>({ re: false, cs: false, word: false });
  const [res, setRes] = useState<FileHits[]>([]);
  const [sum, setSum] = useState("");
  const [shut, setShut] = useState<Set<string>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => { input.current?.focus(); input.current?.select(); }, [seed]);
  useEffect(() => { if (seed) setQ(seed); }, [seed]);

  useEffect(() => {
    if (!q) { setRes([]); setSum(""); return; }
    const sig = { stop: false };
    const t = setTimeout(async () => {
      setSum(i18next.t("検索中…")); setRes([]);
      const r = await searchRoots(roots, q, o, liveRef.current, sig, (p) => !sig.stop && setRes(p));
      if (!sig.stop) setSum(r.total ? i18next.t("{{files}} 件のファイルに {{total}}{{arg2}}一致", { files: r.files, total: r.total, arg2: r.capped ? " 以上の" : " 件の" }) : i18next.t("見つかりません"));
    }, 220);
    return () => { sig.stop = true; clearTimeout(t); };
  }, [q, o, roots]);

  const flag = (k: keyof Opt, label: string, tip: string) => (
    <button className="sp-opt" data-on={o[k]} title={tip} aria-label={tip} aria-pressed={o[k]} onClick={() => setO({ ...o, [k]: !o[k] })}>{label}</button>
  );

  return (
    <div className="sp">
      <div className="sp-box">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={i18next.t("全ファイルから検索")} aria-label={i18next.t("検索")} spellCheck={false} />
        {flag("cs", "Aa", i18next.t("大文字と小文字を区別"))}{flag("word", "ab", i18next.t("単語単位"))}{flag("re", ".*", i18next.t("正規表現"))}
      </div>
      <div className="sp-sum" aria-live="polite">{sum}</div>
      <div className="sp-res scroll">
        {res.map(({ node, hits }) => {
          const closed = shut.has(node.path);
          return (
            <div key={node.path}>
              <button className="sp-file" onClick={() => setShut((s) => { const n = new Set(s); closed ? n.delete(node.path) : n.add(node.path); return n; })}>
                <ChevronRight className="chev" data-open={!closed} />
                <span className="truncate">{node.name}</span><span className="sp-count">{hits.length}</span>
              </button>
              {!closed && hits.slice(0, searchMax).map((h, i) => {
                const a = Math.max(0, h.from - 24), pre = h.text.slice(a, h.from).trimStart();
                return (
                  <button key={i} className="sp-hit" onClick={() => onOpen(node, h)}>
                    <b>{h.line}</b>
                    <span className="truncate">{a > 0 ? "…" : ""}{pre}<mark>{h.text.slice(h.from, h.to)}</mark>{h.text.slice(h.to, h.to + 80)}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
