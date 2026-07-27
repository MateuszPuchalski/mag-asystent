import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Widoczność magazynów ───────────────────────────────────────────────────
   Najważniejszy jest tu test „ukrycie przeżywa import". Widoczność KUSI, żeby
   trzymać ją jako kolumnę w `sgt_magazyn` — obok kodu i nazwy, w tabeli, która
   nazywa się „magazyn". Byłby to błąd bez objawu przy pierwszym uruchomieniu:
   `sgt_*` to lustro Subiekta czyszczone w całości przy każdym imporcie, więc
   ustawienie znikałoby po minucie, a zgłoszenie brzmiałoby „ukrywanie nie
   działa czasami".                                                           */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-mag-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let M: typeof import("./magazyny.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  M = await import("./magazyny.js");
});

/** Trzy magazyny z rolami + dwa zwykłe. */
function zasil() {
  const d = db();
  d.prepare("DELETE FROM sgt_magazyn").run();
  d.prepare("DELETE FROM sgt_stan").run();
  d.prepare("DELETE FROM magazyn_widocznosc").run();
  d.prepare("DELETE FROM events").run();

  const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  insMag.run(1, "MAG", "Magazyn główny");
  insMag.run(2, "MGP", "Strefa przyjęć");
  insMag.run(3, "ZWROTY", "Zwroty od klientów");
  insMag.run(91, "SERWIS", "Serwis i reklamacje");
  insMag.run(92, "EKSPO", "Ekspozycja");

  const insStan = d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (?,?,?,?)");
  insStan.run(1, 1, 10, 2);
  insStan.run(1, 2, 5, 0);
  insStan.run(1, 91, 7, 0);
  insStan.run(1, 92, 0, 0);
}

beforeEach(zasil);

/** To, co robi importer: wymiata read-model i wstawia go od nowa. */
function udajImport() {
  const d = db();
  d.prepare("DELETE FROM sgt_magazyn").run();
  const insMag = d.prepare("INSERT INTO sgt_magazyn(mag_id, kod, nazwa) VALUES (?,?,?)");
  insMag.run(1, "MAG", "Magazyn główny");
  insMag.run(2, "MGP", "Strefa przyjęć");
  insMag.run(3, "ZWROTY", "Zwroty od klientów");
  insMag.run(91, "SERWIS", "Serwis i reklamacje");
  insMag.run(92, "EKSPO", "Ekspozycja");
}

// ── Lista i role ────────────────────────────────────────────────────────────

test("lista zna wszystkie magazyny i rozpoznaje trzy z rolami", () => {
  const l = M.listaMagazynow();
  assert.equal(l.length, 5);
  assert.deepEqual(
    l.filter((m) => m.rola !== null).map((m) => m.rola),
    ["MAG", "MGP", "ZWROTY"]
  );
  assert.equal(l.find((m) => m.magId === 91)?.rola, null);
});

// ── Karta towaru ────────────────────────────────────────────────────────────

test("karta dostaje magazyny BEZ ról — trójka ma własne kafle", () => {
  const m = M.magazynyTowaru(1);
  assert.deepEqual(m.map((x) => x.kod), ["SERWIS", "EKSPO"]);
});

test("zerowe stany zostają na liście, na dole", () => {
  // „widzieć wszystkie magazyny" było treścią zgłoszenia; od zaśmiecania
  // ekranu jest ukrywanie, nie milczące odsiewanie zer
  const m = M.magazynyTowaru(1);
  assert.equal(m[0].kod, "SERWIS");
  assert.equal(m[0].stan, 7);
  assert.equal(m.at(-1)?.kod, "EKSPO");
  assert.equal(m.at(-1)?.stan, 0);
});

test("towar bez stanów poza rolami daje pustą listę, nie błąd", () => {
  assert.deepEqual(M.magazynyTowaru(999), []);
});

// ── Ukrywanie ───────────────────────────────────────────────────────────────

test("ukryty magazyn znika z karty", () => {
  assert.equal(M.ustawUkryte([91], "Biuro Testowe").ok, true);
  assert.deepEqual(M.magazynyTowaru(1).map((x) => x.kod), ["EKSPO"]);
});

test("lista ustawień nadal go pokazuje, z flagą", () => {
  M.ustawUkryte([91], "Biuro Testowe");
  const m = M.listaMagazynow().find((x) => x.magId === 91);
  assert.equal(m?.ukryty, true);
});

test("zapis jest listą PEŁNĄ — czego nie ma, wraca na widok", () => {
  M.ustawUkryte([91, 92], "Biuro Testowe");
  assert.deepEqual(M.magazynyTowaru(1), []);
  M.ustawUkryte([92], "Biuro Testowe");
  assert.deepEqual(M.magazynyTowaru(1).map((x) => x.kod), ["SERWIS"]);
});

test("ukrycie przeżywa import read-modelu", () => {
  /* GDYBY flaga siedziała w `sgt_magazyn`, ten test padłby — a na produkcji
     objawem byłoby „ukrywanie działa i po chwili przestaje". */
  M.ustawUkryte([91], "Biuro Testowe");
  udajImport();
  assert.deepEqual(M.magazynyTowaru(1).map((x) => x.kod), ["EKSPO"]);
});

test("ukrycie zostawia ślad w events", () => {
  M.ustawUkryte([91], "Biuro Testowe");
  const ev = db()
    .prepare("SELECT type, user_id, payload FROM events ORDER BY id DESC LIMIT 1")
    .get() as { type: string; user_id: string; payload: string };
  assert.equal(ev.type, "magazyny_widocznosc");
  assert.equal(ev.user_id, "Biuro Testowe");
  assert.match(ev.payload, /SERWIS/);
});

// ── Ochrona trójki z rolami ─────────────────────────────────────────────────

for (const [id, kod] of [[1, "MAG"], [2, "MGP"], [3, "ZWROTY"]] as const) {
  test(`${kod} nie da się ukryć — prowadzi rozkładanie`, () => {
    const w = M.ustawUkryte([id], "Biuro Testowe");
    assert.equal(w.ok, false);
    assert.match(w.blad ?? "", new RegExp(kod));
  });
}

test("odmowa nie zapisuje NICZEGO — także poprawnych pozycji z tej samej listy", () => {
  M.ustawUkryte([91], "Biuro Testowe");
  const w = M.ustawUkryte([92, 2], "Biuro Testowe"); // 2 = MGP, niedozwolone
  assert.equal(w.ok, false);
  // stan sprzed odrzuconego zapisu ma zostać nietknięty
  assert.deepEqual(M.magazynyTowaru(1).map((x) => x.kod), ["EKSPO"]);
});

test("nieznany magazyn odpada z nazwą powodu", () => {
  const w = M.ustawUkryte([12345], "Biuro Testowe");
  assert.equal(w.ok, false);
  assert.match(w.blad ?? "", /12345/);
});

test("rola wygrywa nad starym wpisem w bazie", () => {
  // magazyn ukryty, zanim dostał rolę w konfiguracji
  db().prepare("INSERT INTO magazyn_widocznosc(mag_id, ukryty) VALUES (2,1)").run();
  assert.equal(M.listaMagazynow().find((m) => m.magId === 2)?.ukryty, false);
});
