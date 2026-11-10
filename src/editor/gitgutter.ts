// 変更した行の印(Git の HEAD との差)。追加は緑、変更は青、削除は赤の三角を、行番号の右の細い列に出す。
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type Text } from "@codemirror/state";
import { GutterMarker, ViewPlugin, gutter, type EditorView, type ViewUpdate } from "@codemirror/view";

type Kind = "add" | "mod" | "del";
class Mark extends GutterMarker {
  constructor(readonly kind: Kind) { super(); }
  eq(o: Mark) { return o.kind === this.kind; }
  toDOM() { const d = document.createElement("div"); d.className = `cm-git-mark cm-git-${this.kind}`; return d; }
}
const MARKS: Record<Kind, Mark> = { add: new Mark("add"), mod: new Mark("mod"), del: new Mark("del") };

export const setGitBase = StateEffect.define<string | null>();
const setMarks = StateEffect.define<RangeSet<GutterMarker>>();

const baseField = StateField.define<string | null>({
  create: () => null,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setGitBase)) return e.value; return v; },
});
const markField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update: (v, tr) => { for (const e of tr.effects) if (e.is(setMarks)) return e.value; return tr.docChanged ? v.map(tr.changes) : v; },
});

// 行どうしの差。前後の同じ行を落としてから、最長共通部分列で突き合わせる(大きすぎるときは諦める)
export type Hunk = { from: number; to: number; del: number }; // 新しい側の行(0 始まり、[from,to))と、そこで消えた行数
export function lineDiff(a: string[], b: string[]): Hunk[] | null {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const n = ea - s, m = eb - s;
  if (!n && !m) return [];
  if (!n) return [{ from: s, to: eb, del: 0 }];
  if (!m) return [{ from: s, to: s, del: n }];
  if (n * m > 4_000_000) return null;
  if (Math.max(n, m) > 65000) return null; // 一致の長さを 16bit で持つので、行数の上限で切る
  const w = m + 1, t = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    t[i * w + j] = a[s + i] === b[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const out: Hunk[] = [];
  let i = 0, j = 0, cur: Hunk | null = null;
  const flush = () => { if (cur) { out.push(cur); cur = null; } };
  while (i < n || j < m) {
    if (i < n && j < m && a[s + i] === b[s + j]) { flush(); i++; j++; }
    else if (j < m && (i >= n || t[i * w + j + 1] >= t[(i + 1) * w + j])) { cur ??= { from: s + j, to: s + j, del: 0 }; cur.to = s + j + 1; j++; }
    else { cur ??= { from: s + j, to: s + j, del: 0 }; cur.del++; i++; }
  }
  flush();
  return out;
}

const linesOf = (t: string) => { const l = t.split("\n"); if (l[l.length - 1] === "") l.pop(); return l; };
const docLines = (d: Text) => { const l: string[] = []; for (let i = 1; i <= d.lines; i++) l.push(d.line(i).text); if (l.length && l[l.length - 1] === "" ) l.pop(); return l; };

function build(doc: Text, base: string): RangeSet<GutterMarker> {
  const hunks = lineDiff(linesOf(base.replace(/\r\n/g, "\n")), docLines(doc));
  const b = new RangeSetBuilder<GutterMarker>();
  if (!hunks) return b.finish();
  const at = (line0: number) => doc.line(Math.min(doc.lines, Math.max(1, line0 + 1))).from;
  for (const h of hunks) {
    if (h.to > h.from) for (let l = h.from; l < h.to; l++) b.add(at(l), at(l), MARKS[h.del ? "mod" : "add"]);
    else b.add(at(h.from), at(h.from), MARKS.del); // 消えただけの所は、その位置の行に三角を置く
  }
  return b.finish();
}

const calc = ViewPlugin.fromClass(class {
  timer = 0;
  constructor(readonly v: EditorView) { this.schedule(0); }
  update(u: ViewUpdate) { if (u.docChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setGitBase)))) this.schedule(u.docChanged ? 250 : 0); }
  schedule(ms: number) { clearTimeout(this.timer); this.timer = window.setTimeout(() => this.run(), ms); }
  run() {
    const base = this.v.state.field(baseField);
    this.v.dispatch({ effects: setMarks.of(base === null ? RangeSet.empty : build(this.v.state.doc, base)) });
  }
  destroy() { clearTimeout(this.timer); }
});

export const gitGutter = () => [
  baseField, markField, calc,
  gutter({ class: "cm-git-gutter", markers: (v) => v.state.field(markField), initialSpacer: () => MARKS.add }),
];
