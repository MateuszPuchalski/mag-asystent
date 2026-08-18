import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import { apkNaSerwerze } from "../services/aktualizacja.js";

/* ── Aktualizacja kolektora z serwera (0.52.0) ───────────────────────────────
   OBIE TRASY SĄ POZA BRAMKĄ SESJI (`BEZ_SESJI` w `context.ts`) i to jest
   decyzja, nie przeoczenie. Pytanie pada przy otwarciu aplikacji, także wtedy,
   gdy nikt nie jest zalogowany — a kolektor, którego nie da się naprawić bez
   zalogowania, i którego aplikacja jest zepsuta, jest zamknięty w kółku.

   Cena jest jawna: każdy w sieci magazynu pobierze ten plik bez logowania.
   Jest do przyjęcia, bo APK nie niesie dziś żadnej tajemnicy — adres serwera
   wpisuje człowiek, a w `BuildConfig` nie ma kluczy. Z tego bierze się reguła
   na przyszłość: DO APK NIE WOLNO WBUDOWAĆ NICZEGO TAJNEGO.

   Tym, co odróżnia aktualizację WERTIS od dowolnego APK podanego kolektorowi
   z tej samej sieci, jest PODPIS — Android odmówi instalacji pliku podpisanego
   innym kluczem. Suma SHA-256 chroni wyłącznie przed uszkodzeniem w transporcie,
   bo przychodzi tym samym kanałem co plik.                                    */

export async function aktualizacjaRoutes(app: FastifyInstance) {
  /**
   * Co serwer ma dla kolektorów.
   *
   * Zawsze 200, nawet gdy nie ma pliku — `404` nie da się odróżnić od starego
   * serwera, który tej trasy nie zna, a to dwie różne odpowiedzi na pytanie
   * „czy jest aktualizacja".
   *
   * Nic liczonego z zegara w ciele odpowiedzi: hak ETag z `routes/etag.ts`
   * odda wtedy 304, a kolektor pyta o to przy każdym otwarciu aplikacji.
   */
  app.get("/api/aktualizacja", async () => {
    const apk = apkNaSerwerze();
    if (!apk) return { wersja: null, kodWersji: 0, bajtow: 0, sha256: "" };
    return { wersja: apk.wersja, kodWersji: apk.kodWersji, bajtow: apk.bajtow, sha256: apk.sha256 };
  });

  /**
   * Sam plik.
   *
   * BEZ PARAMETRU W ŚCIEŻCE — nazwę wybiera serwer z katalogu. Nie ma tu więc
   * ani jednego znaku pochodzącego z żądania, czyli nie ma czego sanityzować;
   * inaczej niż przy zdjęciach, gdzie nazwa idzie z bazy i przechodzi przez
   * `path.basename`.
   */
  app.get("/api/aktualizacja/apk", async (req, reply) => {
    const apk = apkNaSerwerze();
    if (!apk) return reply.code(404).send({ error: "Serwer nie ma APK kolektora" });

    const etag = `"${apk.sha256}"`;
    if (req.headers["if-none-match"] === etag) return reply.code(304).header("etag", etag).send();

    /* `no-store`, a nie `max-age` jak przy zdjęciach. Cache dyskowy OkHttp ma
       20 MB (`ApiClient.kt`) i służy odpytywaniu co 1,5–2 s; zapisanie w nim
       kilkunastomegabajtowego APK wyrzuciłoby z niego całą resztę. `no-cache`
       tu nie wystarcza — wymusza odświeżenie, ale pozwala ZAPISAĆ. */
    return reply
      .type("application/vnd.android.package-archive")
      .header("etag", etag)
      .header("cache-control", "no-store")
      .header("content-length", String(fs.statSync(apk.plik).size))
      .send(fs.createReadStream(apk.plik));
  });
}
