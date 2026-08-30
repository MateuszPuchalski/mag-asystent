import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { config } from "../config.js";
import { allegroTryb } from "../adapters/allegro.js";
import {
  rozlacz,
  rozpocznijParowanie,
  sprawdzParowanie,
  stanPolaczenia,
} from "../services/allegro-token.js";

/* ── Konto Allegro — parowanie i stan (0.138.0) ──────────────────────────────
   Te cztery trasy mieszkały do 0.137.2 w `routes/zwroty.ts` i odeszłyby razem
   z rejestrem zwrotów. Zostają, bo token nie należał do zwrotów: to jedno
   połączenie konta sprzedawcy, z którego skorzysta nowa obsługa klienta,
   a dziś korzysta z niego sonda kształtu (`npm run sonda`).

   Parowanie i rozłączenie to ADMIN — token wydany na konto firmy jest kluczem
   do wszystkiego, co Allegro o niej wie. Sam stan czyta biuro, bo to jest
   informacja o tle pracy („czy połączenie żyje"), a nie władza nad nim.     */

export async function allegroRoutes(app: FastifyInstance) {
  function odmowa(role: string[] = ["biuro", "admin"]): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!role.includes(s.user.role)) {
      return { kod: 403, error: "Konto Allegro obsługuje biuro" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  app.get("/api/biuro/allegro/status", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { ...stanPolaczenia(), tryb: allegroTryb(), sandbox: config.allegro.sandbox };
  });

  app.post("/api/biuro/allegro/parowanie", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    if (allegroTryb() === "dev") {
      return reply
        .code(400)
        .send({ error: "Adapter dev nie wymaga parowania — tryb demo działa od razu" });
    }
    try {
      return await rozpocznijParowanie();
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.get("/api/biuro/allegro/parowanie", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      return await sprawdzParowanie(autor());
    } catch (e) {
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  app.delete("/api/biuro/allegro", async (_req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    rozlacz(autor());
    return { ok: true };
  });
}
