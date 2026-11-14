import { useState } from "react";
import i18next from "i18next";
import { ArrowLeft, Download, ExternalLink, Pencil, Plus, RefreshCw, Tag, Trash2 } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { openExternal } from "@/features/account/auth";
import { gh, relTime, type Release } from "./api";
import type { Ctx } from "./GithubView";
import { act, Area, Busy, bytes, Empty, Fail, Head, Md, Pill, useLoad } from "./ui";

// 作成と編集の画面。編集のときは、タグは変えられない
function Editor({ ctx, rel, onDone, onCancel }: { ctx: Ctx; rel: Release | null; onDone: () => void; onCancel: () => void }) {
  const { s, repo } = ctx;
  const [tag, setTag] = useState(rel?.tag_name ?? "");
  const [target, setTarget] = useState(repo.default_branch);
  const [name, setName] = useState(rel?.name ?? "");
  const [body, setBody] = useState(rel?.body ?? "");
  const [draft, setDraft] = useState(rel?.draft ?? false);
  const [pre, setPre] = useState(rel?.prerelease ?? false);
  const [auto, setAuto] = useState(!rel);
  const [busy, setBusy] = useState(false);
  const br = useLoad(() => gh.branches(s), [s.owner, s.repo]);
  const go = async () => {
    setBusy(true);
    const ok = await act(() => rel
      ? gh.updateRelease(s, rel.id, { name, body, draft, prerelease: pre })
      : gh.createRelease(s, { tag_name: tag.trim(), target_commitish: target, name: name || tag.trim(), body: body || undefined, draft, prerelease: pre, generate_release_notes: auto && !body }),
    rel ? i18next.t("保存しました") : i18next.t("リリースを作りました"));
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div className="gh-page">
      <Head title={rel ? i18next.t("リリースを編集") : i18next.t("新しいリリース")}><button className="btn" onClick={onCancel}><ArrowLeft size={14} /><span>{i18next.t("戻る")}</span></button></Head>
      <section className="gh-card">
        <label className="gh-f"><span>{i18next.t("タグ")}</span><input className="field" value={tag} disabled={!!rel} placeholder="v1.0.0" onChange={(e) => setTag(e.target.value)} /></label>
        {!rel && <div className="gh-f"><span>{i18next.t("タグを付けるブランチ")}</span><Select value={target} label={i18next.t("タグを付けるブランチ")} onChange={setTarget} options={(br.data ?? [{ name: repo.default_branch }]).map((b) => ({ value: b.name, label: b.name }))} /></div>}
        <label className="gh-f"><span>{i18next.t("タイトル")}</span><input className="field" value={name} placeholder={tag} onChange={(e) => setName(e.target.value)} /></label>
        <label className="gh-f"><span>{i18next.t("リリースノート(Markdown)")}</span><Area value={body} onChange={setBody} rows={9} label={i18next.t("リリースノート")} /></label>
        {!rel && <label className="gh-check"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>{i18next.t("ノートが空なら、GitHub に自動で作らせる")}</span></label>}
        <label className="gh-check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /><span>{i18next.t("下書きにする(公開しない)")}</span></label>
        <label className="gh-check"><input type="checkbox" checked={pre} onChange={(e) => setPre(e.target.checked)} /><span>{i18next.t("プレリリースにする")}</span></label>
        <div className="gh-actions">
          <button className="btn" onClick={onCancel}>{i18next.t("やめる")}</button>
          <button className="btn" data-primary="true" disabled={busy || (!rel && !tag.trim())} onClick={() => void go()}>{rel ? i18next.t("保存") : i18next.t("作る")}</button>
        </div>
      </section>
    </div>
  );
}

export default function Releases(ctx: Ctx) {
  const { s } = ctx;
  const list = useLoad(() => gh.releases(s), [s.owner, s.repo]);
  const [at, setAt] = useState<Release | "new" | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  if (at) return <Editor ctx={ctx} rel={at === "new" ? null : at} onCancel={() => setAt(null)} onDone={() => { setAt(null); void list.reload(); }} />;

  const del = async (r: Release) => {
    if (!(await ask({ message: i18next.t("リリース「{{name}}」を削除します。タグは残ります。", { name: r.name || r.tag_name }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteRelease(s, r.id), i18next.t("削除しました"))) void list.reload();
  };
  return (
    <div className="gh-page">
      <Head title={i18next.t("リリース")} sub={list.data ? i18next.t("{{n}} 件", { n: list.data.length }) : undefined}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => void list.reload()}><RefreshCw size={14} /></button>
        <button className="btn" data-primary="true" onClick={() => setAt("new")}><Plus size={14} /><span>{i18next.t("新規")}</span></button>
      </Head>
      {list.busy && !list.data ? <Busy /> : list.err ? <Fail msg={list.err} retry={() => void list.reload()} /> : (list.data ?? []).length === 0 ? <Empty icon={<Tag size={20} />} text={i18next.t("リリースがありません")} /> : (
        <ul className="gh-list">
          {list.data!.map((r) => (
            <li key={r.id} className="gh-rel">
              <div className="gh-item gh-item-static">
                <Tag size={15} />
                <button className="gh-item-t gh-plain" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  <b>{r.name || r.tag_name}</b>
                  <small>{r.tag_name} · {relTime(r.published_at ?? r.created_at)}</small>
                </button>
                <span className="gh-item-r">
                  {r.draft && <Pill>{i18next.t("下書き")}</Pill>}
                  {r.prerelease && <Pill tone="warn">{i18next.t("プレリリース")}</Pill>}
                  <button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(r.html_url)}><ExternalLink size={14} /></button>
                  <button className="icon-btn" aria-label={i18next.t("編集")} title={i18next.t("編集")} onClick={() => setAt(r)}><Pencil size={14} /></button>
                  <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del(r)}><Trash2 size={14} /></button>
                </span>
              </div>
              {open === r.id && (
                <div className="gh-rel-body">
                  {r.body ? <Md text={r.body} /> : <p className="gh-none">{i18next.t("リリースノートはありません")}</p>}
                  {r.assets.length > 0 && <ul className="gh-files">{r.assets.map((a) => <li key={a.id}><Download size={13} /><span className="gh-fn">{a.name}</span><small>{bytes(a.size)} · {i18next.t("{{n}} 回", { n: a.download_count })}</small></li>)}</ul>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
