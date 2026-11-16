import { useEffect, useState } from "react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ms } from "@/features/settings/settings";
import { notify } from "@/shared/notify";
import { checkRevocations, extAvailable, fetchBundle, fetchList, hasNewer, install, isLocal, pickFolder, readLocal, setEnabled, setTheme, uninstall, useInstalled, activeTheme, type Installed, type Listed, type Status } from "./registry";
import { permLines, type Manifest, type Perms } from "./spec";

const statusText = (s: Status) => ({ verified: i18next.t("認証済み"), unverified: i18next.t("未認証"), revoked: i18next.t("認証が取り消されました"), blocked: i18next.t("配布が停止されました"), tampered: i18next.t("内容が署名と合いません"), "needs-consent": i18next.t("権限の許可が必要です") })[s];
const permText = (k: "fsRead" | "fsWrite" | "network" | "exec", v: string) => ({ fsRead: i18next.t("ファイルを読む"), fsWrite: i18next.t("ファイルを書く"), network: i18next.t("ネットワークに接続する: {{v}}", { v }), exec: i18next.t("外部コマンドを実行する: {{v}}", { v }) })[k];
const kindsText = (m: Manifest) => [m.themes.length ? i18next.t("テーマ {{n}}", { n: m.themes.length }) : "", m.snippets.length ? i18next.t("スニペット {{n}}", { n: m.snippets.length }) : "", m.commands.length ? i18next.t("コマンド {{n}}", { n: m.commands.length }) : ""].filter(Boolean).join(" · ");

function Perms({ p }: { p: Perms }) {
  const rows = permLines(p);
  if (!rows.length) return <p className="ex-none">{i18next.t("特別な権限は要りません")}</p>;
  return <ul className="ex-perms">{rows.map((r) => <li key={r.key}>{permText(r.key, r.value)}</li>)}</ul>;
}

// 入れる前の確認。認証済みでも権限は 1 つずつ許可してもらう。未認証は、警告に同意してもらう
type Pick = { id: string; version: string; sig: string | null; manifest: Manifest; raw: string };
function Confirm({ id, version, sig, manifest, raw, onClose }: Pick & { onClose: () => void }) {
  const rows = permLines(manifest.perms);
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
      <Perms p={manifest.perms} />
      {!sig && <p className="ex-warn" role="alert">{isLocal(id) ? i18next.t("このフォルダの拡張機能は、審査も署名もありません。内容は検査していますが、安全とは確かめられていません。自分で作った、または信頼できる作者のものだけ入れてください。") : i18next.t("この版は運営の審査を受けていません。内容は検査していますが、安全とは確かめられていません。信頼できる作者のものだけ入れてください。")}</p>}
      {rows.map((r) => <label key={r.key} className="ex-check"><input type="checkbox" checked={!!ok[r.key]} onChange={(e) => setOk({ ...ok, [r.key]: e.target.checked })} />{i18next.t("許可する: {{p}}", { p: permText(r.key, r.value) })}</label>)}
      {!sig && <label className="ex-check"><input type="checkbox" checked={risk} onChange={(e) => setRisk(e.target.checked)} />{i18next.t("未認証であることを理解したうえで入れる")}</label>}
      <div className="dlg-foot"><button className="btn" onClick={onClose} disabled={busy}>{i18next.t("やめる")}</button><button className="btn" data-primary="true" onClick={go} disabled={!ready || busy}>{i18next.t("入れる")}</button></div>
    </div>
  );
}

function Mine({ x }: { x: Installed }) {
  const sel = activeTheme();
  return (
    <li className="ex-item">
      <div className="ex-row">
        <span className="ex-name">{x.manifest.name}</span><span className="ex-id">{x.id}</span><span className="tnum">v{x.version}</span>
        <span className="ex-badge" data-s={x.status}>{statusText(x.status)}</span>{isLocal(x.id) && <span className="ex-badge">{i18next.t("自作")}</span>}
      </div>
      <p className="ex-desc">{[x.manifest.description, kindsText(x.manifest)].filter(Boolean).join(" · ")}</p>
      {x.status === "needs-consent" && <p className="ex-warn">{i18next.t("権限が増えているため止めています。入れ直して、権限を許可してください。")}</p>}
      {x.manifest.themes.length > 0 && x.active && <div className="ex-themes">{x.manifest.themes.map((th) => { const key = `${x.id}/${th.id}`; return <button key={key} className="btn" data-on={sel === key} onClick={() => setTheme(sel === key ? null : key)}>{th.name}</button>; })}</div>}
      <div className="ex-acts">
        {(x.status === "verified" || x.status === "unverified") && <button className="btn" onClick={() => setEnabled(x.id, !x.enabled)}>{x.enabled ? i18next.t("無効にする") : i18next.t("有効にする")}</button>}
        <button className="btn" onClick={() => uninstall(x.id)}>{i18next.t("削除")}</button>
      </div>
    </li>
  );
}

function Browse({ installed, onPick }: { installed: Installed[]; onPick: (p: Pick) => void }) {
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
  if (!list.length) return <p className="ex-none">{i18next.t("公開されている拡張機能はまだありません")}</p>;
  return (
    <ul className="ex-list">
      {list.map((g) => {
        const cur = installed.find((x) => x.id === g.id);
        const vs = g.versions.filter((v) => v.status !== "revoked");
        if (!vs.length) return null;
        return (
          <li key={g.id} className="ex-item">
            <div className="ex-row"><span className="ex-name">{vs[0].name}</span><span className="ex-id">{g.id}</span>{cur && <span className="tnum">{i18next.t("入れた版 v{{v}}", { v: cur.version })}</span>}{cur && hasNewer(g, cur.version) && <span className="ex-badge" data-s="new">{i18next.t("新しい版あり")}</span>}</div>
            <p className="ex-desc">{vs[0].description || i18next.t("説明はありません")}</p>
            <ul className="ex-vers">
              {vs.map((v) => <li key={v.version}><span className="tnum">v{v.version}</span><span className="ex-badge" data-s={v.status === "verified" ? "verified" : "unverified"}>{v.status === "verified" ? i18next.t("認証済み") : i18next.t("未認証")}</span><span className="ex-perm-sum">{permLines(v.perms).map((r) => permText(r.key, r.value)).join(" / ") || i18next.t("特別な権限なし")}</span>
                <button className="btn" disabled={!!busy || cur?.version === v.version} onClick={() => void choose(g.id, v.version, v.status === "verified" ? v.sig : null)}>{cur?.version === v.version ? i18next.t("入れ済み") : i18next.t("入れる")}</button></li>)}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function ExtensionsView({ out, onClose }: { out?: boolean; onClose: () => void }) {
  const installed = useInstalled();
  const [closing, setClosing] = useState(false);
  const [tab, setTab] = useState<"mine" | "browse">("mine");
  const [pick, setPick] = useState<Pick | null>(null);
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
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); }; addEventListener("keydown", on); return () => removeEventListener("keydown", on); });
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg ex" role="dialog" aria-label={i18next.t("拡張機能")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="st-head"><h2><Trans i18nKey="拡張機能" /></h2><button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button></header>
        {!extAvailable ? <p className="ex-none">{i18next.t("拡張機能はデスクトップ版で使えます")}</p> : (
          <>
            {pick ? <div className="ex-body"><Confirm {...pick} onClose={() => setPick(null)} /></div> : <>
            <div className="seg" role="tablist">
              <button role="tab" aria-selected={tab === "mine"} data-on={tab === "mine"} onClick={() => setTab("mine")}>{i18next.t("入れた拡張機能")}</button>
              <button role="tab" aria-selected={tab === "browse"} data-on={tab === "browse"} onClick={() => setTab("browse")}>{i18next.t("探す")}</button>
            </div>
            <div className="ex-body">
              {tab === "mine" ? (installed.length ? <ul className="ex-list">{installed.map((x) => <Mine key={x.id} x={x} />)}</ul> : <p className="ex-none">{i18next.t("入れた拡張機能はありません")}</p>) : <Browse installed={installed} onPick={setPick} />}
            </div>
            {tab === "mine" && <div className="ex-acts"><button className="btn" onClick={() => void fromFolder()}>{i18next.t("フォルダから入れる(自作)")}</button></div>}
            <p className="ex-foot">{i18next.t("公開は fixit-editor.lapius7.com の「拡張機能」から。認証済みは、運営が審査した版です。")}</p>
            </>}
          </>
        )}
      </div>
    </div>
  );
}
