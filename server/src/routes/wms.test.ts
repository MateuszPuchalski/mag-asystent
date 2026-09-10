import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";

process.env.DB_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "wertis-wms-api-")),
  "wms.db",
);
process.env.LOG_LEVEL = "silent";
process.env.WMS_SELLASIST_ENABLED = '0';
let app: FastifyInstance;
let adminToken: string, workerToken: string;
before(async () => {
  const { buildApp } = await import("../index.js");
  const { createUser } = await import("../services/users.js");
  const { zaloguj } = await import("../services/auth.js");
  const { db } = await import("../db/db.js");
  createUser("Biuro", "admin", "biuro", "haslo-testowe");
  createUser("Magazyn", "magazynier", "hala", "haslo-testowe");
  adminToken = zaloguj("biuro", "haslo-testowe", null)!.token;
  workerToken = zaloguj("hala", "haslo-testowe", null)!.token;
  db()
    .prepare(
      "INSERT INTO sgt_towar(tw_id,symbol,nazwa,ean) VALUES (1,'NOZ-01','Nóż kosiarki','59001')",
    )
    .run();
  app = await buildApp();
});
after(async () => {
  await app?.close();
});
const headers = () => ({
  "x-session": adminToken,
  "idempotency-key": randomUUID(),
});
test("WMS wymaga sesji; raporty, import i spis wymagają biura", async () => {
  for (const url of [
    "/api/wms/orders",
    "/api/wms/orders/1",
    "/api/wms/inventory",
    "/api/wms/bins",
    "/api/wms/waves",
    "/api/wms/waves/1",
    "/api/wms/analytics",
    "/api/wms/integrity",
    "/api/wms/sellasist",
  ])
    assert.equal(
      (await app.inject({ method: "GET", url })).statusCode,
      401,
      url,
    );
  for (const url of [
    "/api/wms/analytics",
    "/api/wms/analytics/csv",
    "/api/wms/sellasist",
    "/api/wms/integrity",
    "/api/wms/reconciliation",
    "/api/wms/shipments",
    "/api/wms/movements?twId=1",
  ])
    assert.equal(
      (
        await app.inject({
          method: "GET",
          url,
          headers: { "x-session": workerToken },
        })
      ).statusCode,
      403,
      url,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wms/orders",
        headers: { "x-session": workerToken },
        payload: {},
      })
    ).statusCode,
    403,
  );
  for (const url of ["/api/wms/import", "/api/wms/release", "/api/wms/bins"]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { "x-session": workerToken },
          payload: {},
        })
      ).statusCode,
      403,
      url,
    );
  }
});
test("pełna trasa HTTP: zapis, idempotencja, odczyt, konflikt i brak ujawnienia SQL", async () => {
  const h = headers();
  const payload = {
    reference: "ORDER-HTTP",
    dueAt: "2026-09-12T12:00:00Z",
    lines: [{ sku: "NOZ-01", quantity: 2 }],
  };
  const first = await app.inject({
    method: "POST",
    url: "/api/wms/orders",
    headers: h,
    payload,
  });
  assert.equal(first.statusCode, 200, first.body);
  const retry = await app.inject({
    method: "POST",
    url: "/api/wms/orders",
    headers: h,
    payload,
  });
  assert.deepEqual(retry.json(), first.json());
  const conflict = await app.inject({
    method: "POST",
    url: "/api/wms/orders",
    headers: h,
    payload: { ...payload, reference: "OTHER" },
  });
  assert.equal(conflict.statusCode, 409);
  const detail = await app.inject({
    method: "GET",
    url: `/api/wms/orders/${first.json().id}`,
    headers: h,
  });
  assert.equal(detail.json().reference, "ORDER-HTTP");
  const missing = await app.inject({
    method: "GET",
    url: "/api/wms/orders/999999",
    headers: h,
  });
  assert.equal(missing.statusCode, 404);
  assert.doesNotMatch(missing.body, /SELECT|stack|sqlite/i);
});
test("walidacja odrzuca złe identyfikatory, ilości, filtry i brak klucza ponowienia", async () => {
  for (const url of [
    "/api/wms/orders/NaN",
    "/api/wms/orders?limit=1000000",
    "/api/wms/analytics?days=-1",
    "/api/wms/inventory?offset=-1",
  ])
    assert.equal(
      (await app.inject({ method: "GET", url, headers: headers() })).statusCode,
      400,
      url,
    );
  const payload = {
    action: "receive",
    twId: 1,
    bin: "A01-01-02",
    quantity: 1,
    reason: "PZ test",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wms/inventory",
        headers: { "x-session": adminToken },
        payload,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wms/inventory",
        headers: headers(),
        payload: { ...payload, quantity: 0.1 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/wms/inventory",
        headers: headers(),
        payload,
      })
    ).statusCode,
    200,
  );
});
test("wyszukiwanie traktuje znaki SQL jak dane, statyki WMS dostępne w biurze", async () => {
  const result = await app.inject({
    method: "GET",
    url: "/api/wms/orders?q=" + encodeURIComponent("' OR 1=1 --"),
    headers: headers(),
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().total, 0);
  for (const url of ["/biuro/wms.js", "/biuro/wms.css"])
    assert.equal((await app.inject({ method: "GET", url })).statusCode, 200);
  const { analytics } = await import("../services/wms-analytics.js");
  assert.doesNotThrow(
    () => analytics({}),
    "raport pustego magazynu po odrzuconych żądaniach",
  );
  const csv = await app.inject({
    method: "GET",
    url: "/api/wms/analytics/csv",
    headers: headers(),
  });
  assert.equal(csv.statusCode, 200);
  assert.match(String(csv.headers["content-type"]), /text\/csv/);
});
