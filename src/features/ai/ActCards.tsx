// 返答の途中に出す、AI のファイル操作のカード。読む・一覧は 1 行、変更は Git の差分のように見せて、許可か却下を選ぶ。
import { memo } from "react";
import { ArrowRight, Check, FilePen, FilePlus, FileText, FolderPlus, FolderTree, MoveRight, Search, SquareTerminal, Trash2, X } from "lucide-react";
import i18next from "i18next";
import type { Act } from "@/features/ai/tools";

export type Decide = (id: string, d: "apply" | "reject") => void;

const rows = (s: string) => (s === "" ? [] : s.split("\n"));
const STATE: Record<string, string> = { applied: "適用しました", rejected: "却下しました", stale: "適用できませんでした(ファイルが変わっています)", err: "変更を作れませんでした" };
const OP_STATE: Record<string, string> = { applied: "実行しました", rejected: "却下しました", err: "実行できませんでした" };
type Op = Extract<Act, { k: "create" | "mkdir" | "move" | "delete" }>;
const OP_ICON = { create: FilePlus, mkdir: FolderPlus, move: MoveRight, delete: Trash2 } as const;
const bytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

/* 作る・移す・消すの確認カード(差分は無く、対象と許可・却下だけを出す) */
function OpCard({ a, onDecide }: { a: Op; onDecide: Decide }) {
  const Icon = OP_ICON[a.k];
  const title = a.k === "create" ? i18next.t("ファイルを作る") : a.k === "mkdir" ? i18next.t("フォルダを作る") : a.k === "move" ? i18next.t("移動・名前の変更") : i18next.t("削除");
  return (
    <div className="ai-edit" data-st={a.st} data-op={a.k}>
      <div className="ai-edit-h"><Icon aria-hidden /><span className="ai-edit-ht">{title}</span>{a.k === "create" && a.size != null ? <small>{bytes(a.size)}</small> : null}</div>
      <div className="ai-op-p" title={a.k === "move" ? `${a.path} → ${a.to}` : a.path}>
        <code>{a.path}</code>
        {a.k === "move" && <><ArrowRight aria-hidden /><code>{a.to}</code></>}
      </div>
      <div className="ai-edit-f">
        {a.st === "pending" ? (
          <>
            <button className="ai-edit-b" onClick={() => onDecide(a.id, "reject")}><X aria-hidden />{i18next.t("却下")}</button>
            <button className="ai-edit-b" data-primary="true" data-danger={a.k === "delete" || undefined} onClick={() => onDecide(a.id, "apply")}><Check aria-hidden />{a.k === "delete" ? i18next.t("削除する") : i18next.t("許可")}</button>
          </>
        ) : <span className="ai-edit-s" role="status" data-st={a.st}>{a.st === "applied" && <Check aria-hidden />}{a.st === "err" && a.err ? a.err : i18next.t(OP_STATE[a.st])}</span>}
      </div>
    </div>
  );
}

/* コマンドの確認カード。実行するコマンドを全文見せ、許可すると動かして、終了コードと出力を残す */
function RunCard({ a, onDecide }: { a: Extract<Act, { k: "run" }>; onDecide: Decide }) {
  const bad = a.st === "applied" && a.code !== 0;
  return (
    <div className="ai-edit" data-st={a.st} data-op="run">
      <div className="ai-edit-h"><SquareTerminal aria-hidden /><span className="ai-edit-ht">{i18next.t("コマンドを実行")}</span></div>
      <pre className="ai-run-c scroll" aria-label={i18next.t("実行するコマンド")}>{a.cmd}</pre>
      {a.st === "applied" && a.out?.trim() ? <pre className="ai-run-o scroll" aria-label={i18next.t("コマンドの出力")}>{a.out.trimEnd()}</pre> : null}
      <div className="ai-edit-f">
        {a.st === "pending" ? (
          <>
            <button className="ai-edit-b" onClick={() => onDecide(a.id, "reject")}><X aria-hidden />{i18next.t("却下")}</button>
            <button className="ai-edit-b" data-primary="true" onClick={() => onDecide(a.id, "apply")}><Check aria-hidden />{i18next.t("実行する")}</button>
          </>
        ) : (
          <span className="ai-edit-s" role="status" data-st={bad ? "err" : a.st}>
            {a.st === "applied" && !bad && <Check aria-hidden />}
            {a.st === "applied" ? (a.timedOut ? i18next.t("時間切れで止めました") : i18next.t("終了コード {{code}}", { code: a.code ?? 0 })) : a.st === "err" && a.err ? a.err : i18next.t(OP_STATE[a.st])}
          </span>
        )}
      </div>
    </div>
  );
}

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
  if (a.k === "search") return <div className="ai-fop" data-err={!!a.err || undefined}><Search aria-hidden /><span className="ai-fop-t truncate" title={a.query}>{a.err ? i18next.t("「{{q}}」を検索できませんでした", { q: a.query }) : i18next.t("「{{q}}」を検索しました", { q: a.query })}</span>{a.n != null && !a.err ? <small>{i18next.t("{{n}} 件ヒット", { n: a.n })}</small> : null}</div>;
  if (a.k === "run") return <RunCard a={a} onDecide={onDecide} />;
  if (a.k !== "edit") return <OpCard a={a} onDecide={onDecide} />;
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
