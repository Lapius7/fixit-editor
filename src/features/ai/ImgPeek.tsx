// AI に添えた画像を大きく見る窓。閉じるのはボタンか Esc だけ(外側のクリックでは閉じない)
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import i18next from "i18next";
import { ms } from "@/features/settings/settings";

export type Peek = { src: string; name: string };

export function ImgPeek({ img, onClose }: { img: Peek; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const [size, setSize] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, ms(160)); };
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    btn.current?.focus();
    return () => { prev?.focus?.(); };
  }, []);
  useEffect(() => {
    // 下にある AI パネルの Esc(パネルを閉じる)より先に受ける
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  });
  return createPortal(
    <div className="qo-backdrop" data-mid="true" data-closing={closing}>
      <div className="qo dlg peek" role="dialog" aria-modal="true" aria-label={img.name}>
        <header className="st-head">
          <h2 className="truncate" title={img.name}>{img.name}</h2>
          <button ref={btn} className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
        </header>
        <div className="peek-body overscroll-contain">
          <img src={img.src} alt={img.name} onLoad={(e) => setSize(`${e.currentTarget.naturalWidth} × ${e.currentTarget.naturalHeight}`)} />
        </div>
        {size && <p className="peek-meta">{size}</p>}
      </div>
    </div>,
    document.body,
  );
}
