import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wms-putback-")),
  "seeded.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = join(tmpdir(), "putback-no-env.local");
let W: typeof import("./wms.js"),
  C: typeof import("./wms-carts.js"),
  P: typeof import("./wms-putback.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const },
  picker = { id: 2, name: "Zbiórka", role: "magazynier" as const },
  packer = { id: 3, name: "Pakowanie", role: "magazynier" as const },
  worker = { id: 4, name: "Zwroty", role: "magazynier" as const };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  C = await import("./wms-carts.js");
  P = await import("./wms-putback.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
  for (const [code, kind] of [
    ["PACK", "pack"],
    ["EX", "exception"],
  ] as const)
    C.configureStation(admin, randomUUID(), {
      code,
      name: code,
      kind,
      version: 0,
      active: true,
    });
});
function fixture() {
  const n = ++serial,
    sku = `PART-${n}`,
    bin = `A-${n}`,
    cart = `C-${n}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(n, sku, "Część seeded");
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: n,
    bin,
    quantity: 10,
    reason: "Dostawa",
  });
  let o = W.createOrder(admin, randomUUID(), {
    reference: `ORDER-${n}`,
    channel: "seeded",
    dueAt: "2026-09-12T12:00:00Z",
    lines: [{ sku, quantity: 3 }],
  });
  C.configureCart(admin, randomUUID(), {
    code: cart,
    name: cart,
    capacity: 20,
    version: 0,
    selection: "all",
    maxUnits: 3,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: `${cart}-B${i + 1}`,
    })),
  });
  const run = C.startCart(picker, randomUUID(), { barcode: cart }).run!;
  const t = run.tasks.find((t) => t.order_id === o.id)!;
  W.pickWave(picker, randomUUID(), run.id, {
    orderId: o.id,
    version: t.version,
    allocationId: t.allocation_id,
    bin,
    barcode: sku,
    tote: t.tote,
    quantity: 3,
  });
  C.handoffCart(picker, randomUUID(), run.id, { cart, station: "PACK" });
  o = C.packCartBox(packer, randomUUID(), { box: t.tote, station: "PACK" });
  o = W.actOnOrder(packer, randomUUID(), o.id, {
    action: "pack",
    version: o.version,
    barcode: sku,
    quantity: 1,
    parcelNo: 1,
  });
  o = W.actOnOrder(admin, randomUUID(), o.id, {
    action: "hold",
    version: o.version,
    reason: "Klient anuluje",
  });
  return {
    n,
    sku,
    bin,
    cart,
    runId: run.id,
    get order() {
      return W.getOrder(o.id);
    },
    request() {
      return P.requestPutback(admin, randomUUID(), {
        orderId: o.id,
        version: W.getOrder(o.id).version,
        reason: "Zwrot przed anulowaniem",
      });
    },
  };
}
function claim(
  t: ReturnType<typeof P.putbackTask>,
  actor = worker,
  key = randomUUID(),
) {
  return P.claimPutback(actor, key, t.id, {
    version: t.version,
    box: t.box,
    station: t.station,
    contentsConfirmed: true,
  });
}
function body(t: ReturnType<typeof P.putbackTask>, quantity = 1) {
  const p = t.picks[0];
  return {
    version: t.version,
    orderVersion: t.order_version,
    box: t.box,
    allocationId: p.allocation_id,
    bin: p.bin,
    barcode: p.sku,
    quantity,
  };
}

test("jawny zwrot z pakowania przekazuje skrzynkę trzeciemu operatorowi i zwalnia wózek bez pozornego przyjęcia", () => {
  const f = fixture(),
    before = f.order;
  assert.throws(
    () =>
      C.detachCartBox(packer, randomUUID(), f.runId, {
        version: before.version,
        box: before.tote,
        station: "EX",
      }),
    /Zakończ pakowanie/,
  );
  let t = f.request();
  assert.equal(t.user_id, null);
  assert.equal(f.order.lines[0].packed, 1);
  assert.equal(C.getCartRun(picker, f.runId).returns.length, 0);
  assert.throws(
    () =>
      W.actOnOrder(admin, randomUUID(), before.id, {
        action: "resume",
        version: f.order.version,
        reason: "Adres poprawiony",
      }),
    /zlecony zwrot/,
  );
  assert.throws(
    () =>
      W.actOnOrder(packer, randomUUID(), before.id, {
        action: "return",
        version: f.order.version,
        tote: before.tote,
        allocationId: before.allocations[0].id,
        bin: f.bin,
        barcode: f.sku,
        quantity: 1,
        reason: "Równoległy zwrot",
      }),
    /zlecony zwrot/,
  );
  t = claim(t);
  assert.equal(t.user_id, 4);
  assert.equal(f.order.lines[0].picked, 3);
  assert.equal(f.order.lines[0].packed, 0);
  assert.deepEqual(f.order.packingContents, []);
  assert.equal(C.getCart(picker, f.cart).slots[0].box_barcode, null);
  C.releaseCart(picker, randomUUID(), f.runId, { cart: f.cart });
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(f.n, f.bin)!.on_hand,
    7,
  );
  t = P.finishPutback(worker, randomUUID(), t.id, body(t));
  assert.equal(t.picks[0].remaining, 2);
  assert.equal(t.completed_at, null);
  t = P.finishPutback(worker, randomUUID(), t.id, body(t, 2));
  assert.ok(t.completed_at);
  assert.equal(t.picks.length, 0);
  assert.equal(f.order.hold_reason, "Klient anuluje");
  W.actOnOrder(admin, randomUUID(), before.id, {
    action: "cancel",
    version: f.order.version,
    reason: "Pobrania odłożone",
  });
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(f.n, f.bin)!.on_hand,
    10,
  );
  assert.equal(A.integrity().ok, true);
});
test("zlecenie i podjęcie odrzucają brak wstrzymania, obcego operatora, starą wersję i inne miejsce", () => {
  const f = fixture();
  let o = f.order;
  W.actOnOrder(admin, randomUUID(), o.id, {
    action: "resume",
    version: o.version,
    reason: "Adres poprawiony",
  });
  assert.throws(() => f.request(), /wstrzymanej skrzynki/);
  o = f.order;
  W.actOnOrder(admin, randomUUID(), o.id, {
    action: "hold",
    version: o.version,
    reason: "Anulowanie klienta",
  });
  let t = f.request();
  assert.throws(
    () =>
      P.requestPutback(packer, randomUUID(), {
        orderId: o.id,
        version: f.order.version,
        reason: "Duplikat",
      }),
    /biur|uprawni/i,
  );
  assert.throws(
    () =>
      P.claimPutback(worker, randomUUID(), t.id, {
        version: t.version,
        box: t.box,
        station: "EX",
        contentsConfirmed: true,
      }),
    /stanowisko/,
  );
  assert.throws(
    () =>
      P.claimPutback(worker, randomUUID(), t.id, {
        version: t.version,
        box: t.box,
        station: t.station,
      }),
    /contentsConfirmed/,
  );
  t = claim(t);
  assert.throws(() => claim(t, packer), /podjęty/);
  assert.throws(
    () => P.finishPutback(packer, randomUUID(), t.id, body(t)),
    /innego operatora/,
  );
  assert.throws(
    () =>
      P.abortPutback(admin, randomUUID(), t.id, {
        version: t.version,
        reason: "Przerwanie",
      }),
    /zwolnić zadanie/,
  );
  t = P.releasePutback(worker, randomUUID(), t.id, {
    version: t.version,
    box: t.box,
    station: t.station,
    reason: "Zmiana operatora",
  });
  assert.equal(t.user_id, null);
  assert.equal(t.picks[0].remaining, 3);
  t = claim(t, packer);
  t = P.finishPutback(packer, randomUUID(), t.id, body(t, 3));
  assert.ok(t.completed_at);
  assert.equal(A.integrity().ok, true);
});
test("awaria podjęcia cofa paczki i pozycję, ponowienie partii zachowuje jeden ruch, przerwanie zostawia wstrzymanie", () => {
  const f = fixture();
  let t = f.request();
  db().exec(
    "CREATE TRIGGER fail_putback BEFORE UPDATE ON wms_putback BEGIN SELECT RAISE(ABORT,'putback rollback'); END",
  );
  const key = randomUUID();
  assert.throws(() => claim(t, worker, key), /putback rollback/);
  assert.equal(f.order.lines[0].packed, 1);
  assert.equal(C.getCart(picker, f.cart).slots[0].box_barcode, t.box);
  db().exec("DROP TRIGGER fail_putback");
  t = claim(t, worker, key);
  const returned = body(t),
    returnKey = randomUUID();
  const first = P.finishPutback(worker, returnKey, t.id, returned);
  assert.deepEqual(
    P.finishPutback(worker, returnKey, t.id, returned),
    JSON.parse(JSON.stringify(first)),
  );
  assert.equal(f.order.lines[0].picked, 2);
  t = P.releasePutback(worker, randomUUID(), t.id, {
    version: first.version,
    box: t.box,
    station: t.station,
    reason: "Przekazanie do biura",
  });
  t = P.abortPutback(admin, randomUUID(), t.id, {
    version: t.version,
    reason: "Dalsze wyjaśnienie",
  });
  assert.ok(t.cancelled_at);
  assert.ok(f.order.hold_reason);
  assert.equal(f.order.lines[0].picked, 2);
  assert.equal(A.integrity().ok, true);
});
test("kolejka i analityka pokazują zlecony zwrot, a kontrola kopii wykrywa utratę wstrzymania", async () => {
  const f = fixture(),
    t = f.request();
  const queue = P.putbackQueue(worker, { q: f.order.reference, offset: 0 });
  assert.equal(queue.total, 1);
  assert.equal(queue.rows[0].remaining, 3);
  const { flowAnalytics } = await import("./wms-flow-analytics.js");
  const flow = flowAnalytics(
    db(),
    "2026-01-01T00:00:00Z",
    "2026-12-31T00:00:00Z",
  );
  assert.equal(flow.queues.find((q) => q.id === "putback")!.count, 1);
  const { verifiedBackup } = await import("./wms-backup.js");
  await verifiedBackup(
    process.env.DB_PATH!,
    join(mkdtempSync(join(tmpdir(), "wms-putback-copy-")), "copy.db"),
  );
  db()
    .prepare("UPDATE wms_order SET hold_reason=NULL WHERE id=?")
    .run(t.order_id);
  assert.equal(A.integrity().ok, false);
  assert.equal(A.integrity().putback[0].id, t.id);
  db()
    .prepare("UPDATE wms_order SET hold_reason='Zwrot zlecony' WHERE id=?")
    .run(t.order_id);
  assert.equal(A.integrity().ok, true);
});
