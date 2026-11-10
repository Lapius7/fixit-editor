#!/usr/bin/env bash
# Windows 用のインストーラーを作る。出力は dist-win/Fixit-Editor-Setup-<版>.exe。
# 先に scripts/build-win.sh で dist-win/Fixit-Editor.exe(本体)を作っておく。
set -euo pipefail
cd "$(dirname "$0")/.."
T=x86_64-pc-windows-gnu
APP="$PWD/dist-win/Fixit-Editor.exe"
[ -f "$APP" ] || { echo "dist-win/Fixit-Editor.exe がありません。先に scripts/build-win.sh を実行してください" >&2; exit 1; }
VER=$(node -p "require('./package.json').version" 2>/dev/null || bun -e "console.log(require('./package.json').version)")
# 1) インストーラー本体(画面つき)。本体の exe を内包する
(cd src-tauri/installer && FIXIT_APP_EXE="$APP" FIXIT_VERSION="$VER" cargo build --release --target $T)
IREL="$PWD/src-tauri/installer/target/$T/release"
# 2) launcher で包む(WebView2Loader.dll を一緒に同梱し、1 ファイルにする)
PAY="$PWD/src-tauri/installer/target/payload"
rm -rf "$PAY"; mkdir -p "$PAY"
cp "$IREL/fixit-installer.exe" "$PAY/fixit-editor.exe"
cp "src-tauri/target/$T/release/WebView2Loader.dll" "$PAY/"
(cd src-tauri/launcher && FIXIT_PAYLOAD_SETUP=1 FIXIT_PAYLOAD_DIR="$PAY" cargo build --release --target $T)
mkdir -p dist-win
cp "src-tauri/launcher/target/$T/release/fixit-launcher.exe" "dist-win/Fixit-Editor-Setup-$VER.exe"
ls -l "dist-win/Fixit-Editor-Setup-$VER.exe"
