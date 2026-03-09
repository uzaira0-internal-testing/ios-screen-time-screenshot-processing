import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// Tauri expects a fixed port for dev, and sets TAURI_DEV_HOST for mobile
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  base: "./",
  server: {
    host: host || false,
    port: 5173,
    strictPort: true,
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
