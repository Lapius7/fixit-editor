// 拡張機能のスクリプトを動かす場所。拡張ごとに、隔離した iframe(sandbox="allow-scripts"、opaque origin)を 1 つ作り、
// その中の Worker でコードを動かす。Worker は window も通信手段も持たず、本体とは MessagePort の RPC だけでつながる。
// 本体側(ここ)が、宣言した権限を毎回確かめる。Worker の言うことは信用しない。
import { IS_TAURI } from "@/shared/chrome";
import i18next from "i18next";
import { notify } from "@/shared/notify";
import { COLOR, type ExtSetting, type Manifest } from "../spec";
import { EXT_FS_LIST_MAX, EXT_FS_READ_MAX, EXT_FS_WRITE_MAX, EXT_NET_PER_MIN, EXT_NET_RES_MAX, EXT_NET_TIMEOUT_MS, EXT_PANELS_MAX, EXT_STATUS_MAX, EXT_TERM_PER_MIN } from "@/shared/config";
import { buildExtCommand } from "../exports";
import { bridge } from "./bridge";
import { cleanPanel, fsPath, netInit, netUrl, panelHasAction, panelIdOk, pickItems, promptText, statusText, termCommand } from "./guard";
import { askUser, countPanels, countStatus, dropUi, getPanel, hasStatus, setPanel, setStatus, showPanel } from "./ui";
import { dropProviders, EVENT_KINDS, provide, readActive, readSelection, readText, replaceRange, reply, setIo, type EventKind } from "./hub";
import { setBackdrop, type Fit } from "./backdrop";
import { getBlob, IMAGE_TYPES } from "./blobs";
import { setExtCss, cssOk } from "./css";
import { HOST_HTML } from "./page";
import { POSTLUDE, PRELUDE } from "./prelude";
import { dataGet, dataSet, getSettings, putSetting, subscribeSettings, type SettingVal } from "./store";

const READY_MS = 8_000;   // 起動(activate の完了)までの上限
const BEAT_MS = 4_000, DEAD_MS = 14_000; // 生存確認。返事が DEAD_MS 途絶えたら止める
const RATE = 400;         // 1 秒あたりの呼び出し上限
const MAX_ARG_CHARS = 120_000;
const FITS: Fit[] = ["cover", "contain", "center", "tile"];

type Run = { id: string; version: string; frame: HTMLIFrameElement; port: MessagePort; timers: number[]; off: () => void; disposers: (() => void)[]; picking: boolean; subs: Set<EventKind>; mins: { net: number; term: number }; pvId: string | null; ready: boolean; calls: number; lastBeat: number; manifest: Manifest };
const runs = new Map<string, Run>();

export const hostRunning = (id: string) => runs.has(id);

/** 宣言した既定値に、利用者が変えた値を重ねたもの */
export function effective(m: Manifest, id: string): Record<string, SettingVal> {
  const saved = getSettings(id), out: Record<string, SettingVal> = {};
  for (const s of m.settings) out[s.id] = s.kind === "button" ? null : s.kind === "file" ? (saved[s.id] ?? null) : valid(s, saved[s.id]) ? (saved[s.id] as SettingVal) : (s.def as SettingVal);
  return out;
}
export function valid(s: ExtSetting, v: unknown): boolean {
  switch (s.kind) {
    case "bool": return typeof v === "boolean";
    case "num": return typeof v === "number" && Number.isFinite(v) && v >= s.min && v <= s.max;
    case "enum": return typeof v === "string" && s.options.some((o) => o[0] === v);
    case "text": return typeof v === "string" && v.length <= 2000;
    case "color": return typeof v === "string" && COLOR.test(v);
    default: return false;
  }
}

async function call(r: Run, m: string, a: unknown[]): Promise<unknown> {
  const id = r.id, mf = r.manifest;
  if (JSON.stringify(a ?? []).length > MAX_ARG_CHARS) throw new Error("too large");
  const need = (ok: boolean) => { if (!ok) throw new Error("permission denied"); };
  switch (m) {
    case "ready": r.ready = true; return null;
    case "fail": stop(id); notify(`${mf.name}: ${String(a[0] ?? "").slice(0, 200)}`, "error"); return null;
    case "log": return null;
    case "pong": r.lastBeat = Date.now(); return null;
    case "settings.all": return effective(mf, id);
    case "settings.set": {
      const s = mf.settings.find((x) => x.id === a[0]);
      if (!s || !valid(s, a[1])) throw new Error("invalid setting");
      putSetting(id, s.id, a[1] as SettingVal);
      return null;
    }
    case "storage.get": return typeof a[0] === "string" ? dataGet(id, a[0].slice(0, 80)) : null;
    case "storage.set": {
      if (typeof a[0] !== "string" || (a[1] !== null && typeof a[1] !== "string")) throw new Error("invalid");
      if (!dataSet(id, a[0].slice(0, 80), a[1] as string | null)) throw new Error("storage full");
      return null;
    }
    case "ui.showMessage": {
      if (typeof a[0] !== "string") throw new Error("invalid");
      notify(`${mf.name}: ${a[0].slice(0, 300)}`, a[1] === "error" ? "error" : a[1] === "success" ? "success" : a[1] === "warning" ? "warning" : "info");
      return null;
    }
    case "ui.setCss": {
      need(!!mf.perms.ui);
      if (a[0] !== null && typeof a[0] !== "string") throw new Error("invalid");
      if (typeof a[0] === "string" && !cssOk(a[0])) throw new Error("css rejected (url/@import/escape are not allowed)");
      setExtCss(id, a[0] as string | null);
      return null;
    }
    case "ui.setBackgroundImage": {
      need(!!mf.perms.ui);
      const o = a[0] as { ref?: unknown; opacity?: unknown; blur?: unknown; fit?: unknown } | null;
      if (o === null) { setBackdrop(id, null); return null; }
      if (typeof o !== "object" || typeof o.ref !== "string" || !o.ref.startsWith(`${id}/`)) throw new Error("invalid ref");
      const blob = await getBlob(o.ref);
      if (!blob || !IMAGE_TYPES.includes(blob.type)) throw new Error("image not found");
      const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
      if (!runs.has(id)) return null; // 待っている間に止まった
      setBackdrop(id, { blob, opacity: num(o.opacity, 1, 0, 1), blur: num(o.blur, 0, 0, 40), fit: FITS.includes(o.fit as Fit) ? (o.fit as Fit) : "cover" });
      return null;
    }
    case "editor.activeFile": need(!!mf.perms.editorRead); return readActive();
    case "editor.getText": need(!!mf.perms.editorRead); return readText();
    case "editor.selection": need(!!mf.perms.editorRead); return readSelection();
    case "editor.replaceRange": need(!!mf.perms.editorWrite); replaceRange(a[0], a[1], a[2]); return null;
    case "editor.on": {
      need(!!mf.perms.editorRead);
      if (!EVENT_KINDS.includes(a[0] as EventKind)) throw new Error("invalid event");
      r.subs.add(a[0] as EventKind);
      return null;
    }
    case "editor.provide": {
      need(!!mf.perms.editorRead && (a[0] !== "format" || !!mf.perms.editorWrite));
      provide(id, a[0], a[1]);
      return null;
    }
    case "provide.reply": reply(id, a[0], a[1]); return null;
    case "panel.set": {
      need(!!mf.perms.ui);
      if (!panelIdOk(a[0])) throw new Error("invalid id");
      if (a[1] === null) { setPanel(id, mf.name, a[0], null); return null; }
      const p = cleanPanel(a[1]);
      if (!p) throw new Error("invalid panel");
      if (!getPanel(id, a[0]) && countPanels(id) >= EXT_PANELS_MAX) throw new Error("too many panels");
      setPanel(id, mf.name, a[0], p);
      return null;
    }
    case "panel.reveal": {
      need(!!mf.perms.ui);
      if (!panelIdOk(a[0]) || !getPanel(id, a[0])) throw new Error("no such panel");
      showPanel(`${id}/${a[0]}`);
      return null;
    }
    case "statusBar.set": {
      const sid = a[0], v = a[1] as { text?: unknown; tooltip?: unknown; command?: unknown } | null;
      if (typeof sid !== "string" || !/^[a-z0-9_-]{1,32}$/.test(sid)) throw new Error("invalid id");
      if (v === null) { setStatus(id, mf.name, sid, null); return null; }
      const text = statusText(v?.text), tip = v?.tooltip === undefined ? "" : statusText(v.tooltip), command = v?.command === undefined ? "" : v.command;
      if (!text || tip === null || typeof command !== "string" || (command && !mf.scriptCommands.some((c) => c.id === command))) throw new Error("invalid item");
      if (!hasStatus(id, sid) && countStatus(id) >= EXT_STATUS_MAX) throw new Error("too many status items");
      setStatus(id, mf.name, sid, { text, tip, command });
      return null;
    }
    case "window.showQuickPick": {
      const items = pickItems(a[0]), o = (a[1] ?? {}) as { title?: unknown; placeholder?: unknown };
      const title = promptText(o?.title), placeholder = promptText(o?.placeholder);
      if (!items || title === null || placeholder === null) throw new Error("invalid");
      const n = await askUser({ ext: id, name: mf.name, kind: "pick", title, placeholder, value: "", secret: false, items });
      return typeof n === "number" ? n : null;
    }
    case "window.showInputBox": {
      const o = (a[0] ?? {}) as { title?: unknown; placeholder?: unknown; value?: unknown; password?: unknown };
      const title = promptText(o?.title), placeholder = promptText(o?.placeholder), value = promptText(o?.value, 2000);
      if (title === null || placeholder === null || value === null) throw new Error("invalid");
      const t = await askUser({ ext: id, name: mf.name, kind: "input", title, placeholder, value, secret: o?.password === true, items: [] });
      return typeof t === "string" ? t : null;
    }
    case "window.pickFile": {
      // 利用者が OS のダイアログで選んだ 1 つのファイルの中身だけを返す(権限は要らない。選んだものしか渡らない)
      const f = await pickLocalFile(r);
      if (!f) return null;
      if (f.size > EXT_FS_READ_MAX) throw new Error("file too large");
      return { name: f.name.slice(0, 200), text: await f.text() };
    }
    case "workspace.list": {
      need(!!mf.perms.fsRead);
      const p = fsPath(a[0] ?? "/", true), fs = bridge().files;
      if (!p || !fs) throw new Error("path not allowed or no folder open");
      const list = await fs.list(p);
      if (!list) throw new Error("cannot read the folder");
      return list.slice(0, EXT_FS_LIST_MAX).map((e) => ({ name: e.name, dir: e.dir }));
    }
    case "workspace.readFile": {
      need(!!mf.perms.fsRead);
      const p = fsPath(a[0]), fs = bridge().files;
      if (!p || !fs) throw new Error("path not allowed or no folder open");
      const res = await fs.read(p);
      if ("err" in res) throw new Error(`cannot read: ${res.err}`);
      if (res.text.length > EXT_FS_READ_MAX) throw new Error("file too large");
      return res.text;
    }
    case "workspace.writeFile": {
      need(!!mf.perms.fsWrite);
      const p = fsPath(a[0]), fs = bridge().files;
      if (!p || !fs || typeof a[1] !== "string" || a[1].length > EXT_FS_WRITE_MAX) throw new Error("path not allowed, no folder open, or content too large");
      const out = await fs.write(p, a[1]);
      if (out !== "ok") throw new Error(out.slice(0, 200));
      return null;
    }
    case "terminal.run": {
      const c = termCommand(mf.perms, a[0], a[1]);
      if (!c) throw new Error("command not allowed (must be declared in permissions.exec; arguments are restricted)");
      if (++r.mins.term > EXT_TERM_PER_MIN) throw new Error("too many commands");
      const b = buildExtCommand(c, bridge().termCtx());
      if (!b) throw new Error("cannot run (missing file or folder, or unsafe path)");
      bridge().term(b.line, b.dir);
      return null;
    }
    case "net.fetch": {
      const url = netUrl(a[0], mf.perms.network), init = netInit(a[1]);
      if (!url || !init) throw new Error("request not allowed (https, declared host, restricted headers)");
      if (++r.mins.net > EXT_NET_PER_MIN) throw new Error("too many requests");
      return netFetch(url, init);
    }
    default: throw new Error(`unknown method: ${m}`);
  }
}


/** 本体の画面から https で取りに行く(CORS が効く。許可していないヘッダー・リダイレクト・認証情報は使わない)。応答は読みながら上限を数える */
async function netFetch(url: URL, init: { method: string; headers: Record<string, string>; body: string | null }) {
  const ctl = new AbortController(), t = window.setTimeout(() => ctl.abort(), EXT_NET_TIMEOUT_MS);
  try {
    const res = await fetch(url.href, { method: init.method, headers: init.headers, body: init.body, redirect: "error", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", signal: ctl.signal });
    if (new URL(res.url).hostname !== url.hostname) throw new Error("redirected");
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > EXT_NET_RES_MAX) throw new Error("response too large");
    const chunks: Uint8Array[] = []; let n = 0;
    const rd = res.body?.getReader();
    while (rd) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.length;
      if (n > EXT_NET_RES_MAX) { ctl.abort(); throw new Error("response too large"); }
      chunks.push(value);
    }
    const all = new Uint8Array(n); let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return { status: res.status, ok: res.ok, contentType: (res.headers.get("content-type") ?? "").slice(0, 100), text: new TextDecoder().decode(all) };
  } catch (e) {
    throw new Error(ctl.signal.aborted && !/too large/.test(String((e as Error)?.message)) ? "request timed out" : `request failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
  } finally { window.clearTimeout(t); }
}

/** OS のファイル選択を開く。1 つの拡張が同時に開けるのは 1 つ。拡張を止めたら取り消しとして閉じる */
function pickLocalFile(r: Run): Promise<File | null> {
  if (r.picking) return Promise.reject(new Error("another dialog is open"));
  r.picking = true;
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    const end = (f: File | null) => { r.picking = false; resolve(f); };
    inp.addEventListener("change", () => end(inp.files?.[0] ?? null), { once: true });
    inp.addEventListener("cancel", () => end(null), { once: true });
    r.disposers.push(() => end(null));
    inp.click();
  });
}

function pageUrl(r: { pvId: string | null }): Promise<{ src?: string; srcdoc?: string }> {
  if (!IS_TAURI) return Promise.resolve({ srcdoc: HOST_HTML });
  // アプリ版は srcdoc だと本体の CSP を受け継いでスクリプトが止まるため、fixitpv:// から読む(Preview と同じ)
  return import("@tauri-apps/api/core").then(async ({ invoke, convertFileSrc }) => {
    await invoke("pv_put", { id: r.pvId, html: HOST_HTML });
    return { src: `${convertFileSrc(r.pvId!, "fixitpv")}?v=1` };
  });
}

export async function startHost(id: string, manifest: Manifest, files: Record<string, string>): Promise<void> {
  if (runs.has(id) || !manifest.main) return;
  const source = files[manifest.main];
  if (typeof source !== "string") return;
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  frame.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
  const ch = new MessageChannel();
  const r: Run = { id, version: manifest.version, frame, port: ch.port1, timers: [], off: () => {}, disposers: [], picking: false, subs: new Set(), mins: { net: 0, term: 0 }, pvId: IS_TAURI ? `ext-${id}-${Math.random().toString(36).slice(2)}` : null, ready: false, calls: 0, lastBeat: Date.now(), manifest };
  runs.set(id, r);

  ch.port1.onmessage = (e) => {
    const d = e.data as { id?: number; m?: string; a?: unknown[] } | null;
    if (!d || typeof d.id !== "number" || typeof d.m !== "string") return;
    if (++r.calls > RATE) { stop(id); notify(i18next.t("{{name}}: 呼び出しが多すぎるため止めました", { name: manifest.name }), "error"); return; }
    const seq = d.id;
    call(r, d.m, Array.isArray(d.a) ? d.a : []).then((res) => ch.port1.postMessage({ id: seq, r: res ?? null }), (err) => ch.port1.postMessage({ id: seq, e: String((err as Error)?.message ?? err).slice(0, 300) }));
  };

  const onWin = (e: MessageEvent) => {
    if (e.source !== frame.contentWindow) return; // 自分の iframe からだけ受ける
    const d = e.data as { t?: string } | null;
    if (d?.t === "ready") frame.contentWindow!.postMessage({ t: "boot", code: PRELUDE + source + POSTLUDE }, "*", [ch.port2]);
    else if (d?.t === "error") { stop(id); notify(i18next.t("{{name}}: スクリプトでエラーが起きたため止めました", { name: manifest.name }), "error"); }
  };
  window.addEventListener("message", onWin);

  const pushSettings = () => {
    const now = effective(manifest, id), was = (r as Run & { last?: Record<string, SettingVal> }).last ?? {};
    for (const k of Object.keys(now)) if (JSON.stringify(now[k]) !== JSON.stringify(was[k]) && r.ready) ch.port1.postMessage({ ev: "setting", key: k, value: now[k] });
    (r as Run & { last?: Record<string, SettingVal> }).last = now;
  };
  (r as Run & { last?: Record<string, SettingVal> }).last = effective(manifest, id);
  const unsub = subscribeSettings(pushSettings);
  r.off = () => { window.removeEventListener("message", onWin); unsub(); };

  r.timers.push(
    window.setTimeout(() => { if (!r.ready) { stop(id); notify(i18next.t("{{name}}: 時間内に起動しなかったため止めました", { name: manifest.name }), "error"); } }, READY_MS),
    window.setInterval(() => { r.calls = 0; }, 1000),
    window.setInterval(() => { r.mins.net = 0; r.mins.term = 0; }, 60_000),
    window.setInterval(() => { ch.port1.postMessage({ ev: "ping" }); if (Date.now() - r.lastBeat > DEAD_MS) { stop(id); notify(i18next.t("{{name}}: 応答がないため止めました", { name: manifest.name }), "error"); } }, BEAT_MS),
  );

  const p = await pageUrl(r);
  if (!runs.has(id)) return;
  if (p.src) frame.src = p.src; else frame.srcdoc = p.srcdoc!;
  document.body.appendChild(frame);
}

/** 止める。iframe を捨てれば Worker も終わる。この拡張が足した見た目も外す */
export function stop(id: string) {
  const r = runs.get(id);
  if (!r) return;
  runs.delete(id);
  r.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  r.off();
  r.port.close();
  r.frame.remove();
  setBackdrop(id, null);
  setExtCss(id, null);
  dropUi(id);
  dropProviders(id);
  for (const d of r.disposers.splice(0)) { try { d(); } catch { /* 片付けの失敗で止めない */ } }
  if (r.pvId) import("@tauri-apps/api/core").then(({ invoke }) => invoke("pv_drop", { id: r.pvId })).catch(() => {});
}

/** パネルの操作(ボタン・一覧の行・入力の Enter)を、そのパネルの拡張へ渡す。パネルに実在する部品の操作だけ */
export function panelAction(ext: string, panel: string, action: string, value: string) {
  const r = runs.get(ext), p = getPanel(ext, panel);
  if (!r?.ready || !p || !panelHasAction(p, action)) return;
  r.port.postMessage({ ev: "panel", panel, action, value: String(value).slice(0, 1000) });
}
/** スクリプトが受けるコマンドを動かす(パレットや、設定のボタンから) */
export function runCommand(id: string, cid: string, arg?: { path: string; dir: boolean }) {
  const r = runs.get(id);
  if (r?.ready) r.port.postMessage({ ev: "command", cid, ...(arg ? { arg: { path: String(arg.path).slice(0, 1000), dir: !!arg.dir } } : {}) });
}
export const stopAll = () => [...runs.keys()].forEach(stop);
export const runningVersion = (id: string) => runs.get(id)?.version ?? null;

// エディタ側(hub.ts)が拡張へ知らせるための口。読む権限があり、その出来事を購読した拡張だけに渡す
setIo({
  listeners: (kind) => [...runs.values()].filter((r) => r.ready && r.manifest.perms.editorRead && r.subs.has(kind)).map((r) => r.id),
  send: (id, msg) => { const r = runs.get(id); if (r?.ready) r.port.postMessage(msg); },
  name: (id) => runs.get(id)?.manifest.name ?? id,
});
