// 使用量の表示。設定の「AI」(UsageRows)と、AI パネルの上の細い帯(UsageStrip)で使う
import i18next from "i18next";
import { useUsage, resetUsage, type Lim, type Tok } from "@/features/ai/usage";
import type { Provider } from "@/features/ai/store";

// 5 時間/週間の使用率。claude が返した名前を、わかる名前にして出す
export const LIMIT_NAME: Record<string, string> = { five_hour: "5 時間", seven_day: "週間", seven_day_opus: "週間(Opus)", seven_day_sonnet: "週間(Sonnet)", premium: "プレミアムリクエスト(月)", chat: "チャット(月)", completions: "補完(月)" };
const fmt = (n: number) => n.toLocaleString();
// 帯に入れる短い数(12,345 → 12.3k)
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : n.toLocaleString());
function resetText(r: number, now: number) {
  if (!r) return "";
  const ms = r * 1000 - now;
  if (ms <= 0) return i18next.t("リセット済み");
  const m = Math.ceil(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? i18next.t("{{d}}日{{h}}時間後にリセット", { d, h }) : h ? i18next.t("{{h}}時間{{m}}分後にリセット", { h, m: m % 60 }) : i18next.t("{{m}}分後にリセット", { m });
}
export function LimitBar({ id, l }: { id: string; l: Lim }) {
  const now = Date.now(), over = l.r > 0 && l.r * 1000 <= now;
  const pct = over ? 0 : Math.round(l.u * 100); // リセットを過ぎた枠は、使用率が古い。0 として見せる
  return (
    <div className="ai-lim" data-hot={pct >= 90}>
      <span className="ai-lim-n">{i18next.t(LIMIT_NAME[id] ?? id)}</span>
      <div className="ai-lim-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={i18next.t(LIMIT_NAME[id] ?? id)}><i style={{ width: `${pct}%` }} /></div>
      <span className="ai-lim-v">{pct}%</span>
      <small className="ai-lim-r">{resetText(l.r, now)}</small>
    </div>
  );
}
// 使用量。トークンはこのエディタから送った分だけ(他のアプリでの利用は含まない)。上限の使用率は claude が返した値
export function UsageRows({ p }: { p: Provider }) {
  const u = useUsage()[p];
  const lim = Object.entries(u?.limits ?? {}).sort(([a], [b]) => (a === "five_hour" ? -1 : b === "five_hour" ? 1 : a.localeCompare(b)));
  return (
    <div className="ai-set-row ai-use">
      <span>{i18next.t("使用量")}</span>
      {lim.length > 0 && <div className="ai-lims">{lim.map(([id, l]) => <LimitBar key={id} id={id} l={l} />)}</div>}
      {u?.n ? (
        <div className="ai-tok">
          <small>{i18next.t("直近の 1 回: 入力 {{i}} / 出力 {{o}}", { i: fmt(u.last!.i + u.last!.cr + u.last!.cw), o: fmt(u.last!.o) })}</small>
          <small>{i18next.t("{{n}} 回の合計: 入力 {{i}} / 出力 {{o}}", { n: fmt(u.n), i: fmt(u.total.i + u.total.cr + u.total.cw), o: fmt(u.total.o) })}</small>
          <button className="btn" onClick={() => resetUsage(p)}><span>{i18next.t("数え直す")}</span></button>
        </div>
      ) : <small className="ai-tok">{i18next.t("まだ使っていません")}</small>}
    </div>
  );
}


const byId = ([a]: [string, Lim], [b]: [string, Lim]) => (a === "five_hour" ? -1 : b === "five_hour" ? 1 : a.localeCompare(b));

// AI パネルの上の帯。5 時間/週間の使用率(分かるプロバイダーだけ)と、この会話で使ったトークン数。数字を読むのは設定で、ここは目安
export function UsageStrip({ p, chat }: { p: Provider; chat?: Tok }) {
  const u = useUsage()[p];
  const lim = Object.entries(u?.limits ?? {}).sort(byId).filter(([id]) => id in LIMIT_NAME);
  if (!lim.length && !chat) return null;
  const now = Date.now();
  const inp = chat ? chat.i + chat.cr + chat.cw : 0;
  return (
    <div className="ai-strip" role="group" aria-label={i18next.t("使用量")}>
      {lim.map(([id, l]) => {
        const pct = l.r > 0 && l.r * 1000 <= now ? 0 : Math.round(l.u * 100);
        return (
          <span key={id} className="ai-strip-i" data-hot={pct >= 90} title={resetText(l.r, now) || undefined}>
            {i18next.t(LIMIT_NAME[id])}
            <i className="ai-strip-bar"><b style={{ width: `${pct}%` }} /></i>
            <em>{pct}%</em>
          </span>
        );
      })}
      {chat && (
        <span className="ai-strip-i" title={i18next.t("入力 {{i}}(キャッシュ読み込み {{cr}}、書き込み {{cw}})、出力 {{o}}", { i: fmt(chat.i), cr: fmt(chat.cr), cw: fmt(chat.cw), o: fmt(chat.o) })}>
          {i18next.t("この会話")}
          <em>{i18next.t("入力 {{i}} / 出力 {{o}}", { i: short(inp), o: short(chat.o) })}</em>
        </span>
      )}
    </div>
  );
}
