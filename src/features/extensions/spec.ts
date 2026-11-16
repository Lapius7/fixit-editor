// 拡張機能の中身の検証。サイトが保存する形(server/ext.ts の parseBundle が作る形)を、本体でも同じ規則で確かめる。
// 認証済みの版は署名で守られるが、未認証の版は中身をそのまま信じないため、どちらも必ずここを通す。変えるときは server/ext.ts とそろえる。
export const EXT_ID = /^[a-z0-9_-]{1,32}\.[a-z0-9_-]{1,32}$/;
export const EXT_VER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export const MAX_BUNDLE = 400_000;
// テーマが変えてよい CSS 変数(色だけ)
export const THEME_VARS = ["--c-kw", "--c-type", "--c-fn", "--c-str", "--c-num", "--c-com", "--c-prop", "--c-meta", "--editor-ink", "--gutter", "--gutter-active", "--match", "--match-now", "--indent-on"] as const;
const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[\d.]+%?(\s*,\s*|\s+)[\d.]+%?(\s*,\s*|\s+)[\d.]+%?(\s*(,|\/)\s*[\d.]+%?)?\s*\))$/;
const EXEC_NAME = /^[A-Za-z0-9._-]{1,40}$/;
const PLACEHOLDER = /\{(file|dir|root)\}/g;
const ARG_SAFE = /^[A-Za-z0-9._+@,:/=-]*$/;

export type Perms = { fsRead: boolean; fsWrite: boolean; network: string[]; exec: string[] };
export type ExtTheme = { id: string; name: string; dark: Record<string, string>; light: Record<string, string> };
export type ExtSnippet = { lang: string; label: string; template: string; detail: string };
export type ExtCommand = { id: string; title: string; cmd: string; args: string[] };
export type Manifest = { id: string; name: string; version: string; description: string; perms: Perms; themes: ExtTheme[]; snippets: ExtSnippet[]; commands: ExtCommand[] };
export type Bundle = { format: 1; manifest: Manifest; files: Record<string, string> };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): string | null => (typeof v === "string" && v.length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : null);
const exact = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** 保存された形を検証して返す。形が違えば null(理由は出さない。出す必要があるのは、サイトの公開時の検査のほう) */
export function readBundle(raw: string): Bundle | null {
  if (raw.length > MAX_BUNDLE) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!isObj(j) || j.format !== 1 || !isObj(j.manifest) || !isObj(j.files) || !exact(j, ["format", "manifest", "files"])) return null;
  const m = j.manifest;
  if (!exact(m, ["id", "name", "version", "description", "perms", "themes", "snippets", "commands"])) return null;
  const id = str(m.id, 65), name = str(m.name, 60), version = str(m.version, 11), description = str(m.description, 300, 0);
  if (!id || !EXT_ID.test(id) || !name || !version || !EXT_VER.test(version) || description === null) return null;

  const p = m.perms;
  if (!isObj(p) || !exact(p, ["fsRead", "fsWrite", "network", "exec"]) || p.fsRead !== false || p.fsWrite !== false || !Array.isArray(p.network) || p.network.length || !Array.isArray(p.exec)) return null;
  if (p.exec.length > 12 || !p.exec.every((e) => typeof e === "string" && EXEC_NAME.test(e))) return null;
  const perms: Perms = { fsRead: false, fsWrite: false, network: [], exec: p.exec as string[] };

  if (!Array.isArray(m.themes) || m.themes.length > 10 || !Array.isArray(m.snippets) || m.snippets.length > 200 || !Array.isArray(m.commands) || m.commands.length > 30) return null;
  const themes: ExtTheme[] = [];
  for (const t of m.themes) {
    if (!isObj(t) || !exact(t, ["id", "name", "dark", "light"]) || !isObj(t.dark) || !isObj(t.light)) return null;
    const tid = str(t.id, 32), tn = str(t.name, 40);
    if (!tid || !/^[a-z0-9_-]+$/.test(tid) || !tn) return null;
    const side = (o: Record<string, unknown>): Record<string, string> | null => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) { if (!(THEME_VARS as readonly string[]).includes(k) || typeof v !== "string" || !COLOR.test(v)) return null; out[k] = v; }
      return out;
    };
    const dark = side(t.dark), light = side(t.light);
    if (!dark || !light) return null;
    themes.push({ id: tid, name: tn, dark, light });
  }
  const snippets: ExtSnippet[] = [];
  for (const s of m.snippets) {
    if (!isObj(s) || !exact(s, ["lang", "label", "template", "detail"])) return null;
    const lang = str(s.lang, 24), label = str(s.label, 40), template = str(s.template, 2000), detail = str(s.detail, 80, 0);
    if (!lang || !/^[a-z0-9+#_-]+$/.test(lang) || !label || !template || detail === null) return null;
    snippets.push({ lang, label, template, detail });
  }
  const commands: ExtCommand[] = [];
  for (const k of m.commands) {
    if (!isObj(k) || !exact(k, ["id", "title", "cmd", "args"]) || !Array.isArray(k.args)) return null;
    const kid = str(k.id, 32), title = str(k.title, 60), cmd = str(k.cmd, 40);
    // 使うコマンドは、宣言した権限(exec)に入っていなければならない
    if (!kid || !/^[a-z0-9_-]+$/.test(kid) || !title || !cmd || !EXEC_NAME.test(cmd) || !perms.exec.includes(cmd)) return null;
    if (k.args.length > 16 || !k.args.every((a) => typeof a === "string" && a.length <= 200 && ARG_SAFE.test(a.replace(PLACEHOLDER, "")) && !/[{}]/.test(a.replace(PLACEHOLDER, "")))) return null;
    commands.push({ id: kid, title, cmd, args: k.args as string[] });
  }
  return { format: 1, manifest: { id, name, version, description, perms, themes, snippets, commands }, files: {} };
}

/** 権限の一覧(画面に出す・同意の比べ方に使う)。どれも「宣言した」ものだけ */
export const permLines = (p: Perms): { key: "fsRead" | "fsWrite" | "network" | "exec"; value: string }[] => [
  ...(p.fsRead ? [{ key: "fsRead" as const, value: "" }] : []),
  ...(p.fsWrite ? [{ key: "fsWrite" as const, value: "" }] : []),
  ...(p.network.length ? [{ key: "network" as const, value: p.network.join(", ") }] : []),
  ...(p.exec.length ? [{ key: "exec" as const, value: p.exec.join(", ") }] : []),
];
/** 新しい版の権限が、同意済みの権限の範囲に収まっているか(増えていなければ true) */
export const permsWithin = (now: Perms, consented: Perms) => (!now.fsRead || consented.fsRead) && (!now.fsWrite || consented.fsWrite) && now.network.every((h) => consented.network.includes(h)) && now.exec.every((c) => consented.exec.includes(c));
export const cmpVer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// ---- 自作(ローカル)の拡張機能 ----
// フォルダの fixit-extension.json(作者向けの書き方)を、保存する形に直す。直したあとは、サイトのものと同じ readBundle で検査する。
// id は「local.名前」に限る(サイトで公開された id と混ざらないように)。スクリプト・ファイルは使えないので、files は空にする。
export const LOCAL_PREFIX = "local.";
const sub = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
export function localBundle(text: string): { raw: string; manifest: Manifest } | "bad" | "id" {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return "bad"; }
  if (!isObj(j) || !sub(j, ["id", "name", "version", "description", "permissions", "contributes"])) return "bad";
  if (typeof j.id !== "string" || !j.id.startsWith(LOCAL_PREFIX)) return "id";
  const p = j.permissions === undefined ? {} : j.permissions, c = j.contributes === undefined ? {} : j.contributes;
  if (!isObj(p) || !isObj(c) || !sub(p, ["fsRead", "fsWrite", "network", "exec"]) || !sub(c, ["themes", "snippets", "commands"])) return "bad";
  const list = (v: unknown): unknown[] | null => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const th = list(c.themes), sn = list(c.snippets), cm = list(c.commands);
  if (!th || !sn || !cm) return "bad";
  const items = <T,>(a: unknown[], f: (o: Record<string, unknown>) => T | null): T[] | null => { const out: T[] = []; for (const x of a) { if (!isObj(x)) return null; const r = f(x); if (!r) return null; out.push(r); } return out; };
  const themes = items(th, (o) => sub(o, ["id", "name", "dark", "light"]) && (o.dark === undefined || isObj(o.dark)) && (o.light === undefined || isObj(o.light)) ? { id: o.id, name: o.name, dark: o.dark ?? {}, light: o.light ?? {} } : null);
  const snippets = items(sn, (o) => sub(o, ["lang", "label", "template", "detail"]) ? { lang: o.lang, label: o.label, template: o.template, detail: o.detail ?? "" } : null);
  const commands = items(cm, (o) => sub(o, ["id", "title", "run"]) && isObj(o.run) && sub(o.run, ["cmd", "args"]) ? { id: o.id, title: o.title, cmd: o.run.cmd, args: o.run.args ?? [] } : null);
  if (!themes || !snippets || !commands) return "bad";
  const raw = JSON.stringify({ format: 1, manifest: { id: j.id, name: j.name, version: j.version, description: j.description ?? "", perms: { fsRead: p.fsRead ?? false, fsWrite: p.fsWrite ?? false, network: p.network ?? [], exec: p.exec ?? [] }, themes, snippets, commands }, files: {} });
  const b = readBundle(raw);
  return b ? { raw, manifest: b.manifest } : "bad";
}
