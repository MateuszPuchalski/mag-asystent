import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Konto rozstrzyga, KTO wykonał operację — błąd tutaj kończy się wpisem
   w audycie pod cudzym nazwiskiem, nie komunikatem na ekranie.               */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-usr-")), "t.db");

let db: typeof import("../db/db.js").db;
let U: typeof import("./users.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  U = await import("./users.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
  db().prepare("DELETE FROM device_session").run();
  db().prepare("DELETE FROM app_user").run();
});

/* ── Login ───────────────────────────────────────────────────────────────── */

test("login nie rozróżnia wielkości liter ani spacji", () => {
  // inaczej „Kowalski" i „kowalski" byłyby dwoma kontami tej samej osoby
  U.createUser("Jan Kowalski", "magazynier", "  JKowalski ", "tajnehaslo");
  assert.equal(U.userByLogin("jkowalski")?.name, "Jan Kowalski");
  assert.equal(U.userByLogin("JKOWALSKI")?.name, "Jan Kowalski");
});

test("kształt loginu jest zamknięty", () => {
  for (const dobry of ["jkowalski", "anna.nowak", "brygada_1", "p-nowak", "abc"]) {
    assert.ok(U.poprawnyLogin(dobry), dobry);
  }
  for (const zly of ["ab", "jan kowalski", "jan@wertis.pl", "żółw", "-start", ""]) {
    assert.ok(!U.poprawnyLogin(zly), zly);
  }
});

/* ── Hasło ───────────────────────────────────────────────────────────────── */

test("hasło nie jest przechowywane jawnie i weryfikuje się poprawnie", () => {
  const hash = U.hashSekret("tajnehaslo");
  assert.ok(!hash.includes("tajnehaslo"), "hasło nie może być odtwarzalne z hasza");
  assert.ok(U.sprawdzSekret("tajnehaslo", hash));
  assert.ok(!U.sprawdzSekret("tajnehasło", hash));
  assert.ok(!U.sprawdzSekret("tajnehaslo", null));
});

test("to samo hasło daje różne hasze — sól per konto", () => {
  // bez soli identyczne hasła widać w bazie gołym okiem
  assert.notEqual(U.hashSekret("tajnehaslo"), U.hashSekret("tajnehaslo"));
});

test("hasła nie widać w widoku konta", () => {
  const u = U.createUser("Jan Kowalski", "biuro", "jkowalski", "tajnehaslo");
  assert.equal(JSON.stringify(u).includes("tajnehaslo"), false);
  assert.equal(u.maHaslo, true, "widok mówi TYLKO, że hasło jest");
});

/* ── Konta ───────────────────────────────────────────────────────────────── */

test("konto bez hasła nie loguje się, ale zostaje w bazie", () => {
  // taki kształt ma konto-ślad: z migracji historii i po przejściu z plakietek
  const u = U.createUser("Historia Sprzed Kont");
  assert.equal(u.login, null);
  assert.equal(u.maHaslo, false);
  assert.ok(U.userById(u.userId), "historia ma na co wskazywać");
});

test("konto nieaktywne nie loguje się, ale zostaje w bazie", () => {
  const u = U.createUser("Były Pracownik", "magazynier", "bpracownik", "tajnehaslo");
  U.setActive(u.userId, false);
  assert.equal(U.userByLogin("bpracownik"), null, "nie zaloguje się");
  assert.ok(U.userById(u.userId), "ale historia ma na co wskazywać");
});

test("konto-ślad NIE otwiera furtki pierwszego konta", () => {
  /* Furtka liczy konta Z LOGINEM. Gdyby liczyła wiersze, każda instalacja
     z historią miałaby ją zamkniętą na głucho: żeby założyć konto, trzeba
     sesji, a żeby mieć sesję, trzeba konta. */
  U.createUser("Historia Sprzed Kont");
  assert.equal(U.brakKont(), true, "sam ślad nie jest kontem do logowania");
  U.createUser("Biuro Zakupy", "biuro", "biuro", "tajnehaslo");
  assert.equal(U.brakKont(), false);
});

/* ── Migracja historii ───────────────────────────────────────────────────── */

function zdarzenie(user: string) {
  db().prepare("INSERT INTO events(type, user_id) VALUES ('scan', ?)").run(user);
}

test("warianty tej samej osoby schodzą się w JEDNO konto", () => {
  // to jest powód, dla którego audyt dotąd był bezużyteczny
  zdarzenie("Jan");
  zdarzenie("jan");
  zdarzenie(" Jan ");
  const w = U.migrujHistorie();
  assert.equal(w.zalozonychKont, 1);
  assert.equal(w.przypisanychZdarzen, 3);
  assert.equal(U.listUsers().length, 1);
});

test("migracja nie kasuje ani nie nadpisuje historii", () => {
  zdarzenie("Anna");
  U.migrujHistorie();
  const r = db().prepare("SELECT user_id, user_ref FROM events").get() as {
    user_id: string;
    user_ref: number | null;
  };
  assert.equal(r.user_id, "Anna", "tekstowy snapshot zostaje");
  assert.ok(r.user_ref, "obok dochodzi wskazanie na konto");
});

test("migracja jest idempotentna", () => {
  zdarzenie("Piotr");
  const pierwsza = U.migrujHistorie();
  const druga = U.migrujHistorie();
  assert.equal(pierwsza.przypisanychZdarzen, 1);
  assert.equal(druga.przypisanychZdarzen, 0, "drugie uruchomienie nic nie rusza");
  assert.equal(U.listUsers().length, 1, "i nie dubluje kont");
});

test("zdarzenie bez nazwy zostaje NIEPRZYPISANE, nie zgadywane", () => {
  db().prepare("INSERT INTO events(type, user_id) VALUES ('scan', '')").run();
  zdarzenie("Ewa");
  const w = U.migrujHistorie();
  assert.equal(w.zalozonychKont, 1);
  assert.equal(w.nieprzypisanych, 1, "puste zostaje z user_ref = NULL");
});

/* ── Konto demo admin/admin (0.53.2) ─────────────────────────────────────── */

test("seeded + pusta baza: powstaje admin/admin i da się nim zalogować", async () => {
  const { config } = await import("../config.js");
  assert.equal(config.sgtMode, "seeded", "test zakłada domyślny tryb demo");
  U.ziarnoKontaDemo();
  const konto = U.userByLogin("admin");
  assert.ok(konto, "konto demo miało powstać");
  assert.equal(konto!.role, "admin");
  // pełna ścieżka logowania — hasło krótsze niż HASLO_MIN jest tu ŚWIADOME
  const { zaloguj } = await import("./auth.js");
  assert.ok(zaloguj("admin", "admin", null), "login admin/admin ma działać");
});

test("istniejące konto z loginem zamyka ziarno — niczego nie dokłada i nie rusza", () => {
  U.createUser("Własne Konto", "magazynier", "wlasne", "tajnehaslo");
  U.ziarnoKontaDemo();
  assert.equal(U.userByLogin("admin"), null, "admin nie ma prawa powstać obok kont użytkownika");
});

test("w trybie mssql ziarno nie robi nic — stałe hasło nie jedzie na produkcję", async () => {
  const { config } = await import("../config.js");
  const tryb = config.sgtMode;
  try {
    (config as { sgtMode: string }).sgtMode = "mssql";
    U.ziarnoKontaDemo();
    assert.equal(U.userByLogin("admin"), null);
  } finally {
    (config as { sgtMode: string }).sgtMode = tryb;
  }
});
