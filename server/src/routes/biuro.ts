import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { podgladDokumentu } from "../services/podglad-dostawy.js";

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

  /**
   * Pozycje dokumentu dla biura — CZYTA, nigdy nie otwiera dostawy.
   *
   * Trasa mieszka TU, a nie przy pozostałych trasach dostaw, i to jest decyzja
   * o bezpieczeństwie, nie o porządku: jej sąsiadem byłby `POST
   * /api/delivery/documents/:dokId/open`, czyli zapis różniący się o jeden
   * człon ścieżki. `routes/delivery.ts` zostaje o ścieżce pracy kolektora,
   * a to jedyna trasa czytana wyłącznie przez `/biuro`.
   *
   * Klucz to `dokId` (numer dokumentu w Subiekcie), a nie lokalne `deliveryId`,
   * bo dokument, którego nikt nie tknął, żadnego `deliveryId` jeszcze nie ma —
   * a wejść w niego biuro musi tak samo.
   *
   * Bez własnej bramki ról: globalna bramka sesji obejmuje wszystko pod `/api/`
   * poza zamkniętą listą `BEZ_SESJI`, a te same dane pokazuje już lista dostaw
   * i lista wyjątków. `autoryzuj()` byłoby tu wręcz szkodliwe — zapisuje
   * zdarzenie `privileged` przy każdym sprawdzeniu, a to jest zwykły odczyt.
   *
   * ETag/304 dokłada hak `routes/etag.ts`. Warunek: w odpowiedzi NIE MA nic
   * liczonego z zegara — strona odpytuje ją co pół minuty i ma dostawać 304.
   */
  app.get<{ Params: { dokId: string } }>("/api/biuro/dokument/:dokId", async (req, reply) => {
    const d = podgladDokumentu(Number(req.params.dokId));
    if (!d) return reply.code(404).send({ error: "Nie znaleziono dokumentu" });
    return d;
  });

  /* Do 0.26.0 wisiała tu jeszcze trasa `/sw.js` — jednorazowy pogrzeb service
     workera PWA usuniętej w 0.3.0. Komputery biura przeszły od tego czasu
     przez sprzątający skrypt, więc trasa wyszła razem ze swoim powodem. */
}
