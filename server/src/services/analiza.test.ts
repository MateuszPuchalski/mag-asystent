import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Analiza śladu audytowego ────────────────────────────────────────────────
   Agregacje czytane przez zakładkę ANALIZA. Trzy rzeczy są tu przedmiotem
   testu, bo każda ma cichy tryb awarii:

   1. BUCKETOWANIE PO DNIU LOKALNYM. Znaczniki w bazie są w UTC, a zdarzenie
      z 23:30 UTC należy do NASTĘPNEGO dnia polskiego. Liczone w SQL po dobie
      UTC wieczorna zmiana lądowałaby w złym dniu — lekcja 0.31.1.
   2. REGUŁA bezDubli. Rozłożenie linii emituje dwa zdarzenia; policzone
      podwójnie zawyżałoby pracę całej hali.
   3. STARE ZDARZENIA `search` BEZ LICZBY WYNIKÓW. Potraktowane jako zero
      zamieniłyby całą historię wyszukiwań w listę braków.                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-anl-")), "t.db");
process.env.STREFA_CZASU = "Europe/Warsaw";

let db: typeof import("../db/db.js").db;
let A: typeof import("./raporty.js");
let dataLokalna: typeof import("../czas.js").dataLokalna;

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./raporty.js");
  ({ dataLokalna } = await import("../czas.js"));
});

beforeEach(() => {
  const d = db();
  for (const t of ["events", "problem", "delivery_line", "delivery", "app_user"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

/** Zdarzenie wstawione wprost — testy agregacji nie udają ruchu aplikacji. */
function zdarzenie(opts: {
  typ: string;
  czas?: string;
  payload?: unknown;
  userRef?: number | null;
  device?: string | null;
}): void {
  db()
    .prepare(
      `INSERT INTO events(type, tw_id, payload, user_id, device_id, user_ref, created_at)
       VALUES (?, NULL, ?, 'test', ?, ?, ?)`
    )
    .run(
      opts.typ,
      opts.payload != null ? JSON.stringify(opts.payload) : null,
      opts.device ?? null,
      opts.userRef ?? null,
      opts.czas ?? new Date().toISOString()
    );
}

const przedGodzinami = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

// ── Oś czasu ────────────────────────────────────────────────────────────────

test("zdarzenie z późnego wieczora UTC ląduje w NASTĘPNYM dniu lokalnym", () => {
  /* 23:30 UTC = 00:30 lub 01:30 czasu polskiego następnego dnia. Test stawia
     zdarzenie o 23:30 UTC wczoraj i sprawdza, że bucket to DZISIEJSZA data
     lokalna — dokładnie to psuje `date(created_at)` w SQL. */
  const wczorajWieczoremUtc = new Date();
  wczorajWieczoremUtc.setUTCDate(wczorajWieczoremUtc.getUTCDate() - 1);
  wczorajWieczoremUtc.setUTCHours(23, 30, 0, 0);
  zdarzenie({ typ: "putaway_line_done", czas: wczorajWieczoremUtc.toISOString() });

  const a = A.analiza(7);
  const zPozycja = a.dni.filter((d) => d.pozycje > 0);
  assert.equal(zPozycja.length, 1);
  assert.equal(
    zPozycja[0].data,
    dataLokalna(wczorajWieczoremUtc.toISOString()),
    "bucket ma być dniem LOKALNYM zdarzenia, nie dobą UTC"
  );
});

test("dni bez zdarzeń są na osi z zerami, nie znikają", () => {
  zdarzenie({ typ: "putaway_line_done", czas: przedGodzinami(1) });
  const a = A.analiza(7);
  assert.equal(a.dni.length, 7, "wykres z dziurami czyta się jako błąd danych");
  assert.equal(a.dni.reduce((s, d) => s + d.pozycje, 0), 1);
});

test("rozłożenie linii to JEDNA pozycja, choć emituje dwa zdarzenia", () => {
  // ta sama czynność człowieka: putaway_line_done + location_set(zrodlo=putaway)
  zdarzenie({ typ: "putaway_line_done", czas: przedGodzinami(2) });
  zdarzenie({ typ: "location_set", czas: przedGodzinami(2), payload: { zrodlo: "putaway" } });
  // zmiana z karty liczy się normalnie
  zdarzenie({ typ: "location_set", czas: przedGodzinami(3), payload: { zrodlo: "karta" } });

  const a = A.analiza(7);
  assert.equal(a.dni.reduce((s, d) => s + d.pozycje, 0), 2, "dubel zawyżałby pracę całej hali");
});

test("rozkład godzin liczy operacje PRACY, nie każde zdarzenie", () => {
  zdarzenie({ typ: "putaway_line_done", czas: przedGodzinami(1) });
  zdarzenie({ typ: "search", czas: przedGodzinami(1), payload: { q: "x" } });
  const a = A.analiza(7);
  assert.equal(a.godziny.reduce((s, n) => s + n, 0), 1, "search nie jest pracą przy regale");
});

// ── Wyszukiwania ────────────────────────────────────────────────────────────

test("zapytania zliczają się bez rozróżniania wielkości liter", () => {
  zdarzenie({ typ: "search", payload: { q: "Gaznik", wynikow: 5 } });
  zdarzenie({ typ: "search", payload: { q: "gaznik", wynikow: 5 } });
  const a = A.analiza(7);
  assert.deepEqual(a.szukania.top.map((t) => ({ q: t.q, ile: t.ile })), [{ q: "gaznik", ile: 2 }]);
});

test("stare zdarzenia bez liczby wyników NIE trafiają do listy braków", () => {
  /* Zdarzenia sprzed 0.48.0 niosą samo `q`. Brak pola to „nieznane" —
     potraktowany jako zero zrobiłby z całej historii listę braków. */
  zdarzenie({ typ: "search", payload: { q: "stare zapytanie" } });
  zdarzenie({ typ: "search", payload: { q: "brakujacy towar", wynikow: 0 } });
  zdarzenie({ typ: "search", payload: { q: "znaleziony", wynikow: 3 } });

  const a = A.analiza(7);
  assert.deepEqual(a.szukania.bezWynikow.map((t) => ({ q: t.q, ile: t.ile })), [{ q: "brakujacy towar", ile: 1 }]);
  assert.equal(a.szukania.top.length, 3, "do topu wchodzą wszystkie, także stare");
});

// ── Rytm magazynu ───────────────────────────────────────────────────────────

test("mediana czasu dostawy liczy się z zamkniętych, brak próbki to null", () => {
  const d = db();
  const wstaw = d.prepare(
    `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, closed_at)
     VALUES (?, ?, 'done', ?, ?)`
  );
  wstaw.run(1, "FZ 1", przedGodzinami(5), przedGodzinami(4)); // 60 min
  wstaw.run(2, "FZ 2", przedGodzinami(3), przedGodzinami(1)); // 120 min
  const a = A.analiza(7);
  assert.equal(a.rytm.dostawZamknietych, 2);
  assert.equal(a.rytm.medianaMinutDostawy, 90);

  d.prepare("DELETE FROM delivery").run();
  assert.equal(A.analiza(7).rytm.medianaMinutDostawy, null, "brak danych to null, nie zero");
});

test("problemy: zgłoszone i rozwiązane w oknie, otwarte jako stan", () => {
  const d = db();
  d.prepare(
    "INSERT INTO problem(typ, created_at, resolved_at) VALUES ('damaged', ?, NULL)"
  ).run(przedGodzinami(2));
  d.prepare(
    "INSERT INTO problem(typ, created_at, resolved_at) VALUES ('damaged', ?, ?)"
  ).run(przedGodzinami(300), przedGodzinami(1)); // zgłoszony DAWNO, rozwiązany dziś
  const a = A.analiza(7);
  assert.equal(a.rytm.problemyZgloszone, 1, "stare zgłoszenie nie wchodzi do okna");
  assert.equal(a.rytm.problemyRozwiazane, 1, "rozwiązanie liczy się po dacie rozwiązania");
  assert.equal(a.rytm.problemyOtwarte, 1, "otwarte to stan całości, nie okna");
});

// ── Urządzenia ──────────────────────────────────────────────────────────────

test("zdrowie sprzętu grupuje po urządzeniu", () => {
  zdarzenie({ typ: "device_drop", device: "TC21-01" });
  zdarzenie({ typ: "device_drop", device: "TC21-01" });
  zdarzenie({ typ: "battery_low", device: "TC21-02" });
  zdarzenie({ typ: "klient_odrzucona", device: "TC21-02" });
  const a = A.analiza(7);
  const m = new Map(a.urzadzenia.map((u) => [u.device, u]));
  assert.equal(m.get("TC21-01")?.upadki, 2);
  assert.equal(m.get("TC21-02")?.odrzucone, 1);
  assert.equal(m.get("TC21-02")?.niskieBaterie, 1);
});

// ── Pomocnicze ──────────────────────────────────────────────────────────────

test("mediana: środek, para i pustka", () => {
  assert.equal(A.mediana([3, 1, 2]), 2);
  assert.equal(A.mediana([1, 2, 3, 4]), 2.5);
  assert.equal(A.mediana([]), null);
});

test("pusta baza daje puste struktury, nie wyjątek", () => {
  const a = A.analiza(7);
  assert.equal(a.dni.length, 7);
  assert.equal(a.godziny.length, 24);
  assert.deepEqual(a.szukania.top, []);
  assert.deepEqual(a.urzadzenia, []);
  assert.equal(a.wydajnosc.wiersze.length, 0);
});
