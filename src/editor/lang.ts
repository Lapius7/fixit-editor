import { LanguageDescription } from "@codemirror/language";
import { languages as base } from "@codemirror/language-data";
import i18next from 'i18next'

// 標準の一覧に無い言語(Mermaid)を足したもの
export const languages: LanguageDescription[] = [
  ...base,
  LanguageDescription.of({ name: "Mermaid", alias: ["mermaid", "mmd"], extensions: ["mmd", "mermaid"], load: () => import("codemirror-lang-mermaid").then((m) => m.mermaid()) }),
];

export const langName = (file: string) => LanguageDescription.matchFilename(languages, file)?.name ?? i18next.t("テキスト");
