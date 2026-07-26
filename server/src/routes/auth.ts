import type { FastifyInstance } from "fastify";
import { currentDevice } from "../context.js";
import {
  BLOKADA_MIN,
  autoryzuj,
  odblokuj,
  przejmij,
  sesja,
  wyloguj,
  zaloguj,
  type OperacjaUprzywilejowana,
} from "../services/auth.js";
import { createUser, listUsers, migrujHistorie, setActive, setPin } from "../services/users.js";

/* ── Tożsamość: badge zamiast wolnego tekstu (plan §7) ──────────────────────
   Jeden skan na ścieżce codziennej. PIN dopiero tam, gdzie badge nie
   wystarcza, bo badge'e bywają pożyczane.                                    */

const token = (req: { headers: Record<string, unknown> }): string | null => {
  const h = req.headers["x-session"];
  const v = Array.isArray(h) ? h[0] : h;
  return (v && String(v).trim()) || null;
};

export async function authRoutes(app: FastifyInstance) {
  /** Skan badge'a → sesja urządzenia. */
  app.post<{ Body: { badge?: string } }>("/api/auth/badge", async (req, reply) => {
    const s = zaloguj(req.body?.badge ?? "", currentDevice());
    if (!s) {
      // jeden komunikat dla „nie ma takiego" i „zła cyfra kontrolna" — dla
      // człowieka to ten sam wniosek, a rozróżnianie kusiłoby do prób
      return reply.code(401).send({ error: "Nieznany badge albo uszkodzona etykieta" });
    }
    return { token: s.token, user: s.user, blokadaMin: BLOKADA_MIN };
  });

  /** Kim jestem — kolektor pyta przy starcie i po powrocie z tła. */
  app.get("/api/auth/me", async (req, reply) => {
    const s = sesja(token(req));
    if (!s) return reply.code(401).send({ error: "Brak sesji" });
    return { user: s.user, zablokowana: s.zablokowana, blokadaMin: BLOKADA_MIN };
  });

  /** Odblokowanie WŁASNEJ sesji po bezczynności — nic nie zostało utracone. */
  app.post<{ Body: { badge?: string } }>("/api/auth/unlock", async (req, reply) => {
    const s = odblokuj(token(req) ?? "", req.body?.badge ?? "");
    if (!s) {
      return reply
        .code(401)
        .send({ error: "To nie jest badge osoby, która ma tę sesję — użyj przejęcia pracy" });
    }
    return { user: s.user, zablokowana: false };
  });

  /**
   * Przejęcie pracy przez inną osobę — JAWNE, nigdy po cichu.
   * Kolektor wywołuje to dopiero po potwierdzeniu przez człowieka.
   */
  app.post<{ Body: { badge?: string; kontekst?: string } }>(
    "/api/auth/handover",
    async (req, reply) => {
      const s = przejmij(
        token(req) ?? "",
        req.body?.badge ?? "",
        currentDevice(),
        req.body?.kontekst
      );
      if (!s) return reply.code(401).send({ error: "Nieznany badge albo uszkodzona etykieta" });
      return { token: s.token, user: s.user };
    }
  );

  app.post("/api/auth/logout", async (req) => {
    const t = token(req);
    if (t) wyloguj(t);
    return { ok: true };
  });

  /** Sprawdzenie PIN-u przed operacją uprzywilejowaną. */
  app.post<{ Body: { pin?: string; operacja?: OperacjaUprzywilejowana } }>(
    "/api/auth/privileged",
    async (req, reply) => {
      const s = sesja(token(req));
      if (!s) return reply.code(401).send({ error: "Brak sesji" });
      const w = autoryzuj(s.user, req.body?.operacja ?? "ustawienia", req.body?.pin ?? null);
      if (!w.ok) return reply.code(403).send({ error: w.powod });
      return { ok: true };
    }
  );

  /* ── Administracja kontami (biuro) ─────────────────────────────────────── */

  app.get("/api/users", async () => ({ users: listUsers() }));

  app.post<{ Body: { name?: string; role?: "magazynier" | "brygadzista" | "biuro"; pin?: string } }>(
    "/api/users",
    async (req, reply) => {
      const name = (req.body?.name ?? "").trim();
      if (!name) return reply.code(400).send({ error: "Podaj imię i nazwisko" });
      // badge nadaje SERWER — numer musi być unikalny w całej firmie, a kod
      // nieść poprawną cyfrę kontrolną
      return { user: createUser(name, req.body?.role ?? "magazynier", req.body?.pin) };
    }
  );

  app.post<{ Params: { id: string }; Body: { pin?: string | null } }>(
    "/api/users/:id/pin",
    async (req) => {
      setPin(Number(req.params.id), req.body?.pin ?? null);
      return { ok: true };
    }
  );

  app.post<{ Params: { id: string }; Body: { active?: boolean } }>(
    "/api/users/:id/active",
    async (req) => {
      // konta się nie kasuje — historia w `events` musi mieć na co wskazywać
      setActive(Number(req.params.id), req.body?.active !== false);
      return { ok: true };
    }
  );

  /**
   * Jednorazowa migracja historii: nazwy z `events` → konta.
   * Idempotentna — dotyka wyłącznie zdarzeń bez `user_ref`.
   */
  app.post("/api/users/migrate-history", async () => migrujHistorie());
}
