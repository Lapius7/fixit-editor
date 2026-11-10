import { IS_TAURI } from "@/shared/chrome";

export type LocalFont = { name: string; mono: boolean };

let cache: Promise<LocalFont[]> | null = null;

// この PC に入っているフォントの家族名。exe は Rust(list_fonts)、ブラウザは queryLocalFonts(許可が出たときだけ)で読む。一度読んだら使い回す
export function localFonts(): Promise<LocalFont[]> {
  return (cache ??= load().catch(() => { cache = null; return []; }));
}

async function load(): Promise<LocalFont[]> {
  if (IS_TAURI) return (await import("@tauri-apps/api/core")).invoke<LocalFont[]>("list_fonts");
  const q = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
  if (!q) return [];
  const names = [...new Set((await q.call(window)).map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  return names.map((name) => ({ name, mono: /mono|code|console|courier|consolas/i.test(name) }));
}
