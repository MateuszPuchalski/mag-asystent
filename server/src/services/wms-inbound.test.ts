import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.DB_PATH = path.join(
  mkdtempSync(path.join(tmpdir(), "wms-inbound-")),
  "test.db",
);
let I: typeof import("./wms-inbound.js"),
  W: typeof import("./wms.js"),
  A: typeof import("./wms-analytics.js"),
  db: typeof import("../db/db.js").db;
const admin = { id: 1, name: "Biuro", role: "admin" as const },
  worker = { id: 2, name: "Hala", role: "magazynier" as const };
let seq = 0;
before(async () => {
  I = await import("./wms-inbound.js");
  W = await import("./wms.js");
  A = await import("./wms-analytics.js");
  ({ db } = await import("../db/db.js"));
  for (const [bin, mode] of [
    ["PICK-1", "pick"],
    ["RES-1", "reserve"],
    ["QUAR-1", "quarantine"],
  ])
    W.configureBin(admin, randomUUID(), {
      bin,
      mode,
      version: 1,
      reason: "Przygotowanie lokalizacji",
    });
});
function delivery(expected = 5) {
  const twId = ++seq,
    sku = `IN-${twId}`;
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(twId, sku, "Część seeded", `590IN${twId}`);
  const payload = {
    reference: `PZ-${seq}`,
    supplier: "Dostawca seeded",
    lines: [{ sku, quantity: expected }],
  };
  const created = I.createInbound(admin, randomUUID(), payload);
  const doc = I.getInbound(created.id);
  return { doc, payload, twId, sku };
}
function put(
  doc: ReturnType<typeof I.getInbound>,
  quantity = 1,
  bin = "PICK-1",
) {
  return {
    lineId: doc.lines[0].id,
    version: doc.lines[0].version,
    barcode: doc.lines[0].sku,
    bin,
    quantity,
    disposition: "good" as const,
  };
}
test("oczekiwana dostawa nie zmienia zapasu; odłożenie częściowe tworzy zapas i trwałe ponowienie", () => {
  const { doc, payload, twId } = delivery();
  assert.equal(
    db().prepare("SELECT count(*) AS n FROM wms_stock WHERE tw_id=?").get(twId)!
      .n,
    0,
  );
  const before = db().prepare("SELECT total_changes() AS n").get()!.n;
  I.getInbound(doc.id);
  I.listInbound({});
  assert.equal(db().prepare("SELECT total_changes() AS n").get()!.n, before);
  assert.deepEqual(
    I.createInbound(admin, randomUUID(), {
      ...payload,
      reference: payload.reference.toLowerCase(),
    }),
    { id: doc.id, alreadyCreated: true },
  );
  assert.throws(
    () => I.createInbound(worker, randomUUID(), payload),
    /uprawnień/,
  );
  assert.throws(
    () =>
      I.createInbound(admin, randomUUID(), {
        ...payload,
        lines: [{ sku: payload.lines[0].sku, quantity: 6 }],
      }),
    /inną treść/,
  );
  const key = randomUUID(),
    body = put(doc, 2),
    result = I.putawayInbound(worker, key, doc.id, body);
  assert.deepEqual(I.putawayInbound(worker, key, doc.id, body), result);
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, body),
    /zmieniła się/,
  );
  const after = I.getInbound(doc.id);
  assert.equal(after.lines[0].received, 2);
  assert.equal(after.putaways.length, 1);
  assert.equal(W.inventory({ q: payload.lines[0].sku }).rows[0].on_hand, 2);
  assert.equal(after.closed_at, null);
  assert.equal(A.integrity().ok, true);
});
test("odbiór sprawdza dokument, SKU, istniejącą lokalizację i niejednoznaczny EAN", () => {
  const { doc } = delivery(),
    other = delivery();
  const body = put(doc);
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), other.doc.id, body),
    /nie należy/,
  );
  assert.throws(
    () =>
      I.putawayInbound(worker, randomUUID(), doc.id, {
        ...body,
        barcode: "OTHER",
      }),
    /Inny towar/,
  );
  assert.throws(
    () =>
      I.putawayInbound(worker, randomUUID(), doc.id, { ...body, bin: "TYPO" }),
    /Nieznana lokalizacja/,
  );
  db()
    .prepare("UPDATE sgt_towar SET ean=? WHERE tw_id=?")
    .run(doc.lines[0].barcode, other.twId);
  assert.throws(
    () =>
      I.putawayInbound(worker, randomUUID(), doc.id, {
        ...body,
        barcode: doc.lines[0].barcode,
      }),
    /niejednoznaczny/,
  );
  assert.equal(I.getInbound(doc.id).putaways.length, 0);
});
test("uszkodzenie trafia tylko do kwarantanny, a nadwyżka wymaga biura i powodu", () => {
  const { doc, sku } = delivery(2),
    body = put(doc, 1, "QUAR-1");
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, body),
    /kwarantanną/,
  );
  assert.throws(
    () =>
      I.putawayInbound(worker, randomUUID(), doc.id, {
        ...body,
        bin: "PICK-1",
        disposition: "damaged",
        reason: "Pęknięcie",
      }),
    /do kwarantanny/,
  );
  assert.throws(() =>
    I.putawayInbound(worker, randomUUID(), doc.id, {
      ...body,
      disposition: "damaged",
    }),
  );
  I.putawayInbound(worker, randomUUID(), doc.id, {
    ...body,
    disposition: "damaged",
    reason: "Pęknięte koło",
  });
  const next = I.getInbound(doc.id);
  assert.equal(next.lines[0].damaged, 1);
  assert.equal(W.inventory({ q: sku }).rows[0].available, 0);
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, put(next, 2)),
    /uprawnień/,
  );
  assert.throws(
    () => I.putawayInbound(admin, randomUUID(), doc.id, put(next, 2)),
    /uzasadnienia/,
  );
  I.putawayInbound(admin, randomUUID(), doc.id, {
    ...put(next, 2),
    reason: "Dostawca potwierdził nadwyżkę",
  });
  const full = I.getInbound(doc.id);
  assert.equal(full.lines[0].received, 3);
  I.closeInbound(worker, randomUUID(), doc.id, { version: full.version });
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, put(full)),
    /zamknięte/,
  );
});
test("zamknięcie niedoboru wymaga aktualnego podglądu i uzasadnienia biura", () => {
  const { doc } = delivery();
  assert.throws(
    () =>
      I.closeInbound(worker, randomUUID(), doc.id, {
        version: doc.version,
        reason: "Brak",
      }),
    /uprawnień/,
  );
  assert.throws(
    () => I.closeInbound(admin, randomUUID(), doc.id, { version: doc.version }),
    /Brakuje 5/,
  );
  I.putawayInbound(worker, randomUUID(), doc.id, put(doc));
  assert.throws(
    () =>
      I.closeInbound(admin, randomUUID(), doc.id, {
        version: doc.version,
        reason: "Brak",
      }),
    /zmieniło/,
  );
  const current = I.getInbound(doc.id),
    key = randomUUID(),
    body = { version: current.version, reason: "Dostawca nie dosyła" };
  const result = I.closeInbound(admin, key, doc.id, body);
  assert.equal(result.missing, 4);
  assert.deepEqual(I.closeInbound(admin, key, doc.id, body), result);
  assert.equal(I.listInbound({ closed: "1", q: doc.reference }).total, 1);
});
test("dokument nie może przyjąć się drugi raz przez import arkusza ani odwrotnie", () => {
  const { doc, sku } = delivery();
  const batch = {
    reference: doc.reference,
    mode: "receive" as const,
    rows: [{ sku, bin: "PICK-1", quantity: 5 }],
  };
  assert.throws(
    () => W.previewStockBatch(admin, batch),
    /obsługiwany w Przyjęciach/,
  );
  assert.throws(
    () =>
      W.importStockBatch(admin, randomUUID(), {
        ...batch,
        rows: [{ ...batch.rows[0], version: 1 }],
      }),
    /obsługiwany w Przyjęciach/,
  );
  const other = { ...batch, reference: randomUUID() };
  const preview = W.previewStockBatch(admin, other);
  W.importStockBatch(admin, randomUUID(), {
    ...other,
    rows: other.rows.map((r, i) => ({
      ...r,
      version: preview.rows[i].version,
    })),
  });
  assert.throws(
    () =>
      I.createInbound(admin, randomUUID(), {
        reference: other.reference,
        supplier: "Test",
        lines: [{ sku, quantity: 5 }],
      }),
    /zapisano już/,
  );
});
test("awaria po ruchu wycofuje zapas, dokument i audyt; ponowienie pozostaje możliwe", () => {
  const { doc, sku } = delivery();
  const key = randomUUID(),
    body = put(doc);
  db().exec(
    `CREATE TEMP TRIGGER inbound_fail BEFORE INSERT ON wms_inbound_putaway BEGIN SELECT RAISE(ABORT,'test failure'); END`,
  );
  try {
    assert.throws(
      () => I.putawayInbound(worker, key, doc.id, body),
      /test failure/,
    );
  } finally {
    db().exec("DROP TRIGGER inbound_fail");
  }
  assert.equal(I.getInbound(doc.id).lines[0].received, 0);
  assert.equal(W.inventory({ q: sku }).rows[0].on_hand, 0);
  assert.equal(
    db().prepare("SELECT 1 FROM wms_command WHERE key=?").get(key),
    undefined,
  );
  I.putawayInbound(worker, key, doc.id, body);
  assert.equal(A.integrity().ok, true);
});
test("SKU bez dotychczasowego zapasu można odłożyć, a dwa SKU nie blokują sobie wersji", () => {
  const first = delivery(),
    second = delivery();
  const doc = I.getInbound(
    I.createInbound(admin, randomUUID(), {
      reference: randomUUID(),
      supplier: "Wspólna dostawa",
      lines: [
        { sku: first.sku, quantity: 2 },
        { sku: second.sku, quantity: 2 },
      ],
    }).id,
  );
  const [one, two] = doc.lines;
  I.putawayInbound(worker, randomUUID(), doc.id, {
    ...put(doc),
    lineId: one.id,
    barcode: one.sku,
  });
  I.putawayInbound({ ...worker, id: 3 }, randomUUID(), doc.id, {
    ...put(doc),
    lineId: two.id,
    barcode: two.sku,
  });
  assert.equal(
    I.getInbound(doc.id).lines.reduce((n, l) => n + l.received, 0),
    2,
  );
  assert.equal(A.integrity().ok, true);
});
test("korekta jest ruchem kompensującym; zamknięty dokument wymaga jawnego ponownego otwarcia", () => {
  const { doc, sku } = delivery(2);
  const first = I.putawayInbound(worker, randomUUID(), doc.id, put(doc, 2));
  const filled = I.getInbound(doc.id);
  I.closeInbound(worker, randomUUID(), doc.id, { version: filled.version });
  const closed = I.getInbound(doc.id);
  assert.throws(
    () =>
      I.reopenInbound(worker, randomUUID(), doc.id, {
        version: closed.version,
        reason: "Korekta",
      }),
    /uprawnień/,
  );
  I.reopenInbound(admin, randomUUID(), doc.id, {
    version: closed.version,
    reason: "Błąd ilości na przyjęciu",
  });
  const current = I.getInbound(doc.id),
    key = randomUUID(),
    body = {
      putawayId: first.putawayId,
      version: current.version,
      barcode: sku,
      bin: "PICK-1",
      reason: "Przyjęto o sztukę za dużo",
    };
  const result = I.reverseInbound(admin, key, doc.id, body);
  assert.deepEqual(I.reverseInbound(admin, key, doc.id, body), result);
  const corrected = I.getInbound(doc.id);
  assert.equal(corrected.lines[0].received, 0);
  assert.ok(corrected.putaways[0].reversed_at);
  assert.throws(
    () =>
      I.reverseInbound(admin, randomUUID(), doc.id, {
        ...body,
        version: corrected.version,
      }),
    /już skorygowane/,
  );
  assert.equal(W.inventory({ q: sku }).rows[0].on_hand, 0);
  I.putawayInbound(worker, randomUUID(), doc.id, put(corrected, 1));
  assert.equal(A.integrity().ok, true);
});
test("korekta nie odbiera sztuk przydzielonych do zamówienia i nie zmienia rozliczenia przy odmowie", () => {
  const { doc, sku } = delivery(2);
  const first = I.putawayInbound(worker, randomUUID(), doc.id, put(doc, 2));
  const order = W.createOrder(admin, randomUUID(), {
    reference: randomUUID(),
    dueAt: new Date().toISOString(),
    lines: [{ sku, quantity: 1 }],
  });
  W.actOnOrder(admin, randomUUID(), order.id, {
    action: "allocate",
    version: order.version,
  });
  const current = I.getInbound(doc.id);
  assert.throws(
    () =>
      I.reverseInbound(admin, randomUUID(), doc.id, {
        putawayId: first.putawayId,
        version: current.version,
        barcode: sku,
        bin: "PICK-1",
        reason: "Korekta ilości",
      }),
    /Za mało/,
  );
  assert.equal(I.getInbound(doc.id).lines[0].received, 2);
  assert.equal(I.getInbound(doc.id).putaways[0].reversed_at, null);
  assert.equal(A.integrity().ok, true);
});
test("5000 SKU w dostawie: odczyt i wybór ostatniej pozycji bez generowania zapasu", () => {
  const insert = db().prepare(
    "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)",
  );
  const lines = Array.from({ length: 5000 }, (_, i) => ({
    sku: `SCALE-IN-${i}`,
    quantity: 1,
  }));
  db().exec("BEGIN");
  try {
    for (let i = 0; i < 5000; i++)
      insert.run(10000 + i, lines[i].sku, "Towar seeded", `SCALE-EAN-${i}`);
    db().exec("COMMIT");
  } catch (e) {
    db().exec("ROLLBACK");
    throw e;
  }
  const started = performance.now();
  const created = I.createInbound(admin, randomUUID(), {
    reference: "SCALE-IN-5000",
    supplier: "Test skali",
    lines,
  });
  const doc = I.getInbound(created.id);
  assert.equal(doc.lines.length, 5000);
  const snapshotChanges = db().prepare("SELECT total_changes() AS n").get()!.n;
  const page = I.getInboundCollector(created.id, { offset: 4950 });
  assert.equal(page.lines.length, 50);
  assert.equal(page.total, 5000);
  const scanned = I.getInboundCollector(created.id, {
    barcode: "SCALE-EAN-4999",
  });
  assert.equal(scanned.selected!.sku, "SCALE-IN-4999");
  assert.equal(scanned.summary.remaining, 5000);
  assert.equal(scanned.lines.length, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(scanned)) < 4096);
  assert.equal(
    db().prepare("SELECT total_changes() AS n").get()!.n,
    snapshotChanges,
  );
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_stock WHERE tw_id>=10000")
      .get()!.n,
    0,
  );
  const last = doc.lines.find((l) => l.sku === "SCALE-IN-4999")!;
  I.putawayInbound(worker, randomUUID(), doc.id, {
    ...put(doc),
    lineId: last.id,
    version: last.version,
    barcode: last.sku,
  });
  assert.equal(
    I.getInbound(doc.id).lines.find((l) => l.id === last.id)!.received,
    1,
  );
  assert.equal(A.integrity().ok, true);
  console.log(
    `Przyjęcie 5000 SKU: utworzenie, dwa odczyty i odłożenie ${Math.round(performance.now() - started)} ms`,
  );
});
test("kolektor po przyjęciu pokazuje świeżą wersję i nie wybiera obcej pozycji", () => {
  const { doc } = delivery();
  const other = delivery();
  const selected = I.getInboundCollector(doc.id, {
    lineId: doc.lines[0].id,
  }).selected!;
  I.putawayInbound(worker, randomUUID(), doc.id, put(doc, 2, "RES-1"));
  const fresh = I.getInboundCollector(doc.id, { barcode: selected.barcode! });
  assert.equal(fresh.selected!.received, 2);
  assert.equal(fresh.selected!.version, selected.version + 1);
  assert.equal(fresh.summary.remaining, 3);
  assert.throws(
    () => I.getInboundCollector(doc.id, { lineId: other.doc.lines[0].id }),
    /Części nie ma/,
  );
  assert.throws(
    () => I.getInboundCollector(doc.id, { barcode: "nieznany" }),
    /Części nie ma/,
  );
  assert.throws(() =>
    I.getInboundCollector(doc.id, {
      barcode: selected.sku,
      lineId: selected.id,
    }),
  );
});

test("kolizja EAN nie przeskakuje na inną część po pełnym policzeniu pierwszej", () => {
  const first = delivery(),
    second = delivery();
  db()
    .prepare("UPDATE sgt_towar SET ean='COLLISION-EAN' WHERE tw_id IN (?,?)")
    .run(first.twId, second.twId);
  const created = I.createInbound(admin, randomUUID(), {
    reference: `COLLISION-${seq}`,
    supplier: "Seeded",
    lines: [
      { sku: first.sku, quantity: 1 },
      { sku: second.sku, quantity: 1 },
    ],
  });
  const doc = I.getInbound(created.id);
  I.putawayInbound(worker, randomUUID(), doc.id, put(doc));
  assert.throws(
    () => I.getInboundCollector(doc.id, { barcode: "COLLISION-EAN" }),
    /kilka części/,
  );
  const chosen = I.getInboundCollector(doc.id, { barcode: doc.lines[0].sku });
  assert.equal(chosen.selected!.received, 1);
});
test("otwarte przeliczenie blokuje odłożenie na tę półkę bez utraty partii", () => {
  const { doc, twId } = delivery();
  db()
    .prepare(
      "INSERT INTO wms_stock_check(tw_id,bin,reason,created_at,user_id) VALUES (?,?,?,?,?)",
    )
    .run(
      twId,
      "PICK-1",
      "Nie zgadza się półka",
      new Date().toISOString(),
      admin.id,
    );
  assert.throws(
    () => I.putawayInbound(worker, randomUUID(), doc.id, put(doc)),
    /czeka na przeliczenie/,
  );
  assert.equal(I.getInbound(doc.id).lines[0].received, 0);
  I.putawayInbound(worker, randomUUID(), doc.id, put(doc, 1, "RES-1"));
  assert.equal(I.getInbound(doc.id).lines[0].received, 1);
});
