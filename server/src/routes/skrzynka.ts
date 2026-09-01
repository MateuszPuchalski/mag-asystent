import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { listaRozmow, osRozmowy, stanSkrzynki, zlecPomiar } from "../services/skrzynka.js";

const BIURO = ["biuro", "admin"];
const blad = (reply: FastifyReply, e: unknown) =>
  reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

/* Skrzynka jest ekranem biura, więc bramka roli stoi na każdej trasie — także
   na odczycie. Rozmowy z klientami nie są danymi, które ma widzieć hala. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Skrzynkę obsługuje biuro" });
  }
  return null;
}

export async function skrzynkaRoutes(app: FastifyInstance) {
  app.get("/api/obsluga/rozmowy", async (_req, reply) =>
    odmowa(reply) ?? { rozmowy: listaRozmow(), stan: stanSkrzynki() });

  app.get<{ Params: { id: string } }>("/api/obsluga/rozmowy/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try { return osRozmowy(req.params.id); } catch (e) { return blad(reply, e); }
  });

  app.post<{ Body: { rozmowaId?: string; wiadomoscId?: string; instrukcja?: string } }>(
    "/api/obsluga/zadania/pomiar", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = sesjaZadania()!;
      try {
        return {
          zadanie: zlecPomiar(
            req.body?.rozmowaId ?? "", req.body?.wiadomoscId ?? "",
            req.body?.instrukcja ?? "", { id: s.user.userId, name: s.user.name },
          ),
        };
      } catch (e) { return blad(reply, e); }
    });
}
