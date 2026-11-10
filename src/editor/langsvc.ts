// JS/TS の言語機能(ホバーの型情報・定義へ移動・参照の検索・シンボルのリネーム)。
// 実体は Worker の言語サービス(`ts/worker.ts`)。ここは CodeMirror とのつなぎだけ。
import { Facet, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip, keymap } from "@codemirror/view";
import i18next from "i18next";
import { ask, isScript, type Edit, type Hover, type Loc } from "@/editor/ts/client";
import { notify } from "@/shared/notify";

export const filePath = Facet.define<string, string>({ combine: (v) => v[0] ?? "" });

export const LANG_EVENT = "fixit:lang";
export type LangMsg =
  | { kind: "goto"; loc: Loc }
  | { kind: "refs"; title: string; items: Loc[] }
  | { kind: "rename"; view: EditorView; file: string; name: string; from: number; to: number };
const say = (m: LangMsg) => dispatchEvent(new CustomEvent<LangMsg>(LANG_EVENT, { detail: m }));

const ctx = (v: EditorView) => ({ file: v.state.facet(filePath), text: v.state.doc.toString() });
const live = (v: EditorView) => isScript(v.state.facet(filePath));

export async function goDefinition(v: EditorView, pos = v.state.selection.main.head) {
  if (!live(v)) return false;
  const { file, text } = ctx(v);
  const r = await ask<Loc[]>("define", file, text, pos);
  if (!r?.length) { notify(i18next.t("定義が見つかりません"), "info"); return true; }
  if (r.length === 1) say({ kind: "goto", loc: r[0] });
  else say({ kind: "refs", title: i18next.t("定義"), items: r });
  return true;
}

export async function findRefs(v: EditorView) {
  if (!live(v)) return false;
  const { file, text } = ctx(v), pos = v.state.selection.main.head;
  const r = await ask<Loc[]>("refs", file, text, pos);
  if (!r?.length) { notify(i18next.t("参照が見つかりません"), "info"); return true; }
  say({ kind: "refs", title: i18next.t("参照 ({{n}} 件)", { n: r.length }), items: r });
  return true;
}

export async function startRename(v: EditorView) {
  if (!live(v)) return false;
  const { file, text } = ctx(v), pos = v.state.selection.main.head;
  const r = await ask<{ name?: string; from?: number; to?: number; error?: string }>("renameInfo", file, text, pos);
  if (!r || r.error || r.name === undefined) { notify(r?.error || i18next.t("この位置の名前は変えられません"), "info"); return true; }
  say({ kind: "rename", view: v, file, name: r.name, from: r.from!, to: r.to! });
  return true;
}

export const renameEdits = (v: EditorView, file: string, pos: number) => ask<Edit[]>("rename", file, v.state.doc.toString(), pos);

const tip = (h: Hover) => {
  const el = document.createElement("div");
  el.className = "lt";
  const sig = document.createElement("pre");
  sig.className = "lt-sig";
  sig.textContent = h.sig;
  el.append(sig);
  if (h.doc) { const d = document.createElement("div"); d.className = "lt-doc"; d.textContent = h.doc; el.append(d); }
  return el;
};

export const langService = (): Extension => [
  hoverTooltip(async (v, pos) => {
    if (!live(v)) return null;
    const { file, text } = ctx(v);
    const h = await ask<Hover>("hover", file, text, pos);
    if (!h || !h.sig) return null;
    return { pos: h.from, end: h.to, above: true, create: () => ({ dom: tip(h) }) };
  }, { hoverTime: 350 }),
  EditorView.domEventHandlers({
    mousedown: (e, v) => {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0 || !live(v)) return false;
      const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      e.preventDefault();
      v.dispatch({ selection: { anchor: pos } });
      void goDefinition(v, pos);
      return true;
    },
  }),
  keymap.of([
    { key: "F12", run: (v) => { void goDefinition(v); return live(v); } },
    { key: "Shift-F12", run: (v) => { void findRefs(v); return live(v); } },
    { key: "F2", run: (v) => { void startRename(v); return live(v); } },
  ]),
];
