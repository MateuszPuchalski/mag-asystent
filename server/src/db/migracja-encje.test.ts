import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

/* ── Jednorazowe zdjęcie encji HTML (0.127.0) ────────────────────────────────
   Do 0.127.0 adapter zapisywał teksty Allegro dosłownie, więc w bazach
   produkcyjnych leżą `zwr&oacute;cić`. Migracja ma je zdekodować RAZ — i nie
   ruszyć niczego innego. Konstrukcja jak w migracja-kont.test.ts: bazę „sprzed"
   budujemy surowo (tu: dzisiejszym schematem, bo migracja goni DANE, nie
   kształt tabel), zamykamy plik i dopiero wtedy importujemy `db.js`.         */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-encje-"));
const plik = path.join(katalog, "stara.db");

const schemat = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql"),
  "utf8"
);
const stara = new DatabaseSync(plik);
stara.exec(schemat);
stara.exec(`
  INSERT INTO dyskusja (allegro_id, temat, widziano_at, utworzono_at) VALUES
    ('d-enc', 'Zwrot cz&eogon;&sacute;ci &#380;eliwnej', '2026-08-01', '2026-08-01'),
    ('d-czysty', 'Zwykły temat & spółka', '2026-08-01', '2026-08-01');
  INSERT INTO pytanie (zrodlo, thread_id, wiadomosc_id, tresc, oferta_tytul, otrzymano_at, status, utworzono_at, utworzono_przez) VALUES
    ('allegro', 't1', 'w1', 'czy zwr&oacute;cicie pieni&aogon;dze?', 'Ko&sacute; spalinowa', '2026-08-01', 'nowe', '2026-08-01', 'sync'),
    ('allegro', 't2', 'w2', 'pytanie bez encji', 'Tytuł bez encji', '2026-08-01', 'nowe', '2026-08-01', 'sync');
`);
stara.close();

process.env.DB_PATH = plik;
process.env.SGT_MODE = "seeded";

let db: typeof import("./db.js").db;

before(async () => {
  ({ db } = await import("./db.js"));
});

test("encje w zastanych wierszach dekodują się przy pierwszym otwarciu", () => {
  const d = db()
    .prepare("SELECT temat FROM dyskusja WHERE allegro_id = 'd-enc'")
    .get() as { temat: string };
  assert.equal(d.temat, "Zwrot części żeliwnej");
  const p = db()
    .prepare("SELECT tresc, oferta_tytul FROM pytanie WHERE thread_id = 't1'")
    .get() as { tresc: string; oferta_tytul: string };
  assert.equal(p.tresc, "czy zwrócicie pieniądze?");
  assert.equal(p.oferta_tytul, "Koś spalinowa");
});

test("wiersz bez encji zostaje bajt w bajt — także z gołym ampersandem", () => {
  /* `& spółka` łapie się w prefiltr LIKE '%&%;%' przez średnik dalej w bazie?
     Nie — w tym wierszu średnika nie ma, ale nawet gdyby był, dekoder nie zna
     `& s` i zostawia tekst. Ten test pilnuje obu furtek naraz. */
  const d = db()
    .prepare("SELECT temat FROM dyskusja WHERE allegro_id = 'd-czysty'")
    .get() as { temat: string };
  assert.equal(d.temat, "Zwykły temat & spółka");
  const p = db()
    .prepare("SELECT tresc, oferta_tytul FROM pytanie WHERE thread_id = 't2'")
    .get() as { tresc: string; oferta_tytul: string };
  assert.equal(p.tresc, "pytanie bez encji");
  assert.equal(p.oferta_tytul, "Tytuł bez encji");
});
