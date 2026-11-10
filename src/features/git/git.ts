// Git の状態。開いているフォルダが Git のリポジトリなら、変更のあるファイルと、いまのブランチを調べる。
// 読むだけで、何も書き換えない(コミットなどは、ターミナルで行う)。
import { gitHeadText, gitStatusRaw, type Conn } from "@/platform/remote";

export type Code = "M" | "A" | "D" | "U" | "R" | "C"; // 変更・追加・削除・未追跡・名前変更・衝突
export type GitInfo = { root: string; branch: string; files: Map<string, Code>; dirs: Set<string> };

const codeOf = (x: string, y: string): Code => {
  if (x === "?" && y === "?") return "U";
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) return "C";
  if (x === "D" || y === "D") return "D";
  if (x === "R" || y === "R") return "R";
  if (x === "A") return "A";
  return "M";
};

// porcelain v1 の -z 出力: 先頭にリポジトリの場所とブランチを足してある。名前変更は、新しい名前のあとに元の名前が続く
function parseStatus(raw: string): GitInfo | null {
  const p = raw.split("\0");
  if (p.length < 2) return null;
  const root = p[0].replace(/\/+$/, ""), branch = p[1];
  const files = new Map<string, Code>(), dirs = new Set<string>();
  for (let i = 2; i < p.length; i++) {
    const e = p[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], rel = e.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") i++; // 元の名前は読み飛ばす
    const abs = `${root}/${rel}`;
    files.set(abs, codeOf(x, y));
    for (let d = abs.lastIndexOf("/"); d > root.length; d = abs.lastIndexOf("/", d - 1)) dirs.add(abs.slice(0, d));
    dirs.add(root);
  }
  return { root, branch, files, dirs };
}

export async function loadGit(conn: Conn, dir: string): Promise<GitInfo | null> {
  try { const raw = await gitStatusRaw(conn, dir); return raw ? parseStatus(raw) : null; } catch { return null; }
}

// ガターに出す差分の元。未追跡のファイルは、全行が追加。変更の無い・Git 管理外のものは HEAD をそのまま返す
export async function loadBase(conn: Conn, file: string, code: Code | undefined): Promise<string | null> {
  if (code === "U") return "";
  try {
    const t = await gitHeadText(conn, file);
    return t === null && code === "A" ? "" : t;
  } catch { return null; }
}
