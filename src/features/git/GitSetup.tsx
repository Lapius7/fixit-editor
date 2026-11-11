// Git パネルで、開いているフォルダがリポジトリではないときの中身。
// ここでリポジトリを作る(git init)・複製する(git clone)か、中にあるリポジトリを選んで開く
import { useEffect, useState } from "react";
import { FolderGit2, GitBranchPlus, Download } from "lucide-react";
import i18next from "i18next";
import { RemoteDir, type Conn } from "@/platform/remote";
import { gitWrite } from "@/features/git/git";
import { GIT_SCAN_DIRS } from "@/shared/config";

type Props = { conn: Conn; dir: string; onRepo: (dir: string) => void };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const join = (d: string, n: string) => (d.endsWith("/") ? d + n : `${d}/${n}`);
// URL の最後の部分から、複製先のフォルダ名を決める(…/name.git → name)
export const cloneDirName = (url: string) => url.trim().replace(/[/\\]+$/, "").split(/[/:]/).pop()?.replace(/\.git$/i, "") ?? "";

// 直下のフォルダのうち、.git を持つもの(.git はフォルダのことも、ワークツリーなどのファイルのこともある)
async function childRepos(conn: Conn, dir: string): Promise<string[]> {
  const subs: string[] = [];
  for await (const [name, h] of new RemoteDir(conn, dir).entries()) {
    if (h.kind === "directory" && name !== ".git") subs.push(name);
    if (subs.length >= GIT_SCAN_DIRS) break;
  }
  const out: string[] = [];
  for (let i = 0; i < subs.length; i += 8) {
    const hit = await Promise.all(subs.slice(i, i + 8).map((n) => new RemoteDir(conn, join(dir, n)).getDirectoryHandle(".git")
      .then(() => true, (e: { code?: string }) => e?.code === "ENOTDIR")));
    subs.slice(i, i + 8).forEach((n, k) => { if (hit[k]) out.push(n); });
  }
  return out.sort((a, b) => a.localeCompare(b));
}

export function GitSetup({ conn, dir, onRepo }: Props) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [repos, setRepos] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true; setRepos(null); setErr("");
    childRepos(conn, dir).then((r) => { if (live) setRepos(r); }, () => { if (live) setRepos([]); });
    return () => { live = false; };
  }, [conn, dir]);

  const go = async (label: string, body: Record<string, unknown>, to: string) => {
    if (busy) return;
    setBusy(label); setErr("");
    try { await gitWrite(conn, dir, body); onRepo(to); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(""); }
  };
  const name = cloneDirName(url);
  const clone = () => { if (url.trim() && name) void go("clone", { cmd: "clone", url: url.trim(), name }, join(dir, name)); };

  return (
    <div className="git-setup scroll">
      <p className="git-setup-note">{i18next.t("このフォルダは Git のリポジトリではありません")}</p>
      {err && <p className="git-setup-err" role="alert">{err}</p>}
      <button className="git-setup-btn" disabled={!!busy} onClick={() => void go("init", { cmd: "init" }, dir)}>
        <GitBranchPlus />{busy === "init" ? i18next.t("作成しています…") : i18next.t("ここにリポジトリを作成")}
      </button>
      <form className="git-setup-clone" onSubmit={(e) => { e.preventDefault(); clone(); }}>
        <label htmlFor="git-clone-url">{i18next.t("リポジトリを複製")}</label>
        <div className="git-setup-row">
          <input id="git-clone-url" spellCheck={false} autoComplete="off" placeholder="https://github.com/owner/repo.git"
            value={url} disabled={!!busy} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="git-setup-go" disabled={!!busy || !url.trim() || !name} aria-label={i18next.t("複製")} title={i18next.t("複製")}><Download /></button>
        </div>
        {busy === "clone" ? <p className="git-setup-hint" role="status">{i18next.t("複製しています…")}</p>
          : name && <p className="git-setup-hint">{i18next.t("「{{name}}」フォルダに複製します", { name })}</p>}
      </form>
      {repos === null ? <p className="git-setup-hint">{i18next.t("中のリポジトリを探しています…")}</p> : repos.length > 0 && (
        <section className="git-setup-list" aria-label={i18next.t("このフォルダの中のリポジトリ")}>
          <h3>{i18next.t("このフォルダの中のリポジトリ")}</h3>
          {repos.map((r) => (
            <button key={r} className="git-setup-repo" disabled={!!busy} onClick={() => onRepo(join(dir, r))}><FolderGit2 /><span className="truncate">{r}</span></button>
          ))}
        </section>
      )}
    </div>
  );
}
