import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import {
  BladTagu, odepnijTag, przelaczTag, przypnijTag, slownikTagow, utworzTag, zmienNazweTagu,
} from "../services/tagi-spraw.js";

/* ── Trasy tagów spraw (0.279.0) ─────────────────────────────────────────────
   SŁOWNIK JEST WSPÓLNY dla reklamacji i dyskusji, więc trasy słownika stoją
   osobno, a nie pod `/reklamacje`. Przypięcie do sprawy zostaje tam, gdzie
   sprawa — w `routes/reklamacje.ts` i `routes/dyskusje.ts` — bo tamte trasy
   znają już swój `typ` i własną bramkę.

   Bramka roli na KAŻDEJ trasie, także na odczycie. Nazwa tagu jest zdaniem
   biura o sprawie klienta; magazyn nie ma po co jej czytać.

   OTWARCIE EKRANU NIE ZAPISUJE NIC. `GET` oddaje słownik taki, jaki jest —
   ziarno wsiewa `migrate()` przy starcie procesu, a nie pierwszy odczyt.    */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Tagi spraw prowadzi biuro" });
  }
  return null;
}

function blad(reply: FastifyReply, e: unknown) {
  if (e instanceof BladTagu) return reply.code(e.kod).send({ error: e.message });
  return reply.code(400).send({ error: (e as Error).message });
}

/** Autor mutacji: numer do śladu, imię do zdania na ekranie. */
const kto = () => {
  const s = sesjaZadania()!;
  return { id: s.user.userId, name: s.user.name };
};

export async function tagiRoutes(app: FastifyInstance) {
  app.get("/api/obsluga/tagi", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    return { tagi: slownikTagow(db()) };
  });

  app.post<{ Body: { nazwa?: string } }>("/api/obsluga/tagi", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return { tag: utworzTag(db(), String(req.body?.nazwa ?? ""), kto()) };
    } catch (e) { return blad(reply, e); }
  });

  /* Zmiana nazwy i włączanie/wyłączanie jedną trasą, bo to jedna karta
     w Ustawieniach i jeden wiersz słownika. Pola są rozłączne: przychodzi
     `nazwa` albo `aktywny`, nigdy oba naraz. */
  app.patch<{ Params: { id: string }; Body: { nazwa?: string; aktywny?: boolean } }>(
    "/api/obsluga/tagi/:id", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const id = Number(req.params.id);
      try {
        if (typeof req.body?.nazwa === "string") {
          return { tag: zmienNazweTagu(db(), id, req.body.nazwa, kto()) };
        }
        if (typeof req.body?.aktywny === "boolean") {
          return { tag: przelaczTag(db(), id, req.body.aktywny, kto()) };
        }
        return reply.code(400).send({ error: "Podaj nazwę albo stan tagu" });
      } catch (e) { return blad(reply, e); }
    });
}

/**
 * Przypięcie i zdjęcie tagu przy sprawie.
 *
 * JEDNA PARA TRAS NA OBA EKRANY, wołana z `routes/reklamacje.ts`
 * i `routes/dyskusje.ts` z ich własną bramką. Klucz jest tym samym wierszem
 * tej samej tabeli, a zdublowanie tras zdublowałoby też walidację numeru
 * sprawy — ta sama decyzja co przy załącznikach dyskusji w 0.245.0.
 */
export function trasyTagowSprawy(app: FastifyInstance, sciezka: string) {
  app.post<{ Params: { id: string; tagId: string } }>(
    `${sciezka}/:id/tagi/:tagId`, async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        const nowy = przypnijTag(db(), Number(req.params.id), Number(req.params.tagId), kto());
        /* `false` znaczy „już tam był" i NIE jest błędem: drugie kliknięcie
           w ten sam tag to drugie kliknięcie, a nie drugi fakt. */
        return { przypiety: nowy };
      } catch (e) { return blad(reply, e); }
    });

  app.delete<{ Params: { id: string; tagId: string } }>(
    `${sciezka}/:id/tagi/:tagId`, async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        const zdjety = odepnijTag(db(), Number(req.params.id), Number(req.params.tagId), kto());
        if (!zdjety) return reply.code(404).send({ error: "Ta sprawa nie ma tego tagu" });
        return { ok: true };
      } catch (e) { return blad(reply, e); }
    });
}
