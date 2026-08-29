import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Czasy obsługi klienta ───────────────────────────────────────────────────
   Cztery decyzje warte testu, każda zmienia wynik o godziny: okno przycina po
   ODPOWIEDZI, seria głosów klienta liczy się od PIERWSZEGO, odpowiedź bez
   pytania nie jest odcinkiem, a lista „czeka teraz" bierze wyłącznie sprawy
   otwarte w rejestrze.                                                       */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-czob-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let C: typeof import("./czasy-obslugi.js");
let O: typeof import("./os-sprawy.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  C = await import("./czasy-obslugi.js");
  O = await import("./os-sprawy.js");
});

beforeEach(() => {
  for (const t of ["sprawa_zdarzenie", "pytanie", "dyskusja"]) {
    db().prepare(`DELETE FROM ${t}`).run();
  }
});

const godzinTemu = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Otwarte pytanie w rejestrze — sekcja „czeka teraz" czyta stąd otwartość. */
function pytanieOtwarte(id: number, login = "jan_wraca"): void {
  const teraz = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO pytanie(id, zrodlo, thread_id, kupujacy_login, tresc, otrzymano_at, status,
                           produkty_json, utworzono_at, utworzono_przez)
       VALUES (?, 'allegro', ?, ?, 'x', ?, 'nowe', '[]', ?, 'test')`
    )
    .run(id, `w-${id}`, login, teraz, teraz);
}

test("odcinek liczy się od głosu klienta do naszej odpowiedzi", () => {
  pytanieOtwarte(1);
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 1, typ: "zalozona", kto: "klient", kiedy: godzinTemu(50) });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 1, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(48), wariant: "a",
  });
  const w = C.czasyObslugi(7);
  const cala = w.odcinki.find((o) => o.klucz === "wszystko");
  assert.equal(cala?.ile, 1);
  assert.equal(cala?.medianaH, 2);
  assert.deepEqual(w.ludzie.map((l) => [l.kto, l.odpowiedzi]), [["Anna", 1]]);
  assert.equal(w.ludzie[0].wiarygodne, false, "jedna odpowiedź to nie jest wynik");
});

test("seria głosów klienta liczy się od PIERWSZEGO — nie od ostatniego", () => {
  pytanieOtwarte(2);
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 2, typ: "zalozona", kto: "klient", kiedy: godzinTemu(30) });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 2, typ: "klient_napisal", kto: "klient",
    kiedy: godzinTemu(20), wariant: "m2",
  });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 2, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(10), wariant: "a",
  });
  /* Klient czekał 20 godzin, nie 10: liczenie od ostatniej wiadomości dawałoby
     najlepszy wynik dokładnie tam, gdzie obsługa była najgorsza. */
  assert.equal(C.czasyObslugi(7).odcinki[0].medianaH, 20);
});

test("odpowiedź bez pytania nie jest odcinkiem, a okno tnie po ODPOWIEDZI", () => {
  pytanieOtwarte(3);
  /* Nasza inicjatywa — nikt nie czekał. */
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 3, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(5), wariant: "a",
  });
  assert.equal(C.czasyObslugi(7).odcinki[0].ile, 0);

  /* Para sprzed okna: pytanie i odpowiedź starsze niż 7 dni. */
  pytanieOtwarte(4);
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 4, typ: "zalozona", kto: "klient", kiedy: godzinTemu(24 * 20) });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 4, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(24 * 19), wariant: "a",
  });
  assert.equal(C.czasyObslugi(7).odcinki[0].ile, 0, "poza oknem");
  assert.equal(C.czasyObslugi(30).odcinki[0].ile, 1, "w oknie 30 dni już jest");
  assert.equal(C.czasyObslugi(7).odcinki[0].czemuPusto !== null, true, "pustka mówi dlaczego");
});

test("kanały liczą się osobno — pytania obok dyskusji", () => {
  pytanieOtwarte(5);
  db()
    .prepare(
      `INSERT INTO dyskusja(id, allegro_id, status, temat, kupujacy_login, widziano_at, utworzono_at)
       VALUES (9, 'd-9', 'nowa', 't', 'ewa', ?, ?)`
    )
    .run(new Date().toISOString(), new Date().toISOString());
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 5, typ: "zalozona", kto: "klient", kiedy: godzinTemu(9) });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 5, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(8), wariant: "a",
  });
  O.dopiszZdarzenie({ rodzaj: "dyskusja", lokalnyId: 9, typ: "zalozona", kto: "klient", kiedy: godzinTemu(9) });
  O.dopiszZdarzenie({
    rodzaj: "dyskusja", lokalnyId: 9, typ: "odpowiedzielismy", kto: "my", autor: "Bartek",
    kiedy: godzinTemu(4), wariant: "a",
  });
  const w = C.czasyObslugi(7);
  assert.equal(w.odcinki.find((o) => o.klucz === "pytanie")?.medianaH, 1);
  assert.equal(w.odcinki.find((o) => o.klucz === "dyskusja")?.medianaH, 5);
  assert.equal(w.odcinki.find((o) => o.klucz === "wszystko")?.ile, 2);
});

test("czeka teraz: tylko sprawy otwarte i tylko te bez naszej odpowiedzi", () => {
  pytanieOtwarte(6, "kto_czeka");
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 6, typ: "zalozona", kto: "klient", kiedy: godzinTemu(12) });

  /* Sprawa, w której już odpisaliśmy — piłka jest u klienta, nie u nas. */
  pytanieOtwarte(7, "juz_odpisane");
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 7, typ: "zalozona", kto: "klient", kiedy: godzinTemu(30) });
  O.dopiszZdarzenie({
    rodzaj: "pytanie", lokalnyId: 7, typ: "odpowiedzielismy", kto: "my", autor: "Anna",
    kiedy: godzinTemu(29), wariant: "a",
  });

  /* Sprawa ZAMKNIĘTA w rejestrze — nikt na nią nie czeka, choć oś czasu
     kończy się głosem klienta. */
  pytanieOtwarte(8, "zamkniete");
  db().prepare("UPDATE pytanie SET status = 'wyslane' WHERE id = 8").run();
  O.dopiszZdarzenie({ rodzaj: "pytanie", lokalnyId: 8, typ: "zalozona", kto: "klient", kiedy: godzinTemu(99) });

  const teraz = C.czasyObslugi(7).teraz;
  assert.deepEqual(teraz.map((t) => t.klient), ["kto_czeka"]);
  assert.equal(teraz[0].godzin >= 11.9 && teraz[0].godzin <= 12.1, true);
});

test("monitoring pracowniczy jedzie z danymi, nie obok nich", () => {
  const w = C.czasyObslugi(7);
  assert.match(w.podstawaPrawna, /Kodeks pracy/);
  assert.equal(typeof w.progWiarygodnosci, "number");
});
