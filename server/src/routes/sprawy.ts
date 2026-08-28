import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { stanPolaczenia } from "../services/allegro-token.js";
import {
  RODZAJE_SPRAW,
  licznikSpraw,
  listaSpraw,
  powiazaneSprawy,
  sprawyKlienta,
  szukajKlientow,
  type RodzajSprawy,
} from "../services/sprawy.js";
import { BladPytania, stempelProwadzi } from "../services/pytania.js";
import { BladZwrotu, stempelProwadziZwrotu } from "../services/zwroty.js";
import { stempelProwadziReklamacji } from "../services/reklamacje.js";
import { BladDyskusji, stempelProwadziDyskusji } from "../services/dyskusje.js";

/* ── Sprawy — trasy jednej kolejki obsługi klienta ───────────────────────────
   Prawie wyłącznie ODCZYT: kolejka, licznik na zakładkę, Klient 360
   i powiązania. Mutacje mieszkają przy rejestrach źródłowych (pytania.ts,
   zwroty.ts, dyskusje.ts) — sprawa to widok, nie nowy byt. Bramka biuro|admin
   jak przy dyskusjach: prowadzenie spraw klienckich to robota biura, nie hali.

   JEDEN WYJĄTEK od „wyłącznie odczytu" (0.121.0): przejęcie sprawy. I on też
   nie łamie reguły, tylko ją potwierdza — trasa NIC nie zapisuje sama, jedynie
   rozdziela na cztery istniejące stemple przy rejestrach źródłowych. Musi
   stać tutaj, bo klika się ją Z KOLEJKI, a kolejka nie wie, do którego
   rejestru należy wiersz — to jest właśnie ta wiedza, którą ten moduł niesie.

   Dlaczego w ogóle: przy 168 sprawach w kolejce i kilku osobach w biurze
   kolumna PROWADZI miała myślnik w KAŻDYM wierszu, bo znacznik stawiało
   dopiero wejście w sprawę. Dwie osoby odpowiadały na to samo pytanie i nikt
   się o tym nie dowiadywał.                                                  */

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

  /* Liczba mnoga obok istniejącej pojedynczej i to nie jest przypadek:
     `/klient` POKAZUJE jednego, `/klienci` SZUKA wielu. Odczyt jak cała
     rodzina spraw — SQLite, zero ruchu do Allegro (audyt 0.109.1). */
  app.get<{ Querystring: { q?: string } }>("/api/biuro/sprawy/klienci", async (req, reply) => {
    const nie = odmowa();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    return { klienci: szukajKlientow(req.query.q ?? "") };
  });

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

  // ── Przejęcie sprawy ──────────────────────────────────────────────────────

  /**
   * „Wezmę to" z kolejki. ZNACZNIK, NIE BLOKADA: nie odbiera nikomu dostępu,
   * mówi tylko, że ktoś przy tej sprawie siedzi. Każdy rejestr stempluje
   * po swojemu i sam pilnuje swoich warunków (sprawa zamknięta odmawia),
   * więc tutaj zostaje wyłącznie rozdzielenie po rodzaju.
   *
   * Reklamacja bierze `id` POZYCJI zwrotu, nie zwrotu — tak samo jak wiersz
   * kolejki, który ją niesie (`sprawyReklamacji` zwraca `p.id`).
   */
  app.post<{ Params: { rodzaj: string; id: string } }>(
    "/api/biuro/sprawy/:rodzaj/:id/prowadzi",
    async (req, reply) => {
      const nie = odmowa();
      if (nie) return reply.code(nie.kod).send({ error: nie.error });
      const rodzaj = rodzajZapytania(req.params.rodzaj);
      const id = Number(req.params.id);
      if (rodzaj === null || rodzaj === "blad" || !Number.isInteger(id) || id <= 0) {
        return reply
          .code(400)
          .send({ error: `Podaj rodzaj (${RODZAJE_SPRAW.join(", ")}) i dodatnie id sprawy` });
      }
      const autor = sesjaZadania()?.user.name ?? "?";
      /* Każdy rejestr rzuca SWOIM błędem z własnym kodem HTTP („sprawa
         zamknięta", „nie ma takiej pozycji") — i te kody muszą dojechać do
         kolejki. Bez tego odmowa wyglądałaby na awarię serwera, a klik
         w wierszu po cichu nie robiłby nic. `BladZwrotu` obsługuje też
         reklamacje: `stempelProwadziReklamacji` rzuca właśnie nim. */
      try {
        if (rodzaj === "pytanie") stempelProwadzi(id, autor);
        else if (rodzaj === "zwrot") stempelProwadziZwrotu(id, autor);
        else if (rodzaj === "dyskusja") stempelProwadziDyskusji(id, autor);
        else stempelProwadziReklamacji(id, autor);
      } catch (e) {
        if (e instanceof BladZwrotu || e instanceof BladPytania || e instanceof BladDyskusji) {
          return reply.code(e.kod).send({ error: e.message });
        }
        throw e;
      }
      return { prowadzi: autor };
    }
  );
}
