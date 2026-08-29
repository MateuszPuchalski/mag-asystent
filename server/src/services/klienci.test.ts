import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kontekst klienta — jedno miejsce dla czterech rejestrów ─────────────────
   Sedno: ten sam login spina pytania, zwroty, dyskusje i reklamacje; brak
   loginu daje poprawny wynik PUSTY; `pomijaj` wycina sprawę, z której się
   patrzy.                                                                    */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kli-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let K: typeof import("./klienci.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  K = await import("./klienci.js");
});

beforeEach(() => {
  const d = db();
  for (const t of ["sprawa_zrodlo", "sprawa", "dyskusja", "pytanie", "zwrot_pozycja", "zwrot"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

const teraz = () => new Date().toISOString();

function daneKlienta(login: string) {
  const d = db();
  d.prepare(
    `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status, produkty_json, utworzono_at, utworzono_przez)
     VALUES ('allegro', ?, 'Czy pasuje do T375?', ?, 'wyslane', '[]', ?, 'Test')`
  ).run(login, teraz(), teraz());
  const z = d.prepare(
    `INSERT INTO zwrot(kupujacy_login, waybill, status, utworzono_at, utworzono_przez)
     VALUES (?, 'WB-1', 'nowy', ?, 'Test')`
  ).run(login, teraz());
  d.prepare(
    "INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc) VALUES (?, 'Piła', 2)"
  ).run(Number(z.lastInsertRowid));
  /* Druga pozycja tego samego zwrotu jest reklamacją — czwarty rejestr. */
  d.prepare(
    `INSERT INTO zwrot_pozycja(zwrot_id, nazwa, ilosc, decyzja, decyzja_at, decyzja_przez)
     VALUES (?, 'Pęknięty nóż', 1, 'reklamacja', ?, 'Test')`
  ).run(Number(z.lastInsertRowid), teraz());
  const dy = d.prepare(
    `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login, widziano_at, utworzono_at)
     VALUES ('iss-1', 'CLAIM', 'nowa', 'Pęknięta obudowa', ?, ?, ?)`
  ).run(login, teraz(), teraz());
  return Number(dy.lastInsertRowid);
}

test("cztery rejestry jednego loginu w jednej odpowiedzi", () => {
  daneKlienta("jan_wraca");
  const k = K.kontekstKlienta("jan_wraca");
  assert.equal(k.login, "jan_wraca");
  assert.equal(k.pytania.length, 1);
  assert.equal(k.zwroty.length, 1);
  assert.equal(k.zwroty[0].pozycji, 2);
  assert.equal(k.dyskusje.length, 1);
  assert.equal(k.dyskusje[0].typ, "CLAIM");
  /* Reklamacja to pozycja zwrotu z decyzją, nie osobna tabela — kontekst
     ma ją widzieć, bo dotąd była jedynym niewidocznym rejestrem klienta. */
  assert.equal(k.reklamacje.length, 1);
  assert.equal(k.reklamacje[0].nazwa, "Pęknięty nóż");
  assert.equal(k.reklamacje[0].wynik, null, "nierozpatrzona = otwarta");
  assert.ok(k.reklamacje[0].dniDoTerminu >= 13, "zegar 14 dni od zgłoszenia");
  assert.equal(k.reklamacje[0].poTerminie, false);
  // cudzy login nie podgląda cudzych spraw
  const obcy = K.kontekstKlienta("ktos_inny");
  assert.equal(
    obcy.pytania.length + obcy.zwroty.length + obcy.dyskusje.length + obcy.reklamacje.length,
    0
  );
});

test("brak loginu = uczciwie pusto, nie błąd", () => {
  daneKlienta("jan_wraca");
  const k = K.kontekstKlienta(null);
  assert.equal(k.login, null);
  assert.deepEqual([k.pytania, k.zwroty, k.dyskusje, k.reklamacje], [[], [], [], []]);
});

test("pomijaj wycina sprawę, z której się patrzy — własny wiersz to szum", () => {
  const dyskusjaId = daneKlienta("ewa_oddaje");
  const zJej = K.kontekstKlienta("ewa_oddaje", { dyskusjaId });
  assert.equal(zJej.dyskusje.length, 0, "jedyna dyskusja to ta otwarta na ekranie");
  assert.equal(zJej.zwroty.length, 1, "reszta rejestrów zostaje");
});
