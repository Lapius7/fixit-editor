// AI パネルの、モデルと考える量(Effort)の選択。使えるプロバイダーのモデルを 1 つの一覧に混ぜて出す。
import i18next from "i18next";
import { connected, EFFORTS, hasEffort, modelsOf, PROVIDER_SHORT, setActive, setEffort, useAi, useLink, type Effort, type Provider } from "@/features/ai/store";

import { Select } from "@/shared/Select";

const SEP = "\u0001";

export function ModelPicker({ disabled }: { disabled?: boolean }) {
  const cfg = useAi();
  const link = useLink();
  // 選んでいるプロバイダーは、接続の確認が終わっていなくても必ず一覧に入れる
  const ps = connected(cfg, link);
  const list: Provider[] = ps.includes(cfg.provider) || !cfg.enabled[cfg.provider] ? ps : [...ps, cfg.provider];
  const label = (p: Provider, m: string) => `${m || i18next.t("claude の既定")} (${i18next.t(PROVIDER_SHORT[p])})`;
  const cur = cfg.provider + SEP + cfg.models[cfg.provider];
  return (
    <div className="ai-pick">
      <Select className="ai-pick-model" disabled={disabled} value={cur} label={i18next.t("モデル")} title={i18next.t("モデル")}
        options={list.flatMap((p) => modelsOf(cfg, p).map((m) => ({ value: p + SEP + m, label: label(p, m), short: m || i18next.t("(claude の既定)") })))}
        onChange={(v) => { const i = v.indexOf(SEP); setActive(v.slice(0, i) as Provider, v.slice(i + 1)); }} />
      {hasEffort(cfg.provider) && (
        <Select className="ai-pick-effort" disabled={disabled} value={cfg.effort} label={i18next.t("考える量")} title={i18next.t("考える量(Effort)。上げると丁寧になりますが、遅くなり、利用枠も多く使います。モデルによっては使えません")}
          options={EFFORTS.map((x) => ({ value: x, label: i18next.t("Effort: {{v}}", { v: x || i18next.t("既定") }), short: x || i18next.t("既定") }))}
          onChange={(v) => setEffort(v as Effort)} />
      )}
    </div>
  );
}
