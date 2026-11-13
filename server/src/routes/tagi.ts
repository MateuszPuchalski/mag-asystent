import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import {
  BladTagu, przelaczTag, slownikTagow, utworzTag, zmienNazweTagu,
} from "../services/tagi-spraw.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Trasy słownika tagów spraw ──────────────────────────────────────────────
   Zostaje sam słownik, który prowadzi ekran Ustawień. Przypinania tagu do
   sprawy nie ma już na żadnym ekranie, więc jego tras też nie ma.

   Bramka roli na KAŻDEJ trasie, także na odczycie. Nazwa tagu jest zdaniem
   biura o sprawie klienta; magazyn nie ma po co jej czytać.

   OTWARCIE EKRANU NIE ZAPISUJE NIC. `GET` oddaje słownik taki, jaki jest —
   ziarno wsiewa `migrate()` przy starcie procesu, a nie pierwszy odczyt.    */

const BIURO = ROLE_BIUROWE;

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
