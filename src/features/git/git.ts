// Git の状態。開いているフォルダが Git のリポジトリなら、変更のあるファイルと、いまのブランチを調べる。
// ファイルツリーの印・ガターは読むだけ。ステージ・コミット・ブランチ操作は、下の gitRead / gitWrite で行う(固定の操作名だけを backend に渡す)。
import { gitHeadText, gitRun, gitStatusRaw, type Conn } from "@/platform/remote";

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

// ---- Git パネル ----
export type Change = { path: string; x: string; y: string; orig?: string };
export type Status = { branch: string; upstream: string; ahead: number; behind: number; detached: boolean; staged: Change[]; unstaged: Change[]; conflicts: Change[] };
export type RefKind = "head" | "local" | "remote" | "tag";
export type Ref = { name: string; kind: RefKind };
export type Commit = { hash: string; parents: string[]; author: string; at: number; refs: Ref[]; subject: string };
export type Branch = { name: string; remote: boolean; current: boolean; upstream: string; track: string; hash: string; subject: string };
export type FileChange = { status: string; path: string; orig?: string };
export type Seg = { x1: number; y1: number; x2: number; y2: number; color: number };
export type GraphRow = { commit: Commit; col: number; color: number; segs: Seg[]; width: number };

export class GitError extends Error {}

// 読み取り。失敗(終了コードが 0 以外)は例外にする。差分だけは、違いがあると 1 を返す
export async function gitRead(conn: Conn, root: string, body: Record<string, unknown>): Promise<string> {
  const r = await gitRun(conn, root, body);
  if (r.code !== 0 && !(r.code === 1 && body.cmd === "diff" && body.untracked)) throw new GitError(r.out.trim() || `git ${String(body.cmd)} (${r.code})`);
  return r.out;
}
// 書き込み。失敗したときは、git のエラー文を例外にする
export async function gitWrite(conn: Conn, root: string, body: Record<string, unknown>): Promise<string> {
  const r = await gitRun(conn, root, body);
  if (r.code !== 0) throw new GitError(r.out.trim() || `git ${String(body.cmd)} (${r.code})`);
  return r.out;
}

// status --porcelain=v1 -z -b。先頭の項目が "## main...origin/main [ahead 1, behind 2]"
export function parseChanges(raw: string): Status {
  const p = raw.split("\0");
  const st: Status = { branch: "", upstream: "", ahead: 0, behind: 0, detached: false, staged: [], unstaged: [], conflicts: [] };
  const head = p[0]?.startsWith("## ") ? p[0].slice(3) : "";
  const m = /^(.*?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head);
  if (m) {
    st.branch = m[1].replace(/^No commits yet on /, "").replace(/^Initial commit on /, "");
    st.upstream = m[2] ?? "";
    const a = /ahead (\d+)/.exec(m[3] ?? ""), b = /behind (\d+)/.exec(m[3] ?? "");
    st.ahead = a ? +a[1] : 0; st.behind = b ? +b[1] : 0;
    if (st.branch.startsWith("HEAD (no branch)")) { st.detached = true; st.branch = "HEAD"; }
  }
  for (let i = 1; i < p.length; i++) {
    const e = p[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], c: Change = { path: e.slice(3), x, y };
    if (x === "R" || x === "C" || y === "R" || y === "C") c.orig = p[++i];
    if (x === "?" && y === "?") st.unstaged.push(c);
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) st.conflicts.push(c);
    else { if (x !== " ") st.staged.push(c); if (y !== " ") st.unstaged.push(c); }
  }
  return st;
}

function parseRefs(d: string, remotes: Set<string>): Ref[] {
  if (!d) return [];
  return d.split(", ").map((x): Ref => {
    if (x.startsWith("HEAD -> ")) return { name: x.slice(8), kind: "head" };
    if (x === "HEAD") return { name: "HEAD", kind: "head" };
    if (x.startsWith("tag: ")) return { name: x.slice(5), kind: "tag" };
    return { name: x, kind: x.includes("/") && remotes.has(x.split("/")[0]) ? "remote" : "local" };
  }).filter((r) => !r.name.endsWith("/HEAD"));
}

// log の -z 出力。1件が NUL 区切りで、中は 0x1f 区切り(hash, parents, author, at, refs, subject)
// remotes は、リモートの名前(origin など)。feat/x のような名前のローカルブランチと見分けるのに使う
export function parseLog(raw: string, remotes: Set<string> = new Set(["origin"])): Commit[] {
  return raw.split("\0").filter(Boolean).map((r) => {
    const f = r.replace(/^\n/, "").split("\x1f");
    return { hash: f[0], parents: f[1] ? f[1].split(" ") : [], author: f[2] ?? "", at: +(f[3] ?? 0) * 1000, refs: parseRefs(f[4] ?? "", remotes), subject: f[5] ?? "" };
  }).filter((c) => c.hash);
}

export function parseBranches(raw: string): Branch[] {
  const out: Branch[] = [];
  for (const line of raw.split("\n")) {
    const f = line.split("\x1f");
    if (f.length < 6) continue;
    const remote = f[0].startsWith("refs/remotes/");
    if (remote && f[0].endsWith("/HEAD")) continue;
    out.push({ name: f[1], remote, current: f[4] === "*", upstream: f[2], track: f[3], hash: f[5], subject: f[6] ?? "" });
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current) || Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name));
}

// show --name-status -z -M。「状態 NUL 名前」の繰り返しで、名前変更・複製は名前が2つ続く
export function parseFiles(raw: string): FileChange[] {
  const p = raw.split("\0").filter((x) => x !== "" && x !== "\n");
  const out: FileChange[] = [];
  for (let i = 0; i < p.length; i++) {
    const st = p[i].trim()[0];
    if (st === "R" || st === "C") { out.push({ status: st, orig: p[i + 1], path: p[i + 2] }); i += 2; }
    else { out.push({ status: st, path: p[i + 1] }); i++; }
  }
  return out.filter((f) => f.path);
}

// 枝の線を引くための計算。列(lane)を左から詰め、各行について「上半分・下半分」の線分を作る。y は 0(上端)・0.5(丸の中心)・1(下端)
export function buildGraph(commits: Commit[]): GraphRow[] {
  type Lane = { h: string; color: number } | null;
  let lanes: Lane[] = [], next = 0;
  const rows: GraphRow[] = [];
  for (const c of commits) {
    const before = lanes.slice();
    const hit = before.flatMap((l, k) => (l?.h === c.hash ? [k] : []));
    let col: number, color: number;
    if (hit.length) { col = hit[0]; color = before[col]!.color; }
    else { col = lanes.findIndex((l) => !l); if (col < 0) col = lanes.length; color = next++; lanes[col] = { h: c.hash, color }; }
    const segs: Seg[] = [];
    before.forEach((l, k) => {
      if (!l) return;
      if (l.h === c.hash) segs.push({ x1: k, y1: 0, x2: col, y2: 0.5, color: l.color });
      else segs.push({ x1: k, y1: 0, x2: k, y2: 1, color: l.color });
    });
    for (const k of hit) lanes[k] = null;
    c.parents.forEach((ph, i) => {
      const j = lanes.findIndex((l) => l?.h === ph);
      if (j >= 0) { segs.push({ x1: col, y1: 0.5, x2: j, y2: 1, color: lanes[j]!.color }); return; }
      let slot = i === 0 ? col : lanes.findIndex((l) => !l);
      if (slot < 0) slot = lanes.length;
      const colr = i === 0 ? color : next++;
      lanes[slot] = { h: ph, color: colr };
      segs.push({ x1: col, y1: 0.5, x2: slot, y2: 1, color: colr });
    });
    while (lanes.length && !lanes[lanes.length - 1]) lanes.pop();
    rows.push({ commit: c, col, color, segs, width: Math.max(before.length, lanes.length, col + 1) });
  }
  return rows;
}

export type DiffLine = { t: "add" | "del" | "ctx" | "hunk" | "meta"; text: string };
export function parseDiff(raw: string): DiffLine[] {
  const out: DiffLine[] = [];
  let body = false;
  for (const l of raw.split("\n")) {
    if (l.startsWith("@@")) { body = true; out.push({ t: "hunk", text: l }); }
    else if (!body) { if (/^(Binary files|rename |similarity |new file|deleted file)/.test(l)) out.push({ t: "meta", text: l }); }
    else if (l.startsWith("+")) out.push({ t: "add", text: l.slice(1) });
    else if (l.startsWith("-")) out.push({ t: "del", text: l.slice(1) });
    else if (l.startsWith("\\")) out.push({ t: "meta", text: l });
    else if (l.startsWith(" ")) out.push({ t: "ctx", text: l.slice(1) });
  }
  return out;
}

// ブランチ一覧から、リモートの名前(origin など)を取り出す
export const remoteNames = (bs: Branch[]): Set<string> => new Set(bs.filter((b) => b.remote).map((b) => b.name.split("/")[0]));
