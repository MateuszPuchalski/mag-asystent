import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: { target: "es2019" },
  server: {
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["assets/*"],
      manifest: {
        name: "WERTIS Kolektor magazynowy",
        short_name: "WERTIS Mag",
        description:
          "Asystent magazyniera — podgląd stanów, lokalizacje, przesunięcia MM (Subiekt GT)",
        lang: "pl",
        display: "standalone",
        orientation: "portrait",
        background_color: "#ffffff",
        theme_color: "#2A2A2C",
        icons: [
          { src: "assets/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        // WASM ONNX Runtime i wagi modeli (ASR) są za duże na precache —
        // ładowane leniwie przy włączonych komendach i cache'owane w runtime
        globIgnores: ["**/ort-*.wasm", "**/models/**"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: { cacheName: "wertis-api" },
          },
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".wasm"),
            handler: "CacheFirst",
            options: { cacheName: "wertis-wasm" },
          },
          {
            urlPattern: ({ url }) => url.pathname.includes("/models/"),
            handler: "CacheFirst",
            options: { cacheName: "wertis-models" },
          },
        ],
      },
    }),
  ],
});
