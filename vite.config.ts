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
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["assets/*.svg"],
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
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith("/data/products.json"),
            handler: "NetworkFirst",
            options: { cacheName: "wertis-data" },
          },
        ],
      },
    }),
  ],
});
