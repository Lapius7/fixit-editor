import { useSyncExternalStore } from "react";
import i18next from "i18next";
import { get as settings } from "@/features/settings/settings";
import type { Node } from "@/platform/fs";

// ドラッグ中のもの。dataTransfer には Node を入れられないので、ここに持つ
export const drag: { node: Node | null; tab: string | null; from: number } = { node: null, tab: null, from: 0 };
export const dragging = () => !!(drag.node || drag.tab);
// エディタの画面に落とせるもの(タブとファイル。フォルダは開けないので受けない)
export const paneDrag = () => !!drag.tab || drag.node?.kind === "file";

// エクスプローラーの中のドラッグの見た目: 引きずっている元と、いま落とすと入るフォルダ。
// 行ごとに state を持つと dragleave が子要素でちらつくので、1か所で持って各行が自分のぶんだけ購読する
const st: { src: string | null; target: string | null } = { src: null, target: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const setDropTarget = (k: string | null) => { if (st.target !== k) { st.target = k; emit(); } };
export const setDragSrc = (k: string | null) => { if (st.src !== k) { st.src = k; emit(); } };
export const rootKey = (prefix: string) => `\0root:${prefix}`;
// 1 = 落とし先、2 = 引きずっている元
export const useDnd = (k: string) => useSyncExternalStore(sub, () => (st.target === k ? 1 : 0) | (st.src === k ? 2 : 0));

// OS(エクスプローラーなど)から引きずってきたファイル・フォルダか
export const extFiles = (e: React.DragEvent) => !drag.node && !drag.tab && e.dataTransfer.types.includes("Files");
// ドラッグでコピーにするキー(設定 dragCopyKey)。ドロップ側も同じ関数で見る
export const isCopyKey = (e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean }) => {
  const k = settings().dragCopyKey;
  return k === "alt" ? e.altKey : k === "shift" ? e.shiftKey : e.ctrlKey;
};

// 引きずっている間、カーソルのそばに「○○に移動 / ○○にコピー」の札を出す(キーの押し離し・落とし先で切り替わる)。
// ドラッグ中のイベントは間引かれて来る(約 20 回/秒)ので、直近 2 点の速度で今の位置まで先読みして、毎フレーム置く
let hint: HTMLDivElement | null = null, raf = 0, cp = false, px = 0, py = 0, pt = 0, vx = 0, vy = 0, seen = false;
const LEAD_MAX = 90; // 先読みする最大の長さ(ms)
const hintMove = (e: DragEvent) => {
  if (!hint || !drag.node) return;
  cp = isCopyKey(e);
  if (!e.clientX && !e.clientY) return; // drag の最後に来る 0,0 は捨てる
  const now = performance.now();
  if (seen && now > pt) { const dt = now - pt; vx = (e.clientX - px) / dt; vy = (e.clientY - py) / dt; }
  px = e.clientX; py = e.clientY; pt = now; seen = true;
};
const targetName = () => {
  const k = st.target;
  if (!k) return "";
  if (k.startsWith("\0root:")) return k.slice(6).split("/").filter(Boolean).pop() ?? "";
  return k.split("/").filter(Boolean).pop() ?? "";
};
const hintTick = () => {
  if (!hint) return;
  const mode = cp ? "copy" : "move", name = targetName();
  hint.dataset.mode = mode;
  const t = name ? i18next.t(cp ? "「{{name}}」にコピー" : "「{{name}}」に移動", { name }) : i18next.t(cp ? "コピー" : "移動");
  if (hint.textContent !== t) hint.textContent = t;
  if (seen) {
    const lead = Math.min(performance.now() - pt, LEAD_MAX);
    hint.style.transform = `translate(${px + vx * lead + 16}px, ${py + vy * lead + 20}px)`;
    hint.style.visibility = "";
  }
  raf = requestAnimationFrame(hintTick);
};
export const dragHint = () => {
  if (hint) return;
  hint = document.createElement("div");
  hint.className = "drag-mode";
  hint.setAttribute("aria-hidden", "true");
  hint.style.visibility = "hidden";
  document.body.appendChild(hint);
  seen = false; vx = vy = 0; cp = false;
  window.addEventListener("dragover", hintMove, true);
  window.addEventListener("drag", hintMove, true);
  raf = requestAnimationFrame(hintTick);
};
const hintOff = () => {
  window.removeEventListener("dragover", hintMove, true); window.removeEventListener("drag", hintMove, true);
  cancelAnimationFrame(raf); hint?.remove(); hint = null;
};

export const dragEnd = () => { hintOff(); drag.node = null; drag.tab = null; setDropTarget(null); setDragSrc(null); };
export const useDropTarget = () => useSyncExternalStore(sub, () => st.target);
