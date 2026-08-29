import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Oś czasu sprawy ─────────────────────────────────────────────────────────
   Trzy rzeczy są tu warte testu i wszystkie trzy są decyzjami projektowymi,
   nie szczegółami implementacji: idempotencja zapisu (polling powtarza fakty),
   zdarzenie przy ŹRÓDLE zamiast przy sprawie (SCAL nie przepisuje historii)
   oraz dosypka zastanego stanu, która może chodzić przy każdym starcie.     */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-os-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let O: typeof import("./os-sprawy.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  O = await import("./os-sprawy.js");
});

beforeEach(() => {
  for (const tabela of ["sprawa_zdarzenie", "sprawa_zrodlo", "sprawa", "pytanie", "dyskusja"]) {
    db().prepare(`DELETE FROM ${tabela}`).run();
  }
});

/** Sprawa z dwoma źródłami — dokładnie ten układ, dla którego oś powstała. */
function sprawaZDwomaZrodlami(): number {
  const d = db();
  const sprawaId = Number(
    d.prepare("INSERT INTO sprawa (utworzono_at) VALUES ('2026-08-01T08:00:00Z')").run()
      .lastInsertRowid
  );
  const wstaw = d.prepare(
    `INSERT INTO sprawa_zrodlo (sprawa_id, rodzaj, lokalny_id, wiazanie, dodano_at)
     VALUES (?,?,?, 'auto', '2026-08-01T08:00:00Z')`
  );
  wstaw.run(sprawaId, "zwrot", 7);
  wstaw.run(sprawaId, "dyskusja", 3);
  return sprawaId;
}

test("zapis jest idempotentny — ten sam fakt dwa razy to jeden wiersz", () => {
  const fakt = {
    rodzaj: "dyskusja" as const,
    lokalnyId: 3,
    typ: "zalozona" as const,
    kto: "klient" as const,
    kiedy: "2026-08-01T09:00:00Z",
  };
  O.dopiszZdarzenie(fakt);
  O.dopiszZdarzenie(fakt);
  const wpisy = O.osCzasuZrodel([{ rodzaj: "dyskusja", lokalnyId: 3 }]);
  assert.equal(wpisy.length, 1);
  assert.equal(wpisy[0].opis, O.TYPY_ZDARZEN.zalozona);
});

test("wariant odróżnia powtarzalne zdarzenia tego samego typu", () => {
  for (const znakow of ["120 znaków", "40 znaków"]) {
    O.dopiszZdarzenie({
      rodzaj: "dyskusja",
      lokalnyId: 3,
      typ: "odpowiedzielismy",
      kto: "my",
      autor: "biuro.anna",
      szczegol: znakow,
      wariant: znakow,
    });
  }
  const wpisy = O.osCzasuZrodel([{ rodzaj: "dyskusja", lokalnyId: 3 }]);
  assert.equal(wpisy.length, 2);
  assert.deepEqual(
    wpisy.map((w) => w.szczegol),
    ["120 znaków", "40 znaków"]
  );
});

test("oś sprawy skleja źródła i sortuje po czasie zdarzenia", () => {
  sprawaZDwomaZrodlami();
  O.dopiszZdarzenie({
    rodzaj: "dyskusja",
    lokalnyId: 3,
    typ: "klient_napisal",
    kto: "klient",
    kiedy: "2026-08-03T10:00:00Z",
    wariant: "m1",
  });
  O.dopiszZdarzenie({
    rodzaj: "zwrot",
    lokalnyId: 7,
    typ: "zalozona",
    kto: "klient",
    kiedy: "2026-08-02T10:00:00Z",
  });
  /* Wejściem jest JEDNO źródło, wyjściem oś CAŁEJ sprawy — panel zna tylko
     rejestr, w którym stoi otwarty szczegół. */
  const os = O.osCzasuSprawy("dyskusja", 3);
  assert.equal(os.zrodla.length, 2);
  assert.deepEqual(
    os.wpisy.map((w) => `${w.rodzaj}:${w.typ}`),
    ["zwrot:zalozona", "dyskusja:klient_napisal"]
  );
});

test("źródło bez wiązania dostaje własną oś — pseudo-sprawa nie gubi historii", () => {
  O.dopiszZdarzenie({
    rodzaj: "pytanie",
    lokalnyId: 11,
    typ: "zalozona",
    kto: "klient",
    kiedy: "2026-08-04T10:00:00Z",
  });
  const os = O.osCzasuSprawy("pytanie", 11);
  assert.equal(os.sprawaId, null);
  assert.equal(os.wpisy.length, 1);
});

test("scalenie nie rusza zdarzeń — historia jedzie ze źródłem", () => {
  const d = db();
  const sprawaId = sprawaZDwomaZrodlami();
  O.dopiszZdarzenie({
    rodzaj: "zwrot",
    lokalnyId: 7,
    typ: "zalozona",
    kto: "klient",
    kiedy: "2026-08-02T10:00:00Z",
  });
  /* Ręczne przeniesienie źródła do innej sprawy — dokładnie to, co robi
     SCAL. Zdarzenie zostaje nietknięte, a oś nowej sprawy je widzi. */
  const inna = Number(
    d.prepare("INSERT INTO sprawa (utworzono_at) VALUES ('2026-08-01T08:00:00Z')").run()
      .lastInsertRowid
  );
  d.prepare("UPDATE sprawa_zrodlo SET sprawa_id = ? WHERE rodzaj = 'zwrot' AND lokalny_id = 7").run(
    inna
  );
  assert.equal(O.osCzasuSprawy("zwrot", 7).sprawaId, inna);
  assert.equal(O.osCzasuSprawy("zwrot", 7).wpisy.length, 1);
  /* Stara sprawa traci ten wpis — bo straciła źródło, nie historię. */
  assert.equal(O.osCzasuSprawy("dyskusja", 3).sprawaId, sprawaId);
  assert.equal(O.osCzasuSprawy("dyskusja", 3).wpisy.length, 0);
});

test("dosypka czyta stemple rejestrów i nie dubluje przy drugim przebiegu", () => {
  const d = db();
  d.prepare(
    `INSERT INTO pytanie (id, zrodlo, kupujacy_login, tresc, otrzymano_at, status,
                          wyslano_at, odpowiedzial, prowadzi, prowadzi_at,
                          produkty_json, utworzono_at, utworzono_przez)
     VALUES (5, 'allegro', 'kowalski', 'x', '2026-08-01T10:00:00Z', 'wyslane',
             '2026-08-02T12:00:00Z', 'biuro.anna', 'biuro.anna', '2026-08-02T11:00:00Z',
             '[]', '2026-08-01T10:00:00Z', 'sync')`
  ).run();

  const pierwszy = O.dosypOsCzasu();
  assert.equal(pierwszy, 3, "wpłynęło, wzięto, odpowiedzieliśmy");
  const drugi = O.dosypOsCzasu();
  assert.equal(drugi, 0, "druga dosypka nie ma prawa dopisać niczego");

  const wpisy = O.osCzasuZrodel([{ rodzaj: "pytanie", lokalnyId: 5 }]);
  assert.deepEqual(
    wpisy.map((w) => w.typ),
    ["zalozona", "przejeto", "odpowiedzielismy"]
  );
  assert.equal(wpisy[2].autor, "biuro.anna");
});

test("dosypka odróżnia zamknięcie automatem Allegro od naszego", () => {
  const d = db();
  const wstaw = d.prepare(
    `INSERT INTO dyskusja (id, allegro_id, status, temat, utworzono_allegro,
                           zamknieto_at, zamknieto_przez, widziano_at, utworzono_at)
     VALUES (?,?, 'zamknieta', 't', '2026-08-01T10:00:00Z', '2026-08-05T10:00:00Z', ?,
             '2026-08-05T10:00:00Z', '2026-08-01T10:00:00Z')`
  );
  wstaw.run(1, "a1", "allegro");
  wstaw.run(2, "a2", "biuro.anna");
  O.dosypOsCzasu();

  const zAllegro = O.osCzasuZrodel([{ rodzaj: "dyskusja", lokalnyId: 1 }]).at(-1);
  const nasze = O.osCzasuZrodel([{ rodzaj: "dyskusja", lokalnyId: 2 }]).at(-1);
  assert.equal(zAllegro?.kto, "allegro");
  assert.equal(zAllegro?.autor, null);
  assert.equal(nasze?.kto, "my");
  assert.equal(nasze?.autor, "biuro.anna");
});

test("pusta oś to pusta lista, nie wyjątek", () => {
  assert.deepEqual(O.osCzasuZrodel([]), []);
  assert.equal(O.osCzasuSprawy("reklamacja", 999).wpisy.length, 0);
});
