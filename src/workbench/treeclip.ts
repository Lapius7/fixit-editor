import { useSyncExternalStore } from "react";
import type { Node } from "@/platform/fs";

// エクスプローラー内のコピー・切り取り。選んだ行を持っておき、貼り付けで写す・移す。
// OS のクリップボードにはパスの文字を書く。貼り付けのときに文字が同じなら「このアプリで持っているもの」と見なし、
// 別のところで新しくコピーされていれば(文字が違えば)そちらを優先する
type Clip = { mode: "copy" | "cut"; nodes: Node[]; sig: string };
let clip: Clip | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const setTreeClip = (mode: Clip["mode"], nodes: Node[], sig: string) => { clip = { mode, nodes, sig }; emit(); };
export const clearTreeClip = () => { if (clip) { clip = null; emit(); } };
/** 貼り付けるもの。OS 側の文字が変わっていれば(別でコピーされたので)なし */
export const treeClipFor = (text: string): Clip | null => (clip && clip.sig === text ? clip : null);
export const hasTreeClip = () => !!clip;
/** 切り取り中の行か(薄く見せる) */
export const useCut = (path: string) => useSyncExternalStore(sub, () => clip?.mode === "cut" && clip.nodes.some((n) => n.path === path || path.startsWith(n.path + "/")));
export const getTreeClip = () => clip;
