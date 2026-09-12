import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-capacity-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(
  os.tmpdir(),
  "wms-capacity-no-env.local",
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
const movements = (twId: number) =>
  db().prepare("SELECT count(*) n FROM wms_movement WHERE tw_id=?").get(twId)!
    .n;
const check = (twId: number) =>
  db()
    .prepare(
      "SELECT * FROM wms_stock_check WHERE tw_id=? AND resolved_at IS NULL",
    )
    .get(twId);

function limits(
  f: ReturnType<typeof fixture>,
  capacity: number | null,
  minimum = 0,
) {
  return W.changeStock(office, randomUUID(), {
    action: "limits",
    twId: f.twId,
    bin: f.target,
    capacity,
    minimum,
    version: stock(f.twId, f.target).version,
    reason: "Wymiary sprawdzone na półce",
  });
}
function claim(f: ReturnType<typeof fixture>, quantity = 4) {
  return S.claimReplenishment(worker, randomUUID(), {
    ...f.claim,
    quantity,
    sourceVersion: stock(f.twId, f.source).version,
    targetVersion: stock(f.twId, f.target).version,
  });
}
function full(f: ReturnType<typeof fixture>, quantity = 2, pickedQuantity = 4) {
  return {
    ...f.input,
    quantity,
    pickedQuantity,
    targetFull: true,
    returnedSource: f.source,
    reason: "Nie mieści się na celu",
  };
}
const issue = (twId: number) =>
  db()
    .prepare(
      "SELECT * FROM wms_capacity_issue WHERE tw_id=? AND resolved_at IS NULL",
    )
    .get(twId);

function secondTarget(
  f: ReturnType<typeof fixture>,
  capacity = 10,
  minimum = 0,
) {
  const bin = `B-${f.twId}`;
  W.changeStock(office, randomUUID(), {
    action: "limits",
    twId: f.twId,
    bin,
    capacity,
    minimum,
    version: 1,
    reason: "Druga półka tej części",
  });
  return bin;
}
function demand(f: ReturnType<typeof fixture>, quantity: number) {
  return W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: f.sku, quantity }],
  });
}
function planQuantities(f: ReturnType<typeof fixture>) {
  return Object.fromEntries(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).plans.map(
      (p) => [String(p.target), Number(p.quantity)],
    ),
  );
}

test("pełna pierwsza półka oddaje popyt następnej, także po zgłoszeniu braku miejsca", () => {
  for (const reported of [false, true]) {
    const f = fixture();
    limits(f, reported ? null : 1);
    const target = secondTarget(f);
    if (reported)
      S.completeReplenishment(worker, randomUUID(), claim(f).id, full(f, 0));
    demand(f, 4);
    const before = writes();
    assert.deepEqual(planQuantities(f), { [target]: 3 });
    assert.equal(writes(), before);
  }
});

test("popyt dzieli się między pojemne cele a podjęte i ukończone zadania nie są planowane ponownie", () => {
  const f = fixture();
  limits(f, 3);
  const target = secondTarget(f);
  demand(f, 7);
  assert.deepEqual(planQuantities(f), { [f.target]: 2, [target]: 4 });
  const first = claim(f, 2);
  assert.deepEqual(planQuantities(f), { [target]: 4 });
  const second = S.claimReplenishment(worker, randomUUID(), {
    ...f.claim,
    target,
    quantity: 4,
    sourceVersion: stock(f.twId, f.source).version,
    targetVersion: stock(f.twId, target).version,
  });
  assert.deepEqual(planQuantities(f), {});
  S.completeReplenishment(worker, randomUUID(), first.id, {
    ...f.input,
    quantity: 2,
  });
  assert.deepEqual(planQuantities(f), {});
  S.completeReplenishment(worker, randomUUID(), second.id, {
    ...f.input,
    target,
  });
  assert.deepEqual(planQuantities(f), {});
  demand(f, 2);
  assert.deepEqual(planQuantities(f), { [target]: 2 });
});

test("minimum innych półek pokrywa popyt zamiast dodawać go po raz drugi", () => {
  const f = fixture();
  limits(f, 4, 3);
  const target = secondTarget(f, 5, 3);
  demand(f, 4);
  assert.deepEqual(planQuantities(f), { [f.target]: 2, [target]: 3 });
});

test("pojemność jest jawna, wersjonowana i wymaga biura; zero różni się od nieustalonej", () => {
  const f = fixture();
  assert.equal(stock(f.twId, f.target).capacity, null);
  const body = {
    action: "limits",
    twId: f.twId,
    bin: f.target,
    capacity: 5,
    minimum: 3,
    version: 3,
    reason: "Pomiar półki",
  };
  assert.throws(
    () => W.changeStock(worker, randomUUID(), body),
    (e: unknown) => e instanceof W.WmsError && e.statusCode === 403,
  );
  for (const patch of [
    { capacity: -1 },
    { capacity: 1.5 },
    { capacity: 1000001 },
    { capacity: 2 },
    { version: 2 },
  ])
    assert.throws(() =>
      W.changeStock(office, randomUUID(), { ...body, ...patch }),
    );
  const key = randomUUID(),
    result = W.changeStock(office, key, body),
    before = writes();
  assert.deepEqual(W.changeStock(office, key, body), { ...result });
  assert.equal(writes(), before);
  assert.throws(
    () =>
      W.changeStock(office, randomUUID(), {
        action: "minimum",
        twId: f.twId,
        bin: f.target,
        quantity: 6,
        version: 4,
        reason: "Za duże minimum",
      }),
    /pojemność/,
  );
  limits(f, 0);
  assert.throws(
    () =>
      W.changeStock(worker, randomUUID(), {
        action: "receive",
        twId: f.twId,
        bin: f.target,
        quantity: 1,
        reason: "Przyjęcie",
      }),
    /zmieści/,
  );
  limits(f, null);
  W.changeStock(worker, randomUUID(), {
    action: "receive",
    twId: f.twId,
    bin: f.target,
    quantity: 100,
    reason: "Przyjęcie",
  });
  assert.equal(stock(f.twId, f.target).on_hand, 101);
});

test("rezerwacja nadal zajmuje miejsce; plan ogranicza min i popyt do fizycznej pojemności", () => {
  const f = fixture();
  limits(f, 4, 4);
  let order = W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  order = W.actOnOrder(office, randomUUID(), order.id, {
    action: "allocate",
    version: order.version,
  });
  assert.equal(stock(f.twId, f.target).reserved, 1);
  const before = writes(),
    plan = S.replenishmentWork(worker, { view: "plans", q: f.barcode })
      .plans[0];
  assert.equal(plan.quantity, 3);
  assert.equal(writes(), before);
  assert.throws(() => claim(f, 4), /zmieści się jeszcze 3/);
  claim(f, 3);
  assert.equal(
    W.inventory({ q: f.sku }).rows.find((s) => s.bin === f.target)!.incoming,
    3,
  );
});

test("przydzielone uzupełnienie chroni miejsce przed przyjęciem i innym przesunięciem", () => {
  const f = fixture();
  limits(f, 5, 5);
  const task = claim(f),
    from = stock(f.twId, f.source),
    to = stock(f.twId, f.target);
  assert.throws(
    () =>
      W.changeStock(worker, randomUUID(), {
        action: "receive",
        twId: f.twId,
        bin: f.target,
        quantity: 1,
        reason: "Równoległa dostawa",
      }),
    /zmieści/,
  );
  assert.throws(
    () =>
      W.changeStock(worker, randomUUID(), {
        action: "transfer",
        twId: f.twId,
        bin: f.source,
        target: f.target,
        quantity: 1,
        reason: "Inne odłożenie",
      }),
    /zmieści/,
  );
  assert.throws(() => limits(f, 4), /rozlicz przydzielone/);
  assert.deepEqual(stock(f.twId, f.source), from);
  assert.deepEqual(stock(f.twId, f.target), to);
  S.completeReplenishment(worker, randomUUID(), task.id, f.input);
  assert.equal(stock(f.twId, f.target).on_hand, 5);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    0,
  );
});

test("spis prawdziwego stanu ponad limitem nie jest blokowany ani przycinany", () => {
  const f = fixture();
  limits(f, 2);
  W.changeStock(office, randomUUID(), {
    action: "count",
    twId: f.twId,
    bin: f.target,
    quantity: 5,
    version: stock(f.twId, f.target).version,
    reason: "Faktycznie znaleziono pięć",
  });
  assert.equal(stock(f.twId, f.target).on_hand, 5);
  assert.equal(stock(f.twId, f.target).capacity, 2);
  assert.throws(
    () =>
      W.changeStock(worker, randomUUID(), {
        action: "receive",
        twId: f.twId,
        bin: f.target,
        quantity: 1,
        reason: "Nowa dostawa",
      }),
    /zmieści/,
  );
});

test("spis źródła i celu czeka na potwierdzenie sztuk będących w drodze", () => {
  const f = fixture(),
    task = claim(f);
  for (const bin of [f.source, f.target]) {
    const before = stock(f.twId, bin);
    assert.throws(
      () =>
        W.changeStock(office, randomUUID(), {
          action: "count",
          twId: f.twId,
          bin,
          quantity: Number(before.on_hand) + 2,
          version: before.version,
          reason: "Spis podczas pracy",
        }),
      /uzupełnień/,
    );
    assert.deepEqual(stock(f.twId, bin), before);
  }
  S.completeReplenishment(worker, randomUUID(), task.id, full(f));
  W.changeStock(office, randomUUID(), {
    action: "count",
    twId: f.twId,
    bin: f.target,
    quantity: 3,
    version: stock(f.twId, f.target).version,
    reason: "Spis po zwrocie",
  });
  assert.equal(stock(f.twId, f.target).on_hand, 3);
});

test("pełny cel i zwrot nadmiaru nie zgłaszają braku na źródle i nie blokują zbiórki", () => {
  const f = fixture(),
    task = claim(f),
    key = randomUUID(),
    input = full(f);
  const result = S.completeReplenishment(worker, key, task.id, input);
  assert.equal(result.shortage, 0);
  assert.equal(result.returned, 2);
  assert.equal(result.targetFull, true);
  assert.equal(stock(f.twId, f.source).on_hand, 8);
  assert.equal(stock(f.twId, f.target).on_hand, 3);
  assert.equal(check(f.twId), undefined);
  assert.ok(issue(f.twId));
  assert.equal(S.replenishmentTask(worker, task.id).returned_quantity, 2);
  const before = writes();
  assert.deepEqual(
    S.completeReplenishment(worker, key, task.id, input),
    result,
  );
  assert.equal(writes(), before);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    0,
  );
  assert.throws(
    () =>
      W.changeStock(worker, randomUUID(), {
        action: "receive",
        twId: f.twId,
        bin: f.target,
        quantity: 1,
        reason: "Nowa dostawa",
      }),
    /brak miejsca/,
  );
  let order = W.createOrder(office, randomUUID(), {
    reference: randomUUID(),
    dueAt: "2026-12-31T12:00:00Z",
    lines: [{ sku: f.sku, quantity: 1 }],
  });
  order = W.actOnOrder(office, randomUUID(), order.id, {
    action: "allocate",
    version: order.version,
  });
  order = W.actOnOrder(worker, randomUUID(), order.id, {
    action: "pick-start",
    version: order.version,
    tote: `BOX-${f.twId}`,
  });
  W.actOnOrder(worker, randomUUID(), order.id, {
    action: "pick",
    version: order.version,
    allocationId: order.allocations[0].id,
    bin: f.target,
    barcode: f.barcode,
    quantity: 1,
    tote: order.tote,
  });
  assert.equal(stock(f.twId, f.target).on_hand, 2);
});

test("brak na źródle i pełny cel rozliczają osobno brak i zwrot", () => {
  const f = fixture(),
    task = claim(f);
  const result = S.completeReplenishment(
    worker,
    randomUUID(),
    task.id,
    full(f, 1, 2),
  );
  assert.equal(result.shortage, 2);
  assert.equal(result.returned, 1);
  assert.equal(stock(f.twId, f.source).on_hand, 9);
  assert.ok(check(f.twId));
  assert.ok(issue(f.twId));
});

test("zero odłożonych na pełnym celu nie tworzy ruchu, a brak skanu zwrotu odrzuca zapis", () => {
  const f = fixture(),
    task = claim(f),
    before = movements(f.twId);
  for (const patch of [
    { returnedSource: "BAD" },
    { returnedSource: undefined },
    { pickedQuantity: undefined },
    { pickedQuantity: 5 },
    { quantity: 4 },
    { pickedQuantity: 0 },
    { reason: undefined },
    { target: "BAD" },
    { barcode: "BAD" },
    { targetFull: false },
  ])
    assert.throws(() =>
      S.completeReplenishment(worker, randomUUID(), task.id, {
        ...full(f, 0),
        ...patch,
      }),
    );
  assert.equal(issue(f.twId), undefined);
  assert.equal(check(f.twId), undefined);
  const result = S.completeReplenishment(
    worker,
    randomUUID(),
    task.id,
    full(f, 0),
  );
  assert.equal(result.returned, 4);
  assert.equal(result.shortage, 0);
  assert.equal(movements(f.twId), before);
});

test("biuro zwalnia miejsce z uzasadnieniem, limit i historia pozostają", () => {
  const f = fixture(),
    task = claim(f);
  S.completeReplenishment(worker, randomUUID(), task.id, full(f));
  const c = issue(f.twId)!,
    input = { bin: f.target, reason: "Przeniesiono pojemnik na większą półkę" },
    key = randomUUID();
  const before = writes();
  assert.equal(
    S.stockWork(worker, {}).capacityIssues.some((i) => i.id === c.id),
    true,
  );
  assert.equal(writes(), before);
  assert.throws(
    () => S.resolveCapacityIssue(worker, key, Number(c.id), input),
    (e: unknown) => e instanceof W.WmsError && e.statusCode === 403,
  );
  assert.throws(
    () =>
      S.resolveCapacityIssue(office, key, Number(c.id), {
        ...input,
        bin: "BAD",
      }),
    /Zeskanuj/,
  );
  S.resolveCapacityIssue(office, key, Number(c.id), input);
  const again = writes();
  S.resolveCapacityIssue(office, key, Number(c.id), input);
  assert.equal(writes(), again);
  assert.equal(issue(f.twId), undefined);
  assert.equal(
    S.replenishmentWork(worker, { view: "plans", q: f.barcode }).total,
    1,
  );
  assert.equal(
    db()
      .prepare("SELECT resolution FROM wms_capacity_issue WHERE id=?")
      .get(c.id)!.resolution,
    input.reason,
  );
});

test("awaria zgłoszenia pełnego celu cofa oba ruchy, zwrot i zamknięcie przydziału", () => {
  const f = fixture(),
    task = claim(f),
    key = randomUUID(),
    from = stock(f.twId, f.source),
    to = stock(f.twId, f.target),
    before = movements(f.twId);
  db().exec(
    "CREATE TEMP TRIGGER fail_capacity BEFORE INSERT ON wms_capacity_issue BEGIN SELECT RAISE(ABORT,'capacity rollback'); END",
  );
  try {
    assert.throws(
      () => S.completeReplenishment(worker, key, task.id, full(f)),
      /capacity rollback/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_capacity");
  }
  assert.deepEqual(stock(f.twId, f.source), from);
  assert.deepEqual(stock(f.twId, f.target), to);
  assert.equal(movements(f.twId), before);
  assert.equal(S.replenishmentTask(worker, task.id).completed_at, null);
  assert.equal(S.replenishmentTask(worker, task.id).returned_quantity, 0);
  S.completeReplenishment(worker, key, task.id, full(f));
  assert.ok(issue(f.twId));
});

test("odmowa pojemności przy odkładaniu dostawy zachowuje bufor i pozwala wybrać inny cel", async () => {
  const I = await import("./wms-inbound.js"),
    P = await import("./wms-putaway.js"),
    f = fixture();
  limits(f, 2);
  const doc = I.createInbound(office, randomUUID(), {
    reference: randomUUID(),
    supplier: "Seeded",
    lines: [{ sku: f.sku, quantity: 4 }],
  });
  let line = I.getInbound(doc.id).lines[0];
  const input = {
    lineId: line.id,
    version: line.version,
    barcode: f.barcode,
    bin: f.target,
    quantity: 4,
    disposition: "good",
  };
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, input),
    /zmieści/,
  );
  assert.equal(I.getInbound(doc.id).lines[0].received, 0);
  const accepted = I.putawayInbound(worker, randomUUID(), doc.id, {
    ...input,
    bin: f.source,
    staged: true,
  });
  let work = P.getPutaway(accepted.workId!);
  P.claimPutaway(worker, randomUUID(), work.id, { version: work.version });
  work = P.getPutaway(work.id);
  const finish = {
      version: work.version,
      source: f.source,
      target: f.target,
      barcode: f.barcode,
      quantity: 4,
    },
    before = stock(f.twId, f.source);
  assert.throws(
    () => P.finishPutaway(worker, randomUUID(), work.id, finish),
    /zmieści/,
  );
  assert.deepEqual(stock(f.twId, f.source), before);
  assert.equal(P.getPutaway(work.id).remaining, 4);
  W.configureBin(office, randomUUID(), {
    bin: `ALT-${f.twId}`,
    mode: "pick",
    version: 1,
    reason: "Wolna półka",
  });
  P.finishPutaway(worker, randomUUID(), work.id, {
    ...finish,
    target: `ALT-${f.twId}`,
  });
  assert.equal(P.getPutaway(work.id).remaining, 0);
});
