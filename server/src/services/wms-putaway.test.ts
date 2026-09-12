import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-putaway-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
let W: typeof import("./wms.js"),
  I: typeof import("./wms-inbound.js"),
  P: typeof import("./wms-putaway.js"),
  S: typeof import("./wms-stock-work.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const office = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Odkładanie", role: "magazynier" as const },
  other = { id: 3, name: "Drugi", role: "magazynier" as const };
let seq = 0;
before(async () => {
  W = await import("./wms.js");
  I = await import("./wms-inbound.js");
  P = await import("./wms-putaway.js");
  S = await import("./wms-stock-work.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
  for (const [bin, mode] of [
    ["BUF-1", "reserve"],
    ["SHELF-1", "pick"],
    ["SHELF-2", "reserve"],
    ["QUAR-1", "quarantine"],
  ])
    W.configureBin(office, randomUUID(), {
      bin,
      mode,
      version: 1,
      reason: "Test lokalizacji",
    });
});
function receipt(quantity = 10) {
  const twId = ++seq,
    sku = `BUF-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Część do kosiarki", `0590${twId}`);
  const document = I.createInbound(office, randomUUID(), {
    reference: `PZ-BUF-${twId}`,
    supplier: "Seeded",
    lines: [{ sku, quantity }],
  });
  const line = I.getInbound(document.id).lines[0];
  const body = {
    lineId: line.id,
    version: line.version,
    barcode: sku,
    bin: "BUF-1",
    quantity,
    disposition: "good",
    staged: true,
  };
  const accepted = I.putawayInbound(worker, randomUUID(), document.id, body);
  return { twId, sku, id: document.id, taskId: accepted.workId!, body };
}
function finish(
  task: ReturnType<typeof P.getPutaway>,
  quantity = task.remaining,
  target = "SHELF-1",
) {
  return {
    version: task.version,
    source: task.source,
    barcode: task.sku,
    quantity,
    target,
  };
}
function state(twId: number, bin: string) {
  return db()
    .prepare("SELECT * FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, bin)!;
}

test("bufor nie trafia do zbiórki; częściowe odłożenie i ponowienie działają po zamknięciu dostawy", () => {
  const r = receipt();
  assert.equal(state(r.twId, "BUF-1").on_hand, 10);
  const order = W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: r.sku, quantity: 4 }],
  });
  assert.throws(() =>
    W.actOnOrder(worker, randomUUID(), order.id, {
      action: "pick-start",
      version: order.version,
      tote: "BUF-TOTE",
    }),
  );
  assert.equal(
    W.inventory({ q: r.sku }).rows.find((s) => s.bin === "BUF-1")!.available,
    0,
  );
  const document = I.getInbound(r.id);
  I.closeInbound(worker, randomUUID(), r.id, { version: document.version });
  const task = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: P.getPutaway(r.taskId).version,
  });
  const key = randomUUID(),
    body = finish(task, 4);
  const partial = P.finishPutaway(worker, key, task.id, body);
  assert.equal(partial.remaining, 6);
  assert.deepEqual(
    P.finishPutaway(worker, key, task.id, body),
    JSON.parse(JSON.stringify(partial)),
  );
  assert.equal(state(r.twId, "SHELF-1").on_hand, 4);
  assert.equal(state(r.twId, "BUF-1").on_hand, 6);
  const done = P.finishPutaway(
    worker,
    randomUUID(),
    task.id,
    finish(partial, 6, "SHELF-2"),
  );
  assert.equal(done.remaining, 0);
  assert.ok(done.completed_at);
  assert.equal(I.getInbound(r.id).lines[0].received, 10);
  assert.equal(A.integrity().ok, true);
});

test("dwa kolektory nie podejmują ani nie odkładają tych samych sztuk", () => {
  const r = receipt();
  const original = P.getPutaway(r.taskId);
  const mine = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: original.version,
  });
  assert.throws(
    () =>
      P.claimPutaway(other, randomUUID(), r.taskId, {
        version: original.version,
      }),
    /zmieniło/,
  );
  assert.throws(
    () =>
      P.claimPutaway(other, randomUUID(), r.taskId, { version: mine.version }),
    /uprawnień/,
  );
  assert.throws(
    () => P.finishPutaway(other, randomUUID(), r.taskId, finish(mine)),
    /swoje konto/,
  );
  const taken = P.claimPutaway(office, randomUUID(), r.taskId, {
    version: mine.version,
    reason: "Zmiana operatora",
  });
  assert.throws(
    () => P.finishPutaway(worker, randomUUID(), r.taskId, finish(taken)),
    /swoje konto/,
  );
  assert.throws(
    () =>
      P.finishPutaway(office, randomUUID(), r.taskId, {
        ...finish(taken),
        barcode: "INNY",
      }),
    /kod|towar|SKU/i,
  );
  assert.throws(
    () =>
      P.finishPutaway(office, randomUUID(), r.taskId, {
        ...finish(taken),
        source: "INNY",
      }),
    /bufor/,
  );
  assert.throws(
    () => P.finishPutaway(office, randomUUID(), r.taskId, finish(taken, 11)),
    /przekracza/,
  );
  assert.throws(
    () =>
      P.finishPutaway(
        office,
        randomUUID(),
        r.taskId,
        finish(taken, 1, "QUAR-1"),
      ),
    /półkę/,
  );
  assert.equal(P.getPutaway(r.taskId).remaining, 10);
});

test("otwarte odkładanie chroni zapas przed ruchem, spisem, zmianą lokalizacji i uzupełnieniem", () => {
  const r = receipt();
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId: r.twId,
    bin: "SHELF-1",
    quantity: 1,
    reason: "Stan początkowy",
  });
  assert.throws(
    () =>
      W.changeStock(office, randomUUID(), {
        action: "transfer",
        twId: r.twId,
        bin: "BUF-1",
        target: "SHELF-1",
        quantity: 1,
        reason: "Ruch równoległy",
      }),
    /odkładanie/,
  );
  assert.throws(
    () =>
      W.configureBin(office, randomUUID(), {
        bin: "BUF-1",
        mode: "pick",
        version: 1,
        reason: "Zmiana przeznaczenia",
      }),
    /odkładanie/,
  );
  assert.throws(
    () =>
      S.claimReplenishment(worker, randomUUID(), {
        twId: r.twId,
        source: "BUF-1",
        target: "SHELF-1",
        quantity: 1,
        sourceVersion: state(r.twId, "BUF-1").version,
        targetVersion: state(r.twId, "SHELF-1").version,
      }),
    /zadaniach/,
  );
  assert.throws(
    () =>
      W.changeStock(office, randomUUID(), {
        action: "count",
        twId: r.twId,
        bin: "BUF-1",
        quantity: 9,
        version: state(r.twId, "BUF-1").version,
        reason: "Spis równoległy",
      }),
    /odkładanie/,
  );
  assert.equal(state(r.twId, "BUF-1").on_hand, 10);
});

test("odmowa na docelowej półce wycofuje źródło, historię i zwolnienie rezerwacji", () => {
  const r = receipt();
  const task = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: P.getPutaway(r.taskId).version,
  });
  db().exec(
    `CREATE TEMP TRIGGER fail_putaway BEFORE INSERT ON wms_movement WHEN NEW.tw_id=${r.twId} AND NEW.bin='SHELF-1' BEGIN SELECT RAISE(ABORT,'Brak zapisu celu'); END`,
  );
  try {
    assert.throws(
      () => P.finishPutaway(worker, randomUUID(), r.taskId, finish(task, 4)),
      /Brak zapisu celu/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_putaway");
  }
  assert.equal(state(r.twId, "BUF-1").on_hand, 10);
  assert.equal(P.getPutaway(r.taskId).remaining, 10);
  assert.equal(P.getPutaway(r.taskId).steps.length, 0);
});

test("korekta braku dotyczy tylko bufora i zachowuje częściowe odłożenie", () => {
  const r = receipt();
  const task = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: P.getPutaway(r.taskId).version,
  });
  const partial = P.finishPutaway(
    worker,
    randomUUID(),
    task.id,
    finish(task, 4),
  );
  const body = {
    version: partial.version,
    source: "BUF-1",
    barcode: r.sku,
    quantity: 2,
    reason: "W kartonie były dwie sztuki mniej",
  };
  assert.throws(
    () => P.correctPutaway(worker, randomUUID(), task.id, body),
    /uprawnień/,
  );
  const key = randomUUID(),
    corrected = P.correctPutaway(office, key, task.id, body);
  assert.equal(corrected.remaining, 4);
  assert.deepEqual(
    P.correctPutaway(office, key, task.id, body),
    JSON.parse(JSON.stringify(corrected)),
  );
  assert.equal(I.getInbound(r.id).lines[0].received, 8);
  assert.equal(state(r.twId, "SHELF-1").on_hand, 4);
  assert.equal(state(r.twId, "BUF-1").on_hand, 4);
  assert.equal(
    corrected.steps.filter((s) => s.kind === "correction").length,
    1,
  );
  assert.throws(
    () =>
      db().prepare("DELETE FROM wms_putaway_step WHERE task_id=?").run(task.id),
    /immutable/,
  );
  assert.equal(A.integrity().ok, true);
});

test("podgląd i stronicowanie kolejki nie zapisują danych", () => {
  const r = receipt();
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  const list = P.listPutaway(worker, { q: r.sku });
  assert.equal(list.rows.length, 1);
  assert.equal(list.totals.units, 10);
  assert.equal(P.listPutaway(worker, { q: r.sku, offset: 50 }).rows.length, 0);
  P.getPutaway(r.taskId);
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
});

test("rozszerzenie przyjęcia zachowuje odcisk dawnych ponowień bez pola staged", () => {
  const r = receipt();
  const line = I.getInbound(r.id).lines[0];
  const legacy = {
    lineId: line.id,
    version: line.version,
    barcode: r.sku,
    bin: "SHELF-1",
    quantity: 1,
    disposition: "good",
    reason: "Dodatkowa partia",
  };
  const key = randomUUID();
  const result = I.putawayInbound(office, key, r.id, legacy);
  const expected = createHash("sha256")
    .update(JSON.stringify([office.id, `inbound_putaway:${r.id}`, legacy]))
    .digest("hex");
  assert.equal(
    db().prepare("SELECT fingerprint FROM wms_command WHERE key=?").get(key)!
      .fingerprint,
    expected,
  );
  assert.deepEqual(
    I.putawayInbound(office, key, r.id, { ...legacy, staged: false }),
    JSON.parse(JSON.stringify(result)),
  );
});

test("bufor nie może być półką kompletacji ani przyjęciem uszkodzonego towaru", () => {
  const r = receipt();
  const line = I.getInbound(r.id).lines[0];
  const body = { ...r.body, version: line.version, reason: "Nadwyżka testowa" };
  for (const override of [
    { bin: "SHELF-1" },
    { bin: "QUAR-1", disposition: "damaged" },
  ])
    assert.throws(
      () =>
        I.putawayInbound(office, randomUUID(), r.id, { ...body, ...override }),
      /bufora/,
    );
  assert.equal(P.listPutaway(worker, { q: r.sku }).totals.units, 10);
});

test("spójność wykrywa utratę ochrony bufora i rozjazd historii odkładania", () => {
  const r = receipt();
  db()
    .prepare("UPDATE wms_putaway_work SET remaining=remaining-1 WHERE id=?")
    .run(r.taskId);
  assert.ok(A.integrity().putaway.some((p) => p.id === r.taskId));
  db()
    .prepare("UPDATE wms_putaway_work SET remaining=remaining+1 WHERE id=?")
    .run(r.taskId);
  db().prepare("UPDATE wms_bin SET mode='pick' WHERE bin='BUF-1'").run();
  assert.ok(A.integrity().putaway.some((p) => p.bin === "BUF-1"));
  db().prepare("UPDATE wms_bin SET mode='reserve' WHERE bin='BUF-1'").run();
  assert.equal(A.integrity().ok, true);
});

test("uszkodzenie wykryte przy odkładaniu trafia do kwarantanny bez zmiany przyjętej ilości", () => {
  const r = receipt();
  const task = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: P.getPutaway(r.taskId).version,
  });
  const bad = {
    ...finish(task, 2, "QUAR-1"),
    disposition: "damaged",
    reason: "Pęknięta obudowa części",
  };
  assert.throws(
    () =>
      P.finishPutaway(worker, randomUUID(), task.id, {
        ...bad,
        target: "SHELF-1",
      }),
    /właściwą półkę/,
  );
  const result = P.finishPutaway(worker, randomUUID(), task.id, bad);
  assert.equal(result.remaining, 8);
  assert.equal(state(r.twId, "QUAR-1").on_hand, 2);
  const line = I.getInbound(r.id).lines[0];
  assert.equal(line.received, 10);
  assert.equal(line.damaged, 2);
  assert.equal(result.steps[0].kind, "quarantine");
  assert.equal(A.integrity().ok, true);
});
