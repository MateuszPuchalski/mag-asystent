import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import {
  getDelivery,
  listDocuments,
  openDelivery,
  putawayLine,
  resolveScan,
} from "../services/delivery.js";
import type { LocApplyAction } from "../types.js";

/* ── Tryb A: rozkładanie dostaw krajowych (redesign v2.0) ────────────────────
   Ścieżka codzienna: dokument → skan towaru → skan lokalizacji. Zapis wyłącznie
   `set_location` (D1). Tryb B (kontener) żyje dalej pod /api/putaway/*.       */

export async function deliveryRoutes(app: FastifyInstance) {
  /** Lista dostaw FZ/PZ (14 dni) z postępem; dokumenty w buforze też (D1). */
  app.get("/api/delivery/documents", async () => ({ documents: listDocuments(14) }));

  /** Otwórz/wznów rozkładanie dokumentu — snapshot pozycji w chwili otwarcia. */
  app.post<{ Params: { dokId: string } }>("/api/delivery/documents/:dokId/open", async (req, reply) => {
    try {
      return { deliveryId: openDelivery(Number(req.params.dokId), userOf(req)) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Błąd otwarcia" });
    }
  });

  /** Widok dostawy: linie posortowane po lokalizacji, BEZ LOK na końcu. */
  app.get<{ Params: { id: string } }>("/api/delivery/:id", async (req, reply) => {
    const d = getDelivery(Number(req.params.id));
    if (!d) return reply.code(404).send({ error: "Brak dostawy" });
    return d;
  });

  /** Skan towaru → linia / kolizja EAN / spoza dokumentu / nieznany (D7). */
  app.post<{ Params: { id: string }; Body: { code: string } }>(
    "/api/delivery/:id/scan",
    async (req, reply) => {
      const code = (req.body?.code ?? "").trim();
      if (!code) return reply.code(400).send({ error: "Pusty kod" });
      return resolveScan(Number(req.params.id), code, userOf(req));
    }
  );

  /**
   * Odłożenie linii: skan lokalizacji obowiązkowy (D3). Bez MM.
   * `locAction` rozstrzyga rozjazd (§4.3): 'replace' = towar przeniesiony,
   * 'add' = druga lokalizacja tego samego towaru. Decyduje magazynier w dialogu,
   * a nie serwer — z samego skanu nie da się odróżnić tych dwóch sytuacji.
   */
  app.post<{
    Params: { id: string; lineId: string };
    Body: { location: string; qty?: number; locAction?: LocApplyAction };
  }>(
    "/api/delivery/:id/lines/:lineId/putaway",
    async (req, reply) => {
      const { location, qty, locAction } = req.body ?? ({} as { location?: string; qty?: number });
      if (!location) return reply.code(400).send({ error: "Brak kodu lokalizacji" });
      if (locAction && locAction !== "add" && locAction !== "replace") {
        return reply.code(400).send({ error: `Nieznana akcja lokalizacji: ${locAction}` });
      }
      const r = putawayLine(Number(req.params.lineId), location, qty, userOf(req), locAction ?? "replace");
      if ("error" in r) return reply.code(r.status ?? 400).send({ error: r.error });
      return r;
    }
  );
}
