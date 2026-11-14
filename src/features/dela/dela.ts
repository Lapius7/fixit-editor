// dela(ローカルのポートを https://app-xxxx.try.lapius7.si で公開する CLI)を、ターミナルから使うための小さな部品。
// 公開はインターネットに向けたものなので、実行前に必ず確認を挟む(呼び出し側)。.delaconfig には秘密のトークンが入る(dela が .gitignore へ足す)。
export const DELA_INSTALL = "pnpm add -g @lapius/dela-cli";
export const DELA_HOME = "https://try.lapius7.si";
// 入っているかの確認。非ログインのシェルは pnpm の bin が PATH に無いことが多いので、pnpm の置き場所とログインシェルでも探す
export const DELA_CHECK = `command -v dela >/dev/null 2>&1 || [ -x "\${PNPM_HOME:-$HOME/.local/share/pnpm}/dela" ] || [ -x "\${PNPM_HOME:-$HOME/.local/share/pnpm}/bin/dela" ] || [ -x "$HOME/.local/share/pnpm/bin/dela" ] || "\${SHELL:-sh}" -lic 'command -v dela >/dev/null 2>&1' </dev/null >/dev/null 2>&1`;
// 公開中のポート(画面に出さない端末 1 つにつき 1 件)。fail: 公開できずに終わった
// dir/rel: dela を動かしたフォルダ(rel は開いたフォルダからの相対。"" は開いたフォルダ)。temp: .delaconfig を使わない一時公開
export type Pub = { id: number; port: string; url?: string; state: "start" | "up" | "fail"; note?: string; dir?: string; rel?: string; temp?: boolean; name?: string };

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, "");

const URL_RE = /https:\/\/[a-z0-9][a-z0-9-]*\.try\.lapius7\.si\b[^\s"'<>]*/i;
// 出力のかたまりから、公開 URL を探す(無ければ null)。末尾の句読点は含めない
export function findUrl(chunk: string): string | null {
  const m = stripAnsi(chunk).match(URL_RE);
  return m ? m[0].replace(/[.,;:)\]]+$/, "") : null;
}

export const validPort = (v: string): boolean => /^\d{1,5}$/.test(v.trim()) && +v >= 1 && +v <= 65535;
// --name: 同じプロジェクトで別のサービスを公開するときの名前(英小文字・数字・ハイフンで 1〜20 文字)
export const validName = (v: string): boolean => /^[a-z0-9]([a-z0-9-]{0,18}[a-z0-9])?$/.test(v);
export type PubOpt = { name?: string; temp?: boolean };
// --inspect: 受けたリクエストを 127.0.0.1 の画面(API)に記録させる。ポートのログ表示(PortLog)が読む(dela 0.5.0 以上)
export const publishCmd = (port: string, o: PubOpt = {}) => `dela ${+port} --inspect${o.temp ? " --temp" : o.name && validName(o.name) ? ` --name ${o.name}` : ""}`;
// 未導入のときだけ入れてから、公開する
export const installAndPublish = (port: string, o: PubOpt = {}) => `${DELA_INSTALL} && ${publishCmd(port, o)}`;

// 表示する URL: https:// と、どれも同じ末尾(.try.lapius7.si)は省く。全体はホバーで見える
export const shortUrl = (u: string) => u.replace(/^https:\/\//, "").replace(/\.try\.lapius7\.si(?=\/|$)/, "");
