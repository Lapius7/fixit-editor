import { useEffect } from "react";
import { Palette as PaletteIcon, RotateCcw, X } from "lucide-react";
import { DEFS, resetOne, useSettings } from "@/features/settings/settings";
import { Look, Rows } from "@/features/settings/SettingsParts";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

// エディタの右にひらく、見た目の編集パネル。変えるたびに、そのまま画面へ反映される
export default function ThemePanel({ out, onClose }: { out: boolean; onClose: () => void }) {
  const s = useSettings() as unknown as Record<string, unknown>;
  const defs = DEFS.filter((d) => d.cat === "look");
  const changed = defs.filter((d) => JSON.stringify(s[d.id]) !== JSON.stringify(d.def)).length;

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".qo-backdrop, .ctx-layer")) return; // 前面のダイアログを先に閉じる
      onClose();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);

  return (
    <aside className="theme-panel" data-out={out} aria-label={i18next.t("テーマの編集")} aria-hidden={out || undefined}>
      <div className="tp">
        <header className="tp-head">
          <PaletteIcon />
          <div className="tp-title"><b><Trans i18nKey="テーマ" /></b><small><Trans i18nKey="変えると、すぐ画面に反映されます" /></small></div>
          <button className="icon-btn" aria-label={i18next.t("外観を初期値に戻す")} title={i18next.t("外観を初期値に戻す")} disabled={!changed} onClick={() => defs.forEach((d) => resetOne(d.id))}><RotateCcw /></button>
          <button className="icon-btn" aria-label={i18next.t("テーマパネルを閉じる")} onClick={onClose}><X /></button>
        </header>
        <div className="tp-body scroll">
          <Look />
          <Rows defs={defs} />
        </div>
      </div>
    </aside>
  );
}
