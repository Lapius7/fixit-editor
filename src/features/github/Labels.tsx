// ラベルとマイルストーンの管理(gh label / gh api milestones 相当)。
import { useState } from "react";
import i18next from "i18next";
import { Check, Pencil, Plus, RefreshCw, Tag as TagIcon, Target, Trash2, X } from "lucide-react";
import { ask } from "@/shared/ask";
import { gh, type Label, type Milestone } from "./api";
import type { Ctx } from "./GithubView";
import { act, Busy, Empty, Fail, Head, labelStyle, useLoad } from "./ui";

type LDraft = { orig?: string; name: string; color: string; description: string };
const HEX = /^[0-9a-f]{6}$/i;
const rand = () => [...Array(3)].map(() => Math.floor(100 + Math.random() * 120).toString(16)).join("");

function LabelForm({ d, onChange, onSave, onCancel }: { d: LDraft; onChange: (d: LDraft) => void; onSave: () => void; onCancel: () => void }) {
  const ok = d.name.trim() !== "" && HEX.test(d.color);
  return (
    <div className="gh-card gh-inset">
      <label className="gh-f"><span>{i18next.t("名前")}</span>
        <input className="field" value={d.name} autoFocus maxLength={50} onChange={(e) => onChange({ ...d, name: e.target.value })} /></label>
      <label className="gh-f"><span>{i18next.t("色(16 進 6 桁)")}</span>
        <div className="gh-bar">
          <input className="field gh-grow" value={d.color} spellCheck={false} maxLength={6} aria-invalid={!HEX.test(d.color)} onChange={(e) => onChange({ ...d, color: e.target.value.replace(/^#/, "") })} />
          <span className="gh-label gh-sample" style={labelStyle(d.color)}>{d.name || "label"}</span>
          <button className="btn" onClick={() => onChange({ ...d, color: rand() })}>{i18next.t("ランダム")}</button>
        </div></label>
      <label className="gh-f"><span>{i18next.t("説明")}</span>
        <input className="field" value={d.description} maxLength={100} onChange={(e) => onChange({ ...d, description: e.target.value })} /></label>
      <div className="gh-actions">
        <button className="btn" onClick={onCancel}>{i18next.t("キャンセル")}</button>
        <button className="btn" data-primary="true" disabled={!ok} onClick={onSave}>{d.orig ? i18next.t("更新") : i18next.t("作成")}</button>
      </div>
    </div>
  );
}

type MDraft = { n?: number; title: string; description: string; due: string };
function MilestoneForm({ d, onChange, onSave, onCancel }: { d: MDraft; onChange: (d: MDraft) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="gh-card gh-inset">
      <label className="gh-f"><span>{i18next.t("タイトル")}</span>
        <input className="field" value={d.title} autoFocus onChange={(e) => onChange({ ...d, title: e.target.value })} /></label>
      <label className="gh-f"><span>{i18next.t("期日(任意)")}</span>
        <input className="field" type="date" value={d.due} onChange={(e) => onChange({ ...d, due: e.target.value })} /></label>
      <label className="gh-f"><span>{i18next.t("説明")}</span>
        <input className="field" value={d.description} onChange={(e) => onChange({ ...d, description: e.target.value })} /></label>
      <div className="gh-actions">
        <button className="btn" onClick={onCancel}>{i18next.t("キャンセル")}</button>
        <button className="btn" data-primary="true" disabled={!d.title.trim()} onClick={onSave}>{d.n ? i18next.t("更新") : i18next.t("作成")}</button>
      </div>
    </div>
  );
}

const dueIso = (d: string) => (d ? `${d}T00:00:00Z` : undefined);

export default function Labels({ s, repo }: Ctx) {
  const labels = useLoad(() => gh.labels(s), [s.owner, s.repo]);
  const ms = useLoad(() => gh.milestones(s), [s.owner, s.repo]);
  const [ld, setLd] = useState<LDraft | null>(null);
  const [md, setMd] = useState<MDraft | null>(null);
  const canWrite = !!(repo.permissions?.push || repo.permissions?.admin);

  const saveLabel = async () => {
    if (!ld) return;
    const ok = await act(() => ld.orig
      ? gh.updateLabel(s, ld.orig, { new_name: ld.name.trim(), color: ld.color, description: ld.description })
      : gh.createLabel(s, { name: ld.name.trim(), color: ld.color, description: ld.description || undefined }), i18next.t("保存しました"));
    if (ok) { setLd(null); void labels.reload(); }
  };
  const delLabel = async (l: Label) => {
    if (!(await ask({ message: i18next.t("ラベル「{{name}}」を削除します。付いている Issue からも外れます。", { name: l.name }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteLabel(s, l.name), i18next.t("削除しました"))) void labels.reload();
  };
  const saveMs = async () => {
    if (!md) return;
    const body = { title: md.title.trim(), description: md.description, due_on: dueIso(md.due) };
    const ok = await act(() => md.n ? gh.updateMilestone(s, md.n, { ...body, due_on: dueIso(md.due) ?? null }) : gh.createMilestone(s, body), i18next.t("保存しました"));
    if (ok) { setMd(null); void ms.reload(); }
  };
  const toggleMs = async (m: Milestone) => { if (await act(() => gh.updateMilestone(s, m.number, { state: m.state === "open" ? "closed" : "open" }))) void ms.reload(); };
  const delMs = async (m: Milestone) => {
    if (!(await ask({ message: i18next.t("マイルストーン「{{name}}」を削除します。Issue は残ります。", { name: m.title }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteMilestone(s, m.number), i18next.t("削除しました"))) void ms.reload();
  };

  return (
    <div className="gh-page">
      <Head title={i18next.t("ラベルとマイルストーン")}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void labels.reload(); void ms.reload(); }}><RefreshCw size={14} /></button>
      </Head>

      <section className="gh-card">
        <div className="gh-head"><div className="gh-head-t"><h4><TagIcon size={14} />{i18next.t("ラベル")}</h4></div>
          {canWrite && <div className="gh-head-a"><button className="btn" onClick={() => setLd({ name: "", color: rand(), description: "" })}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div>}
        </div>
        {ld && <LabelForm d={ld} onChange={setLd} onSave={() => void saveLabel()} onCancel={() => setLd(null)} />}
        {labels.busy && !labels.data ? <Busy /> : labels.err ? <Fail msg={labels.err} retry={() => void labels.reload()} /> : (labels.data ?? []).length === 0 ? <Empty text={i18next.t("ラベルがありません")} /> : (
          <ul className="gh-list">{labels.data!.map((l) => (
            <li key={l.id} className="gh-item gh-item-static">
              <span className="gh-label" style={labelStyle(l.color)}>{l.name}</span>
              <span className="gh-item-t"><small>{l.description ?? ""}</small></span>
              {canWrite && <span className="gh-item-r">
                <button className="icon-btn" aria-label={i18next.t("編集")} title={i18next.t("編集")} onClick={() => setLd({ orig: l.name, name: l.name, color: l.color, description: l.description ?? "" })}><Pencil size={14} /></button>
                <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void delLabel(l)}><Trash2 size={14} /></button>
              </span>}
            </li>
          ))}</ul>
        )}
      </section>

      <section className="gh-card">
        <div className="gh-head"><div className="gh-head-t"><h4><Target size={14} />{i18next.t("マイルストーン")}</h4></div>
          {canWrite && <div className="gh-head-a"><button className="btn" onClick={() => setMd({ title: "", description: "", due: "" })}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div>}
        </div>
        {md && <MilestoneForm d={md} onChange={setMd} onSave={() => void saveMs()} onCancel={() => setMd(null)} />}
        {ms.busy && !ms.data ? <Busy /> : ms.err ? <Fail msg={ms.err} retry={() => void ms.reload()} /> : (ms.data ?? []).length === 0 ? <Empty text={i18next.t("マイルストーンがありません")} /> : (
          <ul className="gh-list">{ms.data!.map((m) => {
            const total = m.open_issues + m.closed_issues;
            return (
              <li key={m.number} className="gh-item gh-item-static">
                <span className="gh-item-t"><b>{m.title}</b>
                  <small>{[m.state === "closed" ? i18next.t("完了") : i18next.t("進行中"), total ? `${m.closed_issues}/${total}` : "", m.due_on ? i18next.t("期日 {{when}}", { when: m.due_on.slice(0, 10) }) : ""].filter(Boolean).join(" · ")}</small></span>
                {canWrite && <span className="gh-item-r">
                  <button className="icon-btn" aria-label={m.state === "open" ? i18next.t("完了にする") : i18next.t("再び開く")} title={m.state === "open" ? i18next.t("完了にする") : i18next.t("再び開く")} onClick={() => void toggleMs(m)}>{m.state === "open" ? <Check size={14} /> : <X size={14} />}</button>
                  <button className="icon-btn" aria-label={i18next.t("編集")} title={i18next.t("編集")} onClick={() => setMd({ n: m.number, title: m.title, description: m.description ?? "", due: m.due_on?.slice(0, 10) ?? "" })}><Pencil size={14} /></button>
                  <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void delMs(m)}><Trash2 size={14} /></button>
                </span>}
              </li>
            );
          })}</ul>
        )}
      </section>
    </div>
  );
}
