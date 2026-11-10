import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { isDark, useSettings } from "@/features/settings/settings";
import { IS_TAURI } from "@/shared/chrome";
import { tauriPty, type Sock } from "@/platform/pty";
import i18next from 'i18next'

const LIGHT = { background: "#00000000", foreground: "#26292e", cursor: "#3b6fd9", selectionBackground: "#3b6fd940", black: "#26292e", red: "#c41a16", green: "#2a9d6c", yellow: "#8a5a00", blue: "#3b6fd9", magenta: "#9b2393", cyan: "#326d74", white: "#8b93a1" };
const DARK = { background: "#00000000", foreground: "#e6e9f0", cursor: "#7aa2ff", selectionBackground: "#5a8cff55", black: "#3a3f4b", red: "#fc6a5d", green: "#67d4a4", yellow: "#d0bf69", blue: "#7aa2ff", magenta: "#fc5fa3", cyan: "#5dd8ff", white: "#e6e9f0" };
const FONT = (): string => getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";

export type TermApi = { copy: () => void; paste: () => void; clear: () => void; focus: () => void };
type Props = {
  id: number;
  active: boolean;       // この画面が前に出ているか(ほかのタブの間は隠すだけで、接続は残す)
  open: boolean;         // パネルが開いているか
  focusKey: number;
  host?: string;         // SSH 先(なければこのPCのシェル)
  shell?: string;        // 使うシェル(空なら標準)
  cwd?: string;          // 最初に入るフォルダ
  register: (id: number, api: TermApi | null) => void;
  onExit: (id: number) => void;
  onContext: (e: React.MouseEvent, id: number) => void;
};

// 1つの画面 = 1つの xterm + 1本の WebSocket(サーバー側で1つのシェルになる)
export default function TerminalSession({ id, active, open, focusKey, host: sshHost, cwd, shell, register, onExit, onContext }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<XTerm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const ws = useRef<Sock | null>(null);
  const live = useRef({ active, open });
  live.current = { active, open };
  const s = useSettings();
  const cb = useRef({ onExit, register });
  cb.current = { onExit, register };
  const copyOnSelect = useRef(s.termCopyOnSelect);
  copyOnSelect.current = s.termCopyOnSelect;
  const rightPaste = useRef(s.termRightClick === "paste");
  rightPaste.current = s.termRightClick === "paste";

  // 大きさが 0 のとき(隠れている間)は測らない。測ると 0 桁になってシェルが壊れる
  const size = () => {
    const h = host.current, t = term.current, f = fit.current, sock = ws.current;
    if (!h || !t || !f || !h.offsetWidth || !h.offsetHeight || !live.current.active) return;
    try { f.fit(); if (sock?.readyState === 1) sock.send(`\u0000r${t.cols} ${t.rows}`); } catch { /* 非表示中 */ }
  };

  useEffect(() => {
    const t = new XTerm({
      fontFamily: FONT(), fontSize: s.termFontSize, lineHeight: s.termLineHeight, cursorBlink: s.termBlink, cursorWidth: s.termCursorWidth, cursorInactiveStyle: (s.termCursorInactive === "none" ? "none" : s.termCursorInactive) as "outline" | "block" | "none", cursorStyle: s.termCursor as "bar" | "block" | "underline",
      allowTransparency: true, scrollback: s.termScrollback, scrollSensitivity: s.termScrollSens, minimumContrastRatio: s.termMinContrast, theme: isDark(s) ? DARK : LIGHT,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    term.current = t; fit.current = f;
    const q = new URLSearchParams({ ...(sshHost ? { host: sshHost } : {}), ...(cwd ? { cwd } : {}), ...(shell ? { shell } : {}) }).toString();
    const sock: Sock = IS_TAURI ? tauriPty(id, sshHost, cwd, shell) : (() => {
      const w = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/__term${q ? `?${q}` : ""}`);
      w.binaryType = "arraybuffer";
      return w as unknown as Sock;
    })();
    ws.current = sock;
    sock.onopen = () => size();
    sock.onmessage = (e) => t.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data as ArrayBuffer));
    sock.onclose = () => {
      if (s.termAutoClose) cb.current.onExit(id);
      else t.write(i18next.t("\r\n\u001b[2m[終了しました。Enter で閉じます]\u001b[0m"));
    };
    sock.onerror = () => t.write(i18next.t("\r\n\u001b[31mターミナルに接続できません。\u001b[0m\r\nこの機能は開発サーバー(pnpm dev)かデスクトップ版で使えます。"));
    t.onData((d) => { if (sock.readyState === 1) sock.send(d); else if (d === "\r") cb.current.onExit(id); });
    t.onSelectionChange(() => { if (copyOnSelect.current) { const x = t.getSelection(); if (x) navigator.clipboard.writeText(x).catch(() => {}); } });
    cb.current.register(id, {
      copy: () => { const x = t.getSelection(); if (x) navigator.clipboard.writeText(x).catch(() => {}); },
      paste: () => navigator.clipboard.readText().then((x) => t.paste(x)).catch(() => {}),
      clear: () => t.clear(),
      focus: () => t.focus(),
    });
    const ro = new ResizeObserver(() => size());
    ro.observe(host.current!);
    return () => { ro.disconnect(); cb.current.register(id, null); sock.onclose = null; sock.close(); t.dispose(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 見た目の設定は、作り直さず、動いている画面にそのまま反映する
  useEffect(() => { if (term.current) term.current.options.theme = isDark(s) ? DARK : LIGHT; }, [s.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = term.current; if (!t) return;
    t.options.fontFamily = FONT(); t.options.fontSize = s.termFontSize; t.options.lineHeight = s.termLineHeight;
    t.options.cursorBlink = s.termBlink; t.options.cursorWidth = s.termCursorWidth; t.options.cursorInactiveStyle = s.termCursorInactive as "outline" | "block" | "none"; t.options.cursorStyle = s.termCursor as "bar" | "block" | "underline"; t.options.scrollback = s.termScrollback;
    t.options.scrollSensitivity = s.termScrollSens; t.options.minimumContrastRatio = s.termMinContrast;
    requestAnimationFrame(size);
  }, [s.fontFamily, s.termFontSize, s.termLineHeight, s.termBlink, s.termCursorWidth, s.termCursorInactive, s.termCursor, s.termScrollback, s.termScrollSens, s.termMinContrast, s.termPad]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || !open) return;
    const r = requestAnimationFrame(() => { size(); if (!document.activeElement?.closest(".term-head")) term.current?.focus(); }); // 名前を変えている間は、入力欄から焦点を奪わない
    return () => cancelAnimationFrame(r);
  }, [active, open, focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={host} className="term-body" hidden={!active}
      onContextMenu={(e) => { if (rightPaste.current) { e.preventDefault(); e.stopPropagation(); navigator.clipboard.readText().then((x) => term.current?.paste(x)).catch(() => {}); } else onContext(e, id); }}
    />
  );
}
