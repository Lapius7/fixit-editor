// エクスプローラーの行が増える・減るときの動き。
// 増える: 縦に伸びながら現れる(名前を打って作ったときは、位置が二度ずれないよう色の光りだけ)。
// 減る: 消す操作を始めた瞬間に畳む。遅い場所(WSL・SSH)でも、すぐに消えたように見える。失敗したら元に戻す。
const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

// 設定の「動きの速さ」(0 なら動かさない)
const speed = () => {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sp"));
  return Number.isFinite(v) ? v : 1;
};

const rowOf = (path: string) => document.querySelector<HTMLElement>(`nav.tree .tree-row[data-path="${CSS.escape(path)}"]`)?.closest<HTMLElement>("li") ?? null;

/** 新しく現れた行の動き。soft は高さを動かさず、色の光りだけ */
export const enterRow = (li: HTMLElement, soft: boolean) => {
  const sp = speed();
  if (!sp || !li.animate) return;
  if (soft) {
    const row = li.querySelector<HTMLElement>(":scope > .tree-row");
    row?.animate([{ backgroundColor: "color-mix(in srgb, var(--accent) 22%, transparent)" }, { backgroundColor: "transparent" }], { duration: 900 * sp, easing: EASE });
    return;
  }
  const h = li.offsetHeight;
  li.animate(
    [
      { height: "0px", opacity: 0, transform: "translateX(-8px)", overflow: "hidden" },
      { height: `${h}px`, opacity: 1, transform: "none", overflow: "hidden" },
    ],
    { duration: 240 * sp, easing: EASE },
  );
};

/** 行(開いているフォルダは中身ごと)を畳んで隠す。
 * 畳んだ行は、一覧から本当に消えるまで隠したままにする(再読み込みが反映される前に戻すと、消えた行が一瞬出直してしまう)。
 * undo は失敗した行だけ元に戻す(paths を省くと全部)。settle は成功したあとの保険で、数秒たっても残っている行だけ戻す */
export const leaveRows = (paths: string[]) => {
  const sp = speed();
  const items = new Map<string, { li: HTMLElement; anim: Animation }>();
  for (const p of paths) {
    const li = rowOf(p);
    if (!li || !li.animate) continue;
    li.style.pointerEvents = "none";
    const h = li.offsetHeight;
    const anim = li.animate(
      [
        { height: `${h}px`, opacity: 1, transform: "none", overflow: "hidden" },
        { height: "0px", opacity: 0, transform: "translateX(-8px)", overflow: "hidden" },
      ],
      { duration: 200 * sp, easing: EASE, fill: "forwards" },
    );
    items.set(p, { li, anim });
  }
  const restore = (keys: string[], onlyConnected = false) => {
    for (const k of keys) {
      const it = items.get(k);
      if (!it || (onlyConnected && !it.li.isConnected)) continue;
      it.anim.cancel();
      it.li.style.removeProperty("pointer-events");
      items.delete(k);
    }
  };
  return {
    undo: (only?: string[]) => restore(only ?? [...items.keys()]),
    settle: () => { setTimeout(() => restore([...items.keys()], true), 5000); },
  };
};
