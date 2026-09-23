import type { FastifyInstance } from "fastify";
import { userOf } from "../context.js";
import { logEvent } from "../services/events.js";
import { metrics } from "../services/raporty.js";
import { reconcile } from "../services/reconcile.js";

/** Telemetria urządzenia z kolektora (akcelerometr/bateria) → audyt w events. */
const ALLOWED = new Set([
  "device_drop",
  "battery_low",
  /* Skan → odpowiedź mierzone U CZŁOWIEKA (plan §10). Czas serwera pomijałby
     sieć i render, czyli akurat to, gdzie problem naprawdę siedzi. */
  "scan_timing",
  /* Przerwa w łączności kolektora z serwerem (0.326.0).

     Zgłasza ją kolektor PO jej końcu — w trakcie nie ma czym. Niesie czas
     początku, czas trwania, liczbę prób, powód i drogę sieciową; kto pracował,
     wiadomo i tak z nagłówków żądania.

     PIERWSZE PYTANIE PRZY TAKIEJ AWARII brzmi „to jedno urządzenie czy
     wszystkie?", a bez wspólnego zapisu nie dało się na nie odpowiedzieć:
     dziennik żył w pamięci jednego kolektora i znikał przy zamknięciu
     aplikacji. Biuro czyta to w zakładce DZIENNIK ZDARZEŃ, z filtrem
     po urządzeniu. */
  "siec_przerwa",
  /* Czasy odpowiedzi każdego żądania, per ekran i trasa (0.475.0). Paczka
     z kubełkami co 5 minut — reguły w `android/core/.../net/CzasyZadan.kt`,
     odczyt w `services/ergonomia.ts`. */
  "czasy_zadan",
]);

/**
 * Najwięcej wierszy w jednej paczce czasów. Kolektor ma kilkanaście ekranów
 * i kilkadziesiąt tras, więc prawdziwa paczka mieści się z dużym zapasem.
 * Granica chroni dziennik audytu przed paczką, która nie jest pomiarem.
 */
const MAKS_WIERSZY_CZASOW = 500;

export async function deviceRoutes(app: FastifyInstance) {
  /**
   * Cztery liczby dla biura (plan §10) — jeden endpoint, bez panelu.
   * Read-only, więc wolno je pokazać wszędzie, także tam, gdzie zapis nie
   * wchodzi w grę.
   */
  app.get<{ Querystring: { days?: string } }>("/api/metrics", async (req) => {
    return metrics(Number(req.query.days) || 7);
  });

  /**
   * Rekoncyliacja na żądanie (plan §9) — te same cztery kontrole co nocny
   * przebieg, tylko liczone teraz. Read-only, jak `/api/metrics` wyżej.
   */
  app.get("/api/reconcile", async () => reconcile());

  /* `GET /api/wydajnosc` ZNIKNĘŁO w 0.431.0. Raport per osoba wisiał tu za
     samą sesją, więc czytał go każdy zalogowany — także magazynier z kolektora
     (zmierzone: 200 z pełnym raportem). Nie wołał go żaden front: biuro bierze
     raport z `/api/analiza`, za bramką roli. Trasa bez odbiorcy, która wynosi
     dane o ludziach, jest wyłącznie ryzykiem. */

  app.post<{ Body: { type?: string; [k: string]: unknown } }>(
    "/api/device/event",
    async (req, reply) => {
      const { type, ...payload } = req.body ?? {};
      if (!type || !ALLOWED.has(type)) {
        return reply.code(400).send({ error: "Nieznany typ zdarzenia urządzenia" });
      }
      if (type === "czasy_zadan") {
        const czasy = (payload as { czasy?: unknown }).czasy;
        if (!Array.isArray(czasy) || czasy.length > MAKS_WIERSZY_CZASOW) {
          return reply.code(400).send({ error: "Paczka czasów bez listy albo za duża" });
        }
      }
      logEvent(type, userOf(req), null, payload);
      return { ok: true };
    }
  );
}
