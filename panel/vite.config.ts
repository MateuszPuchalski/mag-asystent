import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { wtyczkaZmian } from "./wtyczka-zmian";

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

/* ── DEKODERY OBRAZÓW PDF-A OBOK PANELU ──────────────────────────────────
   Skan ze skanera biurowego to zwykle obraz JBIG2 albo JPEG2000. pdf.js
   dekoduje je wyłącznie modułami WASM spod `wasmUrl`. Bez nich pomija obraz
   i strona skanu wychodzi biała, bez żadnego błędu do pokazania agentowi.

   Nazwy plików są stałe, bo pdf.js dokleja je do katalogu `wasmUrl`. Serwer
   podaje zasoby z `assets/` jako niezmienne na rok, więc w nazwie katalogu
   stoi wersja pdf.js. Po podbiciu biblioteki przeglądarka nie weźmie starego
   dekodera. `rysujPdf.ts` składa ten sam katalog z `version` biblioteki.

   Bez `quickjs-eval`, bo to silnik skryptów PDF-a, którego nie włączamy. */
const DEKODERY_PDF = ["jbig2.wasm", "openjpeg.wasm", "qcms_bg.wasm"];

function dekoderyPdf(): Plugin {
  const paczka = path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const wersja = JSON.parse(fs.readFileSync(path.join(paczka, "package.json"), "utf8")).version as string;
  const nazwa = (plik: string) => `pdfjs-${wersja}/${plik}`;
  return {
    name: "wertis-dekodery-pdf",
    generateBundle() {
      for (const plik of DEKODERY_PDF) {
        this.emitFile({ type: "asset", fileName: `assets/${nazwa(plik)}`,
          source: fs.readFileSync(path.join(paczka, "wasm", plik)) });
      }
    },
    /* Serwer deweloperski nie ma builda, więc te same adresy podaje z paczki. */
    configureServer(serwer) {
      serwer.middlewares.use((req, res, dalej) => {
        const plik = DEKODERY_PDF.find((p) => req.url?.endsWith(`/assets/${nazwa(p)}`));
        if (!plik) return dalej();
        res.setHeader("content-type", "application/wasm");
        res.end(fs.readFileSync(path.join(paczka, "wasm", plik)));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), pieczatkaWersji(), dekoderyPdf(), wtyczkaZmian(path.join(tutaj, ".."))],
  base: "/obsluga/",
  build: {
    rolldownOptions: {
      output: {
        /* Worker pdf.js przychodzi w paczce jako `.mjs`, a serwer podaje typ
           treści po rozszerzeniu i `.mjs` nie zna. Przeglądarka odrzuca
           skrypt workera bez typu JavaScript, więc każdy PDF w czacie
           kończyłby się zdaniem „nie umiem otworzyć”. Ten sam plik, bez
           zmiany bajtu, wychodzi więc jako `.js`. */
        assetFileNames: (zasob) => (zasob.names.some((n) => n.endsWith(".mjs"))
          ? "assets/[name]-[hash].js" : "assets/[name]-[hash][extname]"),
      },
    },
  },
  server: {
    port: 5174,
    /* `strictPort`, bo test dymny Playwrighta czeka pod konkretnym adresem.
       Bez tego Vite po cichu bierze 5175 i test wisi do timeoutu. */
    strictPort: true,
    proxy: { "/api": "http://localhost:3001" },
  },
});
