// HTML プレビュー用: 相対パスで参照している CSS・JS・画像を、フォルダから読んで HTML の中に埋め込む。
// 開いているタブに未保存の内容があれば、ファイルより優先する(Live Server のように、書いたそばから反映される)。
import { splitRoot } from "@/workbench/rootpath";

export type Source = {
  root?: FileSystemDirectoryHandle; // 開いているフォルダの先頭(これが無いと、ファイルは読めない)
  path: string; // プレビューする HTML のパス(先頭の /@xxxx を含む)
  open: Record<string, string>; // 開いているタブの中身(パス → 文)
  nonce: number; // 変えると、読み込み済みのファイルを読み直す
};

const IMG_MAX = 6_000_000;
const MIME: Record<string, string> = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", avif: "image/avif", bmp: "image/bmp", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm" };
const extOf = (p: string) => p.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase() ?? "";

const isExternal = (u: string) => /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u) || u === "";

// 基準のパス(ファイルのパス)から見た相対参照を、フォルダ内のパスにそろえる。フォルダの外へ出るときは null
export function resolvePath(from: string, ref: string): string | null {
  const { prefix, rel } = splitRoot(from);
  const clean = ref.split(/[?#]/)[0];
  const parts = clean.startsWith("/") ? [] : rel.split("/").slice(0, -1);
  for (const seg of decodeURI(clean).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return prefix + "/" + parts.filter(Boolean).join("/");
}

async function fileAt(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const segs = splitRoot(path).rel.split("/").filter(Boolean);
  try {
    let dir = root;
    for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s);
    return await (await dir.getFileHandle(segs[segs.length - 1])).getFile();
  } catch { return null; }
}

const dataUrl = (f: Blob, type: string) => new Promise<string>((res) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).replace(/^data:[^;,]*/, `data:${type}`));
  r.onerror = () => res("");
  r.readAsDataURL(f);
});

const cache = new Map<string, string>();
let cacheNonce = -1;

async function textOf(src: Source, path: string): Promise<string | null> {
  if (path in src.open) return src.open[path];
  if (!src.root) return null;
  const f = await fileAt(src.root, path);
  return f ? f.text() : null;
}
async function dataOf(src: Source, path: string): Promise<string | null> {
  const key = path;
  if (cache.has(key)) return cache.get(key)!;
  if (!src.root) return null;
  const f = await fileAt(src.root, path);
  if (!f || f.size > IMG_MAX) return null;
  const u = await dataUrl(f, MIME[extOf(path)] ?? (f.type || "application/octet-stream"));
  cache.set(key, u);
  return u;
}

// CSS の url(...) を、CSS ファイルの位置から見た相対で解いて埋め込む
async function cssUrls(src: Source, css: string, at: string): Promise<string> {
  const found = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)];
  const done = new Map<string, string>();
  await Promise.all(found.map(async (m) => {
    const ref = m[2].trim();
    if (isExternal(ref) || done.has(ref)) return;
    const p = resolvePath(at, ref);
    const d = p ? await dataOf(src, p) : null;
    if (d) done.set(ref, d);
  }));
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q, ref) => { const d = done.get(String(ref).trim()); return d ? `url("${d}")` : all; });
}

const scriptSafe = (s: string) => s.replace(/<\/(script)/gi, "<\\/$1");
const styleSafe = (s: string) => s.replace(/<\/(style)/gi, "<\\/$1");

export async function inline(html: string, src: Source): Promise<string> {
  if (src.nonce !== cacheNonce) { cache.clear(); cacheNonce = src.nonce; }
  if (!src.root && !Object.keys(src.open).length) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const jobs: Promise<void>[] = [];
  const path = (ref: string) => (isExternal(ref) ? null : resolvePath(src.path, ref));

  doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]').forEach((el) => {
    const p = path(el.getAttribute("href")!);
    if (!p) return;
    jobs.push((async () => {
      const css = await textOf(src, p);
      if (css === null) return;
      const st = doc.createElement("style");
      st.textContent = styleSafe(await cssUrls(src, css, p));
      el.replaceWith(st);
    })());
  });
  doc.querySelectorAll<HTMLScriptElement>("script[src]").forEach((el) => {
    const p = path(el.getAttribute("src")!);
    if (!p) return;
    jobs.push((async () => {
      const js = await textOf(src, p);
      if (js === null) return;
      const s = doc.createElement("script");
      const t = el.getAttribute("type"); if (t) s.setAttribute("type", t);
      // インラインでは defer が効かないので、読み込み後に実行する(グローバルの eval なので、変数や関数は今までどおり window に載る)
      s.textContent = el.hasAttribute("defer") && !t ? scriptSafe(`document.addEventListener("DOMContentLoaded",function(){(0,eval)(${JSON.stringify(js)})});`) : scriptSafe(js);
      el.replaceWith(s);
    })());
  });
  doc.querySelectorAll<HTMLElement>("img[src], source[src], video[src], audio[src], video[poster], input[type=image][src]").forEach((el) => {
    for (const a of ["src", "poster"]) {
      const v = el.getAttribute(a);
      const p = v && path(v);
      if (!p) continue;
      jobs.push((async () => { const d = await dataOf(src, p); if (d) el.setAttribute(a, d); })());
    }
  });
  doc.querySelectorAll<HTMLElement>("[style*='url(']").forEach((el) => {
    jobs.push((async () => { el.setAttribute("style", await cssUrls(src, el.getAttribute("style")!, src.path)); })());
  });
  await Promise.all(jobs);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
