// 会話を送らなくても、使用量(残り枠)を定期的に取り直す。画面が見えているときだけ、決まった間隔で問い合わせる。
import { useEffect } from "react";
import { useAi } from "@/features/ai/store";
import { refreshCopilotUsage } from "@/features/ai/copilotUsage";
import { claudeUsage } from "@/features/ai/providers";
import { recordLimit } from "@/features/ai/usage";

const EVERY = 5 * 60_000;

async function refreshClaudeUsage() {
  const l = await claudeUsage();
  if (!l) return;
  for (const [id, x] of Object.entries(l)) { const t = Date.parse(x.r); recordLimit("claude-cli", id, x.u, Number.isFinite(t) ? Math.floor(t / 1000) : 0); }
}

export function useUsagePoll() {
  const cfg = useAi();
  const key = cfg.enabled.copilot ? cfg.keys.copilot : "";
  const claude = cfg.enabled["claude-cli"] && !!cfg.consent["claude-cli"];
  useEffect(() => {
    if (!key && !claude) return;
    const ac = new AbortController();
    const run = () => {
      if (document.hidden) return;
      if (key) void refreshCopilotUsage(key, ac.signal);
      if (claude) void refreshClaudeUsage();
    };
    run();
    const t = setInterval(run, EVERY);
    document.addEventListener("visibilitychange", run);
    return () => { ac.abort(); clearInterval(t); document.removeEventListener("visibilitychange", run); };
  }, [key, claude]);
}
