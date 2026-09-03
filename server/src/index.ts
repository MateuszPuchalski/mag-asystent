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
import { lokalizacjeMasoweRoutes } from "./routes/lokalizacje-masowe.js";
import { dostawcyRoutes } from "./routes/dostawcy.js";
import { kartonRoutes } from "./routes/karton.js";
import { allegroRoutes } from "./routes/allegro.js";
import { zadaniaTerenoweRoutes } from "./routes/zadania-terenowe.js";
import { panelObslugiRoutes } from "./routes/panel-obslugi.js";
import { skrzynkaRoutes } from "./routes/skrzynka.js";
import { zwrotyRoutes } from "./routes/zwroty.js";
import { ustawieniaRoutes } from "./routes/ustawienia.js";
import { wiedzaRoutes } from "./routes/wiedza.js";
import { koszeRoutes } from "./routes/kosze.js";
import {
  bladImportuFaktur,
  brakKolumnyNrOryg,
  brakKolumnyUwag,
  bladImportuMm,
  brakDostepuDoMagazynow,
  brakKolumnyZrealizowano,
  importFromMssql,
  lastImport,
  przyjeciaBezPozycji,
} from "./adapters/subiekt.mssql.js";
import { problemAllegro, problemUserAgenta, stanPolaczenia } from "./services/allegro-token.js";
import { nienazwaneTypyDostaw } from "./adapters/typy-dokumentow.js";
import { brakDostepuDoZdjec } from "./adapters/zdjecia.sgt.js";
import { brakDostepuDoTla } from "./adapters/tlo.js";
import { statystykiWlasnych } from "./services/zdjecia-wlasne.js";
import { statystykiZdjec, zapomnijBrakiZdjec } from "./services/zdjecia.js";
import { zamelduj, stanWorkera, stanSfery, zaleglosciMm } from "./services/process-state.js";
import { WERSJA } from "./wersja.js";
import { stanSynchronizacjiHealth } from "./services/allegro-inbox-sync-state.js";
import { stanObslugiHealth } from "./services/skrzynka.js";
import { synchronizujAllegroInbox } from "./services/allegro-inbox-sync.js";
import { synchronizujAllegroZwroty } from "./services/allegro-zwroty-sync.js";
import { synchronizujAllegroRabaty } from "./services/allegro-rabaty-sync.js";
import { uzupelnijZamowienia } from "./services/allegro-zamowienia-sync.js";
import { uzupelnijOferty } from "./services/allegro-oferty-sync.js";
import { uruchomTakt } from "./services/takt.js";
import { zwiazPewne } from "./services/sygnatury.js";
import { zwiazFakturyPewne } from "./services/faktury.js";
import { allegroTryb } from "./adapters/allegro.js";
import { poImporcie, pochodnePuste } from "./services/po-imporcie.js";

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
/**
 * Stan ostatniego odświeżenia read-modelu Subiekta.
 *
 * `null` znaczy „ostatni przebieg się udał". Wartość trafia na listę problemów
 * w `/api/health`, więc nieświeży read-model jest WIDOCZNY, a nie domyślany.
 */
let bladImportuStartowego: string | null = null;

/**
 * Odświeżenie read-modelu, którego awaria NIE kładzie serwera.
 *
 * Do 0.149.0 import przy starcie był twardym błędem: `main()` czekał na
 * `importFromMssql()` przed `app.listen()`, a wyjątek kończył proces. Decyzja
 * była świadoma („twardy błąd, gdy baza nieosiągalna") i okazała się kosztowna:
 * 1 września 2026 jeden zerwany klucz obcy w imporcie położył CAŁE API
 * w pętli restartów NSSM — razem z kolektorami, które o Subiekta nie pytają,
 * i z panelem biura, który czyta własne tabele. To ta sama awaria co 0.53.1,
 * tylko z inną przyczyną pod spodem.
 *
 * Nowa reguła: read-model ma prawo być nieświeży, API nie ma prawa nie wstać.
 * Stan sprzed ostatniego udanego importu zostaje w SQLite (transakcja się
 * wycofuje), więc kolektor pracuje na danych sprzed awarii zamiast na niczym,
 * a `/api/health` mówi zdaniem, że tak jest.
 */
export async function odswiezReadModel(
  etap: "start" | "cykl",
  /* Import wstrzykiwany, żeby dało się sprawdzić NIEBLOKUJĄCOŚĆ bez serwera
     MSSQL. Bez tego jedyną drogą do tego zachowania byłoby wywrócenie
     produkcji — a właśnie tak się o nim dowiedzieliśmy. */
  imp: () => Promise<unknown> = importFromMssql,
): Promise<void> {
  try {
    await imp();
    bladImportuStartowego = null;
  } catch (e) {
    const powod = e instanceof Error ? e.message : String(e);
    bladImportuStartowego =
      `Import z Subiekta nie powiódł się (${etap}): ${powod}. ` +
      "Kartoteki i stany pochodzą z ostatniego udanego odświeżenia.";
    console.error("[mssql] odświeżenie nieudane:", powod);
  }
}

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
    /* Trasa zdrowia jest JEDYNYM sposobem, w jaki instalator i biuro poznają,
       że system żyje — `Test-WertisHealth` odpytuje ją piętnaście razy i po
       piętnastym wyjątku melduje „API nie odpowiedziało". Blok, który rzuci,
       nie ma więc prawa zabrać ze sobą całej odpowiedzi: zwraca `null`
       i melduje się zdaniem wśród problemów. Odpowiedź niepełna mówi, czego
       brakuje; brak odpowiedzi nie mówi nic. */
    const awarie: string[] = [];
    const bez = <T>(nazwa: string, fn: () => T): T | null => {
      try {
        return fn();
      } catch (e) {
        awarie.push(`Blok „${nazwa}" trasy zdrowia padł: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    };

    const worker = bez("worker", stanWorkera) ?? { problem: null, zyje: false, sgtMode: "?", widziany: null };
    /* Blok Sfery istnieje TYLKO przy SFERA_WORKER=1. Bez przełącznika brak
       tego procesu jest normą (etapy 0-1 wdrożenia) i zdanie o nim robiłoby
       każdą dotychczasową instalację czerwoną bez powodu. */
    const sfera = config.sferaWorker ? bez("worker Sfery", stanSfery) : null;
    /* Bloki danych liczone PRZED listą problemów, nie w obiekcie zwracanym:
       `bez()` melduje awarię dopisaniem do `awarie`, a lista problemów jest
       budowana raz. Odwrotna kolejność dawała pustą sekcję BEZ zdania o tym,
       dlaczego jest pusta — czyli dokładnie tę ciszę, którą ta trasa ma łamać. */
    const allegro = bez("połączenie Allegro", stanPolaczenia);
    const allegroInbox = bez("synchronizacja Allegro", () => stanSynchronizacjiHealth(db()));
    const obsluga = bez("obsługa klienta", stanObslugiHealth);
    const audyt = bez("audyt", statystykiAudytu);

    const problemy = [
      worker.problem,
      sfera?.problem ?? null,
      config.sferaWorker ? bez("zaległości MM", zaleglosciMm) : null,
      /* PIERWSZY na liście świadomie: przykryta konfiguracja unieważnia
         wszystko, co niżej. Aplikacja czyta wtedy inną bazę, niż mówi plik,
         więc każdy kolejny objaw jest skutkiem, nie przyczyną. */
      bez("konfiguracja", () => problemPrzykrytejKonfiguracji(envFile, config.sgtMode)),
      brakDostepuDoMagazynow,
      brakKolumnyZrealizowano,
      /* Sprzedaż bez kolumny numeru obcego wiąże dokument tylko ręką: zwrot
         dopasuje się po pozycjach, ale wskazać musi człowiek. Na ekranie
         wygląda to jak „numer paragonu się nie pokazuje". Te dwa zdania
         osierociały w 0.140.0 razem z read-modelem i wracają tu z nim
         w 0.174.0. */
      brakKolumnyNrOryg,
      /* Uwagi dokumentu niedostępne — a to w nich Sellasist wpisuje numer
         zamówienia (0.175.0). Bez nich automat nie zwiąże ani jednego zwrotu,
         choć wszystko inne działa; ktoś ma się o tym dowiedzieć. */
      brakKolumnyUwag,
      /* Odczyt sprzedaży padł w całości (timeout/8623) — zwroty pokazują
         dokument z ostatniej udanej synchronizacji, ktoś ma o tym wiedzieć. */
      bladImportuFaktur,
      /* Przyjęcia na regał zwrotów. Odczyt padł w całości — zakładka ZWROTY
         pracuje na danych sprzed awarii. Do 0.76.1 tego zdania na liście
         brakowało, więc awaria nie miała jak wypłynąć. */
      bladImportuMm,
      /* Groźniejszy od awarii jest pusty wynik: dokumenty są, pozycji zero,
         a kosz z zerem pozycji na kolektorze wygląda jak dzień bez zwrotów. */
      bez("przyjęcia bez pozycji", przyjeciaBezPozycji),
      bez("konto Allegro", problemAllegro),
      /* Brak własnego User-Agenta grozi zablokowaniem klucza przez Allegro
         (ostrzeżenie z ekranu rejestracji aplikacji), a objawia się dopiero
         blokadą — czyli wtedy, gdy jest już za późno na spokojną naprawę. */
      bez("User-Agent Allegro", problemUserAgenta),
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
      bez("typy dostaw", nienazwaneTypyDostaw),
      /* Read-model Subiekta bywa nieświeży i to jest stan do zameldowania,
         a nie powód, żeby nie wstać — patrz `odswiezReadModel`. */
      bladImportuStartowego,
      ...awarie,
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
      allegro,
      allegroInbox,
      /* Liczby obsługi klienta z §21 projektu panelu: ile pytań czeka i jak
         długo wisi najstarsze zadanie dla hali. Same liczby — trasa jest
         publiczna, więc klient, treść i numer oferty tu nie wchodzą. */
      obsluga,
      /* Liczby obsługi klienta z §21 projektu panelu: ile pytań czeka i jak
         długo wisi najstarsze zadanie dla hali. Same liczby — trasa jest
         publiczna, więc klient, treść i numer oferty tu nie wchodzą. */
      /* Pole addytywne — kolektor go nie deserializuje (Dtos.kt ignoruje
         nieznane pola), więc stare APK nie mają czego zepsuć. */
      ...(sfera ? { sfera: { zyje: sfera.zyje, mode: sfera.sgtMode, widziany: sfera.widziany } } : {}),
      /* Ślad audytowy NIE JEST czyszczony — to świadoma decyzja, bo reklamacja
         przychodzi po miesiącach. Ale „rośnie w nieskończoność" bez licznika
         kończy się pełnym dyskiem o trzeciej w nocy, więc rozmiar i wiek
         historii widać tutaj. Decyzję o archiwum podejmuje się na liczbach. */
      audyt,
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
  await app.register(lokalizacjeMasoweRoutes);
  await app.register(dostawcyRoutes);
  await app.register(koszeRoutes);
  await app.register(kartonRoutes);
  await app.register(allegroRoutes);
  await app.register(zadaniaTerenoweRoutes);
  await app.register(panelObslugiRoutes);
  await app.register(skrzynkaRoutes);
  await app.register(zwrotyRoutes);
  await app.register(ustawieniaRoutes);
  await app.register(wiedzaRoutes);
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

  /* SGT_MODE=mssql: read-model sgt_* zasilany z bazy Subiekta — import przy
     starcie, potem co MSSQL_SYNC_MS. Awaria NIE kończy procesu; uzasadnienie
     przy `odswiezReadModel`. */
  if (config.sgtMode === "mssql") {
    await odswiezReadModel("start");
    setInterval(() => void odswiezReadModel("cykl"), config.mssql.syncMs);
  }
  /* Pierwszy start po aktualizacji do E3 (albo seeded bez ponownego seeda):
     kartoteka już jest, pochodne opisów jeszcze nie. Raz, tylko w api —
     worker ma własny `migrate()`, ale nie ma czytelnika tych tabel. */
  if (pochodnePuste()) poImporcie();

  /* Wyłącznie punkt wejścia uruchamia pracę w tle: import buildApp w testach
     ani narzędzia administracyjne nie mogą zacząć odpytywać Allegro. */
  if (config.allegro.clientId && allegroTryb() === "http") {
    uruchomTakt("allegro-inbox", config.allegro.inboxSyncMs, synchronizujAllegroInbox);
    /* Drugi ticker na TYM SAMYM adresie IP, więc rytm musi być inny — nie
       tylko przesunięty. `uruchomTakt` daje rozrzut i losowy start, a bazowy
       odstęp zwrotów jest pięć razy dłuższy od skrzynki: zwrot ma termin
       w dniach, pytanie klienta czeka na odpowiedź. Równy chór dwóch pętli
       to ta sygnatura maszyny, która w sierpniu 2026 skończyła się blokadą
       (patrz nagłówek `services/takt.ts`). */
    /* Wiązanie po sygnaturze idzie ZARAZ PO synchronizacji, w takcie, nigdy
       przy otwarciu ekranu. Nowy zwrot bywa gotowy do powiązania od razu —
       gdy zamówienie stoi już w bazie. */
    uruchomTakt("allegro-zwroty", config.allegro.zwrotySyncMs, async () => {
      await synchronizujAllegroZwroty();
      zwiazPewne(db());
      /* Dokument sprzedaży PO kartotece (0.174.0): wiąże go numer zamówienia,
         więc kolejność nie jest wymogiem — ale kandydaci do wskazania ręcznego
         liczą się z `tw_id`, a te dopiero co powstały. */
      zwiazFakturyPewne(db());
    });
    /* Wnioski o rabat idą OSOBNYM taktem, nie doklejone do zwrotów: jedna
       końcówka nie ma prawa zabrać drugiej ze sobą, gdy odpowie błędem
       (blizna 0.149.2 — jeden zepsuty wątek zatrzymywał całą synchronizację). */
    uruchomTakt("allegro-rabaty", config.allegro.rabatySyncMs, synchronizujAllegroRabaty);
    /* Trzeci ticker, najrzadszy z całej trójki. Uzupełnia zamówienia do
       zwrotów, które już mamy, więc po kilku przebiegach nie ma czego
       pobierać i milczy — a gdy zwrot dojdzie, dociągnie mu kontekst
       w kwadrans. Zwrot i tak ma termin liczony w dniach. */
    /* I DRUGI RAZ TUTAJ, bo zamówienie dochodzi zwykle PO zwrocie: to dopiero
       ono niesie sygnaturę, więc bez tego wywołania pozycja czekałaby na
       powiązanie do następnego przebiegu zwrotów. */
    uruchomTakt("allegro-zamowienia", config.allegro.zamowieniaSyncMs,
      async () => { await uzupelnijZamowienia(); zwiazPewne(db()); zwiazFakturyPewne(db()); });
    /* Czwarty ticker: tytuły ofert do rozmów (0.178.0). Osobno od zamówień,
       bo dotyczy pytań SPRZED zakupu — tam zamówienia nie ma i nigdy nie
       będzie, a agent i tak potrzebuje wiedzieć, o czym rozmawia. Partia
       mieści się w jednym żądaniu, więc ten takt to jedno wywołanie na cykl. */
    uruchomTakt("allegro-oferty", config.allegro.ofertySyncMs, async () => { await uzupelnijOferty(); });
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
