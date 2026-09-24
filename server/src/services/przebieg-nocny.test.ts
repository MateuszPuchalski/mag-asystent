import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wertis-noc-"));
process.env.DB_PATH = path.join(dir, "wertis.db");
process.env.KOPIE_KATALOG = path.join(dir, "kopie");
process.env.SGT_MODE = "seeded";
process.env.LOG_LEVEL = "silent";

/* Przebieg nocny zastąpił dwa wpisy w Harmonogramie zadań. Ten test pilnuje,
   że jedno wywołanie w nocy robi OBIE rzeczy, zostawia ślad w dzienniku
   biura i nie powtarza się tej samej nocy. W dzień nie robi nic. */

test("noc: kopia i rekoncyliacja raz, w dzień nic", async () => {
  const { przebiegNocny } = await import("./przebieg-nocny.js");
  const { db } = await import("../db/db.js");
  const { czytajStan } = await import("./kopie-bazy.js");

  const dzien = przebiegNocny("2026-09-24T10:00:00.000Z");
  assert.deepEqual(dzien, { kopia: null, rozjazdow: null });

  const noc = przebiegNocny("2026-09-24T00:30:00.000Z");
  assert.equal(noc.kopia, "noc-2026-09-24.db");
  assert.equal(noc.rozjazdow, 0, "pusta baza demo nie ma rozjazdów");
  assert.ok(fs.existsSync(path.join(process.env.KOPIE_KATALOG!, "noc-2026-09-24.db")));
  assert.equal(czytajStan().rekoncyliacja?.rozjazdow, 0);

  const znowu = przebiegNocny("2026-09-24T01:45:00.000Z");
  assert.deepEqual(znowu, { kopia: null, rozjazdow: null }, "druga runda tej samej nocy");

  const wpisy = db()
    .prepare("SELECT type FROM events WHERE type IN ('kopia_bazy','rekoncyliacja') ORDER BY id")
    .all() as Array<{ type: string }>;
  assert.deepEqual(wpisy.map((w) => w.type), ["kopia_bazy", "rekoncyliacja"]);
});
