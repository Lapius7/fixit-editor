import { kvGet, kvSet } from "@/platform/appdata";
import { useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import i18next from "i18next";
import { Trans } from "react-i18next";
import { ACCENTS, get, ms, update, useSettings } from "@/features/settings/settings";
import { LANGS } from "@/i18n";
import { useAccount } from "@/features/account/auth";
import { Avatar, LoginBox } from "@/features/account/AccountUI";

const FLAG = "fixit:setup:v1";
const SETTINGS_KEY = "fixit:settings:v1";

// 初めて起動したときだけ出す。すでに設定がある人(以前から使っている人)には出さない。
// ?setup で、いつでも出せる(確認用)
export function needSetup(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("setup")) return true;
    if (q.has("nosplash")) return false;
    if (kvGet(FLAG)) return false;
    if (kvGet(SETTINGS_KEY)) { kvSet(FLAG, "1"); return false; }
    return true;
  } catch { return false; }
}
const markSetupDone = () => { try { kvSet(FLAG, "1"); } catch { /* 保存できなくても動かす */ } };

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="su-row">
      <div className="su-l"><span>{label}</span>{hint && <small>{hint}</small>}</div>
      <div className="su-c">{children}</div>
    </div>
  );
}

// 言語・テーマ・基本設定を選ぶ初回画面。選んだ内容はその場で反映される
export default function Setup({ onClose, out }: { onClose: () => void; out?: boolean }) {
  const s = useSettings();
  const [closing, setClosing] = useState(false);
  const [step, setStep] = useState<0 | 1>(0);
  const user = useAccount();
  const done = () => { markSetupDone(); setClosing(true); setTimeout(onClose, ms(180)); };
  const modes = [["light", i18next.t("ライト"), Sun], ["dark", i18next.t("ダーク"), Moon], ["auto", i18next.t("自動"), Monitor]] as const;
  const sw = (id: "wsRestore" | "statsOn", label: string) => (
    <button className="switch" role="switch" aria-checked={get()[id]} aria-label={label} onClick={() => update({ [id]: !get()[id] })} />
  );
  return (
    <div className="qo-backdrop su-backdrop" data-mid data-closing={closing || !!out}>
      <div className="qo dlg setup" role="dialog" aria-modal="true" aria-label={i18next.t("はじめの設定")}>
        {step === 1 ? (
          <>
            <h2><Trans i18nKey="Lapount でログイン" /></h2>
            <p><Trans i18nKey="設定・プロファイル・ワークスペースの場所をほかの PC とそろえ、フィードバックの返信を受け取れます。ログインしなくても、すべての機能を使えます。あとで「設定」の「アカウント」からもできます。" /></p>
            {user ? (
              <div className="acct-card"><Avatar user={user} size={44} /><div className="acct-who"><b>{user.name}</b><small>{user.handle ? `@${user.handle}` : user.email}</small></div></div>
            ) : <LoginBox compact />}
            <div className="dlg-foot">
              <button className="btn" onClick={() => setStep(0)}><Trans i18nKey="戻る" /></button>
              {user ? <button className="btn" data-primary="true" autoFocus onClick={done}><Trans i18nKey="はじめる" /></button> : <button className="btn" onClick={done}><Trans i18nKey="スキップ" /></button>}
            </div>
          </>
        ) : (<>
        <h2><Trans i18nKey="はじめの設定" /></h2>
        <p><Trans i18nKey="あとで「設定」からいつでも変えられます。" /></p>

        <Row label={i18next.t("言語")}>
          <div className="seg" role="group" aria-label={i18next.t("言語")}>
            <button aria-pressed={s.lang === "auto"} onClick={() => update({ lang: "auto" })}><Trans i18nKey="自動" /></button>
            {LANGS.map(([id, name]) => <button key={id} aria-pressed={s.lang === id} onClick={() => update({ lang: id })}>{name}</button>)}
          </div>
        </Row>
        <Row label={i18next.t("テーマ")}>
          <div className="seg" role="group" aria-label={i18next.t("テーマ")}>
            {modes.map(([id, label, Icon]) => <button key={id} aria-pressed={s.mode === id} onClick={() => update({ mode: id })}><Icon />{label}</button>)}
          </div>
        </Row>
        <Row label={i18next.t("アクセント色")}>
          <div className="sw-row" style={{ padding: 0 }}>
            {ACCENTS.map((c) => <button key={c} className="sw" aria-label={c} data-on={s.accent === c} style={{ background: c }} onClick={() => update({ accent: c })} />)}
          </div>
        </Row>
        <div className="su-sep" />
        <Row label={i18next.t("起動したとき、前回の続きを開く")} hint={i18next.t("開いていたフォルダとタブを戻します")}>{sw("wsRestore", i18next.t("起動したとき、前回の続きを開く"))}</Row>
        <Row label={i18next.t("作業時間と入力数を記録する")} hint={i18next.t("この PC の中だけに保存します。外部へは送りません")}>{sw("statsOn", i18next.t("作業時間と入力数を記録する"))}</Row>

        <div className="dlg-foot"><button className="btn" data-primary="true" autoFocus onClick={() => setStep(1)}><Trans i18nKey="次へ" /></button></div>
        </>)}
      </div>
    </div>
  );
}
