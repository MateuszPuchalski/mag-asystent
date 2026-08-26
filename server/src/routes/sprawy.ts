import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  RODZAJE_SPRAW,
  licznikSpraw,
  listaSpraw,
  powiazaneSprawy,
  sprawyKlienta,
  type RodzajSprawy,
} from "../services/sprawy.js";

/* ── Sprawy — trasy jednej kolejki obsługi klienta ───────────────────────────
   Wyłącznie ODCZYT: kolejka, licznik na zakładkę, Klient 360 i powiązania.
   Mutacje mieszkają przy rejestrach źródłowych (pytania.ts, zwroty.ts,
   dyskusje.ts) — sprawa to widok, nie nowy byt. Bramka biuro|admin jak przy
   dyskusjach: prowadzenie spraw klienckich to robota biura, nie hali.        */

const ORZEKAJACY = ["biuro", "admin"];

export async function sprawyRoutes(app: FastifyInstance) {
  function odmowa(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (!ORZEKAJACY.includes(s.user.role)) {
      return { kod: 403, error: "Sprawy klientów są dostępne dla biura" };
    }
    return null;
  }

  /** Zły rodzaj to literówka w kliencie — 400 z listą, nie pusta odpowiedź. */
  function rodzajZapytania(surowy: string | undefined): RodzajSprawy | null | "blad" {
    if (!surowy) return null;
    return (RODZAJE_SPRAW as string[]).includes(surowy) ? (surowy as RodzajSprawy) : "blad";
  }

  // ── Kolejka ───────────────────────────────────────────────────────────────

  app.get<{ Querystring: { rodzaj?: string } }>("/api/biuro/sprawy", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    const rodzaj = rodzajZapytania(req.query.rodzaj);
    if (rodzaj === "blad") {
      return reply
        .code(400)
        .send({ error: `Nieznany rodzaj sprawy — dozwolone: ${RODZAJE_SPRAW.join(", ")}` });
    }
    return { sprawy: listaSpraw(rodzaj ?? undefined), allegro: stanPolaczenia() };
  });

  /* Osobna, celowo TANIA trasa — pigułka na zakładce odświeża się co 30 s
     (ten sam powód co /api/biuro/pytania/licznik). */
  app.get("/api/biuro/sprawy/licznik", async (_req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return licznikSpraw();
  });

  // ── Klient 360 ────────────────────────────────────────────────────────────

  /* Login w querystring, nie w ścieżce: to dowolny tekst z Allegro
     (ukośniki, spacje), a brak parametru ma czyste znaczenie — kubełek
     spraw bez klienta. */
  app.get<{ Querystring: { login?: string } }>(
    "/api/biuro/sprawy/klient",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const login = req.query.login?.trim() || null;
      return { login, ...sprawyKlienta(login) };
    }
  );

  // ── Powiązania ────────────────────────────────────────────────────────────

  app.get<{ Querystring: { rodzaj?: string; id?: string } }>(
    "/api/biuro/sprawy/powiazane",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const rodzaj = rodzajZapytania(req.query.rodzaj);
      const id = Number(req.query.id);
      if (rodzaj === null || rodzaj === "blad" || !Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      return powiazaneSprawy(rodzaj, id);
    }
  );
}
