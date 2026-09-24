import type { FastifyInstance } from "fastify";
import { envFile } from "../config.js";
import { sesjaZadania } from "../context.js";
import { stanKonfiguracji } from "../services/konfiguracja.js";
import { autoryzuj, potwierdzHaslo } from "../services/auth.js";
import {
  BladZlecenia, sprawdzWydania, stanAktualizacji, zlecAktualizacje,
} from "../services/aktualizacja-serwera.js";
import { WERSJA } from "../wersja.js";
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

  /* ── Aktualizacja serwera (0.492.0) ─────────────────────────────────────
     Odczyt jak przy konfiguracji: sam admin, bez `autoryzuj`, bo patrzenie
     nie zostawia śladu. Lista wydań pochodzi z pamięci, którą odświeża takt
     w `main()` albo przycisk „Sprawdź teraz" — samo otwarcie karty nie
     wychodzi do sieci. */
  const tylkoAdmin = () => {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    if (s.user.role !== "admin") return { kod: 403, error: "Aktualizacją serwera zajmuje się administrator" };
    return null;
  };

  app.get("/api/biuro/aktualizacja", async (_req, reply) => {
    const o = tylkoAdmin();
    if (o) return reply.code(o.kod).send({ error: o.error });
    return stanAktualizacji();
  });

  /* Bez ciała — reguła klienta HTTP z CLAUDE.md. Zapisu w bazie nie ma, więc
     bez `autoryzuj`; zapytanie idzie do GitHuba, nie do danych firmy. */
  app.post("/api/biuro/aktualizacja/sprawdz", async (_req, reply) => {
    const o = tylkoAdmin();
    if (o) return reply.code(o.kod).send({ error: o.error });
    await sprawdzWydania();
    return stanAktualizacji();
  });

  /* Zlecenie: rola, ślad `privileged`, ponowne hasło — w tej kolejności.
     Hasło po roli, bo biuro i hala nie mają tu czego zgadywać. */
  app.post<{ Body: { wersja?: string; haslo?: string } }>("/api/biuro/aktualizacja", async (req, reply) => {
    const s = sesjaZadania();
    if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
    const a = autoryzuj(s.user, "aktualizacja_serwera");
    if (!a.ok) return reply.code(403).send({ error: a.powod });
    if (!potwierdzHaslo(s.user, req.body?.haslo ?? "")) {
      return reply.code(403).send({ error: "Błędne hasło. Po pięciu próbach formularz odpoczywa minutę." });
    }
    const wersja = req.body?.wersja ?? "";
    try {
      await zlecAktualizacje(wersja, s.user.name);
    } catch (e) {
      if (e instanceof BladZlecenia) return reply.code(e.kod).send({ error: e.message });
      throw e;
    }
    logEvent("aktualizacja_zlecona", s.user.name, null, { z: WERSJA, na: wersja });
    return { ok: true, wersja };
  });
}
