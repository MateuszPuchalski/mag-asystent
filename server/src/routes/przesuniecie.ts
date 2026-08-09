import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import { przesunStan } from "../services/przesuniecie.js";

/**
 * Przesunięcie stanu między magazynami (0.22.0).
 *
 * Jedna trasa zamiast ośmiu tras sesji kontenerowej. Bez sprawdzania roli:
 * przenoszenie towaru to codzienna czynność magazynowa, tak samo jak
 * zatwierdzenie wózka, które ta trasa zastąpiła.
 */
export async function przesuniecieRoutes(app: FastifyInstance) {
  app.post<{
    Body: {
      twId?: number;
      qty?: number;
      magFrom?: number;
      magTo?: number;
      location?: string;
      lineId?: number;
      recznie?: boolean;
    };
  }>("/api/przesuniecie", async (req, reply) => {
    const b = req.body ?? {};
    const r = przesunStan(
      {
        twId: Number(b.twId),
        qty: Number(b.qty),
        magFrom: Number(b.magFrom),
        magTo: Number(b.magTo),
        location: b.location ?? null,
        lineId: b.lineId ?? null,
        recznie: b.recznie === true,
      },
      userOf(req)
    );
    // 409 zostaje zarezerwowane dla braku stanu: to jedyna odmowa, którą
    // naprawia się CZEKANIEM albo mniejszą ilością, a nie poprawieniem żądania
    if ("error" in r) return reply.code(r.status ?? 400).send({ error: r.error });
    return r;
  });
}
