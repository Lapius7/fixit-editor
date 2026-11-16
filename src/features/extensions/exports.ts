// 拡張機能のコマンド行の組み立て(テストしやすいよう、画面から分けてある)
import { shq } from "@/features/run/runners";
import type { ExtCommand } from "./spec";
export type { Installed } from "./registry";

const BAD = /["`$\r\n%]/; // runners.ts と同じ。シェルに解釈される文字を含むパスは使わない
const dirOf = (p: string) => { const k = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return k > 0 ? p.slice(0, k) : k === 0 ? p.slice(0, 1) : "."; };

/** {file} {dir} {root} を埋めてコマンド行にする。足りない値があるか、パスに使えない文字があれば null */
export function buildExtCommand(c: ExtCommand, v: { file: string | null; root: string | null }): { line: string; dir: string | null } | null {
  const vals: Record<string, string | null> = { file: v.file, dir: v.file ? dirOf(v.file) : v.root, root: v.root };
  const parts: string[] = [];
  for (const a of c.args) {
    let ok = true;
    const out = a.replace(/\{(file|dir|root)\}/g, (_, w: string) => {
      const p = vals[w];
      if (!p || BAD.test(p)) { ok = false; return ""; }
      const base = w === "file" && p.split(/[\\/]/).pop()!.startsWith("-") ? `./${p.split(/[\\/]/).pop()}` : p;
      return base;
    });
    if (!ok) return null;
    parts.push(shq(out));
  }
  return { line: [c.cmd, ...parts].join(" "), dir: v.root };
}
