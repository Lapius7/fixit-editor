import { memo } from "react";
import i18next from "i18next";
import { Plus } from "lucide-react";
import { wsLabel, type Workspace } from "@/features/workspaces/workspaces";

// スタート画面に並べる、フォルダの形のカード。最近のワークスペースと「フォルダを開く」
const W = 200;
// 奥の板(右上につまみ)と手前の板(左上につまみ)の形。CSS の clip-path と縁の線で同じ形を使う
const BACK = `M0,28 Q0,14 14,14 L104,14 C116,14 116,0 128,0 L186,0 Q200,0 200,14 L200,134 Q200,148 186,148 L14,148 Q0,148 0,134 Z`;
const FRONT = `M0,14 Q0,0 14,0 L70,0 C82,0 82,12 94,12 L186,12 Q200,12 200,26 L200,94 Q200,108 186,108 L14,108 Q0,108 0,94 Z`;

// ID から決まる数(同じワークスペースは毎回同じ絵になる)
const seed = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000; };
function art(id: string, color: string): React.CSSProperties {
  const r = seed(id), p = (a: number, b: number) => Math.round(a + r() * (b - a));
  return {
    "--fc-c": color,
    "--fc-x1": `${p(5, 45)}%`, "--fc-y1": `${p(10, 70)}%`,
    "--fc-x2": `${p(55, 95)}%`, "--fc-y2": `${p(20, 90)}%`,
    "--fc-a": `${p(0, 360)}deg`,
  } as React.CSSProperties;
}

const day = (t: number) => new Intl.DateTimeFormat(i18next.language, { weekday: "short", month: "short", day: "numeric" }).format(t);

function Card({ label, sub, style, onClick, corner, aria }: { label: string; sub?: string; style: React.CSSProperties; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; corner?: React.ReactNode; aria: string }) {
  return (
    <li>
      <button className="fc" style={style} onClick={onClick} aria-label={aria} title={aria}>
        <span className="fc-back" style={{ clipPath: `path("${BACK}")` }}><span className="fc-art" /></span>
        <span className="fc-sheet" />
        <span className="fc-front" style={{ clipPath: `path("${FRONT}")` }}>
          <svg className="fc-edge" viewBox={`0 0 ${W} 108`} aria-hidden="true"><path d={FRONT} /></svg>
          <span className="fc-txt">
            <span className="fc-name truncate">{label}</span>
            {sub && <span className="fc-sub truncate">{sub}</span>}
          </span>
          {corner && <span className="fc-corner">{corner}</span>}
        </span>
      </button>
    </li>
  );
}

function FolderCards({ list, current, onOpen, onNew, canNew }: { list: Workspace[]; current: string | null; onOpen: (w: Workspace, at: { x: number; y: number }) => void; onNew: () => void; canNew: boolean }) {
  // ピン留めを先に、あとは最近使った順。いま開いているものは出さない
  const rows = list.filter((w) => w.id !== current && w.root.kind !== "demo")
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated).slice(0, 3);
  if (!rows.length && !canNew) return null;
  const from = (e: React.MouseEvent<HTMLElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    // キーボードで押したとき(座標が 0)は、カードの中央から
    return e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  };
  return (
    <ul className="fcards" aria-label={i18next.t("最近のワークスペース")}>
      {rows.map((w) => (
        <Card key={w.id} label={w.name} sub={day(w.updated)} style={art(w.id, w.color)} aria={i18next.t("ワークスペース「{{name}}」を開く", { name: w.name }) + ` · ${wsLabel(w)}`} onClick={(e) => onOpen(w, from(e))} />
      ))}
      {canNew && <Card label={i18next.t("フォルダを開く")} style={{ ...art("new", "var(--accent)"), "--fc-k": ".55" } as React.CSSProperties} aria={i18next.t("フォルダを開く")} onClick={onNew} corner={<Plus />} />}
    </ul>
  );
}

export default memo(FolderCards);
