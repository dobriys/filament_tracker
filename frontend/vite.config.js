import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Компоненты Untitled UI импортируют друг друга как "@/components/...".
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    host: true,
    port: 5173,
    // virtiofs (Colima) не пробрасывает inotify — опрашиваем файлы для HMR.
    watch: { usePolling: true },
    // Единый порт и в деве: проксируем API/health на backend (по умолчанию —
    // сервис compose; для запуска vite на хосте задайте VITE_PROXY_TARGET).
    proxy: {
      "/api": { target: process.env.VITE_PROXY_TARGET || "http://backend:8000", changeOrigin: true },
      "/health": { target: process.env.VITE_PROXY_TARGET || "http://backend:8000", changeOrigin: true },
    },
  },
});
