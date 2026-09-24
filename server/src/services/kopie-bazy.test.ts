import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ALARM_PO_GODZINACH,
  ZOSTAW_NOCNYCH,
  ZOSTAW_PRZED,
  czytajStan,
  kopiaNocna,
  kopiaPrzedMigracja,
  problemyKopii,
  przytnij,
  rekoncyliacjaDzisiaj,
  zapiszRekoncyliacje,
  zapiszWersjeSchematu,
} from "./kopie-bazy.js";

/* Kopie bazy zastąpiły dwie czynności człowieka: kopię przed aktualizacją
   i wpis w Harmonogramie zadań. Te testy pilnują, że zastępstwo jest pełne,
   bo kopia, która po cichu nie powstaje, jest gorsza od braku kopii — ktoś
   na nią liczy. Godziny są w UTC; strefa domyślna to Europe/Warsaw (UTC+2
   we wrześniu), więc 00:30Z to 2:30 na ścianie magazynu. */

const NOC = "2026-09-24T00:30:00.000Z";
const DZIEN = "2026-09-24T10:00:00.000Z";

function temp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kopie-"));
}

function bazaZDanymi(dir: string): DatabaseSync {
  const d = new DatabaseSync(path.join(dir, "wertis.db"));
  d.exec("PRAGMA journal_mode = WAL");
  d.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
  d.prepare("INSERT INTO t (v) VALUES (?)").run("przed aktualizacją");
  return d;
}

test("kopia przed migracją powstaje przy zmianie wersji i niesie dane z WAL-a", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  const d = bazaZDanymi(dir);
  /* Wiersz zapisany tuż przed kopią siedzi jeszcze w `-wal`. Zwykła kopia
     pliku `wertis.db` by go zgubiła — to jest powód `VACUUM INTO`. */
  d.prepare("INSERT INTO t (v) VALUES (?)").run("świeży zapis");

  const plik = kopiaPrzedMigracja(d, "0.487.0", kat, NOC);
  assert.ok(plik, "kopia miała powstać");
  assert.match(plik, /^przed-20260924-003000-nieznana-do-0\.487\.0\.db$/);

  const k = new DatabaseSync(path.join(kat, plik), { readOnly: true });
  const wiersze = k.prepare("SELECT v FROM t ORDER BY id").all() as Array<{ v: string }>;
  k.close();
  assert.deepEqual(wiersze.map((w) => w.v), ["przed aktualizacją", "świeży zapis"]);
  assert.ok(!fs.existsSync(path.join(kat, `${plik}.tmp`)), "plik tymczasowy został");
  assert.equal(czytajStan(kat).przed?.plik, plik);
});

test("ta sama wersja nie robi drugiej kopii — restart usługi to nie aktualizacja", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  const d = bazaZDanymi(dir);
  assert.ok(kopiaPrzedMigracja(d, "0.487.0", kat, NOC));
  zapiszWersjeSchematu("0.487.0", kat, NOC);
  assert.equal(kopiaPrzedMigracja(d, "0.487.0", kat, DZIEN), null);
  /* Następna wersja — znowu kopia, z poprzednią wersją w nazwie. */
  assert.match(kopiaPrzedMigracja(d, "0.488.0", kat, DZIEN) ?? "", /-0\.487\.0-do-0\.488\.0\.db$/);
});

test("świeża baza bez tabel nie dostaje kopii, ale znacznik wersji tak", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  const d = new DatabaseSync(path.join(dir, "wertis.db"));
  assert.equal(kopiaPrzedMigracja(d, "0.487.0", kat, NOC), null);
  zapiszWersjeSchematu("0.487.0", kat, NOC);
  const stan = czytajStan(kat);
  assert.equal(stan.wersja, "0.487.0");
  assert.equal(stan.od, NOC, "od tego momentu liczy się alarm o nocnej kopii");
});

test("nieudana kopia NIE zatrzymuje startu i zostawia zdanie w zdrowiu", () => {
  const dir = temp();
  const d = bazaZDanymi(dir);
  /* Katalog kopii zajęty przez zwykły plik — mkdir padnie tak samo jak przy
     braku praw zapisu. Start ma iść dalej, bo odmowa w NSSM to pętla. */
  const kat = path.join(dir, "zajety");
  fs.writeFileSync(kat, "to nie katalog");
  assert.equal(kopiaPrzedMigracja(d, "0.487.0", kat, NOC), null);

  const kat2 = path.join(dir, "kopie");
  const d2 = bazaZDanymi(temp());
  d2.close();
  /* Zamknięta baza rzuca przy VACUUM — błąd ląduje w stanie. */
  assert.equal(kopiaPrzedMigracja(d2, "0.487.0", kat2, NOC), null);
  const stan = czytajStan(kat2);
  assert.equal(stan.blad?.rodzaj, "przed");
  const p = problemyKopii(stan, "mssql", kat2, NOC);
  assert.ok(p.some((z) => z.includes("przed aktualizacją") && z.includes("nie powstała")), p.join("\n"));
});

test("udana kopia zdejmuje zdanie o poprzedniej nieudanej", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  const zamknieta = bazaZDanymi(temp());
  zamknieta.close();
  kopiaPrzedMigracja(zamknieta, "0.487.0", kat, NOC);
  assert.ok(czytajStan(kat).blad);
  assert.ok(kopiaPrzedMigracja(bazaZDanymi(dir), "0.487.0", kat, DZIEN));
  assert.equal(czytajStan(kat).blad, undefined);
});

test("przycinanie zostawia najnowsze, a nie przypadkowe", () => {
  const kat = temp();
  for (let i = 1; i <= ZOSTAW_PRZED + 3; i++) {
    fs.writeFileSync(path.join(kat, `przed-2026090${i}-000000-a-do-b.db`), "");
  }
  fs.writeFileSync(path.join(kat, "noc-2026-09-01.db"), "");
  const usuniete = przytnij(kat, "przed-", ZOSTAW_PRZED);
  assert.equal(usuniete.length, 3);
  assert.ok(usuniete.every((p) => /przed-2026090[123]-/.test(p)), usuniete.join(","));
  assert.ok(fs.existsSync(path.join(kat, "noc-2026-09-01.db")), "przycinanie ruszyło cudzy rodzaj");
});

test("nocna kopia: tylko w oknie nocnym i raz na dobę", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  const d = bazaZDanymi(dir);
  /* W dzień NIE — VACUUM INTO jest synchroniczne i zatrzymałby kolektory. */
  assert.equal(kopiaNocna(d, kat, DZIEN), null);
  assert.equal(kopiaNocna(d, kat, NOC), "noc-2026-09-24.db");
  assert.equal(kopiaNocna(d, kat, "2026-09-24T01:30:00.000Z"), null, "druga kopia tej samej nocy");
  assert.equal(czytajStan(kat).noc?.plik, "noc-2026-09-24.db");
});

test("nocna kopia zostawia dwa tygodnie", () => {
  const dir = temp();
  const kat = path.join(dir, "kopie");
  fs.mkdirSync(kat);
  for (let i = 1; i <= ZOSTAW_NOCNYCH + 2; i++) {
    fs.writeFileSync(path.join(kat, `noc-2026-08-${String(i).padStart(2, "0")}.db`), "");
  }
  kopiaNocna(bazaZDanymi(dir), kat, NOC);
  const zostaly = fs.readdirSync(kat).filter((p) => p.startsWith("noc-"));
  assert.equal(zostaly.length, ZOSTAW_NOCNYCH);
  assert.ok(zostaly.includes("noc-2026-09-24.db"));
});

test("alarm o nocnej kopii: po dwóch dobach, nie wcześniej, i nie na demo", () => {
  const kat = temp();
  const godzinPo = (h: number) => new Date(Date.parse(NOC) + h * 3_600_000).toISOString();
  const stan = { od: NOC, wersja: "0.487.0" };

  assert.deepEqual(problemyKopii(stan, "mssql", kat, godzinPo(ALARM_PO_GODZINACH - 1)), []);
  const p = problemyKopii(stan, "mssql", kat, godzinPo(ALARM_PO_GODZINACH + 1));
  assert.equal(p.length, 1);
  assert.match(p[0]!, /ani jednej nocnej kopii/);
  assert.deepEqual(problemyKopii(stan, "seeded", kat, godzinPo(ALARM_PO_GODZINACH + 1)), [],
    "dane demo nie mają czego chronić, a czerwone zdrowie na pilocie uczy ignorować czerwone");

  const zKopia = { ...stan, noc: { at: NOC, plik: "noc-2026-09-24.db", bajtow: 1 } };
  assert.match(problemyKopii(zKopia, "mssql", kat, godzinPo(72))[0]!, /Ostatnia nocna kopia bazy jest z 2026-09-24/);
});

test("rozjazdy z nocy wchodzą do zdrowia, zero rozjazdów nie", () => {
  const kat = temp();
  zapiszRekoncyliacje(3, "C:\\wertis\\server\\data\\reconcile\\2026-09-24.csv", kat, NOC);
  const p = problemyKopii(czytajStan(kat), "mssql", kat, NOC);
  assert.ok(p.some((z) => z.includes("3 rozjazdów") && z.includes("2026-09-24.csv")), p.join("\n"));
  zapiszRekoncyliacje(0, null, kat, NOC);
  assert.deepEqual(problemyKopii(czytajStan(kat), "mssql", kat, NOC), []);
});

test("rekoncyliacja liczy dobę lokalną, nie UTC", () => {
  /* 23:30Z 23 września to 1:30 24 września w Polsce — ta sama noc co 00:30Z. */
  const stan = { rekoncyliacja: { at: "2026-09-23T23:30:00.000Z", rozjazdow: 0, plik: null } };
  assert.equal(rekoncyliacjaDzisiaj(stan, NOC), true);
  assert.equal(rekoncyliacjaDzisiaj(stan, "2026-09-24T23:30:00.000Z"), false);
});
