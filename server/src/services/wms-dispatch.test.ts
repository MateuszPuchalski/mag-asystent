import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-dispatch-")),
  "test.db",
);
let W: typeof import("./wms.js"),
  D: typeof import("./wms-dispatch.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Hala", role: "magazynier" as const };
let seq = 0;
before(async () => {
  W = await import("./wms.js");
  D = await import("./wms-dispatch.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
});
function prepared(parcels = 1) {
  const twId = ++seq,
    sku = `OUT-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Seeded", `590OUT${twId}`);
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId,
    bin: "PICK-1",
    quantity: 4,
    reason: "Test seeded",
  });
  let order = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: new Date().toISOString(),
    lines: [{ sku, quantity: 2 }],
  });
  const act = (action: unknown) => {
    order = W.actOnOrder(worker, randomUUID(), order.id, {
      ...(action as object),
      version: order.version,
    });
  };
  order = W.actOnOrder(admin, randomUUID(), order.id, {
    action: "allocate",
    version: order.version,
  });
  act({ action: "pick-start", tote: `TOTE-${seq}` });
  act({
    action: "pick",
    allocationId: order.allocations[0].id,
    bin: "PICK-1",
    barcode: sku,
    quantity: 2,
  });
  act({ action: "pack-start", tote: order.tote });
  for (let i = 1; i <= parcels; i++)
    act({ action: "pack", barcode: sku, quantity: 2 / parcels, parcelNo: i });
  act({
    action: "ship",
    carrier: "DEMO",
    tracking: `OUT-${seq}-1`,
    weightG: 500,
    extraParcels: Array.from({ length: parcels - 1 }, (_, i) => ({
      carrier: "DEMO",
      tracking: `OUT-${seq}-${i + 2}`,
      weightG: 500,
    })),
  });
  return order;
}
test("numer przesyłki kończy pakowanie, ale nie potwierdza odbioru kuriera", () => {
  const order = prepared();
  assert.equal(order.status, "packed");
  assert.equal(order.shipped_at, null);
  assert.equal(order.tote, null);
});

test("zapisana paczka zachowuje sprawdzoną zawartość SKU", () => {
  const order = prepared();
  const contents = (order.shipments[0] as Record<string, unknown>).contents;
  assert.deepEqual(contents, [
    {
      line_id: order.lines[0].id,
      tw_id: order.lines[0].tw_id,
      sku: order.lines[0].sku,
      name: order.lines[0].name,
      quantity: 2,
    },
  ]);
});
test("skan jest odporny na powtórzenie, a zamówienie wielopaczkowe czeka na wszystkie odbiory", () => {
  const o = prepared(2),
    [p, q] = o.shipments;
  const batch = D.createHandoff(worker, randomUUID(), { carrier: "demo" });
  const key = randomUUID(),
    body = { tracking: p.tracking };
  const scanned = D.scanHandoff(worker, key, batch.id, body);
  assert.deepEqual(D.scanHandoff(worker, key, batch.id, body), scanned);
  assert.equal(
    D.scanHandoff(worker, randomUUID(), batch.id, body).alreadyScanned,
    true,
  );
  assert.equal(D.getHandoff(batch.id).totals!.parcels, 1);
  assert.throws(
    () =>
      D.closeHandoff(worker, randomUUID(), batch.id, {
        version: batch.version,
        parcels: 1,
      }),
    /zmieniło/,
  );
  D.closeHandoff(worker, randomUUID(), batch.id, {
    version: scanned.version,
    parcels: 1,
  });
  assert.equal(W.getOrder(o.id).status, "packed");
  assert.equal(W.getOrder(o.id).shipped_at, null);
  const physical = A.erpReconciliation().rows.find(
    (r) => r.tw_id === o.lines[0].tw_id,
  )!;
  assert.equal(physical.partial_dispatch, 0);
  assert.equal(physical.staged, 1);
  const second = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  const next = D.scanHandoff(worker, randomUUID(), second.id, {
    tracking: q.tracking,
  });
  const closeKey = randomUUID(),
    closeBody = { version: next.version, parcels: 1 };
  const closed = D.closeHandoff(worker, closeKey, second.id, closeBody);
  assert.deepEqual(
    D.closeHandoff(worker, closeKey, second.id, closeBody),
    closed,
  );
  assert.equal(W.getOrder(o.id).status, "shipped");
  assert.equal(W.getOrder(o.id).shipped_at, closed.closed_at);
  assert.throws(
    () =>
      D.scanHandoff(worker, randomUUID(), second.id, { tracking: p.tracking }),
    /zamknięte/,
  );
});
test("zły przewoźnik, obce przekazanie i wstrzymanie blokują wydanie bez częściowego zapisu", () => {
  const o = prepared(),
    p = o.shipments[0];
  const wrong = D.createHandoff(worker, randomUUID(), { carrier: "OTHER" });
  assert.throws(
    () =>
      D.scanHandoff(worker, randomUUID(), wrong.id, { tracking: p.tracking }),
    /Brak jednoznacznej/,
  );
  const first = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  const scanned = D.scanHandoff(worker, randomUUID(), first.id, {
    tracking: p.tracking,
  });
  const second = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  assert.throws(
    () =>
      D.scanHandoff(worker, randomUUID(), second.id, { tracking: p.tracking }),
    /już na przekazaniu/,
  );
  const held = W.actOnOrder(worker, randomUUID(), o.id, {
    action: "hold",
    version: o.version,
    reason: "Sprawdzenie paczki",
  });
  assert.throws(
    () =>
      D.closeHandoff(worker, randomUUID(), first.id, {
        version: scanned.version,
        parcels: 1,
      }),
    /wstrzymaną/,
  );
  assert.equal(D.getHandoff(first.id).closed_at, null);
  assert.equal(W.getOrder(o.id).shipped_at, null);
  const removed = D.removeHandoff(worker, randomUUID(), first.id, {
    version: scanned.version,
    tracking: p.tracking,
    reason: "Paczka pozostaje",
  });
  assert.equal(removed.totals!.parcels, 0);
  W.actOnOrder(admin, randomUUID(), o.id, {
    action: "resume",
    version: held.version,
    reason: "Sprawdzono paczkę",
  });
  assert.equal(
    D.scanHandoff(worker, randomUUID(), second.id, { tracking: p.tracking })
      .totals!.parcels,
    1,
  );
});
test("korekta etykiety wymaga biura, chroni tożsamość i nie zmienia historii poprzedniego skanu", () => {
  const o = prepared(),
    p = o.shipments[0];
  const corrected = {
    version: 1,
    carrier: "demo",
    tracking: `FIXED-${seq}`,
    weightG: 600,
    reason: "Błędna etykieta",
  };
  assert.throws(
    () => D.correctParcel(worker, randomUUID(), Number(p.id), corrected),
    /uprawnień/,
  );
  const b = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  const added = D.scanHandoff(worker, randomUUID(), b.id, {
    tracking: p.tracking,
  });
  assert.throws(
    () => D.correctParcel(admin, randomUUID(), Number(p.id), corrected),
    /usuń paczkę/,
  );
  D.removeHandoff(worker, randomUUID(), b.id, {
    version: added.version,
    tracking: p.tracking,
    reason: "Poprawiam etykietę",
  });
  D.correctParcel(admin, randomUUID(), Number(p.id), corrected);
  assert.equal(
    db()
      .prepare("SELECT tracking FROM wms_dispatch_entry WHERE shipment_id=?")
      .get(p.id)!.tracking,
    p.tracking,
  );
  assert.equal(W.getOrder(o.id).shipments[0].tracking, corrected.tracking);
  assert.throws(
    () => D.scanHandoff(worker, randomUUID(), b.id, { tracking: p.tracking }),
    /Brak jednoznacznej/,
  );
  assert.throws(
    () => D.correctParcel(admin, randomUUID(), Number(p.id), corrected),
    /zmieniła/,
  );
  const a = D.scanHandoff(worker, randomUUID(), b.id, {
    tracking: corrected.tracking,
  });
  D.closeHandoff(worker, randomUUID(), b.id, {
    version: a.version,
    parcels: 1,
  });
  assert.throws(
    () =>
      D.correctParcel(admin, randomUUID(), Number(p.id), {
        ...corrected,
        version: 3,
      }),
    /przed przekazaniem/,
  );
  assert.match(D.handoffCsv(b.id), new RegExp(corrected.tracking));
});
test("ponowna kontrola wycofuje etykiety i wymaga ponownego sprawdzenia zawartości", () => {
  const o = prepared(2);
  assert.throws(
    () =>
      W.actOnOrder(admin, randomUUID(), o.id, {
        action: "return",
        tote: o.tote ?? "RECHECK-1",
        version: o.version,
        allocationId: o.allocations[0].id,
        barcode: o.lines[0].sku,
        bin: "PICK-1",
        quantity: 1,
        reason: "Korekta paczki",
      }),
    /przygotowane paczki/,
  );
  const reopened = D.reopenPacking(admin, randomUUID(), o.id, {
    version: o.version,
    tote: "RECHECK-1",
    reason: "Niewłaściwy karton",
  });
  assert.equal(reopened.status, "picked");
  assert.equal(reopened.lines[0].packed, 0);
  assert.equal(reopened.shipments.length, 0);
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_parcel_state p JOIN wms_shipment s ON s.id=p.shipment_id WHERE s.order_id=? AND p.status='void'",
      )
      .get(o.id)!.n,
    2,
  );
  assert.throws(
    () =>
      W.actOnOrder(worker, randomUUID(), o.id, {
        action: "ship",
        version: reopened.version,
        carrier: "DEMO",
        tracking: "OTHER",
        weightG: 500,
      }),
    /etapie/,
  );
  let checked = W.actOnOrder(worker, randomUUID(), o.id, {
    action: "pack-start",
    version: reopened.version,
    tote: "RECHECK-1",
  });
  checked = W.actOnOrder(worker, randomUUID(), o.id, {
    action: "pack",
    version: checked.version,
    barcode: checked.lines[0].sku,
    quantity: 2,
  });
  const ready = W.actOnOrder(worker, randomUUID(), o.id, {
    action: "ship",
    version: checked.version,
    carrier: "DEMO",
    tracking: "RECHECK-NEW",
    weightG: 500,
  });
  assert.equal(ready.shipments.length, 1);
  assert.equal(ready.shipments[0].package_no, 3);
});
test("awaria podczas zamknięcia wycofuje wszystkie paczki i pozwala bezpiecznie ponowić", () => {
  const o = prepared(2),
    b = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  for (const p of o.shipments)
    D.scanHandoff(worker, randomUUID(), b.id, { tracking: p.tracking });
  const current = D.getHandoff(b.id),
    key = randomUUID(),
    body = { version: current.version, parcels: 2 };
  db().exec(
    "CREATE TEMP TRIGGER fail_handoff BEFORE UPDATE OF closed_at ON wms_dispatch_batch BEGIN SELECT RAISE(ABORT,'handoff failure'); END",
  );
  try {
    assert.throws(
      () => D.closeHandoff(worker, key, b.id, body),
      /handoff failure/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_handoff");
  }
  assert.equal(W.getOrder(o.id).shipped_at, null);
  assert.ok(
    W.getOrder(o.id).shipments.every((p) => p.dispatch_status === "ready"),
  );
  assert.equal(D.getHandoff(b.id).closed_at, null);
  D.closeHandoff(worker, key, b.id, body);
  assert.equal(W.getOrder(o.id).status, "shipped");
});
test("pusta lista może zostać zamknięta; zamknięta historia nie pozwala zmieniać dowodu odbioru", () => {
  const empty = D.createHandoff(worker, randomUUID(), { carrier: "EMPTY" });
  assert.ok(
    D.closeHandoff(worker, randomUUID(), empty.id, {
      version: empty.version,
      parcels: 0,
    }).closed_at,
  );
  const o = prepared(),
    b = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  const scanned = D.scanHandoff(worker, randomUUID(), b.id, {
    tracking: o.shipments[0].tracking,
  });
  D.closeHandoff(worker, randomUUID(), b.id, {
    version: scanned.version,
    parcels: 1,
  });
  assert.throws(
    () =>
      db()
        .prepare("UPDATE wms_dispatch_batch SET closed_at=NULL WHERE id=?")
        .run(b.id),
    /immutable/,
  );
  assert.throws(
    () =>
      db().prepare("DELETE FROM wms_dispatch_entry WHERE batch_id=?").run(b.id),
    /immutable/,
  );
  assert.throws(
    () =>
      db()
        .prepare("UPDATE wms_dispatch_entry SET removed_at=? WHERE batch_id=?")
        .run(new Date().toISOString(), b.id),
    /immutable/,
  );
  assert.equal(A.integrity().ok, true);
});
test("korekta nie może podwoić numeru przesyłki nawet przy zmianie wielkości liter", () => {
  const first = prepared(),
    second = prepared();
  assert.throws(
    () =>
      D.correctParcel(admin, randomUUID(), Number(second.shipments[0].id), {
        version: 1,
        carrier: "demo",
        tracking: String(first.shipments[0].tracking).toLowerCase(),
        weightG: 100,
        reason: "Pomyłka numeru",
      }),
    /już użyty/,
  );
  assert.equal(
    W.getOrder(second.id).shipments[0].tracking,
    second.shipments[0].tracking,
  );
});
