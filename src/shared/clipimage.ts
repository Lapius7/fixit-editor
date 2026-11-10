// 画像をクリップボードへ。クリップボードが受け付けるのは PNG だけなので、ほかの形式は canvas で PNG に直す
const toPng = (src: Blob): Promise<Blob> =>
  new Promise((ok, ng) => {
    const url = URL.createObjectURL(src), img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
      c.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      c.toBlob((b) => (b ? ok(b) : ng(new Error("toBlob"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); ng(new Error("decode")); };
    img.src = url;
  });

export async function copyImage(src: Blob | Promise<Blob> | HTMLCanvasElement): Promise<void> {
  // ClipboardItem に Promise を渡すと、ユーザー操作の直後という条件を保ったまま変換を待てる
  const png = src instanceof HTMLCanvasElement
    ? new Promise<Blob>((ok, ng) => src.toBlob((b) => (b ? ok(b) : ng(new Error("toBlob"))), "image/png"))
    : Promise.resolve(src).then((b) => (b.type === "image/png" ? new Blob([b], { type: "image/png" }) : toPng(b)));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
