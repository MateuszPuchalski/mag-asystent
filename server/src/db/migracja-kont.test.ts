import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/* ── Przejście z plakietek na login i hasło ─────────────────────────────────
   Jedyna przebudowa tabeli w tym repo, a przy tym jedyne miejsce, w którym
   błąd kosztuje DANE, a nie komunikat. Dlatego test nie sprawdza kształtu
   tabeli „na oko", tylko trzy rzeczy, których nikt inny nie zauważy:

     1. konta zostają razem ze swoimi identyfikatorami — bo `events.user_ref`
        i `sfera_queue.created_by_ref` wskazują właśnie na nie,
     2. sesje sprzed zmiany są unieważnione — token wydany po skanie plakietki
        nie ma prawa przeżyć zmiany mechanizmu wejścia,
     3. furtka pierwszego konta jest OTWARTA — inaczej instalacji nie dałoby
        się odblokować niczym poza ręczną zmianą w bazie.

   Konstrukcja jest nietypowa względem reszty testów: STARĄ tabelę budujemy
   ręcznie surowym SQL-em, zamykamy plik i dopiero wtedy importujemy `db.js`,
   bo migracja odpala się przy pierwszym otwarciu bazy.                       */

const katalog = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-migr-"));
const plik = path.join(katalog, "stara.db");

// Schemat sprzed 0.20.0 — dokładnie tyle, ile potrzeba, żeby migracja miała co robić.
const stara = new DatabaseSync(plik);
stara.exec(`
  CREATE TABLE app_user (
    user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    badge_code TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    pin_hash   TEXT,
    role       TEXT NOT NULL DEFAULT 'magazynier',
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE device_session (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES app_user(user_id),
    device_id  TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    revoked_at TEXT
  );
  INSERT INTO app_user(user_id, badge_code, name, pin_hash, role) VALUES
    (1,'PRC-0001-9','Biuro Zakupy','sol:hasz','biuro'),
    (7,'PRC-0007-3','Jan Kowalski',NULL,'magazynier');
  INSERT INTO device_session(token, user_id) VALUES ('stary-token', 7);
`);
stara.close();

process.env.DB_PATH = plik;

let db: typeof import("./db.js").db;
let U: typeof import("../services/users.js");

before(async () => {
  ({ db } = await import("./db.js"));
  U = await import("../services/users.js");
});

test("baza z plakietkami przechodzi na loginy bez utraty konta", () => {
  const kolumny = (db().prepare("PRAGMA table_info(app_user)").all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  assert.equal(kolumny.includes("badge_code"), false, "kolumna plakietki wychodzi");
  assert.equal(kolumny.includes("pin_hash"), false, "PIN wychodzi razem z nią");
  assert.ok(kolumny.includes("login") && kolumny.includes("haslo_hash"));
  assert.equal(U.listUsers().length, 2, "żadne konto nie znika");
});

test("identyfikatory kont nie zmieniają się, więc audyt dalej wskazuje na kogo trzeba", () => {
  // przenumerowanie kont przypisałoby całą historię niewłaściwym osobom —
  // bez jednego objawu, aż do pierwszej reklamacji
  assert.equal(U.userById(1)?.name, "Biuro Zakupy");
  assert.equal(U.userById(7)?.name, "Jan Kowalski");
});

test("konta po migracji nie mają czym się zalogować, ale zostają jako ślad", () => {
  for (const id of [1, 7]) {
    const u = U.userById(id)!;
    assert.equal(u.login, null);
    assert.equal(u.maHaslo, false);
  }
});

test("sesje sprzed zmiany są unieważnione", () => {
  const r = db().prepare("SELECT revoked_at FROM device_session WHERE token='stary-token'").get() as {
    revoked_at: string | null;
  };
  assert.ok(r.revoked_at, "token po skanie plakietki nie przeżywa zmiany wejścia");
});

test("furtka pierwszego konta jest OTWARTA — inaczej instalacja byłaby martwa", () => {
  /* Konta-ślady zostają w tabeli na zawsze. Gdyby liczyły się do warunku
     `brakKont()`, biuro nie miałoby jak założyć pierwszego konta z hasłem:
     żeby założyć konto, trzeba sesji, a żeby mieć sesję, trzeba konta. */
  assert.equal(U.brakKont(), true);
});

test("po przebudowie nie ma osieroconych sesji", () => {
  /* Przebudowa kasuje tabelę rodzica przy WYŁĄCZONYCH kluczach obcych —
     inaczej `DROP TABLE` padłby przy starcie usługi. Wyłączenie kluczy zdejmuje
     jednak sprawdzanie, więc dowód, że nic nie zostało, musi być osobny. */
  const rozjazdy = db().prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(rozjazdy, []);
});

test("klucze obce wracają włączone po migracji", () => {
  // zostawienie ich wyłączonych oznaczałoby bazę bez ochrony do restartu
  const r = db().prepare("PRAGMA foreign_keys").get() as Record<string, number>;
  assert.equal(Object.values(r)[0], 1);
});
