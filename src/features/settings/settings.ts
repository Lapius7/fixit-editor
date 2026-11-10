import { kvGet, kvSet, kvWatch } from "@/platform/appdata"; import { cleanRunners } from "@/features/run/runners";
import { useSyncExternalStore } from "react";
import { setWinTheme } from "@/shared/chrome";
import { TAB_SIZE } from "@/shared/config";

export type Dot = { x: number; y: number; c: string };
export type Mode = "light" | "dark" | "auto";
export type Cat = "look" | "layout" | "editor" | "cursor" | "assist" | "files" | "ws" | "term" | "run" | "status" | "motion" | "privacy" | "adv" | "history" | "ai" | "account";

// 背景の色を選ぶ見本(画像の下段の丸)
export const SWATCHES = ["#e4e6ec", "#f08bb4", "#f2836b", "#f5a65b", "#e6c85a", "#8ccf6f", "#4fc79a", "#4aa8f0", "#7a7cf0", "#b57cf0"];
export const ACCENTS = ["#3b6fd9", "#7a5cf0", "#d6479a", "#e0691f", "#2a9d6c", "#5b6473"];
export const MAX_DOTS = 5;

export const CATS: { id: Cat | "keys"; label: string }[] = [
  { id: "look", label: "外観" }, { id: "layout", label: "レイアウト" }, { id: "editor", label: "エディタ" }, { id: "cursor", label: "カーソルと行番号" },
  { id: "assist", label: "補完と入力" }, { id: "files", label: "ファイル" }, { id: "ws", label: "ワークスペース" }, { id: "term", label: "ターミナル" }, { id: "run", label: "実行" }, { id: "status", label: "ステータスバー" },
  { id: "motion", label: "アニメーション" }, { id: "privacy", label: "統計とプライバシー" }, { id: "adv", label: "詳細" }, { id: "account", label: "アカウント" }, { id: "ai", label: "AI" }, { id: "history", label: "変更履歴" }, { id: "keys", label: "ショートカット" },
];

/* ---------- 設定の一覧(ここに足すだけで、設定画面・保存・検索に出る) ----------
   css  : 値を CSS 変数に書き出す(fmt で文字列に変える)
   attr : 値を <html data-◯◯> に書き出す
   どちらも無いものは、コード側が useSettings() で読む。 */
type Opt = { sec?: string; hint?: string; css?: string; attr?: string };
const n = <K extends string>(id: K, cat: Cat, label: string, def: number, o: Opt & { min: number; max: number; step?: number; unit?: string; fmt?: (v: number) => string }) =>
  ({ id, cat, label, def, kind: "num" as const, step: 1, unit: "", ...o });
const b = <K extends string>(id: K, cat: Cat, label: string, def: boolean, o: Opt & { fmt?: (v: boolean) => string } = {}) => ({ id, cat, label, def, kind: "bool" as const, ...o });
const e = <K extends string>(id: K, cat: Cat, label: string, def: string, opts: [string, string][], o: Opt & { fmt?: (v: string) => string } = {}) =>
  ({ id, cat, label, def, kind: "enum" as const, opts, ...o });
// 書体。選択肢のキー(preset)か、この PC のフォント("local:家族名")のどちらかを持つ
const f = <K extends string>(id: K, cat: Cat, label: string, def: string, opts: [string, string][], o: Opt & { fmt?: (v: string) => string; mono?: boolean } = {}) =>
  ({ id, cat, label, def, kind: "font" as const, opts, ...o });
export const LOCAL = "local:";
const quote = (n: string) => `"${n.replace(/["\\\n]/g, "")}"`;
// プリセットは map から、この PC のフォントは家族名を先頭にして、日本語の字が欠けないよう tail を後ろに付ける
const fontCss = (m: Record<string, string>, tail: string) => (v: string) => (v.startsWith(LOCAL) ? `${quote(v.slice(LOCAL.length))}, ${tail}` : m[v] ?? "");
const map = (m: Record<string, string>) => (v: string) => m[v] ?? "";

export const SANS: Record<string, string> = {
  inter: '"Inter Variable", "Noto Sans JP Variable", system-ui, sans-serif',
  system: 'system-ui, "Noto Sans JP Variable", sans-serif',
  serif: 'ui-serif, Georgia, "Hiragino Mincho ProN", "Yu Mincho", "Noto Sans JP Variable", serif',
};
export const CODE: Record<string, string> = {
  obel: '"Obel Mono", "Noto Sans JP Variable", ui-monospace, monospace',
  jb: '"JetBrains Mono Variable", "Noto Sans JP Variable", ui-monospace, monospace',
  system: 'ui-monospace, "Cascadia Code", Consolas, Menlo, "Noto Sans JP Variable", monospace',
  mono: 'monospace, "Noto Sans JP Variable"',
};

const RAW = [
  e("lang", "look", "表示言語", "auto", [["auto", "自動(OSに合わせる)"], ["ja", "日本語"], ["en", "English"], ["ko", "한국어"]], { sec: "言語" }),
  /* 外観(モードとアクセントと背景のメッシュは、専用の画面) */
  f("uiFont", "look", "画面の文字", "inter", [["inter", "Inter"], ["system", "システム"], ["serif", "明朝"]], { sec: "文字と形", css: "--font-sans", fmt: fontCss(SANS, '"Noto Sans JP Variable", system-ui, sans-serif'), hint: "この PC に入っているフォントも選べます" }),
  e("treeFont", "look", "フォルダ(ファイル一覧)の文字", "ui", [["ui", "画面と同じ"], ["code", "コードと同じ"], ["inter", "Inter"], ["system", "システム"], ["serif", "明朝"]], { css: "--font-tree", fmt: map({ ui: "var(--font-sans)", code: "var(--font-mono)", ...SANS }) }),
  e("radius", "look", "角の丸さ", "normal", [["sharp", "角ばる"], ["normal", "標準"], ["round", "まるい"]], { css: "--rk", fmt: map({ sharp: ".35", normal: "1", round: "1.5" }) }),
  n("blur", "look", "ガラスのぼかし", 10, { sec: "ガラス", min: 0, max: 60, step: 2, unit: "px", css: "--blur", hint: "窓・エディタの面・メニューの背景がどれだけ溶けるか" }),
  n("sat", "look", "ガラスの彩度", 1.8, { min: 1, max: 2.4, step: 0.1, css: "--sat" }),
  n("glass", "look", "ガラスの透け具合", 40, { min: 20, max: 100, step: 5, unit: "%", css: "--glass-pct", fmt: (v) => `${v}%`, hint: "大きいほど、壁紙が見えにくくなります" }),
  n("paperA", "look", "エディタの面の濃さ", 30, { min: 0, max: 100, step: 5, unit: "%", css: "--paper-k", attr: "paper", fmt: (v) => String(v / 100), hint: "下げるほど、壁紙が透けて見えます" }),
  b("specular", "look", "ガラスの上端の光", true, { attr: "spec" }),
  n("shadow", "look", "影の濃さ", 100, { min: 0, max: 100, step: 5, unit: "%", css: "--sk", fmt: (v) => String(v / 100) }),
  n("dim", "look", "ダーク時の壁紙の暗さ", 54, { min: 0, max: 90, step: 2, unit: "%", hint: "ダークテーマで壁紙にかぶせる黒の濃さ" }),
  n("winGap", "look", "窓の外側の余白", 0, { min: 0, max: 48, step: 4, unit: "px", css: "--stage-pad", attr: "wm", hint: "0 で画面いっぱい。上げると窓が壁紙の上に浮き、角の丸さと影が見えます" }),
  n("hairA", "look", "線と枠の濃さ", 100, { sec: "濃さ", min: 0, max: 250, step: 10, unit: "%", css: "--hair-k", fmt: (v) => String(v / 100), hint: "区切り線・枠・ガラスの縁" }),
  n("hoverA", "look", "ホバー・押したときの濃さ", 100, { min: 0, max: 300, step: 20, unit: "%", css: "--press-k", fmt: (v) => String(v / 100) }),
  n("selA", "look", "選択範囲の濃さ", 100, { min: 20, max: 200, step: 10, unit: "%", css: "--sel-k", fmt: (v) => String(v / 100), hint: "エディタで選んだ文字の背景。アクセントの色になります" }),
  n("lineA", "look", "カーソル行の濃さ", 100, { min: 0, max: 400, step: 20, unit: "%", css: "--line-k", fmt: (v) => String(v / 100) }),
  n("grain", "look", "壁紙のざらつき", 0, { sec: "壁紙", min: 0, max: 100, step: 10, unit: "%", css: "--grain-k", fmt: (v) => String(v / 100), hint: "壁紙にフィルムのような粒を重ねます" }),

  /* レイアウト */
  n("sideW", "layout", "サイドバーの幅", 280, { sec: "サイドバー", min: 200, max: 640, step: 10, unit: "px", css: "--side-w", hint: "エディタとの境目をドラッグしても変えられます" }),
  n("aiW", "layout", "AI パネルの幅", 440, { sec: "右のパネル", min: 280, max: 900, step: 10, unit: "px", css: "--ai-w", hint: "エディタとの境目をドラッグしても変えられます" }),
  n("brW", "layout", "ブラウザの幅", 560, { sec: "右のパネル", min: 280, max: 1000, step: 10, unit: "px", css: "--br-w", hint: "エディタとの境目をドラッグしても変えられます" }),
  n("rowH", "layout", "ファイルの行の高さ", 28, { min: 22, max: 40, step: 2, unit: "px", css: "--row-h" }),
  n("treeIndent", "layout", "フォルダの字下げ", 16, { min: 8, max: 32, step: 2, unit: "px" }),
  b("showHidden", "layout", "「.」で始まるファイルも出す", true),
  n("tabH", "layout", "タブの高さ", 32, { sec: "タブと画面", min: 26, max: 44, step: 2, unit: "px", css: "--tab-h" }),
  n("tabMaxW", "layout", "タブの最大の幅", 220, { min: 120, max: 400, step: 20, unit: "px", css: "--tab-w" }),
  e("tabX", "layout", "タブの × を出すとき", "active", [["active", "選択・ホバー"], ["always", "いつも"], ["hover", "ホバーのみ"]], { attr: "tabx" }),
  n("paneGap", "layout", "分割した画面のすき間", 8, { min: 0, max: 24, step: 2, unit: "px", css: "--pane-gap" }),
  e("splitDir","layout","分割の向き","col",[["col","左右に並べる"],["row","上下に並べる"]],{attr:"splitdir"}),
  n("splitRatio","layout","分割の比率(左または上)",50,{min:20,max:80,step:5,unit:"%"}),
  b("splitDrop","layout","タブやファイルのドラッグで、画面を選べるようにする",true),

  /* エディタ */
  f("fontFamily", "editor", "コードの書体", "obel", [["obel", "Obel Mono"], ["jb", "JetBrains Mono"], ["system", "システム"], ["mono", "標準の等幅"]], { sec: "文字", css: "--font-mono", fmt: fontCss(CODE, '"Noto Sans JP Variable", ui-monospace, monospace'), mono: true, hint: "この PC に入っているフォントも選べます。ターミナルにも使います" }),
  n("fontSize", "editor", "文字の大きさ", 13.5, { min: 10, max: 28, step: 0.5, unit: "px", css: "--fs" }),
  n("fontWeight", "editor", "文字の太さ", 400, { min: 300, max: 700, step: 100, css: "--code-w" }),
  n("lineHeight", "editor", "行の高さ", 22, { min: 16, max: 36, step: 1, unit: "px", css: "--lh", hint: "整数のpxにすると、にじみません" }),
  n("letterSpacing", "editor", "文字の間隔", 0, { min: 0, max: 2, step: 0.1, unit: "px", css: "--ls" }),
  b("ligatures", "editor", "合字(=> を ⇒ のように描く)", false, { attr: "lig" }),
  n("tabSize", "editor", "インデントの幅", TAB_SIZE, { sec: "インデントと折り返し", min: 1, max: 8, step: 1, hint: "Tab キーで入る空白の数" }),
  b("insertSpaces", "editor", "Tab キーで空白を入れる", true, { hint: "切ると、タブ文字を入れます" }),
  b("wrap", "editor", "長い行を折り返す", true),
  e("ruler", "editor", "右端の目安線", "off", [["off", "なし"], ["80", "80 桁"], ["100", "100 桁"], ["120", "120 桁"]], { css: "--ruler", fmt: (v) => (v === "off" ? "0" : v), attr: "ruler" }),
  n("padY", "editor", "本文の上下の余白", 14, { sec: "余白と色", min: 0, max: 48, step: 2, unit: "px", css: "--pad-y" }),
  n("padX", "editor", "本文の左の余白", 8, { min: 0, max: 48, step: 2, unit: "px", css: "--pad-x" }),
  e("syntax", "editor", "構文の色", "color", [["color", "鮮やか"], ["muted", "くすんだ色"], ["mono", "モノクロ"]], { css: "--syn-k", fmt: map({ color: "100%", muted: "55%", mono: "0%" }) }),
  b("commentItalic", "editor", "コメントを斜体にする", true, { css: "--com-style", fmt: (v) => (v ? "italic" : "normal") }),
  b("scrollPastEnd", "editor", "最後の行の下にも余白を取る", false),
  e("scrollbar", "editor", "スクロールバー", "thin", [["thin", "細い"], ["auto", "標準"], ["none", "隠す"]], { attr: "sb" }),
  b("spellcheck", "editor", "スペルチェック", false, { hint: "ブラウザの機能を使います" }),
  b("readOnly", "editor", "読み取り専用にする", false, { hint: "入力できなくなります" }),

  /* カーソルと行番号 */
  b("lineNumbers", "cursor", "行番号", true, { sec: "左の余白(ガター)" }),
  b("activeLine", "cursor", "いまの行を目立たせる", true),
  b("foldGutter", "cursor", "折りたたみの矢印", true),
  b("indentGuides", "cursor", "インデントの縦線", true),
  b("bracketMatching", "cursor", "対応する括弧を強調", true, { sec: "強調" }),
  b("matchHighlight", "cursor", "選んだ語と同じ語を強調", true),
  b("rainbowBrackets", "cursor", "括弧を階層ごとに色分け", true), b("tagSync", "assist", "開始タグを直すと閉じタグも同時に直す", true), b("diagnostics", "assist", "エラーに波線を引く", true), b("langService", "assist", "型情報・定義へ移動・参照検索・リネーム(JS・TS)", true), b("gitStatus", "assist", "Git の変更を表示(ファイルの印・行の変更・ブランチ)", true), b("minimap", "cursor", "ミニマップ(右端に全体の縮図)", true, { sec: "全体表示" }), b("breadcrumbs", "cursor", "パンくず(いまの位置の階層)", true),
  e("whitespace", "cursor", "空白文字の表示", "off", [["off", "出さない"], ["trailing", "行末だけ"], ["all", "すべて"]]),
  e("cursorStyle", "cursor", "カーソルの形", "bar", [["bar", "縦線"], ["block", "ブロック"], ["underline", "下線"]], { sec: "カーソル", attr: "cursor" }),
  n("cursorWidth", "cursor", "カーソルの太さ", 1.5, { min: 1, max: 4, step: 0.5, unit: "px", css: "--cur-w" }),
  e("cursorBlink", "cursor", "カーソルの点滅", "normal", [["off", "止める"], ["slow", "ゆっくり"], ["normal", "標準"], ["fast", "速く"]]),

  /* 補完と入力 */
  b("autocomplete", "assist", "入力補完", true, { sec: "補完" }),
  n("autocompleteDelay", "assist", "補完が出るまでの時間", 100, { min: 0, max: 600, step: 50, unit: "ms" }),
  n("completeMax", "assist", "補完の候補の数", 12, { min: 4, max: 24, step: 1 }),
  b("completeIcons", "assist", "候補に種類の印を付ける", false),
  b("wordComplete", "assist", "文書内の単語も候補にする", true),
  b("emmet", "assist", "Emmet 記法を Tab で展開する(HTML・CSS など)", true),
  b("closeBrackets", "assist", "括弧や引用符を自動で閉じる", true, { sec: "入力の補助" }),
  b("indentOnInput", "assist", "入力に合わせてインデントを直す", true),

  /* ファイル */
  b("trimOnSave", "files", "保存するとき、行末の空白を削る", false, { sec: "保存" }),
  b("finalNewline", "files", "保存するとき、末尾に改行を入れる", false),
  n("autoSave", "files", "自動で保存するまでの時間", 0, { min: 0, max: 60, step: 1, unit: "秒", hint: "0 で自動保存しません(フォルダを開いたときだけ)" }),
  b("confirmClose", "files", "未保存のタブを閉じるとき確かめる", true),
  b("hideBuild", "files", "node_modules などを一覧から除く", true, { sec: "検索と一覧" }),
  n("quickOpenMax", "files", "ファイル検索の表示数", 50, { min: 10, max: 200, step: 10 }),
  n("crawlLimit", "files", "ファイル検索で集める上限", 3000, { min: 500, max: 20000, step: 500 }),
  n("sshTimeout", "files", "SSH の接続を待つ時間", 10, { sec: "WSL と SSH", min: 3, max: 60, step: 1, unit: "秒" }),
  n("remoteMaxMB", "files", "WSL・SSH で開ける上限", 20, { min: 1, max: 200, step: 1, unit: "MB", hint: "これより大きいファイルは開きません" }),
  n("recentMax", "files", "最近開いた場所の数", 8, { min: 1, max: 20, step: 1 }),
  b("remoteFocusReload", "files", "画面に戻ったとき、WSL・SSH の一覧を読み直す", true),
  b("remoteKeepEol", "files", "改行コード(CRLF)を保ったまま保存する", true),

  /* 統計とプライバシー */
  b("statsOn", "privacy", "コーディング時間とタイピングを記録する", true, { sec: "統計", hint: "この PC の中だけに保存します。外へは送りません" }),
  n("statsIdle", "privacy", "離席とみなすまでの時間", 60, { min: 10, max: 600, step: 10, unit: "秒", hint: "手が止まってからこの時間までは、作業中として数えます" }),

  /* ワークスペースとプロファイル */
  b("wsRestore", "ws", "起動したとき、前回のワークスペースを開く", true, { sec: "ワークスペース" }),
  b("wsRegister", "ws", "フォルダを開いたとき、ワークスペースに登録する", true, { hint: "同じフォルダを開き直すと、前回のタブも戻ります" }),
  b("wsTerms", "ws", "ターミナルの数と開始位置も保存する", true, { hint: "実行中の処理は戻りません。新しいシェルを同じ場所で開きます" }),
  b("wsProfileLink", "ws", "ワークスペースに結びつけたプロファイルへ切り替える", true),
  n("wsMax", "ws", "保存できるワークスペースの数", 30, { min: 5, max: 100, step: 5 }),
  n("wsDelay", "ws", "保存するまでの待ち時間", 800, { sec: "動作", min: 200, max: 5000, step: 100, unit: "ms" }),
  b("wsStatus", "ws", "ステータスバーにワークスペース名を出す", true),

  /* ターミナル */
  n("termH", "term", "高さ", 260, { sec: "表示", min: 120, max: 640, step: 10, unit: "px", hint: "上の境目をドラッグしても変わります" }),
  n("termGlass", "term", "背景の濃さ", 100, { min: 0, max: 100, step: 5, unit: "%", css: "--term-a", fmt: (v) => String(v / 100) }),
  n("termPad", "term", "左の余白", 12, { min: 0, max: 32, step: 2, unit: "px", css: "--term-pad" }),
  b("termOpenOnLaunch", "term", "起動したらターミナルを開く", false),
  n("termMax", "term", "同時に開ける数", 6, { sec: "複数のターミナル", min: 1, max: 12, step: 1 }),
  b("termAutoClose", "term", "シェルが終わったらタブを閉じる", true, { hint: "切ると、Enter で閉じるまで残ります" }),
  b("runSave", "run", "実行の前に保存する", true, { sec: "実行", hint: "▶ を押したとき、未保存の変更を先に保存します" }),
  b("runClear", "run", "実行の前にターミナルの画面を消す", false, { sec: "実行" }),
  n("termFontSize", "term", "文字の大きさ", 12.5, { sec: "文字", min: 9, max: 24, step: 0.5, unit: "px" }),
  n("termLineHeight", "term", "行の高さ(倍率)", 1.3, { min: 1, max: 2, step: 0.05 }),
  n("termMinContrast", "term", "文字の最低コントラスト", 1, { min: 1, max: 7, step: 0.5, hint: "1 で補正しません" }),
  e("termCursor", "term", "カーソルの形", "block", [["block", "ブロック"], ["bar", "縦線"], ["underline", "下線"]], { sec: "操作" }),
  b("termBlink", "term", "カーソルを点滅させる", true),
  e("termBlinkStyle", "term", "点滅のしかた", "smooth", [["smooth", "ふわっと"], ["step", "ぱっと"]], { attr: "tcblink" }),
  n("termCursorWidth", "term", "縦線カーソルの太さ", 2, { min: 1, max: 4, step: 1, unit: "px", css: "--tc-w" }),
  e("termScrollbar","term","スクロールバー","slim",[["slim","細い丸棒"],["normal","太め"],["none","隠す"]],{attr:"tcbar"}),
  e("termCursorInactive", "term", "操作していないときのカーソル", "outline", [["outline", "枠だけ"], ["block", "そのまま"], ["none", "消す"]], { attr: "tcidle" }),
  n("termScrollback", "term", "さかのぼれる行数", 5000, { min: 500, max: 50000, step: 500 }),
  n("termScrollSens", "term", "スクロールの速さ", 1, { min: 1, max: 10, step: 1 }),
  b("termCopyOnSelect", "term", "選んだ文字を、すぐコピー", false),
  e("termRightClick", "term", "右クリック", "menu", [["menu", "メニュー"], ["paste", "貼り付け"]]),

  /* ステータスバー */
  b("sbShow", "status", "ステータスバーを出す", true, { sec: "全体" }),
  n("sbH", "status", "高さ", 28, { min: 22, max: 36, step: 2, unit: "px", css: "--sb-h" }),
  b("sbDividers", "status", "項目の区切り線", true, { attr: "sbdiv" }),
  b("sbTerm", "status", "ターミナル", true, { sec: "出す項目" }),
  b("sbSaved", "status", "保存の状態", true),
  b("sbPos", "status", "行と列", true),
  b("sbLines", "status", "行数", true),
  b("sbIndent", "status", "インデント", true),
  b("sbEnc", "status", "文字コード", true),
  b("sbWrap", "status", "折り返し", true),
  b("sbLang", "status", "言語", true),
  b("sbZoom", "status", "文字の大きさ", true),

  /* アニメーション */
  e("speed", "motion", "動きの速さ", "normal", [["off", "なし"], ["fast", "速く"], ["normal", "標準"], ["slow", "ゆっくり"]], { css: "--sp", fmt: map({ off: "0", fast: ".6", normal: "1", slow: "1.6" }), hint: "「なし」で、すべての動きを止めます" }),
  n("moveBlur", "motion", "出入りのときのぼかし", 6, { min: 0, max: 16, step: 1, unit: "px", css: "--ab" }),
  n("pressScale", "motion", "押したときの縮み", 0.96, { min: 0.9, max: 1, step: 0.01, css: "--ps", hint: "1 で縮みません" }),
  b("themeFade", "motion", "ライト/ダークをふわっと切り替える", true),
  b("splash", "motion", "起動アニメーションを表示する", true),
  b("tabAnim", "motion", "タブの出入りを動かす", true, { attr: "tabanim" }),
  b("treeStagger", "motion", "ファイルを順に出す", true, { attr: "stagger" }),
  b("hoverZoom", "motion", "アイコンをホバーで少し大きく", true, { attr: "hoverzoom" }),

  /* 詳細 */
  b("confirmExit", "adv", "未保存のままページを閉じるとき確かめる", true),
  n("msgMs", "adv", "メッセージを出す時間", 2.6, { min: 1, max: 10, step: 0.2, unit: "秒" }),
  n("searchMax", "adv", "全文検索の表示数", 50, { min: 20, max: 500, step: 10 }),
  b("smoothScroll", "adv", "一覧のスクロールをなめらかに", true, { attr: "smooth" }),
  b("emptyHint", "adv", "何も開いていないとき、操作の案内を出す", true),
];

/* ---------- 型 ---------- */
export type AnyDef = {
  id: string; cat: Cat; label: string; hint?: string; sec?: string; kind: "num" | "bool" | "enum" | "font"; mono?: boolean; def: number | boolean | string;
  min?: number; max?: number; step?: number; unit?: string; opts?: [string, string][]; css?: string; attr?: string; fmt?: (v: never) => string;
};
export const DEFS: AnyDef[] = RAW;

type Def = (typeof RAW)[number];
export type Values = { [D in Def as D["id"]]: D["def"] };
export type Settings = Values & { mode: Mode; dots: Dot[]; accent: string; keys: Record<string, string>; runners: Record<string, string> };

const DEFAULTS = {
  ...Object.fromEntries(RAW.map((d) => [d.id, d.def])),
  mode: "light", accent: ACCENTS[0], keys: {}, runners: {},
  dots: [{ x: 17, y: 14, c: "#59a0f7" }, { x: 86, y: 88, c: "#ffaa6e" }, { x: 12, y: 86, c: "#ffe6c8" }, { x: 85, y: 18, c: "#d8c1f0" }],
} as Settings;

/* ---------- 読み書き ---------- */
const KEY = "fixit:settings:v1";
const HEX = /^#[0-9a-f]{6}$/i;

// 保存された値や取り込んだ JSON を、安全な形に直す(壊れた値は初期値に戻す)
function clean(raw: unknown, base: Settings = DEFAULTS): Settings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...base } as Record<string, unknown>;
  for (const d of DEFS) {
    const v = r[d.id];
    if (typeof v !== typeof d.def) continue;
    if (d.kind === "num") { if (Number.isFinite(v)) out[d.id] = Math.min(d.max!, Math.max(d.min!, v as number)); }
    else if (d.kind === "enum") { if (d.opts!.some(([k]) => k === v)) out[d.id] = v; }
    else if (d.kind === "font") { if (d.opts!.some(([k]) => k === v) || (typeof v === "string" && v.startsWith(LOCAL) && v.length > LOCAL.length && v.length < 120)) out[d.id] = v; }
    else out[d.id] = v;
  }
  if (r.mode === "light" || r.mode === "dark" || r.mode === "auto") out.mode = r.mode;
  if (typeof r.accent === "string" && HEX.test(r.accent)) out.accent = r.accent;
  if (Array.isArray(r.dots)) {
    const dots = r.dots.filter((d): d is Dot => !!d && typeof d.x === "number" && typeof d.y === "number" && typeof d.c === "string" && HEX.test(d.c)).slice(0, MAX_DOTS);
    if (dots.length) out.dots = dots;
  }
  if (r.keys && typeof r.keys === "object") out.keys = Object.fromEntries(Object.entries(r.keys).filter(([, v]) => typeof v === "string"));
  if (r.runners) out.runners = cleanRunners(r.runners);
  return out as Settings;
}

let s: Settings = (() => {
  try { return clean(JSON.parse(kvGet(KEY) || "{}")); } catch { return DEFAULTS; }
})();
const subs = new Set<() => void>();

export const isDark = (x: Settings) => x.mode === "dark" || (x.mode === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);

export function wallpaper(dots: Dot[], dark: boolean, dim = 58) {
  const layers = dots.map((d) => `radial-gradient(78% 78% at ${d.x}% ${d.y}%, ${d.c} 0%, transparent 72%)`);
  const a = (dim / 100).toFixed(2);
  const veil = dark && dim > 0 ? `linear-gradient(rgba(8,10,16,${a}), rgba(8,10,16,${a})), ` : "";
  return `${veil}${layers.join(", ")}, ${dark ? "#0f1117" : "#c6d5ea"}`;
}

// 動きの速さ。CSS の --sp と同じ倍率を、setTimeout の待ち時間にも掛ける
const SPEED: Record<string, number> = { off: 0, fast: 0.6, normal: 1, slow: 1.6 };
export const ms = (t: number) => Math.round(t * (SPEED[s.speed] ?? 1));

function apply() {
  const r = document.documentElement, dark = isDark(s), next = dark ? "dark" : "light";
  if (s.themeFade && r.dataset.theme && r.dataset.theme !== next) {
    r.classList.add("theme-fade");
    setTimeout(() => r.classList.remove("theme-fade"), ms(500));
  }
  r.dataset.theme = next;
  setWinTheme(dark).catch(() => {});
  r.style.setProperty("--accent", s.accent);
  r.style.setProperty("--wall", wallpaper(s.dots, dark, s.dim));
  const v = s as unknown as Record<string, number | boolean | string>;
  for (const d of DEFS) {
    const x = v[d.id];
    if (d.css) r.style.setProperty(d.css, d.fmt ? (d.fmt as (a: unknown) => string)(x) : `${x}${d.unit ?? ""}`);
    if (d.attr) r.setAttribute(`data-${d.attr}`, typeof x === "boolean" ? (x ? "on" : "off") : String(x));
  }
}

function commit(next: Settings) {
  s = next;
  try { kvSet(KEY, JSON.stringify(s)); } catch { /* 保存できなくても動かす */ }
  apply();
  subs.forEach((f) => f());
}

export const get = () => s;
export const subscribe = (f: () => void) => (subs.add(f), () => { subs.delete(f); });
export const update = (patch: Partial<Settings>) => commit({ ...s, ...patch });
export const isChanged = (d: AnyDef) => (s as unknown as Record<string, unknown>)[d.id] !== d.def;
export const changedCount = () => DEFS.filter(isChanged).length;
export const resetOne = (id: string) => { const d = DEFS.find((x) => x.id === id); if (d) commit({ ...s, [d.id]: d.def }); };
// 見た目と各項目を初期値に戻す(ショートカットは、別に戻す)
export const resetAll = () => commit({ ...DEFAULTS, keys: s.keys, runners: s.runners });
export const exportJson = () => JSON.stringify(s, null, 2);
export function importJson(text: string) {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("設定のファイルではありません");
  commit(clean(raw));
}

apply();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (s.mode === "auto") { s = { ...s }; apply(); subs.forEach((f) => f()); } });

export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => s);

// 他のウィンドウが設定を変えたら取り込む(こちらに保存前の変更があるときは、こちらを優先する)。
// 取り込みによる変更は、履歴・プロファイルへは書き戻さない(変えたウィンドウが済ませているため)
let fromOther = false;
export const fromOtherWindow = () => fromOther;
// 同期で送る形。この PC のフォント("local:…")は、ほかの PC にないので除く
export function syncExport(raw: string | null): string {
  try {
    const r = JSON.parse(raw || "{}") as Record<string, unknown>;
    for (const d of DEFS) if (d.kind === "font" && typeof r[d.id] === "string" && (r[d.id] as string).startsWith(LOCAL)) delete r[d.id];
    return JSON.stringify(r);
  } catch { return "{}"; }
}
// 同期で取り込んだときも、これを呼ぶ
export function reloadFromStore() {
  try { s = clean(JSON.parse(kvGet(KEY) || "{}")); } catch { return; }
  fromOther = true;
  try { apply(); subs.forEach((f) => f()); } finally { fromOther = false; }
}
kvWatch(KEY, (_f, dirty) => { if (!dirty) reloadFromStore(); });
