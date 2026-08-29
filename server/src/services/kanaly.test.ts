import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Kanały odpowiedzi w sprawie ─────────────────────────────────────────────
   Trzy decyzje warte testu: kanałem jest tylko to, przez co da się NAPISAĆ
   (zwrot i reklamacja nie), polecenie idzie za ostatnim głosem KLIENTA (nie
   za wiekiem sprawy), a kanał zamknięty znika z listy — odpowiadanie do
   zamkniętej sprawy Allegro kończy się błędem po stronie API.              */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-kan-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let K: typeof import("./kanaly.js");
let M: typeof import("./watek-meta.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  K = await import("./kanaly.js");
  M = await import("./watek-meta.js");
});

beforeEach(() => {
  for (const t of ["watek_meta", "sprawa_zrodlo", "sprawa", "pytanie", "dyskusja", "zwrot"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

/** Sprawa z trzech źródeł: zwrot (bez kanału), dyskusja i pytanie. */
function sprawaTrzechZrodel(): { zwrotId: number; dyskusjaId: number; pytanieId: number } {
  const d = db();
  const teraz = "2026-08-01T08:00:00Z";
  const zwrotId = Number(
    d.prepare(
      `INSERT INTO zwrot(kupujacy_login, waybill, status, allegro_order_id, utworzono_at, utworzono_przez)
       VALUES ('jan', 'WB-1', 'nowy', 'zam-1', ?, 'test')`
    ).run(teraz).lastInsertRowid
  );
  const dyskusjaId = Number(
    d.prepare(
      `INSERT INTO dyskusja(allegro_id, typ, status, temat, kupujacy_login, order_id,
                            utworzono_allegro, widziano_at, utworzono_at)
       VALUES ('d-1', 'CLAIM', 'nowa', 'Pęknięta obudowa', 'jan', 'zam-1', ?, ?, ?)`
    ).run(teraz, teraz, teraz).lastInsertRowid
  );
  const pytanieId = Number(
    d.prepare(
      `INSERT INTO pytanie(zrodlo, thread_id, kupujacy_login, oferta_tytul, tresc, otrzymano_at,
                           status, produkty_json, utworzono_at, utworzono_przez)
       VALUES ('allegro', 'w-1', 'jan', 'Kosiarka T375', 'Czy pasuje?', ?, 'nowe', '[]', ?, 'test')`
    ).run(teraz, teraz).lastInsertRowid
  );
  const sprawaId = Number(
    d.prepare("INSERT INTO sprawa (utworzono_at) VALUES (?)").run(teraz).lastInsertRowid
  );
  const wstaw = d.prepare(
    `INSERT INTO sprawa_zrodlo (sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
     VALUES (?,?,?, 'auto', ?)`
  );
  wstaw.run(sprawaId, "zwrot", zwrotId, teraz);
  wstaw.run(sprawaId, "dyskusja", dyskusjaId, teraz);
  wstaw.run(sprawaId, "pytanie", pytanieId, teraz);
  return { zwrotId, dyskusjaId, pytanieId };
}

const wiadDyskusji = (id: string, odNas: boolean, at: string) => ({
  id, odNas, autorLogin: null, autorRola: odNas ? "SELLER" : "BUYER",
  tresc: "x", at, zalacznik: null,
});
const wiadPytania = (id: string, odKupujacego: boolean, at: string) => ({
  id, odKupujacego, autor: null, tresc: "x", at, zalacznikow: 0, ofertaId: null,
});

test("kanałem jest wątek pytania i dyskusja — zwrot niesie mechanikę, nie rozmowę", () => {
  const { zwrotId } = sprawaTrzechZrodel();
  const { kanaly } = K.kanalyOdpowiedzi("zwrot", zwrotId);
  assert.deepEqual(kanaly.map((k) => k.rodzaj).sort(), ["dyskusja", "pytanie"]);
  /* CLAIM ma inną wagę niż zwykła dyskusja i to widać na przycisku. */
  assert.equal(kanaly.find((k) => k.rodzaj === "dyskusja")?.etykieta, "CLAIM");
});

test("poleca kanał, w którym klient odezwał się OSTATNI", () => {
  const { zwrotId, dyskusjaId, pytanieId } = sprawaTrzechZrodel();
  M.zapiszMetaDyskusji("d-1", [wiadDyskusji("m1", false, "2026-08-02T10:00:00Z")], "sync");
  M.zapiszMetaPytania("w-1", [wiadPytania("p1", true, "2026-08-05T10:00:00Z")], "sync");

  const pierwszy = K.kanalyOdpowiedzi("zwrot", zwrotId).kanaly.find((k) => k.polecany);
  assert.equal(pierwszy?.rodzaj, "pytanie", "klient pisał świeżej w pytaniu");
  assert.equal(pierwszy?.id, pytanieId);

  /* Nowy głos w dyskusji przestawia polecenie — i to bez jednego zapytania
     do Allegro, bo liczą metadane. */
  M.zapiszMetaDyskusji("d-1", [wiadDyskusji("m2", false, "2026-08-09T10:00:00Z")], "sync");
  const drugi = K.kanalyOdpowiedzi("zwrot", zwrotId).kanaly.find((k) => k.polecany);
  assert.equal(drugi?.rodzaj, "dyskusja");
  assert.equal(drugi?.id, dyskusjaId);
});

test("kanał, w którym ostatnie słowo jest NASZE, nie wygrywa polecenia", () => {
  const { zwrotId } = sprawaTrzechZrodel();
  M.zapiszMetaDyskusji("d-1", [wiadDyskusji("m1", false, "2026-08-02T10:00:00Z")], "sync");
  /* Nasza świeża odpowiedź w wątku pytania: piłka jest u klienta, więc to
     nie tam czekamy z odpowiedzią. */
  M.zapiszMetaPytania(
    "w-1",
    [wiadPytania("p1", true, "2026-08-03T10:00:00Z"), wiadPytania("p2", false, "2026-08-09T10:00:00Z")],
    "sync"
  );
  const polecany = K.kanalyOdpowiedzi("zwrot", zwrotId).kanaly.find((k) => k.polecany);
  assert.equal(polecany?.rodzaj, "dyskusja");
});

test("kanał zamknięty znika, a sprawa bez kanałów oddaje pustą listę", () => {
  const { zwrotId, dyskusjaId, pytanieId } = sprawaTrzechZrodel();
  const d = db();
  d.prepare("UPDATE dyskusja SET status = 'zamknieta' WHERE id = ?").run(dyskusjaId);
  assert.deepEqual(
    K.kanalyOdpowiedzi("zwrot", zwrotId).kanaly.map((k) => k.rodzaj),
    ["pytanie"]
  );
  d.prepare("UPDATE pytanie SET status = 'wyslane' WHERE id = ?").run(pytanieId);
  assert.deepEqual(K.kanalyOdpowiedzi("zwrot", zwrotId).kanaly, []);
});

test("wklejka nie jest kanałem — nie ma dokąd odpisać", () => {
  const d = db();
  const teraz = "2026-08-01T08:00:00Z";
  const id = Number(
    d.prepare(
      `INSERT INTO pytanie(zrodlo, kupujacy_login, tresc, otrzymano_at, status,
                           produkty_json, utworzono_at, utworzono_przez)
       VALUES ('wklejka', 'jan', 'ze screenshota', ?, 'nowe', '[]', ?, 'test')`
    ).run(teraz, teraz).lastInsertRowid
  );
  /* Pseudo-sprawa: bez wiązania kanały liczy się dla samego źródła. */
  const wynik = K.kanalyOdpowiedzi("pytanie", id);
  assert.equal(wynik.sprawaId, null);
  assert.deepEqual(wynik.kanaly, []);
});
