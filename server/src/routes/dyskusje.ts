import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import {
  BladReklamacji, ReklamacjaConflict,
} from "../services/reklamacje.js";
import {
  licznikiDyskusji, listaDyskusji, szczegolDyskusji,
  stempelProwadziDyskusje, zapiszNotatkeDyskusji,
} from "../services/dyskusje.js";
import { stanReklamacjiHealth } from "../services/allegro-reklamacje-sync-state.js";
import { odpowiedzWSprawie } from "../services/reklamacje-wysylka.js";
import { poprosOZakonczenie } from "../services/dyskusja-zakonczenie.js";
import { autoryzuj } from "../services/auth.js";

/* ── Trasy dyskusji klienckich (0.245.0) ─────────────────────────────────────
   Bliźniak `routes/reklamacje.ts`, z trzema różnicami, i każda bierze się
   z tego, czego dyskusja NIE MA.

   1. NIE MA WERDYKTU. `POST /sale/issues/{id}/status` odmawia przy dyskusji
      („Not a valid operation for disputes"), więc tej trasy tu nie ma wcale.
      Zamiast niej stoi PROŚBA O ZAKOŃCZENIE — jedyna operacja, którą Allegro
      przewiduje wyłącznie dla dyskusji.
   2. NIE MA WŁASNEJ SYNCHRONIZACJI. Dyskusje i reklamacje przyjeżdżają JEDNĄ
      listą `/sale/issues`, więc druga trasa „synchronizuj teraz" byłaby drugim
      przyciskiem na to samo żądanie — i dwoma sposobami wejścia w limit 429.
      Ekran dyskusji czyta stan tej samej synchronizacji.
   3. NIE MA WŁASNYCH TRAS ZAŁĄCZNIKÓW. Klucz jest tym samym wierszem tej samej
      tabeli, a bramka roli identyczna; zdublowanie ich zdublowałoby też
      rozpoznawanie typu po sygnaturze pliku. Panel dyskusji woła trasy
      reklamacji i to jest świadome.

   TRZY ZAPISY: znacznik „kto prowadzi", notatka i odpowiedź w rozmowie —
   plus czwarty, PROŚBA O ZAKOŃCZENIE, jako jedyny za `autoryzuj()` z wpisem
   `privileged`. Otwarcie ekranu nie zapisuje nic (blizna 0.18.0).

   Bramka roli stoi na KAŻDEJ trasie, także na odczycie. Dyskusja niesie login
   kupującego, treść jego zgłoszenia i numer zamówienia; to są dane biura,
   nie hali.                                                                  */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Dyskusje prowadzi biuro" });
  }
  return null;
}

/** `BladReklamacji` niesie kod HTTP; konflikt wersji ma własny ładunek. */
function blad(reply: FastifyReply, e: unknown) {
  if (e instanceof ReklamacjaConflict) {
    return reply.code(409).send({ error: e.message, ...e.szczegoly });
  }
  if (e instanceof BladReklamacji) return reply.code(e.kod).send({ error: e.message });
  return reply.code(400).send({ error: (e as Error).message });
}

const autor = () => sesjaZadania()?.user.name ?? "?";

export async function dyskusjeRoutes(app: FastifyInstance) {
  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — ten sam wybór
     co przy zwrotach i reklamacjach. */
  app.get("/api/obsluga/dyskusje", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const dyskusje = listaDyskusji(db());
    return {
      dyskusje,
      liczniki: licznikiDyskusji(dyskusje),
      stan: stanReklamacjiHealth(db()),
    };
  });

  app.get<{ Params: { id: string } }>("/api/obsluga/dyskusje/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return szczegolDyskusji(db(), Number(req.params.id));
    } catch (e) { return blad(reply, e); }
  });

  /* Znacznik „prowadzę", nie zamek: ponowne kliknięcie go zdejmuje. Bez
     `autoryzuj()` — to zwykła praca biura. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/dyskusje/:id/prowadze", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        /* Tożsamość, nie imię — powód przy tej samej trasie w reklamacjach. */
        const s = sesjaZadania()!;
        return {
          dyskusja: stempelProwadziDyskusje(db(), Number(req.params.id),
            { id: s.user.userId, name: s.user.name }, req.body?.wersja),
        };
      } catch (e) { return blad(reply, e); }
    });

  /**
   * Odpowiedź w rozmowie.
   *
   * Ta sama maszyneria co przy reklamacji, z jawnym `rodzaj: "DISPUTE"` —
   * on bramkuje odczyt wiersza i nazywa zdarzenie w dzienniku. Bez niego
   * wysyłka z tego ekranu dosięgłaby reklamacji, a ślad audytowy mówiłby
   * o niej „reklamacja_odpowiedz".
   *
   * KAŻDA FLAGA Z CIAŁA JEST TU DEKLAROWANA I PRZEKAZYWANA DALEJ (blizna
   * 0.224.1): pole obsłużone w serwisie i wysyłane przez panel, ale
   * pominięte w typie trasy, po prostu ginie — a strażnik tras pilnuje
   * ADRESÓW, nie pól ciała.
   */
  app.post<{ Params: { id: string }; Body: {
    tresc?: string; expectedWersja?: number;
    expectedLastMessageId?: number | null; mimoNowejWiadomosci?: boolean;
  } }>("/api/obsluga/dyskusje/:id/odpowiedz", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const s = sesjaZadania()!;
    try {
      return await odpowiedzWSprawie({
        reklamacjaId: Number(req.params.id),
        rodzaj: "DISPUTE",
        autor: { id: s.user.userId, name: s.user.name },
        tresc: req.body?.tresc ?? "",
        expectedWersja: Number(req.body?.expectedWersja),
        expectedLastMessageId: req.body?.expectedLastMessageId ?? null,
        mimoNowejWiadomosci: Boolean(req.body?.mimoNowejWiadomosci),
      });
    } catch (e) { return blad(reply, e); }
  });

  /**
   * Prośba o zakończenie dyskusji (`END_REQUEST`).
   *
   * ZA `autoryzuj()`, choć `odmowa()` i tak wpuszcza tylko biuro: bramka roli
   * niewiele tu dodaje, ale wpis `privileged` z nazwą operacji — tak. Prośba
   * trafia do kupującego natychmiast i drugiej nie wyślemy, bo pierwsza mogła
   * dojść. Potwierdzenie stoi w PANELU, przed przyciskiem.
   *
   * Wersja z ekranu jest OBOWIĄZKOWA: prośba bez wiedzy, na co agent patrzył,
   * to prośba w ciemno — ten sam warunek co przy werdykcie.
   */
  app.post<{ Params: { id: string }; Body: {
    tresc?: string; wersja?: number;
    expectedLastMessageId?: number | null; mimoNowejWiadomosci?: boolean;
  } }>("/api/obsluga/dyskusje/:id/zakoncz", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    const s = sesjaZadania()!;
    /* Kształt ciała PRZED `autoryzuj()`: wpis `privileged` ma znaczyć
       „człowiek poprosił o zakończenie", a nie „panel wysłał ciało bez wersji". */
    if (!Number.isInteger(Number(req.body?.wersja))) {
      return reply.code(400).send({ error: "Prośba o zakończenie wymaga wersji sprawy z ekranu" });
    }
    const w = autoryzuj(s.user, "dyskusja_zakonczenie");
    if (!w.ok) return reply.code(403).send({ error: w.powod });
    try {
      return await poprosOZakonczenie({
        dyskusjaId: Number(req.params.id),
        autor: { id: s.user.userId, name: s.user.name },
        tresc: req.body?.tresc ?? "",
        expectedWersja: Number(req.body?.wersja),
        expectedLastMessageId: req.body?.expectedLastMessageId ?? null,
        mimoNowejWiadomosci: Boolean(req.body?.mimoNowejWiadomosci),
      });
    } catch (e) { return blad(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { notatka?: string | null; wersja?: number } }>(
    "/api/obsluga/dyskusje/:id/notatka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const n = req.body?.notatka;
      if (n !== null && n !== undefined && typeof n !== "string") {
        return reply.code(400).send({ error: "Pole `notatka` musi być tekstem albo `null`" });
      }
      try {
        return {
          dyskusja: zapiszNotatkeDyskusji(
            db(), Number(req.params.id), n ?? null, autor(), req.body?.wersja),
        };
      } catch (e) { return blad(reply, e); }
    });
}
