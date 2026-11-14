// 公開中のポートのログ(モーダル)。「リクエスト」は dela --inspect が記録した、受けたリクエストを 2 秒ごとに読む。「出力」は dela 自身の出力(接続・再接続)をそのまま流す。
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Copy, ExternalLink, ScrollText, Trash2 } from "lucide-react";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";
import type { Conn } from "@/platform/remote";
import { shortUrl, type Pub } from "./dela";
import { fetchReqs, fmtMs, fmtSize, fmtTime, inspectBase, logClear, logInspect, logLines, logSubscribe, logVersion, type Req } from "./logs";

const POLL_MS = 2000;
const SHOW = 200; // 表示するリクエストの数(新しいものから)

export default function PortLog({ pub, conn, out, onClose, onCopy, onOpen }: { pub: Pub; conn?: Conn; out?: boolean; onClose: () => void; onCopy: (u: string) => void; onOpen: (u: string) => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".ask-layer, .sel-list")) close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const [tab, setTab] = useState<"req" | "out">("req");
  useSyncExternalStore((f) => logSubscribe(pub.id, f), () => logVersion(pub.id)); // 出力が増えたら描き直す
  const lines = logLines(pub.id);
  const base = inspectBase(logInspect(pub.id));
  const dir = pub.dir ?? conn?.path ?? "";

  // 受けたリクエスト
  const [reqs, setReqs] = useState<Req[]>([]);
  const [bad, setBad] = useState(false);
  const [hide, setHide] = useState(0); // クリアしたときの最後の番号。これ以前は出さない
  useEffect(() => {
    if (!conn || !base || tab !== "req" || pub.state === "fail") return;
    let stop = false, t: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await fetchReqs(conn, dir, base);
      if (stop) return;
      if (r) { setReqs(r); setBad(false); } else setBad(true);
      t = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => { stop = true; clearTimeout(t); };
  }, [conn, base, dir, tab, pub.state]);
  const shown = reqs.filter((r) => r.id > hide).reverse().slice(0, SHOW);

  // 出力は、いちばん下を見ているときだけ、増えた分に合わせて下へ送る
  const box = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => { const b = box.current; if (b && stuck.current) b.scrollTop = b.scrollHeight; }, [lines.length, lines[lines.length - 1], tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const clear = () => { if (tab === "req") setHide(reqs.reduce((m, r) => Math.max(m, r.id), hide)); else logClear(pub.id); };

  const tag = pub.temp ? i18next.t("一時") : [pub.rel, pub.name].filter(Boolean).join(" · ");
  const empty = tab === "req"
    ? (!base ? (pub.state === "fail" ? i18next.t("公開できなかったので、リクエストはありません") : pub.state === "start" ? i18next.t("公開の準備をしています…") : i18next.t("リクエストの記録が見つかりません。dela を 0.5.0 以上にして、公開し直してください"))
      : bad ? i18next.t("リクエストを読み取れません(アプリ版で、curl が使えるか確かめてください)")
      : shown.length === 0 ? i18next.t("まだリクエストはありません。公開 URL にアクセスすると、ここに出ます") : "")
    : lines.length === 0 ? i18next.t("まだ出力はありません") : "";

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={close}>
      <div className="qo dlg ports-log" role="dialog" aria-label={i18next.t("ポートのログ")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="gh-top">
          <h2><ScrollText size={16} /><span>{i18next.t("ポートのログ")}</span></h2>
          <button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
        </header>
        <div className="pl-info">
          <span className="pl-port">:{pub.port}</span>
          {tag && <span className="ports-tag truncate" title={pub.dir}>{tag}</span>}
          <span className="pl-url truncate" title={pub.url ?? pub.note}>{pub.url ? shortUrl(pub.url) : pub.state === "fail" ? pub.note || i18next.t("公開できませんでした") : i18next.t("公開しています…")}</span>
          {pub.url && <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(pub.url!)}><Copy /></button>}
          {pub.url && <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(pub.url!)}><ExternalLink /></button>}
        </div>
        <div className="pl-bar">
          <div className="seg" role="group" aria-label={i18next.t("表示")}>
            <button aria-pressed={tab === "req"} onClick={() => setTab("req")}>{i18next.t("リクエスト")}</button>
            <button aria-pressed={tab === "out"} onClick={() => setTab("out")}>{i18next.t("出力")}</button>
          </div>
          <span className="pl-live" data-on={pub.state === "up" || undefined}>{pub.state === "up" ? i18next.t("リアルタイム") : pub.state === "fail" ? i18next.t("停止") : i18next.t("準備中")}</span>
          <button className="btn" onClick={clear} disabled={tab === "req" ? shown.length === 0 : lines.length === 0}><Trash2 size={14} /><span>{i18next.t("クリア")}</span></button>
        </div>
        {tab === "req" ? (
          <div className="pl-body pl-reqs" role="table" aria-label={i18next.t("リクエスト")}>
            {shown.map((r) => (
              <div key={r.id} className="pl-req" role="row" data-s={r.status >= 500 ? 5 : r.status >= 400 ? 4 : r.status >= 300 ? 3 : r.status >= 200 ? 2 : 0}>
                <span className="pl-time">{fmtTime(r.time)}</span>
                <span className="pl-method">{r.method}</span>
                <span className="pl-path truncate" title={`${r.path}${r.remote ? `\n${r.remote}` : ""}${r.note ? `\n${r.note}` : ""}`}>{r.path}</span>
                <span className="pl-status">{r.status || "—"}</span>
                <span className="pl-num">{fmtMs(r.durationMs)}</span>
                <span className="pl-num">{fmtSize(r.respSize)}</span>
              </div>
            ))}
            {empty && <p className="pl-empty">{empty}</p>}
          </div>
        ) : (
          <div className="pl-body pl-out" ref={box} onScroll={(e) => { const b = e.currentTarget; stuck.current = b.scrollHeight - b.scrollTop - b.clientHeight < 24; }}>
            {lines.map((l, i) => <div key={i} className="pl-line">{l}</div>)}
            {empty && <p className="pl-empty">{empty}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
