import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* ── Guard kolejności workera Sfery — na PLIKACH, które wykonuje C# ─────────
   Wybór zadania mm z guardem „adres przed sprzedawalnością" to najbardziej
   ryzykowna logika workera Sfery, a jest czystym SQLite. Dlatego zapytania
   mieszkają w sfera-worker/sql/ i są czytane przez oba światy: C# jako
   EmbeddedResource, a ten test przez fs — JEDNO źródło prawdy, mierzone w CI
   bez dotneta i bez Windows.

   Niezmiennik (services/przesuniecie.ts): MM czyni towar sprzedawalnym;
   wykonane przed zapisem lokalizacji tego samego towaru dawałoby okno,
   w którym towar jest sprzedawalny pod starym albo pustym adresem — a przy
   trwałym błędzie lokalizacji stan ten byłby TRWAŁY.                         */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.resolve(__dirname, "../../../sfera-worker/sql");
const PICK_PENDING = fs.readFileSync(path.join(SQL_DIR, "pick_mm_pending.sql"), "utf8");
const PICK_WAITING = fs.readFileSync(path.join(SQL_DIR, "pick_mm_waiting.sql"), "utf8");

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pick-")), "t.db");

let db: typeof import("../db/db.js").db;

before(async () => {
  ({ db } = await import("../db/db.js"));
});

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
});

function dodaj(
  type: "mm" | "set_location" | "korekta_zwrot",
  twId: number | null,
  opts: { status?: string; nextAt?: string | null } = {}
): number {
  const info = db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, tw_id, next_attempt_at, created_at, created_by)
       VALUES (?,?,?,?,?,?, 'test')`
    )
    .run(
      type,
      "{}",
      opts.status ?? "pending",
      twId,
      opts.nextAt ?? null,
      new Date().toISOString()
    );
  return Number(info.lastInsertRowid);
}

const pickPending = (): { id: number } | undefined =>
  db().prepare(PICK_PENDING).get({ now: new Date().toISOString() }) as { id: number } | undefined;
const pickWaiting = (): { id: number } | undefined =>
  db().prepare(PICK_WAITING).get({ now: new Date().toISOString() }) as { id: number } | undefined;

// ── Blokada przez wcześniejsze set_location tego samego towaru ──────────────

for (const status of ["pending", "processing", "error"]) {
  test(`set_location w '${status}' z niższym id blokuje mm tego samego towaru`, () => {
    dodaj("set_location", 42, { status });
    dodaj("mm", 42);
    assert.equal(pickPending(), undefined);
  });
}

test("set_location w done/cancelled odblokowuje mm", () => {
  dodaj("set_location", 42, { status: "done" });
  dodaj("set_location", 42, { status: "cancelled" });
  const mm = dodaj("mm", 42);
  assert.equal(pickPending()?.id, mm);
});

test("set_location INNEGO towaru nie blokuje", () => {
  dodaj("set_location", 7);
  const mm = dodaj("mm", 42);
  assert.equal(pickPending()?.id, mm);
});

test("set_location o WYŻSZYM id nie blokuje wcześniejszego mm", () => {
  // człowiek zmienił adres PO zleceniu przesunięcia — to nowa decyzja,
  // nie poprzednik; mm ma wejść w swojej kolejności
  const mm = dodaj("mm", 42);
  dodaj("set_location", 42);
  assert.equal(pickPending()?.id, mm);
});

test("każdy pass widzi wyłącznie mm we własnym statusie", () => {
  dodaj("set_location", 1);
  const czekajace = dodaj("mm", 2, { status: "waiting_for_doc" });
  dodaj("mm", 3, { status: "done" });
  dodaj("mm", 4, { status: "error" });
  assert.equal(pickPending(), undefined);
  assert.equal(pickWaiting()?.id, czekajace);
});

test("next_attempt_at w przyszłości wstrzymuje wybór (backoff)", () => {
  dodaj("mm", 42, { nextAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(pickPending(), undefined);
});

test("next_attempt_at w przeszłości nie wstrzymuje", () => {
  const mm = dodaj("mm", 42, { nextAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(pickPending()?.id, mm);
});

test("guard działa też w pass waiting_for_doc", () => {
  dodaj("set_location", 42, { status: "error" });
  dodaj("mm", 42, { status: "waiting_for_doc" });
  assert.equal(pickWaiting(), undefined);
});

test("najstarsze odblokowane mm wychodzi pierwsze (ORDER BY id)", () => {
  const pierwsze = dodaj("mm", 1);
  dodaj("mm", 2);
  assert.equal(pickPending()?.id, pierwsze);
});
test("worker Sfery bierze też korektę zwrotu, a guard lokalizacji jej nie dotyczy", () => {
  /* `korekta_zwrot` powstaje z wielu pozycji, więc nie ma jednego `tw_id`
     i guard „adres przed sprzedawalnością" jej nie obejmuje. To poprawne:
     korekta nie czyni towaru sprzedawalnym — zabiera go na bufor zwrotowy. */
  const lokalizacja = dodaj("set_location", 900_036);
  const korekta = dodaj("korekta_zwrot", null);
  assert.equal(pickPending()?.id, korekta, "czekanie na zapis adresu nie ma tu sensu");

  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(korekta);
  db().prepare("UPDATE sfera_queue SET status='done' WHERE id=?").run(lokalizacja);
  const czekajaca = dodaj("korekta_zwrot", null, { status: "waiting_for_doc" });
  assert.equal(pickWaiting()?.id, czekajaca);
});
