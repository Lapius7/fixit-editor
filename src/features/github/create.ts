// フォルダを新しい GitHub リポジトリにして送る。リポジトリを作る前に確かめられる部分(名前・秘密に見えるファイル)はここに分けてある。
import { gh, type Repo } from "./api";
import { gitRead, gitWrite, loadGit, parseChanges, parseLog } from "@/features/git/git";
import { RemoteDir } from "@/platform/remote";
import i18next from "i18next";
import type { Conn } from "@/platform/remote";

// GitHub のリポジトリ名: 英数字・ . - _ の 1〜100 文字(. と .. は不可)
export const validRepoName = (n: string) => /^[A-Za-z0-9._-]{1,100}$/.test(n) && n !== "." && n !== ".." && !n.endsWith(".git");
// フォルダ名から、リポジトリ名の初期値を作る(使えない文字は - にする)
export const repoNameOf = (folder: string) => folder.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").slice(0, 100);

// 公開すると困りやすいファイル(環境変数・秘密鍵・認証情報・dela のトークン)。名前だけで見分けるので、見つからなくても安全とは限らない
const RISKY = /(^|\/)(\.env(\..+)?|\.delaconfig|\.npmrc|\.netrc|id_(rsa|ed25519|ecdsa)|credentials(\.json)?|[^/]+\.(pem|key|p12|pfx))$/i;
export const riskyFiles = (paths: string[]): string[] => paths.filter((p) => RISKY.test(p) && !/\.(example|sample|template)$/i.test(p));

// git リポジトリでないフォルダは、変更の一覧が取れないので、フォルダを直に調べて相対パスを集める(深さ・数に上限あり)
const SKIP = new Set([".git", "node_modules", "target", "dist", "build", "vendor", "__pycache__", "venv"]);
export async function scanFiles(conn: Conn, dir: string, max = 800): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, rel: string, depth: number): Promise<void> => {
    if (out.length >= max) return;
    const dirs: string[] = [];
    try {
      for await (const [name, h] of new RemoteDir(conn, d).entries()) {
        if (h.kind === "directory") { if (!SKIP.has(name) && depth < 4) dirs.push(name); } else out.push(rel ? `${rel}/${name}` : name);
      }
    } catch { return; }
    for (const n of dirs) await walk(d.endsWith("/") ? d + n : `${d}/${n}`, rel ? `${rel}/${n}` : n, depth + 1);
  };
  await walk(dir, "", 0);
  return out;
}

export type Plan = { isRepo: boolean; hasCommit: boolean; branch: string; files: string[]; remoteNames: string[]; top: string };
// 送る前の確認用に、いまのフォルダの状態を調べる(何も変えない)
export async function plan(conn: Conn, dir: string): Promise<Plan> {
  const g = await loadGit(conn, dir);
  if (!g) return { isRepo: false, hasCommit: false, branch: "", files: await scanFiles(conn, dir), remoteNames: [], top: "" };
  const st = parseChanges(await gitRead(conn, dir, { cmd: "changes" }));
  const hasCommit = parseLog(await gitRead(conn, dir, { cmd: "log" })).length > 0;
  const raw = await gitRead(conn, dir, { cmd: "remotes" });
  const remoteNames = [...new Set(raw.split("\n").map((l) => l.split(/\s+/)[0]).filter(Boolean))];
  const files = [...st.staged, ...st.unstaged, ...st.conflicts].map((c) => c.path);
  return { isRepo: true, hasCommit, branch: st.branch, files: [...new Set(files)], remoteNames, top: g.root };
}

export type Opts = { name: string; description: string; priv: boolean; owner?: string; who: string; gitignore?: string; license?: string; author?: string }; // owner: 組織のときだけ(自分なら省く) / who: 作る先のアカウント名(リモートの URL 用)
export type Progress = { repo?: Repo; remote?: string };
// すでにファイルがあれば触らない。書いたら true
export async function writeIfAbsent(conn: Conn, dir: string, name: string, text: string): Promise<boolean> {
  const d = new RemoteDir(conn, dir);
  try { await d.getFileHandle(name); return false; } catch { /* なければ作る */ }
  const w = await (await d.getFileHandle(name, { create: true })).createWritable();
  await w.write(text);
  await w.close();
  return true;
}

// 実際に作成してアップロードする。途中で失敗したら例外を投げ、そこまでの結果は progress に残る(もう一度呼ぶと、続きから進む)
export async function publishFolder(conn: Conn, dir: string, o: Opts, progress: Progress, step: (s: string) => void): Promise<Repo> {
  const p = await plan(conn, dir);
  let branch = p.branch;
  if (!p.isRepo) { step("init"); await gitWrite(conn, dir, { cmd: "init" }); }
  // .gitignore とライセンス。すでにあるファイルは触らない(GitHub 側の auto_init は、あちらに別のコミットができて push が拒まれるので使わない)
  const added: string[] = [];
  if (o.gitignore && await writeIfAbsent(conn, dir, ".gitignore", await gh.gitignoreText(o.gitignore))) added.push(".gitignore");
  if (o.license && await writeIfAbsent(conn, dir, "LICENSE", (await gh.licenseText(o.license)).replace(/\[year\]/gi, String(new Date().getFullYear())).replace(/\[fullname\]/gi, o.author || o.who))) added.push("LICENSE");
  if (!p.hasCommit) {
    step("commit");
    if (branch !== "main") { await gitWrite(conn, dir, { cmd: "branch-create", name: "main" }); branch = "main"; }
    await gitWrite(conn, dir, { cmd: "stage", files: ["."] });
    await gitWrite(conn, dir, { cmd: "commit", message: "Initial commit" });
  } else if (added.length) {
    // コミット済みのフォルダには、加えたファイルだけを新しいコミットにする
    step("commit");
    await gitWrite(conn, dir, { cmd: "stage", files: added });
    await gitWrite(conn, dir, { cmd: "commit", message: `Add ${added.join(" and ")}` });
  }
  // リモートの追加は GitHub のリポジトリがなくてもできるので、先に済ませる(この版が未対応なら、GitHub に何も作らないまま止まる)
  if (!progress.remote) {
    step("remote");
    const name = p.remoteNames.includes("origin") ? "github" : "origin";
    try { await gitWrite(conn, dir, { cmd: "remote-add", name, url: `https://github.com/${o.who}/${o.name}.git` }); }
    catch (e) {
      if (String((e as Error)?.message ?? e).includes("使えません")) throw new Error(i18next.t("このアプリの版では、リモートの追加に対応していません。アプリを新しい版にしてから、もう一度試してください(GitHub には何も作っていません)"));
      throw e;
    }
    progress.remote = name;
  }
  if (!progress.repo) { step("create"); progress.repo = await gh.createRepo({ name: o.name, description: o.description.trim() || undefined, private: o.priv }, o.owner); }
  step("push");
  await gitWrite(conn, dir, { cmd: "push", setUpstream: true, remote: progress.remote, name: branch || "main" });
  return progress.repo!;
}
