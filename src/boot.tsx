import HoverTip from "@/shared/HoverTip";
import { Notifier } from "@/shared/notify";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/noto-sans-jp";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/index.css";
import "@/i18n";
import { showWin, winThemed } from "@/shared/chrome";
import App from "@/app/App";
import { startStats } from "@/features/stats/stats";
import { initSegSlide } from "@/shared/segslide";
import "@/features/settings/history"; // 設定の変更履歴の記録を始める
import Splash from "@/app/Splash";
import { warmJaFont } from "@/shared/fontwarm";

createRoot(document.getElementById("root")!).render(<><App /><Splash /><Notifier /><HoverTip /></>);
startStats();
initSegSlide();
warmJaFont();
showWin(winThemed);
