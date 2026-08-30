import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Tagi i reguły ───────────────────────────────────────────────────────────
   Cztery decyzje warte testu: tag wisi przy ŹRÓDLE (żeby przeżył scalanie
   i przebudowę), sprawa pokazuje sumę tagów swoich źródeł, reguła jest
   idempotentna, a przydział NIE odbiera sprawy komuś, kto już ją prowadzi.  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-tagi-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let T: typeof import("./tagi.js");
let przebudujSprawy: typeof import("./sprawa.js").przebudujSprawy;

before(async () => {
  ({ db } = await import("../db/db.js"));
  T = await import("./tagi.js");
  ({ przebudujSprawy } = await import("./sprawa.js"));
});

beforeEach(() => {
  for (const t of ["sprawa_tag", "regula", "sprawa_zrodlo", "sprawa", "zwrot", "dyskusja", "events"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/** Zwrot i dyskusja jednego zamówienia — jedna sprawa o dwóch źródłach. */
function sprawaDwuzrodlowa(): { zwrotId: number; dyskusjaId: number } {
  const d = db();
  const teraz = new Date().toISOString();
  const zwrotId = Number(
    d
      .prepare(
        `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id, utworzono_at, utworzono_przez)
         VALUES ('jan_wraca', 'WB-1', 'nowy', 'ord-1', ?, 'test')`
      )
      .run(teraz).lastInsertRowid
  );
  const dyskusjaId = Number(
    d
      .prepare(
        `INSERT INTO dyskusja(allegro_id, status, temat, kupujacy_login, order_id, widziano_at, utworzono_at)
         VALUES ('d-1', 'nowa', 'Uszkodzona przesyłka', 'jan_wraca', 'ord-1', ?, ?)`
      )
      .run(teraz, teraz).lastInsertRowid
  );
  przebudujSprawy();
  return { zwrotId, dyskusjaId };
}

test("tag nadany przy jednym źródle jest tagiem CAŁEJ sprawy", () => {
  const { zwrotId, dyskusjaId } = sprawaDwuzrodlowa();
  T.dodajTag("zwrot", zwrotId, "Uszkodzenie", "Anna");
  assert.deepEqual(
    T.tagiSprawy("dyskusja", dyskusjaId).map((t) => t.tag),
    ["uszkodzenie"],
    "sprawa pokazuje sumę tagów swoich źródeł"
  );
  /* Tag jest etykietą: bez wielkich liter i bez podwójnych spacji. */
  assert.equal(T.tagiSprawy("zwrot", zwrotId)[0].tag, "uszkodzenie");
});

test("zdjęcie tagu zabiera go z KOMPLETU źródeł sprawy", () => {
  const { zwrotId, dyskusjaId } = sprawaDwuzrodlowa();
  T.dodajTag("zwrot", zwrotId, "reklamacja", "Anna");
  T.dodajTag("dyskusja", dyskusjaId, "reklamacja", "Anna");
  T.usunTag("zwrot", zwrotId, "reklamacja", "Anna");
  assert.deepEqual(T.tagiSprawy("dyskusja", dyskusjaId), [], "tag znika ze sprawy, nie z połowy");
});

test("tag pilnuje kształtu: pusty, długi i z przecinkiem to odmowa", () => {
  const { zwrotId } = sprawaDwuzrodlowa();
  assert.throws(() => T.dodajTag("zwrot", zwrotId, "   ", "Anna"), /Pusty tag/);
  assert.throws(() => T.dodajTag("zwrot", zwrotId, "a".repeat(33), "Anna"), /32 znaki/);
  assert.throws(() => T.dodajTag("zwrot", zwrotId, "jeden,dwa", "Anna"), /Przecinek/);
  assert.deepEqual(T.tagiSprawy("zwrot", zwrotId), []);
});

test("reguła taguje pasujące sprawy i jest idempotentna", () => {
  const { zwrotId, dyskusjaId } = sprawaDwuzrodlowa();
  T.dodajRegule({ nazwa: "Uszkodzenia", wzorzec: "uszkodzon", tag: "uszkodzenie" }, "Anna");

  const pierwszy = T.zastosujReguly("Anna");
  assert.equal(pierwszy.tagow > 0, true);
  assert.deepEqual(T.tagiSprawy("zwrot", zwrotId).map((t) => t.tag), ["uszkodzenie"]);
  /* Tag nadany automatem jest podpisany regułą — po tym widać, czego nie
     zrobił człowiek. */
  assert.match(T.tagiSprawy("dyskusja", dyskusjaId)[0].autor, /^regula:\d+$/);

  const drugi = T.zastosujReguly("Anna");
  assert.equal(drugi.tagow, 0, "drugi przebieg nie dokłada tego samego tagu");
});

test("reguła dopasowuje się do TEKSTU ŹRÓDŁA, nie do wiersza sprawy", () => {
  sprawaDwuzrodlowa();
  /* „Uszkodzona przesyłka" to temat DYSKUSJI; zwrot nosi swój numer i nic
     o uszkodzeniu nie mówi. Reguła zawężona do zwrotów nie ma czego złapać —
     i to jest poprawne: tag ma wisieć przy źródle, którego dotyczy. */
  T.dodajRegule(
    { nazwa: "Zwroty uszkodzone", rodzaj: "zwrot", wzorzec: "uszkodzon", tag: "do-zdjecia" },
    "Anna"
  );
  assert.equal(T.zastosujReguly("Anna").tagow, 0);

  T.dodajRegule(
    { nazwa: "Dyskusje uszkodzone", rodzaj: "dyskusja", wzorzec: "uszkodzon", tag: "uszkodzenie" },
    "Anna"
  );
  T.zastosujReguly("Anna");
  const zrodla = db()
    .prepare("SELECT rodzaj FROM sprawa_tag ORDER BY rodzaj")
    .all() as Array<{ rodzaj: string }>;
  assert.deepEqual(zrodla.map((z) => z.rodzaj), ["dyskusja"]);
});

test("przydział NIE odbiera sprawy komuś, kto już ją prowadzi", () => {
  sprawaDwuzrodlowa();
  T.dodajRegule({ nazwa: "Do Anny", wzorzec: "uszkodzon", przydziel: "Anna" }, "Szef");
  const pierwszy = T.zastosujReguly("Szef");
  assert.equal(pierwszy.przydzialow, 1);

  /* Ktoś inny bierze sprawę ręką — reguła ma tego nie cofnąć. */
  db().prepare("UPDATE sprawa SET prowadzi = 'Bartek'").run();
  T.dodajRegule({ nazwa: "Do Anny znowu", wzorzec: "uszkodzon", przydziel: "Anna" }, "Szef");
  const drugi = T.zastosujReguly("Szef");
  assert.equal(drugi.przydzialow, 0, "cudza robota zostaje cudza");
  assert.equal(
    (db().prepare("SELECT prowadzi FROM sprawa").get() as { prowadzi: string }).prowadzi,
    "Bartek"
  );
});

test("reguła bez skutku i ze zbyt krótkim wzorcem to odmowa ze zdaniem", () => {
  assert.throws(() => T.dodajRegule({ nazwa: "Pusta", wzorzec: "uszkodzenie" }, "Anna"), /nic nie robi/);
  assert.throws(
    () => T.dodajRegule({ nazwa: "Za krótka", wzorzec: "ab", tag: "x" }, "Anna"),
    /trzy znaki/
  );
  assert.equal(T.listaRegul().length, 0);
});

test("kolejka niesie SUMĘ tagów źródeł — tag nadany przy zwrocie widać w wierszu", () => {
  const { zwrotId } = sprawaDwuzrodlowa();
  T.dodajTag("zwrot", zwrotId, "uszkodzenie", "Anna");

  const kolejka = T.sprawyZTagami();
  assert.equal(kolejka.length, 1, "zwrot i dyskusja jednego zamówienia to JEDEN wiersz");
  /* Sedno domknięcia E5: wiersz kolejki mówi to samo, co ekran sprawy.
     Tag wisi przy zwrocie, a wiersz stoi za całą sprawę — gdyby czytał tagi
     samego źródła wiodącego, etykieta znikałaby zależnie od tego, które
     źródło akurat jest najpilniejsze. */
  assert.deepEqual(kolejka[0].tagi, ["uszkodzenie"]);
});

test("sprawa bez tagów niesie PUSTĄ listę, nie brak pola", () => {
  sprawaDwuzrodlowa();
  /* Panel czyta `s.tagi` w pętli. Brak pola i pusta lista znaczą tam to samo,
     ale tylko puste pole mówi wprost „pytano o tagi i nie ma żadnego". */
  assert.deepEqual(T.sprawyZTagami()[0].tagi, []);
});

test("ten sam tag przy DWÓCH źródłach sprawy nie dubluje się w wierszu", () => {
  const { zwrotId, dyskusjaId } = sprawaDwuzrodlowa();
  T.dodajTag("zwrot", zwrotId, "vip", "Anna");
  T.dodajTag("dyskusja", dyskusjaId, "vip", "Anna");
  assert.deepEqual(T.sprawyZTagami()[0].tagi, ["vip"], "suma źródeł jest zbiorem, nie listą");
});

test("słownik tagów liczy użycia — podpowiedź przy dopisywaniu", () => {
  const { zwrotId, dyskusjaId } = sprawaDwuzrodlowa();
  T.dodajTag("zwrot", zwrotId, "uszkodzenie", "Anna");
  T.dodajTag("dyskusja", dyskusjaId, "uszkodzenie", "Anna");
  T.dodajTag("dyskusja", dyskusjaId, "vip", "Anna");
  assert.deepEqual(
    T.slownikTagow().map((s) => `${s.tag}:${s.ile}`),
    ["uszkodzenie:2", "vip:1"]
  );
});
