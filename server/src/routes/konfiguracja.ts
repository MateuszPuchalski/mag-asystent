import type { FastifyInstance } from "fastify";
import { envFile } from "../config.js";
import { sesjaZadania } from "../context.js";
import { stanKonfiguracji } from "../services/konfiguracja.js";

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
}
