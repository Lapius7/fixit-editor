import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import i18next from 'i18next'

export const langName = (file: string) => LanguageDescription.matchFilename(languages, file)?.name ?? i18next.t("テキスト");
