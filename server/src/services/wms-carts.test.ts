import { before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-carts-")),
  "test.db",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.WERTIS_ENV_FILE = path.join(os.tmpdir(), "wms-carts-no-env.local");
let C: typeof import("./wms-carts.js"),
  W: typeof import("./wms.js"),
  db: typeof import("../db/db.js").db;
let S: typeof import("./wms-stock-work.js");
const admin = { id: 1, name: "Biuro", role: "admin" as const };
const picker = { id: 2, name: "Zbiórka", role: "magazynier" as const };
const other = { id: 3, name: "Pakowanie", role: "magazynier" as const };
let serial = 0;
before(async () => {
  C = await import("./wms-carts.js");
  W = await import("./wms.js");
  ({ db } = await import("../db/db.js"));
  S = await import("./wms-stock-work.js");
  C.configureStation(admin, randomUUID(), {
    code: "PACK-01",
    name: "Pakowanie 1",
    kind: "pack",
    active: true,
    version: 0,
  });
  C.configureStation(admin, randomUUID(), {
    code: "EX-01",
    name: "Wyjaśnienia",
    kind: "exception",
    active: true,
    version: 0,
  });
});
beforeEach(() => {
  // Niezamknięte scenariusze nie mogą zmieniać kolejki kolejnego niezależnego testu.
  db().exec(
    "UPDATE wms_order SET hold_reason='Inny scenariusz testowy' WHERE status IN ('new','allocated')",
  );
});
function product(quantity = 1000, bin = "A-01") {
  const n = ++serial;
  const sku = `PART-${n}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(n, sku, "Część testowa", `590${n}`);
  if (quantity)
    W.changeStock(admin, randomUUID(), {
      action: "receive",
      twId: n,
      bin,
      quantity,
      reason: "Dostawa testowa",
    });
  return { twId: n, sku, bin };
}
function order(sku: string, quantity = 1, priority = 0) {
  return W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    channel: "seeded",
    priority,
    dueAt: "2026-09-12T12:00:00Z",
    lines: [{ sku, quantity }],
  });
}
function cart(
  capacity: 20 | 30 = 20,
  selection: "all" | "single" | "multi" = "all",
  maxUnits = 1000000,
) {
  const code = `CART-${++serial}`;
  return C.configureCart(admin, randomUUID(), {
    code,
    name: code,
    capacity,
    version: 0,
    selection,
    maxUnits,
    boxes: Array.from({ length: capacity }, (_, i) => ({
      position: i + 1,
      barcode: `${code}-BOX-${i + 1}`,
    })),
  });
}
function start(code: string) {
  return C.startCart(picker, randomUUID(), { barcode: code }).run!;
}
function pickAll(runId: number) {
  for (;;) {
    const wave = W.getWave(picker, runId);
    const task = wave.tasks.find((t) => !t.hold_reason);
    if (!task) return;
    W.pickWave(picker, randomUUID(), runId, {
      orderId: task.order_id,
      version: task.version,
      allocationId: task.allocation_id,
      bin: task.bin,
      barcode: task.sku,
      tote: task.tote,
      quantity: task.remaining,
    });
  }
}

for (const capacity of [20, 30] as const)
  test(`skan wózka ${capacity}: automatyczny przydział, stałe pozycje i odtworzenie po przerwaniu`, () => {
    const p = product();
    for (let i = 0; i < capacity; i++) order(p.sku);
    const c = cart(capacity),
      key = randomUUID();
    const result = C.startCart(picker, key, { barcode: c.code });
    assert.equal(result.run!.orders.length, capacity);
    assert.deepEqual(
      result.run!.assignments.map((a) => a.position),
      Array.from({ length: capacity }, (_, i) => i + 1),
    );
    assert.equal(new Set(result.run!.orders.map((o) => o.tote)).size, capacity);
    assert.deepEqual(
      C.startCart(picker, key, { barcode: c.code }),
      JSON.parse(JSON.stringify(result)),
    );
    const resumed = C.startCart(picker, randomUUID(), { barcode: c.code });
    assert.equal(resumed.resumed, true);
    assert.equal(resumed.run!.id, result.run!.id);
    assert.throws(
      () => C.startCart(other, randomUUID(), { barcode: c.code }),
      /uprawnień|inna osoba/,
    );
    assert.equal(
      db().prepare("SELECT reserved FROM wms_stock WHERE tw_id=?").get(p.twId)!
        .reserved,
      capacity,
    );
    assert.equal(result.run!.tasks[0].stop_quantity, capacity);
  });

test("kolektor otrzymuje kod EAN z pozycji zamówienia i potwierdza nim właściwą skrzynkę", () => {
  const p = product();
  db()
    .prepare("UPDATE sgt_towar SET ean=? WHERE tw_id=?")
    .run("0590123456789", p.twId);
  order(p.sku, 2);
  const run = start(cart().code),
    t = run.tasks[0];
  assert.equal(t.barcode, "0590123456789");
  assert.equal(t.position, 1);
  assert.equal(t.tw_id, p.twId);
  const picked = W.pickWave(picker, randomUUID(), run.id, {
    orderId: t.order_id,
    version: t.version,
    allocationId: t.allocation_id,
    bin: t.bin,
    barcode: t.barcode,
    tote: t.tote,
    quantity: 2,
  });
  assert.equal(picked.tasks.length, 0);
  assert.equal(picked.orders[0].status, "picked");
});

test("braki na pierwszych 75 pozycjach nie blokują gotowych zamówień; priorytet i zapas są wiążące", () => {
  const missing = product(0),
    available = product(2),
    c = cart();
  for (let i = 0; i < 75; i++) order(missing.sku, 1, 2);
  const ordinary = order(available.sku),
    urgent = order(available.sku, 1, 2),
    third = order(available.sku);
  const run = start(c.code);
  assert.deepEqual(
    run.assignments.map((a) => a.order_id),
    [urgent.id, ordinary.id],
  );
  assert.equal(W.getOrder(third.id).status, "new");
  const second = cart();
  assert.equal(
    C.startCart(other, randomUUID(), { barcode: second.code }).run,
    null,
  );
  assert.equal(C.getCart(other, second.code).occupied, false);
});

test("błędny kod skrzynki, nadmiar oraz stara wersja nie zmieniają stanu", () => {
  const p = product();
  order(p.sku, 2);
  order(p.sku);
  const run = start(cart().code),
    t = run.tasks[0];
  const payload = {
    orderId: t.order_id,
    version: t.version,
    allocationId: t.allocation_id,
    bin: t.bin,
    barcode: t.sku,
    tote: t.tote,
    quantity: 1,
  };
  const initial = W.getOrder(Number(t.order_id));
  assert.throws(
    () =>
      W.pickWave(picker, randomUUID(), run.id, {
        ...payload,
        tote: run.orders[1].tote,
      }),
    /pojemnik/,
  );
  assert.throws(
    () =>
      W.pickWave(picker, randomUUID(), run.id, { ...payload, quantity: 99 }),
    /Ilość/,
  );
  assert.deepEqual(W.getOrder(initial.id), initial);
  W.pickWave(picker, randomUUID(), run.id, payload);
  assert.throws(
    () => W.pickWave(picker, randomUUID(), run.id, payload),
    /zmieniło się/,
  );
  assert.equal(W.getOrder(initial.id).lines[0].picked, 1);
});

test("kolejność hali wyprzedza sortowanie nazw, a własna skrzynka blokuje ścieżkę ręczną", () => {
  const first = product(3, "Z-01"),
    second = product(3, "A-01"),
    c = cart();
  const o = order(first.sku);
  order(second.sku);
  C.configurePickRoute(admin, randomUUID(), {
    bins: [{ bin: "Z-01", sequence: 1, version: 0 }],
  });
  const allocated = W.actOnOrder(admin, randomUUID(), o.id, {
    action: "allocate",
    version: o.version,
  });
  assert.throws(
    () =>
      W.actOnOrder(picker, randomUUID(), o.id, {
        action: "pick-start",
        version: allocated.version,
        tote: c.slots[0].box_barcode,
      }),
    /skanem wózka/,
  );
  assert.equal(start(c.code).tasks[0].bin, "Z-01");
});

test("skan stanowiska jest obowiązkowy także przy bezpośrednim API zamówienia; pakowanie blokuje innego pracownika", () => {
  const p = product();
  order(p.sku);
  const c = cart(),
    run = start(c.code);
  assert.throws(
    () =>
      C.handoffCart(picker, randomUUID(), run.id, {
        cart: c.code,
        station: "PACK-01",
      }),
    /dokończ/,
  );
  pickAll(run.id);
  const o = W.getOrder(run.orders[0].id);
  assert.throws(
    () =>
      W.actOnOrder(other, randomUUID(), o.id, {
        action: "pack-start",
        version: o.version,
        tote: o.tote,
      }),
    /przekaż/,
  );
  assert.throws(
    () =>
      C.handoffCart(picker, randomUUID(), run.id, {
        cart: "OTHER",
        station: "PACK-01",
      }),
    /właściwy/,
  );
  C.handoffCart(picker, randomUUID(), run.id, {
    cart: c.code,
    station: "PACK-01",
  });
  assert.throws(
    () => C.packCartBox(other, randomUUID(), { box: o.tote, station: "EX-01" }),
    /stanowisko/,
  );
  const packed = C.packCartBox(other, randomUUID(), {
    box: o.tote,
    station: "PACK-01",
  });
  assert.equal(packed.status, "packing");
  assert.throws(
    () =>
      C.packCartBox(picker, randomUUID(), { box: o.tote, station: "PACK-01" }),
    /inna osoba/,
  );
  assert.throws(
    () => C.releaseCart(picker, randomUUID(), run.id, { cart: c.code }),
    /niezakończone/,
  );
});

test("odłączenie skrzynki zachowuje zamówienie; zajęta skrzynka nie wraca do obiegu", () => {
  const p = product();
  order(p.sku);
  const c = cart(),
    run = start(c.code);
  pickAll(run.id);
  const o = W.getOrder(run.orders[0].id);
  C.detachCartBox(picker, randomUUID(), run.id, {
    box: o.tote,
    station: "PACK-01",
    version: o.version,
  });
  assert.equal(C.getCart(picker, c.code).slots[0].box_barcode, null);
  C.releaseCart(picker, randomUUID(), run.id, { cart: c.code });
  const current = C.getCart(picker, c.code);
  assert.throws(
    () =>
      C.bindCartBox(picker, randomUUID(), {
        cart: c.code,
        position: 1,
        box: o.tote,
        version: current.version,
      }),
    /niezakończone/,
  );
  const replaced = C.bindCartBox(picker, randomUUID(), {
    cart: c.code,
    position: 1,
    box: `NEW-${serial}`,
    version: current.version,
  });
  assert.equal(replaced.slots[0].position, 1);
  assert.equal(
    C.packCartBox(other, randomUUID(), { box: o.tote, station: "PACK-01" }).id,
    o.id,
  );
});

test("pełna skrzynka: pozostałe zamówienie pracuje, wymiana zachowuje pozycję i rozwiązuje wyłącznie swój wyjątek", () => {
  const p = product();
  order(p.sku);
  order(p.sku);
  const c = cart(),
    run = start(c.code),
    t = run.tasks[0];
  C.reportPickException(picker, randomUUID(), {
    orderId: t.order_id,
    allocationId: t.allocation_id,
    version: t.version,
    box: t.tote,
    kind: "box_full",
    reason: "Część nie mieści się",
  });
  const held = W.getOrder(Number(t.order_id));
  assert.throws(
    () =>
      W.actOnOrder(admin, randomUUID(), held.id, {
        action: "resume",
        version: held.version,
        reason: "Obejście wyjątku",
      }),
    /rozwiąż/,
  );
  pickAll(run.id);
  assert.equal(W.getOrder(run.orders[1].id).status, "picked");
  const replaced = C.replaceCartBox(picker, randomUUID(), run.id, {
    oldBox: held.tote,
    newBox: `LARGE-${serial}`,
    version: held.version,
    transferConfirmed: true,
    reason: "Przełożono do większej skrzynki",
  });
  assert.equal(replaced.assignments[0].position, 1);
  assert.equal(replaced.assignments[0].box_barcode, `LARGE-${serial}`);
  assert.equal(W.getOrder(held.id).hold_reason, null);
  assert.ok(replaced.exceptions[0].resolved_at);
});

test("wyjątek nie koryguje zapasu; usunięcie wymaga zwrotu pobranych sztuk", () => {
  const p = product();
  order(p.sku, 2);
  const c = cart(),
    run = start(c.code),
    t = run.tasks[0];
  W.pickWave(picker, randomUUID(), run.id, {
    orderId: t.order_id,
    version: t.version,
    allocationId: t.allocation_id,
    bin: t.bin,
    barcode: t.sku,
    tote: t.tote,
    quantity: 1,
  });
  let o = W.getOrder(Number(t.order_id));
  C.reportPickException(picker, randomUUID(), {
    orderId: o.id,
    allocationId: t.allocation_id,
    version: o.version,
    box: o.tote,
    kind: "missing",
    reason: "Brakuje jednej sztuki",
  });
  o = W.getOrder(o.id);
  assert.equal(
    db().prepare("SELECT on_hand FROM wms_stock WHERE tw_id=?").get(p.twId)!
      .on_hand,
    999,
  );
  assert.throws(
    () =>
      C.resolvePickException(admin, randomUUID(), {
        orderId: o.id,
        version: o.version,
        box: o.tote,
        reason: "Anulowanie po braku",
        action: "remove",
      }),
    /odłóż/,
  );
  o = W.actOnOrder(picker, randomUUID(), o.id, {
    action: "return",
    version: o.version,
    allocationId: t.allocation_id,
    bin: t.bin,
    barcode: t.sku,
    quantity: 1,
    reason: "Zwrot pobrania",
  });
  const cancelled = C.resolvePickException(admin, randomUUID(), {
    orderId: o.id,
    version: o.version,
    box: o.tote,
    reason: "Anulowanie po braku",
    action: "remove",
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    db().prepare("SELECT reserved FROM wms_stock WHERE tw_id=?").get(p.twId)!
      .reserved,
    0,
  );
});

test("role, stara konfiguracja i analityka bez zapisu", () => {
  const c = cart();
  assert.throws(() => C.configureCart(picker, randomUUID(), {}), /uprawnień/);
  assert.throws(() => C.cartAnalytics(picker, {}), /uprawnień/);
  assert.throws(
    () =>
      C.bindCartBox(picker, randomUUID(), {
        cart: c.code,
        position: 1,
        box: "EMPTY",
        version: 999,
      }),
    /zmienił/,
  );
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  C.listCarts(picker);
  C.getCart(picker, c.code);
  const report = C.cartAnalytics(admin, {});
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
  assert.ok(Number(report.summary!.runs) > 0);
  assert.match(report.note, /Nie jest pomiarem roboczogodzin/);
});

test("błąd po pierwszym przydziale wycofuje cały wózek, zapas i klucz ponowienia", () => {
  const p = product(5),
    a = order(p.sku),
    b = order(p.sku),
    c = cart(),
    key = randomUUID();
  db().exec(
    "CREATE TRIGGER test_cart_failure BEFORE INSERT ON wms_cart_assignment WHEN NEW.position=2 BEGIN SELECT RAISE(ABORT,'symulowany błąd dysku'); END",
  );
  try {
    assert.throws(
      () => C.startCart(picker, key, { barcode: c.code }),
      /symulowany/,
    );
  } finally {
    db().exec("DROP TRIGGER test_cart_failure");
  }
  assert.equal(C.getCart(picker, c.code).occupied, false);
  assert.equal(W.getOrder(a.id).status, "new");
  assert.equal(W.getOrder(b.id).status, "new");
  assert.equal(
    db().prepare("SELECT reserved FROM wms_stock WHERE tw_id=?").get(p.twId)!
      .reserved,
    0,
  );
  assert.equal(
    db().prepare("SELECT 1 FROM wms_command WHERE key=?").get(key),
    undefined,
  );
  assert.equal(
    C.startCart(picker, key, { barcode: c.code }).run!.orders.length,
    2,
  );
});

test("profile jednego SKU i limitu sztuk mają jawne kryteria", () => {
  const p = product(),
    q = product();
  order(p.sku, 12);
  const single = order(p.sku, 2);
  const multi = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: "2026-09-12T12:00:00Z",
    lines: [
      { sku: p.sku, quantity: 1 },
      { sku: q.sku, quantity: 1 },
    ],
  });
  const singles = start(cart(30, "single", 2).code);
  assert.deepEqual(
    singles.orders.map((o) => o.id),
    [single.id],
  );
  const multiples = start(cart(20, "multi", 2).code);
  assert.deepEqual(
    multiples.orders.map((o) => o.id),
    [multi.id],
  );
});

async function concurrentStart(code: string, actorId: number, startAt: number) {
  const script = `import { bezMigracji } from ${JSON.stringify(new URL("../db/db.ts", import.meta.url).href)};
    bezMigracji();
    const { startCart } = await import(${JSON.stringify(new URL("./wms-carts.ts", import.meta.url).href)});
    await new Promise(resolve => setTimeout(resolve, Math.max(0, ${startAt}-Date.now())));
    const result = startCart({ id: ${actorId}, name: 'Test równoległy', role: 'magazynier' }, ${JSON.stringify(randomUUID())}, { barcode: ${JSON.stringify(code)} });
    console.log(JSON.stringify({ id: result.run?.id ?? null, count: result.run?.orders.length ?? 0, resumed: result.resumed }));`;
  return await new Promise<{
    id: number | null;
    count: number;
    resumed: boolean;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "",
      error = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (error += b));
    child.on("error", reject);
    child.on("exit", (status) => {
      if (status) reject(new Error(error));
      else {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}

test("dwa procesy skanują ten sam wózek: jedna trasa i jedno zużycie rezerwacji", async () => {
  const p = product(20);
  for (let i = 0; i < 20; i++) order(p.sku);
  const c = cart(),
    at = Date.now() + 2000;
  const results = await Promise.all([
    concurrentStart(c.code, 2, at),
    concurrentStart(c.code, 2, at),
  ]);
  assert.equal(results[0].id, results[1].id);
  assert.deepEqual(results.map((r) => r.resumed).sort(), [false, true]);
  assert.equal(
    db().prepare("SELECT reserved FROM wms_stock WHERE tw_id=?").get(p.twId)!
      .reserved,
    20,
  );
});

test("dwa różne wózki konkurują o ostatnią sztukę bez podwójnego przydziału", async () => {
  const p = product(1);
  order(p.sku);
  order(p.sku);
  const a = cart(),
    b = cart(30),
    at = Date.now() + 2000;
  const results = await Promise.all([
    concurrentStart(a.code, 2, at),
    concurrentStart(b.code, 3, at),
  ]);
  assert.equal(
    results.reduce((sum, r) => sum + r.count, 0),
    1,
  );
  assert.equal(results.filter((r) => r.id === null).length, 1);
  assert.equal(
    db().prepare("SELECT reserved FROM wms_stock WHERE tw_id=?").get(p.twId)!
      .reserved,
    1,
  );
});

test("brak blokuje wspólną półkę; przeliczenie odbudowuje rezerwacje według priorytetu i uzupełnienie przywraca zamówienie", async () => {
  const p = product(10),
    ordinary = order(p.sku, 3),
    urgent = order(p.sku, 3, 2);
  const run = start(cart().code),
    t = run.tasks.find((t) => t.order_id === ordinary.id)!;
  C.reportPickException(picker, randomUUID(), {
    orderId: ordinary.id,
    allocationId: t.allocation_id,
    version: t.version,
    box: t.tote,
    kind: "missing",
    reason: "Pusta część pojemnika na półce",
  });
  const otherTask = run.tasks.find((t) => t.order_id === urgent.id)!;
  assert.throws(
    () =>
      W.pickWave(picker, randomUUID(), run.id, {
        orderId: urgent.id,
        allocationId: otherTask.allocation_id,
        version: otherTask.version,
        bin: otherTask.bin,
        barcode: otherTask.sku,
        tote: otherTask.tote,
        quantity: 3,
      }),
    /przeliczenie/,
  );
  const check = S.stockWork(admin, { q: p.sku }).checks.find(
    (c) => c.tw_id === p.twId,
  )!;
  const count = {
    bin: p.bin,
    barcode: p.sku,
    version: check.stock_version,
    quantity: 3,
    reason: "Zweryfikowano trzy sprawne sztuki",
  };
  assert.throws(
    () => S.countStockCheck(picker, randomUUID(), Number(check.id), count),
    /uprawnień/,
  );
  assert.throws(
    () =>
      S.countStockCheck(admin, randomUUID(), Number(check.id), {
        ...count,
        version: 9999,
      }),
    /zmienił/,
  );
  assert.throws(
    () =>
      S.countStockCheck(admin, randomUUID(), Number(check.id), {
        ...count,
        barcode: "WRONG",
      }),
    /Inny towar/,
  );
  const counted = S.countStockCheck(
    admin,
    randomUUID(),
    Number(check.id),
    count,
  );
  assert.deepEqual(
    counted.results.map((r) => [r.orderId, r.reserved]),
    [
      [urgent.id, true],
      [ordinary.id, false],
    ],
  );
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, p.bin)!.on_hand,
    3,
  );
  assert.equal(
    db()
      .prepare("SELECT reserved FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, p.bin)!.reserved,
    3,
  );
  const held = W.getOrder(ordinary.id);
  assert.throws(
    () =>
      C.resolvePickException(admin, randomUUID(), {
        orderId: held.id,
        version: held.version,
        box: held.tote,
        action: "continue",
        reason: "Kontrola po przeliczeniu",
      }),
    /Uzupełnij/,
  );
  const reserve = `RES-${p.twId}`;
  W.configureBin(admin, randomUUID(), {
    bin: reserve,
    mode: "reserve",
    version: 1,
    reason: "Zapas zaplecza",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: reserve,
    quantity: 6,
    reason: "Zapas do uzupełnienia",
  });
  const plan = S.stockWork(picker, { q: p.sku }).plans.find(
    (p) => p.tw_id === held.lines[0].tw_id,
  )!;
  assert.equal(plan.quantity, 3);
  const job = S.claimReplenishment(picker, randomUUID(), {
    twId: p.twId,
    source: reserve,
    target: p.bin,
    quantity: 3,
    sourceVersion: plan.source_version,
    targetVersion: plan.target_version,
  });
  const scan = { source: reserve, target: p.bin, barcode: p.sku, quantity: 3 };
  assert.throws(
    () => S.completeReplenishment(other, randomUUID(), job.id, scan),
    /inna osoba/,
  );
  assert.throws(
    () =>
      S.completeReplenishment(picker, randomUUID(), job.id, {
        ...scan,
        barcode: "WRONG",
      }),
    /Inny towar/,
  );
  const key = randomUUID(),
    completed = S.completeReplenishment(picker, key, job.id, scan);
  assert.deepEqual(
    S.completeReplenishment(picker, key, job.id, scan),
    completed,
  );
  assert.throws(
    () => S.completeReplenishment(picker, randomUUID(), job.id, scan),
    /zamknięte/,
  );
  const restored = C.resolvePickException(admin, randomUUID(), {
    orderId: held.id,
    version: held.version,
    box: held.tote,
    action: "continue",
    reason: "Uzupełnienie sprawdzone",
  });
  assert.equal(restored.hold_reason, null);
  assert.equal(
    restored.allocations.reduce((sum, a) => sum + a.quantity, 0),
    3,
  );
  assert.equal((await import("./wms-analytics.js")).integrity().ok, true);
});

test("plan uzupełnień nie zapisuje, a nowe przyjęcie nie unieważnia przypisanej pracy", () => {
  const p = product(1),
    reserve = `RES-${p.twId}`;
  W.configureBin(admin, randomUUID(), {
    bin: reserve,
    mode: "reserve",
    version: 1,
    reason: "Zapas zaplecza",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: reserve,
    quantity: 8,
    reason: "Zapas uzupełnienia",
  });
  W.changeStock(admin, randomUUID(), {
    action: "minimum",
    twId: p.twId,
    bin: p.bin,
    quantity: 5,
    version: 2,
    reason: "Minimum kompletacji",
  });
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  const plan = S.stockWork(picker, { q: p.sku }).plans[0];
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
  assert.equal(plan.quantity, 4);
  const input = {
    twId: p.twId,
    source: reserve,
    target: p.bin,
    quantity: 4,
    sourceVersion: plan.source_version,
    targetVersion: plan.target_version,
  };
  const task = S.claimReplenishment(picker, randomUUID(), input);
  assert.throws(
    () => S.claimReplenishment(other, randomUUID(), input),
    /otwarte uzupełnienie/,
  );
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: reserve,
    quantity: 1,
    reason: "Zmiana w czasie zadania",
  });
  S.completeReplenishment(picker, randomUUID(), task.id, {
    source: reserve,
    target: p.bin,
    barcode: p.sku,
    quantity: 4,
  });
  assert.equal(S.stockWork(picker, { q: p.sku }).plans.length, 0);
});

test("ręczne przesunięcie nie zabiera sztuk przydzielonych do uzupełnienia", () => {
  const p = product(1),
    source = `RS-${p.twId}`;
  W.configureBin(admin, randomUUID(), {
    bin: source,
    mode: "reserve",
    version: 1,
    reason: "Zaplecze",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: source,
    quantity: 8,
    reason: "Przyjęcie",
  });
  const task = S.claimReplenishment(picker, randomUUID(), {
    twId: p.twId,
    source,
    target: p.bin,
    quantity: 4,
    sourceVersion: 2,
    targetVersion: 2,
  });
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "transfer",
        twId: p.twId,
        bin: source,
        target: "OTHER",
        quantity: 5,
        reason: "Ręczny ruch",
      }),
    /uzupełnień/,
  );
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, source)!.on_hand,
    8,
  );
  W.changeStock(admin, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: source,
    target: "OTHER",
    quantity: 4,
    reason: "Wolne sztuki",
  });
  const key = randomUUID(),
    scan = { source, target: p.bin, barcode: p.sku, quantity: 4 };
  S.completeReplenishment(picker, key, task.id, scan);
  S.completeReplenishment(picker, key, task.id, scan);
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, source)!.on_hand,
    0,
  );
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, p.bin)!.on_hand,
    5,
  );
});

test("dwa uzupełnienia chronią wspólne źródło, a awaria wycofuje zwolnienie przydziału", () => {
  const p = product(1),
    source = `RS-${p.twId}`,
    target = `PICK-${p.twId}`;
  W.configureBin(admin, randomUUID(), {
    bin: source,
    mode: "reserve",
    version: 1,
    reason: "Zaplecze",
  });
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: source,
    quantity: 8,
    reason: "Przyjęcie",
  });
  W.changeStock(admin, randomUUID(), {
    action: "minimum",
    twId: p.twId,
    bin: target,
    quantity: 4,
    version: 1,
    reason: "Druga półka",
  });
  const first = S.claimReplenishment(picker, randomUUID(), {
    twId: p.twId,
    source,
    target: p.bin,
    quantity: 4,
    sourceVersion: 2,
    targetVersion: 2,
  });
  const second = S.claimReplenishment(other, randomUUID(), {
    twId: p.twId,
    source,
    target,
    quantity: 4,
    sourceVersion: 2,
    targetVersion: 2,
  });
  assert.equal(
    W.inventory({ q: p.sku }).rows.find((row) => row.bin === source)!
      .replenishment_reserved,
    8,
  );
  assert.throws(
    () =>
      W.configureBin(admin, randomUUID(), {
        bin: source,
        mode: "pick",
        version: 2,
        reason: "Zmiana przeznaczenia",
      }),
    /otwarte uzupełnienia/,
  );
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "count",
        twId: p.twId,
        bin: source,
        quantity: 7,
        version: 2,
        reason: "Przeliczenie źródła",
      }),
    /uzupełnień/,
  );
  db()
    .exec(`CREATE TEMP TRIGGER fail_replenishment BEFORE INSERT ON wms_movement
    WHEN NEW.tw_id=${p.twId} AND NEW.bin='${p.bin}' AND NEW.kind='transfer'
    BEGIN SELECT RAISE(ABORT,'replenishment rollback'); END`);
  try {
    assert.throws(
      () =>
        S.completeReplenishment(picker, randomUUID(), first.id, {
          source,
          target: p.bin,
          barcode: p.sku,
          quantity: 4,
        }),
      /rollback/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_replenishment");
  }
  assert.equal(
    db()
      .prepare("SELECT completed_at FROM wms_replenishment WHERE id=?")
      .get(first.id)!.completed_at,
    null,
  );
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, source)!.on_hand,
    8,
  );
  S.completeReplenishment(picker, randomUUID(), first.id, {
    source,
    target: p.bin,
    barcode: p.sku,
    quantity: 4,
  });
  S.completeReplenishment(other, randomUUID(), second.id, {
    source,
    target,
    barcode: p.sku,
    quantity: 4,
  });
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, source)!.on_hand,
    0,
  );
});

test("ręczny ruch nie omija przeliczenia źródła ani celu", () => {
  const p = product(10),
    otherBin = `SAFE-${p.twId}`;
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: p.twId,
    bin: otherBin,
    quantity: 2,
    reason: "Druga półka",
  });
  db()
    .prepare(
      "INSERT INTO wms_stock_check(tw_id,bin,reason,created_at,user_id) VALUES (?,?,?,?,?)",
    )
    .run(p.twId, p.bin, "Rozbieżność", new Date().toISOString(), admin.id);
  for (const [source, target] of [
    [p.bin, otherBin],
    [otherBin, p.bin],
  ])
    assert.throws(
      () =>
        W.changeStock(admin, randomUUID(), {
          action: "transfer",
          twId: p.twId,
          bin: source,
          target,
          quantity: 1,
          reason: "Próba obejścia",
        }),
      /przeliczenie/,
    );
  assert.equal(
    db()
      .prepare("SELECT on_hand FROM wms_stock WHERE tw_id=? AND bin=?")
      .get(p.twId, otherBin)!.on_hand,
    2,
  );
});
