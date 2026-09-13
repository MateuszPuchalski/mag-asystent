import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-inbound-dispatch-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(
  tmpdir(),
  "wms-inbound-dispatch-no-env.local",
);

test("brakująca dostawa przechodzi z bufora przez wózek i pakowanie do kuriera bez ręcznej alokacji", async () => {
  const W = await import("./wms.js"),
    I = await import("./wms-inbound.js"),
    P = await import("./wms-putaway.js");
  const C = await import("./wms-carts.js"),
    D = await import("./wms-dispatch.js"),
    A = await import("./wms-analytics.js");
  const { db } = await import("../db/db.js");
  const office = { id: 1, name: "Biuro", role: "admin" as const };
  const receiver = { id: 2, name: "Przyjęcie", role: "magazynier" as const };
  const picker = { id: 3, name: "Zbiórka", role: "magazynier" as const };
  const packer = { id: 4, name: "Pakowanie", role: "magazynier" as const };
  db()
    .prepare(
      "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (1,'FLOW-PART','Koło kosiarki','05900001')",
    )
    .run();
  for (const [bin, mode] of [
    ["FLOW-BUFFER", "reserve"],
    ["FLOW-PICK", "pick"],
  ] as const) {
    W.configureBin(office, randomUUID(), {
      bin,
      mode,
      version: 1,
      reason: "Lokalizacja seeded",
    });
  }
  const cart = C.configureCart(office, randomUUID(), {
    code: "FLOW-CART",
    name: "Wózek testowy",
    capacity: 20,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: `FLOW-BOX-${i + 1}`,
    })),
  });
  C.configureStation(office, randomUUID(), {
    code: "FLOW-PACK",
    name: "Pakowanie seeded",
    kind: "pack",
    active: true,
    version: 0,
  });
  let order = W.createOrder(office, randomUUID(), {
    reference: "FLOW-ORDER",
    channel: "seeded",
    priority: 2,
    dueAt: "2026-09-13T10:00:00Z",
    lines: [{ sku: "FLOW-PART", quantity: 3 }],
  });
  const start = () =>
    C.startCart(picker, randomUUID(), { barcode: cart.code }).run;
  assert.equal(start(), null);
  const inbound = I.createInbound(office, randomUUID(), {
    reference: "FLOW-PZ",
    supplier: "Seeded",
    lines: [{ sku: "FLOW-PART", quantity: 5 }],
  });
  const line = I.getInbound(inbound.id).lines[0];
  const receiveBody = {
    lineId: line.id,
    version: line.version,
    barcode: "FLOW-PART",
    bin: "FLOW-BUFFER",
    quantity: 5,
    disposition: "good",
    staged: true,
  };
  const receiveKey = randomUUID();
  const received = I.putawayInbound(
    receiver,
    receiveKey,
    inbound.id,
    receiveBody,
  );
  assert.deepEqual(
    I.putawayInbound(receiver, receiveKey, inbound.id, receiveBody),
    JSON.parse(JSON.stringify(received)),
  );
  I.closeInbound(receiver, randomUUID(), inbound.id, {
    version: I.getInbound(inbound.id).version,
  });
  // Zamknięty dokument i powtórzony odbiór nie udostępniają chronionego bufora zbiórce.
  assert.equal(start(), null);
  assert.equal(P.listPutaway(receiver, {}).rows[0].order_shortage, 3);
  let task = P.claimPutaway(receiver, randomUUID(), received.workId!, {
    version: 1,
    source: "FLOW-BUFFER",
  });
  const put = (quantity: number) => {
    const key = randomUUID(),
      body = {
        version: task.version,
        source: "FLOW-BUFFER",
        barcode: "FLOW-PART",
        quantity,
        target: "FLOW-PICK",
      };
    task = P.finishPutaway(receiver, key, task.id, body);
    assert.deepEqual(
      P.finishPutaway(receiver, key, task.id, body),
      JSON.parse(JSON.stringify(task)),
    );
  };
  put(2);
  assert.equal(start(), null);
  assert.equal(W.getOrder(order.id).status, "new");
  assert.equal(P.listPutaway(receiver, {}).rows[0].order_shortage, 1);
  put(1);
  assert.equal(task.remaining, 2);
  assert.equal(P.listPutaway(receiver, {}).rows[0].order_shortage, 0);
  const startKey = randomUUID(),
    startBody = { barcode: cart.code };
  const assigned = C.startCart(picker, startKey, startBody);
  assert.deepEqual(
    C.startCart(picker, startKey, startBody),
    JSON.parse(JSON.stringify(assigned)),
  );
  const run = assigned.run!;
  assert.ok(run);
  assert.equal(run.orders.length, 1);
  assert.equal(run.orders[0].id, order.id);
  order = W.getOrder(order.id);
  assert.equal(order.status, "picking");
  assert.equal(order.tote, "FLOW-BOX-1");
  assert.equal(order.allocations.length, 1);
  assert.equal(order.allocations[0].bin, "FLOW-PICK");
  const pick = run.tasks[0];
  W.pickWave(picker, randomUUID(), run.id, {
    orderId: order.id,
    version: pick.version,
    allocationId: pick.allocation_id,
    bin: pick.bin,
    barcode: "FLOW-PART",
    tote: order.tote,
    quantity: 3,
  });
  assert.throws(
    () =>
      C.packCartBox(packer, randomUUID(), {
        box: "FLOW-BOX-1",
        station: "FLOW-PACK",
      }),
    /przekazana/,
  );
  C.handoffCart(picker, randomUUID(), run.id, {
    cart: cart.code,
    station: "FLOW-PACK",
  });
  order = C.packCartBox(packer, randomUUID(), {
    box: "FLOW-BOX-1",
    station: "FLOW-PACK",
  });
  order = W.actOnOrder(packer, randomUUID(), order.id, {
    action: "pack",
    version: order.version,
    barcode: "FLOW-PART",
    quantity: 3,
  });
  order = W.actOnOrder(packer, randomUUID(), order.id, {
    action: "ship",
    version: order.version,
    carrier: "SEEDED",
    tracking: "FLOW-TRACK",
    weightG: 500,
  });
  assert.equal(order.status, "packed");
  assert.equal(order.shipped_at, null);
  assert.equal(order.shipments.length, 1);
  assert.deepEqual(order.shipments[0].contents, [
    {
      line_id: order.lines[0].id,
      tw_id: 1,
      sku: "FLOW-PART",
      name: "Koło kosiarki",
      quantity: 3,
    },
  ]);
  assert.equal(C.getCart(picker, cart.code).slots[0].box_barcode, "FLOW-BOX-1");
  const batch = D.createHandoff(packer, randomUUID(), { carrier: "SEEDED" });
  D.scanHandoff(packer, randomUUID(), batch.id, { tracking: "FLOW-TRACK" });
  assert.equal(W.getOrder(order.id).status, "packed");
  const closeKey = randomUUID(),
    closeBody = { version: D.getHandoff(batch.id).version, parcels: 1 };
  const handed = D.closeHandoff(packer, closeKey, batch.id, closeBody);
  assert.deepEqual(
    D.closeHandoff(packer, closeKey, batch.id, closeBody),
    JSON.parse(JSON.stringify(handed)),
  );
  order = W.getOrder(order.id);
  assert.equal(order.status, "shipped");
  assert.ok(order.shipped_at);
  const stock = W.inventory({ q: "FLOW-PART" }).rows;
  assert.equal(stock.find((s) => s.bin === "FLOW-PICK")!.on_hand, 0);
  assert.equal(stock.find((s) => s.bin === "FLOW-PICK")!.reserved, 0);
  assert.equal(stock.find((s) => s.bin === "FLOW-BUFFER")!.on_hand, 2);
  assert.equal(P.getPutaway(task.id).remaining, 2);
  assert.equal(A.integrity().ok, true);
});
