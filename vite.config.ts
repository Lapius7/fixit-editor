import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// portless が PORT / HOST を渡してくる
export default defineConfig({
  plugins: [react()],
  server: { port: Number(process.env.PORT) || 5173, host: process.env.HOST || "127.0.0.1", strictPort: true, allowedHosts: [".localhost"] },
});
