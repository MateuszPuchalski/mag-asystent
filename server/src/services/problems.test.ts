import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Wyjątki przy dostawie ──────────────────────────────────────────────────
   Zgłoszenie wyjątku to jedyne miejsce, w którym magazynier mówi „tego nie da
   się zrobić po rutynie", i jedyne źródło reklamacji u dostawcy. Do tej pory
   nie miało ani jednego testu po stronie serwera — walidacje żyły w dwóch
   kopiach (tu i w `core/problem/ProblemModel.kt`), a pilnowała ich tylko ta
   kotlinowa.

   Ten plik pilnuje strony SERWERA, i to jest jego cały powód: reguły kolektora
   są uprzejmością wobec człowieka w alejce, a nie zabezpieczeniem. Kolektor
   z pominiętą walidacją, stary APK albo `curl` z sieci hali trafia wprost tutaj. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-prob-")), "t.db");

let db: typeof import("../db/db.js").db;
let nowIso: typeof import("../db/db.js").nowIso;
let P: typeof import("./problems.js");

before(async () => {
  ({ db, nowIso } = await import("../db/db.js"));
  P = await import("./problems.js");
});

let deliveryId = 0;
let lineId = 0;

beforeEach(() => {
  for (const t of ["events", "problem", "delivery_line", "delivery"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
  deliveryId = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, opened_at)
         VALUES (4711,'FZ 4711/2026','FALON-TECH','2026-08-01',?)`
      )
      .run(nowIso()).lastInsertRowid
  );
  lineId = Number(
    db()
      .prepare(
        `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok)
         VALUES (?,1,'W32-0401','Zestaw podkładek',5)`
      )
      .run(deliveryId).lastInsertRowid
  );
});

/** Najmniejszy poprawny PNG w base64 — treść zdjęcia nie ma tu znaczenia. */
const ZDJECIE =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const zglos = (wejscie: Partial<Parameters<typeof P.raiseProblem>[0]>) =>
  P.raiseProblem({ deliveryId, typ: "no_space", ...wejscie } as never, "Jan Kowalski");

const status = (id: number) =>
  (db().prepare("SELECT status FROM delivery_line WHERE id=?").get(id) as { status: string }).status;

/* ── Słownik typów ───────────────────────────────────────────────────────── */

test("każdy typ ma etykietę, a nieznany pokazuje się surowo", () => {
  /* Etykieta jedzie z serwera w `typLabel`, bo podgląd biura drukuje ją na
     protokole dla dostawcy. Typ bez etykiety wyszedłby tam jako `qty_short`
     i nikt by tego nie zauważył przed wysłaniem. */
  for (const typ of P.PROBLEM_TYPES) {
    assert.notEqual(P.etykietaTypu(typ), typ, typ);
  }
  assert.equal(P.etykietaTypu("cos_nowego"), "cos_nowego");
});

test("lista typów zgadza się z kolektorem", () => {
  // lustro `ProblemType.entries` z `core/problem/ProblemModel.kt`; rozjazd
  // kończy się 400 w alejce, przy palecie, z ręką w rękawicy
  assert.deepEqual(P.PROBLEM_TYPES, [
    "qty_short",
    "qty_over",
    "damaged",
    "wrong_item",
    "no_space",
    "unknown_barcode",
    "ean_conflict",
  ]);
});

test("widok wyjątku niesie etykietę, nie sam klucz", () => {
  zglos({ typ: "damaged", lineId, photoBase64: ZDJECIE });
  assert.equal(P.listUnresolved()[0].typLabel, "Uszkodzony");
});

/* ── Walidacje ───────────────────────────────────────────────────────────── */

test("zgłoszenie bez wymaganego zdjęcia odpada, i to na SERWERZE", () => {
  // bez dowodu to opinia, a nie zgłoszenie — a reguła kolektora jest tylko
  // uprzejmością wobec człowieka, nie bramką
  for (const typ of ["damaged", "wrong_item", "unknown_barcode"]) {
    const r = zglos({ typ, lineId });
    assert.ok("error" in r, typ);
    assert.match((r as { error: string }).error, /zdj/i);
  }
  assert.equal(P.listUnresolved().length, 0, "nic nie wpadło do bazy");
});

test("zgłoszenie bez ilości faktycznej odpada przy typach ilościowych", () => {
  for (const typ of ["qty_short", "qty_over"]) {
    assert.ok("error" in zglos({ typ, lineId }), typ);
    assert.ok("error" in zglos({ typ, lineId, qty: Number.NaN }), `${typ} + NaN`);
  }
  // zero jest poprawną ilością: „naliczono 0 sztuk" to najczęstszy brak
  assert.ok("id" in zglos({ typ: "qty_short", lineId, qty: 0 }));
});

test("nieznany typ nie zapisuje się jako wyjątek", () => {
  // lista typów jest ZAMKNIĘTA: otwarte pole daje dane, których nikt nie policzy
  const r = zglos({ typ: "zepsute_cos", lineId });
  assert.ok("error" in r);
  assert.match((r as { error: string }).error, /Nieznany typ/);
  assert.equal(P.listUnresolved().length, 0);
});

test("zdjęcie ląduje na dysku, a w bazie zostaje sama nazwa pliku", () => {
  const r = zglos({ typ: "damaged", lineId, photoBase64: ZDJECIE });
  assert.ok("id" in r);
  const p = P.listByDelivery(deliveryId)[0];
  assert.equal(p.hasPhoto, true);
  const ref = P.photoRefOf(p.id)!;
  assert.ok(!ref.includes("/"), "referencja to nazwa pliku, nie ścieżka");
  assert.ok(P.photoPath(ref), "plik istnieje na dysku");
});

/* ── Skutek dla dostawy ──────────────────────────────────────────────────── */

test("zgłoszenie wyjmuje linię z rutyny, ale nie blokuje reszty dostawy", () => {
  assert.ok("id" in zglos({ typ: "no_space", lineId }));
  assert.equal(status(lineId), "problem");
  // wyjątek żyje dalej na liście nierozwiązanych — domknięcie dostawy go nie
  // zamiata, bo inaczej zgłoszenie problemu karałoby zgłaszającego
  assert.equal(P.listUnresolved().length, 1);
});

test("wyjątek bez linii jest zapisywany, choć nie ma czego wyjąć z rutyny", () => {
  // skan nieznanego kodu przy palecie: towaru nie ma na dokumencie
  const r = zglos({ typ: "unknown_barcode", photoBase64: ZDJECIE });
  assert.ok("id" in r);
  assert.equal(status(lineId), "todo", "cudza linia nietknięta");
});

/* ── Rozwiązywanie ───────────────────────────────────────────────────────── */

test("rozwiązanie wyjątku drugi raz to odmowa, nie cicha zmiana notatki", () => {
  const { id } = zglos({ typ: "no_space", lineId }) as { id: number };
  assert.deepEqual(P.resolveProblem(id, "reklamacja 12/2026", "Biuro"), { ok: true });
  const drugie = P.resolveProblem(id, "coś innego", "Biuro");
  assert.ok("error" in drugie);
  assert.equal(P.listByDelivery(deliveryId)[0].resolvedNote, "reklamacja 12/2026");
});

test("rozwiązany wyjątek znika z listy nierozwiązanych, ale zostaje w dostawie", () => {
  const { id } = zglos({ typ: "no_space", lineId }) as { id: number };
  P.resolveProblem(id, undefined, "Biuro");
  assert.equal(P.listUnresolved().length, 0);
  assert.equal(P.listByDelivery(deliveryId).length, 1, "historia dostawy nie gubi wyjątków");
});

/* ── CSV do reklamacji ───────────────────────────────────────────────────── */

test("CSV ma BOM i średnik — Excel PL otwiera go bez kreatora importu", () => {
  zglos({ typ: "qty_short", lineId, qty: 3 });
  const csv = P.exportCsv(deliveryId);
  assert.ok(csv.startsWith("﻿"), "bez BOM Excel rozjeżdża polskie znaki");
  const [naglowek, wiersz] = csv.slice(1).split("\r\n");
  assert.equal(naglowek.split(";").length, 12);
  assert.equal(wiersz.split(";")[1], "FZ 4711/2026", "numer dokumentu z dostawy");
  assert.equal(wiersz.split(";")[2], "W32-0401", "symbol z linii");
});

test("średnik i cudzysłów w opisie nie rozwalają kolumn", () => {
  // opis pisze człowiek na kolektorze — prędzej czy później wpisze średnik
  zglos({ typ: "no_space", lineId, opis: 'karton 2; napis "UWAGA"' });
  const wiersz = P.exportCsv(deliveryId).slice(1).split("\r\n")[1];
  assert.match(wiersz, /"karton 2; napis ""UWAGA"""/);
  assert.equal(wiersz.split('"')[0].split(";").length, 7, "kolumny przed opisem bez zmian");
});
