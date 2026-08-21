import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Przyjęcia na regał zwrotów — kosz z dokumentu MM ────────────────────────
   Trzy rzeczy, każda z ceną błędu:

   1. NUMER Z KARTKI otwiera dokument. Magazynier czyta to, co ktoś napisał
      długopisem („1209"), nie identyfikator z bazy.
   2. OTWARCIE JEST IDEMPOTENTNE. Drugi skan tej samej kartki — albo drugi
      kolektor przy tym samym koszu — ma dać TEN SAM kosz, nie drugi.
   3. ZAKOŃCZ NA KOSZU Z DOKUMENTU NIE WYSTAWIA NICZEGO. Przesunięcie zrobiło
      biuro przed przywiezieniem kosza, powrotne zrobi po rozłożeniu; zadanie
      w kolejce znaczyłoby dokument wystawiony drugi raz.                     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-przyj-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let P: typeof import("./przyjecia.js");
let K: typeof import("./kosze.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  P = await import("./przyjecia.js");
  K = await import("./kosze.js");
});

const DOK = 41_209;

beforeEach(() => {
  const d = db();
  for (const t of [
    "kosz_pozycja", "kosz", "przyjecie_pominiete",
    "sgt_mm_zwrot_pozycja", "sgt_mm_zwrot", "sgt_towar", "sfera_queue",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)");
  ins.run(900_036, "TEST-LINIA-TODO", "Pozycja nietknięta", "", "A01-02-03");
  ins.run(900_037, "TEST-LINIA-DONE", "Pozycja odłożona", "5900000000037", "B02-01-01");

  d.prepare(
    `INSERT INTO sgt_mm_zwrot(dok_id, nr_pelny, numer, data_wyst, mag_z, mag_do)
     VALUES (?, 'MM 1209/MAG/2026', '1209', '2026-08-18', 1, 3)`
  ).run(DOK);
  const poz = d.prepare(
    `INSERT INTO sgt_mm_zwrot_pozycja(dok_id, tw_id, ilosc, symbol, nazwa)
     VALUES (?,?,?,?,?)`
  );
  poz.run(DOK, 900_036, 3, "TEST-LINIA-TODO", "Pozycja nietknięta");
  poz.run(DOK, 900_037, 1, "TEST-LINIA-DONE", "Pozycja odłożona");
  /* Towar ZABLOKOWANY w Subiekcie: dokument go niesie, kartoteki nie ma. */
  poz.run(DOK, 900_099, 2, "TEST-WYCOFANY", "Towar wycofany ze sprzedaży");
});

test("numer z kartki: sama liczba, cały numer i śmieci", () => {
  assert.equal(P.numerKosza("MM 1240/MAG/2026"), "1240");
  assert.equal(P.numerZKartki("  MM 1209/MAG/2026 "), "1209");
  assert.equal(P.numerZKartki("1209"), "1209");
  // kartka bez ukośnika — bierzemy cyfry, bo brak dopasowania jest gorszy
  assert.equal(P.numerZKartki("kosz 77"), "77");
  assert.equal(P.numerZKartki("   "), "");
});

test("otwarcie po numerze buduje kosz z pozycji dokumentu i jest idempotentne", () => {
  const kosz = P.otworzPrzyjecie("1209", "Jan");
  assert.equal(kosz.kod, "1209");
  assert.equal(kosz.status, "zamkniety", "kosz z dokumentu rodzi się gotowy do rozkładania");
  assert.equal(kosz.mmNumer, "1209");
  assert.deepEqual(
    kosz.pozycje.map((p) => [p.symbol, p.ilosc]),
    [["TEST-LINIA-TODO", 3], ["TEST-LINIA-DONE", 1], ["TEST-WYCOFANY", 2]]
  );
  assert.equal(kosz.pozycje[0].zwrotId, null, "pozycja nie pochodzi ze zwrotu");

  // drugi skan tej samej kartki — ten sam kosz, nie drugi
  const drugi = P.otworzPrzyjecie("MM 1209/MAG/2026", "Ewa");
  assert.equal(drugi.id, kosz.id);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM kosz").get() as { n: number }).n, 1);
});

test("towar bez kartoteki zostaje w koszu i niesie nazwę z dokumentu", () => {
  /* Regresja 0.75.1. Import kartotek pomija towar zablokowany
     (`tw_Zablokowany = 0` w zapytaniu), a na regale zwrotów leży właśnie towar
     wycofany ze sprzedaży. Pominięcie takiej pozycji dawało kosz KRÓTSZY niż
     papier przy nim — w dodatku bez śladu, że czegoś brakuje. */
  const kosz = P.otworzPrzyjecie("1209", "Jan");
  const wycofany = kosz.pozycje.find((p) => p.symbol === "TEST-WYCOFANY");
  assert.ok(wycofany, "pozycja spoza kartoteki nie może wypaść z kosza");
  assert.equal(wycofany.nazwa, "Towar wycofany ze sprzedaży");
  assert.equal(wycofany.lokOczekiwana, null, "kartoteki nie ma, więc nie ma adresu");
  // odłożenie działa: magazynier wskazuje półkę palcem, bo skan nie ma czego trafić
  K.odlozPozycje(wycofany.id, "C09-09-09", "Jan");
  assert.equal(P.listaPrzyjec()[0].odlozonych, 1);
});

test("nieznany numer mówi CO sprawdzić, zamiast milczeć", () => {
  assert.throws(() => P.otworzPrzyjecie("999", "Jan"), /Nie znam przyjęcia o numerze 999/);
  assert.throws(() => P.otworzPrzyjecie("", "Jan"), /Podaj numer z kartki/);
});

test("ZAKOŃCZ na koszu z dokumentu NIE wystawia żadnego dokumentu", () => {
  /* Sedno całej zmiany: przesunięcie na regał zrobiło biuro przed
     przywiezieniem kosza, a powrotne zrobi po rozłożeniu. Zadanie w kolejce
     znaczyłoby TEN SAM towar przesunięty drugi raz. */
  const kosz = P.otworzPrzyjecie("1209", "Jan");
  // pierwsza wraca na SWOJĄ półkę, druga ląduje gdzie indziej
  K.odlozPozycje(kosz.pozycje[0].id, kosz.pozycje[0].lokOczekiwana ?? "A01-02-03", "Jan");
  K.odlozPozycje(kosz.pozycje[1].id, "C09-09-09", "Jan");
  K.odlozPozycje(kosz.pozycje[2].id, "C09-09-10", "Jan");

  const rozlozony = K.zakonczKosz(kosz.id, "Jan");
  assert.equal(rozlozony.status, "rozlozony");
  const mm = db().prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='mm'").get() as { n: number };
  assert.equal(mm.n, 0, "żadnego MM z kolektora");
  /* Zapis ADRESU idzie normalnie i JEST jedynym śladem, jaki kolektor tu
     zostawia — ale tylko dla towaru, który zmienił miejsce. Powrót na własną
     półkę niczego nie zapisuje, bo nie ma czego prostować. */
  const loc = db()
    .prepare("SELECT COUNT(*) AS n FROM sfera_queue WHERE type='set_location'")
    .get() as { n: number };
  /* Dwa, nie trzy: pierwsza pozycja wróciła na WŁASNĄ półkę i nie ma czego
     prostować. Drugi zapis dotyczy towaru bez kartoteki w read-modelu —
     zablokowana kartoteka też dostaje adres, bo towar naprawdę tam leży. */
  assert.equal(loc.n, 2, "adres zapisany tylko dla przeniesionego towaru");
});

test("lista zna stan pracy, a admin zdejmuje dokument sprzed wdrożenia", () => {
  assert.deepEqual(
    P.listaPrzyjec().map((p) => [p.numer, p.stan, p.pozycji]),
    [["1209", "nietkniety", 3]]
  );

  const kosz = P.otworzPrzyjecie("1209", "Jan");
  assert.equal(P.listaPrzyjec()[0].stan, "w_rozkladaniu");
  for (const p of kosz.pozycje) K.odlozPozycje(p.id, "C01-01-01", "Jan");
  K.zakonczKosz(kosz.id, "Jan");
  assert.equal(P.listaPrzyjec()[0].stan, "rozlozony");
  assert.equal(P.liczbaPrzyjecDoRozlozenia(), 0);

  // zdjęcie ręką: idempotentne i widoczne na liście
  P.oznaczRozlozonePozaAplikacja(DOK, "Admin");
  P.oznaczRozlozonePozaAplikacja(DOK, "Admin");
  assert.equal(P.listaPrzyjec()[0].stan, "poza_aplikacja");
  assert.throws(() => P.oznaczRozlozonePozaAplikacja(999_999, "Admin"), /nie istnieje/);
});
