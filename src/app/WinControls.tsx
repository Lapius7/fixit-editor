import { Minus, Plus, X } from "lucide-react";
import { winAct } from "@/shared/chrome";
import i18next from 'i18next'

// 窓を閉じる・小さくする・大きくするボタン(左上の三つの丸)
export default function WinControls() {
  return (
    <div className="wc" role="group" aria-label={i18next.t("窓の操作")}>
      <button className="wc-b" data-k="close" aria-label={i18next.t("閉じる")} onClick={() => winAct("close")}><X /></button>
      <button className="wc-b" data-k="min" aria-label={i18next.t("最小化")} onClick={() => winAct("minimize")}><Minus /></button>
      <button className="wc-b" data-k="max" aria-label={i18next.t("最大化")} onClick={() => winAct("toggleMaximize")}><Plus /></button>
    </div>
  );
}
