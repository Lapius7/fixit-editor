// 切り替えボタン(.seg)の、選択中のつまみが滑って動くようにする。
// 選択中のボタン(aria-pressed="true")の位置と幅を CSS 変数に書き、見た目は CSS(.seg::before)が受け持つ。
const seen = new WeakSet<HTMLElement>();
let ro: ResizeObserver | null = null;
let queued = new Set<HTMLElement>(), raf = 0;

function measure(seg: HTMLElement) {
  const b = seg.querySelector<HTMLElement>(':scope > button[aria-pressed="true"]');
  if (!b || !b.offsetWidth) { if (!b) seg.removeAttribute("data-slide"); return; }
  seg.style.setProperty("--seg-x", `${b.offsetLeft}px`);
  seg.style.setProperty("--seg-w", `${b.offsetWidth}px`);
  seg.setAttribute("data-slide", "");
  // 最初の 1 回は動かさずに置き、そのあとから滑らせる
  if (!seg.hasAttribute("data-ready")) requestAnimationFrame(() => requestAnimationFrame(() => seg.setAttribute("data-ready", "")));
}
function add(seg: HTMLElement) {
  if (!seen.has(seg)) { seen.add(seg); ro?.observe(seg); }
  queued.add(seg);
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; const q = queued; queued = new Set(); q.forEach(measure); });
}
function scan(root: ParentNode) { root.querySelectorAll<HTMLElement>(".seg").forEach(add); }

export function initSegSlide() {
  if (typeof document === "undefined") return;
  ro = new ResizeObserver((es) => es.forEach((e) => add(e.target as HTMLElement)));
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "attributes") { const s = (m.target as HTMLElement).closest<HTMLElement>(".seg"); if (s) add(s); }
      else m.addedNodes.forEach((n) => { if (n.nodeType === 1) { const el = n as HTMLElement; if (el.matches(".seg")) add(el); scan(el); } });
    }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed"] });
  scan(document);
}
