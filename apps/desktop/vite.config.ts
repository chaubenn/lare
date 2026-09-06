import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// The shipped version, baked in at build time so the UI can show it without a round trip to
// Rust (and so it still reads correctly in a plain browser). package.json, tauri.conf.json,
// src-tauri/Cargo.toml and the extension's package.json are all kept on the same number.
const { version: APP_VERSION } = createRequire(import.meta.url)("./package.json") as {
  version: string;
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Tauri expects a fixed port; fail if it is taken.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS/Linux.
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Vite 8 minifies with oxc by default; skip it for debug bundles.
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
