// 右側のポート管理パネル。上: 新しい公開(名前とポート)と、使用中の一覧(停止)。下: 保存した名前ごとの URL(再公開・コピー・開く・作り直し)。
// 名前ごとに URL の元(トークン)が別で、プロジェクトのフォルダには何も作らない。同じ名前なら、どのフォルダを開いていても同じ URL で公開できる。
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, Globe, ChevronRight, Play, Plus, Shuffle, Square, X } from "lucide-react";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";
import { ask } from "@/shared/ask";
import type { Conn } from "@/platform/remote";
import { DEFAULT_NAME, shortUrl, validName, validPort, type Pub } from "./dela";
import { forgetSlot, loadSlots, scopeOf, type Slot } from "./slots";
import { LocalPorts } from "./LocalPorts";
import { localAvailable } from "./localport";
import { delaRunning, delaSlotInfo, delaSlotRenew, type SlotInfo } from "./projects";

type Opt = { name?: string; temp?: boolean };
type Props = {
  open: boolean;
  items: Pub[];
  conn?: Conn;
  rootPath?: string;
  onClose: () => void;
  onPublish: (port: string, o: Opt) => void;
  onStop: (id: number) => void;
  onCopy: (url: string) => void;
  onOpen: (url: string) => void;
  onLog: (id: number) => void;
};

type Row = SlotInfo & { busy?: boolean };
const nameOf = (d: Pub) => d.name || DEFAULT_NAME;

export function PortsPanel({ open, items, conn, rootPath, onClose, onPublish, onStop, onCopy, onOpen, onLog }: Props) {
  const [mounted, setMounted] = useState(open);
  const [port, setPort] = useState("5173");
  const [name, setName] = useState(DEFAULT_NAME); // 公開する名前。app は名前を付けない既定の URL
  const [fresh, setFresh] = useState(false); // 新しい名前を打っているか
  const [adv, setAdv] = useState(false); // 「別の URL・一時公開」を開いているか
  const [temp, setTemp] = useState(false); // 一時公開(設定を使わず、終了で URL を捨てる)
  const [infos, setInfos] = useState<Record<string, Row | undefined>>({});
  const [running, setRunning] = useState<string[]>([]); // 起動中のトンネルの URL(dela list)
  const [tick, setTick] = useState(0); // 一覧の読み直し
  const asked = useRef(new Set<string>());
  const portRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setMounted(true); return; } const h = setTimeout(() => setMounted(false), ms(260)); return () => clearTimeout(h); }, [open]);

  const scope = scopeOf(conn);
  const dir = conn?.path ?? rootPath ?? "";
  const keyOf = (n: string) => `${scope}\u0000${n}`;
  // 公開が増減したとき(URL が出たとき)に、名前の一覧とポートを読み直す
  const sig = items.map((d) => `${d.id}:${d.state}:${d.url ?? ""}`).join();
  const slots = useMemo<Slot[]>(() => {
    const list = loadSlots(scope);
    for (const d of items) if (!d.temp && !list.some((s) => s.name === nameOf(d))) list.push({ name: nameOf(d), port: d.port, at: 0 });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, open, sig, tick]);

  // 名前ごとの URL(dela info)。順に 1 つずつ確かめる。URL が出た名前は取り直す
  const load = async (n: string) => {
    if (!conn) return;
    const k = keyOf(n);
    asked.current.add(k);
    setInfos((m) => ({ ...m, [k]: { ok: true, found: m[k]?.found ?? false, url: m[k]?.url, note: "", busy: true } }));
    const r = await delaSlotInfo(conn, dir, n);
    setInfos((m) => ({ ...m, [k]: r }));
  };
  useEffect(() => {
    if (!open || !conn) return;
    for (const d of items) if (d.url && !d.temp && infos[keyOf(nameOf(d))]?.url !== d.url) asked.current.delete(keyOf(nameOf(d)));
    let stop = false;
    void (async () => {
      for (const s of slots) {
        if (stop) return;
        if (!asked.current.has(keyOf(s.name))) await load(s.name);
      }
    })();
    return () => { stop = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, slots, conn]);

  // 起動中の URL: 開いたとき・アプリ内の公開が変わったときに取り直す(別のターミナルや前の起動で動いているものも拾う)
  useEffect(() => {
    if (!open || !conn) return;
    let stop = false;
    const h = setTimeout(() => { void delaRunning(conn, dir).then((r) => { if (!stop) setRunning(r); }); }, 600);
    return () => { stop = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scope, sig, tick]);

  const live = new Set([...running, ...items.filter((d) => d.url && d.state !== "fail").map((d) => d.url!)]);
  const liveItem = (n: string) => items.find((d) => !d.temp && d.state !== "fail" && nameOf(d) === n);

  const renew = async (n: string) => {
    if (!conn) return;
    if (!(await ask({ message: i18next.t("「{{name}}」の URL を作り直します。いまの URL は使えなくなります。続けますか?", { name: n }), ok: i18next.t("作り直す"), danger: true }))) return;
    const k = keyOf(n);
    setInfos((m) => ({ ...m, [k]: { ok: true, found: true, url: m[k]?.url, note: "", busy: true } }));
    await delaSlotRenew(conn, dir, n);
    await load(n); // 新しい URL を取り直す
  };
  const forget = async (n: string) => {
    if (!(await ask({ message: i18next.t("「{{name}}」を一覧から外します。同じ名前で公開すれば、同じ URL に戻ります。", { name: n }), ok: i18next.t("外す") }))) return;
    forgetSlot(scope, n);
    setTick((x) => x + 1);
    if (name === n) setName(DEFAULT_NAME);
  };
  // 公開を止める: 公開中の URL は使えなくなるので、確認してから止める(失敗した行を閉じるだけのときは確認しない)
  const stop = async (d: Pub) => {
    if (d.state !== "fail" && !(await ask({ message: i18next.t("この公開を止めます。公開中の URL は使えなくなります。続けますか?"), ok: i18next.t("止める"), danger: true }))) return;
    onStop(d.id);
  };
  // 公開する。同じ名前がほかのポートで公開中なら、止めて切り替える(1 つの URL には 1 つのポートだけ)
  const publish = async (p: string, o: Opt) => {
    const n = o.name ?? DEFAULT_NAME;
    const cur = o.temp ? undefined : liveItem(n);
    if (cur && cur.port !== p) {
      if (!(await ask({ message: i18next.t("「{{name}}」はポート {{from}} で公開中です。ポート {{to}} に切り替えますか?", { name: n, from: cur.port, to: p }), ok: i18next.t("切り替える") }))) return;
      onStop(cur.id);
      await new Promise((r) => setTimeout(r, 900)); // 前のトンネルが閉じて、URL が空くのを待つ
    }
    onPublish(p, o);
  };
  // ▷: 押した名前を最後のポートで公開する。ポートの記録がなければ、上の欄に名前を入れるだけ
  const again = (s: Slot) => {
    setTemp(false); setFresh(false); setName(s.name);
    if (s.port && validPort(s.port)) { setPort(s.port); void publish(s.port, { name: s.name }); } else portRef.current?.focus();
  };
  const pickName = (n: string) => { setFresh(false); setName(n); const hp = slots.find((s) => s.name === n)?.port; if (hp) setPort(hp); };

  if (!open && !mounted) return null;
  const nameOk = !fresh || (validName(name) && name !== DEFAULT_NAME); // 新しい名前は、空や app のままでは公開できない
  const ok = validPort(port) && (temp || nameOk);
  const go = () => { if (ok) void publish(port.trim(), { temp, name: temp ? undefined : name }); };
  const sel = infos[keyOf(name)];
  // 名前が 2 つ以上ある・app 以外を選んでいる・一時公開のときは、折りたたまずに出す
  const forced = temp || fresh || name !== DEFAULT_NAME || slots.length > 1;
  const showAdv = adv || forced;
  return (
    <aside className="ai-dock ports-dock" data-closing={!open} aria-label={i18next.t("ポート管理")} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div className="ai-bar">
        <span className="ai-title"><Globe size={15} /><span className="truncate">{i18next.t("ポート管理")}</span></span>
        <button className="icon-btn" aria-label={i18next.t("閉じる")} title={i18next.t("閉じる")} onClick={onClose}><X /></button>
      </div>
      <div className="ports-top scroll">
        <h3 className="ports-sec">{i18next.t("新しく公開")}</h3>
        <form className="ports-new" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <input ref={portRef} inputMode="numeric" aria-label={i18next.t("公開するポート")} placeholder="3000" value={port} onChange={(e) => setPort(e.target.value)} aria-invalid={!validPort(port) || undefined} />
          <button type="submit" className="ports-go" disabled={!ok}>{i18next.t("公開する")}</button>
        </form>
        {!forced && (
          <button type="button" className="ports-more" aria-expanded={adv} onClick={() => setAdv((x) => !x)}>
            <ChevronRight size={12} />
            <span>{i18next.t("別の URL・一時公開")}</span>
          </button>
        )}
        {showAdv && (
          <>
        <div className="ports-proj">
          <div className="seg ports-mode" role="group" aria-label={i18next.t("公開のしかた")}>
            <button type="button" aria-pressed={!temp} onClick={() => setTemp(false)}>{i18next.t("名前で公開")}</button>
            <button type="button" aria-pressed={temp} onClick={() => setTemp(true)}>{i18next.t("一時公開")}</button>
          </div>
        </div>
        {!temp && (
          <div className="ports-names" role="group" aria-label={i18next.t("公開する名前")}>
            <span className="ports-names-l">{i18next.t("公開する名前")}</span>
            {slots.map((s) => (
              <button key={s.name} type="button" className="ports-chip" aria-pressed={!fresh && name === s.name} onClick={() => pickName(s.name)}>{s.name}</button>
            ))}
            <button type="button" className="ports-chip ports-chip-new" aria-pressed={fresh} onClick={() => { setFresh(true); setName(""); }}><Plus size={12} /><span>{i18next.t("新しい名前")}</span></button>
          </div>
        )}
        {!temp && fresh && (
          <div className="ports-new">
            <input className="ports-name" autoFocus aria-label={i18next.t("新しい名前")} title={i18next.t("別の URL で公開するときの名前(英小文字・数字・ハイフンで 20 文字まで)")} placeholder={i18next.t("英小文字・数字・ハイフン(20 文字まで)")} value={name} spellCheck={false} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); portRef.current?.focus(); } }} aria-invalid={(!!name && !nameOk) || undefined} />
          </div>
        )}
        {!temp && fresh && name === DEFAULT_NAME && <p className="ports-note">{i18next.t("「app」は、最初から使える名前です。ほかの名前にしてください")}</p>}
          </>
        )}
        {temp ? (
          <p className="ports-note">{i18next.t("使い捨ての URL で公開します。終了すると URL は破棄され、設定は残りません。")}</p>
        ) : !fresh && sel && !sel.busy ? (
          <p className="ports-note">{sel.url ? i18next.t("URL: {{url}}(ポートを変えても、同じ名前なら同じ URL です)", { url: shortUrl(sel.url) }) : i18next.t("初めての公開で URL が決まり、次からも同じ URL を使えます。")}</p>
        ) : null}
        <h3 className="ports-sec">{i18next.t("使用中")}{items.length > 0 && <span className="ports-count">{items.length}</span>}</h3>
        {items.length === 0 && <p className="ports-empty">{i18next.t("公開しているポートはありません")}</p>}
        {items.map((d) => (
          <div key={d.id} className="ports-row">
            <button className="ports-row-main" title={i18next.t("ログを見る")} aria-label={i18next.t("ポート {{port}} のログを見る", { port: d.port })} onClick={() => onLog(d.id)}>
              <span className="ports-port">:{d.port}</span>
              <span className="ports-tag truncate">{d.temp ? i18next.t("一時") : nameOf(d)}</span>
              <span className="ports-url truncate" data-wait={!d.url || undefined} data-fail={d.state === "fail" || undefined} title={d.url ?? d.note}>
                {d.url ? shortUrl(d.url) : (d.state === "fail" ? d.note || i18next.t("公開できませんでした") : i18next.t("公開しています…"))}
              </span>
            </button>
            {d.url && <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(d.url!)}><Copy /></button>}
            {d.url && <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(d.url!)}><ExternalLink /></button>}
            <button className="icon-btn" aria-label={d.state === "fail" ? i18next.t("閉じる") : i18next.t("公開を止める")} title={d.state === "fail" ? i18next.t("閉じる") : i18next.t("公開を止める")} onClick={() => void stop(d)}>{d.state === "fail" ? <X /> : <Square />}</button>
          </div>
        ))}
        {localAvailable && <LocalPorts open={open} defaultPort={port} onCopy={onCopy} onOpen={onOpen} />}
      </div>
      <section className="ports-bottom" aria-label={i18next.t("保存した URL")}>
        <h3 className="ports-sec ports-sec-bar">
          <span>{i18next.t("保存した URL")}<span className="ports-count">{slots.length}</span></span>
        </h3>
        <div className="ports-plist scroll">
          {slots.map((s) => {
            const inf = infos[keyOf(s.name)];
            const run = liveItem(s.name);
            const on = !temp && !fresh && name === s.name;
            const url = run?.url ?? inf?.url;
            return (
              <div key={s.name} className="ports-proj-row" data-on={on || undefined}>
                <div className="ports-proj-head">
                  <button className="ports-proj-main" title={i18next.t("この名前を上の欄に入れる")} onClick={() => { setTemp(false); pickName(s.name); portRef.current?.focus(); }}>
                    <span className="truncate">{s.name}</span>
                  </button>
                  {s.port && <span className="ports-tag">{`:${s.port}`}</span>}
                  {run ? (
                    <button className="icon-btn" aria-label={i18next.t("公開を止める")} title={i18next.t("公開を止める")} onClick={() => void stop(run)}><Square /></button>
                  ) : (
                    <button className="icon-btn" aria-label={i18next.t("この名前を最後のポートで公開する")} title={s.port ? i18next.t("ポート {{port}} で公開する", { port: s.port }) : i18next.t("この名前を上の欄に入れる")} onClick={() => again(s)}><Play /></button>
                  )}
                  {inf?.found && <button className="icon-btn" aria-label={i18next.t("URL を作り直す")} title={i18next.t("URL を作り直す")} data-busy={inf.busy || undefined} disabled={inf.busy} onClick={() => void renew(s.name)}><Shuffle /></button>}
                  {s.name !== DEFAULT_NAME && !run && <button className="icon-btn" aria-label={i18next.t("一覧から外す")} title={i18next.t("一覧から外す")} onClick={() => void forget(s.name)}><X /></button>}
                </div>
                {url ? (
                  <div className="ports-proj-url">
                    <span className="ports-live" data-on={live.has(url) || undefined} title={live.has(url) ? i18next.t("公開中") : undefined} />
                    <span className="ports-url truncate" title={url}>{shortUrl(url)}</span>
                    <button className="icon-btn" aria-label={i18next.t("URL をコピー")} title={i18next.t("URL をコピー")} onClick={() => onCopy(url)}><Copy /></button>
                    <button className="icon-btn" aria-label={i18next.t("ブラウザで開く")} title={i18next.t("ブラウザで開く")} onClick={() => onOpen(url)}><ExternalLink /></button>
                  </div>
                ) : (
                  <div className="ports-proj-url"><span className="ports-url truncate" data-wait={inf?.ok !== false || undefined} data-fail={(inf && !inf.busy && !inf.ok) || undefined}>{!inf || inf.busy ? i18next.t("確認中…") : inf.ok ? i18next.t("まだ公開していません") : inf.note || i18next.t("URL を取得できませんでした")}</span></div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
