import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri runs `beforeDevCommand` with cwd = src-tauri; anchor paths here so .env loads from repo root.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: projectRoot,
  envDir: projectRoot,
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  optimizeDeps: {
    include: ["@mdxeditor/editor"],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        main: "./index.html",
        "sticky-note": "./sticky-note.html",
        "moodboard-tile": "./moodboard-tile.html",
      },
    },
  },
});
