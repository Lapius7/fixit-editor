// 変わりやすい値はここに集約する
export const APP_NAME = "Fixit Editor";
export const TAB_SIZE = 2;
export const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "target", ".next", ".turbo", "DerivedData"]);
export const MAX_OPEN_BYTES = 2_000_000;

// プレビューの更新を待つ時間(打鍵のたびに作り直さないため)
export const PREVIEW_DELAY_MS = 250;
export const PREVIEW_FIRST_MS = 1200; // HTML プレビューの初回: 画像などの埋め込みがこれより遅いときは、本文だけ先に出す
export const PREVIEW_REFOCUS_MS = 3000; // ウィンドウに戻ったときの読み直しは、この間隔より詰めない

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
export const AI_MAX_HISTORY_CHARS = 120_000; // 会話の履歴として送る量の上限(古い発言から外す)
// AI に添える画像。API が受け付ける形式(これ以外は PNG に描き直す)と、縮める大きさ
export const AI_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const AI_IMAGE_MAX_EDGE = 1568; // 長い辺の上限(px)。超えたら縮める
export const AI_IMAGE_MAX_BYTES = 3_500_000; // 1 枚の上限。base64 にすると 4/3 倍になり、API の 5MB に収まる
export const AI_IMAGE_SRC_MAX_BYTES = 30_000_000; // 読み込む元の画像の上限
export const AI_MAX_IMAGES = 4; // 1 回に添えられる枚数
export const AI_MAX_HISTORY_IMAGES = 8; // 履歴も含めて 1 回のリクエストに載せる枚数(古い画像から外す)
export const AI_CLI_MAX_BODY = 48 * 1024 * 1024; // 開発サーバーの claude 中継が受け取る大きさ(画像を含む)

// 匿名の利用数(インストール数・利用者数)。送り先と保存キーはここだけで決める
// 受信と更新配布の口。エンドポイントはここに集める
const API_BASE = "https://fixit-editor.lapius7.com";
export const SITE_URL = API_BASE;
export const REPO_URL = "https://github.com/Lapius7/fixit-editor";
export const TELEMETRY_URL = `${API_BASE}/api/ping`;
export const USAGE_URL = `${API_BASE}/api/usage`;
export const ERROR_URL = `${API_BASE}/api/error`;
export const FEEDBACK_URL = `${API_BASE}/api/feedback`;
export const UPDATE_URL = `${API_BASE}/api/update/latest`;
// Lapount ログイン(端末間の同期・フィードバックの紐づけ)。anon キーは公開してよい値
export const LAPOUNT_URL = "https://supabase.lapius7.com";
export const LAPOUNT_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg5MTYwNDMwLCJleHAiOjE5NDY4NDA0MzB9.bk3hxt1IXRa2UlACmQ3N1MzacqGnN7Od-gQcRpHe4Qs";
export const LAPOUNT_CLIENT_ID = "lp_fixit";
export const SYNC_URL = `${API_BASE}/api/sync`;
export const MY_FEEDBACK_URL = `${API_BASE}/api/me/feedback`;
export const LINK_URL = `${API_BASE}/api/me/link`; // ログイン前の利用状況を、この端末の ID からアカウントへ紐づける
export const SYNC_POLL_MS = 60_000; // 他の端末の変更を見に行く間隔
export const SYNC_PUSH_DELAY_MS = 4_000; // 変更が止まってから送るまでの待ち
export const REPLY_POLL_MS = 5 * 60_000; // フィードバックの返信を見に行く間隔
export const REPLY_OPEN_POLL_MS = 30_000; // フィードバックの画面を開いている間に、返信や削除を見に行く間隔
export const USAGE_STORE_KEY = "fixit:usage-sent:v1";
export const TELEMETRY_STORE_KEY = "fixit:telemetry:v1";

// ローカル履歴(保存のたびに中身を残す)。文字数で数える
export const LOCAL_HISTORY_MAX_PER_FILE = 30;
export const LOCAL_HISTORY_FILE_CHARS = 300_000; // これより大きいファイルは残さない
export const LOCAL_HISTORY_TOTAL_CHARS = 4_000_000; // 全体の上限
