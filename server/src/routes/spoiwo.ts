import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania, subiekt } from "../context.js";
import { szukajWszedzie } from "../services/szukaj-wszedzie.js";
import { historiaSprawy } from "../services/klient-historia.js";

/* ── Trasy PONAD kolejkami (23 września 2026) ────────────────────────────────
   Szukanie Ctrl+K i historia klienta ze zwrotu albo sprawy nie należą do
   żadnej jednej kolejki — dlatego nie stoją w pliku żadnej z nich. Obie są
   ODCZYTEM: GET, zero zapisu i zero żądań do Allegro. */

const BIURO = ["biuro", "admin"];

/* Bramka jak w skrzynce: sprawy klientów widzi biuro, nie hala. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Szukanie spraw obsługuje biuro" });
  }
  return null;
}

export async function spoiwoRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string } }>("/api/obsluga/szukaj", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    /* Towar bez furtki literówek: w oknie szukania rozmyte trafienie
       w kartotekę zagłuszałoby dokładne trafienie w sprawę. */
    return {
      trafienia: szukajWszedzie(req.query.q ?? "", (q) => subiekt.search(q, 8, { literowki: false })),
    };
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/zwroty/:id/klient", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return historiaSprawy("zwrot", Number(req.params.id)); }
    catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });

  /* Reklamacja i dyskusja to jedna tabela — jedna trasa, rodzaj zna wiersz. */
  app.get<{ Params: { id: string } }>("/api/obsluga/sprawy/:id/klient", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try { return historiaSprawy("sprawa", Number(req.params.id)); }
    catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });
}
