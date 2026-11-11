// Git の書き込み・履歴操作。画面からは固定名の操作(cmd)だけを受け、git の引数はここで組み立てる。
// 画面から任意の引数は渡せない。src-tauri/fixit-core/src/git.rs と同じ振る舞いにそろえる。
import { FsError } from "./fsapi";

export type GitPlan = { args: string[]; ms: number; merge: boolean };
type Req = Record<string, unknown>;

const bad = (m: string) => new FsError(m, 400, "EARG");
const NET = 120_000, FAST = 30_000;

// ブランチ名・リモート名。先頭が - だとオプションに読まれるため、ここで断る
function refName(v: Req, key: string): string {
  const s = typeof v[key] === "string" ? (v[key] as string) : "";
  if (!s || s.length > 200 || /^[-/.]/.test(s) || s.includes("..") || s.includes("\\") || /[\u0000-\u001f\u007f\s]/.test(s)) throw bad("名前が正しくありません");
  return s;
}
function hash(v: Req): string {
  const s = typeof v.hash === "string" ? v.hash : "";
  if (!/^[0-9a-fA-F]{4,40}$/.test(s)) throw bad("コミットが正しくありません");
  return s;
}
const okPath = (s: unknown): s is string => typeof s === "string" && s.length > 0 && s.length <= 4096 && !s.includes("\0");
function oneFile(v: Req): string {
  if (!okPath(v.file)) throw bad("ファイルが正しくありません");
  return v.file;
}
function files(v: Req): string[] {
  const a = v.files;
  if (!Array.isArray(a) || a.length === 0 || a.length > 5000 || !a.every(okPath)) throw bad("ファイルが正しくありません");
  return a as string[];
}

// 複製元の URL。https・ssh・git と、user@host:path の形だけ(file:// や手元のパス、ext:: などは断る)
function cloneUrl(v: Req): string {
  const s = typeof v.url === "string" ? v.url.trim() : "";
  const ok = s.length <= 2048 && !s.startsWith("-") && !/[\u0000-\u001f\u007f\s]/.test(s)
    && (/^(https?|ssh|git):\/\/[^/]+\/./i.test(s) || /^[\w.-]+@[\w.-]+:[^/].*/.test(s));
  if (!ok) throw bad("URL が正しくありません");
  return s;
}
// 複製先のフォルダ名(今のフォルダの直下に作る)
function cloneName(v: Req): string {
  const s = typeof v.name === "string" ? v.name : "";
  if (!s || s.length > 200 || /^[-.]/.test(s) || /[/\\\u0000-\u001f\u007f]/.test(s)) throw bad("フォルダ名が正しくありません");
  return s;
}

export function gitPlan(raw: Buffer): GitPlan {
  let v: Req;
  try { v = JSON.parse(raw.toString("utf8")) as Req; } catch { throw bad("要求が正しくありません"); }
  if (!v || typeof v !== "object") throw bad("要求が正しくありません");
  let rest: string[], ms = FAST, merge = false;
  switch (v.cmd) {
    // 読み取り
    case "changes": rest = ["status", "--porcelain=v1", "-z", "-uall", "-b"]; break;
    case "log": rest = ["log", "--all", "--no-color", "-n", "300", "-z", "--date-order", "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s"]; break;
    case "branches": rest = ["for-each-ref", "--format=%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track,nobracket)%1f%(HEAD)%1f%(objectname:short)%1f%(subject)", "refs/heads", "refs/remotes"]; break;
    case "show": rest = ["show", "--format=", "--name-status", "-z", "-M", hash(v)]; break;
    // ステージ済みの差分をまとめて(AI でコミットメッセージを作るため)。名前の一覧と、短い文脈の差分
    case "staged-stat": rest = ["diff", "--cached", "--no-color", "--stat=200", "--summary"]; break;
    case "staged-diff": rest = ["diff", "--cached", "--no-color", "-U1", "--no-ext-diff"]; break;
    case "diff": {
      const f = oneFile(v);
      if (typeof v.hash === "string") rest = ["show", "--format=", "--no-color", "-U3", hash(v), "--", f];
      else if (v.untracked === true) rest = ["diff", "--no-color", "--no-index", "--", "/dev/null", f];
      else rest = ["diff", "--no-color", "-U3", ...(v.staged === true ? ["--cached"] : []), "--", f];
      break;
    }
    // 書き込み(標準エラーも結果に混ぜる)
    case "stage": rest = ["add", "-A", "--", ...files(v)]; merge = true; break;
    case "unstage": rest = ["reset", "-q", "--", ...files(v)]; merge = true; break;
    case "discard": rest = ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...files(v)]; merge = true; break;
    case "clean": rest = ["clean", "-fq", "--", ...files(v)]; merge = true; break;
    case "commit": {
      const m = typeof v.message === "string" ? v.message.trim() : "";
      if (!m || m.length > 20_000 || m.includes("\0")) throw bad("コミットメッセージが正しくありません");
      rest = ["commit", "-m", m]; ms = NET; merge = true; break;
    }
    case "checkout": rest = ["checkout", refName(v, "name"), "--"]; merge = true; break;
    case "branch-create": rest = ["checkout", "-b", refName(v, "name"), ...(typeof v.start === "string" ? [refName(v, "start")] : [])]; merge = true; break;
    case "branch-delete": rest = ["branch", v.force === true ? "-D" : "-d", "--", refName(v, "name")]; merge = true; break;
    case "fetch": rest = ["fetch", "--all", "--prune"]; ms = NET; merge = true; break;
    case "pull": rest = ["pull", "--ff-only"]; ms = NET; merge = true; break;
    case "push": rest = v.setUpstream === true ? ["push", "-u", typeof v.remote === "string" ? refName(v, "remote") : "origin", refName(v, "name")] : ["push"]; ms = NET; merge = true; break;
    // リポジトリではないフォルダで使う
    case "init": rest = ["init"]; ms = FAST; merge = true; break;
    case "clone": rest = ["clone", "--", cloneUrl(v), cloneName(v)]; ms = NET * 5; merge = true; break;
    default: throw bad("この Git 操作は使えません");
  }
  // 先頭に付ける設定。画面からの値は入らない
  return { args: ["-c", "core.quotepath=off", "-c", "i18n.logOutputEncoding=UTF-8", "--literal-pathspecs", ...rest], ms, merge };
}

const MARK = "\0FIXITRC";
const MARK_SH = "\\0FIXITRC"; // printf に渡す書き方
// 実行するシェルのスクリプト。終了コードは最後に印を付けて返す(ssh 越しでも失敗として扱われないように)
export function gitScript(dir: string, p: GitPlan, sq: (s: string) => string): string {
  return `cd -- ${sq(dir)} 2>/dev/null || { echo 'フォルダを開けません'; printf '${MARK_SH}128'; exit 0; }; GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0 GIT_EDITOR=true git ${p.args.map(sq).join(" ")} ${p.merge ? "2>&1" : "2>/dev/null"}; c=$?; printf '${MARK_SH}%s' "$c"; exit 0`;
}
export function gitResult(out: Buffer): { code: number; out: string } {
  const s = out.toString("utf8"), i = s.lastIndexOf(MARK);
  if (i < 0) return { code: 255, out: s };
  return { code: Number(s.slice(i + MARK.length)) || 0, out: s.slice(0, i) };
}
