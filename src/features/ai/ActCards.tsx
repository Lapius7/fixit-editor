// 返答の途中に出す、AI のファイル操作のカード。読む・一覧は 1 行、変更は Git の差分のように見せて、許可か却下を選ぶ。
import { memo } from "react";
import { Check, FilePen, FileText, FolderTree, X } from "lucide-react";
import i18next from "i18next";
import type { Act } from "@/features/ai/tools";

export type Decide = (id: string, d: "apply" | "reject") => void;

const rows = (s: string) => (s === "" ? [] : s.split("\n"));
const STATE: Record<string, string> = { applied: "適用しました", rejected: "却下しました", stale: "適用できませんでした(ファイルが変わっています)", err: "変更を作れませんでした" };

function Diff({ a }: { a: Extract<Act, { k: "edit" }> }) {
  const line = (cls: string, sign: string, text: string, key: string) => <div key={key} className="ai-diff-l" data-k={cls}><span aria-hidden>{sign}</span><code>{text || " "}</code></div>;
  return (
    <div className="ai-diff scroll" role="group" aria-label={i18next.t("変更の差分")}>
      {rows(a.pre).map((t, i) => line("ctx", " ", t, `p${i}`))}
      {rows(a.old).map((t, i) => line("del", "-", t, `o${i}`))}
      {rows(a.neu).map((t, i) => line("add", "+", t, `n${i}`))}
      {rows(a.post).map((t, i) => line("ctx", " ", t, `q${i}`))}
    </div>
  );
}

export const ActCard = memo(function ActCard({ a, onDecide }: { a: Act; onDecide: Decide }) {
  if (a.k === "read") return <div className="ai-fop" data-err={!!a.err || undefined}><FileText aria-hidden /><span className="ai-fop-t truncate" title={a.path}>{a.err ? i18next.t("{{path}} を読めませんでした", { path: a.path }) : i18next.t("{{path}} を読みました", { path: a.path })}</span>{a.from ? <small>{i18next.t("{{a}}〜{{b}} 行", { a: a.from, b: a.to })}</small> : null}</div>;
  if (a.k === "list") return <div className="ai-fop" data-err={!!a.err || undefined}><FolderTree aria-hidden /><span className="ai-fop-t truncate" title={a.path}>{i18next.t("{{path}} の一覧を見ました", { path: a.path })}</span></div>;
  return (
    <div className="ai-edit" data-st={a.st}>
      <div className="ai-edit-h"><FilePen aria-hidden /><span className="ai-fop-t truncate" title={a.path}>{a.path}</span><small>{i18next.t("{{n}} 行目", { n: a.line })}</small></div>
      {a.st !== "err" && <Diff a={a} />}
      <div className="ai-edit-f">
        {a.st === "pending" ? (
          <>
            <button className="ai-edit-b" onClick={() => onDecide(a.id, "reject")}><X aria-hidden />{i18next.t("却下")}</button>
            <button className="ai-edit-b" data-primary="true" onClick={() => onDecide(a.id, "apply")}><Check aria-hidden />{i18next.t("適用")}</button>
          </>
        ) : <span className="ai-edit-s" role="status" data-st={a.st}>{a.st === "applied" && <Check aria-hidden />}{i18next.t(STATE[a.st])}</span>}
      </div>
    </div>
  );
}, (x, y) => x.a === y.a);
