import { useEffect, useState } from "react";
import { X } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ms } from "@/features/settings/settings";
import { notify } from "@/shared/notify";
import { applyUpdate, type Manifest } from "./update";

// 新しい版のお知らせ。「更新する」で、署名を確かめた新しい版に置き換えて再起動する
export default function UpdateView({ m, onClose, out }: { m: Manifest; onClose: () => void; out?: boolean }) {
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = () => { if (busy) return; setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const run = async () => {
    setBusy(true);
    const r = await applyUpdate(m);
    setBusy(false);
    if (r === "no_launcher") { notify(i18next.t("この起動のしかたでは自動で更新できません。公式サイトから新しい版をダウンロードしてください"), "warning"); }
    else notify(i18next.t("更新できませんでした。ネットワークを確かめて、もう一度試してください"), "error");
  };
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={close}>
      <div className="qo dlg fb" role="dialog" aria-label={i18next.t("新しい版があります")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="st-head">
          <h2><Trans i18nKey="新しい版があります" /></h2>
          <button className="icon-btn" aria-label={i18next.t("閉じる")} onClick={close}><X /></button>
        </header>
        <p className="up-ver"><span className="tnum">v{__APP_VERSION__}</span> → <b className="tnum">v{m.version}</b></p>
        {m.notes && <pre className="up-notes">{m.notes}</pre>}
        <p className="fb-note"><Trans i18nKey="更新すると、アプリが自動で再起動します。" /></p>
        <div className="dlg-foot">
          <button className="btn" onClick={close} disabled={busy}><Trans i18nKey="あとで" /></button>
          <button className="btn" data-primary="true" disabled={busy} onClick={run}><Trans i18nKey={busy ? "更新しています…" : "更新して再起動"} /></button>
        </div>
      </div>
    </div>
  );
}
