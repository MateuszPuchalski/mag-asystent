import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.SGT_MODE = "seeded";
const schema = readFileSync(
  new URL("../db/schema.sql", import.meta.url),
  "utf8",
);

test("kopia WMS sprzed bufora pozostaje sprawdzalna bez migracji źródła", async () => {
  const { verifiedBackup } = await import("./wms-backup.js");
  const directory = mkdtempSync(path.join(tmpdir(), "wms-old-backup-"));
  const source = path.join(directory, "source.db");
  const target = path.join(directory, "copy.db");
  const old = new DatabaseSync(source);
  try {
    old.exec(schema);
    old.exec("DROP TABLE wms_putaway_step; DROP TABLE wms_putaway_work");
  } finally {
    old.close();
  }
  const before = readFileSync(source);
  const result = await verifiedBackup(source, target);
  assert.equal(result.verified, true);
  assert.deepEqual(readFileSync(source), before);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(
      copy
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'wms_putaway_%'",
        )
        .get()?.n,
      0,
    );
  } finally {
    copy.close();
  }
});

for (const absent of ["wms_putaway_work", "wms_putaway_step"]) {
  test(`kontrola odrzuca niepełny schemat: brak ${absent}`, async () => {
    const { integrity } = await import("./wms-analytics.js");
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(schema);
      database.exec(`DROP TABLE ${absent}`);
      assert.throws(
        () => integrity(database),
        /Niepełny schemat odkładania WMS/,
      );
      // Nieudana kontrola nie może pozostawić transakcji blokującej następne sprawdzenie.
      database.exec("BEGIN; ROLLBACK");
    } finally {
      database.close();
    }
  });
}
