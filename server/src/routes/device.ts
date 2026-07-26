import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import { logEvent } from "../services/events.js";
import { metrics } from "../services/metrics.js";
import { reconcile } from "../services/reconcile.js";

/** Telemetria urządzenia z kolektora (akcelerometr/bateria) → audyt w events. */
const ALLOWED = new Set([
  "device_drop",
  "battery_low",
  /* Wygaśnięcie kontekstu przyklejonego (plan §6). Wysoka częstość = ludzie są
     przerywani albo TTL jest za krótki — to jest pomiar, nie ciekawostka. */
  "pin_expired",
  /* Skan → odpowiedź mierzone U CZŁOWIEKA (plan §10). Czas serwera pomijałby
     sieć i render, czyli akurat to, gdzie problem naprawdę siedzi. */
  "scan_timing",
]);

export async function deviceRoutes(app: FastifyInstance) {
  /**
   * Cztery liczby dla biura (plan §10) — jeden endpoint, bez panelu.
   * Read-only, więc `/lookup` może je pokazać bez naruszania swojej zasady.
   */
  app.get<{ Querystring: { days?: string } }>("/api/metrics", async (req) => {
    return metrics(Number(req.query.days) || 7);
  });

  /**
   * Rekoncyliacja na żądanie (plan §9) — te same cztery kontrole co nocny
   * przebieg, tylko liczone teraz. Read-only, więc `/lookup` może to pokazać.
   */
  app.get("/api/reconcile", async () => reconcile());

  app.post<{ Body: { type?: string; [k: string]: unknown } }>(
    "/api/device/event",
    async (req, reply) => {
      const { type, ...payload } = req.body ?? {};
      if (!type || !ALLOWED.has(type)) {
        return reply.code(400).send({ error: "Nieznany typ zdarzenia urządzenia" });
      }
      logEvent(type, userOf(req), null, payload);
      return { ok: true };
    }
  );
}
