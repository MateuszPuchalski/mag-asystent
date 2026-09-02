import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { transaction } from "../db/db.js";
import { db } from "../db/db.js";
import {
  bilansKartotek, cofnijKorekte, licznikiKubelkow, listaZwrotow, ocenPozycje, osZwrotu,
  potwierdzKartoteke, rozstrzygnijZwrot, zapiszKorekte, zapiszKwote, znajdzZwrotPoKodzie,
  ZwrotConflict,
} from "../services/zwroty.js";
import { RabatConflict, zlozWniosekORabat } from "../services/rabaty.js";
import { zglosRabat } from "../adapters/allegro.http.js";
import { uzupelnijZamowienia } from "../services/allegro-zamowienia-sync.js";
import { dociagnijZwrotPoLiscie } from "../services/allegro-zwroty-sync.js";
import { config } from "../config.js";
import { logEvent } from "../services/events.js";
import { stanZwrotowHealth } from "../services/allegro-zwroty-sync-state.js";

/* ── Trasy zwrotów klienckich (0.150.0, decyzje biura od 0.156.0) ────────────
   SZEŚĆ ZAPISÓW: kartoteka pozycji, werdykt, ocena towaru, kwota oraz — od
   0.162.0 — numer korekty i jego cofnięcie. Nic nie wychodzi stąd do Allegro
   ani do Subiekta: korektę wystawia człowiek w Subiekcie, a pieniądze oddaje
   w panelu Allegro. Panel zapisuje FAKT, że to się stało.

   Oddanie pieniędzy przez API czeka na końcówki zapisu Allegro, których sonda
   nie potwierdzi (jest GET-em).

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

  /* Konflikt wersji dostaje 409 i SZCZEGÓŁY, tak samo jak przy rozmowie:
     panel ma narysować „inny agent zdążył pierwszy", a nie gołe „błąd". */
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof ZwrotConflict
    ? reply.code(409).send({ error: e.message, ...e.szczegoly })
    : reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

  const kto = () => {
    const s = sesjaZadania()!;
    return { id: s.user.userId, name: s.user.name };
  };

  app.post<{ Params: { id: string }; Body: { decyzja?: string; powod?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/werdykt", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const d = req.body?.decyzja;
      if (d !== "przyjety" && d !== "odrzucony") {
        return reply.code(400).send({ error: "Werdykt to `przyjety` albo `odrzucony`." });
      }
      try {
        return rozstrzygnijZwrot(db(), Number(req.params.id), d,
          req.body?.powod ?? null, Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { ocena?: string | null; wersja?: number } }>(
    "/api/obsluga/zwroty/pozycje/:id/ocena", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const o = req.body?.ocena ?? null;
      if (o !== null && !["stan", "przecena", "utylizacja"].includes(o)) {
        return reply.code(400).send({ error: "Ocena to `stan`, `przecena`, `utylizacja` albo brak." });
      }
      try {
        return ocenPozycje(db(), Number(req.params.id), o as never,
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Panel przysyła ZAZNACZENIE, nie kwotę. §25a.3: liczy serwer, panel niczego
     nie zgaduje — inaczej dałoby się zapisać dowolną liczbę z pominięciem
     ekranu, a to są cudze pieniądze. */
  app.post<{ Params: { id: string }; Body: { pozycjeIds?: number[]; dostawa?: boolean; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/kwota", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const ids = req.body?.pozycjeIds;
      if (!Array.isArray(ids) || ids.some((i) => !Number.isInteger(i))) {
        return reply.code(400).send({ error: "`pozycjeIds` to lista identyfikatorów pozycji." });
      }
      try {
        return zapiszKwote(db(), Number(req.params.id),
          { pozycjeIds: ids, dostawa: req.body?.dostawa === true },
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* Numer korekty PRZEPISUJE człowiek z Subiekta, więc pomyłka jest tu
     zdarzeniem normalnym — stąd druga trasa, cofająca (§25a.5). */
  app.post<{ Params: { id: string }; Body: { numer?: string; wersja?: number } }>(
    "/api/obsluga/zwroty/:id/korekta", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return zapiszKorekte(db(), Number(req.params.id), req.body?.numer ?? "",
          Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/zwroty/:id/korekta/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return cofnijKorekte(db(), Number(req.params.id), Number(req.body?.wersja), kto());
      } catch (e) { return konflikt(reply, e); }
    });

  /* RABAT TRANSAKCYJNY (0.164.0) — jedyna trasa tego pliku, która WYCHODZI
     do Allegro. Reszta zapisuje wyłącznie u nas. Stąd osobna ostrożność:
     strażnik przed dubletem stoi w serwisie, PRZED siecią, bo końcówka
     Allegro nie ma idempotencji. */
  app.post<{ Params: { id: string } }>("/api/obsluga/zwroty/pozycje/:id/rabat",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return await zlozWniosekORabat(db(), Number(req.params.id), kto(),
          (lineItemId, ilosc) => zglosRabat(config.allegro.apiUrl, lineItemId, ilosc));
      } catch (e) {
        /* Dublet to 409, nie 400: to nie jest zła prośba, tylko praca już
           wykonana — a ekran ma powiedzieć, KTÓRY wniosek już istnieje. */
        if (e instanceof RabatConflict) return reply.code(409).send({ error: e.message });
        return konflikt(reply, e);
      }
    });

  /* ── Skan etykiety zwrotnej (0.163.0) ─────────────────────────────────────
     TA TRASA JEST POST-em, CHOĆ NICZEGO NIE ZAPISUJE, i to jest świadome.
     Zeskanowany kod w adresie wylądowałby w logu żądań serwera — a numer listu
     przewozowego prowadzi w systemie kuriera do adresu odbiorcy (`ksztalt.ts`,
     0.155.0). Stałby się więc trwały tylnymi drzwiami, mimo że w bazie nie ma
     na niego kolumny. Ten sam argument stoi przy szynie zdarzeń panelu:
     „token lądowałby w logach żądań serwera" (`panel/src/api/zdarzenia.ts`).

     Z tego samego powodu nie ma tu `logEvent`: wpis z kodem w dzienniku byłby
     dokładnie tym zapisem, którego unikamy, a bez kodu nie niósłby nic. */
  app.post<{ Body: { kod?: string } }>("/api/obsluga/zwroty/skan", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const kod = (req.body?.kod ?? "").trim();
    if (!kod) return reply.code(400).send({ error: "Pusty kod" });
    return znajdzZwrotPoKodzie(kod, db());
  });

  /* Skan, który nie trafił w nic u nas. Paczka bywa w biurze szybciej, niż
     zwrot doleci synchronizacją, więc pytamy Allegro o TEN JEDEN numer listu
     zamiast kazać czekać na ticker.

     Ta trasa ZAPISUJE (dociąga zwrot), więc woła `logEvent` — bez kodu
     w danych zdarzenia, z tego samego powodu co wyżej. */
  app.post<{ Body: { kod?: string } }>("/api/obsluga/zwroty/skan/dociagnij",
    async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const kod = (req.body?.kod ?? "").trim();
      if (!kod) return reply.code(400).send({ error: "Pusty kod" });
      if (!config.allegro.clientId) {
        return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
      }
      const s = sesjaZadania()!;
      try {
        const pobrano = await dociagnijZwrotPoLiscie(kod);
        logEvent("zwrot_skan_dociagniecie", s.user.name, null, { pobrano });
        return { pobrano, ...znajdzZwrotPoKodzie(kod, db()) };
      } catch (e) {
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
