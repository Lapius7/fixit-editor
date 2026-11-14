import { useEffect, useState } from "react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { Archive, ArrowRightLeft, Eye, EyeOff, GitFork, Lock, Pencil, Star, Trash2, X } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { gh, relTime, type Repo } from "./api";
import type { Ctx } from "./GithubView";
import { act, Busy, Fail, Head, Row, Switch, TypeConfirm, useLoad } from "./ui";

// 言語の割合(色は言語名から決める。GitHub と同じ色にはしない)
// ホームページは https:// を見せず、保存するときに補う(http:// は安全でないので、そのまま見せる)
const bare = (u: string) => u.replace(/^https:\/\//i, "");
const full = (u: string) => { const t = u.trim(); return !t ? "" : /^https?:\/\//i.test(t) ? t : `https://${t}`; };

function Langs({ ctx }: { ctx: Ctx }) {
  const l = useLoad(() => gh.languages(ctx.s), [ctx.s.owner, ctx.s.repo]);
  const e = Object.entries(l.data ?? {}).sort((a, b) => b[1] - a[1]);
  const sum = e.reduce((a, x) => a + x[1], 0);
  if (!sum) return null;
  const hue = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <div className="gh-langs">
      <div className="gh-langbar" role="img" aria-label={i18next.t("言語の割合")}>
        {e.map(([n, v]) => <i key={n} style={{ width: `${(v / sum) * 100}%`, background: `hsl(${hue(n)} 55% 55%)` }} title={`${n} ${((v / sum) * 100).toFixed(1)}%`} />)}
      </div>
      <ul>{e.slice(0, 6).map(([n, v]) => <li key={n}><i style={{ background: `hsl(${hue(n)} 55% 55%)` }} />{n}<small>{((v / sum) * 100).toFixed(1)}%</small></li>)}</ul>
    </div>
  );
}

export default function Overview(ctx: Ctx & { onClose: () => void }) {
  const { s, repo, reloadRepo } = ctx;
  const [desc, setDesc] = useState(repo.description ?? "");
  const [home, setHome] = useState(bare(repo.homepage ?? ""));
  const [topics, setTopics] = useState<string[]>(repo.topics ?? []);
  const [tin, setTin] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [move, setMove] = useState(false); // 譲渡の確認
  const [newName, setNewName] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [starred, setStarred] = useState<boolean | null>(null);
  useEffect(() => { setDesc(repo.description ?? ""); setHome(bare(repo.homepage ?? "")); setTopics(repo.topics ?? []); }, [repo]);
  useEffect(() => { let on = true; gh.isStarred(s).then((v) => on && setStarred(v)).catch(() => on && setStarred(null)); return () => { on = false; }; }, [s.owner, s.repo]);
  const branches = useLoad(() => gh.branches(s), [s.owner, s.repo]);
  const r = repo as Repo & Record<string, unknown>;
  const dirty = desc !== (repo.description ?? "") || full(home) !== (repo.homepage ?? "") || topics.join() !== (repo.topics ?? []).join();

  const patch = async (b: Record<string, unknown>, ok?: string) => { if (await act(() => gh.updateRepo(s, b), ok)) reloadRepo(); };
  const save = async () => {
    setBusy(true);
    const ok = await act(async () => {
      if (desc !== (repo.description ?? "") || full(home) !== (repo.homepage ?? "")) await gh.updateRepo(s, { description: desc, homepage: full(home) });
      if (topics.join() !== (repo.topics ?? []).join()) await gh.setTopics(s, topics);
    }, i18next.t("保存しました"));
    setBusy(false);
    if (ok) reloadRepo();
  };
  const addTopic = () => {
    const t = tin.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !topics.includes(t) && topics.length < 20) setTopics([...topics, t]);
    setTin("");
  };
  const flag = (key: string, label: string, hint?: string) => (
    <Row title={label} hint={hint}><Switch on={!!r[key]} label={label} onChange={(v) => void patch({ [key]: v })} /></Row>
  );

  const toggleVisibility = async () => {
    const toPrivate = !repo.private;
    const ok = await ask({
      message: toPrivate ? i18next.t("「{{name}}」を非公開にします。公開中のスター・ウォッチは失われ、公開されていた GitHub Pages も止まります。続けますか?", { name: repo.name }) : i18next.t("「{{name}}」を公開します。コードと履歴を誰でも見られるようになります。続けますか?", { name: repo.name }),
      ok: toPrivate ? i18next.t("非公開にする") : i18next.t("公開する"), danger: !toPrivate,
    });
    if (ok) await patch({ private: toPrivate }, toPrivate ? i18next.t("非公開にしました") : i18next.t("公開しました"));
  };
  const archive = async () => {
    const to = !repo.archived;
    if (await ask({ message: to ? i18next.t("アーカイブすると、読み取り専用になります(あとで戻せます)。続けますか?") : i18next.t("アーカイブを解除して、書き込めるようにします。"), ok: to ? i18next.t("アーカイブする") : i18next.t("解除する") }))
      await patch({ archived: to }, to ? i18next.t("アーカイブしました") : i18next.t("解除しました"));
  };
  const remove = async () => {
    if (!(await ask({ message: i18next.t("リポジトリ「{{name}}」を GitHub から削除します。Issue・プルリクエスト・リリースもすべて消え、元に戻せません。", { name: repo.full_name }), ok: i18next.t("次へ"), danger: true }))) return;
    setDel(true);
  };
  const toggleStar = async () => {
    if (starred === null) return;
    const to = !starred;
    if (await act(() => gh.star(s, to), to ? i18next.t("スターを付けました") : i18next.t("スターを外しました"))) { setStarred(to); reloadRepo(); }
  };
  const doFork = async () => {
    if (!(await ask({ message: i18next.t("「{{name}}」を自分のアカウントにフォークします。", { name: repo.full_name }), ok: i18next.t("フォークする") }))) return;
    await act(() => gh.fork(s), i18next.t("フォークを作っています。数十秒ほどで、自分のアカウントに現れます"));
  };
  const rename = async () => {
    const n = newName.trim();
    if (!n || n === repo.name) return;
    if (!(await ask({ message: i18next.t("リポジトリ名を「{{from}}」から「{{to}}」に変えます。古い URL は新しい名前へ転送されますが、ローカルのリモート URL は手で直してください。", { from: repo.name, to: n }), ok: i18next.t("名前を変える"), danger: true }))) return;
    if (await act(() => gh.updateRepo(s, { name: n }), i18next.t("名前を変えました。画面を閉じます"))) ctx.onClose();
  };
  const reallyMove = async () => {
    setMove(false);
    if (await act(() => gh.transfer(s, newOwner.trim()), i18next.t("譲渡を依頼しました。相手の承認で完了します"))) { setNewOwner(""); ctx.onClose(); }
  };
  const reallyDelete = async () => {
    setDel(false);
    if (await act(() => gh.deleteRepo(s), i18next.t("リポジトリを削除しました"))) ctx.onClose();
  };

  return (
    <div className="gh-page">
      <Head title={repo.full_name} sub={i18next.t("{{when}}に更新", { when: relTime((repo as unknown as { pushed_at?: string }).pushed_at ?? "") })}>
        <button className="btn" disabled={starred === null} aria-pressed={!!starred} onClick={() => void toggleStar()}><Star size={14} fill={starred ? "currentColor" : "none"} /><span className="gh-num">{repo.stargazers_count}</span></button>
        <button className="btn" onClick={() => void doFork()}><GitFork size={14} /><span className="gh-num">{repo.forks_count}</span></button>
        <span className="gh-pill" data-tone={repo.private ? "warn" : "ok"}>{repo.private ? <Lock size={11} /> : <Eye size={11} />}{repo.private ? i18next.t("非公開") : i18next.t("公開")}</span>
        {repo.archived && <span className="gh-pill" data-tone="mute"><Archive size={11} />{i18next.t("アーカイブ済み")}</span>}
      </Head>
      <Langs ctx={ctx} />

      <section className="gh-card">
        <h4>About</h4>
        <label className="gh-f"><span><Trans i18nKey="説明" /></span><input className="field" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={350} /></label>
        <label className="gh-f"><span><Trans i18nKey="ホームページ" /></span><input className="field" value={home} placeholder="example.com" inputMode="url" autoCapitalize="off" spellCheck={false} onChange={(e) => setHome(e.target.value)} /></label>
        <div className="gh-f">
          <span><Trans i18nKey="トピック" /></span>
          <div className="gh-chips">
            {topics.map((t) => <span key={t} className="gh-chip">{t}<button aria-label={i18next.t("{{name}} を外す", { name: t })} onClick={() => setTopics(topics.filter((x) => x !== t))}><X size={11} /></button></span>)}
            <input className="gh-chip-in" value={tin} placeholder={i18next.t("追加して Enter")} aria-label={i18next.t("トピックを追加")} onChange={(e) => setTin(e.target.value)} onBlur={addTopic}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTopic(); } else if (e.key === "Backspace" && !tin && topics.length) setTopics(topics.slice(0, -1)); }} />
          </div>
        </div>
        <div className="gh-actions">
          <button className="btn" disabled={!dirty || busy} onClick={() => { setDesc(repo.description ?? ""); setHome(bare(repo.homepage ?? "")); setTopics(repo.topics ?? []); }}>{i18next.t("元に戻す")}</button>
          <button className="btn" data-primary="true" disabled={!dirty || busy} onClick={() => void save()}>{i18next.t("保存")}</button>
        </div>
      </section>

      <section className="gh-card">
        <h4><Trans i18nKey="ブランチ" /></h4>
        <Row title={i18next.t("既定のブランチ")} hint={i18next.t("プルリクエストの向き先と、最初に開かれるブランチです")}>
          {branches.busy && !branches.data ? <Busy /> : branches.err ? <Fail msg={branches.err} /> : (
            <Select value={repo.default_branch} label={i18next.t("既定のブランチ")} onChange={(v) => void patch({ default_branch: v }, i18next.t("既定のブランチを変えました"))} options={(branches.data ?? []).map((b) => ({ value: b.name, label: b.name }))} />
          )}
        </Row>
        {flag("delete_branch_on_merge", i18next.t("マージしたら、ブランチを自動で削除する"))}
        {flag("allow_update_branch", i18next.t("プルリクエストで「ブランチを更新」を出す"))}
      </section>

      <section className="gh-card">
        <h4><Trans i18nKey="マージの方法" /></h4>
        {flag("allow_merge_commit", i18next.t("マージコミットを許す"))}
        {flag("allow_squash_merge", i18next.t("スカッシュを許す"))}
        {flag("allow_rebase_merge", i18next.t("リベースを許す"))}
        {flag("allow_auto_merge", i18next.t("自動マージを許す"), i18next.t("チェックが通ったら、自動でマージできるようにします"))}
        {flag("web_commit_signoff_required", i18next.t("Web の編集に Signed-off-by を付ける"), i18next.t("GitHub の画面で作るコミットに、サインオフを必須にします"))}
      </section>

      <section className="gh-card">
        <h4><Trans i18nKey="機能" /></h4>
        {flag("has_issues", "Issue")}
        {flag("has_projects", i18next.t("プロジェクト"))}
        {flag("has_wiki", "Wiki")}
        {flag("has_discussions", i18next.t("ディスカッション"))}
        {flag("is_template", i18next.t("テンプレートリポジトリにする"), i18next.t("「このテンプレートを使う」から、新しいリポジトリを作れるようにします"))}
        {repo.owner?.type === "Organization" && flag("allow_forking", i18next.t("フォークを許す"), i18next.t("非公開リポジトリで、組織内のフォークを許します"))}
      </section>

      {repo.security_and_analysis && (
        <section className="gh-card">
          <h4>{i18next.t("セキュリティ")}</h4>
          {(["secret_scanning", "secret_scanning_push_protection"] as const).map((k) => (
            <Row key={k} title={k === "secret_scanning" ? i18next.t("シークレットスキャン") : i18next.t("プッシュ保護")} hint={k === "secret_scanning" ? i18next.t("コミットに混ざった鍵やトークンを検出します") : i18next.t("鍵やトークンを含む push を、受け付ける前に止めます")}>
              <Switch on={repo.security_and_analysis?.[k]?.status === "enabled"} label={k} onChange={(v) => void patch({ security_and_analysis: { [k]: { status: v ? "enabled" : "disabled" } } })} />
            </Row>
          ))}
        </section>
      )}

      <section className="gh-card" data-danger="true">
        <h4><Trans i18nKey="危険な操作" /></h4>
        <Row title={repo.private ? i18next.t("公開する") : i18next.t("非公開にする")} hint={repo.private ? i18next.t("コードと履歴が誰でも見られるようになります") : i18next.t("検索や他の人からは見えなくなります")}>
          <button className="btn" onClick={() => void toggleVisibility()}>{repo.private ? <Eye size={14} /> : <EyeOff size={14} />}<span>{repo.private ? i18next.t("公開する") : i18next.t("非公開にする")}</span></button>
        </Row>
        <Row title={repo.archived ? i18next.t("アーカイブを解除") : i18next.t("アーカイブする")} hint={i18next.t("読み取り専用にします。あとで戻せます")}>
          <button className="btn" onClick={() => void archive()}><Archive size={14} /><span>{repo.archived ? i18next.t("解除する") : i18next.t("アーカイブする")}</span></button>
        </Row>
        <Row title={i18next.t("名前を変える")} hint={i18next.t("古い URL は新しい名前へ転送されます")}>
          <div className="gh-join">
            <input className="field" value={newName} placeholder={repo.name} spellCheck={false} aria-label={i18next.t("新しい名前")} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" disabled={!newName.trim() || newName.trim() === repo.name} onClick={() => void rename()}><Pencil size={14} /><span>{i18next.t("変える")}</span></button>
          </div>
        </Row>
        <Row title={i18next.t("所有者を変える")} hint={i18next.t("ユーザー名か組織名を入れます。相手が受け入れると、移ります")}>
          <div className="gh-join">
            <input className="field" value={newOwner} placeholder="owner" spellCheck={false} aria-label={i18next.t("新しい所有者")} onChange={(e) => setNewOwner(e.target.value)} />
            <button className="btn" disabled={!/^[A-Za-z0-9-]{1,39}$/.test(newOwner.trim())} onClick={() => setMove(true)}><ArrowRightLeft size={14} /><span>{i18next.t("譲渡する")}</span></button>
          </div>
        </Row>
        <Row title={i18next.t("リポジトリを削除")} hint={i18next.t("元に戻せません。名前を入力して確かめます")} danger>
          <button className="btn" data-danger="true" onClick={() => void remove()}><Trash2 size={14} /><span>{i18next.t("削除する")}</span></button>
        </Row>
      </section>
      {move && <TypeConfirm word={repo.full_name} label={i18next.t("譲渡")} onOk={() => void reallyMove()} onCancel={() => setMove(false)} />}
      {del && <TypeConfirm word={repo.full_name} label={i18next.t("削除")} onOk={() => void reallyDelete()} onCancel={() => setDel(false)} />}
    </div>
  );
}
