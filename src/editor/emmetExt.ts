// Emmet の拡張一式。Editor と、テストの両方から使う。
import { Prec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import type * as Plugin from "@emmetio/codemirror6-plugin";
import { parseEmmetJson } from "./emmetJson";

// 行の頭から数えたキャレットまでの、空白で区切った最後のかたまり
const lastWord = (v: EditorView): string => { const r = v.state.selection.main; const ln = v.state.doc.lineAt(r.head); return /\S*$/.exec(ln.text.slice(0, r.head - ln.from))?.[0] ?? ""; };

// プラグインは「(」で始まる記法((h1+h2)*2 など)の追跡を始められないので、Tab・Enter で展開を補う。HTML の「!」も同じ
function fallback(m: typeof Plugin, syntax: string): Extension {
  const run = (v: EditorView) => {
    const r = v.state.selection.main;
    if (!r.empty) return false;
    const w = lastWord(v);
    if (syntax === "html" && w === "!") return m.expandAbbreviation(v);
    return /^\(.*\)/.test(w) && syntax !== "css" ? m.expandAbbreviation(v) : false;
  };
  return Prec.high(keymap.of([{ key: "Enter", run }, { key: "Tab", run }]));
}

// ショートカット設定から呼ぶ Emmet の操作。プラグインは読み込み後に登録する(読み込み前は何もしない)
export const emmetRun: Record<string, (v: EditorView) => boolean> = {};
export const EMMET_CMDS = ["emWrap", "emExpand", "emBalanceOut", "emBalanceIn", "emNextPoint", "emPrevPoint", "emTagPair", "emRemoveTag", "emSplitJoin", "emMath", "emInc1", "emDec1", "emInc01", "emDec01", "emInc10", "emDec10", "emNextItem", "emPrevItem", "emAbbrMode"] as const;
function register(m: typeof Plugin) {
  const c = (f: unknown) => f as (v: EditorView) => boolean;
  Object.assign(emmetRun, { emWrap: c((m as unknown as Record<string, unknown>).enterWrapWithAbbreviation), emExpand: c(m.expandAbbreviation), emBalanceOut: c(m.balanceOutward), emBalanceIn: c(m.balanceInward), emNextPoint: c(m.goToNextEditPoint), emPrevPoint: c(m.goToPreviousEditPoint), emTagPair: c(m.goToTagPair), emRemoveTag: c(m.removeTag), emSplitJoin: c(m.splitJoinTag), emMath: c(m.evaluateMath), emInc1: c(m.incrementNumber1), emDec1: c(m.decrementNumber1), emInc01: c(m.incrementNumber01), emDec01: c(m.decrementNumber01), emInc10: c(m.incrementNumber10), emDec10: c(m.decrementNumber10), emNextItem: c(m.selectNextItem), emPrevItem: c(m.selectPreviousItem), emAbbrMode: c(m.enterAbbreviationMode) });
}

export function emmetExtensions(m: typeof Plugin, syntax: string, json: string): Extension[] {
  register(m);
  const p = parseEmmetJson(json ?? "");
  const opt = p.ok ? p.opt : {};
  return [m.emmetConfig.of({ shortHex: true, ...opt, syntax: syntax as never }), m.abbreviationTracker({ syntax: syntax as never }), fallback(m, syntax), m.wrapWithAbbreviation("F24")];
}
