import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFileSync } from "node:fs";

// wersja + data builda wstrzykiwane do apki (splash) — do rozróżniania buildów
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));
const BUILD_TIME = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

export default defineConfig({
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
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
          // PNG 192 i 512 są wymagane przez Chrome do prawdziwej instalacji PWA
          // (WebAPK) — bez nich instalacja spada do „skrótu" ze znaczkiem Chrome.
          { src: "assets/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "assets/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "assets/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
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
