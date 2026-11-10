import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { WebSocketServer } from "ws";
import { SSH_HOST, sq } from "./fsapi";

const HELPER = fileURLToPath(new URL("./pty-helper.py", import.meta.url));
// 開発サーバー専用。ループバックからの、localhost 系の Origin だけを受け付ける
const OK_ORIGIN = /^https?:\/\/([\w-]+\.)*localhost(:\d+)?$|^https?:\/\/127\.0\.0\.1(:\d+)?$/;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// 選べるシェル(開発サーバーが動いている環境のもの)
const SHELLS: [string, string][] = [["bash", "bash"], ["zsh", "zsh"], ["fish", "fish"], ["sh", "sh"]];
const shellPath = (id: string) => !id ? undefined : ["/bin", "/usr/bin", "/usr/local/bin"].map((d) => `${d}/${id}`).find((p) => existsSync(p));

export function terminal(): Plugin {
  return {
    name: "fixit-terminal",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__shells", (req, res) => {
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) { res.statusCode = 403; res.end(); return; }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(SHELLS.filter(([id]) => shellPath(id)).map(([id, label]) => ({ id, label }))));
      });
      const wss = new WebSocketServer({ noServer: true });
      server.httpServer?.on("upgrade", (req, socket, head) => {
        if (!req.url?.startsWith("/__term")) return;
        if (!LOOPBACK.has(req.socket.remoteAddress ?? "") || !OK_ORIGIN.test(req.headers.origin ?? "")) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          // ?host=<SSH先>&cwd=<最初のフォルダ>。host は形を確かめ、`--` のあとに渡す(オプションとして解釈させない)
          const q = new URL(req.url!, "http://localhost").searchParams;
          const host = q.get("host") ?? "", want = q.get("cwd") ?? "", pick = shellPath(SHELLS.find(([id]) => id === q.get("shell"))?.[0] ?? "");
          if ((host && (!SSH_HOST.test(host) || host.startsWith("-"))) || want.includes("\0") || (want && !want.startsWith("/"))) { ws.close(); return; }
          const cwd = (!host && want) || process.env.FIXIT_TERM_CWD || homedir();
          const cmd = host
            ? ["--", "ssh", "-t", "-o", "ConnectTimeout=10", "-o", "ControlMaster=auto", "-o", "ControlPath=~/.ssh/cm-%C", "-o", "ControlPersist=10m", "--", host,
               `sh -c ${sq(`${want ? `cd ${sq(want)} 2>/dev/null; ` : ""}exec "\${SHELL:-/bin/sh}" -l`)}`]
            : [];
          const p = spawn("python3", [HELPER, cwd, ...cmd], { stdio: ["pipe", "pipe", "inherit", "pipe"], env: { ...process.env, ...(pick && !host ? { SHELL: pick } : {}), ...(want && !host ? { FIXIT_KEEP_CWD: "1" } : {}) } });
          p.on("error", () => { ws.send("\r\npython3 を起動できませんでした。\r\n"); ws.close(); });
          p.stdout!.on("data", (d: Buffer) => ws.readyState === ws.OPEN && ws.send(d));
          p.on("exit", () => ws.close());
          ws.on("message", (data, isBinary) => {
            const s = isBinary ? "" : data.toString();
            if (s.startsWith("\u0000r")) p.stdio[3] && (p.stdio[3] as NodeJS.WritableStream).write(s.slice(2) + "\n");
            else p.stdin!.write(isBinary ? (data as Buffer) : s);
          });
          ws.on("close", () => p.kill("SIGHUP"));
        });
      });
    },
  };
}
