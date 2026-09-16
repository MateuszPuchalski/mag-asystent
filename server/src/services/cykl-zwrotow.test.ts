import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Raport cyklu zwrotu ─────────────────────────────────────────────────────
   Raport o czasie pracy ma wadę groźniejszą niż brak: liczbę zmyśloną. Cztery
   rzeczy pilnowane tutaj są dokładnie tymi, na których łatwo ją wyprodukować:

   1. ZSZYCIE DWÓCH KOSZY. Karton nosi dwa imiona — koszyk „Z-7" z panelu
      i kosz „1209" z jego dokumentu. Liczone osobno, odcinek „czekanie hali"
      nie istnieje w żadnym z nich, bo pierwszy nie ma odłożeń, a drugi
      zamknięcia.
   2. BRAK DANYCH TO NIE ZERO. Karton bez zamknięcia nie wchodzi do mediany
      odcinka, zamiast wchodzić jako „zero minut".
   3. USZKODZONY PAYLOAD NIE ZABIERA RAPORTU. Jeden ucięty JSON kładł kiedyś
      całe `/api/metrics` (0.31.x) — tu ma zostać pominięty wiersz, nie raport.
   4. TEMPO LICZY SIĘ Z PRZEJŚĆ, nie z pozycji. Karton jednopozycyjny nie ma
      odstępu, więc nie ma prawa zaniżać sekund na pozycję.                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-cykl-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let C: typeof import("./cykl-zwrotow.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  C = await import("./cykl-zwrotow.js");
});

beforeEach(() => {
  for (const t of ["events", "kosz_pozycja", "kosz", "sfera_queue"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/* JEDNA baza czasu na cały plik, nie `Date.now()` przy każdym wywołaniu:
   odstępy są tu treścią testu, a dwa wywołania zegara różnią się o milisekundy
   i zamieniają równe 60 minut w 60,000017. */
const BAZA = Date.now();
const T = (minut: number): string => new Date(BAZA - 60_000 * minut).toISOString();

const odcinek = (r: ReturnType<typeof C.cyklZwrotow>, nazwa: string) =>
  r.odcinki.find((o) => o.nazwa === nazwa)!;

/** Zadanie MM w kolejce: kiedy je zamówiono i kiedy dokument wszedł. */
function zadanieMm(zamowione: string, wSubiekcie: string | null, numer: string): number {
  return Number(db().prepare(
    `INSERT INTO sfera_queue(type, status, payload, sgt_doc_number, created_at, processed_at,
                             created_by)
     VALUES ('mm', ?, '{}', ?, ?, ?, 'Biuro')`)
    .run(wSubiekcie ? "done" : "pending", numer, zamowione, wSubiekcie)
    .lastInsertRowid);
}

/** Koszyk z panelu: powstaje, zapełnia się, zostaje zamknięty. */
function koszyk(kod: string, powstal: string, zamkniety: string | null, mmQueueId: number | null) {
  return Number(db().prepare(
    `INSERT INTO kosz(kod, status, rodzaj, mm_queue_id, utworzono_at, utworzono_przez,
                      zamknieto_at, zamknieto_przez)
     VALUES (?, ?, 'zwroty', ?, ?, 'Biuro', ?, 'Biuro')`)
    .run(kod, zamkniety ? "zamkniety" : "otwarty", mmQueueId, powstal, zamkniety)
    .lastInsertRowid);
}

/**
 * Kosz z dokumentu MM — ten, który hala naprawdę rozkłada.
 *
 * `status` bierze się z zewnątrz, bo kod kosza jest unikalny WYŁĄCZNIE wśród
 * nierozłożonych (`ix_kosz_kod_aktywny`). Zeszłoroczny kosz o tym samym
 * numerze musi więc być rozłożony — i tak też wygląda na produkcji.
 */
function koszHali(
  kod: string, otwarty: string, powrotQueueId: number | null, status = "zamkniety",
) {
  return Number(db().prepare(
    `INSERT INTO kosz(kod, status, rodzaj, mm_dok_id, mm_numer, powrot_queue_id,
                      utworzono_at, utworzono_przez, zamknieto_at, zamknieto_przez)
     VALUES (?, ?, 'zwroty', 41209, ?, ?, ?, 'Hala', ?, 'Hala')`)
    .run(kod, status, kod, powrotQueueId, otwarty, otwarty).lastInsertRowid);
}

function odlozenie(koszId: number, at: string, opts: { wpis?: boolean; rozjazd?: boolean } = {}) {
  db().prepare("INSERT INTO events(type, payload, user_id, created_at) VALUES (?,?,?,?)")
    .run("kosz_putaway", JSON.stringify({
      koszId, location: "A01-02-03",
      expected: opts.rozjazd ? "B05-01-01" : "A01-02-03",
      potwierdzenie: opts.wpis ? "wpis" : "polka",
    }), "Hala", at);
}

test("odcinki liczą się ze znaczników, które w bazie już są", () => {
  /* Pełna droga jednego kartonu, rozpisana na dwa kosze — tak wygląda dziś
     produkcja: panel napełnia „Z-7", hala rozkłada kosz z dokumentu „1209". */
  const q = zadanieMm(T(500), T(495), "MM 1209/MAG/2026");
  const panel = koszyk("Z-7", T(600), T(540), q);
  const powrot = Number(db().prepare(
    `INSERT INTO sfera_queue(type, status, payload, created_at, created_by)
     VALUES ('mm', 'pending', '{}', ?, 'automat')`).run(T(470)).lastInsertRowid);
  const hala = koszHali("1209", T(490), powrot);
  odlozenie(hala, T(485));
  odlozenie(hala, T(483), { wpis: true, rozjazd: true });

  const r = C.cyklZwrotow(90);
  assert.equal(r.kartonow, 1, "dwa kosze to JEDEN karton");
  assert.equal(r.sprawy[0].koszId, panel);
  assert.equal(r.sprawy[0].kodHali, "1209");

  assert.equal(odcinek(r, "napełnianie").medianaMin, 60);
  assert.equal(odcinek(r, "korekty").medianaMin, 40, "zamknięcie → zamówienie MM");
  assert.equal(odcinek(r, "dokument").medianaMin, 5, "zamówienie MM → dokument w Subiekcie");
  assert.equal(odcinek(r, "czekanie hali").medianaMin, 55, "zamknięcie → pierwsze odłożenie");
  assert.equal(odcinek(r, "rozkładanie").medianaMin, 2);
  assert.equal(odcinek(r, "domknięcie").medianaMin, 13);
  assert.equal(odcinek(r, "cały cykl").medianaMin, 70);

  assert.equal(r.odlozen, 2);
  assert.equal(r.wpisow, 1, "adres z klawiatury to miara etykiet, nie człowieka");
  assert.equal(r.rozjazdow, 1);
  assert.equal(r.sekundNaPozycje, 120, "jedno przejście o długości dwóch minut");
});

test("kosz hali dobiera się po zamknięciu koszyka, nie po samym kodzie", () => {
  /* Kod kosza wraca do obiegu po rozłożeniu, a numery MM powtarzają się co rok.
     Bez warunku „otwarty PO zamknięciu" raport skleiłby zeszłoroczny karton
     z dzisiejszym i pokazał czekanie hali liczone w miesiącach. */
  const q = zadanieMm(T(500), T(495), "MM 1209/MAG/2026");
  koszyk("Z-7", T(600), T(540), q);
  const stary = koszHali("1209", T(4000), null, "rozlozony");
  odlozenie(stary, T(3999));
  const nowy = koszHali("1209", T(490), null);
  odlozenie(nowy, T(485));

  const r = C.cyklZwrotow(90);
  assert.equal(r.sprawy[0].koszHaliId, nowy);
  assert.equal(odcinek(r, "czekanie hali").medianaMin, 55);
  assert.equal(r.odlozen, 1, "odłożenia starego kosza nie należą do tego kartonu");
});

test("koszyk bez zamknięcia nie wchodzi do mediany jako zero", () => {
  /* Blizna do uniknięcia: koszyk otwarty albo zamknięty przed oknem raportu
     nie ma początku odcinka. Gdyby brak liczył się jako zero, „czekanie hali"
     spadłoby właśnie przy kartonach, które czekały najdłużej. */
  const q = zadanieMm(T(500), T(495), "MM 1209/MAG/2026");
  koszyk("Z-7", T(600), T(540), q);
  const hala = koszHali("1209", T(490), null);
  odlozenie(hala, T(485));
  koszyk("Z-8", T(300), null, null);

  const r = C.cyklZwrotow(90);
  assert.equal(r.kartonow, 2, "koszyk otwarty jest w raporcie…");
  assert.equal(odcinek(r, "czekanie hali").probka, 1, "…ale nie w próbce odcinka");
  assert.equal(odcinek(r, "czekanie hali").medianaMin, 55);
});

test("uszkodzony payload pomija WIERSZ, nie raport", () => {
  /* Dokładnie ten wiersz kładł kiedyś metryki i analizę: `json_extract`
     w SQLite nie zwraca NULL na złym JSON-ie, tylko wywala zapytanie. */
  const q = zadanieMm(T(500), T(495), "MM 1209/MAG/2026");
  koszyk("Z-7", T(600), T(540), q);
  const hala = koszHali("1209", T(490), null);
  odlozenie(hala, T(485));
  db().prepare("INSERT INTO events(type, payload, user_id, created_at) VALUES (?,?,?,?)")
    .run("kosz_putaway", "{ucięty payload", "Hala", T(484));

  const r = C.cyklZwrotow(90);
  assert.equal(r.kartonow, 1);
  assert.equal(r.odlozen, 1, "wiersza nie do odczytania nie liczymy, reszta zostaje");
});

test("odcinek bez próbki oddaje null, a nie zero", () => {
  koszyk("Z-9", T(200), T(100), null);
  const r = C.cyklZwrotow(90);
  assert.equal(odcinek(r, "czekanie hali").medianaMin, null);
  assert.equal(odcinek(r, "czekanie hali").probka, 0);
  assert.equal(C.poLudzku(null), "brak danych");
  assert.equal(r.sekundNaPozycje, null, "bez odłożeń nie ma tempa");
});

test("mediana, nie średnia — jeden karton przez weekend nie zamazuje reszty", () => {
  for (let i = 1; i <= 3; i++) {
    const q = zadanieMm(T(500 + i), T(495 + i), `MM 120${i}/MAG/2026`);
    koszyk(`Z-${i}`, T(600 + i), T(540 + i), q);
    const hala = koszHali(`120${i}`, T(490 + i), null);
    odlozenie(hala, T(485 + i));
  }
  /* Czwarty czekał na halę trzy doby. Średnia powiedziałaby „18 h", mediana
     mówi to samo co o trzech pozostałych. */
  const q4 = zadanieMm(T(5000), T(4999), "MM 1204/MAG/2026");
  koszyk("Z-4", T(5100), T(5000), q4);
  const hala4 = koszHali("1204", T(700), null);
  odlozenie(hala4, T(680));

  const r = C.cyklZwrotow(90);
  assert.equal(odcinek(r, "czekanie hali").medianaMin, 55);
  assert.equal(odcinek(r, "czekanie hali").najdluzszyMin, 4320,
    "ogon zostaje widoczny w osobnej kolumnie");
  assert.equal(odcinek(r, "czekanie hali").probka, 4);
});

test("zdarzenia nie po kolei nie produkują ujemnego czasu", () => {
  /* Cofnięcie zakończenia i ponowne rozłożenie potrafi ustawić powrót PRZED
     ostatnim odłożeniem. „Minus dwie godziny" nie jest czasem pracy. */
  const powrot = Number(db().prepare(
    `INSERT INTO sfera_queue(type, status, payload, created_at, created_by)
     VALUES ('mm', 'pending', '{}', ?, 'automat')`).run(T(90)).lastInsertRowid);
  const q = zadanieMm(T(500), T(495), "MM 1209/MAG/2026");
  koszyk("Z-7", T(600), T(100), q);
  const hala = koszHali("1209", T(99), powrot);
  odlozenie(hala, T(50));

  const r = C.cyklZwrotow(90);
  assert.equal(odcinek(r, "domknięcie").probka, 0, "powrót przed odłożeniem nie jest odcinkiem");
  assert.equal(odcinek(r, "cały cykl").medianaMin, 10);
});
