import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-replenish-priority-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(
  os.tmpdir(),
  "wms-replenish-priority-no-env.local",
);
let S: typeof import("./wms-stock-work.js"),
  W: typeof import("./wms.js"),
  db: typeof import("../db/db.js").db;
const office = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Uzupełniający", role: "magazynier" as const };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  S = await import("./wms-stock-work.js");
  ({ db } = await import("../db/db.js"));
});
function fixture() {
  const twId = ++serial,
    sku = `REPL-${twId}`,
    barcode = `00590${twId}`,
    source = `RES-${twId}`,
    target = `A-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Nóż kosiarki", barcode);
  W.configureBin(office, randomUUID(), {
    bin: source,
    mode: "reserve",
    version: 1,
    reason: "Zaplecze seeded",
  });
  for (const [bin, quantity] of [
    [source, 10],
    [target, 1],
  ] as const)
    W.changeStock(office, randomUUID(), {
      action: "receive",
      twId,
      bin,
      quantity,
      reason: "Dostawa seeded",
    });
  W.changeStock(office, randomUUID(), {
    action: "minimum",
    twId,
    bin: target,
    quantity: 5,
    version: 2,
    reason: "Minimum półki",
  });
  const plan = S.replenishmentWork(worker, { view: "plans", q: barcode })
    .plans[0];
  const claim = {
    twId,
    source,
    target,
    quantity: 4,
    sourceVersion: plan.source_version,
    targetVersion: plan.target_version,
  };
  return {
    twId,
    sku,
    barcode,
    source,
    target,
    claim,
    input: { source, target, barcode, quantity: 4 },
  };
}
const writes = () => db().prepare("SELECT total_changes() n").get()!.n;
const stock = (twId: number, bin: string) =>
  db()
    .prepare("SELECT * FROM wms_stock WHERE tw_id=? AND bin=?")
    .get(twId, bin)!;
function order(
  f: ReturnType<typeof fixture>,
  quantity: number,
  priority = 0,
  dueAt = "2026-12-31T12:00:00Z",
) {
  return W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    priority,
    dueAt,
    lines: [{ sku: f.sku, quantity }],
  });
}
function plan(f: ReturnType<typeof fixture>) {
  return S.replenishmentWork(worker, { view: "plans", q: f.barcode }).plans[0];
}
function positions(...fixtures: ReturnType<typeof fixture>[]) {
  const ids = fixtures.map((f) => f.twId);
  return S.replenishmentWork(worker, { view: "plans" })
    .plans.filter((p) => ids.includes(Number(p.tw_id)))
    .map((p) => p.tw_id);
}
test("zamówienie czekające na jedną sztukę wyprzedza duże minimum bez popytu", () => {
  const routine = fixture(),
    urgent = fixture();
  W.changeStock(office, randomUUID(), {
    action: "minimum",
    twId: routine.twId,
    bin: routine.target,
    quantity: 500,
    version: stock(routine.twId, routine.target).version,
    reason: "Duży zapas okresowy",
  });
  order(urgent, 2);
  const before = writes();
  assert.deepEqual(positions(routine, urgent), [urgent.twId, routine.twId]);
  assert.equal(plan(urgent).order_shortage, 1);
  assert.equal(plan(routine).order_shortage, 0);
  assert.equal(plan(routine).order_priority, null);
  assert.equal(writes(), before);
});
test("kolejność braków uwzględnia priorytet, a potem termin zamówienia", () => {
  const ordinary = fixture(),
    later = fixture(),
    earlier = fixture();
  order(ordinary, 10, 0, "2026-09-12T08:00:00Z");
  order(later, 2, 2, "2026-09-15T08:00:00Z");
  order(earlier, 2, 2, "2026-09-14T08:00:00Z");
  assert.deepEqual(positions(ordinary, later, earlier), [
    earlier.twId,
    later.twId,
    ordinary.twId,
  ]);
  assert.equal(plan(earlier).order_priority, 2);
  assert.equal(plan(earlier).order_due_at, "2026-09-14T08:00:00.000Z");
});
test("zapas pokrywający pilne zamówienie nie podnosi pilności pozostałego braku", () => {
  const f = fixture();
  order(f, 1, 2, "2026-09-12T08:00:00Z");
  order(f, 2, 0, "2026-10-12T08:00:00Z");
  assert.equal(plan(f).order_shortage, 2);
  assert.equal(plan(f).order_priority, 0);
  assert.equal(plan(f).order_due_at, "2026-10-12T08:00:00.000Z");
});
test("zadanie w drodze pokrywa zamówienia, a anulowanie przywraca ich brak", () => {
  const f = fixture();
  W.changeStock(office, randomUUID(), {
    action: "limits",
    twId: f.twId,
    bin: `B-${f.twId}`,
    minimum: 3,
    capacity: 10,
    version: 1,
    reason: "Druga półka",
  });
  order(f, 5, 2);
  const task = S.claimReplenishment(worker, randomUUID(), f.claim);
  assert.equal(plan(f).order_shortage, 0);
  assert.equal(plan(f).order_priority, null);
  S.cancelReplenishment(worker, randomUUID(), task.id, {
    source: f.source,
    reason: "Towar pozostaje na źródle",
  });
  assert.equal(plan(f).order_shortage, 4);
  assert.equal(plan(f).order_priority, 2);
});

test("wstrzymane, anulowane i już zarezerwowane zamówienia nie zawyżają pilności", () => {
  const f = fixture();
  for (const action of ["hold", "cancel"] as const) {
    const o = order(f, 10, 2);
    W.actOnOrder(office, randomUUID(), o.id, {
      action,
      version: o.version,
      reason: "Decyzja klienta",
    });
  }
  const allocated = order(f, 1, 2);
  W.actOnOrder(office, randomUUID(), allocated.id, {
    action: "allocate",
    version: allocated.version,
  });
  order(f, 2, 0);
  assert.equal(plan(f).order_shortage, 2);
  assert.equal(plan(f).order_priority, 0);
});
