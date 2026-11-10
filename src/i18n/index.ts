import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/i18n/locales/en.json";
import ko from "@/i18n/locales/ko.json";
import { get, subscribe } from "@/features/settings/settings";

// 日本語の原文をそのままキーにする。ja.json は空でも、キーがそのまま出る。
export const LANGS = [["ja", "日本語"], ["en", "English"], ["ko", "한국어"]] as const;
export type Lang = (typeof LANGS)[number][0];

// 「自動」のとき、OS の言語から選ぶ
function osLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    const c = l.toLowerCase().slice(0, 2);
    if (c === "ja" || c === "ko" || c === "en") return c;
  }
  return "en";
}
const resolve = (v: string): Lang => (v === "ja" || v === "en" || v === "ko" ? v : osLang());

i18next.use(initReactI18next).init({
  lng: resolve(get().lang),
  fallbackLng: "ja",
  resources: { en: { translation: en }, ko: { translation: ko }, ja: { translation: {} } },
  keySeparator: false,
  nsSeparator: false,
  returnEmptyString: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const apply = () => {
  const l = resolve(get().lang);
  if (i18next.language !== l) i18next.changeLanguage(l);
  document.documentElement.lang = l;
};
apply();
subscribe(apply);
export default i18next;
