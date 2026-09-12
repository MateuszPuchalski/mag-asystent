import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-replenish-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(
  os.tmpdir(),
  "wms-replenish-no-env.local",
);
let S: typeof import("./wms-stock-work.js"),
  W: typeof import("./wms.js"),
  C: typeof import("./wms-counting.js"),
  db: typeof import("../db/db.js").db;
const office = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Uzupełniający", role: "magazynier" as const },
  other = { ...worker, id: 3 };
let serial = 0;
before(async () => {
  W = await import("./wms.js");
  S = await import("./wms-stock-work.js");
  C = await import("./wms-counting.js");
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
const movements = (twId: number) =>
  db().prepare("SELECT count(*) n FROM wms_movement WHERE tw_id=?").get(twId)!
    .n;
const check = (twId: number) =>
  db()
    .prepare(
      "SELECT * FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
    )
    .get(twId);

test("plan i własna kolejka są stronicowane, wyszukiwalne i tylko do odczytu", () => {
  const f = fixture(),
    before = writes();
  for (const q of [f.barcode, f.source.toLowerCase(), f.target, f.sku]) {
    const queue = S.replenishmentWork(worker, { view: "plans", q });
    assert.equal(queue.total, 1);
    assert.equal(queue.plans[0].barcode, f.barcode);
    assert.equal(queue.plans[0].quantity, 4);
  }
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode, offset: 50 })
      .plans.length,
    0,
  );
  assert.equal(writes(), before);
  const task = S.claimReplenishment(worker, randomUUID(), f.claim),
    snapshot = writes();
  assert.equal(
    S.replenishmentWork(worker, { q: f.barcode }).tasks[0].id,
    task.id,
  );
  assert.equal(S.replenishmentWork(other, { q: f.barcode }).total, 0);
  assert.equal(S.replenishmentWork(office, { q: f.barcode }).total, 0);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    0,
  );
  assert.equal(S.replenishmentTask(worker, task.id).blocked, null);
  assert.equal(S.replenishmentTask(office, task.id).id, task.id);
  assert.throws(
    () => S.replenishmentTask(other, task.id),
    (e: unknown) => e instanceof W.WmsError && e.statusCode === 403,
  );
  assert.equal(writes(), snapshot);
  for (const input of [
    { offset: -1 },
    { offset: 1.5 },
    { view: "all" },
    { q: "x".repeat(121) },
  ])
    assert.throws(() => S.replenishmentWork(worker, input));
});

test("51 propozycji i zadań nie gubi ostatniej strony", () => {
  const fixtures = Array.from({ length: 51 }, fixture);
  const total = S.replenishmentWork(worker, { view: "plans" }).total;
  assert.equal(S.replenishmentWork(worker, { view: "plans" }).plans.length, 50);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", offset: 50 }).plans.length,
    total - 50,
  );
  for (const f of fixtures) S.claimReplenishment(other, randomUUID(), f.claim);
  const before = writes();
  assert.equal(S.replenishmentWork(other, {}).tasks.length, 50);
  assert.equal(S.replenishmentWork(other, { offset: 50 }).tasks.length, 1);
  assert.equal(S.replenishmentWork(other, { offset: 50 }).total, 51);
  assert.equal(writes(), before);
});

test("utracone podjęcie odzyskuje ten sam numer, a konkurent nie bierze tej samej półki", () => {
  const f = fixture(),
    key = randomUUID(),
    task = S.claimReplenishment(worker, key, f.claim),
    before = writes();
  assert.deepEqual(S.claimReplenishment(worker, key, f.claim), task);
  assert.equal(writes(), before);
  assert.throws(
    () => S.claimReplenishment(other, randomUUID(), f.claim),
    /otwarte uzupełnienie/,
  );
});

test("częściowe uzupełnienie przesuwa znalezione sztuki i kieruje źródło do liczenia bez odpisu", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim),
    key = randomUUID();
  const input = {
    ...f.input,
    quantity: 2,
    reason: "Znalazłem tylko dwie sztuki",
  };
  const result = S.completeReplenishment(worker, key, task.id, input);
  assert.equal(result.shortage, 2);
  assert.equal(result.quantity, 2);
  assert.equal(stock(f.twId, f.source).on_hand, 8);
  assert.equal(stock(f.twId, f.target).on_hand, 3);
  assert.equal(S.replenishmentTask(worker, task.id).moved, 2);
  assert.equal(S.replenishmentWork(worker, { q: f.barcode }).total, 0);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    0,
  );
  assert.match(String(check(f.twId)!.reason), /Znalazłem tylko dwie/);
  const before = writes();
  assert.deepEqual(
    S.completeReplenishment(worker, key, task.id, input),
    result,
  );
  assert.equal(writes(), before);
  assert.throws(
    () => S.completeReplenishment(worker, randomUUID(), task.id, input),
    /zamknięte/,
  );
});

test("puste źródło zamyka przydział bez ruchu i nie zmienia zapasu na zero", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim),
    from = stock(f.twId, f.source),
    to = stock(f.twId, f.target),
    before = movements(f.twId);
  S.completeReplenishment(worker, randomUUID(), task.id, {
    ...f.input,
    quantity: 0,
    reason: "Pusta lokalizacja",
  });
  assert.deepEqual(stock(f.twId, f.source), from);
  assert.deepEqual(stock(f.twId, f.target), to);
  assert.equal(movements(f.twId), before);
  assert.equal(S.replenishmentTask(worker, task.id).moved, 0);
  assert.ok(check(f.twId));
});

test("błędne skany, ilości i obcy operator nie zwalniają przydziału", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim),
    before = stock(f.twId, f.source);
  for (const patch of [
    { quantity: 0 },
    { quantity: 2 },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: 5 },
    { quantity: "" },
    { quantity: 2, reason: " " },
    { source: "BAD" },
    { target: "BAD" },
    { barcode: "590" },
  ])
    assert.throws(() =>
      S.completeReplenishment(worker, randomUUID(), task.id, {
        ...f.input,
        ...patch,
      }),
    );
  assert.throws(
    () => S.completeReplenishment(other, randomUUID(), task.id, f.input),
    (e: unknown) => e instanceof W.WmsError && e.statusCode === 403,
  );
  assert.deepEqual(stock(f.twId, f.source), before);
  assert.equal(S.replenishmentTask(worker, task.id).completed_at, null);
  assert.equal(check(f.twId), undefined);
});

test("awaria zgłoszenia braku wycofuje transfer i zamknięcie; ten sam klucz nadal działa", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim),
    key = randomUUID(),
    input = { ...f.input, quantity: 2, reason: "Brak sztuk" };
  const from = stock(f.twId, f.source),
    to = stock(f.twId, f.target),
    before = movements(f.twId);
  db().exec(
    "CREATE TEMP TRIGGER fail_replenish_check BEFORE INSERT ON wms_stock_check BEGIN SELECT RAISE(ABORT,'shortage rollback'); END",
  );
  try {
    assert.throws(
      () => S.completeReplenishment(worker, key, task.id, input),
      /shortage rollback/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_replenish_check");
  }
  assert.deepEqual(stock(f.twId, f.source), from);
  assert.deepEqual(stock(f.twId, f.target), to);
  assert.equal(movements(f.twId), before);
  assert.equal(S.replenishmentTask(worker, task.id).completed_at, null);
  S.completeReplenishment(worker, key, task.id, input);
  assert.equal(stock(f.twId, f.target).on_hand, 3);
});

test("wspólne źródło po braku czeka na zwrot drugiego zadania, potem na liczenie i biuro", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim),
    target2 = `B-${f.twId}`;
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId: f.twId,
    bin: target2,
    quantity: 1,
    reason: "Druga półka",
  });
  const sibling = S.claimReplenishment(other, randomUUID(), {
    ...f.claim,
    target: target2,
    targetVersion: stock(f.twId, target2).version,
  });
  S.completeReplenishment(worker, randomUUID(), task.id, {
    ...f.input,
    quantity: 2,
    reason: "Brak na zapleczu",
  });
  assert.match(
    String(S.replenishmentTask(other, sibling.id).blocked),
    /przeliczenie/,
  );
  const checkId = Number(check(f.twId)!.id),
    count = {
      bin: f.source,
      barcode: f.barcode,
      quantity: 4,
      version: Number(stock(f.twId, f.source).version),
    };
  assert.throws(
    () => C.observeCount(worker, randomUUID(), checkId, count),
    /rozlicz uzupełnienie/,
  );
  assert.throws(
    () =>
      S.completeReplenishment(other, randomUUID(), sibling.id, {
        ...f.input,
        target: target2,
      }),
    /przelicz/,
  );
  assert.throws(
    () =>
      S.cancelReplenishment(other, randomUUID(), sibling.id, {
        source: target2,
        reason: "Zwrot pobrania",
      }),
    /zeskanuj/,
  );
  const key = randomUUID(),
    cancel = { source: f.source, reason: "Odłożono wszystkie sztuki" };
  S.cancelReplenishment(other, key, sibling.id, cancel);
  const before = writes();
  S.cancelReplenishment(other, key, sibling.id, cancel);
  assert.equal(writes(), before);
  const observation = C.observeCount(worker, randomUUID(), checkId, count);
  assert.equal(stock(f.twId, f.source).on_hand, 8);
  C.reviewCount(office, randomUUID(), checkId, {
    observationId: observation.observationId,
    decision: "accept",
    reason: "Potwierdzony spis",
  });
  assert.equal(stock(f.twId, f.source).on_hand, 4);
  assert.equal(check(f.twId), undefined);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    1,
  );
});

test("stare pełne zadanie zachowuje ilość, anulowanie nie udaje przesunięcia", () => {
  const f = fixture(),
    task = S.claimReplenishment(worker, randomUUID(), f.claim);
  S.completeReplenishment(worker, randomUUID(), task.id, f.input);
  db()
    .prepare("UPDATE wms_replenishment SET completed_quantity=NULL WHERE id=?")
    .run(task.id);
  assert.equal(S.replenishmentTask(worker, task.id).moved, 4);
  const next = fixture(),
    cancelled = S.claimReplenishment(worker, randomUUID(), next.claim);
  S.cancelReplenishment(worker, randomUUID(), cancelled.id, {
    source: next.source,
    reason: "Zwrot na źródło",
  });
  assert.equal(S.replenishmentTask(worker, cancelled.id).moved, null);
});
