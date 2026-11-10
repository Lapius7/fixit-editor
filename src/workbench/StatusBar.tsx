import { Check, SquareTerminal, Settings as Cog, WrapText, Server, HardDrive, FolderKanban, GitBranch } from "lucide-react";
import type { Cursor } from "@/editor/Editor";
import type { Tab } from "@/shared/types";
import { useSettings } from "@/features/settings/settings";
import type { PopKind } from "@/workbench/StatusPop";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

type Props = {
  tab: Tab | null; cur: Cursor | null; info: string; lang: string; dirtyCount: number; termCount: number;
  term: boolean; conn: string | null; connKind: "wsl" | "ssh" | "pc" | null; onConn: () => void; ws: string | null; wsColor?: string; onWs: () => void; onPop: (k: PopKind) => void; onTerm: () => void; onSettings: () => void;
  git?: { branch: string; changes: number } | null; onGit?: () => void;
};

// 下の情報バー(VS Code の状態バーに相当)。出す項目は設定で選べる
export default function StatusBar({ tab, cur, info, lang, dirtyCount, termCount, term, conn, connKind, onConn, ws, wsColor, onWs, onPop, onTerm, onSettings, git, onGit }: Props) {
  const s = useSettings();
  const text = tab?.view.kind === "text";
  return (
    <footer className="statusbar" role="status" aria-live="polite">
      {ws !== null && <button className="sb sb-ws" onClick={onWs} title={i18next.t("ワークスペースの切り替え・保存")}><FolderKanban />{ws ? <><i className="ws-dot" style={{ background: wsColor }} /><span className="sb-wsn">{ws}</span></> : i18next.t("ワークスペース")}</button>}
      {conn && <button className="sb sb-conn" data-kind={connKind} onClick={onConn} title={`${conn}\n${i18next.t("接続先の切り替え・切断")}`}>{connKind === "ssh" ? <Server /> : <HardDrive />}{(() => { const i = conn.indexOf(" · "); return i < 0 ? conn : <><span className="sb-host">{conn.slice(0, i)} ·</span><span className="sb-path"><bdi>{conn.slice(i + 3)}</bdi></span></>; })()}</button>}
      {git && <button className="sb sb-git" onClick={onGit} title={i18next.t("Git のブランチ(クリックで更新)")}><GitBranch />{git.branch}{git.changes > 0 && <b className="sb-n">{git.changes}</b>}</button>}
      {s.sbTerm && <button className="sb" data-on={term} onClick={onTerm} title={i18next.t("ターミナル")}><SquareTerminal /><Trans i18nKey="ターミナル" />{termCount > 0 && <b className="sb-n">{termCount}</b>}</button>}
      {s.sbSaved && <span className="sb" title={i18next.t("未保存のファイル")} data-on={dirtyCount > 0}>{dirtyCount > 0 ? <><span className="sb-dot" />{dirtyCount} <Trans i18nKey="件未保存" /></> : <><Check /><Trans i18nKey="保存済み" /></>}</span>}
      <span className="sb-sp" />
      {tab && !text && <span className="sb">{info}</span>}
      {text && cur && (
        <>
          {s.sbPos && <button className="sb" data-pop="goto" onClick={() => onPop("goto")} title={i18next.t("行へ移動(Ctrl+G)")}>{cur.l} <Trans i18nKey="行" /> {cur.c} <Trans i18nKey="列" />{cur.sel > 0 ? i18next.t("({{sel}} 文字選択)", { sel: cur.sel }) : ""}</button>}
          {s.sbLines && <span className="sb sb-hide">{cur.lines} <Trans i18nKey="行" /></span>}
          {s.sbIndent && <button className="sb sb-hide" data-pop="indent" onClick={() => onPop("indent")} title={i18next.t("インデントの設定")}>{s.insertSpaces ? i18next.t("スペース") : i18next.t("タブ")}: {s.tabSize}</button>}
          {s.sbEnc && <button className="sb sb-hide" data-pop="enc" onClick={() => onPop("enc")} title={i18next.t("文字コード")}>UTF-8</button>}
          {s.sbEnc && tab && <button className="sb sb-hide" data-pop="eol" onClick={() => onPop("eol")} title={i18next.t("改行コード")}>{tab.eol === "crlf" ? "CRLF" : "LF"}</button>}
          {s.sbWrap && <button className="sb sb-hide" data-on={s.wrap} data-pop="wrap" onClick={() => onPop("wrap")} title={i18next.t("折り返しと表示の設定")}><WrapText /><Trans i18nKey="折り返し" /></button>}
          {s.sbLang && <button className="sb" data-pop="lang" onClick={() => onPop("lang")} title={i18next.t("言語")}>{lang}</button>}
        </>
      )}
      {s.sbZoom && <button className="sb sb-hide" data-pop="zoom" onClick={() => onPop("zoom")} title={i18next.t("文字の大きさ(Ctrl+= / Ctrl+-)")}>{s.fontSize}px</button>}
      {s.sbSettings && <button className="sb" onClick={onSettings} title={i18next.t("設定")}><Cog /><Trans i18nKey="設定" /></button>}
    </footer>
  );
}
