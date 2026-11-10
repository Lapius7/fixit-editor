// 起動の入口。アプリ版では、データフォルダの内容をメモリに読み込んでから、本体を読み込む
import { initStore } from "@/platform/appdata";

initStore().finally(() => void import("./boot"));
