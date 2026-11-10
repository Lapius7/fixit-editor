// 変わりやすい値はここに集約する
export const APP_NAME = "Fixit Editor";
export const TAB_SIZE = 2;
export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".turbo", "DerivedData"]);
export const MAX_OPEN_BYTES = 2_000_000;

// プレビューの更新を待つ時間(打鍵のたびに作り直さないため)
export const PREVIEW_DELAY_MS = 250;

// アプリ内ブラウザの最初のアドレス欄
export const BROWSER_DEFAULT_URL = "http://localhost:5173";

// 設定の変更履歴: 残す件数と、続けて変えたものを 1 件にまとめる待ち時間
export const SETTINGS_HISTORY_MAX = 100;
export const SETTINGS_HISTORY_DELAY_MS = 1500;

// AI 連携。キーは設定とは別のキーに置く(設定の書き出し・履歴に混ざらないように)
export const AI_STORE_KEY = "fixit:ai:v1";
export const AI_CHATS_KEY = "fixit:ai-chats:v1"; // 会話の履歴。API キーとは別に置く(設定の書き出し・変更履歴・統計には載らない)
export const AI_CHATS_MAX = 50; // 残す会話の数(古いものから消す)
export const AI_CHATS_MAX_CHARS = 1_500_000; // 全会話の文字数の上限(localStorage の容量を使い切らないため)
export const AI_MAX_CONTEXT_CHARS = 60_000; // 1 回に送るコードの上限
export const AI_MAX_TOKENS = 16_000;
export const AI_DEFAULT_MODEL = { anthropic: "claude-opus-5-5", openai: "gpt-5", "claude-cli": "" } as const;
export const AI_MODEL_HINTS = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
  openai: ["gpt-5", "gpt-5-mini"],
  "claude-cli": ["opus", "sonnet", "haiku"],
} as const;
export const AI_TRANSLATE_TO = [["ja", "日本語"], ["en", "English"], ["ko", "한국어"]] as const;
export const AI_MAX_HISTORY_CHARS = 120_000; // 会話の履歴として送る量の上限(古い発言から外す)

// 匿名の利用数(インストール数・利用者数)。送り先と保存キーはここだけで決める
export const TELEMETRY_URL = "https://fixit-editor.lapius7.com/api/ping";
export const TELEMETRY_STORE_KEY = "fixit:telemetry:v1";
