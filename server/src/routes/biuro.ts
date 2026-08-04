import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

/* ── Podgląd biura — jedna strona pod /biuro ─────────────────────────────────
   Wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał, którym biuro widziało
   stan dostaw. CSV i REST istniały dalej, ale „wywołaj curlem z tokenem" nie
   jest interfejsem dla księgowości. Ta strona jest tym interfejsem: status
   rozkładania + gotowy do druku protokół rozbieżności ze zdjęciami dowodowymi.

   ŚWIADOMIE jeden plik HTML bez builda i bez frameworka. Poprzedni podgląd
   (/lookup) zniknął razem z całym klientem PWA, bo dwa fronty to dwa razy
   utrzymanie — więc nowy nie ma prawa być drugim frontem. Strona jest cienka:
   sam odczyt istniejących tras API, z tokenem sesji w nagłówku, tak samo jak
   kolektor. Zero własnych uprawnień, zero zapisu.

   Plik jest wczytywany RAZ, przy rejestracji tras — nie per żądanie. Zmiana
   strony wymaga restartu usługi, dokładnie jak zmiana kodu.                  */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function biuroRoutes(app: FastifyInstance) {
  const html = fs.readFileSync(path.join(__dirname, "../web/biuro.html"), "utf8");

  app.get("/biuro", async (_req, reply) => reply.type("text/html; charset=utf-8").send(html));

  // korzeń przekierowuje do podglądu: adres `http://serwer:3001` w pasku
  // przeglądarki biura ma pokazać COŚ, a nie 404
  app.get("/", async (_req, reply) => reply.redirect("/biuro"));

  /* Do 0.25.0 wisiała tu jeszcze trasa `/sw.js` — jednorazowy pogrzeb service
     workera PWA usuniętej w 0.3.0. Komputery biura przeszły od tego czasu
     przez sprzątający skrypt, więc trasa wyszła razem ze swoim powodem. */
}
