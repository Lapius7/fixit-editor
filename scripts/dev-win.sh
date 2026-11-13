#!/usr/bin/env bash
# 自分用の開発版(Windows)。exe は開発サーバー(WSL の vite)の画面を読み込むので、フロントの修正は保存するだけで反映される。
# Rust(src-tauri/)を直したときだけ、`scripts/dev-win.sh build` で作り直す。
#   scripts/dev-win.sh build   デバッグ用 exe を作り、Desktop/Fixit-Dev/ に置く(初回と Rust の修正後)
#   scripts/dev-win.sh serve   開発サーバーを 5174 番で動かす(exe を開く間、動かしておく)
#   scripts/dev-win.sh         build してから serve
# 普段は Desktop/Fixit-Dev/Fixit-Dev.cmd を開けばよい(開発サーバーも自動で起動する)。exe だけ開くと、開発サーバーが無いので画面は出ない。
# 保存データは本番版と分けてある(identifier が別)。リリース版の確認は build-win.sh で作る exe で行う。
set -euo pipefail
cd "$(dirname "$0")/.."
T=x86_64-pc-windows-gnu
OUT="${FIXIT_DEV_OUT:-/mnt/c/Users/lap7/Desktop/Fixit-Dev}"
PORT=5174

build() {
  # custom-protocol を付けないデバッグビルドは、内蔵ファイルではなく devUrl の画面を読む
  (cd src-tauri && TAURI_CONFIG="$(cat tauri.dev.conf.json)" cargo build --target $T)
  mkdir -p "$OUT"
  command cp -f "src-tauri/target/$T/debug/fixit-editor.exe" "$OUT/Fixit-Editor-Dev.exe"
  command cp -f "src-tauri/target/$T/debug/WebView2Loader.dll" "$OUT/WebView2Loader.dll"
  launcher
  echo "置き場所: $OUT/Fixit-Dev.cmd (これを開く)"
}

# Windows 側から開く入口。開発サーバーが動いていなければ WSL で起動し、つながってから exe を開く
launcher() {
  local dir; dir="$(pwd)"
  {
    echo '@echo off'
    echo 'curl.exe -s -o nul http://localhost:'$PORT' && goto run'
    echo "wsl.exe -d ${WSL_DISTRO_NAME:-Ubuntu} -e zsh -ic \"cd '$dir' && (setsid nohup scripts/dev-win.sh serve >/tmp/fixit-devwin.log 2>&1 < /dev/null &)\""
    echo 'set /a n=0'
    echo ':wait'
    echo 'set /a n+=1'
    echo 'if %n% gtr 60 (echo Cannot reach the dev server. See /tmp/fixit-devwin.log in WSL & pause & exit /b 1)'
    echo 'ping -n 2 127.0.0.1 >nul'
    echo 'curl.exe -s -o nul http://localhost:'$PORT' || goto wait'
    echo ':run'
    echo 'start "" /min "%~dp0Fixit-Editor-Dev.exe"'
  } | sed 's/$/\r/' > "$OUT/Fixit-Dev.cmd"
}
serve() { PORT=$PORT HOST=0.0.0.0 exec pnpm dev; }

case "${1:-all}" in
  build) build ;;
  serve) serve ;;
  all) build; serve ;;
  *) echo "使い方: $0 [build|serve]" >&2; exit 1 ;;
esac
