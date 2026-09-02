import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import {
  dodajDowod, kolejkaPropozycji, rozstrzygnijZastosowanie, szukajModeli, WiedzaConflict,
  wycofajZastosowanie, zaproponujZastosowanie, zastosowaniaTowaru, type NowaPropozycja,
} from "../services/wiedza.js";

/* ── Trasy bazy wiedzy (§12, etap E2) ────────────────────────────────────────
   CZTERY ZAPISY: propozycja, rozstrzygnięcie, wycofanie, dowód. Każdy idzie
   przez serwis, który sprawdza konto biura PRZED zapisem — trasa nie ma
   własnej listy ról poza bramką odczytu.

   Adres `wiedza/*`, nie `dopasowania/*` z §16: `dopasowanie` to nazwa
   spalona w bazie i nie ożywiamy jej nawet w URL-u.

   Bramka roli stoi także na odczycie: wiedza niesie numery rozmów i imiona
   agentów; hala pracuje na kolektorze i nie ma po co tu zaglądać.          */

const BIURO = ["biuro", "admin"];

const blad = (reply: FastifyReply, e: unknown) =>
  reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) return reply.code(403).send({ error: "Bazę wiedzy prowadzi biuro" });
  return null;
}

export async function wiedzaRoutes(app: FastifyInstance) {
  const konflikt = (reply: FastifyReply, e: unknown) => e instanceof WiedzaConflict
    ? reply.code(409).send({ error: e.message, ...e.details }) : blad(reply, e);
  const ja = () => sesjaZadania()!.user;

  app.get("/api/obsluga/wiedza/kolejka", async (_req, reply) =>
    odmowa(reply) ?? kolejkaPropozycji());

  app.get<{ Querystring: { q?: string } }>("/api/obsluga/wiedza/modele", async (req, reply) =>
    odmowa(reply) ?? { modele: szukajModeli(req.query.q ?? "") });

  app.get<{ Params: { twId: string } }>("/api/obsluga/wiedza/towar/:twId", async (req, reply) =>
    odmowa(reply) ?? zastosowaniaTowaru(Number(req.params.twId)));

  /* Ręczna propozycja z ekranu Wiedza. Autor to sesja — nigdy pole z ciała. */
  app.post<{ Body: Partial<NowaPropozycja> }>("/api/obsluga/wiedza/propozycje", async (req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    try {
      const b = req.body ?? {};
      const z = zaproponujZastosowanie({
        twId: Number(b.twId), model: b.model!, polaryzacja: b.polaryzacja!,
        powodNegatywny: b.powodNegatywny ?? null, komentarz: b.komentarz ?? null,
        zrodlo: "reczne", dowod: b.dowod!, zastepujeId: b.zastepujeId ?? null,
      }, { userId: ja().userId, name: ja().name });
      /* Duplikat to odmowa ze zdaniem, nie cichy sukces: agent ma wiedzieć,
         że ta para już czeka albo stoi. */
      if (!z) return reply.code(409).send({ error: "Ta para kartoteka–model już czeka w kolejce albo jest zatwierdzona" });
      return z;
    } catch (e) { return blad(reply, e); }
  });

  app.post<{ Params: { id: string }; Body: { decyzja?: "zatwierdz" | "odrzuc"; powod?: string | null } }>(
    "/api/obsluga/wiedza/:id/rozstrzygnij", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return rozstrzygnijZastosowanie(Number(req.params.id), req.body?.decyzja as "zatwierdz" | "odrzuc",
          req.body?.powod ?? null, ja().userId);
      } catch (e) { return konflikt(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { powod?: string | null } }>(
    "/api/obsluga/wiedza/:id/wycofaj", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try { return wycofajZastosowanie(Number(req.params.id), req.body?.powod ?? null, ja().userId); }
      catch (e) { return blad(reply, e); }
    });

  app.post<{ Params: { id: string }; Body: { rodzaj?: string; tresc?: string; link?: string | null } }>(
    "/api/obsluga/wiedza/:id/dowody", async (req, reply) => {
      const nie = odmowa(reply); if (nie) return nie;
      try {
        return dodajDowod(Number(req.params.id), {
          rodzaj: req.body?.rodzaj as never, tresc: req.body?.tresc ?? "", link: req.body?.link ?? null,
        }, ja().userId);
      } catch (e) { return blad(reply, e); }
    });
}
