import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Wyłącznik obowiązkowego pomiaru przy dostawie ───────────────────────────
   Kolektor wie o decyzji właściciela wyłącznie z widoku dostawy. Gdy pole
   zginie po drodze, kolektor przyjmie „obowiązkowy" i przełącznik w panelu
   przestanie cokolwiek zmieniać, bez żadnego błędu. Ten plik pilnuje, że
   `POMIAR_PRZY_DOSTAWIE=0` dojeżdża do widoku jako `pomiarWymagany: false`. */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-pomiar-")), "t.db");
process.env.MAG_ID_MAG = "1";
process.env.MAG_ID_MGP = "2";
process.env.MAG_ID_ZWROTY = "3";
process.env.POMIAR_PRZY_DOSTAWIE = "0";

let db: typeof import("../db/db.js").db;
let D: typeof import("./delivery.js");
let C: typeof import("../config.js");

before(async () => {
  ({ db } = await import("../db/db.js"));
  D = await import("./delivery.js");
  C = await import("../config.js");
});

function dostawa(): number {
  return Number(
    db()
      .prepare(
        `INSERT INTO delivery(sgt_dok_id, sgt_dok_numer, status, opened_at, source_mag_id)
         VALUES (?,?, 'open', ?, 1)`
      )
      .run(900, "FZ 900/MAG/11/2026", new Date().toISOString()).lastInsertRowid
  );
}

test("wyłączony pomiar jedzie w widoku dostawy jako pomiarWymagany=false", () => {
  const id = dostawa();
  assert.equal(C.config.pomiarPrzyDostawie, false);
  assert.equal(D.getDelivery(id)?.pomiarWymagany, false);
});
