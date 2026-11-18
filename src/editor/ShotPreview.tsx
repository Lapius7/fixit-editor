import { useEffect, useState } from "react";
import { Check, Copy, Download, RotateCw, X } from "lucide-react";
import i18next from "i18next";
import { closeShot as closeNow, patchShot, useShot } from "@/editor/shotPreview";
import { copyShot, saveShot } from "@/editor/shot";
import { notify } from "@/shared/notify";

const SHOW_MS = 12_000; // 何もしなければ消えるまでの時間
const LEAVE_MS = 200; // 消えるアニメーションの長さ
const DONE_MS = 1600; // 「コピーした」のチェックを出しておく時間

// コードの画像を撮ったあと、右下に出る確認の小窓。やり直し・コピー・保存・閉じる
export function ShotPreview() {
  const s = useShot();
  const [hover, setHover] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false); // 自分でコピーを押した直後だけ、チェックを出す(最初から出さない)
  // 消えるアニメーションを見せてから、実際に閉じる
  const close = () => { setLeaving(true); setTimeout(closeNow, LEAVE_MS); };
  useEffect(() => { setLeaving(false); setDone(false); }, [s?.id]);
  useEffect(() => {
    if (!s || hover || s.busy || leaving) return;
    const t = setTimeout(close, SHOW_MS);
    return () => clearTimeout(t);
  }, [s?.id, s?.busy, hover, leaving]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), DONE_MS); return () => clearTimeout(t); }, [done]);
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
  const copy = async () => { const ok = await copyShot(s.blob); patchShot({ copied: ok }); setDone(ok); if (!ok) notify(i18next.t("コピーできませんでした"), "error"); };
  return (
    <div className="shot-pv" key={s.id} role="status" data-leaving={leaving || undefined} data-hover={hover || undefined} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="shot-pv-bar">
        <div className="shot-pv-pill">
          <button type="button" title={i18next.t("設定を変えて撮り直す")} aria-label={i18next.t("撮り直す")} onClick={redo} disabled={s.busy}><RotateCw className={s.busy ? "spin" : undefined} /></button>
          <button type="button" title={i18next.t("コピー")} aria-label={i18next.t("コピー")} onClick={copy}><span className="shot-ico" key={done ? "ok" : "cp"}>{done ? <Check className="shot-check" /> : <Copy />}</span></button>
          <button type="button" title={i18next.t("保存")} aria-label={i18next.t("保存")} onClick={() => saveShot(s.blob, s.name)}><Download /></button>
        </div>
        <button type="button" className="shot-pv-x" title={i18next.t("閉じる")} aria-label={i18next.t("閉じる")} onClick={close}><X /></button>
      </div>
      <div className="shot-pv-card"><img src={s.url} alt="" draggable={false} /><i className="shot-pv-life" key={String(hover)} aria-hidden /></div>
    </div>
  );
}
