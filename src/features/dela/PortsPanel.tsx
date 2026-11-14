// 右側のポート管理パネル。上: 新しい公開の開始と、公開中のポートの一覧(停止)。下: 開いたフォルダ以下の .delaconfig があるプロジェクトの一覧で、
// 同じ URL の確認・コピー・ブラウザで開く・作り直しと、そのフォルダで公開する選択ができる。
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, Folder, Globe, Play, Plus, RefreshCw, Shuffle, Square, X } from "lucide-react";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";
import { ask } from "@/shared/ask";
import FolderBrowse from "@/features/github/FolderBrowse";
import type { Conn } from "@/platform/remote";
import { shortUrl, validName, validPort, type Pub } from "./dela";
import { histKey, loadHist, nameOfUrl, urlWithName } from "./history";
import { delaInfo, delaRenew, delaRunning, findProjects, hasDelaConfig, urlId, type Info, type Proj } from "./projects";

type Opt = { dir?: string; rel?: string; temp?: boolean; name?: string };
type Props = {
  open: boolean;
  items: Pub[];
  conn?: Conn;
  rootPath?: string;
  onClose: () => void;
  onPublish: (port: string, o: Opt) => void;
  onStop: (id: number) => void;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
  onLog: (id: number) => void;
};

const TEMP = "\u0000temp";
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;
type Row = Info & { busy?: boolean };

export function PortsPanel({ open, items, conn, rootPath, onClose, onPublish, onStop, onCopy, onOpen, onLog }: Props) {
  const [mounted, setMounted] = useState(open);
  const [port, setPort] = useState("5173");
  const [name, setName] = useState(""); // 公開する名前。"" は既定の app(名前を付けない)
  const [fresh, setFresh] = useState(false); // 新しい名前を打っているか
  const [projects, setProjects] = useState<Proj[]>([]);
  const [scanning, setScanning] = useState(false);
  const [rescan, setRescan] = useState(0);
  const [sel, setSel] = useState(""); // 公開に使うフォルダ(空は未選択)
  const [temp, setTemp] = useState(false); // 一時公開(.delaconfig を使わない)
  const [browse, setBrowse] = useState(false); // フォルダの階層ブラウザを開いているか
  const [infos, setInfos] = useState<Record<string, Row | undefined>>({});
  const [running, setRunning] = useState<string[]>([]); // 起動中のトンネルの URL(dela list)
  const asked = useRef(new Set<string>());
  const portRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setMounted(true); return; } const h = setTimeout(() => setMounted(false), ms(260)); return () => clearTimeout(h); }, [open]);

  const cKind = conn?.kind, cHost = conn?.host;
  useEffect(() => { setSel(""); setBrowse(false); }, [cKind, cHost, rootPath]); // 別のフォルダを開いたら、選びなおす
  const keyOf = (dir: string) => `${cKind}:${cHost ?? ""}:${dir}`;
  // 開いたときと、開いたフォルダが変わったときに、.delaconfig のあるフォルダを探し直す
  useEffect(() => {
    if (!open || !conn || !rootPath) return;
    const sig = { stop: false };
    setScanning(true);
    findProjects(conn, rootPath, sig).then((r) => { if (!sig.stop) { setProjects(r); setScanning(false); } }, () => { if (!sig.stop) setScanning(false); });
    return () => { sig.stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cKind, cHost, rootPath, rescan]);

  const withCfg = projects.filter((p) => p.config);
  const dflt = projects.find((p) => p.rel === "" && p.config) ?? (withCfg.length === 1 ? withCfg[0] : undefined);
  const cur = temp ? TEMP : sel || dflt?.dir || rootPath || "";
  const proj = cur === TEMP ? undefined : projects.find((p) => p.dir === cur);
  const root = (rootPath ?? "").replace(/\/+$/, "");
  // 開いたフォルダからの相対パス(外のフォルダなら空)
  const relOf = (d: string) => (root && d.replace(/\/+$/, "").startsWith(`${root}/`) ? d.replace(/\/+$/, "").slice(root.length + 1) : "");

  // フォルダごとの URL(dela info)。.delaconfig があるプロジェクトを、順に 1 つずつ確かめる
  const load = async (dir: string) => {
    if (!conn) return;
    const k = keyOf(dir);
    asked.current.add(k);
    setInfos((m) => ({ ...m, [k]: { ok: true, urls: m[k]?.urls ?? [], note: "", busy: true } }));
    const r = await delaInfo(conn, dir);
    setInfos((m) => ({ ...m, [k]: r }));
  };
  useEffect(() => {
    if (!open || !conn) return;
    let stop = false;
    void (async () => {
      for (const p of projects) {
        if (stop) return;
        if (p.config && !asked.current.has(keyOf(p.dir))) await load(p.dir);
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projects]);

  // 選んだフォルダに .delaconfig があれば、使われている名前を知るために dela info を取る(中身は読まない)
  useEffect(() => {
    if (!open || !conn || cur === TEMP || !cur || asked.current.has(keyOf(cur))) return;
    let stop = false;
    void hasDelaConfig(conn, cur).then((yes) => { if (!stop && yes) void load(cur); });
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cur, projects]);

  // 起動中の URL: 開いたとき・探し直したとき・アプリ内の公開が変わったときに取り直す(別のターミナルや前の起動で動いているものも拾う)
  const sig = items.map((d) => `${d.id}:${d.state}:${d.url ?? ""}`).join();
  useEffect(() => {
    if (!open || !conn || !rootPath) return;
    let stop = false;
    const h = setTimeout(() => { void delaRunning(conn, rootPath).then((r) => { if (!stop) setRunning(r); }); }, 600);
    return () => { stop = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cKind, cHost, rootPath, rescan, sig]);

  const renew = async (p: Proj) => {
    if (!conn) return;
    if (!(await ask({ message: i18next.t("このフォルダの URL を作り直します。いまの URL は使えなくなります。続けますか?"), ok: i18next.t("作り直す"), danger: true }))) return;
    const k = keyOf(p.dir);
    setInfos((m) => ({ ...m, [k]: { ok: true, urls: [], note: "", busy: true } }));
    const r = await delaRenew(conn, p.dir);
    setInfos((m) => ({ ...m, [k]: r }));
    if (r.ok) await load(p.dir); // 新しい URL を取り直す
  };
  // 公開を止める: 公開中の URL は使えなくなるので、確認してから止める(失敗した行を閉じるだけのときは確認しない)
  const stop = async (d: Pub) => {
    if (d.state !== "fail" && !(await ask({ message: i18next.t("この公開を止めます。公開中の URL は使えなくなります。続けますか?"), ok: i18next.t("止める"), danger: true }))) return;
    onStop(d.id);
  };
  // 公開中の URL: dela list の結果に、このアプリで公開した URL も足す(list が空でも、公開した URL は必ず出す)
  const live = new Set([...running, ...items.filter((d) => d.url && d.state !== "fail").map((d) => d.url!)]);
  // 公開の履歴(フォルダと名前ごとの最後のポート)。公開が増減したときに読み直す
  const scope = `${cKind}:${cHost ?? ""}`;
  const hist = useMemo(() => loadHist(), [open, items.length, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  // ▷: 押した行のフォルダ・名前を上の入力欄に入れる(公開はしない)。履歴にポートがあれば、それも入れる
  const again = (p: Proj, nm: string, port?: string) => {
    setSel(p.dir); setTemp(false); setFresh(false); setName(nm === "app" ? "" : nm);
    if (port) setPort(port);
    portRef.current?.focus();
  };
  const histPort = (p: Proj, nm: string) => hist[histKey(scope, p.dir, nm)]?.port;
  // 選んだフォルダで使われている名前(dela info の URL と、公開の履歴から)。"" は名前なし(app-)
  const known = useMemo(() => {
    if (cur === TEMP) return [] as string[];
    const set = new Set<string>([""]); // 名前なし(app)は、いつも選べる
    for (const u of infos[keyOf(cur)]?.urls ?? []) set.add(nameOfUrl(u));
    for (const k of Object.keys(hist)) { const [sc, d, n] = k.split("\u0000"); if (sc === scope && d === cur) set.add(n === "app" ? "" : n ?? ""); }
    if (!fresh && name) set.add(name);
    return [...set].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur, infos, hist, scope, fresh, name]);
  const pickName = (n: string) => { setFresh(false); setName(n); const hp = hist[histKey(scope, cur, n)]?.port; if (hp) setPort(hp); };
  const rescanAll = () => { asked.current.clear(); setRescan((n) => n + 1); };

  if (!open && !mounted) return null;
  const nameOk = !fresh || (validName(name) && name !== "app"); // 新しい名前は、空や app のままでは公開できない
  const ok = validPort(port) && (cur === TEMP || nameOk);
  const go = () => {
    if (!ok) return;
    const temp = cur === TEMP;
    onPublish(port.trim(), { dir: temp ? rootPath : conn ? cur : undefined, rel: temp ? "" : proj?.rel ?? relOf(cur), temp, name: !temp && name && name !== "app" ? name : undefined });
  };
  return (
    <aside className="ai-dock ports-dock" data-closing={!open} aria-label={i18next.t("ポート管理")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="ai-bar">
        <span className="ai-title"><Globe size={15} /><span className="truncate">{i18next.t("ポート管理")}</span></span>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      <div className="ports-top scroll">
        <h3 className="ports-sec">{i18next.t("新しく公開")}</h3>
        {conn && rootPath && (
          <div className="ports-proj">
            <div className="seg ports-mode" role="group" aria-label={i18next.t("公開のしかた")}>
              <button type="button" aria-pressed={!temp} onClick={() => setTemp(false)}>{i18next.t("フォルダを選ぶ")}</button>
              <button type="button" aria-pressed={temp} onClick={() => { setTemp(true); setBrowse(false); }}>{i18next.t("一時公開")}</button>
            </div>
            {!temp && (
              <>
                <button type="button" className="ports-folder" aria-expanded={browse} title={cur} onClick={() => setBrowse((b) => !b)}>
                  <Folder size={14} /><span className="truncate">{relOf(cur) || base(cur)}{cur.replace(/\/+$/, "") === root ? i18next.t("(開いているフォルダ)") : ""}</span><ChevronDown size={14} data-open={browse || undefined} />
                </button>
                {browse && <div className="ports-browse"><FolderBrowse conn={conn} root={rootPath} value={cur} onChange={(d) => { setSel(d); setName(""); setFresh(false); }} /></div>}
              </>
            )}
          </div>
        )}
        {cur !== TEMP && (
          <div className="ports-names" role="group" aria-label={i18next.t("公開する名前")}>
            <span className="ports-names-l">{i18next.t("公開する名前")}</span>
            {known.map((n) => (
              <button key={n || "\u0000"} type="button" className="ports-chip" aria-pressed={!fresh && name === n} onClick={() => pickName(n)}>{n || "app"}</button>
            ))}
            <button type="button" className="ports-chip ports-chip-new" aria-pressed={fresh} onClick={() => { setFresh(true); setName(""); }}><Plus size={12} /><span>{i18next.t("新しい名前")}</span></button>
          </div>
        )}
        {cur !== TEMP && fresh && (
          <div className="ports-new">
            <input className="ports-name" autoFocus aria-label={i18next.t("新しい名前")} title={i18next.t("同じフォルダで別のサービスを公開するときの名前(英小文字・数字・ハイフンで 20 文字まで)")} placeholder={i18next.t("英小文字・数字・ハイフン(20 文字まで)")} value={name} spellCheck={false} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); portRef.current?.focus(); } }} aria-invalid={(!!name && !nameOk) || undefined} />
          </div>
        )}
        {cur !== TEMP && fresh && name === "app" && <p className="ports-note">{i18next.t("「app」は、名前を付けない公開の名前です。ほかの名前にしてください")}</p>}
        <form className="ports-new" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <input ref={portRef} inputMode="numeric" aria-label={i18next.t("公開するポート")} placeholder="3000" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={!validPort(port) || undefined} />
          <button type="submit" className="ports-go" disabled={!ok}>{i18next.t("公開する")}</button>
        </form>
        {cur === TEMP ? (
          <p className="ports-note">{i18next.t("使い捨ての URL で公開します。終了すると URL は破棄され、.delaconfig は作られません。")}</p>
        ) : proj && !proj.config ? (
          <p className="ports-note">{i18next.t("まだ .delaconfig がありません。公開すると作られ(git リポジトリならそのルートに)、次からも同じ URL を使えます。")}</p>
        ) : null}
        <h3 className="ports-sec">{i18next.t("使用中")}{items.length > 0 && <span className="ports-count">{items.length}</span>}</h3>
        {items.length === 0 && <p className="ports-empty">{i18next.t("公開しているポートはありません")}</p>}
        {items.map((d) => (
          <div key={d.id} className="ports-row">
            <button className="ports-row-main" title={i18next.t("ログを見る")} aria-label={i18next.t("ポート {{port}} のログを見る", { port: d.port })} onClick={() => onLog(d.id)}>
            <span className="ports-port">:{d.port}</span>
            {(d.temp || d.rel || d.name) && <span className="ports-tag truncate" title={d.dir}>{d.temp ? i18next.t("一時") : [d.rel, d.name].filter(Boolean).join(" · ")}</span>}
            <span className="ports-url truncate" data-wait={!d.url || undefined} data-fail={d.state === "fail" || undefined} title={d.url ?? d.note}>
              {d.url ? shortUrl(d.url) : (d.state === "fail" ? d.note || i18next.t("公開できませんでした") : i18next.t("公開しています…"))}
            </span>
            </button>
            {d.url && <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(d.url!)}><Copy /></button>}
            {d.url && <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(d.url!)}><ExternalLink /></button>}
            <button className="icon-btn" aria-label={d.state === "fail" ? i18next.t("閉じる") : i18next.t("公開を止める")} title={d.state === "fail" ? i18next.t("閉じる") : i18next.t("公開を止める")} onClick={() => void stop(d)}>{d.state === "fail" ? <X /> : <Square />}</button>
          </div>
        ))}
      </div>
      {conn && rootPath && (
        <section className="ports-bottom" aria-label={i18next.t("プロジェクト")}>
          <h3 className="ports-sec ports-sec-bar">
            <span>{i18next.t("プロジェクト")}{withCfg.length > 0 && <span className="ports-count">{withCfg.length}</span>}</span>
            <button className="icon-btn" aria-label={i18next.t("フォルダを探し直す")} title={i18next.t("フォルダを探し直す")} data-busy={scanning || undefined} onClick={rescanAll}><RefreshCw /></button>
          </h3>
          <div className="ports-plist scroll">
            {!scanning && withCfg.length === 0 && <p className="ports-empty">{i18next.t("開いているフォルダ以下に .delaconfig はありません")}</p>}
            {withCfg.map((p) => {
              const inf = infos[keyOf(p.dir)];
              const on = cur === p.dir;
              const id = inf?.urls[0] ? urlId(inf.urls[0]) : undefined;
              // このプロジェクトの URL: dela info の URL(app-)と、同じ id で起動中の URL(--name を付けたもの)
              const urls = inf?.urls[0] ? [...new Set([...inf.urls, ...[...live].filter((u) => id && urlId(u) === id)])] : [];
              return (
                <div key={p.dir} className="ports-proj-row" data-on={on || undefined}>
                  <div className="ports-proj-head">
                    <button className="ports-proj-main" title={i18next.t("このフォルダで公開する")} onClick={() => { setSel(p.dir); setTemp(false); portRef.current?.focus(); }}>
                      <span className="truncate">{p.rel || base(p.dir)}</span>
                    </button>
                    {urls.length > 0 && <button className="icon-btn" aria-label={i18next.t("URL を作り直す")} title={i18next.t("URL を作り直す")} data-busy={inf?.busy || undefined} disabled={inf?.busy} onClick={() => void renew(p)}><Shuffle /></button>}
                  </div>
                  {urls.map((u) => (
                    <div key={u} className="ports-proj-url">
                      <span className="ports-live" data-on={live.has(u) || undefined} title={live.has(u) ? i18next.t("公開中") : undefined} />
                      <span className="ports-url truncate" title={u}>{shortUrl(u)}</span>
                      <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(u)}><Copy /></button>
                      <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(u)}><ExternalLink /></button>
                      {live.has(u) ? <span className="ports-gap" aria-hidden /> : <button className="icon-btn" aria-label={i18next.t("このフォルダ・名前を上の欄に入れる")} title={i18next.t("このフォルダ・名前を上の欄に入れる")} onClick={() => again(p, nameOfUrl(u), histPort(p, nameOfUrl(u)))}><Play /></button>}
                </div>
                  ))}
                  {urls.length > 0 && Object.entries(hist).flatMap(([k, h]) => {
                const [sc, dir, nm] = k.split("\u0000");
                if (sc !== scope || dir !== p.dir || !nm || urls.some((u) => nameOfUrl(u) === nm)) return [];
                const hu = urlWithName(urls[0], nm);
                return [<div key={k} className="ports-proj-url"><span className="ports-live" /><span className="ports-url truncate" title={hu ?? nm}>{shortUrl(hu ?? nm)}</span>{hu ? <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(hu)}><Copy /></button> : <span className="ports-gap" aria-hidden />}{hu ? <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(hu)}><ExternalLink /></button> : <span className="ports-gap" aria-hidden />}<button className="icon-btn" aria-label={i18next.t("このフォルダ・名前を上の欄に入れる")} title={i18next.t("このフォルダ・名前を上の欄に入れる")} onClick={() => again(p, nm, h.port)}><Play /></button></div>];
              })}
              {!urls.length && <div className="ports-proj-url"><span className="ports-url truncate" data-wait={inf?.ok !== false || undefined} data-fail={inf && !inf.busy && !inf.ok || undefined}>{!inf || inf.busy ? i18next.t("確認中…") : inf.note || i18next.t("URL を取得できませんでした")}</span></div>}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}
