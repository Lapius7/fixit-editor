// ひな形(.gitignore・ライセンス)の追加、デプロイキー、Actions のキャッシュ、タグ、最近のコミット。
import { useState } from "react";
import i18next from "i18next";
import { ExternalLink, FilePlus2, GitCommitHorizontal, KeyRound, Plus, RefreshCw, Tag as TagIcon, Trash2, Database } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { openExternal } from "@/features/account/auth";
import { gh, GhError, relTime } from "./api";
import type { Ctx } from "./GithubView";
import { act, Avatar, Busy, bytes, Empty, Fail, Head, Switch, useLoad } from "./ui";

// 指定のパスにファイルを置く。すでにあれば、置き換えてよいか確かめる
async function put(ctx: Ctx, path: string, text: string, message: string): Promise<boolean> {
  const { s, repo } = ctx;
  let sha: string | undefined;
  try { sha = (await gh.file(s, path, repo.default_branch)).sha; } catch (e) { if (!(e instanceof GhError && e.status === 404)) throw e; }
  if (sha && !(await ask({ message: i18next.t("{{path}} はすでにあります。置き換えますか?(元の内容は履歴に残ります)", { path }), ok: i18next.t("置き換える"), danger: true }))) return false;
  return act(() => gh.putFile(s, path, text, message, sha, repo.default_branch), i18next.t("{{path}} を {{branch}} に追加しました", { path, branch: repo.default_branch }));
}

function Templates(ctx: Ctx) {
  const canWrite = !!(ctx.repo.permissions?.push || ctx.repo.permissions?.admin);
  const ign = useLoad(() => gh.gitignoreNames(), []);
  const lic = useLoad(() => gh.licenseList(), []);
  const [gi, setGi] = useState("");
  const [li, setLi] = useState("");
  const [busy, setBusy] = useState(false);
  const addIgnore = async () => {
    setBusy(true);
    try { const text = await gh.gitignoreText(gi); await put(ctx, ".gitignore", text, `Add .gitignore (${gi})`); }
    catch (e) { await act(() => Promise.reject(e)); }
    setBusy(false);
  };
  const addLicense = async () => {
    setBusy(true);
    try {
      const text = (await gh.licenseText(li)).replace(/\[year\]/gi, String(new Date().getFullYear())).replace(/\[fullname\]/gi, ctx.viewer.name || ctx.viewer.login);
      await put(ctx, "LICENSE", text, `Add LICENSE (${li})`);
    } catch (e) { await act(() => Promise.reject(e)); }
    setBusy(false);
  };
  return (
    <section className="gh-card">
      <h4><FilePlus2 size={14} />{i18next.t("ひな形を追加")}</h4>
      <p className="gh-none">{i18next.t("既定のブランチ({{b}})に、ファイルを 1 つ追加するコミットを作ります。", { b: ctx.repo.default_branch })}</p>
      <div className="gh-f"><span>.gitignore</span>
        <div className="gh-bar">
          {ign.err ? <Fail msg={ign.err} retry={() => void ign.reload()} /> : (
            <><Select value={gi} label=".gitignore" onChange={setGi} options={[{ value: "", label: i18next.t("選んでください") }, ...(ign.data ?? []).map((n) => ({ value: n, label: n }))]} />
              <button className="btn" data-primary="true" disabled={!gi || busy || !canWrite} onClick={() => void addIgnore()}><Plus size={14} /><span>{i18next.t("追加")}</span></button></>
          )}
        </div></div>
      <div className="gh-f"><span>{i18next.t("ライセンス")}</span>
        <div className="gh-bar">
          {lic.err ? <Fail msg={lic.err} retry={() => void lic.reload()} /> : (
            <><Select value={li} label={i18next.t("ライセンス")} onChange={setLi} options={[{ value: "", label: i18next.t("選んでください") }, ...(lic.data ?? []).map((n) => ({ value: n.key, label: n.name }))]} />
              <button className="btn" data-primary="true" disabled={!li || busy || !canWrite} onClick={() => void addLicense()}><Plus size={14} /><span>{i18next.t("追加")}</span></button></>
          )}
        </div></div>
      {!canWrite && <p className="gh-none">{i18next.t("このリポジトリに書き込む権限がありません")}</p>}
    </section>
  );
}

function Keys({ s, repo }: Ctx) {
  const admin = !!repo.permissions?.admin;
  const keys = useLoad(() => gh.deployKeys(s), [s.owner, s.repo]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [rw, setRw] = useState(false);
  const ok = title.trim() !== "" && /^(ssh-|ecdsa-|sk-)/.test(key.trim());
  const add = async () => {
    if (rw && !(await ask({ message: i18next.t("書き込みを許すと、この鍵を持つ人がこのリポジトリに push できます。続けますか?"), ok: i18next.t("許す"), danger: true }))) return;
    if (await act(() => gh.addDeployKey(s, { title: title.trim(), key: key.trim(), read_only: !rw }), i18next.t("追加しました"))) { setOpen(false); setTitle(""); setKey(""); setRw(false); void keys.reload(); }
  };
  const del = async (id: number, t: string) => {
    if (!(await ask({ message: i18next.t("デプロイキー「{{name}}」を削除します。この鍵ではアクセスできなくなります。", { name: t }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteDeployKey(s, id), i18next.t("削除しました"))) void keys.reload();
  };
  return (
    <section className="gh-card">
      <div className="gh-head"><div className="gh-head-t"><h4><KeyRound size={14} />{i18next.t("デプロイキー")}</h4><small>{i18next.t("公開鍵だけを登録します")}</small></div>
        {admin && <div className="gh-head-a"><button className="btn" onClick={() => setOpen(!open)}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div>}</div>
      {open && (
        <div className="gh-card gh-inset">
          <label className="gh-f"><span>{i18next.t("名前")}</span><input className="field" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="gh-f"><span>{i18next.t("公開鍵")}</span><textarea className="field gh-area gh-mono" rows={3} spellCheck={false} value={key} placeholder="ssh-ed25519 AAAA…" aria-label={i18next.t("公開鍵")} onChange={(e) => setKey(e.target.value)} /></label>
          <div className="gh-f"><span>{i18next.t("書き込みを許す")}</span><Switch on={rw} label={i18next.t("書き込みを許す")} onChange={setRw} /></div>
          <div className="gh-actions">
            <button className="btn" onClick={() => setOpen(false)}>{i18next.t("キャンセル")}</button>
            <button className="btn" data-primary="true" disabled={!ok} onClick={() => void add()}>{i18next.t("追加")}</button>
          </div>
        </div>
      )}
      {keys.busy && !keys.data ? <Busy /> : keys.err ? <Fail msg={keys.err} retry={() => void keys.reload()} /> : (keys.data ?? []).length === 0 ? <Empty text={i18next.t("デプロイキーがありません")} /> : (
        <ul className="gh-list">{keys.data!.map((k) => (
          <li key={k.id} className="gh-item gh-item-static">
            <span className="gh-item-t"><b>{k.title}</b><small>{k.read_only ? i18next.t("読み取りのみ") : i18next.t("書き込みも可")} · {relTime(k.created_at)}</small></span>
            {admin && <span className="gh-item-r"><button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del(k.id, k.title)}><Trash2 size={14} /></button></span>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function Caches({ s, repo }: Ctx) {
  const can = !!(repo.permissions?.push || repo.permissions?.admin);
  const c = useLoad(() => gh.caches(s), [s.owner, s.repo]);
  const total = (c.data ?? []).reduce((a, x) => a + x.size_in_bytes, 0);
  const del = async (id: number) => { if (await act(() => gh.deleteCache(s, id), i18next.t("削除しました"))) void c.reload(); };
  const all = async () => {
    if (!(await ask({ message: i18next.t("Actions のキャッシュをすべて削除します。次の実行は、キャッシュなしで始まります。"), ok: i18next.t("すべて削除"), danger: true }))) return;
    if (await act(() => gh.deleteAllCaches(s), i18next.t("削除しました"))) void c.reload();
  };
  return (
    <section className="gh-card">
      <div className="gh-head"><div className="gh-head-t"><h4><Database size={14} />{i18next.t("Actions のキャッシュ")}</h4>{c.data && <small>{i18next.t("{{n}} 件 · {{size}}", { n: c.data.length, size: bytes(total) })}</small>}</div>
        {can && (c.data ?? []).length > 0 && <div className="gh-head-a"><button className="btn" data-danger="true" onClick={() => void all()}><Trash2 size={14} /><span>{i18next.t("すべて削除")}</span></button></div>}</div>
      {c.busy && !c.data ? <Busy /> : c.err ? <Fail msg={c.err} retry={() => void c.reload()} /> : (c.data ?? []).length === 0 ? <Empty text={i18next.t("キャッシュがありません")} /> : (
        <ul className="gh-list">{c.data!.slice(0, 50).map((x) => (
          <li key={x.id} className="gh-item gh-item-static">
            <span className="gh-item-t"><b className="gh-val">{x.key}</b><small>{x.ref} · {bytes(x.size_in_bytes)} · {relTime(x.last_accessed_at)}</small></span>
            {can && <span className="gh-item-r"><button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del(x.id)}><Trash2 size={14} /></button></span>}
          </li>
        ))}</ul>
      )}
    </section>
  );
}

function History({ s }: Ctx) {
  const tags = useLoad(() => gh.tags(s), [s.owner, s.repo]);
  const commits = useLoad(() => gh.commits(s), [s.owner, s.repo]);
  const url = (p: string) => `https://github.com/${s.owner}/${s.repo}/${p}`;
  return (
    <>
      <section className="gh-card">
        <h4><TagIcon size={14} />{i18next.t("タグ")}</h4>
        {tags.busy && !tags.data ? <Busy /> : tags.err ? <Fail msg={tags.err} retry={() => void tags.reload()} /> : (tags.data ?? []).length === 0 ? <Empty text={i18next.t("タグがありません")} /> : (
          <ul className="gh-list">{tags.data!.slice(0, 50).map((t) => (
            <li key={t.name} className="gh-item gh-item-static">
              <span className="gh-item-t"><b>{t.name}</b><small className="gh-mono">{t.commit.sha.slice(0, 7)}</small></span>
              <span className="gh-item-r"><button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(url(`releases/tag/${encodeURIComponent(t.name)}`))}><ExternalLink size={14} /></button></span>
            </li>
          ))}</ul>
        )}
      </section>
      <section className="gh-card">
        <h4><GitCommitHorizontal size={14} />{i18next.t("最近のコミット")}</h4>
        {commits.busy && !commits.data ? <Busy /> : commits.err ? <Fail msg={commits.err} retry={() => void commits.reload()} /> : (commits.data ?? []).length === 0 ? <Empty text={i18next.t("コミットがありません")} /> : (
          <ul className="gh-list">{commits.data!.map((c) => (
            <li key={c.sha} className="gh-item gh-item-static">
              <Avatar u={c.author} size={20} />
              <span className="gh-item-t"><b className="truncate">{c.commit.message.split("\n")[0]}</b><small>{c.author?.login ?? c.commit.author?.name ?? ""} · {relTime(c.commit.author?.date ?? "")} · <span className="gh-mono">{c.sha.slice(0, 7)}</span></small></span>
              <span className="gh-item-r"><button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(c.html_url)}><ExternalLink size={14} /></button></span>
            </li>
          ))}</ul>
        )}
      </section>
    </>
  );
}

export default function Extras(ctx: Ctx) {
  const [n, setN] = useState(0); // 再読み込みで、各区画を作り直す
  return (
    <div className="gh-page" key={n}>
      <Head title={i18next.t("ひな形・キー・履歴")}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => setN(n + 1)}><RefreshCw size={14} /></button>
      </Head>
      <Templates {...ctx} />
      <Keys {...ctx} />
      <Caches {...ctx} />
      <History {...ctx} />
    </div>
  );
}
