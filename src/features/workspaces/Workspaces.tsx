import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FolderKanban, HardDrive, Monitor, Pencil, Pin, Plus, Server, Trash2, Upload, UserRound } from "lucide-react";
import { ms } from "@/features/settings/settings";
import { ask } from "@/shared/ask";
import {
  createProfile, exportProfile, getProfiles, importProfile, preview, removeProfile, renameProfile, switchProfile, useProfiles,
} from "@/features/settings/profiles";
import i18next from 'i18next'
import { Trans } from 'react-i18next'
import {
  ago, canUse, exportWorkspaces, getHandle, importWorkspaces, patchWs, findWs, removeWs, rootLabel, useWorkspaces, wsLabel, type Workspace,
} from "@/features/workspaces/workspaces";

type Props = {
  initial: "ws" | "profile"; curId: string | null; saveName: string; max: number;
  onOpen: (w: Workspace) => Promise<boolean | void>; onSaveNew: (name: string) => Promise<string | void>; onClose: () => void; flash: (m: string) => void; out?: boolean;
};

function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const findName = (id: string) => findWs(id)?.name ?? "";
const KindIcon = ({ k }: { k: Workspace["root"]["kind"] }) => (k === "ssh" ? <Server /> : k === "wsl" ? <HardDrive /> : k === "local" ? <Monitor /> : <FolderKanban />);

// ワークスペースとプロファイルを切り替える・整理する画面
export default function Workspaces({ initial, curId, saveName, max, onOpen, onSaveNew, onClose, flash, out }: Props) {
  const [tab, setTab] = useState(initial);
  const { list, current } = useWorkspaces();
  const pf = useProfiles();
  const [q, setQ] = useState("");
  const [ren, setRen] = useState<{ id: string; v: string; out?: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [closing, setClosing] = useState(false);
  const [perm, setPerm] = useState<Record<string, boolean>>({});
  const file = useRef<HTMLInputElement>(null);

  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };

  useEffect(() => {
    let live = true;
    (async () => {
      const m: Record<string, boolean> = {};
      for (const w of list) if (w.root.kind === "local") { const h = await getHandle(w.id); m[w.id] = !!h && (await canUse(h, false)); }
      if (live) setPerm(m);
    })();
    return () => { live = false; };
  }, [list.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return [...list]
      .filter((w) => !s || `${w.name} ${rootLabel(w.root)}`.toLowerCase().includes(s))
      .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updated - a.updated);
  }, [list, q]);

  const go = async (w: Workspace) => {
    setErr(""); setBusy(w.id);
    try { if ((await onOpen(w)) !== false) close(); } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  const commitRen = () => {
    if (!ren || ren.out) return;
    if (tab === "ws") patchWs(ren.id, { name: ren.v }); else renameProfile(ren.id, ren.v);
    setRen({ ...ren, out: true });
    setTimeout(() => setRen((r) => (r?.out ? null : r)), ms(120));
  };
  const pick = (f: (t: string) => void) => {
    const i = file.current!;
    i.onchange = async () => {
      const t = await i.files?.[0]?.text(); i.value = "";
      if (t) try { f(t); } catch (e) { setErr((e as Error).message); }
    };
    i.click();
  };
  const nameCell = (id: string, label: string) =>
    ren?.id === id ? (
      <input className="field ws-ren inline-edit" data-closing={!!ren.out} autoFocus onFocus={(e) => e.currentTarget.select()} value={ren.v} spellCheck={false} onChange={(e) => setRen({ id, v: e.target.value })} onBlur={commitRen}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commitRen(); else if (e.key === "Escape") setRen({ ...ren, out: true }), setTimeout(() => setRen(null), ms(120)); }} />
    ) : (
      <b className="truncate label-in" onDoubleClick={() => setRen({ id, v: label })}>{label}</b>
    );

  const addWs = async () => {
    const id = await onSaveNew(saveName || i18next.t("ワークスペース"));
    if (id) setRen({ id, v: findName(id) });
  };
  const addPf = () => { const id = createProfile(i18next.t("プロファイル"), "current"); setRen({ id, v: getProfiles().list.find((p) => p.id === id)?.name ?? "" }); };
  const linkNext = (w: Workspace) => {
    const ids = ["", ...pf.list.map((p) => p.id)];
    patchWs(w.id, { profile: ids[(ids.indexOf(w.profile ?? "") + 1) % ids.length] || undefined });
  };
  const io = (up: () => void, down: () => void) => (
    <div className="ws-io">
      <button className="icon-btn" aria-label={i18next.t("書き出す")} title={i18next.t("ファイルに書き出す")} onClick={down}><Download /></button>
      <button className="icon-btn" aria-label={i18next.t("読み込む")} title={i18next.t("ファイルから読み込む")} onClick={up}><Upload /></button>
    </div>
  );

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg ws" role="dialog" aria-label={i18next.t("ワークスペースとプロファイル")} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape" && !ren) close(); }}>
        <div className="seg ws-seg" role="group" aria-label={i18next.t("種類")}>
          <button aria-pressed={tab === "ws"} onClick={() => { setTab("ws"); setErr(""); }}><FolderKanban /><Trans i18nKey="ワークスペース" /></button>
          <button aria-pressed={tab === "profile"} onClick={() => { setTab("profile"); setErr(""); }}><UserRound /><Trans i18nKey="プロファイル" /></button>
        </div>

        <div key={tab} className="set-fade">
        {tab === "ws" ? (
          <>
            {list.length > 5 && <input className="field ws-q" placeholder={i18next.t("絞り込む")} value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />}
            <div className="ws-list scroll">
              {rows.length === 0 && <p className="ws-empty">{list.length ? i18next.t("当てはまるものがありません") : i18next.t("まだありません")}</p>}
              {rows.map((w) => (
                <div key={w.id} className="ws-row" data-cur={w.id === (curId ?? current)}>
                  <button className="ws-main" disabled={!!busy} onClick={() => go(w)} title={rootLabel(w.root)}>
                    <i className="ws-dot" style={{ background: w.color }} />
                    <span className="ws-txt">
                      {nameCell(w.id, w.name)}
                      <span className="ws-meta"><KindIcon k={w.root.kind} /><span className="truncate">{wsLabel(w)}</span></span>
                    </span>
                    <span className="ws-sub">
                      {w.root.kind === "local" && perm[w.id] === false && <em className="ws-badge" data-tone="warn"><Trans i18nKey="要許可" /></em>}
                      {w.profile && pf.list.some((p) => p.id === w.profile) && <em className="ws-badge"><UserRound />{pf.list.find((p) => p.id === w.profile)!.name}</em>}
                      {w.id === (curId ?? current) ? <em className="ws-badge" data-tone="on"><Check /><Trans i18nKey="使用中" /></em> : <span>{busy === w.id ? i18next.t("開いています…") : ago(w.updated)}</span>}
                    </span>
                  </button>
                  <div className="ws-acts">
                    <button className="icon-btn" data-on={!!w.profile} aria-label={i18next.t("プロファイルを結びつける")} title={i18next.t("開くとき切り替えるプロファイル(押すたびに変わります)")} onClick={() => linkNext(w)}><UserRound /></button>
                    <button className="icon-btn" data-on={!!w.pinned} aria-label={i18next.t("上に固定")} title={w.pinned ? i18next.t("固定を外す") : i18next.t("上に固定")} onClick={() => patchWs(w.id, { pinned: !w.pinned })}><Pin /></button>
                    <button className="icon-btn" aria-label={i18next.t("名前を変える")} title={i18next.t("名前を変える")} onClick={() => setRen({ id: w.id, v: w.name })}><Pencil /></button>
                    <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除(フォルダのファイルは消えません)")} onClick={async () => { if (await ask({ message: i18next.t("ワークスペース「{{name}}」を削除しますか?\n(フォルダのファイルは消えません)", { name: w.name }), ok: i18next.t("削除"), danger: true })) removeWs(w.id); }}><Trash2 /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="ws-foot">
              <button className="btn" data-primary="true" onClick={addWs}><Plus /><Trans i18nKey="いまの状態を保存" /></button>
              {io(() => pick((t) => { const n = importWorkspaces(t, max); flash(i18next.t("{{n}} 件を読み込みました", { n })); }), () => { download("fixit-workspaces.json", exportWorkspaces()); flash(i18next.t("書き出しました(PC のフォルダは含みません)")); })}
            </div>
          </>
        ) : (
          <>
            <div className="ws-list scroll">
              {pf.list.map((p) => {
                const v = preview(p), on = p.id === pf.active;
                return (
                  <div key={p.id} className="ws-row" data-cur={on}>
                    <button className="ws-main" onClick={() => { switchProfile(p.id); flash(i18next.t("プロファイル「{{name}}」に切り替えました", { name: p.name })); }}>
                      <i className="ws-dot" style={{ background: v.accent }} />
                      <span className="ws-txt">
                        {nameCell(p.id, p.name)}
                        <span className="ws-meta"><span>{v.mode}</span></span>
                      </span>
                      <span className="ws-sub">{on ? <em className="ws-badge" data-tone="on"><Check /><Trans i18nKey="使用中" /></em> : <span>{ago(p.updated)}</span>}</span>
                    </button>
                    <div className="ws-acts">
                      <button className="icon-btn" aria-label={i18next.t("名前を変える")} title={i18next.t("名前を変える")} onClick={() => setRen({ id: p.id, v: p.name })}><Pencil /></button>
                      <button className="icon-btn" aria-label={i18next.t("削除")} title={pf.list.length <= 1 ? i18next.t("最後のひとつは消せません") : i18next.t("削除")} disabled={pf.list.length <= 1}
                        onClick={async () => { if (await ask({ message: i18next.t("プロファイル「{{name}}」を削除しますか?", { name: p.name }), ok: i18next.t("削除"), danger: true })) removeProfile(p.id); }}><Trash2 /></button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="ws-foot">
              <button className="btn" data-primary="true" title={i18next.t("いまの設定を写して作ります")} onClick={addPf}><Plus /><Trans i18nKey="新しいプロファイル" /></button>
              {io(() => pick((t) => { importProfile(t); flash(i18next.t("プロファイルを読み込みました")); }), () => { const a = pf.list.find((p) => p.id === pf.active); if (a) download(`${a.name}.fixit-profile.json`, exportProfile(a.id)); })}
            </div>
          </>
        )}
        </div>
        {err && <p className="cn-err" role="alert">{err}</p>}
        <input ref={file} type="file" accept="application/json,.json" hidden />
      </div>
    </div>
  );
}
