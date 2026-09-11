import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wms-")),
  "wms.db",
);
let W: typeof import("./wms.js");
let A: typeof import("./wms-analytics.js");
let D: typeof import("./wms-dispatch.js");
let db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const };
const picker = { id: 2, name: "Zbierający", role: "magazynier" as const };
const packer = { id: 3, name: "Pakujący", role: "magazynier" as const };
let nextSku = 1;
before(async () => {
  W = await import("./wms.js");
  A = await import("./wms-analytics.js");
  D = await import("./wms-dispatch.js");
  ({ db } = await import("../db/db.js"));
});

function stockBatchPayload(input: {
  reference: string;
  mode: "receive" | "count";
  rows: { sku: string; bin: string; quantity: number }[];
}) {
  return {
    ...input,
    rows: W.previewStockBatch(admin, input).rows.map(
      ({ sku, bin, quantity, version }) => ({ sku, bin, quantity, version }),
    ),
  };
}

test("podgląd dokumentu stanów nie zapisuje; spis jest atomowy i odrzuca nieaktualne wersje", () => {
  const p = product(10),
    q = product(20);
  const input = {
    reference: "SPIS-TEST-001",
    mode: "count" as const,
    rows: [
      { sku: p.sku, bin: "A01-01-02", quantity: 8 },
      { sku: q.sku, bin: "A01-01-02", quantity: 19 },
    ],
  };
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  const body = stockBatchPayload(input);
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
  assert.throws(() => W.previewStockBatch(picker, input), /uprawnień/);
  assert.throws(
    () => W.importStockBatch(picker, randomUUID(), body),
    /uprawnień/,
  );
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId: q.twId,
    bin: "A01-01-02",
    quantity: 1,
    reason: "Nowa dostawa",
  });
  assert.throws(
    () => W.importStockBatch(admin, randomUUID(), body),
    /Wiersz 2: stan zmienił/,
  );
  assert.equal(W.inventory({ q: p.sku }).rows[0].on_hand, 10);
  const key = randomUUID(),
    refreshed = stockBatchPayload(input),
    result = W.importStockBatch(admin, key, refreshed);
  assert.equal(result.delta, -4);
  assert.deepEqual(W.importStockBatch(admin, key, refreshed), result);
  const replay = W.importStockBatch(admin, randomUUID(), {
    ...refreshed,
    rows: [...refreshed.rows].reverse(),
  });
  assert.equal(replay.alreadyApplied, true);
  assert.equal(
    W.importStockBatch(admin, randomUUID(), {
      ...refreshed,
      reference: refreshed.reference.toLowerCase(),
    }).alreadyApplied,
    true,
  );
  assert.throws(
    () =>
      db()
        .prepare("DELETE FROM wms_stock_document WHERE reference=?")
        .run(input.reference),
    /immutable/,
  );
  assert.equal(W.inventory({ q: p.sku }).rows[0].on_hand, 8);
  assert.equal(
    W.previewStockBatch(admin, input).completed?.reference,
    input.reference,
  );
  assert.throws(
    () =>
      W.previewStockBatch(admin, {
        ...input,
        rows: [{ ...input.rows[0], quantity: 7 }],
      }),
    /inną treść/,
  );
  assert.equal(A.integrity().ok, true);
});

test("dokument przyjęcia odrzuca błędne i powtórzone SKU; awaria drugiego ruchu wycofuje cały dokument", () => {
  const p = product(10),
    q = product(20);
  const input = {
    reference: "PZ-TEST-002",
    mode: "receive" as const,
    rows: [
      { sku: p.sku, bin: "B01-01-01", quantity: 3 },
      { sku: q.sku, bin: "B01-01-01", quantity: 4 },
    ],
  };
  assert.throws(
    () =>
      W.previewStockBatch(admin, {
        ...input,
        rows: [input.rows[0], { ...input.rows[0], sku: p.sku.toLowerCase() }],
      }),
    /powtórzona para/,
  );
  assert.throws(
    () =>
      W.previewStockBatch(admin, {
        ...input,
        rows: [{ ...input.rows[0], sku: "UNKNOWN-STOCK-SKU" }],
      }),
    /nie wskazuje/,
  );
  assert.throws(
    () =>
      W.previewStockBatch(admin, {
        ...input,
        rows: [{ ...input.rows[0], quantity: 0 }],
      }),
    /dodatniej ilości/,
  );
  const body = stockBatchPayload(input),
    key = randomUUID();
  db().exec(
    `CREATE TRIGGER fail_stock_document BEFORE INSERT ON wms_movement WHEN NEW.tw_id=${q.twId} AND NEW.bin='B01-01-01' BEGIN SELECT RAISE(ABORT,'test disk failure'); END;`,
  );
  try {
    assert.throws(
      () => W.importStockBatch(admin, key, body),
      /test disk failure/,
    );
  } finally {
    db().exec("DROP TRIGGER fail_stock_document");
  }
  assert.equal(
    db()
      .prepare("SELECT 1 FROM wms_stock_document WHERE reference=?")
      .get(input.reference),
    undefined,
  );
  assert.equal(
    db()
      .prepare("SELECT 1 FROM wms_stock WHERE tw_id=? AND bin='B01-01-01'")
      .get(p.twId),
    undefined,
  );
  const result = W.importStockBatch(admin, key, body);
  assert.equal(result.delta, 7);
  assert.equal(
    W.importStockBatch(admin, randomUUID(), body).alreadyApplied,
    true,
  );
  assert.equal(
    W.inventory({ q: p.sku }).rows.find((r) => r.bin === "B01-01-01")?.on_hand,
    3,
  );
  assert.equal(A.integrity().ok, true);
});

test("spis z dokumentu nie narusza rezerwacji; brakująca lokalizacja i zero są jawne", () => {
  const p = product(10);
  action(order(p.sku, 5), "allocate");
  const input = {
    reference: "SPIS-TEST-003",
    mode: "count" as const,
    rows: [{ sku: p.sku, bin: "A01-01-02", quantity: 4 }],
  };
  assert.throws(
    () => W.previewStockBatch(admin, input),
    /mniejszy niż rezerwacja/,
  );
  const zero = {
    ...input,
    rows: [{ sku: p.sku, bin: "EMPTY-COUNT", quantity: 0 }],
  };
  W.importStockBatch(admin, randomUUID(), stockBatchPayload(zero));
  assert.equal(
    W.inventory({ q: p.sku }).rows.find((r) => r.bin === "EMPTY-COUNT")
      ?.on_hand,
    0,
  );
  assert.equal(
    W.inventory({ q: p.sku }).rows.find((r) => r.bin === "A01-01-02")?.on_hand,
    10,
  );
  assert.equal(A.integrity().ok, true);
});

test("otwarcie 5000 SKU zapisuje jeden dokument i zgodny dziennik", () => {
  const d = db(),
    rows = [];
  const insert = d.prepare(
    "INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)",
  );
  d.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 0; i < 5000; i++) {
      const sku = `OPENING-${i}`;
      insert.run(100000 + i, sku, `Część otwarcia ${i}`);
      rows.push({ sku, bin: "OPENING-BIN", quantity: 10 });
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  const input = { reference: "SPIS-5000-SKU", mode: "count" as const, rows };
  const result = W.importStockBatch(
    admin,
    randomUUID(),
    stockBatchPayload(input),
  );
  assert.equal(result.rows, 5000);
  assert.equal(result.delta, 50000);
  assert.equal(
    d
      .prepare(
        "SELECT sum(on_hand) AS n FROM wms_stock WHERE bin='OPENING-BIN'",
      )
      .get()!.n,
    50000,
  );
  assert.equal(A.integrity().ok, true);
});

test("kwarantanna i zaplecze nie zasilają zbiórki; uwolnienie zapasu wymaga biura", () => {
  const p = product(10),
    address = `QUAR-${p.twId}`,
    reserve = `RES-${p.twId}`;
  const key = randomUUID();
  const input = {
    bin: address,
    mode: "quarantine",
    version: 1,
    reason: "Kontrola dostawy",
  };
  const configured = W.configureBin(admin, key, input);
  assert.deepEqual(W.configureBin(admin, key, input), configured);
  assert.throws(() => W.configureBin(picker, randomUUID(), input), /uprawnień/);
  assert.throws(
    () => W.configureBin(admin, randomUUID(), { ...input, mode: "pick" }),
    /zmieniła/,
  );
  W.changeStock(picker, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: "A01-01-02",
    target: address,
    quantity: 10,
    reason: "Kontrola dostawy",
  });
  const o = order(p.sku, 2);
  assert.throws(() => action(o, "allocate"), /Brak 2/);
  assert.equal(
    W.inventory({ q: p.sku }).rows.find((s) => s.bin === address)?.available,
    0,
  );
  assert.equal(A.analytics({}).stock!.quarantined, 10);
  assert.throws(
    () =>
      W.changeStock(picker, randomUUID(), {
        action: "transfer",
        twId: p.twId,
        bin: address,
        target: "A01-01-02",
        quantity: 2,
        reason: "Po kontroli",
      }),
    /uprawnień/,
  );
  W.configureBin(admin, randomUUID(), {
    bin: reserve,
    mode: "reserve",
    version: 1,
    reason: "Zapas zaplecza",
  });
  W.changeStock(admin, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: address,
    target: reserve,
    quantity: 2,
    reason: "Po kontroli",
  });
  assert.throws(() => action(o, "allocate"), /Brak 2/);
  W.changeStock(picker, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: reserve,
    target: "A01-01-02",
    quantity: 2,
    reason: "Uzupełnienie zbiórki",
  });
  const allocated = action(o, "allocate");
  assert.equal(allocated.allocations[0].bin, "A01-01-02");
  assert.throws(
    () =>
      W.configureBin(admin, randomUUID(), {
        bin: "A01-01-02",
        mode: "quarantine",
        version: 1,
        reason: "Zamknięcie półki",
      }),
    /rezerwacje/,
  );
  assert.ok(
    W.listBins({ q: address }).rows.some((b) => b.mode === "quarantine"),
  );
  assert.equal(A.integrity().ok, true);
});
function product(quantity = 10) {
  const twId = nextSku++;
  const sku = `PART-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Nóż kosiarki", `590${twId}`);
  W.changeStock(admin, randomUUID(), {
    action: "receive",
    twId,
    bin: "A01-01-02",
    quantity,
    reason: "Przyjęcie PZ",
  });
  return { twId, sku };
}
function order(sku: string, quantity = 2) {
  return W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    lines: [{ sku, quantity }],
  });
}
type Detail = ReturnType<typeof order>;
function action(
  o: Detail,
  action: string,
  extra = {},
  actor = admin as typeof admin | typeof picker | typeof packer,
) {
  return W.actOnOrder(actor, randomUUID(), o.id, {
    action,
    version: o.version,
    ...extra,
  });
}
function pick(o: Detail) {
  o = action(o, "allocate");
  o = action(o, "pick-start", { tote: `BOX-${o.id}` }, picker);
  for (const a of o.allocations) {
    const line = o.lines.find((l) => l.id === a.line_id)!;
    o = action(
      o,
      "pick",
      {
        allocationId: a.id,
        bin: a.bin,
        barcode: line.sku,
        quantity: a.quantity,
      },
      picker,
    );
  }
  return o;
}

test("pełny przebieg: rezerwacja → skan → kontrola paczki → wysyłka → zgodny dziennik", () => {
  const p = product();
  let o = pick(order(p.sku));
  assert.equal(o.status, "picked");
  assert.throws(
    () => action(o, "pack-start", { tote: "OBCY" }, packer),
    /pojemnik/,
  );
  o = action(o, "pack-start", { tote: o.tote }, packer);
  assert.throws(
    () =>
      action(
        o,
        "ship",
        { carrier: "DPD", tracking: "123", weightG: 500 },
        packer,
      ),
    /etapie/,
  );
  assert.throws(
    () => action(o, "pack", { barcode: p.sku, quantity: 3 }, packer),
    /Nadmiar/,
  );
  o = action(o, "pack", { barcode: p.sku, quantity: 2 }, packer);
  assert.equal(o.status, "packed");
  o = action(
    o,
    "ship",
    { carrier: "DPD", tracking: "123", weightG: 500 },
    packer,
  );
  assert.equal(o.status, "packed");
  const batch = D.createHandoff(packer, randomUUID(), { carrier: "DPD" });
  const scanned = D.scanHandoff(packer, randomUUID(), batch.id, {
    tracking: "123",
  });
  D.closeHandoff(packer, randomUUID(), batch.id, {
    version: scanned.version,
    parcels: 1,
  });
  o = W.getOrder(o.id);
  assert.equal(o.status, "shipped");
  assert.throws(
    () => action(o, "cancel", { reason: "Anulowanie" }),
    /zamknięte/,
  );
  assert.deepEqual(A.integrity(), { ok: true, balances: [], reservations: [] });
  assert.equal(
    (A.analytics({ days: 1 }).throughput as { shipped: number }).shipped,
    1,
  );
});

test("wózek atomowo przypisuje zamówienia i wymaga właściwego pojemnika przy każdym skanie", () => {
  const p = product(10);
  const first = action(order(p.sku, 1), "allocate"),
    second = action(order(p.sku, 2), "allocate");
  const key = randomUUID();
  const input = {
    name: "Trasa 1",
    orders: [
      { id: first.id, version: first.version, tote: "CART-BOX-1" },
      { id: second.id, version: second.version, tote: "CART-BOX-2" },
    ],
  };
  const count = () =>
    db().prepare("SELECT count(*) AS n FROM wms_wave").get()!.n;
  const baseline = count();
  assert.throws(
    () =>
      W.createWave(picker, randomUUID(), {
        ...input,
        orders: [input.orders[0], { ...input.orders[1], tote: "CART-BOX-1" }],
      }),
    /Pojemnik/,
  );
  assert.equal(count(), baseline);
  assert.equal(W.getOrder(first.id).status, "allocated");
  let wave = W.createWave(picker, key, input);
  assert.equal(W.createWave(picker, key, input).id, wave.id);
  assert.equal(wave.orders.length, 2);
  assert.equal(W.listWaves(picker, {}).rows.length, 1);
  assert.throws(() => W.getWave(packer, Number(wave.id)), /uprawnień/);
  assert.throws(() => W.createWave(packer, randomUUID(), input), /wózka/);
  const task = wave.tasks[0];
  assert.equal(
    task.tw_id,
    W.getOrder(Number(task.order_id)).lines.find((l) => l.sku === task.sku)
      ?.tw_id,
  );
  const scan = {
    orderId: task.order_id,
    version: task.version,
    allocationId: task.allocation_id,
    bin: task.bin,
    barcode: task.sku,
    quantity: task.remaining,
    tote: task.tote,
  };
  assert.throws(
    () =>
      W.pickWave(picker, randomUUID(), Number(wave.id), {
        ...scan,
        tote: "WRONG",
      }),
    /pojemnik/,
  );
  assert.throws(
    () =>
      action(
        W.getOrder(first.id),
        "pick",
        {
          allocationId: task.allocation_id,
          bin: task.bin,
          barcode: task.sku,
          quantity: 1,
        },
        picker,
      ),
    /pojemnik/,
  );
  const scanKey = randomUUID();
  wave = W.pickWave(picker, scanKey, Number(wave.id), scan);
  assert.equal(
    W.pickWave(picker, scanKey, Number(wave.id), scan).tasks.length,
    wave.tasks.length,
  );
  assert.equal(W.getOrder(Number(task.order_id)).lines[0].picked, 1);
  const remaining = wave.tasks[0];
  const held = action(
    W.getOrder(Number(remaining.order_id)),
    "hold",
    { reason: "Sprawdzenie części" },
    picker,
  );
  assert.throws(
    () =>
      W.pickWave(picker, randomUUID(), Number(wave.id), {
        orderId: held.id,
        version: held.version,
        allocationId: remaining.allocation_id,
        bin: remaining.bin,
        barcode: remaining.sku,
        quantity: remaining.remaining,
        tote: remaining.tote,
      }),
    /wstrzymane/,
  );
  const resumed = action(held, "resume", { reason: "Zgodność potwierdzona" });
  wave = W.pickWave(picker, randomUUID(), Number(wave.id), {
    orderId: resumed.id,
    version: resumed.version,
    allocationId: remaining.allocation_id,
    bin: remaining.bin,
    barcode: remaining.sku,
    quantity: remaining.remaining,
    tote: remaining.tote,
  });
  assert.equal(wave.tasks.length, 0);
  assert.equal(W.listWaves(picker, {}).rows.length, 0);
  assert.equal(A.integrity().ok, true);
});

test("niedobór drugiej pozycji wycofuje wszystkie rezerwacje i audyt", () => {
  const a = product(10),
    b = product(1);
  const o = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: new Date().toISOString(),
    lines: [
      { sku: a.sku, quantity: 5 },
      { sku: b.sku, quantity: 2 },
    ],
  });
  assert.throws(() => action(o, "allocate"), /Brak 1/);
  assert.equal(W.getOrder(o.id).allocations.length, 0);
  const stock = db()
    .prepare("SELECT reserved FROM wms_stock WHERE tw_id=?")
    .get(a.twId);
  assert.equal(stock?.reserved, 0);
  assert.equal(A.integrity().ok, true);
});

test("zmiana zamówienia zwalnia rezerwacje atomowo i wymaga odłożenia pobranego towaru", () => {
  const p = product(10),
    replacement = product(10);
  let o = action(order(p.sku, 2), "allocate");
  const amendment = {
    lines: [{ sku: replacement.sku, quantity: 3 }],
    dueAt: o.due_at,
    priority: 1,
    reason: "Klient wybrał inną część",
  };
  assert.throws(() => action(o, "amend", amendment, picker), /uprawnień/);
  assert.throws(
    () =>
      action(o, "amend", {
        ...amendment,
        lines: [{ sku: "UNKNOWN", quantity: 3 }],
      }),
    /brak kartoteki/,
  );
  assert.equal(W.getOrder(o.id).status, "allocated");
  assert.equal(W.inventory({ q: p.sku }).rows[0].reserved, 2);
  o = action(o, "amend", amendment);
  assert.equal(o.status, "new");
  assert.equal(o.lines[0].sku, replacement.sku);
  assert.equal(W.inventory({ q: p.sku }).rows[0].reserved, 0);
  o = pick(o);
  assert.throws(() => action(o, "amend", amendment), /etapie/);
  o = action(o, "hold", { reason: "Kolejna zmiana klienta" });
  const a = o.allocations[0];
  o = action(o, "return", {
    allocationId: a.id,
    bin: a.bin,
    barcode: replacement.sku,
    quantity: 3,
    reason: "Odłożono przed zmianą",
  });
  o = action(o, "amend", {
    ...amendment,
    lines: [{ sku: p.sku, quantity: 1 }],
  });
  assert.equal(o.status, "new");
  assert.ok(o.hold_reason);
  assert.equal(o.tote, null);
  assert.equal(A.integrity().ok, true);
});

test("ponowienie po utracie odpowiedzi nie podwaja pobrania, a inny payload jest konfliktem", () => {
  const p = product();
  let o = action(order(p.sku), "allocate");
  o = action(o, "pick-start", { tote: `BOX-${o.id}` }, picker);
  const key = randomUUID();
  const input = {
    action: "pick",
    version: o.version,
    allocationId: o.allocations[0].id,
    bin: "A01-01-02",
    barcode: p.sku,
    quantity: 1,
  };
  const first = W.actOnOrder(picker, key, o.id, input);
  assert.deepEqual(
    W.actOnOrder(picker, key, o.id, input),
    JSON.parse(JSON.stringify(first)),
  );
  assert.throws(
    () => W.actOnOrder(picker, key, o.id, { ...input, quantity: 2 }),
    /Klucz/,
  );
  assert.throws(
    () => W.actOnOrder(picker, randomUUID(), o.id, input),
    /zmieniło/,
  );
  assert.equal(W.getOrder(o.id).lines[0].picked, 1);
});

test("dwaj operatorzy nie przejmują równocześnie zlecenia ani nie rezerwują ostatniej sztuki", () => {
  const p = product(1);
  const a = order(p.sku, 1),
    b = order(p.sku, 1);
  const reserved = action(a, "allocate");
  assert.throws(() => action(b, "allocate"), /Brak/);
  const started = action(
    reserved,
    "pick-start",
    { tote: `BOX-${a.id}` },
    picker,
  );
  assert.throws(
    () => action(reserved, "pick-start", { tote: `BOX-${a.id}` }, packer),
    /zmieniło/,
  );
  assert.throws(
    () =>
      action(
        started,
        "pick",
        {
          allocationId: started.allocations[0].id,
          bin: "A01-01-02",
          barcode: p.sku,
          quantity: 1,
        },
        packer,
      ),
    /inna osoba/,
  );
});

test("skan złego towaru, lokalizacji i nadmiaru nie zmienia stanu", () => {
  const p = product();
  let o = action(order(p.sku), "allocate");
  o = action(o, "pick-start", { tote: `BOX-${o.id}` }, picker);
  const data = {
    allocationId: o.allocations[0].id,
    bin: "A01-01-02",
    barcode: p.sku,
    quantity: 1,
  };
  assert.throws(
    () => action(o, "pick", { ...data, barcode: "ZŁY" }, picker),
    /Inny towar/,
  );
  assert.throws(
    () => action(o, "pick", { ...data, bin: "A02-01-02" }, picker),
    /lokalizację/,
  );
  assert.throws(
    () => action(o, "pick", { ...data, quantity: 3 }, picker),
    /Ilość/,
  );
  assert.equal(W.getOrder(o.id).lines[0].picked, 0);
});

test("anulowanie po pobraniu wymaga fizycznego zwrotu, zwraca zapas i zwalnia rezerwację", () => {
  const p = product();
  let o = pick(order(p.sku));
  assert.throws(() => action(o, "cancel", { reason: "Rezygnacja" }), /odłóż/);
  o = action(o, "hold", { reason: "Rezygnacja klienta" });
  o = action(
    o,
    "return",
    {
      allocationId: o.allocations[0].id,
      bin: "A01-01-02",
      barcode: p.sku,
      quantity: 2,
      reason: "Odłożono towar",
    },
    picker,
  );
  o = action(o, "cancel", { reason: "Rezygnacja klienta" });
  assert.equal(o.status, "cancelled");
  const s = db()
    .prepare("SELECT on_hand,reserved FROM wms_stock WHERE tw_id=?")
    .get(p.twId);
  assert.equal(s?.on_hand, 10);
  assert.equal(s?.reserved, 0);
  assert.equal(A.integrity().ok, true);
});

test("spis i przesunięcie nie naruszają rezerwacji; spis chroniony wersją i rolą", () => {
  const p = product(10);
  action(order(p.sku, 8), "allocate");
  const current = db()
    .prepare("SELECT version FROM wms_stock WHERE tw_id=?")
    .get(p.twId)!;
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "count",
        twId: p.twId,
        bin: "A01-01-02",
        quantity: 3,
        version: current.version,
        reason: "Spis",
      }),
    /Za mało/,
  );
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "transfer",
        twId: p.twId,
        bin: "A01-01-02",
        target: "B01-01-02",
        quantity: 3,
        reason: "Uzupełnienie",
      }),
    /Za mało/,
  );
  assert.throws(
    () =>
      W.changeStock(picker, randomUUID(), {
        action: "count",
        twId: p.twId,
        bin: "A01-01-02",
        quantity: 10,
        version: current.version,
        reason: "Spis",
      }),
    /uprawnień/,
  );
  W.changeStock(admin, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: "A01-01-02",
    target: "B01-01-02",
    quantity: 2,
    reason: "Uzupełnienie",
  });
  assert.throws(
    () =>
      W.changeStock(admin, randomUUID(), {
        action: "count",
        twId: p.twId,
        bin: "A01-01-02",
        quantity: 8,
        version: current.version,
        reason: "Spis",
      }),
    /zmienił/,
  );
  assert.equal(A.integrity().ok, true);
});

test("dziennik odporny na nadpisanie i usunięcie, zerowe i ułamkowe ilości odrzucone", () => {
  assert.throws(
    () => db().prepare("UPDATE wms_movement SET delta=999 WHERE id=1").run(),
    /immutable/,
  );
  assert.throws(
    () => db().prepare("DELETE FROM wms_movement WHERE id=1").run(),
    /immutable/,
  );
  const p = product();
  for (const quantity of [0, -1, 0.5, NaN, Infinity])
    assert.throws(() => order(p.sku, quantity));
});

test("kontrola spójności wykrywa także brak całego wiersza zapasu", () => {
  const p = product(3);
  action(order(p.sku, 1), "allocate");
  const original = {
    ...db().prepare("SELECT * FROM wms_stock WHERE tw_id=?").get(p.twId),
  };
  db().prepare("DELETE FROM wms_stock WHERE tw_id=?").run(p.twId);
  try {
    const result = A.integrity();
    assert.equal(result.ok, false);
    assert.ok(result.balances.some((s) => s.tw_id === p.twId));
    assert.ok(result.reservations.some((s) => s.tw_id === p.twId));
  } finally {
    db()
      .prepare(
        "INSERT INTO wms_stock(tw_id,bin,on_hand,reserved,minimum,version) VALUES (?,?,?,?,?,?)",
      )
      .run(
        original.tw_id,
        original.bin,
        original.on_hand,
        original.reserved,
        original.minimum,
        original.version,
      );
  }
  assert.equal(A.integrity().ok, true);
});

test("dwa niezależne procesy rezerwują ostatnią sztukę tylko raz", async () => {
  const p = product(1),
    a = order(p.sku, 1),
    b = order(p.sku, 1);
  const run = (o: Detail) =>
    new Promise<number>((resolve, reject) => {
      const script = `const D=await import(${JSON.stringify(new URL("../db/db.ts", import.meta.url).href)});D.bezMigracji();
      const W=await import(${JSON.stringify(new URL("./wms.ts", import.meta.url).href)});
      try{W.actOnOrder(${JSON.stringify(admin)},${JSON.stringify(randomUUID())},${o.id},{action:'allocate',version:1});process.exit(0);}
      catch(e){if(e instanceof W.WmsError && e.statusCode===409)process.exit(9);console.error(e);process.exit(1);}`;
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          env: process.env,
          windowsHide: true,
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let error = "";
      child.stderr.on("data", (d) => (error += d));
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0 || code === 9 ? resolve(code) : reject(new Error(error)),
      );
    });
  const results = await Promise.all([run(a), run(b)]);
  assert.deepEqual(results.sort(), [0, 9]);
  assert.equal(A.integrity().ok, true);
});

test("kopia SQLite obejmuje WAL; odtworzenie przechodzi kontrolę i nie nadpisuje celu", async () => {
  const { verifiedBackup } = await import("./wms-backup.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wms-backup-test-"));
  const target = path.join(dir, "copy.db"),
    restored = path.join(dir, "restored.db");
  const result = await verifiedBackup(process.env.DB_PATH!, target);
  assert.equal(result.verified, true);
  assert.ok(result.orders > 0);
  await assert.rejects(
    () => verifiedBackup(process.env.DB_PATH!, target),
    /EEXIST/,
  );
  const restoredResult = await verifiedBackup(target, restored);
  assert.equal(restoredResult.orders, result.orders);
  const copy = new DatabaseSync(restored, { readOnly: true });
  try {
    assert.equal(A.integrity(copy).ok, true);
  } finally {
    copy.close();
  }
});

test("kod współdzielony przez różne SKU wymaga jednoznacznego symbolu", () => {
  const p = product(),
    duplicate = product();
  db()
    .prepare("UPDATE sgt_towar SET ean=? WHERE tw_id=?")
    .run(`590${p.twId}`, duplicate.twId);
  let o = action(order(p.sku, 1), "allocate");
  o = action(o, "pick-start", { tote: `BOX-${o.id}` }, picker);
  assert.throws(
    () =>
      action(
        o,
        "pick",
        {
          allocationId: o.allocations[0].id,
          bin: "A01-01-02",
          barcode: `590${p.twId}`,
          quantity: 1,
        },
        picker,
      ),
    /niejednoznaczny/,
  );
  o = action(
    o,
    "pick",
    {
      allocationId: o.allocations[0].id,
      bin: "A01-01-02",
      barcode: p.sku,
      quantity: 1,
    },
    picker,
  );
  assert.equal(o.status, "picked");
});

test("import partii jest atomowy, rozpoznaje duplikaty i rozdziela kanały", () => {
  const p = product();
  const item = {
    reference: "BATCH-01",
    channel: "sklep",
    dueAt: new Date().toISOString(),
    lines: [{ sku: p.sku, quantity: 1 }],
  };
  assert.throws(
    () =>
      W.importOrders(admin, randomUUID(), {
        orders: [
          item,
          {
            ...item,
            reference: "BATCH-02",
            lines: [{ sku: "BRAK-SKU", quantity: 1 }],
          },
        ],
      }),
    /brak kartoteki/,
  );
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_order WHERE reference='BATCH-01'")
      .get()?.n,
    0,
  );
  const first = W.importOrders(admin, randomUUID(), {
    orders: [item, { ...item, channel: "allegro" }],
  });
  assert.equal(first.created, 2);
  const repeat = W.importOrders(admin, randomUUID(), { orders: [item] });
  assert.equal(repeat.existing, 1);
  assert.throws(
    () =>
      W.importOrders(admin, randomUUID(), {
        orders: [{ ...item, lines: [{ sku: p.sku, quantity: 2 }] }],
      }),
    /inną treścią/,
  );
});

test("zbiorcza rezerwacja nie blokuje poprawnego zamówienia przez brak w innym", () => {
  const p = product(1),
    a = order(p.sku, 2),
    b = order(p.sku, 1);
  const key = randomUUID(),
    payload = {
      orders: [
        { id: a.id, version: a.version },
        { id: b.id, version: b.version },
      ],
    };
  const result = W.releaseBatch(admin, key, payload);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[1].ok, true);
  assert.equal(W.getOrder(a.id).status, "new");
  assert.equal(W.getOrder(b.id).status, "allocated");
  assert.deepEqual(W.releaseBatch(admin, key, payload), result);
  assert.equal(A.integrity().ok, true);
});

test("usunięta kartoteka ERP nie ukrywa fizycznego zapasu ani jego ruchów", () => {
  const p = product(5);
  db().prepare("DELETE FROM sgt_towar WHERE tw_id=?").run(p.twId);
  const inventory = W.inventory({ q: p.sku });
  assert.equal(inventory.total, 1);
  assert.equal(inventory.rows[0].on_hand, 5);
  assert.equal(inventory.rows[0].active, 0);
  W.changeStock(admin, randomUUID(), {
    action: "transfer",
    twId: p.twId,
    bin: "A01-01-02",
    target: "B01-01-02",
    quantity: 5,
    reason: "Wycofana kartoteka",
  });
  assert.equal(A.integrity().ok, true);
});

test("wielopaczkowa wysyłka jest atomowa; ponowny numer paczki nie zamyka zamówienia", () => {
  const p = product();
  let o = pick(order(p.sku, 1));
  o = action(o, "pack-start", { tote: o.tote }, packer);
  o = action(o, "pack", { barcode: p.sku, quantity: 1 }, packer);
  const shipment = {
    carrier: "MULTI",
    tracking: "BOX-1",
    weightG: 500,
    extraParcels: [{ carrier: "MULTI", tracking: "BOX-1", weightG: 600 }],
  };
  assert.throws(() => action(o, "ship", shipment, packer), /już użyty/);
  assert.equal(W.getOrder(o.id).shipments.length, 0);
  assert.equal(W.getOrder(o.id).status, "packed");
  o = action(
    o,
    "ship",
    {
      ...shipment,
      extraParcels: [{ carrier: "MULTI", tracking: "BOX-2", weightG: 600 }],
    },
    packer,
  );
  assert.equal(o.shipments.length, 2);
  assert.equal(o.shipments[1].package_no, 2);
});
