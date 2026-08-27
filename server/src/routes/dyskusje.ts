import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  BladDyskusji,
  BladSwiezosciDyskusji,
  generujSzkicDyskusji,
  licznikDyskusji,
  listaDyskusji,
  stanSynchronizacjiDyskusji,
  synchronizujDyskusje,
  szczegolDyskusji,
  wiadomosciDyskusji,
  wyslijOdpowiedzDyskusji,
  zapiszNotatkeDyskusji,
  zapiszOdpowiedzDyskusji,
  zmienStatusDyskusji,
  type ZalacznikDyskusji,
} from "../services/dyskusje.js";
import { kontekstKlienta } from "../services/klienci.js";
import { db } from "../db/db.js";

/* ── Dyskusje i reklamacje Allegro — trasy biura ─────────────────────────────
   Bramka biuro|admin (wzorzec pytania.ts): prowadzenie spraw klienckich to
   robota biura, nie hali. Awaria integracji przy synchronizacji wraca jako
   502 ze zdaniem z adaptera — ono mówi, co naprawić (token, uprawnienie).   */

const ORZEKAJACY = ["biuro", "admin"];

export async function dyskusjeRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Dyskusje Allegro są dostępne dla biura" };
    }
    return null;
  }

  const autor = (): string => sesjaZadania()?.user.name ?? "?";

  /** BladDyskusji niesie kod HTTP; reszta to 500 i niech Fastify ją zaloguje. */
  function zBledem<T>(reply: FastifyReply, fn: () => T): T | FastifyReply {
    try {
      return fn();
    } catch (e) {
      if (e instanceof BladDyskusji) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
  }

  /** Ta sama obsługa dla ścieżek dotykających Allegro albo modelu (wzorzec pytań). */
  async function zIntegracja<T>(
    reply: FastifyReply,
    fn: () => Promise<T>
  ): Promise<T | FastifyReply> {
    try {
      return await fn();
    } catch (e) {
      /* Świeżość niesie ŁADUNEK — panel pokazuje, co doszło (wzorzec pytań). */
      if (e instanceof BladSwiezosciDyskusji) {
        return reply.code(e.kod).send({ error: e.message, noweWiadomosci: e.wiadomosci });
      }
      if (e instanceof BladDyskusji) return reply.code(e.kod).send({ error: e.message });
      return reply.code(502).send({ error: (e as Error).message });
    }
  }

  // ── Lista i licznik ───────────────────────────────────────────────────────

  app.get<{ Querystring: { status?: string; limit?: string } }>(
    "/api/biuro/dyskusje",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return {
        dyskusje: listaDyskusji({
          status: req.query.status || undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
        }),
        ...licznikDyskusji(),
        synchronizacja: stanSynchronizacjiDyskusji(),
        allegro: stanPolaczenia(),
      };
    }
  );

  /* Osobna, celowo TANIA trasa — licznik na zakładce odświeża się co 30 s
     (ten sam powód co /api/biuro/pytania/licznik). */
  app.get("/api/biuro/dyskusje/licznik", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { ...licznikDyskusji(), synchronizacja: stanSynchronizacjiDyskusji() };
  });

  // ── Synchronizacja na żądanie ─────────────────────────────────────────────

  app.post("/api/biuro/dyskusje/odswiez", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    try {
      const wynik = await synchronizujDyskusje(autor());
      return { ...wynik, ...licznikDyskusji() };
    } catch (e) {
      /* Odmowa Allegro (wygasły token, brak uprawnienia disputes) ma dojść
         do człowieka, który kliknął — w logu serwera nikt jej nie szuka. */
      return reply.code(502).send({ error: (e as Error).message });
    }
  });

  // ── Szczegół i praca nad sprawą ───────────────────────────────────────────

  app.get<{ Params: { id: string } }>("/api/biuro/dyskusje/:id", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zBledem(reply, () => {
      const dyskusja = szczegolDyskusji(Number(req.params.id));
      /* Nagłówek powiązanego zwrotu od razu w szczególe — po to jest wiązanie:
         „ta sprawa dotyczy paczki, która u nas leży" ma być jednym spojrzeniem. */
      const zwrot = dyskusja.zwrotId
        ? ((db()
            .prepare("SELECT id, referencja, status, waybill FROM zwrot WHERE id = ?")
            .get(dyskusja.zwrotId) as
            | { id: number; referencja: string | null; status: string; waybill: string }
            | undefined) ?? null)
        : null;
      return {
        dyskusja,
        zwrot,
        klient: kontekstKlienta(dyskusja.kupujacyLogin, { dyskusjaId: dyskusja.id }),
      };
    });
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    "/api/biuro/dyskusje/:id/status",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      if (!req.body?.status) return reply.code(400).send({ error: "Brak pola status" });
      return zBledem(reply, () => ({
        dyskusja: zmienStatusDyskusji(Number(req.params.id), req.body!.status!, autor()),
      }));
    }
  );

  app.put<{ Params: { id: string }; Body: { notatka?: string } }>(
    "/api/biuro/dyskusje/:id/notatka",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => ({
        dyskusja: zapiszNotatkeDyskusji(Number(req.params.id), req.body?.notatka ?? "", autor()),
      }));
    }
  );

  // ── Rozmowa i odpowiedź (0.104.0) ─────────────────────────────────────────

  /* Rozmowa czytana z Allegro NA KLIK, bez zapisu u nas. `null` w odpowiedzi
     to treść, nie błąd: znaczy „sprawa niedostępna przez API dyskusji"
     i panel degraduje wtedy do linku do panelu Allegro. */
  app.get<{ Params: { id: string } }>(
    "/api/biuro/dyskusje/:id/wiadomosci",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zIntegracja(reply, async () => ({
        wiadomosci: await wiadomosciDyskusji(Number(req.params.id)),
      }));
    }
  );

  app.post<{ Params: { id: string } }>("/api/biuro/dyskusje/:id/generuj", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => ({
      dyskusja: await generujSzkicDyskusji(Number(req.params.id), autor()),
    }));
  });

  /* Parytet serwera dla zapisu szkicu bez wysyłki — panel tego nie woła
     (treść jedzie w body wysyłki, jak przy pytaniach), ale trasa domyka
     kontrakt: każdy stan z ekranu da się osiągnąć przez API. */
  app.put<{ Params: { id: string }; Body: { odpowiedz?: string } }>(
    "/api/biuro/dyskusje/:id/odpowiedz",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      return zBledem(reply, () => ({
        dyskusja: zapiszOdpowiedzDyskusji(
          Number(req.params.id),
          req.body?.odpowiedz ?? "",
          autor()
        ),
      }));
    }
  );

  app.post<{
    Params: { id: string };
    Body: {
      odpowiedz?: string;
      zalacznik?: ZalacznikDyskusji;
      ostatniaWidzianaId?: string;
      wymus?: boolean;
    };
  }>("/api/biuro/dyskusje/:id/wyslij", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return zIntegracja(reply, async () => {
      /* Poprawiona treść jedzie razem z wysyłką (wzorzec pytań): zapis
         najpierw, żeby flaga redakcji i prowadzący stanęły przed wyjściem
         wiadomości do klienta. */
      if (req.body?.odpowiedz !== undefined) {
        zapiszOdpowiedzDyskusji(Number(req.params.id), req.body.odpowiedz, autor());
      }
      return {
        dyskusja: await wyslijOdpowiedzDyskusji(Number(req.params.id), autor(), req.body?.zalacznik, {
          ostatniaWidzianaId: req.body?.ostatniaWidzianaId ?? null,
          wymus: req.body?.wymus === true,
        }),
      };
    });
  });
}
