import type { FastifyInstance } from "fastify";
import { sesjaZadania } from "../context.js";
import { autoryzuj } from "../services/auth.js";
import { listaMagazynow, ustawUkryte } from "../services/magazyny.js";

/**
 * Magazyny i ich widoczność na karcie towaru.
 *
 * Ustawienie jest GLOBALNE, po stronie serwera. Przy kilku kolektorach lista
 * ukrytych magazynów trzymana na urządzeniu znaczyłaby, że dwie osoby patrzą
 * na ten sam towar i widzą co innego — a to dokładnie ten rodzaj różnicy,
 * którego na hali nikt nie skojarzy z ustawieniami.
 */
export async function magazynRoutes(app: FastifyInstance) {
  /** Pełna lista do ekranu ustawień: z rolą i flagą `ukryty`. */
  app.get("/api/magazyny", async () => ({ magazyny: listaMagazynow() }));

  /**
   * Zapis widoczności. `ukryte` to lista PEŁNA — czego w niej nie ma, jest
   * widoczne. Wysyłanie różnicy wymagałoby od kolektora znajomości stanu
   * sprzed zmiany, a przy dwóch osobach w ustawieniach naraz kończyłoby się
   * cichym gubieniem jednej z decyzji.
   */
  app.post<{ Body: { ukryte?: number[] } }>(
    "/api/magazyny/widocznosc",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });

      const w = autoryzuj(s.user, "widocznosc_magazynow");
      if (!w.ok) return reply.code(403).send({ error: w.powod ?? "Brak uprawnień" });

      const ukryte = req.body?.ukryte;
      if (!Array.isArray(ukryte) || ukryte.some((x) => !Number.isInteger(x))) {
        return reply.code(400).send({ error: "Pole `ukryte` musi być listą identyfikatorów" });
      }

      const wynik = ustawUkryte(ukryte, s.user.name);
      if (!wynik.ok) return reply.code(400).send({ error: wynik.blad });
      return { ukryte: wynik.ukryte, magazyny: listaMagazynow() };
    }
  );
}
