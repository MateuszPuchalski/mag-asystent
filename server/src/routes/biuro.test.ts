import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";

/* ── Podgląd biura ───────────────────────────────────────────────────────────
   Strona pod /biuro jest jedynym interfejsem biura, więc dwa niezmienniki są
   warte testu:

   1. SAMA STRONA jest dostępna bez sesji — logowanie odbywa się na niej, więc
      gdyby bramka ją objęła, biuro nie miałoby jak wpisać badge'a.
   2. DANE za nią nie są: trasy API, z których strona czyta, odpadają bez
      tokenu. Strona bez sesji ma pokazać formularz logowania, nie dane.      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-biuro-")), "t.db");
process.env.LOG_LEVEL = "silent";

let app: FastifyInstance;

before(async () => {
  const { buildApp } = await import("../index.js");
  app = await buildApp();
});

test("strona /biuro jest serwowana bez sesji", async () => {
  const r = await app.inject({ method: "GET", url: "/biuro" });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers["content-type"] as string, /text\/html/);
  assert.match(r.body, /Podgląd biura/);
});

test("korzeń przekierowuje do podglądu", async () => {
  const r = await app.inject({ method: "GET", url: "/" });
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, "/biuro");
});

test("trasa /sw.js wyszła razem z pogrzebem starej PWA", async () => {
  // jednorazowe sprzątanie po PWA z 0.3.0 skończyło się w 0.26.0
  const r = await app.inject({ method: "GET", url: "/sw.js" });
  assert.equal(r.statusCode, 404);
});

test("dane strony zostają za bramką sesji", async () => {
  // dokładnie trasy, z których strona czyta — regresja w którejkolwiek
  // otworzyłaby dane magazynu każdemu w LAN
  for (const url of [
    "/api/delivery/documents",
    "/api/problems/unresolved",
    "/api/delivery/1/problems",
    "/api/delivery/1/problems.csv",
    "/api/problems/1/photo",
    /* Zakładka STAN SYSTEMU i DZIENNIK (0.27.0). Metryki i kolejka mówią, ile
       kto zeskanował i co się nie zapisało, a ślad audytowy mówi to imiennie —
       więc bramka obejmuje je tak samo jak dostawy. */
    "/api/metrics",
    "/api/queue",
    "/api/reconcile",
    "/api/ean-conflicts",
    "/api/events",
    "/api/events/csv",
    // Pozycje dokumentu (0.36.0) — mówią, co przyjechało, po ile i gdzie leży.
    "/api/biuro/dokument/1",
  ]) {
    const r = await app.inject({ method: "GET", url });
    assert.equal(r.statusCode, 401, url);
  }
});

test("strona czyta stan serwera bez sesji — i tylko to", async () => {
  /* `/api/health` jest jedyną trasą, z której pasek stanu korzysta przed
     zalogowaniem, i jedyną, która ma prawo być otwarta: mówi o PROCESIE
     (wersja, tryb, czy worker żyje), nie o towarze ani o ludziach. */
  const r = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(r.statusCode, 200);
  const h = r.json();
  assert.ok(typeof h.wersja === "string");
  assert.ok("worker" in h);
});

test("formularze dostawców siedzą w stronie obok protokołu WERTIS", () => {
  /* GEKO i PARTNER mają własne druki reklamacyjne — wydruk ma wyglądać jak
     ich formularz, nie jak nasz protokół. Wybór idzie po nazwie dostawcy
     z dokumentu FZ; dane firmy do nadruku żyją w localStorage przeglądarki. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /Protokół zgłoszenia reklamacji B2B/, "szablon GEKO");
  assert.match(html, /PROTOKÓŁ ZGŁOSZENIA REKLAMACJI/, "szablon PARTNER");
  assert.match(html, /SZABLONY_DOSTAWCOW/, "wybór szablonu po dostawcy");
  assert.match(html, /wertis\.firma/, "dane firmy w localStorage");
});

test("strona biura nie zapisuje niczego poza logowaniem", () => {
  /* „ZERO ZAPISU" jest w tym pliku regułą od 0.18.0 i do 0.36.0 pilnowało jej
     wyłącznie oko. Wejście w dokument to pierwsze miejsce, w którym łatwo ją
     złamać przez wygodę: `POST /api/delivery/documents/:dokId/open` różni się
     od trasy podglądu o jeden człon ścieżki, a zwróciłby to samo. Kosztem
     byłoby otwarcie dostawy przez samo PATRZENIE — czyli zabranie blokad
     komuś przy półce i dokument w statusie W TOKU, którego nikt nie zaczął. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.equal(
    (html.match(/method:\s*"POST"/g) ?? []).length,
    1,
    "jedynym zapisem strony ma zostać logowanie"
  );
  assert.ok(!/documents\/[^"'`]*\/open/.test(html), "strona otwiera dostawę");
  assert.match(html, /\/api\/biuro\/dokument\//, "strona czyta trasę podglądu");
});

test("podgląd pokazuje, kto odłożył pozycję", () => {
  /* `done_by` i `done_at` leżały w bazie od 0.17.0 bez ani jednego czytelnika.
     Wyleciałyby z widoku niezauważone przy pierwszym porządkowaniu tabeli. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.match(html, /doneBy/);
  assert.match(html, /KTO ODŁOŻYŁ/);
});

test("podgląd nie oferuje raportu wydajności per osoba", () => {
  /* Monitoring pracowniczy (Kodeks pracy art. 22²) wymaga zapisu w regulaminie
     i uprzedzenia ludzi. `GET /api/wydajnosc` istnieje dla biura, ale przycisk
     obok metryk zrobiłby z obowiązku formalnego przypadek — a tego nie widać
     w kodzie strony inaczej niż tak. */
  const html = fs.readFileSync(
    path.resolve(import.meta.dirname, "../web/biuro.html"),
    "utf8"
  );
  assert.ok(!/["'`]\/api\/wydajnosc/.test(html), "strona odpytuje /api/wydajnosc");
});
