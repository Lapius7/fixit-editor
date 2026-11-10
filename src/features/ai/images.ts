// AI に添える画像を、API が受け付ける形と大きさにそろえる。
// png / jpeg / gif / webp で、長い辺と容量が上限以内なら、そのまま使う。それ以外(svg・bmp・ico・avif、大きすぎる画像)は描き直す
import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_EDGE, AI_IMAGE_SRC_MAX_BYTES, AI_IMAGE_TYPES } from "@/shared/config";
import type { Img } from "@/features/ai/providers";

export type AiImage = Img & { id: number; name: string };
export type ImgFail = "type" | "big" | "read";

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon", avif: "image/avif" };
export const imageType = (f: Blob, name: string) => f.type || MIME[name.split(".").pop()?.toLowerCase() ?? ""] || "";
export const isImageFile = (f: Blob, name: string) => imageType(f, name).startsWith("image/");

const b64 = async (b: Blob) => {
  const u = new Uint8Array(await b.arrayBuffer());
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

const decode = (b: Blob) => new Promise<HTMLImageElement>((ok, ng) => {
  const url = URL.createObjectURL(b), im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); ok(im); };
  im.onerror = () => { URL.revokeObjectURL(url); ng(new Error("decode")); };
  im.src = url;
});

const encode = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((ok) => c.toBlob(ok, type, q));

export async function toAiImage(f: Blob, name: string): Promise<Omit<AiImage, "id"> | ImgFail> {
  const type = imageType(f, name);
  if (!type.startsWith("image/")) return "type";
  if (f.size > AI_IMAGE_SRC_MAX_BYTES) return "big";
  const src = type === f.type ? f : new Blob([f], { type });
  let im: HTMLImageElement;
  try { im = await decode(src); } catch { return "read"; }
  const w = im.naturalWidth || AI_IMAGE_MAX_EDGE, h = im.naturalHeight || AI_IMAGE_MAX_EDGE;
  const ok = (AI_IMAGE_TYPES as readonly string[]).includes(type);
  if (ok && Math.max(w, h) <= AI_IMAGE_MAX_EDGE && f.size <= AI_IMAGE_MAX_BYTES) return { name, type, data: await b64(f) };
  // 描き直す。PNG で収まらなければ JPEG にする(透明な部分は白にする)
  const k = Math.min(1, AI_IMAGE_MAX_EDGE / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  if (!g) return "read";
  g.drawImage(im, 0, 0, c.width, c.height);
  let out = type === "image/jpeg" ? null : await encode(c, "image/png");
  if (!out || out.size > AI_IMAGE_MAX_BYTES) {
    g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    for (const q of [0.9, 0.8, 0.65]) { out = await encode(c, "image/jpeg", q); if (out && out.size <= AI_IMAGE_MAX_BYTES) break; }
  }
  if (!out || out.size > AI_IMAGE_MAX_BYTES) return "big";
  return { name, type: out.type, data: await b64(out) };
}
