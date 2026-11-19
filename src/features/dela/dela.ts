// dela(ローカルのポートを https://app-xxxx.try.lapius7.si で公開する CLI)を、ターミナルから使うための小さな部品。
// 公開はインターネットに向けたものなので、実行前に必ず確認を挟む(呼び出し側)。.delaconfig には秘密のトークンが入る(dela が .gitignore へ足す)。
export const DELA_INSTALL = "pnpm add -g @lapius/dela-cli";
export const DELA_HOME = "https://try.lapius7.si";
// 入っているかの確認。非ログインのシェルは pnpm の bin が PATH に無いことが多いので、pnpm の置き場所とログインシェルでも探す
export const DELA_CHECK = `command -v dela >/dev/null 2>&1 || [ -x "\${PNPM_HOME:-$HOME/.local/share/pnpm}/dela" ] || [ -x "\${PNPM_HOME:-$HOME/.local/share/pnpm}/bin/dela" ] || [ -x "$HOME/.local/share/pnpm/bin/dela" ] || "\${SHELL:-sh}" -lic 'command -v dela >/dev/null 2>&1' </dev/null >/dev/null 2>&1`;
// 公開中のポート(画面に出さない端末 1 つにつき 1 件)。fail: 公開できずに終わった
// name: 公開する名前(未指定は app)。temp: 設定を使わない一時公開
export type Pub = { id: number; port: string; url?: string; state: "start" | "up" | "fail"; note?: string; temp?: boolean; name?: string };

// ANSI エスケープを取り除くため、制御文字を意図して使う
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");

const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.try\.lapius7\.si\b[^\s"'<>]*/i;
// 出力のかたまりから、公開 URL を探す(無ければ null)。末尾の句読点は含めない
export function findUrl(chunk: string): string | null {
  const m = stripAnsi(chunk).match(URL_RE);
  return m ? m[0].replace(/[.,;:)\]]+$/, "") : null;
}

export const validPort = (v: string): boolean => /^\d{1,5}$/.test(v.trim()) && +v >= 1 && +v <= 65535;
// 公開する名前(英小文字・数字・ハイフンで 1〜20 文字)。"app" は名前を付けない既定の URL(app-xxxx)
export const validName = (v: string): boolean => /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/.test(v);
export const DEFAULT_NAME = "app";
// 名前ごとの URL の元(トークン)の置き場。dela が先頭の ~ を展開するので、PC・WSL・SSH のどのシェルでも同じ書き方でよい(プロジェクトのフォルダには何も作らない)
export const slotConfig = (name: string) => `~/.dela/projects/${name || DEFAULT_NAME}.delaconfig`;
export const cfgFlag = (name = DEFAULT_NAME) => `--config "${slotConfig(name)}"`;
export type PubOpt = { name?: string; temp?: boolean };
// この版以上の dela だけが --config を知っている(古い版は黙って無視して、フォルダに .delaconfig を作ってしまう)
export const DELA_MIN = "0.6.0";
export const versionAtLeast = (v: string, min = DELA_MIN): boolean => {
  const a = v.split(".").map((x) => parseInt(x, 10) || 0), b = min.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
export const parseVersion = (text: string): string | null => /(\d+\.\d+\.\d+)/.exec(stripAnsi(text))?.[1] ?? null;
// --inspect: 受けたリクエストを 127.0.0.1 の画面(API)に記録させる。ポートのログ表示(PortLog)が読む
export const publishCmd = (port: string, o: PubOpt = {}) => {
  if (o.temp) return `dela ${+port} --inspect --temp`;
  const n = o.name && o.name !== DEFAULT_NAME && validName(o.name) ? o.name : DEFAULT_NAME;
  return `dela ${+port} --inspect ${cfgFlag(n)}${n === DEFAULT_NAME ? "" : ` --name ${n}`}`;
};
// 未導入のときだけ入れてから、公開する
export const installAndPublish = (port: string, o: PubOpt = {}) => `${DELA_INSTALL} && ${publishCmd(port, o)}`;
// 古い版を新しくしてから公開する
export const DELA_UPDATE = "pnpm add -g @lapius/dela-cli@latest";
export const updateAndPublish = (port: string, o: PubOpt = {}) => `${DELA_UPDATE} && ${publishCmd(port, o)}`;

// 表示する URL: https:// と、どれも同じ末尾(.try.lapius7.si)は省く。全体はホバーで見える
export const shortUrl = (u: string) => u.replace(/^https:\/\//, "").replace(/\.try\.lapius7\.si(?=\/|$)/, "");
