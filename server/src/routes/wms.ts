import type { FastifyInstance } from "fastify";
import * as Carts from "../services/wms-carts.js";
import * as StockWork from "../services/wms-stock-work.js";
import * as Inbound from "../services/wms-inbound.js";
import * as Handoff from "../services/wms-dispatch.js";
import { ZodError, z } from "zod";
import { sesjaZadania } from "../context.js";
import {
  actOnOrder,
  changeStock,
  previewStockBatch,
  importStockBatch,
  configureBin,
  listBins,
  createWave,
  getWave,
  listWaves,
  pickWave,
  createOrder,
  getOrder,
  importOrders,
  inventory,
  listOrders,
  manager,
  releaseBatch,
  WmsError,
  type Actor,
} from "../services/wms.js";
import {
  analytics,
  erpReconciliation,
  integrity,
} from "../services/wms-analytics.js";
import { db } from "../db/db.js";
import { wierszCsv, zbudujCsv } from "../services/csv.js";
import {
  dispatchRegister,
  dispatchCsv,
  dispatchToday,
} from "../services/wms-dispatch.js";

function actor(): Actor {
  const s = sesjaZadania();
  if (!s) throw new WmsError(401, "Zaloguj się ponownie");
  return { id: s.user.userId, name: s.user.name, role: s.user.role };
}
const orderId = (raw: string) =>
  z.coerce.number().int().positive().max(2_147_483_647).parse(raw);

export async function wmsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff");
  });
  // Enkapsulacja Fastify zachowuje dotychczasowe błędy pozostałych modułów.
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof WmsError)
      return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: "Sprawdź dane formularza",
        details: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: "Niepoprawne żądanie" });
    req.log.error({ err: error }, "WMS request failed");
    return reply
      .code(500)
      .send({ error: "Nie zapisano operacji. Ponów z tym samym kluczem" });
  });
  app.get("/api/wms/orders", async (req) => {
    actor();
    return listOrders(req.query);
  });
  app.get("/api/wms/handoffs", async (req) => {
    actor();
    return Handoff.handoffQueue(req.query);
  });
  app.get<{ Params: { id: string } }>("/api/wms/handoffs/:id", async (req) => {
    actor();
    return Handoff.getHandoff(orderId(req.params.id));
  });
  app.post("/api/wms/handoffs", async (req) =>
    Handoff.createHandoff(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  for (const [path, action] of Object.entries({
    scan: Handoff.scanHandoff,
    remove: Handoff.removeHandoff,
    close: Handoff.closeHandoff,
  }))
    app.post<{ Params: { id: string } }>(
      `/api/wms/handoffs/:id/${path}`,
      async (req) =>
        action(
          actor(),
          String(req.headers["idempotency-key"] ?? ""),
          orderId(req.params.id),
          req.body,
        ),
    );
  app.post<{ Params: { id: string } }>(
    "/api/wms/parcels/:id/correct",
    async (req) =>
      Handoff.correctParcel(
        actor(),
        String(req.headers["idempotency-key"] ?? ""),
        orderId(req.params.id),
        req.body,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/wms/orders/:id/reopen-packing",
    async (req) =>
      Handoff.reopenPacking(
        actor(),
        String(req.headers["idempotency-key"] ?? ""),
        orderId(req.params.id),
        req.body,
      ),
  );
  app.get<{ Params: { id: string } }>(
    "/api/wms/handoffs/:id/csv",
    async (req, reply) => {
      actor();
      return reply
        .type("text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="wms-przekazanie.csv"',
        )
        .send(Handoff.handoffCsv(orderId(req.params.id)));
    },
  );
  app.get("/api/wms/inbound", async (req) => {
    actor();
    return Inbound.listInbound(req.query);
  });
  app.get<{ Params: { id: string } }>("/api/wms/inbound/:id", async (req) => {
    actor();
    return Inbound.getInbound(orderId(req.params.id), req.query);
  });
  app.post("/api/wms/inbound", { bodyLimit: 1024 * 1024 }, async (req) =>
    Inbound.createInbound(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  for (const [path, action] of Object.entries({
    putaway: Inbound.putawayInbound,
    close: Inbound.closeInbound,
    reopen: Inbound.reopenInbound,
    reverse: Inbound.reverseInbound,
  }))
    app.post<{ Params: { id: string } }>(
      `/api/wms/inbound/:id/${path}`,
      async (req) =>
        action(
          actor(),
          String(req.headers["idempotency-key"] ?? ""),
          orderId(req.params.id),
          req.body,
        ),
    );
  app.get("/api/wms/carts", async () => Carts.listCarts(actor()));
  app.get<{ Params: { code: string } }>("/api/wms/carts/:code", async (req) =>
    Carts.getCart(actor(), req.params.code),
  );
  app.get<{ Params: { id: string } }>("/api/wms/cart-runs/:id", async (req) =>
    Carts.getCartRun(actor(), orderId(req.params.id)),
  );
  app.get("/api/wms/cart-analytics", async (req) =>
    Carts.cartAnalytics(actor(), req.query),
  );
  app.get("/api/wms/pick-route", async () => {
    manager(actor());
    return {
      rows: db()
        .prepare("SELECT * FROM wms_pick_route ORDER BY sequence,bin")
        .all(),
    };
  });
  const cartCommands = {
    "/api/wms/replenishments": StockWork.claimReplenishment,
    "/api/wms/reservation-repair": StockWork.repairReservations,
    "/api/wms/carts": Carts.configureCart,
    "/api/wms/cart-start": Carts.startCart,
    "/api/wms/cart-box-bind": Carts.bindCartBox,
    "/api/wms/cart-box-pack": Carts.packCartBox,
    "/api/wms/stations": Carts.configureStation,
    "/api/wms/pick-route": Carts.configurePickRoute,
    "/api/wms/pick-exceptions": Carts.reportPickException,
    "/api/wms/pick-exceptions/resolve": Carts.resolvePickException,
  };
  for (const [path, action] of Object.entries(cartCommands))
    app.post(path, { bodyLimit: 512 * 1024 }, async (req) =>
      action(actor(), String(req.headers["idempotency-key"] ?? ""), req.body),
    );
  const runCommands = {
    handoff: Carts.handoffCart,
    release: Carts.releaseCart,
    detach: Carts.detachCartBox,
    replace: Carts.replaceCartBox,
    takeover: Carts.takeoverCart,
  };
  for (const [path, action] of Object.entries(runCommands))
    app.post<{ Params: { id: string } }>(
      `/api/wms/cart-runs/:id/${path}`,
      async (req) =>
        action(
          actor(),
          String(req.headers["idempotency-key"] ?? ""),
          orderId(req.params.id),
          req.body,
        ),
    );
  app.get("/api/wms/stock-work", async (req) =>
    StockWork.stockWork(actor(), req.query),
  );
  for (const [path, action] of Object.entries({
    "/api/wms/replenishments/:id/complete": StockWork.completeReplenishment,
    "/api/wms/replenishments/:id/cancel": StockWork.cancelReplenishment,
    "/api/wms/stock-checks/:id/count": StockWork.countStockCheck,
  }))
    app.post<{ Params: { id: string } }>(path, async (req) =>
      action(
        actor(),
        String(req.headers["idempotency-key"] ?? ""),
        orderId(req.params.id),
        req.body,
      ),
    );
  app.get("/api/wms/waves", async (req) => listWaves(actor(), req.query));
  app.post("/api/wms/waves", async (req) =>
    createWave(actor(), String(req.headers["idempotency-key"] ?? ""), req.body),
  );
  app.get<{ Params: { id: string } }>("/api/wms/waves/:id", async (req) =>
    getWave(actor(), orderId(req.params.id)),
  );
  app.post<{ Params: { id: string } }>("/api/wms/waves/:id/pick", async (req) =>
    pickWave(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      orderId(req.params.id),
      req.body,
    ),
  );
  app.get<{ Params: { id: string } }>("/api/wms/orders/:id", async (req) => {
    actor();
    return getOrder(orderId(req.params.id));
  });
  app.post("/api/wms/orders", { bodyLimit: 128 * 1024 }, async (req) =>
    createOrder(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  app.post("/api/wms/import", { bodyLimit: 2 * 1024 * 1024 }, async (req) =>
    importOrders(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  app.post("/api/wms/release", async (req) =>
    releaseBatch(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/wms/orders/:id/actions",
    async (req) => {
      const user = actor(),
        key = String(req.headers["idempotency-key"] ?? ""),
        id = orderId(req.params.id);
      return actOnOrder(user, key, id, req.body);
    },
  );
  app.get("/api/wms/inventory", async (req) => {
    actor();
    return inventory(req.query);
  });
  app.get("/api/wms/bins", async (req) => {
    actor();
    return listBins(req.query);
  });
  app.post("/api/wms/bins", async (req) =>
    configureBin(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  app.post("/api/wms/inventory", async (req) =>
    changeStock(
      actor(),
      String(req.headers["idempotency-key"] ?? ""),
      req.body,
    ),
  );
  app.post(
    "/api/wms/inventory/preview",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req) => previewStockBatch(actor(), req.body),
  );
  app.post(
    "/api/wms/inventory/import",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req) =>
      importStockBatch(
        actor(),
        String(req.headers["idempotency-key"] ?? ""),
        req.body,
      ),
  );
  app.get("/api/wms/analytics", async (req) => {
    manager(actor());
    return analytics(req.query);
  });
  app.get("/api/wms/integrity", async () => {
    manager(actor());
    return integrity();
  });
  app.get<{ Querystring: { day?: string } }>("/api/wms/dispatch", async (req) =>
    dispatchRegister(actor(), { day: dispatchToday(), ...req.query }),
  );
  app.get<{ Querystring: { day?: string } }>(
    "/api/wms/dispatch/csv",
    async (req, reply) => {
      const csv = dispatchCsv(actor(), { day: dispatchToday(), ...req.query });
      return reply
        .type("text/csv; charset=utf-8")
        .header(
          "content-disposition",
          'attachment; filename="wms-rejestr-paczek.csv"',
        )
        .send(csv);
    },
  );
  app.get("/api/wms/reconciliation", async () => {
    manager(actor());
    return erpReconciliation();
  });
  app.get<{ Querystring: { after?: string } }>(
    "/api/wms/shipments",
    async (req) => {
      manager(actor());
      const after = z.coerce
        .number()
        .int()
        .min(0)
        .max(2_147_483_647)
        .parse(req.query.after ?? 0);
      const rows = db()
        .prepare(
          `SELECT s.*,o.reference,o.channel,coalesce(p.status,'legacy') AS dispatch_status,p.handed_at FROM wms_shipment s JOIN wms_order o ON o.id=s.order_id LEFT JOIN wms_parcel_state p ON p.shipment_id=s.id
      WHERE s.id>? ORDER BY s.id LIMIT 100`,
        )
        .all(after);
      return { rows, next: rows.length ? rows[rows.length - 1].id : after };
    },
  );
  app.get<{ Querystring: { twId?: string; before?: string } }>(
    "/api/wms/movements",
    async (req) => {
      manager(actor());
      const twId = orderId(req.query.twId ?? "0");
      const before = req.query.before
        ? orderId(req.query.before)
        : 2_147_483_647;
      return {
        rows: db()
          .prepare(
            "SELECT * FROM wms_movement WHERE tw_id=? AND id<? ORDER BY id DESC LIMIT 100",
          )
          .all(twId, before),
      };
    },
  );
  app.get("/api/wms/analytics/csv", async (req, reply) => {
    manager(actor());
    const a = analytics(req.query);
    const rows = [wierszCsv(["Dzień UTC", "Wysłane", "W terminie"], ";")];
    for (const r of a.daily)
      rows.push(wierszCsv([r.day, r.shipped, r.on_time], ";"));
    return reply
      .type("text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="wms-wysylki.csv"')
      .send(zbudujCsv(rows));
  });
}
