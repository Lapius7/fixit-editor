import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, PanelLeft, ListCollapse, RotateCw, X, Circle } from "lucide-react";
import Editor from "./Editor";
import FileTree from "./FileTree";
import QuickOpen from "./QuickOpen";
import { DEMO_NAME, DEMO_TREE } from "./lib/demo";
import { pickFolder, readDir, readFile, supportsFs, writeFile, type Node } from "./lib/fs";
import { APP_NAME } from "./lib/config";

type Tab = { node: Node; text: string; saved: string };

export default function App() {
  const [root, setRoot] = useState<{ name: string; handle?: FileSystemDirectoryHandle; nodes: Node[] }>({ name: DEMO_NAME, nodes: DEMO_TREE });
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [side, setSide] = useState(true);
  const [treeKey, setTreeKey] = useState(0);
  const [pos, setPos] = useState({ l: 1, c: 1 });
  const [msg, setMsg] = useState("");
  const [palette, setPalette] = useState(false);
  const [closing, setClosing] = useState<Set<string>>(new Set());

  const tab = tabs.find((t) => t.node.path === active) ?? null;
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2200); };

  const open = useCallback(async (n: Node) => {
    if (!tabs.some((t) => t.node.path === n.path)) {
      try {
        const text = n.demo ?? (await readFile(n.handle as FileSystemFileHandle));
        setTabs((p) => [...p, { node: n, text, saved: text }]);
      } catch (e) { return flash(String((e as Error).message)); }
    }
    setActive(n.path);
  }, [tabs]);

  const close = (path: string) => {
    const i = tabs.findIndex((t) => t.node.path === path);
    const next = tabs.filter((t) => t.node.path !== path);
    if (active === path) setActive(next[Math.max(0, i - 1)]?.node.path ?? null);
    setClosing((c) => new Set(c).add(path));
    setTimeout(() => { setTabs((p) => p.filter((t) => t.node.path !== path)); setClosing((c) => { const n = new Set(c); n.delete(path); return n; }); }, 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setPalette(true); }
      else if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); setSide((v) => !v); }
      else if (e.altKey && e.key.toLowerCase() === "w" && active) { e.preventDefault(); close(active); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const save = useCallback(async () => {
    if (!tab) return;
    if (!tab.node.handle) { setTabs((p) => p.map((t) => (t === tab ? { ...t, saved: t.text } : t))); return flash("デモファイルは保存先がありません"); }
    try { await writeFile(tab.node.handle as FileSystemFileHandle, tab.text); setTabs((p) => p.map((t) => (t === tab ? { ...t, saved: t.text } : t))); flash("保存しました"); }
    catch (e) { flash("保存できませんでした: " + (e as Error).message); }
  }, [tab]);

  const openFolder = async () => {
    try {
      const { name, handle } = await pickFolder();
      setRoot({ name, handle, nodes: await readDir(handle) });
      setTabs([]); setActive(null); setTreeKey((k) => k + 1);
    } catch { /* キャンセル */ }
  };

  const refresh = async () => { if (root.handle) { setRoot({ ...root, nodes: await readDir(root.handle) }); setTreeKey((k) => k + 1); } };
  const dirty = useMemo(() => new Set(tabs.filter((t) => t.text !== t.saved).map((t) => t.node.path)), [tabs]);

  return (
    <div className="stage">
      <div className="window" data-side={side}>
        <aside className="sidebar" aria-label="ファイル">
          <header className="side-head">
            <h1 className="title">{root.name}</h1>
            <div className="tools">
              <button className="icon-btn" aria-label="更新" onClick={refresh}><RotateCw /></button>
              <button className="icon-btn" aria-label="すべて閉じる" onClick={() => setTreeKey((k) => k + 1)}><ListCollapse /></button>
              <button className="icon-btn" aria-label="サイドバーを隠す" onClick={() => setSide(false)}><PanelLeft /></button>
            </div>
          </header>
          <nav className="tree scroll"><FileTree key={treeKey} nodes={root.nodes} activePath={active} onOpen={open} /></nav>
          <footer className="side-foot">
            <button className="open-btn" onClick={openFolder} disabled={!supportsFs()} title={supportsFs() ? "" : "このブラウザでは使えません(Chrome / Edge を使ってください)"}>
              <FolderOpen /> フォルダを開く
            </button>
          </footer>
        </aside>

        <section className="main">
          <div className="tabbar" role="tablist">
            {!side && <button className="icon-btn" aria-label="サイドバーを表示" onClick={() => setSide(true)}><PanelLeft /></button>}
            {tabs.map((t) => (
              <div key={t.node.path} role="tab" aria-selected={t.node.path === active} className="tab" data-closing={closing.has(t.node.path)} onClick={() => setActive(t.node.path)}>
                <span className="tab-name">{t.node.name}</span>
                <button className="tab-x" aria-label={`${t.node.name} を閉じる`} onClick={(e) => { e.stopPropagation(); close(t.node.path); }}>
                  {dirty.has(t.node.path) ? <Circle className="dot" /> : <X />}
                </button>
              </div>
            ))}
          </div>
          <div className="paper">
            {tab ? (
              <Editor key={tab.node.path} docKey={tab.node.path} name={tab.node.name} value={tab.text} onSave={save} onCursor={(l, c) => setPos({ l, c })}
                onChange={(v) => setTabs((p) => p.map((x) => (x.node.path === tab.node.path ? { ...x, text: v } : x)))} />
            ) : (
              <div className="empty"><p className="empty-title">{APP_NAME}</p><p>左のファイルを選ぶと、ここで開きます。</p><p className="hint"><kbd>Ctrl</kbd> <kbd>P</kbd> でファイルを検索</p></div>
            )}
            <div className="status" aria-live="polite" data-show={!!(msg || tab)}>{msg || `${pos.l} 行 ${pos.c} 列`}</div>
          </div>
        </section>
      </div>
      {palette && <QuickOpen nodes={root.nodes} onPick={open} onClose={() => setPalette(false)} />}
    </div>
  );
}
