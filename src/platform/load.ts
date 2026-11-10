import { MAX_OPEN_BYTES } from "@/shared/config";
import type { Node } from "@/platform/fs";
import i18next from 'i18next'

export type View =
  | { kind: "text"; text: string; eol?: "lf" | "crlf" }
  | { kind: "image" | "pdf" | "audio" | "video"; url: string }
  | { kind: "docx"; html: string }
  | { kind: "unsupported"; reason: string; hint?: string };

const ext = (n: string) => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
export const isImageName = (n: string) => IMAGE.has(ext(n));
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
const MIME: Record<string, string> = { svg: "image/svg+xml", pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm" };

// 開けない形式と、その理由。拡張子で先に判定する
const NO: Record<string, [string, string?]> = {
  exe: ["実行ファイル(Windows)", "実行ファイルは、中身が機械語なので表示できません。"], msi: ["インストーラー"], dll: ["ライブラリ(DLL)"], sys: ["システムファイル"],
  so: ["ライブラリ"], dylib: ["ライブラリ"], bin: ["バイナリファイル"], o: ["オブジェクトファイル"], class: ["Java のクラスファイル"],
  zip: ["圧縮ファイル"], "7z": ["圧縮ファイル"], rar: ["圧縮ファイル"], gz: ["圧縮ファイル"], tar: ["アーカイブ"], iso: ["ディスクイメージ"],
  doc: ["Word 97-2003 形式(.doc)", ".docx に変換すると開けます。"], xls: ["Excel 97-2003 形式(.xls)"], xlsx: ["Excel ブック"], ppt: ["PowerPoint 97-2003 形式"], pptx: ["PowerPoint スライド"],
  psd: ["Photoshop ファイル"], ttf: ["フォント"], otf: ["フォント"], woff: ["フォント"], woff2: ["フォント"], sqlite: ["データベース"], db: ["データベース"],
};

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export async function getFile(n: Node): Promise<File> {
  if (n.demo !== undefined) return new File([n.demo], n.name, { type: MIME[ext(n.name)] ?? "" });
  return (n.handle as FileSystemFileHandle).getFile();
}

export async function load(n: Node): Promise<{ view: View; info: string }> {
  const f = await getFile(n);
  const e = ext(n.name);
  const info = `${e ? e.toUpperCase() + " · " : ""}${size(f.size)}`;

  if (NO[e]) return { info, view: { kind: "unsupported", reason: i18next.t("{{arg0}}は開けません。", { arg0: i18next.t(NO[e][0]) }), hint: NO[e][1] ? i18next.t(NO[e][1]!) : undefined } };
  const blob = (type: string) => URL.createObjectURL(f.type ? f : new Blob([f], { type }));
  if (IMAGE.has(e)) return { info, view: { kind: "image", url: blob(MIME[e] ?? "image/*") } };
  if (e === "pdf") return { info, view: { kind: "pdf", url: blob("application/pdf") } };
  if (AUDIO.has(e)) return { info, view: { kind: "audio", url: blob(MIME[e] ?? "audio/*") } };
  if (VIDEO.has(e)) return { info, view: { kind: "video", url: blob(MIME[e] ?? "video/*") } };
  if (e === "docx") {
    const mammoth = await import("mammoth/mammoth.browser");
    const r = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() });
    return { info, view: { kind: "docx", html: r.value } };
  }

  // 拡張子から分からないものは、先頭を見て文字かどうかを判断する
  const head = new Uint8Array(await f.slice(0, 8192).arrayBuffer());
  if (head.includes(0)) return { info, view: { kind: "unsupported", reason: i18next.t("バイナリファイルのため開けません。") } };
  if (f.size > MAX_OPEN_BYTES) return { info, view: { kind: "unsupported", reason: i18next.t("ファイルが大きすぎて開けません。"), hint: i18next.t("上限は {{arg0}} です。", { arg0: size(MAX_OPEN_BYTES) }) } };
  const raw = await f.text();
  const crlf = /\r\n/.test(raw) && !/(^|[^\r])\n/.test(raw); // すべての行が CRLF のときだけ。混ざっているときは LF にそろえる
  return { info, view: { kind: "text", text: crlf ? raw.replace(/\r\n/g, "\n") : raw, eol: crlf ? "crlf" : "lf" } };
}
