import { useState } from "react";
import { ChevronRight, FileText, FileCode2, FileJson, Folder, Image as ImageIcon } from "lucide-react";
import { readDir, type Node } from "./lib/fs";

const iconFor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["json", "jsonc"].includes(ext)) return <FileJson className="ico" style={{ color: "#d9822b" }} />;
  if (["ts", "tsx", "js", "jsx", "mjs", "py", "go", "rs", "swift", "css", "html", "sh"].includes(ext)) return <FileCode2 className="ico" style={{ color: "#4f7cf0" }} />;
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return <ImageIcon className="ico" style={{ color: "#33a06f" }} />;
  return <FileText className="ico" style={{ color: "#8b93a1" }} />;
};

type Props = { nodes: Node[]; activePath: string | null; onOpen: (n: Node) => void; depth?: number };

export default function FileTree({ nodes, activePath, onOpen, depth = 0 }: Props) {
  return (
    <ul role={depth ? "group" : "tree"} className="m-0 list-none p-0">
      {nodes.map((n, i) => <Item key={n.path} idx={i} n={n} activePath={activePath} onOpen={onOpen} depth={depth} />)}
    </ul>
  );
}

function Item({ n, activePath, onOpen, depth, idx }: Omit<Props, "nodes"> & { n: Node; depth: number; idx: number }) {
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<Node[] | undefined>(n.children);
  const isDir = n.kind === "dir";

  const click = async () => {
    if (!isDir) return onOpen(n);
    if (!open && !kids && n.handle) setKids(await readDir(n.handle as FileSystemDirectoryHandle, n.path));
    setOpen(!open);
  };

  return (
    <li role="treeitem" aria-expanded={isDir ? open : undefined}>
      <button className="tree-row" data-active={!isDir && activePath === n.path} onClick={click} style={{ paddingLeft: 10 + depth * 16, ["--i" as string]: idx }}>
        <ChevronRight className="chev" data-open={open} data-hidden={!isDir} />
        {isDir ? <Folder className="ico folder" /> : iconFor(n.name)}
        <span className="truncate">{n.name}</span>
      </button>
      {isDir && kids && (
        <div className="collapse" data-open={open}>
          <div className="collapse-inner"><FileTree nodes={kids} activePath={activePath} onOpen={onOpen} depth={depth + 1} /></div>
        </div>
      )}
    </li>
  );
}
