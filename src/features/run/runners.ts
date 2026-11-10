// ▶ 実行: 拡張子ごとのコマンドの一覧。初期値に、ユーザーが足した・直したものを重ねる(空の文字列は「その拡張子では実行しない」)。
// 書式: {file} = ファイルの絶対パス(引用符つき) / {dir} = そのフォルダ / {name} = ファイル名 / {stem} = 拡張子を除いたファイル名

export const RUN_DEFAULTS: Record<string, string> = {
  py: "python {file}",
  js: "bun {file}", mjs: "bun {file}", ts: "bun {file}",
  go: "go run .",
  rs: "cargo run",
  sh: "bash {file}",
};

export const RUN_MAX = 64; // 登録できる拡張子の数
const EXT = /^[a-z0-9_+-]{1,16}$/;
const BAD = /["`$\r\n%]/; // シェルに解釈される文字を含むパスは実行しない(引用符で囲んでも展開されるため)

export const cleanExt = (s: string) => s.trim().replace(/^\.+/, "").toLowerCase();
export const validExt = (s: string) => EXT.test(s);
const extOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i + 1).toLowerCase() : ""; };

/** 保存された上書きを検査して取り出す(設定の読み込み用) */
export function cleanRunners(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, c] of Object.entries(v as Record<string, unknown>)) {
    if (Object.keys(out).length >= RUN_MAX) break;
    if (typeof c !== "string" || !validExt(k)) continue;
    out[k] = c.replace(/[\r\n]+/g, " ").trim().slice(0, 300);
  }
  return out;
}

/** 初期値 + 上書き。空の文字列のものは除く */
const effective = (o: Record<string, string>) =>
  Object.fromEntries(Object.entries({ ...RUN_DEFAULTS, ...o }).filter(([, c]) => c.trim()));

export const runnerFor = (name: string, o: Record<string, string>) => effective(o)[extOf(name)] ?? null;

/** コマンドを組み立てる。使えない文字がパスにあれば null */
export function buildCommand(tpl: string, abs: string): { cmd: string; dir: string } | null {
  if (BAD.test(abs)) return null;
  const k = abs.lastIndexOf("/") >= abs.lastIndexOf("\\") ? abs.lastIndexOf("/") : abs.lastIndexOf("\\");
  const dir = k > 0 ? abs.slice(0, k) : k === 0 ? abs.slice(0, 1) : ".";
  const name = abs.slice(k + 1), stem = name.replace(/\.[^.]*$/, "") || name;
  const q = (x: string) => `"${x}"`;
  const cmd = tpl.replace(/\{(file|dir|name|stem)\}/g, (_, w: string) => w === "file" ? q(abs) : w === "dir" ? q(dir) : w === "name" ? q(name) : q(stem));
  return { cmd, dir };
}
