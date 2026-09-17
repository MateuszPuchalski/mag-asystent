import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wms-empty-box-")),
  "seeded.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = join(tmpdir(), "empty-box-no-env.local");
let W: typeof import("./wms.js"),
  C: typeof import("./wms-carts.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const },
  picker = { id: 2, name: "Zbiórka", role: "magazynier" as const };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  C = await import("./wms-carts.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
  C.configureStation(admin, randomUUID(), {
    code: "PACK",
    name: "Pakowanie",
    kind: "pack",
    version: 0,
    active: true,
  });
});
function fixture(picked = 0, exception = true) {
  const n = ++serial,
    sku = `PART-${n}`,
    bin = `A-${n}`,
    box = `BOX-${n}`,
    cart = `CART-${n}`;
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
  const order = W.createOrder(admin, randomUUID(), {
    reference: `EMPTY-${n}`,
    channel: "seeded",
    dueAt: "2026-01-01T12:00:00Z",
    lines: [{ sku, quantity: 3 }],
  });
  C.configureCart(admin, randomUUID(), {
    code: cart,
    name: cart,
    capacity: 20,
    version: 0,
    boxes: Array.from({ length: 20 }, (_, i) => ({
      position: i + 1,
      barcode: i === 0 ? box : null,
    })),
  });
  const run = C.startCart(picker, randomUUID(), { barcode: cart }).run!,
    pick = run.tasks.find((t) => t.order_id === order.id)!;
  if (picked)
    W.pickWave(picker, randomUUID(), run.id, {
      orderId: order.id,
      version: pick.version,
      allocationId: pick.allocation_id,
      bin,
      barcode: sku,
      tote: box,
      quantity: picked,
    });
  const get = () => W.getOrder(order.id);
  if (exception)
    C.reportPickException(picker, randomUUID(), {
      orderId: order.id,
      version: get().version,
      allocationId: pick.allocation_id,
      box,
      kind: "missing",
      reason: "Brak części na półce",
    });
  else
    W.actOnOrder(admin, randomUUID(), order.id, {
      action: "hold",
      version: get().version,
      reason: "Klient chce zmienić część",
    });
  const body = () => ({
    orderId: order.id,
    version: get().version,
    at: get().emptyCartBox?.at,
    place: get().emptyCartBox?.place,
    box,
    emptyConfirmed: true,
    reason: "Skrzynka sprawdzona, zmiana zamówienia",
  });
  return {
    n,
    sku,
    bin,
    box,
    cart,
    run,
    pick,
    get,
    body,
    handoff: () =>
      C.handoffCart(picker, randomUUID(), run.id, { cart, station: "PACK" }),
  };
}
test("wycofanie pustej skrzynki zachowuje zamówienie, rezerwacje i przeliczenie zamiast wymuszać anulowanie", () => {
  const f = fixture(),
    before = f.get();
  const inventory = () => ({
    stock: db().prepare("SELECT * FROM wms_stock WHERE tw_id=?").all(f.n),
    allocations: f.get().allocations,
    movements: db()
      .prepare("SELECT * FROM wms_movement WHERE tw_id=? ORDER BY id")
      .all(f.n),
  });
  const balance = inventory();
  assert.equal(before.emptyCartBox?.at, "cart");
  assert.equal(before.emptyCartBox?.place, f.cart);
  assert.throws(
    () => C.withdrawEmptyCartBox(picker, randomUUID(), f.body()),
    /uprawnień biura/,
  );
  assert.throws(() =>
    C.withdrawEmptyCartBox(admin, randomUUID(), {
      ...f.body(),
      emptyConfirmed: false,
    }),
  );
  for (const patch of [{ box: "WRONG" }, { place: "WRONG" }, { at: "station" }])
    assert.throws(
      () =>
        C.withdrawEmptyCartBox(admin, randomUUID(), { ...f.body(), ...patch }),
      /zmieniła miejsce/,
    );
  assert.throws(
    () =>
      C.withdrawEmptyCartBox(admin, randomUUID(), {
        ...f.body(),
        version: before.version - 1,
      }),
    /zmieniło/,
  );
  const key = randomUUID(),
    input = f.body(),
    result = C.withdrawEmptyCartBox(admin, key, input);
  assert.deepEqual(
    C.withdrawEmptyCartBox(admin, key, input),
    JSON.parse(JSON.stringify(result)),
  );
  assert.equal(result.version, before.version + 1);
  assert.equal(result.status, "allocated");
  assert.equal(result.tote, null);
  assert.equal(result.hold_reason, before.hold_reason);
  assert.equal(result.emptyCartBox, null);
  assert.equal(result.wave_id, null);
  assert.deepEqual(inventory(), balance);
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_putback WHERE order_id=?")
      .get(result.id)?.n,
    0,
  );
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_pick_exception WHERE order_id=? AND resolved_at IS NULL",
      )
      .get(result.id)?.n,
    0,
  );
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
      )
      .get(f.n)?.n,
    1,
  );
  const run = C.getCartRun(picker, f.run.id);
  assert.equal(run.tasks.length, 0);
  assert.equal(run.orders.length, 0);
  assert.ok(run.assignments[0].ended_at);
  assert.equal(C.getCart(admin, f.cart).slots[0].box_barcode, f.box);
  const changed = W.actOnOrder(admin, randomUUID(), result.id, {
    action: "amend",
    version: result.version,
    reason: "Klient potrzebuje mniej",
    dueAt: "2026-09-14T12:00:00Z",
    priority: 0,
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  assert.equal(changed.lines[0].quantity, 1);
  assert.equal(changed.hold_reason, before.hold_reason);
  C.releaseCart(picker, randomUUID(), f.run.id, { cart: f.cart });
  assert.equal(A.integrity().ok, true);
});
test("przekazanie zmienia wymagany skan miejsca nawet bez zmiany wersji zamówienia", () => {
  const f = fixture(),
    old = f.body();
  f.handoff();
  assert.equal(f.get().version, old.version);
  assert.equal(f.get().emptyCartBox?.at, "station");
  assert.equal(f.get().emptyCartBox?.place, "PACK");
  assert.throws(
    () => C.withdrawEmptyCartBox(admin, randomUUID(), old),
    /zmieniła miejsce/,
  );
  const result = C.withdrawEmptyCartBox(admin, randomUUID(), f.body());
  assert.equal(result.status, "allocated");
  assert.ok(result.hold_reason);
  C.releaseCart(picker, randomUUID(), f.run.id, { cart: f.cart });
  assert.equal(A.integrity().ok, true);
});
test("zwrot wszystkich pobrań przed przekazaniem pozwala wycofać pustą skrzynkę bez dodatkowego zlecenia", () => {
  const f = fixture(1);
  W.actOnOrder(picker, randomUUID(), f.get().id, {
    action: "return",
    version: f.get().version,
    allocationId: f.pick.allocation_id,
    tote: f.box,
    bin: f.bin,
    barcode: f.sku,
    quantity: 1,
    reason: "Odłożenie przed zmianą zamówienia",
  });
  assert.equal(f.get().lines[0].picked, 0);
  assert.equal(f.get().emptyCartBox?.at, "cart");
  const result = C.withdrawEmptyCartBox(admin, randomUUID(), f.body());
  assert.equal(result.status, "allocated");
  assert.ok(result.hold_reason);
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_putback WHERE order_id=?")
      .get(result.id)?.n,
    0,
  );
  assert.equal(A.integrity().ok, true);
});
test("nieudana decyzja cofa przydział i zgłoszenie; pusta skrzynka może później obsłużyć nowe zamówienie", () => {
  const f = fixture(0, false);
  f.handoff();
  assert.throws(
    () =>
      W.actOnOrder(admin, randomUUID(), f.get().id, {
        action: "resume",
        version: f.get().version,
        reason: "Klient już odpowiedział",
      }),
    /wycofaj pustą skrzynkę/,
  );
  const before = f.get(),
    key = randomUUID(),
    input = f.body();
  const assignment = C.getCartRun(picker, f.run.id).assignments[0];
  db().exec(
    `CREATE TRIGGER fail_empty_box BEFORE UPDATE ON wms_order WHEN OLD.id=${before.id} BEGIN SELECT RAISE(ABORT,'empty-box-write-failed'); END`,
  );
  try {
    assert.throws(
      () => C.withdrawEmptyCartBox(admin, key, input),
      /empty-box-write-failed/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_empty_box");
  }
  assert.deepEqual(f.get(), before);
  assert.deepEqual(C.getCartRun(picker, f.run.id).assignments[0], assignment);
  C.withdrawEmptyCartBox(admin, key, input);
  C.releaseCart(picker, randomUUID(), f.run.id, { cart: f.cart });
  const fresh = W.createOrder(admin, randomUUID(), {
    reference: "FRESH-EMPTY-BOX",
    channel: "seeded",
    priority: 2,
    dueAt: "2000-01-01T12:00:00Z",
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  const newRun = C.startCart(picker, randomUUID(), { barcode: f.cart }).run!;
  assert.equal(W.getOrder(fresh.id).tote, f.box);
  assert.equal(newRun.tasks[0].order_id, fresh.id);
  const current = W.getOrder(fresh.id);
  C.withdrawEmptyCartBox(admin, key, input);
  assert.deepEqual(W.getOrder(fresh.id), current);
  assert.throws(
    () =>
      C.withdrawEmptyCartBox(admin, randomUUID(), {
        ...input,
        version: f.get().version,
      }),
    /wstrzymanej pustej/,
  );
  assert.equal(A.integrity().ok, true);
});
test("pobranie albo aktywna praca uniemożliwia deklarowanie pustej skrzynki", async () => {
  const f = fixture(1);
  f.handoff();
  const input = {
    orderId: f.get().id,
    version: f.get().version,
    box: f.box,
    at: "station",
    place: "PACK",
    emptyConfirmed: true,
    reason: "Próba ominięcia zwrotu",
  };
  assert.equal(f.get().emptyCartBox, null);
  assert.throws(
    () => C.withdrawEmptyCartBox(admin, randomUUID(), input),
    /wstrzymanej pustej/,
  );
  const P = await import("./wms-putback.js");
  P.requestPutback(admin, randomUUID(), {
    orderId: f.get().id,
    version: f.get().version,
    reason: "Zwrot pobrania",
  });
  assert.throws(
    () =>
      C.withdrawEmptyCartBox(admin, randomUUID(), {
        ...input,
        version: f.get().version,
      }),
    /wstrzymanej pustej/,
  );
  assert.equal(f.get().lines[0].picked, 1);
  assert.equal(A.integrity().ok, true);
});
