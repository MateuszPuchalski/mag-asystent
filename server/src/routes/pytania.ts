import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { allegroAdapter } from "../adapters/allegro.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import { stanAI } from "../services/ai.js";
import {
  BladPytania,
  dogenerujSzkice,
  generujSzkic,
  kontekstPytania,
  licznikOtwartych,
  listaPytan,
  oknoDniPytan,
  pobierzKonfiguracje,
  pytanieZWklejki,
  statystykiPytan,
  synchronizujPytania,
  historiaKlienta,
  licznikiPytan,
  stanSynchronizacjiPytan,
  stempelProwadzi,
  szczegolPytania,
  wyslijOdpowiedz,
  zapiszFakty,
  zapiszOdpowiedz,
  zapiszPrompt,
  zmienStatus,
} from "../services/pytania.js";

/* ── Pytania klientów — trasy biura ──────────────────────────────────────────
   Bramka biuro|admin (wzorzec zwroty.ts): odpowiedź idzie do klienta w imieniu
   firmy, więc to nie jest operacja z hali. Prompt eksperta i fakty firmowe —
   wyłącznie admin: to one decydują, co aplikacja mówi klientom, czyli mają
   ciężar poświadczeń, nie ustawienia widoku.

   Awaria integracji (Allegro albo model) wraca jako 502 ze zdaniem
   z adaptera — ono mówi, co naprawić.                                        */

const ORZEKAJACY = ["biuro", "admin"];

export async function pytaniaRoutes(app: FastifyInstance) {
  function odmowa(rola: string[] = ORZEKAJACY): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!rola.includes(s.user.role)) {
      return {
        kod: 403,
        error:
          rola.length === 1
            ? "Prompt eksperta i fakty firmowe zmienia wyłącznie admin"
            : "Pytania klientów są dostępne dla biura",
      };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  /** BladPytania niesie kod HTTP; reszta to 500 i niech Fastify ją zaloguje. */
  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladPytania) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  /** Ta sama obsługa dla ścieżek dotykających Allegro albo modelu. */
  async function zIntegracja<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof BladPytania) return reply.code(e.kod).send({ error: e.message });
      return reply.code(502).send({ error: (e as Error).message });
    }
  }

  // ── Lista i licznik ───────────────────────────────────────────────────────

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    "/api/biuro/pytania",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return {
        pytania: listaPytan({
          status: req.query.status || undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
        ai: stanAI(),
        allegro: stanPolaczenia(),
        otwartych: licznikOtwartych(),
        ...licznikiPytan(),
        synchronizacja: stanSynchronizacjiPytan(),
      };
    }
  );

  /* Osobna, celowo TANIA trasa: licznik na zakładce odświeża się co 30 s
     razem z resztą panelu, a pełna lista z każdym odświeżeniem byłaby
     zapytaniem o setki wierszy dla jednej liczby w nawiasie. */
  app.get("/api/biuro/pytania/licznik", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    /* Ślad ostatniego pobrania jedzie i tutaj, nie tylko z pełną listą:
       ta trasa chodzi co 30 s, więc zdanie „ostatnio pytaliśmy o 14:02"
       starzeje się na ekranie samo, bez wchodzenia na zakładkę. */
    return {
      otwartych: licznikOtwartych(),
      ...licznikiPytan(),
      synchronizacja: stanSynchronizacjiPytan(),
    };
  });

  // ── Synchronizacja i wklejka ──────────────────────────────────────────────

  app.post("/api/biuro/pytania/odswiez", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => {
      const wynik = await synchronizujPytania(autor());
      /* Szkice od razu po synchronizacji — kliknięcie ODŚWIEŻ ma dać listę
         gotową do czytania, tak samo jak przebieg tickera.

         Limit jest NIŻSZY niż w tickerze i nie chodzi o oszczędność: przy
         kliknięciu ktoś CZEKA na odpowiedź, a każdy szkic to nawet
         kilkanaście sekund pracy modelu. Dwadzieścia z rzędu zamieniłoby
         przycisk w kilkuminutowe zawieszenie. Resztę policzy ticker w tle. */
      const szkicow = await dogenerujSzkice(autor(), 5);
      return { ...wynik, szkicow, otwartych: licznikOtwartych() };
    });
  });

  app.post<{ Body: { tekst?: string; obraz?: string; mime?: string } }>(
    "/api/biuro/pytania/wklejka",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const b = req.body ?? {};
      return zIntegracja(reply, async () => ({
        pytanie: await pytanieZWklejki(
          { tekst: b.tekst, obrazBase64: b.obraz, mime: b.mime },
          autor()
        ),
      }));
    }
  );

  // ── Statystyki i konfiguracja modelu ──────────────────────────────────────

  app.get<{ Querystring: { dni?: string; osoba?: string } }>("/api/biuro/pytania/statystyki", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return {
      statystyki: statystykiPytan(oknoDniPytan(req.query.dni), req.query.osoba),
    };
  });

  app.get("/api/biuro/pytania/prompt", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { konfiguracja: pobierzKonfiguracje(), ai: stanAI() };
  });

  app.put<{ Body: { prompt?: string } }>("/api/biuro/pytania/prompt", async (req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { konfiguracja: zapiszPrompt(req.body?.prompt ?? "", autor()) };
  });

  app.put<{ Body: { fakty?: string } }>("/api/biuro/pytania/fakty", async (req, reply) => {
    const nie = odmowa(["admin"]);
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { konfiguracja: zapiszFakty(req.body?.fakty ?? "", autor()) };
  });

  // ── Jedno pytanie ─────────────────────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/biuro/pytania/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => {
      const pytanie = szczegolPytania(Number(req.params.id));
      /* Karty towarów obok szkicu: zdjęcie, stan i półka biorą się z tego
         samego kontekstu, który dostał model — człowiek weryfikuje dobór
         bez przełączania się do Subiekta. */
      const kontekst = await kontekstPytania(pytanie);
      return {
        pytanie,
        kartoteki: kontekst.kartoteki.map((k) => ({
          ...k,
          zdjecieUrl: `/api/products/${k.twId}/zdjecie`,
        })),
        oferty: kontekst.oferty,
        /* Reszta kontekstu szła dotąd WYŁĄCZNIE do modelu. Człowiek ma prawo
           wiedzieć to samo: czego szukaliśmy, co już potwierdziliśmy i czy
           pusta lista aukcji znaczy „nie mamy", czy „nie udało się sprawdzić". */
        bladOfert: kontekst.bladOfert,
        frazy: kontekst.frazy,
        dopasowania: kontekst.dopasowania,
        poprzednie: kontekst.poprzednie,
      };
    });
  });

  /* Historia klienta — osobno i na klik. Wpięcie jej w szczegół dołożyłoby
     dwa zapytania do każdego otwarcia sprawy, a potrzebna jest przy części
     z nich: wtedy, gdy login coś mówi. */
  app.get<{ Params: { id: string } }>("/api/biuro/pytania/:id/klient", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => ({ historia: historiaKlienta(Number(req.params.id)) }));
  });

  /* Rozmowa czytana NA ŻĄDANIE i nietrzymana u nas — ta sama zasada co przy
     zwrotach: prywatna korespondencja ma jedno miejsce prawdy w Allegro. */
  app.get<{ Params: { id: string } }>("/api/biuro/pytania/:id/wiadomosci", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => {
      const p = szczegolPytania(Number(req.params.id));
      if (!p.threadId) return { watek: null, zrodlo: p.zrodlo };
      return {
        watek: {
          threadId: p.threadId,
          /* Login kupującego jedzie razem z pytaniem od 0.80.0 — bez niego
             rozmowa bez ról autora wyświetlała się w całości jako nasza. */
          wiadomosci: await allegroAdapter().wiadomosciWatku(p.threadId, p.kupujacyLogin),
        },
        zrodlo: p.zrodlo,
      };
    });
  });

  app.post<{ Params: { id: string } }>("/api/biuro/pytania/:id/generuj", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => {
      /* Policzenie szkicu DLA JEDNEJ sprawy jest pracą nad nią, więc stempluje
         prowadzącego. Zbiorcze `dogenerujSzkice` (ticker, ODŚWIEŻ) tego nie
         robi — patrz `stempelProwadzi`. */
      const pytanie = await generujSzkic(Number(req.params.id), autor());
      stempelProwadzi(pytanie.id, autor());
      return { pytanie: szczegolPytania(pytanie.id) };
    });
  });

  app.put<{ Params: { id: string }; Body: { odpowiedz?: string } }>(
    "/api/biuro/pytania/:id",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => ({
        pytanie: zapiszOdpowiedz(Number(req.params.id), req.body?.odpowiedz ?? "", autor()),
      }));
    }
  );

  app.post<{ Params: { id: string }; Body: { odpowiedz?: string } }>(
    "/api/biuro/pytania/:id/wyslij",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zIntegracja(reply, async () => {
        /* Treść z ekranu zapisujemy PRZED wysyłką: inaczej poprawka wpisana
           i niezapisana poszłaby do klienta w starej wersji. */
        if (req.body?.odpowiedz !== undefined) {
          zapiszOdpowiedz(Number(req.params.id), req.body.odpowiedz, autor());
        }
        const wynik = await wyslijOdpowiedz(Number(req.params.id), autor());
        return { ...wynik, otwartych: licznikOtwartych() };
      });
    }
  );

  for (const status of ["zamknij", "pomin"] as const) {
    app.post<{ Params: { id: string } }>(`/api/biuro/pytania/:id/${status}`, async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => ({
        ...zmienStatus(
          Number(req.params.id),
          status === "zamknij" ? "zamkniete" : "pominiete",
          autor()
        ),
        otwartych: licznikOtwartych(),
      }));
    });
  }
}
