import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import {
  addOffDocument,
  closeSession,
  commitCart,
  confirmItem,
  createSession,
  getSession,
  listDocuments,
  removeFromCart,
  scanToCart,
  skipItem,
} from "../services/putaway.js";

export async function putawayRoutes(app: FastifyInstance) {
  // lista dokumentów FZ/PZ na MGP, 14 dni, z postępem sesji (spec §5.4)
  app.get("/api/putaway/documents", async () => ({ documents: listDocuments(14) }));

  // start/wznowienie sesji: { docId } | { mode: "all_mgp" }
  app.post<{ Body: { docId?: number; mode?: "all_mgp" } }>(
    "/api/putaway/sessions",
    async (req, reply) => {
      try {
        const id = createSession(req.body ?? {}, userOf(req));
        return { sessionId: id };
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
      }
    }
  );

  app.get<{ Params: { id: string } }>("/api/putaway/sessions/:id", async (req, reply) => {
    const s = getSession(Number(req.params.id));
    if (!s) return reply.code(404).send({ error: "Brak sesji" });
    return s;
  });

  // skan na wózek / dodanie spoza dokumentu
  app.post<{ Params: { id: string }; Body: { twId: number; offDocument?: boolean } }>(
    "/api/putaway/sessions/:id/cart",
    async (req) => {
      const sid = Number(req.params.id);
      const user = userOf(req);
      if (req.body.offDocument) return addOffDocument(sid, req.body.twId, user);
      return scanToCart(sid, req.body.twId, user);
    }
  );

  app.post<{ Params: { id: string }; Body: { itemId: number } }>(
    "/api/putaway/sessions/:id/cart/remove",
    async (req) => removeFromCart(req.body.itemId, userOf(req))
  );

  // potwierdzenie pozycji: towar + lokalizacja + qty (spec §5.4 pkt 2/3/6)
  app.post<{
    Params: { id: string };
    Body: { itemId: number; qty: number; location: string; updateLoc?: boolean };
  }>("/api/putaway/sessions/:id/confirm", async (req, reply) => {
    const { itemId, qty, location, updateLoc = true } = req.body;
    const r = confirmItem(itemId, qty, location, updateLoc, userOf(req));
    if ("error" in r) return reply.code(("status" in r && r.status) || 400).send({ error: r.error });
    return r;
  });

  app.post<{ Params: { id: string }; Body: { itemId: number; reason?: string } }>(
    "/api/putaway/sessions/:id/skip",
    async (req) => skipItem(req.body.itemId, req.body.reason, userOf(req))
  );

  // zatwierdź wózek → jeden MM + set_location(y) (spec §5.4 pkt 8)
  app.post<{ Params: { id: string } }>(
    "/api/putaway/sessions/:id/commit-cart",
    async (req, reply) => {
      const r = commitCart(Number(req.params.id), userOf(req));
      if ("error" in r) return reply.code(("status" in r && r.status) || 400).send({ error: r.error });
      return r;
    }
  );

  app.post<{ Params: { id: string } }>("/api/putaway/sessions/:id/close", async (req) =>
    closeSession(Number(req.params.id), userOf(req))
  );
}
