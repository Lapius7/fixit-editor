// 右側の Git パネル。変更(ステージ・コミット)・ツリー・履歴・ブランチを、タブで切り替える。
// Git の操作は gitRead / gitWrite で、固定の操作名だけを backend に渡す。
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, GitBranch, GitCommitHorizontal, Minus, Plus, RefreshCw, Sparkles, Square, Trash2, Undo2, X } from "lucide-react";
import { aiConsent, aiConsented, aiErrText, aiProviderName, aiReady, askOnce } from "@/features/ai/oneshot";
import { commitPrompt, commitSystem } from "@/features/ai/prompts";
import { useAi } from "@/features/ai/store";
import i18next from "i18next";
import type { Conn } from "@/platform/remote";
import { ms, update, useSettings } from "@/features/settings/settings";
import {
  buildGraph, gitRead, gitWrite, GitError, parseBranches, parseChanges, parseDiff, parseFiles, parseLog, remoteNames,
  type Branch, type Change, type Commit, type DiffLine, type FileChange, type GraphRow, type Status,
} from "@/features/git/git";
import { GitSetup } from "@/features/git/GitSetup";

type Tab = "changes" | "tree" | "log" | "branches";
type Side = "staged" | "unstaged" | "conflict";
// root: リポジトリの最上位(null はリポジトリではない、undefined はまだ調べている)。dir: 見ているフォルダ
// title・onBack: 右クリックで別のフォルダを選んでいるとき、その名前と、開いているフォルダに戻すボタン
type Props = {
  open: boolean; conn: Conn | null; root: string | null | undefined; dir?: string; title?: string; rev: number;
  // ファイル一覧からフォルダを落としたとき。受け取れるフォルダなら true(canDrop)
  canDrop?: () => boolean; onDropDir?: () => void;
  onClose: () => void; onChanged: () => void; onRepo?: (dir: string) => void; onBack?: () => void; guard?: () => boolean | Promise<boolean>;
};

const ROW = 28, LANE = 12, COLORS = 8;
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const letter = (c: Change, side: Side) => { const l = side === "staged" ? c.x : c.y === "?" ? "U" : c.y; return l === "?" ? "U" : l; };
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function ago(at: number) {
  const s = Math.round((at - Date.now()) / 1000), a = Math.abs(s);
  const f = new Intl.RelativeTimeFormat(i18next.language, { numeric: "auto" });
  if (a < 60) return f.format(s, "second");
  if (a < 3600) return f.format(Math.round(s / 60), "minute");
  if (a < 86400) return f.format(Math.round(s / 3600), "hour");
  if (a < 86400 * 30) return f.format(Math.round(s / 86400), "day");
  return new Date(at).toLocaleDateString(i18next.language);
}

// 作業フォルダのファイルを書き換える操作
const REWRITES = new Set(["checkout", "discard", "clean", "pull"]);

export function GitPanel({ open, conn, root, dir, title, rev, onClose, onChanged, onRepo, onBack, guard, canDrop, onDropDir }: Props) {
  const [over, setOver] = useState(false);
  const [tab, setTab] = useState<Tab>("changes");
  const [st, setSt] = useState<Status | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [gen, setGen] = useState<AbortController | null>(null); // AI でコミットメッセージを作っている間
  useEffect(() => () => gen?.abort(), [gen]);
  useAi(); // AI の設定が変わったらボタンの状態を変える
  const [newName, setNewName] = useState("");
  const [arm, setArm] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const seq = useRef(0);
  const armT = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 閉じるときは、縮みきってから外す
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const h = setTimeout(() => setMounted(false), ms(260));
    return () => clearTimeout(h);
  }, [open]);

  // 別のリポジトリに切り替えたら、前の内容を残さない
  useEffect(() => { seq.current++; setSt(null); setCommits([]); setBranches([]); setErr(""); setLoading(false); }, [root, conn]);
  const load = useCallback(async () => {
    if (!conn || !root) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const status = parseChanges(await gitRead(conn, root, { cmd: "changes" }));
      if (my !== seq.current) return;
      setSt(status); setErr("");
      if (tab === "branches" || tab === "tree" || tab === "log") {
        const bs = parseBranches(await gitRead(conn, root, { cmd: "branches" }));
        if (my !== seq.current) return;
        setBranches(bs);
        if (tab !== "branches") {
          const cs = parseLog(await gitRead(conn, root, { cmd: "log" }), remoteNames(bs));
          if (my !== seq.current) return;
          setCommits(cs);
        }
      }
    } catch (e) { if (my === seq.current) setErr(msg(e)); }
    finally { if (my === seq.current) setLoading(false); }
  }, [conn, root, tab]);
  useEffect(() => { if (open) void load(); }, [open, load, rev]);
  useEffect(() => { setSel(null); setOpenKey(null); }, [tab, root]);

  // 書き込み操作。終わったら、パネルとファイルツリーを更新する
  const run = async (label: string, body: Record<string, unknown>, after?: () => void) => {
    if (!conn || !root || busy) return;
    // 作業フォルダのファイルを書き換える操作は、未保存のタブがあれば先に確かめる
    if (REWRITES.has(String(body.cmd)) && guard && !(await guard())) return;
    setBusy(label); setErr("");
    try { await gitWrite(conn, root, body); after?.(); onChanged(); await load(); }
    catch (e) { setErr(msg(e)); }
    finally { setBusy(""); }
  };
  // 取り消せない操作は、2回押すと実行する(3秒で元に戻る)
  const twice = (key: string, go: () => void) => () => {
    if (arm === key) { clearTimeout(armT.current); setArm(""); go(); return; }
    setArm(key); clearTimeout(armT.current); armT.current = setTimeout(() => setArm(""), 3000);
  };

  if (!open && !mounted) return null;
  const nStaged = st?.staged.length ?? 0;
  const canCommit = !!text.trim() && nStaged > 0 && !busy;
  const commit = () => { if (canCommit) void run("commit", { cmd: "commit", message: text.trim() }, () => setText("")); };
  // ステージした差分から、AI でコミットメッセージを作る。作っている間にもう一度押すと止める
  const aiMsg = async () => {
    if (gen) { gen.abort(); return; }
    if (!conn || !root || nStaged === 0 || busy) return;
    if (!aiReady()) { setErr(i18next.t("AI が使えません。設定の「AI」でプロバイダーを設定してください")); return; }
    if (!aiConsented()) {
      if (arm !== "ai") { clearTimeout(armT.current); setArm("ai"); armT.current = setTimeout(() => setArm(""), 4000); return; }
      clearTimeout(armT.current); setArm(""); aiConsent();
    }
    const ac = new AbortController(); setGen(ac); setErr("");
    try {
      const [stat, diff] = await Promise.all([gitRead(conn, root, { cmd: "staged-stat" }), gitRead(conn, root, { cmd: "staged-diff" })]);
      const recent = commits.filter((c) => c.parents.length < 2).slice(0, 12).map((c) => c.subject);
      let acc = "";
      await askOnce({ system: commitSystem(), prompt: commitPrompt(stat, diff, recent), signal: ac.signal, effort: "low", onText: (t) => { acc += t; setText(acc.replace(/^\s+/, "")); } });
      setText(acc.trim());
    } catch (e) {
      if (!ac.signal.aborted) setErr(e instanceof GitError ? msg(e) : i18next.t(aiErrText(e)));
    } finally { setGen(null); }
  };
  const upstream = !!st?.upstream;

  const tabs: [Tab, string, number][] = [
    ["changes", i18next.t("変更"), (st?.staged.length ?? 0) + (st?.unstaged.length ?? 0) + (st?.conflicts.length ?? 0)],
    ["tree", i18next.t("ツリー"), 0], ["log", i18next.t("履歴"), 0], ["branches", i18next.t("ブランチ"), 0],
  ];

  return (
    <aside className="ai-dock git-dock" data-closing={!open} data-over={over || undefined} aria-label="Git"
      onDragOver={(e) => { if (!canDrop?.()) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setOver(false); }}
      onDrop={(e) => { setOver(false); if (!canDrop?.()) return; e.preventDefault(); onDropDir?.(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="ai-bar git-bar">
        {onBack && <button className="icon-btn" aria-label={i18next.t("開いているフォルダに戻す")} title={i18next.t("開いているフォルダに戻す")} onClick={onBack}><ArrowLeft /></button>}
        <span className="ai-title"><GitBranch size={15} />
          {title && <span className="git-where truncate" title={dir}>{title}</span>}
          {st ? <span className="truncate">{st.detached ? i18next.t("(切り離し)") : st.branch}</span> : !title && "Git"}
        </span>
        {st && <button className="icon-btn git-sync" aria-label={i18next.t("リモートから取得")} title={i18next.t("リモートから取得")} disabled={!!busy} onClick={() => void run("fetch", { cmd: "fetch" })}><RefreshCw data-spin={busy === "fetch" || loading} /></button>}
        {st && upstream && <button className="icon-btn git-sync" aria-label={i18next.t("プル")} title={i18next.t("プル(早送りだけ)")} disabled={!!busy || st.behind === 0} onClick={() => void run("pull", { cmd: "pull" })}><ArrowDown /><i>{st.behind || ""}</i></button>}
        {st && !st.detached && <button className="icon-btn git-sync" aria-label={upstream ? i18next.t("プッシュ") : i18next.t("ブランチを公開")} title={upstream ? i18next.t("プッシュ") : i18next.t("ブランチを公開")} disabled={!!busy || (upstream && st.ahead === 0)} onClick={() => void run("push", upstream ? { cmd: "push" } : { cmd: "push", setUpstream: true, name: st.branch })}><ArrowUp /><i>{st.ahead || ""}</i></button>}
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      {!root || !conn ? (
        root === undefined && conn ? <p className="git-empty">{i18next.t("読み込み中…")}</p>
          : conn && dir && onRepo ? <GitSetup conn={conn} dir={dir} onRepo={onRepo} />
          : <p className="git-empty">{i18next.t("このフォルダは Git のリポジトリではありません")}</p>
      ) : (
        <>
          <div className="git-tabs" role="tablist" aria-label="Git">
            {tabs.map(([k, label, n]) => (
              <button key={k} role="tab" aria-selected={tab === k} data-on={tab === k} onClick={() => setTab(k)}>{label}{n > 0 && <b>{n}</b>}</button>
            ))}
          </div>
          {err && <div className="git-err" role="alert"><span>{err}</span><button className="icon-btn" aria-label={i18next.t("閉じる")} onClick={() => setErr("")}><X /></button></div>}
          {tab === "changes" && st && (
            <>
              <div className="git-msg">
                <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={i18next.t("コミットメッセージ(Ctrl+Enter で確定)")} aria-label={i18next.t("コミットメッセージ")} rows={2} spellCheck={false} readOnly={!!gen} aria-busy={!!gen}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); } }} />
                {arm === "ai" && <p className="git-ai-note" role="status">{i18next.t("ステージした差分を {{p}} に送ります。もう一度押すと送信します", { p: aiProviderName() })}</p>}
                <div className="git-msg-bar">
                  <button className="git-ai" data-armed={arm === "ai"} disabled={!gen && (nStaged === 0 || !!busy)} onClick={() => void aiMsg()}
                    aria-label={gen ? i18next.t("作成を止める") : i18next.t("AI でコミットメッセージを作る")} title={gen ? i18next.t("作成を止める") : i18next.t("AI でコミットメッセージを作る")}>
                    {gen ? <Square /> : <Sparkles />}
                  </button>
                  <button className="git-commit" disabled={!canCommit || !!gen} onClick={commit}><Check />{i18next.t("コミット")}{nStaged > 0 && <b>{nStaged}</b>}</button>
                </div>
              </div>
              <div className="git-body scroll">
                {st.conflicts.length > 0 && <Group title={i18next.t("衝突")} n={st.conflicts.length}>{st.conflicts.map((c) => <Row key={"c" + c.path} c={c} side="conflict" conn={conn} root={root} open={openKey === "c" + c.path} onOpen={() => setOpenKey(openKey === "c" + c.path ? null : "c" + c.path)} onStage={() => void run("stage", { cmd: "stage", files: [c.path] })} />)}</Group>}
                <Group title={i18next.t("ステージ済み")} n={st.staged.length} act={st.staged.length > 0 && <button className="icon-btn" aria-label={i18next.t("すべてステージから外す")} title={i18next.t("すべてステージから外す")} disabled={!!busy} onClick={() => void run("unstage", { cmd: "unstage", files: st.staged.map((c) => c.path) })}><Minus /></button>}>
                  {st.staged.map((c) => <Row key={"s" + c.path} c={c} side="staged" conn={conn} root={root} open={openKey === "s" + c.path} onOpen={() => setOpenKey(openKey === "s" + c.path ? null : "s" + c.path)} onUnstage={() => void run("unstage", { cmd: "unstage", files: [c.path] })} />)}
                </Group>
                <Group title={i18next.t("変更")} n={st.unstaged.length} act={st.unstaged.length > 0 && <button className="icon-btn" aria-label={i18next.t("すべてステージ")} title={i18next.t("すべてステージ")} disabled={!!busy} onClick={() => void run("stage", { cmd: "stage", files: st.unstaged.map((c) => c.path) })}><Plus /></button>}>
                  {st.unstaged.map((c) => {
                    const k = "u" + c.path, untracked = c.x === "?";
                    return <Row key={k} c={c} side="unstaged" conn={conn} root={root} open={openKey === k} onOpen={() => setOpenKey(openKey === k ? null : k)} armed={arm === k}
                      onStage={() => void run("stage", { cmd: "stage", files: [c.path] })}
                      onDiscard={twice(k, () => void run("discard", untracked ? { cmd: "clean", files: [c.path] } : { cmd: "discard", files: [c.path] }))} />;
                  })}
                </Group>
                {st.conflicts.length + st.staged.length + st.unstaged.length === 0 && <p className="git-empty">{i18next.t("変更はありません")}</p>}
              </div>
            </>
          )}
          {(tab === "tree" || tab === "log") && (
            <CommitList conn={conn} root={root} commits={commits} graph={tab === "tree"} sel={sel} onSel={setSel} loading={loading} />
          )}
          {tab === "branches" && (
            <div className="git-body scroll">
              <form className="git-new" onSubmit={(e) => { e.preventDefault(); const n = newName.trim(); if (n) void run("branch", { cmd: "branch-create", name: n }, () => setNewName("")); }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={i18next.t("新しいブランチ名")} aria-label={i18next.t("新しいブランチ名")} spellCheck={false} />
                <button className="git-commit" disabled={!newName.trim() || !!busy} type="submit"><Plus />{i18next.t("作成")}</button>
              </form>
              <BranchGroup title={i18next.t("ローカル")} items={branches.filter((b) => !b.remote)} busy={!!busy} arm={arm}
                onGo={(b) => void run("checkout", { cmd: "checkout", name: b.name })}
                onDelete={(b) => twice("d" + b.name, () => void run("branch-delete", { cmd: "branch-delete", name: b.name }))()} />
              <BranchGroup title={i18next.t("リモート")} items={branches.filter((b) => b.remote)} busy={!!busy} arm={arm}
                onGo={(b) => void run("checkout", { cmd: "checkout", name: b.name.slice(b.name.indexOf("/") + 1) })} />
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function Group({ title, n, act, children }: { title: string; n: number; act?: React.ReactNode; children: React.ReactNode }) {
  if (!n) return null;
  return (
    <section className="git-grp">
      <header><span>{title}</span><b>{n}</b><span className="git-grp-act">{act}</span></header>
      {children}
    </section>
  );
}

function Row({ c, side, conn, root, open, onOpen, onStage, onUnstage, onDiscard, armed }: {
  c: Change; side: Side; conn: Conn; root: string; open: boolean; onOpen: () => void; onStage?: () => void; onUnstage?: () => void; onDiscard?: () => void; armed?: boolean;
}) {
  const l = letter(c, side), d = dirOf(c.path);
  return (
    <div className="git-item" data-open={open}>
      <div className="git-row" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} title={c.path}>
        <i className="git-l" data-l={l}>{l}</i>
        <span className="git-name truncate">{base(c.path)}{d && <small>{d}</small>}</span>
        <span className="git-acts" onClick={(e) => e.stopPropagation()}>
          {onDiscard && <button className="icon-btn" data-armed={armed} aria-label={armed ? i18next.t("もう一度押すと元に戻します") : i18next.t("変更を元に戻す")} title={armed ? i18next.t("もう一度押すと元に戻します") : c.x === "?" ? i18next.t("ファイルを削除") : i18next.t("変更を元に戻す")} onClick={onDiscard}>{c.x === "?" ? <Trash2 /> : <Undo2 />}</button>}
          {onStage && <button className="icon-btn" aria-label={i18next.t("ステージ")} title={i18next.t("ステージ")} onClick={onStage}><Plus /></button>}
          {onUnstage && <button className="icon-btn" aria-label={i18next.t("ステージから外す")} title={i18next.t("ステージから外す")} onClick={onUnstage}><Minus /></button>}
        </span>
      </div>
      <Collapse open={open}>{open && <DiffView conn={conn} root={root} file={c.path} staged={side === "staged"} untracked={c.x === "?"} />}</Collapse>
    </div>
  );
}

// 開閉をなめらかにする(高さを 0fr ⇄ 1fr で動かす)
function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [keep, setKeep] = useState<React.ReactNode>(null);
  useEffect(() => { if (open) setKeep(children); else { const h = setTimeout(() => setKeep(null), ms(220)); return () => clearTimeout(h); } }, [open, children]);
  return <div className="git-collapse" data-open={open}><div>{open ? children : keep}</div></div>;
}

function DiffView({ conn, root, file, staged, untracked, hash }: { conn: Conn; root: string; file: string; staged?: boolean; untracked?: boolean; hash?: string }) {
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setLines(null); setErr("");
    gitRead(conn, root, hash ? { cmd: "diff", file, hash } : { cmd: "diff", file, staged: !!staged, untracked: !!untracked })
      .then((o) => live && setLines(untracked ? parseDiff(o).filter((l) => !(l.t === "meta" && l.text.startsWith("new file"))) : parseDiff(o))).catch((e) => live && setErr(msg(e)));
    return () => { live = false; };
  }, [conn, root, file, staged, untracked, hash]);
  if (err) return <p className="git-diff-note">{err}</p>;
  if (!lines) return <p className="git-diff-note">{i18next.t("読み込み中…")}</p>;
  if (!lines.length) return <p className="git-diff-note">{i18next.t("表示できる差分がありません")}</p>;
  const MAX = 400, shown = lines.slice(0, MAX);
  return (
    <div className="git-diff scroll" tabIndex={0}>
      <div className="git-dw">
        {shown.map((l, i) => <span key={i} className="git-dl" data-t={l.t}>{l.text || " "}</span>)}
        {lines.length > MAX && <span className="git-dl" data-t="meta">{i18next.t("…残り {{n}} 行", { n: lines.length - MAX })}</span>}
      </div>
    </div>
  );
}

function Graph({ row }: { row: GraphRow }) {
  const w = row.width * LANE + 6, x = (k: number) => 6 + k * LANE;
  return (
    <svg className="git-graph" width={w} height={ROW} viewBox={`0 0 ${w} ${ROW}`} aria-hidden="true">
      {row.segs.map((s, i) => {
        const x1 = x(s.x1), x2 = x(s.x2), y1 = s.y1 * ROW, y2 = s.y2 * ROW, my = (y1 + y2) / 2;
        return <path key={i} d={x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`} stroke={`var(--git-c${s.color % COLORS})`} fill="none" strokeWidth="1.6" strokeLinecap="round" />;
      })}
      <circle cx={x(row.col)} cy={ROW / 2} r={row.commit.parents.length > 1 ? 3.5 : 4.2} fill={row.commit.parents.length > 1 ? "var(--git-bg)" : `var(--git-c${row.color % COLORS})`} stroke={`var(--git-c${row.color % COLORS})`} strokeWidth="1.8" />
    </svg>
  );
}

function CommitList({ conn, root, commits, graph, sel, onSel, loading }: { conn: Conn; root: string; commits: Commit[]; graph: boolean; sel: string | null; onSel: (h: string | null) => void; loading: boolean }) {
  const rows = graph ? buildGraph(commits) : null;
  const cur = commits.find((c) => c.hash === sel) ?? null;
  const [files, setFiles] = useState<FileChange[] | null>(null);
  const [file, setFile] = useState<string | null>(null);
  useEffect(() => {
    setFiles(null); setFile(null);
    if (!cur) return;
    let live = true;
    gitRead(conn, root, { cmd: "show", hash: cur.hash }).then((o) => live && setFiles(parseFiles(o))).catch(() => live && setFiles([]));
    return () => { live = false; };
  }, [conn, root, cur?.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const { gitLogH } = useSettings();
  const [drag, setDrag] = useState(false);
  // 一覧と詳細の境目。上へ動かすと詳細が高くなる。一覧が少し残るように、パネルの 8 割までにする
  const fit = (el: HTMLElement, h: number) => Math.round(Math.min(Math.max(96, (el.parentElement?.clientHeight ?? 600) * 0.8), Math.max(96, h)));
  const grip = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = (el.nextElementSibling as HTMLElement | null)?.offsetHeight ?? gitLogH;
    setDrag(true);
    const mv = (ev: PointerEvent) => update({ gitLogH: fit(el, h0 + y0 - ev.clientY) });
    const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); setDrag(false); };
    el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  };
  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (d) { e.preventDefault(); update({ gitLogH: fit(e.currentTarget, gitLogH + d * (e.shiftKey ? 40 : 10)) }); }
  };
  if (!commits.length) return <p className="git-empty">{loading ? i18next.t("読み込み中…") : i18next.t("コミットはまだありません")}</p>;
  return (
    <>
      <div className="git-body scroll" data-split={!!cur}>
        {commits.map((c, i) => (
          <button key={c.hash} className="git-commit-row" data-on={c.hash === sel} onClick={() => onSel(c.hash === sel ? null : c.hash)}>
            {rows && <Graph row={rows[i]} />}
            <span className="git-sub truncate">{c.subject}</span>
            {c.refs.map((r) => <em key={r.kind + r.name} className="git-ref" data-k={r.kind}>{r.name}</em>)}
            {!rows && <small>{c.author} · {ago(c.at)}</small>}
          </button>
        ))}
      </div>
      {cur && <div className="git-vgrip" role="separator" aria-orientation="horizontal" tabIndex={0} data-drag={drag} aria-valuenow={gitLogH}
        title={i18next.t("ドラッグで高さを変える・ダブルクリックで元の高さに戻す")} onPointerDown={grip} onKeyDown={key} onDoubleClick={() => update({ gitLogH: 260 })} />}
      {cur && (
        <div className="git-detail scroll" style={{ flexBasis: gitLogH }}>
          <p className="git-detail-sub">{cur.subject}</p>
          <p className="git-detail-meta">{cur.author} · {new Date(cur.at).toLocaleString(i18next.language)} · <code>{cur.hash.slice(0, 7)}</code></p>
          {!files ? <p className="git-diff-note">{i18next.t("読み込み中…")}</p> : files.map((f) => (
            <div key={f.path} className="git-item" data-open={file === f.path}>
              <div className="git-row" role="button" tabIndex={0} title={f.path} onClick={() => setFile(file === f.path ? null : f.path)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFile(file === f.path ? null : f.path); } }}>
                <i className="git-l" data-l={f.status}>{f.status}</i>
                <span className="git-name truncate">{base(f.path)}{dirOf(f.path) && <small>{dirOf(f.path)}</small>}</span>
              </div>
              <Collapse open={file === f.path}>{file === f.path && <DiffView conn={conn} root={root} file={f.path} hash={cur.hash} />}</Collapse>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BranchGroup({ title, items, busy, arm, onGo, onDelete }: { title: string; items: Branch[]; busy: boolean; arm: string; onGo: (b: Branch) => void; onDelete?: (b: Branch) => void }) {
  if (!items.length) return null;
  return (
    <section className="git-grp">
      <header><span>{title}</span><b>{items.length}</b></header>
      {items.map((b) => (
        <div key={b.name} className="git-row git-br" data-cur={b.current}>
          <GitCommitHorizontal className="git-br-ico" />
          <span className="git-name truncate">{b.name}{b.upstream && <small>{b.upstream}{b.track ? ` · ${b.track}` : ""}</small>}</span>
          <span className="git-acts">
            {!b.current && <button className="git-pill" disabled={busy} onClick={() => onGo(b)}>{i18next.t("切り替え")}</button>}
            {!b.current && onDelete && <button className="icon-btn" data-armed={arm === "d" + b.name} aria-label={arm === "d" + b.name ? i18next.t("もう一度押すと削除します") : i18next.t("ブランチを削除")} title={arm === "d" + b.name ? i18next.t("もう一度押すと削除します") : i18next.t("ブランチを削除")} disabled={busy} onClick={() => onDelete(b)}><Trash2 /></button>}
          </span>
          {b.current && <Check className="git-cur" />}
        </div>
      ))}
    </section>
  );
}
