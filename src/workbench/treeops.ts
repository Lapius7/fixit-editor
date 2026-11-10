import type { Node } from "@/platform/fs";

const sort = (a: Node, b: Node) => (a.kind === b.kind ? a.name.localeCompare(b.name, "ja", { numeric: true }) : a.kind === "dir" ? -1 : 1);
export const dirOf = (p: string) => p.slice(0, p.lastIndexOf("/"));

// メモリ上のツリー(デモ用)を、パスで指定して作り替える
export function addNode(nodes: Node[], parent: string, n: Node): Node[] {
  if (!parent) return [...nodes, n].sort(sort);
  return nodes.map((x) => (x.path === parent ? { ...x, children: [...(x.children ?? []), n].sort(sort) } : x.children ? { ...x, children: addNode(x.children, parent, n) } : x));
}
export function removeNode(nodes: Node[], path: string): Node[] {
  return nodes.filter((x) => x.path !== path).map((x) => (x.children ? { ...x, children: removeNode(x.children, path) } : x));
}
function reroot(n: Node, from: string, to: string): Node {
  return { ...n, path: to + n.path.slice(from.length), children: n.children?.map((c) => reroot(c, from, to)) };
}
export function renameNode(nodes: Node[], path: string, name: string): Node[] {
  return nodes.map((x) => {
    if (x.path === path) return { ...reroot(x, path, `${dirOf(path)}/${name}`), name };
    return x.children ? { ...x, children: renameNode(x.children, path, name) } : x;
  }).sort(sort);
}
export const exists = (nodes: Node[], path: string): boolean => nodes.some((x) => x.path === path || (x.children ? exists(x.children, path) : false));

export const findNode = (nodes: Node[], path: string): Node | null => {
  for (const x of nodes) { if (x.path === path) return x; const r = x.children && findNode(x.children, path); if (r) return r; }
  return null;
};
// デモのツリー: path のものを dest(空なら最上位)の中へ移す
export function moveNode(nodes: Node[], path: string, dest: string): Node[] {
  const n = findNode(nodes, path);
  if (!n) return nodes;
  return addNode(removeNode(nodes, path), dest, reroot(n, path, `${dest}/${n.name}`));
}
