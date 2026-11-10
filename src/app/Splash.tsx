import { useEffect, useRef, useState } from "react";
import { get, isDark, ms } from "@/features/settings/settings";
import { PixelField, textShape } from "@/shared/pixels";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

// 起動画面。ピクセルが渦を巻いて集まり「Fixit」になり、そのあと画面がせり上がる。
// 飛ばせない(途中のクリックで消えないように)。?nosplash か設定で無効にできる。
const root = document.documentElement;
export const SPLASH_ON = () => !new URLSearchParams(location.search).has("nosplash") && get().splash;
if (SPLASH_ON()) root.dataset.boot = "wait";

export default function Splash() {
  const cv = useRef<HTMLCanvasElement>(null);
  const [out, setOut] = useState(false), [gone, setGone] = useState(!SPLASH_ON());
  const dark = isDark(get());

  useEffect(() => {
    if (gone) return;
    let dead = false, t: ReturnType<typeof setTimeout>;
    const done = () => { if (dead) return; dead = true; clearTimeout(t); delete root.dataset.boot; setOut(true); setTimeout(() => setGone(true), ms(700)); };
    const c = cv.current!, cell = 4, accent = getComputedStyle(root).getPropertyValue("--accent").trim() || "#3b6fd9";
    const stops = dark ? [[143, 180, 255], [183, 156, 255], [255, 159, 176], [255, 196, 138]] : [[59, 111, 217], [122, 92, 240], [232, 131, 143], [240, 163, 92]];
    const grad = (u: number) => { const k = Math.min(stops.length - 1.001, u * (stops.length - 1)), i = Math.floor(k), t = k - i, a = stops[i], b = stops[i + 1]; return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * t)).join(",")})`; };
    const sh = textShape("Fixit", "800 120px \"Inter Variable\", \"Noto Sans JP Variable\", sans-serif", cell, (_i, u, v) => grad(Math.min(1, Math.max(0, u * .85 + v * .15))));
    const f = new PixelField(c, cell, sh.w + 10, sh.h + 10, .82);
    f.morph(sh, dark ? "#f2f3f7" : accent, ms(1300)).then(() => { if (!dead) t = setTimeout(done, ms(450)); });
    return () => { dead = true; clearTimeout(t); f.stop(); delete root.dataset.boot; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (gone) return null;
  return (
    <div className="splash" data-out={out} data-dark={dark} aria-hidden>
      <div className="splash-in">
        <canvas ref={cv} />
        <span className="splash-sub">Fixit Editor</span>
      </div>
    </div>
  );
}
