import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { migrate } from "../db/db.js";
import { config } from "../config.js";
import { etykietyDostaw } from "../adapters/typy-dokumentow.js";
import { BladReklamacji, ReklamacjaConflict, szczegolReklamacji } from "./reklamacje.js";
import { LIMIT_DOWODU } from "./reklamacja-dowody.js";
import { dodajDowod, usunDowod, zapiszUDostawcy } from "./reklamacja-dowody-zapis.js";

/* Ten plik pilnuje reguł, których na ekranie nie widać: że dowód i reklamacja
   u dostawcy NIE ruszają wersji sprawy (inaczej kolega robiłby 409 komuś, kto
   pisze do kupującego), że zdjęcie dowodu musi być z tej samej sprawy, że
   dziennik dostaje numery i długości, nigdy słowa, i że dyskusja nie ma
   dostępu do żadnego z tych zapisów. */
const schema = fs.readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

const ALA = { id: 1, name: "A. Lewandowska" };
const MAREK = { id: 2, name: "M. Wójcik" };

function stanowisko() {
  const d = new DatabaseSync(":memory:");
  d.exec(schema);
  migrate(d);
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (1,'ala','A. Lewandowska','biuro')").run();
  d.prepare("INSERT INTO app_user(user_id,login,name,role) VALUES (2,'marek','M. Wójcik','biuro')").run();
  const konto = Number(d.prepare(
    "INSERT INTO channel_account(channel,external_account_id) VALUES ('allegro','seller-a')")
    .run().lastInsertRowid);
  const sprawa = (ext: string, typ = "CLAIM") => Number(d.prepare(`INSERT INTO reklamacja_klienta
    (channel_account_id,external_id,typ,offer_id,otwarto_at,synced_at)
    VALUES (?,?,?,'of-1','2026-09-06T10:00:00Z','2026-09-07T10:00:00Z')`)
    .run(konto, ext, typ).lastInsertRowid);
  const id = sprawa("i-1");
  const inna = sprawa("i-2");
  const dyskusja = sprawa("d-1", "DISPUTE");
  const zdjecie = (reklamacjaId: number, url: string) => Number(d.prepare(
    "INSERT INTO reklamacja_zalacznik(reklamacja_id,wiadomosc_id,nazwa,url) VALUES (?,NULL,'usterka.jpg',?)")
    .run(reklamacjaId, url).lastInsertRowid);
  return { d, konto, id, inna, dyskusja, zdjecie };
}

const wersjaSprawy = (d: DatabaseSync, id: number) =>
  Number((d.prepare("SELECT wersja FROM reklamacja_klienta WHERE id=?").get(id) as { wersja: number }).wersja);

const zdarzenia = (d: DatabaseSync, type: string) => (d.prepare(
  "SELECT user_id, payload FROM events WHERE type=? ORDER BY id").all(type) as
  Array<{ user_id: string; payload: string }>).map((z) => ({ user: z.user_id, ...JSON.parse(z.payload) }));

const dziennik = (d: DatabaseSync) => (d.prepare("SELECT payload FROM events").all() as
  Array<{ payload: string | null }>).map((e) => e.payload ?? "").join(" ");

test("dowód dopisuje się od najstarszego, ze zdjęciem i autorem, bez ruszania wersji sprawy", () => {
  const { d, id, zdjecie } = stanowisko();
  const z1 = zdjecie(id, "https://api.allegro.pl/sale/issues/attachments/a-1");
  dodajDowod(d, id, { tresc: "  Pęknięta obudowa przy mocowaniu noża.  ", zalacznikId: z1 }, ALA);
  const lista = dodajDowod(d, id, { tresc: "Brakuje zdjęcia tabliczki." }, MAREK);

  assert.deepEqual(lista.map((w) => [w.tresc, w.zalacznikId, w.autor]), [
    ["Pęknięta obudowa przy mocowaniu noża.", z1, "A. Lewandowska"],
    ["Brakuje zdjęcia tabliczki.", null, "M. Wójcik"],
  ]);
  assert.match(lista[0].utworzonoAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(wersjaSprawy(d, id), 1, "dowód nie unieważnia ekranu kolegi, który pisze odpowiedź");

  const [pierwszy] = zdarzenia(d, "reklamacja_dowod");
  assert.deepEqual(pierwszy, {
    user: "A. Lewandowska", reklamacjaId: id, dowodId: lista[0].id, dlugosc: 37, zalacznikId: z1,
  });
  assert.equal(dziennik(d).includes("obudowa"), false, "treść dowodu nie idzie do dziennika");
});

test("pusty, za długi albo nie-tekstowy dowód odpada zdaniem, bez wiersza", () => {
  const { d, id } = stanowisko();
  const przypadki: Array<[unknown, RegExp]> = [
    ["   ", /Pusty dowód/],
    ["x".repeat(LIMIT_DOWODU + 1), new RegExp(`najwyżej ${LIMIT_DOWODU} znaków, a ten ma ${LIMIT_DOWODU + 1}`)],
    [42, /Dowód to tekst/],
    [undefined, /Dowód to tekst/],
  ];
  for (const [tresc, wzor] of przypadki) {
    assert.throws(() => dodajDowod(d, id, { tresc }, ALA), (e: unknown) =>
      e instanceof BladReklamacji && e.kod === 400 && wzor.test(e.message));
  }
  assert.throws(() => dodajDowod(d, id, { tresc: "ok", zalacznikId: 1.5 }, ALA),
    (e: unknown) => e instanceof BladReklamacji && e.kod === 400);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_dowod").get() as { n: number }).n, 0);
});

test("zdjęcie z CUDZEJ sprawy nie wiąże się z dowodem — 400 i nic nie zostaje", () => {
  const { d, id, inna, zdjecie } = stanowisko();
  const cudze = zdjecie(inna, "https://api.allegro.pl/sale/issues/attachments/a-9");
  assert.throws(() => dodajDowod(d, id, { tresc: "Widać pęknięcie", zalacznikId: cudze }, ALA),
    (e: unknown) => e instanceof BladReklamacji && e.kod === 400 && /nie należy do tej reklamacji/.test(e.message));
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_dowod").get() as { n: number }).n, 0);
  assert.equal(zdarzenia(d, "reklamacja_dowod").length, 0);
});

test("dyskusja i sprawa spoza bazy to 404 dla wszystkich trzech zapisów", () => {
  const { d, dyskusja } = stanowisko();
  for (const sprawa of [dyskusja, 9999]) {
    const nieMa = (e: unknown) => e instanceof BladReklamacji && e.kod === 404;
    assert.throws(() => dodajDowod(d, sprawa, { tresc: "Dowód" }, ALA), nieMa);
    assert.throws(() => usunDowod(d, sprawa, 1, ALA), nieMa);
    assert.throws(() => zapiszUDostawcy(d, sprawa, { dostawca: "AGRO", wersja: 0 }, ALA), nieMa);
  }
});

test("usunięcie dowodu: tylko z tej sprawy, ślad bez treści, wersja sprawy stoi", () => {
  const { d, id, inna } = stanowisko();
  const [w] = dodajDowod(d, id, { tresc: "Klient przysłał zdjęcie paragonu." }, ALA);
  /* Numer dowodu z cudzej sprawy to 404, nie skasowanie cudzego wpisu. */
  assert.throws(() => usunDowod(d, inna, w.id, ALA),
    (e: unknown) => e instanceof BladReklamacji && e.kod === 404);
  assert.deepEqual(usunDowod(d, id, w.id, MAREK), []);
  assert.deepEqual(zdarzenia(d, "reklamacja_dowod_usuniety"),
    [{ user: "M. Wójcik", reklamacjaId: id, dowodId: w.id, dlugosc: 33 }]);
  assert.equal(dziennik(d).includes("paragonu"), false);
  assert.equal(wersjaSprawy(d, id), 1);
  assert.throws(() => usunDowod(d, id, w.id, ALA), (e: unknown) => e instanceof BladReklamacji && e.kod === 404);
});

test("reklamacja u dostawcy: wersja 0 zakłada, drugie założenie i stara wersja to 409", () => {
  const { d, id } = stanowisko();
  const u = zapiszUDostawcy(d, id, { dostawca: " AGRO ", nrUDostawcy: " RMA-77 ", wersja: 0 }, ALA);
  assert.equal(u.dostawca, "AGRO");
  assert.equal(u.nrUDostawcy, "RMA-77");
  assert.equal(u.wynik, null);
  assert.equal(u.wynikAt, null);
  assert.equal(u.autor, "A. Lewandowska");
  assert.equal(u.wersja, 1);
  assert.match(u.zgloszonoAt, /^\d{4}-\d{2}-\d{2}T/);

  /* Dwie osoby klikające „Zgłoś u dostawcy” naraz: druga dowiaduje się, że
     ktoś był szybszy, i dostaje jego zgłoszenie do poprawienia. */
  assert.throws(() => zapiszUDostawcy(d, id, { dostawca: "HUSQ", wersja: 0 }, MAREK), (e: unknown) => {
    assert.ok(e instanceof ReklamacjaConflict);
    assert.equal((e.szczegoly.uDostawcy as { dostawca: string }).dostawca, "AGRO");
    return true;
  });
  assert.throws(() => zapiszUDostawcy(d, id, { dostawca: "AGRO", wynik: "uznal", wersja: 7 }, MAREK),
    (e: unknown) => e instanceof ReklamacjaConflict && /zmienił ktoś inny/.test(e.message));
  assert.equal(wersjaSprawy(d, id), 1, "zgłoszenie u dostawcy ma własną wersję, nie wersję sprawy");
});

test("wynik u dostawcy stempluje datę, brak pola zostawia wartość, `null` ją czyści", () => {
  const { d, id } = stanowisko();
  zapiszUDostawcy(d, id, { dostawca: "AGRO", nrUDostawcy: "RMA-77", wersja: 0 }, ALA);
  const uznal = zapiszUDostawcy(d, id, { dostawca: "AGRO", wynik: "uznal", wersja: 1 }, MAREK);
  assert.equal(uznal.wynik, "uznal");
  assert.ok(uznal.wynikAt, "kiedy dostawca uznał, jest faktem do rozliczenia z nim");
  assert.equal(uznal.nrUDostawcy, "RMA-77", "brak pola w ciele nie kasuje numeru");
  assert.equal(uznal.autor, "A. Lewandowska", "autor to zgłaszający; zmiany stoją w dzienniku");
  assert.equal(uznal.wersja, 2);

  const tenSam = zapiszUDostawcy(d, id, { dostawca: "AGRO", nrUDostawcy: null, wersja: 2 }, ALA);
  assert.equal(tenSam.nrUDostawcy, null);
  assert.equal(tenSam.wynikAt, uznal.wynikAt, "ten sam wynik nie przestawia daty");

  const cofniety = zapiszUDostawcy(d, id, { dostawca: "AGRO", wynik: null, wersja: 3 }, ALA);
  assert.equal(cofniety.wynik, null);
  assert.equal(cofniety.wynikAt, null);

  assert.deepEqual(zdarzenia(d, "reklamacja_u_dostawcy").map((z) => [z.wersja, z.wynik, z.maNr]),
    [[1, null, true], [2, "uznal", true], [3, "uznal", false], [4, null, false]]);
  assert.equal(dziennik(d).includes("RMA-77"), false, "numer u dostawcy nie idzie do dziennika");
});

test("zgłoszenie u dostawcy bez dostawcy, ze złym wynikiem albo bez wersji odpada zdaniem", () => {
  const { d, id } = stanowisko();
  const przypadki: Array<[Record<string, unknown>, RegExp]> = [
    [{ dostawca: "  ", wersja: 0 }, /Wpisz dostawcę/],
    [{ dostawca: "x".repeat(121), wersja: 0 }, /najwyżej 120/],
    [{ dostawca: "AGRO", nrUDostawcy: "n".repeat(81), wersja: 0 }, /najwyżej 80/],
    [{ dostawca: "AGRO", nrUDostawcy: 5, wersja: 0 }, /tekst albo nic/],
    [{ dostawca: "AGRO", wynik: "moze", wersja: 0 }, /uznal/],
    [{ dostawca: "AGRO" }, /wymaga wersji/],
    [{ dostawca: "AGRO", wersja: -1 }, /wymaga wersji/],
  ];
  for (const [z, wzor] of przypadki) {
    assert.throws(() => zapiszUDostawcy(d, id, z as never, ALA), (e: unknown) =>
      e instanceof BladReklamacji && e.kod === 400 && wzor.test(e.message), JSON.stringify(z));
  }
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_u_dostawcy").get() as { n: number }).n, 0);
});

test("szczegół niesie dowody, zgłoszenie u dostawcy i dostawę towaru z pewnej kartoteki", () => {
  const { d, konto, id } = stanowisko();
  dodajDowod(d, id, { tresc: "Widać pęknięcie." }, ALA);
  zapiszUDostawcy(d, id, { dostawca: "AGRO", wersja: 0 }, ALA);
  /* Wiersz nie ma kartoteki z paragonu ani z mapowania, ale SKU oferty trafia
     w jedną kartotekę. Taka kartoteka jest pewna, więc dostawa liczy się dla
     niej — inaczej panel pokazałby symbol z SKU i „nie wiemy" przy dostawcy. */
  d.prepare(`INSERT INTO offer_snapshot(channel_account_id,external_id,nazwa,sku,synced_at)
    VALUES (?,'of-1','Nóż','NOZ-1','2026-09-07T10:00:00Z')`).run(konto);
  d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (501,'NOZ-1','Nóż')").run();
  d.prepare(`INSERT INTO sgt_dokument(dok_id,typ,nr_pelny,data_wyst,mag_id,dostawca,nr_oryg)
    VALUES (1,?,'FZ 1/2026','2026-08-01',?,'AGRO','FV/1')`).run(etykietyDostaw()[0] ?? "FZ", config.magId.MAG);
  d.prepare("INSERT INTO sgt_pozycja(dok_id,tw_id,ilosc) VALUES (1,501,4)").run();

  const s = szczegolReklamacji(d, id);
  assert.equal(s.reklamacja.twId, null, "wiersz sam kartoteki nie zna");
  assert.equal(s.kartoteka?.pewnosc, "sku");
  assert.deepEqual(s.dostawa, { dostawca: "AGRO", data: "2026-08-01", numer: "FV/1", przedZakupem: false });
  assert.deepEqual(s.dowody.map((w) => w.tresc), ["Widać pęknięcie."]);
  assert.equal(s.uDostawcy?.dostawca, "AGRO");
});

test("sprawa odchodzi razem ze swoimi dowodami i zgłoszeniem u dostawcy", () => {
  /* Retencja idzie za sprawą (kaskada). Bez niej sprzątanie spraw stawałoby
     na kluczu obcym, a dowód bez sprawy byłby zdaniem o niczym. */
  const { d, id } = stanowisko();
  dodajDowod(d, id, { tresc: "Dowód" }, ALA);
  zapiszUDostawcy(d, id, { dostawca: "AGRO", wersja: 0 }, ALA);
  d.prepare("DELETE FROM reklamacja_klienta WHERE id=?").run(id);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_dowod").get() as { n: number }).n, 0);
  assert.equal((d.prepare("SELECT COUNT(*) n FROM reklamacja_u_dostawcy").get() as { n: number }).n, 0);
});
