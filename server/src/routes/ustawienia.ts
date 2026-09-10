import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { pokrycieSygnatur } from "../services/sygnatury.js";
import { pokrycieWiedzy } from "../services/identyfikatory.js";
import { skutecznoscDoboru } from "../services/skutecznosc-doboru.js";

/* ── Trasy ekranu ustawień obsługi (0.169.0) ─────────────────────────────────
   ZERO ZAPISÓW i to jest umowa, tak samo jak licznik `method:` w biurze.
   Ustawienia obsługi opisują TŁO pracy; gdy kiedyś dojdzie tu zapis, dojdzie
   razem ze zdaniem w uzasadnieniu, dlaczego musi.

   Bramka roli jak przy skrzynce i zwrotach: pokrycie sygnatur mówi o
   kartotekach i zamówieniach, czyli o danych biura. Od 0.267.0 stoi tu także
   raport z osią osobową, więc bramka przestała być wyłącznie kwestią tego,
   komu te liczby są potrzebne.                                              */

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

  /* Skuteczność doboru (0.267.0): którym z jedenastu szczebli §11.2 przyszedł
     kandydat, którego agent naprawdę wybrał. Liczone z księgi zdarzeń, nie
     z `dobor_rozmowy` — tamta pamięta ostatni wybór, a pytanie brzmi „która
     droga dała trafienie". Uzasadnienie w nagłówku serwisu.

     Ta trasa niesie OŚ OSOBOWĄ, więc jest tu jedyną, przy której bramka roli
     znaczy więcej niż wygodę: raport per osoba to monitoring pracowniczy.
     Zdanie o podstawie prawnej jedzie w ładunku, żeby panel nie mógł go
     zgubić po drodze. */
  app.get<{ Querystring: { dni?: string } }>("/api/obsluga/skutecznosc-doboru", async (req, reply) =>
    odmowa(reply) ?? skutecznoscDoboru(dniZQuery(req.query.dni), db()));
}

/** Okno przycinane do trzech wartości, które oferuje selektor karty. */
function dniZQuery(v: string | undefined): number {
  const n = Number(v);
  return n === 30 || n === 90 ? n : 7;
}
