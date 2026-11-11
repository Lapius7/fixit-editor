import { memo, useId } from "react";
import i18next from "i18next";
import { Plus } from "lucide-react";
import { wsLabel, type Workspace } from "@/features/workspaces/workspaces";

// スタート画面に並べる、フォルダの形のカード。最近のワークスペースと「フォルダを開く」
const W = 168; // カードの幅(CSS px)。高さは H
const H = 124;
const FH = 92; // 手前の板の高さ
// 奥の板(右上につまみ)と手前の板(左に長いつまみ、なだらかな段で下がる)の形。clip-path と縁の線で同じ形を使う
const BACK = `M0,22 Q0,12 10,12 L92,12 C102,12 104,0 114,0 L158,0 Q168,0 168,10 L168,114 Q168,124 158,124 L10,124 Q0,124 0,114 Z`;
const FRONT = `M0,10 Q0,0 10,0 L56,0 C72,0 76,12 94,12 L158,12 Q168,12 168,22 L168,82 Q168,92 158,92 L10,92 Q0,92 0,82 Z`;

// ID から決まる数(同じワークスペースは毎回同じ絵になる)
const seed = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
};

// 奥の板の絵。色の帯を、乱れ(feTurbulence)でゆがめて、マーブル模様にする
function Art({ id, color }: { id: string; color: string }) {
  const r = seed(id);
  const uid = useId().replace(/:/g, "");
  const angle = Math.round(r() * 180), turb = Math.round(r() * 9999), fx = (0.008 + r() * 0.008).toFixed(4), fy = (0.016 + r() * 0.014).toFixed(4);
  // 帯の色の並び。ワークスペースの色を軸に、紺・白・朱・青緑を挟む
  const stops: [number, string][] = [
    [0, "#101a3c"], [0.14, color], [0.24, "#f3f5f9"], [0.3, color], [0.42, "#13254f"],
    [0.55, `color-mix(in oklab, ${color}, #e0452c 70%)`], [0.63, "#f6efe9"], [0.74, "#1f6f7a"], [0.86, color], [1, "#0d1530"],
  ];
  return (
    <svg className="fc-art" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`g${uid}`} gradientTransform={`rotate(${angle} .5 .5)`} x2=".55" spreadMethod="reflect">
          {stops.map(([o, c]) => <stop key={o} offset={o} style={{ stopColor: c }} />)}
        </linearGradient>
        <filter id={`f${uid}`} x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence type="fractalNoise" baseFrequency={`${fx} ${fy}`} numOctaves={2} seed={turb} />
          <feDisplacementMap in="SourceGraphic" scale={78} xChannelSelector="R" yChannelSelector="G" />
          <feGaussianBlur stdDeviation={0.6} />
        </filter>
      </defs>
      <rect x={-40} y={-40} width={W + 80} height={H + 80} fill={`url(#g${uid})`} filter={`url(#f${uid})`} />
    </svg>
  );
}

const day = (t: number) => new Intl.DateTimeFormat(i18next.language, { weekday: "short", month: "short", day: "numeric" }).format(t);

function Card({ id, color, label, sub, onClick, corner, aria, faint }: { id: string; color: string; label: string; sub?: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; corner?: React.ReactNode; aria: string; faint?: boolean }) {
  const edge = `e${useId().replace(/:/g, "")}`;
  return (
    <li>
      <button className={faint ? "fc fc-faint" : "fc"} onClick={onClick} aria-label={aria} title={aria}>
        <span className="fc-back" style={{ clipPath: `path("${BACK}")` }}><Art id={id} color={color} /></span>
        <span className="fc-sheet" />
        <span className="fc-front" style={{ clipPath: `path("${FRONT}")` }}>
          <svg className="fc-edge" viewBox={`0 0 ${W} ${FH}`} aria-hidden="true">
            <defs>
              <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="fc-edge-top" />
                <stop offset="1" className="fc-edge-bottom" />
              </linearGradient>
            </defs>
            <path d={FRONT} stroke={`url(#${edge})`} />
          </svg>
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

function FolderCards({ list, current, onOpen, onNew, canNew }: { list: Workspace[]; current: string | null; onOpen: (w: Workspace) => void; onNew: () => void; canNew: boolean }) {
  // ピン留めを先に、あとは最近使った順。いま開いているものは出さない
  const rows = list.filter((w) => w.id !== current && w.root.kind !== "demo")
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated).slice(0, 3);
  if (!rows.length && !canNew) return null;
  return (
    <ul className="fcards" aria-label={i18next.t("最近のワークスペース")}>
      {rows.map((w) => (
        <Card key={w.id} id={w.id} color={w.color} label={w.name} sub={day(w.updated)} aria={i18next.t("ワークスペース「{{name}}」を開く", { name: w.name }) + ` · ${wsLabel(w)}`} onClick={() => onOpen(w)} />
      ))}
      {canNew && <Card id="new" color="var(--accent)" faint label={i18next.t("フォルダを開く")} aria={i18next.t("フォルダを開く")} onClick={onNew} corner={<Plus />} />}
    </ul>
  );
}

export default memo(FolderCards);
