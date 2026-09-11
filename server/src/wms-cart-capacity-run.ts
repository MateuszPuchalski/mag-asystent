import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

// Ten test tworzy nową bazę; liczby szczytowe są scenariuszem, a nie importem danych klienta.
process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wms-cart-capacity-")),
  "test.db",
);
process.env.WERTIS_ENV_FILE = path.join(
  os.tmpdir(),
  "wms-cart-capacity-no-env.local",
);
process.env.SGT_MODE = "seeded";
process.env.ALLEGRO_MODE = "dev";
process.env.LOG_LEVEL = "silent";
const { db } = await import("./db/db.js");
const { createUser } = await import("./services/users.js");
const { zaloguj } = await import("./services/auth.js");
const W = await import("./services/wms.js");
const C = await import("./services/wms-carts.js");
const A = await import("./services/wms-analytics.js");
const { buildApp } = await import("./index.js");
const password = randomUUID();
const user = createUser(
  "Test wydajności wózków",
  "admin",
  "cart-capacity",
  password,
);
const actor = { id: user.userId, name: user.name, role: user.role };
const token = zaloguj("cart-capacity", password, null)!.token;
const skuCount = 5000,
  orderCount = 2000,
  concurrency = 8;
db().exec("BEGIN IMMEDIATE");
for (let i = 1; i <= skuCount; i++)
  db()
    .prepare("INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (?,?,?,?)")
    .run(i, `C-${i}`, "Część seeded", `590${String(i).padStart(10, "0")}`);
db().exec("COMMIT");
const rows = Array.from({ length: skuCount }, (_, i) => ({
  sku: `C-${i + 1}`,
  bin: `A-${String((i % 50) + 1).padStart(2, "0")}`,
  quantity: 100,
}));
const opening = {
  reference: "CART-CAPACITY-OPENING",
  mode: "receive" as const,
  rows,
};
W.importStockBatch(actor, randomUUID(), {
  ...opening,
  rows: W.previewStockBatch(actor, opening).rows.map(
    ({ sku, bin, quantity, version }) => ({ sku, bin, quantity, version }),
  ),
});
for (let offset = 0; offset < orderCount; offset += 200)
  W.importOrders(actor, randomUUID(), {
    orders: Array.from(
      { length: Math.min(200, orderCount - offset) },
      (_, index) => {
        const i = offset + index;
        return {
          reference: `CART-CAP-${i}`,
          channel: "seeded",
          priority: i % 3,
          dueAt: new Date(Date.now() + (i % 8) * 3600000).toISOString(),
          lines: Array.from({ length: (i % 3) + 1 }, (_, line) => ({
            sku: `C-${((i * 3 + line) % skuCount) + 1}`,
            quantity: 1,
          })),
        };
      },
    ),
  });
C.configureStation(actor, randomUUID(), {
  code: "PACK-CAP",
  name: "Stanowisko testowe",
  kind: "pack",
  active: true,
  version: 0,
});
for (let worker = 0; worker < concurrency; worker++) {
  const capacity = worker % 2 ? 20 : 30;
  C.configureCart(actor, randomUUID(), {
    code: `CAP-${worker}`,
    name: `Wózek ${worker}`,
    capacity,
    version: 0,
    boxes: Array.from({ length: capacity }, (_, i) => ({
      position: i + 1,
      barcode: `CAP-${worker}-BOX-${i + 1}`,
    })),
  });
}
const app = await buildApp();
await app.listen({ port: 0, host: "127.0.0.1" });
const address = app.server.address();
if (!address || typeof address === "string")
  throw new Error("Brak portu testu");
const base = `http://127.0.0.1:${address.port}`;
const timings: number[] = [],
  cartTimings: number[] = [];
const loop = monitorEventLoopDelay({ resolution: 20 });
let completed = 0,
  runs = 0;
async function request<T>(url: string, body?: unknown): Promise<T> {
  const start = performance.now();
  const response = await fetch(base + url, {
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
  });
  const result = await response.json();
  timings.push(performance.now() - start);
  if (!response.ok) throw new Error(`${url}: ${JSON.stringify(result)}`);
  return result as T;
}
const started = performance.now();
loop.enable();
try {
  await Promise.all(
    Array.from({ length: concurrency }, async (_, worker) => {
      for (;;) {
        const start = performance.now();
        const assigned = await request<ReturnType<typeof C.startCart>>(
          "/api/wms/cart-start",
          { barcode: `CAP-${worker}` },
        );
        cartTimings.push(performance.now() - start);
        if (!assigned.run) return;
        const run = assigned.run;
        runs++;
        let wave: ReturnType<typeof W.getWave> = run;
        while (wave.tasks.length) {
          const t = wave.tasks[0];
          wave = await request(`/api/wms/waves/${run.id}/pick`, {
            orderId: t.order_id,
            allocationId: t.allocation_id,
            version: t.version,
            bin: t.bin,
            barcode: t.sku,
            tote: t.tote,
            quantity: t.remaining,
          });
        }
        await request(`/api/wms/cart-runs/${run.id}/handoff`, {
          cart: run.cart_code,
          station: "PACK-CAP",
        });
        for (const a of run.assignments) {
          let o = await request<ReturnType<typeof W.getOrder>>(
            "/api/wms/cart-box-pack",
            { box: a.box_barcode, station: "PACK-CAP" },
          );
          for (const line of o.lines)
            o = await request(`/api/wms/orders/${o.id}/actions`, {
              action: "pack",
              version: o.version,
              barcode: line.sku,
              quantity: line.quantity,
            });
          await request(`/api/wms/orders/${o.id}/actions`, {
            action: "ship",
            version: o.version,
            carrier: "SEEDED",
            tracking: `CAP-TRACK-${o.id}`,
            weightG: 500,
          });
          completed++;
        }
        await request(`/api/wms/cart-runs/${run.id}/release`, {
          cart: run.cart_code,
        });
      }
    }),
  );
  const elapsedMs = performance.now() - started;
  loop.disable();
  const integrity = A.integrity();
  const shipped = Number(
    db()
      .prepare("SELECT count(*) AS n FROM wms_order WHERE status='shipped'")
      .get()!.n,
  );
  if (completed !== orderCount || shipped !== orderCount || !integrity.ok)
    throw new Error(
      `Niespójny wynik: ${completed}/${shipped}, ledger=${integrity.ok}`,
    );
  const stats = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: sorted.length,
      p50Ms: sorted[Math.floor(sorted.length * 0.5)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      p99Ms: sorted[Math.floor(sorted.length * 0.99)],
      maxMs: Math.max(...sorted),
    };
  };
  const result = {
    skuCount,
    orderCount,
    concurrency,
    completed,
    runs,
    elapsedMs,
    requests: stats(timings),
    cartAssignment: stats(cartTimings),
    eventLoopP95Ms: loop.percentile(95) / 1e6,
    integrity,
    cartAnalytics: C.cartAnalytics(actor, { days: 1 }),
    boundary:
      "Seeded HTTP test. 2000 orders is an explicit stress scenario above the observed 1690-order peak. SKU overlap and 1–3 lines/order are synthetic assumptions; elapsed time measures software throughput, not staff productivity.",
  };
  fs.mkdirSync(".wms-artifacts", { recursive: true });
  fs.writeFileSync(
    ".wms-artifacts/cart-capacity.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      completed,
      runs,
      elapsedMs,
      requests: result.requests,
      cartAssignment: result.cartAssignment,
      integrity: integrity.ok,
    }),
  );
} finally {
  loop.disable();
  await app.close();
}
