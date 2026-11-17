// GitHub の公開リポジトリから拡張機能を入れるための、URL の読み取り。形は Rust の ext::github_raw_url と同じ規則(取得先は raw.githubusercontent.com の決まった形だけ)
export type GithubRef = { owner: string; repo: string; ref: string };

const OWNER = /^[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REF = /^[A-Za-z0-9._-]{1,100}$/;

/** https://github.com/owner/repo[.git][/tree/<ref>] を読む(?... と #... は無視)。違う場所・http・サブフォルダ・「/」を含むブランチ名は null。ref の指定がなければ HEAD(既定のブランチ) */
export function parseGithubUrl(input: string): GithubRef | null {
  const m = /^(?:https:\/\/)?(?:www\.)?github\.com\/([^?#]*)(?:[?#].*)?$/i.exec(input.trim());
  if (!m) return null;
  const seg = m[1].split("/");
  if (seg[seg.length - 1] === "") seg.pop(); // 末尾の「/」
  if (seg.length !== 2 && !(seg.length === 4 && seg[2] === "tree")) return null;
  const owner = seg[0], repo = seg[1].replace(/\.git$/i, ""), ref = seg.length === 4 ? seg[3] : "HEAD";
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === ".." || !REF.test(ref) || ref.startsWith(".") || ref.includes("..")) return null;
  return { owner, repo, ref };
}

/** 保存する入手元の印(未認証の版が、別の入手元の同じ id を上書きしないために使う) */
export const githubSrc = (g: GithubRef) => `github:${g.owner}/${g.repo}@${g.ref}`;
