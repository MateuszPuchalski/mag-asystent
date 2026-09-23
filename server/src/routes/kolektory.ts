import type { FastifyInstance } from "fastify";
import { currentDevice, userOf } from "../context.js";
import {
  kolektory,
  sprawdzWezwanie,
  wezwij,
  zakonczSzukanie,
} from "../services/szukanie-kolektora.js";

/* ── Szukanie zgubionego kolektora — trasy ───────────────────────────────────
   Logika i jej uzasadnienie: `services/szukanie-kolektora.ts`.

   Wszystkie za SAMĄ SESJĄ, bez bramki roli: kolektora szuka najczęściej
   kolega z hali, a nie biuro. Trasy nie trafiają na listę `BEZ_SESJI` —
   wylogowany kolektor nie pyta o wezwanie. Ta lista jest zamknięta dla
   wszystkiego, co nie jest drogą do zalogowania, a kolektor wylogowany
   zwykle i tak leży w szufladzie, nie na regale.

   Dwa zapisy są BEZ CIAŁA. Kolektor wysyła je jako `EMPTY_BODY`, panel —
   przez `api()` bez `body`, bo pusty JSON z typem treści kończy się gołym
   „Bad Request" (CLAUDE.md, reguła klienta HTTP). */

export async function kolektoryRoutes(app: FastifyInstance) {
  /**
   * Lista kolektorów do wyboru. `ten` mówi pytającemu kolektorowi, który
   * wiersz jest nim samym — samego siebie się nie szuka.
   */
  app.get("/api/kolektory", async () => ({ kolektory: kolektory(), ten: currentDevice() }));

  app.post<{ Params: { deviceId: string } }>("/api/kolektory/:deviceId/wezwij", async (req, reply) => {
    const r = wezwij(req.params.deviceId, userOf(req));
    if ("error" in r) return reply.code(404).send(r);
    return { ok: true, kolektor: r };
  });

  /**
   * Koniec szukania. Ta sama trasa dla szukającego i dla kolektora, który
   * się odnalazł; audyt rozróżnia je po tym, KTO pyta (`x-device`).
   */
  app.post<{ Params: { deviceId: string } }>("/api/kolektory/:deviceId/odwolaj", async (req) => {
    const deviceId = req.params.deviceId;
    return { ok: true, ...zakonczSzukanie(deviceId, userOf(req), currentDevice() === deviceId) };
  });

  /**
   * Pytanie kolektora o własne wezwanie — co 10 s, z każdego ekranu.
   * Niczego nie zapisuje do bazy (patrz nagłówek serwisu).
   */
  app.get("/api/kolektor/wezwanie", async (_req, reply) => {
    const deviceId = currentDevice();
    if (!deviceId) return reply.code(400).send({ error: "Żądanie bez nagłówka x-device" });
    return { wezwanie: sprawdzWezwanie(deviceId) };
  });
}
