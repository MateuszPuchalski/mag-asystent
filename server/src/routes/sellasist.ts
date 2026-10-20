import type { FastifyInstance, FastifyReply } from "fastify";
import { sellasistWlaczony } from "../adapters/sellasist.http.js";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { BladBraku, oznaczPowiadomiony } from "../services/brak-kompletacji.js";
import { BladNotatki, dodajNotatkeSellasist, widokSellasist } from "../services/sellasist-notatki.js";
import { stanSellasist } from "../services/sellasist-sync.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Sellasist — trasy biura ─────────────────────────────────────────────────
   Cztery trasy, cienkie: stan lustra dla analizy, wgląd w zamówienie, notatka
   do zamówienia dla profilu klienta i „Klient powiadomiony” przy braku
   z kompletacji. Logika i powody w `services/sellasist-*`.
   Numer zamówienia jedzie w adresie: to numer formularza zakupu, nie dana
   osobowa. Treść notatki jedzie w ciele, bo adres ląduje w logu żądań. */

const BIURO = ROLE_BIUROWE;

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) return reply.code(403).send({ error: "Sellasist w WERTIS obsługuje biuro" });
  return null;
}

export async function sellasistRoutes(app: FastifyInstance) {
  app.get("/api/biuro/sellasist/stan", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    return stanSellasist(db(), sellasistWlaczony());
  });

  /* GET bez zapisu: lustro czytamy, notatki pytamy na żywo i nie zapisujemy. */
  app.get<{ Params: { zamowienie: string } }>("/api/obsluga/sellasist/zamowienie/:zamowienie", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    return widokSellasist(db(), req.params.zamowienie);
  });

  app.post<{ Params: { zamowienie: string }; Body: { tekst?: unknown } }>(
    "/api/obsluga/sellasist/zamowienie/:zamowienie/notatka", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      if (typeof req.body?.tekst !== "string") return reply.code(400).send({ error: "Pole `tekst` musi być tekstem" });
      const s = sesjaZadania()!;
      try {
        await dodajNotatkeSellasist(db(), req.params.zamowienie, req.body.tekst, { id: s.user.userId, name: s.user.name });
      } catch (e) {
        if (e instanceof BladNotatki) return reply.code(e.kod).send({ error: e.message });
        throw e;
      }
      return widokSellasist(db(), req.params.zamowienie);
    });

  /* Wejście w status jedzie w ciele, bo przycisk dotyczy braku, który ekran
     widział. Nowsze wejście to 409, nie cichy zapis za inny brak. */
  app.post<{ Params: { id: string }; Body: { statusAt?: unknown } }>(
    "/api/obsluga/sellasist/braki/:id/powiadomiony", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "Numer zamówienia Sellasist" });
      if (typeof req.body?.statusAt !== "string") {
        return reply.code(400).send({ error: "Pole `statusAt` musi być tekstem" });
      }
      const s = sesjaZadania()!;
      try {
        return oznaczPowiadomiony(db(), id, req.body.statusAt, { id: s.user.userId, name: s.user.name });
      } catch (e) {
        if (e instanceof BladBraku) return reply.code(e.kod).send({ error: e.message });
        throw e;
      }
    });
}
