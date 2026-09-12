import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-counting-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(os.tmpdir(), "wms-count-no-env.local");
let C: typeof import("./wms-counting.js"),
  W: typeof import("./wms.js"),
  S: typeof import("./wms-stock-work.js"),
  db: typeof import("../db/db.js").db;
const office = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Liczący", role: "magazynier" as const };
let serial = 0;
before(async () => {
  C = await import("./wms-counting.js");
  W = await import("./wms.js");
  S = await import("./wms-stock-work.js");
  ({ db } = await import("../db/db.js"));
});
function fixture() {
  const twId = ++serial,
    sku = `COUNT-${twId}`,
    bin = `A-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Część do liczenia", `0590${twId}`);
  W.changeStock(office, randomUUID(), {
    action: "receive",
    twId,
    bin,
    quantity: 10,
    reason: "Dostawa seeded",
  });
  const checkId = Number(
    db()
      .prepare(
        "INSERT INTO wms_stock_check(tw_id,bin,reason,user_id,created_at) VALUES (?,?,?,2,?)",
      )
      .run(twId, bin, "Brak na półce", new Date().toISOString())
      .lastInsertRowid,
  );
  const task = C.countTask(worker, checkId);
  const input = {
    bin,
    barcode: sku,
    quantity: 7,
    version: Number(task.version),
  };
  return { twId, sku, bin, checkId, input };
}
const balance = (twId: number) =>
  db().prepare("SELECT * FROM wms_stock WHERE tw_id=?").get(twId);
const writes = () => db().prepare("SELECT total_changes() AS n").get()!.n;

test("kolektor liczy bez stanu oczekiwanego; odczyty niczego nie zapisują", () => {
  const f = fixture(),
    before = writes();
  assert.throws(
    () =>
      S.applyStockCheckCount(office, f.checkId, {
        ...f.input,
        reason: "Poza transakcją",
      }),
    /transakcji/,
  );
  const queue = C.countQueue(worker, { q: f.sku });
  assert.equal(queue.rows.length, 1);
  for (const row of [queue.rows[0], C.countTask(worker, f.checkId)]) {
    for (const key of [
      "on_hand",
      "reserved",
      "counted",
      "quantity",
      "observed_quantity",
    ])
      assert.equal(key in row, false, key);
  }
  assert.equal(writes(), before);
  assert.throws(() => C.countQueue(worker, { offset: -1 }));
});
test("wynik z hali czeka na biuro; retry przed i po zatwierdzeniu nie dubluje zapisu", () => {
  const f = fixture(),
    before = balance(f.twId),
    key = randomUUID();
  const observation = C.observeCount(worker, key, f.checkId, f.input);
  assert.deepEqual(balance(f.twId), before);
  assert.equal(C.countTask(worker, f.checkId).pending, 1);
  let saved = writes();
  assert.deepEqual(
    C.observeCount(worker, key, f.checkId, f.input),
    observation,
  );
  assert.equal(writes(), saved);
  const reviewKey = randomUUID(),
    review = {
      observationId: observation.observationId,
      decision: "accept",
      reason: "Zweryfikowano wynik",
    };
  const result = C.reviewCount(office, reviewKey, f.checkId, review);
  assert.equal(result.checkId, f.checkId);
  assert.equal(balance(f.twId)!.on_hand, 7);
  assert.ok(C.countTask(worker, f.checkId).resolved_at);
  saved = writes();
  assert.deepEqual(C.reviewCount(office, reviewKey, f.checkId, review), result);
  assert.deepEqual(
    C.observeCount(worker, key, f.checkId, f.input),
    observation,
  );
  assert.equal(writes(), saved);
});
test("drugi operator nie przykrywa wyniku; biuro nie omija oczekującej obserwacji", () => {
  const f = fixture();
  C.observeCount(worker, randomUUID(), f.checkId, f.input);
  assert.throws(
    () =>
      C.observeCount({ ...worker, id: 3 }, randomUUID(), f.checkId, {
        ...f.input,
        quantity: 6,
      }),
    /już zapisane/,
  );
  assert.throws(
    () =>
      S.countStockCheck(office, randomUUID(), f.checkId, {
        ...f.input,
        reason: "Bezpośredni spis",
      }),
    /kolektora/,
  );
  assert.equal(
    db()
      .prepare("SELECT count(*) n FROM wms_stock_observation WHERE check_id=?")
      .get(f.checkId)!.n,
    1,
  );
});
test("błędny skan pusty formularz i stare dane nie stają się wynikiem", () => {
  const f = fixture();
  for (const patch of [
    { bin: "OTHER" },
    { barcode: "wrong" },
    { quantity: "" },
    { quantity: -1 },
    { quantity: 1.5 },
    { quantity: 1000001 },
    { version: f.input.version + 1 },
  ]) {
    assert.throws(() =>
      C.observeCount(worker, randomUUID(), f.checkId, { ...f.input, ...patch }),
    );
  }
  assert.equal(C.countTask(worker, f.checkId).pending, 0);
  C.observeCount(worker, randomUUID(), f.checkId, { ...f.input, quantity: 0 });
  assert.equal(balance(f.twId)!.on_hand, 10);
});
test("ruch między policzeniem a akceptacją wymaga ponownego liczenia z historią", () => {
  const f = fixture(),
    observation = C.observeCount(worker, randomUUID(), f.checkId, f.input);
  // Znany ruch rezerwacji także zmienia wersję: zatwierdzenie nie może opierać się na starszym odczycie.
  db()
    .prepare("UPDATE wms_stock SET version=version+1 WHERE tw_id=?")
    .run(f.twId);
  assert.throws(
    () =>
      C.reviewCount(office, randomUUID(), f.checkId, {
        observationId: observation.observationId,
        decision: "accept",
        reason: "Potwierdzenie",
      }),
    /Stan zmienił/,
  );
  assert.equal(C.countTask(worker, f.checkId).pending, 1);
  C.reviewCount(office, randomUUID(), f.checkId, {
    observationId: observation.observationId,
    decision: "recount",
    reason: "Policz ponownie po ruchu",
  });
  assert.equal(C.countTask(worker, f.checkId).pending, 0);
  assert.equal(
    C.countTask(worker, f.checkId).recount_reason,
    "Policz ponownie po ruchu",
  );
  const second = C.observeCount(worker, randomUUID(), f.checkId, {
    ...f.input,
    quantity: 8,
    version: Number(C.countTask(worker, f.checkId).version),
  });
  assert.notEqual(second.observationId, observation.observationId);
  assert.equal(
    db()
      .prepare("SELECT quantity FROM wms_stock_observation WHERE id=?")
      .get(observation.observationId)!.quantity,
    7,
  );
  assert.throws(() =>
    C.reviewCount(office, randomUUID(), f.checkId, {
      observationId: observation.observationId,
      decision: "accept",
      reason: "Stary ekran",
    }),
  );
});
test("magazynier nie zatwierdza ani nie zmienia ilości przesłanej biuru", () => {
  const f = fixture(),
    observation = C.observeCount(worker, randomUUID(), f.checkId, f.input);
  const review = {
    observationId: observation.observationId,
    decision: "accept",
    reason: "Potwierdzenie",
  };
  assert.throws(
    () => C.reviewCount(worker, randomUUID(), f.checkId, review),
    (e: unknown) => e instanceof W.WmsError && e.statusCode === 403,
  );
  assert.throws(() =>
    C.reviewCount(office, randomUUID(), f.checkId, {
      ...review,
      quantity: 100,
    }),
  );
  assert.equal(balance(f.twId)!.on_hand, 10);
});
test("awaria zapisu decyzji cofa korektę zapasu i pozwala ponowić tę samą akceptację", () => {
  const f = fixture(),
    observation = C.observeCount(worker, randomUUID(), f.checkId, f.input),
    before = balance(f.twId),
    key = randomUUID();
  db().exec(
    "CREATE TEMP TRIGGER fail_count_review BEFORE UPDATE ON wms_stock_observation BEGIN SELECT RAISE(ABORT,'test decision failure'); END",
  );
  const review = {
    observationId: observation.observationId,
    decision: "accept",
    reason: "Potwierdzenie",
  };
  try {
    assert.throws(
      () => C.reviewCount(office, key, f.checkId, review),
      /test decision failure/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_count_review");
  }
  assert.deepEqual(balance(f.twId), before);
  assert.equal(C.countTask(worker, f.checkId).pending, 1);
  assert.equal(C.countTask(worker, f.checkId).resolved_at, null);
  C.reviewCount(office, key, f.checkId, review);
  assert.equal(balance(f.twId)!.on_hand, 7);
});
test("liczenie czeka na zakończenie fizycznego uzupełnienia", () => {
  const f = fixture();
  db()
    .prepare(
      "INSERT INTO wms_replenishment(tw_id,source,target,quantity,source_version,target_version,user_id,created_at) VALUES (?,'RESERVE',?,1,1,1,2,?)",
    )
    .run(f.twId, f.bin, new Date().toISOString());
  assert.throws(
    () => C.observeCount(worker, randomUUID(), f.checkId, f.input),
    /rozlicz uzupełnienie/,
  );
  assert.equal(C.countTask(worker, f.checkId).pending, 0);
});
