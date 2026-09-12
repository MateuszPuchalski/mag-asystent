import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-pack-recovery-")),
  "test.db",
);
let W: typeof import("./wms.js"),
  R: typeof import("./wms-pack-recovery.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const worker = { id: 2, name: "Pakowanie", role: "magazynier" as const },
  admin = { id: 1, name: "Biuro", role: "admin" as const };
let seq = 0;
before(async () => {
  W = await import("./wms.js");
  R = await import("./wms-pack-recovery.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
});
function fixture() {
  const products = [3, 1].map((quantity) => {
    const twId = ++seq,
      sku = `CONTENT-${twId}`;
    db()
      .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
      .run(twId, sku, "Część seeded", `EAN-${twId}`);
    W.changeStock(admin, randomUUID(), {
      action: "receive",
      twId,
      bin: "PICK",
      quantity: 10,
      reason: "Test seeded",
    });
    return { sku, quantity };
  });
  let o = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: new Date().toISOString(),
    lines: products,
  });
  const act = (
    body: object,
    key = randomUUID(),
    actor: import("./wms.js").Actor = worker,
  ) => {
    o = W.actOnOrder(actor, key, o.id, { ...body, version: o.version });
    return o;
  };
  act({ action: "allocate" }, randomUUID(), admin);
  act({ action: "pick-start", tote: `TOTE-${seq}` });
  for (const a of o.allocations)
    act({
      action: "pick",
      allocationId: a.id,
      bin: a.bin,
      barcode: o.lines.find((l) => l.id === a.line_id)!.sku,
      quantity: a.quantity,
    });
  act({ action: "pack-start", tote: o.tote });
  return {
    get order() {
      return o;
    },
    act,
    products,
  };
}
function packAll(f: ReturnType<typeof fixture>) {
  for (const p of f.products)
    f.act({ action: "pack", barcode: p.sku, quantity: p.quantity });
}
function shipping(parcels = 1) {
  return {
    action: "ship",
    carrier: "DEMO",
    tracking: randomUUID(),
    weightG: 600,
    extraParcels: Array.from({ length: parcels - 1 }, () => ({
      carrier: "DEMO",
      tracking: randomUUID(),
      weightG: 500,
    })),
  };
}

function damage(
  f: ReturnType<typeof fixture>,
  quantity = 1,
  parcelNo = 1,
  key = randomUUID(),
) {
  if (!db().prepare("SELECT 1 FROM wms_bin WHERE bin='QUAR'").get())
    W.configureBin(admin, randomUUID(), {
      bin: "QUAR",
      mode: "quarantine",
      version: 1,
      reason: "Kontrola jakości",
    });
  const o = W.getOrder(f.order.id);
  return R.quarantinePacking(worker, key, {
    orderId: o.id,
    version: o.version,
    box: o.tote,
    barcode: f.products[0].sku,
    quantity,
    parcelNo,
    quarantine: "QUAR",
    reason: "Pęknięta część",
  });
}
function pickup(t: ReturnType<typeof R.recoveryTask>, quantity = 1) {
  const p = t.picks[0];
  return {
    version: t.version,
    allocationId: p.allocation_id,
    sourceVersion: p.stock_version,
    source: p.bin,
    barcode: p.sku,
    quantity,
    box: t.box,
  };
}
function balance(twId: number, bin: string) {
  return db()
    .prepare("SELECT on_hand,reserved FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, bin);
}

test("uszkodzenie w paczce zachowuje dobre potwierdzenia i wymienia tylko jedną sztukę", () => {
  const f = fixture();
  packAll(f);
  const before = f.order,
    tw = before.lines[0].tw_id,
    shelf = balance(tw, "PICK");
  const t = damage(f);
  let o = W.getOrder(before.id);
  assert.deepEqual(
    o.lines.map((l) => [l.picked, l.packed]),
    [
      [2, 2],
      [1, 1],
    ],
  );
  assert.deepEqual(balance(tw, "PICK"), shelf);
  assert.equal(balance(tw, "QUAR")!.on_hand, 1);
  assert.equal(o.packingRecovery!.remaining, 1);
  assert.throws(
    () =>
      W.actOnOrder(worker, randomUUID(), o.id, {
        action: "pack",
        version: o.version,
        barcode: f.products[0].sku,
        quantity: 1,
      }),
    /Poczekaj/,
  );
  const assigned = R.claimRecovery(worker, randomUUID(), t.id, {
    version: t.version,
  });
  assert.equal(assigned.picks.length, 1);
  assert.equal(assigned.picks[0].quantity, 1);
  const done = R.pickRecovery(worker, randomUUID(), t.id, pickup(assigned));
  assert.ok(done.completed_at);
  o = W.getOrder(o.id);
  assert.equal(o.packingRecovery, null);
  assert.deepEqual(
    o.lines.map((l) => [l.picked, l.packed]),
    [
      [3, 2],
      [1, 1],
    ],
  );
  o = W.actOnOrder(worker, randomUUID(), o.id, {
    action: "pack",
    version: o.version,
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 1,
  });
  assert.equal(o.status, "packed");
  o = W.actOnOrder(worker, randomUUID(), o.id, {
    ...shipping(),
    version: o.version,
  });
  assert.equal(
    o.shipments[0].contents.reduce((n, c) => n + Number(c.quantity), 0),
    4,
  );
  assert.equal(A.integrity().ok, true);
});

test("brak zamiennika nie cofa kwarantanny i nie pozostawia częściowej rezerwacji", () => {
  const f = fixture();
  packAll(f);
  const tw = f.order.lines[0].tw_id;
  W.changeStock(admin, randomUUID(), {
    action: "count",
    twId: tw,
    bin: "PICK",
    quantity: 0,
    version: db()
      .prepare("SELECT version FROM wms_stock WHERE tw_id=? AND bin='PICK'")
      .get(tw)!.version,
    reason: "Półka opróżniona",
  });
  const t = damage(f);
  assert.throws(
    () => R.claimRecovery(worker, randomUUID(), t.id, { version: t.version }),
    /Brak/,
  );
  assert.equal(R.recoveryTask(worker, t.id).user_id, null);
  assert.equal(balance(tw, "QUAR")!.on_hand, 1);
  assert.equal(balance(tw, "PICK")!.reserved, 0);
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: tw,
    bin: "PICK",
    quantity: 1,
    reason: "Nowa dostawa",
  });
  assert.equal(
    R.claimRecovery(worker, randomUUID(), t.id, { version: t.version }).picks[0]
      .quantity,
    1,
  );
});

test("ilość i skany kwarantanny, paczki oraz właściciel chronią fizyczną zawartość", () => {
  const f = fixture();
  packAll(f);
  const o = f.order;
  const base = {
    orderId: o.id,
    version: o.version,
    box: o.tote,
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 1,
    quarantine: "QUAR",
    reason: "Pęknięcie",
  };
  for (const patch of [
    { box: "WRONG" },
    { barcode: "WRONG" },
    { parcelNo: 0 },
    { parcelNo: 2 },
    { quantity: 4 },
    { quantity: 0 },
    { quarantine: "PICK" },
    { reason: "" },
    { version: o.version - 1 },
  ])
    assert.throws(() =>
      R.quarantinePacking(worker, randomUUID(), { ...base, ...patch }),
    );
  assert.throws(() =>
    R.quarantinePacking({ ...worker, id: 3 }, randomUUID(), base),
  );
  assert.deepEqual(W.getOrder(o.id), o);
  const t = damage(f, 2);
  const assigned = R.claimRecovery(worker, randomUUID(), t.id, {
    version: t.version,
  });
  for (const patch of [
    { box: "WRONG" },
    { barcode: "WRONG" },
    { source: "WRONG" },
    { sourceVersion: 1 },
    { quantity: 3 },
    { version: 1 },
  ])
    assert.throws(() =>
      R.pickRecovery(worker, randomUUID(), t.id, {
        ...pickup(assigned),
        ...patch,
      }),
    );
  assert.throws(() =>
    R.pickRecovery({ ...worker, id: 3 }, randomUUID(), t.id, pickup(assigned)),
  );
  const first = R.pickRecovery(worker, randomUUID(), t.id, pickup(assigned));
  assert.equal(first.completed_at, null);
  assert.equal(first.picks[0].quantity, 1);
  assert.ok(
    R.pickRecovery(worker, randomUUID(), t.id, pickup(first)).completed_at,
  );
});

test("zwolnienie pracy wymaga zwrotu na wszystkie źródła, a spis czeka na jej rozliczenie", async () => {
  const f = fixture();
  packAll(f);
  const t = damage(f);
  const a = R.claimRecovery(worker, randomUUID(), t.id, { version: t.version });
  const p = a.picks[0];
  const check = db()
    .prepare(
      "INSERT INTO wms_stock_check(tw_id,bin,reason,created_at,user_id) VALUES (?,?,'Kontrola',?,1)",
    )
    .run(p.tw_id, p.bin, new Date().toISOString());
  const S = await import("./wms-stock-work.js");
  const current = W.getOrder(f.order.id);
  assert.throws(
    () =>
      S.countStockCheck(admin, randomUUID(), Number(check.lastInsertRowid), {
        bin: p.bin,
        barcode: p.sku,
        quantity: 7,
        version: p.stock_version,
        reason: "Spis źródła",
      }),
    /wymiany/,
  );
  assert.deepEqual(W.getOrder(f.order.id), current);
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "count",
        twId: p.tw_id,
        bin: p.bin,
        quantity: 7,
        version: p.stock_version,
        reason: "Spis",
      }),
    /wymiany/,
  );
  assert.throws(() =>
    R.releaseRecovery(worker, randomUUID(), t.id, {
      version: a.version,
      sources: [],
      reason: "Przerwa",
    }),
  );
  assert.throws(
    () =>
      R.abortRecovery(admin, randomUUID(), t.id, {
        version: a.version,
        reason: "Anulowanie",
      }),
    /zwolnij/,
  );
  const released = R.releaseRecovery(worker, randomUUID(), t.id, {
    version: a.version,
    sources: [p.bin],
    reason: "Zwrot niepotwierdzonych sztuk",
  });
  assert.equal(released.user_id, null);
  assert.equal(released.picks.length, 0);
  S.countStockCheck(admin, randomUUID(), Number(check.lastInsertRowid), {
    bin: p.bin,
    barcode: p.sku,
    quantity: 7,
    version: db()
      .prepare("SELECT version FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.tw_id, p.bin)!.version,
    reason: "Przeliczenie po zwrocie",
  });
  const aborted = R.abortRecovery(admin, randomUUID(), t.id, {
    version: released.version,
    reason: "Klient rezygnuje",
  });
  assert.ok(aborted.cancelled_at);
  const o = W.getOrder(f.order.id);
  assert.equal(o.status, "picking");
  assert.ok(o.hold_reason);
  assert.equal(o.lines[0].picked, 2);
  assert.equal(o.lines[0].packed, 0);
});

test("utrata odpowiedzi nie podwaja kwarantanny ani pobrania, a błąd zapisu cofa cały ruch", () => {
  const f = fixture();
  packAll(f);
  const before = f.order,
    tw = before.lines[0].tw_id,
    quar = Number(balance(tw, "QUAR")?.on_hand ?? 0);
  db().exec(
    "CREATE TEMP TRIGGER fail_damage BEFORE INSERT ON wms_pack_damage BEGIN SELECT RAISE(ABORT,'damage rollback'); END",
  );
  try {
    assert.throws(() => damage(f), /damage rollback/);
  } finally {
    db().exec("DROP TRIGGER fail_damage");
  }
  assert.deepEqual(W.getOrder(before.id), before);
  assert.equal(Number(balance(tw, "QUAR")?.on_hand ?? 0), quar);
  const key = randomUUID();
  const t = damage(f, 1, 1, key);
  const input = {
    orderId: before.id,
    version: before.version,
    box: before.tote,
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 1,
    quarantine: "QUAR",
    reason: "Pęknięta część",
  };
  assert.deepEqual(
    R.quarantinePacking(worker, key, input),
    JSON.parse(JSON.stringify(t)),
  );
  const claimKey = randomUUID(),
    a = R.claimRecovery(worker, claimKey, t.id, { version: t.version });
  assert.deepEqual(
    R.claimRecovery(worker, claimKey, t.id, { version: t.version }),
    JSON.parse(JSON.stringify(a)),
  );
  const pickKey = randomUUID(),
    body = pickup(a);
  db().exec(
    "CREATE TEMP TRIGGER fail_replacement BEFORE UPDATE ON wms_pack_damage BEGIN SELECT RAISE(ABORT,'replacement rollback'); END",
  );
  try {
    assert.throws(
      () => R.pickRecovery(worker, pickKey, t.id, body),
      /replacement rollback/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_replacement");
  }
  assert.equal(R.recoveryTask(worker, t.id).picks[0].quantity, 1);
  const done = R.pickRecovery(worker, pickKey, t.id, body);
  assert.deepEqual(
    R.pickRecovery(worker, pickKey, t.id, body),
    JSON.parse(JSON.stringify(done)),
  );
  assert.equal(A.integrity().ok, true);
});

test("niesprawdzona sztuka i kolejne uszkodzenie tworzą jedną widoczną kolejkę bez zapisu przy odczycie", () => {
  const f = fixture();
  f.act({ action: "pack", barcode: f.products[1].sku, quantity: 1 });
  const first = damage(f, 1, 0);
  const second = damage(f, 1, 0);
  assert.equal(first.id, second.id);
  const o = W.getOrder(f.order.id);
  assert.equal(o.lines[0].picked, 1);
  assert.equal(o.lines[1].packed, 1);
  const before = db().prepare("SELECT total_changes() n").get()!.n;
  const queue = R.recoveryWork(worker, { q: o.reference });
  assert.equal(queue.total, 1);
  assert.equal(queue.rows[0].remaining, 2);
  R.recoveryTask(worker, first.id);
  assert.equal(db().prepare("SELECT total_changes() n").get()!.n, before);
  const a = R.claimRecovery(worker, randomUUID(), first.id, {
    version: second.version,
  });
  assert.throws(() => damage(f, 1, 0), /aktywną wymianę/);
  assert.throws(() =>
    R.claimRecovery({ ...worker, id: 3 }, randomUUID(), first.id, {
      version: a.version,
    }),
  );
  const current = W.getOrder(o.id);
  assert.throws(
    () =>
      W.actOnOrder(admin, randomUUID(), o.id, {
        action: "cancel",
        version: current.version,
        reason: "Anulowanie",
      }),
    /wymianę/,
  );
});

test("brak zamiennika przy pakowaniu tworzy popyt do uzupełnienia oraz kolejkę analityki", async () => {
  const S = await import("./wms-stock-work.js");
  const F = await import("./wms-flow-analytics.js");
  const f = fixture();
  packAll(f);
  const tw = f.order.lines[0].tw_id;
  W.changeStock(admin, randomUUID(), {
    action: "count",
    twId: tw,
    bin: "PICK",
    quantity: 0,
    version: db()
      .prepare("SELECT version FROM wms_stock WHERE tw_id=? AND bin='PICK'")
      .get(tw)!.version,
    reason: "Pusta półka",
  });
  const reserve = "RES-" + tw;
  W.configureBin(admin, randomUUID(), {
    bin: reserve,
    mode: "reserve",
    version: 1,
    reason: "Zaplecze",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: tw,
    bin: reserve,
    quantity: 2,
    reason: "Zapas do uzupełnienia",
  });
  const t = damage(f);
  const before = db().prepare("SELECT total_changes() n").get()!.n;
  const plan = S.replenishmentWork(worker, {
    view: "plans",
    q: f.products[0].sku,
  }).plans[0];
  assert.equal(plan.quantity, 1);
  assert.equal(plan.order_shortage, 1);
  const flow = F.flowAnalytics(
    db(),
    "2026-01-01T00:00:00Z",
    "2027-01-01T00:00:00Z",
  );
  const q = flow.queues.find((q) => q.id === "packing_recovery")!;
  assert.equal(q.view, "recovery");
  assert.ok(q.count > 0);
  assert.equal(db().prepare("SELECT total_changes() n").get()!.n, before);
  assert.equal(R.recoveryTask(worker, t.id).lines[0].replaced, 0);
});

test("kontrola kopii wykrywa niepełny schemat i utracone rozliczenie wymiany, a czyta starszy format", async () => {
  const f = fixture();
  packAll(f);
  const t = damage(f);
  assert.equal(A.integrity().ok, true);
  const filename = path.join(
    mkdtempSync(path.join(tmpdir(), "wms-recovery-backup-")),
    "copy.db",
  );
  await backup(db(), filename);
  const copy = new DatabaseSync(filename);
  try {
    copy
      .prepare(
        "UPDATE wms_pack_damage SET replaced=quantity WHERE recovery_id=?",
      )
      .run(t.id);
    assert.equal(A.integrity(copy).ok, false);
    assert.ok(A.integrity(copy).packingRecovery.some((r) => r.id === t.id));
    copy.exec("PRAGMA foreign_keys=OFF; DROP TABLE wms_pack_damage");
    assert.throws(() => A.integrity(copy), /Niepełny schemat wymian/);
    copy.exec("DROP TABLE wms_pack_recovery");
    assert.equal(A.integrity(copy).ok, true);
  } finally {
    copy.close();
  }
});

test("inny operator dostarcza części z dwóch półek, a pakujący zachowuje osobną kontrolę po częściowym zwolnieniu", () => {
  const f = fixture();
  packAll(f);
  const t = damage(f, 2);
  const twId = f.order.lines[0].tw_id;
  W.changeStock(admin, randomUUID(), {
    action: "count",
    twId,
    bin: "PICK",
    quantity: 1,
    version: db()
      .prepare("SELECT version FROM wms_stock WHERE tw_id=? AND bin='PICK'")
      .get(twId)!.version,
    reason: "Stan seeded",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId,
    bin: "PICK-ALT",
    quantity: 1,
    reason: "Druga półka seeded",
  });
  const picker = { ...worker, id: 3, name: "Dostarczenie" };
  let assigned = R.claimRecovery(picker, randomUUID(), t.id, {
    version: t.version,
  });
  assert.equal(assigned.picks.length, 2);
  assert.throws(() => R.recoveryTask(worker, t.id));
  assert.equal(R.recoveryTask(admin, t.id).user_id, picker.id);
  assigned = R.pickRecovery(picker, randomUUID(), t.id, pickup(assigned));
  assert.equal(assigned.lines[0].replaced, 1);
  assigned = R.releaseRecovery(picker, randomUUID(), t.id, {
    version: assigned.version,
    sources: assigned.picks.map((p) => String(p.bin)),
    reason: "Zmiana operatora po dostarczeniu",
  });
  let order = W.getOrder(f.order.id);
  assert.equal(order.lines[0].picked, 2);
  assert.equal(order.lines[0].packed, 1);
  order = W.actOnOrder(worker, randomUUID(), order.id, {
    action: "pack",
    version: order.version,
    barcode: f.products[0].sku,
    quantity: 1,
  });
  assigned = R.claimRecovery(worker, randomUUID(), t.id, {
    version: assigned.version,
  });
  assigned = R.pickRecovery(worker, randomUUID(), t.id, pickup(assigned));
  assert.ok(assigned.completed_at);
  order = W.getOrder(order.id);
  assert.equal(order.lines[0].picked, 3);
  assert.equal(order.lines[0].packed, 2);
  assert.equal(order.packingRecovery, null);
  assert.equal(A.integrity().ok, true);
});
