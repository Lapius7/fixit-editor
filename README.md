# Fixit Editor(フィクシットエディタ)

軽くて見た目のいいコードエディタです。すりガラスのサイドバー、浮いたエディタ面、タブ、ファイルツリーを備えています。

## 機能

- フォルダを開いてファイルを編集・保存(Ctrl+S)。Chrome / Edge の File System Access API を使います。
- CodeMirror 6 による構文ハイライト(主要な言語に対応)と検索(Ctrl+F)。
- 開いていない状態では、デモのフォルダで見た目を確かめられます。

## 開発

```bash
pnpm install
pnpm dev     # http://localhost:5173
pnpm build
```

## 今後

Tauri で Windows のアプリにする予定です。Mica や Acrylic で、サイドバーを OS の半透明にします。

## ライセンス

MIT
