import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react({ jsxRuntime: "automatic" })],
  appType: "spa",
  server: {
    // Use a dedicated port for HMR WebSocket so it doesn't conflict
    // with @fastify/websocket which also attaches to the same HTTP server.
    hmr: {
      port: 24678,
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
