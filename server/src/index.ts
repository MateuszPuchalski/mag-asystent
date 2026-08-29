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
import { withEtag } from "./routes/etag.js";
import { deviceRoutes } from "./routes/device.js";
import { authRoutes } from "./routes/auth.js";
import { audytRoutes } from "./routes/audyt.js";
import { analizaRoutes } from "./routes/analiza.js";
import { statystykiAudytu } from "./services/audyt.js";
import { ziarnoKontaDemo } from "./services/users.js";
import { magazynRoutes } from "./routes/magazyny.js";
import { aktualizacjaRoutes } from "./routes/aktualizacja.js";
import { biuroRoutes } from "./routes/biuro.js";
import { zbiorkiRoutes } from "./routes/zbiorki.js";
import { dostawcyRoutes } from "./routes/dostawcy.js";
import { zwrotyRoutes } from "./routes/zwroty.js";
import { pytaniaRoutes } from "./routes/pytania.js";
import { dyskusjeRoutes } from "./routes/dyskusje.js";
import { sprawyRoutes } from "./routes/sprawy.js";
import { szablonyRoutes } from "./routes/szablony.js";
import { opinieRoutes } from "./routes/opinie.js";
import { kartonRoutes } from "./routes/karton.js";
import { koszeRoutes } from "./routes/kosze.js";
import {
  bladImportuMm,
  bladImportuSprzedazy,
  brakDostepuDoMagazynow,
  brakKolumnSprzedazy,
  brakKolumnyZrealizowano,
  importFromMssql,
  lastImport,
  przyjeciaBezPozycji,
} from "./adapters/subiekt.mssql.js";
import { problemAllegro, problemUserAgenta, stanPolaczenia } from "./services/allegro-token.js";
import { uruchomTickerZapowiedzi } from "./services/zapowiedzi.js";
import { uruchomTickerPytan } from "./services/pytania.js";
import { uruchomTickerDyskusji } from "./services/dyskusje.js";
import { przebudujSprawy } from "./services/sprawa.js";
import { dosypOsCzasu } from "./services/os-sprawy.js";
import { nienazwaneTypyDostaw } from "./adapters/typy-dokumentow.js";
import { brakDostepuDoZdjec } from "./adapters/zdjecia.sgt.js";
import { brakDostepuDoTla } from "./adapters/tlo.js";
import { statystykiWlasnych } from "./services/zdjecia-wlasne.js";
import { statystykiZdjec, zapomnijBrakiZdjec } from "./services/zdjecia.js";
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
  // ETag/304 dla odpytywanych odczytów — kolektor rewaliduje zamiast pobierać
  withEtag(app);

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
      /* Sprzedaż bez kolumny numeru obcego dopasowuje zwroty tylko po
         pozycjach; konto Allegro niesparowane wysypuje każdy skan etykiety.
         Oba stany wyglądają na ekranie jak „zwroty nie działają". */
      brakKolumnSprzedazy,
      /* Odczyt sprzedaży padł w całości (timeout/8623) — zwroty dopasowują
         na danych z ostatniej udanej synchronizacji, ktoś ma o tym wiedzieć. */
      bladImportuSprzedazy,
      /* Przyjęcia na regał zwrotów. Odczyt padł w całości — zakładka ZWROTY
         pracuje na danych sprzed awarii. Do 0.76.1 tego zdania na liście
         brakowało, więc awaria nie miała jak wypłynąć. */
      bladImportuMm,
      /* Groźniejszy od awarii jest pusty wynik: dokumenty są, pozycji zero,
         a kosz z zerem pozycji na kolektorze wygląda jak dzień bez zwrotów. */
      przyjeciaBezPozycji(),
      problemAllegro(),
      /* Brak własnego User-Agenta grozi zablokowaniem klucza przez Allegro
         (ostrzeżenie z ekranu rejestracji aplikacji), a objawia się dopiero
         blokadą — czyli wtedy, gdy jest już za późno na spokojną naprawę. */
      problemUserAgenta(),
      /* Zdjęcia: brak dostępu do źródła wygląda dokładnie tak samo jak
         kartoteka bez zdjęcia — pusty slot na karcie. Bez tego zdania nikt by
         nie skojarzył, że przyczyną jest brak GRANT-u albo zły katalog. */
      brakDostepuDoZdjec,
      /* Usuwanie tła: gdy usługa nie odpowiada, zdjęcia zapisują się z tłem —
         czyli tak samo, jak gdy magazynier sam wybrał „ZOSTAW TŁO". Różnicy
         nie widać nigdzie poza tym zdaniem. */
      brakDostepuDoTla,
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
      /* Etykieta instancji (0.69.0). Trasa jest bez sesji i tak ma być:
         etykieta nie jest daną biura, a ostrzeżenie „to jest dev" musi być
         widoczne PRZED zalogowaniem — właśnie wtedy człowiek myli serwery. */
      srodowisko: config.srodowisko,
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
      /* Stan konta Allegro dla ikony w pasku (0.114.0) — panel ma go widzieć
         z każdej zakładki, a nie dopiero po odczycie listy zwrotów. Trasa jest
         publiczna i to jest w porządku: payload to stan/środowisko/data
         wygaśnięcia — bez loginu konta i bez tokenów. */
      allegro: stanPolaczenia(),
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
      /* Zdjęcia zrobione kolektorem, które NIE WESZŁY jeszcze do Subiekta.
         Liczba rosnąca z dnia na dzień znaczy, że zadania `set_zdjecie` stoją
         w błędzie — a objawu nie widać nigdzie indziej, bo karta pokazuje
         zdjęcie z naszej kopii i wygląda poprawnie. */
      ...(config.zdjecia.dodawanie ? { zdjeciaWlasne: statystykiWlasnych() } : {}),
      ...(config.sgtMode === "mssql" ? { lastSync: lastImport } : {}),
      ...(problemy.length ? { problemy } : {}),
    };
  });

  /* Wymuszenie ponownego pytania o zdjęcia, których wcześniej nie było.
     Zdjęcie dodane w Subiekcie pojawia się samo po ZDJECIA_BRAK_TTL_H, ale
     przy wdrożeniu i przy sprawdzaniu „czy już działa" nikt nie będzie czekał
     kilkunastu godzin. Kolektor ma własną dobową pamięć braku — po tym
     wywołaniu zobaczy zdjęcie najdalej nazajutrz, a nie po tygodniu. */
  app.post("/api/admin/zdjecia/odswiez", async (_req, reply) => {
    if (config.zdjecia.zrodlo === "") {
      return reply.code(400).send({ error: "Zdjęcia są wyłączone (ZDJECIA_ZRODLO puste)" });
    }
    return { ok: true, zapomniano: zapomnijBrakiZdjec() };
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
  await app.register(analizaRoutes);
  await app.register(biuroRoutes);
  await app.register(zbiorkiRoutes);
  await app.register(dostawcyRoutes);
  await app.register(zwrotyRoutes);
  await app.register(pytaniaRoutes);
  await app.register(dyskusjeRoutes);
  await app.register(sprawyRoutes);
  await app.register(szablonyRoutes);
  await app.register(opinieRoutes);
  await app.register(koszeRoutes);
  await app.register(kartonRoutes);
  await app.register(aktualizacjaRoutes);

  await app.ready();
  return app;
}

async function main() {
  db(); // migracja schematu przy starcie
  /* Konto demo admin/admin — tylko seeded, tylko pusta baza. Tu, nie
     w buildApp(): testy tras sprawdzają bootstrap „pierwsze konto bez
     sesji", który by przy gotowym koncie zniknął. */
  ziarnoKontaDemo();
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

  /* Zapowiedzi zwrotów z Allegro — w main(), nie w buildApp(): testy tras
     budują aplikację i nie mają prawa uruchamiać pętli sięgającej do API. */
  uruchomTickerZapowiedzi();
  /* Pytania klientów (0.80.0) — ten sam powód i ten sam interwał: praca w tle
     na tym samym koncie Allegro, plus szkice, żeby otwarte pytanie miało
     odpowiedź gotową, a nie przycisk „wygeneruj” i czekanie. */
  uruchomTickerPytan();
  /* Dyskusje i reklamacje Allegro — ten sam powód i ten sam interwał: rejestr
     spraw ma schodzić z kolejki sam, gdy panel Allegro je zamyka. */
  uruchomTickerDyskusji();

  /* Nakładka spraw dogania rejestry przy starcie (0.128.0): baza sprzed tego
     wydania nie ma ani jednego wiersza w `sprawa`, a rekoncyliacja żyje przy
     mutacjach. W main(), nie w migrate() — migrate() nie może wołać serwisu
     (cykl importów db → serwis → db); nie w buildApp() — testy tras nie
     mają prawa zależeć od rekoncyliacji. */
  przebudujSprawy();
  /* Oś czasu dogania zastane rejestry (0.130.0) — ten sam powód i to samo
     miejsce co wyżej. Bez dosypki każda sprawa sprzed aktualizacji miałaby
     pustą historię, co czyta się jak awaria, a nie jak brak danych.
     Idempotentna, więc kolejne starty nie dopisują nic. */
  const dosypanych = dosypOsCzasu();
  if (dosypanych > 0) console.log(`[api] oś czasu spraw: dosypano ${dosypanych} zdarzeń`);

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
