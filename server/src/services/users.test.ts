import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Badge rozstrzyga, KTO wykonał operację — błąd tutaj kończy się wpisem
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

/* ── Wektory WSPÓLNE z :core ────────────────────────────────────────────────
   Cyfra kontrolna ma dwie niezależne implementacje — TypeScript tutaj
   i Kotlin w `core/badge/Badge.kt` — bo algorytmu nie da się wysłać jako
   wzorca, tak jak wysyłamy wzorce lokalizacji. Duplikacja jest więc
   nieunikniona, ale rozjazd już nie: TA SAMA tabela jest zaasertowana po obu
   stronach (`BadgeTest.kt`). Trzy niezależne kopie jednej reguły były
   przyczyną §1 — ta ma dokładnie dwie i test, który je spina.                */
const WEKTORY: Array<[number, string]> = [
  [1, "PRC-0001-9"],
  [7, "PRC-0007-3"],
  [42, "PRC-0042-6"],
  [999, "PRC-0999-5"],
  [1234, "PRC-1234-2"],
  [9999, "PRC-9999-8"],
];

test("kody badge zgadzają się z implementacją kolektora", () => {
  for (const [numer, kod] of WEKTORY) assert.equal(U.badgeCode(numer), kod, String(numer));
});

test("odczyt wraca do numeru", () => {
  for (const [numer, kod] of WEKTORY) assert.equal(U.parseBadge(kod), numer);
});

test("przekłamana cyfra to odmowa, NIE cudzy badge", () => {
  // bez cyfry kontrolnej starty znak zamienia Jana w Piotra, a audyt wskazuje
  // niewinnego — to jest różnica między „nie odczytano" a „odczytano źle"
  assert.equal(U.parseBadge("PRC-0007-4"), null);
  assert.equal(U.parseBadge("PRC-0008-3"), null);
  assert.equal(U.parseBadge("PRC-0070-3"), null, "przestawione sąsiednie cyfry");
});

test("co nie jest badgem, nie udaje badge'a", () => {
  for (const zly of ["PRC-007-3", "ABC-0007-3", "A01-02-03", "5901234567890", ""]) {
    assert.equal(U.parseBadge(zly), null, zly);
  }
});

/* ── PIN ─────────────────────────────────────────────────────────────────── */

test("PIN nie jest przechowywany jawnie i weryfikuje się poprawnie", () => {
  const hash = U.hashPin("4821");
  assert.ok(!hash.includes("4821"), "PIN nie może być odtwarzalny z hasza");
  assert.ok(U.sprawdzPin("4821", hash));
  assert.ok(!U.sprawdzPin("4822", hash));
  assert.ok(!U.sprawdzPin("4821", null));
});

test("ten sam PIN daje różne hasze — sól per konto", () => {
  // bez soli identyczne PIN-y widać w bazie gołym okiem
  assert.notEqual(U.hashPin("1111"), U.hashPin("1111"));
});

/* ── Konta ───────────────────────────────────────────────────────────────── */

test("numery badge nadaje serwer, kolejno i bez powtórzeń", () => {
  const a = U.createUser("Jan Kowalski");
  const b = U.createUser("Anna Nowak");
  assert.equal(a.badgeCode, "PRC-0001-9");
  assert.equal(b.badgeCode, "PRC-0002-8");
  assert.equal(U.userByBadge("PRC-0002-8")?.name, "Anna Nowak");
});

test("badge nie niesie nazwiska", () => {
  // badge się gubi i zostaje na kurtce
  const u = U.createUser("Jan Kowalski");
  assert.ok(!u.badgeCode.toLowerCase().includes("kowalski"));
  assert.ok(!u.badgeCode.toLowerCase().includes("jan"));
});

test("konto nieaktywne nie loguje się badgem, ale zostaje w bazie", () => {
  const u = U.createUser("Były Pracownik");
  U.setActive(u.userId, false);
  assert.equal(U.userByBadge(u.badgeCode), null, "nie zaloguje się");
  assert.ok(U.userById(u.userId), "ale historia ma na co wskazywać");
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
