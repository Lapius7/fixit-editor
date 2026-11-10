import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { terminal } from "./server/term";
import { fsApi } from "./server/fsapi";
import { claudeBridge } from "./server/claude";
import pkg from "./package.json" with { type: "json" };

// portless が PORT / HOST を渡してくる
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), terminal(), fsApi(), claudeBridge()],
  server: { port: Number(process.env.PORT) || 5173, host: process.env.HOST || "127.0.0.1", strictPort: true, allowedHosts: [".localhost"] },
});
