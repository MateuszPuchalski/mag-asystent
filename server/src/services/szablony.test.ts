import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Szablony odpowiedzi ─────────────────────────────────────────────────────
   Sedno jest w podstawianiu: szablon jedzie do KLIENTA, więc pole, którego
   sprawa nie zna, ma zostać widoczną klamrą, a nie pustym miejscem w zdaniu.
   Reszta testów pilnuje filtra kanału i tego, że maska `client:NNN` nigdy nie
   trafia w powitanie.                                                        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-szab-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let S: typeof import("./szablony.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  S = await import("./szablony.js");
});

beforeEach(() => {
  for (const t of ["szablon", "sprawa_zrodlo", "sprawa", "pytanie", "dyskusja", "zwrot", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

test("brakujące pole zostaje KLAMRĄ, a nie pustym miejscem w zdaniu", () => {
  const tekst = "Dzień dobry {{klient}}, zamówienie {{zamowienie}} jest w drodze. {{ja}}";
  const wynik = S.wypelnijSzablon(tekst, { klient: "jan_wraca", zamowienie: null, ja: "Anna" });
  assert.equal(wynik, "Dzień dobry jan_wraca, zamówienie {{zamowienie}} jest w drodze. Anna");
});

test("nieznane pole zostaje nietknięte — szablon nie zgaduje", () => {
  assert.equal(S.wypelnijSzablon("Numer {{wymyslone}}", { klient: "x" }), "Numer {{wymyslone}}");
  /* Spacje w klamrach i wielkość liter piszącego nie mogą psuć podstawienia. */
  assert.equal(S.wypelnijSzablon("Cześć {{ Klient }}", { klient: "ewa" }), "Cześć ewa");
});

test("filtr kanału zostawia szablony `dowolny` — one pasują wszędzie", () => {
  S.dodajSzablon("Powitanie", "dowolny", "Dzień dobry", "Anna");
  S.dodajSzablon("Dobór części", "pytanie", "Ta część pasuje do", "Anna");
  S.dodajSzablon("Zwrot środków", "dyskusja", "Środki oddajemy dziś", "Anna");

  /* Szablon pisany POD kanał stoi wyżej niż uniwersalny — jest celniejszy. */
  assert.deepEqual(
    S.listaSzablonow("pytanie").map((s) => s.nazwa),
    ["Dobór części", "Powitanie"]
  );
  assert.deepEqual(
    S.listaSzablonow("dyskusja").map((s) => s.nazwa),
    ["Zwrot środków", "Powitanie"]
  );
  assert.equal(S.listaSzablonow().length, 3);
});

test("pusta nazwa i pusta treść to odmowa ze zdaniem, nie cichy zapis", () => {
  assert.throws(() => S.dodajSzablon("  ", "dowolny", "coś", "Anna"), /nazwy/);
  assert.throws(() => S.dodajSzablon("Nazwa", "dowolny", "   ", "Anna"), /Pusty/);
  assert.throws(() => S.dodajSzablon("Nazwa", "wymyslony", "treść", "Anna"), /Nieznany kanał/);
  assert.equal(S.listaSzablonow().length, 0);
});

test("dane sprawy: maska client:NNN NIE jest imieniem", () => {
  const d = db();
  const teraz = "2026-08-01T08:00:00Z";
  const id = Number(
    d.prepare(
      `INSERT INTO pytanie(zrodlo, thread_id, kupujacy_login, oferta_tytul, tresc, otrzymano_at,
                           status, produkty_json, utworzono_at, utworzono_przez)
       VALUES ('allegro', 'w-1', 'client:44300444', 'Kosiarka T375', 'x', ?, 'nowe', '[]', ?, 'test')`
    ).run(teraz, teraz).lastInsertRowid
  );
  const dane = S.daneSprawy("pytanie", id, "Anna");
  assert.equal(dane.klient, null, "maska zostaje klamrą — agent wpisze imię sam");
  assert.equal(dane.oferta, "Kosiarka T375");
  assert.equal(dane.ja, "Anna");
});

test("szablon dla sprawy wypełnia się i mówi, czego zabrakło", () => {
  const d = db();
  const teraz = "2026-08-01T08:00:00Z";
  const zwrotId = Number(
    d.prepare(
      `INSERT INTO zwrot(kupujacy_login, waybill, referencja, status, allegro_order_id,
                         utworzono_at, utworzono_przez)
       VALUES ('jan_wraca', 'WB-1', 'ZW-DEV-0001', 'nowy', 'dev-ord-1', ?, 'test')`
    ).run(teraz).lastInsertRowid
  );
  const s = S.dodajSzablon(
    "Zwrot przyjęty",
    "dowolny",
    "Dzień dobry {{klient}}, zwrot {{zwrot}} do zamówienia {{zamowienie}} przyjęty. {{oferta}}",
    "Anna"
  );
  const wynik = S.szablonDlaSprawy(s.id, "zwrot", zwrotId, "Anna");
  assert.match(wynik.tresc, /jan_wraca/);
  assert.match(wynik.tresc, /ZW-DEV-0001/);
  assert.match(wynik.tresc, /dev-ord-1/);
  /* Zwrot nie zna tytułu oferty — klamra zostaje i panel to zgłasza. */
  assert.match(wynik.tresc, /\{\{oferta\}\}/);
  assert.deepEqual(wynik.brakujace, ["oferta"]);
});

test("każda mutacja szablonu ma ślad w dzienniku", () => {
  const s = S.dodajSzablon("Powitanie", "dowolny", "Dzień dobry", "Anna");
  S.zapiszSzablon(s.id, "Powitanie długie", "pytanie", "Dzień dobry, dziękuję za wiadomość", "Anna");
  S.skasujSzablon(s.id, "Anna");
  const typy = (
    db().prepare("SELECT type FROM events ORDER BY id").all() as Array<{ type: string }>
  ).map((e) => e.type);
  assert.deepEqual(typy, ["szablon_dodany", "szablon_zapisany", "szablon_skasowany"]);
  assert.throws(() => S.szablon(s.id), /Nie ma takiego/);
});
