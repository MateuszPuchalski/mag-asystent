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
let getDelivery: typeof import("./delivery.js").getDelivery;

before(async () => {
  ({ db, nowIso } = await import("../db/db.js"));
  P = await import("./problems.js");
  ({ getDelivery } = await import("./delivery.js"));
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
  P.raiseProblem({ deliveryId, typ: "missing_item", ...wejscie } as never, "Jan Kowalski");

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

test("lista kategorii zgadza się z formularzem i z kolektorem", () => {
  // lustro `ProblemType.entries` z `core/problem/ProblemModel.kt` ORAZ pięciu
  // checkboxów formularza; rozjazd kończy się 400 w alejce, przy palecie
  assert.deepEqual(P.PROBLEM_TYPES, [
    "wrong_item",
    "missing_item",
    "damaged",
    "qty_mismatch",
    "extra_item",
  ]);
});

test("klucz sprzed 0.21.0 nie zapisuje się, ale nadal ma nazwę", () => {
  /* Okno wdrożenia APK 0.21.0 zamknęło się w 0.26.0: stare klucze wypadły
     z listy zapisywalnych. Etykieta zostaje — wyjątki z historii muszą mieć
     nazwę na protokole dla dostawcy. */
  assert.ok("error" in zglos({ typ: "qty_short", lineId, qty: 3 }));
  assert.equal(P.etykietaTypu("qty_short"), "Za mało");
  assert.ok(!P.PROBLEM_TYPES.includes("qty_short" as never));
});

test("widok wyjątku niesie etykietę, nie sam klucz", () => {
  zglos({ typ: "damaged", lineId, qty: 1, photoBase64: ZDJECIE });
  assert.equal(P.listUnresolved()[0].typLabel, "Uszkodzone w transporcie");
});

/* ── Walidacje ───────────────────────────────────────────────────────────── */

test("zgłoszenie bez wymaganego zdjęcia odpada, i to na SERWERZE", () => {
  // bez dowodu to opinia, a nie zgłoszenie — a reguła kolektora jest tylko
  // uprzejmością wobec człowieka, nie bramką
  for (const typ of ["damaged", "wrong_item"]) {
    const r = zglos({ typ, lineId, qty: 1, symObcy: "OBCY-1" });
    assert.ok("error" in r, typ);
    assert.match((r as { error: string }).error, /zdj/i);
  }
  assert.equal(P.listUnresolved().length, 0, "nic nie wpadło do bazy");
});

test("każda kategoria formularza wymaga ilości", () => {
  // formularz żąda jej we wszystkich pięciu blokach
  for (const typ of P.PROBLEM_TYPES) {
    const r = zglos({ typ, lineId, symObcy: "OBCY-1", photoBase64: ZDJECIE });
    assert.ok("error" in r, typ);
    assert.match((r as { error: string }).error, /ilo/i, typ);
  }
  // zero jest poprawną ilością: „naliczono 0 sztuk" to najczęstszy brak
  assert.ok("id" in zglos({ typ: "missing_item", lineId, qty: 0 }));
});

test("artykuł spoza dokumentu wymaga numeru katalogowego", () => {
  /* `wrong_item` i `extra_item` opisują towar, którego na fakturze NIE MA —
     nie ma więc linii, z której dałoby się odczytać symbol. Do 0.21.0 takiego
     towaru nie dało się zgłosić w ogóle: skan kończył się toastem. */
  for (const typ of ["wrong_item", "extra_item"]) {
    const r = zglos({ typ, qty: 2, photoBase64: ZDJECIE });
    assert.ok("error" in r, typ);
    assert.match((r as { error: string }).error, /numer katalogowy/i, typ);
  }
  assert.ok("id" in zglos({ typ: "extra_item", qty: 2, symObcy: "  FT-991  " }));
  assert.equal(P.listUnresolved()[0].symObcy, "FT-991", "przycięty, ale zapisany");
});

test("zła ilość bez pozycji z dokumentu odpada", () => {
  // „dostarczono złą ilość ZAMÓWIONEGO artykułu" — bez linii nie ma z czym
  // porównać, a formularz chce obu liczb
  const r = zglos({ typ: "qty_mismatch", qty: 2 });
  assert.ok("error" in r);
  assert.match((r as { error: string }).error, /dokument/i);
});

/* ── Zakres kategorii (0.57.0) ────────────────────────────────────────────────
   Reguła działa w OBIE strony i to jest tu sedno. Do 0.57.0 stała tylko jej
   połowa, i tylko dla „złej ilości" — więc „artykuł niezamówiony", z definicji
   towar SPOZA dokumentu, dawało się przypiąć do dowolnej pozycji faktury
   i ustawić jej status `problem`.                                            */

test("każda kategoria pozycji odpada bez wskazanej pozycji", () => {
  for (const typ of ["qty_mismatch", "missing_item", "damaged", "wrong_item"] as const) {
    const r = zglos({ typ, qty: 1, photoBase64: "x", symObcy: "K-1", zamiastIlosc: 1 });
    assert.ok("error" in r, `${typ} przeszło bez pozycji`);
    assert.match((r as { error: string }).error, /pozycj/i, `${typ}: odmowa ma nazwać powód`);
  }
});

test("artykuł niezamówiony odpada, gdy ktoś przypnie go do pozycji", () => {
  const r = zglos({ typ: "extra_item", lineId, qty: 1, symObcy: "K-1099" });
  assert.ok("error" in r, "kategoria dostawy przeszła na pozycji");
  assert.match((r as { error: string }).error, /dostaw/i);

  // ta sama kategoria BEZ pozycji przechodzi — i nie rusza żadnej linii
  const ok = zglos({ typ: "extra_item", qty: 1, symObcy: "K-1099" });
  assert.ok(!("error" in ok), JSON.stringify(ok));
  assert.notEqual(status(lineId), "problem", "zgłoszenie dostawy nie tyka pozycji");
});

test("ilość z dokumentu zapisuje się jako snapshot, nie odczyt na żywo", () => {
  /* Fakturę w Subiekcie da się poprawić po zgłoszeniu. Protokół dla dostawcy
     ma pokazywać, co widzieliśmy przy palecie, a nie stan po korekcie. */
  zglos({ typ: "qty_mismatch", lineId, qty: 3 });
  db().prepare("UPDATE delivery_line SET ilosc_dok = 99 WHERE id = ?").run(lineId);
  assert.equal(P.listUnresolved()[0].qtyDok, 5, "5 sztuk widziane w chwili zgłoszenia");
});

test("błędny artykuł niesie oba artykuły naraz", () => {
  // formularz pyta o to, co przyszło (wymagane), i o to, co miało przyjść
  const r = zglos({
    typ: "wrong_item",
    lineId,
    qty: 2,
    symObcy: "FT-777",
    zamiastIlosc: 5,
    photoBase64: ZDJECIE,
  });
  assert.ok("id" in r);
  const p = P.listUnresolved()[0];
  assert.equal(p.symObcy, "FT-777", "co przyszło");
  assert.equal(p.sym, "W32-0401", "a co miało przyjść — z linii dokumentu");
  assert.equal(p.zamiastIlosc, 5);
});

test("nieznany typ nie zapisuje się jako wyjątek", () => {
  // lista typów jest ZAMKNIĘTA: otwarte pole daje dane, których nikt nie policzy
  const r = zglos({ typ: "zepsute_cos", lineId });
  assert.ok("error" in r);
  assert.match((r as { error: string }).error, /Nieznany typ/);
  assert.equal(P.listUnresolved().length, 0);
});

test("zdjęcie ląduje na dysku, a w bazie zostaje sama nazwa pliku", () => {
  const r = zglos({ typ: "damaged", lineId, qty: 1, photoBase64: ZDJECIE });
  assert.ok("id" in r);
  const p = P.listByDelivery(deliveryId)[0];
  assert.equal(p.hasPhoto, true);
  const ref = P.photoRefOf(p.id)!;
  assert.ok(!ref.includes("/"), "referencja to nazwa pliku, nie ścieżka");
  assert.ok(P.photoPath(ref), "plik istnieje na dysku");
});

/* ── Skutek dla dostawy ──────────────────────────────────────────────────── */

test("zgłoszenie wyjmuje linię z rutyny, ale nie blokuje reszty dostawy", () => {
  assert.ok("id" in zglos({ typ: "missing_item", lineId, qty: 1 }));
  assert.equal(status(lineId), "problem");
  // wyjątek żyje dalej na liście nierozwiązanych — domknięcie dostawy go nie
  // zamiata, bo inaczej zgłoszenie problemu karałoby zgłaszającego
  assert.equal(P.listUnresolved().length, 1);
});

test("nieistniejąca pozycja to odmowa, nie błąd bazy", () => {
  /* Klucz obcy odpowiedziałby 500 „FOREIGN KEY constraint failed" — zdanie
     o bazie, nie o zgłoszeniu. Kolektor wysyła id z widoku, ale to walidacja
     serwera decyduje, co jest zdaniem dla człowieka. */
  const r = P.raiseProblem({ deliveryId, lineId: 999999, typ: "missing_item", qty: 1 }, "Jan");
  assert.ok("error" in r);
  assert.match(r.error, /pozycji/);
});

test("wyjątek bez linii jest zapisywany, choć nie ma czego wyjąć z rutyny", () => {
  // artykuł niezamówiony: przyjechał obok wszystkiego, co miało przyjść
  const r = zglos({ typ: "extra_item", qty: 4, symObcy: "FT-991" });
  assert.ok("id" in r);
  assert.equal(status(lineId), "todo", "cudza linia nietknięta");
});

/* ── Przesyłka ───────────────────────────────────────────────────────────── */

test("numer przesyłki należy do dostawy, nie do zgłoszenia", () => {
  /* Wpisany przy każdym uszkodzonym artykule z osobna mógłby się różnić,
     a to jedna paczka. Dwa zgłoszenia widzą ten sam numer. */
  assert.deepEqual(P.zapiszPrzesylke(deliveryId, "  00159876543  ", "tak", "Jan"), { ok: true });
  const d = db()
    .prepare("SELECT nr_przesylki, kurier_protokol, przesylka_by FROM delivery WHERE id=?")
    .get(deliveryId) as { nr_przesylki: string; kurier_protokol: string; przesylka_by: string };
  assert.equal(d.nr_przesylki, "00159876543", "przycięty");
  assert.equal(d.kurier_protokol, "tak");
  assert.equal(d.przesylka_by, "Jan", "kto wpisał — to dane od człowieka, nie z importu");
});

test("widok dostawy niesie numer przesyłki, żeby kolektor nie pytał drugi raz", () => {
  /* Pytanie pada RAZ na dostawę. Gdyby widok tego nie niósł, restart aplikacji
     pytałby o numer ponownie przy każdym uszkodzonym artykule. */
  assert.equal(getDelivery(deliveryId)?.nrPrzesylki, null, "przed zapisem: nie pytano");
  P.zapiszPrzesylke(deliveryId, "00159876543", "nie", "Jan");
  const d = getDelivery(deliveryId);
  assert.equal(d?.nrPrzesylki, "00159876543");
  assert.equal(d?.kurierProtokol, "nie");
});

test("odpowiedź o protokole kuriera ma trzy stany, nie dwa", () => {
  // NULL znaczy „nie pytano" i nie wolno go zwinąć do „nie": formularz
  // reklamacyjny jedzie do przewoźnika
  assert.deepEqual(P.zapiszPrzesylke(deliveryId, "123", null, "Jan"), { ok: true });
  assert.ok("error" in P.zapiszPrzesylke(deliveryId, "123", "moze", "Jan"));
  assert.ok("error" in P.zapiszPrzesylke(999999, "123", "tak", "Jan"), "nieistniejąca dostawa");
});

/* ── Rozwiązywanie ───────────────────────────────────────────────────────── */

test("rozwiązanie wyjątku drugi raz to odmowa, nie cicha zmiana notatki", () => {
  const { id } = zglos({ typ: "missing_item", lineId, qty: 1 }) as { id: number };
  assert.deepEqual(P.resolveProblem(id, "reklamacja 12/2026", "Biuro"), { ok: true });
  const drugie = P.resolveProblem(id, "coś innego", "Biuro");
  assert.ok("error" in drugie);
  assert.equal(P.listByDelivery(deliveryId)[0].resolvedNote, "reklamacja 12/2026");
});

test("rozwiązany wyjątek znika z listy nierozwiązanych, ale zostaje w dostawie", () => {
  const { id } = zglos({ typ: "missing_item", lineId, qty: 1 }) as { id: number };
  P.resolveProblem(id, undefined, "Biuro");
  assert.equal(P.listUnresolved().length, 0);
  assert.equal(P.listByDelivery(deliveryId).length, 1, "historia dostawy nie gubi wyjątków");
});

/* ── CSV do reklamacji ───────────────────────────────────────────────────── */

test("CSV ma BOM i średnik — Excel PL otwiera go bez kreatora importu", () => {
  zglos({ typ: "qty_mismatch", lineId, qty: 3 });
  const csv = P.exportCsv(deliveryId);
  assert.ok(csv.startsWith("﻿"), "bez BOM Excel rozjeżdża polskie znaki");
  const [naglowek, wiersz] = csv.slice(1).split("\r\n");
  assert.equal(naglowek.split(";").length, 12);
  assert.equal(wiersz.split(";")[1], "FZ 4711/2026", "numer dokumentu z dostawy");
  assert.equal(wiersz.split(";")[2], "W32-0401", "symbol z linii");
});

test("średnik i cudzysłów w opisie nie rozwalają kolumn", () => {
  // opis pisze człowiek na kolektorze — prędzej czy później wpisze średnik
  zglos({ typ: "missing_item", lineId, qty: 1, opis: 'karton 2; napis "UWAGA"' });
  const wiersz = P.exportCsv(deliveryId).slice(1).split("\r\n")[1];
  assert.match(wiersz, /"karton 2; napis ""UWAGA"""/);
  assert.equal(wiersz.split('"')[0].split(";").length, 7, "kolumny przed opisem bez zmian");
});
