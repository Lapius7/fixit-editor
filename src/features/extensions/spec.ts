// 拡張機能の中身の検証。サイトが保存する形(server/ext.ts の parseBundle が作る形)を、本体でも同じ規則で確かめる。
// 認証済みの版は署名で守られるが、未認証の版は中身をそのまま信じないため、どちらも必ずここを通す。変えるときは server/ext.ts とそろえる。
export const EXT_ID = /^[a-z0-9_-]{1,32}\.[a-z0-9_-]{1,32}$/;
export const EXT_VER = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
export const MAX_BUNDLE = 400_000;
// テーマが変えてよい CSS 変数(色だけ)
export const THEME_VARS = ["--c-kw", "--c-type", "--c-fn", "--c-str", "--c-num", "--c-com", "--c-prop", "--c-meta", "--editor-ink", "--gutter", "--gutter-active", "--match", "--match-now", "--indent-on"] as const;
export const COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[\d.]+%?(\s*,\s*|\s+)[\d.]+%?(\s*,\s*|\s+)[\d.]+%?(\s*(,|\/)\s*[\d.]+%?)?\s*\))$/;
const EXEC_NAME = /^[A-Za-z0-9._-]{1,40}$/;
const PLACEHOLDER = /\{(file|dir|root)\}/g;
const ARG_SAFE = /^[A-Za-z0-9._+@,:/=-]*$/;
/** network に書けるホスト: 小文字の DNS 名(ドット区切り、最後は英字)。IP・localhost・ポート・パスは書けない */
export const NET_HOST = /^(?=.{3,100}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
export const NET_HOST_DENY = /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/;
export const MAX_NET_HOSTS = 8;
export const MAX_EXEC = 12;
/** 引数 1 つが安全か(置き換え {file}{dir}{root} は除いて見る)。manifest の検査と、実行時の terminal.run の両方が使う */
export const argOk = (a: unknown): a is string => typeof a === "string" && a.length <= 200 && ARG_SAFE.test(a.replace(PLACEHOLDER, "")) && !/[{}]/.test(a.replace(PLACEHOLDER, ""));
export const execNameOk = (n: unknown): n is string => typeof n === "string" && EXEC_NAME.test(n);

/** ui: 見た目を変える(背景画像など)。editorRead / editorWrite: 開いている文書を読む・書く。どれも format 2 だけ。
 *  保存済みの古い同意には無いので、読むときは !! で扱う(無い=false) */
export type Perms = { fsRead: boolean; fsWrite: boolean; network: string[]; exec: string[]; ui?: boolean; editorRead?: boolean; editorWrite?: boolean };
export type SettingKind = "bool" | "num" | "enum" | "text" | "color" | "file" | "button";
export type ExtSetting = { id: string; label: string; kind: SettingKind; hint: string; def: string | number | boolean; min: number; max: number; step: number; options: [string, string][]; command: string };
export type ExtScriptCommand = { id: string; title: string };
export type ExtTheme = { id: string; name: string; dark: Record<string, string>; light: Record<string, string> };
export type ExtSnippet = { lang: string; label: string; template: string; detail: string };
export type ExtCommand = { id: string; title: string; cmd: string; args: string[] };
/** ショートカット。コマンド(外部・スクリプトのどちらでも)に割り当てる。本体のキーとは重ならないものだけ効く */
export type ExtKey = { command: string; key: string };
/** 右クリックメニューへの追加。editor=エディタ、tree=ファイル一覧 */
export type ExtMenu = { command: string; where: "editor" | "tree" };
export const MAX_CONTRIB = 20;
/** 組み合わせの書き方(keys.ts の comboOf と同じ形: Mod+Alt+Shift+キー)。Mod・Alt・F キーのどれかが要る */
export const KEY_COMBO = /^(Mod\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F([1-9]|1[0-2])|[`\-=[\];',./\\]|Enter|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/;
export const keyOk = (k: unknown): k is string => typeof k === "string" && k.length <= 30 && KEY_COMBO.test(k) && (/^(Mod|Alt)\+/.test(k) || /^(Shift\+)?F\d+$/.test(k));
export type Manifest = { id: string; name: string; version: string; description: string; perms: Perms; themes: ExtTheme[]; snippets: ExtSnippet[]; commands: ExtCommand[]; main: string | null; settings: ExtSetting[]; scriptCommands: ExtScriptCommand[]; keybindings: ExtKey[]; menus: ExtMenu[] };
export type Bundle = { format: 1 | 2; manifest: Manifest; files: Record<string, string> };
export const FILE_NAME = /^[A-Za-z0-9._/-]{1,120}$/;
export const MAX_FILE_CHARS = 300_000;
export const MAX_SETTINGS = 40;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number, min = 1): string | null => (typeof v === "string" && v.length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v) ? v : null);
const exact = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every((k) => k in o);

/** 保存された形を検証して返す。形が違えば null(理由は出さない。出す必要があるのは、サイトの公開時の検査のほう) */
export function readBundle(raw: string): Bundle | null {
  if (raw.length > MAX_BUNDLE) return null;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!isObj(j) || (j.format !== 1 && j.format !== 2) || !isObj(j.manifest) || !isObj(j.files) || !exact(j, ["format", "manifest", "files"])) return null;
  const v2 = j.format === 2;
  const m = j.manifest;
  if (!exact(m, v2 ? ["id", "name", "version", "description", "perms", "themes", "snippets", "commands", "main", "settings", "scriptCommands", "keybindings", "menus"] : ["id", "name", "version", "description", "perms", "themes", "snippets", "commands"])) return null;
  const id = str(m.id, 65), name = str(m.name, 60), version = str(m.version, 11), description = str(m.description, 300, 0);
  if (!id || !EXT_ID.test(id) || !name || !version || !EXT_VER.test(version) || description === null) return null;

  const p = m.perms;
  const P1 = ["fsRead", "fsWrite", "network", "exec"], P2 = [...P1, "ui", "editorRead", "editorWrite"];
  if (!isObj(p) || !exact(p, v2 ? P2 : P1) || !Array.isArray(p.network) || !Array.isArray(p.exec)) return null;
  if (p.exec.length > MAX_EXEC || !p.exec.every(execNameOk)) return null;
  if (!v2 && (p.fsRead !== false || p.fsWrite !== false || p.network.length)) return null;
  if (v2) {
    if (![p.fsRead, p.fsWrite, p.ui, p.editorRead, p.editorWrite].every((b) => typeof b === "boolean")) return null;
    if (p.network.length > MAX_NET_HOSTS || !p.network.every((h) => typeof h === "string" && NET_HOST.test(h) && !NET_HOST_DENY.test(h)) || new Set(p.network).size !== p.network.length) return null;
  }
  const perms: Perms = v2
    ? { fsRead: p.fsRead as boolean, fsWrite: p.fsWrite as boolean, network: p.network as string[], exec: p.exec as string[], ui: p.ui as boolean, editorRead: p.editorRead as boolean, editorWrite: p.editorWrite as boolean }
    : { fsRead: false, fsWrite: false, network: [], exec: p.exec as string[] };

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
    if (k.args.length > 16 || !k.args.every(argOk)) return null;
    commands.push({ id: kid, title, cmd, args: k.args as string[] });
  }
  if (!v2) return { format: 1, manifest: { id, name, version, description, perms, themes, snippets, commands, main: null, settings: [], scriptCommands: [], keybindings: [], menus: [] }, files: {} };

  // ---- format 2: スクリプト・設定項目 ----
  const files: Record<string, string> = {};
  const fl = j.files as Record<string, unknown>;
  if (Object.keys(fl).length > 20) return null;
  for (const [k, v] of Object.entries(fl)) { if (!FILE_NAME.test(k) || k.includes("..") || typeof v !== "string" || v.length > MAX_FILE_CHARS) return null; files[k] = v; }
  const main = m.main === null ? null : str(m.main, 120);
  if (main !== null && (!/\.js$/.test(main) || !(main in files))) return null;
  if (!Array.isArray(m.scriptCommands) || m.scriptCommands.length > 30 || !Array.isArray(m.settings) || m.settings.length > MAX_SETTINGS) return null;
  if (!main && (m.scriptCommands.length || m.settings.some((x) => isObj(x) && x.kind === "button"))) return null;
  const scriptCommands: ExtScriptCommand[] = [];
  for (const k of m.scriptCommands) {
    if (!isObj(k) || !exact(k, ["id", "title"])) return null;
    const kid = str(k.id, 32), title = str(k.title, 60);
    if (!kid || !/^[a-z0-9_-]+$/.test(kid) || !title || commands.some((c) => c.id === kid) || scriptCommands.some((c) => c.id === kid)) return null;
    scriptCommands.push({ id: kid, title });
  }
  const settings: ExtSetting[] = [];
  const KINDS: SettingKind[] = ["bool", "num", "enum", "text", "color", "file", "button"];
  for (const x of m.settings) {
    if (!isObj(x) || !exact(x, ["id", "label", "kind", "hint", "def", "min", "max", "step", "options", "command"])) return null;
    const sid = str(x.id, 32), label = str(x.label, 60), hint = str(x.hint, 120, 0), command = str(x.command, 32, 0);
    if (!sid || !/^[a-z0-9_-]+$/.test(sid) || !label || hint === null || command === null || settings.some((o) => o.id === sid)) return null;
    if (typeof x.kind !== "string" || !KINDS.includes(x.kind as SettingKind)) return null;
    const kind = x.kind as SettingKind;
    const { def, min, max, step } = x;
    if (typeof min !== "number" || typeof max !== "number" || typeof step !== "number" || ![min, max, step].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e9)) return null;
    if (!Array.isArray(x.options) || x.options.length > 20) return null;
    const options: [string, string][] = [];
    for (const o of x.options) { if (!Array.isArray(o) || o.length !== 2) return null; const a = str(o[0], 40), b = str(o[1], 40); if (!a || !b) return null; options.push([a, b]); }
    if (kind === "bool" && typeof def !== "boolean") return null;
    if (kind === "num" && (typeof def !== "number" || !(min < max) || step <= 0 || def < min || def > max)) return null;
    if (kind === "enum" && (typeof def !== "string" || !options.length || !options.some(([a]) => a === def))) return null;
    if (kind === "text" && (typeof def !== "string" || def.length > 200)) return null;
    if (kind === "color" && (typeof def !== "string" || !COLOR.test(def))) return null;
    if ((kind === "file" || kind === "button") && def !== "") return null;
    if (kind === "button" && !scriptCommands.some((c) => c.id === command)) return null;
    if (kind !== "button" && command !== "") return null;
    settings.push({ id: sid, label, kind, hint, def: def as ExtSetting["def"], min, max, step, options, command });
  }
  // ショートカットとメニュー: 宣言したコマンドにだけ付けられる
  const known = new Set([...commands.map((c) => c.id), ...scriptCommands.map((c) => c.id)]);
  if (!Array.isArray(m.keybindings) || m.keybindings.length > MAX_CONTRIB || !Array.isArray(m.menus) || m.menus.length > MAX_CONTRIB) return null;
  const keybindings: ExtKey[] = [];
  for (const k of m.keybindings) {
    if (!isObj(k) || !exact(k, ["command", "key"]) || typeof k.command !== "string" || !known.has(k.command) || !keyOk(k.key) || keybindings.some((o) => o.key === k.key)) return null;
    keybindings.push({ command: k.command, key: k.key });
  }
  const menus: ExtMenu[] = [];
  for (const k of m.menus) {
    if (!isObj(k) || !exact(k, ["command", "where"]) || typeof k.command !== "string" || !known.has(k.command) || (k.where !== "editor" && k.where !== "tree") || menus.some((o) => o.command === k.command && o.where === k.where)) return null;
    menus.push({ command: k.command, where: k.where });
  }
  return { format: 2, manifest: { id, name, version, description, perms, themes, snippets, commands, main, settings, scriptCommands, keybindings, menus }, files };
}

/** 権限の一覧(画面に出す・同意の比べ方に使う)。どれも「宣言した」ものだけ */
export type PermKey = "fsRead" | "fsWrite" | "network" | "exec" | "ui" | "editorRead" | "editorWrite";
export const permLines = (p: Perms): { key: PermKey; value: string }[] => [
  ...(p.editorRead ? [{ key: "editorRead" as const, value: "" }] : []),
  ...(p.editorWrite ? [{ key: "editorWrite" as const, value: "" }] : []),
  ...(p.fsRead ? [{ key: "fsRead" as const, value: "" }] : []),
  ...(p.fsWrite ? [{ key: "fsWrite" as const, value: "" }] : []),
  ...(p.network.length ? [{ key: "network" as const, value: p.network.join(", ") }] : []),
  ...(p.exec.length ? [{ key: "exec" as const, value: p.exec.join(", ") }] : []),
  ...(p.ui ? [{ key: "ui" as const, value: "" }] : []),
];
/** 新しい版の権限が、同意済みの権限の範囲に収まっているか(増えていなければ true)。古い同意には ui・editor* が無い。権限を足したらここも必ず足す */
export const permsWithin = (now: Perms, consented: Perms) => (!now.fsRead || !!consented.fsRead) && (!now.fsWrite || !!consented.fsWrite) && (!now.ui || !!consented.ui) && (!now.editorRead || !!consented.editorRead) && (!now.editorWrite || !!consented.editorWrite) && now.network.every((h) => consented.network.includes(h)) && now.exec.every((c) => consented.exec.includes(c));
export const cmpVer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// ---- 自作(ローカル)の拡張機能 ----
// フォルダの fixit-extension.json(作者向けの書き方)を、保存する形に直す。直したあとは、サイトのものと同じ readBundle で検査する。
// id は「local.名前」に限る(サイトで公開された id と混ざらないように)。format 2 のときは、main のスクリプトを files に入れる。
export const LOCAL_PREFIX = "local.";
const sub = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k));
export function localBundle(text: string, files: Record<string, string> = {}): { raw: string; manifest: Manifest } | "bad" | "id" {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return "bad"; }
  if (!isObj(j) || !sub(j, ["id", "name", "version", "description", "permissions", "contributes", "main"])) return "bad";
  if (typeof j.id !== "string" || !j.id.startsWith(LOCAL_PREFIX)) return "id";
  const p = j.permissions === undefined ? {} : j.permissions, c = j.contributes === undefined ? {} : j.contributes;
  if (!isObj(p) || !isObj(c) || !sub(p, ["fsRead", "fsWrite", "network", "exec", "ui", "editorRead", "editorWrite"]) || !sub(c, ["themes", "snippets", "commands", "settings", "keybindings", "menus"])) return "bad";
  const list = (v: unknown): unknown[] | null => (v === undefined ? [] : Array.isArray(v) ? v : null);
  const th = list(c.themes), sn = list(c.snippets), cm = list(c.commands), se = list(c.settings), kb = list(c.keybindings), mn = list(c.menus);
  if (!th || !sn || !cm || !se || !kb || !mn) return "bad";
  const items = <T,>(a: unknown[], f: (o: Record<string, unknown>) => T | null): T[] | null => { const out: T[] = []; for (const x of a) { if (!isObj(x)) return null; const r = f(x); if (!r) return null; out.push(r); } return out; };
  const themes = items(th, (o) => sub(o, ["id", "name", "dark", "light"]) && (o.dark === undefined || isObj(o.dark)) && (o.light === undefined || isObj(o.light)) ? { id: o.id, name: o.name, dark: o.dark ?? {}, light: o.light ?? {} } : null);
  const snippets = items(sn, (o) => sub(o, ["lang", "label", "template", "detail"]) ? { lang: o.lang, label: o.label, template: o.template, detail: o.detail ?? "" } : null);
  // run のあるものは外部コマンド、無いものはスクリプトが受けるコマンド(format 2)
  const commands = items(cm.filter((x) => isObj(x) && x.run !== undefined), (o) => sub(o, ["id", "title", "run"]) && isObj(o.run) && sub(o.run, ["cmd", "args"]) ? { id: o.id, title: o.title, cmd: o.run.cmd, args: o.run.args ?? [] } : null);
  const scriptCommands = items(cm.filter((x) => isObj(x) && x.run === undefined), (o) => sub(o, ["id", "title"]) ? { id: o.id, title: o.title } : null);
  const settings = items(se, (o) => sub(o, ["id", "label", "kind", "hint", "default", "min", "max", "step", "options", "command"])
    ? { id: o.id, label: o.label, kind: o.kind, hint: o.hint ?? "", def: o.default ?? ({ bool: false, num: 0, enum: (o.options as unknown[][] | undefined)?.[0]?.[0] ?? "", text: "", color: "#000000" } as Record<string, unknown>)[o.kind as string] ?? "", min: o.min ?? 0, max: o.max ?? 100, step: o.step ?? 1, options: o.options ?? [], command: o.command ?? "" } : null);
  const keybindings = items(kb, (o) => sub(o, ["command", "key"]) ? { command: o.command, key: o.key } : null);
  const menus = items(mn, (o) => sub(o, ["command", "where"]) ? { command: o.command, where: o.where ?? "editor" } : null);
  if (!themes || !snippets || !commands || !scriptCommands || !settings || !keybindings || !menus) return "bad";
  const v2 = j.main !== undefined || p.ui !== undefined || p.editorRead !== undefined || p.editorWrite !== undefined || p.fsRead || p.fsWrite || (Array.isArray(p.network) && p.network.length > 0) || se.length > 0 || scriptCommands.length > 0 || keybindings.length > 0 || menus.length > 0;
  const perms = { fsRead: p.fsRead ?? false, fsWrite: p.fsWrite ?? false, network: p.network ?? [], exec: p.exec ?? [], ...(v2 ? { ui: p.ui ?? false, editorRead: p.editorRead ?? false, editorWrite: p.editorWrite ?? false } : {}) };
  const head = { id: j.id, name: j.name, version: j.version, description: j.description ?? "", perms, themes, snippets, commands };
  const raw = JSON.stringify(v2
    ? { format: 2, manifest: { ...head, main: j.main ?? null, settings, scriptCommands, keybindings, menus }, files: typeof j.main === "string" && j.main in files ? { [j.main]: files[j.main] } : {} }
    : { format: 1, manifest: head, files: {} });
  const b = readBundle(raw);
  return b ? { raw, manifest: b.manifest } : "bad";
}
