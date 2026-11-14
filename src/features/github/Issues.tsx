import { useMemo, useState } from "react";
import i18next from "i18next";
import { ArrowLeft, CircleCheck, CircleDot, ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, Plus, RefreshCw, Search } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { openExternal } from "@/features/account/auth";
import { gh, relTime, type Issue, type Label, type Pull } from "./api";
import type { Ctx } from "./GithubView";
import { act, Area, Avatar, Busy, Empty, Fail, Head, labelStyle, Md, Pill, runTone, useLoad, type Tone } from "./ui";

type Kind = "issue" | "pull";
type St = "open" | "closed" | "all";

const labelName = (l: Label | string) => (typeof l === "string" ? l : l.name);

function StateIcon({ i, pull }: { i: Issue | Pull; pull: boolean }) {
  if (pull) {
    const p = i as Pull;
    if (p.merged_at || p.merged) return <GitMerge size={15} data-tone="info" />;
    return i.state === "open" ? <GitPullRequest size={15} data-tone="ok" /> : <GitPullRequestClosed size={15} data-tone="bad" />;
  }
  return i.state === "open" ? <CircleDot size={15} data-tone="ok" /> : <CircleCheck size={15} data-tone="info" />;
}

// 新しい Issue / プルリクエストを作る
function Create({ ctx, kind, labels, onDone, onCancel }: { ctx: Ctx; kind: Kind; labels: Label[]; onDone: (n: number) => void; onCancel: () => void }) {
  const { s, repo } = ctx;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [head, setHead] = useState("");
  const [base, setBase] = useState(repo.default_branch);
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const br = useLoad(() => (kind === "pull" ? gh.branches(s) : Promise.resolve([])), [kind]);
  const names = (br.data ?? []).map((b) => b.name);
  const h = head || names.find((n) => n !== base) || "";
  const go = async () => {
    setBusy(true);
    let num = 0;
    const ok = await act(async () => {
      if (kind === "issue") num = (await gh.createIssue(s, { title: title.trim(), body, labels: sel })).number;
      else num = (await gh.createPull(s, { title: title.trim(), body, head: h, base, draft })).number;
    }, kind === "issue" ? i18next.t("Issue を作りました") : i18next.t("プルリクエストを作りました"));
    setBusy(false);
    if (ok) onDone(num);
  };
  return (
    <div className="gh-page">
      <Head title={kind === "issue" ? i18next.t("新しい Issue") : i18next.t("新しいプルリクエスト")}><button className="btn" onClick={onCancel}><ArrowLeft size={14} /><span>{i18next.t("戻る")}</span></button></Head>
      <section className="gh-card">
        {kind === "pull" && (
          <div className="gh-f gh-f-inline">
            <span>{i18next.t("ブランチ")}</span>
            <Select value={h} label={i18next.t("取り込むブランチ")} onChange={setHead} options={names.map((n) => ({ value: n, label: n }))} />
            <span className="gh-arrow">→</span>
            <Select value={base} label={i18next.t("取り込み先")} onChange={setBase} options={names.map((n) => ({ value: n, label: n }))} />
          </div>
        )}
        <label className="gh-f"><span>{i18next.t("タイトル")}</span><input className="field" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="gh-f"><span>{i18next.t("本文(Markdown)")}</span><Area value={body} onChange={setBody} rows={8} label={i18next.t("本文")} /></label>
        {kind === "issue" && labels.length > 0 && (
          <div className="gh-f"><span>{i18next.t("ラベル")}</span>
            <div className="gh-chips">{labels.map((l) => (
              <button key={l.id} className="gh-label" data-on={sel.includes(l.name)} style={labelStyle(l.color)} onClick={() => setSel(sel.includes(l.name) ? sel.filter((x) => x !== l.name) : [...sel, l.name])}>{l.name}</button>
            ))}</div>
          </div>
        )}
        {kind === "pull" && <label className="gh-check"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /><span>{i18next.t("下書きとして作る")}</span></label>}
        <div className="gh-actions">
          <button className="btn" onClick={onCancel}>{i18next.t("やめる")}</button>
          <button className="btn" data-primary="true" disabled={!title.trim() || busy || (kind === "pull" && (!h || h === base))} onClick={() => void go()}>{i18next.t("作る")}</button>
        </div>
      </section>
    </div>
  );
}

// 1 件の詳細。コメント・ラベル・開閉、プルリクエストならチェックとマージ
function Detail({ ctx, kind, n, labels, onBack }: { ctx: Ctx; kind: Kind; n: number; labels: Label[]; onBack: () => void }) {
  const { s } = ctx;
  const pull = kind === "pull";
  const it = useLoad(() => (pull ? gh.pull(s, n) : gh.issue(s, n)), [n, kind]);
  const cm = useLoad(() => gh.comments(s, n), [n]);
  const files = useLoad(() => (pull ? gh.pullFiles(s, n) : Promise.resolve([])), [n, kind]);
  const sha = (it.data as Pull | null)?.head?.sha;
  const checks = useLoad(() => (pull && sha ? gh.checkRuns(s, sha) : Promise.resolve(null)), [sha]);
  const [text, setText] = useState("");
  const [method, setMethod] = useState<"merge" | "squash" | "rebase">("squash");
  const [editing, setEditing] = useState(false);
  const [et, setEt] = useState("");
  const [eb, setEb] = useState("");
  if (it.busy && !it.data) return <Busy />;
  if (it.err || !it.data) return <Fail msg={it.err} retry={() => void it.reload()} />;
  const i = it.data as Issue & Partial<Pull>;
  const merged = !!(i.merged || i.merged_at);
  const mine = (i.labels ?? []).map(labelName);

  const patch = async (b: Record<string, unknown>, ok?: string) => { if (await act(() => (pull ? gh.updatePull(s, n, b) : gh.updateIssue(s, n, b)), ok)) void it.reload(); };
  const comment = async () => { if (await act(() => gh.addComment(s, n, text.trim()))) { setText(""); void cm.reload(); void it.reload(); } };
  const toggleLabel = async (name: string) => {
    const next = mine.includes(name) ? mine.filter((x) => x !== name) : [...mine, name];
    await patch({ labels: next });
  };
  const merge = async () => {
    const lab = method === "merge" ? i18next.t("マージコミット") : method === "squash" ? i18next.t("スカッシュ") : i18next.t("リベース");
    if (!(await ask({ message: i18next.t("#{{n}} を {{base}} へマージします({{lab}})。続けますか?", { n, base: i.base?.ref ?? "", lab }), ok: i18next.t("マージする") }))) return;
    if (await act(async () => { const r = await gh.mergePull(s, n, method); if (!r.merged) throw new Error(r.message); }, i18next.t("マージしました"))) { void it.reload(); void cm.reload(); }
  };
  const startEdit = () => { setEt(i.title); setEb(i.body ?? ""); setEditing(true); };
  const saveEdit = async () => { if (await act(() => (pull ? gh.updatePull(s, n, { title: et, body: eb }) : gh.updateIssue(s, n, { title: et, body: eb })), i18next.t("保存しました"))) { setEditing(false); void it.reload(); } };

  const ck = checks.data?.check_runs ?? [];
  const ckTone: Tone = ck.some((c) => c.conclusion === "failure") ? "bad" : ck.some((c) => c.status !== "completed") ? "info" : ck.length ? "ok" : "mute";
  const stateTone: Tone = merged ? "info" : i.state === "open" ? "ok" : "bad";
  const stateLabel = merged ? i18next.t("マージ済み") : i.state === "open" ? i18next.t("開いている") : i18next.t("閉じている");
  const mergeable = pull && i.state === "open" && !merged && !i.draft;
  const blocked = i.mergeable === false || i.mergeable_state === "dirty";

  return (
    <div className="gh-page">
      <Head title={`#${n}`} sub={i.title}>
        <button className="btn" onClick={onBack}><ArrowLeft size={14} /><span>{i18next.t("一覧へ")}</span></button>
        <button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(i.html_url)}><ExternalLink size={14} /></button>
      </Head>
      <section className="gh-card">
        {editing ? (
          <>
            <input className="field" value={et} aria-label={i18next.t("タイトル")} onChange={(e) => setEt(e.target.value)} />
            <Area value={eb} onChange={setEb} rows={8} label={i18next.t("本文")} />
            <div className="gh-actions"><button className="btn" onClick={() => setEditing(false)}>{i18next.t("やめる")}</button><button className="btn" data-primary="true" disabled={!et.trim()} onClick={() => void saveEdit()}>{i18next.t("保存")}</button></div>
          </>
        ) : (
          <>
            <div className="gh-title"><StateIcon i={i} pull={pull} /><b>{i.title}</b><Pill tone={stateTone}>{stateLabel}</Pill>{i.draft && <Pill>{i18next.t("下書き")}</Pill>}</div>
            <div className="gh-meta"><Avatar u={i.user} size={16} /><span>{i.user?.login}</span><span>{relTime(i.created_at)}</span>
              {pull && i.head && <span className="gh-branch">{i.head.ref} → {i.base?.ref}</span>}
              {pull && <span className="gh-diffstat"><i data-tone="ok">+{i.additions}</i> <i data-tone="bad">−{i.deletions}</i> · {i18next.t("{{n}} ファイル", { n: i.changed_files ?? 0 })}</span>}
            </div>
            {i.body ? <Md text={i.body} /> : <p className="gh-none">{i18next.t("本文はありません")}</p>}
            <div className="gh-actions">
              <button className="btn" onClick={startEdit}>{i18next.t("タイトルと本文を編集")}</button>
              {!merged && <button className="btn" onClick={() => void patch({ state: i.state === "open" ? "closed" : "open" }, i.state === "open" ? i18next.t("閉じました") : i18next.t("開き直しました"))}>{i.state === "open" ? i18next.t("閉じる") : i18next.t("開き直す")}</button>}
            </div>
          </>
        )}
      </section>

      {!pull && (
        <section className="gh-card">
          <h4>{i18next.t("ラベル")}</h4>
          <div className="gh-chips">{labels.length ? labels.map((l) => (
            <button key={l.id} className="gh-label" data-on={mine.includes(l.name)} style={labelStyle(l.color)} onClick={() => void toggleLabel(l.name)}>{l.name}</button>
          )) : <span className="gh-none">{i18next.t("ラベルがありません")}</span>}</div>
        </section>
      )}

      {pull && (
        <section className="gh-card">
          <h4>{i18next.t("チェックとマージ")}</h4>
          <div className="gh-checks">
            <div className="gh-check-h"><Pill tone={ckTone}>{ck.length ? (ckTone === "ok" ? i18next.t("すべて成功") : ckTone === "bad" ? i18next.t("失敗あり") : i18next.t("実行中")) : i18next.t("チェックなし")}</Pill>
              <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void checks.reload(); void it.reload(); }}><RefreshCw size={13} /></button></div>
            {ck.map((c) => { const t = runTone(c.status, c.conclusion); return (
              <button key={c.name} className="gh-line" onClick={() => void openExternal(c.html_url)}><i className="gh-dot" data-tone={t.tone} /><span>{c.name}</span><small>{t.label}</small></button>
            ); })}
          </div>
          {blocked && <p className="gh-warn">{i18next.t("コンフリクトがあります。ブランチ側で解消してから、もう一度開いてください。")}</p>}
          {mergeable && (
            <div className="gh-actions gh-merge">
              <Select value={method} label={i18next.t("マージの方法")} onChange={(v) => setMethod(v as typeof method)} options={[
                ...(ctx.repo as unknown as { allow_squash_merge?: boolean }).allow_squash_merge === false ? [] : [{ value: "squash", label: i18next.t("スカッシュしてマージ") }],
                ...(ctx.repo as unknown as { allow_merge_commit?: boolean }).allow_merge_commit === false ? [] : [{ value: "merge", label: i18next.t("マージコミットを作る") }],
                ...(ctx.repo as unknown as { allow_rebase_merge?: boolean }).allow_rebase_merge === false ? [] : [{ value: "rebase", label: i18next.t("リベースしてマージ") }],
              ]} />
              <button className="btn" data-primary="true" disabled={blocked} onClick={() => void merge()}><GitMerge size={14} /><span>{i18next.t("マージする")}</span></button>
            </div>
          )}
          {i.draft && <p className="gh-none">{i18next.t("下書きのため、マージできません。GitHub で「レビューの準備完了」にしてください。")}</p>}
        </section>
      )}

      {pull && (files.data?.length ?? 0) > 0 && (
        <section className="gh-card">
          <h4>{i18next.t("変更したファイル")}</h4>
          <ul className="gh-files">{files.data!.map((f) => (
            <li key={f.filename}><span className="gh-fs" data-s={f.status}>{f.status[0].toUpperCase()}</span><span className="gh-fn">{f.filename}</span><small><i data-tone="ok">+{f.additions}</i> <i data-tone="bad">−{f.deletions}</i></small></li>
          ))}</ul>
        </section>
      )}

      <section className="gh-card">
        <h4><MessageSquare size={14} />{i18next.t("コメント")}<small>{cm.data?.length ?? 0}</small></h4>
        {cm.busy && !cm.data ? <Busy /> : cm.err ? <Fail msg={cm.err} retry={() => void cm.reload()} /> : (cm.data ?? []).map((c) => (
          <div key={c.id} className="gh-comment">
            <div className="gh-meta"><Avatar u={c.user} size={18} /><b>{c.user?.login}</b><span>{relTime(c.created_at)}</span></div>
            <Md text={c.body} />
          </div>
        ))}
        <Area value={text} onChange={setText} rows={4} label={i18next.t("コメント")} placeholder={i18next.t("コメントを書く(Markdown)")} />
        <div className="gh-actions"><button className="btn" data-primary="true" disabled={!text.trim()} onClick={() => void comment()}>{i18next.t("コメントする")}</button></div>
      </section>
    </div>
  );
}

export default function Issues(ctx: Ctx & { kind: Kind }) {
  const { s, kind } = ctx;
  const pull = kind === "pull";
  const [st, setSt] = useState<St>("open");
  const [q, setQ] = useState("");
  const [lab, setLab] = useState("");
  const [at, setAt] = useState<number | "new" | null>(null);
  const list = useLoad<(Issue | Pull)[]>(async () => {
    if (pull) return gh.pulls(s, { state: st, sort: "updated", direction: "desc" });
    return (await gh.issues(s, { state: st, sort: "updated", direction: "desc" })).filter((x) => !x.pull_request);
  }, [kind, st, s.owner, s.repo]);
  const labels = useLoad(() => gh.labels(s), [s.owner, s.repo]);
  const shown = useMemo(() => (list.data ?? []).filter((x) => (!q || x.title.toLowerCase().includes(q.toLowerCase()) || `#${x.number}` === q) && (!lab || x.labels.map(labelName).includes(lab))), [list.data, q, lab]);

  if (at === "new") return <Create ctx={ctx} kind={kind} labels={labels.data ?? []} onCancel={() => setAt(null)} onDone={(n) => { void list.reload(); setAt(n); }} />;
  if (at !== null) return <Detail ctx={ctx} kind={kind} n={at} labels={labels.data ?? []} onBack={() => { setAt(null); void list.reload(); }} />;

  return (
    <div className="gh-page">
      <Head title={pull ? i18next.t("プルリクエスト") : "Issue"} sub={list.data ? i18next.t("{{n}} 件", { n: shown.length }) : undefined}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => void list.reload()}><RefreshCw size={14} /></button>
        <button className="btn" data-primary="true" onClick={() => setAt("new")}><Plus size={14} /><span>{i18next.t("新規")}</span></button>
      </Head>
      <div className="gh-bar">
        <div className="seg" role="group" aria-label={i18next.t("状態")}>
          {(["open", "closed", "all"] as St[]).map((v) => <button key={v} aria-pressed={st === v} onClick={() => setSt(v)}>{v === "open" ? i18next.t("開いている") : v === "closed" ? i18next.t("閉じている") : i18next.t("すべて")}</button>)}
        </div>
        <label className="gh-search"><Search size={14} /><input value={q} placeholder={i18next.t("タイトルで探す")} aria-label={i18next.t("タイトルで探す")} onChange={(e) => setQ(e.target.value)} /></label>
        {(labels.data?.length ?? 0) > 0 && <Select value={lab} label={i18next.t("ラベルで絞る")} onChange={setLab} options={[{ value: "", label: i18next.t("すべてのラベル") }, ...labels.data!.map((l) => ({ value: l.name, label: l.name }))]} />}
      </div>
      {list.busy && !list.data ? <Busy /> : list.err ? <Fail msg={list.err} retry={() => void list.reload()} /> : shown.length === 0 ? <Empty icon={pull ? <GitPullRequest size={20} /> : <CircleDot size={20} />} text={i18next.t("見つかりませんでした")} /> : (
        <ul className="gh-list">
          {shown.map((x) => (
            <li key={x.number}>
              <button className="gh-item" onClick={() => setAt(x.number)}>
                <StateIcon i={x} pull={pull} />
                <span className="gh-item-t"><b>{x.title}</b>
                  <small>#{x.number} · {x.user?.login} · {relTime(x.updated_at)}{(x as Pull).draft ? ` · ${i18next.t("下書き")}` : ""}</small></span>
                <span className="gh-item-r">
                  {x.labels.slice(0, 3).map((l) => typeof l === "string" ? null : <span key={l.id} className="gh-label" style={labelStyle(l.color)}>{l.name}</span>)}
                  {x.comments > 0 && <span className="gh-stat"><MessageSquare size={12} />{x.comments}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
