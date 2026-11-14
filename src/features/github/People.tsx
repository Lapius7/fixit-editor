import { useState } from "react";
import i18next from "i18next";
import { ExternalLink, Plus, RefreshCw, Trash2, UserPlus, Webhook } from "lucide-react";
import { Select } from "@/shared/Select";
import { ask } from "@/shared/ask";
import { openExternal } from "@/features/account/auth";
import { gh } from "./api";
import type { Ctx } from "./GithubView";
import { act, Avatar, Busy, Empty, Fail, Head, Pill, Switch, useLoad } from "./ui";

export default function People(ctx: Ctx) {
  const { s, repo, viewer } = ctx;
  const admin = !!repo.permissions?.admin;
  const people = useLoad(() => gh.collaborators(s), [s.owner, s.repo]);
  const hooks = useLoad(() => gh.hooks(s), [s.owner, s.repo]);
  const [login, setLogin] = useState("");
  const [perm, setPerm] = useState("push");

  const add = async () => {
    const l = login.trim().replace(/^@/, "");
    if (!l) return;
    if (await act(() => gh.addCollaborator(s, l, perm), i18next.t("招待を送りました"))) { setLogin(""); void people.reload(); }
  };
  const remove = async (l: string) => {
    if (!(await ask({ message: i18next.t("「{{name}}」をこのリポジトリから外します。", { name: l }), ok: i18next.t("外す"), danger: true }))) return;
    if (await act(() => gh.removeCollaborator(s, l), i18next.t("外しました"))) void people.reload();
  };
  const toggle = async (id: number, on: boolean) => { if (await act(() => gh.updateHook(s, id, { active: on }))) void hooks.reload(); };
  const delHook = async (id: number, url: string) => {
    if (!(await ask({ message: i18next.t("Webhook「{{url}}」を削除します。", { url }), ok: i18next.t("削除する"), danger: true }))) return;
    if (await act(() => gh.deleteHook(s, id), i18next.t("削除しました"))) void hooks.reload();
  };

  return (
    <div className="gh-page">
      <Head title={i18next.t("メンバーと Webhook")}>
        <button className="icon-btn" aria-label={i18next.t("再読み込み")} title={i18next.t("再読み込み")} onClick={() => { void people.reload(); void hooks.reload(); }}><RefreshCw size={14} /></button>
      </Head>

      <section className="gh-card">
        <h4><UserPlus size={14} />{i18next.t("メンバー")}</h4>
        {admin && (
          <div className="gh-bar">
            <input className="field gh-grow" value={login} placeholder={i18next.t("GitHub のユーザー名")} aria-label={i18next.t("GitHub のユーザー名")} spellCheck={false} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
            <Select value={perm} label={i18next.t("権限")} onChange={setPerm} options={[
              { value: "pull", label: i18next.t("読み取り") }, { value: "triage", label: i18next.t("トリアージ") }, { value: "push", label: i18next.t("書き込み") },
              { value: "maintain", label: i18next.t("メンテナー") }, { value: "admin", label: i18next.t("管理者") },
            ]} />
            <button className="btn" data-primary="true" disabled={!login.trim()} onClick={() => void add()}><Plus size={14} /><span>{i18next.t("招待")}</span></button>
          </div>
        )}
        {people.busy && !people.data ? <Busy /> : people.err ? <Fail msg={people.err} retry={() => void people.reload()} /> : (people.data ?? []).length === 0 ? <Empty text={i18next.t("メンバーがいません")} /> : (
          <ul className="gh-list">{people.data!.map((p) => (
            <li key={p.login} className="gh-item gh-item-static">
              <Avatar u={{ login: p.login, avatar_url: p.avatar_url } as never} size={22} />
              <span className="gh-item-t"><b>{p.login}</b></span>
              <span className="gh-item-r">
                <Pill tone={p.permissions?.admin ? "warn" : "mute"}>{p.role_name ?? (p.permissions?.admin ? "admin" : "write")}</Pill>
                <button className="icon-btn" aria-label={i18next.t("GitHub で開く")} title={i18next.t("GitHub で開く")} onClick={() => void openExternal(p.html_url)}><ExternalLink size={14} /></button>
                {admin && p.login !== viewer.login && p.login !== s.owner && <button className="icon-btn" aria-label={i18next.t("外す")} title={i18next.t("外す")} onClick={() => void remove(p.login)}><Trash2 size={14} /></button>}
              </span>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="gh-card">
        <h4><Webhook size={14} />Webhook</h4>
        {hooks.busy && !hooks.data ? <Busy /> : hooks.err ? <Fail msg={hooks.err} retry={() => void hooks.reload()} /> : (hooks.data ?? []).length === 0 ? <Empty text={i18next.t("Webhook がありません")} /> : (
          <ul className="gh-list">{hooks.data!.map((h) => (
            <li key={h.id} className="gh-item gh-item-static">
              <span className="gh-item-t"><b className="gh-val" title={h.config.url ?? h.name}>{(h.config.url ?? h.name).replace(/^https:\/\//i, "")}</b><small>{h.events.join(", ")}{h.last_response?.code ? ` · ${h.last_response.code}` : ""}</small></span>
              <span className="gh-item-r">
                <Switch on={h.active} label={h.config.url ?? h.name} disabled={!admin} onChange={(v) => void toggle(h.id, v)} />
                {admin && <button className="icon-btn" aria-label={i18next.t("削除")} title={i18next.t("削除")} onClick={() => void delHook(h.id, h.config.url ?? h.name)}><Trash2 size={14} /></button>}
              </span>
            </li>
          ))}</ul>
        )}
        <p className="gh-none">{i18next.t("Webhook の追加は、宛先の URL と秘密の値を扱うため、GitHub の画面で行ってください。")}</p>
      </section>
    </div>
  );
}
