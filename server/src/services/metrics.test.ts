import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* Metryki są jedynym miejscem, gdzie zdarzenia zamieniają się w LICZBY, po
   których ktoś podejmie decyzję („przedrukuj etykietę na tym regale"). Pomyłka
   w agregacji nie wywala niczego — po prostu wskazuje zły regał.             */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-met-")), "t.db");

let db: typeof import("../db/db.js").db;
let metrics: typeof import("./raporty.js").metrics;

before(async () => {
  ({ db } = await import("../db/db.js"));
  ({ metrics } = await import("./raporty.js"));
});

function zdarzenie(type: string, payload: unknown = null, dni = 0) {
  db()
    .prepare(
      `INSERT INTO events(type, payload, user_id, created_at)
       VALUES (?,?,'test', datetime('now', ?))`
    )
    .run(type, payload == null ? null : JSON.stringify(payload), `-${dni} days`);
}

beforeEach(() => {
  db().prepare("DELETE FROM events").run();
});

test("pusty magazyn — brak danych to null, nie zero", () => {
  const m = metrics(7);
  // zero i „nie wiem" to dwie różne rzeczy; zero sugerowałoby idealny wynik
  assert.equal(m.dotknieciaNaPozycje, null);
  assert.equal(m.p95OdpowiedziMs, null);
  assert.equal(m.zdarzen, 0);
});

test("dotknięcia na pozycję — główny wskaźnik jakości UX", () => {
  for (let i = 0; i < 10; i++) zdarzenie("putaway_line_done");
  zdarzenie("manual_entry", { code: "A01-02-03", kind: "LOC" });
  zdarzenie("location_mismatch");
  assert.equal(metrics(7).dotknieciaNaPozycje, 0.2);
});

test("p95 czasu odpowiedzi bierze ogon, nie średnią", () => {
  // 10% skanów wolnych: średnia (180 ms) mieści się w celu <150? nie — ale
  // rozmywa problem do „trochę wolno"; p95 pokazuje, ile trwa ZŁY przypadek,
  // czyli ten, przez który człowiek skanuje drugi raz
  for (let i = 0; i < 90; i++) zdarzenie("scan_timing", { ms: 100 });
  for (let i = 0; i < 10; i++) zdarzenie("scan_timing", { ms: 900 });
  assert.equal(metrics(7).p95OdpowiedziMs, 900);
});

test("etykieta wpisywana ręcznie wskazuje regał do przedruku", () => {
  zdarzenie("scan", { code: "A01-02-03", kind: "LOC" });
  zdarzenie("manual_entry", { code: "A01-02-03", kind: "LOC" });
  zdarzenie("manual_entry", { code: "A01-02-03", kind: "LOC" });
  zdarzenie("scan", { code: "B02-02-02", kind: "LOC" });

  const m = metrics(7);
  const zly = m.etykietyDoPrzedruku.find((r) => r.code === "A01-02-03");
  assert.equal(zly?.reczne, 2);
  assert.equal(zly?.razem, 3);
  assert.equal(zly?.udzial, 0.67);
  // regał, którego nikt nie wpisywał ręcznie, nie ma po co być na liście
  assert.equal(m.etykietyDoPrzedruku.some((r) => r.code === "B02-02-02"), false);
});

test("towar i regał lądują na osobnych listach", () => {
  zdarzenie("manual_entry", { code: "A01-02-03", kind: "LOC" });
  zdarzenie("manual_entry", { code: "W32-0203", kind: "TEXT" });
  const m = metrics(7);
  assert.deepEqual(m.etykietyDoPrzedruku.map((r) => r.code), ["A01-02-03"]);
  assert.deepEqual(m.towaryBezCzytelnegoKodu.map((r) => r.code), ["W32-0203"]);
});

test("okno czasowe odcina stare zdarzenia", () => {
  zdarzenie("scan_timing", { ms: 500 }, 30);
  assert.equal(metrics(7).p95OdpowiedziMs, null);
  assert.equal(metrics(60).p95OdpowiedziMs, 500);
});

test("okno jest ograniczone — brak wstrzyknięcia przez parametr", () => {
  zdarzenie("scan_timing", { ms: 500 });
  // wartości spoza zakresu nie mogą wysadzić zapytania ani zwrócić wszystkiego
  assert.doesNotThrow(() => metrics(0));
  assert.doesNotThrow(() => metrics(99999));
  assert.doesNotThrow(() => metrics(-5));
});
