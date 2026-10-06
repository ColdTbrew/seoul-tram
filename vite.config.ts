import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "/seoul-tram/",
  optimizeDeps: { exclude: ["maplibre-gl"] }, // dev에서도 워커 .mjs가 원본 경로로 서빙되게 (프리번들 제외)
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
