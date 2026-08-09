import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Nadawanie kodów kreskowych (0.37.0) ─────────────────────────────────────
   Funkcja rozszerza granicę zapisu do bazy firmy z jednego pola na dwa, więc
   test pilnuje przede wszystkim tego, czego NIE wolno:

     - nadać kodu, który należy już do innej kartoteki (własnoręczna kolizja),
     - nadpisać istniejącego kodu bez świadomego potwierdzenia,
     - pozwolić, żeby kod nadany u nas PRZYKRYŁ kod z Subiekta.

   Reszta to obietnica, dla której funkcja powstała: kod ma działać przy skanie
   NATYCHMIAST, także zanim worker dopchnie go do Subiekta.                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-ean-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";

let db: typeof import("../db/db.js").db;
let A: typeof import("./ean-alias.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  A = await import("./ean-alias.js");
});

const GAZNIK = 51;
const LOZYSKO = 52;
const KOD = "5901234123457";

beforeEach(() => {
  const d = db();
  d.prepare("DELETE FROM ean_alias").run();
  d.prepare("DELETE FROM sgt_towar").run();
  const t = d.prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)");
  t.run(GAZNIK, "GAZ-1", "Gaźnik", "");
  t.run(LOZYSKO, "LZ-6202", "Łożysko", "5900000000001");
});

/* ── Walidacja kodu ───────────────────────────────────────────────────────── */

test("kod o kształcie adresu regału jest odrzucany", () => {
  /* Gdyby przeszedł, najbliższy skan tej etykiety zamieniłby półkę w towar —
     pomyłka niewidoczna, dopóki ktoś nie zauważy, że zniknął regał. */
  assert.match(A.bladKodu("A01-02-03") ?? "", /adres regału/);
});

test("kod o niedozwolonej długości jest odrzucany", () => {
  for (const zly of ["123", "1234567", "123456789012345", "abcdefgh"]) {
    assert.ok(A.bladKodu(zly), `„${zly}" powinien być odrzucony`);
  }
});

test("poprawne długości EAN przechodzą", () => {
  for (const ok of ["12345678", "123456789012", "5901234123457", "12345678901234"]) {
    assert.equal(A.bladKodu(ok), null, ok);
  }
});

test("pusty kod jest odrzucany", () => {
  assert.ok(A.bladKodu(""));
  assert.ok(A.bladKodu("   "));
});

/* ── Kto ma ten kod ───────────────────────────────────────────────────────── */

test("wolny kod nie ma właściciela", () => {
  assert.equal(A.ktoMaTenKod(KOD), null);
});

test("kod z kartoteki Subiekta ma właściciela", () => {
  assert.deepEqual(A.ktoMaTenKod("5900000000001"), { twId: LOZYSKO, skad: "kartoteka" });
});

test("kod nadany u nas też ma właściciela", () => {
  // bez tego dałoby się nadać ten sam kod dwóm kartotekom, zanim worker
  // zdąży dopchnąć pierwszy do Subiekta — czyli wyprodukować kolizję
  A.zapiszAlias(KOD, GAZNIK, null, 1, "jan");
  assert.deepEqual(A.ktoMaTenKod(KOD), { twId: GAZNIK, skad: "wertis" });
});

/* ── Zapis i zdejmowanie ──────────────────────────────────────────────────── */

test("alias niesie stary kod i numer zadania", () => {
  A.zapiszAlias(KOD, GAZNIK, "5900000000009", 42, "jan");
  const a = A.aliasKodu(KOD)!;
  assert.equal(a.twId, GAZNIK);
  assert.equal(a.eanPrzed, "5900000000009");
  assert.equal(a.queueId, 42, "bez tego nie da się powiedzieć, które zadanie stoi w błędzie");
  assert.equal(a.createdBy, "jan");
});

test("ponowne nadanie tego samego kodu podmienia wpis, nie dubluje", () => {
  A.zapiszAlias(KOD, GAZNIK, null, 1, "jan");
  A.zapiszAlias(KOD, LOZYSKO, null, 2, "ewa");
  assert.equal(A.aliasyTowaru(GAZNIK).length, 0);
  assert.equal(A.aliasKodu(KOD)!.twId, LOZYSKO);
});

test("zdjęty alias przestaje wskazywać kartotekę", () => {
  A.zapiszAlias(KOD, GAZNIK, null, 1, "jan");
  A.zdejmijAlias(KOD);
  assert.equal(A.aliasKodu(KOD), undefined);
});

test("kartoteka pokazuje kody nadane u nas", () => {
  A.zapiszAlias(KOD, GAZNIK, null, 1, "jan");
  A.zapiszAlias("5901234123464", GAZNIK, null, 2, "jan");
  assert.deepEqual(A.aliasyTowaru(GAZNIK).map((a) => a.ean), [KOD, "5901234123464"]);
});

test("jeden kod nie może wskazywać dwóch kartotek — pilnuje tego baza", () => {
  /* Nie tylko kod aplikacji: klucz główny na `ean` jest ostatnią linią obrony
     przed odtworzeniem kolizji (§4.5), którą ten system mierzy jako defekt. */
  A.zapiszAlias(KOD, GAZNIK, null, 1, "jan");
  const ile = (db().prepare("SELECT COUNT(*) n FROM ean_alias WHERE ean=?").get(KOD) as { n: number }).n;
  assert.equal(ile, 1);
});
