import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, FileCode2, FileJson, FileType, Folder, FolderOpen, Image as ImageIcon, Film, Music } from "lucide-react";
import { readDir, type Node } from "@/platform/fs";
import { useSettings } from "@/features/settings/settings";
import { drag, dragEnd, setDragSrc, setDropTarget, useDnd } from "@/workbench/dnd";
import { dirOf } from "@/workbench/treeops"; import { isOpen, setOpenPath } from "@/workbench/treeOpen";

// ドラッグ中のものを、このフォルダへ移せるか(自分の中・今いる場所へは移せない)
export const canDrop = (dest: Node) => {
  const n = drag.node;
  return !!n && dest.kind === "dir" && n.path !== dest.path && dirOf(n.path) !== dest.path && !dest.path.startsWith(n.path + "/");
};

const iconFor = (name: string) => {
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

export type GitMark = "M" | "A" | "D" | "U" | "R" | "C" | "dir";
export const GitMarks = createContext<(n: Node) => GitMark | undefined>(() => undefined);

type Props = { nodes: Node[]; activePath: string | null; ctxPath: string | null; rev: number; onOpen: (n: Node, pin?: boolean) => void; onContext: (e: React.MouseEvent, n: Node) => void; onMove: (n: Node, dest: Node) => void; depth?: number };

export default function FileTree({ nodes: all, activePath, ctxPath, rev, onOpen, onContext, onMove, depth = 0 }: Props) {
  const { showHidden, treeIndent } = useSettings();
  const nodes = showHidden ? all : all.filter((n) => !n.name.startsWith("."));
  return (
    <ul role={depth ? "group" : "tree"} className="m-0 list-none p-0" style={depth ? { ["--guide" as string]: `${16 + (depth - 1) * treeIndent}px` } : undefined}>
      {nodes.map((n, i) => <Item key={n.path} idx={i} n={n} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} depth={depth} />)}
    </ul>
  );
}

function Item({ n, activePath, ctxPath, rev, onOpen, onContext, onMove, depth, idx }: Omit<Props, "nodes"> & { n: Node; depth: number; idx: number }) {
  const git = useContext(GitMarks)(n);
  const indent = useSettings().treeIndent;
  const restored = useRef(n.kind === "dir" && isOpen(n.path)).current; // 前に開いていたフォルダは、アニメーションなしで開いた状態に戻す
  const [open, setOpenRaw] = useState(restored);
  const setOpen = (v: boolean) => { setOpenRaw(v); setOpenPath(n.path, v); };
  const [loaded, setLoaded] = useState<Node[] | undefined>();
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
  useEffect(() => { if (restored && n.handle) readDir(n.handle as FileSystemDirectoryHandle, n.path).then(setLoaded).catch(() => setOpen(false)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 作成・削除のあとに、開いているフォルダの中身を読み直す
  useEffect(() => {
    if (isDir && n.handle && loaded) readDir(n.handle as FileSystemDirectoryHandle, n.path).then(setLoaded);
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = async () => {
    if (!isDir) return onOpen(n);
    if (!open && !kids && n.handle) setLoaded(await readDir(n.handle as FileSystemDirectoryHandle, n.path));
    setOpen(!open);
  };

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
      if (!drag.node) return;
      e.stopPropagation();
      if (!canDrop(n)) { setDropTarget(null); return; }
      e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget(n.path);
    },
    onDrop: (e: React.DragEvent) => {
      if (!drag.node) return;
      e.stopPropagation();
      if (!canDrop(n)) { dragEnd(); return; }
      e.preventDefault(); const m = drag.node; dragEnd(); onMove(m, n);
    },
  } : {};

  return (
    <li role="treeitem" aria-expanded={isDir ? open : undefined} data-drop={over || undefined} {...dropProps}>
      <button className="tree-row" data-git={git} data-active={!isDir && activePath === n.path} data-ctx={ctxPath === n.path} data-src={!!(dnd & 2) || undefined} draggable
        onDragStart={(e) => { drag.node = n; e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", n.name); dragChip(e, e.currentTarget, n.name); setTimeout(() => setDragSrc(n.path), 0); }}
        onDragEnd={() => dragEnd()} onClick={click} onDoubleClick={() => { if (!isDir) onOpen(n, true); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContext(e, n); }}
        style={{ paddingLeft: 10 + depth * indent, ["--i" as string]: idx }}>
        <ChevronRight className="chev" data-open={open} data-hidden={!isDir} />
        {isDir ? (open ? <FolderOpen className="ico folder" /> : <Folder className="ico folder" />) : iconFor(n.name)}
        <span className="truncate">{n.name}</span>
        {(git || lastGit.current) && <span className="git-badge" data-on={!!git} data-g={shownGit}>{shownGit === "dir" ? "" : shownGit}</span>}
      </button>
      {isDir && kids && (
        <div className="collapse" data-open={open && armed}>
          <div className="collapse-inner"><FileTree nodes={kids} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} depth={depth + 1} /></div>
        </div>
      )}
    </li>
  );
}
