import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-contents-")),
  "test.db",
);
let W: typeof import("./wms.js"),
  D: typeof import("./wms-dispatch.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const worker = { id: 2, name: "Pakowanie", role: "magazynier" as const },
  admin = { id: 1, name: "Biuro", role: "admin" as const };
let seq = 0;
before(async () => {
  W = await import("./wms.js");
  D = await import("./wms-dispatch.js");
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
test("skan i przełożenie zapisują zawartość raz, chronią wersję i osobę pakującą", () => {
  const f = fixture(),
    key = randomUUID(),
    body = {
      action: "pack",
      barcode: f.products[0].sku,
      quantity: 2,
      parcelNo: 1,
      version: f.order.version,
    };
  const saved = W.actOnOrder(worker, key, f.order.id, body);
  assert.deepEqual(
    W.actOnOrder(worker, key, f.order.id, body),
    JSON.parse(JSON.stringify(saved)),
  );
  assert.equal(saved.packingContents[0].quantity, 2);
  assert.throws(
    () => W.actOnOrder(worker, randomUUID(), f.order.id, body),
    /zmieniło/,
  );
  const move = {
    action: "pack-move",
    barcode: f.products[0].sku,
    quantity: 1,
    fromParcel: 1,
    toParcel: 2,
    version: saved.version,
  };
  assert.throws(
    () => W.actOnOrder(admin, randomUUID(), f.order.id, move),
    /inna osoba/,
  );
  const moveKey = randomUUID();
  const moved = W.actOnOrder(worker, moveKey, f.order.id, move);
  assert.deepEqual(
    W.actOnOrder(worker, moveKey, f.order.id, move),
    JSON.parse(JSON.stringify(moved)),
  );
  assert.equal(moved.lines[0].packed, 2);
  assert.deepEqual(
    moved.packingContents.map((c) => [c.parcel_no, c.quantity]),
    [
      [1, 1],
      [2, 1],
    ],
  );
  assert.throws(
    () =>
      W.actOnOrder(worker, randomUUID(), f.order.id, {
        ...move,
        version: moved.version,
        quantity: 2,
      }),
    /nie ma tylu/,
  );
  assert.throws(
    () =>
      W.actOnOrder(worker, randomUUID(), f.order.id, {
        ...move,
        version: moved.version,
        barcode: "FOREIGN",
      }),
    /nie należy/,
  );
  assert.throws(() =>
    W.actOnOrder(worker, randomUUID(), f.order.id, {
      ...body,
      version: moved.version,
      parcelNo: 21,
    }),
  );
});
test("puste paczki, brak etykiety i luka w numerach nie tworzą przesyłek", () => {
  const f = fixture();
  packAll(f);
  assert.throws(() => f.act(shipping(2)), /Każda paczka/);
  f.act({
    action: "pack-move",
    barcode: f.products[0].sku,
    quantity: 1,
    fromParcel: 1,
    toParcel: 3,
  });
  assert.throws(() => f.act(shipping(1)), /Każda paczka/);
  assert.throws(() => f.act(shipping(2)), /Każda paczka/);
  f.act({
    action: "pack-move",
    barcode: f.products[0].sku,
    quantity: 1,
    fromParcel: 3,
    toParcel: 2,
  });
  const saved = f.act(shipping(2));
  assert.equal(
    saved.shipments[0].contents.reduce((n, c) => n + Number(c.quantity), 0),
    3,
  );
  assert.equal(saved.shipments[1].contents[0].quantity, 1);
  assert.throws(
    () => f.act({ action: "pack-reset", reason: "Ponowna kontrola" }),
    /przygotowane paczki/,
  );
  assert.throws(
    () =>
      db()
        .prepare(
          "UPDATE wms_shipment_content SET quantity=9 WHERE shipment_id=?",
        )
        .run(saved.shipments[0].id),
    /immutable/,
  );
  assert.throws(
    () =>
      db()
        .prepare("DELETE FROM wms_shipment_content WHERE shipment_id=?")
        .run(saved.shipments[0].id),
    /immutable/,
  );
});
test("odbiór jednej paczki odejmuje tylko jej SKU i sztuki od zapasu przy stanowisku", () => {
  const f = fixture();
  f.act({
    action: "pack",
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 1,
  });
  f.act({
    action: "pack",
    barcode: f.products[0].sku,
    quantity: 2,
    parcelNo: 2,
  });
  f.act({
    action: "pack",
    barcode: f.products[1].sku,
    quantity: 1,
    parcelNo: 2,
  });
  const order = f.act(shipping(2));
  const batch = D.createHandoff(worker, randomUUID(), { carrier: "DEMO" });
  const scanned = D.scanHandoff(worker, randomUUID(), batch.id, {
    tracking: order.shipments[0].tracking,
  });
  D.closeHandoff(worker, randomUUID(), batch.id, {
    version: scanned.version,
    parcels: 1,
  });
  for (const [i, expected] of [
    [0, 2],
    [1, 1],
  ]) {
    const r = A.erpReconciliation().rows.find(
      (r) => r.tw_id === order.lines[i].tw_id,
    )!;
    assert.equal(r.staged, expected);
    assert.equal(r.partial_dispatch, 0);
  }
  assert.equal(W.getOrder(order.id).status, "packed");
});
test("awaria zapisu drugiej zawartości cofa etykiety, skrzynkę i komendę", () => {
  const f = fixture();
  packAll(f);
  f.act({
    action: "pack-move",
    barcode: f.products[0].sku,
    quantity: 1,
    fromParcel: 1,
    toParcel: 2,
  });
  const before = W.getOrder(f.order.id),
    key = randomUUID(),
    body = shipping(2);
  db().exec(
    `CREATE TEMP TRIGGER fail_contents BEFORE INSERT ON wms_shipment_content WHEN NEW.shipment_id=(SELECT max(id) FROM wms_shipment) AND (SELECT count(*) FROM wms_shipment WHERE order_id=${before.id})=2 BEGIN SELECT RAISE(ABORT,'contents failure'); END`,
  );
  try {
    assert.throws(() => f.act(body, key), /contents failure/);
  } finally {
    db().exec("DROP TRIGGER fail_contents");
  }
  assert.deepEqual(W.getOrder(before.id), before);
  assert.equal(f.act(body, key).shipments.length, 2);
});
test("ponowna kontrola usuwa roboczy podział; wycofane etykiety zachowują historyczną zawartość", () => {
  const f = fixture();
  packAll(f);
  f.act({ action: "pack-reset", reason: "Inny podział kartonów" });
  assert.equal(f.order.status, "packing");
  assert.equal(f.order.packingContents.length, 0);
  assert.equal(f.order.lines[0].picked, 3);
  assert.equal(f.order.lines[0].packed, 0);
  packAll(f);
  const ready = f.act(shipping());
  const reopened = D.reopenPacking(admin, randomUUID(), ready.id, {
    version: ready.version,
    tote: `REPACK-${seq}`,
    reason: "Uszkodzone opakowanie",
  });
  assert.equal(reopened.packingContents.length, 0);
  assert.equal(
    db()
      .prepare(
        "SELECT sum(quantity) AS n FROM wms_shipment_content WHERE shipment_id=?",
      )
      .get(ready.shipments[0].id)!.n,
    4,
  );
});
test("stara kontrola bez podziału może potwierdzić jedną paczkę, ale nie zmyśla dwóch", () => {
  const f = fixture();
  packAll(f);
  db()
    .prepare(
      "DELETE FROM wms_pack_content WHERE line_id IN (SELECT id FROM wms_line WHERE order_id=?)",
    )
    .run(f.order.id);
  assert.throws(() => f.act(shipping(2)), /Brak pełnego podziału/);
  const ready = f.act(shipping());
  assert.equal(ready.shipments[0].contents.length, 2);
});

test("dawny częściowy odbiór bez zawartości nadal pokazuje nieznany zapas", () => {
  const f = fixture();
  packAll(f);
  const ids = [1, 2].map((n) =>
    Number(
      db()
        .prepare(
          "INSERT INTO wms_shipment(order_id,package_no,carrier,tracking,weight_g,created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(f.order.id, n, "OLD", randomUUID(), 500, new Date().toISOString())
        .lastInsertRowid,
    ),
  );
  for (const id of ids)
    db()
      .prepare("INSERT INTO wms_parcel_state(shipment_id) VALUES (?)")
      .run(id);
  const order = W.getOrder(f.order.id);
  const b = D.createHandoff(worker, randomUUID(), { carrier: "OLD" });
  const scanned = D.scanHandoff(worker, randomUUID(), b.id, {
    tracking: order.shipments[0].tracking,
  });
  D.closeHandoff(worker, randomUUID(), b.id, {
    version: scanned.version,
    parcels: 1,
  });
  const row = A.erpReconciliation().rows.find(
    (r) => r.tw_id === order.lines[0].tw_id,
  )!;
  assert.equal(row.partial_dispatch, 1);
  assert.equal(row.staged, null);
  assert.equal(row.difference, null);
});

test("zmiana zamówienia po wycofaniu paczek nie usuwa historycznej zawartości", () => {
  const f = fixture();
  packAll(f);
  const ready = f.act(shipping());
  let o = D.reopenPacking(admin, randomUUID(), ready.id, {
    version: ready.version,
    tote: `AMEND-${seq}`,
    reason: "Klient zmienił zamówienie",
  });
  const act = (body: object) => {
    o = W.actOnOrder(admin, randomUUID(), o.id, {
      ...body,
      version: o.version,
    });
  };
  act({ action: "hold", reason: "Zmiana zawartości" });
  for (const a of o.allocations)
    act({
      action: "return",
      allocationId: a.id,
      barcode: o.lines.find((l) => l.id === a.line_id)!.sku,
      bin: a.bin,
      quantity: a.picked,
      reason: "Zwrot przed zmianą",
    });
  act({
    action: "amend",
    reason: "Nowe pozycje klienta",
    lines: [{ sku: f.products[0].sku, quantity: 1 }],
    dueAt: o.due_at,
    priority: 0,
  });
  assert.equal(o.lines.length, 1);
  assert.equal(o.lines[0].quantity, 1);
  const historical = db()
    .prepare(
      "SELECT sum(quantity) AS n FROM wms_shipment_content WHERE shipment_id=?",
    )
    .get(ready.shipments[0].id)!;
  assert.equal(historical.n, 4);
  assert.equal(A.integrity().ok, true);
});

test("cofnięcie jednej sztuki zachowuje pozostałe paczki, zapas i pozwala skontrolować tylko brak", () => {
  const f = fixture();
  f.act({
    action: "pack",
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 1,
  });
  f.act({
    action: "pack",
    barcode: f.products[0].sku,
    quantity: 2,
    parcelNo: 2,
  });
  f.act({
    action: "pack",
    barcode: f.products[1].sku,
    quantity: 1,
    parcelNo: 2,
  });
  const movements = db().prepare("SELECT count(*) n FROM wms_movement").get()!
    .n;
  const before = f.order;
  const key = randomUUID(),
    body = {
      action: "pack-unpack",
      barcode: f.products[0].sku,
      quantity: 1,
      fromParcel: 2,
      reason: "Omyłkowe potwierdzenie sztuki",
      version: before.version,
    };
  const changed = W.actOnOrder(worker, key, before.id, body);
  assert.equal(changed.status, "packing");
  assert.equal(changed.packed_at, null);
  assert.deepEqual(
    changed.lines.map((l) => l.packed),
    [2, 1],
  );
  assert.deepEqual(
    changed.lines.map((l) => l.picked),
    [3, 1],
  );
  assert.equal(
    changed.packingContents.find((c) => c.parcel_no === 1)!.quantity,
    1,
  );
  assert.equal(
    db().prepare("SELECT count(*) n FROM wms_movement").get()!.n,
    movements,
  );
  assert.equal(
    db()
      .prepare(
        "SELECT pack_completed_at FROM wms_order_timing WHERE order_id=?",
      )
      .get(before.id)!.pack_completed_at,
    null,
  );
  const writes = db().prepare("SELECT total_changes() n").get()!.n;
  assert.deepEqual(
    W.actOnOrder(worker, key, before.id, body),
    JSON.parse(JSON.stringify(changed)),
  );
  assert.equal(db().prepare("SELECT total_changes() n").get()!.n, writes);
  assert.throws(() =>
    W.actOnOrder(worker, randomUUID(), before.id, {
      ...shipping(2),
      version: changed.version,
    }),
  );
  const checked = W.actOnOrder(worker, randomUUID(), before.id, {
    action: "pack",
    barcode: f.products[0].sku,
    quantity: 1,
    parcelNo: 2,
    version: changed.version,
  });
  assert.equal(checked.status, "packed");
  const shipped = W.actOnOrder(worker, randomUUID(), before.id, {
    ...shipping(2),
    version: checked.version,
  });
  assert.deepEqual(
    shipped.shipments.map((s) =>
      s.contents.reduce((n, c) => n + Number(c.quantity), 0),
    ),
    [1, 3],
  );
  assert.throws(() =>
    W.actOnOrder(worker, randomUUID(), before.id, {
      ...body,
      version: shipped.version,
    }),
  );
});

test("cofnięcie kontroli sprawdza paczkę, kod, ilość, właściciela i wersję", () => {
  const f = fixture();
  packAll(f);
  const body = {
    action: "pack-unpack",
    barcode: f.products[0].sku,
    quantity: 1,
    fromParcel: 1,
    reason: "Powtórna kontrola",
  };
  for (const patch of [
    { fromParcel: 2 },
    { barcode: "WRONG" },
    { quantity: 4 },
    { quantity: 0 },
    { quantity: 1.5 },
    { reason: "" },
  ]) {
    assert.throws(() => f.act({ ...body, ...patch }));
    assert.equal(W.getOrder(f.order.id).status, "packed");
  }
  assert.throws(() =>
    W.actOnOrder(worker, randomUUID(), f.order.id, {
      ...body,
      version: f.order.version - 1,
    }),
  );
  assert.throws(() => f.act(body, randomUUID(), { ...worker, id: 3 }));
  const changed = f.act({ ...body, quantity: 3 });
  assert.equal(
    changed.packingContents.some((c) => c.line_id === changed.lines[0].id),
    false,
  );
  assert.equal(changed.lines[1].packed, 1);
});

test("błąd zapisu cofnięcia przywraca zawartość oraz pozwala powtórzyć ten sam klucz", () => {
  const f = fixture();
  packAll(f);
  const before = f.order,
    key = randomUUID();
  const body = {
    action: "pack-unpack",
    barcode: f.products[0].sku,
    quantity: 3,
    fromParcel: 1,
    reason: "Ponowne liczenie",
  };
  db().exec(
    "CREATE TEMP TRIGGER fail_unpack BEFORE UPDATE OF packed ON wms_line BEGIN SELECT RAISE(ABORT,'unpack rollback'); END",
  );
  try {
    assert.throws(() => f.act(body, key), /unpack rollback/);
  } finally {
    db().exec("DROP TRIGGER fail_unpack");
  }
  assert.deepEqual(W.getOrder(before.id), before);
  assert.equal(f.act(body, key).lines[0].packed, 0);
});
