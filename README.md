<div align="center">

<img src="docs/screenshots/banner.png" alt="Fixit Editor" width="100%">

# Fixit Editor

**A light, frosted-glass code editor for Windows.**

![License](https://img.shields.io/badge/license-proprietary-lightgrey)
![Platform](https://img.shields.io/badge/platform-Windows-0078d4)
![Built with](https://img.shields.io/badge/built%20with-Tauri%20%C2%B7%20React%20%C2%B7%20CodeMirror%206-444)

[Website](https://fixit-editor.lapius7.com) · [Docs](https://fixit-editor.lapius7.com/docs) · [Changelog](https://fixit-editor.lapius7.com/en/changelog) · [License](#license)

**English** · [日本語](README.ja.md) · [한국어](README.ko.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md)

</div>

## Overview

Fixit Editor is a small code editor with a frosted-glass look. It ships for Windows as an installer (`Fixit-Editor-Setup.exe`) and as a single `Fixit-Editor.exe`. It is built on CodeMirror 6 and Tauri, so it starts fast and stays light.

Settings, statistics, and workspaces are stored on your PC. Nothing about your coding leaves it unless you ask an AI a question, log in to Lapount with sync turned on, send feedback, or turn on the optional anonymous reporting. The anonymous launch count is always sent.

<p align="center">
  <img src="docs/screenshots/en-light.png" alt="Fixit Editor in light mode" width="49%">
  <img src="docs/screenshots/en-dark.png" alt="Fixit Editor in dark mode" width="49%">
</p>

## Features

Everything below is in the latest version, 1.0.8. See the [changelog](https://fixit-editor.lapius7.com/en/changelog) for what changed in each release.

### Editing

- **Languages and completion:** syntax highlighting for many languages, and completion with language-specific candidates, words from the open document, and snippets such as `for` and `if`. Emmet works in HTML and CSS (type an abbreviation, press `Tab`). In HTML, typing `!` and pressing `Enter` or `Tab` expands an HTML5 template.
- **Code view:** minimap with a frame around the visible range, bracket pair colorization, indent guides, folding, matching-bracket highlight, and automatic brackets and quotes. Error squiggles for syntax mistakes and JSON. The minimap, colorization, and squiggles can each be turned off.
- **Navigation:** breadcrumbs (file location › current function or class) that open a list of siblings, an outline (`Ctrl+Shift+O`) to filter and jump to symbols, go to line, and quick open (`Ctrl+P`).
- **Search and replace:** a floating translucent panel with a match count and case, word, and regex toggles. Full-text search can include or exclude files (`*.ts`, `src/**`) or search open tabs only.
- **Editing commands:** multiple cursors, rectangular selection, duplicate, move, delete, and sort lines, toggle comments, change case, and indent with `Tab` and `Shift+Tab`. In HTML and XML (and JSX, TSX, Vue, and PHP), renaming an opening tag renames the closing tag too.
- **Saving:** auto save, optional trailing-whitespace removal and final newline on save, and an optional setting that rewrites leading whitespace to the indent width and spaces/tabs shown in the status bar. Makefile, Markdown, and multi-line strings are left alone. Each tab keeps its undo history and cursor position.
- **Local history:** every save keeps a copy on your PC. Compare it with the current file and restore any version (`Ctrl+Alt+H`).
- **Code as an image:** turn the selection (or the whole file) into a PNG with a gradient background and a macOS-style window, then copy or save it. Colors and background are configurable.
- **Large files:** files over 1.9 MB show a notice and a "Load" button instead of refusing to open. Changes made outside the editor are reloaded if you have no edits, or you are asked before overwriting.

### Language servers

Opt-in and off by default. Turn them on in Settings, and the editor fetches the server on first use (package requests only; code and file names are never sent).

- **Languages:** TypeScript and JavaScript (TypeScript server), Python (Pyright), HTML, CSS / SCSS / Less, PHP (Intelephense), Go (gopls), Rust (rust-analyzer), Ruby (Solargraph), and MySQL (sqls).
- **Features:** completion (with auto-import for TypeScript), hover types, go to definition (`F12`, `Ctrl+Click`), signature help (`Ctrl+Shift+Space`), find references (`Shift+F12`), rename across files (`F2`), code actions (`Ctrl+.`), inlay hints, and error squiggles that follow your `tsconfig.json` and `node_modules`. Changes that would touch unopened files or only partly apply are refused with a reason.
- **Control:** a status bar item (`TS`, `PY`, `RS`, and so on) opens a list with the state of each server, per-server and per-feature switches, restart on error, and live CPU and memory for running servers. Servers stop after the last matching tab closes (1 minute by default) and when you quit. WSL folders use the PATH of your WSL login shell.

### Files and folders

- **File tree:** create files and folders by typing a name in the list (`test/01/main.js` creates the folders too), rename with an icon that follows the extension, delete, and multi-select with `Ctrl` and `Shift`. Cut, copy, and paste with `Ctrl+X`, `Ctrl+C`, and `Ctrl+V`, including files copied in Windows Explorer and images from the clipboard. Drag to move; hovering a closed folder opens it. Changes made outside the editor appear within seconds, and the sort order matches Windows Explorer.
- **Multiple folders:** add more folders to a workspace, from this PC or WSL and SSH. Each folder gets a heading, can be removed from the workspace, and can be expanded or collapsed all the way down (`.git` and `node_modules` stay closed).
- **Context menu:** open in an external terminal or Explorer, open a terminal here (choose PowerShell, Command Prompt, Git Bash, or a WSL distribution), open in the Git panel, copy path, and preview.
- **Viewers:** images, PDF, audio, video, and Word (`.docx`) open inside the editor. A file that cannot be opened shows why and what to do.
- **Image editor:** crop with aspect ratios, rotate, flip, resize, brightness, contrast, saturation, blur, monochrome, invert, undo and redo. Zoom with `Ctrl+Wheel` or by typing a value, and copy images to the clipboard as PNG.
- **Command line:** with the installer, type `fixit ./` in a terminal or the Explorer address bar to open a folder.

### Preview and browser

- **Markdown and HTML preview** (`Ctrl+Alt+V`) beside the source or on its own, and it can be pinned. Markdown renders Mermaid diagrams and LaTeX math (`$…$`, `$$…$$`, `` ```math ``). Mermaid files (`.mmd`, `.mermaid`) are highlighted and previewed.
- **HTML preview** shows relative CSS, JavaScript, and images, and reflects unsaved CSS and JavaScript as you type. It runs in an isolated view.
- **Built-in browser** (`Ctrl+Alt+B`) opens web pages inside the editor. Sites that forbid embedding cannot be shown.

### Terminal and running code

- Several terminals under the editor with renamable tabs, for local, WSL, and SSH. URLs are clickable, and `Ctrl+V` pastes. Colors follow the light and dark theme.
- Run the open file with ▶ (`Ctrl+Alt+R`). The command per extension is editable in Settings.
- WSL terminals receive `FIXIT_CWD=1`, so a `.zshrc` that jumps to the home folder can keep the opened folder instead.

### Git

A Git panel on the right (branch button, or the branch name in the status bar) with four tabs, and it works in WSL and SSH folders too.

- **Changes:** stage, unstage, commit, discard (press twice to confirm), and view diffs.
- **Tree and history:** commit branches drawn as lines, with the changed files and diffs of each commit.
- **Branches:** create, switch, delete (merged only), fetch, pull (fast-forward only), and push.
- **Folders that are not repositories:** create one, or clone from a URL. Repositories inside the opened folder can be opened from a list.
- The file tree marks changed files, the editor gutter shows added, changed, and removed lines, and the status bar shows the branch and change count.

### Remote folders and workspaces

- Open WSL and SSH folders like local ones: browse, edit, save, rename, delete, search, move, use the Git panel, and use a terminal. CRLF files keep their line endings. A picker lets you walk through folders like Explorer, create new folders, go back and forward with the mouse buttons, and reopen recent places.
- WSL file operations and Git reads go through a worker shell that stays alive inside WSL, so `wsl.exe` is not started for every operation. How long it stays (5 minutes by default, 0 to disable) is a setting.
- **Workspaces** save folders, tabs, split layout, terminals, preview state, and cursor positions, and restore them on the next launch. The start screen shows recent workspaces as folder-shaped cards.
- **Profiles** bundle appearance, settings, and shortcuts. Switch between them, tie one to a workspace, or export and import them as files.
- Several windows can be open at once without overwriting each other's settings, chats, or workspaces.

### Tabs and layout

- Tabs can be reordered, pinned to the left (`Alt+P`), and closed in bulk. Closing an unsaved tab offers Save and close.
- Split the view left, right, up, or down as many times as you like by dragging a tab or file to an edge, or with "Open in split". Drag a divider to resize (double-click to halve), swap panes, and change direction. Dividers between the sidebar, editor, AI, and browser can be dragged too.

### AI, only when you ask

- **Providers:** your own Anthropic or OpenAI API key, Claude subscription through the official `claude` command (Windows or WSL, selectable), GitHub Copilot through GitHub device login (free plans work), Google Gemini, and OpenAI-compatible endpoints such as Ollama, LM Studio, and OpenRouter. Every provider is off until you turn it on, and a consent screen shows the destination before the first request.
- **Chat:** open it with `Ctrl+Alt+A`. Choose the model and the thinking effort (low to max). Attach code with "Quote in AI chat" (`Ctrl+Alt+Q`), or drag files and tabs in (up to 8). Attach images (up to 4, PNG, JPEG, GIF, and WebP; other formats are converted and large ones are resized).
- **Conversations:** a history view grouped by day, a timestamp on every message, attached images kept in the history, regenerate, a jump-to-latest button, code blocks colored like the editor with copy buttons, and Mermaid and math rendering. Links open in your default browser.
- **Actions:** summarize, explain, translate (Japanese, English, Korean), find problems, and add comments from the editor context menu. A button in the Git panel writes a commit message from the staged changes, matching the language and style of recent commits.
- **Files and commands:** the AI can list, read, search, create, edit, move, and delete files and folders inside the opened folder, and (desktop app only, for PC, WSL, and SSH folders) run one terminal command at a time. Reading and searching are automatic. Every other action is shown as a card (a diff for edits, the full command for commands) that you approve first. A button next to the chat input switches the mode: Ask (approve everything, the default), Auto (create and edit automatically; move, delete, and commands still ask), or Full auto (nothing asks). Commands have stdin closed and stop after 30 seconds by default (120 at most). Paths outside the folder, `.git`, and secret-looking files such as `.env` and keys are off limits. This is not available through the Claude subscription route.
- **Usage:** 5-hour and weekly usage for the Claude subscription and the quota of Copilot, refreshed every 5 minutes, and token counts for API keys. Numbers cover only what was sent from this editor.
- A color glow follows the window edge while the AI answers (it can be turned off in Settings).

### Look and feel

- Frosted-glass design with light, dark, or follow-the-OS themes. The accent color and a background color mesh (drag points to shape it) are adjustable with a live preview, as are surface opacity, window margins, line strength, and wallpaper grain.
- Separate fonts for the interface, the file tree, and code; every font on your PC is selectable. The default code font is the bundled Obel Mono.
- Animations (workspace switch waves, split glass, toasts) can be slowed, shortened, or turned off, and they respect the OS reduced-motion setting.
- Display languages: Japanese, English, and Korean. A first-run screen picks language, theme, accent color, and basics, then offers Lapount login (skippable).

### Settings and shortcuts

- Over 120 settings with search, a "changed only" filter, a bar marking changed items, per-item reset, a change history you can roll back, and JSON export and import.
- Over 70 shortcuts you can rebind, searchable by key name. The command palette (`Ctrl+Shift+P`) runs every action.
- Settings, AI chats, and statistics are JSON files in `%APPDATA%\Fixit` (the app) or localStorage (browser), easy to back up.
- A debug log you can download from Settings → Developer information (errors, main events, settings, environment, with the user name and folder names hidden). It is never sent automatically.

### Statistics, updates, and accounts

- **Statistics:** coding time, typed characters, key presses, saves, and streak days.
- **Updates:** an "Update available" mark appears, and Update and restart replaces the app after the signature and hash are verified. Check manually from Settings or the menu. A failed check retries by itself.
- **Feedback:** send bugs and requests from the menu. While logged in, read developer replies and reply in the app.
- **Lapount account (optional):** log in by approving a code in your browser (no password is typed into the editor). Sync settings, profiles, and workspaces across PCs, and see totals and replies on the website dashboard. Every feature works without logging in.

### Safety

- AI API keys and Lapount login data are encrypted with Windows (exe only).
- The app restricts what it can load, and the HTML preview is isolated from the editor.
- The AI can touch only the opened folder and never secret-looking files. Terminal commands it runs are not filtered: you see the full command and approve each one (unless you choose Full auto).

<p align="center">
  <img src="docs/screenshots/en-split.png" alt="Split view" width="49%">
  <img src="docs/screenshots/en-palette.png" alt="Command palette" width="49%">
</p>

## Privacy

Only the following can leave your PC. File contents, names, and paths are never included, except in AI requests as described.

- **AI requests:** the selected code, the open file, your message, and any files the AI reads go to the provider you chose.
- **Anonymous usage count:** once a day, a random ID, the app version, the OS family, and the language. There is no setting to turn it off.
- **Feedback:** only when you press Send: your message, its type, an optional contact, the app version, the OS, and the language.
- **Lapount login (optional):** only when you log in, the app fetches your account name and icon and syncs your settings, profiles, and workspaces (names, colors, and folder locations). Open tabs, terminals, AI keys and chats, statistics, and file contents are not synced. You can turn sync off and delete the cloud data. Feedback sent while logged in is linked to your account so you can receive replies.
- **Detailed usage and errors:** daily working time, typed characters, key presses, and saves, and the type, message, and call order of errors. There is no setting to turn this off.
- **Language servers (opt-in):** the server itself is downloaded from npm, GitHub releases, `go install`, or `gem install`. Only the package request is sent.
- **Update check:** asks for the latest version information.

## Build from source

Requirements: pnpm and a Rust toolchain with the `x86_64-pc-windows-gnu` target. The Windows exe is built from WSL or Linux:

```bash
pnpm install
bash scripts/build-win.sh   # writes dist-win/Fixit-Editor.exe
```

## License

All rights reserved. You may use the app for free, but copying, redistributing, or reusing the code is not allowed. See [LICENSE](LICENSE).
