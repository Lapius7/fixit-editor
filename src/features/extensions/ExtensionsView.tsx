import { useEffect, useState } from "react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ExternalLink, Search as SearchIcon, X } from "lucide-react";
import { openExternal } from "@/features/account/auth";
import { siteLang } from "@/i18n";
import { SITE_URL } from "@/shared/config";
import { ms } from "@/features/settings/settings";
import { shieldExtCss } from "./host/css";
import { notify } from "@/shared/notify";
import { checkRevocations, extAvailable, fetchBundle, fetchList, hasNewer, install, isLocal, pickFolder, readLocal, setEnabled, setTheme, uninstall, useInstalled, activeTheme, type Installed, type Listed, type Status } from "./registry";
import { cmpVer, permLines, type Manifest, type PermKey, type Perms } from "./spec";

const statusText = (s: Status) => ({ verified: i18next.t("認証済み"), unverified: i18next.t("未認証"), revoked: i18next.t("認証が取り消されました"), blocked: i18next.t("配布が停止されました"), tampered: i18next.t("内容が署名と合いません"), "needs-consent": i18next.t("権限の許可が必要です") })[s];
const permText = (k: PermKey | "script", v: string) => ({ editorRead: i18next.t("開いているファイルの内容を読む"), editorWrite: i18next.t("開いているファイルの内容を書き換える"), script: i18next.t("隔離した場所でスクリプトを動かす(宣言した権限の範囲だけ)"), ui: i18next.t("見た目を変える(背景画像・スタイル)"), fsRead: i18next.t("開いているフォルダのファイルを読む"), fsWrite: i18next.t("開いているフォルダのファイルを書く"), network: i18next.t("ネットワークに接続する: {{v}}", { v }), exec: i18next.t("外部コマンドを実行する: {{v}}", { v }) })[k];
const kindsText = (m: Manifest) => [m.themes.length ? i18next.t("テーマ {{n}}", { n: m.themes.length }) : "", m.snippets.length ? i18next.t("スニペット {{n}}", { n: m.snippets.length }) : "", m.commands.length ? i18next.t("コマンド {{n}}", { n: m.commands.length }) : "", m.main ? i18next.t("スクリプト") : ""].filter(Boolean).join(" · ");

export const rowsOf = (m: Manifest) => [...(m.main ? [{ key: "script" as const, value: "" }] : []), ...permLines(m.perms)];
function Perms({ m }: { m: Manifest }) {
  const rows = rowsOf(m);
  if (!rows.length) return <p className="ex-none">{i18next.t("特別な権限は要りません")}</p>;
  return <ul className="ex-perms">{rows.map((r) => <li key={r.key}>{permText(r.key, r.value)}</li>)}</ul>;
}

// 入れる前の確認。認証済みでも権限は 1 つずつ許可してもらう。未認証は、警告に同意してもらう
type Pick = { id: string; version: string; sig: string | null; manifest: Manifest; raw: string };
function Confirm({ id, version, sig, manifest, raw, onClose }: Pick & { onClose: () => void }) {
  const rows = rowsOf(manifest);
  const [ok, setOk] = useState<Record<string, boolean>>({});
  const [risk, setRisk] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = rows.every((r) => ok[r.key]) && (!!sig || risk);
  const go = async () => { setBusy(true); await install(id, raw, sig, manifest.perms); setBusy(false); notify(i18next.t("「{{n}}」を入れました", { n: manifest.name }), "success"); onClose(); };
  return (
    <div className="ex-confirm" role="group" aria-label={i18next.t("インストールの確認")}>
      <p className="ex-title"><b>{manifest.name}</b> <span className="tnum">v{version}</span> <span className="ex-badge" data-s={sig ? "verified" : "unverified"}>{sig ? i18next.t("認証済み") : i18next.t("未認証")}</span></p>
      <p className="ex-desc">{manifest.description || i18next.t("説明はありません")}</p>
      <h3>{i18next.t("この拡張機能が使う権限")}</h3>
      <Perms m={manifest} />
      {!sig && <p className="ex-warn" role="alert">{isLocal(id) ? i18next.t("このフォルダの拡張機能は、審査も署名もありません。内容は検査していますが、安全とは確かめられていません。自分で作った、または信頼できる作者のものだけ入れてください。") : i18next.t("この版は運営の審査を受けていません。内容は検査していますが、安全とは確かめられていません。信頼できる作者のものだけ入れてください。")}</p>}
      {rows.map((r) => <label key={r.key} className="ex-check"><input type="checkbox" checked={!!ok[r.key]} onChange={(e) => setOk({ ...ok, [r.key]: e.target.checked })} />{i18next.t("許可する: {{p}}", { p: permText(r.key, r.value) })}</label>)}
      {!sig && <label className="ex-check"><input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} />{i18next.t("未認証であることを理解したうえで入れる")}</label>}
      <div className="dlg-foot"><button className="btn" onClick={onClose} disabled={busy}>{i18next.t("やめる")}</button><button className="btn" data-primary="true" onClick={go} disabled={!ready || busy}>{i18next.t("入れる")}</button></div>
    </div>
  );
}

const hit = (q: string, ...f: string[]) => { const t = q.trim().toLowerCase(); return !t || f.join("\n").toLowerCase().includes(t); };

function Mine({ x }: { x: Installed }) {
  const sel = activeTheme();
  const toggle = x.status === "verified" || x.status === "unverified";
  return (
    <li className="ex-item">
      <div className="ex-top">
        <div className="ex-row">
          <span className="ex-name">{x.manifest.name}</span><span className="tnum ex-id">v{x.version}</span>
          <span className="ex-badge" data-s={x.status}>{statusText(x.status)}</span>{isLocal(x.id) && <span className="ex-badge">{i18next.t("自作")}</span>}
        </div>
        {toggle && <button className="switch" role="switch" aria-checked={x.enabled} aria-label={x.enabled ? i18next.t("無効にする") : i18next.t("有効にする")} onClick={() => setEnabled(x.id, !x.enabled)} />}
      </div>
      <p className="ex-desc">{[x.manifest.description, kindsText(x.manifest)].filter(Boolean).join(" · ")}</p>
      <p className="ex-id">{x.id}</p>
      {x.status === "needs-consent" && <p className="ex-warn">{i18next.t("権限が増えているため止めています。入れ直して、権限を許可してください。")}</p>}
      <div className="ex-acts">
        {x.manifest.themes.length > 0 && x.active && x.manifest.themes.map((th) => { const key = `${x.id}/${th.id}`; return <button key={key} className="btn" data-on={sel === key} onClick={() => setTheme(sel === key ? null : key)}>{th.name}</button>; })}
        <button className="btn ex-del" onClick={() => uninstall(x.id)}>{i18next.t("削除")}</button>
      </div>
    </li>
  );
}

function Browse({ installed, q, onlyV, onPick }: { installed: Installed[]; q: string; onlyV: boolean; onPick: (p: Pick) => void }) {
  const [list, setList] = useState<Listed[] | null>(null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { fetchList().then(setList).catch(() => setErr(true)); }, []);
  const choose = async (id: string, version: string, sig: string | null) => {
    setBusy(`${id}@${version}`);
    const r = await fetchBundle(id, version, sig).catch(() => "bad" as const);
    setBusy("");
    if (r === "bad") return notify(i18next.t("取得できませんでした。内容が正しくないか、ネットワークに接続できません"), "error");
    onPick({ id, version, sig, ...r });
  };
  if (err) return <p className="ex-warn">{i18next.t("一覧を取得できませんでした。ネットワークを確かめてください")}</p>;
  if (!list) return <p className="ex-none">{i18next.t("読み込み中…")}</p>;
  type V = Listed["versions"][number];
  const rows = list.map((g) => {
    const vs = g.versions.filter((v) => v.status !== "revoked" && (!onlyV || v.status === "verified")).sort((a, b) => cmpVer(b.version, a.version));
    const main: V | undefined = vs.find((v) => v.status === "verified") ?? vs[0];
    return { g, vs, main };
  }).filter((r): r is { g: Listed; vs: V[]; main: V } => !!r.main && hit(q, r.main.name, r.g.id, r.main.description));
  if (!rows.length) return <p className="ex-none">{q.trim() ? i18next.t("「{{q}}」に合う拡張機能はありません", { q: q.trim() }) : i18next.t("公開されている拡張機能はまだありません")}</p>;
  const pickBtn = (id: string, v: V, cur?: Installed, label?: string) => (
    <button className="btn" data-primary={(!cur && v.status === "verified") || undefined} disabled={!!busy || cur?.version === v.version} onClick={() => void choose(id, v.version, v.status === "verified" ? v.sig : null)}>{cur?.version === v.version ? i18next.t("入れ済み") : label ?? i18next.t("入れる")}</button>
  );
  return (
    <ul className="ex-list">
      {rows.map(({ g, vs, main }) => {
        const cur = installed.find((x) => x.id === g.id);
        const upd = !!cur && hasNewer(g, cur.version) && cmpVer(main.version, cur.version) > 0;
        const rest = vs.filter((v) => v !== main);
        return (
          <li key={g.id} className="ex-item">
            <div className="ex-top">
              <div className="ex-row"><span className="ex-name">{main.name}</span><span className="tnum ex-id">v{main.version}</span><span className="ex-badge" data-s={main.status === "verified" ? "verified" : "unverified"}>{main.status === "verified" ? i18next.t("認証済み") : i18next.t("未認証")}</span>{upd && <span className="ex-badge" data-s="new">{i18next.t("新しい版あり")}</span>}</div>
              {pickBtn(g.id, main, cur, upd ? i18next.t("更新する") : undefined)}
            </div>
            <p className="ex-desc">{main.description || i18next.t("説明はありません")}</p>
            <p className="ex-id">{g.id} · {permLines(main.perms).map((r) => permText(r.key, r.value)).join(" / ") || i18next.t("特別な権限なし")}</p>
            {rest.length > 0 && <details className="ex-more"><summary>{i18next.t("ほかの版 ({{n}})", { n: rest.length })}</summary>
              <ul className="ex-vers">
                {rest.map((v) => <li key={v.version}><span className="tnum">v{v.version}</span><span className="ex-badge" data-s={v.status === "verified" ? "verified" : "unverified"}>{v.status === "verified" ? i18next.t("認証済み") : i18next.t("未認証")}</span><span className="ex-perm-sum">{permLines(v.perms).map((r) => permText(r.key, r.value)).join(" / ") || i18next.t("特別な権限なし")}</span>{pickBtn(g.id, v, cur)}</li>)}
              </ul></details>}
          </li>
        );
      })}
    </ul>
  );
}

export function ExtensionsView({ out, onClose }: { out?: boolean; onClose: () => void }) {
  const installed = useInstalled();
  useEffect(() => { shieldExtCss(true); return () => shieldExtCss(false); }, []);
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<"mine" | "browse">("mine");
  const [pick, setPick] = useState<Pick | null>(null);
  const [q, setQ] = useState("");
  const [onlyV, setOnlyV] = useState(false);
  const fromFolder = async () => {
    const dir = await pickFolder().catch(() => null);
    if (!dir) return;
    const r = await readLocal(dir);
    if (r === "missing") return notify(i18next.t("選んだフォルダの直下に fixit-extension.json がありません"), "error");
    if (r === "id") return notify(i18next.t("自作の拡張機能の id は「local.名前」にしてください"), "error");
    if (r === "bad") return notify(i18next.t("fixit-extension.json の内容が正しくありません。書き方は fixit-editor.lapius7.com の「拡張機能」にあります"), "error");
    setPick(r);
  };
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => { void checkRevocations(true); }, []);
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") { if (q && !pick) setQ(""); else close(); } }; addEventListener("keydown", on); return () => removeEventListener("keydown", on); });
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg ex" role="dialog" aria-label={i18next.t("拡張機能")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="st-head"><h2><Trans i18nKey="拡張機能" /></h2><button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button></header>
        {!extAvailable ? <p className="ex-none">{i18next.t("拡張機能はデスクトップ版で使えます")}</p> : (
          <>
            {pick ? <div className="ex-body"><Confirm {...pick} onClose={() => setPick(null)} /></div> : <>
            <div className="ex-tabs">
              <div className="seg" role="tablist">
                <button role="tab" aria-selected={tab === "mine"} aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>{i18next.t("入れた拡張機能")}{installed.length ? ` ${installed.length}` : ""}</button>
                <button role="tab" aria-selected={tab === "browse"} aria-pressed={tab === "browse"} onClick={() => setTab("browse")}>{i18next.t("探す")}</button>
              </div>
              <button className="chipbtn" onClick={() => void openExternal(`${SITE_URL}/${siteLang()}/extensions`)}>{i18next.t("Web の拡張機能ページ")}<ExternalLink size={13} /></button>
            </div>
            <div className="ex-bar">
              <div className="sp-box">
                <SearchIcon size={14} />
                <input autoFocus placeholder={i18next.t("拡張機能を探す")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={i18next.t("拡張機能を探す")} />
                {q && <button className="icon-btn" aria-label={i18next.t("消す")} onClick={() => setQ("")}><X /></button>}
              </div>
              {tab === "browse" && <button className="chipbtn" aria-pressed={onlyV} onClick={() => setOnlyV(!onlyV)}>{i18next.t("認証済みのみ")}</button>}
              {tab === "mine" && <button className="chipbtn" onClick={() => void fromFolder()}>{i18next.t("フォルダから入れる(自作)")}</button>}
            </div>
            <div className="ex-body">
              {tab === "mine" ? (() => {
                const rows = installed.filter((x) => hit(q, x.manifest.name, x.id, x.manifest.description));
                if (!installed.length) return <p className="ex-none">{i18next.t("入れた拡張機能はありません")}</p>;
                if (!rows.length) return <p className="ex-none">{i18next.t("「{{q}}」に合う拡張機能はありません", { q: q.trim() })}</p>;
                return <ul className="ex-list">{rows.map((x) => <Mine key={x.id} x={x} />)}</ul>;
              })() : <Browse installed={installed} q={q} onlyV={onlyV} onPick={setPick} />}
            </div>
            <p className="ex-foot">{i18next.t("公開は fixit-editor.lapius7.com の「拡張機能」から。認証済みは、運営が審査した版です。")}</p>
            </>}
          </>
        )}
      </div>
    </div>
  );
}
