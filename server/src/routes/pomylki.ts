import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import {
  BladPomylki, BrakPomylki, KonfliktPomylki, biezacyMiesiac, dodajPomylke, licznikDoUzupelnienia,
  listaPomylek, podsumowanieMiesiaca, pozycjeDoWyboru, wznowPomylke, zakonczPomylke, zmienPomylke,
  type NowaPomylka, type ZmianaPomylki,
} from "../services/pomylki.js";
import { sellasistWlaczony } from "../adapters/sellasist.http.js";
import { config } from "../config.js";
import { zlapanePomylki } from "../services/sellasist-sync.js";
import { ROLE_BIUROWE } from "../services/users.js";

/* ── Pomyłki wysyłkowe: trasy zakładki ───────────────────────────────────────
   Cienkie: sesja, rola, serwis, tłumaczenie błędu na kod HTTP. Logika i dziennik
   siedzą w `services/pomylki.ts`.

   BRAMKA ROLI TAKŻE NA ODCZYCIE. Pomyłka niesie login klienta, numer
   zamówienia i imiona pracowników — dane biura, nie hali.

   ZESTAWIENIE NA OSOBĘ WIDZI WYŁĄCZNIE ADMIN. Rachunek win per pracownik to
   monitoring pracowniczy (art. 22² KP), decyzja właściciela w polityce danych
   sprawy klienta (`docs/obsluga-klienta.md`). Biuro widzi imiona i winę przy
   pojedynczej pomyłce, bo bez nich wiersza nie da się uzupełnić.

   Listę osób do wyboru panel bierze z istniejącego `GET /api/users`: zwraca
   rolę i aktywność, a widzi ją biuro. Druga lista rozjechałaby się z nią. */

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!ROLE_BIUROWE.includes(s.user.role)) {
    return reply.code(403).send({ error: "Rejestr pomyłek prowadzi biuro" });
  }
  return null;
}

const autor = () => {
  const u = sesjaZadania()!.user;
  return { id: u.userId, name: u.name };
};

function blad(reply: FastifyReply, e: unknown) {
  if (e instanceof KonfliktPomylki) {
    return reply.code(409).send({ kod: "konflikt", error: e.message, pomylka: e.pomylka });
  }
  if (e instanceof BrakPomylki) return reply.code(404).send({ error: e.message });
  if (e instanceof BladPomylki) return reply.code(400).send({ error: e.message });
  throw e;
}

export async function pomylkiRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { stan?: string; miesiac?: string } }>("/api/pomylki", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      const pomylki = listaPomylek({ stan: req.query.stan, miesiac: req.query.miesiac }, db());
      const podsumowanie = podsumowanieMiesiaca(req.query.miesiac ?? biezacyMiesiac(), db());
      if (sesjaZadania()!.user.role !== "admin") podsumowanie.osoby = [];
      return { pomylki, podsumowanie, doUzupelnienia: licznikDoUzupelnienia(db()) };
    } catch (e) {
      return blad(reply, e);
    }
  });

  /* Pomyłki złapane przy pakowaniu, z Sellasist. Liczba na dobę bez osób,
     więc widzi ją całe biuro, nie tylko admin. Czysty odczyt lustra.
     Zatrzymane lustro wyłącza blok, bo nie czyta dziennika. */
  app.get("/api/pomylki/zlapane", async (_req, reply) => {
    const nie = odmowa(reply); if (nie) return nie;
    const s = config.sellasist;
    return zlapanePomylki(db(), sellasistWlaczony() && s.syncMs > 0 && s.statusyPomylka.length > 0);
  });

  app.get("/api/pomylki/licznik", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    return { doUzupelnienia: licznikDoUzupelnienia(db()) };
  });

  app.get<{ Params: { id: string } }>("/api/pomylki/:id/pozycje", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return pozycjeDoWyboru(Number(req.params.id), db());
    } catch (e) {
      return blad(reply, e);
    }
  });

  /* 201 dla nowej, 200 dla istniejącej: drugie „Zła paczka” przy tym samym
     zamówieniu ma przenieść do wiersza, który już stoi, a nie robić drugi. */
  app.post<{ Body: NowaPomylka }>("/api/pomylki", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      const w = dodajPomylke(req.body ?? {}, autor(), new Date(), db());
      return reply.code(w.nowa ? 201 : 200).send({ pomylka: w.pomylka });
    } catch (e) {
      return blad(reply, e);
    }
  });

  app.patch<{ Params: { id: string }; Body: ZmianaPomylki }>("/api/pomylki/:id", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return { pomylka: zmienPomylke(Number(req.params.id), req.body ?? {}, autor(), new Date(), db()) };
    } catch (e) {
      return blad(reply, e);
    }
  });

  app.post<{ Params: { id: string }; Body: { wersja?: unknown } }>("/api/pomylki/:id/zakoncz", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return { pomylka: zakonczPomylke(Number(req.params.id), req.body?.wersja, autor(), new Date(), db()) };
    } catch (e) {
      return blad(reply, e);
    }
  });

  app.post<{ Params: { id: string }; Body: { wersja?: unknown } }>("/api/pomylki/:id/wznow", async (req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    try {
      return { pomylka: wznowPomylke(Number(req.params.id), req.body?.wersja, autor(), new Date(), db()) };
    } catch (e) {
      return blad(reply, e);
    }
  });
}
