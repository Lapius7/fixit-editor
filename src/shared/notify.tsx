// アプリ内の通知(トースト)。ding(スプリングで動く 1 つだけのトースト)を使う。
// 出す時間は設定「メッセージを出す時間」(msgMs)に合わせる。使う側は notify() だけを呼ぶ。
import { Toaster, toast } from "@yusufceng1z/ding-react";
import i18next from "i18next";
import { get, useSettings } from "@/features/settings/settings";

export type NoticeKind = "success" | "error" | "warning" | "info";

export function notify(message: string, kind: NoticeKind = "info", description?: string): void {
  toast[kind](message, { duration: Math.round(get().msgMs * 1000), ...(description ? { description } : {}) });
}

export function Notifier() {
  const s = useSettings();
  return <Toaster position="bottom-center" theme={s.mode === "auto" ? "system" : s.mode} labels={{ region: i18next.t("通知"), dismiss: i18next.t("閉じる") }} />;
}
