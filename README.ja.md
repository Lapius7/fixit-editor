<div align="center">

<img src="docs/screenshots/banner.png" alt="Fixit Editor" width="100%">

# Fixit Editor

**軽くて見た目のいい、すりガラス調の Windows 用コードエディタ。**

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%C2%B7%20React%20%C2%B7%20CodeMirror%206-444)

[公式サイト](https://fixit-editor.lapius7.com) · [ドキュメント](https://fixit-editor.lapius7.com/docs) · [更新履歴](https://fixit-editor.lapius7.com/changelog) · [ライセンス](#ライセンス)

[English](README.md) · **日本語** · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)

</div>

## 概要

Fixit Editor は、すりガラス調の小さなコードエディタです。インストーラーなしで、`Fixit-Editor.exe` 1 つだけで動きます。CodeMirror 6 と Tauri で作っているので、起動が速く軽く動きます。

設定・統計・ワークスペースは、この PC の中に保存します。AI に質問したときと、匿名の利用数を許可したときを除いて、コーディングの内容は外へ送りません。

<p align="center">
  <img src="docs/screenshots/ja-light.png" alt="ライトモードの Fixit Editor" width="49%">
  <img src="docs/screenshots/ja-dark.png" alt="ダークモードの Fixit Editor" width="49%">
</p>

## 機能

**編集**

- フォルダを 1 つ、または複数開いて、構文ハイライト・補完・検索つきで編集できます(CodeMirror 6)。
- 分割表示、全文検索、コマンドパレット、クイックオープンに対応しています。
- 画像・PDF・Word・音声・動画を開けます。Markdown と HTML は、ソースの横でプレビューできます。
- ターミナルを複数開けます。タブの名前も変えられます。

**リモートとワークスペース**

- WSL と SSH のフォルダを、この PC のフォルダと同じように開けます。一覧・編集・保存・名前の変更・削除・検索・ターミナルが使えます。CRLF のファイルは改行を保ったまま保存します。
- ワークスペースは、フォルダ・タブ・分割・ターミナルをまとめて残し、次の起動で元に戻します。
- プロファイルは、見た目・各設定・ショートカットのひとまとまりです。名前をつけて切り替えられ、ワークスペースに結びつけることもできます。ファイルへの書き出しと読み込みにも対応します。

**見た目と使い心地**

- ライト・ダーク・OS に合わせるを選べます。背景は色のメッシュで、点をドラッグして作ります。
- 設定は 120 項目以上あります。検索、「変えたものだけ」の絞り込み、1 項目ずつのリセット、JSON の書き出しと読み込みができます。
- ショートカットは 70 個以上あり、変更できます。
- 表示は日本語・英語・韓国語に対応しています。

**AI は、質問したときだけ**

- 選択したコードや開いているファイルについて質問できます。自分の Anthropic / OpenAI の API キーのほか、公式の `claude` コマンド経由で Claude のサブスクリプションのログインも使えます。
- 各プロバイダーへ初めて送る前に、同意画面を出します。

<p align="center">
  <img src="docs/screenshots/ja-split.png" alt="分割表示" width="49%">
  <img src="docs/screenshots/ja-palette.png" alt="コマンドパレット" width="49%">
</p>

## プライバシー

外へ送るのは次の 2 つだけで、どちらも操作したとき、または設定で許可したときに限ります。コーディング統計は外へ送りません。

- **AI への質問:** 選択範囲・開いているファイル・入力した文章を、選んだプロバイダーへ送ります。
- **匿名の利用数:** 1 日 1 回、ランダムな ID・アプリの版・OS の種類・言語を送ります。設定と初回セットアップでオフにできます。

## ソースからビルド

pnpm と、`x86_64-pc-windows-gnu` ターゲットを入れた Rust が必要です。Windows 用の exe は WSL か Linux でビルドします。

```bash
pnpm install
bash scripts/build-win.sh   # dist-win/Fixit-Editor.exe ができます
```

## ライセンス

[MIT](LICENSE)
