import type { FastifyInstance, FastifyReply } from "fastify";
import { autorOperacji, sesjaZadania } from "../context.js";
import { ROLE_BIUROWE } from "../services/users.js";
import { listaBezWymiarow, zapiszPomiar } from "../services/wymiary.js";

/* ── Waga i wymiary kartotek widziane z biura ────────────────────────────────
   Lista braków i zapis pomiaru. Logika siedzi w `services/wymiary.ts`. */

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!ROLE_BIUROWE.includes(s.user.role)) {
    return reply.code(403).send({ error: "Wymiary towarów obsługuje biuro" });
  }
  return null;
}

/* Baza Subiekta nie odpowiedziała — awaria, nie stan funkcji, więc błąd 503. */
function awariaBazy(reply: FastifyReply, e: unknown) {
  const powod = e instanceof Error ? e.message : String(e);
  return reply.code(503).send({ error: `Nie da się odczytać kartoteki z Subiekta (${powod}).` });
}

export async function wymiaryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string; sortuj?: string; naStanie?: string; sprzedane?: string } }>(
    "/api/wymiary/bez-wymiarow",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return await listaBezWymiarow(req.query);
      } catch (e) {
        return awariaBazy(reply, e);
      }
    }
  );

  app.post<{ Params: { twId: string }; Body: unknown }>("/api/wymiary/:twId", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const twId = Number(req.params.twId);
    if (!Number.isInteger(twId) || twId <= 0) return reply.code(400).send({ error: "Zły numer towaru" });
    let wynik;
    try {
      wynik = await zapiszPomiar(twId, req.body, autorOperacji(req));
    } catch (e) {
      return awariaBazy(reply, e);
    }
    if (!wynik.ok) return reply.code(wynik.kod).send({ error: wynik.error });
    return { queueId: wynik.queueId, pomiar: wynik.pomiar };
  });
}
