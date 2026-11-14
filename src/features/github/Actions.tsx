import { useEffect, useState } from "react";
import i18next from "i18next";
import { parse } from "yaml";
import { ChevronRight, ExternalLink, Play, RefreshCw, RotateCcw, Square, Trash2 } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { openExternal } from "@/features/account/auth";
import { gh, relTime, type Run, type Slug, type Workflow } from "./api";
import type { Ctx } from "./GithubView";
import { act, Busy, Dot, Empty, Fail, Head, Pill, Row, runTone, Switch, useLoad } from "./ui";

type Input = { name: string; description?: string; required?: boolean; default?: string; type?: string; options?: string[] };

// ワークフローの YAML から、手動実行の入力欄を取り出す
async function inputsOf(s: Slug, w: Workflow, ref: string): Promise<{ inputs: Input[]; dispatchable: boolean }> {
  try {
    const doc = parse((await gh.file(s, w.path, ref)).text) as { on?: unknown; true?: unknown } | null;
    const on = (doc?.on ?? doc?.true) as unknown;
    const wd = on && typeof on === "object" && !Array.isArray(on) ? (on as Record<string, unknown>).workflow_dispatch : undefined;
    const dispatchable = Array.isArray(on) ? on.includes("workflow_dispatch") : on === "workflow_dispatch" || (!!on && typeof on === "object" && "workflow_dispatch" in (on as object));
    const raw = (wd && typeof wd === "object" ? (wd as { inputs?: Record<string, Record<string, unknown>> }).inputs : undefined) ?? {};
    return { dispatchable, inputs: Object.entries(raw).map(([name, v]) => ({ name, description: v.description as string | undefined, required: !!v.required, default: v.default === undefined ? undefined : String(v.default), type: v.type as string | undefined, options: v.options as string[] | undefined })) };
  } catch { return { inputs: [], dispatchable: true }; }
}

function Dispatch({ ctx, ws, onDone, onCancel }: { ctx: Ctx; ws: Workflow[]; onDone: () => void; onCancel: () => void }) {
  const { s, repo } = ctx;
  const [wid, setWid] = useState(String(ws[0]?.id ?? ""));
  const [ref, setRef] = useState(repo.default_branch);
  const [vals, setVals] = useState<Record<string, string>>({});
  const w = ws.find((x) => String(x.id) === wid);
  const br = useLoad(() => gh.branches(s), [s.owner, s.repo]);
  const meta = useLoad(() => (w ? inputsOf(s, w, ref) : Promise.resolve({ inputs: [], dispatchable: true })), [wid, ref]);
  const inputs = meta.data?.inputs ?? [];
  const val = (i: Input) => vals[i.name] ?? i.default ?? (i.type === "boolean" ? "false" : "");
  const missing = inputs.some((i) => i.required && !val(i));
  const go = async () => {
    const body: Record<string, string> = {};
    inputs.forEach((i) => { const v = val(i); if (v !== "") body[i.name] = v; });
    if (await act(() => gh.dispatch(s, wid, ref, body), i18next.t("実行を始めました"))) onDone();
  };
  return (
    <section className="gh-card">
      <h4>{i18next.t("手動で実行")}</h4>
      <div className="gh-f gh-f-inline">
        <span>{i18next.t("ワークフロー")}</span>
        <Select value={wid} label={i18next.t("ワークフロー")} onChange={(v) => { setWid(v); setVals({}); }} options={ws.map((x) => ({ value: String(x.id), label: x.name }))} />
        <span>{i18next.t("ブランチ")}</span>
        <Select value={ref} label={i18next.t("ブランチ")} onChange={setRef} options={(br.data ?? [{ name: repo.default_branch }]).map((b) => ({ value: b.name, label: b.name }))} />
      </div>
      {meta.busy && !meta.data ? <Busy /> : meta.data && !meta.data.dispatchable ? (
        <p className="gh-warn">{i18next.t("このワークフローには workflow_dispatch がないため、手動では実行できません。")}</p>
      ) : inputs.map((i) => (
        <div key={i.name} className="gh-f">
          <span>{i.name}{i.required ? " *" : ""}</span>
          {i.type === "boolean" ? <Switch on={val(i) === "true"} label={i.name} onChange={(v) => setVals({ ...vals, [i.name]: String(v) })} />
            : i.type === "choice" && i.options ? <Select value={val(i)} label={i.name} onChange={(v) => setVals({ ...vals, [i.name]: v })} options={i.options.map((o) => ({ value: o, label: o }))} />
            : <input className="field" value={val(i)} aria-label={i.name} onChange={(e) => setVals({ ...vals, [i.name]: e.target.value })} />}
          {i.description && <small>{i.description}</small>}
        </div>
      ))}
      <div className="gh-actions">
        <button className="btn" onClick={onCancel}>{i18next.t("やめる")}</button>
        <button className="btn" data-primary="true" disabled={!w || missing || (meta.data ? !meta.data.dispatchable : false)} onClick={() => void go()}><Play size={14} /><span>{i18next.t("実行する")}</span></button>
      </div>
    </section>
  );
}

function RunRow({ ctx, r, onChange }: { ctx: Ctx; r: Run; onChange: () => void }) {
  const { s } = ctx;
  const [open, setOpen] = useState(false);
  const jobs = useLoad(() => (open ? gh.jobs(s, r.id) : Promise.resolve(null)), [open, r.status, r.conclusion]);
  const t = runTone(r.status, r.conclusion);
  const live = r.status !== "completed";
  const cancel = async () => { if (await act(() => gh.cancelRun(s, r.id), i18next.t("取り消しを依頼しました"))) onChange(); };
  const rerun = async (failed: boolean) => { if (await act(() => gh.rerun(s, r.id, failed), i18next.t("再実行を始めました"))) onChange(); };
  const del = async () => {
    if (!(await ask({ message: i18next.t("この実行の記録を削除します。"), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteRun(s, r.id), i18next.t("削除しました"))) onChange();
  };
  return (
    <li className="gh-run">
      <div className="gh-item gh-item-static">
        <button className="gh-chev" aria-expanded={open} aria-label={i18next.t("ジョブを開く")} onClick={() => setOpen(!open)}><ChevronRight size={14} data-open={open} /></button>
        <Dot tone={t.tone} />
        <span className="gh-item-t"><b>{r.display_title}</b><small>{r.name} #{r.run_number} · {r.event} · {r.head_branch} · {r.head_sha.slice(0, 7)} · {relTime(r.created_at)}</small></span>
        <span className="gh-item-r">
          <Pill tone={t.tone}>{t.label}</Pill>
          {live && <button className="icon-btn" aria-label={i18next.t("取り消す")} title={i18next.t("取り消す")} onClick={() => void cancel()}><Square size={13} /></button>}
          {!live && r.conclusion !== "success" && r.conclusion !== "cancelled" && <button className="icon-btn" aria-label={i18next.t("失敗したジョブだけ再実行")} title={i18next.t("失敗したジョブだけ再実行")} onClick={() => void rerun(true)}><RotateCcw size={14} /></button>}
          {!live && <button className="icon-btn" aria-label={i18next.t("すべて再実行")} title={i18next.t("すべて再実行")} onClick={() => void rerun(false)}><RefreshCw size={14} /></button>}
          <button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(r.html_url)}><ExternalLink size={14} /></button>
          {!live && <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del()}><Trash2 size={14} /></button>}
        </span>
      </div>
      {open && (
        <div className="gh-jobs">
          {jobs.busy && !jobs.data ? <Busy /> : jobs.err ? <Fail msg={jobs.err} retry={() => void jobs.reload()} /> : (jobs.data ?? []).map((j) => {
            const jt = runTone(j.status, j.conclusion);
            return (
              <div key={j.id} className="gh-job">
                <button className="gh-line" onClick={() => void openExternal(j.html_url)}><Dot tone={jt.tone} /><b>{j.name}</b><small>{jt.label}</small></button>
                {(j.steps ?? []).map((st) => { const x = runTone(st.status, st.conclusion); return <div key={st.number} className="gh-step"><Dot tone={x.tone} /><span>{st.name}</span></div>; })}
              </div>
            );
          })}
        </div>
      )}
    </li>
  );
}

export default function Actions(ctx: Ctx) {
  const { s } = ctx;
  const [wf, setWf] = useState("");
  const [st, setSt] = useState("");
  const [run, setRun] = useState(false);
  const ws = useLoad(() => gh.workflows(s), [s.owner, s.repo]);
  const runs = useLoad(() => gh.runs(s, st ? { status: st } : {}, wf || undefined), [wf, st, s.owner, s.repo]);
  const live = (runs.data ?? []).some((r) => r.status !== "completed");
  // 進行中の実行があるあいだは、5 秒ごとに取り直す
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void runs.reload(), 5000);
    return () => clearInterval(t);
  }, [live, runs]);
  const shown = runs.data ?? [];
  const wl = ws.data ?? [];

  return (
    <div className="gh-page">
      <Head title={i18next.t("Actions の実行")} sub={live ? i18next.t("実行中があります。自動で更新します") : undefined}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void runs.reload(); void ws.reload(); }}><RefreshCw size={14} /></button>
        <button className="btn" data-primary="true" disabled={!wl.length} onClick={() => setRun(true)}><Play size={14} /><span>{i18next.t("手動で実行")}</span></button>
      </Head>
      {run && <Dispatch ctx={ctx} ws={wl} onCancel={() => setRun(false)} onDone={() => { setRun(false); setTimeout(() => void runs.reload(), 1500); }} />}
      <div className="gh-bar">
        <Select value={wf} label={i18next.t("ワークフローで絞る")} onChange={setWf} options={[{ value: "", label: i18next.t("すべてのワークフロー") }, ...wl.map((w) => ({ value: String(w.id), label: w.name }))]} />
        <Select value={st} label={i18next.t("状態で絞る")} onChange={setSt} options={[
          { value: "", label: i18next.t("すべての状態") }, { value: "in_progress", label: i18next.t("実行中") }, { value: "queued", label: i18next.t("待機中") },
          { value: "success", label: i18next.t("成功") }, { value: "failure", label: i18next.t("失敗") }, { value: "cancelled", label: i18next.t("取り消し") },
        ]} />
      </div>
      {wl.length > 0 && !wf && (
        <details className="gh-wfs">
          <summary>{i18next.t("ワークフロー({{n}})", { n: wl.length })}</summary>
          {wl.map((w) => (
            <Row key={w.id} title={w.name} hint={w.path}>
              <Switch on={w.state === "active"} label={w.name} onChange={(v) => void act(() => gh.setWorkflowState(s, w.id, v), v ? i18next.t("有効にしました") : i18next.t("無効にしました")).then(() => ws.reload())} />
            </Row>
          ))}
        </details>
      )}
      {runs.busy && !runs.data ? <Busy /> : runs.err ? <Fail msg={runs.err} retry={() => void runs.reload()} /> : shown.length === 0 ? <Empty icon={<Play size={20} />} text={i18next.t("実行の記録がありません")} /> : (
        <ul className="gh-list">{shown.map((r) => <RunRow key={r.id} ctx={ctx} r={r} onChange={() => void runs.reload()} />)}</ul>
      )}
    </div>
  );
}
