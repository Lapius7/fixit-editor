// 補完のスニペット。${1:名前} が入力欄になり、Tab で次へ、Shift+Tab で前へ進む
import { snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { language } from "@codemirror/language";
import i18next from "i18next";

const s = (label: string, template: string, detail?: string): Completion => snippetCompletion(template, { label, detail, type: "keyword", boost: 1 });

const jsList = (): Completion[] => [
  s("for", "for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${}\n}", i18next.t("for ループ")),
  s("forof", "for (const ${1:item} of ${2:items}) {\n\t${}\n}", "for…of"),
  s("if", "if (${1:cond}) {\n\t${}\n}", "if"),
  s("ifelse", "if (${1:cond}) {\n\t${}\n} else {\n\t\n}", "if…else"),
  s("fn", "function ${1:name}(${2:args}) {\n\t${}\n}", i18next.t("関数")),
  s("afn", "const ${1:name} = async (${2:args}) => {\n\t${}\n};", i18next.t("async 関数")),
  s("try", "try {\n\t${}\n} catch (${1:e}) {\n\t\n}", "try…catch"),
  s("class", "class ${1:Name} {\n\tconstructor(${2:args}) {\n\t\t${}\n\t}\n}", i18next.t("クラス")),
  s("switch", "switch (${1:value}) {\n\tcase ${2:x}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}", "switch"),
  s("log", "console.log(${1:value});", "console.log"),
  s("imp", "import ${1:name} from \"${2:module}\";", "import"),
];

const build = (): Record<string, Completion[]> => ({
  javascript: jsList(),
  python: [
    s("def", "def ${1:name}(${2:args}):\n\t${}", i18next.t("関数")),
    s("class", "class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${}", i18next.t("クラス")),
    s("if", "if ${1:cond}:\n\t${}", "if"),
    s("for", "for ${1:item} in ${2:items}:\n\t${}", i18next.t("for ループ")),
    s("try", "try:\n\t${}\nexcept ${1:Exception} as ${2:e}:\n\t", "try…except"),
    s("with", "with ${1:open(path)} as ${2:f}:\n\t${}", "with"),
    s("main", "if __name__ == \"__main__\":\n\t${}", i18next.t("エントリポイント")),
  ],
  rust: [
    s("fn", "fn ${1:name}(${2:args}) -> ${3:()} {\n\t${}\n}", i18next.t("関数")),
    s("struct", "struct ${1:Name} {\n\t${}\n}", i18next.t("構造体")),
    s("impl", "impl ${1:Name} {\n\t${}\n}", "impl"),
    s("match", "match ${1:value} {\n\t${2:_} => ${},\n}", "match"),
  ],
  go: [
    s("func", "func ${1:name}(${2:args}) ${3:error} {\n\t${}\n}", i18next.t("関数")),
    s("for", "for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t${}\n}", i18next.t("for ループ")),
    s("iferr", "if err != nil {\n\treturn ${1:err}\n}", i18next.t("エラー処理")),
  ],
  html: [
    s("html5", "<!doctype html>\n<html lang=\"${1:ja}\">\n<head>\n\t<meta charset=\"utf-8\">\n\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\t<title>${2:タイトル}</title>\n</head>\n<body>\n\t${}\n</body>\n</html>", i18next.t("HTML の骨組み")),
    s("link", "<link rel=\"stylesheet\" href=\"${1:style.css}\">", i18next.t("CSS 読み込み")),
    s("script", "<script src=\"${1:main.js}\"></script>", i18next.t("script 読み込み")),
    s("ul", "<ul>\n\t<li>${}</li>\n</ul>", i18next.t("リスト")),
  ],
  css: [
    s("flex", "display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};", "flex"),
    s("grid", "display: grid;\ngrid-template-columns: ${1:repeat(2, 1fr)};\ngap: ${2:8px};", "grid"),
    s("media", "@media (max-width: ${1:640px}) {\n\t${}\n}", i18next.t("メディアクエリ")),
  ],
  markdown: [
    s("link", "[${1:text}](${2:url})", i18next.t("リンク")),
    s("img", "![${1:alt}](${2:url})", i18next.t("画像")),
    s("code", "```${1:lang}\n${}\n```", i18next.t("コードブロック")),
    s("table", "| ${1:列1} | ${2:列2} |\n| --- | --- |\n| ${} |  |", i18next.t("表")),
  ],
});

// CodeMirror が返す言語名の別名(TS / JSX / TSX は JavaScript と同じ定型句を使う)
const ALIAS: Record<string, string> = { typescript: "javascript", jsx: "javascript", tsx: "javascript" };

// 言語を切り替えたときだけ作り直す(詳細の文言が訳されるため)
let cache: { lang: string; map: Record<string, Completion[]> } | null = null;
const table = () => (cache?.lang === i18next.language ? cache.map : (cache = { lang: i18next.language, map: build() }).map);

export function snippetSource(ctx: CompletionContext): CompletionResult | null {
  const w = ctx.matchBefore(/[A-Za-z0-9_]+/);
  if (!w && !ctx.explicit) return null;
  // obj.l のようにメンバーを打っているときは定型句を出さない(console.l で console.console.log になるため)
  if (/(?:\.|->|::)$/.test(ctx.state.sliceDoc(Math.max(0, (w ? w.from : ctx.pos) - 2), w ? w.from : ctx.pos))) return null;
  const name = ctx.state.facet(language)?.name ?? "";
  const list = table()[ALIAS[name] ?? name];
  if (!list?.length) return null;
  return { from: w ? w.from : ctx.pos, options: list, validFor: /^[A-Za-z0-9_]*$/ };
}
