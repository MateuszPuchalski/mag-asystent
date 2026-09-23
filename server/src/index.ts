import Fastify from "fastify";
import { pathToFileURL } from "node:url";
import { config, envFile } from "./config.js";
import { problemPrzykrytejKonfiguracji } from "./env-file.js";
import { withRequestContext, sesjaZadania } from "./context.js";
import { autoryzuj } from "./services/auth.js";
import { db } from "./db/db.js";
import { productRoutes } from "./routes/products.js";
import { queueRoutes } from "./routes/queue.js";
import { przesuniecieRoutes } from "./routes/przesuniecie.js";
import { deliveryRoutes } from "./routes/delivery.js";
import { problemRoutes } from "./routes/problems.js";
import { locationRoutes } from "./routes/locations.js";
import { withEtag } from "./routes/etag.js";
import { deviceRoutes } from "./routes/device.js";
import { kolektoryRoutes } from "./routes/kolektory.js";
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
import { panelObslugiRoutes, problemPaneluObslugi, wersjaPaneluObslugi }
  from "./routes/panel-obslugi.js";
import { skrzynkaRoutes } from "./routes/skrzynka.js";
import { copilotRoutes } from "./routes/copilot.js";
import { zwrotyRoutes } from "./routes/zwroty.js";
import { reklamacjeRoutes } from "./routes/reklamacje.js";
import { dyskusjeRoutes } from "./routes/dyskusje.js";
import { tagiRoutes } from "./routes/tagi.js";
import { ustawieniaRoutes } from "./routes/ustawienia.js";
import { wiedzaRoutes } from "./routes/wiedza.js";
import { koszeRoutes } from "./routes/kosze.js";
import {
  bladImportuFaktur,
  brakKolumnyNrOryg,
  brakKolumnyUwag,
  brakKolumnyKorekty,
  bladImportuMm,
  bladImportuCen,
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
import { stanReklamacjiHealth } from "./services/allegro-reklamacje-sync-state.js";
import { stanObslugiHealth } from "./services/skrzynka.js";
import { synchronizujAllegroInbox } from "./services/allegro-inbox-sync.js";
import { synchronizujAllegroZwroty } from "./services/allegro-zwroty-sync.js";
import { synchronizujAllegroReklamacje } from "./services/allegro-reklamacje-sync.js";
import { synchronizujAllegroRabaty } from "./services/allegro-rabaty-sync.js";
import { zlozBrakujaceWnioski } from "./services/rabaty-automat.js";
import { zglosRabat } from "./adapters/allegro.http.js";
import { uzupelnijZamowienia } from "./services/allegro-zamowienia-sync.js";
import { uzupelnijOferty } from "./services/allegro-oferty-sync.js";
import { ulozZalegleSzkice } from "./services/copilot-auto-szkic.js";
import { sklasyfikujNowe } from "./services/klasyfikacja-auto.js";
import { oproznijKolejke } from "./services/wiedza-automat.js";
import { nadawcaKluczaAnthropic } from "./adapters/copilot.anthropic.js";
import { uruchomTakt } from "./services/takt.js";
import { powiazPoImporcieSubiekta, powiazZaleglosci } from "./services/wiazania.js";
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
    /* KOREKTA WCHODZI Z SUBIEKTA, więc wiąże się ZARAZ PO imporcie (audyt
       zwrotów, 15 września 2026). Do tego wydania czekała na takt Allegro, a
       operator przepisywał numer ręką. Po udanym imporcie, nie w `finally`:
       nieudany zostawia stare dokumenty i nie ma czego wiązać. Każdy krok ma
       własny parasol w `wiazania.ts`, więc wiązanie nie udaje awarii importu. */
    powiazPoImporcieSubiekta(db());
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
    /* ── STAN SYNCHRONIZACJI SPRAW POSPRZEDAŻOWYCH (0.409.0) ─────────────────
       Zgłoszenie właściciela: „reklamacje w aplikacji mają nieaktualny stan".

       `stanReklamacjiHealth` istniał od 0.222.0 i ta trasa go NIE WOŁAŁA —
       przez trzy kwartały `/api/health` mówił o skrzynce i milczał o sprawach
       posprzedażowych. Właściciel przysłał wynik tej trasy, żeby pokazać
       problem z reklamacjami, a odpowiedzi na to pytanie w nim nie było.

       Sam blok panel czyta od dawna (pasek tła na kolejce reklamacji), ale to
       jest ekran pracy, a nie miejsce, do którego się zagląda, gdy coś jest
       nie tak. Zdrowie ma odpowiadać na pytanie „co się dzieje" bez logowania
       się do panelu. */
    const allegroReklamacje = bez("synchronizacja spraw", () => stanReklamacjiHealth(db()));
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
      /* ── OGON SPRAW, KTÓREGO PRZEBIEG NIE WZIĄŁ (0.409.0) ─────────────────
         Bezpiecznik stron czyta najwyżej tysiąc spraw na przebieg. Konto
         z dłuższym archiwum zostawia resztę po tamtej stronie — i to są
         sprawy, których STATUS u nas się nie odświeża, choć w Allegro dawno
         się zmienił. Dokładnie to zgłosił właściciel: „reklamacje mają
         nieaktualny stan".

         Liczba stała w bazie od 0.222.0 i widział ją wyłącznie pasek nad
         kolejką reklamacji. Tutaj wchodzi jako ZDANIE, bo `problemy` są tym,
         co człowiek czyta, gdy coś nie działa — i to stąd wziął odpowiedź
         o cenach dwie godziny wcześniej. */
      bez("ogon spraw posprzedażowych", () => {
        const p = allegroReklamacje?.pozostaloDoPobrania ?? null;
        return p && p > 0
          ? `Synchronizacja spraw posprzedażowych nie dociąga ${p} spraw — `
            + "bezpiecznik stron czyta najwyżej tysiąc na przebieg. Status tych "
            + "spraw w panelu NIE odświeża się wcale, choć w Allegro mógł się "
            + "zmienić. Próg daty kolejki („od …”) tego nie naprawia: obcina "
            + "widok, nie pobieranie."
          : null;
      }),
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
      /* Kolumna dokumentu korygowanego niedostępna (0.201.0) — numery korekt
         przepisuje wtedy człowiek, jak przed tym wydaniem. Bez tego zdania
         brak automatu wyglądałby na zepsuty automat. */
      brakKolumnyKorekty,
      /* Odczyt sprzedaży padł w całości (timeout/8623) — zwroty pokazują
         dokument z ostatniej udanej synchronizacji, ktoś ma o tym wiedzieć. */
      bladImportuFaktur,
      /* Przyjęcia na regał zwrotów. Odczyt padł w całości — zakładka ZWROTY
         pracuje na danych sprzed awarii. Do 0.76.1 tego zdania na liście
         brakowało, więc awaria nie miała jak wypłynąć. */
      bladImportuMm,
      /* Cennik kartotek (0.405.0). Objaw braku uprawnienia jest NIEMY: karta
         towaru bez cen wygląda dokładnie tak, jak wyglądała przed tym
         wydaniem. Bez tego zdania nikt nie skojarzyłby, że brakuje
         `GRANT SELECT ON dbo.tw_Cena`, a nie danych w Subiekcie. */
      bladImportuCen,
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
      /* PANEL ZOSTAŁ NA STARYM BUILDZIE (audyt, 15 września 2026). Najcichsza
         pomyłka wdrożenia, jaką zna to repo: `npm run build` w `server/` nie
         przebudowuje panelu, więc API melduje nową wersję, a ekran obsługi
         zostaje na starej. Wygląda to na wydanie, które „nie działa".
         Recepta w `DEPLOY.md` istniała przez siedemnaście wydań panelu i nie
         została uruchomiona ani razu — więc pyta o to teraz sama trasa. */
      bez("panel obsługi", () => problemPaneluObslugi(WERSJA)),
      ...awarie,
    ].filter((x): x is string => x !== null);
    return {
      ok: problemy.length === 0,
      /* Wersja serwera — kolektor pokazuje ją obok własnej na dole ekranu.
         Rozjazd („serwer 0.5.0, kolektor 0.4.0") to najczęstsze pytanie po
         aktualizacji: `git pull` przestawia serwer, ale APK na kolektorze
         zostaje stary do czasu rozesłania przez MDM. */
      wersja: WERSJA,
      /* Wersja ZBUDOWANEGO panelu obsługi, obok wersji serwera i z tego samego
         powodu co ona: rozjazd jest pytaniem numer jeden po aktualizacji.
         `null` znaczy „panelu tu nie ma albo jest sprzed 0.355.0" — to nie
         jest to samo co rozjazd i nie robi wdrożenia czerwonym. */
      panelObslugi: wersjaPaneluObslugi(),
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
      allegroReklamacje,
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

  /* Bramka operacji ratunkowych (0.431.0). Do tej wersji obie trasy niżej
     stały za samą sesją, więc pełny import z Subiekta mógł wywołać każdy
     zalogowany — także kolektor. `autoryzuj` zostawia w dzienniku ślad
     `privileged`, bo resync na produkcji to zdarzenie, o które ktoś zapyta. */
  const odmowaRatunku = (): { kod: number; error: string } | null => {
    const s = sesjaZadania();
    if (!s) return { kod: 401, error: "Brak sesji — zaloguj się" };
    const w = autoryzuj(s.user, "ratunek_serwera");
    return w.ok ? null : { kod: 403, error: w.powod ?? "Brak uprawnień" };
  };

  /* Wymuszenie ponownego pytania o zdjęcia, których wcześniej nie było.
     Zdjęcie dodane w Subiekcie pojawia się samo po ZDJECIA_BRAK_TTL_H, ale
     przy wdrożeniu i przy sprawdzaniu „czy już działa" nikt nie będzie czekał
     kilkunastu godzin. Kolektor ma własną dobową pamięć braku — po tym
     wywołaniu zobaczy zdjęcie najdalej nazajutrz, a nie po tygodniu. */
  app.post("/api/admin/zdjecia/odswiez", async (_req, reply) => {
    const nie = odmowaRatunku();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
    if (config.zdjecia.zrodlo === "") {
      return reply.code(400).send({ error: "Zdjęcia są wyłączone (ZDJECIA_ZRODLO puste)" });
    }
    return { ok: true, zapomniano: zapomnijBrakiZdjec() };
  });

  // wymuszenie odświeżenia read-modelu (mssql): np. po przyjęciu dostawy w Subiekcie
  app.post("/api/admin/resync", async (_req, reply) => {
    const nie = odmowaRatunku();
    if (nie) return reply.code(nie.kod).send({ error: nie.error });
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
  await app.register(kolektoryRoutes);
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
  await app.register(copilotRoutes);
  await app.register(zwrotyRoutes);
  await app.register(reklamacjeRoutes);
  await app.register(dyskusjeRoutes);
  await app.register(tagiRoutes);
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
       gdy zamówienie stoi już w bazie.

       `finally`, a nie ciąg dalszy (0.220.0). Wiązanie nie potrzebuje Allegro
       do niczego: czyta i pisze własną bazę. Gdy stało po `await`, wyjątek
       z pobierania zabierał je ze sobą przy KAŻDYM przebiegu — a zwroty
       zapisane wcześniej zostawały, więc kolejka wyglądała zdrowo i tylko
       kartotek nie było. Co robią te cztery kroki i w jakiej kolejności,
       mówi `services/wiazania.ts`. */
    uruchomTakt("allegro-zwroty", config.allegro.zwrotySyncMs, async () => {
      try {
        await synchronizujAllegroZwroty();
      } finally {
        powiazZaleglosci(db());
      }
    });
    /* Wnioski o rabat idą OSOBNYM taktem, nie doklejone do zwrotów: jedna
       końcówka nie ma prawa zabrać drugiej ze sobą, gdy odpowie błędem
       (blizna 0.149.2 — jeden zepsuty wątek zatrzymywał całą synchronizację).

       DWA KROKI W JEDNYM TAKCIE, w tej kolejności (0.320.0): najpierw lustro
       wniosków, potem składanie brakujących. Odwrotnie automat pytałby o stan
       sprzed kwadransa i składał drugi wniosek do pozycji, która pierwszy
       dostała w panelu Allegro. Składanie pod parasolem, bo odmowa jednego
       wniosku nie ma prawa zatrzymać odświeżania lustra. */
    uruchomTakt("allegro-rabaty", config.allegro.rabatySyncMs, async () => {
      await synchronizujAllegroRabaty();
      try {
        const w = await zlozBrakujaceWnioski(db(),
          (lineItemId, ilosc) => zglosRabat(config.allegro.apiUrl, lineItemId, ilosc));
        if (w.zlozone || w.bledy) {
          console.log(`[rabat] automat: ${w.zlozone} złożonych, ${w.bledy} odmów`);
        }
      } catch (e) {
        console.error("[rabat] automat:", e instanceof Error ? e.message : e);
      }
    });
    /* Reklamacje (0.222.0) — piąty ticker i piąty rytm. Gęstszy niż zwroty,
       rzadszy niż skrzynka: reklamacja niesie CZAT, więc klient czeka na
       odpowiedź jak w skrzynce, ale `decisionDueDate` liczy się w dniach.
       Osobny takt z tego samego powodu co rabaty — jedna końcówka nie ma
       prawa zabrać drugiej ze sobą, gdy odpowie błędem. */
    uruchomTakt("allegro-reklamacje", config.allegro.reklamacjeSyncMs,
      async () => { await synchronizujAllegroReklamacje(); });
    /* Trzeci ticker, najrzadszy z całej trójki. Uzupełnia zamówienia do
       zwrotów, które już mamy, więc po kilku przebiegach nie ma czego
       pobierać i milczy — a gdy zwrot dojdzie, dociągnie mu kontekst
       w kwadrans. Zwrot i tak ma termin liczony w dniach. */
    /* I DRUGI RAZ TUTAJ, bo zamówienie dochodzi zwykle PO zwrocie: to dopiero
       ono niesie sygnaturę, więc bez tego wywołania pozycja czekałaby na
       powiązanie do następnego przebiegu zwrotów. */
    uruchomTakt("allegro-zamowienia", config.allegro.zamowieniaSyncMs,
      async () => {
        /* Ten sam parasol co przy zwrotach: zamówienie bywa niepobrane, a
           zaległość z poprzedniego przebiegu i tak ma się dopiąć. */
        try {
          await uzupelnijZamowienia();
        } finally {
          powiazZaleglosci(db());
        }
      });
    /* Czwarty ticker: tytuły ofert do rozmów (0.178.0). Osobno od zamówień,
       bo dotyczy pytań SPRZED zakupu — tam zamówienia nie ma i nigdy nie
       będzie, a agent i tak potrzebuje wiedzieć, o czym rozmawia. Partia
       mieści się w jednym żądaniu, więc ten takt to jedno wywołanie na cykl. */
    uruchomTakt("allegro-oferty", config.allegro.ofertySyncMs, async () => { await uzupelnijOferty(); });
  }

  /* SZKIC SAM DLA NOWEGO PYTANIA POD OFERTĄ (0.317.0).
     Osobny warunek od tickerów Allegro, bo to inna zależność: te potrzebują
     konta Allegro, ten potrzebuje klucza dostawcy modelu. Wyłączony domyślnie
     i włączany JEDNĄ zmienną w `wertis.env` — rzecz, która wydaje pieniądze
     bez kliknięcia, ma się włączać decyzją, a nie aktualizacją.

     Rytm WŁASNY, nie doklejony do taktu skrzynki: układanie szkicu trwa
     sekundy na rozmowę, więc wpięte tam opóźniałoby pobieranie wiadomości
     o długość partii szkiców. */
  if (config.copilot.autoSzkic && config.copilot.mode === "anthropic" && config.copilot.klucz) {
    uruchomTakt("copilot-auto-szkic", config.copilot.autoMs, async () => {
      const w = await ulozZalegleSzkice();
      /* Głośno TYLKO wtedy, gdy takt stanął. Przebieg, który nic nie zastał,
         jest normą i nie ma o czym mówić. */
      if (w.przerwane) console.warn(`[copilot-auto-szkic] przebieg przerwany: ${w.przerwane}`);
    });
  }

  /* ROZPOZNANIE KAŻDEJ NOWEJ WIADOMOŚCI KLIENTA (22 września 2026). Ten sam
     warunek co szkic z taktu — klucz dostawcy, nie konto Allegro — i ta sama
     zasada: włącza się jedną zmienną w `wertis.env`, bo wydaje pieniądze bez
     kliknięcia. Rytm własny, żeby nie opóźniać pobierania wiadomości. */
  if (config.copilot.autoKlasyfikacja && config.copilot.mode === "anthropic" && config.copilot.klucz) {
    uruchomTakt("copilot-auto-klasyfikacja", config.copilot.autoKlasyfikacjaMs, async () => {
      const w = await sklasyfikujNowe();
      if (w.przerwane) console.warn(`[copilot-auto-klasyfikacja] przebieg przerwany: ${w.przerwane}`);
    });
  }

  /* KOLEJKA WIEDZY OPRÓŻNIA SIĘ SAMA (0.331.0). Takt, nie `buildApp()` —
     ta sama reguła, co przy każdym innym: testy tras nie mają dopisywać
     wiedzy do bazy w tle.

     Źródło czwarte (model językowy) podpinamy TYLKO wtedy, gdy właściciel
     włączył je osobno i Copilot ma czym mówić. Bez niego automat chodzi na
     trzech źródłach deterministycznych i nie kosztuje ani grosza. */
  if (config.wiedzaAutomat.wlaczony) {
    const zModelem = config.wiedzaAutomat.model
      && config.copilot.mode === "anthropic" && config.copilot.klucz;
    uruchomTakt("wiedza-automat", config.wiedzaAutomat.ms, async () => {
      const w = await oproznijKolejke({
        naPrzebieg: config.wiedzaAutomat.naPrzebieg,
        ...(zModelem ? { nadajKlucz: nadawcaKluczaAnthropic } : {}),
      });
      /* Głośno tylko o tym, co woła o reakcję: wiersze bez marki zostają
         człowiekowi, a błędy znaczą, że coś w kolejce nie przechodzi. */
      if (w.bezMarki || w.bledow) {
        console.warn(`[wiedza-automat] bez marki: ${w.bezMarki}, błędów: ${w.bledow}`);
      }
    });
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
