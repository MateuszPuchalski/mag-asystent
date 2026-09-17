import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(
  mkdtempSync(join(tmpdir(), "wertis-return-location-")),
  "seeded.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = join(tmpdir(), "return-location-no-env.local");
let W: typeof import("./wms.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const };
const picker = { id: 2, name: "Kolektor", role: "magazynier" as const };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
});
function fixture() {
  const twId = ++serial,
    sku = `PART-${twId}`,
    source = `A-OLD-${twId}`,
    target = `B-NEW-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Część seeded", `0590${twId}`);
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId,
    bin: source,
    quantity: 10,
    reason: "Dostawa seeded",
  });
  let order = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    channel: "seeded",
    dueAt: "2026-09-13T12:00:00Z",
    lines: [{ sku, quantity: 3 }],
  });
  const act = (
    body: object,
    actor = admin as typeof admin | typeof picker,
    key = randomUUID(),
  ) => {
    order = W.actOnOrder(actor, key, order.id, {
      ...body,
      version: order.version,
    });
    return order;
  };
  act({ action: "allocate" });
  act({ action: "pick-start", tote: `BOX-${twId}` }, picker);
  act(
    {
      action: "pick",
      allocationId: order.allocations[0].id,
      bin: source,
      barcode: sku,
      quantity: 3,
    },
    picker,
  );
  act({ action: "hold", reason: "Zmiana klienta" });
  W.configureBin(admin, randomUUID(), {
    bin: target,
    mode: "pick",
    version: 1,
    reason: "Nowa półka",
  });
  const stock = (bin: string) =>
    db()
      .prepare(
        "SELECT on_hand,reserved,version FROM wms_stock WHERE tw_id=? AND bin=?",
      )
      .get(twId, bin);
  return {
    twId,
    sku,
    source,
    target,
    act,
    stock,
    get order() {
      return order;
    },
    body(quantity: number, destination = target) {
      return {
        action: "return",
        tote: order.tote!,
        allocationId: order.allocations.find((a) => a.bin === source)!.id,
        bin: source,
        target: destination,
        barcode: sku,
        quantity,
        reason: "Zwrot na inną półkę",
      };
    },
  };
}

test("kwarantanna po pobraniu nie przejmuje zwrotu, a inna półka przejmuje rezerwację partii", () => {
  const f = fixture();
  W.configureBin(admin, randomUUID(), {
    bin: f.source,
    mode: "quarantine",
    version: 1,
    reason: "Półka wyłączona",
  });
  const before = f.stock(f.source);
  const { target: _target, ...original } = f.body(1);
  assert.throws(() => f.act(original, picker), /półki kompletacji/);
  assert.deepEqual(f.stock(f.source), before);
  const first = f.act(f.body(1), picker);
  assert.equal(first.lines[0].picked, 2);
  assert.deepEqual(
    first.allocations.map((a) => [a.bin, a.quantity, a.picked]),
    [
      [f.source, 2, 2],
      [f.target, 1, 0],
    ],
  );
  f.act(f.body(2), picker);
  assert.deepEqual(
    f.order.allocations.map((a) => [a.bin, a.quantity, a.picked]),
    [[f.target, 3, 0]],
  );
  assert.equal(f.stock(f.source)!.on_hand, 7);
  assert.equal(f.stock(f.target)!.on_hand, 3);
  assert.equal(f.stock(f.target)!.reserved, 3);
  assert.equal(A.integrity().ok, true);
  f.act({ action: "cancel", reason: "Rezygnacja klienta" });
  assert.equal(f.stock(f.target)!.reserved, 0);
  assert.equal(A.integrity().ok, true);
});

test("alternatywny cel odrzuca nieznaną półkę, zaplecze, pełny cel i aktywne liczenie", () => {
  const f = fixture();
  const before = f.stock(f.source);
  assert.throws(() => f.act(f.body(1, "UNKNOWN"), picker), /półki kompletacji/);
  W.configureBin(admin, randomUUID(), {
    bin: f.target,
    mode: "reserve",
    version: 2,
    reason: "Zaplecze",
  });
  assert.throws(() => f.act(f.body(1), picker), /półki kompletacji/);
  W.configureBin(admin, randomUUID(), {
    bin: f.target,
    mode: "pick",
    version: 3,
    reason: "Kompletacja",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: f.twId,
    bin: f.target,
    quantity: 1,
    reason: "Zajęte miejsce",
  });
  W.changeStock(admin, randomUUID(), {
    action: "limits",
    twId: f.twId,
    bin: f.target,
    minimum: 0,
    capacity: 1,
    version: f.stock(f.target)!.version,
    reason: "Mała półka",
  });
  assert.throws(() => f.act(f.body(1), picker), /zmieści/);
  db()
    .prepare(
      "INSERT INTO wms_stock_check(tw_id,bin,reason,created_at,user_id) VALUES (?,?,?,datetime('now'),?)",
    )
    .run(f.twId, f.target, "Przeliczenie", 1);
  assert.throws(() => f.act(f.body(1), picker), /przeliczenie/);
  assert.deepEqual(f.stock(f.source), before);
  assert.equal(f.order.lines[0].picked, 3);
  assert.equal(A.integrity().ok, true);
});

test("awaria rozdzielenia przydziału cofa ruch, a ponowienie zwraca jedną partię", () => {
  const f = fixture(),
    key = randomUUID();
  const body = { ...f.body(1), version: f.order.version };
  db().exec(
    "CREATE TRIGGER fail_return_allocation BEFORE INSERT ON wms_allocation BEGIN SELECT RAISE(ABORT,'audit rollback'); END",
  );
  assert.throws(
    () => W.actOnOrder(picker, key, f.order.id, body),
    /audit rollback/,
  );
  assert.equal(f.stock(f.target), undefined);
  assert.equal(f.stock(f.source)!.on_hand, 7);
  assert.equal(W.getOrder(f.order.id).lines[0].picked, 3);
  db().exec("DROP TRIGGER fail_return_allocation");
  const saved = W.actOnOrder(picker, key, f.order.id, body);
  assert.deepEqual(
    W.actOnOrder(picker, key, f.order.id, body),
    JSON.parse(JSON.stringify(saved)),
  );
  assert.equal(f.stock(f.target)!.on_hand, 1);
  assert.equal(f.stock(f.target)!.reserved, 1);
  assert.equal(A.integrity().ok, true);
});

test("pełny zwrot zachowuje identyfikator przydziału, gdy docelowa rezerwacja jeszcze nie istnieje", () => {
  const f = fixture(),
    id = f.order.allocations[0].id;
  f.act(f.body(3), picker);
  assert.equal(f.order.allocations[0].id, id);
  assert.equal(f.order.allocations[0].bin, f.target);
  assert.equal(f.order.lines[0].picked, 0);
  f.act({ action: "resume", reason: "Potwierdzenie klienta" });
  f.act(
    {
      action: "pick",
      allocationId: id,
      bin: f.target,
      barcode: f.sku,
      quantity: 3,
    },
    picker,
  );
  assert.equal(f.order.status, "picked");
  assert.equal(A.integrity().ok, true);
});

test("dawna rezerwacja w kwarantannie jest wykrywana i nie pozwala ponownie pobrać towaru", () => {
  const f = fixture();
  W.configureBin(admin, randomUUID(), {
    bin: f.source,
    mode: "quarantine",
    version: 1,
    reason: "Półka kwarantanny",
  });
  // Odtwarzamy stan zapisany przez starą wersję, bez obchodzenia nowej komendy zwrotu.
  db().exec("BEGIN");
  W.move(admin, f.twId, f.source, 1, 1, "return", "Dawny zwrot", f.order.id);
  db()
    .prepare("UPDATE wms_allocation SET picked=picked-1 WHERE id=?")
    .run(f.order.allocations[0].id);
  db()
    .prepare("UPDATE wms_line SET picked=picked-1 WHERE order_id=?")
    .run(f.order.id);
  db()
    .prepare(
      "UPDATE wms_order SET status='picking',hold_reason=NULL WHERE id=?",
    )
    .run(f.order.id);
  db().exec("COMMIT");
  const wave = db()
    .prepare(
      "INSERT INTO wms_wave(name,picker_id,created_at) VALUES ('Dawna trasa',2,datetime('now'))",
    )
    .run();
  db()
    .prepare("INSERT INTO wms_wave_order(wave_id,order_id) VALUES (?,?)")
    .run(wave.lastInsertRowid, f.order.id);
  const route = W.getWave(picker, Number(wave.lastInsertRowid));
  assert.match(
    String(route.tasks[0].stock_blocked),
    /nie służy do kompletacji/,
  );
  assert.equal(route.tasks[0].stop_quantity, 0);
  const report = A.integrity();
  assert.equal(report.ok, false);
  assert.equal(report.reservations.length, 1);
  assert.equal(report.reservations[0].bin_mode, "quarantine");
  assert.throws(
    () =>
      W.actOnOrder(picker, randomUUID(), f.order.id, {
        action: "pick",
        version: f.order.version,
        tote: f.order.tote!,
        allocationId: f.order.allocations[0].id,
        bin: f.source,
        barcode: f.sku,
        quantity: 1,
      }),
    /nie służy do kompletacji/,
  );
});
