import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { config, envFile } from "./config.js";
import { problemPrzykrytejKonfiguracji } from "./env-file.js";
import { withRequestContext } from "./context.js";
import { db } from "./db/db.js";
import { productRoutes } from "./routes/products.js";
import { queueRoutes } from "./routes/queue.js";
import { przesuniecieRoutes } from "./routes/przesuniecie.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { problemRoutes } from "./routes/problems.js";
import { locationRoutes } from "./routes/locations.js";
import { deviceRoutes } from "./routes/device.js";
import { authRoutes } from "./routes/auth.js";
import { audytRoutes } from "./routes/audyt.js";
import { statystykiAudytu } from "./services/audyt.js";
import { magazynRoutes } from "./routes/magazyny.js";
import { biuroRoutes } from "./routes/biuro.js";
import {
  brakDostepuDoMagazynow,
  brakKolumnyZrealizowano,
  importFromMssql,
  lastImport,
} from "./adapters/subiekt.mssql.js";
import { nienazwaneTypyDostaw } from "./adapters/typy-dokumentow.js";
import { brakDostepuDoZdjec } from "./adapters/zdjecia.sgt.js";
import { statystykiZdjec } from "./services/zdjecia.js";
import { zamelduj, stanWorkera, stanSfery, zaleglosciMm } from "./services/process-state.js";
import { WERSJA } from "./wersja.js";

/**
 * Złożenie aplikacji BEZ nasłuchiwania.
 *
 * Wydzielone z `main()`, żeby dało się je przetestować: `app.inject()` z
 * Fastify wykonuje pełne żądanie — hooki, walidację, trasę — nie otwierając
 * portu. Wcześniej budowanie i `listen` siedziały w jednej funkcji, więc test
 * trasy wymagałby postawienia serwera i strzelania do niego po sieci.
 *
 * Poza tym zostaje tu wyłącznie to, co niepotrzebne w teście: cykliczny import
 * z MSSQL i samo `listen`.
 */
export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // zdjęcia dowodowe lecą jako base64 w JSON (~300 KB → ~400 KB po kodowaniu)
    bodyLimit: 6 * 1024 * 1024,
  });
  // kontekst żądania (device_id do events) + bramka sesji — przed trasami
  withRequestContext(app);

  /* Health ma odpowiadać na pytanie „czy wdrożenie jest poprawne", a nie tylko
     „czy proces API odpowiada". Do tej pory raportował wyłącznie własny config,
     więc najgroźniejsza pomyłka wdrożenia — worker w innym trybie niż API —
     była przez niego NIEWYKRYWALNA. Teraz `ok` jest fałszywe, gdy cokolwiek
     wymaga uwagi, a `problemy` mówią zdaniami co zrobić. */
  app.get("/api/health", async () => {
    const worker = stanWorkera();
    /* Blok Sfery istnieje TYLKO przy SFERA_WORKER=1. Bez przełącznika brak
       tego procesu jest normą (etapy 0-1 wdrożenia) i zdanie o nim robiłoby
       każdą dotychczasową instalację czerwoną bez powodu. */
    const sfera = config.sferaWorker ? stanSfery() : null;
    const problemy = [
      worker.problem,
      sfera?.problem ?? null,
      config.sferaWorker ? zaleglosciMm() : null,
      /* PIERWSZY na liście świadomie: przykryta konfiguracja unieważnia
         wszystko, co niżej. Aplikacja czyta wtedy inną bazę, niż mówi plik,
         więc każdy kolejny objaw jest skutkiem, nie przyczyną. */
      problemPrzykrytejKonfiguracji(envFile, config.sgtMode),
      brakDostepuDoMagazynow,
      brakKolumnyZrealizowano,
      /* Zdjęcia: brak dostępu do źródła wygląda dokładnie tak samo jak
         kartoteka bez zdjęcia — pusty slot na karcie. Bez tego zdania nikt by
         nie skojarzył, że przyczyną jest brak GRANT-u albo zły katalog. */
      brakDostepuDoZdjec,
      /* Kod dostawy bez nazwy nie zatrzymuje pracy, więc nie jest błędem
         konfiguracji — ale dokumenty chodzą wtedy po ekranie jako `TYP-7`
         i ktoś powinien to dokończyć. Bez tej linii nie miałoby to gdzie
         wypłynąć. */
      nienazwaneTypyDostaw(),
    ].filter((x): x is string => x !== null);
    return {
      ok: problemy.length === 0,
      /* Wersja serwera — kolektor pokazuje ją obok własnej na dole ekranu.
         Rozjazd („serwer 0.5.0, kolektor 0.4.0") to najczęstsze pytanie po
         aktualizacji: `git pull` przestawia serwer, ale APK na kolektorze
         zostaje stary do czasu rozesłania przez MDM. */
      wersja: WERSJA,
      mode: config.sgtMode,
      sferaMode: config.sferaMode,
      // skąd wzięła się konfiguracja — pierwsze pytanie przy „u mnie nie działa"
      configZPliku: envFile.path,
      /* Które klucze z pliku PRZEGRAŁY ze środowiskiem. Same nazwy, nigdy
         wartości — w pliku leży MSSQL_PASSWORD. Puste w zdrowej instalacji. */
      configPrzykryte: envFile.overridden,
      worker: {
        zyje: worker.zyje,
        mode: worker.sgtMode,
        widziany: worker.widziany,
      },
      /* Pole addytywne — kolektor go nie deserializuje (Dtos.kt ignoruje
         nieznane pola), więc stare APK nie mają czego zepsuć. */
      ...(sfera ? { sfera: { zyje: sfera.zyje, mode: sfera.sgtMode, widziany: sfera.widziany } } : {}),
      /* Ślad audytowy NIE JEST czyszczony — to świadoma decyzja, bo reklamacja
         przychodzi po miesiącach. Ale „rośnie w nieskończoność" bez licznika
         kończy się pełnym dyskiem o trzeciej w nocy, więc rozmiar i wiek
         historii widać tutaj. Decyzję o archiwum podejmuje się na liczbach. */
      audyt: statystykiAudytu(),
      /* Liczby cache'u zdjęć — po to, żeby ZDJECIA_MAX_KB dobierać na danych
         z własnej bazy, a nie na przypuszczeniu, ile waży typowe zdjęcie. */
      ...(config.zdjecia.zrodlo ? { zdjecia: statystykiZdjec() } : {}),
      ...(config.sgtMode === "mssql" ? { lastSync: lastImport } : {}),
      ...(problemy.length ? { problemy } : {}),
    };
  });

  // wymuszenie odświeżenia read-modelu (mssql): np. po przyjęciu dostawy w Subiekcie
  app.post("/api/admin/resync", async (_req, reply) => {
    if (config.sgtMode !== "mssql") {
      return reply.code(400).send({ error: "resync dostępny tylko w SGT_MODE=mssql" });
    }
    const stats = await importFromMssql();
    return { ok: true, stats };
  });

  await app.register(productRoutes);
  await app.register(queueRoutes);
  await app.register(przesuniecieRoutes);
  await app.register(deliveryRoutes);
  await app.register(problemRoutes);
  await app.register(locationRoutes);
  await app.register(deviceRoutes);
  await app.register(authRoutes);
  await app.register(magazynRoutes);
  await app.register(audytRoutes);
  await app.register(biuroRoutes);

  await app.ready();
  return app;
}

async function main() {
  db(); // migracja schematu przy starcie
  zamelduj("api");

  // SGT_MODE=mssql: read-model sgt_* zasilany z bazy Subiekta — import przy
  // starcie (twardy błąd, gdy baza nieosiągalna), potem co MSSQL_SYNC_MS.
  if (config.sgtMode === "mssql") {
    await importFromMssql();
    setInterval(() => {
      importFromMssql().catch((e) =>
        console.error("[mssql] odświeżenie nieudane:", e instanceof Error ? e.message : e)
      );
    }, config.mssql.syncMs);
  }

  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] WERTIS serwer na http://${config.host}:${config.port} · SGT_MODE=${config.sgtMode}`);
}

/* Import z testu nie może uruchomić serwera. `import.meta.main` jest w Node
   dopiero od 24, a repo celuje w 22.5, więc porównujemy ścieżkę wprost. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
