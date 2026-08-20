import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Zapowiedzi zwrotów (Etap 4) ─────────────────────────────────────────────
   Sedno: system zna zgłoszenie ZANIM paczka dojedzie. Ticker upsertuje bez
   duplikatów, skan trafia w zapowiedź po KTÓRYMKOLWIEK numerze paczki
   i odhacza ją, a panel brakujących pokazuje tylko to, co czeka za długo.  */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-zapo-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let Z: typeof import("./zapowiedzi.js");
let Zw: typeof import("./zwroty.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  Z = await import("./zapowiedzi.js");
  Zw = await import("./zwroty.js");
});

beforeEach(() => {
  const d = db();
  // zapowiedź wskazuje zwrot (FK), więc schodzi z bazy PRZED zwrotami
  for (const t of ["kosz_pozycja", "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot_zapowiedz", "zwrot", "sfera_queue"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
});

test("przebieg tickera: upsert bez duplikatów, drugi raz zero nowych", async () => {
  assert.equal(await Z.odswiezZapowiedzi(), 3, "trzy fikcyjne zgłoszenia adaptera dev");
  assert.equal(await Z.odswiezZapowiedzi(), 0, "te same zgłoszenia nie liczą się drugi raz");
  const n = (db().prepare("SELECT COUNT(*) AS n FROM zwrot_zapowiedz").get() as { n: number }).n;
  assert.equal(n, 3);
});

test("skan trafia w zapowiedź po każdym numerze paczki zgłoszenia", async () => {
  await Z.odswiezZapowiedzi();
  // dev-ret-2 ma waybill nadania DEVWB0002 i numer doręczyciela DEVTW0002
  assert.equal(Z.zapowiedzDlaWaybilla("DEVWB0002")?.allegroReturnId, "dev-ret-2");
  assert.equal(Z.zapowiedzDlaWaybilla("DEVTW0002")?.allegroReturnId, "dev-ret-2");
  assert.equal(Z.zapowiedzDlaWaybilla("OBCY-NUMER"), null);
});

test("przyjęcie skanem odhacza zgłoszenie i zdejmuje je z brakujących", async () => {
  await Z.odswiezZapowiedzi();
  // dev-ret-3 czeka 5 dni — powyżej progu 3 dni, więc jest alarmem…
  assert.ok(Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
  // …a świeże zgłoszenie sprzed dnia (dev-ret-2) alarmem nie jest
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0002"));

  const w = await Zw.utworzZeSkanu("DEVWB0003", "Test");
  assert.equal(w.rodzaj, "utworzony");
  const zap = db()
    .prepare("SELECT status, zwrot_id FROM zwrot_zapowiedz WHERE allegro_return_id='dev-ret-3'")
    .get() as { status: string; zwrot_id: number | null };
  assert.equal(zap.status, "dotarl");
  assert.ok(zap.zwrot_id, "zapowiedź wskazuje przyjęty zwrot");
  assert.ok(!Z.brakujacePaczki().some((b) => b.referencja === "ZW-DEV-0003"));
});

test("zgłoszenie zwrotu przyjętego PRZED przebiegiem rodzi się jako dotarłe", async () => {
  // paczka wyprzedziła ticker: najpierw skan…
  const w = await Zw.utworzZeSkanu("DEVWB0001", "Test");
  assert.equal(w.rodzaj, "utworzony");
  // …potem pierwszy przebieg — zgłoszenie nie ma prawa wisieć wśród brakujących
  await Z.odswiezZapowiedzi();
  const zap = db()
    .prepare("SELECT status FROM zwrot_zapowiedz WHERE allegro_return_id='dev-ret-1'")
    .get() as { status: string };
  assert.equal(zap.status, "dotarl");
});

test("liczby do raportu: oczekujące i brakujące osobno", async () => {
  await Z.odswiezZapowiedzi();
  const l = Z.liczbyZapowiedzi();
  assert.equal(l.oczekujace, 3);
  assert.ok(l.brakujace >= 1 && l.brakujace < 3, "alarmem jest stare zgłoszenie, nie wczorajsze");
});
