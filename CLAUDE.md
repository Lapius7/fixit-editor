# Fixit Editor 開発メモ(Claude 向け)

新しいセッションで作業を始めるときに、最初に読むファイル。状況が変わったら、同じ作業の中でこのファイルも更新する。

## 概要

- 軽くて見た目のいい、すりガラス調のコードエディタ(Xcode 風)。作者の既定は Lapius。
- 構成は Vite + React + CodeMirror 6 + Tauri v2。Windows の exe は Tauri で作る。
- 設定・統計・ワークスペース・設定の変更履歴は、PC の中にだけ保存する(アプリ版は `%APPDATA%\Fixit` の JSON、ブラウザ版は localStorage)。
- 外部へ送るものは次のとおり。AI 機能と匿名の利用数以外は、ユーザーが操作したとき、または設定で許可しているときだけ送る。送り先と保存キーは `shared/config.ts`、受け手はサイトのプロジェクト(`fixit-editor.lapius7.com` の `server/index.ts`、MySQL)。
  - AI 機能: ユーザーが操作したときに、選択範囲・開いているファイル・入力した文章を、ユーザーが選んだ AI(Anthropic / OpenAI / この PC の claude コマンド経由の Anthropic)へ送る。API キーはユーザー自身のもの。
  - 匿名の利用数: 1 日 1 回、ランダムな ID・アプリの版・OS の種類・言語だけを送る。常にオンで、設定では切り替えられない(開発ビルドでは送らない)。
  - フィードバック: メニューと右上のボタンの `FeedbackView` から「送る」を押したときだけ。内容・種類・任意の連絡先・版・OS・言語。
  - 詳しい利用状況とエラーは、必須の送信として常に送る(設定項目なし。本番ビルドのみ。利用状況は `statsOn` が false の間は送らない)。ファイルの中身・名前・パスは含めない。(旧 `reportErrors` は廃止)
- git リポジトリ。コミットは頼まれたときだけ行う(2026-11-10 に、それまでの変更をまとめて 1 つコミット済み)。
- 公式サイトは別プロジェクト `~/projects/workspace/git/vpsservice/private/fixit-editor.lapius7.com`。更新履歴は `src/changelog.ts`。機能を足す・変える・消したら、同じ作業の中で更新する(初回公開版は 1.0.0 で、公開までの変更はすべてここに入れる)。

## コマンド

- 開発サーバーは `portless fixit pnpm dev`。開く URL は https://fixit.localhost:1355 。`?nosplash` で起動アニメーションを飛ばし、`?setup` で初回セットアップを強制表示する。
- 型検査は `pnpm exec tsc --noEmit`。ビルドは `pnpm build`。
- 匿名の利用数の送信は本番ビルドでしか動かない(`pnpm dev` では送らない)。確かめるときは `pnpm build` のあと `pnpm exec vite preview` で開き、Playwright で送信先を `page.route` で受ける。
- Windows の exe は `pnpm exec tauri build --target x86_64-pc-windows-gnu --no-bundle`。出力は `src-tauri/target/x86_64-pc-windows-gnu/release/fixit-editor.exe`。
- i18n の検査は `pnpm exec x18n check`(エラー 0 を保つ。未使用キーの警告 270 件ほどは、設定ラベルを変数で渡しているため出る。無視してよい)。
- パッケージ管理は pnpm、ランタイムは Bun を優先する。`pkill` / `killall` は使わない(止めるときは PID を指定する)。

## ディレクトリ(`@/` は `src/` の別名)

- `src/app/` 全体の組み立て(`App.tsx`)、初回セットアップ(`Setup.tsx`、フラグは `fixit:setup:v1`)、起動画面、ウィンドウ操作。コマンドパレットの項目、分割画面、タブ、ダイアログの開閉は `App.tsx`。
- `src/editor/` CodeMirror 本体(`Editor.tsx`、タブごとの状態は `cache`(Map))、キーマップと補完(`extensions.ts`)、スニペット(`snippets.ts`)、コードの画像化(`shot.ts`)。
- `src/workbench/` ファイル一覧、タブまわりの部品、クイックオープン、全文検索、パレット、ターミナル、ビューア、ステータスバー。
- `src/features/` 機能ごとの塊。
  - `settings/` 設定の定義と保存(`settings.ts`)、画面(`Settings.tsx`)、ショートカット(`keys.ts`)、プロファイル、変更履歴(`history.ts`、カテゴリ `history`)。
  - `ai/` AI パネル(`AiDock.tsx`)、設定画面(`AiSettings.tsx`)、通信(`providers.ts`)、プロンプト(`prompts.ts`)、キーと同意の保存(`store.ts`、`fixit:ai:v1`)。
  - `ModelPicker.tsx` はパネルのモデル/Effort 選択(API キーのあるプロバイダーと、ログイン済みの claude のモデルを混ぜた一覧)。`link.ts` は claude コマンドの接続状態(`store.ts` の `Link`。保存しない)の確認とログイン。Rust 版 `claude::status` / `claude::login` と Node 版 `/__claude/status` / `/__claude/login` は同じ振る舞い(`claude auth status --json` の `loggedIn` だけを見る。メール・トークンは読まない)。Effort は `--effort`(claude)と `output_config.effort`(Anthropic)に渡す。openai には渡さない。
  - `preview/` Markdown・HTML のプレビュー(sandbox の iframe、`allow-same-origin` は付けない)。
  - `browser/` ページ内ブラウザ(`BrowserDock.tsx`)。
  - `telemetry/` 匿名の利用数(`telemetry.ts`)・利用状況とエラーの送信(`report.ts`)・フィードバック(`FeedbackView.tsx`)。送り先と保存キーは `shared/config.ts`。
  - `stats/` コーディング時間・入力数・連続日数。`theme/` テーマ編集パネル。`workspaces/` ワークスペース、WSL / SSH 接続。
- `src/platform/` ファイル操作・ターミナル・リモートへの橋渡し(ブラウザ版は `/__fs`、exe は Tauri)。
- `src/shared/Select.tsx` は OS 標準 `<select>` の代わり(ポータルで開く一覧は `.ctx` と同じ見た目)。`<select>` は使わずこれを使う。`segslide.ts` は `.seg`(切り替えボタン)の選択つまみを滑らせる(`--seg-x/--seg-w` を書き、`.seg::before` が動く)。エディタ面の濃さは `--paper-k` と `data-paper`(0 のとき `.paper` のぼかしを外す)で効く。
- タブ切り替えの動き: 設定の左の分類は `.set-nav::before` の印が滑る(`Settings.tsx` の `useLayoutEffect` が選択中の `.set-tab` の位置を `--tab-y` / `--tab-h` に書く。最初の 1 回は `data-ready` が付くまで動かさない)。設定の中身とワークスペース/プロファイルの中身は、`key` つきの `.set-fade` で切り替えのたびにふわっと出る。
- 通知と補助の表示: メッセージは `src/shared/notify.tsx` の `notify(文, 種類)`(ding のトースト。`App` の `flash` も同じ。ステータスバーの文字表示はやめた)。タブとファイル一覧のホバーカードは `src/shared/HoverTip.tsx`(要素に `data-tip` / `data-tip-sub` を付けるだけ)。設定の「変えた項目」の印は、行の左のバー(`.set-row::after`)と、変えたときだけ出る「初期値に戻す」ボタン。
- エディタ補助: `src/editor/intel.ts`(括弧の色分け・開始/閉じタグ同時編集・波線・ミニマップ)、`outline.ts` + `Crumbs.tsx`(パンくずとアウトライン。`Mod+Shift+O` は `OUTLINE_EVENT`)。タブのピン留めは `App.tsx` の `pinned`(左に固定、一括で閉じる操作の対象外。`closeMany(paths, force)` の `force` で外せる)。
- JS/TS 言語機能: `src/editor/ts/worker.ts`(`ts5` = typescript@5 の別名。入っている `typescript` 7 は JS の言語サービス API を持たないため。Web Worker 上で、開いているタブの中身だけを仮想ファイルとして解析)、`ts/client.ts`、`langsvc.ts`(ホバーの型情報・Ctrl+クリック/F12 で定義へ・Shift+F12 で参照・F2 でリネーム)、`LangUI.tsx`(参照一覧とリネーム入力)。設定 `langService`。
- ホバーカードは `HoverTip.tsx`(初回 1000ms・移動後 300ms)。エクスプローラーには出さず、タブだけ。起動画面はピクセルが集まってロゴになる元のアニメで、色は 4 色グラデーション(`shared/pixels.ts` の colors に `(i,u,v)`)。分割時のフォーカス枠は `panels.css` 末尾の `.paper::before`(ゆっくり揺れるグラデーション)。
- Git 連携(読み取りだけ): `src/features/git/git.ts`(`git status` の読み取り)、`src/editor/gitgutter.ts`(HEAD との行差分をガターに。追加=緑・変更=青・削除=赤)、`FileTree.tsx` の `.git-badge`、StatusBar のブランチ。取得は `server/fsapi.ts` と `src-tauri/fixit-core/src/{fs,local}.rs` の `gitstatus`/`githead`。コミット・push・書き込みはしない。設定は `gitStatus`。
- ローカル履歴: `src/features/history/`。保存のたびに中身を `fixit:local-history:v1`(appdata)へ残す(1 ファイル 30 版・30 万字まで、全体 400 万字。上限は `shared/config.ts`)。画面は `LocalHistory.tsx`(Ctrl+Alt+H・タブの右クリック・パレット)。差分は `diffLines`、リネームで `moveFile`。
- `src/shared/` 共有の定数(`config.ts`)・型・小さな道具。`src/styles/` CSS。`src/i18n/` と `locales/{ja,en,ko}.json`: UI の文字列は日本語の原文をキーにして、ここへ訳を足す。
- `server/fsapi.ts` と `server/term.ts` と `server/claude.ts` ブラウザ版のファイル操作(`/__fs`)・ターミナル・Claude サブスク用の橋渡し(`/__claude`)。vite の dev サーバーに載っている。
- `src-tauri/` Tauri の Rust 側(`src/main.rs`: ターミナルと、`fs_op` / `fs_write` / `claude_chat` の受け口)。
- `src-tauri/launcher/` 1 ファイル配布の起動役(`scripts/build-win.sh` → `dist-win/Fixit-Editor.exe`)。`src-tauri/fixit-core/src/local.rs` はこの PC のフォルダ(`kind=pc`)を std::fs で扱う(`protected()` で `/`・ドライブ直下・ホームの削除は拒否)。
- ファイル一覧は複数のフォルダを同時に持てる(`App.tsx` の `roots`。先頭は prefix なし、追加分は `/@xxxxx`。保存は `Workspace.roots`、ハンドルの保存キーは `handleKey`)。別のフォルダへの移動は拒否する。
- `src-tauri/fixit-core/` ブラウザ版の `server/fsapi.ts`・`server/claude.ts` と同じ振る舞いの Rust 版(Tauri に依存せず、Linux でビルド・試験できる)。`cargo run -p fixit-core --bin fixit-fs -- <op> key=value...` で動作確認できる。Node 版を変えたら Rust 版も同じに直す。

## 守ること

- 返答は日本語。UI の文字は 3 言語に対応させる(日本語を直書きしない。ja/en/ko のキーを足して `x18n check` を通す)。
- UI を作る・直すときは skill `pixel-align` を必ず使い、デプロイ前や確認前に `measure.py` で測る。日本語フォントは Noto Sans JP の Web フォントを `system-ui` より前に置く。`line-height` は整数の px にする。字の位置を px で押し下げて直さない(アイコンの重心合わせだけ例外。`.ai-act svg` を 1px 上げている)。
- 内側のスクロール領域には `overscroll-contain` を付ける。
- 変わりやすい値は直書きせず、設定や定数にまとめる。
- 仮のアイコンを置かない。ファビコンは設定する。
- Arc / shadcn / hallmark などの UI スキルは、使うかどうかを先にユーザーに確かめる(今回の開発では「使わない」と回答済み)。
- ブラウザ内の検証は Playwright で行う(`ignore_https_errors=True` が要る。portless の証明書が自己署名のため)。最終報告では「ブラウザで検証済み」と「Windows では未検証」を分けて書く。
- 外部へ送る内容を増やしたら、`src/changelog.ts` と、初回セットアップ・設定画面の説明を同時に直す。API キーの実値は聞かない(試験は `page.route` のモックと偽のキーで行う)。
- コミット・PR・文書に Claude の名前や Co-Authored-By を入れない。

## 実装済み(要点)

- 見た目は、すりガラス、ライト・ダーク・自動、アクセント色、背景メッシュ、テーマ編集パネル。書体は画面・ファイル一覧(`treeFont`)・コードを別々に設定できる。
- 編集は、言語ごとの色分けと補完(`@codemirror/language-data`)、開いている文書内の単語の補完、スニペット。検索・置換(自作パネル `src/editor/search-panel.ts`、CSS は `panels.css` 末尾)、複数カーソル、折りたたみ、行操作、Tab のインデント、保存時の整形、自動保存も入っている。
- Markdown・HTML のプレビュー。タブバーの `.pv-seg` は「プレビュー」(横に開く/閉じる)と、開いている間だけ出る「プレビューだけにする」の 2 つ(`Mod+Alt+V` は従来どおり テキスト→両方→プレビューを循環)。切り替えは `.ed-pv` の列幅の transition で動かし、プレビューのみのときもエディタは外さず、幅 0・非表示にする。HTML は `features/preview/resolve.ts` が相対パスの CSS・JS(`defer` 含む)・画像・CSS の `url()` をフォルダから読み、HTML に埋め込んで iframe(srcDoc)に渡す。開いている CSS・JS・SVG・JSON のタブは未保存の内容を優先し、書いたそばから反映する(Live Server 相当のライブ更新。ただし本物の HTTP サーバーではない)。作り直してもスクロール位置は保つ。ウィンドウにフォーカスが戻ると読み直す。右下の更新ボタンで読み直せる。`type="module"` の `import` や `fetch`、ほかの HTML へのリンクは動かない。HTML プレビューはアプリのテーマに追従しない。ページ内ブラウザ(`Mod+Alt+B`)は別。外部サイトは、埋め込みを禁止しているものは表示できない。
- Emmet: `@emmetio/codemirror6-plugin`(設定 `emmet`、初期値オン)。`Editor.tsx` の `EMMET` Compartment が、ファイル名から html / xml / jsx / css / scss / sass / pug などの書き方を選び、使うときに初めて読み込む。省略形を打って Tab で展開する(HTML は `ul>li.a*3>b{x}`、CSS は `m10-20` `df` で確認済み)。
- AI(`Mod+Alt+A`、右クリックの「AI」)。Anthropic(SDK、既定のモデルは `claude-opus-5-5`)と OpenAI(`gpt-5` が既定、モデル名は自由入力)。プロバイダーごとにスイッチがあり、初期は全部オフ(`enabled`。設定の「AI」で、オンにしたものだけ接続の設定が開く。以前の設定は、キーか同意があればオンとして引き継ぐ)。API キーは別のキー(`fixit:ai:v1`)に平文で保存し、設定の書き出し・履歴・統計には含めない。初めて送る前にプロバイダごとの同意画面を出す。「Claude (サブスク)」(`claude-cli`)は、この PC の `claude` コマンドを `server/claude.ts` が非対話で呼ぶ(ツール無効・空の一時フォルダ・`ANTHROPIC_API_KEY` は外す。トークンには触れない)。dev サーバー(ブラウザ版)では `server/claude.ts`、exe では Rust(`fixit-core/src/claude.rs`、Tauri の `claude_chat` / `claude_cancel`)が動かす。exe は Windows の claude.exe を先に探し、なければ WSL の claude を使う。実 CLI で 1 往復の動作は確認済み。OpenAI 側は実 API では未検証。
- ▶ 実行(`Mod+Alt+R`): `features/run/runners.ts` の拡張子ごとのコマンド(設定 `runners`、設定の「実行」で編集)を、ファイルのあるフォルダでターミナルから走らせる。パスに `" ` $ %` や改行があれば実行しない。新しいターミナルへ送る入力は、シェルの出力が 300ms 落ち着くまで預ける(起動中に送ると捨てられるため)。
- ミニマップと行番号のガターは背景と同じ色(透明)のまま固定に見せる。横にスクロールしたとき(折り返しオフ)は、`extensions.ts` の `hScrollMask` が字のほうを `.cm-content` のマスク(`--cm-l/--cm-r`)で隠す。タブをほかの画面へ落とすと、複製ではなく移動(元の画面が空ならたたむ)。
- タブ、左右・上下の分割、フォルダ、ファイル一覧、クイックオープン、全文検索、画像・PDF・音声・動画・docx の表示、WSL / SSH のフォルダ、ターミナル、ワークスペースとプロファイル。
- 統計(`Mod+Alt+I`)、コードの画像化、コマンドパレット、約 130 の設定、設定の書き出しと読み込み、設定の変更履歴(巻き戻し。この PC の中だけ)。
- 起動時は空(`src/shared/demo.ts` の `DEMO_TREE` は空)。接続ダイアログ(`Connect.tsx`)にフォルダの階層ブラウザ(`.cn-br`)。右クリックのサブメニューは `createPortal` で `.ctx-layer` に出す(親の `overflow` で切れるため)。設定 `paperA`(エディタの面の濃さ)は `--paper-k` で効く。
- 初回セットアップ画面。言語・テーマ・アクセント色・ワークスペース復元・統計のオン/オフを選ぶ。

## 未実装・未確認

- exe の `/__fs` 相当(WSL のファイル操作)と Claude サブスクは、Rust に移植済み。Windows 実機の WebView2 で `fs_op` / `fs_write`(バイナリの往復を含む)と `claude_chat` のチャンネルを確認した(Windows の claude.exe は利用上限で `rate` が返り、WSL 経由は fixit-fs.exe で返答を確認)。未確認: exe の画面操作でのファイル一覧・保存、exe からの SSH(Windows の ssh.exe と `%USERPROFILE%\.ssh\config` を使う設計)。(`showDirectoryPicker` は exe では `kind=pc` に置き換えた。)
- exe は `src-tauri/launcher/` で 1 ファイルに同梱済み(Windows 実機で起動と描画は確認)。未確認: `pick_folder`(フォルダ選択ダイアログ)の実操作。
- サイトは `~/projects/workspace/git/vpsservice/private/fixit-editor.lapius7.com`(`sitedeploy fixit-editor.lapius7.com` で反映済み)。管理画面 `/admin` は Lapount のオーナーだけ。Lapount のリダイレクト許可リストには追加済み(DB の `connected_service_origins` と、supabase の `.env` の `ADDITIONAL_REDIRECT_URLS` に `https://fixit-editor.lapius7.com/login`。実ログインで `/admin` に入れることを確認済み)。
- フォント: Obel Mono(OFL)を `src/styles/fonts/` に同梱し、コードの書体の既定にしている。この PC のフォントは、exe では Rust の `list_fonts`(`fixit-core/src/fonts.rs`、fontdb)、ブラウザでは `queryLocalFonts` で一覧にする(`settings/fonts.ts`)。値は `local:<家族名>` で保存する。
- アイコン: 元画像は `assets/icon.svg`。`src-tauri/icons/icon.ico`(16〜256)と `icon.png`、`public/favicon.svg` は、ここから `rsvg-convert` と `magick` で作る。サイトのファビコンも同じ。
- 自動更新: `src/features/update/`(確認と表示)と、Rust の `apply_update`(`fixit-core/src/update.rs`)。更新情報は Ed25519 署名つきで、アプリ側が署名と SHA-256 を確かめてから、起動ファイル(launcher が `FIXIT_LAUNCHER` で渡す)を置き換える。公開鍵は `update.rs`、秘密鍵は `~/.config/fixit-release/update-key.pem`(リポジトリの外)。配布は `bun scripts/release.ts --notes "..."`(exe と署名つき `latest.json` を VPS の `data/releases/` へ置く)。1.0.0 は GitHub の非公開リポジトリ(Lapius7/fixit-editor)の Release v1.0.0 に置いた(Setup と単体 exe)が、サイトの VPS には未公開。
- インストーラー: `src-tauri/installer/`(wry/tao の画面 `ui/index.html`。本体の exe を内包)。`scripts/build-installer.sh`(先に `build-win.sh`)で `dist-win/Fixit-Editor-Setup-<版>.exe` ができる。launcher を `FIXIT_PAYLOAD_SETUP=1` で使って 1 ファイルにする。`%LOCALAPPDATA%\Programs\Fixit Editor` へ入れ、スタートメニュー・アプリの一覧に登録し、`Uninstall.exe --uninstall` で削除する。Windows 実機では未検証(画面はブラウザで確認済み)。exe を作り直したら、Release の資産も `gh release upload v1.0.0 <file> --clobber` で差し替える
- SSH の書き込み試験。ユーザーの許可を得たときだけ、`contabo-vps:/tmp/fixit-test` で行う。
- Ctrl+G のステータスポップの再確認。
- pixel-align は、ブラウザ(Linux の Chromium)でライト・ダークの両方について、右クリックメニュー、接続画面、ファイル一覧(複数フォルダの見出し)、タブ列、テーマパネル、統計、設定(日英韓・15 タブ)を測った。未測定は、ステータスポップ(Ctrl+G で開けなかった)、分割メニュー、シェルメニュー。英語・韓国語のセグメントボタンで「インクの中心が少しずれる」と出るのは既知で、直さなくてよい。AI の設定画面にあるパスワード欄の測定値(下に 5px)は、プレースホルダーの字形による誤検出で、入力欄の寸法は既存の `.field` と同じ。
- Windows 実機での動作確認は全体として未実施。

## ほかのメモの置き場

- 個別の経緯や手順は `~/.claude/projects/-home-lap7/memory/` にある。パッケージの一覧は `~/.claude/projects/-home-lap7-projects-workspace/memory/packages-registry.md`(パス・URL・版を変えたら更新する)。

## README・画像

- README は `README.md`(英語)と `README.ja/ko/zh-CN/es.md`。画像は `docs/screenshots/`(見本フォルダ `/tmp/rd/notes-app` を headless で撮影し、バナーは PIL で合成)。
- `src/shared/fontwarm.ts`: 起動後の空き時間に日本語フォントの主要な字を先読みし、フォルダを初めて開くときの引っかかりを減らす。
- 分割は入れ子の木で持ちます(`src/workbench/layout.ts`。葉が画面、枝が左右/上下の分割と割合)。`App.tsx` の `lay` が木で、画面は `.panes` の中に `.slot` を絶対配置し、境目は `joints()` から `.split-grip` を置きます。上端に接する画面のタブ列は `.tabrow` に、それ以外は画面の中(`.paper.has-strip`)に出します。保存は `WsState.lay`(旧形式の `split`/`splitDir`/`splitRatio` は木が無いときの既定値)。動きは `window.css` の `--split-spring` で、新しい画面は `.slot[data-born]` の `pane-in` と `::before` の光沢が走ります。閉じる(畳む)ときの退場の動きはありません。ドロップヒント `.drop-hint` は端ゾーンの半分の矩形で、バネで位置と大きさを変えます。重い `backdrop-filter` は headless のソフトウェア描画だと遅い(実機の GPU では未確認)。
- アプリ版のデータ保存: 各機能は `src/platform/appdata.ts` の `kvGet` / `kvSet` / `kvDel` を通して `fixit:` で始まるキーを読み書きする(localStorage は使わない)。アプリ版はメモリに持ち、400ms 後と閉じる直前に `%APPDATA%\Fixit` の JSON(1 キー 1 ファイル、例 `fixit_settings_v1.json`)へ書く。起動は `main.tsx` で `initStore()` を待ってから `boot.tsx`(本体)を読む。ファイルの読み込みに失敗したときだけ localStorage に退避する。ブラウザ版は kv が localStorage を読み書きする。Rust 側は `fixit-core/src/store.rs`(テストあり)と `main.rs` の `store_load` / `store_save`。ワークスペースの IndexedDB(`fixit-ws`)はブラウザ版の PC フォルダのハンドル専用で、アプリ版は使わない。API キーも同じ方式で別ファイルに平文保存する。
- 複数ウィンドウ: Fixit は 1 ウィンドウ 1 プロセスで、同じ `%APPDATA%\Fixit` を共有する。`appdata.ts` は 2 秒ごと(表示中)・フォーカス時に各ファイルの更新の目印(`store_stamps`)を見て、変わっていれば `store_read` で読み、`kvWatch(キー, (他方の値, 未保存の変更の有無, 直前に一致した値) => …)` で各ストアに知らせる。書く前にも `store_read` で先行書き込みを確かめ、あれば混ぜてから書く(閉じる直前だけ確かめず直接書く)。混ぜ方は、設定=未保存ならこのウィンドウ優先、履歴・プロファイル・チャット=`mergeById`、統計=3-way(他方 + (いまの値 − 直前に一致した値))、`workspaces` の `current` と AI チャットの `cur` はウィンドウごとに保つ。他ウィンドウ由来の設定変更は `fromOtherWindow()` で履歴へ書き戻さない。`store.rs` は一時ファイル名に pid を付けて衝突を避け、rename を最大 5 回リトライする。ランチャーも展開用の一時ファイル名に pid を付け、同時起動では他方の展開完了を最大 4 秒待つ。既知の限界: 2 つのウィンドウが同じキーを数 ms 以内に同時に書くと、片方の更新が失われうる(読んでから書くまでの隙間)。
