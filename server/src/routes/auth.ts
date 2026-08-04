import type { FastifyInstance } from "fastify";
import { currentDevice, currentToken, sesjaZadania } from "../context.js";
import { autoryzuj, karaLogowania, wyloguj, zaloguj, zmienHaslo } from "../services/auth.js";
import { logEvent } from "../services/events.js";
import {
  brakKont,
  createUser,
  HASLO_MIN,
  listUsers,
  migrujHistorie,
  poprawnyLogin,
  setActive,
  setHaslo,
  type Rola,
} from "../services/users.js";

/* ── Tożsamość: konto imienne zamiast wolnego tekstu (plan §7) ──────────────
   Login i hasło — ten sam wzorzec, co reszta systemów w firmie. Wcześniej był
   nim skan plakietki; wyszedł w 0.20.0 razem z PIN-em do operacji
   uprzywilejowanych, które rozstrzyga dziś sama rola.                        */

// Token czyta kontekst żądania (`context.ts`), a nie każda trasa z osobna —
// druga kopia odczytu nagłówka to druga okazja do rozjazdu.
const token = currentToken;

export async function authRoutes(app: FastifyInstance) {
  /** Login i hasło → sesja urządzenia. */
  app.post<{ Body: { login?: string; haslo?: string } }>(
    "/api/auth/login",
    async (req, reply) => {
      const login = req.body?.login ?? "";
      /* Dławienie odpowiada 429, nie 401, i to nie jest kosmetyka. „Odczekaj
         chwilę" i „pomyliłeś hasło" to dla człowieka dwie różne instrukcje,
         a kolektor po 401 kasuje operację z bufora (`czyPrzejsciowy`).
         Kod nie zdradza niczego o koncie: licznik chodzi po wpisanym łańcuchu,
         więc nieistniejący login blokuje się tak samo jak istniejący. */
      if (karaLogowania(login) > 0) {
        return reply.code(429).send({ error: "Za dużo prób logowania — odczekaj minutę" });
      }
      const s = zaloguj(login, req.body?.haslo ?? "", currentDevice());
      if (!s) {
        // JEDEN komunikat dla „nie ma takiego loginu", „złe hasło", „konto bez
        // hasła" i „konto wyłączone". Rozróżnienie mówiłoby obcemu w sieci
        // magazynu, które konta istnieją — a człowiekowi i tak nie pomaga.
        return reply.code(401).send({ error: "Nieznany login albo błędne hasło" });
      }
      return { token: s.token, user: s.user };
    }
  );

  /** Zmiana WŁASNEGO hasła — bez niej każdą zmianę musiałoby robić biuro. */
  app.post<{ Body: { stare?: string; nowe?: string } }>(
    "/api/auth/haslo",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const w = zmienHaslo(s.user, req.body?.stare ?? "", req.body?.nowe ?? "");
      if (w.error) return reply.code(400).send({ error: w.error });
      return { ok: true };
    }
  );

  /**
   * Kim jestem — kolektor pyta przy starcie i po powrocie z tła.
   *
   * Odpowiedź nie niesie już stanu blokady ani TTL: sesja trwa do jawnego
   * wylogowania albo przejęcia pracy. Zostaje jedno pytanie, na które ta trasa
   * odpowiada — „czy ten token nadal wskazuje czynne konto".
   */
  app.get("/api/auth/me", async (_req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({ error: "Brak sesji" });
    return { user: s.user };
  });

  app.post("/api/auth/logout", async () => {
    const t = token();
    if (t) wyloguj(t);
    return { ok: true };
  });

  /* ── Administracja kontami — WYŁĄCZNIE biuro ──────────────────────────────
     Te trasy tworzą TOŻSAMOŚĆ, więc bez strażnika cała reszta §7 jest
     dekoracją: `GET /api/users` wystawia login każdego, `POST /api/users`
     pozwalałby założyć konto biura z własnym hasłem, a `:id/haslo` zmienić
     cudze. Jedno żądanie z sieci magazynu dałoby wtedy wszystko naraz.

     Dlatego rola `biuro` przy każdej z nich. Do sierpnia 2026 dochodził PIN
     przy zmianach; wyszedł razem z badge'em, bo hasło do konta jest już tym
     sekretem, którym PIN był wobec pożyczanej plakietki.                     */

  /**
   * Czy instalacja jest jeszcze pusta — pytanie zadawane przez kolektor przy
   * pierwszym starcie.
   *
   * Bez tego kolektor nie odróżnia „system dopiero powstaje" od „pomyliłeś
   * hasło": obie sytuacje wyglądają jak 401 z `/api/auth/login`. Człowiek
   * rozpakowujący kolektor w poniedziałek rano zobaczyłby ekran proszący
   * o login, którego jeszcze nikt nie założył.
   *
   * Odpowiedź nie jest tajemnicą: dokładnie tę samą informację ujawnia próba
   * założenia konta (`POST /api/users` przechodzi albo żąda sesji).
   */
  app.get("/api/setup", async () => ({ potrzebne: brakKont() }));

  /** Sesja biura; `null` = zgoda, obiekt = odmowa gotowa do odesłania. */
  function odmowaZarzadzania(): { kod: number; error: string } | null {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    const w = autoryzuj(s.user, "zarzadzanie_kontami");
    return w.ok ? null : { kod: 403, error: w.powod ?? "Brak uprawnień" };
  }

  app.get("/api/users", async (_req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
    if (s.user.role !== "biuro") {
      // lista loginów to lista tożsamości — nie wystawiamy jej hali
      return reply.code(403).send({ error: "Lista kont jest dostępna tylko dla biura" });
    }
    return { users: listUsers() };
  });

  /** Wspólna walidacja pary login-hasło; `null` = w porządku. */
  function bladDanych(login: string, haslo: string): string | null {
    if (!poprawnyLogin(login)) {
      return "Login: 3-32 znaki, małe litery, cyfry oraz . _ -";
    }
    if ((haslo ?? "").length < HASLO_MIN) {
      return `Hasło musi mieć co najmniej ${HASLO_MIN} znaków`;
    }
    return null;
  }

  app.post<{
    Body: { name?: string; login?: string; haslo?: string; role?: Rola };
  }>("/api/users", async (req, reply) => {
    const name = (req.body?.name ?? "").trim();
    if (!name) return reply.code(400).send({ error: "Podaj imię i nazwisko" });

    const blad = bladDanych(req.body?.login ?? "", req.body?.haslo ?? "");
    if (blad) return reply.code(400).send({ error: blad });

    /* Rola EFEKTYWNA, nie surowe pole z żądania — pominięcie pola znaczy
       `magazynier` i walidacja musi patrzeć na to samo, co powstanie. */
    const rola: Rola = brakKont() ? "biuro" : (req.body?.role ?? "magazynier");

    // Pierwsze konto w pustej bazie zakłada się bez sesji — inaczej nie dałoby
    // się założyć żadnego. Rola `biuro` jest wymuszona, bo to konto będzie
    // jedyną drogą do wszystkich następnych.
    const pierwsze = brakKont();
    if (!pierwsze) {
      const odmowa = odmowaZarzadzania();
      if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
    }

    try {
      const u = createUser(name, rola, req.body?.login, req.body?.haslo);
      logEvent("user_created", u.name, null, {
        userId: u.userId,
        role: u.role,
        ...(pierwsze ? { pierwsze: true } : {}),
      });
      return { user: u };
    } catch {
      // jedyny realny powód: UNIQUE na loginie
      return reply.code(409).send({ error: "Taki login już istnieje" });
    }
  });

  app.post<{ Params: { id: string }; Body: { haslo?: string | null } }>(
    "/api/users/:id/haslo",
    async (req, reply) => {
      const odmowa = odmowaZarzadzania();
      if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
      const haslo = req.body?.haslo ?? null;
      // `null` odbiera hasło, czyli zamyka konto na klucz bez kasowania go
      if (haslo !== null && haslo.length < HASLO_MIN) {
        return reply.code(400).send({ error: `Hasło musi mieć co najmniej ${HASLO_MIN} znaków` });
      }
      setHaslo(Number(req.params.id), haslo);
      logEvent("user_haslo_changed", "biuro", null, { userId: Number(req.params.id) });
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: { active?: boolean } }>(
    "/api/users/:id/active",
    async (req, reply) => {
      const odmowa = odmowaZarzadzania();
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
  app.post("/api/users/migrate-history", async (_req, reply) => {
    const odmowa = odmowaZarzadzania();
    if (odmowa) return reply.code(odmowa.kod).send({ error: odmowa.error });
    return migrujHistorie();
  });
}
