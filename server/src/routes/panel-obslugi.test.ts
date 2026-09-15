import { before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-panel-")), "t.db");
process.env.LOG_LEVEL = "silent";
process.env.SGT_MODE = "seeded";

let app: FastifyInstance;
before(async () => { app = await (await import("../index.js")).buildApp(); });

/* Do 0.146.0 ścieżki ekranów panelu stały tu wypisane z ręki — dwie sztuki.
   Rozmowa ma od tego wydania własny adres, więc lista rosłaby bez końca,
   a każdy pominięty ekran dawał 404 po odświeżeniu strony.

   Test celowo NIE zakłada, że panel jest zbudowany: w CI `npm test` biegnie
   przed `npm run build`. Sprawdza więc rzecz, która nie zależy od builda —
   że głęboki link dostaje TO SAMO co korzeń. */
const EKRANY = ["/obsluga/", "/obsluga/skrzynka", "/obsluga/skrzynka/4821",
  "/obsluga/reklamacje", "/obsluga/reklamacje/17"];

test("każdy ekran panelu odpowiada tak samo jak jego korzeń", async () => {
  const odpowiedzi = [];
  for (const url of EKRANY) {
    const r = await app.inject({ method: "GET", url });
    assert.notEqual(r.statusCode, 404, `${url} dał 404 — fallback SPA go nie objął`);
    odpowiedzi.push(r.statusCode);
  }
  assert.equal(new Set(odpowiedzi).size, 1, "ekrany panelu rozjechały się odpowiedzią");
});

test("wejście bez ukośnika prowadzi do panelu, a nie w pustkę", async () => {
  const r = await app.inject({ method: "GET", url: "/obsluga" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/obsluga/");
});

test("zasoby nie wychodzą poza katalog builda", async () => {
  /* Gwiazdka `/obsluga/*` łapie wszystko, więc bez białej listy nazwa pliku
     z `..` czytałaby cudze pliki serwera. */
  for (const zly of ["../../../etc/passwd", "..%2f..%2fpackage.json", "nie-ma-takiego.js"]) {
    const r = await app.inject({ method: "GET", url: `/obsluga/assets/${zly}` });
    assert.ok(r.statusCode === 404 || r.statusCode === 200 && !r.body.includes("root:"),
      `zasób ${zly} nie został odrzucony`);
  }
});

/* ── Pieczątka wersji panelu (audyt, 15 września 2026) ──────────────────────
   `npm run build` w `server/` NIE przebudowuje panelu. Kto pomyli katalog,
   dostaje API z nowego kodu i ekran obsługi ze starego builda — a `/api/health`
   melduje przy tym nową wersję, więc wdrożenie wygląda na udane. Siedemnaście
   wydań panelu zeszło z jednej gałęzi bez ani jednego potwierdzenia, że
   dotarły na ekran; recepta w `DEPLOY.md` nie została uruchomiona ani razu.

   Testy idą po funkcjach CZYSTYCH, nie po dysku: w CI `npm test` biegnie przed
   `npm run build`, więc test sięgający po prawdziwy katalog zachowywałby się
   inaczej u programisty niż na maszynie CI — czyli nie pilnowałby niczego. */

test("pieczątkę czyta się z HTML-a, także po wstrzyknięciu skryptów przez Vite", async () => {
  const { wersjaZHtml } = await import("./panel-obslugi.js");
  assert.equal(wersjaZHtml('<head><meta name="wertis-panel" content="0.354.0"/></head>'), "0.354.0");
  /* Kolejność znaczników nie jest umową — plugin stempluje `post`, ale build
     Vite wstawia swoje skrypty obok i to się zmienia między wersjami. */
  assert.equal(wersjaZHtml(
    '<head><script src="/a.js"></script><meta name="wertis-panel" content="1.2.3"/>'
    + '<link rel="stylesheet" href="/a.css"></head>'), "1.2.3");
});

test("brak pieczątki to nie jest wersja — build sprzed tego wydania jej nie ma", async () => {
  const { wersjaZHtml } = await import("./panel-obslugi.js");
  assert.equal(wersjaZHtml("<head><title>WERTIS</title></head>"), null);
  assert.equal(wersjaZHtml(""), null);
});

test("rozjazd wersji mówi, CO zrobić, i wskazuje właściwy katalog", async () => {
  const { problemZWersji } = await import("./panel-obslugi.js");
  const zdanie = problemZWersji("0.352.0", "0.354.0");
  assert.ok(zdanie, "rozjazd musi dać zdanie");
  /* Obie wersje w zdaniu, bo bez nich nie widać, która strona została z tyłu. */
  assert.match(zdanie, /0\.352\.0/);
  assert.match(zdanie, /0\.354\.0/);
  assert.match(zdanie, /KORZENIU/);
});

test("zgodne wersje i brak panelu MILCZĄ, bo żadne z nich nie jest usterką", async () => {
  const { problemZWersji } = await import("./panel-obslugi.js");
  assert.equal(problemZWersji("0.354.0", "0.354.0"), null);
  /* `null` to instalacja bez panelu albo build sprzed pieczątki. Zdanie w tych
     przypadkach robiłoby czerwonym każdy `npm run dev` i każdą starą
     instalację — czyli uczyłoby ignorować listę problemów zdrowia. */
  assert.equal(problemZWersji(null, "0.354.0"), null);
});
