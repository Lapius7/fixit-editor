import { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput, indentUnit, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { fixitTheme } from "./lib/theme";
import { TAB_SIZE } from "./lib/config";

type Props = { docKey: string; name: string; value: string; onChange: (v: string) => void; onSave: () => void; onCursor: (l: number, c: number) => void };

export default function Editor({ docKey, name, value, onChange, onSave, onCursor }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const lang = useRef(new Compartment());
  const cb = useRef({ onChange, onSave, onCursor });
  cb.current = { onChange, onSave, onCursor };

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), history(), drawSelection(), indentOnInput(),
          bracketMatching(), highlightSelectionMatches(), indentUnit.of(" ".repeat(TAB_SIZE)), EditorState.tabSize.of(TAB_SIZE),
          lang.current.of([]), fixitTheme,
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave(), true) }, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) cb.current.onChange(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const p = u.state.selection.main.head, l = u.state.doc.lineAt(p);
              cb.current.onCursor(l.number, p - l.from + 1);
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, [docKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const d = LanguageDescription.matchFilename(languages, name);
    d?.load().then((s) => view.current?.dispatch({ effects: lang.current.reconfigure(s) }));
  }, [docKey, name]);

  return <div ref={host} className="h-full" />;
}
