import type { FastifyInstance } from "fastify";
import { envFile } from "../config.js";
import { sesjaZadania } from "../context.js";
import { stanKonfiguracji } from "../services/konfiguracja.js";
import { autoryzuj } from "../services/auth.js";
import { logEvent } from "../services/events.js";
import { BladZmiany, zmienKlucz } from "../services/konfiguracja-zapis.js";
import { zaplanujRestart } from "../services/restart.js";

/* ── Konfiguracja serwera w panelu (0.488.0) ─────────────────────────────────
   Sam odczyt. Bramka: wyłącznie admin, bo lista pokazuje adres bazy firmy,
   login SQL i konta, z którymi rozmawia serwer. Biuro nie ma tu nic do
   zrobienia, a lista celów wystawiona szerzej niż trzeba jest ryzykiem bez
   korzyści — ten sam argument, co przy liście kont (DEPLOY §5a).

   BEZ `autoryzuj()`, choć to operacja admina. `autoryzuj` zapisuje wpis
   `privileged` do dziennika, a to jest zapis przy samym patrzeniu — reguła
   zero zapisu przy otwarciu ekranu obowiązuje także karty ustawień. */

export async function konfiguracjaRoutes(app: FastifyInstance) {
  app.get("/api/biuro/konfiguracja", async (_req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
    if (s.user.role !== "admin") {
      return reply.code(403).send({ error: "Konfigurację serwera ogląda administrator" });
    }
    return stanKonfiguracji(envFile);
  });

  /* ── Zmiana jednego klucza (0.491.0) ────────────────────────────────────
     Jeden klucz na żądanie, nie formularz całości. Każda zmiana przechodzi
     osobno przez próbę startu i zostawia osobny wpis w dzienniku, więc
     „kto przestawił próg skrzynki" ma jedną odpowiedź, a nie paczkę.

     Po zapisie serwer kończy się sam i NSSM podnosi go z nowym plikiem;
     worker robi to samo po wpisie `konfiguracja_zmieniona`. Poza usługą
     restart zostaje człowiekowi i odpowiedź mówi to wprost. */
  app.post<{ Body: { klucz?: string; wartosc?: string | null } }>(
    "/api/biuro/konfiguracja",
    async (req, reply) => {
      const s = sesjaZadania();
      if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
      const a = autoryzuj(s.user, "konfiguracja_serwera");
      if (!a.ok) return reply.code(403).send({ error: a.powod });

      const klucz = req.body?.klucz ?? "";
      const wartosc = req.body?.wartosc;
      if (wartosc !== null && typeof wartosc !== "string") {
        return reply.code(400).send({ error: "Podaj wartość albo null, żeby wrócić do domyślnej." });
      }
      try {
        const w = await zmienKlucz(envFile, klucz, wartosc);
        logEvent("konfiguracja_zmieniona", s.user.name, null, w);
        return { ok: true, klucz, restart: zaplanujRestart() };
      } catch (e) {
        if (e instanceof BladZmiany) return reply.code(e.kod).send({ error: e.message });
        throw e;
      }
    },
  );
}
