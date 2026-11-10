// 画面の分割を、木で表す。葉が1つの画面(エディタ)、枝が「左右」か「上下」の分割。
// 画面の番号(id)は葉ごとに固有で、分割していないときは 0 になる。
export type Dir = "col" | "row"; // col = 左右に並べる / row = 上下に並べる
export type Lay = { id: number } | { dir: Dir; r: number; a: Lay; b: Lay }; // r: a の割合(20..80)
export type Edge = "L" | "R" | "T" | "B";

export const LEAF0: Lay = { id: 0 };
export const isLeaf = (l: Lay): l is { id: number } => "id" in l;
export const leaves = (l: Lay): number[] => (isLeaf(l) ? [l.id] : [...leaves(l.a), ...leaves(l.b)]);
export const has = (l: Lay, id: number): boolean => leaves(l).includes(id);
export const nextId = (l: Lay) => Math.max(...leaves(l)) + 1;
export const clampR = (r: number) => Math.min(80, Math.max(20, Math.round(r)));

/** 葉 id を、dir 方向に2つへ割る。edge が "L"/"T" なら新しい画面が先(左・上)に来る */
export function splitLeaf(l: Lay, id: number, fresh: number, edge: Edge, r = 50): Lay {
  if (isLeaf(l)) {
    if (l.id !== id) return l;
    const dir: Dir = edge === "L" || edge === "R" ? "col" : "row";
    const old: Lay = { id }, nu: Lay = { id: fresh };
    return edge === "L" || edge === "T" ? { dir, r: 100 - r, a: nu, b: old } : { dir, r, a: old, b: nu };
  }
  return { ...l, a: splitLeaf(l.a, id, fresh, edge, r), b: splitLeaf(l.b, id, fresh, edge, r) };
}

/** 葉を取り除く。親の枝は、残った兄弟に置き換わる */
export function removeLeaf(l: Lay, id: number): Lay | null {
  if (isLeaf(l)) return l.id === id ? null : l;
  const a = removeLeaf(l.a, id), b = removeLeaf(l.b, id);
  if (!a) return b;
  if (!b) return a;
  return a === l.a && b === l.b ? l : { ...l, a, b };
}

/** 葉を取り除いたあと、残りの葉の id を 0,1,2… に振り直す(1つなら 0)。戻り値の map は 旧id→新id */
export function renumber(l: Lay): { lay: Lay; map: Map<number, number> } {
  const map = new Map<number, number>();
  leaves(l).forEach((id, k) => map.set(id, k));
  const go = (n: Lay): Lay => (isLeaf(n) ? { id: map.get(n.id)! } : { ...n, a: go(n.a), b: go(n.b) });
  return { lay: go(l), map };
}

/** 葉 id の親の枝の向きを入れ替える(左右⇔上下) */
export function flipAround(l: Lay, id: number): Lay {
  if (isLeaf(l)) return l;
  if ((isLeaf(l.a) && l.a.id === id) || (isLeaf(l.b) && l.b.id === id)) return { ...l, dir: l.dir === "col" ? "row" : "col" };
  return { ...l, a: flipAround(l.a, id), b: flipAround(l.b, id) };
}

/** 葉 x と y を入れ替える(中身ではなく場所) */
export function swapLeaves(l: Lay, x: number, y: number): Lay {
  if (isLeaf(l)) return l.id === x ? { id: y } : l.id === y ? { id: x } : l;
  return { ...l, a: swapLeaves(l.a, x, y), b: swapLeaves(l.b, x, y) };
}

/** 枝 path(0=a,1=b の並び)の割合を変える */
export function setRatio(l: Lay, path: number[], r: number): Lay {
  if (isLeaf(l)) return l;
  if (!path.length) return { ...l, r: clampR(r) };
  return path[0] === 0 ? { ...l, a: setRatio(l.a, path.slice(1), r) } : { ...l, b: setRatio(l.b, path.slice(1), r) };
}

/** 葉が、窓の上端に接しているか(接している葉のタブ列は、上の帯に置く) */
export function onTop(l: Lay, id: number): boolean {
  if (isLeaf(l)) return l.id === id;
  if (has(l.a, id)) return onTop(l.a, id);
  return l.dir === "col" && onTop(l.b, id);
}

/** 上端に接している葉を、左から順に */
export function topLeaves(l: Lay): number[] {
  if (isLeaf(l)) return [l.id];
  return l.dir === "col" ? [...topLeaves(l.a), ...topLeaves(l.b)] : topLeaves(l.a);
}

/** 窓の右端に接している葉のうち、いちばん上のもの(右上のボタンを置く) */
export function topRight(l: Lay): number {
  if (isLeaf(l)) return l.id;
  return l.dir === "col" ? topRight(l.b) : topRight(l.a);
}

/** 画面の外側の矩形(0..1)を、葉ごとに求める(ドラッグの受け口に使う) */
export type Box = { x: number; y: number; w: number; h: number };
export function boxes(l: Lay, b: Box = { x: 0, y: 0, w: 1, h: 1 }, out = new Map<number, Box>()): Map<number, Box> {
  if (isLeaf(l)) { out.set(l.id, b); return out; }
  const f = l.r / 100;
  if (l.dir === "col") {
    boxes(l.a, { ...b, w: b.w * f }, out);
    boxes(l.b, { ...b, x: b.x + b.w * f, w: b.w * (1 - f) }, out);
  } else {
    boxes(l.a, { ...b, h: b.h * f }, out);
    boxes(l.b, { ...b, y: b.y + b.h * f, h: b.h * (1 - f) }, out);
  }
  return out;
}

/** 保存してある古い形(2画面・向き・割合)から、木を作る */
export function fromPair(split: boolean, dir: Dir, r: number): Lay {
  return split ? { dir, r: clampR(r), a: { id: 0 }, b: { id: 1 } } : LEAF0;
}

/** 保存したものが木として正しいか(壊れていれば捨てる) */
export function valid(x: unknown): x is Lay {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if ("id" in o) return Number.isInteger(o.id) && (o.id as number) >= 0;
  return (o.dir === "col" || o.dir === "row") && typeof o.r === "number" && valid(o.a) && valid(o.b);
}

/** 分割の境目(枝)を、path・向き・割合・外側の矩形つきで列挙する(境界線の位置に使う) */
export type Joint = { path: number[]; dir: Dir; r: number; box: Box };
export function joints(l: Lay, b: Box = { x: 0, y: 0, w: 1, h: 1 }, path: number[] = [], out: Joint[] = []): Joint[] {
  if (isLeaf(l)) return out;
  out.push({ path, dir: l.dir, r: l.r, box: b });
  const f = l.r / 100;
  if (l.dir === "col") {
    joints(l.a, { ...b, w: b.w * f }, [...path, 0], out);
    joints(l.b, { ...b, x: b.x + b.w * f, w: b.w * (1 - f) }, [...path, 1], out);
  } else {
    joints(l.a, { ...b, h: b.h * f }, [...path, 0], out);
    joints(l.b, { ...b, y: b.y + b.h * f, h: b.h * (1 - f) }, [...path, 1], out);
  }
  return out;
}
