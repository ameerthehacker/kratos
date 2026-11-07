import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [react(), tailwindcss(), svgr()], // svgr: `import X from "./x.svg?react"` → component
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") }, // shadcn imports use "@/..."
  },
  server: {
    // In `pnpm dev:web`, forward the WebSocket to a running `kratos` (pnpm start).
    proxy: {
      "/ws": { target: "ws://127.0.0.1:4317", ws: true },
      "/editor-icons": { target: "http://127.0.0.1:4317" }, // editors' app icons (3d3)
      "/attachments": { target: "http://127.0.0.1:4317" }, // files sent with prompts (D55)
    },
  },
});
