// 送るフォルダを選ぶ。SSH 接続の画面と同じ見た目で、開いたフォルダ以下をたどる(それより上へは行けない)。今開いている場所が選んだフォルダになる。
import { useEffect, useState } from "react";
import { ArrowUp, Folder, Home } from "lucide-react";
import i18next from "i18next";
import { byName, isJunk } from "@/platform/fs";
import { RemoteDir, type Conn } from "@/platform/remote";

const HIDE = new Set(["node_modules", "target", "dist", "build", "vendor", "__pycache__", "venv"]);
const LIST_MAX = 300;
const trim = (p: string) => p.replace(/\/+$/, "") || "/";
const parent = (p: string) => trim(p).replace(/\/[^/]*$/, "") || "/";

export default function FolderBrowse({ conn, root, value, disabled, onChange }: { conn: Conn; root: string; value: string; disabled?: boolean; onChange: (dir: string) => void }) {
  const top = trim(root);
  const [names, setNames] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setNames(null); setErr("");
    void (async () => {
      try {
        const out: string[] = [];
        for await (const [name, h] of new RemoteDir(conn, value).entries()) {
          if (h.kind === "directory" && !name.startsWith(".") && !HIDE.has(name) && !isJunk(name)) out.push(name);
        }
        if (live) setNames(out.sort((a, b) => byName({ name: a }, { name: b })));
      } catch (e) { if (live) { setNames([]); setErr((e as Error).message); } }
    })();
    return () => { live = false; };
  }, [conn, value]);
  const rel = trim(value) === top ? "" : trim(value).slice(top.length + 1);
  const atTop = trim(value) === top;
  const go = (p: string) => { if (!disabled) onChange(p); };
  return (
    <div className="cn-br gh-br" data-loading={names === null || undefined} aria-busy={names === null}>
      <div className="cn-br-bar">
        <button type="button" className="icon-btn" aria-label={i18next.t("親のフォルダ")} title={i18next.t("親のフォルダ")} disabled={disabled || atTop} onClick={() => go(parent(value))}><ArrowUp /></button>
        <button type="button" className="icon-btn" aria-label={i18next.t("開いているフォルダ")} title={i18next.t("開いているフォルダ")} disabled={disabled || atTop} onClick={() => go(top)}><Home /></button>
        <span className="cn-br-path" title={value}>{rel ? `${top.split("/").pop()}/${rel}` : top.split("/").pop() || top}</span>
      </div>
      <div className="cn-br-list" role="listbox" aria-label={i18next.t("フォルダの中身")}>
        {names === null ? null
          : names.length === 0 ? <p className="cn-br-empty">{err || i18next.t("この中にフォルダはありません")}</p>
          : names.slice(0, LIST_MAX).map((n) => <button type="button" key={n} role="option" aria-selected="false" disabled={disabled} onClick={() => go(`${trim(value) === "/" ? "" : trim(value)}/${n}`)}><Folder /><span>{n}</span></button>)}
      </div>
    </div>
  );
}
