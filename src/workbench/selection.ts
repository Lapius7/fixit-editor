import { useSyncExternalStore } from "react";
import type { Node } from "@/platform/fs";

// エクスプローラーの複数選択(VS Code と同じ: Ctrl+クリックで足し引き、Shift+クリックで範囲)。
// 普通のクリックは「選んだ 1 つ」を持つだけで、見た目には出さない(開いているファイルの強調と重ならないように)
let sel = new Map<string, Node>();
let anchor: string | null = null;
let shown = false;
const known = new Map<string, Node>(); // 描いた行のノード(範囲選択で、間の行を引くため)
const subs = new Set<() => void>();
const emit = () => { subs.forEach((f) => f()); watch(); };
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

// 続けて選んだ行は 1 つの塊に見せる。上下の行も選ばれているかを、見えている行の並びから data-sel-pos に入れる(CSS が角丸と枠線を決める)
const visibleRows = () => [...document.querySelectorAll<HTMLElement>("nav.tree .tree-row[data-path]")].filter((r) => !r.closest('.collapse[data-open="false"]'));
let raf = 0;
const syncEdges = () => {
  raf = 0;
  const rows = visibleRows();
  rows.forEach((r, i) => {
    if (!r.hasAttribute("data-sel")) return void r.removeAttribute("data-sel-pos");
    const up = rows[i - 1]?.hasAttribute("data-sel"), down = rows[i + 1]?.hasAttribute("data-sel");
    r.setAttribute("data-sel-pos", up && down ? "mid" : up ? "last" : down ? "first" : "only");
  });
};
// 描き直しの直後(次の描画の前)に反映する。1 フレーム遅れると、古い端の線と新しい端の線が重なって見える
const later = () => { if (!raf) { raf = 1; queueMicrotask(syncEdges); } };
let observed: Element | null = null;
const watch = () => {
  later();
  const nav = document.querySelector("nav.tree");
  if (!nav || nav === observed) return;
  observed = nav;
  new MutationObserver(later).observe(nav, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-sel", "data-open"] });
};

export const knownNode = (n: Node) => { known.set(n.path, n); };
export const selectOnly = (n: Node, show = false) => { sel = new Map([[n.path, n]]); anchor = n.path; shown = show; emit(); };
export const toggleSel = (n: Node) => {
  const m = new Map(sel);
  if (m.has(n.path)) m.delete(n.path); else m.set(n.path, n);
  sel = m; anchor = n.path; shown = true; emit();
};
export const clearSel = () => { if (!sel.size) return; sel = new Map(); anchor = null; shown = false; emit(); };

/** 起点から n までの、いま見えている行をすべて選ぶ */
export const selectRange = (n: Node) => {
  const rows = [...document.querySelectorAll<HTMLElement>("nav.tree .tree-row[data-path]")]
    .filter((r) => !r.closest('.collapse[data-open="false"]'))
    .map((r) => r.dataset.path!);
  const a = anchor ? rows.indexOf(anchor) : -1, b = rows.indexOf(n.path);
  if (a < 0 || b < 0) return selectOnly(n, true);
  const [i, j] = a < b ? [a, b] : [b, a];
  const m = new Map<string, Node>();
  for (const p of rows.slice(i, j + 1)) { const x = known.get(p); if (x) m.set(p, x); }
  sel = m; shown = true; emit();
};

/** 選んでいるもの。選んだフォルダの中のものは、フォルダに含まれるので除く */
export const selectedNodes = (): Node[] => {
  const all = [...sel.values()];
  return all.filter((x) => !all.some((y) => y !== x && y.kind === "dir" && x.path.startsWith(y.path + "/")));
};
export const isMulti = () => shown && sel.size > 1;
export const isSelectedPath = (p: string) => sel.has(p);
export const useSelected = (path: string) => useSyncExternalStore(sub, () => shown && sel.has(path));
/** 最後に選んだ行(貼り付け先に使う) */
export const anchorNode = (): Node | null => (anchor ? known.get(anchor) ?? sel.get(anchor) ?? null : null);
