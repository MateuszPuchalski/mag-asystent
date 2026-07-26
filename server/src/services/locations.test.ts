import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Reguła „co jest w drodze" wyprowadza zmianę POJEDYNCZYCH kodów z payloadu,
   który niesie CAŁE pole lokalizacji. To jedyne miejsce, gdzie ta różnica
   powstaje — i jedyne, w którym łatwo o pomyłkę, więc ma własny test.

   Baza tymczasowa (nie ta z seedu), bo funkcja czyta kolejkę z SQLite.        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-loc-")), "t.db");

let db: typeof import("../db/db.js").db;
let pendingLocChanges: typeof import("./locations.js").pendingLocChanges;
let validateLocationCode: typeof import("./locations.js").validateLocationCode;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ pendingLocChanges, validateLocationCode } = await import("./locations.js"));
});

/* ── Walidacja kodu (plan §1) ─────────────────────────────────────────────── */

test("symbol towaru NIE jest poprawną lokalizacją", () => {
  // sedno poprawki: `W32-0203` przechodziło, bo miało literę i nie miało spacji
  assert.equal(validateLocationCode("W32-0203"), "To kod towaru, nie etykieta regału");
  assert.equal(validateLocationCode("50-111"), "To kod towaru, nie etykieta regału");
});

test("poprawne adresy przechodzą", () => {
  for (const kod of ["A01-02-03", "J14-05-02", "PAL-042", "a01-02-03"]) {
    assert.equal(validateLocationCode(kod), null, kod);
  }
});

test("bazowe reguły działają niezależnie od wzorca", () => {
  assert.equal(validateLocationCode(""), "Pusty kod lokalizacji");
  assert.match(validateLocationCode("A01 02-03") ?? "", /spacj/);
  assert.match(validateLocationCode("5901234567890") ?? "", /EAN/);
});

test("literówka z kartoteki jest błędem, nie adresem", () => {
  // C07A-06-01 to znany dług danych — walidator ma go odrzucać, nie naprawiać
  assert.notEqual(validateLocationCode("C07A-06-01"), null);
});

const TW = 7;

function zadanie(newValue: string, status = "pending"): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, created_by)
         VALUES ('set_location', ?, ?, 'L', 'D', ?, 'test')`
      )
      .run(JSON.stringify({ twId: TW, newValue }), status, TW).lastInsertRowid
  );
}

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
});

test("brak zadań → nic nie jest w drodze", () => {
  assert.deepEqual(pendingLocChanges(TW, ["A01-01-01"]), []);
});

test("dodanie kodu do istniejącej listy", () => {
  const id = zadanie("A01-01-01 B02-02-02");
  assert.deepEqual(pendingLocChanges(TW, ["A01-01-01"]), [
    { code: "B02-02-02", kind: "add", status: "pending", queueId: id },
  ]);
});

test("usunięcie ostatniego kodu — pusta wartość to też zmiana", () => {
  const id = zadanie("");
  assert.deepEqual(pendingLocChanges(TW, ["A01-01-01"]), [
    { code: "A01-01-01", kind: "remove", status: "pending", queueId: id },
  ]);
});

test("zamiana kodu = jednocześnie dodanie i usunięcie", () => {
  zadanie("C03-03-03");
  const p = pendingLocChanges(TW, ["A01-01-01"]);
  assert.equal(p.length, 2);
  assert.deepEqual(
    p.map((x) => [x.code, x.kind]).sort(),
    [["A01-01-01", "remove"], ["C03-03-03", "add"]]
  );
});

test("dwa zadania w kolejce — liczy się WYNIK, czyli ostatnie", () => {
  zadanie("B02-02-02");
  const drugie = zadanie("D04-04-04");
  // pierwsze i tak zostanie nadpisane przez drugie, więc B nie jest „w drodze"
  assert.deepEqual(pendingLocChanges(TW, []), [
    { code: "D04-04-04", kind: "add", status: "pending", queueId: drugie },
  ]);
});

test("zadanie w błędzie ma inny status — samo się nie wykona", () => {
  const id = zadanie("B02-02-02", "error");
  assert.deepEqual(pendingLocChanges(TW, []), [
    { code: "B02-02-02", kind: "add", status: "error", queueId: id },
  ]);
});

test("błąd wygrywa nad oczekiwaniem — to on wymaga reakcji", () => {
  const zly = zadanie("B02-02-02", "error");
  zadanie("B02-02-02");
  const p = pendingLocChanges(TW, []);
  assert.equal(p.length, 1);
  assert.equal(p[0].status, "error");
  assert.equal(p[0].queueId, zly);
});

test("zadanie innej kartoteki nie przecieka", () => {
  db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, label, detail, tw_id, created_by)
       VALUES ('set_location', ?, 'pending', 'L', 'D', 999, 'test')`
    )
    .run(JSON.stringify({ twId: 999, newValue: "Z09-09-09" }));
  assert.deepEqual(pendingLocChanges(TW, []), []);
});

test("zadanie zakończone nie jest już w drodze", () => {
  zadanie("B02-02-02", "done");
  assert.deepEqual(pendingLocChanges(TW, []), []);
});
