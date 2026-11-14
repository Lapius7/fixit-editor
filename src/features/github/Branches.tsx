import { useState } from "react";
import i18next from "i18next";
import { GitBranch, Pencil, RefreshCw, Shield, ShieldCheck, Trash2, X } from "lucide-react";
import { ask } from "@/shared/ask";
import { GhError, gh, type Protection } from "./api";
import type { Ctx } from "./GithubView";
import { act, Busy, Empty, Fail, Head, Pill, Row, Switch, useLoad } from "./ui";

// 保護ルールの編集。GitHub の API は全項目をまとめて受け取るので、画面の状態から本文を組み立てる
function ProtectEditor({ ctx, branch, onClose }: { ctx: Ctx; branch: string; onClose: (changed: boolean) => void }) {
  const { s } = ctx;
  const cur = useLoad<Protection | null>(async () => {
    try { return await gh.protection(s, branch); } catch (e) { if (e instanceof GhError && e.status === 404) return null; throw e; }
  }, [branch]);
  const [f, setF] = useState<{ pr: boolean; count: number; stale: boolean; owners: boolean; checks: boolean; strict: boolean; contexts: string; admins: boolean; linear: boolean; force: boolean; del: boolean; conv: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  if (cur.busy && !cur.data && !f && !cur.err) return <Busy />;
  if (cur.err) return <Fail msg={cur.err} retry={() => void cur.reload()} />;
  const p = cur.data;
  const v = f ?? {
    pr: !!p?.required_pull_request_reviews, count: p?.required_pull_request_reviews?.required_approving_review_count ?? 1,
    stale: !!p?.required_pull_request_reviews?.dismiss_stale_reviews, owners: !!p?.required_pull_request_reviews?.require_code_owner_reviews,
    checks: !!p?.required_status_checks, strict: !!p?.required_status_checks?.strict, contexts: (p?.required_status_checks?.contexts ?? []).join(", "),
    admins: !!p?.enforce_admins?.enabled, linear: !!p?.required_linear_history?.enabled, force: !!p?.allow_force_pushes?.enabled,
    del: !!p?.allow_deletions?.enabled, conv: !!p?.required_conversation_resolution?.enabled,
  };
  const set = (k: Partial<typeof v>) => setF({ ...v, ...k });
  const save = async () => {
    setBusy(true);
    const ok = await act(() => gh.setProtection(s, branch, {
      required_status_checks: v.checks ? { strict: v.strict, contexts: v.contexts.split(",").map((x) => x.trim()).filter(Boolean) } : null,
      enforce_admins: v.admins,
      required_pull_request_reviews: v.pr ? { required_approving_review_count: v.count, dismiss_stale_reviews: v.stale, require_code_owner_reviews: v.owners } : null,
      restrictions: null,
      required_linear_history: v.linear, allow_force_pushes: v.force, allow_deletions: v.del, required_conversation_resolution: v.conv,
    }), i18next.t("保護ルールを保存しました"));
    setBusy(false);
    if (ok) onClose(true);
  };
  const remove = async () => {
    if (!(await ask({ message: i18next.t("「{{branch}}」の保護ルールをすべて外します。", { branch }), ok: i18next.t("外す"), danger: true }))) return;
    if (await act(() => gh.removeProtection(s, branch), i18next.t("保護ルールを外しました"))) onClose(true);
  };
  return (
    <div className="gh-page">
      <Head title={i18next.t("保護ルール")} sub={branch}><button className="btn" onClick={() => onClose(false)}><X size={14} /><span>{i18next.t("閉じる")}</span></button></Head>
      <section className="gh-card">
        <Row title={i18next.t("マージ前にレビューを必須にする")}><Switch on={v.pr} label={i18next.t("レビューを必須にする")} onChange={(x) => set({ pr: x })} /></Row>
        {v.pr && (<>
          <Row title={i18next.t("必要な承認の数")}><input className="field gh-num" type="number" min={1} max={6} value={v.count} aria-label={i18next.t("必要な承認の数")} onChange={(e) => set({ count: Math.min(6, Math.max(1, +e.target.value || 1)) })} /></Row>
          <Row title={i18next.t("新しいコミットで、古い承認を取り消す")}><Switch on={v.stale} label={i18next.t("古い承認を取り消す")} onChange={(x) => set({ stale: x })} /></Row>
          <Row title={i18next.t("コードオーナーの承認を必須にする")}><Switch on={v.owners} label={i18next.t("コードオーナーの承認")} onChange={(x) => set({ owners: x })} /></Row>
        </>)}
        <Row title={i18next.t("マージ前にステータスチェックを必須にする")}><Switch on={v.checks} label={i18next.t("ステータスチェックを必須にする")} onChange={(x) => set({ checks: x })} /></Row>
        {v.checks && (<>
          <Row title={i18next.t("ブランチが最新であることを求める")}><Switch on={v.strict} label={i18next.t("最新であることを求める")} onChange={(x) => set({ strict: x })} /></Row>
          <Row title={i18next.t("必須のチェック名")} hint={i18next.t("カンマで区切ります")}><input className="field" value={v.contexts} aria-label={i18next.t("必須のチェック名")} onChange={(e) => set({ contexts: e.target.value })} /></Row>
        </>)}
        <Row title={i18next.t("会話の解決を必須にする")}><Switch on={v.conv} label={i18next.t("会話の解決を必須にする")} onChange={(x) => set({ conv: x })} /></Row>
        <Row title={i18next.t("履歴を一直線に保つ")} hint={i18next.t("マージコミットを禁じます")}><Switch on={v.linear} label={i18next.t("履歴を一直線に保つ")} onChange={(x) => set({ linear: x })} /></Row>
        <Row title={i18next.t("管理者にも同じルールを適用する")}><Switch on={v.admins} label={i18next.t("管理者にも適用する")} onChange={(x) => set({ admins: x })} /></Row>
        <Row title={i18next.t("強制プッシュを許す")}><Switch on={v.force} label={i18next.t("強制プッシュを許す")} onChange={(x) => set({ force: x })} /></Row>
        <Row title={i18next.t("ブランチの削除を許す")}><Switch on={v.del} label={i18next.t("ブランチの削除を許す")} onChange={(x) => set({ del: x })} /></Row>
        <div className="gh-actions">
          {p && <button className="btn" data-danger="true" disabled={busy} onClick={() => void remove()}>{i18next.t("保護を外す")}</button>}
          <button className="btn" data-primary="true" disabled={busy} onClick={() => void save()}>{i18next.t("保存")}</button>
        </div>
      </section>
    </div>
  );
}

export default function Branches(ctx: Ctx) {
  const { s, repo } = ctx;
  const list = useLoad(() => gh.branches(s), [s.owner, s.repo]);
  const [edit, setEdit] = useState<string | null>(null);
  const [rn, setRn] = useState<{ from: string; to: string } | null>(null);

  if (edit) return <ProtectEditor ctx={ctx} branch={edit} onClose={(c) => { setEdit(null); if (c) void list.reload(); }} />;

  const del = async (name: string) => {
    if (!(await ask({ message: i18next.t("ブランチ「{{name}}」を GitHub から削除します。", { name }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteBranch(s, name), i18next.t("削除しました"))) void list.reload();
  };
  const rename = async () => {
    if (!rn || !rn.to.trim() || rn.to === rn.from) { setRn(null); return; }
    const r = rn; setRn(null);
    if (await act(() => gh.renameBranch(s, r.from, r.to.trim()), i18next.t("名前を変えました"))) { void list.reload(); if (r.from === repo.default_branch) ctx.reloadRepo(); }
  };

  return (
    <div className="gh-page">
      <Head title={i18next.t("ブランチ")} sub={list.data ? i18next.t("{{n}} 件", { n: list.data.length }) : undefined}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => void list.reload()}><RefreshCw size={14} /></button>
      </Head>
      {list.busy && !list.data ? <Busy /> : list.err ? <Fail msg={list.err} retry={() => void list.reload()} /> : (list.data ?? []).length === 0 ? <Empty icon={<GitBranch size={20} />} text={i18next.t("ブランチがありません")} /> : (
        <ul className="gh-list">
          {list.data!.map((b) => {
            const def = b.name === repo.default_branch;
            return (
              <li key={b.name} className="gh-item gh-item-static">
                <GitBranch size={15} />
                <span className="gh-item-t">
                  {rn?.from === b.name
                    ? <input className="field gh-inline" autoFocus value={rn.to} aria-label={i18next.t("新しい名前")} onChange={(e) => setRn({ ...rn, to: e.target.value })} onBlur={() => void rename()} onKeyDown={(e) => { if (e.key === "Enter") void rename(); if (e.key === "Escape") setRn(null); }} />
                    : <b>{b.name}</b>}
                  <small>{b.commit.sha.slice(0, 7)}</small>
                </span>
                <span className="gh-item-r">
                  {def && <Pill tone="info">{i18next.t("既定")}</Pill>}
                  {b.protected && <Pill tone="ok"><ShieldCheck size={11} />{i18next.t("保護")}</Pill>}
                  <button className="icon-btn" aria-label={i18next.t("保護ルール")} title={i18next.t("保護ルール")} onClick={() => setEdit(b.name)}><Shield size={14} /></button>
                  <button className="icon-btn" aria-label={i18next.t("名前を変える")} title={i18next.t("名前を変える")} onClick={() => setRn({ from: b.name, to: b.name })}><Pencil size={14} /></button>
                  <button className="icon-btn" aria-label={i18next.t("削除")} title={def ? i18next.t("既定のブランチは削除できません") : i18next.t("削除")} disabled={def} onClick={() => void del(b.name)}><Trash2 size={14} /></button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {repo.private && <p className="gh-none">{i18next.t("非公開のリポジトリで保護ルールを使うには、GitHub Pro 以上が必要です。")}</p>}
    </div>
  );
}
