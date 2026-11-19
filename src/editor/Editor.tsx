import { useEffect, useRef, useState } from "react";
import Crumbs, { lastFocus } from "@/editor/Crumbs";
import { EditorState, Compartment, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@/editor/lang";
import { searchKeymap } from "@codemirror/search";
import { fixitTheme } from "@/editor/theme";
import { fixitSearch } from "@/editor/search-panel";
import { power, dynamic } from "@/editor/extensions";
import { useSettings } from "@/features/settings/settings";
import { extEditor } from "@/features/extensions/host/extEditor";
import { clearActive, noteChange, noteOpen, setActive } from "@/features/extensions/host/hub";
import { noteEdit } from "@/features/stats/stats";
import { langName } from "@/editor/lang";
import { setGitBase } from "@/editor/gitgutter"; import { fileName } from "@/editor/intel"; import { filePath } from "@/editor/langsvc";
import { MANAGED } from "@/editor/edit-cmds";

export type Cursor = { l: number; c: number; sel: number; lines: number };
export type Jump = { line: number; from: number; to: number; n: number };
type Props = { path?: string;
  docKey: string; name: string; value: string;
  onChange: (v: string) => void; onCursor: (c: Cursor) => void; onFocus: () => void; onReady: (v: EditorView | null) => void;
  onContext: (e: MouseEvent, v: EditorView) => void; jump?: Jump;
  crumbExtra?: React.ReactNode; // パンくず行の右端に置くもの(プレビューの切り替えなど)
  gitBase?: string | null; // Git の HEAD にある内容(行の変更の印の元)。null なら印を出さない
};

// タブを切り替えても、元に戻す履歴やカーソル位置が残るようにする
const cache = new Map<string, EditorState>();
export const dropStates = (match: (key: string) => boolean) => { for (const k of [...cache.keys()]) if (match(k)) cache.delete(k); for (const k of [...scrolls.keys()]) if (match(k)) { scrolls.delete(k); typing.delete(k); } };
// ワークスペースに残すカーソル位置(パス → 文書の先頭からの位置)。開いている画面と、切り替えて残した状態の両方から集める
const live = new Map<string, EditorView>();
// タブを離れたときの表示位置と、入力中だったか(戻ったときに続きから打てるようにする)
const scrolls = new Map<string, ReturnType<EditorView["scrollSnapshot"]>>();
const typing = new Set<string>();
const seeds = new Map<string, number>();
const pathOf = (key: string) => key.slice(key.indexOf(":") + 1);
export const cursorsNow = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, st] of cache) out[pathOf(k)] = st.selection.main.head;
  for (const [k, v] of live) out[pathOf(k)] = v.state.selection.main.head;
  return out;
};
// 開き直したとき、最初に作る状態でカーソルをそこへ置く(1 回だけ使う)
export const seedCursors = (m: Record<string, number> | undefined) => { seeds.clear(); for (const [p, h] of Object.entries(m ?? {})) if (Number.isFinite(h)) seeds.set(p, h); };

// 状態を使い回すので、Compartment は全体で共通にする
import { emmetExtensions } from "./emmetExt";
const LANG = new Compartment(), DYN = new Compartment(), EMMET = new Compartment();
type EmmetSyntax = string;
const EMMET_SYNTAX: Record<string, EmmetSyntax> = { html: "html", htm: "html", xhtml: "html", vue: "html", php: "html", svelte: "html", xml: "xml", svg: "xml", jsx: "jsx", tsx: "jsx", css: "css", scss: "scss", sass: "sass", less: "css", styl: "stylus", pug: "pug", jade: "pug", haml: "haml", slim: "slim", py: "html", pyw: "html", js: "html", mjs: "html", cjs: "html", ts: "html", mts: "html", cts: "html", go: "html", rb: "html", rs: "html", java: "html", kt: "html", kts: "html", cs: "html", swift: "html", dart: "html", lua: "html", pl: "html", scala: "html", ex: "html", exs: "html", groovy: "html" };
const emmetSyntax = (name: string): EmmetSyntax | null => EMMET_SYNTAX[name.split(".").pop()?.toLowerCase() ?? ""] ?? null;
const keys = [indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap].filter((b) => !MANAGED.has(b.run));

export default function Editor({ path, docKey, name, value, onChange, onCursor, onFocus, onReady, onContext, jump, gitBase, crumbExtra }: Props) {
  const st = useSettings();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const emitted = useRef(value);
  const [ver, setVer] = useState(0), [vw, setVw] = useState<EditorView | null>(null);
  const verT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cb = useRef({ onChange, onCursor, onFocus, onReady, onContext });
  cb.current = { onChange, onCursor, onFocus, onReady, onContext };

  useEffect(() => {
    const cached = cache.get(docKey);
    const seed = cached ? undefined : seeds.get(pathOf(docKey));
    if (seed !== undefined) seeds.delete(pathOf(docKey));
    const state = cached && cached.doc.toString() === value ? cached : EditorState.create({
      doc: value, ...(seed !== undefined ? { selection: { anchor: Math.min(Math.max(seed, 0), value.length) } } : {}),
      extensions: [
        history(), fileName.of(name), filePath.of(docKey.slice(docKey.indexOf(":") + 1)), DYN.of(dynamic(st)), LANG.of([]), EMMET.of([]), fixitTheme, fixitSearch, power, extEditor,
        keymap.of(keys),
        EditorView.domEventHandlers({
          blur: (e) => { const to = (e as FocusEvent).relatedTarget as HTMLElement | null; if (!to?.closest?.(".tab, .tabbar")) typing.delete(docKey); return false; }, // タブへ移っただけなら、入力中のまま残す
          focus: (_e, v) => { typing.add(docKey); lastFocus.v = v; setActive(v, pathOf(docKey)); cb.current.onFocus(); },
          // 最終行より下の空き地をクリックしたら、最後の行の末尾にカーソルを置く
          mousedown: (e, v) => {
            if (e.button !== 0 || (e.target as HTMLElement).closest(".cm-content, .cm-gutters, .cm-panels, .cm-tooltip")) return false;
            const last = v.lineBlockAt(v.state.doc.length), bottom = v.documentTop + last.bottom;
            if (e.clientY <= bottom) return false;
            e.preventDefault();
            v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true, userEvent: "select.pointer" });
            v.focus();
            return true;
          },
          contextmenu: (e, v) => { e.preventDefault(); cb.current.onContext(e, v); return true; },
        }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            emitted.current = u.state.doc.toString(); cb.current.onChange(emitted.current);
            let typed = 0, del = 0;
            for (const tr of u.transactions) {
              if (!tr.docChanged) continue;
              const ty = tr.isUserEvent("input.type"), dl = tr.isUserEvent("delete");
              if (ty || dl) tr.changes.iterChanges((a, b, _c, _d, ins) => { if (ty) typed += ins.length; del += b - a; });
            }
            noteEdit(typed, del, langName(name));
            noteChange(pathOf(docKey), () => u.view.state.doc.toString());
          }
          if (u.selectionSet || u.docChanged) { clearTimeout(verT.current); verT.current = setTimeout(() => setVer((n) => n + 1), 160); }
          if (u.selectionSet || u.docChanged || u.startState === u.state) {
            const m = u.state.selection.main, l = u.state.doc.lineAt(m.head);
            cb.current.onCursor({ l: l.number, c: m.head - l.from + 1, sel: u.state.selection.ranges.reduce((a, r) => a + r.to - r.from, 0), lines: u.state.doc.lines });
          }
        }),
      ],
    });
    emitted.current = value;
    const v = new EditorView({ parent: host.current!, state });
    // 開発版の React は、変わった props を中までたどって記録する。view → observer → window と進み、さらにプレビューの iframe(別オリジン)に触れて例外になり、
    // 描画が止まる(Crumbs・StatusPop が view を受け取るため)。たどられないよう、observer だけ列挙の対象から外す(動作には関係しない)
    try { Object.defineProperty(v, "observer", { enumerable: false }); } catch { /* 外せなくても動作は同じ */ }
    view.current = v; setVw(v);
    live.set(docKey, v);
    if (seed !== undefined) requestAnimationFrame(() => v.dispatch({ effects: EditorView.scrollIntoView(v.state.selection.main.head, { y: "center" }) }));
    if (cached) {
      const snap = scrolls.get(docKey);
      if (snap) requestAnimationFrame(() => { if (view.current === v) v.dispatch({ effects: snap }); });
      if (typing.has(docKey)) requestAnimationFrame(() => { if (view.current === v && !v.hasFocus) v.focus(); }); // 入力中に離れたなら、戻ったらすぐ打てる
    }
    cb.current.onReady(v);
    setActive(v, pathOf(docKey)); noteOpen(pathOf(docKey));
    // 切り替え直後のカーソル情報を状態バーへ
    const m = v.state.selection.main, l = v.state.doc.lineAt(m.head);
    cb.current.onCursor({ l: l.number, c: m.head - l.from + 1, sel: 0, lines: v.state.doc.lines });
    return () => { clearTimeout(verT.current); setVw(null); cache.set(docKey, v.state); scrolls.set(docKey, v.scrollSnapshot()); if (live.get(docKey) === v) live.delete(docKey); clearActive(v); cb.current.onReady(null); const had = v.hasFocus || typing.has(docKey); v.destroy(); if (had) typing.add(docKey); };
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 設定の反映(開いた直後にも一度流す)。使う項目だけを並べる
  useEffect(() => {
    view.current?.dispatch({ effects: DYN.reconfigure(dynamic(st)) });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 使う項目だけを並べる
  }, [docKey, st.tabSize, st.insertSpaces, st.wrap, st.lineNumbers, st.activeLine, st.foldGutter, st.indentGuides, st.bracketMatching, st.matchHighlight, st.whitespace, st.cursorBlink,
    st.autocomplete, st.autocompleteDelay, st.completeMax, st.completeIcons, st.wordComplete, st.closeBrackets, st.indentOnInput, st.scrollPastEnd, st.spellcheck, st.readOnly, st.rainbowBrackets, st.tagSync, st.diagnostics, st.langService, st.tsServer, st.tsLspDiag, st.tsLspComplete, st.tsLspHover, st.tsLspDef, st.tsLspSig, st.tsLspRefs, st.tsLspRename, st.tsLspAction, st.tsLspInlay, st.minimap]);

  useEffect(() => { view.current?.dispatch({ effects: setGitBase.of(gitBase ?? null) }); }, [docKey, gitBase]);

  // もう一方の画面で編集されたときに追従する
  useEffect(() => {
    const v = view.current;
    if (!v || value === emitted.current) return;
    emitted.current = value;
    // 外から変わったときは、変わった範囲だけを置き換える(全部を置き換えると、元に戻す履歴とカーソルの位置が失われる)
    const cur = v.state.doc.toString();
    if (cur !== value) {
      let s = 0; const max = Math.min(cur.length, value.length);
      while (s < max && cur.charCodeAt(s) === value.charCodeAt(s)) s++;
      let e = 0;
      while (e < max - s && cur.charCodeAt(cur.length - 1 - e) === value.charCodeAt(value.length - 1 - e)) e++;
      v.dispatch({ changes: { from: s, to: cur.length - e, insert: value.slice(s, value.length - e) } });
    }
  }, [value]);

  // Emmet: ファイルの種類に合う書き方(html / css / jsx など)で、Tab で展開する。使うときに初めて読み込む
  useEffect(() => {
    const syntax = emmetSyntax(name);
    let live = true;
    if (!syntax || !st.emmet) { view.current?.dispatch({ effects: EMMET.reconfigure([]) }); return; }
    void import("@emmetio/codemirror6-plugin").then((m) => { if (live) view.current?.dispatch({ effects: EMMET.reconfigure(emmetExtensions(m, syntax, st.emmetJson ?? "")) }); });
    return () => { live = false; };
  }, [docKey, name, st.emmet, st.emmetJson]);
  useEffect(() => {
    const d = LanguageDescription.matchFilename(languages, name);
    d?.load().then((s) => view.current?.dispatch({ effects: LANG.reconfigure(s) }));
  }, [docKey, name]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump) return;
    const line = v.state.doc.line(Math.min(Math.max(jump.line, 1), v.state.doc.lines));
    const from = Math.min(line.from + jump.from, line.to), to = Math.min(line.from + jump.to, line.to);
    v.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
    v.focus();
  }, [jump?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ed-host">
      {((st.breadcrumbs && path) || crumbExtra) && <Crumbs view={vw} path={path ?? name} ver={ver} extra={crumbExtra} trailOn={!!(st.breadcrumbs && path)} />}
      <div ref={host} className="ed-cm" />
    </div>
  );
}
