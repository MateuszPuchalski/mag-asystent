import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wms-returned-exception-")),
  "seeded.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = join(tmpdir(), "returned-exception-no-env.local");
let W: typeof import("./wms.js"),
  C: typeof import("./wms-carts.js"),
  P: typeof import("./wms-putback.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const },
  picker = { id: 2, name: "Zbiórka", role: "magazynier" as const };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  C = await import("./wms-carts.js");
  P = await import("./wms-putback.js");
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
function fixture(kind = "missing") {
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
    reference: `RETURN-EX-${n}`,
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
  W.pickWave(picker, randomUUID(), run.id, {
    orderId: order.id,
    version: pick.version,
    allocationId: pick.allocation_id,
    bin,
    barcode: sku,
    tote: box,
    quantity: 2,
  });
  C.reportPickException(picker, randomUUID(), {
    orderId: order.id,
    version: W.getOrder(order.id).version,
    allocationId: pick.allocation_id,
    box,
    kind,
    reason: "Problem podczas zbiórki",
  });
  const get = () => W.getOrder(order.id);
  const review = (version = get().version) => ({
    orderId: order.id,
    version,
    action: "review",
    reason: "Pobrania rozliczone, zmiana zamówienia",
  });
  assert.equal(get().returnedPickException, null);
  assert.throws(
    () => C.resolvePickException(admin, randomUUID(), review()),
    /zakończonego zwrotu/,
  );
  C.handoffCart(picker, randomUUID(), run.id, { cart, station: "PACK" });
  let task = P.requestPutback(admin, randomUUID(), {
    orderId: order.id,
    version: get().version,
    reason: "Zmiana po zwrocie",
  });
  task = P.claimPutback(picker, randomUUID(), task.id, {
    version: task.version,
    box,
    station: "PACK",
    contentsConfirmed: true,
  });
  const finish = () => {
    const p = task.picks[0];
    task = P.finishPutback(picker, randomUUID(), task.id, {
      version: task.version,
      orderVersion: task.order_version,
      box,
      allocationId: p.allocation_id,
      bin,
      barcode: sku,
      quantity: 1,
    });
    return task;
  };
  return { n, sku, bin, box, cart, run, get, review, finish };
}
test("pełny zwrot otwiera decyzję biura bez skanu dawnej skrzynki i bez odblokowania półki", () => {
  const f = fixture();
  f.finish();
  assert.equal(f.get().returnedPickException, null);
  assert.throws(
    () => C.resolvePickException(admin, randomUUID(), f.review()),
    /zakończonego zwrotu/,
  );
  const completed = f.finish(),
    before = f.get();
  assert.ok(completed.completed_at);
  assert.equal(before.tote, null);
  assert.equal(before.returnedPickException?.putback_id, completed.id);
  assert.equal(before.returnedPickException?.stock_check_open, 1);
  assert.throws(
    () => C.resolvePickException(picker, randomUUID(), f.review()),
    /uprawnień biura/,
  );
  assert.throws(
    () =>
      C.resolvePickException(admin, randomUUID(), f.review(before.version - 1)),
    /zmieniło/,
  );
  assert.throws(
    () =>
      C.resolvePickException(admin, randomUUID(), {
        ...f.review(),
        box: f.box,
      }),
    /zwolnionej skrzynki/,
  );
  for (const action of ["continue", "remove"])
    assert.throws(
      () =>
        C.resolvePickException(admin, randomUUID(), { ...f.review(), action }),
      /zeskanuj/,
    );
  const stock = () =>
    db().prepare("SELECT * FROM wms_stock WHERE tw_id=? ORDER BY bin").all(f.n);
  const stockBefore = stock();
  const key = randomUUID(),
    body = f.review();
  const reviewed = C.resolvePickException(admin, key, body);
  assert.deepEqual(
    C.resolvePickException(admin, key, body),
    JSON.parse(JSON.stringify(reviewed)),
  );
  assert.equal(reviewed.returnedPickException, null);
  assert.equal(reviewed.version, before.version + 1);
  assert.equal(reviewed.hold_reason, before.hold_reason);
  assert.deepEqual(stock(), stockBefore);
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
      )
      .get(f.n)?.n,
    1,
  );
  assert.throws(
    () => C.resolvePickException(admin, randomUUID(), f.review()),
    /zakończonego zwrotu/,
  );
  const changed = W.actOnOrder(admin, randomUUID(), reviewed.id, {
    action: "amend",
    version: reviewed.version,
    reason: "Klient potrzebuje mniej",
    dueAt: "2026-09-14T12:00:00Z",
    priority: 0,
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  assert.equal(changed.lines[0].quantity, 1);
  assert.equal(changed.hold_reason, before.hold_reason);
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
      )
      .get(f.n)?.n,
    1,
  );
  W.actOnOrder(admin, randomUUID(), changed.id, {
    action: "cancel",
    version: changed.version,
    reason: "Koniec próby seeded",
  });
  assert.equal(A.integrity().ok, true);
});
test("nieudany zapis decyzji cofa zamknięcie sprawy, a ten sam klucz pozwala ponowić", () => {
  const f = fixture("damaged");
  f.finish();
  f.finish();
  const before = f.get(),
    key = randomUUID(),
    body = f.review();
  db().exec(
    `CREATE TRIGGER fail_return_review BEFORE UPDATE ON wms_order WHEN OLD.id=${before.id} BEGIN SELECT RAISE(ABORT,'review-write-failed'); END`,
  );
  try {
    assert.throws(
      () => C.resolvePickException(admin, key, body),
      /review-write-failed/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_return_review");
  }
  assert.deepEqual(f.get(), before);
  const result = C.resolvePickException(admin, key, body);
  assert.equal(result.version, before.version + 1);
  assert.equal(result.returnedPickException, null);
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
      )
      .get(f.n)?.n,
    1,
  );
});
test("pełna skrzynka po zwrocie nie wymaga pozornego przeliczenia półki ani ingerencji w nowe zamówienie tej skrzynki", () => {
  const f = fixture("box_full");
  f.finish();
  f.finish();
  assert.equal(f.get().returnedPickException?.stock_check_open, 0);
  C.releaseCart(picker, randomUUID(), f.run.id, { cart: f.cart });
  C.bindCartBox(admin, randomUUID(), {
    cart: f.cart,
    version: C.getCart(admin, f.cart).version,
    position: 1,
    box: f.box,
  });
  const fresh = W.createOrder(admin, randomUUID(), {
    reference: "NEW-BOX-ORDER",
    channel: "seeded",
    priority: 2,
    dueAt: "2000-01-01T12:00:00Z",
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  C.startCart(picker, randomUUID(), { barcode: f.cart });
  const currentBoxOrder = W.getOrder(fresh.id);
  assert.equal(currentBoxOrder.tote, f.box);
  C.resolvePickException(admin, randomUUID(), f.review());
  assert.deepEqual(W.getOrder(fresh.id), currentBoxOrder);
  assert.ok(f.get().hold_reason);
  assert.equal(A.integrity().ok, true);
});
test("historia innego albo wcześniejszego zwrotu nie uprawnia do zamknięcia bieżącego zgłoszenia", () => {
  const f = fixture();
  const g = fixture();
  f.finish();
  const task = f.finish();
  const before = f.get(),
    exception = before.returnedPickException!;
  const probes = [
    ["UPDATE wms_putback SET order_id=? WHERE id=?", g.get().id, before.id],
    [
      "UPDATE wms_putback SET completed_at=? WHERE id=?",
      null,
      task.completed_at,
    ],
    [
      "UPDATE wms_putback SET cancelled_at=? WHERE id=?",
      "2026-01-01T00:00:00Z",
      null,
    ],
    [
      "UPDATE wms_putback SET created_at=? WHERE id=?",
      "2000-01-01T00:00:00Z",
      task.created_at,
    ],
  ] as const;
  for (const [sql, value, original] of probes) {
    db().prepare(sql).run(value, task.id);
    try {
      assert.equal(f.get().returnedPickException, null);
      assert.throws(
        () => C.resolvePickException(admin, randomUUID(), f.review()),
        /zakończonego zwrotu/,
      );
    } finally {
      db().prepare(sql).run(original, task.id);
    }
  }
  assert.equal(f.get().returnedPickException?.id, exception.id);
});
