import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── „Rozłożone poza WERTIS" ─────────────────────────────────────────────────
   Sedno tych testów: zamknięcie ZDEJMUJE PRACĘ Z EKRANU, a nie udaje, że praca
   została wykonana. Różnica jest niewidoczna na pierwszy rzut oka i dokładnie
   dlatego trzeba ją przybić: gdyby zamknięcie dopisywało linie albo zapisywało
   adresy, raport odłożeń pokazałby robotę, której nikt nie wykonał — a nikomu
   nie przyszłoby do głowy tego sprawdzić.

   Druga połowa to droga powrotna. Operacja jest dostępna z przeglądarki, gdzie
   sąsiedni przycisk leży o centymetr dalej, więc pomyłkowe kliknięcie musi się
   dać cofnąć — i to bez zostawiania po sobie dostawy w stanie, którego nie da
   się ani wykonać, ani zamknąć.                                              */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-poza-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let Dost: typeof import("./dostawy-towaru.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  Dost = await import("./dostawy-towaru.js");
});

const TOWAR = 7;
const DOK = 500;
const dzisiaj = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  const d = db();
  for (const t of ["problem", "delivery_line", "delivery", "sgt_pozycja", "sgt_dokument", "events"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare(
    `INSERT INTO sgt_dokument(dok_id, typ, nr_pelny, data_wyst, mag_id, dostawca, w_buforze)
     VALUES (?, 'FZ', ?, ?, 1, 'OGRÓD-POL', 0)`
  ).run(DOK, `FZ ${DOK}/MAG/07/2026`, dzisiaj());
  d.prepare("INSERT INTO sgt_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(DOK, TOWAR, 6);
});

/** Dostawa otwarta w WERTIS z jedną linią o zadanym postępie. */
function otwarta(odlozona = 0, status = "todo"): number {
  const id = Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, dostawca, data_dok, status, opened_at, source_mag_id)
         VALUES (?,?,?,?, 'open', ?, 1)`
      )
      .run(DOK, `FZ ${DOK}/MAG/07/2026`, "OGRÓD-POL", dzisiaj(), new Date().toISOString())
      .lastInsertRowid
  );
  db()
    .prepare(
      `INSERT INTO delivery_line(delivery_id, tw_id, tw_symbol, tw_nazwa, ilosc_dok, ilosc_odlozona, status)
       VALUES (?,?,?,?,?,?,?)`
    )
    .run(id, TOWAR, "W32-0203", "Kosa spalinowa", 6, odlozona, status);
  return id;
}

const stan = (): string | undefined =>
  (db().prepare("SELECT status FROM delivery WHERE sgt_dok_id = ?").get(DOK) as
    | { status: string }
    | undefined)?.status;

/* ── zamykanie ────────────────────────────────────────────────────────────── */

test("dokument nietknięty da się zamknąć — bez ani jednej linii", () => {
  /* Brak linii jest tu TREŚCIĄ, nie brakiem danych: nikt tego nie rozkładał
     w WERTIS, więc snapshot pozycji udawałby, że było inaczej. */
  const r = D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  assert.equal(r.linie, 0);
  assert.equal(stan(), "external");
  const linie = db()
    .prepare("SELECT COUNT(*) AS n FROM delivery_line WHERE delivery_id = ?")
    .get(r.deliveryId) as { n: number };
  assert.equal(linie.n, 0, "zamknięcie nie dopisuje pracy, której nikt nie wykonał");
});

test("dostawa otwarta i porzucona zostaje ze swoimi liniami", () => {
  // odłożone zostają odłożone: status DOKUMENTU mówi „skończyło się poza
  // aplikacją", a nie „nic z tego się nie stało"
  otwarta(4, "partial");
  const r = D.zamknijPozaWertis(DOK, "Anna z biura", "resztę odłożono z ręki");
  assert.equal(r.linie, 1);
  const l = db()
    .prepare("SELECT ilosc_odlozona, status FROM delivery_line LIMIT 1")
    .get() as { ilosc_odlozona: number; status: string };
  assert.equal(l.ilosc_odlozona, 4);
  assert.equal(l.status, "partial", "linie zostają dokładnie takie, jakie były");
});

test("pusty powód nie przechodzi", () => {
  assert.throws(() => D.zamknijPozaWertis(DOK, "Anna z biura", "   "), /powód/i);
  assert.equal(stan(), undefined, "odmowa nie zostawia po sobie wiersza");
});

test("dostawy rozłożonej W WERTIS nie da się zdjąć z listy", () => {
  /* `done` znaczy „ludzie odłożyli to tutaj i mamy z tego skany". Nadpisanie
     tego statusem `external` skasowałoby fakt wykonania pracy. */
  otwarta(6, "done");
  db().prepare("UPDATE delivery SET status='done' WHERE sgt_dok_id=?").run(DOK);
  assert.throws(() => D.zamknijPozaWertis(DOK, "Anna z biura", "pomyłka"), /rozłożona w WERTIS/);
  assert.equal(stan(), "done");
});

test("drugie zamknięcie odmawia zamiast nadpisać powód i nazwisko", () => {
  D.zamknijPozaWertis(DOK, "Anna z biura", "pierwszy powód");
  assert.throws(() => D.zamknijPozaWertis(DOK, "Ktoś inny", "drugi powód"), /już oznaczona/);
  const d = db().prepare("SELECT closed_by, powod_zamkniecia AS p FROM delivery").get() as {
    closed_by: string;
    p: string;
  };
  assert.equal(d.closed_by, "Anna z biura");
  assert.equal(d.p, "pierwszy powód");
});

test("nieistniejący dokument to błąd, nie pusta dostawa", () => {
  assert.throws(() => D.zamknijPozaWertis(999_999, "Anna z biura", "cokolwiek"), /Nie znaleziono/);
});

test("zamknięcie zostawia ślad w audycie razem z powodem", () => {
  D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  const e = db()
    .prepare("SELECT user_id, payload FROM events WHERE type = 'delivery_external'")
    .get() as { user_id: string; payload: string };
  assert.equal(e.user_id, "Anna z biura");
  assert.match(e.payload, /rozłożone starą aplikacją/);
});

/* ── znikanie z pracy ─────────────────────────────────────────────────────── */

test("zamknięty dokument wypada z listy rozkładania", () => {
  assert.equal(D.listDocuments(14).length, 1);
  D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  assert.deepEqual(D.listDocuments(14), [], "nie wyszarzony na dole — nieobecny");
});

test("karta towaru przestaje mówić „w dostawie” o towarze z półki", () => {
  // to jest zgłoszona usterka: postęp liczy się z delivery_line, więc taki
  // dokument ma zawsze zero odłożone i NIGDY by się sam nie wyzerował
  assert.equal(Dost.nierozlozoneZDostaw(TOWAR).length, 1);
  D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  assert.deepEqual(Dost.nierozlozoneZDostaw(TOWAR), []);
});

test("skan nie wskrzesza zamkniętej dostawy po cichu", () => {
  /* Wskrzeszony dokument nie miałby ani jednej linii, więc kolektor pokazałby
     pustą listę pracy — a droga powrotna ma prowadzić przez biuro i powód. */
  D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  assert.throws(() => D.openDelivery(DOK, "Jan z hali"), /poza WERTIS/);
  assert.equal(stan(), "external");
});

/* ── cofanie ──────────────────────────────────────────────────────────────── */

test("cofnięcie bez linii przywraca dokument jako NIETKNIĘTY", () => {
  /* Zostawienie pustej dostawy w stanie `open` pokazałoby na kolektorze
     dokument otwarty i bez pozycji — pracę, której nie da się ani wykonać,
     ani zamknąć. */
  D.zamknijPozaWertis(DOK, "Anna z biura", "pomyłka");
  assert.equal(D.cofnijZamkniecie(DOK, "Anna z biura").przywrocona, "nowa");
  assert.equal(stan(), undefined, "wiersz znika, dokument wraca do stanu sprzed");
  assert.equal(D.listDocuments(14).length, 1);
  assert.equal(Dost.nierozlozoneZDostaw(TOWAR).length, 1);
});

test("cofnięcie z liniami wraca na OTWARTĄ i nie gubi postępu", () => {
  otwarta(4, "partial");
  D.zamknijPozaWertis(DOK, "Anna z biura", "pomyłka");
  assert.equal(D.cofnijZamkniecie(DOK, "Anna z biura").przywrocona, "otwarta");
  assert.equal(stan(), "open");
  const d = db().prepare("SELECT closed_at, closed_by, powod_zamkniecia AS p FROM delivery").get() as {
    closed_at: string | null;
    closed_by: string | null;
    p: string | null;
  };
  assert.equal(d.closed_at, null);
  assert.equal(d.closed_by, null);
  assert.equal(d.p, null, "powód znika razem z zamknięciem, bo już niczego nie tłumaczy");
  const l = db().prepare("SELECT ilosc_odlozona AS q FROM delivery_line").get() as { q: number };
  assert.equal(l.q, 4);
});

test("zgłoszony wyjątek trzyma wiersz przy życiu mimo braku linii", () => {
  /* `problem.delivery_id` wskazuje na dostawę; skasowanie wiersza zostawiłoby
     w protokołach rozbieżności sierotę. */
  D.zamknijPozaWertis(DOK, "Anna z biura", "pomyłka");
  const id = (db().prepare("SELECT id FROM delivery").get() as { id: number }).id;
  db()
    .prepare(
      `INSERT INTO problem(delivery_id, typ, opis, created_at, created_by)
       VALUES (?, 'damaged', ?, ?, ?)`
    )
    .run(id, "karton przemoczony", new Date().toISOString(), "Jan z hali");
  assert.equal(D.cofnijZamkniecie(DOK, "Anna z biura").przywrocona, "otwarta");
  assert.equal(stan(), "open");
});

test("cofnięcie dostawy, która nie jest zamknięta poza WERTIS, odmawia", () => {
  otwarta();
  assert.throws(() => D.cofnijZamkniecie(DOK, "Anna z biura"), /nie jest oznaczona/);
  assert.throws(() => D.cofnijZamkniecie(999_999, "Anna z biura"), /Nie znaleziono/);
});

/* ── lista dla biura ──────────────────────────────────────────────────────── */

test("lista zamkniętych niesie powód, nazwisko i liczbę linii", () => {
  // bez niej zamknięty dokument znika bez śladu widocznego dla człowieka,
  // więc pomyłka nie ma jak zostać zauważona
  otwarta(2, "partial");
  D.zamknijPozaWertis(DOK, "Anna z biura", "rozłożone starą aplikacją");
  const [d] = D.listaZamknietychPozaWertis();
  assert.equal(d.dokId, DOK);
  assert.equal(d.zamknietaBy, "Anna z biura");
  assert.equal(d.powod, "rozłożone starą aplikacją");
  assert.equal(d.linie, 1);
  assert.equal(d.dostawca, "OGRÓD-POL");
});
