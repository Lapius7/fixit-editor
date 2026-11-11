import type { ReactElement } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Search as SearchIcon, Download, Upload, X, RefreshCw, Plus, Globe, ScrollText, BookOpen, ExternalLink } from "lucide-react";
import { openExternal } from "@/features/account/auth";
import { SITE_URL, REPO_URL } from "@/shared/config";
import { RUN_DEFAULTS, RUN_MAX, cleanExt, validExt } from "@/features/run/runners";
import { useUpdateState } from "@/features/update/update";
import { IS_TAURI } from "@/shared/chrome";
import { CATS, DEFS, changedCount, exportJson, importJson, isChanged, ms, resetAll, update, useSettings } from "@/features/settings/settings";
import { Rows, Look } from "@/features/settings/SettingsParts";
import HistoryView from "@/features/settings/HistoryView";
import About from "@/features/settings/About";
import { AiSettings } from "@/features/ai/AiSettings";
import { AccountSettings } from "@/features/account/AccountUI";
import { KEYS, chips, comboOf, keyOf, rec, table } from "@/features/settings/keys";
import { notify } from "@/shared/notify";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

// 設定の左下から開く先。パスは公式サイトの言語つきの URL の後ろにつなぐ
const siteLang = () => { const l = (i18next.resolvedLanguage || i18next.language || "ja").slice(0, 2); return l === "en" || l === "ko" ? l : "ja"; };
const LINKS: [string, string, ReactElement][] = [
  ["公式サイト", "", <Globe key="g" size={14} />],
  ["ドキュメント", "/docs", <BookOpen key="d" size={14} />],
  ["更新履歴", "/changelog", <ScrollText key="c" size={14} />],
  ["GitHub", REPO_URL, <ExternalLink key="r" size={14} />],
];

export default function Settings({ onClose, first, out, onTheme, onCheckUpdate }: { onClose: () => void; first?: string; out?: boolean; onTheme?: () => void; onCheckUpdate?: () => void }) {
  const { checking, found: newVer } = useUpdateState();
  const [cat, setCat] = useState(CATS.some((c) => c.id === first) ? first! : "look");
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  const [closing, setClosing] = useState(false);
  const s = useSettings();
  const file = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null); const nav = useRef<HTMLElement>(null);
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !rec.on) close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [cat, q, only]);

  const count = useMemo(() => {
    const m = new Map<string, number>();
    DEFS.forEach((d) => { if (isChanged(d)) m.set(d.cat, (m.get(d.cat) ?? 0) + 1); });
    return m;
  }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = changedCount();
  const f = q.trim().toLowerCase();
  const found = useMemo(() => (f || only ? DEFS.filter((d) => (!only || isChanged(d)) && (!f || (d.label + i18next.t(d.label) + (d.hint ? i18next.t(d.hint) : "") + (d.sec ? i18next.t(d.sec) : "") + d.id).toLowerCase().includes(f))) : []), [f, only, s]); // eslint-disable-line react-hooks/exhaustive-deps
  const searching = !!(f || only);
  // 選択中の分類の位置を測り、印(.set-nav::before)が滑って動くようにする。最初の 1 回は動かさずに置く
  useLayoutEffect(() => {
    const n = nav.current, b = n?.querySelector<HTMLElement>('.set-tab[aria-current="true"]');
    if (!n) return;
    if (!b) { n.setAttribute("data-none", ""); return; }
    n.removeAttribute("data-none");
    n.style.setProperty("--tab-y", `${b.offsetTop}px`); n.style.setProperty("--tab-h", `${b.offsetHeight}px`);
    if (!n.hasAttribute("data-ready")) requestAnimationFrame(() => requestAnimationFrame(() => n.setAttribute("data-ready", "")));
  }, [cat, searching]);

  const doExport = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportJson()], { type: "application/json" }));
    a.download = "fixit-settings.json"; a.click(); URL.revokeObjectURL(a.href);
    notify(i18next.t("設定を書き出しました"), "success");
  };
  const doImport = async (fl?: File) => {
    if (!fl) return;
    try { importJson(await fl.text()); notify(i18next.t("設定を読み込みました"), "success"); } catch (e) { notify(i18next.t("読み込めませんでした: {{m}}", { m: (e as Error).message }), "error"); }
    if (file.current) file.current.value = "";
  };

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo set" role="dialog" aria-label={i18next.t("設定")} onMouseDown={(e) => e.stopPropagation()}>
        <nav className="set-nav" ref={nav} aria-label={i18next.t("設定の分類")}>
          <h2><Trans i18nKey="設定" /></h2>
          {CATS.map((c) => (
            <button key={c.id} className="set-tab" aria-current={!searching && cat === c.id} onClick={() => { setQ(""); setOnly(false); setCat(c.id); }}>
              <span>{i18next.t(c.label)}</span>{!!count.get(c.id) && <b className="set-n">{count.get(c.id)}</b>}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <div className="set-links">
            {LINKS.map(([label, path, icon]) => (
              <button key={label} className="set-link" onClick={() => void openExternal(path.startsWith("http") ? path : `${SITE_URL}/${siteLang()}${path}`)}>
                {icon}<span>{i18next.t(label)}</span><ExternalLink size={12} className="set-link-ext" />
              </button>
            ))}
          </div>
          {onCheckUpdate && IS_TAURI && (
            <div className="set-upd">
              <span className="tnum">Fixit Editor v{__APP_VERSION__}</span>
              <button className="btn" disabled={checking} onClick={onCheckUpdate}><RefreshCw size={14} className={checking ? "spin" : undefined} /><Trans i18nKey={checking ? "確認しています…" : newVer ? "新しい版があります" : "更新を確認"} /></button>
            </div>
          )}
          <div className="set-io">
            <button className="btn" onClick={doExport}><Download size={14} /><Trans i18nKey="書き出す" /></button>
            <button className="btn" onClick={() => file.current?.click()}><Upload size={14} /><Trans i18nKey="読み込む" /></button>
            <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => doImport(e.target.files?.[0])} />
          </div>
        </nav>
        <div className="set-main">
          <div className="set-bar">
            <div className="sp-box">
              <SearchIcon size={14} />
              <input placeholder={i18next.t("{{length}} 個の設定から探す", { length: DEFS.length })} value={q} onChange={(e) => setQ(e.target.value)} aria-label={i18next.t("設定を探す")} />
              {q && <button className="icon-btn" aria-label={i18next.t("消す")} onClick={() => setQ("")}><X /></button>}
            </div>
            <button className="chipbtn" aria-pressed={only} onClick={() => setOnly(!only)}><Trans i18nKey="変えたものだけ" />{changed ? ` ${changed}` : ""}</button>
            <button className="chipbtn" disabled={!changed} onClick={() => { resetAll(); notify(i18next.t("設定を初期値に戻しました"), "success"); }}><RotateCcw size={13} /><Trans i18nKey="すべて戻す" /></button>
            <button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
          </div>
          <div className="set-body scroll" ref={body}>
            <div key={searching ? "search" : cat} className="set-fade">
            {searching ? (
              found.length ? <Rows defs={found} flat /> : <p className="set-none"><Trans i18nKey="見つかりません" /></p>
            ) : cat === "keys" ? <Keys /> : cat === "history" ? <HistoryView /> : cat === "ai" ? <AiSettings /> : cat === "account" ? <AccountSettings /> : cat === "about" ? <About /> : (
              <>
                {cat === "look" && onTheme && <div className="set-theme-link"><div><Trans i18nKey="プレビューを見ながら編集" /><small><Trans i18nKey="エディタの右にパネルをひらき、画面そのままで変えられます" /></small></div><button className="btn" data-primary="true" onClick={() => { setClosing(true); setTimeout(onTheme, ms(180)); }}><Trans i18nKey="パネルで編集" /></button></div>}
                {cat === "look" && <Look />}
                <Rows defs={DEFS.filter((d) => d.cat === cat)} />
                {cat === "run" && <RunList />}
              </>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Keys() {
  const s = useSettings();
  const [q, setQ] = useState("");
  const [recId, setRecId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!recId) return;
    rec.on = true;
    const on = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") return setRecId(null);
      if (e.key === "Backspace" || e.key === "Delete") { update({ keys: { ...s.keys, [recId]: "" } }); setNote(i18next.t("割り当てを外しました")); return setRecId(null); }
      const c = comboOf(e);
      if (!c) return;
      if (!c.includes("Mod") && !c.includes("Alt") && !/^F\d+$/.test(c.replace("Shift+", ""))) return setNote(i18next.t("Ctrl・Alt・F1 などのキーと組み合わせてください"));
      const used = table(s.keys).get(c);
      const next = { ...s.keys, [recId]: c };
      let msg = "";
      if (used && used !== recId) { next[used] = ""; msg = i18next.t("「{{label}}」から外して割り当てました", { label: i18next.t(KEYS.find((k) => k.id === used)!.label) }); }
      update({ keys: next });
      setNote(msg);
      setRecId(null);
    };
    addEventListener("keydown", on, true);
    return () => { removeEventListener("keydown", on, true); rec.on = false; };
  }, [recId, s.keys]);

  const rows = useMemo(() => {
    const f = q.trim().toLowerCase();
    return KEYS.filter((k) => !f || (k.label + i18next.t(k.label)).toLowerCase().includes(f) || (k.group + i18next.t(k.group)).includes(f) || keyOf(k.id, s.keys).toLowerCase().includes(f));
  }, [q, s.keys]);
  const changed = Object.keys(s.keys).length > 0;

  return (
    <section className="set-sec">
      <h3><Trans i18nKey="ショートカット" /></h3>
      <div className="sp-box" style={{ marginBottom: 6 }}>
        <SearchIcon size={14} style={{ color: "var(--ink-3)" }} />
        <input placeholder={i18next.t("機能名・キーで絞り込み")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={i18next.t("絞り込み")} />
        {changed && <button className="btn" style={{ height: 24, padding: "0 8px", fontSize: 12 }} onClick={() => { update({ keys: {} }); setNote(i18next.t("すべて初期値に戻しました")); }}><Trans i18nKey="すべて戻す" /></button>}
      </div>
      <p className="set-note" aria-live="polite">{recId ? i18next.t("割り当てるキーを押してください(Esc で中止、Backspace で外す)") : note}</p>
      {rows.map((k, i) => {
        const cur = keyOf(k.id, s.keys), edited = k.id in s.keys;
        return (
          <div key={k.id}>
            {(i === 0 || rows[i - 1].group !== k.group) && <div className="kr-group">{i18next.t(k.group)}</div>}
            <div className="kr">
              <span className="kr-label">{i18next.t(k.label)}</span>
              <button className="kr-key" data-rec={recId === k.id} aria-label={i18next.t("{{label}}のキーを変える", { label: i18next.t(k.label) })} onClick={() => { setNote(""); setRecId(recId === k.id ? null : k.id); }}>
                {recId === k.id ? <em><Trans i18nKey="キーを押す…" /></em> : cur ? chips(cur).map((c, j) => <kbd key={j}>{c}</kbd>) : <em><Trans i18nKey="未設定" /></em>}
              </button>
              <button className="icon-btn kr-reset" aria-label={i18next.t("初期値に戻す")} style={{ visibility: edited ? "visible" : "hidden" }}
                onClick={() => { const n = { ...s.keys }; delete n[k.id]; update({ keys: n }); }}><RotateCcw /></button>
            </div>
          </div>
        );
      })}
      {!rows.length && <p style={{ color: "var(--ink-3)" }}><Trans i18nKey="見つかりません" /></p>}
    </section>
  );
}

// 実行(▶)のコマンド一覧。初期値の拡張子も書き換えられ、空にすると「その拡張子では実行しない」になる
function RunList() {
  const s = useSettings();
  const [ext, setExt] = useState("");
  const [cmd, setCmd] = useState("");
  const all = { ...RUN_DEFAULTS, ...s.runners };
  const exts = Object.keys(all).sort((a, b) => (a in RUN_DEFAULTS ? 0 : 1) - (b in RUN_DEFAULTS ? 0 : 1) || a.localeCompare(b));
  const set = (k: string, v: string) => update({ runners: { ...s.runners, [k]: v } });
  const drop = (k: string) => { const n = { ...s.runners }; delete n[k]; update({ runners: n }); };
  const e = cleanExt(ext), ok = validExt(e) && !!cmd.trim() && !(e in all && all[e] === cmd.trim()) && (e in all || Object.keys(s.runners).length < RUN_MAX);
  const add = () => { if (!ok) return; set(e, cmd.trim()); setExt(""); setCmd(""); };
  return (
    <section className="set-sec">
      <h3><Trans i18nKey="実行するコマンド" /></h3>
      <p className="set-note"><Trans i18nKey="拡張子ごとに、▶ で走らせるコマンドを決めます。実行はファイルのあるフォルダに移動してから行うので、{file} と {name} はファイル名、{stem} は拡張子を除いた名前、{dir} はフォルダのパスになります。" /></p>
      {exts.map((k) => {
        const own = k in s.runners, def = k in RUN_DEFAULTS, changed = own && (!def || s.runners[k] !== RUN_DEFAULTS[k]);
        return (
          <div className="kr" key={k}>
            <span className="run-ext tnum">.{k}</span>
            <input className="field run-cmd" spellCheck={false} value={all[k]} placeholder={i18next.t("実行しない")} aria-label={i18next.t(".{{ext}} の実行コマンド", { ext: k })} onChange={(ev) => set(k, ev.target.value)} />
            <button className="icon-btn kr-reset" aria-label={i18next.t(def ? "初期値に戻す" : "削除")} style={{ visibility: changed ? "visible" : "hidden" }} onClick={() => drop(k)}>{def ? <RotateCcw /> : <X />}</button>
          </div>
        );
      })}
      <div className="kr run-add">
        <input className="field run-ext-in" spellCheck={false} value={ext} placeholder={i18next.t("拡張子 (例: rb)")} aria-label={i18next.t("追加する拡張子")} onChange={(ev) => setExt(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") add(); }} />
        <input className="field run-cmd" spellCheck={false} value={cmd} placeholder={i18next.t("コマンド (例: ruby {file})")} aria-label={i18next.t("追加するコマンド")} onChange={(ev) => setCmd(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Enter") add(); }} />
        <button className="btn" disabled={!ok} onClick={add}><Plus size={14} /><Trans i18nKey="追加" /></button>
      </div>
    </section>
  );
}
