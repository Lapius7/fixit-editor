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
export const AI_USAGE_KEY = "fixit:ai-usage:v1"; // プロバイダーごとの使用量(トークン数・5 時間/週間の上限)。API キーとは別に置く
export const AI_CHATS_KEY = "fixit:ai-chats:v1"; // 会話の履歴。API キーとは別に置く(設定の書き出し・変更履歴・統計には載らない)
export const AI_CHATS_MAX = 50; // 残す会話の数(古いものから消す)
export const AI_CHATS_MAX_CHARS = 1_500_000; // 全会話の文字数の上限(localStorage の容量を使い切らないため)
export const AI_CHATS_MAX_IMAGE_CHARS = 6_000_000; // 履歴に残す画像(base64)の文字数の上限。超えたら古い会話の画像から外す(文章は残す)
export const AI_MAX_CONTEXT_CHARS = 60_000; // 1 回に送るコードの上限
export const AI_COMMIT_DIFF_CHARS = 40_000; // コミットメッセージを作るときに送る差分の上限
export const TREE_PREFETCH_MS = 6000; // フォルダを開くとき、前に開いていたフォルダの中身を先に読んで待つ上限(超えた分は描いてから読む)
export const TREE_WARM_MS = 20_000; // 開く前に先読みしたフォルダの中身を使う期間(過ぎたら読み直す)
/** フォルダの中身の読み込みを待つ上限(ミリ秒)。これを過ぎたら失敗として扱い、読み込み中の表示を続けない */
export const TREE_READ_TIMEOUT_MS = 15_000;
export const TREE_WARM_MAX = 40; // フォルダを開いたとき、中のフォルダを先読みする数の上限
export const TREE_EXPAND_MAX = 300; // 「中の階層をすべて開く」で開くフォルダの数の上限
export const TREE_EXPAND_MS = 8000; // 「中の階層をすべて開く」が、あとから現れるフォルダを開き続ける時間
export const GIT_SCAN_DIRS = 200; // Git パネルで「中のリポジトリ」を探すとき、調べる直下のフォルダの数の上限
export const AI_MAX_TOKENS = 16_000;
export const AI_DEFAULT_MODEL = { anthropic: "claude-opus-5-5", openai: "gpt-5", "claude-cli": "", copilot: "gpt-4.1", gemini: "gemini-2.5-flash", custom: "" } as const;
export const AI_MODEL_HINTS = {
  anthropic: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"],
  openai: ["gpt-5", "gpt-5-mini"],
  "claude-cli": ["opus", "sonnet", "haiku"],
  copilot: ["gpt-4.1", "gpt-4o", "gpt-5-mini", "claude-sonnet-4.5"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
  custom: [],
} as const;
// AI がファイルを読み・直すとき(tools.ts)の上限
export const AI_TOOL_ROUNDS = 16; // 1 回の質問の中で、道具を呼べる往復の数
export const AI_TOOL_READ_LINES = 400; // read_file が 1 回で返す行数の既定
export const AI_TOOL_READ_MAX_LINES = 800; // 同じく、範囲を指定したときの上限
export const AI_TOOL_READ_CHARS = 40_000; // 同じく、文字数の上限
export const AI_TOOL_LIST_MAX = 300; // list_files が返す項目数の上限
export const AI_TOOL_EDIT_CHARS = 20_000; // edit_file の old_text / new_text の上限
export const AI_TOOL_CREATE_CHARS = 100_000; // create_file の content の上限
export const AI_TOOL_SEARCH_MAX = 100; // search_files が返す行数の上限
export const AI_TOOL_EXEC_OUT = 20_000; // run_command の出力を AI に返す文字数の上限(多いときは、先頭と末尾を残す)
export const AI_TOOL_EXEC_SECS = 30; // run_command の既定の制限時間(秒)。上限は 120
export const AI_TOOL_SEARCH_FILES = 3000; // search_files が調べるファイル数の上限
export const AI_MAX_HISTORY_CHARS = 120_000; // 会話の履歴として送る量の上限(古い発言から外す)
// AI に添える画像。API が受け付ける形式(これ以外は PNG に描き直す)と、縮める大きさ
export const AI_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const AI_IMAGE_MAX_EDGE = 1568; // 長い辺の上限(px)。超えたら縮める
export const AI_IMAGE_MAX_BYTES = 3_500_000; // 1 枚の上限。base64 にすると 4/3 倍になり、API の 5MB に収まる
export const AI_IMAGE_SRC_MAX_BYTES = 30_000_000; // 読み込む元の画像の上限
export const AI_MAX_IMAGES = 4; // 1 回に添えられる枚数
export const AI_HISTORY_IMAGE_EDGE = 1024; // 履歴に残す画像の長い辺(px)。これより大きければ縮める
export const AI_HISTORY_IMAGE_BYTES = 200_000; // 履歴に残す 1 枚の目安。収まる画像は縮めず、そのまま残す
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

// 設定の「開発者情報」に出す連絡先
export const DEV = {
  name: "Lapius",
  x: { id: "Lapius7", url: "https://x.com/Lapius7" },
  github: { id: "Lapius7", url: "https://github.com/Lapius7" },
  mail: "me@lapius7.com",
  discord: "x_lapius7.xyz",
};

// TypeScript 言語サーバー(npm から取得して子プロセスで動かす)
export const LSP_SYNC_DELAY_MS = 150; // 打鍵のたびには送らず、この間隔でまとめて変更を伝える
export const LSP_IDLE_UNIT_MS = 60_000; // 設定「止めるまで(分)」の 1 分ぶん(JS/TS のタブがなくなってから、サーバーを止めるまでの時間)
export const LSP_REQUEST_TIMEOUT_MS = 30_000; // 1 回の問い合わせを待つ上限
export const LSP_SIG_DELAY_MS = 80; // 引数のヒント: ( や , を打ってから、サーバーに聞くまでの時間
export const LSP_SIG_AFTER_COMP_MS = 200; // 補完が閉じてから、引数のヒントを出し直すまでの時間(ちらつき防止)
export const LSP_SIG_WORD_MS = 350; // 単語を打っている間、補完が開くのを待ってから引数のヒントを確かめる時間
export const LSP_INLAY_DELAY_MS = 400; // インレイヒント: 編集やスクロールが止まってから、サーバーに聞くまでの時間
export const LSP_REFS_MAX = 300; // 参照の一覧に出す上限
export const LSP_LINT_DELAY_MS = 350; // 打鍵が止まってから、エラーの波線を取りにいくまでの時間
export const LSP_MAX_DOC_CHARS = 3_000_000; // これより大きいファイルは、言語サーバーに渡さない
export const LSP_STATS_MS = 1500; // 言語サーバーの一覧をひらいている間、負荷(CPU・メモリ)を測り直す間隔
export const LSP_STATS_HIST = 30; // 負荷のグラフに残す点の数
export const LSP_BUSY_SHOW_MS = 250; // 解析が続いたとき、バーに「解析中」を出すまでの時間(ちらつき防止)

// GitHub 管理のログイン(デバイスフロー)に使う OAuth App の client_id。公開してよい値。空のあいだは「GitHub でログイン」を出さない
export const GH_CLIENT_ID = "Ov23liT0bYq74mBfo6sG";
export const GH_SCOPES = "repo workflow admin:repo_hook delete_repo";
