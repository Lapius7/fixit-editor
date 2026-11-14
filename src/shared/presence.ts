import { useEffect, useRef, useState } from "react";
import { ms } from "@/features/settings/settings";

// 外から「閉じる」にされても、閉じるアニメーションが終わるまで部品を残す。
// value が空になっても dur の間は直前の値を返し、out を true にする。開き直すたびに key が変わる。
// 部品どうしで key が重ならないよう、番号は全体で通し番号にする(重なると、ダイアログが複数重なって出る)
let seq = 0;

export function usePresence<T>(value: T | null | false | undefined, dur = 200): { v: T | null; out: boolean; key: number } {
  const keep = useRef<T | null>(null);
  const open = !!value;
  const [mounted, setMounted] = useState(open);
  const [key, setKey] = useState(() => ++seq);
  const [was, setWas] = useState(open);
  // 開くときの key は、描画の途中で決める。描画のあとに変えると、部品が一度出てから作り直され、開く動きが二重になってちらつく
  if (open !== was) { setWas(open); if (open) setKey(++seq); }
  if (value) keep.current = value;
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), ms(dur));
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return { v: value ? value : mounted ? keep.current : null, out: !value, key };
}
