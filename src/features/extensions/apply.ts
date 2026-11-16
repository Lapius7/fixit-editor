// 有効な拡張機能の中身を、本体へ反映する(テーマの色・スニペット・コマンド)。反映するのは、検査を通った宣言だけ。
import { useEffect, useMemo, useRef } from "react";
import { setExtraSnippets } from "@/editor/snippets";
import { buildExtCommand, type Installed } from "./exports";
import { activeTheme } from "./registry";
import { THEME_VARS } from "./spec";

const STYLE_ID = "fixit-ext-theme";
const css = (o: Record<string, string>) => Object.entries(o).filter(([k]) => (THEME_VARS as readonly string[]).includes(k)).map(([k, v]) => `${k}:${v}`).join(";");

/** 選んだ拡張のテーマを <style> に反映する(色の変数だけ。値は検査済み)。選んでいなければ外す */
function applyTheme(list: Installed[], sel: string | null) {
  let el = document.getElementById(STYLE_ID);
  const [eid, tid] = sel?.split("/") ?? [];
  const t = list.find((x) => x.id === eid && x.active)?.manifest.themes.find((x) => x.id === tid);
  if (!t) { el?.remove(); return; }
  if (!el) { el = document.createElement("style"); el.id = STYLE_ID; document.head.appendChild(el); }
  el.textContent = `html:root{${css(t.light)}}html:root[data-theme="dark"]{${css(t.dark)}}`;
}

/** 有効な拡張機能のスニペットとテーマを反映する。App で 1 回呼ぶ */
export function useExtensionEffects(list: Installed[]) {
  const sel = activeTheme();
  useEffect(() => { applyTheme(list, sel); }, [list, sel]);
  useEffect(() => { setExtraSnippets(list.filter((x) => x.active).flatMap((x) => x.manifest.snippets)); }, [list]);
}

/** コマンドパレットに足す項目。実行は、呼び出し側が渡す run(コマンド行)でターミナルに打つ */
export function useExtensionCommands(list: Installed[], ctx: () => { file: string | null; root: string | null }, run: (line: string, dir: string | null) => void, group: string) {
  // 実行の時点の「開いているファイル」を使うため、最新の ctx / run を ref に持つ(項目の作り直しは、拡張が変わったときだけ)
  const cur = useRef({ ctx, run });
  cur.current = { ctx, run };
  return useMemo(() => list.filter((x) => x.active).flatMap((x) => x.manifest.commands.map((c) => ({
    id: `ext-${x.id}-${c.id}`, label: `${x.manifest.name}: ${c.title}`, group,
    run: () => { const b = buildExtCommand(c, cur.current.ctx()); if (b) cur.current.run(b.line, b.dir); },
  }))), [list, group]);
}
