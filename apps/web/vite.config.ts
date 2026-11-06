import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In `pnpm dev:web`, forward the WebSocket to a running `kratos` (pnpm start).
    proxy: { "/ws": { target: "ws://127.0.0.1:4317", ws: true } },
  },
});
