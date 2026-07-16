import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import * as inv from "../services/inventory.js";

export async function inventoryRoutes(app: FastifyInstance) {
  app.post("/api/inventory/sessions", async (req) => ({ sessionId: inv.createSession(userOf(req)) }));

  app.get<{ Params: { id: string } }>("/api/inventory/sessions/:id", async (req, reply) => {
    const s = inv.getSession(Number(req.params.id));
    if (!s) return reply.code(404).send({ error: "Brak sesji" });
    return s;
  });

  app.post<{ Params: { id: string }; Body: { location: string } }>(
    "/api/inventory/sessions/:id/scan",
    async (req, reply) => {
      const r = inv.scanLocation(Number(req.params.id), req.body.location, userOf(req));
      if ("error" in r) return reply.code(400).send(r);
      return r;
    }
  );

  app.post<{ Params: { id: string }; Body: { itemId: number; present: boolean; note?: string } }>(
    "/api/inventory/sessions/:id/mark",
    async (req, reply) => {
      const r = inv.markItem(req.body.itemId, req.body.present, req.body.note, userOf(req));
      if ("error" in r) return reply.code(400).send(r);
      return r;
    }
  );

  app.post<{ Params: { id: string }; Body: { location: string; twId: number } }>(
    "/api/inventory/sessions/:id/extra",
    async (req, reply) => {
      const r = inv.addExtra(Number(req.params.id), req.body.location, req.body.twId, userOf(req));
      if ("error" in r) return reply.code(400).send(r);
      return r;
    }
  );

  app.post<{ Params: { id: string } }>("/api/inventory/sessions/:id/close", async (req, reply) => {
    const r = inv.closeSession(Number(req.params.id), userOf(req));
    if ("error" in r) return reply.code(400).send(r);
    return r;
  });
}
