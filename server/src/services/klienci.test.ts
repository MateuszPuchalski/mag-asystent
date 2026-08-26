import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kontekst klienta — jedno miejsce dla trzech rejestrów ───────────────────
   Sedno: ten sam login spina pytania, zwroty i dyskusje; brak loginu daje
   poprawny wynik PUSTY; `pomijaj` wycina sprawę, z której się patrzy.        */

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
  for (const t of ["dyskusja", "pytanie", "zwrot_pozycja", "zwrot"]) {
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
  const dy = d.prepare(
    `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login, widziano_at, utworzono_at)
     VALUES ('iss-1', 'CLAIM', 'nowa', 'Pęknięta obudowa', ?, ?, ?)`
  ).run(login, teraz(), teraz());
  return Number(dy.lastInsertRowid);
}

test("trzy rejestry jednego loginu w jednej odpowiedzi", () => {
  daneKlienta("jan_wraca");
  const k = K.kontekstKlienta("jan_wraca");
  assert.equal(k.login, "jan_wraca");
  assert.equal(k.pytania.length, 1);
  assert.equal(k.zwroty.length, 1);
  assert.equal(k.zwroty[0].pozycji, 1);
  assert.equal(k.dyskusje.length, 1);
  assert.equal(k.dyskusje[0].typ, "CLAIM");
  // cudzy login nie podgląda cudzych spraw
  const obcy = K.kontekstKlienta("ktos_inny");
  assert.equal(obcy.pytania.length + obcy.zwroty.length + obcy.dyskusje.length, 0);
});

test("brak loginu = uczciwie pusto, nie błąd", () => {
  daneKlienta("jan_wraca");
  const k = K.kontekstKlienta(null);
  assert.equal(k.login, null);
  assert.deepEqual([k.pytania, k.zwroty, k.dyskusje], [[], [], []]);
});

test("pomijaj wycina sprawę, z której się patrzy — własny wiersz to szum", () => {
  const dyskusjaId = daneKlienta("ewa_oddaje");
  const zJej = K.kontekstKlienta("ewa_oddaje", { dyskusjaId });
  assert.equal(zJej.dyskusje.length, 0, "jedyna dyskusja to ta otwarta na ekranie");
  assert.equal(zJej.zwroty.length, 1, "reszta rejestrów zostaje");
});
