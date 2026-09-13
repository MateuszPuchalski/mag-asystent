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

test("odkładanie części dla czekającego zamówienia wyprzedza starszą dostawę", () => {
  const routine = receipt(),
    urgent = receipt();
  W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    priority: 2,
    dueAt: "2026-09-13T10:00:00Z",
    lines: [{ sku: urgent.sku, quantity: 2 }],
  });
  const before = db().prepare("SELECT total_changes() n").get()!.n;
  const rows = P.listPutaway(worker, {}).rows.filter((r) =>
    [routine.taskId, urgent.taskId].includes(Number(r.id)),
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [urgent.taskId, routine.taskId],
  );
  assert.equal(rows[0].order_shortage, 2);
  assert.equal(rows[0].order_priority, 2);
  assert.equal(rows[1].order_shortage, 0);
  assert.equal(db().prepare("SELECT total_changes() n").get()!.n, before);
});

test("dostępny zapas pokrywa pilne zamówienie przed ustaleniem priorytetu odkładania", () => {
  const covered = receipt(),
    urgent = receipt();
  for (const [sku, quantity, priority] of [
    [covered.sku, 2, 2],
    [covered.sku, 1, 0],
    [urgent.sku, 1, 1],
  ] as const) {
    W.createOrder(office, randomUUID(), {
      reference: randomUUID(),
      priority,
      dueAt: "2026-09-20T10:00:00Z",
      lines: [{ sku, quantity }],
    });
  }
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId: covered.twId,
    bin: "SHELF-1",
    quantity: 2,
    reason: "Zapas seeded",
  });
  const rows = P.listPutaway(worker, {}).rows.filter((r) =>
    [covered.taskId, urgent.taskId].includes(Number(r.id)),
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [urgent.taskId, covered.taskId],
  );
  assert.equal(rows[1].order_shortage, 1);
  assert.equal(rows[1].order_priority, 0);
  const owned = P.claimPutaway(worker, randomUUID(), covered.taskId, {
    version: 1,
  });
  P.finishPutaway(worker, randomUUID(), owned.id, finish(owned, 1));
  const refreshed = P.listPutaway(worker, { q: covered.sku }).rows.find(
    (r) => r.id === covered.taskId,
  )!;
  assert.equal(refreshed.order_shortage, 0);
  assert.equal(refreshed.order_priority, null);
});

test("wstrzymane nowe zamówienie nie podnosi priorytetu; kolejność równych priorytetów wynika z terminu", () => {
  const held = receipt(),
    later = receipt(),
    earlier = receipt();
  for (const [f, priority, dueAt] of [
    [held, 2, "2026-09-10T10:00:00Z"],
    [later, 1, "2026-09-15T10:00:00Z"],
    [earlier, 1, "2026-09-14T10:00:00Z"],
  ] as const) {
    const order = W.createOrder(office, randomUUID(), {
      reference: randomUUID(),
      priority,
      dueAt,
      lines: [{ sku: f.sku, quantity: 1 }],
    });
    if (f === held)
      db()
        .prepare(
          "UPDATE wms_order SET hold_reason='Wyjaśnienie płatności' WHERE id=?",
        )
        .run(order.id);
  }
  const rows = P.listPutaway(worker, {}).rows.filter((r) =>
    [held.taskId, later.taskId, earlier.taskId].includes(Number(r.id)),
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [earlier.taskId, later.taskId, held.taskId],
  );
  assert.equal(rows[2].order_shortage, 0);
});

test("priorytet odkładania działa przed stronicowaniem i zachowuje filtr właściciela", () => {
  const earlier = Array.from({ length: 51 }, () => receipt());
  const urgent = receipt();
  W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    priority: 2,
    dueAt: "2026-01-01T00:00:00Z",
    lines: [{ sku: urgent.sku, quantity: 1 }],
  });
  assert.equal(P.listPutaway(worker, {}).rows[0].id, urgent.taskId);
  P.claimPutaway(worker, randomUUID(), urgent.taskId, { version: 1 });
  const mine = P.listPutaway(worker, { q: urgent.sku, mine: "1" });
  assert.equal(mine.rows[0].id, urgent.taskId);
  assert.equal(mine.totals.units, 10);
  assert.equal(
    P.listPutaway(other, { q: urgent.sku, mine: "1" }).rows.length,
    0,
  );
  const first = P.listPutaway(worker, {}).rows.map((r) => r.id);
  const next = P.listPutaway(worker, { offset: 50 }).rows.map((r) => r.id);
  assert.equal(first.length, 50);
  assert.ok(next.some((id) => earlier.some((r) => r.taskId === id)));
  assert.ok(!next.some((id) => first.includes(id)));
});

test("skan źródła podejmuje tylko właściwy bufor i zachowuje jeden przydział bez ruchu zapasu", () => {
  const r = receipt();
  const before = P.getPutaway(r.taskId);
  const stock = state(r.twId, "BUF-1");
  assert.throws(
    () =>
      P.claimPutaway(worker, randomUUID(), r.taskId, {
        version: before.version,
        source: "SHELF-1",
      }),
    /Zeskanuj bufor BUF-1/,
  );
  assert.equal(P.getPutaway(r.taskId).user_id, null);
  const key = randomUUID(),
    body = { version: before.version, source: "buf-1" };
  const claimed = P.claimPutaway(worker, key, r.taskId, body);
  assert.equal(claimed.user_id, worker.id);
  assert.equal(claimed.version, before.version + 1);
  assert.deepEqual(P.claimPutaway(worker, key, r.taskId, body), claimed);
  assert.throws(() =>
    P.claimPutaway(other, randomUUID(), r.taskId, {
      version: claimed.version,
      source: "BUF-1",
    }),
  );
  assert.equal(P.getPutaway(r.taskId).user_id, worker.id);
  assert.deepEqual(state(r.twId, "BUF-1"), stock);
  const done = P.finishPutaway(worker, randomUUID(), r.taskId, finish(claimed));
  assert.equal(done.remaining, 0);
  assert.throws(
    () =>
      P.claimPutaway(worker, randomUUID(), r.taskId, {
        version: done.version,
        source: "BUF-1",
      }),
    /Zadanie zmieniło/,
  );
});

test("podpowiedzi przyjęcia i odkładania pomijają pełne oraz zablokowane półki przed limitem ośmiu", () => {
  const r = receipt();
  for (let n = 0; n < 10; n++) {
    const bin = `FULL-${n}`;
    W.changeStock(office, randomUUID(), {
      action: "receive",
      twId: r.twId,
      bin,
      quantity: 2,
      reason: "Zapas seeded",
    });
    W.changeStock(office, randomUUID(), {
      action: "limits",
      twId: r.twId,
      bin,
      capacity: 2,
      minimum: 0,
      version: state(r.twId, bin).version,
      reason: "Pełna półka seeded",
    });
  }
  for (const bin of ["SHELF-1", "SHELF-2", "QUAR-1", "BLOCKED", "COUNTING"])
    W.changeStock(office, randomUUID(), {
      action: "receive",
      twId: r.twId,
      bin,
      quantity: 4,
      reason: "Zapas seeded",
    });
  W.changeStock(office, randomUUID(), {
    action: "limits",
    twId: r.twId,
    bin: "SHELF-1",
    capacity: 9,
    minimum: 0,
    version: state(r.twId, "SHELF-1").version,
    reason: "Pojemność seeded",
  });
  db()
    .prepare(
      "INSERT INTO wms_capacity_issue(tw_id,bin,reason,user_id,created_at) VALUES(?,'BLOCKED','Pełny regał',1,?)",
    )
    .run(r.twId, new Date().toISOString());
  db()
    .prepare(
      "INSERT INTO wms_stock_check(tw_id,bin,reason,user_id,created_at) VALUES(?,'COUNTING','Przelicz półkę',1,?)",
    )
    .run(r.twId, new Date().toISOString());
  S.claimReplenishment(worker, randomUUID(), {
    twId: r.twId,
    source: "SHELF-2",
    target: "SHELF-1",
    quantity: 3,
    sourceVersion: state(r.twId, "SHELF-2").version,
    targetVersion: state(r.twId, "SHELF-1").version,
  });
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  const hints = P.getPutaway(r.taskId).bins;
  assert.deepEqual(
    hints.map((b) => [b.bin, b.room]),
    [
      ["SHELF-1", 2],
      ["SHELF-2", null],
    ],
  );
  for (const bins of [
    I.getInbound(r.id).lines[0].bins,
    I.getInboundCollector(r.id, { barcode: r.sku }).selected!.bins,
  ]) {
    assert.deepEqual(
      bins.filter((b) => b.bin !== "BUF-1"),
      hints,
    );
  }
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
});

test("podpowiedź nie rezerwuje miejsca; równoległe przyjęcie odrzuca odłożenie bez utraty bufora", () => {
  const r = receipt();
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId: r.twId,
    bin: "SHELF-1",
    quantity: 1,
    reason: "Zapas seeded",
  });
  W.changeStock(office, randomUUID(), {
    action: "limits",
    twId: r.twId,
    bin: "SHELF-1",
    capacity: 5,
    minimum: 0,
    version: state(r.twId, "SHELF-1").version,
    reason: "Pojemność seeded",
  });
  const task = P.claimPutaway(worker, randomUUID(), r.taskId, {
    version: P.getPutaway(r.taskId).version,
  });
  assert.equal(task.bins[0].room, 4);
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId: r.twId,
    bin: "SHELF-1",
    quantity: 4,
    reason: "Równoległa dostawa",
  });
  assert.throws(
    () => P.finishPutaway(worker, randomUUID(), task.id, finish(task, 4)),
    /zmieści się jeszcze 0/,
  );
  const refreshed = P.getPutaway(task.id);
  assert.equal(refreshed.remaining, 10);
  assert.equal(refreshed.version, task.version);
  assert.equal(refreshed.steps.length, 0);
  assert.equal(state(r.twId, "BUF-1").on_hand, 10);
  assert.equal(refreshed.bins.length, 0);
  assert.equal(A.integrity().ok, true);
});

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
  assert.equal(
    P.listPutaway(worker, { q: `0590${r.twId}` }).rows[0].id,
    r.taskId,
  );
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
