import { useEffect, useState } from "react";
import { Flame, Keyboard, Timer, Type } from "lucide-react";
import { ms, update, useSettings } from "@/features/settings/settings";
import { clearStats, dur, lastDays, summary, useStats } from "@/features/stats/stats";
import { ask } from "@/shared/ask";
import i18next from 'i18next'
import { Trans } from 'react-i18next'

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="st-tile">
      <span className="st-ic">{icon}</span>
      <span className="st-lb">{label}</span>
      <b className="st-v">{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

// コーディング時間やタイピングの統計
export default function StatsView({ onClose, out }: { onClose: () => void; out?: boolean }) {
  const s = useSettings();
  useStats();
  const [closing, setClosing] = useState(false);
  const [range, setRange] = useState<7 | 30>(7);
  const close = () => { setClosing(true); setTimeout(onClose, ms(180)); };
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  });
  const sm = summary();
  const days = lastDays(range);
  const max = Math.max(60, ...days.map((x) => x.d.sec));
  const langMax = Math.max(1, ...sm.langs.slice(0, 6).map((x) => x[1]));
  const hMax = Math.max(1, ...sm.hours);
  const total = days.reduce((a, x) => a + x.d.sec, 0);
  const langSum = Math.max(1, sm.langs.reduce((a, x) => a + x[1], 0));
  const peak = sm.hours.some((v) => v > 0) ? sm.hours.indexOf(Math.max(...sm.hours)) : -1;
  return (
    <div className="qo-backdrop" data-mid data-closing={closing || !!out} onMouseDown={close}>
      <div className="qo dlg stats" role="dialog" aria-label={i18next.t("統計")} onMouseDown={(e) => e.stopPropagation()}>
        <header className="st-head">
          <h2><Trans i18nKey="統計" /></h2>
          <button className="btn close-btn" onClick={close}>{i18next.t("閉じる")}<kbd>Esc</kbd></button>
        </header>
        {!s.statsOn && <p className="st-off"><Trans i18nKey="記録は止めています。「設定 › 統計とプライバシー」でオンにできます。" /></p>}
        <div className="st-tiles">
          <Tile icon={<Timer />} label={i18next.t("今日の作業")} value={dur(sm.today.sec)} sub={i18next.t("今週 {{arg0}}", { arg0: dur(sm.weekSec) })} />
          <Tile icon={<Type />} label={i18next.t("今日の入力")} value={i18next.t("{{arg0}} 文字", { arg0: sm.today.chars.toLocaleString() })} sub={sm.cpm ? i18next.t("毎分 {{cpm}} 文字", { cpm: sm.cpm }) : i18next.t("削除 {{arg0}}", { arg0: sm.today.del.toLocaleString() })} />
          <Tile icon={<Keyboard />} label={i18next.t("今日のキー")} value={sm.today.keys.toLocaleString()} sub={i18next.t("保存 {{saves}} 回", { saves: sm.today.saves })} />
          <Tile icon={<Flame />} label={i18next.t("連続日数")} value={i18next.t("{{streak}} 日", { streak: sm.streak })} sub={i18next.t("合計 {{arg0}}", { arg0: dur(sm.totalSec) })} />
        </div>

        <section className="st-sec">
          <div className="st-sec-h">
            <h3><Trans i18nKey="作業時間" /></h3>
            <div className="seg" role="group" aria-label={i18next.t("期間")}>
              <button aria-pressed={range === 7} onClick={() => setRange(7)}><Trans i18nKey="7 日" /></button>
              <button aria-pressed={range === 30} onClick={() => setRange(30)}><Trans i18nKey="30 日" /></button>
            </div>
          </div>
          <p className="st-sum">
            <span>{i18next.t("合計 {{arg0}}", { arg0: dur(total) })}</span>
            <span>{i18next.t("1日あたり {{arg0}}", { arg0: dur(Math.round(total / range)) })}</span>
          </p>
          <div className="st-chart">
            <div className="st-grid" aria-hidden>
              {[1, 0.5, 0].map((r) => <div key={r}><em>{r === 1 ? dur(max) : ""}</em></div>)}
            </div>
            <div className="st-bars" data-n={range}>
              {days.map((x, i) => (
                <div key={x.key} className="st-bar" data-today={i === days.length - 1} data-edge={i > days.length - 4 ? "r" : i < 3 ? "l" : undefined} aria-label={`${x.label} ${dur(x.d.sec)}`}>
                  <div className="st-col"><i style={{ height: `${Math.max(x.d.sec ? 4 : 2, (x.d.sec / max) * 100)}%` }} data-zero={!x.d.sec} /></div>
                  <span>{range === 7 || i % 5 === 0 || i === days.length - 1 ? x.label : ""}</span>
                  <div className="st-tip" role="tooltip"><b>{x.label}</b><span>{dur(x.d.sec)}</span><small>{i18next.t("{{arg0}} 文字", { arg0: x.d.chars.toLocaleString() })}</small></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="st-cols">
          <section className="st-sec">
            <h3><Trans i18nKey="言語" /></h3>
            {sm.langs.length === 0 && <p className="st-none"><Trans i18nKey="まだありません" /></p>}
            {sm.langs.slice(0, 6).map(([k, v]) => (
              <div key={k} className="st-lang"><span>{k}</span><div><i style={{ width: `${(v / langMax) * 100}%` }} /></div><em>{dur(v)}<small>{Math.round((v / langSum) * 100)}%</small></em></div>
            ))}
          </section>
          <section className="st-sec">
            <h3><Trans i18nKey="時間帯" /></h3>
            <div className="st-hours" aria-label={i18next.t("時間帯ごとの作業量")}>
              {sm.hours.map((v, h) => <i key={h} data-peak={hMax > 0 && v === hMax && v > 0} title={i18next.t("{{h}} 時  {{arg1}}", { h, arg1: dur(v) })} style={{ opacity: v ? 0.25 + 0.75 * (v / hMax) : 0.1 }} />)}
            </div>
            <div className="st-hours-ax">{[0, 6, 12, 18].map((h) => <span key={h} style={{ gridColumn: `${h + 1} / span 6` }}>{h}</span>)}</div>
            {peak >= 0 && <p className="st-peak">{i18next.t("いちばん多い時間帯 {{h}} 時台", { h: peak })}</p>}
          </section>
        </div>

        <footer className="st-foot">
          <span>{sm.since} <Trans i18nKey="から記録・この PC にだけ保存" /></span>
          <button className="btn" onClick={() => update({ statsOn: !s.statsOn })}>{s.statsOn ? i18next.t("記録を止める") : i18next.t("記録を始める")}</button>
          <button className="btn" onClick={async () => { if (await ask({ message: i18next.t("統計をすべて消します。元に戻せません。"), ok: i18next.t("消す"), danger: true })) clearStats(); }}><Trans i18nKey="消す" /></button>
        </footer>
      </div>
    </div>
  );
}
