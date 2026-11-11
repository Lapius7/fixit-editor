import { useEffect, useRef, useState } from "react";
import Crumbs, { lastFocus } from "@/editor/Crumbs";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@/editor/lang";
import { searchKeymap } from "@codemirror/search";
import { fixitTheme } from "@/editor/theme";
import { fixitSearch } from "@/editor/search-panel";
import { power, dynamic } from "@/editor/extensions";
import { useSettings } from "@/features/settings/settings";
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
export const dropStates = (match: (key: string) => boolean) => { for (const k of [...cache.keys()]) if (match(k)) cache.delete(k); };
// ワークスペースに残すカーソル位置(パス → 文書の先頭からの位置)。開いている画面と、切り替えて残した状態の両方から集める
const live = new Map<string, EditorView>();
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
const LANG = new Compartment(), DYN = new Compartment(), EMMET = new Compartment();
type EmmetSyntax = string;
const EMMET_SYNTAX: Record<string, EmmetSyntax> = { html: "html", htm: "html", xhtml: "html", vue: "html", php: "html", svelte: "html", xml: "xml", svg: "xml", jsx: "jsx", tsx: "jsx", css: "css", scss: "scss", sass: "sass", less: "css", styl: "stylus", pug: "pug", jade: "pug", haml: "haml", slim: "slim" };
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
        history(), fileName.of(name), filePath.of(docKey.slice(docKey.indexOf(":") + 1)), DYN.of(dynamic(st)), LANG.of([]), EMMET.of([]), fixitTheme, fixitSearch, power,
        keymap.of(keys),
        EditorView.domEventHandlers({
          focus: (_e, v) => { lastFocus.v = v; cb.current.onFocus(); },
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
    cb.current.onReady(v);
    // 切り替え直後のカーソル情報を状態バーへ
    const m = v.state.selection.main, l = v.state.doc.lineAt(m.head);
    cb.current.onCursor({ l: l.number, c: m.head - l.from + 1, sel: 0, lines: v.state.doc.lines });
    return () => { clearTimeout(verT.current); setVw(null); cache.set(docKey, v.state); if (live.get(docKey) === v) live.delete(docKey); cb.current.onReady(null); v.destroy(); };
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 設定の反映(開いた直後にも一度流す)
  useEffect(() => {
    view.current?.dispatch({ effects: DYN.reconfigure(dynamic(st)) });
  }, [docKey, st.tabSize, st.insertSpaces, st.wrap, st.lineNumbers, st.activeLine, st.foldGutter, st.indentGuides, st.bracketMatching, st.matchHighlight, st.whitespace, st.cursorBlink,
    st.autocomplete, st.autocompleteDelay, st.completeMax, st.completeIcons, st.wordComplete, st.closeBrackets, st.indentOnInput, st.scrollPastEnd, st.spellcheck, st.readOnly, st.rainbowBrackets, st.tagSync, st.diagnostics, st.langService, st.minimap]);

  useEffect(() => { view.current?.dispatch({ effects: setGitBase.of(gitBase ?? null) }); }, [docKey, gitBase]);

  // もう一方の画面で編集されたときに追従する
  useEffect(() => {
    const v = view.current;
    if (!v || value === emitted.current) return;
    emitted.current = value;
    if (v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  // Emmet: ファイルの種類に合う書き方(html / css / jsx など)で、Tab で展開する。使うときに初めて読み込む
  useEffect(() => {
    const syntax = emmetSyntax(name);
    let live = true;
    if (!syntax || !st.emmet) { view.current?.dispatch({ effects: EMMET.reconfigure([]) }); return; }
    void import("@emmetio/codemirror6-plugin").then((m) => { if (live) view.current?.dispatch({ effects: EMMET.reconfigure([m.emmetConfig.of({ syntax: syntax as never }), m.abbreviationTracker({ syntax: syntax as never })]) }); });
    return () => { live = false; };
  }, [docKey, name, st.emmet]);
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
