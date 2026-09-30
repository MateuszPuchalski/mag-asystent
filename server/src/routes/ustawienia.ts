import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { pokrycieSygnatur } from "../services/sygnatury.js";
import { coAutomatDopisal } from "../services/wiedza-automat.js";
import { pokrycieWiedzy } from "../services/identyfikatory.js";
import { miaryDoboru } from "../services/miary-doboru.js";
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

  /* Pokrycie wiedzy (E3): ile kartotek ma identyfikatory z opisów, ile sekcji
     „Modele:" czeka na człowieka, czy FTS5 w ogóle stoi. Te same liczby, które
     tłumaczą, DLACZEGO szczebel doboru był pominięty. Odczyt bez zapisu. */
  app.get("/api/obsluga/pokrycie-wiedzy", async (_req, reply) =>
    odmowa(reply) ?? pokrycieWiedzy(db()));

  /* Miary doboru: ostatni wynik każdej rozmowy z oknem, podstawy wyboru
     przy „ta część" i ile doborów leży dziś otwartych. Bez osi osobowej:
     pytanie brzmi, które grupy kandydatów dają odpowiedź, nie kto ją dał.
     Uzasadnienie źródła liczb w nagłówku serwisu. */
  app.get<{ Querystring: { dni?: string } }>("/api/obsluga/miary-doboru", async (req, reply) =>
    odmowa(reply) ?? miaryDoboru(dniZQuery(req.query.dni), db()));

  /* MIARA ESKALACJI (S5 spoiwa, `docs/obsluga-klienta-calosc.md`): po ilu
     rozmowach klient szedł dalej — w dyskusję albo w reklamację. Kolejka pusta
     przy rosnącej eskalacji jest miarą, która kłamie, a do tego wydania biuro
     nie miało tej liczby wcale.

     BEZ OSI OSOBOWEJ, celowo. Ta liczba mówi o naszych odpowiedziach jako
     całości; rozbita na ludzi stałaby się oceną pracownika liczoną z decyzji
     klienta, na którą pracownik ma wpływ częściowy. */
  app.get("/api/obsluga/eskalacja", async (_req, reply) =>
    odmowa(reply) ?? { miesiace: eskalacje(db()) });

  /* CO AUTOMAT DOPISAŁ (0.331.0) — lista do prostowania.
     Właściciel wybrał opróżnianie kolejki wiedzy automatem i ta trasa jest
     drugą połową tamtej decyzji: skoro maszyna zatwierdza, człowiek musi mieć
     gdzie zobaczyć, co zatwierdziła, i co cofnąć. Cofanie idzie istniejącymi
     trasami wiedzy, więc tutaj zostaje sam odczyt — i dlatego ta trasa stoi
     w pliku ze strażnikiem ZERO TRAS ZAPISU, nie w `wiedza.ts`. */
  app.get("/api/obsluga/wiedza-automat", async (_req, reply) =>
    odmowa(reply) ?? coAutomatDopisal(100, db()));
}

/** Okno przycinane do trzech wartości, które oferuje selektor karty. */
function dniZQuery(v: string | undefined): number {
  const n = Number(v);
  return n === 30 || n === 90 ? n : 7;
}
