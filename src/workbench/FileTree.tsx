import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import i18next from "i18next";
import { ChevronRight, FileText, FileCode2, FileJson, FileType, Folder, FolderOpen, Image as ImageIcon, Film, Music } from "lucide-react";
import { type Node, nodeOrder } from "@/platform/fs";
import { useSettings } from "@/features/settings/settings";
import { drag, dragEnd, extFiles, setDragSrc, setDropTarget, useDnd } from "@/workbench/dnd";
import { creatingNow, stopCreating, useCreating, useWanted } from "@/workbench/creating";
import { enterRow } from "@/workbench/treeAnim";
import { usePending, type PendingItem } from "@/workbench/pending";
import { useCut } from "@/workbench/treeclip";
import { isMulti, isSelectedPath, knownNode, selectOnly, selectRange, selectedNodes, toggleSel, useSelected } from "@/workbench/selection";
import { dirOf } from "@/workbench/treeops"; import { bulkFor, bulkTake, dropWarm, isOpen, readDir, readWarm, setOpenPath, subBulk, takePrefetched, rememberKids, recallKids, warmDir, warmKids } from "@/workbench/treeOpen";

// ドラッグ中のものを、このフォルダへ移せるか(自分の中・今いる場所へは移せない)
export const canDrop = (dest: Node) => {
  const n = drag.node;
  return !!n && dest.kind === "dir" && n.path !== dest.path && dirOf(n.path) !== dest.path && !dest.path.startsWith(n.path + "/");
};

export const iconFor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["json", "jsonc"].includes(ext)) return <FileJson className="ico" style={{ color: "#d9822b" }} />;
  if (["ts", "tsx", "js", "jsx", "mjs", "py", "go", "rs", "swift", "css", "html", "sh"].includes(ext)) return <FileCode2 className="ico" style={{ color: "#4f7cf0" }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"].includes(ext)) return <ImageIcon className="ico" style={{ color: "#33a06f" }} />;
  if (["pdf", "doc", "docx"].includes(ext)) return <FileType className="ico" style={{ color: "#d94a4a" }} />;
  if (["mp4", "webm", "mov"].includes(ext)) return <Film className="ico" style={{ color: "#9a5cd9" }} />;
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext)) return <Music className="ico" style={{ color: "#d9822b" }} />;
  return <FileText className="ico" style={{ color: "var(--ink-3)" }} />;
};

// Git の印(M・A・U など)。親から関数で受ける(未対応のフォルダでは何も返さない)
// 引きずっている間カーソルに付く札。行そのものの半透明の写しより小さく、何を運んでいるかだけが分かる
export const dragChip = (e: React.DragEvent, row: HTMLElement, name: string) => {
  const c = document.createElement("div");
  c.className = "drag-chip";
  const ico = row.querySelector(".ico");
  if (ico) c.append(ico.cloneNode(true));
  const t = document.createElement("span");
  t.textContent = name;
  c.append(t);
  document.body.append(c);
  e.dataTransfer.setDragImage(c, 14, 16);
  setTimeout(() => c.remove(), 0);
};

const SKEL = [46, 34, 40]; // 中身を読んでいる間に出す行(名前の幅 %)

export type GitMark = "M" | "A" | "D" | "U" | "R" | "C" | "dir";
export const GitMarks = createContext<(n: Node) => GitMark | undefined>(() => undefined);

type Props = { nodes: Node[]; activePath: string | null; ctxPath: string | null; rev: number; onOpen: (n: Node, pin?: boolean) => void; onContext: (e: React.MouseEvent, n: Node) => void; onMove: (n: Node, dest: Node) => void; onDropFiles?: (e: React.DragEvent, dest: Node) => void; onPasteFiles?: (e: React.ClipboardEvent, dest: Node | null) => void; depth?: number; dirPath?: string };

// 名前を打つ行。「a/b/c.js」のように打つと、途中のフォルダも作る
function CreateRow({ depth }: { depth: number }) {
  const c = useCreating();
  const indent = useSettings().treeIndent;
  const [v, setV] = useState(""), [busy, setBusy] = useState(false);
  const done = useRef(false), ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // 横には動かさない(深い階層でも一覧が右へ流れないように)。縦だけ、行が見える位置まで寄せる
    const el = ref.current; if (!el) return;
    el.focus({ preventScroll: true });
    const box = el.closest("nav") as HTMLElement | null, row = el.closest("li");
    if (!box || !row) return;
    const b = box.getBoundingClientRect(), r = row.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top; else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, []);
  if (!c) return null;
  const err = v.trim() ? c.validate(v) : null;
  const submit = async () => {
    const t = v.trim();
    if (done.current) return;
    if (!t || err) { if (!t) { done.current = true; stopCreating(); } return; }
    done.current = true; setBusy(true);
    try { await c.submit(t); } finally { stopCreating(); }
  };
  return (
    <li role="none" className="create-row" data-err={!!err || undefined}>
      <div className="tree-row" style={{ paddingLeft: 10 + depth * indent }}>
        <ChevronRight className="chev" data-hidden />
        {c.kind === "dir" || v.endsWith("/") ? <Folder className="ico folder" /> : iconFor(v.slice(v.lastIndexOf("/") + 1).trim())}
        <input ref={ref} className="create-input" value={v} disabled={busy} spellCheck={false} autoComplete="off" aria-invalid={!!err} aria-label={c.kind === "dir" ? i18next.t("新規フォルダ") : i18next.t("新規ファイル")}
          onChange={(e) => setV(e.target.value)} onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") { done.current = true; stopCreating(); } else if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
          onBlur={() => { if (done.current) return; if (v.trim() && !err) void submit(); else { done.current = true; stopCreating(); } }} />
      </div>
      {err && <div className="create-err" role="alert" style={{ paddingLeft: 10 + depth * indent + 40 }}>{err}</div>}
    </li>
  );
}

// 貼り付け中のものの行(名前は出し、中身が入り終わるまで薄くまたたく)
function PendingRow({ name, depth, i }: { name: string; depth: number; i: number }) {
  const indent = useSettings().treeIndent;
  return (
    <li role="none" className="pending-row" aria-busy="true">
      <div className="tree-row" style={{ paddingLeft: 10 + depth * indent, ["--i" as string]: i }}>
        <ChevronRight className="chev" data-hidden />
        <i className="pending-ico" />
        <span className="truncate">{name}</span>
      </div>
    </li>
  );
}

const mergePending = (nodes: Node[], pending: PendingItem[]) => {
  const have = new Set(nodes.map((n) => n.name));
  const ps = pending.filter((p) => !have.has(p.name));
  if (!ps.length) return nodes.map((n) => ({ n }));
  const asNode = (p: PendingItem) => ({ name: p.name, kind: p.dir ? "dir" : "file" }) as Node;
  const out: ({ n: Node } | { pending: PendingItem })[] = [];
  const sorted = [...ps].sort((a, b) => nodeOrder(asNode(a), asNode(b)));
  let k = 0;
  for (const n of nodes) {
    while (k < sorted.length && nodeOrder(asNode(sorted[k]), n) < 0) out.push({ pending: sorted[k++] });
    out.push({ n });
  }
  while (k < sorted.length) out.push({ pending: sorted[k++] });
  return out;
};

function FileTree({ nodes: all, activePath, ctxPath, rev, onOpen, onContext, onMove, onDropFiles, onPasteFiles, depth = 0, dirPath }: Props) {
  const creating = useCreating();
  const pending = usePending(dirPath);
  const { showHidden, treeIndent } = useSettings();
  const nodes = showHidden ? all : all.filter((n) => !n.name.startsWith("."));
  // いちばん上の一覧では、中のフォルダを先読みしておく。作成・削除のあとは先読みを捨てる
  useEffect(() => { if (!depth) dropWarm(); }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!depth) warmKids(nodes); }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  // 最初に描いた一覧にあったものは動かさず、あとから増えたものだけ現れる動きをつける
  const seen = useRef<Set<string> | null>(null);
  const fresh = seen.current ? nodes.filter((n) => !seen.current!.has(n.path)).map((n) => n.path) : [];
  const soft = fresh.length > 0 && creatingNow();
  useEffect(() => { seen.current = new Set(nodes.map((n) => n.path)); });
  // 入り途中のものは、並び順どおりの位置に出す。同じ名前の本物の行が出たら、そちらに任せて消す
  const rows = mergePending(nodes, pending);
  return (
    <ul role={depth ? "group" : "tree"} className="m-0 list-none p-0" style={depth ? { ["--guide" as string]: `${16 + (depth - 1) * treeIndent}px` } : undefined}>
      {creating && dirPath !== undefined && creating.at === dirPath && <CreateRow key="create" depth={depth} />}
      {rows.map((r, i) => "pending" in r
        ? <PendingRow key={`pending:${r.pending.name}`} name={r.pending.name} depth={depth} i={i} />
        : <Item key={r.n.path} idx={i} enter={fresh.includes(r.n.path) ? (soft ? "soft" : "grow") : undefined} n={r.n} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} onDropFiles={onDropFiles} onPasteFiles={onPasteFiles} depth={depth} />)}
    </ul>
  );
}

function Item({ enter, n, activePath, ctxPath, rev, onOpen, onContext, onMove, onDropFiles, onPasteFiles, depth, idx }: Omit<Props, "nodes"> & { n: Node; depth: number; idx: number; enter?: "grow" | "soft" }) {
  const git = useContext(GitMarks)(n);
  const indent = useSettings().treeIndent;
  const restored = useRef(n.kind === "dir" && isOpen(n.path)).current; // 前に開いていたフォルダは、アニメーションなしで開いた状態に戻す
  const [open, setOpenRaw] = useState(restored);
  const setOpen = (v: boolean) => { setOpenRaw(v); setOpenPath(n.path, v); };
  const prefetched = useRef<Node[] | undefined>(undefined);
  const [loaded, setLoadedRaw] = useState<Node[] | undefined>(() => (restored && n.handle ? (prefetched.current = takePrefetched(n.path)) ?? recallKids(n.path) : undefined));
  const setLoaded = (v: Node[]) => { rememberKids(n.path, v); setLoadedRaw(v); }; // 先読みできていれば、最初から開いた状態で描く
  const selected = useSelected(n.path), cut = useCut(n.path); knownNode(n);
  const dnd = useDnd(n.path), over = !!(dnd & 1);
  const isDir = n.kind === "dir";
  const kids = n.handle ? loaded : n.children;
  // 初めて開くフォルダは、中身を読んだ直後に「開いた状態」で現れるため、閉→開の変化が無く一瞬で開いてしまう。
  // 閉じた状態で一度描いてから開くことで、どの状態でも同じ動きにする
  const [armed, setArmed] = useState(!!kids || restored);
  useEffect(() => {
    if (!open || !kids || armed) return;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setArmed(true)); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [open, kids, armed]);

  // 開いた状態で戻ったフォルダは、中身を読み直す
  useEffect(() => { if (restored && n.handle && !prefetched.current) readDir(n.handle as FileSystemDirectoryHandle, n.path).then(setLoaded).catch(() => setOpen(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 開いたフォルダの中のフォルダを先読みして、次に開くときにすぐ出せるようにする
  useEffect(() => { if (open && kids && n.handle) warmKids(kids); }, [open, kids]); // eslint-disable-line react-hooks/exhaustive-deps

  // 作成・削除のあとに、開いているフォルダの中身を読み直す
  useEffect(() => {
    if (isDir && n.handle && loaded) readDir(n.handle as FileSystemDirectoryHandle, n.path).then(setLoaded, () => {}); // 読み直せなくても、いま出ている中身は残す
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = async () => {
    if (!isDir) return onOpen(n);
    if (open) return setOpen(false);
    // すぐに開いた形にし、中身を読む間はフォルダの中に読み込み中の行を出す
    setOpen(true);
    if (!kids && n.handle) {
      const old = recallKids(n.path);
      if (old) setLoadedRaw(old); // 前に読んだ中身を先に出し、新しい中身が読めたら置き換える
      await readWarm(n).then(setLoaded, () => { if (!old) setOpen(false); });
    }
  };

  // 右クリックの「中の階層をすべて開く・閉じる」。あとから現れた中のフォルダも、描いたときに従う
  const live = useRef({ open, click }); live.current = { open, click };
  useEffect(() => {
    if (!isDir) return;
    const go = () => {
      const v = bulkFor(n.path, n.name);
      if (v === true && !live.current.open) { bulkTake(); void live.current.click(); }
      else if (v === false && live.current.open) setOpen(false);
    };
    go();
    return subBulk(go);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 名前を打つ行の置き場・作ったものの通り道になったフォルダは、閉じていれば開く
  const wanted = useWanted(n.path);
  useEffect(() => { if (wanted && isDir && !live.current.open) void live.current.click(); }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  // 印は消えるときも、直前の文字のまま薄れていく(中身が空になって一瞬ちらつかないように)
  const lastGit = useRef<string | undefined>(git);
  if (git) lastGit.current = git;
  const shownGit = git ?? lastGit.current;

  // 閉じたフォルダの上で少し待つと開く(中へ落とせるように)
  useEffect(() => {
    if (!over || open || !isDir) return;
    const t = setTimeout(() => { void click(); }, 600);
    return () => clearTimeout(t);
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  // 落とし先はフォルダのかたまり全体(行と開いた中身)。ファイルの上なら、そのファイルがあるフォルダに入る。
  // いちばん内側のフォルダで受け止め、移せない場所(自分自身・いまの場所)なら外のフォルダへは伝えない
  const dropProps = isDir ? {
    onDragOver: (e: React.DragEvent) => {
      // OS から引きずってきたものは、このフォルダへ写す
      if (onDropFiles && extFiles(e)) { e.stopPropagation(); e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropTarget(n.path); return; }
      if (!drag.node) return;
      e.stopPropagation();
      if (!canDrop(n)) { setDropTarget(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(n.path);
    },
    onDrop: (e: React.DragEvent) => {
      if (onDropFiles && extFiles(e)) { onDropFiles(e, n); return; }
      if (!drag.node) return;
      e.stopPropagation();
      if (!canDrop(n)) { dragEnd(); return; }
      e.preventDefault(); const m = drag.node; dragEnd(); onMove(m, n);
    },
  } : {};

  const liRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => { if (enter && liRef.current) enterRow(liRef.current, enter === "soft"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <li ref={liRef} role="treeitem" aria-expanded={isDir ? open : undefined} data-drop={over || undefined} {...dropProps}
      onPaste={onPasteFiles ? (e) => onPasteFiles(e, isDir ? n : { name: dirOf(n.path).split("/").pop() ?? "", path: dirOf(n.path), kind: "dir", handle: n.parent }) : undefined}>
      <button className="tree-row" data-path={n.path} data-sel={selected || undefined} data-git={git} data-active={!isDir && activePath === n.path} data-ctx={ctxPath === n.path} data-src={!!(dnd & 2) || cut || undefined} draggable
        onDragStart={(e) => { drag.node = n; e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", n.name); dragChip(e, e.currentTarget, isMulti() && isSelectedPath(n.path) ? i18next.t("{{name}} ほか {{n}} 件", { name: n.name, n: selectedNodes().length - 1 }) : n.name); setTimeout(() => setDragSrc(n.path), 0); }}
        onDragEnd={() => dragEnd()} onClick={(e) => { if (e.ctrlKey || e.metaKey) return toggleSel(n); if (e.shiftKey) { window.getSelection()?.removeAllRanges(); return selectRange(n); } selectOnly(n); void click(); }} onPointerEnter={isDir && !open && !kids ? () => void warmDir(n) : undefined} onDoubleClick={() => { if (!isDir) onOpen(n, true); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); if (!(isMulti() && isSelectedPath(n.path))) selectOnly(n); onContext(e, n); }}
        style={{ paddingLeft: 10 + depth * indent, ["--i" as string]: idx }}>
        <ChevronRight className="chev" data-open={open} data-hidden={!isDir} />
        {isDir ? (open ? <FolderOpen className="ico folder" /> : <Folder className="ico folder" />) : iconFor(n.name)}
        <span className="truncate">{n.name}</span>
        {(git || lastGit.current) && <span className="git-badge" data-on={!!git} data-g={shownGit}>{shownGit === "dir" ? "" : shownGit}</span>}
      </button>
      {isDir && open && !kids && n.handle && (
        <div className="tree-skel" role="status" aria-label={i18next.t("読み込み中…")}>
          {SKEL.map((w, i) => <div key={i} className="tree-skel-row" style={{ paddingLeft: 10 + (depth + 1) * indent, ["--i" as string]: i, ["--w" as string]: `${w}%` }}><i /><i /><b /></div>)}
        </div>
      )}
      {isDir && kids && (
        <div className="collapse" data-open={open && armed}>
          <div className="collapse-inner"><FileTree nodes={kids} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} onDropFiles={onDropFiles} onPasteFiles={onPasteFiles} depth={depth + 1} dirPath={n.path} /></div>
        </div>
      )}
    </li>
  );
}

// 親(App)は打鍵のたびに描き直すので、ツリーは props が変わったときだけ描く
export default memo(FileTree);
