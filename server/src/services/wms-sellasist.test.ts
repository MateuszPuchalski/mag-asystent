import { before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-sellasist-")),
  "test.db",
);
process.env.WMS_SELLASIST_ENABLED = "0";
let W: typeof import("./wms.js"),
  S: typeof import("./wms-sellasist.js"),
  C: typeof import("../adapters/sellasist-wms.js");
let db: typeof import("../db/db.js").db;
let actor: import("./wms.js").Actor;
let sequence = 0;
before(async () => {
  W = await import("./wms.js");
  S = await import("./wms-sellasist.js");
  C = await import("../adapters/sellasist-wms.js");
  ({ db } = await import("../db/db.js"));
  const { createUser } = await import("./users.js");
  const u = createUser(
    "Integracja testowa",
    "biuro",
    "integration-test",
    "temporary-test-password",
  );
  actor = { id: u.userId, name: u.name, role: u.role };
});

function setup() {
  const seq = ++sequence,
    sku = `SA-SKU-${seq}`;
  const settings = C.sellasistSettingsSchema.parse({
    account: `wms-test-${seq}`,
    apiKey: "secret-test-api-key",
    userId: actor.id,
    readyStatuses: [10],
    shippedStatus: 20,
  });
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa) VALUES (?,?,?)")
    .run(seq, sku, "Część testowa");
  W.changeStock(actor, randomUUID(), {
    action: "receive",
    twId: seq,
    bin: "A01-01-01",
    quantity: 100,
    reason: "Spis testowy",
  });
  const source = C.sourceOrder.parse({
    id: 100,
    status: { id: 10 },
    date: "2026-09-11 12:00:00",
    deadline: "2026-09-15",
    carts: [{ symbol: sku, quantity: 2 }],
    tracking_number: `TRACK-${seq}`,
  });
  const records = new Map([[source.id, source]]);
  const calls: { url: URL; method: string; body: unknown }[] = [];
  const switches = {
    losePut: false,
    rateLimit: false,
    block: null as Promise<void> | null,
  };
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      method = init?.method || "GET";
    assert.equal(url.origin, `https://${settings.account}.sellasist.pl`);
    assert.equal(new Headers(init?.headers).get("apikey"), settings.apiKey);
    assert.equal(init?.redirect, "error");
    if (method === "GET")
      assert.equal(new Headers(init?.headers).get("content-type"), null);
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (switches.block) await switches.block;
    if (switches.rateLimit)
      return new Response("", {
        status: 429,
        headers: { "retry-after": "120" },
      });
    if (url.pathname === "/api/v1/orders")
      return Response.json(
        [...records.values()]
          .filter(
            (o) =>
              o.status.id === Number(url.searchParams.get("status_id")) &&
              o.id > Number(url.searchParams.get("from_id")),
          )
          .sort((a, b) => a.id - b.id)
          .slice(0, 100)
          .map((o) => ({ id: o.id })),
      );
    const id = Number(url.pathname.split("/").at(-1)),
      record = records.get(id);
    if (!record) return new Response("", { status: 404 });
    if (method === "PUT") {
      const payload = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(payload).sort(), [
        "send_status_to_external",
        "status",
      ]);
      assert.equal(payload.send_status_to_external, false);
      record.status.id = payload.status;
      if (switches.losePut) {
        switches.losePut = false;
        throw new Error("Lost response after commit");
      }
      return Response.json({ message: "success", id });
    }
    return Response.json(record);
  };
  const client = new C.SellasistClient(settings, transport);
  const linked = () =>
    db()
      .prepare(
        "SELECT * FROM wms_sellasist_link WHERE account=? AND external_id=100",
      )
      .get(settings.account)!;
  return { settings, source, records, calls, switches, client, linked, sku };
}

test("konfiguracja jest domyślnie wyłączona, odrzuca obcy host i nie ujawnia klucza", () => {
  assert.equal(C.sellasistSettings({}), null);
  assert.throws(
    () =>
      C.sellasistSettings({
        WMS_SELLASIST_ENABLED: "1",
        WMS_SELLASIST_ACCOUNT: "shop.evil.test",
        WMS_SELLASIST_API_KEY: "sensitive-value",
      }),
    (e) => e instanceof Error && !e.message.includes("sensitive-value"),
  );
  const t = setup();
  assert.throws(() =>
    C.sellasistSettingsSchema.parse({ ...t.settings, account: "shop/../evil" }),
  );
  const raw = {
    ...t.source,
    bill_address: { name: "Private customer" },
    shipment_address: { phone: "123" },
    comment: "private note",
  };
  const parsed = C.sourceOrder.parse(raw);
  assert.equal("bill_address" in parsed, false);
  assert.equal("shipment_address" in parsed, false);
  assert.equal("comment" in parsed, false);
  assert.equal(
    JSON.stringify(S.sellasistStatus(t.settings)).includes(t.settings.apiKey),
    false,
  );
});

test("terminy respektują czas Warszawy, weekend i jawny deadline; złe ilości nie przechodzą", () => {
  const t = setup();
  assert.equal(
    C.mapSellasistOrder({ ...t.source, deadline: "2026-07-23" }, t.settings)
      .dueAt,
    "2026-07-23T12:00:00.000Z",
  );
  assert.equal(
    C.mapSellasistOrder({ ...t.source, deadline: "2026-12-01" }, t.settings)
      .dueAt,
    "2026-12-01T13:00:00.000Z",
  );
  assert.equal(
    C.mapSellasistOrder({ ...t.source, deadline: null }, t.settings).dueAt,
    "2026-09-14T12:00:00.000Z",
  );
  assert.throws(
    () =>
      C.mapSellasistOrder({ ...t.source, deadline: "2026-02-30" }, t.settings),
    /data/,
  );
  for (const quantity of [0, -1, 1.5])
    assert.throws(() =>
      C.sourceOrder.parse({
        ...t.source,
        carts: [{ symbol: t.sku, quantity }],
      }),
    );
});

test("import jest trwały po przerwaniu między zamówieniem i powiązaniem; jedna zła pozycja nie blokuje sąsiada", async () => {
  const t = setup();
  t.records.set(101, {
    ...t.source,
    id: 101,
    carts: [{ symbol: "UNKNOWN-SKU", quantity: 1 }],
  });
  t.records.set(102, { ...t.source, id: 102 });
  db()
    .exec(`CREATE TRIGGER wms_test_link_failure BEFORE INSERT ON wms_sellasist_link
    WHEN NEW.external_id=100 BEGIN SELECT RAISE(ABORT,'Test crash after import'); END`);
  await S.syncSellasist(t.settings, t.client);
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_order WHERE channel=?")
      .get(`Sellasist/${t.settings.account}`)!.n,
    2,
  );
  db().exec("DROP TRIGGER wms_test_link_failure");
  await S.syncSellasist(t.settings, t.client);
  assert.equal(
    db()
      .prepare("SELECT count(*) AS n FROM wms_order WHERE channel=?")
      .get(`Sellasist/${t.settings.account}`)!.n,
    2,
  );
  assert.ok(t.linked());
  const status = S.sellasistStatus(t.settings);
  assert.equal(status.issues!.length, 1);
  assert.equal(status.issues![0].external_id, 101);
});

test("zmiana koszyka i wycofanie statusu w sklepie wstrzymują pracę bez nadpisania pobranych ilości", async () => {
  const t = setup();
  await S.syncSellasist(t.settings, t.client);
  const id = Number(t.linked().order_id);
  t.source.carts[0].quantity = 3;
  await S.syncSellasist(t.settings, t.client);
  let order = W.getOrder(id);
  assert.match(order.hold_reason!, /zmieniono treść/);
  assert.equal(order.lines[0].quantity, 2);
  t.source.carts = [
    { symbol: t.sku.toLowerCase(), quantity: 1 },
    { symbol: t.sku, quantity: 1 },
  ];
  await S.syncSellasist(t.settings, t.client);
  assert.equal(S.sellasistStatus(t.settings).issues!.length, 0);
  order = W.actOnOrder(actor, randomUUID(), id, {
    action: "resume",
    version: order.version,
    reason: "Źródło poprawione",
  });
  t.source.status.id = 30;
  await S.syncSellasist(t.settings, t.client);
  assert.match(W.getOrder(id).hold_reason!, /status 30/);
});

test("429 odkłada cały cykl, a dzierżawa wyklucza drugi równoległy proces", async () => {
  const t = setup();
  t.switches.rateLimit = true;
  await S.syncSellasist(t.settings, t.client);
  const count = t.calls.length;
  assert.deepEqual(await S.syncSellasist(t.settings, t.client), {
    skipped: true,
  });
  assert.equal(t.calls.length, count);
  assert.ok(
    Number(S.sellasistStatus(t.settings).state!.retry_at) > Date.now() + 110000,
  );
  db()
    .prepare("UPDATE wms_sellasist_state SET retry_at=0 WHERE account=?")
    .run(t.settings.account);
  t.switches.rateLimit = false;
  let release!: () => void;
  t.switches.block = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = S.syncSellasist(t.settings, t.client);
  assert.deepEqual(await S.syncSellasist(t.settings, t.client), {
    skipped: true,
  });
  release();
  await first;
  assert.ok(t.linked());
});

test("jawne uzgodnienie zmiany w WMS aktualizuje powiązanie i usuwa problem, zachowując wstrzymanie", async () => {
  const t = setup();
  await S.syncSellasist(t.settings, t.client);
  t.source.carts[0].quantity = 3;
  await S.syncSellasist(t.settings, t.client);
  const problem = S.sellasistStatus(t.settings).issues![0];
  assert.ok(problem.proposal);
  assert.equal(problem.proposal.order.lines[0].quantity, 3);
  const order = W.getOrder(Number(t.linked().order_id)),
    mapped = C.mapSellasistOrder(t.source, t.settings);
  W.actOnOrder(actor, randomUUID(), order.id, {
    action: "amend",
    version: order.version,
    lines: mapped.lines,
    dueAt: mapped.dueAt,
    priority: mapped.priority,
    reason: "Uzgodniono zmianę klienta",
  });
  await S.syncSellasist(t.settings, t.client);
  assert.equal(S.sellasistStatus(t.settings).issues!.length, 0);
  assert.ok(W.getOrder(order.id).hold_reason);
});

test("ręczna zmiana wyłącznie w WMS również wymaga uzgodnienia ze sklepem", async () => {
  const t = setup();
  await S.syncSellasist(t.settings, t.client);
  const order = W.getOrder(Number(t.linked().order_id));
  W.actOnOrder(actor, randomUUID(), order.id, {
    action: "amend",
    version: order.version,
    lines: [{ sku: t.sku, quantity: 3 }],
    dueAt: order.due_at,
    priority: order.priority,
    reason: "Błędna zmiana lokalna",
  });
  await S.syncSellasist(t.settings, t.client);
  assert.match(W.getOrder(order.id).hold_reason!, /Uzgodnij/);
  assert.equal(
    S.sellasistStatus(t.settings).issues![0].proposal!.order.lines[0].quantity,
    2,
  );
});

function packed(t: ReturnType<typeof setup>) {
  let order = W.getOrder(Number(t.linked().order_id));
  const act = (action: string, extra = {}) => {
    order = W.actOnOrder(actor, randomUUID(), order.id, {
      action,
      version: order.version,
      ...extra,
    });
  };
  act("allocate");
  act("pick-start", { tote: `SA-BOX-${order.id}` });
  const allocation = order.allocations[0];
  act("pick", {
    allocationId: allocation.id,
    bin: allocation.bin,
    barcode: t.sku,
    quantity: 2,
  });
  act("pack-start", { tote: order.tote });
  act("pack", { barcode: t.sku, quantity: 2 });
  return order;
}

async function ship(t: ReturnType<typeof setup>) {
  const order = packed(t),
    key = randomUUID(),
    input = {
      action: "ship",
      version: order.version,
      carrier: "DPD",
      tracking: t.source.tracking_number!,
      weightG: 500,
    };
  await S.verifySellasistShipment(
    actor,
    key,
    order.id,
    input,
    t.settings,
    t.client,
  );
  return W.actOnOrder(actor, key, order.id, input);
}

test("utrata odpowiedzi po zmianie statusu nie wysyła ponownie; błędny numer listu zatrzymuje eksport", async () => {
  const t = setup();
  t.source.source = "allegro";
  await S.syncSellasist(t.settings, t.client);
  await ship(t);
  t.switches.losePut = true;
  await S.syncSellasist(t.settings, t.client);
  assert.equal(t.source.status.id, 20);
  assert.equal(t.linked().exported_at, null);
  db()
    .prepare("UPDATE wms_sellasist_state SET retry_at=0 WHERE account=?")
    .run(t.settings.account);
  await S.syncSellasist(t.settings, t.client);
  assert.ok(t.linked().exported_at);
  assert.equal(t.calls.filter((c) => c.method === "PUT").length, 1);
  const analytics = await import("./wms-analytics.js");
  assert.equal(
    analytics
      .analytics({})
      .channels.find(
        (c) => c.channel === `Sellasist/${t.settings.account}/allegro`,
      )?.shipped,
    1,
  );
  const wrong = setup();
  await S.syncSellasist(wrong.settings, wrong.client);
  await ship(wrong);
  wrong.source.tracking_number = "OTHER-ORDER-LABEL";
  await S.syncSellasist(wrong.settings, wrong.client);
  assert.equal(wrong.calls.filter((c) => c.method === "PUT").length, 0);
  assert.equal(wrong.linked().exported_at, null);
  assert.match(
    String(S.sellasistStatus(wrong.settings).issues![0].message),
    /Numery paczek/,
  );
});

test("przed fizyczną wysyłką numer paczki i treść są sprawdzane; dowód nie pasuje do zmienionego żądania", async () => {
  const t = setup();
  await S.syncSellasist(t.settings, t.client);
  const order = packed(t),
    key = randomUUID(),
    input = {
      action: "ship",
      version: order.version,
      carrier: "DPD",
      tracking: t.source.tracking_number!,
      weightG: 500,
    };
  assert.throws(
    () => W.actOnOrder(actor, key, order.id, input),
    /potwierdź zgodność/,
  );
  await assert.rejects(
    () =>
      S.verifySellasistShipment(
        actor,
        key,
        order.id,
        { ...input, tracking: "WRONG" },
        t.settings,
        t.client,
      ),
    /Numery paczek/,
  );
  assert.equal(W.getOrder(order.id).status, "packed");
  await S.verifySellasistShipment(
    actor,
    key,
    order.id,
    input,
    t.settings,
    t.client,
  );
  assert.throws(
    () => W.actOnOrder(actor, key, order.id, { ...input, weightG: 999 }),
    /potwierdź zgodność/,
  );
  const result = W.actOnOrder(actor, key, order.id, input);
  assert.equal(result.status, "shipped");
  await S.verifySellasistShipment(actor, key, order.id, input, null, null);
  assert.equal(W.actOnOrder(actor, key, order.id, input).status, "shipped");
});

test("1500 zamówień przechodzi przez stronicowanie; stary numer dopuszczony później nie ginie", async () => {
  const t = setup();
  t.records.clear();
  for (let id = 1; id <= 1500; id++)
    t.records.set(id, { ...t.source, id, status: { id: id === 1 ? 30 : 10 } });
  for (let cycle = 0; cycle < 15; cycle++)
    await S.syncSellasist(t.settings, t.client);
  const count = () =>
    Number(
      db()
        .prepare("SELECT count(*) AS n FROM wms_sellasist_link WHERE account=?")
        .get(t.settings.account)!.n,
    );
  assert.equal(count(), 1499);
  t.records.get(1)!.status.id = 10;
  await S.syncSellasist(t.settings, t.client);
  assert.equal(count(), 1500);
  await S.syncSellasist(t.settings, t.client);
  assert.equal(count(), 1500);
  assert.equal(S.sellasistStatus(t.settings).issues!.length, 0);
});

test("niezgodne przesyłki nie blokują eksportu kolejnych zamówień", async () => {
  const t = setup();
  t.records.clear();
  for (let id = 100; id < 126; id++)
    t.records.set(id, {
      ...t.source,
      id,
      status: { id: 10 },
      tracking_number: `FAIR-${t.settings.account}-${id}`,
    });
  await S.syncSellasist(t.settings, t.client);
  for (const source of t.records.values()) {
    const current = {
      ...t,
      source,
      linked: () =>
        db()
          .prepare(
            "SELECT * FROM wms_sellasist_link WHERE account=? AND external_id=?",
          )
          .get(t.settings.account, source.id)!,
    };
    await ship(current);
    if (source.id < 125) source.tracking_number = "OTHER-LABEL";
  }
  await S.syncSellasist(t.settings, t.client);
  assert.equal(
    db()
      .prepare(
        "SELECT count(*) AS n FROM wms_sellasist_link WHERE account=? AND exported_at IS NOT NULL",
      )
      .get(t.settings.account)!.n,
    0,
  );
  await S.syncSellasist(t.settings, t.client);
  assert.ok(
    db()
      .prepare(
        "SELECT exported_at FROM wms_sellasist_link WHERE account=? AND external_id=125",
      )
      .get(t.settings.account)!.exported_at,
  );
});
