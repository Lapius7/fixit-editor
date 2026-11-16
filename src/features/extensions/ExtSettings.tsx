import i18next from "i18next";
import { Trans } from "react-i18next";
import { useInstalled } from "./registry";
import { ExtSettingGroups } from "./ExtSettingRows";

// 設定の「拡張機能」。管理の画面(ExtensionsView)は大きいので、ここからはそれを開くだけにする
export function ExtSettings({ onOpen }: { onOpen: () => void }) {
  const list = useInstalled(), n = list.length;
  return (
    <>
    <div className="set-theme-link">
      <div>
        <Trans i18nKey="拡張機能の管理" />
        <small>{n ? i18next.t("入れた拡張機能: {{n}} 件", { n }) : i18next.t("入れた拡張機能はありません")} · <Trans i18nKey="探す・フォルダから入れる・無効にする・削除する" /></small>
      </div>
      <button className="btn" data-primary="true" onClick={onOpen}><Trans i18nKey="拡張機能を開く" /></button>
    </div>
    <ExtSettingGroups list={list} />
    </>
  );
}
