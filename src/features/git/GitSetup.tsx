// Git パネルで、開いているフォルダがリポジトリではないときの中身。
// ここでリポジトリを作る(git init)・複製する(git clone)か、中にあるリポジトリを選んで開く
import { useEffect, useState } from "react";
import { Folder, FolderGit2, FolderOpen, GitBranchPlus, Download } from "lucide-react";
import i18next from "i18next";
import type { Conn } from "@/platform/remote";
import { gitWrite } from "@/features/git/git";
import { GIT_SCAN_DIRS } from "@/shared/config";
import { walkRepos, type Walked } from "@/features/github/repos";

type Props = { conn: Conn; dir: string; onRepo: (dir: string) => void };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const join = (d: string, n: string) => (d.endsWith("/") ? d + n : `${d}/${n}`);
// URL の最後の部分から、複製先のフォルダ名を決める(…/name.git → name)
export const cloneDirName = (url: string) => url.trim().replace(/[/\\]+$/, "").split(/[/:]/).pop()?.replace(/\.git$/i, "") ?? "";

export function GitSetup({ conn, dir, onRepo }: Props) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [url, setUrl] = useState("");
  const [found, setFound] = useState<Walked | null>(null);
  // 中にある Git プロジェクト(深さ 3 まで)と、まだ Git ではない直下のフォルダ
  useEffect(() => {
    const sig = { stop: false };
    setFound(null); setErr("");
    walkRepos(conn, dir, sig).then((r) => { if (!sig.stop) setFound(r); }, () => { if (!sig.stop) setFound({ repos: [], plain: [] }); });
    return () => { sig.stop = true; };
  }, [conn, dir]);

  const go = async (label: string, body: Record<string, unknown>, to: string) => {
    if (busy) return;
    setBusy(label); setErr("");
    try { await gitWrite(conn, dir, body); onRepo(to); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(""); }
  };
  // 直下のフォルダを Git 化して、そのまま開く
  const initSub = async (rel: string) => {
    if (busy) return;
    const to = join(dir, rel);
    setBusy(`init:${rel}`); setErr("");
    try { await gitWrite(conn, to, { cmd: "init" }); onRepo(to); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(""); }
  };
  const name = cloneDirName(url);
  const here = dir.replace(/\/+$/, "").split("/").pop() || "/";
  const clone = () => { if (url.trim() && name) void go("clone", { cmd: "clone", url: url.trim(), name }, join(dir, name)); };

  const plain = found ? found.plain.slice(0, GIT_SCAN_DIRS) : [];
  return (
    <div className="git-setup scroll">
      {/* 1. 現在のフォルダ(「ここ」がどこかを先に出す) */}
      <section className="git-setup-where" aria-label={i18next.t("現在のフォルダ")}>
        <FolderOpen />
        <div>
          <b className="truncate">{here}</b>
          <span className="git-setup-path" title={dir}><bdi>{dir}</bdi></span>
          <p className="git-setup-note">{i18next.t("Git のリポジトリではありません")}</p>
        </div>
      </section>
      {err && <p className="git-setup-err" role="alert">{err}</p>}

      {/* 2. このフォルダの中にあるリポジトリ */}
      <section className="git-setup-sec" aria-label={i18next.t("このフォルダの中のリポジトリ")}>
        <h3 className="git-setup-head"><FolderGit2 /><span>{i18next.t("このフォルダの中のリポジトリ")}</span>{found && <em>{found.repos.length}</em>}</h3>
        <div className="git-setup-card">
          {found === null ? <p className="git-setup-hint">{i18next.t("中のリポジトリを探しています…")}</p>
            : found.repos.length === 0 ? <p className="git-setup-hint">{i18next.t("見つかりませんでした")}</p>
            : found.repos.map((r) => (
              <button key={r.dir} className="git-setup-repo" disabled={!!busy} title={r.dir} onClick={() => onRepo(r.dir)}>
                <FolderGit2 /><span className="truncate">{r.rel.split("/").pop()}</span>{r.rel.includes("/") && <small className="git-setup-rel truncate"><bdi>{r.rel}</bdi></small>}
              </button>
            ))}
        </div>
      </section>

      {/* 3. 新しく Git 化するフォルダを選ぶ */}
      <section className="git-setup-sec" aria-label={i18next.t("新しく Git 化するフォルダを選ぶ")}>
        <h3 className="git-setup-head"><GitBranchPlus /><span>{i18next.t("新しく Git 化するフォルダを選ぶ")}</span></h3>
        <div className="git-setup-card">
          <button className="git-setup-repo git-setup-here" disabled={!!busy} title={dir} onClick={() => void go("init", { cmd: "init" }, dir)}>
            <FolderOpen /><span className="truncate">{busy === "init" ? i18next.t("作成しています…") : i18next.t("{{name}}(このフォルダ)", { name: here })}</span>
            <span className="git-setup-mini git-setup-pri">{i18next.t("Git 化")}</span>
          </button>
          {plain.map((r) => (
            <div key={r.dir} className="git-setup-repo git-setup-plain" title={r.dir}>
              <Folder /><span className="truncate">{r.rel}</span>
              <button className="git-setup-mini" disabled={!!busy} onClick={() => void initSub(r.rel)}>{busy === `init:${r.rel}` ? i18next.t("作成しています…") : i18next.t("Git 化")}</button>
            </div>
          ))}
        </div>
        <p className="git-setup-hint">{i18next.t("git init を実行し、選んだフォルダに .git を作ります。")}</p>
      </section>

      {/* 4. 既存のリポジトリを複製 */}
      <form className="git-setup-sec" onSubmit={(e) => { e.preventDefault(); clone(); }}>
        <h3 className="git-setup-head"><Download /><label htmlFor="git-clone-url">{i18next.t("リポジトリを複製")}</label></h3>
        <div className="git-setup-row">
          <input id="git-clone-url" spellCheck={false} autoComplete="off" placeholder="https://github.com/owner/repo.git"
            value={url} disabled={!!busy} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="git-setup-go" disabled={!!busy || !url.trim() || !name} aria-label={i18next.t("複製")} title={i18next.t("複製")}><Download /></button>
        </div>
        <p className="git-setup-hint" role={busy === "clone" ? "status" : undefined}>{busy === "clone" ? i18next.t("複製しています…")
          : i18next.t("「{{dir}}」の中に「{{name}}」フォルダを作って複製します。", { dir: here, name: name || "repo" })}</p>
      </form>
    </div>
  );
}
