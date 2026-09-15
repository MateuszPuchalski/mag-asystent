import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const tutaj = path.dirname(fileURLToPath(import.meta.url));

/* ── PIECZĄTKA WERSJI W ZBUDOWANYM PANELU (audyt, 15 września 2026) ────────
   Panel i serwer buduje się dwoma różnymi poleceniami, a `npm run build`
   w `server/` NIE przebudowuje panelu. Skutek jest cichy i najgorszy z
   możliwych: `/api/health` melduje nową wersję, bo proces API wstał z nowego
   kodu, a ekran obsługi zostaje na starym buildzie. Wygląda to na wdrożone
   wydanie, które „nie działa".

   Pieczątka zamienia to w fakt, który da się odczytać z zewnątrz. Numer bierze
   się z KORZENIA repo, bo to on jest źródłem wersji całego monorepo — ten sam
   plik, z którego czyta go serwer i APK.                                    */
function pieczatkaWersji(): Plugin {
  const wersja = JSON.parse(
    fs.readFileSync(path.join(tutaj, "../package.json"), "utf8")).version as string;
  return {
    name: "wertis-pieczatka-wersji",
    /* `post`, żeby stempel przetrwał wstrzyknięcie skryptów przez samego Vite. */
    transformIndexHtml: { order: "post", handler: (html) =>
      html.replace("</head>", `<meta name="wertis-panel" content="${wersja}"/></head>`) },
  };
}

export default defineConfig({
  plugins: [react(), pieczatkaWersji()],
  base: "/obsluga/",
  server: {
    port: 5174,
    /* `strictPort`, bo test dymny Playwrighta czeka pod konkretnym adresem.
       Bez tego Vite po cichu bierze 5175 i test wisi do timeoutu. */
    strictPort: true,
    proxy: { "/api": "http://localhost:3001" },
  },
});
