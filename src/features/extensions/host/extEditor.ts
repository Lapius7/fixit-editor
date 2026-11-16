// エディタに差す、拡張機能からの補完・ホバー・波線。提供元(拡張)が無いときは、何も問い合わせず空を返す。
// 拡張の返事は hub.ts の clean* で形を確かめてから使う。ホバーの文章は textContent で出す(HTML として解釈しない)。
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { linter, type Diagnostic } from "@codemirror/lint";
import { filePath } from "@/editor/langsvc";
import { EXT_CHANGE_TEXT_MAX } from "@/shared/config";
import { ask, cleanCompletions, cleanDiagnostics, cleanHover, extOf, nameOf, providersFor, type Completion } from "./hub";

const path = (s: EditorState) => s.facet(filePath);

async function completion(ctx: CompletionContext): Promise<CompletionResult | null> {
  const p = path(ctx.state), ids = providersFor("completion", p);
  if (!ids.length) return null;
  const w = ctx.matchBefore(/[\w$@#-]*/);
  if (!w || (w.from === w.to && !ctx.explicit)) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const payload = { path: p, ext: extOf(p), pos: ctx.pos, prefix: w.text, lineBefore: ctx.state.sliceDoc(Math.max(line.from, ctx.pos - 400), ctx.pos) };
  const got = await Promise.all(ids.map(async (id) => cleanCompletions(nameOf(id), await ask(id, "completion", payload))));
  const all = got.flat() as Completion[];
  if (!all.length || ctx.aborted) return null;
  return { from: w.from, options: all.map((c) => ({ label: c.label, detail: c.detail || c.by, apply: c.insert, type: "text" })), validFor: /^[\w$@#-]*$/ };
}

const hover = hoverTooltip(async (v, pos) => {
  const p = path(v.state), ids = providersFor("hover", p);
  if (!ids.length) return null;
  const line = v.state.doc.lineAt(pos);
  const payload = { path: p, ext: extOf(p), pos, line: line.text.slice(0, 400), col: pos - line.from };
  for (const id of ids) {
    const text = cleanHover(await ask(id, "hover", payload));
    if (!text) continue;
    const by = nameOf(id);
    return {
      pos, above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "ext-hover";
        const b = document.createElement("div"); b.className = "ext-hover-by"; b.textContent = by;
        const t = document.createElement("div"); t.className = "ext-hover-text"; t.textContent = text;
        dom.append(b, t);
        return { dom };
      },
    };
  }
  return null;
}, { hoverTime: 400 });

const lint = linter(async (v: EditorView): Promise<Diagnostic[]> => {
  const p = path(v.state), ids = providersFor("diagnostics", p);
  if (!ids.length || v.state.doc.length > EXT_CHANGE_TEXT_MAX) return [];
  const text = v.state.doc.toString(), len = text.length;
  const got = await Promise.all(ids.map(async (id) => cleanDiagnostics(nameOf(id), len, await ask(id, "diagnostics", { path: p, ext: extOf(p), text }, 1500))));
  return got.flat().map((d) => ({ from: d.from, to: d.to, severity: d.severity, message: d.message, source: d.by }));
}, { delay: 700 });

export const extEditor: Extension = [EditorState.languageData.of(() => [{ autocomplete: completion }]), hover, lint];
