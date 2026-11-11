import { useSyncExternalStore } from "react";
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
export const dragEnd = () => { drag.node = null; drag.tab = null; setDropTarget(null); setDragSrc(null); };
export const useDropTarget = () => useSyncExternalStore(sub, () => st.target);
