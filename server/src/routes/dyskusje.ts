import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  BladDyskusji,
  licznikDyskusji,
  listaDyskusji,
  stanSynchronizacjiDyskusji,
  synchronizujDyskusje,
  szczegolDyskusji,
  zapiszNotatkeDyskusji,
  zmienStatusDyskusji,
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
}
