import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Statystyki zwrotów ──────────────────────────────────────────────────────
   Trzy rzeczy z ceną błędu:

   1. GRUPOWANIE. Ten sam towar z dwóch zwrotów to JEDEN wiersz z liczbą 2,
      a nie dwa wiersze po jednym. Towar bez kartoteki też musi się policzyć —
      wypadnięcie go zafałszowałoby obraz po cichu.
   2. WSKAŹNIK. Jedyna liczba mówiąca „z tym produktem jest problem" i jedyna,
      która potrafi skłamać. Zero sprzedaży w oknie NIE znaczy 100% zwrotów,
      a okno dłuższe niż import sprzedaży nie ma prawa dzielić pełnego
      licznika przez niepełny mianownik.
   3. OKNO. Zwrot sprzed roku nie ma wpływu na statystykę ostatnich 30 dni.  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-stat-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let S: typeof import("./statystyki-zwrotow.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./statystyki-zwrotow.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", 
    "zwrot_pozycja", "zwrot", "sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_towar",
  ]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  const ins = d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (?,?,?,?,?)");
  ins.run(900_036, "TEST-WRACA", "Towar, który wraca", "", "A01-02-03");
  ins.run(900_037, "TEST-SPOKOJNY", "Towar bez problemów", "", "A01-02-04");
});

const dniTemu = (n: number) => new Date(Date.now() - n * 86_400_000 - 1000).toISOString();

/** Zwrot z pozycjami: [tw_id albo null, ilość, decyzja]. */
function zwrot(
  waybill: string,
  dni: number,
  login: string | null,
  pozycje: Array<[number | null, number, string | null]>
): void {
  const d = db();
  const r = d
    .prepare(
      `INSERT INTO zwrot(waybill, status, kupujacy_login, utworzono_at, utworzono_przez)
       VALUES (?, 'nowy', ?, ?, 'Test')`
    )
    .run(waybill, login, dniTemu(dni));
  const zwrotId = Number(r.lastInsertRowid);
  const poz = d.prepare(
    "INSERT INTO zwrot_pozycja(zwrot_id, nazwa, tw_id, ilosc, decyzja) VALUES (?,?,?,?,?)"
  );
  for (const [twId, ilosc, decyzja] of pozycje) {
    poz.run(zwrotId, twId === 900_036 ? "Towar, który wraca" : "Pozycja spoza katalogu", twId, ilosc, decyzja);
  }
}

/** Sprzedaż w read-modelu — mianownik wskaźnika. */
function sprzedaz(dokId: number, dni: number, twId: number, ilosc: number): void {
  const d = db();
  d.prepare(
    `INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, data_wyst, mag_id)
     VALUES (?, 'FS', ?, ?, 1)`
  ).run(dokId, `FS ${dokId}/2026`, dniTemu(dni).slice(0, 10));
  d.prepare("INSERT INTO sgt_sprzedaz_pozycja(dok_id, tw_id, ilosc) VALUES (?,?,?)").run(dokId, twId, ilosc);
}

test("ten sam towar z dwóch zwrotów to jeden wiersz — zwroty i sztuki osobno", () => {
  zwrot("WB1", 2, "kowalski", [[900_036, 2, "pelnowartosciowy"]]);
  zwrot("WB2", 5, "nowak", [[900_036, 2, "reklamacja"]]);

  const p = S.statystykiZwrotow(30).produkty;
  assert.equal(p.length, 1);
  assert.equal(p[0].symbol, "TEST-WRACA");
  assert.equal(p[0].zwrotow, 2, "dwa zdarzenia");
  assert.equal(p[0].sztuk, 4, "cztery sztuki");
});

test("towar bez kartoteki liczy się po nazwie, zamiast wypaść ze statystyki", () => {
  zwrot("WB1", 1, null, [[null, 1, null]]);
  zwrot("WB2", 1, null, [[null, 3, null]]);

  const p = S.statystykiZwrotow(30).produkty;
  assert.equal(p.length, 1);
  assert.equal(p[0].twId, null);
  assert.equal(p[0].nazwa, "Pozycja spoza katalogu");
  assert.equal(p[0].sztuk, 4);
  assert.equal(p[0].wskaznik, null, "bez kartoteki nie ma czym dzielić");
});

test("wskaźnik dzieli przez sprzedaż z okna, a bez sprzedaży milczy", () => {
  zwrot("WB1", 3, "kowalski", [[900_036, 5, "pelnowartosciowy"], [900_037, 1, "pelnowartosciowy"]]);
  sprzedaz(1, 4, 900_036, 50);
  // 900_037 sprzedany POZA oknem — mianownik jest zerem, nie brakiem towaru
  sprzedaz(2, 200, 900_037, 30);

  const p = S.statystykiZwrotow(30).produkty;
  const wraca = p.find((x) => x.twId === 900_036);
  assert.equal(wraca?.sprzedanych, 50);
  assert.equal(wraca?.wskaznik, 0.1, "5 zwróconych na 50 sprzedanych");

  const spokojny = p.find((x) => x.twId === 900_037);
  assert.equal(spokojny?.sprzedanych, 0);
  assert.equal(
    spokojny?.wskaznik,
    null,
    "zero sprzedaży w oknie to pytanie bez odpowiedzi, nie wskaźnik 100%"
  );
});

test("okno dłuższe niż import sprzedaży nie pokazuje wskaźnika w ogóle", () => {
  /* Licznik miałby 180 dni, mianownik najwyżej 90 — iloraz wyszedłby zawyżony
     i ktoś mógłby po nim wycofać dobrze sprzedający się towar. */
  zwrot("WB1", 100, "kowalski", [[900_036, 5, "pelnowartosciowy"]]);
  sprzedaz(1, 100, 900_036, 50);

  const s = S.statystykiZwrotow(180);
  assert.equal(s.sprzedazOkno, 90, "okno importu sprzedaży jedzie w odpowiedzi");
  assert.equal(s.produkty[0].sprzedanych, null);
  assert.equal(s.produkty[0].wskaznik, null);
});

test("zwrot spoza okna nie wpada do żadnego przekroju", () => {
  zwrot("STARY", 120, "kowalski", [[900_036, 9, "pelnowartosciowy"]]);
  const s = S.statystykiZwrotow(30);
  assert.deepEqual(s.produkty, []);
  assert.deepEqual(s.decyzje, []);
  assert.deepEqual(s.kupujacy, []);
  /* Oś czasu jest własnością OKNA, nie danych: tygodnie zostają, ale puste.
     Wykres bez słupków to co innego niż wykres bez osi. */
  assert.ok(s.tygodnie.length > 0);
  assert.ok(s.tygodnie.every((t) => t.ile === 0), "same zera, bez tego zwrotu");
});

test("tydzień bez zwrotów zostaje na osi jako zero", () => {
  /* Bez tego wykres pokazywałby równy rytm tam, gdzie była przerwa: sąsiadami
     stawałyby się tygodnie odległe o miesiąc. */
  zwrot("WB1", 1, "kowalski", [[900_036, 1, null]]);
  zwrot("WB2", 21, "kowalski", [[900_036, 1, null]]);

  const t = S.statystykiZwrotow(30).tygodnie;
  assert.ok(t.length >= 4, "okno 30 dni to co najmniej cztery tygodnie");
  assert.ok(
    t.some((x) => x.ile === 0),
    "tygodnie ciszy między zwrotami mają własne słupki"
  );
  assert.equal(t.reduce((a, x) => a + x.ile, 0), 2, "suma słupków to liczba zwrotów");
  const klucze = t.map((x) => x.tydzien);
  assert.deepEqual(klucze, [...klucze].sort(), "oś idzie chronologicznie");
});

test("decyzje i kupujący: nieocenione mają własny wiersz, jednorazowi odpadają", () => {
  zwrot("WB1", 1, "kowalski", [[900_036, 2, "pelnowartosciowy"], [900_037, 1, null]]);
  zwrot("WB2", 2, "kowalski", [[900_036, 1, "do_zniszczenia"]]);
  zwrot("WB3", 3, "jednorazowy", [[900_036, 1, "pelnowartosciowy"]]);

  const s = S.statystykiZwrotow(30);
  const mapa = new Map(s.decyzje.map((d) => [d.decyzja, d]));
  assert.equal(mapa.get("pelnowartosciowy")?.sztuk, 3);
  assert.equal(mapa.get("do_zniszczenia")?.pozycji, 1);
  assert.equal(mapa.get("nieocenione")?.pozycji, 1, "brak decyzji to też odpowiedź");

  /* Lista kupujących ma pokazywać POWTARZALNOŚĆ, a nie każdego klienta —
     jeden zwrot to normalne zakupy, nie sygnał. */
  assert.deepEqual(s.kupujacy.map((k) => [k.login, k.zwrotow]), [["kowalski", 2]]);
});

test("okno z żądania sprowadza się do dozwolonej wartości", () => {
  assert.equal(S.oknoDni("30"), 30);
  assert.equal(S.oknoDni(180), 180);
  assert.equal(S.oknoDni("7"), 90, "nieznane okno to domyślne 90 dni");
  assert.equal(S.oknoDni(undefined), 90);
  assert.equal(S.oknoDni("'; DROP TABLE zwrot; --"), 90);
});
