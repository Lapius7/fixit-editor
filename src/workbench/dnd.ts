import type { Node } from "@/platform/fs";

// ドラッグ中のもの。dataTransfer には Node を入れられないので、ここに持つ
export const drag: { node: Node | null; tab: string | null; from: 0 | 1 } = { node: null, tab: null, from: 0 };
export const dragging = () => !!(drag.node || drag.tab);
export const dragEnd = () => { drag.node = null; drag.tab = null; };
