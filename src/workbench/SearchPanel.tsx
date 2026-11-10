import { useSettings } from "@/features/settings/settings";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, SlidersHorizontal, X } from "lucide-react";
import { NO_SCOPE, scopeTest, searchRoots, type FileHits, type Hit, type Opt, type Scope } from "@/editor/find";
import type { Node } from "@/platform/fs";
import i18next from 'i18next'

type Props = { roots: { nodes: Node[]; prefix: string }[]; live: Map<string, string>; seed: string; onOpen: (n: Node, h: Hit) => void };

export default function SearchPanel({ roots, live, seed, onOpen }: Props) {
  const searchMax = useSettings().searchMax;
  const [q, setQ] = useState(seed);
  const [o, setO] = useState<Opt>({ re: false, cs: false, word: false });
  const [sc, setSc] = useState<Scope>(NO_SCOPE);
  const [showSc, setShowSc] = useState(false);
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
      const r = await searchRoots(roots, q, o, liveRef.current, sig, (p) => !sig.stop && setRes(p), sc);
      if (!sig.stop) setSum(r.total ? i18next.t("{{files}} 件のファイルに {{total}}{{arg2}}一致", { files: r.files, total: r.total, arg2: r.capped ? " 以上の" : " 件の" }) : i18next.t("見つかりません"));
    }, 220);
    return () => { sig.stop = true; clearTimeout(t); };
  }, [q, o, sc, roots]);
  const scoped = !!scopeTest(sc) || sc.open;

  const flag = (k: keyof Opt, label: string, tip: string) => (
    <button className="sp-opt" data-on={o[k]} title={tip} aria-label={tip} aria-pressed={o[k]} onClick={() => setO({ ...o, [k]: !o[k] })}>{label}</button>
  );

  return (
    <div className="sp">
      <div className="sp-box">
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={i18next.t("全ファイルから検索")} aria-label={i18next.t("検索")} spellCheck={false} />
        {q && <button className="sp-opt" title={i18next.t("消す")} aria-label={i18next.t("消す")} onClick={() => { setQ(""); input.current?.focus(); }}><X /></button>}{flag("cs", "Aa", i18next.t("大文字と小文字を区別"))}{flag("word", "ab", i18next.t("単語単位"))}{flag("re", ".*", i18next.t("正規表現"))}<button className="sp-opt" data-on={showSc || scoped} aria-pressed={showSc} title={i18next.t("対象のファイルを絞る")} aria-label={i18next.t("対象のファイルを絞る")} onClick={() => setShowSc(!showSc)}><SlidersHorizontal /></button>
      </div>
      {showSc && (
        <div className="sp-scope">
          <label className="sp-scope-row"><span>{i18next.t("含めるファイル")}</span><input value={sc.inc} onChange={(e) => setSc({ ...sc, inc: e.target.value })} placeholder="*.ts, src/**" spellCheck={false} aria-label={i18next.t("含めるファイル")} /></label>
          <label className="sp-scope-row"><span>{i18next.t("除外するファイル")}</span><input value={sc.exc} onChange={(e) => setSc({ ...sc, exc: e.target.value })} placeholder="*.test.ts, dist" spellCheck={false} aria-label={i18next.t("除外するファイル")} /></label>
          <button className="sp-scope-open" data-on={sc.open} aria-pressed={sc.open} onClick={() => setSc({ ...sc, open: !sc.open })}>{i18next.t("開いているタブだけ")}</button>
        </div>
      )}
      <div className="sp-sum"><span aria-live="polite">{sum}{scoped && res.length > 0 ? i18next.t("(絞り込み中)") : ""}</span>{res.length > 1 && <span className="sp-sum-acts"><button className="sp-opt" title={i18next.t("すべて折りたたむ")} aria-label={i18next.t("すべて折りたたむ")} onClick={() => setShut(new Set(res.map((r) => r.node.path)))}><ChevronsDownUp /></button><button className="sp-opt" title={i18next.t("すべて開く")} aria-label={i18next.t("すべて開く")} onClick={() => setShut(new Set())}><ChevronsUpDown /></button></span>}</div>
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
