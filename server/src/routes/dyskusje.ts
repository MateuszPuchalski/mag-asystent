import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { logEvent } from "../services/events.js";
import { config } from "../config.js";
import {
  BladReklamacji, progKolejki, ReklamacjaConflict,
} from "../services/reklamacje.js";
import {
  licznikiDyskusji, listaDyskusji, szczegolDyskusji,
  cofnijNotatkeDyskusji, stempelProwadziDyskusje, zapiszNotatkeDyskusji,
} from "../services/dyskusje.js";
import { stanReklamacjiHealth } from "../services/allegro-reklamacje-sync-state.js";
import { odswiezSprawe } from "../services/allegro-reklamacje-sync.js";
import { odpowiedzWSprawie } from "../services/reklamacje-wysylka.js";
import { poprosOZakonczenie } from "../services/dyskusja-zakonczenie.js";
import { autoryzuj } from "../services/auth.js";
import { sprawdzPrzesylke } from "../services/przesylka-zamowienia.js";
import { trasyTagowSprawy } from "./tagi.js";
import { TAGI_REKLAMACJI } from "../services/tagi-spraw.js";

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

const autor = () => sesjaZadania()?.user.name ?? "?";

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


export async function dyskusjeRoutes(app: FastifyInstance) {
  /* Tagi sprawy: przypięcie i zdjęcie. Trasy wspólne dla obu ekranów,
     bo klucz jest tym samym wierszem tej samej tabeli. */
  trasyTagowSprawy(app, "/api/obsluga/dyskusje", TAGI_REKLAMACJI);

  /* Cała kolejka jednym strzałem razem z licznikami. Panel filtruje kubełkiem
     u siebie, więc przełączenie kubełka nie kosztuje żądania — ten sam wybór
     co przy zwrotach i reklamacjach. */
  app.get<{ Querystring: { od?: string } }>("/api/obsluga/dyskusje", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    /* Próg i furtka te same co przy reklamacjach — obie kolejki karmi ta sama
       tabela, więc rozjazd między nimi byłby rozjazdem w obrębie jednego
       ekranu obsługi. */
    const bezProgu = req.query?.od === "wszystko";
    const prog = progKolejki(db(), Date.now(), config.allegro.reklamacjeOd, "DISPUTE");
    const dyskusje = listaDyskusji(db(), Date.now(), bezProgu ? null : prog.od);
    return {
      dyskusje,
      liczniki: licznikiDyskusji(dyskusje),
      prog: { ...prog, zdjety: bezProgu },
      stan: stanReklamacjiHealth(db()),
    };
  });

  /* ── GDZIE JEST PACZKA DO KLIENTA (0.393.0) ────────────────────────────────
     Bliźniak trasy z `routes/reklamacje.ts` i stoi tu z tego samego powodu,
     dla którego stoi tam: dyskusja o niedostarczonej paczce zaczyna się od
     pytania „czy on to dostał", a dwie kolejki mają odpowiadać jednakowo.
     Doktryna jednej drogi mówi wprost: kolejki są NASZE, nie jego.

     Odpowiedź wpada w kolumny `zamowienie_klienta`, więc pytanie zadane
     z reklamacji widać potem w dyskusji tego samego zamówienia i odwrotnie.
     To celowe: paczka jest jedna, niezależnie od tego, w której kolejce
     akurat siedzi agent.

     NA JAWNE KLIKNIĘCIE: dwa żądania u Allegro nie mają prawa wyjść
     z samego otwarcia ekranu. */
  app.post<{ Params: { id: string } }>(
    "/api/obsluga/dyskusje/:id/przesylka", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      if (!config.allegro.clientId) {
        return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
      }
      const w = db().prepare(`SELECT z.id AS id FROM reklamacja_klienta r
        JOIN zamowienie_klienta z ON z.channel_account_id = r.channel_account_id
          AND z.external_id = r.order_id
        WHERE r.id = ?`).get(Number(req.params.id)) as { id: number } | undefined;
      if (!w) {
        return reply.code(400).send({
          error: "Zamówienia tej sprawy jeszcze nie pobraliśmy — nie ma czego szukać.",
        });
      }
      logEvent("dyskusja_przesylka_reczna", autor());
      try {
        return await sprawdzPrzesylke(db(), w.id);
      } catch (e) {
        return reply.code(502).send({ error: (e as Error).message });
      }
    });

  /* ── ODŚWIEŻENIE JEDNEJ DYSKUSJI (24 września 2026) ─────────────────────────
     Zgłoszenie właściciela: „dyskusje zostały w tyle”. Ekran reklamacji od
     0.410.0 odświeża sprawę przy wejściu, a dyskusja nie miała NICZEGO — ani
     tego, ani przycisku, ani synchronizacji na własnym ekranie. Przebieg
     czyta najwyżej tysiąc spraw z jednej listy, więc starszych dyskusji nie
     odświeżał nigdy. Właściciel wybrał wprost oba: wejście i przycisk.

     Wejście w sprawę rozszerza JEDYNY wyjątek od „zero zapisu przy
     patrzeniu” z reklamacji na dyskusje. To decyzja właściciela z 24 września,
     z tym samym powodem co w 0.410.0. Otwarcie SAMEGO ekranu nadal nie
     mutuje niczego; pilnuje tego `ekrany/Dyskusje.test.tsx`.

     Osobna trasa, nie trasa reklamacji, z dwóch powodów. Zdarzenie w dzienniku
     ma mówić, z którego ekranu padło kliknięcie (§25c.9). Warunek `typ` nie
     pozwala tą drogą odświeżyć reklamacji, a 404 mówi „dyskusji”. */
  app.post<{ Params: { id: string } }>(
    "/api/obsluga/dyskusje/:id/odswiez", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      /* Istnienie PRZED parowaniem: numer reklamacji ma dostać „nie ma takiej
         dyskusji”, a nie radę, żeby sparować konto. */
      const id = Number(req.params.id);
      const jest = db().prepare(
        "SELECT 1 FROM reklamacja_klienta WHERE id = ? AND typ = 'DISPUTE'").get(id);
      if (!jest) return reply.code(404).send({ error: "Nie znaleziono dyskusji" });
      if (!config.allegro.clientId) {
        return reply.code(400).send({ error: "Konto Allegro nie jest sparowane" });
      }
      try {
        if (!await odswiezSprawe(id)) {
          return reply.code(404).send({ error: "Nie znaleziono dyskusji" });
        }
        logEvent("dyskusja_odswiezenie", autor(), null, { id });
        return szczegolDyskusji(db(), id);
      } catch (e) {
        /* Zdanie z adaptera mówi, co naprawić — token, uprawnienie, limit. */
        return reply.code(502).send({ error: (e as Error).message });
      }
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
        const s = sesjaZadania()!;
        return {
          dyskusja: zapiszNotatkeDyskusji(db(), Number(req.params.id), n ?? null,
            { id: s.user.userId, name: s.user.name }, req.body?.wersja),
        };
      } catch (e) { return blad(reply, e); }
    });

  /* Cofnięcie ZMIANY notatki — powód przy tej samej trasie w reklamacjach.
     Prośba o zakończenie drogi powrotnej NIE dostaje i dostać nie może:
     idzie do kupującego i Allegro jej nie cofnie. */
  app.post<{ Params: { id: string }; Body: { wersja?: number } }>(
    "/api/obsluga/dyskusje/:id/notatka/cofnij", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        const s = sesjaZadania()!;
        return {
          dyskusja: cofnijNotatkeDyskusji(db(), Number(req.params.id),
            { id: s.user.userId, name: s.user.name }, req.body?.wersja),
        };
      } catch (e) { return blad(reply, e); }
    });
}
