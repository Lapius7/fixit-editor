import { useState } from "react";
import i18next from "i18next";
import { KeyRound, Pencil, Plus, RefreshCw, Trash2, Variable as VarIcon } from "lucide-react";
import { ask } from "@/shared/ask";
import { gh, relTime, sealSecret } from "./api";
import type { Ctx } from "./GithubView";
import { act, Busy, Empty, Fail, Head, useLoad } from "./ui";

type Draft = { name: string; value: string; exists: boolean };

// 追加と更新の入力欄。変数は値を見せ、シークレットは値を伏せる(保存後は GitHub も値を返さない)
function Form({ kind, d, onChange, onSave, onCancel }: { kind: "var" | "secret"; d: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const ok = /^[A-Za-z_][A-Za-z0-9_]*$/.test(d.name) && !/^GITHUB_/i.test(d.name) && (kind === "var" ? true : d.value !== "");
  return (
    <section className="gh-card">
      <label className="gh-f"><span>{i18next.t("名前")}</span>
        <input className="field" value={d.name} disabled={d.exists} autoFocus={!d.exists} placeholder="MY_NAME" spellCheck={false} onChange={(e) => onChange({ ...d, name: e.target.value.toUpperCase() })} />
        <small>{i18next.t("英数字と _ だけ。数字では始められません。GITHUB_ で始まる名前は使えません。")}</small>
      </label>
      <label className="gh-f"><span>{i18next.t("値")}</span>
        {kind === "var"
          ? <textarea className="field gh-area" rows={3} value={d.value} spellCheck={false} aria-label={i18next.t("値")} onChange={(e) => onChange({ ...d, value: e.target.value })} />
          : <textarea className="field gh-area gh-secret" rows={3} value={d.value} spellCheck={false} autoComplete="off" aria-label={i18next.t("値")} onChange={(e) => onChange({ ...d, value: e.target.value })} />}
        {kind === "secret" && <small>{i18next.t("この PC で暗号化してから GitHub へ送ります。保存したあとは、値を読み出せません。")}</small>}
      </label>
      <div className="gh-actions">
        <button className="btn" onClick={onCancel}>{i18next.t("やめる")}</button>
        <button className="btn" data-primary="true" disabled={!ok} onClick={onSave}>{i18next.t("保存")}</button>
      </div>
    </section>
  );
}

export default function Config(ctx: Ctx) {
  const { s } = ctx;
  const vars = useLoad(() => gh.variables(s), [s.owner, s.repo]);
  const secs = useLoad(() => gh.secrets(s), [s.owner, s.repo]);
  const [edit, setEdit] = useState<{ kind: "var" | "secret"; d: Draft } | null>(null);

  const save = async () => {
    if (!edit) return;
    const { kind, d } = edit;
    const name = d.name.trim();
    const done = await act(async () => {
      if (kind === "var") await gh.setVariable(s, name, d.value, d.exists);
      else { const k = await gh.secretKey(s); await gh.putSecret(s, name, await sealSecret(k.key, d.value), k.key_id); }
    }, i18next.t("保存しました"));
    if (!done) return;
    setEdit(null);
    void (kind === "var" ? vars : secs).reload();
  };
  const del = async (kind: "var" | "secret", name: string) => {
    if (!(await ask({ message: i18next.t("「{{name}}」を削除します。これを使うワークフローは失敗するようになります。", { name }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => (kind === "var" ? gh.deleteVariable(s, name) : gh.deleteSecret(s, name)), i18next.t("削除しました"))) void (kind === "var" ? vars : secs).reload();
  };

  return (
    <div className="gh-page">
      <Head title={i18next.t("変数とシークレット")} sub={i18next.t("GitHub Actions のワークフローから使います")}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void vars.reload(); void secs.reload(); }}><RefreshCw size={14} /></button>
      </Head>
      {edit && <Form kind={edit.kind} d={edit.d} onChange={(d) => setEdit({ ...edit, d })} onSave={() => void save()} onCancel={() => setEdit(null)} />}

      <section className="gh-card">
        <div className="gh-head"><div className="gh-head-t"><h4><VarIcon size={14} />{i18next.t("変数")}</h4><small>{i18next.t("値を読み書きできます")}</small></div>
          <div className="gh-head-a"><button className="btn" onClick={() => setEdit({ kind: "var", d: { name: "", value: "", exists: false } })}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div></div>
        {vars.busy && !vars.data ? <Busy /> : vars.err ? <Fail msg={vars.err} retry={() => void vars.reload()} /> : (vars.data ?? []).length === 0 ? <Empty text={i18next.t("変数がありません")} /> : (
          <ul className="gh-list">{vars.data!.map((v) => (
            <li key={v.name} className="gh-item gh-item-static">
              <span className="gh-item-t"><b>{v.name}</b><small className="gh-val">{v.value}</small></span>
              <span className="gh-item-r">
                <small>{relTime(v.updated_at)}</small>
                <button className="icon-btn" aria-label={i18next.t("編集")} title={i18next.t("編集")} onClick={() => setEdit({ kind: "var", d: { name: v.name, value: v.value, exists: true } })}><Pencil size={14} /></button>
                <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del("var", v.name)}><Trash2 size={14} /></button>
              </span>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="gh-card">
        <div className="gh-head"><div className="gh-head-t"><h4><KeyRound size={14} />{i18next.t("シークレット")}</h4><small>{i18next.t("書き込み専用です")}</small></div>
          <div className="gh-head-a"><button className="btn" onClick={() => setEdit({ kind: "secret", d: { name: "", value: "", exists: false } })}><Plus size={14} /><span>{i18next.t("追加")}</span></button></div></div>
        {secs.busy && !secs.data ? <Busy /> : secs.err ? <Fail msg={secs.err} retry={() => void secs.reload()} /> : (secs.data ?? []).length === 0 ? <Empty text={i18next.t("シークレットがありません")} /> : (
          <ul className="gh-list">{secs.data!.map((v) => (
            <li key={v.name} className="gh-item gh-item-static">
              <span className="gh-item-t"><b>{v.name}</b><small>{i18next.t("更新")} {relTime(v.updated_at)}</small></span>
              <span className="gh-item-r">
                <button className="icon-btn" aria-label={i18next.t("値を上書き")} title={i18next.t("値を上書き")} onClick={() => setEdit({ kind: "secret", d: { name: v.name, value: "", exists: true } })}><Pencil size={14} /></button>
                <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void del("secret", v.name)}><Trash2 size={14} /></button>
              </span>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );
}
