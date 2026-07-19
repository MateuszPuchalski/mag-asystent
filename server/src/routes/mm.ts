import type { FastifyInstance } from "fastify";
import { subiekt, userOf } from "../context.js";
import { config } from "../config.js";
import { pendingMmByTw } from "../services/stock.js";
import { enqueueMM } from "../services/queue.js";
import { logEvent } from "../services/events.js";

interface MmBody {
  items: Array<{ twId: number; qty: number }>;
}

export async function mmRoutes(app: FastifyInstance) {
  app.post<{ Body: MmBody }>("/api/mm", async (req, reply) => {
    const { items } = req.body;
    if (!items?.length) return reply.code(400).send({ error: "Brak pozycji MM" });

    const pending = pendingMmByTw(config.magId.MGP);
    // walidacja ilości: min(żądane, stan_MGP − Σ oczekujących MM) — ostrzeżenie, nie clamp
    for (const it of items) {
      const p = subiekt.getProductById(it.twId);
      if (!p) return reply.code(404).send({ error: `Nieznany towar tw_id=${it.twId}` });
      const stock = subiekt.getStock(it.twId, config.magId.MGP);
      const available = stock.stan - (pending.get(it.twId) ?? 0);
      if (it.qty > available) {
        return reply.code(409).send({
          error: `Za mało na MGP dla ${p.symbol}: żądane ${it.qty}, dostępne ${available} (stan ${stock.stan} − ${pending.get(it.twId) ?? 0} w kolejce)`,
          available,
        });
      }
      if (it.qty <= 0) return reply.code(400).send({ error: "Ilość musi być > 0" });
    }

    const user = userOf(req);
    const first = subiekt.getProductById(items[0].twId)!;

    const totalQty = items.reduce((s, it) => s + it.qty, 0);
    const label =
      items.length === 1 ? "MM MGP→MAG · " + first.symbol : `MM MGP→MAG · ${items.length} poz.`;
    const detail = items.length === 1 ? `${totalQty} szt` : `${totalQty} szt w ${items.length} poz.`;
    const queueId = enqueueMM(config.magId.MGP, config.magId.MAG, items, {
      createdBy: user,
      twId: items.length === 1 ? items[0].twId : null,
      label,
      detail,
    });
    logEvent("mm_queued", user, items.length === 1 ? items[0].twId : null, { items });
    return { queueId, kind: "mm" };
  });
}
