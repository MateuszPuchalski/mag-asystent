import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import { logEvent } from "../services/events.js";

/** Telemetria urządzenia z kolektora (akcelerometr/bateria) → audyt w events. */
const ALLOWED = new Set(["device_drop", "battery_low"]);

export async function deviceRoutes(app: FastifyInstance) {
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
