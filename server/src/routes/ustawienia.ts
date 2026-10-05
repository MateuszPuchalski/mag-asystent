import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { pokrycieSygnatur } from "../services/sygnatury.js";
import { eskalacje } from "../services/droga-klienta.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Trasy ekranu ustawień obsługi (0.169.0) ─────────────────────────────────
   ZERO ZAPISÓW i to jest umowa, tak samo jak licznik `method:` w biurze.
   Ustawienia obsługi opisują TŁO pracy; gdy kiedyś dojdzie tu zapis, dojdzie
   razem ze zdaniem w uzasadnieniu, dlaczego musi.

   Bramka roli jak przy skrzynce i zwrotach: pokrycie sygnatur mówi o
   kartotekach i zamówieniach, czyli o danych biura.                        */

const BIURO = ROLE_BIUROWE;

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

  /* MIARA ESKALACJI (S5 spoiwa, `docs/obsluga-klienta-calosc.md`): po ilu
     rozmowach klient szedł dalej — w dyskusję albo w reklamację. Kolejka pusta
     przy rosnącej eskalacji jest miarą, która kłamie, a do tego wydania biuro
     nie miało tej liczby wcale.

     BEZ OSI OSOBOWEJ, celowo. Ta liczba mówi o naszych odpowiedziach jako
     całości; rozbita na ludzi stałaby się oceną pracownika liczoną z decyzji
     klienta, na którą pracownik ma wpływ częściowy. */
  app.get("/api/obsluga/eskalacja", async (_req, reply) =>
    odmowa(reply) ?? { miesiace: eskalacje(db()) });
}

