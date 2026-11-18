import { useSyncExternalStore } from "react";

// エクスプローラーの中で、新しいファイル・フォルダの名前を打っている途中の状態(VS Code と同じ)。
// at は作る場所の目印: 一覧の先頭ならルートの prefix、フォルダの中ならそのフォルダのパス
export type Creating = {
  kind: "file" | "dir";
  at: string;
  validate: (v: string) => string | null;
  submit: (v: string) => Promise<void>;
};

let cur: Creating | null = null;
let reveal: string[] = []; // 作ったあとに開いて見せたいフォルダ
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export const startCreating = (c: Creating) => { cur = c; reveal = []; emit(); };
let stoppedAt = 0;
export const stopCreating = () => { if (cur) { cur = null; stoppedAt = Date.now(); emit(); } };
/** 名前を打っている最中か、打ち終えたばかりか(作った行は、位置がずれないよう控えめに出す) */
export const creatingNow = () => !!cur || Date.now() - stoppedAt < 1500;
export const getCreating = () => cur;
export const useCreating = () => useSyncExternalStore(sub, () => cur);

/** 閉じているフォルダを開いて見せる(少し経つと忘れる。あとから描かれたフォルダだけが従う) */
export const revealPaths = (paths: string[]) => {
  reveal = paths;
  emit();
  clearTimeout(timer);
  timer = setTimeout(() => { reveal = []; emit(); }, 3000);
};

/** このフォルダは、いま開いて見せたいか(名前を打つ行の置き場、または作ったものの通り道) */
export const useWanted = (path: string) => useSyncExternalStore(sub, () => cur?.at === path || reveal.includes(path));

// エクスプローラーの中で、名前を変えている途中の状態(新規作成と同じく、行の中に入力欄を出す)
export type Renaming = { path: string; name: string; kind: "file" | "dir"; validate: (v: string) => string | null; submit: (v: string) => Promise<void> };
let ren: Renaming | null = null;
export const startRenaming = (r: Renaming) => { ren = r; emit(); };
export const stopRenaming = () => { if (ren) { ren = null; emit(); } };
export const useRenaming = () => useSyncExternalStore(sub, () => ren);
