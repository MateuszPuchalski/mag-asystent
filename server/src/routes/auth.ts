import type { FastifyInstance } from "fastify";
import { currentDevice, currentToken } from "../context.js";
import { autoryzuj, przejmij, sesja, wyloguj, zaloguj } from "../services/auth.js";
import { logEvent } from "../services/events.js";
import {
  brakKont,
  createUser,
  listUsers,
  migrujHistorie,
  setActive,
  setPin,
  type Rola,
} from "../services/users.js";

/* ── Tożsamość: badge zamiast wolnego tekstu (plan §7) ──────────────────────
   Jeden skan na ścieżce codziennej. PIN dopiero tam, gdzie badge nie
   wystarcza, bo badge'e bywają pożyczane.                                    */

// Token czyta kontekst żądania (`context.ts`), a nie każda trasa z osobna —
// druga kopia odczytu nagłówka to druga okazja do rozjazdu.
const token = currentToken;

export async function authRoutes(app: FastifyInstance) {
  /** Skan badge'a → sesja urządzenia. */
  app.post<{ Body: { badge?: string } }>("/api/auth/badge", async (req, reply) => {
    const s = zaloguj(req.body?.badge ?? "", currentDevice());
    if (!s) {
      // jeden komunikat dla „nie ma takiego" i „zła cyfra kontrolna" — dla
      // człowieka to ten sam wniosek, a rozróżnianie kusiłoby do prób
      return reply.code(401).send({ error: "Nieznany badge albo uszkodzona etykieta" });
    }
    return { token: s.token, user: s.user };
  });

  /**
   * Kim jestem — kolektor pyta przy starcie i po powrocie z tła.
   *
   * Odpowiedź nie niesie już stanu blokady ani TTL: sesja trwa do jawnego
   * wylogowania albo przejęcia pracy. Zostaje jedno pytanie, na które ta trasa
   * odpowiada — „czy ten token nadal wskazuje czynne konto".
   */
  app.get("/api/auth/me", async (_req, reply) => {
    const s = sesja(token());
    if (!s) return reply.code(401).send({ error: "Brak sesji" });
    return { user: s.user };
  });

  /**
   * Przejęcie pracy przez inną osobę — JAWNE, nigdy po cichu.
   * Kolektor wywołuje to dopiero po potwierdzeniu przez człowieka.
   */
  app.post<{ Body: { badge?: string; kontekst?: string } }>(
    "/api/auth/handover",
    async (req, reply) => {
      const s = przejmij(
        token() ?? "",
        req.body?.badge ?? "",
        currentDevice(),
        req.body?.kontekst
      );
      if (!s) return reply.code(401).send({ error: "Nieznany badge albo uszkodzona etykieta" });
      return { token: s.token, user: s.user };
    }
  );

  app.post("/api/auth/logout", async () => {
    const t = token();
    if (t) wyloguj(t);
    return { ok: true };
  });

  /* PIN sprawdza TA TRASA, która wykonuje operację, a nie osobne „czy mój PIN
     jest dobry". Osobne wejście dawałoby dwa miejsca, w których wolno
     powiedzieć „ok", i tylko jedno, które faktycznie coś robi — a sprawdzenie
     oderwane od skutku zawsze kiedyś od niego odjedzie.                      */

  /* ── Administracja kontami — WYŁĄCZNIE biuro z PIN-em ─────────────────────
     Te trasy tworzą TOŻSAMOŚĆ, więc bez strażnika cała reszta §7 jest
     dekoracją: `GET /api/users` wystawia `badgeCode` każdego, a logowanie to
     sam skan badge'a, więc jedno żądanie z sieci magazynu daje listę
     wszystkich tożsamości i możliwość zalogowania się jako dowolna z nich.
     `POST /api/users` pozwalałby założyć konto biura z własnym PIN-em,
     a `:id/pin` zresetować cudzy.

     Dlatego: rola `biuro` + PIN przy każdej zmianie, a `GET` co najmniej za
     sesją biura. PIN-u przy odczycie nie wymagamy — lista kont jest potrzebna
     przy każdym wydruku plakietek, a wpisywanie PIN-u do czytania zamieniłoby
     go w odruch, czyli w nic.                                                */

  /**
   * Czy instalacja jest jeszcze pusta — pytanie zadawane przez kolektor przy
   * pierwszym starcie.
   *
   * Bez tego kolektor nie odróżnia „system dopiero powstaje" od „zeskanowałeś
   * zły badge": obie sytuacje wyglądają jak 401 z `/api/auth/badge`. Człowiek
   * rozpakowujący kolektor w poniedziałek rano zobaczyłby ekran proszący
   * o skan plakietki, których jeszcze nikt nie wydrukował.
   *
   * Odpowiedź nie jest tajemnicą: dokładnie tę samą informację ujawnia próba
   * założenia konta (`POST /api/users` przechodzi albo żąda sesji).
   */
  app.get("/api/setup", async () => ({ potrzebne: brakKont() }));

  /** Sesja biura + PIN; `null` = zgoda, obiekt = odmowa gotowa do odesłania. */
  function odmowaZarzadzania(pin: string | null): { kod: number; error: string } | null {
    const s = sesja(token());
    if (!s) return { kod: 401, error: "Brak sesji — zeskanuj badge" };
    const w = autoryzuj(s.user, "zarzadzanie_kontami", pin);
    return w.ok ? null : { kod: 403, error: w.powod ?? "Brak uprawnień" };
  }

  app.get("/api/users", async (_req, reply) => {
    const s = sesja(token());
    if (!s) return reply.code(401).send({ error: "Brak sesji — zeskanuj badge" });
    if (s.user.role !== "biuro") {
      // kody badge'y to lista tożsamości — nie wystawiamy jej hali
      return reply.code(403).send({ error: "Lista kont jest dostępna tylko dla biura" });
    }
    return { users: listUsers() };
  });

  app.post<{
    Body: { name?: string; role?: Rola; pin?: string; pinAutora?: string };
  }>("/api/users", async (req, reply) => {
    const name = (req.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "Podaj imię i nazwisko" });

    // Pierwsze konto w pustej bazie zakłada się bez sesji — inaczej nie dałoby
    // się założyć żadnego. Wymuszamy rolę `biuro` i PIN, bo to konto będzie
    // jedyną drogą do wszystkich następnych.
    if (brakKont()) {
      if (!req.body?.pin) {
        return reply
          .code(400)
          .send({ error: "Pierwsze konto to konto biura i wymaga PIN-u" });
      }
      const u = createUser(name, "biuro", req.body.pin);
      logEvent("user_created", u.name, null, { userId: u.userId, role: u.role, pierwsze: true });
      return { user: u };
    }

    const odmowa = odmowaZarzadzania(req.body?.pinAutora ?? null);
    if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });

    /* Rola EFEKTYWNA, nie surowe pole z żądania. Sprawdzanie `req.body.role`
       wprost znaczyło, że pominięcie pola (czyli poleganie na domyślnym
       `magazynier`) trafiało w warunek `!== "magazynier"` i kończyło się
       żądaniem PIN-u dla konta, które PIN-u nie potrzebuje. Domyślna wartość
       musi być ustalona RAZ i przed walidacją — inaczej walidacja pilnuje
       czegoś innego niż to, co powstanie. */
    const rola: Rola = req.body?.role ?? "magazynier";
    if (rola !== "magazynier" && !req.body?.pin) {
      // konto uprzywilejowane bez PIN-u i tak nic nie wykona (patrz `autoryzuj`)
      return reply.code(400).send({ error: "Konto brygadzisty i biura wymaga PIN-u" });
    }
    // badge nadaje SERWER — numer musi być unikalny w całej firmie, a kod
    // nieść poprawną cyfrę kontrolną
    const u = createUser(name, rola, req.body?.pin);
    logEvent("user_created", u.name, null, { userId: u.userId, role: u.role });
    return { user: u };
  });

  app.post<{ Params: { id: string }; Body: { pin?: string | null; pinAutora?: string } }>(
    "/api/users/:id/pin",
    async (req, reply) => {
      const odmowa = odmowaZarzadzania(req.body?.pinAutora ?? null);
      if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
      setPin(Number(req.params.id), req.body?.pin ?? null);
      logEvent("user_pin_changed", "biuro", null, { userId: Number(req.params.id) });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: { active?: boolean; pinAutora?: string } }>(
    "/api/users/:id/active",
    async (req, reply) => {
      const odmowa = odmowaZarzadzania(req.body?.pinAutora ?? null);
      if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
      // konta się nie kasuje — historia w `events` musi mieć na co wskazywać
      const active = req.body?.active !== false;
      setActive(Number(req.params.id), active);
      logEvent("user_active_changed", "biuro", null, { userId: Number(req.params.id), active });
      return { ok: true };
    }
  );

  /**
   * Jednorazowa migracja historii: nazwy z `events` → konta.
   * Idempotentna — dotyka wyłącznie zdarzeń bez `user_ref`.
   */
  app.post<{ Body: { pinAutora?: string } }>(
    "/api/users/migrate-history",
    async (req, reply) => {
      const odmowa = odmowaZarzadzania(req.body?.pinAutora ?? null);
      if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
      return migrujHistorie();
    }
  );
}
