import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Worker Node przy SFERA_WORKER=1 ────────────────────────────────────────
   Przy włączonym przełączniku zadania mm wykonuje osobny proces
   (sfera-worker/), a ten worker ma ich NIE DOTYKAĆ — inaczej oznaczyłby je
   jako error padającym adapterem SQL, zanim worker Sfery zdąży je wziąć.

   OSOBNY plik testowy, bo config jest literałem zamrożonym przy imporcie:
   SFERA_WORKER musi stać w env, zanim cokolwiek go wczyta. node:test
   uruchamia każdy plik w osobnym procesie, więc to działa — i dlatego
   scenariusze „bez przełącznika" mieszkają w kolejka.test.ts, nie tu.        */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sfw-")), "t.db");
process.env.WORKER_SIM_ERRORS = "0";
process.env.SFERA_WORKER = "1";
// bledyKonfiguracji odrzuca SFERA_WORKER=1 przy seeded; testom nie wolno
// otwierać połączenia MSSQL, więc tryb ustawiamy tylko na poziomie config
process.env.SGT_MODE = "mssql";
process.env.MSSQL_DATABASE = "test";
process.env.MSSQL_USER = "test";
process.env.MSSQL_PASSWORD = "test";

let db: typeof import("../db/db.js").db;
let K: typeof import("./kolejka.js");
let PS: typeof import("../services/process-state.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  K = await import("./kolejka.js");
  PS = await import("../services/process-state.js");
});

beforeEach(() => {
  db().prepare("DELETE FROM sfera_queue").run();
  db().prepare("DELETE FROM process_state").run();
});

function dodajZadanie(
  type: string,
  opts: { status?: string; twId?: number | null } = {}
): number {
  const info = db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, tw_id, created_at, created_by)
       VALUES (?,?,?,?,?, 'test')`
    )
    .run(type, "{}", opts.status ?? "pending", opts.twId ?? null, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

// ── Podział pracy: mm należy do workera Sfery ───────────────────────────────

test("pickTask pomija mm w pending i bierze set_location o wyższym id", () => {
  dodajZadanie("mm");
  const loc = dodajZadanie("set_location");
  // mm ma niższy id, a mimo to nie może zablokować kolejki Node'a
  assert.equal(K.pickTask()?.id, loc);
});

test("pickTask pomija mm w waiting_for_doc", () => {
  dodajZadanie("mm", { status: "waiting_for_doc" });
  assert.equal(K.pickTask(), undefined);
});

test("zadanie nieznanego typu nadal bierze Node — ma skończyć błędem, nie ciszą", () => {
  // seed S48: filtr to `type <> 'mm'`, nie `type = 'set_location'` — literówka
  // w typie ma dostać czytelny błąd od workera Node, a nie wisieć w pending
  const id = dodajZadanie("przecena");
  assert.equal(K.pickTask()?.id, id);
});

// ── stanSfery: zdania dla /api/health ───────────────────────────────────────

const zamelduj = (przed: number, sgtMode = "mssql") =>
  db()
    .prepare(
      "INSERT INTO process_state(name, pid, sgt_mode, sfera_mode, at) VALUES ('sfera', 1, ?, 'com', ?)"
    )
    .run(sgtMode, new Date(Date.now() - przed).toISOString());

test("stanSfery: brak wiersza to problem — worker nigdy nie wystartował", () => {
  const s = PS.stanSfery();
  assert.equal(s.zyje, false);
  assert.match(s.problem ?? "", /nigdy nie wystartował/);
});

test("stanSfery: świeży meldunek = żyje, bez problemu", () => {
  zamelduj(1000);
  const s = PS.stanSfery();
  assert.equal(s.zyje, true);
  assert.equal(s.problem, null);
});

test("stanSfery: meldunek starszy niż 30 s to problem, z liczbą czekających MM", () => {
  zamelduj(60_000);
  dodajZadanie("mm");
  dodajZadanie("mm", { status: "waiting_for_doc" });
  const s = PS.stanSfery();
  assert.equal(s.zyje, false);
  assert.match(s.problem ?? "", /nie melduje się/);
  assert.match(s.problem ?? "", /2 zad\. MM/);
});

test("stanSfery: rozjazd trybu z API to problem", () => {
  zamelduj(1000, "seeded");
  assert.match(PS.stanSfery().problem ?? "", /ROZJAZD KONFIGURACJI/);
});

test("zaleglosciMm: mm starsze niż godzina daje zdanie, świeże nie", () => {
  assert.equal(PS.zaleglosciMm(), null);
  dodajZadanie("mm"); // świeże — nie liczy się
  assert.equal(PS.zaleglosciMm(), null);
  // format ISO jak w aplikacji — porównanie progu jest leksykalne
  db()
    .prepare(
      `INSERT INTO sfera_queue(type, payload, status, created_at, created_by)
       VALUES ('mm', '{}', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours'), 'test')`
    )
    .run();
  assert.match(PS.zaleglosciMm() ?? "", /1 zad\. MM czeka ponad godzinę/);
});