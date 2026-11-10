// JS/TS の言語サービス(型情報・定義・参照・リネーム)。重いので Web Worker で、使われたときだけ読み込む。
// 開いているタブの中身だけを仮想ファイルとして渡す(フォルダ全体は読まない)。
import ts from "ts5";

const libs = import.meta.glob("/node_modules/ts5/lib/lib.{es*,dom*,webworker.importscripts,scripthost,decorators*}.d.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const LIB = new Map<string, string>();
for (const [k, v] of Object.entries(libs)) LIB.set(k.split("/").pop()!, v);

const files = new Map<string, { text: string; v: number }>();
const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, strict: true, noEmit: true, skipLibCheck: true, allowNonTsExtensions: true,
  lib: ["lib.es2022.full.d.ts"],
};
const LIBDIR = "/__lib__/";

const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(f)?.v ?? 0),
  getScriptSnapshot: (f) => {
    const t = files.get(f)?.text ?? (f.startsWith(LIBDIR) ? LIB.get(f.slice(LIBDIR.length)) : undefined);
    return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
  },
  getCurrentDirectory: () => "/",
  getDefaultLibFileName: () => LIBDIR + "lib.es2022.full.d.ts",
  fileExists: (f) => files.has(f) || (f.startsWith(LIBDIR) && LIB.has(f.slice(LIBDIR.length))),
  readFile: (f) => files.get(f)?.text ?? (f.startsWith(LIBDIR) ? LIB.get(f.slice(LIBDIR.length)) : undefined),
  directoryExists: () => true,
  useCaseSensitiveFileNames: () => true,
};
const ls = ts.createLanguageService(host, ts.createDocumentRegistry());

type Req = { id: number; op: string; [k: string]: unknown };
const loc = (f: string, s: number, l: number) => {
  const t = files.get(f)?.text ?? "";
  return { file: f, from: s, to: s + l, line: t.slice(0, s).split("\n").length, text: (t.split("\n")[t.slice(0, s).split("\n").length - 1] ?? "").trim().slice(0, 160) };
};

const handlers: Record<string, (r: Req) => unknown> = {
  sync: (r) => {
    const next = r.files as Record<string, string>;
    for (const k of [...files.keys()]) if (!(k in next)) files.delete(k);
    for (const [k, t] of Object.entries(next)) { const o = files.get(k); if (!o) files.set(k, { text: t, v: 1 }); else if (o.text !== t) files.set(k, { text: t, v: o.v + 1 }); }
    return true;
  },
  hover: (r) => {
    const q = ls.getQuickInfoAtPosition(r.file as string, r.pos as number);
    if (!q) return null;
    return { from: q.textSpan.start, to: q.textSpan.start + q.textSpan.length, sig: ts.displayPartsToString(q.displayParts), doc: ts.displayPartsToString(q.documentation), kind: q.kind };
  },
  define: (r) => {
    const d = ls.getDefinitionAtPosition(r.file as string, r.pos as number) ?? [];
    return d.filter((x) => files.has(x.fileName)).map((x) => loc(x.fileName, x.textSpan.start, x.textSpan.length));
  },
  refs: (r) => {
    const d = ls.getReferencesAtPosition(r.file as string, r.pos as number) ?? [];
    return d.filter((x) => files.has(x.fileName)).map((x) => loc(x.fileName, x.textSpan.start, x.textSpan.length));
  },
  renameInfo: (r) => {
    const i = ls.getRenameInfo(r.file as string, r.pos as number, { allowRenameOfImportPath: false });
    return i.canRename ? { name: i.displayName, from: i.triggerSpan.start, to: i.triggerSpan.start + i.triggerSpan.length } : { error: i.localizedErrorMessage };
  },
  rename: (r) => {
    const d = ls.findRenameLocations(r.file as string, r.pos as number, false, false) ?? [];
    return d.filter((x) => files.has(x.fileName)).map((x) => ({ file: x.fileName, from: x.textSpan.start, to: x.textSpan.start + x.textSpan.length, pre: x.prefixText ?? "", suf: x.suffixText ?? "" }));
  },
};

self.onmessage = (e: MessageEvent<Req>) => {
  const r = e.data;
  try { self.postMessage({ id: r.id, ok: true, v: handlers[r.op]?.(r) }); }
  catch (err) { self.postMessage({ id: r.id, ok: false, e: String(err) }); }
};
