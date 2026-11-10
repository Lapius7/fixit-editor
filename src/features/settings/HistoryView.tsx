// 設定の変更履歴の画面。新しい順に並べ、各履歴を元に戻せる
import { Undo2, Trash2 } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { DEFS } from "@/features/settings/settings";
import { KEYS } from "@/features/settings/keys";
import { canRevert, clearHistory, revert, useHistory, type Change, type Entry } from "@/features/settings/history";

const HEX = /^#[0-9a-f]{6}$/i;
const when = (t: number) => new Intl.DateTimeFormat(i18next.language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(t);

const labelOf = (id: string): string => {
  if (id === "mode") return i18next.t("テーマ");
  if (id === "accent") return i18next.t("アクセント色");
  if (id === "dots") return i18next.t("背景の色");
  if (id.startsWith("keys.")) { const k = KEYS.find((x) => x.id === id.slice(5)); return `${i18next.t("ショートカット")}: ${k ? i18next.t(k.label) : id.slice(5)}`; }
  const d = DEFS.find((x) => x.id === id);
  return d ? i18next.t(d.label) : id;
};

function Val({ id, v }: { id: string; v: unknown }) {
  if (v === null || v === "") return <span className="hv-none">{i18next.t("なし")}</span>;
  if (typeof v === "string" && HEX.test(v)) return <span className="hv-sw"><i style={{ background: v }} />{v}</span>;
  if (id === "dots") return <span className="hv-sw">{(v as { c: string }[]).map((d, i) => <i key={i} style={{ background: d.c }} />)}</span>;
  const d = DEFS.find((x) => x.id === id);
  if (typeof v === "boolean") return <>{v ? i18next.t("オン") : i18next.t("オフ")}</>;
  if (d?.kind === "enum") { const o = d.opts?.find(([k]) => k === v); return <>{o ? i18next.t(o[1]) : String(v)}</>; }
  if (id === "mode") return <>{i18next.t(v === "dark" ? "ダーク" : v === "light" ? "ライト" : "自動")}</>;
  return <>{String(v)}{d?.unit ?? ""}</>;
}

function Line({ id, c }: { id: string; c: Change }) {
  return <li><span className="hv-k">{labelOf(id)}</span><span className="hv-v"><Val id={id} v={c[0]} /> <b aria-hidden>→</b> <Val id={id} v={c[1]} /></span></li>;
}

function Item({ e, all }: { e: Entry; all: Entry[] }) {
  const ids = Object.keys(e.changes), shown = ids.slice(0, 6);
  const src = e.revertOf ? all.find((x) => x.id === e.revertOf) : null;
  return (
    <li className="hv-item">
      <div className="hv-head">
        <time>{when(e.t)}</time>
        <span className="hv-title">{e.revertOf ? i18next.t("元に戻した") + (src ? ` (${when(src.t)})` : "") : i18next.t("{{n}} 件の変更", { n: ids.length })}</span>
        <button className="btn" disabled={!canRevert(e)} onClick={() => revert(e)} title={i18next.t("この変更を元に戻す")}><Undo2 size={14} /><span>{i18next.t("元に戻す")}</span></button>
      </div>
      <ul className="hv-lines">
        {shown.map((id) => <Line key={id} id={id} c={e.changes[id]} />)}
        {ids.length > shown.length && <li className="hv-more">{i18next.t("ほか {{n}} 件", { n: ids.length - shown.length })}</li>}
      </ul>
    </li>
  );
}

export default function HistoryView() {
  const list = useHistory();
  const rev = [...list].reverse();
  return (
    <section className="set-sec">
      <div className="hv-top">
        <p className="hv-note"><Trans i18nKey="設定を変えるたびに、変更前と変更後の値をこの端末に残します。「元に戻す」は履歴を消さず、戻した記録を新しく足します。" /></p>
        {list.length > 0 && <button className="btn" onClick={() => { if (confirm(i18next.t("設定の履歴を全部消しますか?(いまの設定は変わりません)"))) clearHistory(); }}><Trash2 size={14} /><span>{i18next.t("履歴を消す")}</span></button>}
      </div>
      {rev.length ? <ol className="hv-list">{rev.map((e) => <Item key={e.id} e={e} all={list} />)}</ol> : <p className="set-none"><Trans i18nKey="まだ履歴がありません" /></p>}
    </section>
  );
}
