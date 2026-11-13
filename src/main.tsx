// 起動の入口。アプリ版では、データフォルダの内容をメモリに読み込んでから、本体を読み込む
import { initStore } from "@/platform/appdata";

// デバッグログは、保存の読み込みが終わってから始める(前回の記録を読むため)。失敗しても本体は起動する
initStore()
  .then(() => import("@/shared/debuglog"))
  .then((m) => m.startDebugLog())
  .catch(() => {})
  .finally(() => void import("./boot"));
