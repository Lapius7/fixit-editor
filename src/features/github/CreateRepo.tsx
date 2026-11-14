// フォルダを、GitHub に新しいリポジトリとして作成してアップロードする。リモートが無いときの画面に出す。
import { useEffect, useRef, useState } from "react";
import { FolderGit2, Loader2, Plus } from "lucide-react";
import i18next from "i18next";
import { ask } from "@/shared/ask";
import { Select } from "@/shared/Select";
import type { Conn } from "@/platform/remote";
import { gh, ghErr, type User } from "./api";
import type { Found } from "./repos";
import { plan, publishFolder, repoNameOf, riskyFiles, validRepoName, type Progress } from "./create";
import FolderBrowse from "./FolderBrowse";
import { Fail } from "./ui";

const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
const STEPS: Record<string, string> = { init: "Git を始めています", commit: "最初のコミットを作っています", create: "GitHub にリポジトリを作っています", remote: "リモートを設定しています", push: "アップロードしています" };

export default function CreateRepo({ conn, root, viewer, onDone, onBack }: { conn: Conn; root: string; viewer: User; onDone: (f: Found) => void; onBack?: () => void }) {
  const [dir, setDir] = useState(root); // 送るフォルダ(開いたフォルダか、その下の階層)
  const [name, setName] = useState(repoNameOf(base(root)));
  const [named, setNamed] = useState(false); // 名前を自分で直したら、フォルダを変えても上書きしない
  const [desc, setDesc] = useState("");
  const [priv, setPriv] = useState(true);
  const [owner, setOwner] = useState(viewer.login);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [gi, setGi] = useState("");
  const [li, setLi] = useState("");
  const [gis, setGis] = useState<string[]>([]);
  const [lis, setLis] = useState<{ key: string; name: string }[]>([]);
  const [step, setStep] = useState("");
  const [err, setErr] = useState("");
  const progress = useRef<Progress>({});
  const pick = (d: string) => { setDir(d); if (!named) setName(repoNameOf(base(d))); };
  useEffect(() => {
    void gh.gitignoreNames().then(setGis, () => setGis([]));
    void gh.licenseList().then((l) => setLis(l.map((x) => ({ key: x.key, name: x.name }))), () => setLis([]));
  }, []);
  useEffect(() => { void gh.orgs().then((o) => setOrgs(o.map((x) => x.login)), () => setOrgs([])); }, []);

  const nameOk = validRepoName(name);
  const busy = !!step;
  const go = async () => {
    if (!nameOk || busy) return;
    setErr("");
    try {
      // 送る前に、何が送られるかを見せる(秘密に見えるファイルがあれば、名前を挙げる)
      const p = await plan(conn, dir);
      if (p.isRepo && p.top.replace(/\/+$/, "") !== dir.replace(/\/+$/, "")) { setErr(i18next.t("上のフォルダが Git のリポジトリです。そのフォルダを開き直してください")); return; }
      const risky = p.hasCommit ? [] : riskyFiles(p.files);
      if (!progress.current.repo) {
        const lines = [
          i18next.t("{{who}} に「{{name}}」を{{vis}}で作成し、フォルダの内容をアップロードします。", { who: owner, name, vis: priv ? i18next.t("非公開") : i18next.t("公開") }),
          p.hasCommit ? i18next.t("いまのコミットがアップロードされます(まだコミットしていない変更は含まれません)。") : i18next.t("フォルダのファイルをすべてコミットしてアップロードします。除きたいファイルは .gitignore で指定してください。"),
          ...((gi || li) ? [i18next.t("{{list}} を加えてコミットします(すでにあるファイルは変えません)。", { list: [gi && ".gitignore", li && "LICENSE"].filter(Boolean).join("・") })] : []),
          ...(risky.length ? [i18next.t("秘密情報かもしれないファイルがあります: {{list}}", { list: risky.slice(0, 6).join(", ") + (risky.length > 6 ? " …" : "") })] : []),
        ];
        if (!(await ask({ message: lines.join("\n"), ok: i18next.t("作成する"), danger: risky.length > 0 || !priv }))) return;
      }
      setStep("init");
      const r = await publishFolder(conn, dir, { name, description: desc, priv, owner: owner === viewer.login ? undefined : owner, who: owner, gitignore: gi || undefined, license: li || undefined, author: viewer.name || viewer.login }, progress.current, setStep);
      setStep("");
      // 探索の深さの外にあるフォルダでも、作った結果をそのまま渡す(再検索に頼らない)
      const rel = dir.replace(/\/+$/, "").startsWith(root.replace(/\/+$/, "")) ? dir.replace(/\/+$/, "").slice(root.replace(/\/+$/, "").length).replace(/^\/+/, "") : "";
      const [o, n] = r.full_name.split("/");
      onDone({ dir, rel, remotes: [{ name: progress.current.remote ?? "origin", url: `https://github.com/${r.full_name}.git`, owner: o, repo: n }] });
    } catch (e) {
      setStep("");
      const m = ghErr(e);
      setErr(progress.current.repo ? `${m}\n${i18next.t("リポジトリは作成済みです。もう一度押すと、続きからアップロードします。")}` : m);
    }
  };
  const created = progress.current.repo;
  return (
    <div className="gh-gate gh-create">
      <FolderGit2 size={28} />
      <h3>{i18next.t("GitHub に新しく作る")}</h3>
      <p>{i18next.t("「{{dir}}」を、新しい GitHub のリポジトリにします。", { dir: base(dir) })}</p>
      <div className="gh-form">
        <div className="gh-f"><span>{i18next.t("アップロードするフォルダ")}</span>
          <FolderBrowse conn={conn} root={root} value={dir} disabled={busy || !!created} onChange={pick} />
        </div>
      {orgs.length > 0 && (
          <label className="gh-f"><span>{i18next.t("作る場所")}</span>
            <Select value={owner} label={i18next.t("作る場所")} disabled={busy || !!created} onChange={setOwner} options={[viewer.login, ...orgs].map((o) => ({ value: o, label: o }))} />
          </label>
        )}
        <label className="gh-f"><span>{i18next.t("リポジトリ名")}</span>
          <input className="field" value={name} disabled={busy || !!created} spellCheck={false} aria-invalid={!!name && !nameOk} placeholder="my-project" onChange={(e) => { setNamed(true); setName(e.target.value); }} />
          {!!name && !nameOk && <small>{i18next.t("英数字と . - _ だけ、100 文字までです")}</small>}
        </label>
        <label className="gh-f"><span>{i18next.t("説明(省けます)")}</span>
          <input className="field" value={desc} disabled={busy || !!created} onChange={(e) => setDesc(e.target.value)} />
        </label>
        {gis.length > 0 && (
          <div className="gh-f"><span>.gitignore</span>
            <Select value={gi} label=".gitignore" disabled={busy || !!created} onChange={setGi} options={[{ value: "", label: i18next.t("加えない") }, ...gis.map((n) => ({ value: n, label: n }))]} />
          </div>
        )}
        {lis.length > 0 && (
          <div className="gh-f"><span>{i18next.t("ライセンス")}</span>
            <Select value={li} label={i18next.t("ライセンス")} disabled={busy || !!created} onChange={setLi} options={[{ value: "", label: i18next.t("加えない") }, ...lis.map((n) => ({ value: n.key, label: n.name }))]} />
            <small>{i18next.t("すでにあるファイルは上書きしません。加えたファイルは、新しいコミットになります")}</small>
          </div>
        )}
        <div className="gh-f gh-f-inline">
          <span>{i18next.t("非公開にする")}</span>
          <button className="switch" role="switch" aria-checked={priv} aria-label={i18next.t("非公開にする")} disabled={busy || !!created} onClick={() => setPriv(!priv)} />
          <small>{priv ? i18next.t("自分と招待した人だけが見られます") : i18next.t("だれでも見られます")}</small>
        </div>
      </div>
      {err && <Fail msg={err} />}
      <ul className="gh-card gh-inset gh-plan" aria-label={i18next.t("作成する内容")}>
        <li>{i18next.t("{{who}}/{{name}} を{{vis}}で作成", { who: owner, name: name || "…", vis: priv ? i18next.t("非公開") : i18next.t("公開") })}</li>
        <li>{i18next.t("「{{dir}}」の内容をコミットしてアップロード", { dir: base(dir) })}</li>
        {(gi || li) && <li>{i18next.t("{{list}} を追加", { list: [gi && ".gitignore", li && "LICENSE"].filter(Boolean).join("・") })}</li>}
      </ul>
      <div className="gh-actions">
        {onBack && <button className="btn" disabled={busy} onClick={onBack}>{i18next.t("戻る")}</button>}
        <button className="btn" data-primary="true" disabled={!nameOk || busy} onClick={() => void go()}>
          {busy ? <><Loader2 size={14} data-spin="true" /><span>{i18next.t(STEPS[step] ?? "アップロードしています")}</span></> : <><Plus size={14} /><span>{created ? i18next.t("作成を続ける") : i18next.t("リポジトリを作成")}</span></>}
        </button>
      </div>
    </div>
  );
}
