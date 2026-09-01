import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { transaction } from "../db/db.js";
import { db } from "../db/db.js";
import {
  bilansKartotek, licznikiKubelkow, listaZwrotow, osZwrotu, potwierdzKartoteke,
} from "../services/zwroty.js";
import { uzupelnijZamowienia } from "../services/allegro-zamowienia-sync.js";
import { config } from "../config.js";
import { logEvent } from "../services/events.js";
import { stanZwrotowHealth } from "../services/allegro-zwroty-sync-state.js";

/* ── Trasy zwrotów klienckich (0.150.0, zapis od 0.152.0) ────────────────────
   JEDEN ZAPIS: potwierdzenie kartoteki dla pozycji. Nic nie wychodzi stąd do
   Allegro — werdykt, kwota i korekta nadal czekają.

   Bramka roli stoi na KAŻDEJ trasie, także na odczycie — tak samo jak przy
   skrzynce. Zwrot niesie numer zamówienia i nazwisko sprawy klienta; to są
   dane biura, nie hali.                                                     */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Zwroty prowadzi biuro" });
  }
  return null;
}

export async function zwrotyRoutes(app: FastifyInstance) {
  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — a to jest
     dokładnie ten koszt, który ten ekran miał zdjąć. */
  app.get("/api/obsluga/zwroty", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const zwroty = listaZwrotow(db());
    return {
      zwroty, liczniki: licznikiKubelkow(zwroty),
      kartoteki: bilansKartotek(zwroty),
      stan: stanZwrotowHealth(db()),
    };
  });

  /* Ręczne dociągnięcie zamówień (§9, wzorzec „synchronizuj teraz" ze
     skrzynki). Bez niego diagnoza na produkcji wymagała czekania dziesięciu
     minut na najrzadszy z trzech tickerów — a to jest dokładnie ten moment,
     w którym ktoś patrzy na ekran i chce wiedzieć, czy problem jest
     w danych, czy w kodzie.

     NIE omija limitu Allegro: pobiera tyle samo co ticker i tak samo
     przerywa na 429. */
  app.post("/api/obsluga/zwroty/zamowienia", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    if (!config.allegro.clientId) {
      return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
    }
    const s = sesjaZadania()!;
    logEvent("zwroty_zamowienia_reczne", s.user.name);
    try {
      return { pobrano: await uzupelnijZamowienia() };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  /* Potwierdzenie kartoteki. `twId: null` ZDEJMUJE powiązanie i to jest droga
     wyjścia z błędnego potwierdzenia, a nie brak funkcji.

     Bez `autoryzuj()`: to nie jest operacja uprzywilejowana, tylko zwykła
     praca biura, a `autoryzuj` pisałoby `privileged` przy każdym kliknięciu
     (ten sam argument co przy odczycie dokumentu w `routes/biuro.ts`). */
  app.post<{ Params: { id: string }; Body: { twId?: number | null; zrodlo?: string } }>(
    "/api/obsluga/zwroty/pozycje/:id/kartoteka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const s = sesjaZadania()!;
      const zrodlo = req.body?.zrodlo === "sku" ? "sku" : "reczne";
      const twId = req.body?.twId == null ? null : Number(req.body.twId);
      if (twId !== null && !Number.isInteger(twId)) {
        return reply.code(400).send({ error: "twId musi być liczbą całkowitą albo null" });
      }
      try {
        return transaction(db(), () => potwierdzKartoteke(
          db(), Number(req.params.id), twId, zrodlo,
          { id: s.user.userId, name: s.user.name },
        ))();
      } catch (e) {
        /* Nieznana pozycja i nieznany towar to decyzje wołającego, nie awaria
           serwera — ten sam wzorzec co przy domknięciu dostawy. */
        return reply.code(400).send({ error: (e as Error).message });
      }
    });

  app.get<{ Params: { id: string } }>("/api/obsluga/zwroty/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const id = Number(req.params.id);
    const zwrot = listaZwrotow(db()).find((z) => z.id === id);
    if (!zwrot) return reply.code(404).send({ error: "Nie znaleziono zwrotu" });
    return { zwrot, os: osZwrotu(db(), id) };
  });
}
