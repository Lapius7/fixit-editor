#!/usr/bin/env bash
# Windows 向けの exe を作る。出力は dist-win/Fixit-Editor.exe(本体と WebView2Loader.dll を内包した 1 ファイル)。
set -euo pipefail
cd "$(dirname "$0")/.."
T=x86_64-pc-windows-gnu
pnpm exec tauri build --target $T --no-bundle
REL="$PWD/src-tauri/target/$T/release"
(cd src-tauri/launcher && FIXIT_PAYLOAD_DIR="$REL" cargo build --release --target $T)
mkdir -p dist-win
cp src-tauri/launcher/target/$T/release/fixit-launcher.exe dist-win/Fixit-Editor.exe
ls -l dist-win/Fixit-Editor.exe
