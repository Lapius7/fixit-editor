import { useBackdrop } from "./backdrop";

// 拡張機能の背景画像。.stage の最初の子に置く(.window はこの後ろの兄弟で、すりガラス越しに見える)
export function ExtBackdrop() {
  const b = useBackdrop();
  if (!b) return null;
  const tile = b.fit === "tile";
  return (
    <div
      className="ext-bg"
      aria-hidden="true"
      style={{
        backgroundImage: `url("${b.url}")`,
        backgroundSize: tile ? "auto" : b.fit === "center" ? "auto" : b.fit,
        backgroundRepeat: tile ? "repeat" : "no-repeat",
        opacity: b.opacity,
        filter: b.blur ? `blur(${b.blur}px)` : undefined,
        inset: b.blur ? `${-b.blur * 2}px` : 0,
      }}
    />
  );
}
