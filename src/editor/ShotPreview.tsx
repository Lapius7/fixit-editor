import { useEffect, useState } from "react";
import { Check, Copy, Download, RotateCw, X } from "lucide-react";
import i18next from "i18next";
import { closeShot, patchShot, useShot } from "@/editor/shotPreview";
import { copyShot, saveShot } from "@/editor/shot";
import { notify } from "@/shared/notify";

const SHOW_MS = 12_000; // 何もしなければ消えるまでの時間

// コードの画像を撮ったあと、右下に出る確認の小窓。やり直し・コピー・保存・閉じる
export function ShotPreview() {
  const s = useShot();
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (!s || hover || s.busy) return;
    const t = setTimeout(closeShot, SHOW_MS);
    return () => clearTimeout(t);
  }, [s?.id, s?.busy, hover]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const redo = async () => {
    patchShot({ busy: true });
    try {
      const b = await s.redo();
      const ok = await copyShot(b);
      const { showShot } = await import("@/editor/shotPreview");
      showShot(b, s.name, ok, s.redo);
    } catch { patchShot({ busy: false }); notify(i18next.t("画像を作れませんでした"), "error"); }
  };
  const copy = async () => { const ok = await copyShot(s.blob); patchShot({ copied: ok }); if (!ok) notify(i18next.t("コピーできませんでした"), "error"); };
  return (
    <div className="shot-pv" key={s.id} role="status" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="shot-pv-bar">
        <div className="shot-pv-pill">
          <button type="button" title={i18next.t("設定を変えて撮り直す")} aria-label={i18next.t("撮り直す")} onClick={redo} disabled={s.busy}><RotateCw className={s.busy ? "spin" : undefined} /></button>
          <button type="button" title={i18next.t("コピー")} aria-label={i18next.t("コピー")} onClick={copy}>{s.copied ? <Check /> : <Copy />}</button>
          <button type="button" title={i18next.t("保存")} aria-label={i18next.t("保存")} onClick={() => saveShot(s.blob, s.name)}><Download /></button>
        </div>
        <button type="button" className="shot-pv-x" title={i18next.t("閉じる")} aria-label={i18next.t("閉じる")} onClick={closeShot}><X /></button>
      </div>
      <div className="shot-pv-card"><img src={s.url} alt="" draggable={false} /></div>
    </div>
  );
}
