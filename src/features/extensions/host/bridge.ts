// 拡張機能の API が本体の機能を借りる窓口。本体(App)が毎回の描画で setBridge で最新の関数を差し込み、
// runtime.ts は React にも App にも依存せず、ここだけを見る。差し込まれる前は何も起きない(EMPTY)。
import type { FileHost } from "@/features/ai/tools";

export type Bridge = {
  /** 開いているフォルダの読み書き(AI のファイル操作と同じ窓口。WSL・SSH も通る)。フォルダが無いときは null */
  files: FileHost | null;
  /** 外部コマンドの行を、ターミナルで動かす */
  term: (line: string, dir: string | null) => void;
  /** {file} {dir} {root} の中身 */
  termCtx: () => { file: string | null; root: string | null };
};
const EMPTY: Bridge = { files: null, term: () => {}, termCtx: () => ({ file: null, root: null }) };
let cur: Bridge = EMPTY;
export const setBridge = (b: Partial<Bridge>) => { cur = { ...cur, ...b }; };
export const bridge = (): Bridge => cur;
