// ショートカットの定義。key は "Mod+Shift+P" の形(Mod は Ctrl または Cmd)。空文字は未割り当て
export type KeyDef = { id: string; label: string; group: string; key: string; scope?: "editor"; inTerm?: boolean };

const G = { app: "全般", view: "表示", tab: "タブ", find: "検索", edit: "編集", line: "行", fold: "折りたたみ", sel: "選択", term: "ターミナル" };
const d = (group: string, id: string, label: string, key: string, o: Partial<KeyDef> = {}): KeyDef => ({ id, label, group, key, ...o });
const e = { scope: "editor" as const };

export const KEYS: KeyDef[] = [
  d(G.app, "palette", "コマンドパレット", "Mod+Shift+P", { inTerm: true }),
  d(G.app, "quickOpen", "ファイルを開く", "Mod+P", { inTerm: true }),
  d(G.app, "save", "保存", "Mod+S"),
  d(G.app, "openFolder", "フォルダを開く", "Mod+O"),
  d(G.app, "addFolder", "フォルダをワークスペースに追加", ""),
  d(G.app, "connect", "WSL・SSH のフォルダを開く", "Mod+Alt+O"),
  d(G.app, "stats", "統計を見る", "Mod+Alt+I", { inTerm: true }),
  d(G.app, "workspaces", "ワークスペースを開く・切り替える", "Mod+Alt+E", { inTerm: true }),
  d(G.app, "saveWorkspace", "いまの状態をワークスペースに保存", "Mod+Alt+Shift+S"),
  d(G.app, "profiles", "プロファイルを切り替える", "Mod+Alt+Y", { inTerm: true }),
  d(G.app, "newFile", "新規ファイル", "Alt+N"),
  d(G.app, "settings", "設定", "Mod+,", { inTerm: true }),
  d(G.app, "shortcuts", "キーボードショートカット", "Mod+Alt+K", { inTerm: true }),
  d(G.view, "toggleSide", "サイドバーの表示", "Mod+B", { inTerm: true }),
  d(G.view, "togglePreview", "Markdown・HTML のプレビューを切り替え", "Mod+Alt+V"),
  d(G.view, "toggleBrowser", "ブラウザの表示", "Mod+Alt+B"),
  d(G.view, "toggleAi", "AI パネルの表示", "Mod+Alt+A"),
  d(G.view, "toggleTerm", "ターミナルの表示", "Mod+J", { inTerm: true }),
  d(G.view, "toggleSplit", "分割表示", "Mod+\\", { inTerm: true }),
  d(G.view, "otherPane", "もう一方の画面へ移る", "Mod+Shift+\\"),
  d(G.view, "swapPanes", "2つの画面を入れ替える", "Mod+Alt+Shift+\\", { inTerm: true }),
  d(G.view, "moveTab", "このタブをもう一方の画面へ送る", "Mod+Alt+\\"),
  d(G.view, "splitDir", "分割の向きを切り替える", "", { inTerm: true }),
  d(G.view, "closePane", "分割を解除して、この画面だけにする", "", { inTerm: true }),
  d(G.view, "explorer", "ファイル一覧を表示", "Mod+Shift+E", { inTerm: true }),
  d(G.view, "toggleTheme", "ライト / ダークを切り替え", "Mod+Alt+T", { inTerm: true }),
  d(G.view, "themePanel", "テーマを編集(右のパネル)", "Mod+Alt+Shift+T", { inTerm: true }),
  d(G.view, "zoomIn", "文字を大きく", "Mod+="),
  d(G.view, "zoomOut", "文字を小さく", "Mod+-"),
  d(G.view, "zoomReset", "文字の大きさを戻す", "Mod+0"),
  d(G.view, "wrap", "折り返しの切り替え", "Alt+Z"),
  d(G.tab, "closeTab", "タブを閉じる", "Alt+W"),
  d(G.tab, "closeAll", "すべてのタブを閉じる", "Alt+Shift+W"),
  d(G.tab, "nextTab", "次のタブ", "Alt+]"),
  d(G.tab, "prevTab", "前のタブ", "Alt+["),
  d(G.edit, "shot", "コードを画像にする(選択範囲、なければ全体)", "Mod+Alt+P"),
  d(G.find, "searchAll", "全文検索", "Mod+Shift+F", { inTerm: true }),
  d(G.find, "find", "検索", "Mod+F", e),
  d(G.find, "replace", "置換", "Mod+H", e),
  d(G.find, "findNext", "次を検索", "F3", e),
  d(G.find, "findPrev", "前を検索", "Shift+F3", e),
  d(G.find, "gotoLine", "行へ移動", "Mod+G", e),
  d(G.sel, "selectNext", "次の同じ語も選択", "Mod+D", e),
  d(G.sel, "selectMatches", "同じ語をすべて選択", "Mod+Shift+L", e),
  d(G.sel, "selectLine", "行を選択", "Mod+L", e),
  d(G.edit, "undo", "元に戻す", "Mod+Z", e),
  d(G.edit, "redo", "やり直す", "Mod+Shift+Z", e),
  d(G.edit, "comment", "行コメントの切り替え", "Mod+/", e),
  d(G.edit, "blockComment", "ブロックコメントの切り替え", "Shift+Alt+A", e),
  d(G.edit, "indentMore", "インデントを増やす", "Mod+]", e),
  d(G.edit, "indentLess", "インデントを減らす", "Mod+[", e),
  d(G.edit, "upper", "大文字にする", "Mod+Shift+U", e),
  d(G.edit, "lower", "小文字にする", "Mod+Alt+U", e),
  d(G.edit, "cut", "切り取り", ""), d(G.edit, "copy", "コピー", ""), d(G.edit, "paste", "貼り付け", ""),
  d(G.line, "dupDown", "行を下に複製", "Shift+Alt+ArrowDown", e),
  d(G.line, "dupUp", "行を上に複製", "Shift+Alt+ArrowUp", e),
  d(G.line, "moveDown", "行を下へ移動", "Alt+ArrowDown", e),
  d(G.line, "moveUp", "行を上へ移動", "Alt+ArrowUp", e),
  d(G.line, "deleteLine", "行を削除", "Mod+Shift+K", e),
  d(G.line, "blankBelow", "下に空行を挿入", "Mod+Enter", e),
  d(G.line, "sortLines", "行を並べ替え", "", e),
  d(G.line, "trimSpace", "行末の空白を削除", "", e),
  d(G.fold, "fold", "折りたたむ", "Mod+Shift+[", e),
  d(G.fold, "unfold", "展開する", "Mod+Shift+]", e),
  d(G.fold, "foldAll", "すべて折りたたむ", "Mod+Alt+[", e),
  d(G.fold, "unfoldAll", "すべて展開", "Mod+Alt+]", e),
  d(G.term, "newTerm", "新しいターミナル", "Mod+Shift+`", { inTerm: true }),
  d(G.term, "closeTerm", "ターミナルを閉じる", "Mod+Alt+W", { inTerm: true }),
  d(G.term, "nextTerm", "次のターミナル", "Mod+Alt+.", { inTerm: true }),
  d(G.term, "prevTerm", "前のターミナル", "Mod+Alt+,", { inTerm: true }),
  d(G.term, "renameTerm", "ターミナルの名前を変える", "", { inTerm: true }),
  d(G.term, "clearTerm", "ターミナルの画面を消す", "", { inTerm: true }),
];

export const DEF = Object.fromEntries(KEYS.map((k) => [k.id, k])) as Record<string, KeyDef>;
export const keyOf = (id: string, over: Record<string, string>) => over[id] ?? DEF[id]?.key ?? "";

// 録音中は全体のショートカットを止める
export const rec = { on: false };

const CODE: Record<string, string> = { Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Space: "Space" };
const MOD_ONLY = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"]);

export function comboOf(ev: KeyboardEvent): string | null {
  if (MOD_ONLY.has(ev.key) || ev.isComposing) return null;
  let k: string;
  if (/^Key[A-Z]$/.test(ev.code)) k = ev.code.slice(3);
  else if (/^Digit\d$/.test(ev.code)) k = ev.code.slice(5);
  else if (CODE[ev.code]) k = ev.shiftKey ? CODE[ev.code] : ev.key.length === 1 ? ev.key : CODE[ev.code];
  else k = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  const p: string[] = [];
  if (ev.ctrlKey || ev.metaKey) p.push("Mod");
  if (ev.altKey) p.push("Alt");
  if (ev.shiftKey) p.push("Shift");
  return [...p, k].join("+");
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform);
const NAME: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Escape: "Esc", Backspace: "⌫", Delete: "Del", Space: "Space" };
export const chips = (combo: string): string[] =>
  combo ? combo.split(/\+(?=.)/).map((p) => (p === "Mod" ? (isMac() ? "⌘" : "Ctrl") : p === "Alt" && isMac() ? "⌥" : p === "Shift" && isMac() ? "⇧" : NAME[p] ?? p)) : [];

// 重複を調べるための、組み合わせ → 機能の対応表
export function table(over: Record<string, string>) {
  const m = new Map<string, string>();
  for (const k of KEYS) { const c = keyOf(k.id, over); if (c && !m.has(c)) m.set(c, k.id); }
  return m;
}
