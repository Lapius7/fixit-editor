import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ArrowLeft, Boxes, CircleDot, Tags, Wrench, ExternalLink, FolderGit2, GitBranch, GitPullRequest, KeyRound, LayoutDashboard, LogOut, Play, Tag, Users, Workflow as WorkflowIcon } from "lucide-react";
import { ms } from "@/features/settings/settings";
import { githubLogin, type Device } from "@/features/ai/copilot";
import { GH_CLIENT_ID, GH_SCOPES } from "@/shared/config";
import { openExternal } from "@/features/account/auth";
import type { Conn } from "@/platform/remote";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { gh, GhError, ghErr, setGhToken, slugOf, useGhToken, type Repo, type Slug, type User } from "./api";
import { findRepos, loadCache, mergeKnown, saveCache, type Found } from "./repos";
import { Busy, Fail, useLoad } from "./ui";
import Overview from "./Overview";
import Issues from "./Issues";
import Branches from "./Branches";
import Releases from "./Releases";
import Actions from "./Actions";
import Config from "./Config";
import People from "./People";
import Labels from "./Labels";
import Extras from "./Extras";
import CreateRepo from "./CreateRepo";

const WorkflowEditor = lazy(() => import("./workflow/WorkflowEditor"));

export type Ctx = { s: Slug; repo: Repo; conn: Conn; root: string; reloadRepo: () => void; go: (t: Tab) => void; viewer: User };

const TABS = [
  ["overview", "概要と設定", LayoutDashboard],
  ["issues", "Issue", CircleDot],
  ["pulls", "プルリクエスト", GitPullRequest],
  ["branches", "ブランチ", GitBranch],
  ["labels", "ラベル", Tags],
  ["releases", "リリース", Tag],
  ["actions", "Actions の実行", Play],
  ["workflow", "ワークフロー", WorkflowIcon],
  ["config", "変数とシークレット", KeyRound],
  ["people", "メンバーと Webhook", Users],
  ["extras", "ひな形・キー・履歴", Wrench],
] as const;
export type Tab = (typeof TABS)[number][0];

const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=repo,workflow,admin:repo_hook,delete_repo&description=Fixit%20Editor";

// GitHub でログイン(デバイスフロー)。コードを見せ、ブラウザで承認されるまで待つ
function DeviceLogin({ onDone }: { onDone: () => void }) {
  const [dev, setDev] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ac = useMemo(() => ({ cur: null as AbortController | null }), []);
  useEffect(() => () => ac.cur?.abort(), [ac]);
  const start = async () => {
    ac.cur?.abort();
    const c = (ac.cur = new AbortController());
    setBusy(true); setErr(""); setDev(null);
    const r = await githubLogin(GH_CLIENT_ID, GH_SCOPES, (d) => { setDev(d); void openExternal(d.verification_uri); }, c.signal);
    if (c.signal.aborted) return;
    setBusy(false); setDev(null);
    if (!r.ok) { if (r.why !== "cancel") setErr(r.why === "denied" ? i18next.t("承認が拒否されました") : r.why === "expired" ? i18next.t("コードの期限が切れました。もう一度試してください") : i18next.t("GitHub に接続できません")); return; }
    try { await gh.viewer(r.token); setGhToken(r.token); onDone(); } catch (e) { setErr(ghErr(e)); }
  };
  const cancel = () => { ac.cur?.abort(); setBusy(false); setDev(null); };
  return (
    <div className="gh-login">
      {dev ? (
        <>
          <p><Trans i18nKey="ブラウザで GitHub を開き、次のコードを入れて許可してください" /></p>
          <code className="gh-code" aria-label={i18next.t("確認コード")}>{dev.user_code}</code>
          <small><Trans i18nKey="承認を待っています" /></small>
          <div className="gh-actions">
            <button className="btn" onClick={() => void openExternal(dev.verification_uri)}><ExternalLink size={14} /><span><Trans i18nKey="GitHub を開く" /></span></button>
            <button className="btn" onClick={cancel}><Trans i18nKey="やめる" /></button>
          </div>
        </>
      ) : (
        <button className="btn" data-primary="true" disabled={busy} onClick={() => void start()}><KeyRound size={14} /><span><Trans i18nKey="GitHub でログイン" /></span></button>
      )}
      {err && <Fail msg={err} />}
    </div>
  );
}

// ログインの画面。ログイン(デバイスフロー)か、トークンの貼り付け
function TokenGate({ onDone }: { onDone: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setBusy(true); setErr("");
    try { await gh.viewer(v.trim()); setGhToken(v); onDone(); } catch (e) { setErr(ghErr(e)); } finally { setBusy(false); }
  };
  const paste = (
    <div className="gh-paste">
      <ol>
        <li><Trans i18nKey="下のボタンでトークンの作成ページを開く(必要な権限が選ばれています)" /></li>
        <li><Trans i18nKey="作ったトークンをここに貼って「確かめて保存」を押す" /></li>
      </ol>
      <button className="btn" onClick={() => void openExternal(TOKEN_URL)}><ExternalLink size={14} /><span><Trans i18nKey="トークンの作成ページを開く" /></span></button>
      <input className="field" type="password" value={v} autoComplete="off" spellCheck={false} placeholder="ghp_… / github_pat_…" aria-label={i18next.t("トークン")}
        onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && v.trim() && !busy) void save(); }} />
      {err && <Fail msg={err} />}
      <button className="btn" data-primary="true" disabled={!v.trim() || busy} onClick={() => void save()}>{busy ? i18next.t("確認中") : i18next.t("確かめて保存")}</button>
    </div>
  );
  return (
    <div className="gh-gate">
      <KeyRound size={28} />
      <h3><Trans i18nKey={GH_CLIENT_ID ? "GitHub にログインしてください" : "GitHub のトークンを入れてください"} /></h3>
      <p><Trans i18nKey="このエディタから、リポジトリの設定・Issue・プルリクエスト・Actions などを操作するために使います。トークンはこの PC の中だけに、暗号化して保存します。" /></p>
      {GH_CLIENT_ID ? (
        <>
          <DeviceLogin onDone={onDone} />
          <details className="gh-alt"><summary><Trans i18nKey="トークンを貼ってログインする" /></summary>{paste}</details>
        </>
      ) : paste}
    </div>
  );
}

// 開いているフォルダの中の GitHub リポジトリを、一覧から選ぶ
function RepoList({ found, onPick, onCreate }: { found: Found[]; onPick: (dir: string) => void; onCreate: () => void }) {
  return (
    <div className="gh-gate gh-repos">
      <GitBranch size={28} />
      <h3>{found.length ? <Trans i18nKey="リポジトリを選んでください" /> : i18next.t("リポジトリがありません")}</h3>
      <p>{found.length ? i18next.t("開いているフォルダの中に、GitHub のリポジトリが {{n}} 件あります。", { n: found.length }) : i18next.t("開いているフォルダの中に、GitHub のリポジトリは見つかりませんでした。")}</p>
      <ul className="gh-list">
        {found.map((f) => (
          <li key={f.dir}>
            <button className="gh-item" onClick={() => onPick(f.dir)}>
              <GitBranch size={15} />
              <span className="gh-item-t"><b>{f.remotes[0].repo}</b><small>{f.rel || "."} · {slugOf(f.remotes.find((r) => r.name === "origin") ?? f.remotes[0])}</small></span>
            </button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={onCreate}><FolderGit2 size={14} /><span><Trans i18nKey="GitHub に新しく作る" /></span></button>
    </div>
  );
}

function Body({ conn, root, onClose }: { conn: Conn; root: string; onClose: () => void }) {
  // 前回の結果を先に見せ、裏で探し直して差し替える
  const found = useLoad<Found[]>(async () => { const r = await mergeKnown(conn, root, await findRepos(conn, root)); void saveCache(conn, root, r); return r; }, [conn, root]);
  const [cached, setCached] = useState<Found[] | null>(null);
  useEffect(() => {
    let live = true; setCached(null);
    void loadCache(conn, root).then((c) => { if (live) setCached(c); });
    return () => { live = false; };
  }, [conn, root]);
  const [dir, setDir] = useState<string | null>(null); // null: 既定のリポジトリ、"": 一覧を見せる
  const [pick, setPick] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [creating, setCreating] = useState(false);
  const [made, setMade] = useState<Found[]>([]); // いま作ったリポジトリ(探索の深さの外でも出せるように持つ)
  const all = useMemo(() => { const b = found.data ?? cached ?? []; return [...b, ...made.filter((m) => !b.some((f) => f.dir === m.dir))]; }, [found.data, cached, made]);
  const here = dir ? all.find((f) => f.dir === dir) : undefined; // 開いたら、まず一覧を見せる(1 件でも)
  const remotes = here?.remotes ?? [];
  const cur = remotes.find((r) => r.name === pick) ?? remotes.find((r) => r.name === "origin") ?? remotes[0];
  const s: Slug | null = useMemo(() => (cur ? { owner: cur.owner, repo: cur.repo } : null), [cur]);
  const choose = (d: string) => { setDir(d); setPick(""); setTab("overview"); };
  // トークンが拒まれたら、保存を消して入力画面へ戻す
  const me = useLoad(async () => {
    try { return await gh.viewer(); } catch (e) { if (e instanceof GhError && e.status === 401) setGhToken(""); throw e; }
  }, []);
  const repo = useLoad(() => (s ? gh.repo(s) : Promise.resolve(null)), [s?.owner, s?.repo]);

  if (found.busy && !found.data && !cached) return <Busy big />;
  if (found.err && !all.length) return <Fail msg={found.err} retry={() => void found.reload()} />;
  if (creating && me.data) return <CreateRepo conn={conn} root={root} viewer={me.data} onDone={(f) => { void saveCache(conn, root, [...all.filter((x) => x.dir !== f.dir), f]); setMade((m) => [...m, f]); setCreating(false); setDir(f.dir); setTab("overview"); void found.reload(); }} onBack={() => setCreating(false)} />;
  if (!here) return <RepoList found={all} onPick={choose} onCreate={() => setCreating(true)} />;
  if (!s || !cur || !here) {
    if (me.err) return <Fail msg={me.err} retry={() => void me.reload()} />;
    if (!me.data) return <Busy big />;
    return <CreateRepo conn={conn} root={root} viewer={me.data} onDone={(f) => { void saveCache(conn, root, [...all.filter((x) => x.dir !== f.dir), f]); setMade((m) => [...m, f]); setDir(f.dir); setTab("overview"); void found.reload(); }} />;
  }
  if (me.err) return <Fail msg={me.err} retry={() => void me.reload()} />;
  if (repo.err) return <Fail msg={repo.err} retry={() => void repo.reload()} />;
  if (!repo.data || !me.data) return <Busy big />;
  const ctx: Ctx = { s, repo: repo.data, conn, root: here.dir, reloadRepo: () => void repo.reload(), go: setTab, viewer: me.data };
  const logout = async () => {
    if (await ask({ message: i18next.t("保存したトークンを消しますか?(GitHub 側のトークンは消えません)"), ok: i18next.t("消す"), danger: true })) setGhToken("");
  };
  return (
    <div className="gh-body">
      <nav className="gh-nav" aria-label={i18next.t("GitHub の項目")}>
        <div className="gh-repo">
          <b title={slugOf(s)}>{s.repo}</b>
          <small>{s.owner}</small>
          <button className="gh-link" onClick={() => setDir(null)}><ArrowLeft size={13} /><span><Trans i18nKey="一覧へ" /></span></button>
          {remotes.length > 1 && (
            <Select value={cur.name} label={i18next.t("リモート")} onChange={setPick} options={remotes.map((r) => ({ value: r.name, label: `${r.name} · ${r.owner}/${r.repo}` }))} />
          )}
        </div>
        <div className="gh-tabs" role="tablist" aria-orientation="vertical">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}><Icon size={15} /><span>{i18next.t(label)}</span></button>
          ))}
        </div>
        <div className="gh-nav-foot">
          <button className="gh-link" onClick={() => void openExternal(ctx.repo.html_url)}><ExternalLink size={13} /><span><Trans i18nKey="GitHub で開く" /></span></button>
          <button className="gh-link" onClick={() => void logout()}><LogOut size={13} /><span>{i18next.t("{{login}} をやめる", { login: me.data.login })}</span></button>
        </div>
      </nav>
      <div className="gh-main" key={tab} role="tabpanel">
        {tab === "overview" && <Overview {...ctx} onClose={onClose} />}
        {tab === "issues" && <Issues {...ctx} kind="issue" />}
        {tab === "pulls" && <Issues {...ctx} kind="pull" />}
        {tab === "branches" && <Branches {...ctx} />}
        {tab === "labels" && <Labels {...ctx} />}
        {tab === "releases" && <Releases {...ctx} />}
        {tab === "actions" && <Actions {...ctx} />}
        {tab === "workflow" && <Suspense fallback={<Busy />}><WorkflowEditor {...ctx} /></Suspense>}
        {tab === "config" && <Config {...ctx} />}
        {tab === "people" && <People {...ctx} />}
        {tab === "extras" && <Extras {...ctx} />}
      </div>
    </div>
  );
}

// GitHub のリポジトリを管理する画面(全画面のダイアログ)
export default function GithubView({ conn, root, onClose, out }: { conn: Conn; root: string; onClose: () => void; out?: boolean }) {
  const token = useGhToken();
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".ask-layer, .sel-list")) close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const [tick, setTick] = useState(0);
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg gh" role="dialog" aria-label="GitHub" onMouseDown={(e) => e.stopPropagation()}>
        <header className="gh-top">
          <h2><Boxes size={16} /><span>GitHub</span></h2>
          <button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
        </header>
        {token ? <Body key={tick} conn={conn} root={root} onClose={close} /> : <TokenGate onDone={() => setTick((n) => n + 1)} />}
      </div>
    </div>
  );
}
