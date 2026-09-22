import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Strażnik adresów CAŁEGO panelu (0.431.0) ──────────────────────────────
   `skrzynka.test.ts` od 0.181.1 pilnuje, że każdy adres z `api/rozmowy.ts` ma
   trasę na serwerze. Pozostałe moduły `panel/src/api/*.ts` nie miały strażnika
   wcale — a przeprowadzka biura do panelu (`docs/obsluga-klienta.md` §7)
   dokłada tam właśnie nowe moduły: dostawy, kosze, stan systemu.

   BEZ ŻADNEGO ŻĄDANIA, celowo. Tamten test puszcza prawdziwe żądania z kontem
   biura, co przy jednym pliku hooków jest do zniesienia; przy wszystkich
   modułach odpaliłby synchronizacje z Allegro i zapisy. Żądanie bez sesji nie
   pomaga: bramka sesji odpowiada 401 także na adres, którego nie ma (zmierzone
   przy pisaniu tego testu). Zostaje drzewo tras z `printRoutes` — ta sama
   tablica, z której korzysta router — przełożone na wzorce i porównane
   z adresami panelu. Nic się nie wykonuje. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-panel-adresy-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;
before(async () => {
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

const KATALOG = path.resolve(import.meta.dirname, "../../../panel/src/api");

type Trasa = { metody: string[]; wzor: RegExp; sciezka: string };

/** Drzewo `printRoutes` → płaska lista wzorców. Wcięcie to 4 znaki na poziom. */
function trasySerwera(): Trasa[] {
  const out: Trasa[] = [];
  const stos: string[] = [];
  for (const linia of app.printRoutes({ commonPrefix: false }).split("\n")) {
    const m = linia.match(/^([│├└─\s]*)(\S.*?)(?: \(([^)]+)\))?\s*$/);
    if (!m || !m[2]) continue;
    const poziom = m[1].length / 4;
    stos.length = poziom;
    const pelna = (stos[poziom - 1] ?? "") + m[2];
    stos[poziom] = pelna;
    if (!m[3]) continue;
    /* Parametr bywa w drzewie podwójny — `/:twId|:id`, gdy dwie trasy mają
       w tym miejscu różne nazwy — więc parametry idą na znacznik PRZED
       ucieczką znaków, inaczej `|` rozcięłoby wzorzec na dwa. */
    const wzor = new RegExp("^" + pelna
      .replace(/:\w+(?:\([^)]*\))?(?:\|:\w+(?:\([^)]*\))?)*/g, "\u0000")
      .replace(/[.+?^${}()|[\]\\]/g, (z) => "\\" + z)
      .replace(/\u0000/g, "[^/]+")
      .replace(/\*/g, ".*") + "$");
    out.push({ metody: m[3].split(",").map((x) => x.trim()), wzor, sciezka: pelna });
  }
  return out;
}

test("każdy adres wołany z panel/src/api/*.ts ma trasę na serwerze", async () => {
  const trasy = trasySerwera();
  assert.ok(trasy.length >= 100, `drzewo tras się nie czyta — ${trasy.length} tras`);
  const jest = (metoda: string, url: string) => trasy.some((t) => t.metody.includes(metoda) && t.wzor.test(url));
  /* Szablon panelu bywa zmienny w miejscu STAŁEGO członu trasy —
     `/api/obsluga/${v.rodzaj}/…` to raz reklamacje, raz dyskusje. Jedynka
     w tym miejscu nie pasuje do niczego, więc taki adres porównujemy odwrotnie:
     szablon jako wzorzec przyłożony do ścieżek tras. */
  const pasujeSzablon = (metoda: string, szablon: string) => {
    const w = new RegExp("^" + szablon.replace(/\?.*$/, "")
      .replace(/\$\{[^}]+\}/g, "\u0000")
      .replace(/[.+?^${}()|[\]\\]/g, (z) => "\\" + z)
      .replace(/\u0000/g, "[^/]+") + "$");
    return trasy.some((t) => t.metody.includes(metoda) && w.test(t.sciezka));
  };
  // Kontrola samego czytnika: trasa z parametrem i trasa, której nie ma.
  assert.ok(jest("POST", "/api/queue/1/retry"), "czytnik drzewa nie widzi trasy z parametrem");
  assert.ok(!jest("GET", "/api/nie-ma-takiej-trasy"), "czytnik drzewa widzi trasę, której nie ma");

  const pliki = fs.readdirSync(KATALOG).filter((f) => f.endsWith(".ts") && !f.includes(".test."));
  assert.ok(pliki.length >= 8, `spodziewałem się kilku modułów api, jest ${pliki.length}`);
  const bledne: string[] = [];
  let wywolan = 0;
  for (const plik of pliki) {
    const zrodlo = fs.readFileSync(path.join(KATALOG, plik), "utf8");
    /* `api(...)` i `pobierzPlik(...)` z literałem adresu — w backtickach albo
       cudzysłowie — oraz opcjonalnym `method` w tym samym wywołaniu. */
    const wzor = /(?:api|pobierzPlik)(?:<[^>]*>)?\(\s*(?:`([^`]+)`|"([^"]+)")(?:\s*,\s*\{[^}]*?method:\s*"(GET|POST|PUT|PATCH|DELETE)")?/gs;
    for (const [, zPlecami, zCudzyslowem, metoda] of zrodlo.matchAll(wzor)) {
      const adres = zPlecami ?? zCudzyslowem;
      if (!adres.startsWith("/api/")) continue;
      wywolan++;
      const url = adres.replace(/\$\{[^}]+\}/g, "1").replace(/\?.*$/, "");
      if (!jest(metoda ?? "GET", url) && !pasujeSzablon(metoda ?? "GET", adres)) bledne.push(`${plik}: ${metoda ?? "GET"} ${adres}`);
    }
  }
  assert.ok(wywolan >= 40, `wzorzec przestał znajdować wywołania — jest ich ${wywolan}`);
  assert.deepEqual(bledne, [], "panel woła adresy bez trasy na serwerze");
});
