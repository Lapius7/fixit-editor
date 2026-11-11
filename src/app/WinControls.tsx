import { Minus, Plus, X } from "lucide-react";
import { winAct } from "@/shared/chrome";
import i18next from 'i18next'

// 記号の箱を丸と同じ 12px にし、余白は viewBox で持つ(8px を 12px の中央に置くと、125% などの表示倍率で 0.5 画素の端数が出て、Windows で左上に寄るため)
const VB = "-6 -6 36 36";

// 窓を閉じる・小さくする・大きくするボタン(左上の三つの丸)
export default function WinControls() {
  return (
    <div className="wc" role="group" aria-label={i18next.t("窓の操作")}>
      <button className="wc-b" data-k="close" aria-label={i18next.t("閉じる")} onClick={() => winAct("close")}><X viewBox={VB} /></button>
      <button className="wc-b" data-k="min" aria-label={i18next.t("最小化")} onClick={() => winAct("minimize")}><Minus viewBox={VB} /></button>
      <button className="wc-b" data-k="max" aria-label={i18next.t("最大化")} onClick={() => winAct("toggleMaximize")}><Plus viewBox={VB} /></button>
    </div>
  );
}
