import { useEffect, useState } from "react";
import { ArrowUp, Clock, File as FileIcon, Folder, HardDrive, Home, Server, X } from "lucide-react";
import { checkDir, connLabel, dropRecent, getRecent, homeOf, listHosts, parseTarget, pushRecent, resolvePath, RemoteDir, type Conn } from "@/platform/remote";
import { ms } from "@/features/settings/settings";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

type Props = { current: Conn | null; adding?: boolean; onConnect: (c: Conn) => Promise<void> | void; onClose: () => void; out?: boolean };
const HOST_OK = /^[A-Za-z0-9._@-]+$/;
const LIST_MAX = 400;
type Row = { name: string; dir: boolean };
const up = (p: string) => (/^[A-Za-z]:\/?$/.test(p) || p === "/" ? p : p.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/");

// WSL(このPC)か SSH 先のフォルダを開くための画面
export default function Connect({ current, adding, onConnect, onClose, out }: Props) {
  const [kind, setKind] = useState<"wsl" | "ssh">(current?.kind === "ssh" ? "ssh" : "wsl");
  const [host, setHost] = useState(current?.host ?? "");
  const [path, setPath] = useState(current?.path ?? "~");
  const [hosts, setHosts] = useState<{ name: string; hostname?: string; user?: string }[]>([]);
  const [suggest, setSuggest] = useState(false);
  const [recent, setRecent] = useState<Conn[]>(getRecent);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [closing, setClosing] = useState(false);
  const [sshHost, setSshHost] = useState(current?.kind === "ssh" ? current.host ?? "" : ""); // 一覧を出す SSH ホスト(入力を確定したときだけ変える)
  const [dir, setDir] = useState(""); // 一覧に出しているフォルダの絶対パス
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lerr, setLerr] = useState("");

  useEffect(() => { listHosts().then(setHosts); }, []);
  const q = host.trim().toLowerCase();
  const matches = hosts.filter((h) => h.name !== host && (!q || h.name.toLowerCase().includes(q))).slice(0, 6);
  // 入力したパスのフォルダの中身を出す(入力が止まってから読む)
  useEffect(() => {
    if (kind === "ssh" && (!HOST_OK.test(sshHost) || sshHost.startsWith("-"))) { setRows(null); setDir(""); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const base = { kind, host: kind === "ssh" ? sshHost : undefined } as Pick<Conn, "kind" | "host">;
        const abs = await resolvePath(base, parseTarget(path).path || path);
        const out: Row[] = [];
        for await (const [name, h] of new RemoteDir({ ...base, path: abs }, abs).entries()) out.push({ name, dir: h.kind === "directory" });
        out.sort((a, b) => Number(b.dir) - Number(a.dir) || Number(a.name.startsWith(".")) - Number(b.name.startsWith(".")) || a.name.localeCompare(b.name));
        if (live) { setDir(abs); setRows(out); setLerr(""); }
      } catch (e) { if (live) { setRows(null); setLerr((e as Error).message); } }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [kind, sshHost, path]);
  const enter = (p: string) => { setPath(p); setErr(""); };
  const home = async () => { try { enter(await homeOf({ kind, host: kind === "ssh" ? sshHost : undefined })); } catch { /* 接続先がまだ決まっていない */ } };
  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, ms(180)); };

  const go = async (target?: Conn) => {
    setErr(""); setBusy(true);
    try {
      let k = target?.kind ?? kind, h = target?.host ?? host.trim(), p = target?.path ?? path;
      if (!target) {
        const t = parseTarget(p); // ssh://host/dir や host:/dir の形も受け付ける
        if (t.host) { k = "ssh"; h = t.host; p = t.path; }
      }
      if (k === "ssh" && (!HOST_OK.test(h) || h.startsWith("-"))) throw new Error(i18next.t("ホスト名を入力してください(例: user@example.com、または ~/.ssh/config の名前)"));
      const base = { kind: k, host: k === "ssh" ? h : undefined };
      const conn: Conn = { ...base, path: await resolvePath(base, p) };
      await checkDir(conn);
      pushRecent(conn);
      await onConnect(conn);
      close();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={() => close()}>
      <div className="qo dlg cn" role="dialog" aria-label={adding ? i18next.t("WSL・SSH のフォルダを追加") : i18next.t("WSL・SSH に接続")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(); else if (e.key === "Enter" && !busy) { e.preventDefault(); go(); } }}>
        <h2>{adding ? i18next.t("WSL・SSH のフォルダを追加") : i18next.t("WSL・SSH のフォルダを開く")}</h2>
        <div className="seg cn-seg" role="group" aria-label={i18next.t("接続先")}>
          <button aria-pressed={kind === "wsl"} onClick={() => setKind("wsl")}><HardDrive /><Trans i18nKey="WSL(このPC)" /></button>
          <button aria-pressed={kind === "ssh"} onClick={() => setKind("ssh")}><Server />SSH</button>
        </div>
        {kind === "ssh" && (
          <label className="cn-row">
            <span><Trans i18nKey="ホスト" /></span>
            <div className="cn-combo">
              <input className="field" autoFocus role="combobox" aria-expanded={suggest} aria-autocomplete="list" value={host} placeholder={i18next.t("例: user@example.com")} spellCheck={false}
                onChange={(e) => { setHost(e.target.value); setSuggest(true); }}
                onFocus={() => setSuggest(true)}
                onBlur={() => { setSuggest(false); setSshHost(host.trim()); }}
                onKeyDown={(e) => { if (e.key === "Escape" && suggest && matches.length) { e.stopPropagation(); setSuggest(false); } }} />
              {suggest && matches.length > 0 && (
                <ul className="cn-suggest" role="listbox">
                  {matches.map((h) => (
                    <li key={h.name} role="option" aria-selected={h.name === host} onMouseDown={(e) => { e.preventDefault(); setHost(h.name); setSshHost(h.name); setSuggest(false); }}>
                      <Server aria-hidden /><b>{h.name}</b>{(h.user || h.hostname) && <span>{[h.user, h.hostname].filter(Boolean).join("@")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </label>
        )}
        <label className="cn-row">
          <span><Trans i18nKey="フォルダ" /></span>
          <input className="field" autoFocus={kind === "wsl"} value={path} spellCheck={false} placeholder={kind === "wsl" ? i18next.t("例: ~/projects、C:\\Users\\me\\code") : i18next.t("例: ~/app、/var/www")} onChange={(e) => setPath(e.target.value)} />
        </label>
        <p className="cn-hint">{kind === "wsl" ? i18next.t("Windows のパス(C:\\…、\\\\wsl$\\…)も貼れます。") : i18next.t("鍵で入れるホストだけ使えます。パスワードの入力は受け付けません。")}</p>
        <div className="cn-br">
          <div className="cn-br-bar">
            <button className="icon-btn" aria-label={i18next.t("親のフォルダ")} title={i18next.t("親のフォルダ")} disabled={!dir || up(dir) === dir} onClick={() => enter(up(dir))}><ArrowUp /></button>
            <button className="icon-btn" aria-label={i18next.t("ホーム")} title={i18next.t("ホーム")} onClick={home}><Home /></button>
            <span className="cn-br-path" title={dir}>{dir || "—"}</span>
          </div>
          <div className="cn-br-list" role="listbox" aria-label={i18next.t("フォルダの中身")}>
            {rows === null ? <p className="cn-br-empty">{lerr || (kind === "ssh" ? i18next.t("ホストを入力すると、中身を表示します") : i18next.t("読み込み中…"))}</p>
              : rows.length === 0 ? <p className="cn-br-empty">{i18next.t("空のフォルダです")}</p>
              : rows.slice(0, LIST_MAX).map((r) => r.dir
                ? <button key={r.name} role="option" aria-selected="false" onClick={() => enter(`${dir.replace(/\/$/, "")}/${r.name}`)}><Folder /><span>{r.name}</span></button>
                : <div key={r.name} className="cn-br-file"><FileIcon /><span>{r.name}</span></div>)}
            {rows !== null && rows.length > LIST_MAX && <p className="cn-br-empty">{i18next.t("ほか {{n}} 件", { n: rows.length - LIST_MAX })}</p>}
          </div>
        </div>
        {hosts.length > 0 && kind === "ssh" && (
          <div className="cn-chips">{hosts.map((h) => <button key={h.name} className="chipbtn" data-on={host === h.name} onClick={() => { setHost(h.name); setSshHost(h.name); }}><Server />{h.name}</button>)}</div>
        )}
        {recent.length > 0 && (
          <div className="cn-recent">
            <h3><Clock /><Trans i18nKey="最近開いた場所" /></h3>
            {recent.map((c) => (
              <div key={`${c.kind}:${c.host}:${c.path}`} className="cn-item">
                <button onClick={() => go(c)} disabled={busy} data-tip={connLabel(c)} data-tip-sub={c.path}><b>{connLabel(c)}</b><span>{c.path}</span></button>
                <button className="icon-btn" aria-label={i18next.t("履歴から外す")} onClick={() => { dropRecent(c); setRecent(getRecent()); }}><X /></button>
              </div>
            ))}
          </div>
        )}
        <p className="cn-err" role="alert">{err}</p>
        <div className="dlg-foot">
          <button className="btn" onClick={() => close()}><Trans i18nKey="キャンセル" /></button>
          <button className="btn" data-primary="true" disabled={busy} onClick={() => go()}>{busy ? i18next.t("接続中…") : adding ? i18next.t("追加") : i18next.t("開く")}</button>
        </div>
      </div>
    </div>
  );
}
