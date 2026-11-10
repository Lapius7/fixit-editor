// アプリ版(Tauri)では OS のタイトルバーを使わず、自前の窓の操作ボタンを出す。
// ブラウザで見た目だけ確かめるときは ?chrome=1 を付ける。
export const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const CHROME = IS_TAURI || (typeof location !== "undefined" && new URLSearchParams(location.search).has("chrome"));

type Act = "minimize" | "toggleMaximize" | "close";
export async function winAct(a: Act) {
  if (!IS_TAURI) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow()[a]();
}

if (CHROME) document.documentElement.classList.add("chrome");
if (IS_TAURI) document.documentElement.classList.add("tauri");

// Mica の明暗を、アプリのテーマに合わせる
export let winThemed: Promise<unknown> = Promise.resolve();
export function setWinTheme(dark: boolean): Promise<unknown> {
  if (!IS_TAURI) return Promise.resolve();
  const p = import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().setTheme(dark ? "dark" : "light"));
  winThemed = p;
  return p;
}

// 窓は隠して起動し、テーマを合わせて最初の1枚を描いてから見せる(白→黒→白のちらつき対策)
export async function showWin(themed: Promise<unknown>) {
  if (!IS_TAURI) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const show = () => getCurrentWindow().show().catch(() => {});
  const timer = setTimeout(show, 2500);
  await Promise.race([themed.catch(() => {}), new Promise((r) => setTimeout(r, 1200))]);
  requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); show(); }));
}
