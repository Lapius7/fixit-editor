import { useEffect, useRef, useState } from "react";
import { ms } from "@/features/settings/settings";

// 外から「閉じる」にされても、閉じるアニメーションが終わるまで部品を残す。
// value が空になっても dur の間は直前の値を返し、out を true にする。開き直すたびに key が変わる。
// 部品どうしで key が重ならないよう、番号は全体で通し番号にする(重なると、ダイアログが複数重なって出る)
let seq = 0;

export function usePresence<T>(value: T | null | false | undefined, dur = 200): { v: T | null; out: boolean; key: number } {
  const keep = useRef<T | null>(null);
  const [mounted, setMounted] = useState(!!value);
  const [key, setKey] = useState(() => ++seq);
  const was = useRef(!!value);
  if (value) keep.current = value;
  useEffect(() => {
    if (value) {
      setMounted(true);
      if (!was.current) setKey(++seq);
      was.current = true;
      return;
    }
    was.current = false;
    const t = setTimeout(() => setMounted(false), ms(dur));
    return () => clearTimeout(t);
  }, [!!value]); // eslint-disable-line react-hooks/exhaustive-deps
  return { v: value ? value : mounted ? keep.current : null, out: !value, key };
}
