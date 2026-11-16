import { useRef } from "react";
import i18next from "i18next";
import { RotateCcw } from "lucide-react";
import { Select } from "@/shared/Select";
import { notify } from "@/shared/notify";
import { delBlob, IMAGE_TYPES, MAX_BLOB_BYTES, putBlob } from "./host/blobs";
import { effective, runCommand } from "./host/runtime";
import { putSetting, resetSettings, useSettingsVersion, type FileVal, type SettingVal } from "./host/store";
import type { ExtSetting } from "./spec";
import type { Installed } from "./registry";

// 拡張機能が宣言した設定を、本体の設定と同じ見た目(.set-row)で並べる。ラベルは拡張の書いた文字をそのまま出す
function Row({ x, s, v }: { x: Installed; s: ExtSetting; v: SettingVal }) {
  const set = (val: SettingVal) => putSetting(x.id, s.id, val);
  const pick = useRef<HTMLInputElement>(null);
  const changed = s.kind !== "button" && JSON.stringify(v) !== JSON.stringify(s.kind === "file" ? null : s.def);
  let ctl: React.ReactNode = null;
  if (s.kind === "bool") ctl = <button className="switch" role="switch" aria-checked={v as boolean} aria-label={s.label} onClick={() => set(!v)} />;
  else if (s.kind === "enum") ctl = <Select value={v as string} options={s.options.map(([k, t]) => ({ value: k, label: t }))} label={s.label} onChange={set} />;
  else if (s.kind === "text") ctl = <input className="field set-text" value={v as string} spellCheck={false} aria-label={s.label} onChange={(e) => set(e.target.value)} />;
  else if (s.kind === "color") ctl = <input type="color" className="set-color" value={/^#[0-9a-f]{6}$/i.test(v as string) ? (v as string) : "#000000"} aria-label={s.label} onChange={(e) => set(e.target.value)} />;
  else if (s.kind === "num") {
    const n = v as number, fill = s.max > s.min ? ((n - s.min) / (s.max - s.min)) * 100 : 0;
    ctl = (
      <div className="range">
        <input type="range" min={s.min} max={s.max} step={s.step} value={n} aria-label={s.label} style={{ ["--fill" as string]: `${fill}%` }} onChange={(e) => set(+e.target.value)} />
        <output>{s.step < 1 ? n.toFixed(String(s.step).split(".")[1]?.length ?? 1) : n}</output>
      </div>
    );
  } else if (s.kind === "button") ctl = <button className="btn" onClick={() => s.command && runCommand(x.id, s.command)}>{s.label}</button>;
  else {
    const f = v as FileVal | null;
    const choose = async (file: File | undefined) => {
      if (!file) return;
      if (!IMAGE_TYPES.includes(file.type)) { notify(i18next.t("画像(png・jpeg・webp・gif・avif)を選んでください"), "error"); return; }
      if (file.size > MAX_BLOB_BYTES) { notify(i18next.t("画像が大きすぎます(上限 {{mb}} MB)", { mb: Math.round(MAX_BLOB_BYTES / 1048576) }), "error"); return; }
      const ref = `${x.id}/${s.id}/${Date.now().toString(36)}`;
      await putBlob(ref, file);
      if (f) void delBlob(f.ref);
      set({ ref, name: file.name.slice(0, 80), size: file.size, at: Date.now() });
    };
    ctl = (
      <div className="set-file">
        <input ref={pick} type="file" accept={IMAGE_TYPES.join(",")} hidden onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
        {f && <span className="set-file-name" title={f.name}>{f.name}</span>}
        <button className="btn" onClick={() => pick.current?.click()}>{i18next.t(f ? "画像を変える" : "画像を選ぶ")}</button>
        {f && <button className="btn" onClick={() => { void delBlob(f.ref); set(null); }}>{i18next.t("外す")}</button>}
      </div>
    );
  }
  const reset = () => { if (s.kind === "file" && v) void delBlob((v as FileVal).ref); putSetting(x.id, s.id, s.kind === "file" ? null : (s.def as SettingVal)); };
  return (
    <div className="set-row" data-changed={changed}>
      <div className="set-l"><span>{s.kind === "button" ? "" : s.label}</span>{s.hint && <small>{s.hint}</small>}</div>
      <div className="set-c">
        {ctl}
        <button className="icon-btn set-reset" aria-label={i18next.t("{{label}}を初期値に戻す", { label: s.label })} title={i18next.t("初期値に戻す")} tabIndex={changed ? 0 : -1} onClick={reset}><RotateCcw /></button>
      </div>
    </div>
  );
}

/** 有効な拡張が宣言した設定の一覧(拡張ごとの見出しつき)。設定がなければ何も出さない */
export function ExtSettingGroups({ list }: { list: Installed[] }) {
  useSettingsVersion();
  const withSet = list.filter((x) => x.active && x.manifest.settings.length > 0);
  if (!withSet.length) return null;
  return (
    <>
      {withSet.map((x) => {
        const vals = effective(x.manifest, x.id);
        return (
          <section key={x.id} className="set-rows" aria-label={x.manifest.name}>
            <h3 className="set-h">{x.manifest.name}</h3>
            {x.manifest.settings.map((s) => <Row key={s.id} x={x} s={s} v={vals[s.id]} />)}
            {x.manifest.settings.some((s) => s.kind !== "button") && <button className="btn set-ext-reset" onClick={() => { x.manifest.settings.forEach((s) => s.kind === "file" && (vals[s.id] as FileVal | null) && void delBlob((vals[s.id] as FileVal).ref)); resetSettings(x.id); }}>{i18next.t("この拡張の設定をすべて初期値に戻す")}</button>}
          </section>
        );
      })}
    </>
  );
}
