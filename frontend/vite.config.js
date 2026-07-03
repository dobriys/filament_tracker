import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // virtiofs (Colima) не пробрасывает inotify — опрашиваем файлы для HMR.
    watch: { usePolling: true },
  },
});
