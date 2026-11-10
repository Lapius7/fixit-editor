import { displayPath } from "@/workbench/rootpath";
import { useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, FileCode2, FileJson, FileType, Folder, FolderOpen, Image as ImageIcon, Film, Music } from "lucide-react";
import { readDir, type Node } from "@/platform/fs";
import { useSettings } from "@/features/settings/settings";
import { drag, dragEnd } from "@/workbench/dnd";
import { dirOf } from "@/workbench/treeops";

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

type Props = { nodes: Node[]; activePath: string | null; ctxPath: string | null; rev: number; onOpen: (n: Node, pin?: boolean) => void; onContext: (e: React.MouseEvent, n: Node) => void; onMove: (n: Node, dest: Node) => void; depth?: number };

export default function FileTree({ nodes: all, activePath, ctxPath, rev, onOpen, onContext, onMove, depth = 0 }: Props) {
  const showHidden = useSettings().showHidden;
  const nodes = showHidden ? all : all.filter((n) => !n.name.startsWith("."));
  return (
    <ul role={depth ? "group" : "tree"} className="m-0 list-none p-0">
      {nodes.map((n, i) => <Item key={n.path} idx={i} n={n} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} depth={depth} />)}
    </ul>
  );
}

function Item({ n, activePath, ctxPath, rev, onOpen, onContext, onMove, depth, idx }: Omit<Props, "nodes"> & { n: Node; depth: number; idx: number }) {
  const indent = useSettings().treeIndent;
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Node[] | undefined>();
  const [over, setOver] = useState(false);
  const hover = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isDir = n.kind === "dir";
  const kids = n.handle ? loaded : n.children;

  // 作成・削除のあとに、開いているフォルダの中身を読み直す
  useEffect(() => {
    if (isDir && n.handle && loaded) readDir(n.handle as FileSystemDirectoryHandle, n.path).then(setLoaded);
  }, [rev]); // eslint-disable-line react-hooks/exhaustive-deps

  const click = async () => {
    if (!isDir) return onOpen(n);
    if (!open && !kids && n.handle) setLoaded(await readDir(n.handle as FileSystemDirectoryHandle, n.path));
    setOpen(!open);
  };

  const leave = () => { clearTimeout(hover.current); setOver(false); };
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { drag.node = n; e.dataTransfer.effectAllowed = "copyMove"; e.dataTransfer.setData("text/plain", n.name); },
    onDragEnd: () => { dragEnd(); leave(); },
    ...(isDir ? {
      onDragOver: (e: React.DragEvent) => {
        if (!canDrop(n)) return;
        e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move";
        if (!over) { setOver(true); if (!open) hover.current = setTimeout(() => { if (!open) click(); }, 700); }
      },
      onDragLeave: leave,
      onDrop: (e: React.DragEvent) => { if (!canDrop(n)) return; e.preventDefault(); e.stopPropagation(); leave(); const m = drag.node!; dragEnd(); onMove(m, n); },
    } : {}),
  };

  return (
    <li role="treeitem" aria-expanded={isDir ? open : undefined}>
      <button className="tree-row" data-tip={n.name} data-tip-sub={displayPath(n.path)} data-active={!isDir && activePath === n.path} data-ctx={ctxPath === n.path} data-drop={over} {...dragProps} onClick={click} onDoubleClick={() => { if (!isDir) onOpen(n, true); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContext(e, n); }}
        style={{ paddingLeft: 10 + depth * indent, ["--i" as string]: idx }}>
        <ChevronRight className="chev" data-open={open} data-hidden={!isDir} />
        {isDir ? (open ? <FolderOpen className="ico folder" /> : <Folder className="ico folder" />) : iconFor(n.name)}
        <span className="truncate">{n.name}</span>
      </button>
      {isDir && kids && (
        <div className="collapse" data-open={open}>
          <div className="collapse-inner"><FileTree nodes={kids} activePath={activePath} ctxPath={ctxPath} rev={rev} onOpen={onOpen} onContext={onContext} onMove={onMove} depth={depth + 1} /></div>
        </div>
      )}
    </li>
  );
}
