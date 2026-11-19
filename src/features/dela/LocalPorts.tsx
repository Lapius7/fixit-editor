// 「ローカルで公開」: 名前.localhost でこの PC のポートに入れるようにする(外には出ない)
import { useEffect, useState } from "react";
import { Copy, ExternalLink, X } from "lucide-react";
import i18next from "i18next";
import { validPort } from "./dela";
import { addLocal, ensureLocal, loadLocals, localUrl, removeLocal, validLocalName, type Local } from "./localport";

type Props = { open: boolean; defaultPort: string; onCopy: (url: string) => void; onOpen: (url: string) => void };

export function LocalPorts({ open, defaultPort, onCopy, onOpen }: Props) {
  const [list, setList] = useState<Local[]>(loadLocals);
  const [name, setName] = useState(""), [port, setPort] = useState(defaultPort);
  const [base, setBase] = useState<number | null>(null), [err, setErr] = useState("");
  useEffect(() => { if (open) void ensureLocal().then((r) => { if (r.ok) { setBase(r.base); setErr(""); } else setErr(r.error); }); }, [open]);
  const ok = validLocalName(name) && validPort(port);
  const add = async () => {
    if (!ok) return;
    const e = await addLocal(name, port);
    setErr(e ?? ""); setList(loadLocals());
    if (!e) { setName(""); const r = await ensureLocal(); if (r.ok) setBase(r.base); }
  };
  const url = (n: string) => localUrl(n, base ?? undefined);
  return (
    <>
      <h3 className="ports-sec">{i18next.t("ローカルで公開")}{list.length > 0 && <span className="ports-count">{list.length}</span>}</h3>
      <form className="ports-new" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input className="ports-name" aria-label={i18next.t("名前")} title={i18next.t("名前.localhost で開けるようにします(英小文字・数字・ハイフン)")} placeholder={i18next.t("名前(例: myapp)")} value={name} spellCheck={false} onChange={(e) => setName(e.target.value.trim().toLowerCase())} aria-invalid={(!!name && !validLocalName(name)) || undefined} />
        <input inputMode="numeric" aria-label={i18next.t("ポート")} placeholder="3000" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={!validPort(port) || undefined} style={{ flex: "0 0 72px" }} />
        <button type="submit" className="ports-go" disabled={!ok}>{i18next.t("登録")}</button>
      </form>
      {err && <p className="ports-note" role="alert">{err}</p>}
      {list.length === 0 && !err && <p className="ports-note">{i18next.t("この PC の中だけで、ポート番号の代わりに名前で開けます。")}</p>}
      {list.map((l) => (
        <div key={l.name} className="ports-row">
          <button className="ports-row-main" title={i18next.t("ブラウザで開く")} onClick={() => onOpen(url(l.name))}>
            <span className="ports-port">:{l.port}</span>
            <span className="ports-url truncate">{`${l.name}.localhost${base && base !== 80 ? `:${base}` : ""}`}</span>
          </button>
          <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(url(l.name))}><Copy /></button>
          <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(url(l.name))}><ExternalLink /></button>
          <button className="icon-btn" aria-label={i18next.t("登録を外す")} title={i18next.t("登録を外す")} onClick={() => { void removeLocal(l.name).then(() => setList(loadLocals())); }}><X /></button>
        </div>
      ))}
    </>
  );
}
