import i18next from "i18next";
import { IS_TAURI } from "@/shared/chrome";
import { notify } from "@/shared/notify";

// クリップボードの文字の読み書き。
// アプリ版は OS のクリップボードを Rust 経由で直接使う(navigator.clipboard.readText だと
// 「クリップボードの参照を求めています」というブラウザの確認が出るため)。アプリ版では navigator には戻らない。
export async function readClip(): Promise<string> {
  if (IS_TAURI) {
    try { return await (await import("@tauri-apps/api/core")).invoke<string>("clip_read"); } catch { return ""; }
  }
  try { return await navigator.clipboard.readText(); } catch { return ""; }
}

// 書けたら true
export async function writeClip(text: string): Promise<boolean> {
  if (IS_TAURI) {
    try { await (await import("@tauri-apps/api/core")).invoke("clip_write", { text }); return true; } catch { /* 下の方法で試す */ }
  }
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// コピーして、結果をトーストで知らせる(メニューやボタンから明示的にコピーしたとき用)
export async function copyWithNotice(text: string, done = i18next.t("コピーしました")): Promise<void> {
  if (await writeClip(text)) notify(done, "success");
  else notify(i18next.t("コピーできませんでした"), "error");
}
