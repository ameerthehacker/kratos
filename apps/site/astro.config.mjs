// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Static site (D58): `astro build` writes plain HTML/CSS/JS to dist/.
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
