import { useEffect, useRef, useState } from "react";
import i18next from "i18next";
import type { EditorView } from "@codemirror/view";
import { LANG_EVENT, renameEdits, type LangMsg, type PickItem } from "@/editor/langsvc";
import type { Edit, Loc } from "@/editor/ts/client";
import { displayPath } from "@/workbench/rootpath";
import { notify } from "@/shared/notify";

// 参照の一覧と、リネームの入力。位置は、いま編集している画面の中央あたりに出す
type Props = { onGoto: (l: Loc) => void; onRename: (edits: Edit[], name: string, view: EditorView, file: string) => void };

export default function LangUI({ onGoto, onRename }: Props) {
  const [refs, setRefs] = useState<{ title: string; items: PickItem[]; sel: number } | null>(null);
  const [ren, setRen] = useState<Extract<LangMsg, { kind: "rename" }> | null>(null);
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<LangMsg>).detail;
      if (m.kind === "goto") onGoto(m.loc);
      else if (m.kind === "refs") setRefs({ title: m.title, items: m.items.map((l) => ({ label: l.text, sub: `${displayPath(l.file).split("/").pop()}:${l.line}`, go: () => onGoto(l) })), sel: 0 });
      else if (m.kind === "pick") setRefs({ title: m.title, items: m.items, sel: 0 });
      else { setRen(m); setName(m.name); }
    };
    addEventListener(LANG_EVENT, on);
    return () => removeEventListener(LANG_EVENT, on);
  }, [onGoto]);

  useEffect(() => {
    if (!refs && !ren) return;
    const bye = (e: Event) => { if (!box.current?.contains(e.target as Node)) { setRefs(null); setRen(null); } };
    addEventListener("pointerdown", bye, true);
    return () => removeEventListener("pointerdown", bye, true);
  }, [refs, ren]);

  const close = () => { setRefs(null); setRen(null); };
  const go = (it: PickItem) => { close(); it.go(); };

  const submit = async () => {
    if (!ren) return;
    const nn = name.trim();
    if (!nn || nn === ren.name) return close();
    if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(nn)) { notify(i18next.t("名前に使えない文字があります"), "warning"); return; }
    const pos = ren.from;
    const edits = await renameEdits(ren.view, ren.file, pos, nn);
    if (edits === "blocked") return close();
    if (!edits?.length) { notify(i18next.t("名前を変えられませんでした"), "warning"); return close(); }
    onRename(edits, nn, ren.view, ren.file);
    close();
  };

  if (refs) {
    return (
      <div ref={box} className="bc-pop ctx lang-pop" style={{ left: "50%", top: "22%", transform: "translateX(-50%)", width: 480 }}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.preventDefault(); close(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); setRefs({ ...refs, sel: Math.min(refs.items.length - 1, refs.sel + 1) }); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setRefs({ ...refs, sel: Math.max(0, refs.sel - 1) }); }
          else if (e.key === "Enter") { e.preventDefault(); go(refs.items[refs.sel]); }
        }}>
        <div className="lang-title">{refs.title}</div>
        <ul tabIndex={0} autoFocus ref={(el) => el?.focus({ preventScroll: true })}>
          {refs.items.map((l, i) => (
            <li key={i} data-on={i === refs.sel} onMouseMove={() => refs.sel !== i && setRefs({ ...refs, sel: i })} onClick={() => go(l)}>
              <span className="bc-name">{l.label || "…"}</span>
              {l.sub && <em>{l.sub}</em>}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (ren) {
    return (
      <div ref={box} className="bc-pop ctx lang-pop" style={{ left: "50%", top: "22%", transform: "translateX(-50%)", width: 320 }}>
        <div className="lang-title">{i18next.t("名前を変える")}</div>
        <input className="bc-q" autoFocus onFocus={(e) => e.currentTarget.select()} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false}
          ref={(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } else if (e.key === "Escape") { e.preventDefault(); close(); ren.view.focus(); } }} />
      </div>
    );
  }
  return null;
}
