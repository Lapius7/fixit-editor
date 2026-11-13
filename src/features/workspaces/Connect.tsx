import { useEffect, useRef, useState } from "react";
import { ArrowUp, ClipboardCopy, Clock, File as FileIcon, Folder, FolderOpen, FolderPlus, HardDrive, Home, RotateCw, Server, X } from "lucide-react";
import ContextMenu, { type Item } from "@/workbench/ContextMenu";
import { usePresence } from "@/shared/presence";
import { byName, dropJunk, isJunk } from "@/platform/fs";
import { checkDir, connLabel, dropRecent, getRecent, homeOf, listHosts, parseTarget, pushRecent, resolvePath, showPath, RemoteDir, type Conn } from "@/platform/remote";
import { get, ms } from "@/features/settings/settings";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

type Props = { current: Conn | null; adding?: boolean; onConnect: (c: Conn) => Promise<void> | void; onClose: () => void; out?: boolean };
const HOST_OK = /^[A-Za-z0-9._@-]+$/;
const LIST_MAX = 400;
type Row = { name: string; dir: boolean };
const up = (p: string) => (/^[A-Za-z]:\/?$/.test(p) || p === "/" ? p : p.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/");

// WSL(このPC)か SSH 先のフォルダを開くための画面

const SKEL = [46, 62, 38, 70, 54, 42]; // 読み込み中に並べる仮の行の幅(%)

export default function Connect({ current, adding, onConnect, onClose, out }: Props) {
  const [kind, setKind] = useState<"wsl" | "ssh">(current?.kind === "ssh" ? "ssh" : "wsl");
  const [host, setHost] = useState(current?.host ?? "");
  // パスは、開いているフォルダに関係なく、設定の「最初のフォルダ」(初期はホーム。"~" → /home/<ユーザー>)から始める。SSH はいつもホーム
  const start = get().connStart.trim() || "~";
  const [path, setPath] = useState(current?.kind === "ssh" ? "~" : start);
  // フォルダの入力は種類(このPC / SSH)ごとに持つ。このPCのパスを SSH 先で開こうとしないように
  const kindPaths = useRef<Record<"wsl" | "ssh", string>>({ wsl: start, ssh: "~" });
  const switchKind = (k: "wsl" | "ssh") => {
    if (k === kind) return;
    kindPaths.current[kind] = path;
    setKind(k); setPath(kindPaths.current[k]); setErr("");
  };
  const [hosts, setHosts] = useState<{ name: string; hostname?: string; user?: string }[]>([]);
  const [suggest, setSuggest] = useState(false);
  const [recent, setRecent] = useState<Conn[]>(getRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; items: Item[] } | null>(null);
  const pMenu = usePresence(menu, 140);
  const [mk, setMk] = useState<string | null>(null); // 新しいフォルダの名前を入れている間の値
  const [tick, setTick] = useState(0); // 一覧を読み直す合図
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [closing, setClosing] = useState(false);
  const [sshHost, setSshHost] = useState(current?.kind === "ssh" ? current.host ?? "" : ""); // 一覧を出す SSH ホスト(入力を確定したときだけ変える)
  const [dir, setDir] = useState(""); // 一覧に出しているフォルダの絶対パス
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lerr, setLerr] = useState("");
  const [loading, setLoading] = useState(false); // 一覧を読んでいる間(SSH は数秒かかる)
  const [rowsOf, setRowsOf] = useState(""); // いま出している一覧が、どの接続先のものか

  useEffect(() => { listHosts().then(setHosts); }, []);
  const q = host.trim().toLowerCase();
  const matches = hosts.filter((h) => h.name !== host && (!q || h.name.toLowerCase().includes(q))).slice(0, 6);
  // 入力したパスのフォルダの中身を出す(入力が止まってから読む)
  useEffect(() => {
    if (kind === "ssh" && (!HOST_OK.test(sshHost) || sshHost.startsWith("-"))) { setRows(null); setDir(""); setLoading(false); return; }
    let live = true;
    setLoading(true); setLerr("");
    const of = `${kind}|${kind === "ssh" ? sshHost : ""}`;
    const t = setTimeout(async () => {
      try {
        const base = { kind, host: kind === "ssh" ? sshHost : undefined } as Pick<Conn, "kind" | "host">;
        const abs = await resolvePath(base, parseTarget(path).path || path);
        const out: Row[] = [], junk: string[] = [], rd = new RemoteDir({ ...base, path: abs }, abs);
        for await (const [name, h] of rd.entries()) {
          if (h.kind === "file" && isJunk(name)) junk.push(name);
          else out.push({ name, dir: h.kind === "directory" });
        }
        dropJunk(rd as unknown as FileSystemDirectoryHandle, junk);
        out.sort((a, b) => Number(b.dir) - Number(a.dir) || byName(a, b));
        if (live) { setDir(abs); setRows(out); setRowsOf(of); setLerr(""); setLoading(false); }
      } catch (e) { if (live) { setRows(null); setRowsOf(of); setLerr((e as Error).message); setLoading(false); } }
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [kind, sshHost, path, tick]);
  // 一覧で移動した場所の履歴。マウスの戻る・進むボタンでたどる(入力欄に打った移動は積まない)
  const hist = useRef<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const enter = (p: string) => {
    const h = hist.current;
    if (dir && p !== dir && h.back.at(-1) !== dir) { h.back.push(dir); h.fwd = []; }
    setPath(p); setErr("");
  };
  const step = (by: "back" | "fwd") => {
    const h = hist.current, to = h[by].pop();
    if (to === undefined) return;
    if (dir) (by === "back" ? h.fwd : h.back).push(dir);
    setPath(to); setErr("");
  };
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => { hist.current = { back: [], fwd: [] }; }, [kind, sshHost]);
  useEffect(() => {
    // 3 = 戻る、4 = 進む。押したときに既定の動き(ページの戻る)を止め、離したときに動かす
    const stop = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    const up = (e: MouseEvent) => { if (e.button !== 3 && e.button !== 4) return; e.preventDefault(); stepRef.current(e.button === 3 ? "back" : "fwd"); };
    window.addEventListener("mousedown", stop, true); window.addEventListener("mouseup", up, true);
    return () => { window.removeEventListener("mousedown", stop, true); window.removeEventListener("mouseup", up, true); };
  }, []);
  // 別の接続先(このPC→SSH、ホストの切り替え)を読んでいる間は、前の一覧を出さず、読み込み中の行を出す
  const stale = loading && rowsOf !== `${kind}|${kind === "ssh" ? sshHost : ""}`;
  // 初期値の "~" は、ホームの絶対パスに置き換える(階層を移動したときの表示とそろえる)。接続先を変えたら、また "~" から解決し直す
  const autoHome = useRef<string | null>(null);
  useEffect(() => {
    if (path !== "~" && path !== autoHome.current) return;
    let live = true;
    homeOf({ kind, host: kind === "ssh" ? sshHost : undefined }).then((h) => {
      if (!live || !h) return;
      autoHome.current = h;
      setPath((cur) => (cur === "~" || cur === autoHome.current || cur === path ? h : cur));
    }, () => {});
    return () => { live = false; };
  }, [kind, sshHost]); // eslint-disable-line react-hooks/exhaustive-deps
  const home = async () => { try { enter(await homeOf({ kind, host: kind === "ssh" ? sshHost : undefined })); } catch { /* 接続先がまだ決まっていない */ } };
  const sub = (name: string) => `${dir.replace(/\/$/, "")}/${name}`;
  // 一覧の中で新しいフォルダを作る(名前は一覧の先頭の入力欄で受け取る)
  const makeDir = async (name: string) => {
    const v = name.trim();
    if (!v) return setMk(null);
    if (/[\\/]/.test(v)) return setErr(i18next.t("「/」は使えません"));
    if (rows?.some((r) => r.name === v)) return setErr(i18next.t("同じ名前があります"));
    try {
      await new RemoteDir({ kind, host: kind === "ssh" ? sshHost : undefined, path: dir }, dir).getDirectoryHandle(v, { create: true });
      setMk(null); setErr(""); setTick((t) => t + 1);
    } catch (e) { setErr((e as Error).message); }
  };
  const copyPath = (p: string) => void navigator.clipboard.writeText(p).catch(() => {});
  // 一覧の右クリック。行の上ならその行の操作、空いたところなら、いま見ているフォルダの操作
  const listMenu = (e: React.MouseEvent, r?: Row) => {
    e.preventDefault(); e.stopPropagation();
    if (!dir || stale) return;
    const at = r ? sub(r.name) : dir;
    const items: Item[] = [
      ...(r?.dir ? [{ label: i18next.t("このフォルダに移動"), icon: <FolderOpen />, run: () => enter(at) }] : []),
      { label: i18next.t("新しいフォルダ"), icon: <FolderPlus />, run: () => { setErr(""); setMk(""); } },
      { label: i18next.t("最新の状態にする"), icon: <RotateCw />, run: () => setTick((t) => t + 1) },
      { type: "sep" },
      { label: i18next.t("パスをコピー"), icon: <ClipboardCopy />, run: () => copyPath(at) },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  // 最近開いた場所は、一覧の上の時計のボタンから出す(一覧を縦に広く使うため)
  const mine = recent.filter((c) => (kind === "ssh") === (c.kind === "ssh"));
  const recentMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({
      x: b.left, y: b.bottom + 4,
      items: [
        { type: "title", label: i18next.t("最近開いた場所") },
        ...mine.map((c): Item => ({ label: `${connLabel(c)}  ${showPath(c.path)}`, icon: <Clock />, disabled: busy, run: () => void go(c) })),
        { type: "sep" },
        { label: i18next.t("履歴から外す"), icon: <X />, sub: mine.map((c): Item => ({ label: `${connLabel(c)}  ${showPath(c.path)}`, run: () => { dropRecent(c); setRecent(getRecent()); } })) },
      ],
    });
  };
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
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg cn" role="dialog" aria-label={adding ? i18next.t("WSL・SSH のフォルダを追加") : i18next.t("WSL・SSH に接続")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(); else if (e.key === "Enter" && !busy) { e.preventDefault(); go(); } }}>
        <h2>{adding ? i18next.t("WSL・SSH のフォルダを追加") : i18next.t("WSL・SSH のフォルダを開く")}</h2>
        <div className="seg cn-seg" role="group" aria-label={i18next.t("接続先")}>
          <button aria-pressed={kind === "wsl"} onClick={() => switchKind("wsl")}><HardDrive /><Trans i18nKey="WSL(このPC)" /></button>
          <button aria-pressed={kind === "ssh"} onClick={() => switchKind("ssh")}><Server />SSH</button>
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
        <div className="cn-br" data-loading={loading || undefined} aria-busy={loading}>
          <div className="cn-br-bar">
            <button className="icon-btn" aria-label={i18next.t("親のフォルダ")} title={i18next.t("親のフォルダ")} disabled={!dir || up(dir) === dir} onClick={() => enter(up(dir))}><ArrowUp /></button>
            <button className="icon-btn" aria-label={i18next.t("ホーム")} title={i18next.t("ホーム")} onClick={home}><Home /></button>
            <span className="cn-br-path" title={stale ? undefined : dir}>{stale ? (kind === "ssh" ? i18next.t("{{host}} に接続中…", { host: sshHost }) : i18next.t("読み込み中…")) : dir || "—"}</span>
            <button className="icon-btn" aria-label={i18next.t("新しいフォルダ")} title={i18next.t("新しいフォルダ")} disabled={!dir || stale} onClick={() => { setErr(""); setMk(""); }}><FolderPlus /></button>
            {mine.length > 0 && <button className="icon-btn" aria-label={i18next.t("最近開いた場所")} title={i18next.t("最近開いた場所")} aria-haspopup="menu" onClick={recentMenu}><Clock /></button>}
          </div>
          <div className="cn-br-list" role="listbox" aria-label={i18next.t("フォルダの中身")} onContextMenu={(e) => listMenu(e)}>
            {mk !== null && !stale && (
              <div className="cn-br-new"><FolderPlus />
                <input className="field" autoFocus value={mk} spellCheck={false} placeholder={i18next.t("フォルダ名")} aria-label={i18next.t("新しいフォルダの名前")}
                  onChange={(e) => setMk(e.target.value)} onBlur={() => { if (!mk.trim()) setMk(null); }}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); void makeDir(mk); } else if (e.key === "Escape") { setMk(null); setErr(""); } }} />
              </div>
            )}
            {stale || (loading && rows === null) ? SKEL.map((w, i) => <div key={i} className="cn-br-skel" style={{ ["--w" as string]: `${w}%`, ["--i" as string]: i }}><i /><b /></div>)
              : rows === null ? <p className="cn-br-empty">{lerr || (kind === "ssh" ? i18next.t("ホストを入力すると、中身を表示します") : i18next.t("読み込み中…"))}</p>
              : rows.length === 0 ? <p className="cn-br-empty">{i18next.t("空のフォルダです")}</p>
              : rows.slice(0, LIST_MAX).map((r) => r.dir
                ? <button key={r.name} role="option" aria-selected="false" onClick={() => enter(sub(r.name))} onContextMenu={(e) => listMenu(e, r)}><Folder /><span>{r.name}</span></button>
                : <div key={r.name} className="cn-br-file" onContextMenu={(e) => listMenu(e, r)}><FileIcon /><span>{r.name}</span></div>)}
            {rows !== null && rows.length > LIST_MAX && <p className="cn-br-empty">{i18next.t("ほか {{n}} 件", { n: rows.length - LIST_MAX })}</p>}
          </div>
        </div>
        {hosts.length > 0 && kind === "ssh" && (
          <div className="cn-chips">{hosts.map((h) => <button key={h.name} className="chipbtn" data-on={host === h.name} onClick={() => { setHost(h.name); setSshHost(h.name); }}><Server />{h.name}</button>)}</div>
        )}
        <p className="cn-err" role="alert">{err}</p>
        <div className="dlg-foot">
          <button className="btn" onClick={() => close()}><Trans i18nKey="キャンセル" /></button>
          <button className="btn" data-primary="true" disabled={busy} onClick={() => go()}>{busy ? i18next.t("接続中…") : adding ? i18next.t("追加") : i18next.t("開く")}</button>
        </div>
      </div>
      {pMenu.v && <ContextMenu key={pMenu.key} out={pMenu.out} x={pMenu.v.x} y={pMenu.v.y} items={pMenu.v.items} onClose={() => setMenu(null)} />}
    </div>
  );
}
