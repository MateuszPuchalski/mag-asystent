import type { FastifyInstance, FastifyReply } from "fastify";
import { sesjaZadania } from "../context.js";
import { db } from "../db/db.js";
import { config } from "../config.js";
import {
  ocenKlasyfikacje, pomiarCopilota, sklasyfikujRozmowy,
} from "../services/copilot-klasyfikacja.js";
import { nadawcaAnthropic } from "../adapters/copilot.anthropic.js";

/* ── Trasy Copilota (§14, etap F) ────────────────────────────────────────────
   DWIE TRASY ZAPISU i to jest umowa pilnowana testem: partia klasyfikacji oraz
   werdykt człowieka o jej trafności. Ta druga wygląda na drobiazg, a bez niej
   nie da się policzyć trafności — czyli nie da się podjąć decyzji „zejdź na
   tańszy model", dla której cały pomiar powstał.

   Bramka roli stoi też na ODCZYCIE, tak jak w skrzynce: rozmowy z klientami to
   dane biura, a nie hali.

   Bez `autoryzuj()`: to jest zwykła praca biura. Rabat i zwrot pieniędzy
   dostały wpis `privileged`, bo ruszają cudze pieniądze na zewnątrz; tutaj
   wydajemy WŁASNE, a ślad kto i ile wydał niesie księga `copilot_wywolanie`
   razem z `przez_user_id`.                                                   */

const BIURO = ["biuro", "admin"];

function odmowa(reply: FastifyReply) {
  const s = sesjaZadania();
  if (!s) return reply.code(401).send({ error: "Brak sesji — zaloguj się" });
  if (!BIURO.includes(s.user.role)) {
    return reply.code(403).send({ error: "Copilota obsługuje biuro" });
  }
  return null;
}

const kto = () => {
  const u = sesjaZadania()!.user;
  return { id: u.userId, name: u.name };
};

/** Jedno zdanie o tym, dlaczego przycisku nie ma. Pisze je SERWER. */
function czemuWylaczony(): string | null {
  if (config.copilot.mode === "off") {
    return "Copilot jest wyłączony. Włącz go w wertis.env (COPILOT_MODE=anthropic).";
  }
  if (!config.copilot.klucz) {
    return "Copilot nie ma klucza. Ustaw ANTHROPIC_API_KEY w wertis.env i zrestartuj usługę.";
  }
  return null;
}

export async function copilotRoutes(app: FastifyInstance) {
  /* Stan dla ekranu: czy da się kliknąć i ile to bierze naraz. Czysty odczyt —
     „zero zapisu przy patrzeniu" nie ma tu wyjątku. */
  app.get("/api/obsluga/copilot", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    return {
      wlaczony: czemuWylaczony() === null,
      powod: czemuWylaczony(),
      model: config.copilot.model,
      maxPartia: config.copilot.maxPartia,
    };
  });

  /* Pomiar siedzi ZA ZĘBATKĄ (0.168.0): ekran pracy niesie to, co woła
     o reakcję, a diagnostyka mieszka w ustawieniach. */
  app.get("/api/obsluga/copilot/pomiar", async (_req, reply) => {
    const nie = odmowa(reply);
    if (nie) return nie;
    return pomiarCopilota(db());
  });

  /**
   * Rozpoznanie kategorii dla PODANYCH rozmów.
   *
   * Ciało niesie listę identyfikatorów, a nie liczbę: panel ma przed sobą
   * wiersze kolejki i wie, które są nierozpoznane w oglądanym kubełku.
   * Dzięki temu przyszły przycisk w pojedynczej rozmowie wyśle jeden
   * identyfikator — bez nowej trasy i bez podnoszenia licznika tras zapisu.
   */
  app.post<{ Body: { rozmowyId?: number[] } }>(
    "/api/obsluga/copilot/klasyfikacja", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      const powod = czemuWylaczony();
      /* Wyłączony Copilot odpowiada 400 ze zdaniem, a nie 500 z wywrotki
         w adapterze — i nie wychodzi przy tym do sieci ani razu. */
      if (powod) return reply.code(400).send({ error: powod });

      const ids = (req.body?.rozmowyId ?? []).map(Number).filter(Number.isInteger);
      if (ids.length === 0) {
        return reply.code(400).send({ error: "Nie podano rozmów do rozpoznania" });
      }
      if (ids.length > config.copilot.maxPartia) {
        return reply.code(400).send({
          error: `Jedno kliknięcie bierze najwyżej ${config.copilot.maxPartia} rozmów ` +
            "(COPILOT_MAX_PARTIA). To jest hamulec na wydatek, nie limit ekranu.",
        });
      }

      /* Partia przerwana limitem oddaje 200 z wypełnionym `przerwane`, NIE
         błąd: część rozmów została rozpoznana i zapłacona, a kod błędu kazałby
         ekranowi wyrzucić wynik, za który już zapłaciliśmy. */
      return await sklasyfikujRozmowy(db(), ids, kto(), nadawcaAnthropic);
    });

  /** Werdykt człowieka o propozycji maszyny — bez niego nie ma trafności. */
  app.post<{ Params: { id: string }; Body: { ocena?: string } }>(
    "/api/obsluga/copilot/klasyfikacja/:id/ocena", async (req, reply) => {
      const nie = odmowa(reply);
      if (nie) return nie;
      try {
        return ocenKlasyfikacje(db(), Number(req.params.id), req.body?.ocena ?? "", kto());
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    });
}
