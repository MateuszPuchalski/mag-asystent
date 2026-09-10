import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import assert from "node:assert/strict";

// Próba nigdy nie używa skonfigurowanej bazy ani integracji produkcyjnych.
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-capacity-")),
  "capacity.db",
);
process.env.WERTIS_ENV_FILE = path.join(
  os.tmpdir(),
  "wms-capacity-no-env.local",
);
process.env.SGT_MODE = "seeded";
process.env.WMS_SELLASIST_ENABLED = '0';
process.env.LOG_LEVEL = "silent";
const { db } = await import("./db/db.js");
const { createUser } = await import("./services/users.js");
const { zaloguj } = await import("./services/auth.js");
const W = await import("./services/wms.js");
const A = await import("./services/wms-analytics.js");
const { buildApp } = await import("./index.js");
const password = randomUUID();
const u = createUser("Capacity test", "admin", "capacity", password);
const actor = { id: u.userId, name: u.name, role: u.role };
const token = zaloguj("capacity", password, "capacity")!.token;
const products = 5000,
  orders = 1500,
  concurrency = 16;
const d = db();
d.exec("BEGIN IMMEDIATE");
const insert = d.prepare(
  "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)",
);
for (let i = 1; i <= products; i++)
  insert.run(
    i,
    `SKU-${i}`,
    `Część kosiarki ${i}`,
    `590${String(i).padStart(10, "0")}`,
  );
d.exec("COMMIT");
for (let i = 1; i <= products; i++)
  W.changeStock(actor, randomUUID(), {
    action: "receive",
    twId: i,
    bin: "A01-01-02",
    quantity: 20,
    reason: "Capacity opening stock",
  });
const app = await buildApp();
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
if (!address || typeof address === "string")
  throw new Error("Missing server port");
const base = `http://127.0.0.1:${address.port}`;
const timings: number[] = [];
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();
const started = performance.now();
let next = 0,
  completed = 0;
type Detail = ReturnType<typeof W.getOrder>;
async function request(route: string, body?: unknown): Promise<Detail> {
  const start = performance.now();
  const r = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      "x-session": token,
      ...(body
        ? {
            "content-type": "application/json",
            "idempotency-key": randomUUID(),
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const value = await r.json();
  timings.push(performance.now() - start);
  assert.equal(r.status, 200, JSON.stringify(value));
  return value as Detail;
}
try {
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < orders) {
        const index = next++;
        const lines = Array.from({ length: 3 }, (_, i) => ({
          sku: `SKU-${index * 3 + i + 1}`,
          quantity: 1,
        }));
        let o = await request("/api/wms/orders", {
          reference: `CAP-${index}`,
          dueAt: new Date(Date.now() + 86_400_000).toISOString(),
          lines,
        });
        const action = async (input: Record<string, unknown>) => {
          o = await request(`/api/wms/orders/${o.id}/actions`, {
            version: o.version,
            ...input,
          });
        };
        await action({ action: "allocate" });
        await action({ action: "pick-start", tote: `TOTE-${index}` });
        for (const a of o.allocations) {
          const l = o.lines.find((l) => l.id === a.line_id)!;
          await action({
            action: "pick",
            allocationId: a.id,
            bin: a.bin,
            barcode: l.sku,
            quantity: a.quantity,
          });
        }
        await action({ action: "pack-start", tote: o.tote });
        for (const l of o.lines)
          await action({
            action: "pack",
            barcode: l.sku,
            quantity: l.quantity,
          });
        await action({
          action: "ship",
          carrier: "CAPACITY",
          tracking: `CAP-${index}`,
          weightG: 500,
        });
        assert.equal(o.status, "shipped");
        completed++;
        if (completed % 300 === 0)
          console.log(`Completed ${completed}/${orders}`);
        if (index % 30 === 0) {
          await request("/api/wms/orders?status=allocated");
          await request("/api/wms/inventory?q=SKU-4");
          await request("/api/wms/analytics?days=30");
        }
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  timings.sort((a, b) => a - b);
  const percentile = (p: number) =>
    Math.round(timings[Math.floor((timings.length - 1) * p)] * 100) / 100;
  const integrity = A.integrity();
  assert.equal(integrity.ok, true, JSON.stringify(integrity));
  const count = d
    .prepare("SELECT count(*) AS n FROM wms_order WHERE status='shipped'")
    .get();
  assert.equal(count?.n, orders);
  const stock = d.prepare("SELECT sum(on_hand) AS n FROM wms_stock").get();
  assert.equal(stock?.n, products * 20 - orders * 3);
  assert.equal(completed, orders);
  assert.ok(
    percentile(0.95) < 500,
    `HTTP p95 ${percentile(0.95)} ms exceeds 500 ms target`,
  );
  const report = {
    at: new Date().toISOString(),
    node: process.version,
    sqlite: process.versions.sqlite,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    products,
    orders,
    concurrency,
    requests: timings.length,
    elapsedSeconds: Math.round(elapsedMs / 10) / 100,
    ordersPerHour: Math.round((orders * 3600000) / elapsedMs),
    httpMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
      max: percentile(1),
    },
    eventLoopMaxMs: Math.round(loop.max / 1e6),
    integrity,
    limitations:
      "Localhost, synthetic 3-line orders, warm database, one API process. Excludes ERP, carrier, physical scanners and production hardware.",
  };
  const output = path.resolve(import.meta.dirname, "../../.wms-artifacts");
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, "capacity.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--history")) {
    console.log("Seeding 90 days of reporting history (135000 orders / 405000 lines)...");
    const historicalOrders = 90 * orders;
    const insertOrder = d.prepare(`INSERT INTO wms_order(reference,channel,status,due_at,created_at,updated_at,
      allocated_at,picked_at,packed_at,shipped_at) VALUES (?,?,'shipped',?,?,?,?,?,?,?)`);
    const insertLine = d.prepare(`INSERT INTO wms_line(order_id,tw_id,sku,name,quantity,picked,packed)
      VALUES (?,?,?,?,1,1,1)`);
    // Historia jest fixture raportowym. Fizyczny zapas zaczyna się od spisu
    // otwarcia próby i nie jest wyliczany z tych dawnych dokumentów.
    d.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 0; i < historicalOrders; i++) {
        const day = new Date(Date.now() - (1 + Math.floor(i / orders)) * 86_400_000).toISOString().slice(0,10);
        const shipped = `${day}T12:00:00.000Z`;
        const result = insertOrder.run(`HISTORY-${i}`, i % 2 ? "sklep" : "allegro",`${day}T16:00:00.000Z`,
          `${day}T08:00:00.000Z`,shipped,`${day}T09:00:00.000Z`,`${day}T10:00:00.000Z`,`${day}T11:00:00.000Z`,shipped);
        for (let j = 0; j < 3; j++) {
          const twId = (i * 3 + j) % products + 1;
          insertLine.run(result.lastInsertRowid,twId,`SKU-${twId}`,`Część kosiarki ${twId}`);
        }
      }
      d.exec("COMMIT");
    } catch(e) {d.exec("ROLLBACK");throw e;}
    const probes = ["/api/wms/analytics?days=90","/api/wms/analytics?days=30","/api/wms/orders?status=allocated",
      "/api/wms/inventory?q=SKU-4","/api/wms/reconciliation"];
    const results = [];
    for (const url of probes) {
      const start = performance.now();
      await request(url);
      results.push({url,milliseconds:Math.round((performance.now()-start)*100)/100});
    }
    assert.ok(results.every(r=>r.milliseconds<2000),JSON.stringify(results));
    const historyReport = {orders:orders+historicalOrders,lines:(orders+historicalOrders)*3,results,
      limitations:"Historical rows are synthetic reporting fixtures; the preceding 1500-order run exercises real write paths."};
    fs.writeFileSync(path.join(output,"history-capacity.json"),JSON.stringify(historyReport,null,2));
    console.log(JSON.stringify(historyReport,null,2));
  }
} finally {
  loop.disable();
  await app.close();
}
