// 保存するとき、インデントを「スペース/タブ」と「幅」の設定に合わせて直す。
// 行頭の空白だけを動かす。複数行の文字列・テンプレート・コメントの中は触らない。
// 元の 1 段の幅は、続く行との差でいちばん多いものから推し量る(決められなければ何もしない)。

const SKIP = /(^|\/)(makefile|gnumakefile)$|\.(mk|tsv|md|markdown|diff|patch)$/i;

// 行ごとに「文字列などの途中から始まるか」を返す(三連引用符・バッククォート・/* */ だけを数える)
function inside(lines: string[]): boolean[] {
  const out: boolean[] = [];
  let open: string | null = null;
  for (const raw of lines) {
    out.push(open !== null);
    let i = 0;
    while (i < raw.length) {
      if (open === null) {
        const t3 = raw.slice(i, i + 3);
        if (t3 === '"""' || t3 === "'''") { open = t3; i += 3; continue; }
        if (raw[i] === "`") { open = "`"; i++; continue; }
        if (raw[i] === "/" && raw[i + 1] === "*") { open = "*/"; i += 2; continue; }
        i++;
      } else {
        const t = open;
        if (t === "`" && raw[i] === "\\") { i += 2; continue; }
        if (raw.startsWith(t, i)) { i += t.length; open = null; continue; }
        i++;
      }
    }
  }
  return out;
}

const lead = (s: string) => /^[ \t]*/.exec(s)![0];
const blank = (s: string) => s.trim() === "";

export function reindent(text: string, path: string, opts: { size: number; spaces: boolean }): string {
  if (SKIP.test(path) || !text.includes("\n")) return text;
  const lines = text.split("\n");
  const skip = inside(lines);
  // 1 段の幅(スペースで字下げされているファイルだけ)
  const votes = new Map<number, number>();
  let prev = -1, tabs = 0, spaced = 0;
  lines.forEach((l, i) => {
    if (skip[i] || blank(l)) return;
    const w = lead(l);
    if (w.includes("\t")) { tabs++; prev = -1; return; }
    if (w.length > 0) spaced++;
    if (prev >= 0 && w.length > prev) votes.set(w.length - prev, (votes.get(w.length - prev) ?? 0) + 1);
    prev = w.length;
  });
  let unit = 0, best = 0;
  for (const [d, n] of [...votes].sort((a, b) => a[0] - b[0])) if ([2, 3, 4, 8].includes(d) && n > best) { unit = d; best = n; }
  if (tabs > 0 && spaced > 0) return text; // 混ざっているファイルは判断しない
  if (tabs === 0 && !unit) return text;
  const lv = (n: number) => (opts.spaces ? " ".repeat(n * opts.size) : "\t".repeat(n));
  const out = lines.map((l, i) => {
    if (skip[i] || blank(l)) return l;
    const w = lead(l);
    if (!w) return l;
    let next: string;
    if (tabs > 0) { // タブの字下げ: 先頭のタブの数が段の数。そのあとのスペースは揃えなので残す
      const t = /^\t*/.exec(w)![0].length;
      next = lv(t) + w.slice(t);
    } else {
      const levels = Math.floor(w.length / unit), rest = w.length % unit;
      next = lv(levels) + " ".repeat(rest);
    }
    return next === w ? l : next + l.slice(w.length);
  });
  return out.join("\n");
}
