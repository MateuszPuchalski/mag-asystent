import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { listaBezZdjecia } from "../services/zdjecia-bez.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Zdjęcia kartoteki widziane z biura ──────────────────────────────────────
   Dodawanie i zatwierdzanie zdjęcia stoi w `products.ts`, bo kolektor woła je
   z karty towaru. Tu jest to, czego kolektor nie potrzebuje: przegląd braków. */

const BIURO = ROLE_BIUROWE;

/* Lista braków to narzędzie biura. Hala dokłada zdjęcie z karty towaru,
   a pełna kartoteka na kolektorze tylko by ją spowalniała. */
function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Listę towarów bez zdjęcia obsługuje biuro" });
  }
  return null;
}

export async function zdjeciaRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { q?: string; limit?: string; offset?: string } }>(
    "/api/zdjecia/bez-zdjecia",
    async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return await listaBezZdjecia(req.query);
      } catch (e) {
        /* Baza Subiekta nie odpowiedziała. To awaria, nie stan funkcji, więc
           idzie jako błąd: „wyłączone" kazałoby szukać klucza, którego nikt
           nie zmieniał. */
        const powod = e instanceof Error ? e.message : String(e);
        return reply.code(503).send({ error: `Nie da się odczytać kartoteki z Subiekta (${powod}).` });
      }
    }
  );
}
