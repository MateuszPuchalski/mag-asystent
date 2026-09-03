import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { pokrycieSygnatur } from "../services/sygnatury.js";
import { pokrycieWiedzy } from "../services/identyfikatory.js";

/* ── Trasy ekranu ustawień obsługi (0.169.0) ─────────────────────────────────
   ZERO ZAPISÓW i to jest umowa, tak samo jak licznik `method:` w biurze.
   Ustawienia obsługi opisują TŁO pracy; gdy kiedyś dojdzie tu zapis, dojdzie
   razem ze zdaniem w uzasadnieniu, dlaczego musi.

   Bramka roli jak przy skrzynce i zwrotach: pokrycie sygnatur mówi o
   kartotekach i zamówieniach, czyli o danych biura.                         */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Ustawienia obsługi prowadzi biuro" });
  }
  return null;
}

export async function ustawieniaRoutes(app: FastifyInstance) {
  /* Ile sygnatur z Allegro trafia w kartotekę Subiekta. Odpowiedź na pytanie
     „czy wypełnianie sygnatur się opłaca" — liczbami z tej instalacji. */
  app.get("/api/obsluga/sygnatury", async (_req, reply) =>
    odmowa(reply) ?? pokrycieSygnatur(db()));

  /* Pokrycie wiedzy (E3): ile kartotek ma identyfikatory z opisów, ile sekcji
     „Modele:" czeka na człowieka, czy FTS5 w ogóle stoi. Te same liczby, które
     tłumaczą, DLACZEGO szczebel doboru był pominięty. Odczyt bez zapisu. */
  app.get("/api/obsluga/pokrycie-wiedzy", async (_req, reply) =>
    odmowa(reply) ?? pokrycieWiedzy(db()));
}
