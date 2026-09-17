import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyticsReader } from "./wms-analytics-reader.js";

function fixture() {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "wms-report-reader-")),
    "seeded.db",
  );
  const d = new DatabaseSync(file);
  d.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  return { file, d };
}

test("osobny odczyt łączy równoległe raporty, zwalnia pętlę API i nie zachowuje starego wyniku", async () => {
  const { file, d } = fixture(),
    reader = analyticsReader(file);
  try {
    const before = d.prepare("PRAGMA data_version").get()!.data_version;
    const first = reader.get({ days: 1 });
    assert.equal(reader.get({ days: 1 }), first);
    let ticked = false;
    setImmediate(() => {
      ticked = true;
    });
    const empty = await first;
    assert.equal(ticked, true);
    assert.equal(
      empty.flow.queues.find((q) => q.id === "allocation")!.count,
      0,
    );
    d.exec(
      "INSERT INTO wms_order(reference,channel,status,due_at,created_at,updated_at) VALUES ('SYNTH','seeded','new','2026-09-01','2026-09-01','2026-09-01')",
    );
    const next = await reader.get({ days: 1 });
    assert.equal(next.flow.queues.find((q) => q.id === "allocation")!.count, 1);
    assert.equal(d.prepare("PRAGMA data_version").get()!.data_version, before);
  } finally {
    await reader.close();
    d.close();
  }
  await assert.rejects(reader.get({}), /zamknięty/);
});

test("błędny okres, kolejka ponad limit i zamknięcie nie zostawiają oczekujących żądań", async () => {
  const { file, d } = fixture(),
    reader = analyticsReader(file);
  try {
    assert.throws(() => reader.get({ days: 0 }));
    const waiting = [1, 7, 30, 90].map((days) => reader.get({ days }));
    const results = Promise.allSettled(waiting);
    await assert.rejects(reader.get({ days: 2 }), /Trwają inne raporty/);
    await reader.close();
    assert.ok((await results).every((r) => r.status === "rejected"));
  } finally {
    await reader.close();
    d.close();
  }
});

test("brak pliku lub schematu nie tworzy bazy ani migracji; awaria pozwala ponowić odczyt", async () => {
  const file = path.join(
    mkdtempSync(path.join(tmpdir(), "wms-report-missing-")),
    "missing.db",
  );
  const reader = analyticsReader(file);
  try {
    await assert.rejects(reader.get({}), /niedostępny/);
    assert.equal(existsSync(file), false);
    const d = new DatabaseSync(file);
    try {
      d.exec("CREATE TABLE marker(id INTEGER)");
      await assert.rejects(reader.get({}), /odczytać raportu/);
      assert.deepEqual(
        d
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((r) => r.name),
        ["marker"],
      );
    } finally {
      d.close();
    }
  } finally {
    await reader.close();
  }
});

test("limit czasu kończy obliczanie i odrzuca wszystkie wspólne żądania", async () => {
  const { file, d } = fixture(),
    reader = analyticsReader(file, 1);
  try {
    const results = await Promise.allSettled([
      reader.get({ days: 1 }),
      reader.get({ days: 7 }),
    ]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status === "rejected")
        assert.match(String(result.reason), /Przekroczono czas/);
    }
  } finally {
    await reader.close();
    d.close();
  }
});
