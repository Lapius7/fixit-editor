import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Palette as PaletteIcon, Quote, FolderOpen, PanelLeft, PanelRight, PanelTop, PanelBottom, RotateCw, X, Files, Search as SearchIcon, FilePlus, FolderPlus, Pencil, Trash2, Copy, Scissors, ClipboardPaste,
  Columns2, Rows2, ArrowLeftRight, SquareTerminal, Settings as Cog, Plus, TextCursorInput, Terminal as TermIcon, Undo2, Redo2, MousePointerClick, CaseUpper, ArrowDownAZ, WrapText, ChevronsDownUp, Link, Eraser, SunMoon, Command, ChevronDown, ChevronRight, Folder, FolderMinus, FolderX,
} from "lucide-react";
import type { EditorView } from "@codemirror/view";
import WinControls from "@/app/WinControls";
import FolderCards from "@/workbench/FolderCards";
import { wave } from "@/shared/wave";
import { CHROME } from "@/shared/chrome";
import { notify, type NoticeKind } from "@/shared/notify";
import { OUTLINE_EVENT } from "@/editor/Crumbs";
import { reindent } from "@/editor/reindent";
import LangUI from "@/editor/LangUI";
import { openFiles, isScript, type Edit, type Loc } from "@/editor/ts/client";
import Editor, { dropStates, cursorsNow, seedCursors, type Cursor, type Jump } from "@/editor/Editor";
import FileTree, { GitMarks, canDrop, iconFor, type GitMark } from "@/workbench/FileTree";
import { ColGrip, RatioGrip } from "@/workbench/ColGrip";
import { loadBase, loadGit, type GitInfo } from "@/features/git/git";
import QuickOpen from "@/workbench/QuickOpen";
import Viewer from "@/workbench/Viewer";
import { IMAGE_SAVE } from "@/workbench/ImageView";
import Terminal, { type TermApi } from "@/workbench/Terminal";
import StatusBar from "@/workbench/StatusBar";
import { LSP_AVAILABLE } from "@/editor/lsp/transport";
import { lspOptsOf, serverOfFile } from "@/editor/lsp/servers";
import { syncTabs as lspSync, normPath, sessionKey, type TabDoc } from "@/editor/lsp/session";
import { lspUi } from "@/editor/lsp/ext";
import { usePresence } from "@/shared/presence";
import ThemePanel from "@/features/theme/ThemePanel";
import StatusPop, { type PopKind } from "@/workbench/StatusPop";
import Palette, { type Cmd } from "@/workbench/Palette";
import Settings from "@/features/settings/Settings";
import StatsView from "@/features/stats/StatsView";
import GithubView from "@/features/github/GithubView";
import Setup, { needSetup } from "@/app/Setup";
import { noteSave } from "@/features/stats/stats";
import { moveFile, recordSave } from "@/features/history/history";
import LocalHistory from "@/features/history/LocalHistory";
import { sendPing } from "@/features/telemetry/telemetry";
import { installErrorHooks, startUsageReports } from "@/features/telemetry/report";
import FeedbackView from "@/features/telemetry/FeedbackView";
import { useAccount, openExternal } from "@/features/account/auth";
import { useReplies } from "@/features/account/replies";
import { Avatar } from "@/features/account/AccountUI";
import UpdateView from "@/features/update/UpdateView";
import { runCheck, useUpdateState } from "@/features/update/update";
import SearchPanel from "@/workbench/SearchPanel";
import ContextMenu, { type Item } from "@/workbench/ContextMenu";
import Dialog from "@/workbench/Dialog";
import Connect from "@/features/workspaces/Connect";
import Workspaces from "@/features/workspaces/Workspaces";
import { Globe, GitBranch, GitPullRequest, Pin, History, MessageSquareText, RefreshCw, ArrowUpCircle } from "lucide-react";
import { X as XIcon, Play, FolderSearch, AppWindow, FolderGit2, ChevronsUpDown } from "lucide-react";
import { runnerFor, buildCommand, shq } from "@/features/run/runners";
import { DELA_CHECK, DELA_INSTALL, findUrl, installAndPublish, publishCmd, stripAnsi, type Pub } from "@/features/dela/dela";
import { startBg, type Bg } from "@/features/dela/bg";
import { logAppend, logDrop } from "@/features/dela/logs";
import PortLog from "@/features/dela/PortLog";
import { PortsPanel } from "@/features/dela/PortsPanel";
import { rememberPublish } from "@/features/dela/history";
import { Sparkles, Server, FolderKanban, Eye, Maximize2, Minimize2, ImageIcon, ClipboardCopy, ChevronUp, Camera } from "lucide-react";
import { createTemp, createWs, emptyWs, canUse, connOf, findWs, getHandle, getWorkspaces, handleKey, matchRoot, nodeAt, putHandle, patchWs, removeWs, rootLabel, rootRefOf, saveState, setCurrent, setWsRoots, useWorkspaces, wsRoots, type RootEntry, type RootRef, type Workspace, type WsState } from "@/features/workspaces/workspaces";
import { displayPath, setRootNames, splitRoot } from "@/workbench/rootpath";
import { getProfiles, switchProfile, useProfiles } from "@/features/settings/profiles";
import { copyWithNotice, writeClip } from "@/platform/clipboard";
import { prefetchOpen, setAllOpen, setOpenPath, setRefreshScope, shownOpen } from "@/workbench/treeOpen";
import { revealPaths, startCreating } from "@/workbench/creating";
import { beginPending } from "@/workbench/pending";
import { clearSel, isMulti, isSelectedPath, selectedNodes } from "@/workbench/selection";
import { clearTreeClip, getTreeClip, hasTreeClip, setTreeClip, treeClipFor } from "@/workbench/treeclip";
import { leaveRows } from "@/workbench/treeAnim";
import { listShells, type ShellOpt } from "@/platform/pty";
import { RemoteFile, checkDir, execCmd, connKey, isRemote, remoteSig, connLabel, lastDir, normConn, showPath, pushRecent, rootHandle, sshUrl, type Conn, type RemoteDir } from "@/platform/remote";
import { DEMO_NAME, DEMO_TREE } from "@/shared/demo";
import { IS_TAURI } from "@/shared/chrome";
import { canMove, copyInto, createDir, createFile, freeEntryName, moveEntry, pickFolder, pickPcFolder, isJunk, readDir, removeEntry, renameFile, supportsFs, writeFile, writeBlob, freeName, type Node } from "@/platform/fs";
import { diskText, getFile, isImageName, load, norm } from "@/platform/load";
import { copyImage } from "@/shared/clipimage";
import { langName } from "@/editor/lang";
import { AI_TOOL_SEARCH_FILES, APP_NAME, MAX_OPEN_BYTES, SKIP_DIRS } from "@/shared/config";
import BrowserDock from "@/features/browser/BrowserDock";
import { AiDock, type AiPic, type AiQuote } from "@/features/ai/AiDock";
import { GitPanel } from "@/features/git/GitPanel";
import type { AiAction, AiJob, Ctx } from "@/features/ai/prompts";
import { applyAnchor, secretName, type FileHost } from "@/features/ai/tools";
import Preview, { previewKind } from "@/features/preview/Preview";
import { KEYS, DEF, chips, comboOf, keyOf, rec, table } from "@/features/settings/keys";
import { EDIT } from "@/editor/edit-cmds";
import { codeToPng, copyShot } from "@/editor/shot";
import { showShot } from "@/editor/shotPreview";
import { ShotPreview } from "@/editor/ShotPreview";
import { drag, dragEnd, extFiles, paneDrag, rootKey, setDropTarget, useDropTarget } from "@/workbench/dnd";
import { LEAF0, boxes, flipAround, fromPair, isLeaf, joints, leaves, nextId, onTop, removeLeaf, renumber, setRatio, splitLeaf, swapLeaves, topLeaves, topRight, valid as validLay, type Box, type Dir, type Edge, type Joint, type Lay } from "@/workbench/layout";
import { addNode, dirOf, exists, moveNode, removeNode, renameNode } from "@/workbench/treeops";
import { DEFS, isDark, ms, update, useSettings } from "@/features/settings/settings";
import type { Tab } from "@/shared/types";
import { ask, askChoice } from "@/shared/ask";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

// 開いているフォルダ。先頭のフォルダは prefix が空(パスは /src/a.ts)、追加したフォルダは「/@xxxx」から始まる(/@xxxx/src/a.ts)
type Root = { prefix: string; name: string; handle?: FileSystemDirectoryHandle; nodes: Node[]; conn?: Conn; ref: RootRef };
type Spec = { prefix: string; name: string; handle?: FileSystemDirectoryHandle; conn?: Conn; ref: RootRef };
// ツリーの見出しのホバーに出す、フォルダの種類と場所(ブラウザ版の PC のフォルダは場所が分からないので名前だけ)
const rootPath = (r: { ref: RootRef }) => rootLabel(r.ref);
const newPrefix = () => "/@" + Math.random().toString(36).slice(2, 7);
type Dlg = { title: string; desc?: string; input?: string; placeholder?: string; ok: string; danger?: boolean; validate?: (v: string) => string | null; onSubmit: (v: string) => void; icon?: (v: string) => React.ReactNode };
type Pm<T> = Record<number, T>; // 画面の番号ごとの値
type Sess = { id: number; num: number; name?: string; exiting?: boolean; cwd?: string; shell?: string; label?: string; host?: string | null }; // host: SSH 先(null は SSH ではない。未指定は先頭のフォルダに合わせる)
const def = (id: string) => DEFS.find((d) => d.id === id)!.def as number;

const revoke = (t: Tab) => { if ("url" in t.view) URL.revokeObjectURL(t.view.url); };
const isText = (t?: Tab | null) => t?.view.kind === "text";

type Dz = { pane: number; edge?: Edge }; // 落とす先: 既存の画面(edge なし)か、その画面の端に新しく分割(edge あり)

// 読み込み中に出す、ファイル一覧の形をした行([深さ, 名前の幅(%), フォルダか])
const TREE_SKEL: [number, number, boolean][] = [[0, 42, true], [0, 34, true], [1, 50, false], [1, 38, false], [1, 46, false], [0, 30, true], [0, 54, false], [0, 40, false], [0, 48, false], [0, 26, false]];

export default function App() {
  const st = useSettings();
  const [roots, setRoots] = useState<Root[]>([{ prefix: "", name: DEMO_NAME, nodes: DEMO_TREE, ref: { kind: "demo" } }]);
  const rootsNow = useRef(roots); // 続けて足すとき(複数のフォルダのドロップ)に、最新の一覧を使うため
  rootsNow.current = roots;
  const root = roots[0]; // タイトル・接続表示・ターミナルの既定の場所は、先頭のフォルダに合わせる
  setRootNames(roots);
  const [folded, setFolded] = useState<Set<string>>(new Set()); // 見出しを畳んでいるフォルダ
  const dropAt = useDropTarget(); // ドラッグ中に、落とすと入るフォルダ(エクスプローラーの中)
  const [cnAdd, setCnAdd] = useState(false); // WSL・SSH の画面を「追加」で開いているか
  const rootOfPath = (p: string): Root => {
    let best: Root | undefined;
    for (const r of roots) if (r.prefix && (p === r.prefix || p.startsWith(r.prefix + "/")) && (!best || r.prefix.length > best.prefix.length)) best = r;
    return best ?? roots.find((r) => !r.prefix) ?? roots[0];
  };
  const rootOf = (n: Node) => rootOfPath(n.path);
  const updRoot = (prefix: string, f: (r: Root) => Root) => setRoots((p) => p.map((r) => (r.prefix === prefix ? f(r) : r)));
  // 見出し(フォルダそのもの)を、ツリーの項目と同じ形で扱うための項目
  // フォルダを開いていれば、1 つだけでもフォルダ名の見出しを出す(VSCode と同じ。サンプルのときは出さない)
  const sectioned = roots.length > 1 || (!!root.handle && root.ref.kind !== "demo");
  const headNode = (r: Root): Node => ({ name: r.name, path: r.prefix, kind: "dir", handle: r.handle });
 
 const isRootNode = (n: Node) => roots.some((r) => r.prefix === n.path);
  const [tabs, setTabs] = useState<Tab[]>([]);
  // HTML プレビューが相対パスの CSS・JS・画像を読むための材料(開いているフォルダ、開いているタブの中身)
  const openTexts = useMemo(() => Object.fromEntries(tabs.filter((x) => x.view.kind === "text" && /\.(css|m?js|svg|json)$/i.test(x.node.name)).map((x) => [x.node.path, x.text])), [tabs]);
  const previewSource = (t: Tab) => ({ root: rootOfPath(t.node.path)?.handle as FileSystemDirectoryHandle | undefined, path: t.node.path, open: openTexts });
  const [lay, setLay] = useState<Lay>(LEAF0); // 画面の分割(木)。番号は画面ごとに固有で、画面が減っても振り直さない
  const [act, setAct] = useState<Pm<string | null>>({ 0: null });
  const [fp, setFp] = useState(0); // いま操作している画面の番号
  const split = !isLeaf(lay);
  const first = leaves(lay)[0]; // いちばん左上の画面
  const [moving, setMoving] = useState(false); // 画面の配置が動いている間(ミニマップを隠して、止まってから描き直す)
  const [born, setBorn] = useState<Pm<Edge>>({}); // 分割した直後の画面(どの側から現れるか)。現れる動きのために、少しだけ持つ
  const layOnce = useRef(true);
  useEffect(() => {
    if (layOnce.current) { layOnce.current = false; return; }
    setMoving(true);
    const t = setTimeout(() => { setMoving(false); requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))); }, ms(950));
    return () => clearTimeout(t);
  }, [lay]);
  const [grp, setGrp] = useState<Pm<Set<string>>>({ 0: new Set() }); // 分割時、各画面のタブ(どれにも属さないタブは、左上の画面に出す)
  const [fresh, setFresh] = useState<Set<string>>(new Set());   // 開いた直後のタブだけ、伸びる動きをつける(並べ替えで動きが再生されないように)
  const [dz, setDz] = useState<Dz | null>(null);        // ドラッグ中に落とす先
  const seen = useRef(0); const [chk, setChk] = useState(0);                         // 画面が空になっていないか見直す合図
  const [tabDrop, setTabDrop] = useState<{ path: string; after: boolean; pane: number } | null>(null);
  const [dragS, setDragS] = useState(false);
  const [gripOn, setGripOn] = useState<string | null>(null); // つかんでいる境目だけ光らせる
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
  const [pvR, setPvR] = useState(0.5); // エディタとプレビューを並べたときの、エディタの幅の割合
  const [pvMode, setPvMode] = useState<PvMode | undefined>(); // プレビューの表示(全体で1つ)。オンの間は、ほかのタブへ移っても、そのファイルのプレビューを出す
  const pv = (path: string) => (previewKind(path) ? pvMode : undefined);
  const [pvPin, setPvPin] = useState<string | null>(null); // 固定したプレビュー(パス)。同じ画面でほかのファイルを開いている間も横に出し続ける(CSS・JS を直しながら見るため)
  useEffect(() => { if (pvPin && (!pvMode || !tabs.some((t) => t.node.path === pvPin))) setPvPin(null); }, [pvPin, pvMode, tabs]);
  useEffect(() => { if (IS_TAURI) void listShells(); }, []); // 右クリックのメニューで、シェルの一覧を待たずに出せるように
  const pvTools = (path: string) => {
    const cur = pv(path), on = cur !== undefined, wide = cur === "preview", key = chips(K("togglePreview")).join(" ");
    const set = (m: PvMode | undefined) => setPvMode(m);
    return (
      <span className="pv-tools" data-open={on}>
        {on && <button className="icon-btn bc-btn" data-on={pvPin === path} aria-pressed={pvPin === path} aria-label={pvPin === path ? i18next.t("プレビューの固定を外す") : i18next.t("プレビューを固定")} data-tip={pvPin === path ? i18next.t("プレビューの固定を外す") : i18next.t("プレビューを固定")} data-tip-sub={pvPin === path ? undefined : i18next.t("ほかのファイルを開いている間も、このプレビューを横に出し続けます")} onClick={() => { setPvPin((q) => (q === path ? null : path)); setPreview((q) => (q === path ? null : q)); }}><Pin /></button>}
        {on && <button className="icon-btn bc-btn" aria-pressed={wide} aria-label={wide ? i18next.t("エディタも表示する") : i18next.t("プレビューだけにする")} data-tip={wide ? i18next.t("エディタも表示する") : i18next.t("プレビューだけにする")} onClick={() => set(wide ? "split" : "preview")}>{wide ? <Minimize2 /> : <Maximize2 />}</button>}
        <button className="icon-btn bc-btn" data-on={on} aria-pressed={on} aria-label={on ? i18next.t("プレビューを閉じる") : i18next.t("プレビューを横に開く")} data-tip={`${on ? i18next.t("プレビューを閉じる") : i18next.t("プレビューを横に開く")} (${key})`} onClick={() => set(on ? undefined : "split")}><Eye /></button>
      </span>
    );
  };
  const [br, setBr] = useState(false); // アプリ内ブラウザの表示
  const [ai, setAi] = useState(false); // AI パネルの表示
  const [gitOpen, setGitOpen] = useState(false); // Git パネルの表示
  const [aiJob, setAiJob] = useState<AiJob | null>(null); // 右クリックから AI パネルへ渡す依頼
  const [aiQuote, setAiQuote] = useState<AiQuote | null>(null); // 引用して AI パネルへ添える文・画像
  const aiSeq = useRef(0);
  const [cur, setCur] = useState<Pm<Cursor | null>>({});
  const [jump, setJump] = useState<Pm<Jump | undefined>>({});
  const [qo, setQo] = useState(false);
  const [cn, setCn] = useState(false);
  const me = useAccount();
  const unreplies = useReplies().unread;
  const [wsDlg, setWsDlg] = useState<null | "ws" | "profile">(null);
  const [lh, setLh] = useState<string | null>(null); // ローカル履歴を開いているファイルのパス
  const [statsOpen, setStatsOpen] = useState(false); const [ghOpen, setGhOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const { found: upd } = useUpdateState();
  const [updOpen, setUpdOpen] = useState(false);
  // 手動の確認。見つかれば確認の画面を開く
  const checkNow = async () => { const r = await runCheck(); if (r === "error") notify(i18next.t("更新を確認できませんでした"), "error"); else if (r) setUpdOpen(true); else if (!upd) notify(i18next.t("最新の版です"), "success"); else setUpdOpen(true); };
  const [setupOpen, setSetupOpen] = useState(needSetup);
  // 初回セットアップで選び終えてから、1 日 1 回だけ匿名の利用数を送る(開発中は送らない)
  useEffect(() => { if (!setupOpen) { sendPing(); installErrorHooks(); startUsageReports(); } }, [setupOpen]);
  // 起動して少ししたら、新しい版がないか確かめる(あれば右上に印を出す)。失敗しても何も出さない
  useEffect(() => { if (setupOpen || !import.meta.env.PROD) return; const t = setTimeout(() => { void runCheck(); }, 6000); return () => clearTimeout(t); }, [setupOpen]);
  const [pop, setPop] = useState<PopKind | null>(null);
  const wsStore = useWorkspaces();
  const pfStore = useProfiles();
  const wsAny = wsStore.list.find((w) => w.id === wsStore.current) ?? null;
  const ws = wsAny && !wsAny.temp ? wsAny : null; // 登録していないフォルダの「前回の続き」は、登録済みのワークスペースとしては扱わない
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
  // 左下の「フォルダ」の項目を広げているか。外をクリックするか Esc で畳む
  const [footOpen, setFootOpen] = useState(false);
  const [wsName, setWsName] = useState(""); // 左下で新しく作るワークスペースの名前
  const [freshRoot, setFreshRoot] = useState<string | null>(null); // いま足したフォルダ。見出しと中身を順に出す
  const [wsRen, setWsRen] = useState<string | null>(null); // ツリーの上で名前を変えている途中の値
  const footRef = useRef<HTMLDivElement>(null);
  // 広げた項目の高さ。ツリーのこの高さぶんを消して、項目の下に文字が透けて重ならないようにする(背景は敷かない)
  const [footH, setFootH] = useState(0);
  useEffect(() => {
    const el = footRef.current?.querySelector(".foot-menu");
    if (!el) return;
    const ro = new ResizeObserver(() => setFootH((el as HTMLElement).offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!footOpen) return;
    const down = (e: MouseEvent) => { if (!footRef.current?.contains(e.target as globalThis.Node)) setFootOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setFootOpen(false); };
    addEventListener("mousedown", down); addEventListener("keydown", key);
    return () => { removeEventListener("mousedown", down); removeEventListener("keydown", key); };
  }, [footOpen]);
  const [dlg, setDlg] = useState<Dlg | null>(null);
  // 外から閉じられても、閉じるアニメーションが終わるまで残す
  const pQo = usePresence(qo), pPal = usePresence(pal), pSetts = usePresence(setts), pDlg = usePresence(dlg), pCn = usePresence(cn);
  const pTp = usePresence(tp, 400), pWs = usePresence(wsDlg), pLh = usePresence(lh), pStats = usePresence(statsOpen), pGh = usePresence(ghOpen), pFb = usePresence(fbOpen), pUp = usePresence(updOpen), pSetup = usePresence(setupOpen), pPop = usePresence(pop, 140), pMenu = usePresence(menu, 140);
  const views = useRef<Pm<EditorView | null>>({});
  const apis = useRef(new Map<number, TermApi>());
  const seq = useRef(0);
  const sessRef = useRef<Sess[]>([]);
  sessRef.current = sess;
  const cleanT = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tabOf = (p: string | null) => tabs.find((t) => t.node.path === p) ?? null;
  const tab = tabOf(act[fp] ?? null);
  // タブがどの画面に出るか。分割していなければ、すべて左上の画面。どの画面にも属さないものも、左上に出す
  const mem = (i: number, p: string) => (!split ? i === first : !!grp[i]?.has(p) || (i === first && !Object.values(grp).some((g) => g.has(p))));
  const paneTabs = (i: number) => tabs.filter((t) => mem(i, t.node.path));
  const grpAdd = (g: Pm<Set<string>>, i: number, p: string): Pm<Set<string>> => ({ ...g, [i]: new Set(g[i]).add(p) });
  const grpDel = (g: Pm<Set<string>>, ps: Iterable<string>, i?: number): Pm<Set<string>> => {
    const list = new Set(ps), out: Pm<Set<string>> = {};
    for (const k of Object.keys(g)) { const n = Number(k); out[n] = i === undefined || i === n ? new Set([...g[n]].filter((x) => !list.has(x))) : g[n]; }
    return out;
  };
  // その画面で、閉じたタブの代わりに開くタブ(いちばん近いもの)
  const nearIn = (i: number, path: string, list: Tab[] = tabs, skip: Set<string> = new Set([path])) => {
    const k = list.findIndex((t) => t.node.path === path), c = list.filter((t) => !skip.has(t.node.path) && mem(i, t.node.path));
    return (c.find((t) => list.indexOf(t) > k) ?? c[c.length - 1])?.node.path ?? null;
  };
  const flash = (m: string, kind?: NoticeKind) => notify(m, kind);
  const dirtyList = tabs.filter((t) => isText(t) && t.text !== t.saved);

  /* ---------- ファイル ---------- */
  // 大きくて止めていたファイルを、「読み込む」で読む
  const forceLoad = async (n: Node) => {
    try {
      const { view, info } = await load(n, true);
      const text = view.kind === "text" ? view.text : "";
      setTabs((p) => p.map((t) => (t.node.path === n.path && t.view.kind === "unsupported" ? { ...t, view, info, text, saved: text, eol: view.kind === "text" ? view.eol ?? "lf" : "lf" } : t)));
    } catch (e) { flash(String(e), "error"); }
  };
  // 読み込み中のファイル(同じファイルを続けて押しても、読むのは 1 回)と、最後に押した順番
  const opening = useRef(new Map<string, ReturnType<typeof load>>());
  const openSeq = useRef(0);
  const open = useCallback(async (n: Node, pane: number = fp, pin = true) => {
    const seq = ++openSeq.current;
    let slow: ReturnType<typeof setTimeout> | undefined;
    if (!tabs.some((t) => t.node.path === n.path)) {
      try {
        let pend = opening.current.get(n.path);
        if (!pend) {
          const q = load(n);
          pend = q;
          opening.current.set(n.path, q);
          document.body.classList.add("opening");
          const done = () => { opening.current.delete(n.path); if (!opening.current.size) document.body.classList.remove("opening"); };
          q.then(done, done);
        }
        // 読み込みが長引くときだけ知らせる
        slow = setTimeout(() => flash(i18next.t("開いています…")), 700);
        const { view, info } = await pend;
        clearTimeout(slow);
        const text = view.kind === "text" ? view.text : "";
        const nt: Tab = { node: n, view, info, text, saved: text, eol: view.kind === "text" ? view.eol ?? "lf" : "lf" };
        // 一時表示のタブは、次に一時表示で開くものに置き換わる(未保存の変更があるもの・もう一方の画面に出ているものは除く)
        const old = !pin ? tabs.find((t) => t.node.path === preview) : undefined;
        const swap = !!old && old.text === old.saved && !leaves(lay).some((k) => k !== pane && act[k] === old.node.path);
        setTabs((p) => (p.some((t) => t.node.path === n.path) ? p : swap ? p.map((t) => (t.node.path === old!.node.path ? nt : t)) : [...p, nt]));
        if (swap) { revoke(old!); setGrp((g) => grpDel(g, [old!.node.path])); }
        setPreview(pin ? null : n.path);
        if (!swap) {
          setFresh((f) => new Set(f).add(n.path));
          setTimeout(() => setFresh((f) => { const x = new Set(f); x.delete(n.path); return x; }), ms(500));
        }
      } catch (e) { clearTimeout(slow); return flash((e as Error).message, "error"); }
      // 待っている間に別のファイルを押していたら、そちらを優先する(このファイルはタブにだけ追加する)
      if (seq !== openSeq.current) return;
    } else if (pin && preview === n.path) setPreview(null);
    setAct((a) => ({ ...a, [pane]: n.path }));
    setGrp((g) => (g[pane]?.has(n.path) ? g : grpAdd(g, pane, n.path)));
    setFp(pane);
  }, [tabs, fp, preview, act, lay]);

  // 一覧・クイックオープンから開くとき: すでに別の画面で開いていれば、その画面のタブへ移るだけにする(重複して開かない)
  const openOrFocus = (n: Node, pin = true) => {
    if (tabs.some((t) => t.node.path === n.path) && !mem(fp, n.path)) {
      const k = leaves(lay).find((i) => mem(i, n.path));
      if (k !== undefined) {
        if (pin && preview === n.path) setPreview(null);
        setAct((a) => ({ ...a, [k]: n.path })); setFp(k);
        return;
      }
    }
    return open(n, fp, pin);
  };
  const goto = async (n: Node, line: number, from = 0, to = 0) => {
    await open(n);
    setJump((j) => ({ ...j, [fp]: { line, from, to, n: Date.now() } }));
  };

  // JS/TS の言語機能: 言語サービスには、開いているタブの中身を渡す
  useEffect(() => { openFiles.v = Object.fromEntries(tabs.filter((t) => isText(t) && isScript(t.node.name)).map((t) => [t.node.path, t.text])); }, [tabs]);
  // 言語サーバー: WSL・PC のフォルダのタブを、そのフォルダの言語ごとのサーバーへ渡す
  const lspDocs = (): TabDoc[] => {
    if (!LSP_AVAILABLE) return [];
    const out: TabDoc[] = [];
    for (const t of tabs) {
      if (!isText(t) || !serverOfFile(t.node.name)) continue;
      const c = rootOf(t.node).conn;
      if (c && (c.kind === "wsl" || c.kind === "pc")) out.push({ vpath: t.node.path, abs: abs(t.node), conn: c, text: t.text });
    }
    return out;
  };
  useEffect(() => { lspSync(lspDocs(), lspOptsOf(st)); }, [tabs, st.tsServer, st.pyServer, st.htmlServer, st.cssServer, st.phpServer, st.goServer, st.rsServer, st.rbServer, st.sqlServer, st.tsLspWsl, st.tsLspPc, st.lspIdleMin]); // eslint-disable-line react-hooks/exhaustive-deps
  const lspServer = tab ? serverOfFile(tab.node.name)?.server.id ?? null : null;
  const lspConn = (() => { if (!LSP_AVAILABLE || !tab || !lspServer) return null; const c = rootOf(tab.node).conn; return c && (c.kind === "wsl" || c.kind === "pc") ? c : null; })();
  const lspKey = lspConn && lspServer ? sessionKey(lspConn, lspServer) : null;
  // 定義へ移動で別のファイルへ飛ぶとき(絶対パス → このフォルダの仮想パス)
  lspUi.openAt = async (conn, absPath, line, ch) => {
    const r = roots.find((x) => x.conn && connKey(x.conn) === connKey(conn));
    if (!r?.conn || !r.handle) return false;
    const base = normPath(r.conn.path).replace(/\/+$/, "");
    const p = normPath(absPath);
    if (p !== base && !p.startsWith(base + "/")) return false;
    const rel = p.slice(base.length).replace(/^\/+/, "");
    if (!rel) return false;
    const vpath = r.prefix ? `${r.prefix}/${rel}` : rel;
    const n = tabOf(vpath)?.node ?? (await nodeAt(r.handle, vpath, r.prefix));
    if (!n) return false;
    await goto(n, line + 1, ch, ch);
    return true;
  };
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
      if (f === file) { view.dispatch({ changes: sort(list).map((e) => ({ from: e.from, to: e.to, insert: e.text ?? e.pre + name + e.suf })), userEvent: "input.rename" }); continue; }
      setTabs((p) => p.map((t) => {
        if (t.node.path !== f || !isText(t)) return t;
        let x = t.text;
        for (const e of sort(list)) x = x.slice(0, e.from) + (e.text ?? e.pre + name + e.suf) + x.slice(e.to);
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
        setAct((a) => Object.fromEntries(Object.entries(a).map(([k, x]) => [k, x && gone.has(x) ? nearIn(Number(k), x, p, gone) : x])) as Pm<string | null>);
        setGrp((g) => grpDel(g, gone));
        return keep;
      });
      setChk((c) => c + 1);
      paths.forEach((x) => dropStates((k) => k.endsWith(`:${x}`)));
      setClosing((c) => { const n = new Set(c); gone.forEach((x) => n.delete(x)); return n; });
    }, ms(220));
  };
  // 一時表示(斜体)のタブは、どの画面でも選ばれなくなったら閉じる。未保存の変更があれば固定して残す(編集した時点でも固定される)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!preview || closing.has(preview) || Object.values(act).includes(preview)) return;
    const t = tabs.find((x) => x.node.path === preview);
    if (!t) { setPreview(null); return; }
    if (isText(t) && t.text !== t.saved) { setPreview(null); return; }
    setPreview(null);
    closeMany([preview], true);
  });
  const close = async (path: string) => {
    if (pinned.has(path)) return;
    const t = tabOf(path);
    if (t && st.confirmClose && isText(t) && t.text !== t.saved) {
      const c = await askChoice({ message: i18next.t("{{name}} は保存されていません。閉じますか?", { name: t.node.name }), ok: i18next.t("保存せずに閉じる"), alt: i18next.t("保存して閉じる"), danger: true });
      if (c === "cancel") return;
      if (c === "alt") {
        // 上書きの確認でやめた・書き込みに失敗したときは、閉じない
        if (!(await saveTab(t))) return;
      }
    }
    closeMany([path], true);
  };
  // 分割中、もう一方の画面にも出しているタブは、この画面から外すだけにする
  const closeIn = (path: string, i: number) => {
    if (!split || !leaves(lay).some((k) => k !== i && mem(k, path))) return close(path);
    setChk((c) => c + 1);
    setGrp((g) => grpDel(g, [path], i));
    setAct((a) => (a[i] === path ? { ...a, [i]: nearIn(i, path) } : a));
  };

  // 外で変更されたファイル(自動保存を止めたもの)。保存し直すか、読み直すと外す
  const conflicts = useRef(new Set<string>());
  // 最後に読んだ・保存したときの中身(改行コードの切り替えの印 \u0000 は除く)
  // eslint-disable-next-line no-control-regex
  const baseOf = (t: Tab) => t.saved.replace(/\u0000+$/, "");
  // 保存。設定に応じて、行末の空白を削り、末尾に改行を入れる
  const saveTab = useCallback(async (t: Tab, quiet = false): Promise<boolean> => {
    if (!isText(t)) { if (t.view.kind === "image") window.dispatchEvent(new CustomEvent(IMAGE_SAVE, { detail: t.node.path })); return false; }
    let text = t.text;
    if (st.trimOnSave) text = text.replace(/[ \t]+$/gm, "");
    if (st.reindentOnSave) text = reindent(text, t.node.path, { size: st.tabSize, spaces: st.insertSpaces });
    if (st.finalNewline && text && !text.endsWith("\n")) text += "\n";
    const mark = () => { setTabs((p) => p.map((x) => (x.node.path === t.node.path ? { ...x, text: x.text === t.text ? text : x.text, saved: text } : x))); setPreview((v) => (v === t.node.path ? null : v)); };
    if (!t.node.handle) { mark(); if (!quiet) flash(i18next.t("デモのファイルは、保存先がありません")); return false; }
    // 開いた(前に保存した)あとに、外(端末・ほかのアプリ)で書き換わっていないか確かめる。気づかずに上書きしないため
    const disk = await diskText(t.node);
    if (disk !== null && disk !== baseOf(t) && disk !== text) {
      if (quiet) {
        if (!conflicts.current.has(t.node.path)) { conflicts.current.add(t.node.path); flash(i18next.t("{{name}} は外で変更されたため、自動では保存しません。保存すると上書きします", { name: t.node.name }), "error"); }
        return false;
      }
      if (!(await ask({ message: i18next.t("{{name}} は、開いたあとに外で変更されています。上書きして保存しますか?", { name: t.node.name }), ok: i18next.t("上書きして保存"), danger: true }))) return false;
    }
    conflicts.current.delete(t.node.path);
    try { await writeFile(t.node.handle as FileSystemFileHandle, t.eol === "crlf" && st.remoteKeepEol ? text.replace(/\n/g, "\r\n") : text); mark(); noteSave(); recordSave(t.node.path, text, t.saved); setGitTick((n) => n + 1); if (!quiet) flash(i18next.t("保存しました")); return true; }
    catch (e) { flash(i18next.t("保存できませんでした: {{m}}", { m: (e as Error).message }), "error"); return false; }
  }, [st.trimOnSave, st.reindentOnSave, st.tabSize, st.insertSpaces, st.finalNewline, st.remoteKeepEol]);
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
  // Git パネルが見るフォルダ。gitAt は右クリックの「Git パネルで開く」で選んだもの(null なら開いているフォルダ)。
  // root: リポジトリの最上位。null はリポジトリではない、undefined はまだ調べている
  type GitAt = { conn: Conn; dir: string; root: string | null | undefined };
  const [gitAt, setGitAt] = useState<GitAt | null>(null);
  const connId = root.conn ? connKey(root.conn) : "";
  useEffect(() => setGitAt(null), [connId]);
  // ファイルの状態の表示を切っているときは gits が空なので、パネルを開いたときにここで調べる
  const [rootGit, setRootGit] = useState<{ key: string; root: string | null } | null>(null);
  useEffect(() => {
    const c = root.conn;
    if (!gitOpen || gitAt || !c || st.gitStatus) return;
    let live = true;
    void loadGit(c, c.path).then((i) => { if (live) setRootGit({ key: connId, root: i?.root ?? null }); });
    return () => { live = false; };
  }, [gitOpen, gitAt, connId, st.gitStatus, gitTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const gitView: GitAt | null = gitAt ?? (root.conn ? {
    conn: root.conn, dir: root.conn.path,
    root: st.gitStatus ? (root.prefix in gits ? gits[root.prefix]?.root ?? null : undefined) : rootGit?.key === connId ? rootGit.root : undefined,
  } : null);
  // フォルダを Git パネルで開く。中のリポジトリ(より上のフォルダが最上位のこともある)を調べてから切り替える
  const gitHere = async (c: Conn, dir: string) => {
    setGitOpen(true);
    if (root.conn && connKey(c) === connId && dir === root.conn.path) { setGitAt(null); setGitTick((n) => n + 1); return; }
    setGitAt({ conn: c, dir, root: undefined });
    const info = await loadGit(c, dir);
    setGitAt((g) => (g && g.conn === c && g.dir === dir ? { ...g, root: info?.root ?? null } : g));
  };
  const absOf = (n: Node) => (n.handle && (n.handle as { path?: string }).path) || null;
  const gitMark = useCallback((n: Node): GitMark | undefined => {
    const info = gits[splitRoot(n.path).prefix], abs = absOf(n);
    if (!info || !abs) return undefined;
    return n.kind === "dir" ? (info.dirs.has(abs) ? "dir" : undefined) : info.files.get(abs);
  }, [gits]);
  useEffect(() => {
    let live = true;
    for (const path of new Set(Object.values(act))) {
      const t = tabs.find((x) => x.node.path === path);
      const r = roots.find((x) => x.prefix === splitRoot(path ?? "").prefix), info = r && gits[r.prefix], abs = t && absOf(t.node);
      if (!t || !isText(t) || !r?.conn || !info || !abs) { setBases((b) => (path && b[path] !== undefined ? { ...b, [path]: null } : b)); continue; }
      void loadBase(r.conn, abs, info.files.get(abs)).then((v) => { if (live) setBases((b) => (b[path!] === v ? b : { ...b, [path!]: v })); });
    }
    return () => { live = false; };
  }, [gits, Object.values(act).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = async () => {
    const got = await Promise.all(roots.map(async (r) => ({ prefix: r.prefix, handle: r.handle, nodes: r.handle ? await readDir(r.handle, r.prefix).catch(() => null) : null })));
    // 1 つも読めなかったとき(切断など)は、呼び出し元に知らせる
    if (got.some((g) => g.handle) && got.every((g) => !g.handle || !g.nodes)) throw new Error(i18next.t("ファイル一覧を読み込めませんでした"));
    setRoots((p) => p.map((r) => { const g = got.find((x) => x.prefix === r.prefix && x.handle === r.handle); return g?.nodes ? { ...r, nodes: g.nodes } : r; }));
    setRev((r) => r + 1);
  };
  // フォルダの右クリックの「更新」。そのフォルダより下だけを読み直す(見出しは全体)
  const reloadUnder = async (n: Node | null) => {
    if (!n || n.kind !== "dir") return reload();
    const next = rev + 1;
    setRefreshScope(next, n.path);
    setRev(next);
  };
  // 画像の編集結果を書く。同じ名前なら上書きして表示を差し替え、別の形式(.ico など)は空いている名前の .png で隣に作る
  const saveImage = async (t: Tab, blob: Blob, outName: string) => {
    const h = t.node.handle as FileSystemFileHandle | undefined;
    if (!h) throw new Error(i18next.t("デモのファイルは、保存先がありません"));
    if (outName === t.node.name) {
      await writeBlob(h, blob);
      revoke(t);
      const url = URL.createObjectURL(blob);
      setTabs((p) => p.map((x) => (x.node.path === t.node.path ? { ...x, view: { kind: "image", url } } : x)));
      noteSave(); setGitTick((n) => n + 1);
      flash(i18next.t("保存しました"));
      return;
    }
    const dir = t.node.parent;
    if (!dir) throw new Error(i18next.t("保存先のフォルダがありません"));
    const name = await freeName(dir, outName);
    const nh = await createFile(dir, name);
    await writeBlob(nh, blob);
    await reload();
    setGitTick((n) => n + 1);
    open({ name, path: `${dirOf(t.node.path)}/${name}`, kind: "file", handle: nh, parent: dir });
    flash(i18next.t("{{n}} として保存しました", { n: name }));
  };
  // Git の操作でファイルが書き換わったあと、未編集のタブをディスクの中身に読み直す(古い内容を自動保存で書き戻さないため)
  const syncTabs = async () => {
    await reload().catch(() => {});
    for (const t of tabs) {
      if (!isText(t) || t.text !== t.saved || !t.node.handle) continue;
      try {
        const { view } = await load(t.node);
        if (view.kind !== "text" || view.text === t.saved) continue;
        setTabs((p) => p.map((x) => (x.node.path === t.node.path && isText(x) && x.text === x.saved ? { ...x, text: view.text, saved: view.text } : x)));
      } catch { /* 消えたファイルなどは、そのまま */ }
    }
  };
  /* ---------- ワークスペース ---------- */
  const snapshot = (): WsState => ({
    tabs: tabs.map((t) => t.node.path), ...savedPanes(), side, panel, term: term && alive().length > 0,
    cur: (() => { const c = cursorsNow(), keep = new Set(tabs.map((t) => t.node.path)); return Object.fromEntries(Object.entries(c).filter(([k]) => keep.has(k))); })(),
    pv: { mode: pvMode, pin: pvPin, r: pvR },
    terms: st.wsTerms ? alive().map((x) => ({ name: x.name, cwd: x.cwd ?? (x.shell ? undefined : root.conn?.path), shell: x.shell, label: x.label, host: x.host })) : [],
    actTerm: Math.max(0, alive().findIndex((x) => x.id === actT)),
  });
  const savedPanes = () => {
    const { lay: L, map } = renumber(lay), a: (string | null)[] = [], g: string[][] = [];
    for (const [o, n] of map) { a[n] = act[o] ?? null; g[n] = [...(grp[o] ?? [])]; }
    return { act: a, fp: map.get(fp) ?? 0, split, lay: split ? L : undefined, g: split ? g : undefined };
  };
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
  }, [tabs, act, fp, lay, grp, side, panel, term, sess, pvMode, pvPin, pvR, cur, st.wsDelay, st.wsTerms]);
  useEffect(() => {
    const f = () => flushRef.current();
    addEventListener("pagehide", f);
    return () => removeEventListener("pagehide", f);
  }, []);

  // フォルダ(複数も可)を切り替える。対応するワークスペースがあれば、その状態(タブ・分割・ターミナル)も戻す
  // フォルダを読み込んでいる間は、エクスプローラーを読み込み中の表示にする(重なっても数えて戻す)
  const [treeBusy, setTreeBusy] = useState(0);
  const busyWhile = async <T,>(f: () => Promise<T>): Promise<T> => { setTreeBusy((n) => n + 1); try { return await f(); } finally { setTreeBusy((n) => n - 1); } };
  const enterMany = async (specs: Spec[], target?: Workspace) => {
    if (dirtyList.length && st.confirmClose && !(await ask({ message: i18next.t("保存していない変更が {{length}} 件あります。切り替えると失われます。続けますか?", { length: dirtyList.length }), danger: true }))) return false;
    flushWs();
    restoring.current = true;
    const my = ++gen.current;
    const main = specs[0];
    setTreeBusy((n) => n + 1);
    try {
      const lists = await Promise.all(specs.map((x) => (x.handle ? readDir(x.handle, x.prefix) : Promise.resolve(DEMO_TREE))));
      await prefetchOpen(lists.flat());
      const hit = target ?? (main.handle && specs.length === 1 ? await matchRoot(main.ref, main.handle) : null);
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
      seedCursors(hit?.cur);
      setTabs(restored);
      const has = (p: string | null | undefined) => !!p && restored.some((t) => t.node.path === p);
      const L0: Lay = hit?.split && restored.length > 0 ? (hit.lay && validLay(hit.lay) ? hit.lay : fromPair(true, st.splitDir as Dir, st.splitRatio)) : LEAF0;
      // 開き直したときに、タブが 1 つも戻らなかった画面は、空のトップページを出さずにたたむ
      let L: Lay = L0;
      if (hit?.g && leaves(L0).length > 1) for (const k of leaves(L0)) if (!(hit.g[k] ?? []).some(has)) L = (L && removeLeaf(L, k)) ?? { id: leaves(L0)[0] };
      const ids = leaves(L);
      const a0 = hit && has(hit.act[0]) ? hit.act[0] : restored[0]?.node.path ?? null;
      const nextAct: Pm<string | null> = {}, nextGrp: Pm<Set<string>> = {};
      ids.forEach((id, k) => {
        const v = hit?.act[id];
        nextAct[id] = ids.length === 1 || !has(v) ? a0 : v!;
        nextGrp[id] = ids.length === 1 ? new Set() : new Set(hit?.g ? (hit.g[id] ?? []).filter(has) : k === 0 ? restored.map((t) => t.node.path) : nextAct[id] ? [nextAct[id]!] : []);
      });
      setLay(L); setAct(nextAct); setGrp(nextGrp); setBorn({});
      setFp(hit && ids.includes(hit.fp) ? hit.fp : ids[0]);
      if (hit) { setSide(hit.side); setPanel(hit.panel === "search" ? "files" : hit.panel); }
      setPvMode(hit?.pv?.mode === "split" || hit?.pv?.mode === "preview" ? hit.pv.mode : undefined);
      setPvPin(hit?.pv?.pin && has(hit.pv.pin) ? hit.pv.pin : null);
      if (typeof hit?.pv?.r === "number" && hit.pv.r > 0.1 && hit.pv.r < 0.9) setPvR(hit.pv.r);
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
      if (!w && st.wsAutoAdd && main.ref.kind !== "demo") {
        w = createWs(main.name, main.ref, emptyWs(), st.wsMax);
        if (specs.length > 1) setWsRoots(w.id, specs.map((x) => ({ ref: x.ref, prefix: x.prefix })));
      } else if (!w && main.ref.kind !== "demo") {
        // 登録しない設定のときも、前回のフォルダとタブは次の起動で戻せるように、非表示の 1 件に残す
        w = createTemp(main.name, main.ref, emptyWs());
        if (specs.length > 1) setWsRoots(w.id, specs.map((x) => ({ ref: x.ref, prefix: x.prefix })));
      } else if (w?.temp && st.wsAutoAdd) { patchWs(w.id, { temp: false }); }
      if (w) for (const x of specs) if (x.ref.kind === "local" && x.handle) await putHandle(handleKey(w.id, x.prefix), x.handle);
      activeWs.current = w?.id ?? null;
      setCurrent(w?.id ?? null);
      if (w?.profile && st.wsProfileLink && getProfiles().list.some((p) => p.id === w!.profile)) switchProfile(w.profile);
      return true;
    } finally { setTreeBusy((n) => n - 1); if (my === gen.current) restoring.current = false; }
  };
  // 1 つのフォルダを開く。同じフォルダを先頭にした複数フォルダのワークスペースがあれば、それをまとめて開く
  const enter = async (name: string, handle: FileSystemDirectoryHandle | undefined, ref: RootRef, conn?: Conn, target?: Workspace) => {
    const hit = target ?? (handle ? await matchRoot(ref, handle) : null);
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
    await busyWhile(async () => {
      for (const [i, e] of wsRoots(w).entries()) {
        try { specs.push(await specOf(w, e, ask)); } catch (err) { if (i === 0) throw err; skipped++; }
      }
    });
    const ok = await enterMany(specs, w);
    if (ok) flash(skipped ? i18next.t("ワークスペース「{{name}}」を開きました(開けないフォルダが {{n}} 件あります)", { name: w.name, n: skipped }) : i18next.t("ワークスペース「{{name}}」を開きました", { name: w.name }));
    return ok;
  };
  // 一覧・コマンド・スタート画面から切り替えたときは、画面の下の中央から波を出す(起動時の復元では出さない)
  const switchWs = async (w: Workspace) => {
    const ok = await openWs(w);
    if (ok && st.wsWave) wave();
    return ok;
  };
  const saveNew = async (name: string) => {
    const old = findWs(activeWs.current);
    const w = createWs(name, root.ref, snapshot(), st.wsMax);
    if (old?.temp) removeWs(old.id); // 「前回の続き」用の控えは、登録したものに置き換える
    if (roots.length > 1) setWsRoots(w.id, roots.map((r) => ({ ref: r.ref, prefix: r.prefix })));
    for (const r of roots) if (r.ref.kind === "local" && r.handle) await putHandle(handleKey(w.id, r.prefix), r.handle);
    activeWs.current = w.id; setCurrent(w.id);
    flash(i18next.t("ワークスペース「{{name}}」を保存しました", { name: w.name }));
    return w.id;
  };
  const commitWsRen = () => {
    if (wsRen === null) return;
    const v = wsRen.trim();
    if (v && ws && v !== ws.name) patchWs(ws.id, { name: v });
    setWsRen(null);
  };
  const untitled = roots.length > 1 && !ws; // フォルダを並べたが、まだワークスペースとして保存していない
  const createWsHere = async () => {
    await saveNew(wsName.trim() || roots.map((r) => r.name).join(" + "));
    setWsName(""); setFootOpen(false);
  };
  const quickSave = () => {
    if (activeWs.current && !findWs(activeWs.current)?.temp) { saveState(activeWs.current, snapshot()); flash(i18next.t("ワークスペース「{{arg0}}」に保存しました", { arg0: findWs(activeWs.current)?.name })); } else setWsDlg("ws");
  };
  // 起動したとき、前回のワークスペースを開く(PC のフォルダは許可が要るので、確認できなければ一覧を出す)
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const w = findWs(getWorkspaces().current);
      const mine = gen.current;
      try {
        // 「fixit ./」のように、起動のときにフォルダを渡されたら、前回のワークスペースではなくそのフォルダを開く
        const given = IS_TAURI ? await import("@tauri-apps/api/core").then((m) => m.invoke<string | null>("launch_target")).catch(() => null) : null;
        if (given) { setCurrent(null); const conn = normConn({ kind: "pc", path: given }); pushRecent(conn); await connect(conn); }
        else if (st.wsRestore && w && w.root.kind !== "demo") { flash(i18next.t("ワークスペースを開いています…")); await openWs(w, false); }
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
      const conn: Conn = normConn({ kind: "pc", path });
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
  // エクスプローラーへ、OS のフォルダ・ファイルをドロップして開く(フォルダはいまのフォルダに並べて足し、ファイルは各ファイルをタブで開く)
  const hasFiles = extFiles;
  const dropExternal = async (e: React.DragEvent) => {
    setRootDrop(false); setExtDrop(false);
    if (!hasFiles(e)) return;
    e.preventDefault();
    const items = [...e.dataTransfer.items].filter((i) => i.kind === "file");
    const hs = await Promise.all(items.map((i) => (i as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.() ?? null));
    try {
      const dirs = hs.filter((h): h is FileSystemDirectoryHandle => h?.kind === "directory");
      for (const d of dirs) { await addRoot(d.name, d, rootRefOf(undefined, d.name, true)); await new Promise((r) => setTimeout(r)); } // 開き直したあとの一覧が反映されるのを待つ
      if (dirs.length) return;
      const files = hs.filter((h): h is FileSystemFileHandle => h?.kind === "file");
      if (!files.length) { flash(i18next.t("ここへはドロップできません"), "error"); return; }
      for (const f of files) await open({ name: f.name, path: f.name, kind: "file", handle: f }, fp, true);
    } catch (err) { flash((err as Error).message, "error"); }
  };
  // OS のファイル・フォルダを、落とした所のフォルダ(dest。null ならフォルダ r の一番上)へ写す。同じ名前があれば「名前-2」にする
  const dropInto = (e: React.DragEvent, dest: Node | null, r?: Root) => {
    e.preventDefault(); e.stopPropagation();
    setRootDrop(false); setExtDrop(false); setDropTarget(null);
    // ドロップのイベントが終わると中身を読めなくなるので、待つ前にまとめて受け取っておく
    return putExternal(e.dataTransfer, dest, r);
  };
  // OS でコピーしたファイルを、エクスプローラーでの貼り付け(Ctrl+V)で入れる。ファイルの行ならその行があるフォルダへ、フォルダの行ならその中へ
  // exe: エクスプローラーでコピーしたファイル・フォルダを、OS のクリップボードから直接読んで写す(WebView の貼り付けはフォルダを渡さない)
  const pasteNative = async (dest: Node | null, imgs: File[] = []) => {
    let list: string[];
    try { list = await (await import("@tauri-apps/api/core")).invoke<string[]>("clip_files"); } catch { list = []; }
    if (!list.length && !imgs.length) return;
    const rr = dest ? rootOf(dest) : roots[0];
    const to = (dest?.handle ?? rr.handle) as FileSystemDirectoryHandle | undefined;
    if (!to) return flash(i18next.t("ここへはドロップできません"), "error");
    // 画像だけがコピーされているとき(スクリーンショット、コードの画像など)は、PNG のファイルとして入れる
    if (!list.length) {
      const d = new Date(), z = (v: number) => String(v).padStart(2, "0");
      const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
      const at = dest ? (dest.kind === "dir" ? dest.path : dirOf(dest.path)) : rr.prefix;
      if (dest) revealPaths([at]);
      const endImg = beginPending(at, imgs.map((_, i) => ({ name: `screenshot-${stamp}${imgs.length > 1 ? "-" + (i + 1) : ""}.png`, dir: false })));
      try {
        let k = 0;
        for (const f of imgs) {
          const ext = f.type === "image/jpeg" ? "jpg" : f.type === "image/gif" ? "gif" : f.type === "image/webp" ? "webp" : "png";
          const name = await freeEntryName(to, `screenshot-${stamp}${imgs.length > 1 ? "-" + (++k) : ""}.${ext}`);
          const w = await ((await to.getFileHandle(name, { create: true })) as unknown as { createWritable: () => Promise<{ write: (d: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> }).createWritable();
          await w.write(await f.arrayBuffer()); await w.close();
        }
        await reload();
        flash(i18next.t("{{n}} 件を「{{name}}」に入れました", { n: imgs.length, name: dest?.name ?? rr.name }));
      } catch (err) { flash(i18next.t("入れられませんでした: {{msg}}", { msg: (err as Error).message }), "error"); }
      finally { endImg(); }
      return;
    }
    const toPath = isRemote(to) && to.conn.kind === "pc" ? to.path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase() : null;
    // 入り終わるまで、入る先に名前つきの読み込み行を出す(閉じたフォルダなら開いて見せる)
    const at = dest ? (dest.kind === "dir" ? dest.path : dirOf(dest.path)) : rr.prefix;
    if (dest) revealPaths([at]);
    // 先に中身の種類(フォルダかファイルか)を調べて、並び順どおりの位置にスケルトンを出す
    const srcs = await Promise.all(list.map(async (raw) => {
      const q = raw.replace(/\\/g, "/").replace(/\/+$/, ""), i = q.lastIndexOf("/");
      const name = q.slice(i + 1), parent = q.slice(0, i) || "/";
      const dir = rootHandle({ kind: "pc", path: /^[A-Za-z]:$/.test(parent) ? parent + "/" : parent }) as unknown as FileSystemDirectoryHandle;
      const h = await dir.getDirectoryHandle(name).catch(() => null) ?? await dir.getFileHandle(name).catch(() => null);
      return { q, name, h };
    }));
    const endPending = beginPending(at, srcs.map((x) => ({ name: x.name, dir: x.h?.kind === "directory" })));
    try {
      let n = 0;
      for (const { q, name, h } of srcs) {
        if (!h) throw new Error(name + " を読めません");
        const lq = q.toLowerCase();
        if (h.kind === "directory" && toPath && (toPath === lq || toPath.startsWith(lq + "/"))) { flash(i18next.t("フォルダをそれ自身の中へは入れられません"), "error"); continue; }
        await copyInto(h, to, await freeEntryName(to, name)); n++;
      }
      if (!n) return;
      await reload();
      flash(i18next.t("{{n}} 件を「{{name}}」に入れました", { n, name: dest?.name ?? rr.name }));
    } catch (err) { flash(i18next.t("入れられませんでした: {{msg}}", { msg: (err as Error).message }), "error"); }
    finally { endPending(); }
  };
  // エクスプローラー内のコピー・切り取り。OS のクリップボードにはパスの文字を書き、貼り付けで同じ文字なら、持っている行を写す・移す
  const copyTree = async (mode: "copy" | "cut", list: Node[] = selectedNodes()) => {
    if (!list.length) return;
    const sig = list.map((n) => displayPath(n.path)).join("\n");
    setTreeClip(mode, list, sig);
    await writeClip(sig);
    if (mode === "copy") flash(i18next.t("コピーしました"));
  };
  // 貼り付け先のフォルダ。ファイルの行ならその行があるフォルダ、何もなければ(null)一番上
  const dirDest = (n: Node | null): Node | null => (!n || n.kind === "dir" ? n : { name: dirOf(n.path).split("/").pop() ?? "", path: dirOf(n.path), kind: "dir", handle: n.parent });
  const pasteTree = async (c: { mode: "copy" | "cut"; nodes: Node[] }, dest: Node | null) => {
    const rr = dest ? rootOf(dest) : roots[0];
    const to = (dest?.handle ?? rr.handle) as FileSystemDirectoryHandle | undefined;
    if (!to) return flash(i18next.t("ここへはドロップできません"), "error");
    if (c.mode === "cut") {
      for (const n of c.nodes) await moveTo(n, dest);
      clearTreeClip(); clearSel();
      return;
    }
    const at = dest ? (dest.kind === "dir" ? dest.path : dirOf(dest.path)) : rr.prefix;
    if (dest) revealPaths([at]);
    const end = beginPending(at, c.nodes.map((n) => ({ name: n.name, dir: n.kind === "dir" })));
    try {
      let k = 0;
      for (const n of c.nodes) {
        if (!n.handle) { flash(i18next.t("ここへはドロップできません"), "error"); continue; }
        // フォルダを、自分自身かその中へ写すと終わらないので止める
        if (n.kind === "dir" && (await inside(n.handle, rootOf(n).conn, to, rr.conn))) { flash(i18next.t("フォルダをそれ自身の中へは入れられません"), "error"); continue; }
        await copyInto(n.handle, to, await freeEntryName(to, n.name)); k++;
      }
      if (!k) return;
      await reload();
      flash(i18next.t("{{n}} 件を「{{name}}」に入れました", { n: k, name: dest?.name ?? rr.name }));
    } catch (err) { flash(i18next.t("入れられませんでした: {{msg}}", { msg: (err as Error).message }), "error"); }
    finally { end(); }
  };
  // メニューの「貼り付け」。このアプリでコピーしたものがあればそれを、なければ(exe のみ)OS でコピーしたファイルを入れる
  const pasteMenu = (n: Node | null) => { const c = getTreeClip(), d = dirDest(n); if (c) void pasteTree(c, d); else if (IS_TAURI) void pasteNative(d); };
  const pasteInto = (e: React.ClipboardEvent, dest: Node | null) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
    const own = treeClipFor(e.clipboardData?.getData("text/plain") ?? "");
    if (own) { e.preventDefault(); e.stopPropagation(); void pasteTree(own, dest); return; }
    if (IS_TAURI) {
      // 画像は貼り付けイベントの中でしか取れないので、先に受け取っておく
      const imgs = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      e.preventDefault(); e.stopPropagation(); void pasteNative(dest, imgs); return;
    }
    if (!e.clipboardData.files.length) return;
    e.preventDefault(); e.stopPropagation();
    return putExternal(e.clipboardData, dest);
  };
  const putExternal = async (dt: DataTransfer, dest: Node | null, r?: Root) => {
    const hps = [...dt.items].filter((i) => i.kind === "file").map((i) => (i as unknown as { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.());
    const files = [...dt.files];
    const rr = dest ? rootOf(dest) : r ?? roots[0];
    const to = (dest?.handle ?? rr.handle) as FileSystemDirectoryHandle | undefined;
    if (!to) return flash(i18next.t("ここへはドロップできません"), "error");
    try {
      let n = 0;
      const hs = hps.every(Boolean) ? await Promise.all(hps) : [];
      if (hs.some(Boolean)) {
        for (const h of hs) {
          if (!h) continue;
          // 落とした先が、落としたフォルダそのものかその中なら写さない(終わらなくなる)
          if (h.kind === "directory" && !isRemote(to) && (await (h as unknown as { resolve: (x: FileSystemHandle) => Promise<string[] | null> }).resolve(to).catch(() => null))) { flash(i18next.t("フォルダをそれ自身の中へは入れられません"), "error"); continue; }
          await copyInto(h, to, await freeEntryName(to, h.name)); n++;
        }
      } else {
        for (const f of files) {
          const w = await ((await to.getFileHandle(await freeEntryName(to, f.name), { create: true })) as unknown as { createWritable: () => Promise<{ write: (d: ArrayBuffer) => Promise<void>; close: () => Promise<void> }> }).createWritable();
          await w.write(await f.arrayBuffer()); await w.close(); n++;
        }
      }
      if (!n) return;
      await reload();
      flash(i18next.t("{{n}} 件を「{{name}}」に入れました", { n, name: dest?.name ?? rr.name }));
    } catch (err) { flash(i18next.t("入れられませんでした: {{msg}}", { msg: (err as Error).message }), "error"); }
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
    const cur = rootsNow.current;
    if (!cur[0].handle) return enter(name, handle, ref, conn);
    for (const r of cur) if (await sameFolder(r, ref, handle, conn)) { flash(i18next.t("既に追加されています")); return false; }
    try {
      const prefix = newPrefix();
      const nodes = await busyWhile(async () => { const l = await readDir(handle, prefix); await prefetchOpen(l); return l; });
      const next = [...rootsNow.current, { prefix, name, handle, nodes, conn, ref }];
      rootsNow.current = next;
      setRoots(next);
      setFreshRoot(prefix); setTimeout(() => setFreshRoot((v) => (v === prefix ? null : v)), ms(1200));
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
  // 開いているフォルダ(複数なら全部)を閉じて、起動直後の空の状態に戻す。保存したワークスペースは消さない
  const closeFolder = async () => {
    if (!root.handle) return;
    if (await enter(DEMO_NAME, undefined, { kind: "demo" })) flash(i18next.t("フォルダを閉じました"));
  };
  // フォルダをワークスペースから外す(ディスク上のフォルダは消さない)
  const removeRoot = async (prefix: string) => {
    const r = roots.find((x) => x.prefix === prefix);
    if (!r || roots.length < 2) return;
    const under = tabs.filter((t) => rootOfPath(t.node.path) === r);
    if (under.some((t) => dirtyList.includes(t)) && st.confirmClose && !(await ask({ message: i18next.t("保存していない変更があります。フォルダを外すと失われます。続けますか?"), danger: true }))) return;
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
  });

  // 開いているファイルが外で書き換わっていたら、未編集のタブは読み直す。編集中のタブは保存のときに確かめる
  // sshToo: SSH は読むたびに通信するので、設定で切れるようにする(この PC と WSL はいつも確かめる)
  const checkDisk = async (sshToo: boolean) => {
    for (const t of tabs) {
      if (!isText(t) || !t.node.handle || (!sshToo && rootOf(t.node).conn?.kind === "ssh")) continue;
      const disk = await diskText(t.node);
      if (disk === null || disk === baseOf(t)) continue;
      if (t.text === t.saved) {
        conflicts.current.delete(t.node.path);
        setTabs((p) => p.map((x) => (x.node.path === t.node.path && isText(x) && x.text === x.saved ? { ...x, text: disk, saved: disk } : x)));
      } else if (!conflicts.current.has(t.node.path)) {
        conflicts.current.add(t.node.path);
        flash(i18next.t("{{name}} は外で変更されました。保存すると上書きします", { name: t.node.name }), "error");
      }
    }
  };
  const diskRef = useRef(checkDisk);
  diskRef.current = checkDisk;
  useEffect(() => {
    let busy = false;
    const f = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try { await diskRef.current(st.remoteFocusReload); } finally { busy = false; }
    };
    addEventListener("focus", f);
    return () => removeEventListener("focus", f);
  }, [st.remoteFocusReload]);

  // 外(エクスプローラーや端末など)での追加・削除・改名に追従する。画面に出ているフォルダの更新日時(ブラウザ版の PC のフォルダは名前の一覧)を数秒ごとに確かめ、変わっていたら読み直す
  const watchRef = useRef({ roots, reload });
  watchRef.current = { roots, reload };
  useEffect(() => {
    const prev = new Map<string, string>();
    let busy = false, stop = false, n = 0;
    const look = async (r: Root): Promise<[string, string][]> => {
      if (!r.handle) return [];
      const rels = ["", ...shownOpen(r.prefix).map((p) => p.slice(r.prefix.length))].slice(0, 300);
      if (r.conn) {
        const base = (r.handle as unknown as RemoteDir).path.replace(/\/+$/, "");
        const abs = rels.map((x) => base + x || "/");
        const got = new Map<string, string>();
        for (const line of (await remoteSig(r.conn, abs)).split("\n")) { const t = line.indexOf("\t"); if (t > 0) got.set(line.slice(t + 1), line.slice(0, t)); }
        return abs.map((a) => [`${r.prefix}\0${a}`, got.get(a) ?? "-"]);
      }
      return Promise.all(rels.map(async (x): Promise<[string, string]> => {
        try {
          let d: FileSystemDirectoryHandle = r.handle!;
          for (const seg of x.split("/").filter(Boolean)) d = await d.getDirectoryHandle(seg);
          const names: string[] = [];
          for await (const n of (d as any).keys() as AsyncIterable<string>) names.push(n);
          return [`${r.prefix}\0${x}`, names.sort().join("/")];
        } catch { return [`${r.prefix}\0${x}`, "-"]; }
      }));
    };
    const tick = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const { roots, reload } = watchRef.current;
        // SSH は Windows では接続を使い回せず毎回つなぎ直すので、4 回に 1 回(約 10 秒ごと)だけ見る
        const due = roots.filter((r) => r.conn?.kind !== "ssh" || n % 4 === 0);
        n++;
        const got = await Promise.all(due.map((r) => look(r).catch(() => [] as [string, string][]))); // 切れているフォルダは今回は見ない
        if (stop) return;
        // 前に見たフォルダの値が変わったときだけ読み直す(フォルダを開いて見る対象が増えただけでは読み直さない)
        let changed = false;
        for (const [k, v] of got.flat()) { if (prev.has(k) && prev.get(k) !== v) changed = true; prev.set(k, v); }
        if (changed) { await reload(); await diskRef.current(true); } // 保存のしかたによっては(一時ファイルからの置き換え)、フォルダの更新日時も変わる
      } catch { /* 読めないときは次の回に */ } finally { busy = false; }
    };
    const id = setInterval(tick, 2500);
    return () => { stop = true; clearInterval(id); };
  }, []);

  const parentDir = (n: Node | null) => (n ? (n.kind === "dir" ? n : null) : null);
  // エクスプローラーの中で名前を打って作る。「a/b/c.js」なら a と b を作ってから c.js を作る
  const create = (kind: "file" | "dir", at: Node | null) => {
    const rr = at ? rootOf(at) : roots[0];
    const base = at ? at.path : rr.prefix;
    const parts = (v: string) => v.split(/[\\/]+/).map((x) => x.trim()).filter(Boolean);
    setSide(true); setPanel("files");
    if (!at && folded.has(rr.prefix)) setFolded((p) => { const q = new Set(p); q.delete(rr.prefix); return q; });
    startCreating({
      kind, at: at ? at.path : rr.prefix,
      validate: (v) => {
        const ps = parts(v);
        if (!ps.length) return null;
        if (ps.some((x) => x === "." || x === "..")) return i18next.t("「.」「..」は使えません");
        return exists(rr.nodes, `${base}/${ps.join("/")}`) ? i18next.t("同じ名前があります") : null;
      },
      submit: async (v) => {
        const ps = parts(v), dirs = kind === "file" ? ps.slice(0, -1) : ps, last = kind === "file" ? ps[ps.length - 1] : "";
        const full = [...dirs, ...(last ? [last] : [])].join("/");
        try {
          const through: string[] = []; let acc = base;
          for (const d of dirs) { acc += "/" + d; through.push(acc); }
          if (rr.handle) {
            let dir = (parentDir(at)?.handle ?? rr.handle) as FileSystemDirectoryHandle;
            for (const d of dirs) dir = await createDir(dir, d);
            const h = last ? await createFile(dir, last) : undefined;
            for (const p of through) setOpenPath(p, true);
            await reload();
            revealPaths([...(at ? [at.path] : []), ...through]);
            if (h) open({ name: last, path: `${base}/${full}`, kind: "file", handle: h, parent: dir });
          } else {
            const made: Node = last ? { name: last, path: `${base}/${full}`, kind: "file", demo: "" } : { name: "", path: "", kind: "dir" };
            updRoot(rr.prefix, (r) => {
              let nodes = r.nodes, cur = base;
              for (const d of dirs) { const p = `${cur}/${d}`; if (!exists(nodes, p)) nodes = addNode(nodes, cur, { name: d, path: p, kind: "dir", children: [] }); cur = p; }
              return { ...r, nodes: last ? addNode(nodes, cur, { ...made, name: last }) : nodes };
            });
            for (const p of through) setOpenPath(p, true);
            revealPaths([...(at ? [at.path] : []), ...through]);
            if (last) open(made);
          }
        } catch (e) { flash("作れませんでした: " + (e as Error).message); }
      },
    });
  };
  const rename = (n: Node) => {
    const rr = rootOf(n);
    if (n.kind === "dir" && rr.handle && !rr.conn && !canMove()) return flash(i18next.t("フォルダの名前の変更は、まだできません"));
    setDlg({
      title: i18next.t("名前の変更"), input: n.name, ok: i18next.t("変更"), icon: (v) => (n.kind === "dir" ? <Folder className="ico folder" /> : iconFor(v.trim() || n.name)),
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
          } else if (rr.handle && n.handle) {
            handle = await renameFile((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.handle, name);
            if (n.kind === "dir") closeMany(tabs.filter((t) => t.node.path.startsWith(n.path + "/")).map((t) => t.node.path), true);
          }
          else updRoot(rr.prefix, (r) => ({ ...r, nodes: renameNode(r.nodes, n.path, name) }));
          setTabs((p) => p.map((t) => (t.node.path === n.path ? { ...t, node: { ...t.node, name, path: np, handle } } : t)));
          setGrp((g) => Object.fromEntries(Object.entries(g).map(([k, x]) => [k, x.has(n.path) ? new Set([...x].map((q) => (q === n.path ? np : q))) : x])) as Pm<Set<string>>);
          setAct((a) => Object.fromEntries(Object.entries(a).map(([k, x]) => [k, x === n.path ? np : x])) as Pm<string | null>);
          dropStates((k) => k.endsWith(`:${n.path}`));
          if (rr.handle) await reload();
        } catch (e) { flash("変更できませんでした: " + (e as Error).message); }
      },
    });
  };
  // ドラッグで別のフォルダへ移す(dest が null なら最上位)。別のルートのフォルダへは移せない
  // フォルダ to が、フォルダ src そのものかその中か。接続先が違っても同じディスクのこともある(このPC の C:/x と WSL の /mnt/c/x)
  const inside = async (src: FileSystemHandle, sc: Conn | undefined, to: FileSystemDirectoryHandle, tc: Conn | undefined) => {
    if (!isRemote(src) && !isRemote(to)) return !!(await (src as unknown as { resolve: (x: FileSystemHandle) => Promise<string[] | null> }).resolve(to).catch(() => null));
    if (!sc || !tc || sc.kind === "ssh" || tc.kind === "ssh") return false;
    const disk = (c: Conn, p: string) => {
      const m = c.kind === "wsl" ? /^\/mnt\/([a-z])(\/.*)?$/i.exec(p) : null;
      return (m ? `${m[1]}:${m[2] ?? ""}` : p.replace(/\\/g, "/")).replace(/\/+$/, "").toLowerCase();
    };
    const a = disk(sc, (src as unknown as RemoteDir).path), b = disk(tc, (to as unknown as RemoteDir).path);
    return b === a || b.startsWith(a + "/");
  };
  const moveTo = async (n: Node, dest: Node | null) => {
    const rr = rootOf(n), dr = dest ? rootOf(dest) : rr, cross = dr !== rr; // cross: ワークスペースの別のフォルダへ移す
    const base = dest ? dest.path : rr.prefix;
    if (dirOf(n.path) === base || (n.kind === "dir" && (base === n.path || base.startsWith(n.path + "/")))) return;
    // サンプルのフォルダとは、中身の持ち方が違うので移し合えない
    if (cross && (!rr.handle || !dr.handle || !n.handle)) return flash(i18next.t("別のフォルダへは移せません"));
    if (!cross && exists(rr.nodes, `${base}/${n.name}`)) return flash(i18next.t("同じ名前があります"));
    const under = tabs.filter((t) => t.node.path === n.path || t.node.path.startsWith(n.path + "/"));
    if (under.some((t) => dirtyList.includes(t))) return flash(i18next.t("保存していない変更があるので、移せません"));
    try {
      const np = `${base}/${n.name}`, to = (dest?.handle ?? dr.handle) as FileSystemDirectoryHandle | undefined;
      const from = (n.parent ?? rr.handle) as FileSystemDirectoryHandle;
      let handle = n.handle;
      if (rr.conn && dr.conn && rr.conn.kind === dr.conn.kind && (rr.conn.host ?? "") === (dr.conn.host ?? "")) {
        // 同じ接続先(このPC・同じ WSL・同じ SSH ホスト)の中なら、mv 1回で移す
        const d = to as unknown as RemoteDir;
        await (from as unknown as RemoteDir).moveTo(n.name, d);
        handle = n.kind === "file" ? (new RemoteFile(dr.conn, `${d.path === "/" ? "" : d.path}/${n.name}`, n.name) as unknown as FileSystemHandle) : undefined;
      } else if (rr.handle && n.handle && to) {
        // 接続先が違うときは、写してから元を消す。フォルダをそれ自身の中へ写すと終わらないので止める
        if (cross && n.kind === "dir" && (await inside(n.handle, rr.conn, to, dr.conn))) return flash(i18next.t("フォルダをそれ自身の中へは入れられません"), "error");
        if (cross) flash(i18next.t("「{{name}}」を移しています…", { name: n.name }));
        handle = await moveEntry(from, n.handle, to);
      } else updRoot(rr.prefix, (r) => ({ ...r, nodes: moveNode(r.nodes, n.path, base) }));
      if (n.kind === "dir") closeMany(under.map((t) => t.node.path), true);
      else {
        setTabs((p) => p.map((t) => (t.node.path === n.path ? { ...t, node: { ...t.node, path: np, handle, parent: to } } : t)));
        setAct((a) => Object.fromEntries(Object.entries(a).map(([k, x]) => [k, x === n.path ? np : x])) as Pm<string | null>);
        setGrp((g) => Object.fromEntries(Object.entries(g).map(([k, x]) => [k, x.has(n.path) ? new Set([...x].map((q) => (q === n.path ? np : q))) : x])) as Pm<Set<string>>);
      }
      dropStates((k) => k.endsWith(`:${n.path}`));
      if (rr.handle || dr.handle) await reload();
      flash(i18next.t("「{{name}}」を移しました", { name: n.name }));
    } catch (e) { flash("移せませんでした: " + (e as Error).message); }
  };
  const remove = (n: Node) => {
    const rr = rootOf(n);
    setDlg({
      title: i18next.t("「{{name}}」を削除", { name: n.name }), desc: n.kind === "dir" ? i18next.t("中のファイルもすべて消えます。元に戻せません。") : i18next.t("元に戻せません。"), ok: i18next.t("削除"), danger: true,
      onSubmit: async () => {
        const out = leaveRows([n.path]); // 先に畳んで見せる(遅い場所でも、すぐ消えたように見える)
        try {
          if (rr.handle) await removeEntry((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.name);
          else updRoot(rr.prefix, (r) => ({ ...r, nodes: removeNode(r.nodes, n.path) }));
          closeMany(tabs.filter((t) => t.node.path === n.path || t.node.path.startsWith(n.path + "/")).map((t) => t.node.path), true);
          if (rr.handle) await reload();
          out.settle();
          flash(i18next.t("削除しました"));
        } catch (e) { out.undo(); flash("削除できませんでした: " + (e as Error).message); }
      },
    });
  };
  // 複数選択をまとめて消す(確認は 1 回)
  const removeMany = (list: Node[]) => {
    if (list.length === 1) return remove(list[0]);
    setDlg({
      title: i18next.t("{{n}} 件を削除", { n: list.length }),
      desc: list.slice(0, 5).map((x) => x.name).join("、") + (list.length > 5 ? " …" : "") + "\n" + (list.some((x) => x.kind === "dir") ? i18next.t("中のファイルもすべて消えます。元に戻せません。") : i18next.t("元に戻せません。")),
      ok: i18next.t("削除"), danger: true,
      onSubmit: async () => {
        let ok = 0, last = "";
        const out = leaveRows(list.map((x) => x.path));
        for (const n of list) {
          const rr = rootOf(n);
          try {
            if (rr.handle) await removeEntry((n.parent ?? rr.handle) as FileSystemDirectoryHandle, n.name);
            else updRoot(rr.prefix, (r) => ({ ...r, nodes: removeNode(r.nodes, n.path) }));
            closeMany(tabs.filter((t) => t.node.path === n.path || t.node.path.startsWith(n.path + "/")).map((t) => t.node.path), true);
            ok++;
          } catch (e) { last = (e as Error).message; out.undo([n.path]); }
        }
        clearSel();
        await reload();
        out.settle();
        if (ok === list.length) flash(i18next.t("{{n}} 件を削除しました", { n: ok }));
        else flash(i18next.t("{{n}} 件を削除できませんでした: {{msg}}", { n: list.length - ok, msg: last }), "error");
      },
    });
  };
  const abs = (n: Node) => {
    const rr = rootOf(n);
    return n.handle && "path" in n.handle ? (n.handle as unknown as { path: string }).path : (rr.conn?.path ?? "") + n.path.slice(rr.prefix.length);
  };
  const copyText = (s: string, m = i18next.t("コピーしました")) => copyWithNotice(s, m);
  // 画像はクリップボードへ PNG で(ファイルの中身。編集中の画像は、編集画面のコピーボタンから)
  const copyImg = (n: Node) => copyImage(getFile(n).then((f) => (!f.type && /\.svg$/i.test(n.name) ? new Blob([f], { type: "image/svg+xml" }) : f))).then(() => flash(i18next.t("画像をコピーしました")), () => flash(i18next.t("画像をコピーできませんでした")));
  const copyBody = async (n: Node) => {
    const open = tabs.find((x) => x.node.path === n.path);
    if (open && isText(open)) return copyText(open.text, i18next.t("中身をコピーしました"));
    const r = await load(n).catch(() => null);
    if (r?.view.kind === "text") copyText(r.view.text, i18next.t("中身をコピーしました"));
    else flash(i18next.t("テキストではないため、中身をコピーできません"));
  };
  const fileExtras = (n: Node) => [
    ...(isImageName(n.name) ? [{ label: i18next.t("画像をコピー"), icon: ic(ImageIcon), run: () => void copyImg(n) }] : []),
    ...(previewKind(n.name) ? [{ label: i18next.t("プレビューで開く"), icon: ic(Eye), run: () => { openOrFocus(n); setPvMode("preview"); } }] : []),
    ...(!isImageName(n.name) && !/\.(pdf|mp3|wav|ogg|m4a|flac|aac|mp4|webm|mov|m4v|docx)$/i.test(n.name) ? [{ label: i18next.t("中身をコピー"), icon: ic(ClipboardCopy), run: () => void copyBody(n) }] : []),
  ];

  /* ---------- 分割・ターミナル ---------- */
  // 画面の木を差し替え、なくなった画面の持ち物(タブの割り振り・カーソル・エディタの状態)を片づける
  const settle = (L: Lay, keepFp?: number) => {
    const ids = leaves(L), alive = (k: number) => ids.includes(k);
    const cut = <T,>(m: Pm<T>) => Object.fromEntries(Object.entries(m).filter(([k]) => alive(Number(k)))) as Pm<T>;
    for (const k of leaves(lay)) if (!alive(k)) { dropStates((x) => x.startsWith(`${k}:`)); delete views.current[k]; }
    setLay(L); setAct(cut); setJump(cut); setCur(cut); setBorn(cut); setGrp(ids.length === 1 ? {} : cut);
    setFp((p) => (alive(keepFp ?? p) ? keepFp ?? p : ids[0]));
  };
  // 分割を解く。いまフォーカスのある画面を残す
  const closePane = () => {
    if (split) settle({ id: fp }, fp);
  };
  // 閉じる・送るで画面が空になったら、その画面をたたむ(空の画面にトップページを出さない)
  useEffect(() => {
    if (!chk || chk === seen.current || closing.size) return;
    seen.current = chk;
    if (!split) return;
    const gone = leaves(lay).filter((k) => paneTabs(k).length === 0);
    if (!gone.length) return;
    let L: Lay | null = lay;
    for (const k of gone) L = L && removeLeaf(L, k);
    settle(L ?? { id: first });
  }, [chk, tabs, grp, closing, lay]); // eslint-disable-line react-hooks/exhaustive-deps
  const defEdge: Edge = st.splitDir === "row" ? "B" : "R"; // 設定の向きで分割するとき、新しい画面を置く側
  // 画面 id を、edge の側に新しく分割する。分割していなければ、左にいまのタブをすべて残す。dup のタブは新しい画面にも出す。戻り値は新しい画面の番号
  const splitAt = (id: number, edge: Edge, dup: string | null): number => {
    const nid = nextId(lay);
    setLay((l) => splitLeaf(l, id, nid, edge, edge === "L" || edge === "T" ? 100 - st.splitRatio : st.splitRatio));
    const mine = new Set(dup ? [dup] : []);
    setGrp((g) => (split ? { ...g, [nid]: mine } : { [id]: new Set(tabs.map((t) => t.node.path)), [nid]: mine }));
    setBorn((b) => ({ ...b, [nid]: edge }));
    setTimeout(() => setBorn((b) => { const x = { ...b }; delete x[nid]; return x; }), ms(900));
    return nid;
  };
  const toggleSplit = () => {
    if (split) { closePane(); return; }
    const dup = act[fp] ?? null, nid = splitAt(fp, defEdge, dup);
    setAct((a) => ({ ...a, [nid]: dup })); setFp(nid);
  };
  // いまの画面の次の画面(分割していなければ、そのまま)
  const otherOf = (from = fp) => { const ids = leaves(lay); return ids[(ids.indexOf(from) + 1) % ids.length]; };
  const openSplit = async (n: Node) => { await open(n, split ? otherOf() : splitAt(fp, defEdge, null)); };
  // 指定の画面で開く。move なら、元の画面には隣のタブを出す
  const sendTo = async (n: Node, to: number, move = false, from = fp) => {
    if (to === from) return open(n, to);
    const nb = nearIn(from, n.path);
    await open(n, to);
    if (!move) return;
    setChk((c) => c + 1);
    setGrp((g) => grpDel(g, [n.path], from));
    setAct((a) => (a[from] === n.path ? { ...a, [from]: nb } : a));
  };
  // 画面を入れ替える(中身ではなく場所を入れ替えるので、エディタの状態はそのまま)
  const swapPanes = () => { if (split) setLay((l) => swapLeaves(l, fp, otherOf())); };
  // pane の edge の側に新しく分割して開く
  const splitDrop = async (n: Node, pane: number, edge: Edge, move = false, from = fp) => {
    const nid = splitAt(pane, edge, null);
    await sendTo(n, nid, move, from);
  };
  // 分割して開くメニュー(タブやファイルの右クリック用)
  const splitSub = (n: Node, move = false, pane = fp) => ({
    label: i18next.t("分割して開く"), icon: ic(Columns2),
    sub: [
      { label: i18next.t("左に分割"), icon: ic(PanelLeft), run: () => splitDrop(n, pane, "L", move, pane) },
      { label: i18next.t("右に分割"), icon: ic(PanelRight), run: () => splitDrop(n, pane, "R", move, pane) },
      { label: i18next.t("上に分割"), icon: ic(PanelTop), run: () => splitDrop(n, pane, "T", move, pane) },
      { label: i18next.t("下に分割"), icon: ic(PanelBottom), run: () => splitDrop(n, pane, "B", move, pane) },
    ],
  });
  const flipDir = () => { if (split) setLay((l) => flipAround(l, fp)); else update({ splitDir: st.splitDir === "col" ? "row" : "col" }); };
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
  // ドラッグ中、ポインタがどの画面の上か。画面の端(幅・高さの 28%)に寄せると、その側に新しく分割する
  const zoneOf = (e: React.DragEvent): Dz => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    let hit = fp, b: Box = { x: 0, y: 0, w: 1, h: 1 };
    for (const [id, x] of boxes(lay)) if (fx >= x.x && fx <= x.x + x.w && fy >= x.y && fy <= x.y + x.h) { hit = id; b = x; break; }
    const lx = (fx - b.x) / b.w, ly = (fy - b.y) / b.h;
    if (!paneTabs(hit).length) return { pane: hit }; // タブのない画面(トップ画面)は分割先にしない
    const m = Math.min(lx, 1 - lx, ly, 1 - ly);
    if (m > 0.28) return { pane: hit };
    return { pane: hit, edge: m === lx ? "L" : m === 1 - lx ? "R" : m === ly ? "T" : "B" };
  };
  const dropOnPanes = async (z: Dz) => {
    const n = drag.node, path = drag.tab, from = path ? drag.from : fp;
    dragEnd(); setDz(null); setTabDrop(null);
    const node = n ?? tabOf(path);
    if (!node) return;
    const nd = "node" in node ? node.node : node;
    if (z.edge) {
      // 自分の画面にある最後の1枚を、自分の端へ落としても何も変わらない。ほかの画面のタブなら、複製ではなく移動(空になった元の画面はたたまれる)
      if (path && z.pane === from && paneTabs(from).length <= 1) return;
      await splitDrop(nd, z.pane, z.edge, !!path, from);
    }
    else await sendTo(nd, z.pane, !!path, from);
  };
  // 境目をドラッグして、その分割の割合を変える
  const gripDown = (e: React.PointerEvent<HTMLDivElement>, j: Joint) => {
    e.preventDefault();
    const el = e.currentTarget.parentElement!;
    const mv = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const f = j.dir === "row" ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
      const local = j.dir === "row" ? (f - j.box.y) / j.box.h : (f - j.box.x) / j.box.w;
      setLay((l) => setRatio(l, j.path, local * 100));
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); setDragS(false); setGripOn(null); };
    setDragS(true); setGripOn(j.path.join(".")); addEventListener("pointermove", mv); addEventListener("pointerup", up);
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

  // ▶ 実行: 開いているファイルを、設定の「実行」にある拡張子ごとのコマンドで、ターミナルから走らせる
  const runCmd = tab && isText(tab) && tab.node.handle ? runnerFor(tab.node.name, st.runners) : null;
  const typeInTerm = (id: number, text: string, tries = 0) => {
    const api = apis.current.get(id);
    if (api) { if (st.runClear) api.clear(); api.send(text + "\r"); api.focus(); } else if (tries < 40) setTimeout(() => typeInTerm(id, text, tries + 1), 100);
  };
  // ▶ ポートの公開(dela): 専用のターミナルで dela を動かし、出た公開 URL を拾う。止めるときはそのターミナルへ Ctrl+C
  // ポートの公開は、画面に出さない端末(bg.ts)の中で動かす。止める・アプリを閉じるときは、その端末ごと止める
  const [delas, setDelas] = useState<Pub[]>([]);
  const bgs = useRef(new Map<number, Bg>());
  const bgSeq = useRef(0);
  const [portsOpen, setPortsOpen] = useState(false);
  const [logId, setLogId] = useState<number | null>(null); // ログを見ているポート(delas の id)
  const pLog = usePresence(delas.find((d) => d.id === logId));
  const patchDela = (id: number, f: (d: Pub) => Pub) => setDelas((p) => p.map((d) => (d.id === id ? f(d) : d)));
  const startDela = (port: string, o: { dir?: string; rel?: string; temp?: boolean; name?: string } = {}) => {
    if (delas.some((d) => d.port === port && d.state !== "fail")) return flash(i18next.t("ポート {{port}} はすでに公開しています", { port }));
    void (async () => {
      const c = root.conn;
      // 入っているかを先に調べる(exe だけ。調べられないときは、起動したシェルで確かめる)
      let have = true;
      if (IS_TAURI && c) { try { have = (await execCmd(c, c.path, DELA_CHECK, 15)).code === 0; } catch { have = true; } }
      if (!have && !(await ask({ message: i18next.t("dela が見つかりません。{{cmd}} で入れてから公開します。続けますか?", { cmd: DELA_INSTALL }), ok: i18next.t("入れて公開する") }))) return;
      const id = ++bgSeq.current + 100000; // 画面のターミナルの番号とぶつからないように離す
      let tail = "", up = false;
      setDelas((p) => [...p.filter((d) => d.port !== port), { id, port, state: "start", dir: o.dir, rel: o.rel, temp: o.temp, name: o.name }]);
      bgs.current.set(id, startBg({
        id, command: have ? publishCmd(port, o) : installAndPublish(port, o), host: c?.kind === "ssh" ? c.host : undefined, cwd: o.dir ?? c?.path,
        onOut: (chunk) => {
          logAppend(id, chunk);
          tail = (tail + stripAnsi(chunk)).slice(-400);
          const url = findUrl(chunk);
          if (url) { up = true; patchDela(id, (d) => (d.url ? d : { ...d, url, state: "up" })); if (!o.temp && o.dir && c) rememberPublish(`${c.kind}:${c.host ?? ""}`, o.dir, o.name, port); } // URL が出たら履歴に残し、ポート管理から同じ設定でもう一度公開できるようにする
          else { const last = tail.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).pop(); if (last) patchDela(id, (d) => (d.url || d.state === "fail" ? d : { ...d, note: last.slice(0, 160) })); } // 待っている間の途中経過(ホバーで見える)
        },
        onEnd: () => {
          bgs.current.delete(id);
          const note = tail.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-2).join(" ").slice(0, 160);
          setDelas((p) => p.flatMap((d) => (d.id !== id ? [d] : d.url ? [] : [{ ...d, state: "fail" as const, note }])));
          if (up) logDrop(id); // 公開していた行は消えるので、ログも捨てる(失敗した行は、閉じるまで残す)
        },
      }));
    })();
  };
  const stopDela = (id: number) => {
    bgs.current.get(id)?.stop();
    bgs.current.delete(id);
    logDrop(id);
    setLogId((x) => (x === id ? null : x));
    setDelas((p) => p.filter((d) => d.id !== id));
  };
  const runFile = async () => {
    if (!tab || !isText(tab) || !tab.node.handle) return flash(i18next.t("実行できるファイルを開いてください"));
    const tpl = runnerFor(tab.node.name, st.runners);
    if (!tpl) return flash(i18next.t("この種類のファイルの実行コマンドが未設定です(設定の「実行」で追加できます)"));
    const rr = rootOf(tab.node), built = buildCommand(tpl, abs(tab.node));
    if (!built) return flash(i18next.t("パスに使えない文字が含まれているため、実行できません"), "error");
    if (st.runSave && tab.text !== tab.saved) await saveTab(tab, true);
    const ssh = rr.conn?.kind === "ssh";
    const cur = alive().find((x) => x.id === actT);
    if (cur && !ssh && !cur.host && !cur.shell && built.dir.startsWith("/") && apis.current.get(cur.id)) { // いまのターミナルを使い回す(場所だけ移す)
      showTerm(true); setTermKey((k) => k + 1); typeInTerm(cur.id, `cd ${shq(built.dir)} && ${built.cmd}`); return;
    }
    const id = seq.current + 1;
    addTerm(built.dir, undefined, ssh ? rr.conn!.host : null);
    typeInTerm(id, built.cmd);
  };  useEffect(() => {
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
      palette: () => setPal(true), quickOpen: () => setQo(true), save, openFolder, closeFolder, addFolder, addRemote: () => { if (root.handle) { setCnAdd(true); setCn(true); } }, connect: () => { setCnAdd(false); setCn(true); }, workspaces: () => setWsDlg("ws"), profiles: () => setWsDlg("profile"), saveWorkspace: quickSave, newFile: () => create("file", null), settings: () => setSetts("look"), shortcuts: () => setSetts("keys"),
      newTerm: () => addTerm(), runFile, closeTerm: () => alive().length && endTerm(actT), nextTerm: () => stepTerm(1), prevTerm: () => stepTerm(-1),
      renameTerm: () => { if (alive().length) { showTerm(true); setRenaming(actT); } }, clearTerm: () => apis.current.get(actT)?.clear(),
      aiQuote: () => { const v = views.current[fp]; if (v) quoteToAi(v); },
      toggleSide: () => setSide((v) => !v), themePanel: () => setTp((v) => !v), stats: () => setStatsOpen(true), toggleTerm: () => showTerm(), toggleBrowser: () => setBr((v) => !v), toggleAi: () => setAi((v) => !v), togglePreview: () => { if (tab && previewKind(tab.node.name)) setPvMode((m) => (m === undefined ? "split" : m === "split" ? "preview" : undefined)); }, toggleSplit,
      otherPane: () => { if (split) { const n = otherOf(); setFp(n); setTimeout(() => views.current[n]?.focus(), 0); } },
      swapPanes, splitDir: flipDir, closePane,
      moveTab: () => { if (tab) sendTo(tab.node, otherOf(), true); },
      explorer: () => { setSide(true); setPanel("files"); },
      toggleTheme: () => update({ mode: isDark(st) ? "light" : "dark" }),
      zoomIn: () => update({ fontSize: Math.min(28, st.fontSize + 1) }), zoomOut: () => update({ fontSize: Math.max(10, st.fontSize - 1) }), zoomReset: () => update({ fontSize: def("fontSize") }),
      wrap: () => update({ wrap: !st.wrap }), gotoLine: () => { if (ev()) setPop("goto"); },
      pinTab: () => { if (act[fp]) togglePin(act[fp]!); },
      closeTab: () => act[fp] && closeIn(act[fp]!, fp), closeAll: () => closeMany(tabs.map((t) => t.node.path)),
      nextTab: () => step(1), prevTab: () => step(-1),
      shot: () => { const v = ev(), n = act[fp]; if (v && n) takeShot(v, n); },
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

  // 受け取る側を 1 度だけ登録し、未保存の数と設定は ref で最新を見る
  const exitRef = useRef({ dirty: 0, on: true });
  exitRef.current = { dirty: dirtyList.length, on: st.confirmExit };
  // 「保存して閉じる」用。1 つでも保存できなければ(上書きの確認でやめた・書き込み失敗)、閉じない
  const saveDirtyRef = useRef<() => Promise<boolean>>(async () => true);
  saveDirtyRef.current = async () => { for (const t of dirtyList) if (!(await saveTab(t))) return false; return true; };
  // ブラウザのタブ・窓を閉じるときは、未保存があれば確かめる(beforeunload が唯一の手段)。
  // 再読み込みでは確かめない: F5・Ctrl+R と、Vite の自動再読み込みの直前に印を付けて通す。
  // ブラウザの再読み込みボタンは見分けられないので、そのときは確認が出る
  useEffect(() => {
    let skipUntil = 0;
    const skip = () => { skipUntil = Date.now() + 3000; };
    const key = (e: KeyboardEvent) => { if (e.key === "F5" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r")) skip(); };
    const h = (e: BeforeUnloadEvent) => { if (Date.now() < skipUntil) return; if (exitRef.current.on && exitRef.current.dirty) e.preventDefault(); };
    addEventListener("keydown", key, true);
    addEventListener("beforeunload", h);
    import.meta.hot?.on("vite:beforeFullReload", skip);
    return () => { removeEventListener("keydown", key, true); removeEventListener("beforeunload", h); };
  }, []);
  // デスクトップ版: ×ボタン・Alt+F4 で閉じるときも確かめる(beforeunload は、ウィンドウを閉じる操作では働かない)。
  useEffect(() => {
    if (!IS_TAURI) return;
    let off: (() => void) | undefined, dead = false;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().onCloseRequested(async (e) => {
        const { dirty, on } = exitRef.current;
        if (!on || !dirty) return;
        const c = await askChoice({ message: i18next.t("保存していない変更が {{n}} 件あります。閉じると失われます。閉じますか?", { n: dirty }), ok: i18next.t("保存せずに閉じる"), alt: i18next.t("保存して閉じる"), danger: true });
        if (c === "cancel" || (c === "alt" && !(await saveDirtyRef.current()))) e.preventDefault();
      }))
      .then((f) => { if (dead) f(); else off = f; })
      .catch(() => { /* 受け取れなければ、確かめずに閉じる(これまでどおり) */ });
    return () => { dead = true; off?.(); };
  }, []);

  const cmds: Cmd[] = useMemo(() => [
    ...KEYS.map((k) => ({ id: k.id, label: i18next.t(k.label), group: i18next.t(k.group), keys: keyOf(k.id, st.keys), run: () => run(k.id) })),
    { id: "m-light", label: i18next.t("テーマ: ライト"), group: i18next.t("表示"), run: () => update({ mode: "light" }) },
    { id: "m-dark", label: i18next.t("テーマ: ダーク"), group: i18next.t("表示"), run: () => update({ mode: "dark" }) },
    { id: "m-auto", label: i18next.t("テーマ: OS に合わせる"), group: i18next.t("表示"), run: () => update({ mode: "auto" }) },
    { id: "bg", label: i18next.t("背景の色を変える"), group: i18next.t("表示"), run: () => setSetts("look") },
    { id: "refresh", label: i18next.t("ファイル一覧を更新"), group: i18next.t("全般"), run: reload },
    { id: "newDir", label: i18next.t("新規フォルダ"), group: i18next.t("全般"), run: () => create("dir", null) },
    { id: "dela-pub", label: i18next.t("ポート管理パネルの表示"), group: i18next.t("全般"), run: () => setPortsOpen((v) => !v) },
    ...delas.filter((d) => d.url).flatMap((d) => [
      { id: `dela-copy-${d.id}`, label: i18next.t("公開 URL をコピー(ポート {{port}})", { port: d.port }), group: i18next.t("全般"), run: () => copyText(d.url!) },
      { id: `dela-open-${d.id}`, label: i18next.t("公開 URL をブラウザで開く(ポート {{port}})", { port: d.port }), group: i18next.t("全般"), run: () => void openExternal(d.url!) },
    ]),
    ...delas.map((d) => ({ id: `dela-stop-${d.id}`, label: i18next.t("公開を止める(ポート {{port}})", { port: d.port }), group: i18next.t("全般"), run: () => stopDela(d.id) })),
    { id: "copyPath", label: i18next.t("開いているファイルのパスをコピー"), group: i18next.t("全般"), run: () => act[fp] && copyText(act[fp]!.slice(1)) },
  ], [st.keys, tabs, act, fp, split, term, st.fontSize, st.wrap, st.mode, root, delas]); // eslint-disable-line react-hooks/exhaustive-deps
  const wsCmds: Cmd[] = [
    ...cmds,
    ...wsStore.list.map((w) => ({ id: `ws-${w.id}`, label: i18next.t("ワークスペース: {{name}}", { name: w.name }), group: i18next.t("ワークスペース"), icon: <FolderKanban />, run: () => { switchWs(w).catch((e) => flash((e as Error).message, "error")); } })),
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
  // AI に添える中身。画像のファイルは画像として、それ以外は文字として読む
  const aiSource = async (x: Node | string): Promise<Ctx | AiPic | null> => {
    const n = typeof x === "string" ? tabOf(x)?.node : x;
    if (n && n.kind !== "dir" && isImageName(n.name)) { try { return { name: n.name, blob: await getFile(n) }; } catch { return null; } }
    return clipOf(x);
  };
  // AI に読み書きさせる窓口。触れるのは、開いているフォルダ(先頭のルート)の中だけ。
  // 読むときは、エディタで開いている(未保存の)中身を優先する。直すときは、エディタの中の文字を置き換える(保存は利用者が行う)
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const openRef = useRef(open); openRef.current = open;
  const mainDir = roots.find((r) => !r.prefix && r.handle)?.handle ?? null;
  // ファイルを作る・移す・消したあとに、ツリーの読み直しとタブの整理をするための最新の関数(useMemo の中から呼ぶ)
  const aiSync = useRef({ reload, closeMany, dirty: [] as string[] });
  aiSync.current = { reload, closeMany, dirty: dirtyList.map((t) => t.node.path) };
  const aiFiles = useMemo<FileHost | null>(() => {
    if (!mainDir) return null;
    const bad = (path: string) => path.split("/").some((s) => secretName(s));
    const dirAt = async (path: string) => { let d = mainDir; for (const s of path.split("/").filter(Boolean)) d = await d.getDirectoryHandle(s); return d; };
    const fileAt = async (path: string) => {
      const at = path.lastIndexOf("/"), name = path.slice(at + 1), dir = await dirAt(path.slice(0, at));
      return { name, dir, handle: await dir.getFileHandle(name) };
    };
    // そのパスにあるものの種類(なければ null)
    const kind = async (path: string): Promise<"file" | "dir" | null> => {
      try { await fileAt(path); return "file"; } catch { /* ファイルではない */ }
      try { await dirAt(path); return "dir"; } catch { return null; }
    };
    // フォルダを、途中の分も含めて作りながらたどる
    const ensureDir = async (path: string) => { let d = mainDir; for (const s of path.split("/").filter(Boolean)) d = await createDir(d, s); return d; };
    const read: FileHost["read"] = async (path) => {
      if (bad(path)) return { err: "denied" };
      const t = tabsRef.current.find((x) => x.node.path === path);
      if (t) return t.view.kind === "text" ? { text: t.text } : { err: "binary" };
      try {
        const f = await (await fileAt(path)).handle.getFile();
        if (f.size > MAX_OPEN_BYTES) return { err: "big" };
        const raw = await f.text();
        return raw.includes("\u0000") ? { err: "binary" } : { text: norm(raw).text };
      } catch (e) { return { err: (e as DOMException)?.name === "TypeMismatchError" ? "dir" : "none" }; }
    };
    return {
      async list(dir) {
        if (bad(dir)) return null;
        try {
          const out: { name: string; dir: boolean }[] = [];
          for await (const [name, h] of (await dirAt(dir) as any).entries() as AsyncIterable<[string, FileSystemHandle]>) {
            const isDir = h.kind === "directory";
            if (secretName(name) || (isDir ? SKIP_DIRS.has(name) : isJunk(name))) continue;
            out.push({ name, dir: isDir });
          }
          return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
        } catch { return null; }
      },
      read,
      async apply(path, old, neu) {
        if (bad(path)) return "fail";
        const replace = () => setTabs((p) => p.map((t) => { if (t.node.path !== path || t.view.kind !== "text") return t; const n = applyAnchor(t.text, old, neu); return n === null ? t : { ...t, text: n }; }));
        const t = tabsRef.current.find((x) => x.node.path === path);
        if (t) { if (t.view.kind !== "text") return "fail"; if (applyAnchor(t.text, old, neu) === null) return "stale"; replace(); return "ok"; }
        // まだ開いていないファイルは、開いてから置き換える(開けば、利用者にも変更が見える)
        const r = await read(path);
        if ("err" in r) return "fail";
        if (applyAnchor(r.text, old, neu) === null) return "stale";
        try {
          const f = await fileAt(path);
          await openRef.current({ name: f.name, path, kind: "file", handle: f.handle, parent: f.dir });
        } catch { return "fail"; }
        replace();
        return "ok";
      },
      async create(path, content) {
        if (bad(path)) return "That path is not allowed.";
        if (await kind(path)) return "Already exists. Use edit_file to change an existing file.";
        try {
          const at = path.lastIndexOf("/");
          const dir = await ensureDir(path.slice(0, at));
          await writeFile(await createFile(dir, path.slice(at + 1)), content);
        } catch (e) { return (e as Error).message || "Could not create the file."; }
        await aiSync.current.reload().catch(() => {});
        return "ok";
      },
      async mkdir(path) {
        if (bad(path)) return "That path is not allowed.";
        const k = await kind(path);
        if (k === "file") return "A file with that name already exists.";
        if (k === "dir") return "ok";
        try { await ensureDir(path); } catch (e) { return (e as Error).message || "Could not create the folder."; }
        await aiSync.current.reload().catch(() => {});
        return "ok";
      },
      async move(from, to) {
        if (bad(from) || bad(to)) return "That path is not allowed.";
        const k = await kind(from);
        if (!k) return "The source does not exist.";
        if (await kind(to)) return "The destination already exists.";
        const under = (x: string) => x === from || x.startsWith(from + "/");
        if (aiSync.current.dirty.some(under)) return "The source has unsaved changes in the editor. Ask the user to save first.";
        try {
          const a = from.lastIndexOf("/"), b = to.lastIndexOf("/");
          const src = await dirAt(from.slice(0, a)), name = from.slice(a + 1), toName = to.slice(b + 1);
          const h = k === "file" ? await src.getFileHandle(name) : await src.getDirectoryHandle(name);
          const dest = await ensureDir(to.slice(0, b));
          // 同じフォルダの中での名前の変更か、別のフォルダへの移動か
          if (dest === src || (await dest.isSameEntry(src))) await renameFile(src, h, toName);
          else if (toName === name) await moveEntry(src, h, dest);
          else { await renameFile(src, h, toName); await moveEntry(src, await (k === "file" ? src.getFileHandle(toName) : src.getDirectoryHandle(toName)), dest); }
        } catch (e) { return (e as Error).message || "Could not move it."; }
        aiSync.current.closeMany(tabsRef.current.map((t) => t.node.path).filter(under), true);
        await aiSync.current.reload().catch(() => {});
        return "ok";
      },
      async remove(path) {
        if (bad(path)) return "That path is not allowed.";
        if (!(await kind(path))) return "It does not exist.";
        const under = (x: string) => x === path || x.startsWith(path + "/");
        if (aiSync.current.dirty.some(under)) return "It has unsaved changes in the editor. Ask the user to save first.";
        try {
          const at = path.lastIndexOf("/");
          await removeEntry(await dirAt(path.slice(0, at)), path.slice(at + 1));
        } catch (e) { return (e as Error).message || "Could not delete it."; }
        aiSync.current.closeMany(tabsRef.current.map((t) => t.node.path).filter(under), true);
        await aiSync.current.reload().catch(() => {});
        return "ok";
      },
      async walk(dir, each) {
        let n = 0;
        const go = async (path: string, d: FileSystemDirectoryHandle): Promise<boolean> => {
          const items: [string, FileSystemHandle][] = [];
          for await (const e of (d as any).entries() as AsyncIterable<[string, FileSystemHandle]>) items.push(e);
          items.sort((x, y) => x[0].localeCompare(y[0]));
          for (const [name, h] of items) {
            const p = `${path === "/" ? "" : path}/${name}`;
            if (secretName(name)) continue;
            if (h.kind === "directory") { if (!SKIP_DIRS.has(name) && !(await go(p, h as FileSystemDirectoryHandle))) return false; continue; }
            if (isJunk(name) || n >= AI_TOOL_SEARCH_FILES) { if (n >= AI_TOOL_SEARCH_FILES) return false; continue; }
            n++;
            const r = await read(p);
            if ("text" in r && !each(p, r.text)) return false;
          }
          return true;
        };
        try { await go(dir, await dirAt(dir)); } catch { /* 読めないフォルダは飛ばす */ }
      },
      // コマンドは exe(Tauri)で、PC・WSL・SSH のフォルダを開いているときだけ動かす(ブラウザ版の開発サーバーには動かす道を作っていない)
      ...(isRemote(mainDir) ? { root: mainDir.path } : {}),
      ...(IS_TAURI && isRemote(mainDir) ? {
        async exec(cmd: string, secs: number) {
          try { return await execCmd(mainDir.conn, mainDir.path, cmd, secs); } catch (e) { return (e as Error).message || "Could not run the command."; }
        },
      } : {}),
    };
  }, [mainDir]);
  const fileToAi = async (n: Node) => {
    const c = await aiSource(n);
    if (!c) { notify(i18next.t("このファイルは文字として読めないため、添えられません"), "error"); return; }
    setAi(true);
    setAiQuote({ id: ++aiSeq.current, ...c });
  };
  // コード(選択範囲、なければ全体)を画像にして、クリップボードに入れ、右下に見せる
  const takeShot = (v: EditorView, path: string) => {
    const file = path.split("/").pop() || "code";
    const make = () => codeToPng(v, file);
    flash(i18next.t("画像を作っています…"));
    make().then(async (b) => showShot(b, file, await copyShot(b), make)).catch(() => flash(i18next.t("画像を作れませんでした"), "error"));
  };
  const editorMenu = (e: MouseEvent, v: EditorView) => {
    const sel = !v.state.selection.main.empty, word = sel ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : "";
    const r = (id: string) => () => { v.focus(); EDIT[id](v); };
    setFp((p) => Number(Object.keys(views.current).find((k) => views.current[Number(k)] === v) ?? p));
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
          { label: i18next.t("上に空行を挿入"), keys: K("blankAbove"), run: r("blankAbove") },
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
        { label: sel ? i18next.t("選択範囲を画像にする") : i18next.t("コードを画像にする"), icon: ic(Camera), keys: K("shot"), run: () => { const n = act[fp]; if (n) takeShot(v, n); } },
        { label: i18next.t("AI チャットに引用"), icon: ic(Quote), keys: K("aiQuote"), run: () => quoteToAi(v) },
        { label: "AI", icon: ic(Sparkles), sub: [
          { type: "title", label: sel ? i18next.t("選択範囲を送信") : i18next.t("ファイル全体を送信") },
          { label: i18next.t("要約"), run: () => askAi(v, "summarize") },
          { label: i18next.t("コードの説明"), run: () => askAi(v, "explain") },
          { label: i18next.t("問題点を探す"), run: () => askAi(v, "review") },
          { label: i18next.t("コメントを書き足す"), run: () => askAi(v, "comment") },
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
        { label: i18next.t("もう一方の画面へ送る"), icon: ic(ArrowLeftRight), keys: K("moveTab"), run: () => tab && sendTo(tab.node, otherOf(), true), disabled: !tab },
        { label: i18next.t("もう一方の画面にも開く"), icon: ic(Columns2), run: () => tab && openSplit(tab.node), disabled: !tab },
        ] : [tab ? splitSub(tab.node) : { label: i18next.t("分割して開く"), icon: ic(Columns2), disabled: true }]),
        ...(split ? [{ label: leaves(lay).length > 2 ? i18next.t("この画面を次の画面と入れ替える") : i18next.t("2つの画面を入れ替える"), icon: ic(ArrowLeftRight), keys: K("swapPanes"), run: swapPanes }] : []),
        { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => tab && copyText(displayPath(tab.node.path)), disabled: !tab },
      ],
    });
  };
  // フォルダを開く・ワークスペースに足すメニュー。左下のボタンと、フォルダ見出しの右クリックで使う
  const addItems = (): Item[] => [
    { label: i18next.t("この PC のフォルダ"), icon: ic(FolderOpen), keys: K("addFolder"), run: addFolder, disabled: !supportsFs() },
    { label: i18next.t("WSL・SSH のフォルダ"), icon: ic(Server), keys: K("addRemote"), run: () => { setCnAdd(true); setCn(true); } },
  ];
  const folderItems = (): Item[] => [
    { type: "title", label: i18next.t("フォルダを開く") },
    { label: i18next.t("この PC のフォルダ"), icon: ic(FolderOpen), keys: K("openFolder"), run: openFolder, disabled: !supportsFs() },
    { label: i18next.t("WSL・SSH のフォルダ"), icon: ic(Server), keys: K("connect"), run: () => { setCnAdd(false); setCn(true); } },
    ...(root.handle ? [{ type: "sep" as const }, { type: "title" as const, label: i18next.t("ワークスペースに追加") }, ...addItems(),
      { type: "sep" as const }, { label: roots.length > 1 ? i18next.t("すべてのフォルダを閉じる") : i18next.t("フォルダを閉じる"), icon: ic(FolderX), keys: K("closeFolder"), run: closeFolder }] : []),
  ];
  const osOpen = async (c: Conn, path: string, dir: boolean, what: "reveal" | "term", shell?: ShellOpt) => {
    try { const { invoke } = await import("@tauri-apps/api/core"); await invoke("os_open", { kind: c.kind, host: c.host ?? null, path, dir, what, shell: shell?.id ?? null }); }
    catch (err) { notify(String(err), "error"); }
  };
  const treeMenu = async (e: React.MouseEvent, n: Node | null) => {
    e.preventDefault();
    if (n && isMulti() && isSelectedPath(n.path)) {
      const list = selectedNodes();
      return setMenu({ x: e.clientX, y: e.clientY, path: n.path, items: [{ label: i18next.t("切り取り"), icon: ic(Scissors), keys: "Mod+X", run: () => void copyTree("cut", list) }, { label: i18next.t("コピー"), icon: ic(Copy), keys: "Mod+C", run: () => void copyTree("copy", list) }, { type: "sep" as const }, { label: i18next.t("{{n}} 件を削除", { n: list.length }), icon: ic(Trash2), danger: true, run: () => removeMany(list) }] });
    }
    const { clientX: x, clientY: y } = e;
    const shells = await listShells();
    const dir = n?.kind === "dir";
    const head = !!n && isRootNode(n); // 複数のフォルダを開いているときの、フォルダの見出し
    const rr = n ? rootOf(n) : root;
    // ターミナルで開くときに選べるシェル。SSH は選ばない。WSL のフォルダは、既定の WSL と Windows のシェル
    // (コマンド プロンプトは \\wsl.localhost\... で始められないので除く)。この PC のフォルダは全部
    const isWsl = (s: ShellOpt) => s.id === "wsl" || s.id.startsWith("wsl:");
    const shellsFor = (c: Conn): ShellOpt[] => !IS_TAURI ? shells : c.kind === "ssh" ? []
      : c.kind === "wsl" ? [...shells.filter((s) => s.def), ...shells.filter((s) => !isWsl(s) && s.id !== "cmd")] : shells;
    // シェルが2つ以上あれば、種類を選ぶ小さなメニューにする
    const pickShell = (label: string, icon: React.ReactNode, c: Conn, go: (s?: ShellOpt) => void): Item => {
      const list = shellsFor(c);
      return list.length < 2 ? { label, icon, run: () => go(list[0]) }
        : { label, icon, sub: [{ type: "title", label: i18next.t("ターミナルの種類") }, ...list.map((s) => ({ label: s.label, icon: ic(TermIcon), run: () => go(s) }))] };
    };
    const termItem = (c: Conn, p: string, isDir: boolean) => {
      const d = isDir ? p : p.replace(/\/[^/]*$/, "") || "/";
      return pickShell(i18next.t("ここでターミナルを開く"), ic(SquareTerminal), c, (s) => addTerm(d, s, c.kind === "ssh" ? c.host : null));
    };
    // exe だけ: Windows のエクスプローラーで表示する・別のウィンドウのターミナルで開く
    const osItems = (c: Conn | undefined, p: string, isDir: boolean): Item[] => !IS_TAURI || !c ? [] : [
      pickShell(i18next.t("外部のターミナルで開く"), ic(AppWindow), c, (s) => void osOpen(c, p, isDir, "term", s)),
      ...(c.kind !== "ssh" ? [{ label: i18next.t("エクスプローラーで表示"), icon: ic(FolderSearch), run: () => void osOpen(c, p, isDir, "reveal") }] : []),
    ];
    setMenu({
      x, y, path: n?.path,
      items: [
        ...(n ? [{ type: "title" as const, label: head ? rr.name : displayPath(n.path) }] : []),
        ...(n && !dir ? [
          { label: i18next.t("開く"), icon: ic(Files), run: () => openOrFocus(n) },
          split ? { label: i18next.t("もう一方の画面で開く"), icon: ic(Columns2), keys: "", run: () => openSplit(n) } : splitSub(n),
          { label: i18next.t("AI チャットに添える"), icon: ic(Sparkles), run: () => void fileToAi(n) },
          ...fileExtras(n),
          { type: "sep" as const },
        ] : []),
        { label: i18next.t("新規ファイル"), icon: ic(FilePlus), keys: K("newFile"), run: () => create("file", dir ? n : null) },
        { label: i18next.t("新規フォルダ"), icon: ic(FolderPlus), run: () => create("dir", dir ? n : null) },
        ...(n && dir && !head ? [
          { type: "sep" as const },
          { label: i18next.t("中の階層をすべて開く"), icon: ic(ChevronsUpDown), run: () => setAllOpen(n.path, true) },
          { label: i18next.t("中の階層をすべて閉じる"), icon: ic(ChevronsDownUp), run: () => setAllOpen(n.path, false) },
          { label: i18next.t("このフォルダ以下を更新"), icon: ic(RotateCw), run: () => void reloadUnder(n) },
        ] : []),
        ...(n && head ? [
          { type: "sep" as const },
          ...(rr.conn ? [
            { label: i18next.t("絶対パスをコピー"), icon: ic(Link), run: () => copyText(rr.conn!.path) },
            termItem(rr.conn, rr.conn.path, true),
            ...osItems(rr.conn, rr.conn.path, true),
            { label: i18next.t("Git パネルで開く"), icon: ic(FolderGit2), run: () => void gitHere(rr.conn!, rr.conn!.path) },
          ] : []),
          { label: i18next.t("ファイル一覧を更新"), icon: ic(RotateCw), run: reload },
          { type: "sep" as const },
          { label: i18next.t("ワークスペースに追加"), icon: ic(FolderPlus), sub: addItems() },
          // 見出しの「フォルダを閉じる」は、そのフォルダだけを閉じる(ワークスペースから外す)。全部を閉じるのは別の項目
          { label: i18next.t("フォルダを閉じる"), icon: ic(FolderMinus), run: () => (roots.length < 2 ? closeFolder() : removeRoot(rr.prefix)) },
          ...(roots.length > 1 ? [{ label: i18next.t("すべてのフォルダを閉じる"), icon: ic(FolderX), keys: K("closeFolder"), run: closeFolder }] : []),
        ] : n ? [
          { type: "sep" as const },
          ...(head ? [] : [
            { label: i18next.t("切り取り"), icon: ic(Scissors), keys: "Mod+X", run: () => void copyTree("cut", [n]) },
            { label: i18next.t("コピー"), icon: ic(Copy), keys: "Mod+C", run: () => void copyTree("copy", [n]) },
          ]),
          { label: i18next.t("貼り付け"), icon: ic(ClipboardPaste), keys: "Mod+V", run: () => pasteMenu(n), disabled: !hasTreeClip() && !IS_TAURI },
          { type: "sep" as const },
          { label: i18next.t("名前の変更"), icon: ic(Pencil), run: () => rename(n) },
          { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => copyText(displayPath(n.path)) },
          ...(rr.conn ? [
            { label: i18next.t("絶対パスをコピー"), icon: ic(Link), run: () => copyText(abs(n)) },
            ...(rr.conn.kind === "ssh" ? [{ label: "ssh:// のパスをコピー", icon: ic(Link), run: () => copyText(sshUrl(rr.conn!, abs(n))) }] : []),
            termItem(rr.conn, abs(n), dir),
            ...osItems(rr.conn, abs(n), dir),
            ...(dir ? [{ label: i18next.t("Git パネルで開く"), icon: ic(FolderGit2), run: () => void gitHere(rr.conn!, abs(n)) }] : []),
          ] : []),
          { label: i18next.t("名前をコピー"), icon: ic(Copy), run: () => copyText(n.name) },
          { type: "sep" as const },
          { label: i18next.t("削除"), icon: ic(Trash2), danger: true, run: () => remove(n) },
        ] : [
          { type: "sep" as const },
          { label: i18next.t("貼り付け"), icon: ic(ClipboardPaste), keys: "Mod+V", run: () => pasteMenu(null), disabled: !hasTreeClip() && !IS_TAURI },
          { label: i18next.t("ファイル一覧を更新"), icon: ic(RotateCw), run: reload },
          ...(root.conn ? [termItem(root.conn, root.conn.path, true), ...osItems(root.conn, root.conn.path, true)] : []),
          { label: i18next.t("WSL・SSH に接続"), icon: ic(Server), keys: K("connect"), run: () => { setCnAdd(false); setCn(true); } },
          { label: i18next.t("フォルダを開く"), icon: ic(FolderOpen), keys: K("openFolder"), run: openFolder, disabled: !supportsFs() },
          { label: i18next.t("フォルダをワークスペースに追加"), icon: ic(FolderPlus), keys: K("addFolder"), run: addFolder, disabled: !supportsFs() || !root.handle },
          { label: i18next.t("WSL・SSH のフォルダを追加"), icon: ic(Server), keys: K("addRemote"), run: () => { setCnAdd(true); setCn(true); }, disabled: !root.handle },
        ]),
      ],
    });
  };
  const tabMenu = (e: React.MouseEvent, t: Tab) => {
    e.preventDefault();
    const i = tabs.indexOf(t), ids = leaves(lay), row = !isLeaf(lay) && lay.dir === "row";
    const A = row ? i18next.t("上") : i18next.t("左"), B = row ? i18next.t("下") : i18next.t("右"), p = t.node.path;
    const savedOnes = tabs.filter((x) => !(isText(x) && x.text !== x.saved));
    const inPane = (n: number) => split && act[n] === p;
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
        ...fileExtras(t.node),
        ...(!split ? [splitSub(t.node)] : [
        ...ids.map((id, k) => ({
          label: ids.length === 2 ? i18next.t("{{A}}の画面で開く", { A: k ? B : A }) : i18next.t("{{n}} 番目の画面で開く", { n: k + 1 }),
          icon: ic(Columns2), run: () => sendTo(t.node, id), disabled: inPane(id),
        })),
        { label: i18next.t("もう一方の画面へ送る"), icon: ic(ArrowLeftRight), keys: K("moveTab"), run: () => { const from = ids.find((k) => act[k] === p) ?? fp; sendTo(t.node, otherOf(from), true, from); } },
        splitSub(t.node, false, ids.find((k) => act[k] === p) ?? fp),
        ]),
        ...(split ? [
          { label: ids.length > 2 ? i18next.t("この画面を次の画面と入れ替える") : i18next.t("2つの画面を入れ替える"), icon: ic(ArrowLeftRight), keys: K("swapPanes"), run: swapPanes },
          { label: ids.length > 2 ? i18next.t("この分割の向きを入れ替える") : row ? i18next.t("左右に並べ替える") : i18next.t("上下に並べ替える"), icon: ic(row ? Columns2 : Rows2), run: flipDir },
          { label: i18next.t("分割を解除"), keys: K("toggleSplit"), run: closePane },
        ] : []),
        { type: "sep" },
        { label: i18next.t("パスをコピー"), icon: ic(Link), run: () => copyText(p.slice(1)) },
        { label: i18next.t("絶対パスをコピー"), icon: ic(Link), run: () => copyText(abs(t.node)), disabled: !abs(t.node) },
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
        ...(root.conn ? [{ label: i18next.t("GitHub の管理(Issue・PR・Actions など)"), run: () => setGhOpen(true) }] : []),
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

  // 画面(葉)の外側の矩形を、.panes に対する割合で置く。ふちの内側は、隣との隙間の半分だけ内側に寄せる
  const gapH = "calc(var(--pane-gap, 8px) / 2)", EPS = 1e-6;
  const slot = (b: Box, strip = false): React.CSSProperties => ({
    left: `${b.x * 100}%`, width: `${b.w * 100}%`, top: strip ? 0 : `${b.y * 100}%`, height: strip ? "100%" : `${b.h * 100}%`,
    paddingLeft: b.x > EPS ? gapH : 0, paddingRight: b.x + b.w < 1 - EPS ? gapH : 0,
    paddingTop: !strip && b.y > EPS ? gapH : 0, paddingBottom: !strip && b.y + b.h < 1 - EPS ? gapH : 0,
  });
  // 境目のつまみ。つまみの太さの半分だけ、境目から戻して置く
  const gripPos = (j: Joint): React.CSSProperties => {
    const f = j.r / 100;
    return j.dir === "col"
      ? { left: `${(j.box.x + j.box.w * f) * 100}%`, top: `${j.box.y * 100}%`, height: `${j.box.h * 100}%` }
      : { top: `${(j.box.y + j.box.h * f) * 100}%`, left: `${j.box.x * 100}%`, width: `${j.box.w * 100}%` };
  };
  // ドラッグ中に光らせる範囲(.panes に対する割合)
  const dropRect = (z: Dz): React.CSSProperties => {
    const b = boxes(lay).get(z.pane) ?? { x: 0, y: 0, w: 1, h: 1 };
    let { x, y, w, h } = b;
    if (z.edge === "L") w /= 2; else if (z.edge === "R") { x += w / 2; w /= 2; } else if (z.edge === "T") h /= 2; else if (z.edge === "B") { y += h / 2; h /= 2; }
    return { left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` };
  };
  const lastBar = topRight(lay); // 右上のボタンを置く画面
  const firstBar = topLeaves(lay)[0]; // 左上(窓のボタン・サイドバーを開くボタン)を置く画面
  const dropTab = async (i: number, target: string | null, after: boolean) => {
    const p = drag.tab, from = drag.from;
    dragEnd(); setTabDrop(null); setDz(null);
    if (!p) return;
    const t = tabOf(p);
    if (t && split && from !== i) await sendTo(t.node, i, true, from);
    if (target && target !== p) reorder(p, target, after);
  };
  // 画面ごとのタブ列(VSCode と同じ。分割中は、それぞれの画面の上に置く)
  const strip = (i: number) => {
    const list = paneTabs(i);
    return (
      <div className="tabbar" role="tablist" data-pane={i} data-focus={!split || fp === i} data-tauri-drag-region onDragEnter={() => setDz(null)}>
        {i === firstBar && CHROME && !side && <WinControls />}
        {i === firstBar && !side && <button className="icon-btn" aria-label={i18next.t("サイドバーを開く")} onClick={() => setSide(true)}><PanelLeft /></button>}
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
              onClick={(e) => { if (e.altKey && split) sendTo(t.node, otherOf(i), false, i); else open(t.node, i, false); }} onAuxClick={(e) => { if (e.button === 1) closeIn(path, i); }} onContextMenu={(e) => tabMenu(e, t)}>
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
            {upd && <button className="up-pill" title={i18next.t("v{{v}} に更新できます", { v: upd.version })} onClick={() => setUpdOpen(true)}><ArrowUpCircle size={14} /><span>{i18next.t("更新あり")}</span></button>}
            {root.conn && <button className="icon-btn" data-on={gitOpen} aria-label={i18next.t("Git パネルの表示")} title={i18next.t("Git パネルの表示")} onClick={() => setGitOpen((v) => !v)}><GitBranch /></button>}
            <button className="icon-btn" data-on={portsOpen} aria-label={i18next.t("ポート管理パネルの表示")} title={i18next.t("ポート管理パネルの表示")} onClick={() => setPortsOpen((v) => !v)}><Globe /></button>
            {root.conn && <button className="icon-btn" aria-label={i18next.t("GitHub の管理")} title={i18next.t("GitHub の管理")} onClick={() => setGhOpen(true)}><GitPullRequest /></button>}
            <button className="icon-btn" data-on={ai} aria-label={i18next.t("AI パネルの表示")} title={`${i18next.t("AI パネルの表示")} (${chips(K("toggleAi")).join(" ")})`} onClick={() => setAi((v) => !v)}><Sparkles /></button>
            {runCmd && <button className="icon-btn run-btn" aria-label={i18next.t("このファイルを実行")} title={`${i18next.t("このファイルを実行")} (${chips(K("runFile")).join(" ")})`} onClick={runFile}><Play /></button>}
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
  const pane = (i: number) => {
    const t = tabOf(act[i]);
    // 固定したプレビュー: そのファイルがこの画面にあれば、ほかのファイルを開いている間も横に出す(固定していないときは、開いたファイル自身のプレビューを出す)
    const pin = t && t.view.kind === "text" && pvPin && pvPin !== t.node.path && mem(i, pvPin) ? tabOf(pvPin) : null;
    const pvt = pin ?? (t && previewKind(t.node.name) ? t : null); // 横に出すプレビューのファイル
    return (
      <div className={onTop(lay, i) ? "paper" : "paper has-strip"} data-focus={fp === i} onMouseDown={() => setFp(i)} onContextMenu={(e) => { if (!t) stageMenu(e); }}>
        {!onTop(lay, i) && strip(i)}
        {!t ? (
          <div className="empty">
            {split && <button className="icon-btn empty-x" aria-label={i18next.t("この画面を閉じる")} title={i18next.t("この画面を閉じる")} onClick={(e) => { e.stopPropagation(); const rest = leaves(lay).filter((k) => k !== i); settle(removeLeaf(lay, i) ?? { id: rest[0] ?? first }, rest[0]); }}><XIcon /></button>}
            <p className="empty-title">{APP_NAME}</p>
            <p className="empty-sub">{roots.every((r) => r.ref.kind === "demo") ? i18next.t("左下の「フォルダを開く」から始めます。") : <Trans i18nKey="左のファイルを選ぶと、ここで開きます。" />}</p>
            <FolderCards list={wsStore.list.filter((w) => !w.temp)} current={ws?.id ?? null} canNew={supportsFs()} onNew={openFolder} onOpen={(w) => void switchWs(w).catch((e) => flash((e as Error).message, "error"))} />
            {st.emptyHint && (
              <ul className="empty-acts">
                {([["quickOpen", i18next.t("ファイルを開く"), () => setQo(true)], ["palette", i18next.t("コマンドを探す"), () => setPal(true)], ["searchAll", i18next.t("全文検索"), () => run("searchAll")], ["toggleTerm", i18next.t("ターミナル"), () => showTerm()]] as const).map(([id, label, go]) => (
                  <li key={id}><button onClick={go}><span>{label}</span><span className="keys">{chips(K(id)).map((c, k) => <kbd key={k}>{c}</kbd>)}</span></button></li>
                ))}
              </ul>
            )}
          </div>
        ) : t.view.kind === "text" ? (
          <div className="ed-pv" data-pv={pin ? "split" : previewKind(t.node.name) ? pv(t.node.path) ?? "text" : "text"} style={{ "--pv-r": pvR, "--pv-a": `${pvR}fr`, "--pv-b": `${1 - pvR}fr` } as React.CSSProperties}>
          <Editor
          crumbExtra={pin ? (
              <span className="pv-tools" data-open>
                <button className="icon-btn bc-btn" data-on aria-pressed aria-label={i18next.t("プレビューの固定を外す")} data-tip={i18next.t("プレビューの固定を外す")} data-tip-sub={i18next.t("固定中: {{name}}", { name: pin.node.name })} onClick={() => setPvPin(null)}><Pin /></button>
              </span>
            ) : previewKind(t.node.name) ? pvTools(t.node.path) : undefined}
            key={`${i}:${t.node.path}`} docKey={`${i}:${t.node.path}`} path={displayPath(t.node.path)} name={t.node.name} value={t.text} jump={jump[i]}
            onChange={(v) => { setTabs((p) => p.map((x) => (x.node.path === t.node.path && x.text !== v ? { ...x, text: v } : x))); setPreview((q) => (q === t.node.path ? null : q)); }}
            onCursor={(c) => setCur((p) => ({ ...p, [i]: c }))}
            onFocus={() => setFp(i)} onReady={(v) => { views.current[i] = v; }} onContext={editorMenu} gitBase={bases[t.node.path]}
          />
          {previewKind(t.node.name) && pv(t.node.path) === "preview" && <div className="pv-float">{pvTools(t.node.path)}</div>}
          {(pin || (previewKind(t.node.name) && pv(t.node.path) === "split")) && <RatioGrip ratio={pvR} onChange={setPvR} />}
          {pvt && (
            <div className="pv-pane" inert={!pin && !pv(t.node.path)}>
              {(pin || pv(pvt.node.path) || pvSeen.current.has(pvt.node.path)) && (pvSeen.current.add(pvt.node.path), <Preview key={pvt.node.path} kind={previewKind(pvt.node.name)!} text={pvt.text} name={pvt.node.name} source={previewSource(pvt)} />)}
            </div>
          )}
          </div>
        ) : (
          <Viewer view={t.view} name={t.node.name} path={t.node.path} onSaveImage={t.node.handle ? (b, n) => saveImage(t, b, n) : undefined} onForce={() => void forceLoad(t.node)} />
        )}
      </div>
    );
  };

  const goHit = (n: Node, h: { line: number; from: number; to: number }) => goto(n, h.line, h.from, h.to);

  // ツリーに渡す関数は毎回同じものにする(FileTree は memo なので、打鍵のたびに描き直さない)
  const treeRef = useRef({ openOrFocus, treeMenu, moveTo, dropInto, pasteInto, removeMany, copyTree });
  treeRef.current = { openOrFocus, treeMenu, moveTo, dropInto, pasteInto, removeMany, copyTree };
  const treeFn = useMemo(() => ({
    open: (n: Node, pin?: boolean) => treeRef.current.openOrFocus(n, !!pin),
    ctx: (e: React.MouseEvent, n: Node | null) => void treeRef.current.treeMenu(e, n),
    move: async (n: Node, dest: Node | null) => {
      const list = selectedNodes();
      if (isMulti() && list.some((x) => x.path === n.path)) { for (const x of list) if (x.path !== dest?.path) await treeRef.current.moveTo(x, dest); clearSel(); } else await treeRef.current.moveTo(n, dest);
    },
    drop: (e: React.DragEvent, n: Node | null) => void treeRef.current.dropInto(e, n),
    paste: (e: React.ClipboardEvent, n: Node | null) => void treeRef.current.pasteInto(e, n),
  }), []);

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
              {roots.length > 1 && ws && (
                <div className="ws-bar">
                  {wsRen !== null ? (
                    <input className="field ws-ren inline-edit" autoFocus onFocus={(e) => e.currentTarget.select()} value={wsRen} spellCheck={false} aria-label={i18next.t("ワークスペースの名前")}
                      onChange={(e) => setWsRen(e.target.value)} onBlur={commitWsRen}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitWsRen(); else if (e.key === "Escape") setWsRen(null); }} />
                  ) : (
                    <span className="ws-bar-name truncate" title={`${roots.map(rootPath).join("\n")}\n\n${i18next.t("ダブルクリックで名前を変更")}`} onDoubleClick={() => setWsRen(ws.name)}>{ws.name}</span>
                  )}
                </div>
              )}
              <nav className="tree scroll overscroll-contain" data-foot={footOpen} onKeyDown={(e) => { const t = e.target as HTMLElement; if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return; if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "c" || e.key === "x")) { const l = selectedNodes(); if (l.length) { e.preventDefault(); void treeRef.current.copyTree(e.key === "x" ? "cut" : "copy", l); } return; } if (e.key !== "Delete") return; const l = selectedNodes(); if (l.length) { e.preventDefault(); treeRef.current.removeMany(l); } }} onPaste={(e) => { if (roots[0].handle) treeFn.paste(e, null); }} style={{ ["--fh" as string]: `${footOpen ? footH : 0}px` }} data-drop={rootDrop || (roots.length === 1 && dropAt === rootKey(roots[0].prefix))}
                onDragOver={(e) => {
                  if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropTarget(null); setRootDrop(true); setExtDrop(true); return; }
                  // ここまで来るのは、一番上の階層のファイルか、何もない所の上。フォルダが1つなら、その一番上へ移す
                  if (!drag.node) return;
                  if (roots.length > 1 || dirOf(drag.node.path) === roots[0].prefix) { setDropTarget(null); return; }
                  e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(rootKey(roots[0].prefix));
                }}
                onDragOverCapture={(e) => { if (hasFiles(e)) { setRootDrop(false); setExtDrop(false); } }} // フォルダの上なら、そのフォルダが受け止める(開く案内は出さない)。何もない所なら下で出し直す
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) { setRootDrop(false); setExtDrop(false); setDropTarget(null); } }}
                onDrop={(e) => {
                  if (hasFiles(e)) { void dropExternal(e); return; }
                  setRootDrop(false);
                  if (!drag.node) return;
                  const m = drag.node; dragEnd();
                  if (roots.length > 1 || dirOf(m.path) === roots[0].prefix) return;
                  e.preventDefault(); moveTo(m, null);
                }}
                onContextMenu={(e) => { if (e.target === e.currentTarget || !(e.target as HTMLElement).closest(".tree-row")) treeMenu(e, null); }}
                onClick={(e) => { if (!(e.target as HTMLElement).closest(".tree-row, .create-row, .pending-row")) clearSel(); }}>
                {treeBusy > 0 ? (
                  <div className="tree-skel" role="status" aria-label={i18next.t("読み込み中…")}>
                    {TREE_SKEL.map(([d, w, dir], i) => <div key={i} className="tree-skel-row" style={{ paddingLeft: 10 + d * st.treeIndent, ["--i" as string]: i, ["--w" as string]: `${w}%` }}><i data-dir={dir || undefined} /><i /><b /></div>)}
                  </div>
                ) : sectioned ? roots.map((r) => {
                  const h = headNode(r), shut = folded.has(r.prefix);
                  return (
                    <section key={r.prefix || "main"} className="root-sec" data-new={freshRoot === r.prefix} data-drop={dropAt === rootKey(r.prefix) || undefined} aria-label={r.name}
                      onDragOver={(e) => {
                        if (r.handle && hasFiles(e)) { e.stopPropagation(); e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropTarget(rootKey(r.prefix)); return; }
                        if (!drag.node) return; e.stopPropagation(); if (!canDrop(h)) { setDropTarget(null); return; } e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(rootKey(r.prefix));
                      }}
                      onDrop={(e) => { if (r.handle && hasFiles(e)) { void dropInto(e, null, r); return; } if (!drag.node) return; e.stopPropagation(); const m = drag.node, ok = canDrop(h); dragEnd(); if (!ok) return; e.preventDefault(); moveTo(m, roots.length > 1 ? h : null); }}>
                      <button className="tree-row root-head" title={rootPath(r)} data-ctx={menu?.path === r.prefix} aria-expanded={!shut}
                        onClick={() => setFolded((p) => { const q = new Set(p); if (q.has(r.prefix)) q.delete(r.prefix); else q.add(r.prefix); return q; })}
                        onContextMenu={(e) => { e.stopPropagation(); treeMenu(e, h); }}
>
                        <ChevronRight className="chev" data-open={!shut} />
                        <Folder className="ico folder" />
                        <span className="truncate">{r.name}</span>
                      </button>
                      <div className="collapse" data-open={!shut} inert={shut}>
                        <div className="collapse-inner">
                          <FileTree nodes={r.nodes} activePath={act[fp]} ctxPath={menu?.path ?? null} rev={rev} onOpen={treeFn.open} onContext={treeFn.ctx} onMove={treeFn.move} onDropFiles={r.handle ? treeFn.drop : undefined} onPasteFiles={r.handle ? treeFn.paste : undefined} dirPath={r.prefix} />
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
                  <FileTree nodes={root.nodes} activePath={act[fp]} ctxPath={menu?.path ?? null} rev={rev} onOpen={treeFn.open} onContext={treeFn.ctx} onMove={treeFn.move} onPasteFiles={root.handle ? treeFn.paste : undefined} dirPath={root.prefix} />
                )}
              </nav>
              <div className="side-foot" ref={footRef}>
                {/* 開く・追加は 1 つのボタンにまとめ、押すとボタンの上に項目が広がる。フォルダを開くまでは「開く」だけ */}
                <div className="collapse" data-open={footOpen} inert={!footOpen}>
                  <div className="collapse-inner">
                    <div className="foot-menu" role="menu">
                      {untitled && (
                        <form className="foot-save" onSubmit={(e) => { e.preventDefault(); void createWsHere(); }}>
                          <div className="foot-title">{i18next.t("ワークスペースとして保存")}</div>
                          <div className="foot-save-row">
                            <input className="field" value={wsName} spellCheck={false} aria-label={i18next.t("ワークスペースの名前")} placeholder={roots.map((r) => r.name).join(" + ")}
                              onChange={(e) => setWsName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                            <button type="submit" className="chipbtn">{i18next.t("作成")}</button>
                          </div>
                        </form>
                      )}
                      {folderItems().map((it, i) => it.type === "title" ? <div key={i} className="foot-title">{it.label}</div> : it.type === "sep" ? null : (
                        <button key={i} role="menuitem" className="open-btn foot-item" disabled={it.disabled} onClick={() => { setFootOpen(false); it.run?.(); }}>
                          {it.icon}<span className="truncate">{it.label}</span>{it.keys && <span className="foot-kbd">{chips(it.keys).join(" ")}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <button className="open-btn" aria-expanded={footOpen} onClick={() => setFootOpen((v) => !v)}>
                  <FolderOpen /><span className="truncate">{root.handle ? i18next.t("フォルダ") : i18next.t("フォルダを開く")}</span>{untitled && <span className="foot-dot" title={i18next.t("まだワークスペースとして保存していません")} />}<ChevronUp className="open-btn-chev" />
                </button>
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
          <div className="tabrow" data-dragging={dragS}>
            {topLeaves(lay).map((i) => <div key={i} className="slot" style={slot(boxes(lay).get(i)!, true)}>{strip(i)}</div>)}
          </div>
          <div className="work">
            <div className="work-row">
            <div className="panes" data-split={split} data-dragging={dragS} data-moving={moving || undefined}
              onDragOverCapture={(e) => { if (!st.splitDrop || !paneDrag() || (drag.tab && (e.target as HTMLElement).closest?.(".tabbar"))) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = drag.tab ? "move" : "copy"; const z = zoneOf(e); setDz((d) => (d && d.pane === z.pane && d.edge === z.edge ? d : z)); }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDz(null); }}
              onDropCapture={(e) => { if (!st.splitDrop || !paneDrag() || (drag.tab && (e.target as HTMLElement).closest?.(".tabbar"))) return; e.preventDefault(); e.stopPropagation(); dropOnPanes(zoneOf(e)); }}>
              {leaves(lay).map((i) => <div key={i} className="slot" data-born={born[i]} style={slot(boxes(lay).get(i)!)}>{pane(i)}</div>)}
              {joints(lay).map((j) => <div key={j.path.join("")} className="split-grip" data-dir={j.dir} data-drag={gripOn === j.path.join(".")} role="separator" aria-orientation={j.dir === "row" ? "horizontal" : "vertical"} style={gripPos(j)}
                title={i18next.t("ドラッグで幅を変える・ダブルクリックで半分に戻す")} onPointerDown={(e) => gripDown(e, j)} onDoubleClick={() => setLay((l) => setRatio(l, j.path, 50))} />)}
              {dz && paneDrag() && <div className="drop-hint" data-edge={dz.edge} style={dropRect(dz)} />}
            </div>
            {br && <ColGrip width={st.brW} def={560} min={280} max={1000} dir={-1} onChange={(w) => update({ brW: w })} />}
            {br && <BrowserDock onClose={() => setBr(false)} />}
            {ai && <ColGrip width={st.aiW} def={440} min={280} max={900} dir={-1} onChange={(w) => update({ aiW: w })} />}
            <AiDock open={ai} job={aiJob} quote={aiQuote} resolve={aiSource} files={aiFiles} onClose={() => setAi(false)} onSettings={() => setSetts("ai")} />
            <PortsPanel open={portsOpen} items={delas} conn={root?.conn} rootPath={root?.conn?.path} onClose={() => setPortsOpen(false)} onPublish={startDela} onStop={stopDela} onCopy={(u) => copyText(u)} onOpen={(u) => void openExternal(u)} onLog={setLogId} />
            {gitOpen && <ColGrip width={st.gitW} def={440} min={280} max={900} dir={-1} onChange={(w) => update({ gitW: w })} />}
            <GitPanel open={gitOpen} conn={gitView?.conn ?? null} root={gitView?.root} dir={gitView?.dir}
              canDrop={() => drag.node?.kind === "dir" && !!rootOf(drag.node).conn}
              onDropDir={() => { const n = drag.node; dragEnd(); if (n?.kind === "dir" && rootOf(n).conn) void gitHere(rootOf(n).conn!, abs(n)); }}
              title={gitAt ? (gitAt.root ?? gitAt.dir).replace(/\/+$/, "").split("/").pop() || "/" : undefined} onBack={gitAt ? () => setGitAt(null) : undefined}
              onRepo={(d) => { void gitHere(gitView!.conn, d); setGitTick((n) => n + 1); void reload(); }} rev={gitTick} onClose={() => setGitOpen(false)} onChanged={() => { setGitTick((n) => n + 1); void syncTabs(); }} guard={() => !dirtyList.length || ask({ message: i18next.t("保存していない変更が {{length}} 件あります。ファイルが書き換わると失われることがあります。続けますか?", { length: dirtyList.length }), danger: true })} />
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

        <ShotPreview />
        {st.sbShow && (
          <StatusBar
            tab={tab} cur={cur[fp]} info={tab?.info ?? ""} lang={tab ? langName(tab.node.name) : ""}
            dirtyCount={dirtyList.length} termCount={alive().length} term={term}
            conn={root.conn ? `${connLabel(root.conn)} · ${lastDir(root.conn.path)}` : null} connFull={root.conn ? `${connLabel(root.conn)} · ${showPath(root.conn.path)}` : undefined} connKind={root.conn?.kind ?? null}
            onConn={() => setCn(true)} ws={st.wsStatus ? ws?.name ?? "" : null} wsColor={ws?.color} onWs={() => setWsDlg("ws")} onPop={(k) => setPop((p) => (p === k ? null : k))}
            onTerm={() => showTerm()}
            git={gits[root.prefix] ? { branch: gits[root.prefix]!.branch, changes: gits[root.prefix]!.files.size } : null} onGit={() => { setGitTick((n) => n + 1); setGitOpen(true); }}
            lspKey={lspKey}
          />
        )}
      </div>

      {pQo.v && <QuickOpen key={pQo.key} out={pQo.out} roots={rootsLite} onPick={(n) => openOrFocus(n)} onClose={() => setQo(false)} />}
      {pPal.v && <Palette key={pPal.key} out={pPal.out} cmds={wsCmds} onClose={() => setPal(false)} />}
      {pSetts.v && <Settings onCheckUpdate={checkNow} onTheme={() => { setSetts(null); setTp(true); }} key={pSetts.key} out={pSetts.out} first={pSetts.v} onClose={() => setSetts(null)} />}
      {pLh.v && (() => { const lt = tabs.find((x) => x.node.path === pLh.v); return lt && isText(lt) ? <LocalHistory key={pLh.key} out={pLh.out} path={lt.node.path} name={lt.node.name} current={lt.text} onRestore={(text) => setTabs((p) => p.map((x) => (x.node.path === lt.node.path && isText(x) ? { ...x, text } : x)))} onClose={() => setLh(null)} /> : null; })()}
      {pDlg.v && <Dialog key={pDlg.key} out={pDlg.out} {...pDlg.v} onClose={() => setDlg(null)} />}
      {pWs.v && <Workspaces key={pWs.key} out={pWs.out} initial={pWs.v} curId={ws?.id ?? null} saveName={root.conn ? root.name : root.handle ? root.name : ""} max={st.wsMax} onOpen={(w) => switchWs(w)} onSaveNew={saveNew} onClose={() => setWsDlg(null)} flash={flash} />}
      {pSetup.v && <Setup key={pSetup.key} out={pSetup.out} onClose={() => setSetupOpen(false)} />}
      {pFb.v && <FeedbackView key={pFb.key} out={pFb.out} onClose={() => setFbOpen(false)} />}
      {pUp.v && upd && <UpdateView key={pUp.key} m={upd} out={pUp.out} onClose={() => setUpdOpen(false)} />}
      {pLog.v && <PortLog key={pLog.key} pub={pLog.v} conn={root?.conn} out={pLog.out} onClose={() => setLogId(null)} onCopy={(u) => copyText(u)} onOpen={(u) => void openExternal(u)} />}
      {pGh.v && gitView && <GithubView key={pGh.key} out={pGh.out} conn={gitView.conn} root={gitView.root ?? gitView.dir} onClose={() => setGhOpen(false)} />}
      {pStats.v && <StatsView key={pStats.key} out={pStats.out} onClose={() => setStatsOpen(false)} />}
      {pCn.v && <Connect key={pCn.key} out={pCn.out} current={cnAdd ? null : root.conn ?? null} adding={cnAdd} onConnect={cnAdd ? addConn : connect} onClose={() => setCn(false)} />}
      {pPop.v && <StatusPop key={pPop.key} out={pPop.out} kind={pPop.v} view={ev() ?? null} eol={tab?.eol ?? "lf"} lang={tab ? langName(tab.node.name) : ""} onEol={toggleEol} lspKey={lspKey} onSettings={(c) => setSetts(c)} onClose={() => setPop(null)} />}
      <LangUI onGoto={gotoLoc} onRename={applyRename} />
      {pMenu.v && <ContextMenu key={pMenu.key} out={pMenu.out} x={pMenu.v.x} y={pMenu.v.y} items={pMenu.v.items} onClose={() => setMenu(null)} />}
    </div>
    </GitMarks.Provider>
  );
}
