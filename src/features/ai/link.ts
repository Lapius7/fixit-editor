// claude コマンドの接続状態を確かめる・ログインを始める(状態は store.ts の link に持つ)。トークンには触れない。
import { claudeLogin, claudeStatus } from "@/features/ai/providers";
import { getLink, setLink } from "@/features/ai/store";

let checking: Promise<void> | null = null;
// 状態を確かめる。同時に何度呼ばれても 1 回だけ動かす
export function refreshLink(): Promise<void> {
  if (checking) return checking;
  if (getLink() === "unknown") setLink("checking");
  checking = claudeStatus().then((v) => setLink(v)).finally(() => { checking = null; });
  return checking;
}

// ログインを始め、終わったら状態を確かめ直す。戻り値はログインが完了したか
export async function login(onUrl: (u: string) => void, signal: AbortSignal): Promise<boolean> {
  const ok = await claudeLogin(onUrl, signal);
  await refreshLink();
  return ok && getLink() === "ready";
}
