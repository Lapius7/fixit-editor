// 拡張機能が足す CSS。外へ画像を取りに行く書き方(url()・@import など)は受け付けない
// (本体の CSP は img-src https: を許すため、CSS から URL を読ませると、操作の情報を外へ送れてしまう)。画像は背景画像の API だけ。
export const MAX_CSS_CHARS = 60_000;
const BAD = /\\|@import|@namespace|\b(?:url|src|image|image-set|-webkit-image-set|cross-fade|element|paint|expression)\s*\(/i;
export const cssOk = (t: string) => t.length <= MAX_CSS_CHARS && !BAD.test(t);

const els = new Map<string, HTMLStyleElement>();
let shield = 0;
/** 同意画面・拡張機能の管理画面が開いている間、拡張の CSS と背景を止める(画面の見た目を似せてだます使い方を防ぐ) */
export function shieldExtCss(on: boolean) {
  shield = Math.max(0, shield + (on ? 1 : -1));
  els.forEach((el) => { el.disabled = shield > 0; });
  document.documentElement.classList.toggle("ext-shield", shield > 0);
}
export function setExtCss(extId: string, text: string | null) {
  let el = els.get(extId);
  if (text === null || text === "") { el?.remove(); els.delete(extId); return; }
  if (!el) { el = document.createElement("style"); el.dataset.ext = extId; document.head.appendChild(el); els.set(extId, el); }
  el.disabled = shield > 0;
  el.textContent = text;
}
