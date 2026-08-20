import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* ── Adapter dev Sfery — skutek magazynowy korekty zwrotu ────────────────────
   Adapter dev jest jedynym miejscem, w którym da się PRZEĆWICZYĆ efekt, jaki
   na produkcji wykona Sfera. Mierzymy tu to, co w Subiekcie byłoby nie do
   cofnięcia: gdzie ląduje stan po korekcie i czy MM naprawdę zabiera go
   z magazynu sprzedaży.                                                      */

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wertis-sfdev-")), "t.db");
process.env.SGT_MODE = "seeded";

let db: typeof import("../db/db.js").db;
let adapter: import("./sfera.js").SferaAdapter;

before(async () => {
  ({ db } = await import("../db/db.js"));
  const { DevSferaAdapter } = await import("./sfera.dev.js");
  adapter = new DevSferaAdapter();
});

beforeEach(() => {
  const d = db();
  for (const t of ["sgt_sprzedaz_pozycja", "sgt_sprzedaz", "sgt_stan", "sgt_towar"]) {
    d.prepare(`DELETE FROM ${t}`).run();
  }
  d.prepare("INSERT INTO sgt_towar(tw_id, symbol, nazwa, ean, lokalizacja) VALUES (5,'SYM-5','Towar','', '')").run();
  d.prepare("INSERT INTO sgt_stan(tw_id, mag_id, stan, stan_rez) VALUES (5, 1, 10, 0)").run();
  d.prepare(
    "INSERT INTO sgt_sprzedaz(dok_id, typ, nr_pelny, data_wyst, kontrahent, mag_id) VALUES (101,'FS','FS 101','2026-08-01','ALLEGRO',1)"
  ).run();
});

const stan = (magId: number): number => {
  const r = db().prepare("SELECT stan FROM sgt_stan WHERE tw_id=5 AND mag_id=?").get(magId) as
    | { stan: number }
    | undefined;
  return r?.stan ?? 0;
};

test("korekta oddaje stan magazynowi sprzedaży, MM zabiera go na bufor", async () => {
  const w = await adapter.createKorektaZwrotu({
    dokId: 101,
    typ: "FS",
    magZrodlowy: 1,
    magZwrotow: 3,
    pozycje: [{ twId: 5, qty: 2 }],
  });
  /* Magazyn sprzedaży nie zmienia się ANI O SZTUKĘ — korekta dodała dwie,
     MM zabrało te same dwie. To jest sedno operacji: towar nie ma być
     sprzedawalny ani chwili, zanim ktoś go obejrzy. */
  assert.equal(stan(1), 10);
  assert.equal(stan(3), 2);
  assert.match(w.korektaNumer, /^KFS /);
  assert.ok(w.mmNumer);

  const paragon = await adapter.createKorektaZwrotu({
    dokId: 101,
    typ: "PA",
    magZrodlowy: 1,
    magZwrotow: 3,
    pozycje: [{ twId: 5, qty: 1 }],
  });
  assert.match(paragon.korektaNumer, /^KPA /, "paragon dostaje korektę paragonu");
});

test("nieznany dokument sprzedaży nie rusza stanów", async () => {
  await assert.rejects(
    adapter.createKorektaZwrotu({
      dokId: 999,
      typ: "FS",
      magZrodlowy: 1,
      magZwrotow: 3,
      pozycje: [{ twId: 5, qty: 2 }],
    }),
    /999/
  );
  assert.equal(stan(1), 10);
  assert.equal(stan(3), 0);
});
