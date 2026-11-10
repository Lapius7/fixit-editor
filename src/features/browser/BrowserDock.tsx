// アプリ内ブラウザ(iframe)。ローカルの開発サーバーの確認が主な用途
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ExternalLink, RotateCw, X } from "lucide-react";
import i18next from "i18next";
import { BROWSER_DEFAULT_URL } from "@/shared/config";

// 入力を URL にそろえる。http / https 以外(javascript: や data: など)と、エディタ自身のオリジンは受けない
export function toUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(:\d+)?(\/|$)/i.test(t);
  const guess = /^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[\w.-]+:\d+/.test(t) ? t : `${local ? "http" : "https"}://${t}`;
  try {
    const u = new URL(guess);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.origin === location.origin) return null;
    return u;
  } catch { return null; }
}

export default function BrowserDock({ onClose }: { onClose: () => void }) {
  const [input, setInput] = useState(BROWSER_DEFAULT_URL);
  const [url, setUrl] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [nonce, setNonce] = useState(0); // 同じ URL でも読み直すための番号
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); field.current?.select(); }, []);

  const go = () => {
    const u = toUrl(input);
    setBad(!u);
    if (!u) return;
    setInput(u.href); setUrl(u.href); setNonce((n) => n + 1);
  };

  return (
    <aside className="br-dock" aria-label={i18next.t("ブラウザ")}>
      <div className="br-bar">
        <input ref={field} className="br-url" data-bad={bad} value={input} spellCheck={false} placeholder={i18next.t("アドレスを入力")} aria-label={i18next.t("アドレス")}
          onChange={(e) => { setInput(e.target.value); setBad(false); }} onKeyDown={(e) => { if (e.key === "Enter") go(); if (e.key === "Escape") onClose(); }} />
        <button className="icon-btn" aria-label={i18next.t("開く")} title={i18next.t("開く")} onClick={go}><ArrowRight /></button>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} disabled={!url} onClick={() => setNonce((n) => n + 1)}><RotateCw /></button>
        <button className="icon-btn" aria-label={i18next.t("外部のブラウザで開く")} title={i18next.t("外部のブラウザで開く")} disabled={!url} onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}><ExternalLink /></button>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      {bad && <p className="br-note" role="alert">{i18next.t("http:// か https:// のアドレスを入力してください")}</p>}
      {url ? (
        <>
          <iframe key={nonce} className="br-frame" src={url} title={i18next.t("ブラウザ")} referrerPolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals" />
          <p className="br-note">{i18next.t("表示されないサイトは、サイト側が埋め込みを断っています。「外部のブラウザで開く」を使ってください")}</p>
        </>
      ) : (
        <p className="br-empty">{i18next.t("アドレスを入れて Enter。ローカルの開発サーバー(http://localhost:5173 など)の確認に向いています")}</p>
      )}
    </aside>
  );
}
