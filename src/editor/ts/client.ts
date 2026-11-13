// 言語サービスの Worker への窓口。最初に使われるまで、Worker も TypeScript も読み込まない。
let worker: Worker | null = null;
let seq = 0;
const waits = new Map<number, (v: unknown) => void>();
let synced = "";

function get() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; v?: unknown }>) => { waits.get(e.data.id)?.(e.data.ok ? e.data.v : null); waits.delete(e.data.id); };
  worker.onerror = () => { for (const f of waits.values()) f(null); waits.clear(); };
  return worker;
}
const call = <T,>(op: string, args: Record<string, unknown>) => new Promise<T | null>((res) => { const id = ++seq; waits.set(id, res as (v: unknown) => void); get().postMessage({ id, op, ...args }); });

const JS_RE = /\.(?:[cm]?[jt]sx?)$/i;
export const isScript = (name: string) => JS_RE.test(name);

// 開いているタブの中身(パス → 文)。App が更新する
export const openFiles: { v: Record<string, string> } = { v: {} };

export type Loc = { file: string; from: number; to: number; line: number; text: string };
// text があるときは、それをそのまま差し込む(言語サーバー)。ないときは pre + 新しい名前 + suf(Worker)
export type Edit = { file: string; from: number; to: number; pre: string; suf: string; text?: string };
export type Hover = { from: number; to: number; sig: string; doc: string; kind: string };

async function sync(extra: Record<string, string>) {
  const files = { ...openFiles.v, ...extra };
  const key = Object.entries(files).map(([k, v]) => k + ":" + v.length + ":" + v.slice(0, 64) + v.slice(-64)).join("|");
  const full = JSON.stringify(files).length < 5_000_000 ? JSON.stringify(files) : key;
  if (full === synced) return;
  synced = full;
  await call("sync", { files });
}
export async function ask<T>(op: string, file: string, text: string, pos: number): Promise<T | null> {
  await sync({ [file]: text });
  return call<T>(op, { file, pos });
}
