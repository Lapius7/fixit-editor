import { ms } from "@/features/settings/settings";
import { useState, type ReactNode } from "react";
import { Trans } from 'react-i18next'

type Props = { title: string; desc?: string; input?: string; placeholder?: string; ok: string; danger?: boolean; validate?: (v: string) => string | null; onSubmit: (v: string) => void; onClose: () => void; out?: boolean; icon?: (v: string) => ReactNode };

export default function Dialog({ title, desc, input, placeholder, ok, danger, validate, onSubmit, onClose, out, icon }: Props) {
  const [v, setV] = useState(input ?? "");
  const [closing, setClosing] = useState(false);
  const err = input !== undefined ? validate?.(v) ?? null : null;
  const close = (after?: () => void) => { setClosing(true); setTimeout(() => { onClose(); after?.(); }, ms(180)); };
  const submit = () => { if (!err && (input === undefined || v.trim())) close(() => onSubmit(v.trim())); };

  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") close(); else if (e.key === "Enter") { e.preventDefault(); submit(); } }}>
        <h2>{title}</h2>
        {desc && <p>{desc}</p>}
        {input !== undefined && (
          <>
            <div className="dlg-name" data-ico={!!icon || undefined}>
              {icon && <span className="dlg-name-ico" aria-hidden>{icon(v)}</span>}
              <input className="field" autoFocus value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
                onFocus={(e) => { const i = e.currentTarget.value.lastIndexOf("."); e.currentTarget.setSelectionRange(0, i > 0 ? i : e.currentTarget.value.length); }} />
            </div>
            <p style={{ color: "#d93b3b", margin: "6px 0 0", minHeight: 20 }}>{err}</p>
          </>
        )}
        <div className="dlg-foot">
          <button className="btn" onClick={() => close()}><Trans i18nKey="キャンセル" /></button>
          <button className="btn" data-primary={!danger} data-danger={danger} disabled={!!err} onClick={submit}>{ok}</button>
        </div>
      </div>
    </div>
  );
}
