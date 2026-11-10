// ローカル履歴の画面。左に保存した版を新しい順に並べ、右に「いまの中身」との差を出す。選んだ版に戻せる
import { useMemo, useState } from "react";
import { History, Trash2, Undo2 } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ms } from "@/features/settings/settings";
import { clearFile, diffLines, snapshots } from "@/features/history/history";
import { ask } from "@/shared/ask";

type Props = { path: string; name: string; current: string; onRestore: (text: string) => void; onClose: () => void; out?: boolean };

const when = (t: number) => new Intl.DateTimeFormat(i18next.language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(t);

export default function LocalHistory({ path, name, current, onRestore, onClose, out }: Props) {
  const [list, setList] = useState(() => snapshots(path));
  const [sel, setSel] = useState(0);
  const [closing, setClosing] = useState(false);
  const snap = list[sel];
  const ops = useMemo(() => (snap ? diffLines(snap.text, current) : []), [snap, current]);
  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, ms(180)); };
  const stat = (text: string) => { let a = 0, d = 0; for (const o of diffLines(text, current)) { if (o.k === "+") a++; else if (o.k === "-") d++; } return [a, d]; };
  const stats = useMemo(() => list.map((x) => stat(x.text)), [list, current]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={() => close()}>
      <div className="qo dlg lh" role="dialog" aria-label={i18next.t("ローカル履歴")} onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <h2><History size={16} />{i18next.t("ローカル履歴")}<span className="lh-name">{name}</span></h2>
        {list.length ? (
          <div className="lh-body">
            <ol className="lh-list">
              {list.map((x, i) => (
                <li key={x.t}>
                  <button data-on={i === sel} onClick={() => setSel(i)}>
                    <b>{when(x.t)}</b>
                    <span>{stats[i][0] || stats[i][1] ? <><i className="lh-add">+{stats[i][0]}</i> <i className="lh-del">−{stats[i][1]}</i></> : i18next.t("いまと同じ")}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="lh-diff" tabIndex={0}>
              {ops.some((o) => o.k !== " ") ? ops.map((o, i) => <div key={i} className="lh-line" data-k={o.k}><i>{o.k === " " ? "" : o.k}</i><span>{o.s || " "}</span></div>) : <p className="set-none">{i18next.t("いまの中身と同じです")}</p>}
            </div>
          </div>
        ) : <p className="set-none"><Trans i18nKey="まだ履歴がありません" /></p>}
        <p className="lh-hint">{i18next.t("選んだ版に戻すと、赤い行は復活し、緑の行は消えます。保存するまでファイルは変わりません。")}</p>
        <div className="dlg-foot">
          {list.length > 0 && <button className="btn" onClick={async () => { if (await ask({ message: i18next.t("このファイルの履歴を全部消しますか?(ファイルは変わりません)"), ok: i18next.t("消す"), danger: true })) { clearFile(path); setList([]); } }}><Trash2 size={14} /><span>{i18next.t("履歴を消す")}</span></button>}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => close()}>{i18next.t("閉じる")}</button>
          {snap && <button className="btn" data-primary="true" disabled={snap.text === current} onClick={() => close(() => onRestore(snap.text))}><Undo2 size={14} /><span>{i18next.t("この版に戻す")}</span></button>}
        </div>
      </div>
    </div>
  );
}
