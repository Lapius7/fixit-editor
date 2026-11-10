import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Palette as PaletteIcon, Quote, FolderOpen, PanelLeft, PanelRight, PanelTop, PanelBottom, ListCollapse, RotateCw, X, Files, Search as SearchIcon, FilePlus, FolderPlus, Pencil, Trash2, Copy, Scissors, ClipboardPaste,
  Columns2, Rows2, ArrowLeftRight, SquareTerminal, Settings as Cog, Plus, TextCursorInput, Terminal as TermIcon, Undo2, Redo2, MousePointerClick, CaseUpper, ArrowDownAZ, WrapText, ChevronsDownUp, ChevronsUpDown, Link, Eraser, SunMoon, Command, ChevronDown, ChevronRight, Folder, FolderMinus,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import WinControls from "@/app/WinControls";
import { CHROME } from "@/shared/chrome";
import { notify, type NoticeKind } from "@/shared/notify";
import { OUTLINE_EVENT } from "@/editor/Crumbs";
import LangUI from "@/editor/LangUI";
import { openFiles, isScript, type Edit, type Loc } from "@/editor/ts/client";
import Editor, { dropStates, type Cursor, type Jump } from "@/editor/Editor";
import FileTree, { GitMarks, canDrop, type GitMark } from "@/workbench/FileTree";
import { ColGrip } from "@/workbench/ColGrip";
import { loadBase, loadGit, type GitInfo } from "@/features/git/git";
import QuickOpen from "@/workbench/QuickOpen";
import Viewer from "@/workbench/Viewer";
import Terminal, { type TermApi } from "@/workbench/Terminal";
import StatusBar from "@/workbench/StatusBar";
import { usePresence } from "@/shared/presence";
import ThemePanel from "@/features/theme/ThemePanel";
import StatusPop, { type PopKind } from "@/workbench/StatusPop";
import Palette, { type Cmd } from "@/workbench/Palette";
import Settings from "@/features/settings/Settings";
import StatsView from "@/features/stats/StatsView";
import Setup, { needSetup } from "@/app/Setup";
import { noteSave } from "@/features/stats/stats";
import { moveFile, recordSave } from "@/features/history/history";
import LocalHistory from "@/features/history/LocalHistory";
import { sendPing } from "@/features/telemetry/telemetry";
import { installErrorHooks, startUsageReports } from "@/features/telemetry/report";
import FeedbackView from "@/features/telemetry/FeedbackView";
import { useAccount } from "@/features/account/auth";
import { useReplies } from "@/features/account/replies";
import { Avatar } from "@/features/account/AccountUI";
import UpdateView from "@/features/update/UpdateView";
import { checkUpdate, type Manifest } from "@/features/update/update";
import SearchPanel from "@/workbench/SearchPanel";
import ContextMenu, { type Item } from "@/workbench/ContextMenu";
import Dialog from "@/workbench/Dialog";
import Connect from "@/features/workspaces/Connect";
import Workspaces from "@/features/workspaces/Workspaces";
import { Pin, History, MessageSquareText, RefreshCw } from "lucide-react";
import { Sparkles, Server, HardDrive, FolderKanban, Eye, Code2, Maximize2, Minimize2 } from "lucide-react";
import { createWs, canUse, connOf, findWs, getHandle, getWorkspaces, handleKey, matchRoot, nodeAt, putHandle, rootRefOf, saveState, setCurrent, setWsRoots, useWorkspaces, wsRoots, type RootEntry, type RootRef, type Workspace, type WsState } from "@/features/workspaces/workspaces";
import { displayPath, setRootNames, splitRoot } from "@/workbench/rootpath";
import { getProfiles, switchProfile, useProfiles } from "@/features/settings/profiles";
import { listShells, type ShellOpt } from "@/platform/pty";
import { RemoteFile, checkDir, connKey, connLabel, pushRecent, rootHandle, sshUrl, type Conn, type RemoteDir } from "@/platform/remote";
import { DEMO_NAME, DEMO_TREE } from "@/shared/demo";
import { IS_TAURI } from "@/shared/chrome";
import { createDir, createFile, moveEntry, pickFolder, pickPcFolder, readDir, removeEntry, renameFile, supportsFs, writeFile, type Node } from "@/platform/fs";
import { load } from "@/platform/load";
import { langName } from "@/editor/lang";
import { APP_NAME } from "@/shared/config";
import BrowserDock from "@/features/browser/BrowserDock";
import { AiDock } from "@/features/ai/AiDock";
import type { AiAction, AiJob, Clip, Ctx } from "@/features/ai/prompts";
import Preview, { previewKind } from "@/features/preview/Preview";
import { KEYS, DEF, chips, comboOf, keyOf, rec, table } from "@/features/settings/keys";
import { EDIT } from "@/editor/edit-cmds";
import { codeToPng, shareShot } from "@/editor/shot";
import { drag, dragEnd, dragging } from "@/workbench/dnd";
import { addNode, dirOf, exists, moveNode, removeNode, renameNode } from "@/workbench/treeops";
import { DEFS, isDark, ms, update, useSettings } from "@/features/settings/settings";
import type { Tab } from "@/shared/types";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

// 開いているフォルダ。先頭のフォルダは prefix が空(パスは /src/a.ts)、追加したフォルダは「/@xxxx」から始まる(/@xxxx/src/a.ts)
type Root = { prefix: string; name: string; handle?: FileSystemDirectoryHandle; nodes: Node[]; conn?: Conn; ref: RootRef };
type Spec = { prefix: string; name: string; handle?: FileSystemDirectoryHandle; conn?: Conn; ref: RootRef };
const newPrefix = () => "/@" + Math.random().toString(36).slice(2, 7);
type Dlg = { title: string; desc?: string; input?: string; placeholder?: string; ok: string; danger?: boolean; validate?: (v: string) => string | null; onSubmit: (v: string) => void };
type Pair<T> = [T, T];
type Sess = { id: number; num: number; name?: string; exiting?: boolean; cwd?: string; shell?: string; label?: string; host?: string | null }; // host: SSH 先(null は SSH ではない。未指定は先頭のフォルダに合わせる)
const def = (id: string) => DEFS.find((d) => d.id === id)!.def as number;

const revoke = (t: Tab) => { if ("url" in t.view) URL.revokeObjectURL(t.view.url); };
const isText = (t?: Tab | null) => t?.view.kind === "text";

type Dz = 0 | 1 | "L" | "R" | "T" | "B";

export default function App() {
  const st = useSettings();
  const [roots, setRoots] = useState<Root[]>([{ prefix: "", name: DEMO_NAME, nodes: DEMO_TREE, ref: { kind: "demo" } }]);
  const root = roots[0]; // タイトル・接続表示・ターミナルの既定の場所は、先頭のフォルダに合わせる
  setRootNames(roots);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // 見出しを畳んでいるフォルダ
  const [dropHead, setDropHead] = useState<string | null>(null); // ドラッグ中に光らせるフォルダの見出し
  const [cnAdd, setCnAdd] = useState(false); // WSL・SSH の画面を「追加」で開いているか
  const rootOfPath = (p: string): Root => {
    let best: Root | undefined;
    for (const r of roots) if (r.prefix && (p === r.prefix || p.startsWith(r.prefix + "/")) && (!best || r.prefix.length > best.prefix.length)) best = r;
    return best ?? roots.find((r) => !r.prefix) ?? roots[0];
  };
  const rootOf = (n: Node) => rootOfPath(n.path);
  const updRoot = (prefix: string, f: (r: Root) => Root) => setRoots((p) => p.map((r) => (r.prefix === prefix ? f(r) : r)));
  // 見出し(フォルダそのもの)を、ツリーの項目と同じ形で扱うための項目
  const headNode = (r: Root): Node => ({ name: r.name, path: r.prefix, kind: "dir", handle: r.handle });
 
 const isRootNode = (n: Node) => roots.some((r) => r.prefix === n.path);
  const [tabs, setTabs] = useState<Tab[]>([]);
  // HTML プレビューが相対パスの CSS・JS・画像を読むための材料(開いているフォルダ、開いているタブの中身)
  const openTexts = useMemo(() => Object.fromEntries(tabs.filter((x) => x.view.kind === "text" && /\.(css|m?js|svg|json)$/i.test(x.node.name)).map((x) => [x.node.path, x.text])), [tabs]);
  const previewSource = (t: Tab) => ({ root: rootOfPath(t.node.path)?.handle as FileSystemDirectoryHandle | undefined, path: t.node.path, open: openTexts });
  const [act, setAct] = useState<Pair<string | null>>([null, null]);
  const [fp, setFp] = useState<0 | 1>(0);
  const [split, setSplit] = useState(false);
  // 分割: 右の画面を先に置き、次のフレームで幅を広げる(閉じるときは、縮んでから外す)
  const [splitMount, setSplitMount] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [grp, setGrp] = useState<Pair<Set<string>>>([new Set(), new Set()]); // 分割時、各画面のタブ(0 側は「両方に出す」印も兼ねる)
  const [fresh, setFresh] = useState<Set<string>>(new Set());   // 開いた直後のタブだけ、伸びる動きをつける(並べ替えで動きが再生されないように)
  const [dz, setDz] = useState<Dz | null>(null);        // ドラッグ中に落とす先。0/1 は既存の画面、L/R/T/B は「新しく分割してその側に置く」
  const seen = useRef(0); const [chk, setChk] = useState(0);                         // 画面が空になっていないか見直す合図
  const [tabDrop, setTabDrop] = useState<{ path: string; after: boolean; pane: 0 | 1 } | null>(null);
  const [dragS, setDragS] = useState(false);
  // 新しいタブは、自分の幅まで伸びながら出てくる。伸びる先の幅を、出す前に測っておく
  const measureTab = useCallback((el: HTMLDivElement | null) => { if (!el || el.style.getPropertyValue("--tw")) return; el.style.animation = "none"; el.style.setProperty("--tw", `${el.offsetWidth}px`); el.style.animation = ""; }, []);
  const [side, setSide] = useState(true);
  const [panel, setPanel] = useState<"files" | "search">("files");
  const [seed, setSeed] = useState("");
  const [rev, setRev] = useState(0);
  const [rootDrop, setRootDrop] = useState(false);
  const [extDrop, setExtDrop] = useState(false); // OS のフォルダ・ファイルを、エクスプローラーの上へ引きずっている間
  useEffect(() => { // 引きずりが途中でやめられたり、ウィンドウの外へ出たりしたときに、ドロップ表示が残らないようにする
    const end = () => { setRootDrop(false); setExtDrop(false); };
    const out = (e: DragEvent) => { if (!e.relatedTarget) end(); };
    window.addEventListener("dragend", end); window.addEventListener("drop", end); window.addEventListener("dragleave", out);
    return () => { window.removeEventListener("dragend", end); window.removeEventListener("drop", end); window.removeEventListener("dragleave", out); };
  }, []);
  const [preview, setPreview] = useState<string | null>(null); // 一時表示のタブ(1つだけ。編集・保存・ダブルクリックで固定される)
  type PvMode = "split" | "preview"; // 表示の切り替え: なし = テキストだけ / split = 両方 / preview = プレビューだけ
  const pvSeen = useRef(new Set<string>()); // 一度プレビューを開いたファイル(閉じる動きの間も中身を残す)
  const [pv, setPv] = useState<Record<string, PvMode | undefined>>({}); // プレビュー形式のファイルの表示(パス → 表示)
  const [br, setBr] = useState(false); // アプリ内ブラウザの表示
  const [ai, setAi] = useState(false); // AI パネルの表示
  const [aiJob, setAiJob] = useState<AiJob | null>(null); // 右クリックから AI パネルへ渡す依頼
  const [aiQuote, setAiQuote] = useState<Clip | null>(null); // 引用して AI パネルへ添える文
  const aiSeq = useRef(0);
  const [cur, setCur] = useState<Pair<Cursor | null>>([null, null]);
  const [jump, setJump] = useState<Pair<Jump | undefined>>([undefined, undefined]);
  const [qo, setQo] = useState(false);
  const [cn, setCn] = useState(false);
  const me = useAccount();
  const unreplies = useReplies().unread;
  const [wsDlg, setWsDlg] = useState<null | "ws" | "profile">(null);
  const [lh, setLh] = useState<string | null>(null); // ローカル履歴を開いているファイルのパス
  const [statsOpen, setStatsOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const [upd, setUpdM] = useState<Manifest | null>(null);
  const [updOpen, setUpdOpen] = useState(false);
  const setUpd = (m: Manifest) => { setUpdM(m); setUpdOpen(true); };
  const checkNow = async () => { const r = await checkUpdate(); if (r === "error") notify(i18next.t("更新を確認できませんでした"), "error"); else if (r) setUpd(r); else notify(i18next.t("最新の版です"), "success"); };
  const [setupOpen, setSetupOpen] = useState(needSetup);
  // 初回セットアップで選び終えてから、1 日 1 回だけ匿名の利用数を送る(開発中は送らない)
  useEffect(() => { if (!setupOpen) { sendPing(); installErrorHooks(); startUsageReports(); } }, [setupOpen]);
  // 起動して少ししたら、新しい版がないか確かめる(あれば知らせる)。失敗しても何も出さない
  useEffect(() => { if (setupOpen || !import.meta.env.PROD) return; const t = setTimeout(() => { checkUpdate().then((r) => { if (r && r !== "error") setUpd(r); }); }, 6000); return () => clearTimeout(t); }, [setupOpen]);
  const [pop, setPop] = useState<PopKind | null>(null);
  const wsStore = useWorkspaces();
  const pfStore = useProfiles();
  const ws = wsStore.list.find((w) => w.id === wsStore.current) ?? null;
  const activeWs = useRef<string | null>(null); // いまの状態を書き戻す先
  const restoring = useRef(true); // 開き直している間と、起動の直後は、書き戻さない
  const wsTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gen = useRef(0); // 切り替えの通し番号(遅れて終わった古い切り替えを捨てるため)
  const started = useRef(false);
  const [pal, setPal] = useState(false);
  const [setts, setSetts] = useState<null | string>(null);
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const [term, setTerm] = useState(false);           // ターミナルのパネルを開いているか
  const [shown, setShown] = useState(false);          // 開く動きを始めてよいか(閉じた状態を1コマ見せるため)
  const [termKey, setTermKey] = useState(0);
  const [sess, setSess] = useState<Sess[]>([]);       // ターミナルの画面(ひとつが、ひとつのシェル)
  const [actT, setActT] = useState(0);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renOut, setRenOut] = useState(false);
  const [tp, setTp] = useState(false);
  const [dragT, setDragT] = useState(false);
  const [menu, setMenu] = useState<null | { x: number; y: number; items: Item[]; path?: string }>(null);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  // 外から閉じられても、閉じるアニメーションが終わるまで残す
  const pQo = usePresence(qo), pPal = usePresence(pal), pSetts = usePresence(setts), pDlg = usePresence(dlg), pCn = usePresence(cn);
  const pTp = usePresence(tp, 400), pWs = usePresence(wsDlg), pLh = usePresence(lh), pStats = usePresence(statsOpen), pFb = usePresence(fbOpen), pUp = usePresence(updOpen), pSetup = usePresence(setupOpen), pPop = usePresence(pop, 140), pMenu = usePresence(menu, 140);
  const views = useRef<Pair<EditorView | null>>([null, null]);
  const apis = useRef(new Map<number, TermApi>());
  const seq = useRef(0);
  const sessRef = useRef<Sess[]>([]);
  sessRef.current = sess;
  const cleanT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tabOf = (p: string | null) => tabs.find((t) => t.node.path === p) ?? null;
  const tab = tabOf(act[fp]);
  // タブがどの画面に出るか。分割していなければ、すべて左(0)。どちらにも属さないものは左に出す
  const mem = (i: 0 | 1, p: string) => (i === 0 ? !split || !grp[1].has(p) || grp[0].has(p) : split && grp[1].has(p));
  const paneTabs = (i: 0 | 1) => tabs.filter((t) => mem(i, t.node.path));
  const grpAdd = (g: Pair<Set<string>>, i: 0 | 1, p: string): Pair<Set<string>> => { const x: Pair<Set<string>> = [new Set(g[0]), new Set(g[1])]; x[i].add(p); return x; };
  const grpDel = (g: Pair<Set<string>>, ps: Iterable<string>, i?: 0 | 1): Pair<Set<string>> => { const x: Pair<Set<string>> = [new Set(g[0]), new Set(g[1])]; for (const p of ps) { if (i !== 1) x[0].delete(p); if (i !== 0) x[1].delete(p); } return x; };
  // その画面で、閉じたタブの代わりに開くタブ(いちばん近いもの)
  const nearIn = (i: 0 | 1, path: string, list: Tab[] = tabs, skip: Set<string> = new Set([path])) => {
    const k = list.findIndex((t) => t.node.path === path), c = list.filter((t) => !skip.has(t.node.path) && mem(i, t.node.path));
    return (c.find((t) => list.indexOf(t) > k) ?? c[c.length - 1])?.node.path ?? null;
  };
  const flash = (m: string, kind?: NoticeKind) => notify(m, kind);
  const dirtyList = tabs.filter((t) => isText(t) && t.text !== t.saved);

  /* ---------- ファイル ---------- */
  const open = useCallback(async (n: Node, pane: 0 | 1 = fp, pin = true) => {
    if (!tabs.some((t) => t.node.path === n.path)) {
      try {
        const { view, info } = await load(n);
        const text = view.kind === "text" ? view.text : "";
        const nt: Tab = { node: n, view, info, text, saved: text, eol: view.kind === "text" ? view.eol ?? "lf" : "lf" };
        // 一時表示のタブは、次に一時表示で開くものに置き換わる(未保存の変更があるもの・もう一方の画面に出ているものは除く)
        const old = !pin ? tabs.find((t) => t.node.path === preview) : undefined;
        const swap = !!old && old.text === old.saved && act[pane === 0 ? 1 : 0] !== old.node.path;
        setTabs((p) => (p.some((t) => t.node.path === n.path) ? p : swap ? p.map((t) => (t.node.path === old!.node.path ? nt : t)) : [...p, nt]));
        if (swap) { revoke(old!); setGrp((g) => grpDel(g, [old!.node.path])); }
        setPreview(pin ? null : n.path);
        if (!swap) {
          setFresh((f) => new Set(f).add(n.path));
          setTimeout(() => setFresh((f) => { const x = new Set(f); x.delete(n.path); return x; }), ms(500));
        }
      } catch (e) { return flash((e as Error).message, "error"); }
    } else if (pin && preview === n.path) setPreview(null);
    setAct((a) => (pane === 0 ? [n.path, a[1]] : [a[0], n.path]));
    setGrp((g) => (g[pane].has(n.path) ? g : grpAdd(g, pane, n.path)));
    setFp(pane);
  }, [tabs, fp, preview, act]); // eslint-disable-line react-hooks/exhaustive-deps

  const goto = async (n: Node, line: number, from = 0, to = 0) => {
    await open(n);
    setJump((j) => (fp === 0 ? [{ line, from, to, n: Date.now() }, j[1]] : [j[0], { line, from, to, n: Date.now() }]));
  };

  // JS/TS の言語機能: 言語サービスには、開いているタブの中身を渡す
  useEffect(() => { openFiles.v = Object.fromEntries(tabs.filter((t) => isText(t) && isScript(t.node.name)).map((t) => [t.node.path, t.text])); }, [tabs]);
  const gotoLoc = (l: Loc) => {
    const t = tabOf(l.file);
    if (!t) return;
    const start = l.line > 1 ? t.text.split("\n").slice(0, l.line - 1).join("\n").length + 1 : 0;
    void goto(t.node, l.line, l.from - start, l.to - start);
  };
  const applyRename = (edits: Edit[], name: string, view: EditorView, file: string) => {
    const by = new Map<string, Edit[]>();
    for (const e of edits) by.set(e.file, [...(by.get(e.file) ?? []), e]);
    const sort = (a: Edit[]) => [...a].sort((x, y) => y.from - x.from);
    let n = 0;
    for (const [f, list] of by) {
      n += list.length;
      if (f === file) { view.dispatch({ changes: sort(list).map((e) => ({ from: e.from, to: e.to, insert: e.pre + name + e.suf })), userEvent: "input.rename" }); continue; }
      setTabs((p) => p.map((t) => {
        if (t.node.path !== f || !isText(t)) return t;
        let x = t.text;
        for (const e of sort(list)) x = x.slice(0, e.from) + e.pre + name + e.suf + x.slice(e.to);
        return { ...t, text: x };
      }));
    }
    flash(i18next.t("{{n}} か所の名前を変えました", { n }));
  };
  const closeMany = (paths: string[], force = false) => {
    const gone = new Set(force ? paths : paths.filter((x) => !pinned.has(x)));
    if (!gone.size) return;
    gone.forEach((x) => document.querySelectorAll<HTMLElement>(`.tabbar [data-path="${CSS.escape(x)}"]`).forEach((el) => el.style.setProperty("--tw", `${el.offsetWidth}px`)));
    setClosing((c) => new Set([...c, ...gone]));
    setTimeout(() => {
      setTabs((p) => {
        const keep = p.filter((t) => !gone.has(t.node.path));
        p.filter((t) => gone.has(t.node.path)).forEach(revoke);
        setAct((a) => a.map((x, i) => (x && gone.has(x) ? nearIn(i as 0 | 1, x, p, gone) : x)) as Pair<string | null>);
        setGrp((g) => grpDel(g, gone));
        return keep;
      });
      setChk((c) => c + 1);
      paths.forEach((x) => dropStates((k) => k.endsWith(`:${x}`)));
      setClosing((c) => { const n = new Set(c); gone.forEach((x) => n.delete(x)); return n; });
    }, ms(220));
  };
  const close = (path: string) => {
    if (pinned.has(path)) return;
    const t = tabOf(path);
    if (t && st.confirmClose && isText(t) && t.text !== t.saved && !confirm(i18next.t("{{name}} は保存されていません。閉じますか?", { name: t.node.name }))) return;
    closeMany([path], true);
  };
  // 分割中、もう一方の画面にも出しているタブは、この画面から外すだけにする
  const closeIn = (path: string, i: 0 | 1) => {
    const o = i === 0 ? 1 : 0;
    if (!split || !mem(o, path)) return close(path);
    setChk((c) => c + 1);
    if (i === 0) setGrp((g) => grpAdd(grpDel(g, [path], 0), 1, path)); else setGrp((g) => grpAdd(grpDel(g, [path], 1), 0, path));
    setAct((a) => (a[i] === path ? (i === 0 ? [nearIn(0, path), a[1]] : [a[0], nearIn(1, path)]) : a));
  };

  // 保存。設定に応じて、行末の空白を削り、末尾に改行を入れる
  const saveTab = useCallback(async (t: Tab, quiet = false) => {
    if (!isText(t)) return;
    let text = t.text;
    if (st.trimOnSave) text = text.replace(/[ \t]+$/gm, "");
    if (st.finalNewline && text && !text.endsWith("\n")) text += "\n";
    const mark = () => { setTabs((p) => p.map((x) => (x.node.path === t.node.path ? { ...x, text: x.text === t.text ? text : x.text, saved: text } : x))); setPreview((v) => (v === t.node.path ? null : v)); };
    if (!t.node.handle) { mark(); return quiet ? undefined : flash(i18next.t("デモのファイルは、保存先がありません")); }
    try { await writeFile(t.node.handle as FileSystemFileHandle, t.eol === "crlf" && st.remoteKeepEol ? text.replace(/\n/g, "\r\n") : text); mark(); noteSave(); recordSave(t.node.path, text, t.saved); setGitTick((n) => n + 1); if (!quiet) flash(i18next.t("保存しました")); }
    catch (e) { flash(i18next.t("保存できませんでした: {{m}}", { m: (e as Error).message }), "error"); }
  }, [st.trimOnSave, st.finalNewline, st.remoteKeepEol]); // eslint-disable-line react-hooks/exhaustive-deps
  // 改行コードの切り替え。保存し直すまでは、ファイルは変わらない(未保存の印をつける)
  const toggleEol = () => { if (!tab || !isText(tab)) return; const eol = tab.eol === "crlf" ? "lf" : "crlf"; setTabs((p) => p.map((x) => (x.node.path === tab.node.path ? { ...x, eol, saved: x.saved + "\u0000" } : x))); flash(i18next.t("改行コードを {{arg0}} にしました。保存すると反映されます", { arg0: eol === "crlf" ? "CRLF" : "LF" })); };
  const save = useCallback(async () => { if (tab) await saveTab(tab); }, [tab, saveTab]);

  // 自動保存: 手を止めてから、設定の秒数がたつと、保存先のあるファイルを保存する
  useEffect(() => {
    if (!st.autoSave) return;
    const list = dirtyList.filter((t) => t.node.handle);
    if (!list.length) return;
    const h = setTimeout(() => list.forEach((t) => saveTab(t, true)), st.autoSave * 1000);
    return () => clearTimeout(h);
  }, [tabs, st.autoSave, saveTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Git: 開いているフォルダがリポジトリなら、変更のあるファイルと、HEAD との差の元になる内容を調べる(読むだけ)
  const [gits, setGits] = useState<Record<string, GitInfo | null>>({});
  const [gitTick, setGitTick] = useState(0);
  const [bases, setBases] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const h = () => setGitTick((n) => n + 1);
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }, []);
  useEffect(() => {
    if (!st.gitStatus) { setGits({}); return; }
    let live = true;
    const h = setTimeout(async () => {
      const out: Record<string, GitInfo | null> = {};
      await Promise.all(roots.map(async (r) => { if (r.conn) out[r.prefix] = await loadGit(r.conn, r.conn.path); }));
      if (live) setGits(out);
    }, 300);
    return () => { live = false; clearTimeout(h); };
  }, [roots, gitTick, st.gitStatus]);
  const absOf = (n: Node) => (n.handle && (n.handle as { path?: string }).path) || null;
  const gitMark = useCallback((n: Node): GitMark | undefined => {
    const info = gits[splitRoot(n.path).prefix], abs = absOf(n);
    if (!info || !abs) return undefined;
    return n.kind === "dir" ? (info.dirs.has(abs) ? "dir" : undefined) : info.files.get(abs);
  }, [gits]);
  useEffect(() => {
    let live = true;
    for (const path of new Set([act[0], act[1]])) {
      const t = tabs.find((x) => x.node.path === path);
      const r = roots.find((x) => x.prefix === splitRoot(path ?? "").prefix), info = r && gits[r.prefix], abs = t && absOf(t.node);
      if (!t || !isText(t) || !r?.conn || !info || !abs) { setBases((b) => (path && b[path] !== undefined ? { ...b, [path]: null } : b)); continue; }
      void loadBase(r.conn, abs, info.files.get(abs)).then((v) => { if (live) setBases((b) => (b[path!] === v ? b : { ...b, [path!]: v })); });
    }
    return () => { live = false; };
  }, [gits, act[0], act[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    const got = await Promise.all(roots.map(async (r) => ({ prefix: r.prefix, handle: r.handle, nodes: r.handle ? await readDir(r.handle, r.prefix).catch(() => null) : null })));
    // 1 つも読めなかったとき(切断など)は、呼び出し元に知らせる
    if (got.some((g) => g.handle) && got.every((g) => !g.handle || !g.nodes)) throw new Error(i18next.t("ファイル一覧を読み込めませんでした"));
    setRoots((p) => p.map((r) => { const g = got.find((x) => x.prefix === r.prefix && x.handle === r.handle); return g?.nodes ? { ...r, nodes: g.nodes } : r; }));
    setRev((r) => r + 1);
  };
  /* ---------- ワークスペース ---------- */
  const snapshot = (): WsState => ({
    tabs: tabs.map((t) => t.node.path), act, fp, split, g: split ? [[...grp[0]], [...grp[1]]] : undefined, side, panel, term: term && alive().length > 0,
    terms: st.wsTerms ? alive().map((x) => ({ name: x.name, cwd: x.cwd ?? (x.shell ? undefined : root.conn?.path), shell: x.shell, label: x.label, host: x.host })) : [],
    actTerm: Math.max(0, alive().findIndex((x) => x.id === actT)),
  });
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const flushWs = () => {
    clearTimeout(wsTimer.current);
    if (!restoring.current && activeWs.current) saveState(activeWs.current, snapRef.current());
  };
  const flushRef = useRef(flushWs);
  flushRef.current = flushWs;
  // 状態が変わったら、少し待ってから書き戻す
  useEffect(() => {
    if (!activeWs.current || restoring.current) return;
    clearTimeout(wsTimer.current);
    wsTimer.current = setTimeout(() => flushRef.current(), st.wsDelay);
    return () => clearTimeout(wsTimer.current);
  }, [tabs, act, fp, split, grp, side, panel, term, sess, st.wsDelay, st.wsTerms]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = () => flushRef.current();
    addEventListener("pagehide", f);
    return () => removeEventListener("pagehide", f);
  }, []);

  // フォルダ(複数も可)を切り替える。対応するワークスペースがあれば、その状態(タブ・分割・ターミナル)も戻す
  const enterMany = async (specs: Spec[], target?: Workspace) => {
    if (dirtyList.length && st.confirmClose && !confirm(i18next.t("保存していない変更が {{length}} 件あります。切り替えると失われます。続けますか?", { length: dirtyList.length }))) return false;
    flushWs();
    restoring.current = true;
    const my = ++gen.current;
    const main = specs[0];
    try {
      const lists = await Promise.all(specs.map((x) => (x.handle ? readDir(x.handle, x.prefix) : Promise.resolve(DEMO_TREE))));
      const hit = target ?? (st.wsRegister && main.handle && specs.length === 1 ? await matchRoot(main.ref, main.handle) : null);
      const restored: Tab[] = [];
      if (hit) {
        const got = await Promise.all(hit.tabs.map(async (p) => {
          let sp: Spec | undefined;
          for (const x of specs) if (x.handle && (!x.prefix ? !sp : p.startsWith(x.prefix + "/") && (!sp || x.prefix.length > sp.prefix.length))) sp = x;
          const n = sp?.handle ? await nodeAt(sp.handle, p, sp.prefix) : null;
          if (!n) return null;
          try {
            const { view, info } = await load(n);
            const text = view.kind === "text" ? view.text : "";
            return { node: n, view, info, text, saved: text, eol: view.kind === "text" ? view.eol ?? "lf" : "lf" } as Tab;
          } catch { return null; }
        }));
        got.forEach((t) => t && restored.push(t));
      }
      if (my !== gen.current) return false; // 待っている間に、別の切り替えが始まった
      tabs.forEach(revoke); dropStates(() => true);
      setRoots(specs.map((x, i) => (x.handle ? { prefix: x.prefix, name: x.name, handle: x.handle, nodes: lists[i], conn: x.conn, ref: x.ref } : { prefix: "", name: DEMO_NAME, nodes: DEMO_TREE, ref: { kind: "demo" } as RootRef })));
      setFolded(new Set());
      setTabs(restored);
      const has = (p: string | null | undefined) => !!p && restored.some((t) => t.node.path === p);
      const a0 = hit && has(hit.act[0]) ? hit.act[0] : restored[0]?.node.path ?? null;
      const a1 = hit && hit.split ? (has(hit.act[1]) ? hit.act[1] : a0) : null;
      setAct([a0, a1]); setFp(hit?.split && hit.fp === 1 ? 1 : 0);
      setSplit(!!hit?.split && restored.length > 0);
      setGrp(hit?.split && restored.length ? (hit.g ? [new Set(hit.g[0].filter(has)), new Set(hit.g[1].filter(has))] : [new Set(restored.map((t) => t.node.path)), new Set(a1 ? [a1] : [])]) : [new Set(), new Set()]);
      if (hit) { setSide(hit.side); setPanel(hit.panel === "search" ? "files" : hit.panel); }
      // ターミナル: 開き直したシェルを、同じ場所で立ち上げる
      setSess([]);
      const list = hit && st.wsTerms ? hit.terms.slice(0, st.termMax) : [];
      const made = list.map((t, i) => ({ id: ++seq.current, num: i + 1, name: t.name, cwd: t.cwd, shell: t.shell, label: t.label, host: t.host }));
      setSess(made);
      setActT(made[Math.min(hit?.actTerm ?? 0, made.length - 1)]?.id ?? 0);
      setTerm(!!hit?.term && made.length > 0);
      if (made.length) setTermKey((k) => k + 1);
      setRev((r) => r + 1);
      // ワークスペースへの登録
      let w = hit;
      if (!w && st.wsRegister && main.ref.kind !== "demo") {
        w = createWs(main.name, main.ref, { tabs: [], act: [null, null], fp: 0, split: false, side: true, panel: "files", term: false, terms: [], actTerm: 0 }, st.wsMax);
        if (specs.length > 1) setWsRoots(w.id, specs.map((x) => ({ ref: x.ref, prefix: x.prefix })));
      }
      if (w) for (const x of specs) if (x.ref.kind === "local" && x.handle) await putHandle(handleKey(w.id, x.prefix), x.handle);
      activeWs.current = w?.id ?? null;
      setCurrent(w?.id ?? null);
      if (w?.profile && st.wsProfileLink && getProfiles().list.some((p) => p.id === w!.profile)) switchProfile(w.profile);
      return true;
    } finally { if (my === gen.current) restoring.current = false; }
  };
  // 1 つのフォルダを開く。同じフォルダを先頭にした複数フォルダのワークスペースがあれば、それをまとめて開く
  const enter = async (name: string, handle: FileSystemDirectoryHandle | undefined, ref: RootRef, conn?: Conn, target?: Workspace) => {
    const hit = target ?? (st.wsRegister && handle ? await matchRoot(ref, handle) : null);
    if (!target && hit && wsRoots(hit).length > 1) return openWs(hit);
    return enterMany([{ prefix: "", name, handle, conn, ref }], hit ?? undefined);
  };
  // 保存してあるフォルダ 1 つぶんを、開ける形にする(PC のフォルダは、保存したハンドルの許可を確かめる。ask: 許可の確認を出してよいか)
  const specOf = async (w: Workspace, e: RootEntry, ask: boolean): Promise<Spec> => {
    const c = connOf(e.ref);
    if (c) {
      await checkDir(c);
      return { prefix: e.prefix, name: (e.ref as { name: string }).name, handle: rootHandle(c) as unknown as FileSystemDirectoryHandle, conn: c, ref: e.ref };
    }
    if (e.ref.kind === "local") {
      if (IS_TAURI) throw new Error(i18next.t("このフォルダはブラウザ版で保存したものです。「フォルダを開く」から開き直してください"));
      const h = await getHandle(handleKey(w.id, e.prefix));
      if (!h) throw new Error(i18next.t("フォルダの記憶が見つかりません。「フォルダを開く」から開き直してください"));
      if (!(await canUse(h, ask))) throw new Error(i18next.t("フォルダへのアクセスが許可されていません。もう一度、一覧から選んでください"));
      return { prefix: e.prefix, name: e.ref.name, handle: h, ref: e.ref };
    }
    return { prefix: "", name: DEMO_NAME, ref: e.ref };
  };
  // ワークスペースを開く。先頭のフォルダが開けなければ失敗にし、追加したフォルダは開けないものだけ飛ばす
  const openWs = async (w: Workspace, ask = true) => {
    const specs: Spec[] = [];
    let skipped = 0;
    for (const [i, e] of wsRoots(w).entries()) {
      try { specs.push(await specOf(w, e, ask)); } catch (err) { if (i === 0) throw err; skipped++; }
    }
    const ok = await enterMany(specs, w);
    if (ok) flash(skipped ? i18next.t("ワークスペース「{{name}}」を開きました(開けないフォルダが {{n}} 件あります)", { name: w.name, n: skipped }) : i18next.t("ワークスペース「{{name}}」を開きました", { name: w.name }));
    return ok;
  };
  const saveNew = async (name: string) => {
    const w = createWs(name, root.ref, snapshot(), st.wsMax);
    if (roots.length > 1) setWsRoots(w.id, roots.map((r) => ({ ref: r.ref, prefix: r.prefix })));
    for (const r of roots) if (r.ref.kind === "local" && r.handle) await putHandle(handleKey(w.id, r.prefix), r.handle);
    activeWs.current = w.id; setCurrent(w.id);
    flash(i18next.t("ワークスペース「{{name}}」を保存しました", { name: w.name }));
    return w.id;
  };
  const quickSave = () => {
    if (activeWs.current) { saveState(activeWs.current, snapshot()); flash(i18next.t("ワークスペース「{{arg0}}」に保存しました", { arg0: findWs(activeWs.current)?.name })); } else setWsDlg("ws");
  };
  // 起動したとき、前回のワークスペースを開く(PC のフォルダは許可が要るので、確認できなければ一覧を出す)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const w = findWs(getWorkspaces().current);
      const mine = gen.current;
      try {
        if (st.wsRestore && w && w.root.kind !== "demo") { flash(i18next.t("ワークスペースを開いています…")); await openWs(w, false); }
        else if (w) setCurrent(null);
      } catch (e) {
        if (gen.current !== mine) return; // 待っている間に、利用者が別のフォルダを開いた
        setCurrent(null);
        if (w) { setWsDlg("ws"); flash(i18next.t("「{{name}}」は、一覧から選ぶと開けます", { name: w.name })); } else flash((e as Error).message, "error");
      } finally { if (gen.current === mine) restoring.current = false; }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // フォルダを選ぶ(exe は OS のダイアログで選び、Rust 側の std::fs で読み書きする。ブラウザの保存確認は出ない)
  const pickAny = async (): Promise<{ name: string; handle: FileSystemDirectoryHandle; ref: RootRef; conn?: Conn } | null> => {
    if (IS_TAURI) {
      const path = await pickPcFolder(i18next.t("フォルダを開く"));
      if (!path) return null;
      const conn: Conn = { kind: "pc", path };
      pushRecent(conn);
      return { ...connTarget(conn), conn };
    }
    try {
      const p = await pickFolder();
      return { name: p.name, handle: p.handle, ref: rootRefOf(undefined, p.name, true) };
    } catch { return null; /* キャンセル */ }
  };
  const connTarget = (conn: Conn) => {
    const name = conn.path === "/" ? "/" : conn.path.split("/").pop()!;
    return { name, handle: rootHandle(conn) as unknown as FileSystemDirectoryHandle, ref: rootRefOf(conn, name, true) };
  };
  // エクスプローラーへ、OS のフォルダ・ファイルをドロップして開く(先頭がフォルダならそのフォルダを開き、ファイルだけなら各ファイルをタブで開く)
  const hasFiles = (e: React.DragEvent) => !drag.node && !drag.tab && e.dataTransfer.types.includes("Files");
  const dropExternal = async (e: React.DragEvent) => {
    setRootDrop(false); setExtDrop(false);
    if (!hasFiles(e)) return;
    e.preventDefault();
    const items = [...e.dataTransfer.items].filter((i) => i.kind === "file");
    const hs = await Promise.all(items.map((i) => (i as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? null));
    try {
      const dir = hs.find((h): h is FileSystemDirectoryHandle => h?.kind === "directory");
      if (dir) { await enter(dir.name, dir, rootRefOf(undefined, dir.name, true)); return; }
      const files = hs.filter((h): h is FileSystemFileHandle => h?.kind === "file");
      if (!files.length) { flash(i18next.t("ここへはドロップできません"), "error"); return; }
      for (const f of files) await open({ name: f.name, path: f.name, kind: "file", handle: f }, fp, true);
    } catch (err) { flash((err as Error).message, "error"); }
  };
  const openFolder = async () => {
    try {
      const p = await pickAny();
      if (p) await enter(p.name, p.handle, p.ref, p.conn);
    } catch (e) { flash((e as Error).message, "error"); }
  };

  // WSL・SSH のフォルダを開く。ファイルのハンドルと同じ形で扱うので、一覧・保存・検索はそのまま使える
  const connect = async (conn: Conn) => {
    const t = connTarget(conn);
    if (await enter(t.name, t.handle, t.ref, conn)) flash(i18next.t("{{arg0}} に接続しました", { arg0: connLabel(conn) }));
  };

  // フォルダをワークスペースに足す(VSCode の「ワークスペースにフォルダを追加」)。サンプルを開いているときは、普通に開く
  const sameFolder = async (r: Root, ref: RootRef, handle: FileSystemDirectoryHandle, conn?: Conn) => {
    if (!r.handle) return false;
    if (conn && r.conn) return connKey(conn) === connKey(r.conn);
    if (conn || r.conn || ref.kind !== "local") return false;
    try { return await r.handle.isSameEntry(handle); } catch { return false; }
  };
  const addRoot = async (name: string, handle: FileSystemDirectoryHandle, ref: RootRef, conn?: Conn) => {
    if (!root.handle) return enter(name, handle, ref, conn);
    for (const r of roots) if (await sameFolder(r, ref, handle, conn)) { flash(i18next.t("既に追加されています")); return false; }
    try {
      const prefix = newPrefix();
      const nodes = await readDir(handle, prefix);
      const next = [...roots, { prefix, name, handle, nodes, conn, ref }];
      setRoots(next);
      if (activeWs.current) {
        setWsRoots(activeWs.current, next.map((r) => ({ ref: r.ref, prefix: r.prefix })));
        if (ref.kind === "local") await putHandle(handleKey(activeWs.current, prefix), handle);
      }
      setSide(true); setPanel("files");
      setRev((r) => r + 1);
      flash(i18next.t("「{{name}}」を追加しました", { name }));
      return true;
    } catch (e) { flash((e as Error).message, "error"); return false; }
  };
  const addFolder = async () => {
    try {
      const p = await pickAny();
      if (p) await addRoot(p.name, p.handle, p.ref, p.conn);
    } catch (e) { flash((e as Error).message, "error"); }
  };
  const addConn = async (conn: Conn) => { const t = connTarget(conn); await addRoot(t.name, t.handle, t.ref, conn); };
  // フォルダをワークスペースから外す(ディスク上のフォルダは消さない)
  const removeRoot = (prefix: string) => {
    const r = roots.find((x) => x.prefix === prefix);
    if (!r || roots.length < 2) return;
    const under = tabs.filter((t) => rootOfPath(t.node.path) === r);
    if (under.some((t) => dirtyList.includes(t)) && st.confirmClose && !confirm(i18next.t("保存していない変更があります。フォルダを外すと失われます。続けますか?"))) return;
    closeMany(under.map((t) => t.node.path), true);
    const next = roots.filter((x) => x !== r);
    setRoots(next);
    if (activeWs.current) setWsRoots(activeWs.current, next.map((x) => ({ ref: x.ref, prefix: x.prefix })));
    flash(i18next.t("「{{name}}」をワークスペースから外しました", { name: r.name }));
  };
  // 画面に戻ったとき、外で変わったファイルの一覧を読み直す
  useEffect(() => {
    if (!roots.some((r) => r.conn) || !st.remoteFocusReload) return;
    let busy = false;
    const f = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try { await reload(); } catch { /* 切れているときは、そのまま */ } finally { busy = false; }
    };
    addEventListener("focus", f);
    return () => removeEventListener("focus", f);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const parentDir = (n: Node | null) => (n ? (n.kind === "dir" ? n : null) : null);
  const create = (kind: "file" | "dir", at: Node | null) => {
    const rr = at ? rootOf(at) : roots[0];
    const base = at ? at.path : rr.prefix;
    setDlg({
      title: kind === "file" ? i18next.t("新規ファイル") : i18next.t("新規フォルダ"), desc: at ? i18next.t("{{path}} に作ります", { path: displayPath(at.path) || rr.name }) : i18next.t("{{name}} の直下に作ります", { name: rr.name }), input: "", placeholder: kind === "file" ? i18next.t("例: index.ts") : i18next.t("例: components"), ok: i18next.t("作る"),
      validate: (v) => (/[\\/]/.test(v) ? i18next.t("「/」は使えません") : !rr.handle && exists(rr.nodes, `${base}/${v.trim()}`) ? i18next.t("同じ名前があります") : null),
      onSubmit: async (name) => {
        try {
          if (rr.handle) {
            const dir = (parentDir(at)?.handle ?? rr.handle) as FileSystemDirectoryHandle;
            const h = kind === "file" ? await createFile(dir, name) : await createDir(dir, name);
            await reload();
            if (kind === "file") open({ name, path: `${base}/${name}`, kind: "file", handle: h, parent: dir });
          } else {
            const n: Node = kind === "file" ? { name, path: `${base}/${name}`, kind: "file", demo: "" } : { name, path: `${base}/${name}`, kind: "dir", children: [] };
            updRoot(rr.prefix, (r) => ({ ...r, nodes: addNode(r.nodes, base, n) }));
            if (kind === "file") open(n);
          }
        } catch (e) { flash("作れませんでした: " + (e as Error).message); }
      },
    });
  };
  const rename = (n: Node) => {
    const rr = rootOf(n);
    if (n.kind === "dir" && rr.handle && !rr.conn) return flash(i18next.t("フォルダの名前の変更は、まだできません"));
    setDlg({
      title: i18next.t("名前の変更"), input: n.name, ok: i18next.t("変更"),
      validate: (v) => (/[\\/]/.test(v) ? i18next.t("「/」は使えません") : v.trim() !== n.name && exists(rr.nodes, `${dirOf(n.path)}/${v.trim()}`) ? i18next.t("同じ名前があります") : null),
      onSubmit: async (name) => {
        if (name === n.name) return;
        try {
          const np = `${dirOf(n.path)}/${name}`; if (n.kind === "file") moveFile(n.path, np);
          let handle = n.handle;
          if (rr.conn) {
            const parent = (n.parent ?? rr.handle) as unknown as RemoteDir;
            await parent.rename(n.name, name);
            handle = n.kind === "file" ? new RemoteFile(rr.conn, `${parent.path === "/" ? "" : parent.path}/${name}`, name) as unknown as FileSystemHandle : undefined;
            if (n.kind === "dir") closeMany(tabs.filter((t) => t.node.path.startsWith(n.path + "/")).map((t) => t.node.path), true);
          } else if (rr.handle && n.kind === "file") handle = await renameFile((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.handle as FileSystemFileHandle, name);
          else updRoot(rr.prefix, (r) => ({ ...r, nodes: renameNode(r.nodes, n.path, name) }));
          setTabs((p) => p.map((t) => (t.node.path === n.path ? { ...t, node: { ...t.node, name, path: np, handle } } : t)));
          setGrp((g) => g.map((x) => (x.has(n.path) ? new Set([...x].map((q) => (q === n.path ? np : q))) : x)) as Pair<Set<string>>);
          setAct((a) => a.map((x) => (x === n.path ? np : x)) as Pair<string | null>);
          dropStates((k) => k.endsWith(`:${n.path}`));
          if (rr.handle) await reload();
        } catch (e) { flash("変更できませんでした: " + (e as Error).message); }
      },
    });
  };
  // ドラッグで別のフォルダへ移す(dest が null なら最上位)。別のルートのフォルダへは移せない
  const moveTo = async (n: Node, dest: Node | null) => {
    const rr = rootOf(n);
    if (dest && rootOf(dest) !== rr) return flash(i18next.t("別のフォルダへは移せません"));
    const base = dest ? dest.path : rr.prefix;
    if (dirOf(n.path) === base || (n.kind === "dir" && (base === n.path || base.startsWith(n.path + "/")))) return;
    if (exists(rr.nodes, `${base}/${n.name}`)) return flash(i18next.t("同じ名前があります"));
    const under = tabs.filter((t) => t.node.path === n.path || t.node.path.startsWith(n.path + "/"));
    if (under.some((t) => dirtyList.includes(t))) return flash(i18next.t("保存していない変更があるので、移せません"));
    try {
      const np = `${base}/${n.name}`, to = (dest?.handle ?? rr.handle) as FileSystemDirectoryHandle | undefined;
      let handle = n.handle;
      if (rr.conn) {
        const from = (n.parent ?? rr.handle) as unknown as RemoteDir, d = to as unknown as RemoteDir;
        await from.moveTo(n.name, d);
        handle = n.kind === "file" ? (new RemoteFile(rr.conn, `${d.path === "/" ? "" : d.path}/${n.name}`, n.name) as unknown as FileSystemHandle) : undefined;
      } else if (rr.handle && n.handle && to) handle = await moveEntry((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.handle, to);
      else updRoot(rr.prefix, (r) => ({ ...r, nodes: moveNode(r.nodes, n.path, base) }));
      if (n.kind === "dir") closeMany(under.map((t) => t.node.path), true);
      else {
        setTabs((p) => p.map((t) => (t.node.path === n.path ? { ...t, node: { ...t.node, path: np, handle, parent: to } } : t)));
        setAct((a) => a.map((x) => (x === n.path ? np : x)) as Pair<string | null>);
        setGrp((g) => g.map((x) => (x.has(n.path) ? new Set([...x].map((q) => (q === n.path ? np : q))) : x)) as Pair<Set<string>>);
      }
      dropStates((k) => k.endsWith(`:${n.path}`));
      if (rr.handle) await reload();
      flash(i18next.t("「{{name}}」を移しました", { name: n.name }));
    } catch (e) { flash("移せませんでした: " + (e as Error).message); }
  };
  const remove = (n: Node) => {
    const rr = rootOf(n);
    setDlg({
      title: i18next.t("「{{name}}」を削除", { name: n.name }), desc: n.kind === "dir" ? i18next.t("中のファイルもすべて消えます。元に戻せません。") : i18next.t("元に戻せません。"), ok: i18next.t("削除"), danger: true,
      onSubmit: async () => {
        try {
          if (rr.handle) await removeEntry((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.name);
          else updRoot(rr.prefix, (r) => ({ ...r, nodes: removeNode(r.nodes, n.path) }));
          closeMany(tabs.filter((t) => t.node.path === n.path || t.node.path.startsWith(n.path + "/")).map((t) => t.node.path), true);
          if (rr.handle) await reload();
          flash(i18next.t("削除しました"));
        } catch (e) { flash("削除できませんでした: " + (e as Error).message); }
      },
    });
  };
  const abs = (n: Node) => {
    const rr = rootOf(n);
    return n.handle && "path" in n.handle ? (n.handle as unknown as { path: string }).path : (rr.conn?.path ?? "") + n.path.slice(rr.prefix.length);
  };
  const copyText = (s: string, m = i18next.t("コピーしました")) => navigator.clipboard.writeText(s).then(() => flash(m), () => flash(i18next.t("コピーできませんでした")));

  /* ---------- 分割・ターミナル ---------- */
  useEffect(() => {
    if (split) {
      setSplitMount(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setSplitOpen(true)));
      return () => cancelAnimationFrame(r);
    }
    setSplitOpen(false);
    const t = setTimeout(() => setSplitMount(false), ms(700));
    return () => clearTimeout(t);
  }, [split]);
  // 分割を解く。いまフォーカスのある画面のファイルを残す
  const closePane = () => {
    if (!split) return;
    const keep = act[fp];
    setAct([keep, keep]); setJump((j) => [j[fp], j[fp]]); setSplit(false); setFp(0); setGrp([new Set(), new Set()]);
  };
  // 閉じる・送るで片方の画面が空になったら、分割を解く(空の画面にトップページを出さない)
  useEffect(() => {
    if (!chk || chk === seen.current || closing.size) return;
    seen.current = chk;
    if (!split) return;
    const e0 = paneTabs(0).length === 0, e1 = paneTabs(1).length === 0;
    if (!e0 && !e1) return;
    if (e0 && e1) { setSplit(false); setFp(0); setGrp([new Set(), new Set()]); return; }
    const keep = act[e0 ? 1 : 0];
    setAct([keep, keep]); setJump((j) => [j[e0 ? 1 : 0], j[e0 ? 1 : 0]]); setSplit(false); setFp(0); setGrp([new Set(), new Set()]);
  }, [chk, tabs, grp, closing]); // eslint-disable-line react-hooks/exhaustive-deps
  // 分割を始める。左にはいまのタブをすべて残し、右には(あれば)開いているタブを複製する
  const beginSplit = (dup?: string | null) => { setSplit(true); setGrp([new Set(tabs.map((t) => t.node.path)), new Set(dup ? [dup] : [])]); };
  const toggleSplit = () => {
    if (split) { closePane(); return; }
    beginSplit(act[0]); setAct((a) => [a[0], a[0]]); setFp(1);
  };
  const openSplit = async (n: Node) => { if (!split) beginSplit(); await open(n, fp === 0 ? 1 : 0); };
  // 指定の画面で開く。move なら、元の画面には隣のタブを出す
  const sendTo = async (n: Node, to: 0 | 1, move = false) => {
    const from = to === 0 ? 1 : 0;
    if (!split) { if (to === 1) beginSplit(); else return open(n, 0); }
    const nb = nearIn(from, n.path);
    await open(n, to);
    if (!move) return;
    setChk((c) => c + 1);
    setGrp((g) => grpDel(g, [n.path], from));
    setAct((a) => {
      if (a[from] !== n.path) return a;
      const x = [...a] as Pair<string | null>;
      x[from] = nb;
      return x;
    });
  };
  const doSwap = () => { setAct((a) => [a[1], a[0]]); setGrp((g) => [g[1], g[0]]); setJump((j) => [j[1], j[0]]); setCur((c) => [c[1], c[0]]); setFp((p) => (p === 0 ? 1 : 0)); };
  const swapPanes = () => { if (!split) return; doSwap(); };
  // 方向を決めて分割して開く。左・上に置くときは、開いたあとで画面を入れ替える
  const splitDrop = async (n: Node, d: "L" | "R" | "T" | "B", move = false) => {
    const dir = d === "L" || d === "R" ? "col" : "row";
    if (st.splitDir !== dir) update({ splitDir: dir });
    await sendTo(n, 1, move);
    if (d === "L" || d === "T") doSwap();
  };
  // 分割して開くメニュー(分割していないとき用)
  const splitSub = (n: Node, move = false) => ({
    label: i18next.t("分割して開く"), icon: ic(Columns2),
    sub: [
      { label: i18next.t("左に分割"), icon: ic(PanelLeft), run: () => splitDrop(n, "L", move) },
      { label: i18next.t("右に分割"), icon: ic(PanelRight), run: () => splitDrop(n, "R", move) },
      { label: i18next.t("上に分割"), icon: ic(PanelTop), run: () => splitDrop(n, "T", move) },
      { label: i18next.t("下に分割"), icon: ic(PanelBottom), run: () => splitDrop(n, "B", move) },
    ],
  });
  const flipDir = () => update({ splitDir: st.splitDir === "col" ? "row" : "col" });
  const reorder = (path: string, target: string, after: boolean) => setTabs((p) => {
    const m = p.find((t) => t.node.path === path);
    if (!m || path === target) return p;
    const rest = p.filter((t) => t !== m), i = rest.findIndex((t) => t.node.path === target);
    if (i < 0) return p;
    rest.splice(i + (after ? 1 : 0), 0, m);
    return [...rest.filter((t) => pinned.has(t.node.path)), ...rest.filter((t) => !pinned.has(t.node.path))];
  });
  const togglePin = (path: string) => {
    const on = !pinned.has(path), next = new Set(pinned);
    if (on) next.add(path); else next.delete(path);
    setPinned(next);
    setTabs((p) => {
      const m = p.find((t) => t.node.path === path);
      if (!m) return p;
      const rest = p.filter((t) => t !== m), k = rest.filter((t) => next.has(t.node.path)).length;
      rest.splice(k, 0, m);
      return rest;
    });
  };
  // ドラッグ中、ポインタがどの画面の上か。分割していないときは、端に寄せると「新しく分割」になる
  const zoneOf = (e: React.DragEvent): Dz => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (!split) { // 分割していないときは、上下左右の端に寄せると、その側に新しく分割する
      const m = Math.min(fx, 1 - fx, fy, 1 - fy);
      if (m > 0.28) return 0;
      return m === fx ? "L" : m === 1 - fx ? "R" : m === fy ? "T" : "B";
    }
    return (st.splitDir === "row" ? fy : fx) < st.splitRatio / 100 ? 0 : 1;
  };
  const dropOnPanes = async (z: Dz) => {
    const n = drag.node, path = drag.tab;
    dragEnd(); setDz(null); setTabDrop(null);
    const node = n ?? tabOf(path);
    if (!node) return;
    const nd = "node" in node ? node.node : node;
    if (typeof z === "string") await splitDrop(nd, z, !!path && tabs.length > 1);
    else await sendTo(nd, z, !!path);
  };
  const gripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget.parentElement!, row = st.splitDir === "row";
    const mv = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect(), f = row ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
      update({ splitRatio: Math.round(Math.min(80, Math.max(20, f * 100))) });
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setDragS(false); };
    setDragS(true); addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };
  // ターミナル: 開く・閉じるは、すべてここを通す(動きと、開き直しの扱いをそろえるため)
  const alive = () => sessRef.current.filter((x) => !x.exiting);
  const newTerm = (cwd?: string, sh?: ShellOpt, host?: string | null) => {
    if (alive().length >= st.termMax) { flash(i18next.t("ターミナルは {{termMax}} 個までです", { termMax: st.termMax })); return; }
    const used = new Set(alive().map((x) => x.num));
    let num = 1; while (used.has(num)) num++;
    const id = ++seq.current;
    setSess((p) => [...p.filter((x) => !x.exiting), { id, num, cwd: cwd ?? (sh ? undefined : root.conn?.path), shell: sh?.id, label: sh?.label, host }]);
    setActT(id);
  };
  const shellMenu = async (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const list = await listShells();
    const ssh = root.conn?.kind === "ssh" ? root.conn : null;
    const full = alive().length >= st.termMax;
    setMenu({
      x: r.left, y: r.bottom + 6,
      items: [
        { type: "title", label: i18next.t("ターミナルの種類") },
        ...(ssh ? [{ label: i18next.t("SSH · {{host}}", { host: ssh.host }), icon: ic(Server), disabled: full, run: () => addTerm() }] : []),
        ...list.map((x) => ({ label: x.label, icon: ic(TermIcon), disabled: full, run: () => addTerm(undefined, x) })),
        ...(!list.length && !ssh ? [{ label: i18next.t("標準のシェル"), icon: ic(TermIcon), disabled: full, run: () => addTerm() }] : []),
      ],
    });
  };
  const showTerm = (v = !term) => {
    clearTimeout(cleanT.current);
    if (v) {
      if (!alive().length) newTerm();
      setTerm(true); setTermKey((k) => k + 1);
    } else setTerm(false);
  };
  const addTerm = (cwd?: string, sh?: ShellOpt, host?: string | null) => { clearTimeout(cleanT.current); newTerm(cwd, sh, host); setTerm(true); setTermKey((k) => k + 1); };
  // 画面をひとつ終える。最後の1つなら、パネルを閉じる動きのあとで消す
  const endTerm = (id: number) => {
    const rest = alive().filter((x) => x.id !== id);
    if (rest.length) {
      setSess((p) => p.filter((x) => x.id !== id));
      setActT((a) => (a === id ? (rest[Math.min(sessRef.current.findIndex((x) => x.id === id), rest.length - 1)] ?? rest[rest.length - 1]).id : a));
      return;
    }
    setSess((p) => p.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
    setTerm(false);
    clearTimeout(cleanT.current);
    cleanT.current = setTimeout(() => setSess((p) => p.filter((x) => !x.exiting)), ms(480));
  };
  const stepTerm = (d: number) => {
    const l = alive(); if (l.length < 2) return;
    const i = l.findIndex((x) => x.id === actT);
    setActT(l[(i + d + l.length) % l.length].id); setTermKey((k) => k + 1);
  };
  const nameOf = (x: Sess) => x.name || `${x.label ?? i18next.t("ターミナル")} ${x.num}`;
  const registerTerm = useCallback((id: number, api: TermApi | null) => { if (api) apis.current.set(id, api); else apis.current.delete(id); }, []);
  useEffect(() => {
    if (!term) { setShown(false); return; }
    let b = 0;
    const a = requestAnimationFrame(() => { b = requestAnimationFrame(() => setShown(true)); });
    return () => { cancelAnimationFrame(a); cancelAnimationFrame(b); };
  }, [term]);
  useEffect(() => { if (st.termOpenOnLaunch) showTerm(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const grip = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = st.termH;
    const mv = (ev: PointerEvent) => update({ termH: Math.round(Math.min(innerHeight * 0.7, Math.max(120, h0 + y0 - ev.clientY))) });
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setDragT(false); };
    setDragT(true); addEventListener("pointermove", mv); addEventListener("pointerup", up);
  };

  /* ---------- コマンド ---------- */
  const ev = () => views.current[fp];
  const run = (id: string) => {
    const f: Record<string, () => unknown> = {
      palette: () => setPal(true), quickOpen: () => setQo(true), save, openFolder, addFolder, connect: () => { setCnAdd(false); setCn(true); }, workspaces: () => setWsDlg("ws"), profiles: () => setWsDlg("profile"), saveWorkspace: quickSave, newFile: () => create("file", null), settings: () => setSetts("look"), shortcuts: () => setSetts("keys"),
      newTerm: () => addTerm(), closeTerm: () => alive().length && endTerm(actT), nextTerm: () => stepTerm(1), prevTerm: () => stepTerm(-1),
      renameTerm: () => { if (alive().length) { showTerm(true); setRenaming(actT); } }, clearTerm: () => apis.current.get(actT)?.clear(),
      aiQuote: () => { const v = views.current[fp]; if (v) quoteToAi(v); },
      toggleSide: () => setSide((v) => !v), themePanel: () => setTp((v) => !v), stats: () => setStatsOpen(true), toggleTerm: () => showTerm(), toggleBrowser: () => setBr((v) => !v), toggleAi: () => setAi((v) => !v), togglePreview: () => { if (tab && previewKind(tab.node.name)) setPv((p) => ({ ...p, [tab.node.path]: p[tab.node.path] === undefined ? "split" : p[tab.node.path] === "split" ? "preview" : undefined })); }, toggleSplit,
      otherPane: () => { if (split) { const n = fp === 0 ? 1 : 0; setFp(n); setTimeout(() => views.current[n]?.focus(), 0); } },
      swapPanes, splitDir: flipDir, closePane,
      moveTab: () => { if (tab) sendTo(tab.node, fp === 0 ? 1 : 0, true); },
      explorer: () => { setSide(true); setPanel("files"); },
      toggleTheme: () => update({ mode: isDark(st) ? "light" : "dark" }),
      zoomIn: () => update({ fontSize: Math.min(28, st.fontSize + 1) }), zoomOut: () => update({ fontSize: Math.max(10, st.fontSize - 1) }), zoomReset: () => update({ fontSize: def("fontSize") }),
      wrap: () => update({ wrap: !st.wrap }), gotoLine: () => { if (ev()) setPop("goto"); },
      closeTab: () => act[fp] && closeIn(act[fp]!, fp), closeAll: () => closeMany(tabs.map((t) => t.node.path)),
      nextTab: () => step(1), prevTab: () => step(-1),
      shot: () => {
        const v = ev(), n = act[fp];
        if (!v || !n) return;
        flash(i18next.t("画像を作っています…"));
        codeToPng(v, n.split("/").pop() || "code").then((b) => shareShot(b, n.split("/").pop() || "code")).then((r) => flash(r === "copied" ? i18next.t("画像をクリップボードにコピーしました") : i18next.t("画像を保存しました"))).catch(() => flash(i18next.t("画像を作れませんでした")));
      },
      goSymbol: () => { dispatchEvent(new Event(OUTLINE_EVENT)); },
      localHistory: () => { if (tab && isText(tab)) setLh(tab.node.path); },
      searchAll: () => {
        const v = ev(), s = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : "";
        setSeed(s && !s.includes("\n") ? s : ""); setSide(true); setPanel("search");
      },
    };
    if (f[id]) return f[id]();
    const v = ev();
    if (EDIT[id] && v) { v.focus(); EDIT[id](v); }
  };
  const step = (d: number) => {
    const l = paneTabs(fp);
    if (!l.length) return;
    const i = l.findIndex((t) => t.node.path === act[fp]);
    open(l[(i + d + l.length) % l.length].node);
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (rec.on) return;
      const c = comboOf(e);
      if (!c) return;
      const id = table(st.keys).get(c);
      if (!id) return;
      const t = e.target as HTMLElement, inEditor = !!t.closest?.(".cm-editor"), inTerm = !!t.closest?.(".xterm"), inField = /^(INPUT|TEXTAREA)$/.test(t.tagName) && !inTerm;
      const d = DEF[id];
      if (d.scope === "editor" && !inEditor) return;
      if (inTerm && !d.inTerm) return;
      if (inField && !c.includes("Mod") && !c.includes("Alt")) return;
      e.preventDefault(); e.stopPropagation();
      run(id);
    };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  });

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (st.confirmExit && dirtyList.length) e.preventDefault(); };
    addEventListener("beforeunload", h);
    return () => removeEventListener("beforeunload", h);
  });

  const cmds: Cmd[] = useMemo(() => [
    ...KEYS.map((k) => ({ id: k.id, label: i18next.t(k.label), group: i18next.t(k.group), keys: keyOf(k.id, st.keys), run: () => run(k.id) })),
    { id: "m-light", label: i18next.t("テーマ: ライト"), group: i18next.t("表示"), run: () => update({ mode: "light" }) },
    { id: "m-dark", label: i18next.t("テーマ: ダーク"), group: i18next.t("表示"), run: () => update({ mode: "dark" }) },
    { id: "m-auto", label: i18next.t("テーマ: OS に合わせる"), group: i18next.t("表示"), run: () => update({ mode: "auto" }) },
    { id: "bg", label: i18next.t("背景の色を変える"), group: i18next.t("表示"), run: () => setSetts("look") },
    { id: "refresh", label: i18next.t("ファイル一覧を更新"), group: i18next.t("全般"), run: reload },
    { id: "newDir", label: i18next.t("新規フォルダ"), group: i18next.t("全般"), run: () => create("dir", null) },
    { id: "copyPath", label: i18next.t("開いているファイルのパスをコピー"), group: i18next.t("全般"), run: () => act[fp] && copyText(act[fp]!.slice(1)) },
  ], [st.keys, tabs, act, fp, split, term, st.fontSize, st.wrap, st.mode, root]); // eslint-disable-line react-hooks/exhaustive-deps
  const wsCmds: Cmd[] = [
    ...cmds,
    ...wsStore.list.map((w) => ({ id: `ws-${w.id}`, label: i18next.t("ワークスペース: {{name}}", { name: w.name }), group: i18next.t("ワークスペース"), icon: <FolderKanban />, run: () => { openWs(w).catch((e) => flash((e as Error).message, "error")); } })),
    ...pfStore.list.map((p) => ({ id: `pf-${p.id}`, label: i18next.t("プロファイル: {{name}}{{arg1}}", { name: p.name, arg1: p.id === pfStore.active ? i18next.t("(使用中)") : "" }), group: i18next.t("プロファイル"), run: () => { switchProfile(p.id); flash(i18next.t("プロファイル「{{name}}」に切り替えました", { name: p.name })); } })),
  ];

  /* ---------- 右クリックメニュー ---------- */
  const K = (id: string) => keyOf(id, st.keys);
  const ic = (C: React.ComponentType) => <C />;
  // AI に送る範囲: 選択があれば選択範囲、なければファイル全体
  const aiRange = (v: EditorView) => {
    const s = v.state.selection.main, scope: Ctx["scope"] = s.empty ? "file" : "selection";
    const from = scope === "file" ? 0 : s.from, to = scope === "file" ? v.state.doc.length : s.to;
    return { scope, from, to, text: v.state.sliceDoc(from, to), name: tab?.node.name ?? i18next.t("無題") };
  };
  const askAi = (v: EditorView, action: AiAction, lang?: string) => {
    const r = aiRange(v);
    if (!r.text.trim()) return;
    setAi(true);
    setAiJob({ id: ++aiSeq.current, action, lang, view: v, ...r });
  };
  const aiCtx = (): Ctx | null => { const v = views.current[fp]; if (!v) return null; const r = aiRange(v); return r.text ? { name: r.name, text: r.text, scope: r.scope } : null; };
  // 選んだ文(なければ、いまの行)を、行番号つきで AI パネルへ引用する
  const quoteToAi = (v: EditorView) => {
    const sel = v.state.selection.main, d = v.state.doc;
    const from = sel.empty ? d.lineAt(sel.head).from : sel.from, to = sel.empty ? d.lineAt(sel.head).to : sel.to;
    const text = d.sliceString(from, to);
    if (!text.trim()) return;
    setAi(true);
    setAiQuote({ id: ++aiSeq.current, name: tab?.node.name ?? i18next.t("無題"), text, scope: "selection", lines: [d.lineAt(from).number, d.lineAt(to).number] });
  };
  // ファイル(ツリーの行・タブ)を、中身ごと AI パネルへ添える。開いているものは、保存前の内容を使う
  const clipOf = async (x: Node | string): Promise<Ctx | null> => {
    const n = typeof x === "string" ? tabOf(x)?.node : x;
    if (!n || n.kind === "dir") return null;
    const t = tabOf(n.path);
    if (t) return t.view.kind === "text" ? { name: n.name, text: t.text, scope: "file" } : null;
    try { const r = await load(n); return r.view.kind === "text" ? { name: n.name, text: r.view.text, scope: "file" } : null; } catch { return null; }
  };
  const fileToAi = async (n: Node) => {
    const c = await clipOf(n);
    if (!c) { notify(i18next.t("このファイルは文字として読めないため、添えられません"), "error"); return; }
    setAi(true);
    setAiQuote({ id: ++aiSeq.current, ...c });
  };
  const editorMenu = (e: MouseEvent, v: EditorView) => {
    const sel = !v.state.selection.main.empty, word = sel ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : "";
    const r = (id: string) => () => { v.focus(); EDIT[id](v); };
    setFp(views.current[0] === v ? 0 : 1);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: i18next.t("元に戻す"), icon: ic(Undo2), keys: K("undo"), run: r("undo") },
        { label: i18next.t("やり直す"), icon: ic(Redo2), keys: K("redo"), run: r("redo") },
        { type: "sep" },
        { label: i18next.t("切り取り"), icon: ic(Scissors), keys: "Mod+X", run: r("cut") },
        { label: i18next.t("コピー"), icon: ic(Copy), keys: "Mod+C", run: r("copy") },
        { label: i18next.t("貼り付け"), icon: ic(ClipboardPaste), keys: "Mod+V", run: r("paste") },
        { label: i18next.t("すべて選択"), icon: ic(MousePointerClick), keys: "Mod+A", run: () => { v.focus(); v.dispatch({ selection: { anchor: 0, head: v.state.doc.length } }); } },
        { type: "sep" },
        { label: i18next.t("選択"), icon: ic(MousePointerClick), sub: [
          { label: i18next.t("次の同じ語も選択"), keys: K("selectNext"), run: r("selectNext") },
          { label: i18next.t("同じ語をすべて選択"), keys: K("selectMatches"), run: r("selectMatches") },
          { label: i18next.t("行を選択"), keys: K("selectLine"), run: r("selectLine") },
        ] },
        { label: i18next.t("行の操作"), icon: ic(ArrowDownAZ), sub: [
          { label: i18next.t("下に複製"), keys: K("dupDown"), run: r("dupDown") }, { label: i18next.t("上に複製"), keys: K("dupUp"), run: r("dupUp") },
          { label: i18next.t("下へ移動"), keys: K("moveDown"), run: r("moveDown") }, { label: i18next.t("上へ移動"), keys: K("moveUp"), run: r("moveUp") },
          { label: i18next.t("行を削除"), keys: K("deleteLine"), run: r("deleteLine"), danger: true },
          { label: i18next.t("下に空行を挿入"), keys: K("blankBelow"), run: r("blankBelow") },
        ] },
        { label: i18next.t("変換"), icon: ic(CaseUpper), sub: [
          { label: i18next.t("大文字にする"), keys: K("upper"), run: r("upper"), disabled: !sel }, { label: i18next.t("小文字にする"), keys: K("lower"), run: r("lower"), disabled: !sel },
          { label: i18next.t("行を並べ替え"), run: r("sortLines") }, { label: i18next.t("行末の空白を削除"), run: r("trimSpace") },
        ] },
        { label: i18next.t("コメントの切り替え"), icon: ic(WrapText), keys: K("comment"), run: r("comment") },
        { label: i18next.t("折りたたみ"), icon: ic(ChevronsDownUp), sub: [
          { label: i18next.t("折りたたむ"), keys: K("fold"), run: r("fold") }, { label: i18next.t("展開する"), keys: K("unfold"), run: r("unfold") },
          { label: i18next.t("すべて折りたたむ"), keys: K("foldAll"), run: r("foldAll") }, { label: i18next.t("すべて展開"), keys: K("unfoldAll"), run: r("unfoldAll") },
        ] },
        { label: i18next.t("AI チャットに引用"), icon: ic(Quote), keys: K("aiQuote"), run: () => quoteToAi(v) },
        { label: "AI", icon: ic(Sparkles), sub: [
          { type: "title", label: sel ? i18next.t("選択範囲を送信") : i18next.t("ファイル全体を送信") },
          { label: i18next.t("要約"), run: () => askAi(v, "summarize") },
          { label: i18next.t("コードの説明"), run: () => askAi(v, "explain") },
          { label: i18next.t("日本語に翻訳"), run: () => askAi(v, "translate", "ja") },
          { label: i18next.t("英語に翻訳"), run: () => askAi(v, "translate", "en") },
          { label: i18next.t("韓国語に翻訳"), run: () => askAi(v, "translate", "ko") },
          { type: "sep" },
          { label: i18next.t("AI パネルを開く"), keys: K("toggleAi"), run: () => setAi(true) },
        ] },
        { type: "sep" },
        { label: i18next.t("検索 / 置換"), icon: ic(SearchIcon), keys: K("find"), run: r("find") },
        { label: word ? i18next.t("「{{arg0}}」を全体から探す", { arg0: word.length > 14 ? word.slice(0, 14) + "…" : word }) : i18next.t("全文検索"), icon: ic(SearchIcon), keys: K("searchAll"), run: () => { setSeed(word && !word.includes("\n") ? word : ""); setSide(true); setPanel("search"); } },
        { label: i18next.t("行へ移動"), keys: K("gotoLine"), run: r("gotoLine") },
        { label: i18next.t("シンボルへ移動(アウトライン)"), keys: K("goSymbol"), run: () => run("goSymbol") },
        { label: i18next.t("ローカル履歴"), keys: K("localHistory"), run: () => run("localHistory") },
        { type: "sep" },
        ...(split ? [
        { label: i18next.t("もう一方の画面へ送る"), icon: ic(ArrowLeftRight), keys: K("moveTab"), run: () => tab && sendTo(tab.node, fp === 0 ? 1 : 0, true), disabled: !tab },
        { label: i18next.t("もう一方の画面にも開く"), icon: ic(Columns2), run: () => tab && openSplit(tab.node), disabled: !tab },
        ] : [tab ? splitSub(tab.node) : { label: i18next.t("分割して開く"), icon: ic(Columns2), disabled: true }]),
        ...(split ? [{ label: i18next.t("2つの画面を入れ替える"), icon: ic(ArrowLeftRight), keys: K("swapPanes"), run: swapPanes }] : []),
        { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => tab && copyText(displayPath(tab.node.path)), disabled: !tab },
      ],
    });
  };
  const treeMenu = (e: React.MouseEvent, n: Node | null) => {
    e.preventDefault();
    const dir = n?.kind === "dir";
    const head = !!n && isRootNode(n); // 複数のフォルダを開いているときの、フォルダの見出し
    const rr = n ? rootOf(n) : root;
    const here = (p: string) => addTerm(p, undefined, rr.conn?.kind === "ssh" ? rr.conn.host : null);
    setMenu({
      x: e.clientX, y: e.clientY, path: n?.path,
      items: [
        ...(n ? [{ type: "title" as const, label: head ? rr.name : displayPath(n.path) }] : []),
        ...(n && !dir ? [
          { label: i18next.t("開く"), icon: ic(Files), run: () => open(n) },
          split ? { label: i18next.t("もう一方の画面で開く"), icon: ic(Columns2), keys: "", run: () => openSplit(n) } : splitSub(n),
          { label: i18next.t("AI チャットに添える"), icon: ic(Sparkles), run: () => void fileToAi(n) },
          { type: "sep" as const },
        ] : []),
        { label: i18next.t("新規ファイル"), icon: ic(FilePlus), keys: K("newFile"), run: () => create("file", dir ? n : null) },
        { label: i18next.t("新規フォルダ"), icon: ic(FolderPlus), run: () => create("dir", dir ? n : null) },
        ...(n && head ? [
          { type: "sep" as const },
          ...(rr.conn ? [
            { label: i18next.t("絶対パスをコピー"), icon: ic(Link), run: () => copyText(rr.conn!.path) },
            { label: i18next.t("ここでターミナルを開く"), icon: ic(SquareTerminal), run: () => here(rr.conn!.path) },
          ] : []),
          { label: i18next.t("ファイル一覧を更新"), icon: ic(RotateCw), run: reload },
          { type: "sep" as const },
          { label: i18next.t("ワークスペースから外す"), icon: ic(FolderMinus), run: () => removeRoot(rr.prefix) },
        ] : n ? [
          { type: "sep" as const },
          { label: i18next.t("名前の変更"), icon: ic(Pencil), run: () => rename(n) },
          { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => copyText(displayPath(n.path)) },
          ...(rr.conn ? [
            { label: i18next.t("絶対パスをコピー"), icon: ic(Link), run: () => copyText(abs(n)) },
            ...(rr.conn.kind === "ssh" ? [{ label: "ssh:// のパスをコピー", icon: ic(Link), run: () => copyText(sshUrl(rr.conn!, abs(n))) }] : []),
            { label: i18next.t("ここでターミナルを開く"), icon: ic(SquareTerminal), run: () => here(dir ? abs(n) : abs(n).replace(/\/[^/]*$/, "") || "/") },
          ] : []),
          { label: i18next.t("名前をコピー"), icon: ic(Copy), run: () => copyText(n.name) },
          { type: "sep" as const },
          { label: i18next.t("削除"), icon: ic(Trash2), danger: true, run: () => remove(n) },
        ] : [
          { type: "sep" as const },
          { label: i18next.t("ファイル一覧を更新"), icon: ic(RotateCw), run: reload },
          ...(root.conn ? [{ label: i18next.t("ここでターミナルを開く"), icon: ic(SquareTerminal), run: () => addTerm(root.conn!.path, undefined, root.conn!.kind === "ssh" ? root.conn!.host : null) }] : []),
          { label: i18next.t("WSL・SSH に接続"), icon: ic(Server), keys: K("connect"), run: () => { setCnAdd(false); setCn(true); } },
          { label: i18next.t("フォルダを開く"), icon: ic(FolderOpen), keys: K("openFolder"), run: openFolder, disabled: !supportsFs() },
          { label: i18next.t("フォルダをワークスペースに追加"), icon: ic(FolderPlus), keys: K("addFolder"), run: addFolder, disabled: !supportsFs() || !root.handle },
          { label: i18next.t("WSL・SSH のフォルダを追加"), icon: ic(Server), run: () => { setCnAdd(true); setCn(true); }, disabled: !root.handle },
        ]),
      ],
    });
  };
  const tabMenu = (e: React.MouseEvent, t: Tab) => {
    e.preventDefault();
    const i = tabs.indexOf(t), row = st.splitDir === "row";
    const A = row ? i18next.t("上") : i18next.t("左"), B = row ? i18next.t("下") : i18next.t("右"), p = t.node.path;
    const savedOnes = tabs.filter((x) => !(isText(x) && x.text !== x.saved));
    const inPane = (n: 0 | 1) => split && act[n] === p;
    setMenu({
      x: e.clientX, y: e.clientY, path: p,
      items: [
        { label: pinned.has(p) ? i18next.t("ピン留めを外す") : i18next.t("ピン留めする"), icon: ic(Pin), run: () => togglePin(p) },
        ...(isText(t) ? [{ label: i18next.t("ローカル履歴"), icon: ic(History), run: () => setLh(p) }] : []),
        { label: i18next.t("閉じる"), icon: ic(X), keys: K("closeTab"), run: () => close(p), disabled: pinned.has(p) },
        { label: i18next.t("他を閉じる"), run: () => closeMany(tabs.filter((x) => x !== t).map((x) => x.node.path)), disabled: tabs.length < 2 },
        { label: i18next.t("右を閉じる"), run: () => closeMany(tabs.slice(i + 1).map((x) => x.node.path)), disabled: i >= tabs.length - 1 },
        { label: i18next.t("左を閉じる"), run: () => closeMany(tabs.slice(0, i).map((x) => x.node.path)), disabled: i < 1 },
        { label: i18next.t("保存済みを閉じる"), run: () => closeMany(savedOnes.map((x) => x.node.path)), disabled: savedOnes.length === 0 },
        { label: i18next.t("すべて閉じる"), keys: K("closeAll"), run: () => closeMany(tabs.map((x) => x.node.path)) },
        { type: "sep" },
        { label: i18next.t("AI チャットに添える"), icon: ic(Sparkles), run: () => void fileToAi(t.node) },
        ...(!split ? [splitSub(t.node)] : [
        { label: i18next.t("{{A}}の画面で開く", { A }), icon: ic(Columns2), run: () => sendTo(t.node, 0), disabled: inPane(0) },
        { label: i18next.t("{{B}}の画面で開く", { B }), icon: ic(Columns2), run: () => sendTo(t.node, 1), disabled: inPane(1) },
        { label: i18next.t("もう一方の画面へ送る"), icon: ic(ArrowLeftRight), keys: K("moveTab"), run: () => sendTo(t.node, act[0] === p && split ? 1 : act[1] === p && split ? 0 : fp === 0 ? 1 : 0, true) },
        ]),
        ...(split ? [
          { label: i18next.t("2つの画面を入れ替える"), icon: ic(ArrowLeftRight), keys: K("swapPanes"), run: swapPanes },
          { label: row ? i18next.t("左右に並べ替える") : i18next.t("上下に並べ替える"), icon: ic(row ? Columns2 : Rows2), run: flipDir },
          { label: i18next.t("分割を解除"), keys: K("toggleSplit"), run: closePane },
        ] : []),
        { type: "sep" },
        { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => copyText(p.slice(1)) },
        { label: i18next.t("名前をコピー"), icon: ic(Copy), run: () => copyText(t.node.name) },
        { label: i18next.t("名前の変更"), icon: ic(Pencil), run: () => rename(t.node) },
      ],
    });
  };
  const termMenu = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    const a = () => apis.current.get(id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: i18next.t("コピー"), icon: ic(Copy), run: () => a()?.copy() },
        { label: i18next.t("貼り付け"), icon: ic(ClipboardPaste), run: () => a()?.paste() },
        { type: "sep" },
        { label: i18next.t("画面を消す"), icon: ic(Eraser), keys: K("clearTerm"), run: () => a()?.clear() },
        { label: i18next.t("新しいターミナル"), icon: ic(Plus), keys: K("newTerm"), run: () => addTerm(), disabled: alive().length >= st.termMax },
        { label: i18next.t("名前の変更"), icon: ic(TextCursorInput), run: () => setRenaming(id) },
        { type: "sep" },
        { label: i18next.t("このターミナルを終える"), icon: ic(X), keys: K("closeTerm"), run: () => endTerm(id) },
        { label: i18next.t("パネルを閉じる"), icon: ic(SquareTerminal), keys: K("toggleTerm"), run: () => showTerm(false) },
      ],
    });
  };
  const stageMenu = (e: React.MouseEvent) => {
    if (e.defaultPrevented || (e.target as HTMLElement).closest("input,textarea,.cm-editor,.tree,.xterm")) return;
    e.preventDefault();
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: i18next.t("コマンドパレット"), icon: ic(Command), keys: K("palette"), run: () => setPal(true) },
        { label: i18next.t("ファイルを開く"), icon: ic(Files), keys: K("quickOpen"), run: () => setQo(true) },
        { label: i18next.t("全文検索"), icon: ic(SearchIcon), keys: K("searchAll"), run: () => run("searchAll") },
        { type: "sep" },
        { label: i18next.t("テーマを編集(右のパネル)"), icon: ic(PaletteIcon), keys: K("themePanel"), checked: tp, run: () => setTp(!tp) },
        { label: i18next.t("サイドバーの表示"), icon: ic(PanelLeft), keys: K("toggleSide"), checked: side, run: () => setSide(!side) },
        { label: i18next.t("ターミナル"), icon: ic(SquareTerminal), keys: K("toggleTerm"), checked: term, run: () => showTerm() },
        { label: i18next.t("新しいターミナル"), icon: ic(Plus), keys: K("newTerm"), run: () => addTerm() },
        { label: i18next.t("分割表示"), icon: ic(Columns2), keys: K("toggleSplit"), checked: split, run: toggleSplit },
        { label: i18next.t("ライト / ダーク"), icon: ic(SunMoon), keys: K("toggleTheme"), run: () => run("toggleTheme") },
        { type: "sep" },
        { label: i18next.t("設定"), icon: ic(Cog), keys: K("settings"), run: () => setSetts("look") },
        { label: i18next.t("統計を見る(作業時間・入力)"), keys: K("stats"), run: () => setStatsOpen(true) },
        { label: i18next.t("ショートカットの一覧"), keys: K("shortcuts"), run: () => setSetts("keys") },
        { label: i18next.t("アカウント"), run: () => setSetts("account") },
        { label: i18next.t("フィードバックを送る"), icon: ic(MessageSquareText), run: () => setFbOpen(true) },
        ...(IS_TAURI ? [{ label: i18next.t("更新を確認"), icon: ic(RefreshCw), run: () => { void checkNow(); } }] : []),
      ],
    });
  };

  /* ---------- 表示 ---------- */
  const rootsLite = useMemo(() => roots.map((r) => ({ nodes: r.nodes, prefix: r.prefix })), [roots]);
  const live = useMemo(() => new Map(tabs.filter(isText).map((t) => [t.node.path, t.text])), [tabs]);
  const dirty = useMemo(() => new Set(dirtyList.map((t) => t.node.path)), [tabs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ドラッグ中に光らせる範囲(.panes に対する割合)
  const dropRect = (z: Dz): React.CSSProperties => {
    if (typeof z === "string") return z === "L" ? { left: 0, width: "50%", top: 0, bottom: 0 } : z === "R" ? { left: "50%", width: "50%", top: 0, bottom: 0 } : z === "T" ? { top: 0, height: "50%", left: 0, right: 0 } : { top: "50%", height: "50%", left: 0, right: 0 };
    const r = st.splitRatio;
    const [a, b] = !split ? [0, 100] : z === 0 ? [0, r] : [r, 100 - r];
    return st.splitDir === "row" ? { top: `${a}%`, height: `${b}%`, left: 0, right: 0 } : { left: `${a}%`, width: `${b}%`, top: 0, bottom: 0 };
  };
  const col = st.splitDir === "col";
  const lastBar: 0 | 1 = (split || splitMount) && col ? 1 : 0; // 右上のボタンを置く側
  const dropTab = async (i: 0 | 1, target: string | null, after: boolean) => {
    const p = drag.tab, from = drag.from;
    dragEnd(); setTabDrop(null); setDz(null);
    if (!p) return;
    const t = tabOf(p);
    if (t && split && from !== i) await sendTo(t.node, i, true);
    if (target && target !== p) reorder(p, target, after);
  };
  // 画面ごとのタブ列(VSCode と同じ。分割中は、それぞれの画面の上に置く)
  const strip = (i: 0 | 1) => {
    const list = paneTabs(i);
    return (
      <div className="tabbar" role="tablist" data-pane={i} data-focus={!split || fp === i} data-tauri-drag-region onDragEnter={() => setDz(null)}>
        {i === 0 && CHROME && !side && <WinControls />}
        {i === 0 && !side && <button className="icon-btn" aria-label={i18next.t("サイドバーを開く")} onClick={() => setSide(true)}><PanelLeft /></button>}
        {list.map((t) => {
          const path = t.node.path;
          return (
            <div key={path} className="tab" role="tab" data-path={path} data-pinned={pinned.has(path) || undefined} data-tip={t.node.name} data-tip-sub={displayPath(path)} ref={measureTab} data-fresh={fresh.has(path)} data-drop={tabDrop?.pane === i && tabDrop.path === path ? (tabDrop.after ? "after" : "before") : undefined} draggable
              onDragStart={(e) => { drag.tab = path; drag.from = i; setPreview((v) => (v === path ? null : v)); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", displayPath(path)); }}
              onDragEnd={() => { dragEnd(); setDz(null); setTabDrop(null); }}
              onDragOver={(e) => { if (!drag.tab) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; setTabDrop((d) => (d?.pane === i && d.path === path && d.after === after ? d : { path, after, pane: i })); }}
              onDrop={(e) => { if (!drag.tab) return; e.preventDefault(); dropTab(i, path, !!tabDrop?.after); }}
              aria-selected={path === act[i]} data-closing={closing.has(path)} data-preview={preview === path}
              onDoubleClick={() => setPreview((v) => (v === path ? null : v))}
              onClick={(e) => { if (e.altKey && split) sendTo(t.node, i === 0 ? 1 : 0); else open(t.node, i, false); }} onAuxClick={(e) => { if (e.button === 1) closeIn(path, i); }} onContextMenu={(e) => tabMenu(e, t)}>
              <span className="tab-name">{t.node.name}</span>
              <button className="tab-x" data-pin={pinned.has(path) || undefined} aria-label={pinned.has(path) ? i18next.t("ピン留めを外す") : i18next.t("{{name}} を閉じる", { name: t.node.name })} onClick={(e) => { e.stopPropagation(); if (pinned.has(path)) togglePin(path); else closeIn(path, i); }}>
                {pinned.has(path) ? <Pin /> : dirty.has(path) ? <svg className="dot" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" /></svg> : <X />}
              </button>
            </div>
          );
        })}
        <span style={{ flex: 1, alignSelf: "stretch", minWidth: 8 }} data-tauri-drag-region
          onDragOver={(e) => { if (drag.tab) { e.preventDefault(); const last = list[list.length - 1]; setTabDrop({ path: last?.node.path ?? "", after: true, pane: i }); } }}
          onDrop={(e) => { if (drag.tab) { e.preventDefault(); dropTab(i, list[list.length - 1]?.node.path ?? null, true); } }} />
        {i === lastBar && (
          <>
            <button className="icon-btn" data-on={ai} aria-label={i18next.t("AI パネルの表示")} title={`${i18next.t("AI パネルの表示")} (${chips(K("toggleAi")).join(" ")})`} onClick={() => setAi((v) => !v)}><Sparkles /></button>
            <button className="icon-btn" data-on={term} aria-label={i18next.t("ターミナル")} title={i18next.t("ターミナル")} onClick={() => showTerm()}><SquareTerminal /></button>
            <button className="icon-btn" aria-label={i18next.t("コマンドパレット")} title={i18next.t("コマンドパレット")} onClick={() => setPal(true)}><Command /></button>
            <button className="icon-btn fb-btn" aria-label={i18next.t("フィードバックを送る")} title={i18next.t("フィードバックを送る")} onClick={() => setFbOpen(true)}><MessageSquareText />{unreplies > 0 && <i className="fb-dot" aria-hidden />}</button>
            {me && <button className="acct-chip" aria-label={i18next.t("アカウント")} title={me.email} onClick={() => setSetts("account")}><Avatar user={me} size={20} /><span>{me.name}</span></button>}
            <button className="icon-btn" aria-label={i18next.t("設定")} title={i18next.t("設定")} onClick={() => setSetts("look")}><Cog /></button>
          </>
        )}
      </div>
    );
  };
  const pane = (i: 0 | 1) => {
    const t = tabOf(act[i]);
    return (
      <div className={i === 1 && !col ? "paper has-strip" : "paper"} data-focus={fp === i} onMouseDown={() => setFp(i)} onContextMenu={(e) => { if (!t) stageMenu(e); }}>
        {i === 1 && !col && strip(1)}
        {!t ? (
          <div className="empty">
            <p className="empty-title">{APP_NAME}</p>
            <p className="empty-sub">{roots.every((r) => r.ref.kind === "demo") ? i18next.t("左下の「フォルダを開く」から始めます。") : <Trans i18nKey="左のファイルを選ぶと、ここで開きます。" />}</p>
            {st.emptyHint && (
              <ul className="empty-acts">
                {([["quickOpen", i18next.t("ファイルを開く"), () => setQo(true)], ["palette", i18next.t("コマンドを探す"), () => setPal(true)], ["searchAll", i18next.t("全文検索"), () => run("searchAll")], ["toggleTerm", i18next.t("ターミナル"), () => showTerm()]] as const).map(([id, label, go]) => (
                  <li key={id}><button onClick={go}><span>{label}</span><span className="keys">{chips(K(id)).map((c, k) => <kbd key={k}>{c}</kbd>)}</span></button></li>
                ))}
              </ul>
            )}
          </div>
        ) : t.view.kind === "text" ? (
          <div className="ed-pv" data-pv={previewKind(t.node.name) ? pv[t.node.path] ?? "text" : "text"}>
          <Editor
          crumbExtra={previewKind(t.node.name) ? (() => {
            const cur = pv[t.node.path], on = cur !== undefined, wide = cur === "preview", key = chips(K("togglePreview")).join(" ");
            const set = (m: PvMode | undefined) => setPv((p) => ({ ...p, [t.node.path]: m }));
            return (
              <span className="pv-tools" data-open={on}>
                {on && <button className="icon-btn bc-btn" aria-pressed={wide} aria-label={wide ? i18next.t("エディタも表示する") : i18next.t("プレビューだけにする")} data-tip={wide ? i18next.t("エディタも表示する") : i18next.t("プレビューだけにする")} onClick={() => set(wide ? "split" : "preview")}>{wide ? <Minimize2 /> : <Maximize2 />}</button>}
                <button className="icon-btn bc-btn" data-on={on} aria-pressed={on} aria-label={on ? i18next.t("プレビューを閉じる") : i18next.t("プレビューを横に開く")} data-tip={`${on ? i18next.t("プレビューを閉じる") : i18next.t("プレビューを横に開く")} (${key})`} onClick={() => set(on ? undefined : "split")}><Eye /></button>
              </span>
            );
          })() : undefined}
            key={`${i}:${t.node.path}`} docKey={`${i}:${t.node.path}`} path={displayPath(t.node.path)} name={t.node.name} value={t.text} jump={jump[i]}
            onChange={(v) => { setTabs((p) => p.map((x) => (x.node.path === t.node.path && x.text !== v ? { ...x, text: v } : x))); setPreview((q) => (q === t.node.path ? null : q)); }}
            onCursor={(c) => setCur((p) => (i === 0 ? [c, p[1]] : [p[0], c]))}
            onFocus={() => setFp(i)} onReady={(v) => { views.current[i] = v; }} onContext={editorMenu} gitBase={bases[t.node.path]}
          />
          {previewKind(t.node.name) && (
            <div className="pv-pane" inert={!pv[t.node.path]}>
              {(pv[t.node.path] || pvSeen.current.has(t.node.path)) && (pvSeen.current.add(t.node.path), <Preview kind={previewKind(t.node.name)!} text={t.text} name={t.node.name} source={previewSource(t)} />)}
            </div>
          )}
          </div>
        ) : (
          <Viewer view={t.view} name={t.node.name} />
        )}
      </div>
    );
  };

  const goHit = (n: Node, h: { line: number; from: number; to: number }) => goto(n, h.line, h.from, h.to);

  return (
    <GitMarks.Provider value={gitMark}>
    <div className="stage" onContextMenu={stageMenu}>
      <div className="window" data-side={side} data-sb={st.sbShow} data-tp={tp}>
        <ColGrip className="col-grip-side" width={st.sideW} def={280} min={200} max={640} dir={1} onChange={(w) => update({ sideW: w })} />
        <aside className="sidebar" aria-label={i18next.t("サイドバー")}>
          <header className="side-head" data-tauri-drag-region>
            {CHROME && <WinControls />}
            <h1 className="title truncate" data-tauri-drag-region>Fixit</h1>
            <div className="tools">
              <button className="icon-btn" data-on={panel === "files"} aria-label={i18next.t("ファイル")} title={i18next.t("ファイル")} onClick={() => setPanel("files")}><Files /></button>
              <button className="icon-btn" data-on={panel === "search"} aria-label={i18next.t("全文検索")} title={i18next.t("全文検索")} onClick={() => run("searchAll")}><SearchIcon /></button>
              <button className="icon-btn" aria-label={i18next.t("サイドバーを隠す")} onClick={() => setSide(false)}><PanelLeft /></button>
            </div>
          </header>
          {panel === "files" ? (
            <>
              <nav className="tree scroll overscroll-contain" data-drop={rootDrop}
                onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setRootDrop(true); setExtDrop(true); return; } if (roots.length > 1 || !drag.node || (e.target as HTMLElement).closest(".tree-row") || dirOf(drag.node.path) === roots[0].prefix) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; setRootDrop(true); }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) { setRootDrop(false); setExtDrop(false); } }}
                onDrop={(e) => { if (hasFiles(e)) { void dropExternal(e); return; } setRootDrop(false); if (roots.length > 1 || !drag.node || (e.target as HTMLElement).closest(".tree-row")) return; e.preventDefault(); const m = drag.node; dragEnd(); moveTo(m, null); }}
                onContextMenu={(e) => { if (e.target === e.currentTarget || !(e.target as HTMLElement).closest(".tree-row")) treeMenu(e, null); }}>
                {roots.length > 1 ? roots.map((r) => {
                  const h = headNode(r), shut = folded.has(r.prefix);
                  return (
                    <section key={r.prefix || "main"} className="root-sec" aria-label={r.name}>
                      <button className="tree-row root-head" data-ctx={menu?.path === r.prefix} data-drop={dropHead === r.prefix} aria-expanded={!shut}
                        onClick={() => setFolded((p) => { const q = new Set(p); if (q.has(r.prefix)) q.delete(r.prefix); else q.add(r.prefix); return q; })}
                        onContextMenu={(e) => { e.stopPropagation(); treeMenu(e, h); }}
                        onDragOver={(e) => { if (!canDrop(h)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDropHead(r.prefix); }}
                        onDragLeave={() => setDropHead((v) => (v === r.prefix ? null : v))}
                        onDrop={(e) => { if (!canDrop(h)) return; e.preventDefault(); e.stopPropagation(); setDropHead(null); const m = drag.node!; dragEnd(); moveTo(m, h); }}>
                        <ChevronRight className="chev" data-open={!shut} />
                        <Folder className="ico folder" />
                        <span className="truncate">{r.name}</span>
                      </button>
                      <div className="collapse" data-open={!shut} inert={shut}>
                        <div className="collapse-inner">
                          <FileTree nodes={r.nodes} activePath={act[fp]} ctxPath={menu?.path ?? null} rev={rev} onOpen={(n, pin) => open(n, fp, !!pin)} onContext={(e, n) => treeMenu(e, n)} onMove={moveTo} />
                        </div>
                      </div>
                    </section>
                  );
                }) : roots.every((r) => r.ref.kind === "demo") && !root.nodes.length ? (
                  <div className="tree-empty">
                    <FolderOpen />
                    <p><Trans i18nKey="フォルダやファイルをここへドラッグ&ドロップするか、下のボタンから選んでください。" /></p>
                  </div>
                ) : (
                  <FileTree nodes={root.nodes} activePath={act[fp]} ctxPath={menu?.path ?? null} rev={rev} onOpen={(n, pin) => open(n, fp, !!pin)} onContext={(e, n) => treeMenu(e, n)} onMove={moveTo} />
                )}
              </nav>
              <div className="side-foot">
                <button className="open-btn" onClick={openFolder} disabled={!supportsFs()} title={supportsFs() ? "" : i18next.t("このブラウザではフォルダを開けません(Chrome か Edge を使ってください)")}>
                  <FolderOpen /><Trans i18nKey="フォルダを開く" />
                </button>
                <button className="open-btn" onClick={() => { setCnAdd(false); setCn(true); }} title={i18next.t("WSL や SSH 先のフォルダを開く")}><Server /><Trans i18nKey="WSL・SSH" /></button>
              </div>
            </>
          ) : (
            <SearchPanel roots={rootsLite} live={live} seed={seed} onOpen={goHit} />
          )}
          <div className="drop-zone" data-on={extDrop && panel === "files"} aria-hidden="true">
            <div className="drop-zone-card">
              <span className="drop-zone-icon"><FolderOpen /></span>
              <strong><Trans i18nKey="ここにドロップして開く" /></strong>
              <small><Trans i18nKey="フォルダ・ファイルを離すと開きます" /></small>
            </div>
          </div>
        </aside>

        <section className="main">
          <div className="tabrow" data-split={splitOpen && col}
            style={splitOpen && col ? { gridTemplateColumns: `${st.splitRatio}fr ${100 - st.splitRatio}fr` } : undefined}>
            {strip(0)}{(split || splitMount) && col && strip(1)}
          </div>
          <div className="work">
            <div className="work-row">
            <div className="panes" data-split={splitOpen} data-dragging={dragS} style={splitOpen ? ({ ["--split-r" as string]: st.splitRatio / 100, ...(st.splitDir === "row" ? { gridTemplateRows: `${st.splitRatio}fr ${100 - st.splitRatio}fr` } : { gridTemplateColumns: `${st.splitRatio}fr ${100 - st.splitRatio}fr` }) }) : undefined}
              onDragOverCapture={(e) => { if (!st.splitDrop || !dragging() || (drag.tab && (e.target as HTMLElement).closest?.(".tabbar"))) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = drag.tab ? "move" : "copy"; const z = zoneOf(e); setDz((d) => (d === z ? d : z)); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDz(null); }}
              onDropCapture={(e) => { if (!st.splitDrop || !dragging() || (drag.tab && (e.target as HTMLElement).closest?.(".tabbar"))) return; e.preventDefault(); e.stopPropagation(); dropOnPanes(zoneOf(e)); }}>
              {pane(0)}{(split || splitMount) && pane(1)}
              {splitOpen && <div className="split-grip" role="separator" aria-orientation={st.splitDir === "row" ? "horizontal" : "vertical"} title={i18next.t("ドラッグで幅を変える・ダブルクリックで半分に戻す")} data-drag={dragS} onPointerDown={gripDown} onDoubleClick={() => update({ splitRatio: 50 })} />}
              {dz !== null && dragging() && <div className="drop-hint" data-dir={st.splitDir} style={dropRect(dz)} />}
            </div>
            {br && <ColGrip width={st.brW} def={560} min={280} max={1000} dir={-1} onChange={(w) => update({ brW: w })} />}
            {br && <BrowserDock onClose={() => setBr(false)} />}
            {ai && <ColGrip width={st.aiW} def={440} min={280} max={900} dir={-1} onChange={(w) => update({ aiW: w })} />}
            <AiDock open={ai} job={aiJob} quote={aiQuote} resolve={clipOf} getCtx={aiCtx} onClose={() => setAi(false)} onSettings={() => setSetts("ai")} />
            </div>
            {sess.length > 0 && (
              <div className="term-wrap" data-open={term && shown} data-drag={dragT}>
                <div className="term-clip">
                  <div className="term-grip" data-drag={dragT} onPointerDown={grip} />
                  <div className="term" style={{ height: st.termH }}>
                    <div className="term-head" role="tablist" aria-label={i18next.t("ターミナル")}>
                      {sess.filter((x) => !x.exiting).map((x) => (
                        <div key={x.id} className="term-tab" role="tab" aria-selected={x.id === actT} onClick={(e) => { if (e.detail > 1 || renaming === x.id) return; setActT(x.id); setTermKey((k) => k + 1); }}
                          onDoubleClick={() => setRenaming(x.id)} onAuxClick={(e) => { if (e.button === 1) endTerm(x.id); }} onContextMenu={(e) => termMenu(e, x.id)}>
                          <TermIcon />
                          {renaming === x.id ? (
                            <input className="term-rename inline-edit" data-closing={renOut} autoFocus defaultValue={nameOf(x)} aria-label={i18next.t("ターミナルの名前")} onClick={(e) => e.stopPropagation()}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={(e) => { if (renOut) return; const v = e.currentTarget.value.trim(); setSess((p) => p.map((y) => (y.id === x.id ? { ...y, name: v || undefined } : y))); setRenOut(true); setTimeout(() => { setRenaming(null); setRenOut(false); }, ms(120)); }}
                              onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { e.currentTarget.value = nameOf(x); e.currentTarget.blur(); } }} />
                          ) : <span className="truncate label-in">{nameOf(x)}</span>}
                          <button className="tab-x" aria-label={i18next.t("{{arg0}} を終える", { arg0: nameOf(x) })} onClick={(e) => { e.stopPropagation(); endTerm(x.id); }}><X /></button>
                        </div>
                      ))}
                      <button className="icon-btn" aria-label={i18next.t("新しいターミナル")} title={i18next.t("新しいターミナル")} disabled={alive().length >= st.termMax} onClick={() => addTerm()}><Plus /></button>
                      <button className="icon-btn" aria-label={i18next.t("ターミナルの種類を選ぶ")} title={i18next.t("ターミナルの種類を選ぶ")} disabled={alive().length >= st.termMax} onClick={shellMenu}><ChevronDown /></button>
                      <span style={{ flex: 1 }} />
                      <button className="icon-btn" aria-label={i18next.t("パネルを閉じる")} title={i18next.t("パネルを閉じる")} onClick={() => showTerm(false)}><X /></button>
                    </div>
                    <div className="term-views">
                      {sess.map((x) => (
                        <Terminal key={x.id} id={x.id} host={x.host !== undefined ? x.host ?? undefined : !x.shell && root.conn?.kind === "ssh" ? root.conn.host : undefined} shell={x.shell} cwd={x.cwd} active={x.id === actT} open={term && shown} focusKey={termKey} register={registerTerm} onExit={endTerm} onContext={termMenu} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
        {pTp.v && <ThemePanel key={pTp.key} out={pTp.out} onClose={() => setTp(false)} />}

        {st.sbShow && (
          <StatusBar
            tab={tab} cur={cur[fp]} info={tab?.info ?? ""} lang={tab ? langName(tab.node.name) : ""}
            dirtyCount={dirtyList.length} termCount={alive().length} term={term}
            conn={root.conn ? `${connLabel(root.conn)} · ${root.conn.path}` : null} connKind={root.conn?.kind ?? null}
            onConn={() => setCn(true)} ws={st.wsStatus ? ws?.name ?? "" : null} wsColor={ws?.color} onWs={() => setWsDlg("ws")} onPop={(k) => setPop((p) => (p === k ? null : k))}
            onTerm={() => showTerm()} onSettings={() => setSetts("look")}
            git={gits[root.prefix] ? { branch: gits[root.prefix]!.branch, changes: gits[root.prefix]!.files.size } : null} onGit={() => setGitTick((n) => n + 1)}
          />
        )}
      </div>

      {pQo.v && <QuickOpen key={pQo.key} out={pQo.out} roots={rootsLite} onPick={(n) => open(n)} onClose={() => setQo(false)} />}
      {pPal.v && <Palette key={pPal.key} out={pPal.out} cmds={wsCmds} onClose={() => setPal(false)} />}
      {pSetts.v && <Settings onTheme={() => { setSetts(null); setTp(true); }} key={pSetts.key} out={pSetts.out} first={pSetts.v} onClose={() => setSetts(null)} />}
      {pLh.v && (() => { const lt = tabs.find((x) => x.node.path === pLh.v); return lt && isText(lt) ? <LocalHistory key={pLh.key} out={pLh.out} path={lt.node.path} name={lt.node.name} current={lt.text} onRestore={(text) => setTabs((p) => p.map((x) => (x.node.path === lt.node.path && isText(x) ? { ...x, text } : x)))} onClose={() => setLh(null)} /> : null; })()}
      {pDlg.v && <Dialog key={pDlg.key} out={pDlg.out} {...pDlg.v} onClose={() => setDlg(null)} />}
      {pWs.v && <Workspaces key={pWs.key} out={pWs.out} initial={pWs.v} curId={ws?.id ?? null} saveName={root.conn ? root.name : root.handle ? root.name : ""} max={st.wsMax} onOpen={(w) => openWs(w)} onSaveNew={saveNew} onClose={() => setWsDlg(null)} flash={flash} />}
      {pSetup.v && <Setup key={pSetup.key} out={pSetup.out} onClose={() => setSetupOpen(false)} />}
      {pFb.v && <FeedbackView key={pFb.key} out={pFb.out} onClose={() => setFbOpen(false)} />}
      {pUp.v && upd && <UpdateView key={pUp.key} m={upd} out={pUp.out} onClose={() => setUpdOpen(false)} />}
      {pStats.v && <StatsView key={pStats.key} out={pStats.out} onClose={() => setStatsOpen(false)} />}
      {pCn.v && <Connect key={pCn.key} out={pCn.out} current={cnAdd ? null : root.conn ?? null} adding={cnAdd} onConnect={cnAdd ? addConn : connect} onClose={() => setCn(false)} />}
      {pPop.v && <StatusPop key={pPop.key} out={pPop.out} kind={pPop.v} view={ev() ?? null} eol={tab?.eol ?? "lf"} lang={tab ? langName(tab.node.name) : ""} onEol={toggleEol} onClose={() => setPop(null)} />}
      <LangUI onGoto={gotoLoc} onRename={applyRename} />
      {pMenu.v && <ContextMenu key={pMenu.key} out={pMenu.out} x={pMenu.v.x} y={pMenu.v.y} items={pMenu.v.items} onClose={() => setMenu(null)} />}
    </div>
    </GitMarks.Provider>
  );
}
