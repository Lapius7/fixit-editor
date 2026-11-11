// AI の返答の中のコードブロック。上に言語とコピーのボタンを置き、エディタと同じ色で色分けする
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import i18next from "i18next";
import { LanguageDescription, type Language } from "@codemirror/language";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";
import { languages } from "@/editor/lang";
import { writeClip } from "@/platform/clipboard";
import { notify } from "@/shared/notify";
import { ms } from "@/features/settings/settings";

const COPIED_MS = 1600; // コピーしたしるし(チェック)を出しておく時間
const MAX_HIGHLIGHT = 60_000; // これより長いコードは色分けしない(流れてくる間に重くならないように)

// エディタの色分け(editor/theme.ts)と同じまとめ方で、クラスを付ける。色は CSS の --c-* から取る
const hl = tagHighlighter([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], class: "tk-kw" },
  { tag: [t.typeName, t.className, t.namespace], class: "tk-type" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: "tk-fn" },
  { tag: [t.string, t.special(t.string)], class: "tk-str" },
  { tag: [t.number, t.bool, t.null, t.atom], class: "tk-num" },
  { tag: [t.comment, t.lineComment, t.blockComment], class: "tk-com" },
  { tag: [t.propertyName, t.attributeName], class: "tk-prop" },
  { tag: [t.meta, t.annotation], class: "tk-meta" },
]);

const find = (name: string) => (name ? LanguageDescription.matchLanguageName(languages, name, true) : null);

// 言語の読み込みは一度だけ。読み終わったら描き直す
function useLanguage(name: string): Language | null {
  const d = useMemo(() => find(name), [name]);
  const [, bump] = useState(0);
  useEffect(() => {
    if (d && !d.support) void d.load().then(() => bump((n) => n + 1), () => {});
  }, [d]);
  return d?.support?.language ?? null;
}

function paint(code: string, lang: Language | null): ReactNode[] {
  if (!lang || code.length > MAX_HIGHLIGHT) return [code];
  const out: ReactNode[] = [];
  highlightCode(code, lang.parser.parse(code), hl,
    (text, cls) => out.push(cls ? <span key={out.length} className={cls}>{text}</span> : text),
    () => out.push("\n"));
  return out;
}

// コピーして、しるし(チェック)をしばらく出す。失敗したときだけトーストで知らせる
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), ms(COPIED_MS));
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: string) => void writeClip(text).then((ok) => (ok ? setCopied(true) : notify(i18next.t("コピーできませんでした"), "error")));
  return [copied, copy];
}

export const CodeBlock = memo(function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const language = useLanguage(lang);
  const body = useMemo(() => paint(text, language), [text, language]);
  const [copied, copy] = useCopy();
  const name = find(lang)?.name ?? lang;
  return (
    <figure className="ai-code">
      <figcaption>
        <span className="ai-code-lang">{name || i18next.t("コード")}</span>
        <button className="icon-btn ai-code-copy" data-done={copied} aria-label={copied ? i18next.t("コピーしました") : i18next.t("コードをコピー")} title={i18next.t("コードをコピー")} onClick={() => copy(text)}>
          <Copy className="ai-swap-a" aria-hidden /><Check className="ai-swap-b" aria-hidden />
        </button>
      </figcaption>
      <pre><code>{body}</code></pre>
    </figure>
  );
});
