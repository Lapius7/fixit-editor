import { useEffect, useMemo, useRef, useState } from "react";
import i18next from "i18next";
import { ArrowDown, ArrowUp, ExternalLink, FilePlus2, GitBranch, Play, Plus, RefreshCw, Save, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { notify } from "@/shared/notify";
import { openExternal } from "@/features/account/auth";
import { RemoteDir, type RemoteFile } from "@/platform/remote";
import { gh, relTime } from "../api";
import type { Ctx } from "../GithubView";
import { act, Area, Busy, Dot, Empty, Fail, Head, Pill, runTone, Switch, useLoad, type Tone } from "../ui";
import * as M from "./model";

const DIR = [".github", "workflows"];
const isWf = (n: string) => /\.ya?ml$/i.test(n);
const TRIGGERS = ["push", "pull_request", "workflow_dispatch", "schedule", "release", "issues", "workflow_run"] as const;
const RUNNERS = ["ubuntu-latest", "ubuntu-24.04", "windows-latest", "macos-latest"];

type Files = { dir: RemoteDir | null; names: string[] };

async function listFiles(root: RemoteDir): Promise<Files> {
  try {
    let d = root;
    for (const p of DIR) d = await d.getDirectoryHandle(p);
    const names: string[] = [];
    for await (const [n, h] of d.entries()) if (h.kind === "file" && isWf(n)) names.push(n);
    return { dir: d, names: names.sort() };
  } catch { return { dir: null, names: [] }; }
}

// 図の中のジョブの状態。最新の実行のジョブ名と、図のジョブ(名前か id)を突き合わせる
function statusOf(j: M.JobNode, live: { name: string; status: string; conclusion: string | null }[]) {
  const label = j.name || j.id;
  return live.find((x) => x.name === label || x.name.startsWith(`${label} (`));
}

function Graph({ jobs, sel, onSel, live }: { jobs: M.JobNode[]; sel: string | null; onSel: (id: string) => void; live: { name: string; status: string; conclusion: string | null }[] }) {
  const { pos, w, h } = useMemo(() => M.layout(jobs), [jobs]);
  const edges = jobs.flatMap((j) => j.needs.filter((d) => pos.has(d)).map((d) => ({ from: d, to: j.id })));
  return (
    <div className="wf-canvas overscroll-contain">
      <div className="wf-stage" style={{ width: w, height: h }}>
        <svg width={w} height={h} aria-hidden="true">
          {edges.map((e) => {
            const a = pos.get(e.from)!, b = pos.get(e.to)!;
            const x1 = a.x + M.NODE_W, y1 = a.y + M.NODE_H / 2, x2 = b.x, y2 = b.y + M.NODE_H / 2, mx = (x1 + x2) / 2;
            return <path key={`${e.from}>${e.to}`} className="wf-edge" data-hot={sel === e.from || sel === e.to || undefined} d={`M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`} />;
          })}
        </svg>
        {jobs.map((j) => {
          const p = pos.get(j.id)!;
          const st = statusOf(j, live);
          const t = st ? runTone(st.status, st.conclusion) : null;
          return (
            <button key={j.id} className="wf-node" data-sel={sel === j.id || undefined} style={{ left: p.x, top: p.y, width: M.NODE_W, height: M.NODE_H }} onClick={() => onSel(j.id)}>
              <span className="wf-node-t">{t && <Dot tone={t.tone} />}<b>{j.name || j.id}</b></span>
              <small>{j.runsOn || "-"} · {i18next.t("{{n}} ステップ", { n: j.steps })}</small>
              {t && <small className="wf-node-s" data-tone={t.tone}>{t.label}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JobPanel({ id, text, jobs, apply, onRename, onGone }: { id: string; text: string; jobs: M.JobNode[]; apply: (fn: (d: Parameters<typeof M.edit>[1] extends (d: infer D) => void ? D : never) => void) => void; onRename: (n: string) => void; onGone: () => void }) {
  const j = jobs.find((x) => x.id === id);
  const st = useMemo(() => M.steps(text, id), [text, id]);
  const [nid, setNid] = useState(id);
  useEffect(() => setNid(id), [id]);
  if (!j) return null;
  const others = jobs.filter((x) => x.id !== id);
  const idOk = /^[A-Za-z_][A-Za-z0-9_-]*$/.test(nid) && (nid === id || !jobs.some((x) => x.id === nid));
  const rename = () => { if (nid !== id && idOk) { apply((d) => M.renameJob(d, id, nid, jobs)); onRename(nid); } else setNid(id); };
  const del = async () => {
    if (!(await ask({ message: i18next.t("ジョブ「{{id}}」を削除します。ほかのジョブの needs からも外します。", { id }), ok: i18next.t("削除する"), danger: true }))) return;
    apply((d) => M.removeJob(d, id, jobs));
    onGone();
  };
  return (
    <div className="wf-panel">
      <div className="gh-f"><span>{i18next.t("ジョブ ID")}</span>
        <input className="field" value={nid} aria-invalid={!idOk} aria-label={i18next.t("ジョブ ID")} onChange={(e) => setNid(e.target.value)} onBlur={rename} onKeyDown={(e) => { if (e.key === "Enter") rename(); }} />
        {!idOk && <small className="gh-warn">{i18next.t("英数字・_・- だけで、ほかと重ならない名前にしてください")}</small>}
      </div>
      <label className="gh-f"><span>{i18next.t("表示名")}</span><input className="field" value={j.name} placeholder={id} onChange={(e) => apply((d) => M.setJobField(d, id, "name", e.target.value))} /></label>
      <div className="gh-f"><span>runs-on</span>
        <div className="gh-chips">
          <input className="field" list="wf-runners" value={j.runsOn} aria-label="runs-on" onChange={(e) => apply((d) => M.setJobField(d, id, "runs-on", e.target.value))} />
          <datalist id="wf-runners">{RUNNERS.map((r) => <option key={r} value={r} />)}</datalist>
        </div>
      </div>
      <label className="gh-f"><span>if</span><input className="field" value={j.cond} placeholder="github.ref == 'refs/heads/main'" onChange={(e) => apply((d) => M.setJobField(d, id, "if", e.target.value))} /></label>
      <div className="gh-f"><span>needs</span>
        {others.length === 0 ? <small className="gh-none">{i18next.t("ほかのジョブがありません")}</small> : (
          <div className="gh-chips">
            {others.map((o) => {
              const on = j.needs.includes(o.id);
              const loop = !on && M.reaches(jobs, id, o.id); // o が(間接的に)id に依存しているなら、足すと輪になる
              return <label key={o.id} className="gh-chip gh-check" data-off={loop || undefined} title={loop ? i18next.t("輪になるため足せません") : undefined}>
                <input type="checkbox" checked={on} disabled={loop} onChange={(e) => apply((d) => (e.target.checked ? M.addNeed(d, id, o.id) : M.dropNeed(d, id, o.id)))} /><span>{o.id}</span>
              </label>;
            })}
          </div>
        )}
      </div>
      <div className="wf-steps-h"><b>{i18next.t("ステップ")}</b><button className="btn" onClick={() => apply((d) => M.addStep(d, id))}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div>
      <ol className="wf-steps">
        {st.map((s) => (
          <li key={s.i} className="wf-step">
            <div className="wf-step-h">
              <input className="field" value={s.name} placeholder={i18next.t("ステップ名")} aria-label={i18next.t("ステップ名")} onChange={(e) => apply((d) => M.setStep(d, id, s.i, "name", e.target.value))} />
              <button className="icon-btn" aria-label={i18next.t("上へ")} title={i18next.t("上へ")} disabled={s.i === 0} onClick={() => apply((d) => M.moveStep(d, id, s.i, -1))}><ArrowUp size={14} /></button>
              <button className="icon-btn" aria-label={i18next.t("下へ")} title={i18next.t("下へ")} disabled={s.i === st.length - 1} onClick={() => apply((d) => M.moveStep(d, id, s.i, 1))}><ArrowDown size={14} /></button>
              <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => apply((d) => M.delStep(d, id, s.i))}><Trash2 size={14} /></button>
            </div>
            <div className="wf-step-b">
              <div className="seg" role="group" aria-label={i18next.t("種類")}>
                <button aria-pressed={!!s.uses || !s.run} onClick={() => !s.uses && apply((d) => M.stepKind(d, id, s.i, "uses"))}>uses</button>
                <button aria-pressed={!!s.run && !s.uses} onClick={() => !s.run && apply((d) => M.stepKind(d, id, s.i, "run"))}>run</button>
              </div>
              {s.uses || !s.run
                ? <input className="field gh-grow" value={s.uses} placeholder="actions/checkout@v4" aria-label="uses" onChange={(e) => apply((d) => M.setStep(d, id, s.i, "uses", e.target.value))} />
                : <Area value={s.run} rows={Math.min(8, Math.max(2, s.run.split("\n").length))} label="run" onChange={(v) => apply((d) => M.setStep(d, id, s.i, "run", v))} />}
            </div>
            {s.withN > 0 && <small className="gh-none">{i18next.t("with が {{n}} 件あります。YAML で編集できます", { n: s.withN })}</small>}
          </li>
        ))}
      </ol>
      <div className="gh-actions"><button className="btn" data-danger="true" onClick={() => void del()}><Trash2 size={14} /><span>{i18next.t("ジョブを削除")}</span></button></div>
    </div>
  );
}

function TriggerPanel({ model, apply }: { model: M.Model; apply: (fn: (d: Parameters<typeof M.edit>[1] extends (d: infer D) => void ? D : never) => void) => void }) {
  const t = model.triggers;
  const list = (k: string) => { const b = (t[k] as { branches?: string[] | string } | null)?.branches; return Array.isArray(b) ? b.join(", ") : b ?? ""; };
  const cron = ((t.schedule as { cron?: string }[] | undefined)?.[0]?.cron) ?? "";
  return (
    <div className="wf-panel">
      <p className="gh-none">{i18next.t("このワークフローが動くきっかけです。")}</p>
      {TRIGGERS.map((k) => (
        <div key={k} className="gh-f">
          <div className="gh-row-line"><b>{k}</b><Switch on={k in t} label={k} onChange={(v) => apply((d) => M.setTrigger(d, k, v))} /></div>
          {(k === "push" || k === "pull_request") && k in t && (
            <input className="field" defaultValue={list(k)} key={list(k)} placeholder={i18next.t("ブランチ(カンマ区切り。空なら全部)")} aria-label={`${k} branches`}
              onBlur={(e) => apply((d) => M.setBranches(d, k, e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))} />
          )}
          {k === "schedule" && k in t && (
            <input className="field" defaultValue={cron} key={cron} placeholder="0 0 * * *" aria-label="cron" onBlur={(e) => e.target.value.trim() && apply((d) => M.setCron(d, e.target.value.trim()))} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function WorkflowEditor(ctx: Ctx) {
  const { s, repo, conn, root } = ctx;
  const dirRoot = useMemo(() => new RemoteDir(conn, root), [conn, root]);
  const files = useLoad(() => listFiles(dirRoot), [dirRoot]);
  const ws = useLoad(() => gh.workflows(s), [s.owner, s.repo]);
  const [cur, setCur] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [sel, setSel] = useState<string | null>(null); // ジョブ ID。null はトリガー
  const [pane, setPane] = useState<"detail" | "yaml">("detail");
  const [busy, setBusy] = useState(false);
  const dirty = cur !== null && text !== saved;
  const model = useMemo(() => M.read(text), [text]);
  const wf = cur ? ws.data?.find((w) => w.path === `.github/workflows/${cur}`) : undefined;

  // 最新の実行のジョブを、図に重ねる
  const live = useLoad(async () => {
    if (!wf) return [];
    const r = (await gh.runs(s, {}, String(wf.id)))[0];
    return r ? { run: r, jobs: await gh.jobs(s, r.id) } : [];
  }, [wf?.id]);
  const lastRun = live.data && !Array.isArray(live.data) ? live.data.run : null;
  const liveJobs = live.data && !Array.isArray(live.data) ? live.data.jobs : [];
  useEffect(() => {
    if (!lastRun || lastRun.status === "completed") return;
    const t = setInterval(() => void live.reload(), 5000);
    return () => clearInterval(t);
  }, [lastRun?.id, lastRun?.status, live]);

  // 保存前のウィンドウ閉じ・ファイル切り替えで、書きかけを失わせない
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    addEventListener("beforeunload", on);
    return () => removeEventListener("beforeunload", on);
  }, []);

  const guard = async () => !dirty || (await ask({ message: i18next.t("保存していない変更があります。破棄しますか?"), ok: i18next.t("破棄する"), danger: true }));
  const open = async (name: string) => {
    if (name === cur || !(await guard())) return;
    setBusy(true);
    try {
      const h = await files.data!.dir!.getFileHandle(name);
      const t = await h.getFile().then((f) => f.text());
      setCur(name); setText(t); setSaved(t); setSel(null);
    } catch (e) { notify(String((e as Error).message ?? e), "error"); } finally { setBusy(false); }
  };
  const write = async (name: string, body: string) => {
    let d = dirRoot;
    for (const p of DIR) d = await d.getDirectoryHandle(p, { create: true });
    const h = (await d.getFileHandle(name, { create: true })) as RemoteFile;
    const w = await h.createWritable();
    await w.write(body);
    await w.close();
  };
  const save = async () => {
    if (!cur || model.err) return;
    setBusy(true);
    try { await write(cur, text); setSaved(text); notify(i18next.t("保存しました"), "success"); void ws.reload(); }
    catch (e) { notify(String((e as Error).message ?? e), "error"); } finally { setBusy(false); }
  };
  const create = async () => {
    if (!(await guard())) return;
    const base = "ci";
    const have = new Set(files.data?.names ?? []);
    let name = `${base}.yml`;
    for (let i = 2; have.has(name); i++) name = `${base}-${i}.yml`;
    setBusy(true);
    try { await write(name, M.NEW_WORKFLOW); await files.reload(); setCur(name); setText(M.NEW_WORKFLOW); setSaved(M.NEW_WORKFLOW); setSel(null); }
    catch (e) { notify(String((e as Error).message ?? e), "error"); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!cur || !files.data?.dir) return;
    if (!(await ask({ message: i18next.t("ワークフロー「{{name}}」のファイルを削除します。", { name: cur }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => files.data!.dir!.removeEntry(cur), i18next.t("削除しました"))) { setCur(null); setText(""); setSaved(""); void files.reload(); }
  };
  const apply = (fn: Parameters<typeof M.edit>[1]) => setText((t) => M.edit(t, fn));
  const trigger = async () => {
    if (!wf) return;
    if (await act(() => gh.dispatch(s, wf.id, repo.default_branch, {}), i18next.t("実行を始めました"))) setTimeout(() => void live.reload(), 1500);
  };
  const addJob = () => {
    let n = "job"; const have = new Set(model.jobs.map((j) => j.id));
    for (let i = 2; have.has(n); i++) n = `job${i}`;
    apply((d) => M.addJob(d, n));
    setSel(n); setPane("detail");
  };

  if (files.busy && !files.data) return <Busy />;
  if (files.err) return <Fail msg={files.err} retry={() => void files.reload()} />;
  const names = files.data?.names ?? [];
  const lt = lastRun ? runTone(lastRun.status, lastRun.conclusion) : null;

  return (
    <div className="gh-page wf">
      <Head title={i18next.t("ワークフロー")} sub={i18next.t("{{n}} 件", { n: names.length })}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void files.reload(); void ws.reload(); void live.reload(); }}><RefreshCw size={14} /></button>
        <button className="btn" onClick={() => void create()}><FilePlus2 size={14} /><span>{i18next.t("新規")}</span></button>
      </Head>
      <div className="wf-body">
        <ul className="wf-files overscroll-contain">
          {names.length === 0 && <li className="gh-none">{i18next.t(".github/workflows にファイルがありません")}</li>}
          {names.map((n) => <li key={n}><button className="wf-file" data-sel={n === cur || undefined} onClick={() => void open(n)}><GitBranch size={13} /><span>{n}</span>{n === cur && dirty && <i className="wf-dirty" aria-label={i18next.t("未保存")} />}</button></li>)}
        </ul>
        {cur === null ? <Empty icon={<GitBranch size={20} />} text={names.length ? i18next.t("ワークフローを選んでください") : i18next.t("「新規」で最初のワークフローを作れます")} /> : (
          <div className="wf-main">
            <div className="wf-bar">
              <b>{model.name || cur}</b>
              {lt && lastRun && <button className="gh-plain" onClick={() => void openExternal(lastRun.html_url)} title={i18next.t("GitHub で開く")}><Pill tone={lt.tone as Tone}>{lt.label}</Pill><small>#{lastRun.run_number} · {relTime(lastRun.created_at)}</small></button>}
              <span className="gh-grow" />
              <button className="icon-btn" aria-label={i18next.t("元に戻す")} title={i18next.t("元に戻す")} disabled={!dirty} onClick={() => setText(saved)}><Undo2 size={14} /></button>
              <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void remove()}><Trash2 size={14} /></button>
              {wf && <button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(wf.html_url)}><ExternalLink size={14} /></button>}
              <button className="btn" disabled={!wf || !model.dispatch || dirty} title={!wf ? i18next.t("まだ GitHub にありません。コミットして push すると実行できます") : !model.dispatch ? i18next.t("workflow_dispatch がありません") : dirty ? i18next.t("先に保存してください") : undefined} onClick={() => void trigger()}><Play size={14} /><span>{i18next.t("実行")}</span></button>
              <button className="btn" data-primary="true" disabled={!dirty || busy || !!model.err} onClick={() => void save()}><Save size={14} /><span>{i18next.t("保存")}</span></button>
            </div>
            {model.err && <p className="gh-warn wf-err"><TriangleAlert size={14} />{model.err}</p>}
            <div className="wf-split">
              <section className="wf-left">
                <div className="wf-tools">
                  <button className="btn" onClick={() => { setSel(null); setPane("detail"); }} data-primary={sel === null || undefined}>{i18next.t("トリガー")}</button>
                  <button className="btn" onClick={addJob} disabled={!!model.err}><Plus size={14} /><span>{i18next.t("ジョブ")}</span></button>
                </div>
                {model.jobs.length === 0 ? <Empty text={i18next.t("ジョブがありません")} /> : <Graph jobs={model.jobs} sel={sel} onSel={(id) => { setSel(id); setPane("detail"); }} live={liveJobs} />}
                {dirty && <small className="gh-none">{i18next.t("図の色は、GitHub 上の最新の実行です。保存・push するまで、変更は実行に反映されません。")}</small>}
              </section>
              <section className="wf-right">
                <div className="seg" role="group" aria-label={i18next.t("表示")}>
                  <button aria-pressed={pane === "detail"} onClick={() => setPane("detail")}>{i18next.t("詳細")}</button>
                  <button aria-pressed={pane === "yaml"} onClick={() => setPane("yaml")}>YAML</button>
                </div>
                {pane === "yaml" ? <Area value={text} onChange={setText} rows={24} label="YAML" />
                  : model.err ? <p className="gh-none">{i18next.t("YAML のエラーを直すと、ここで編集できます。")}</p>
                  : sel && model.jobs.some((j) => j.id === sel) ? <JobPanel id={sel} text={text} jobs={model.jobs} apply={apply} onRename={setSel} onGone={() => setSel(null)} />
                  : <TriggerPanel model={model} apply={apply} />}
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
