import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnvFile } from "./env-file.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Wertis.env wczytujemy PRZED literałem konfiguracji — inaczej `process.env`
   byłoby jeszcze puste. Wynik trzymamy, bo `/api/health` pokazuje, skąd wzięła
   się konfiguracja: przy zgłoszeniu „nie działa" pierwsze pytanie brzmi
   „a który plik czytasz". */
export const envFile = loadEnvFile();

/**
 * Liczba z env. Śmieci są BŁĘDEM, nie cichym powrotem do domyślnej.
 *
 * Wcześniej `MAG_ID_MAG=jeden` dawało po cichu 1. Przy magazynach to znaczy
 * dostawa w złej zakładce, a przy porcie — serwer pod innym adresem niż ten
 * wpisany na kolektorach. Obie awarie wyglądają jak „aplikacja nie działa"
 * i żadna nie prowadzi do literówki w pliku.
 */
const num = (v: string | undefined, def: number, name?: string) => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${name ?? "wartość"}=${v} — oczekiwano liczby. Popraw w wertis.env.`);
  }
  return n;
};

export const config = {
  /** Port serwera API. */
  port: num(process.env.PORT, 3001, "PORT"),
  host: process.env.HOST ?? "0.0.0.0",

  /** Ścieżka pliku bazy SQLite aplikacji. */
  dbPath:
    process.env.DB_PATH ?? path.resolve(__dirname, "../data/wertis.db"),

  /** Źródło danych Subiekta: 'seeded' (SQLite z magmat.xlsx) lub 'mssql' (produkcja). */
  sgtMode: (process.env.SGT_MODE ?? "seeded") as "seeded" | "mssql",

  /**
   * Adapter zapisu (worker) NIE jest osobną decyzją — wynika wprost ze źródła
   * danych: 'mssql' → UPDATE dwóch kolumn w bazie Subiekta, 'seeded' → mutacja
   * sgt_* (demo). Jeden przełącznik mniej do pomylenia; dawne SFERA_MODE
   * usunięte. Dokumenty MM tworzy worker Sfery (osobny proces C#/COM,
   * sfera-worker/, włączany SFERA_WORKER=1) — nigdy ten proces.
   */
  sferaMode: (process.env.SGT_MODE === "mssql" ? "sql" : "dev") as "dev" | "sql",

  /**
   * Czy dokumenty MM przejmuje osobny worker Sfery (COM, `sfera-worker/`).
   *
   * Domyślnie NIE: worker Node bierze wszystkie zadania, a `mm` w trybie mssql
   * kończy się czytelnym błędem z sfera.sql.ts („dokument MM wystawia biuro").
   * Włączony: worker Node NIE DOTYKA zadań `mm` — wykonuje je usługa
   * wertis-sfera, a jej brak melduje /api/health.
   *
   * To nie jest wybór adaptera (ten nadal wynika z SGT_MODE) — to fakt
   * „istnieje trzeci proces", którego nie da się wywieść z niczego: zależy od
   * licencji Sfery i od tego, czy exe faktycznie leży na maszynie.
   */
  sferaWorker: process.env.SFERA_WORKER === "1",

  /**
   * Połączenie z bazą MSSQL Subiekta GT (SGT_MODE=mssql).
   *
   * Co trzeba ustalić na WŁASNEJ bazie — mag_Id magazynów i pole lokalizacji
   * — opisuje rozdział „Jak ustalić wszystkie wartości"
   * w docs/subiekt-gt-struktura.md, w kolejności pytań kreatora.
   *
   * Kody dok_Typ i bufor (dok_Status = 3) NIE są już [WERYFIKUJ]: wynikają
   * ze struktury bazy 1.8731.31.6933, a nie z ustawień podmiotu.
   */
  mssql: {
    server: process.env.MSSQL_SERVER ?? "localhost",
    /** Instancja nazwana (instalator InsERT tworzy zwykle INSERTGT). */
    instance: process.env.MSSQL_INSTANCE ?? "INSERTGT",
    /** Port TCP — gdy ustawiony, ma pierwszeństwo przed instancją nazwaną. */
    port: process.env.MSSQL_PORT ? num(process.env.MSSQL_PORT, 1433, "MSSQL_PORT") : undefined,
    database: process.env.MSSQL_DATABASE ?? "",
    user: process.env.MSSQL_USER ?? "",
    password: process.env.MSSQL_PASSWORD ?? "",
    encrypt: process.env.MSSQL_ENCRYPT === "1",
    trustServerCertificate: process.env.MSSQL_TRUST_CERT !== "0",
    /**
     * Kody `dok_Typ`. Nie są już zgadywane: oficjalny „Opis struktury zbiorów
     * danych InsERT GT" dla wersji bazy 1.8731.31.6933 wylicza je wprost
     * (patrz docs/subiekt-gt-struktura.md):
     *   1-FZ, 2-FS, 3-RZ, 4-RS, 5-KFZ, 6-KFS, 9-MM, 10-PZ, 11-WZ, 12-PW,
     *   13-RW, 14-ZW, 15-ZD, 16-ZK, 21-PA, 29-IW
     * Domyślne `DOK_TYP_PZ` wynosiło wcześniej 5, czyli KFZ — korektę faktury
     * zakupu. Na prawdziwej bazie aplikacja listowałaby korekty jako dostawy
     * i nie zobaczyła ani jednego PZ.
     */
    dokTypFZ: num(process.env.DOK_TYP_FZ, 1, "DOK_TYP_FZ"),
    dokTypPZ: num(process.env.DOK_TYP_PZ, 10, "DOK_TYP_PZ"),
    /** Zamówienie do dostawcy — ZD. Wartość z tej samej listy, więc pewna. */
    dokTypZD: num(process.env.DOK_TYP_ZD, 15, "DOK_TYP_ZD"),
    /**
     * `dok_Status` zamówień, które UZNAJEMY ZA OTWARTE (CSV).
     *
     * Opis struktury wylicza tylko „5..8-zamówienia (różne stany realizacji)"
     * i NIE mówi, który numer co znaczy — domyślne poniżej bierze więc wszystkie
     * cztery i jest ZAŁOŻENIEM, nie ustaleniem ([WERYFIKUJ], DEPLOY §6).
     * Skutkiem błędu w tę stronę jest zamówienie zamknięte wiszące na karcie;
     * osłania przed tym odjęcie ilości zrealizowanej i okno importu.
     */
    dokStatusyZDOtwarte: (process.env.DOK_STATUS_ZD_OTWARTE ?? "5,6,7,8")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 0),
    /**
     * Kody `dok_Typ` DOSTAW listowanych do rozłożenia (CSV).
     *
     * Domyślnie `1` — sama FZ. U tego klienta towar wchodzi wyłącznie fakturą
     * zakupu, a PZ powstaje z zupełnie innego procesu, więc na liście pracy
     * magazyniera byłoby czystym szumem.
     *
     * Domyślne było wcześniej `1,10` (FZ i PZ), bo w firmie, gdzie towar wchodzi
     * obiema drogami, dla magazyniera to ta sama praca: paleta do rozłożenia.
     * Tam wraca się do `DOK_TYPY_DOSTAW=1,10` — to nadal jedno ustawienie,
     * nie zmiana kodu.
     *
     * Do sierpnia 2026 ta lista była ZASZYTA w zapytaniu, choć zwroty tuż obok
     * miały już listę z konfiguracji. Niespójność, nie decyzja projektowa.
     */
    dokTypyDostaw: (process.env.DOK_TYPY_DOSTAW ?? "1")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    /**
     * Ile dni wstecz importować dokumenty. Domyślnie 14.
     *
     * To jest okno IMPORTU, nie filtr widoku: dokument spoza niego nie trafia
     * do read-modelu w ogóle. Dlatego zapytanie ma wyjątek — dostawa, której
     * ktoś NIE ROZŁOŻYŁ DO KOŃCA, zostaje widoczna niezależnie od wieku
     * (patrz `otwarteDokumenty` w adapterze MSSQL).
     *
     * Bez tego wyjątku skrócenie okna kasowałoby z ekranu niedokończoną pracę,
     * a brak dostawy na liście wygląda identycznie jak dostawa rozłożona.
     */
    dokDniWstecz: num(process.env.DOK_DNI_WSTECZ, 14, "DOK_DNI_WSTECZ"),
    /**
     * Kolumna lokalizacji na tw__Towar. Nowsze wersje SGT (KSeF i późniejsze)
     * NIE mają natywnego pola „lokalizacja" — trzeba użyć jednego z ośmiu
     * generycznych pól dodatkowych (tw_Pole1..tw_Pole8, varchar(50) każde).
     * Domyślnie tw_Pole1 — [WERYFIKUJ]/wybierz sam, patrz
     * docs/subiekt-gt-edu-setup.md. Walidowana jako bezpieczny identyfikator
     * SQL (białe znaki/średniki odrzucane) przed wstrzyknięciem do zapytania.
     */
    locColumn: process.env.MSSQL_LOC_COLUMN ?? "tw_Pole1",
    /**
     * Kolumna `dok_Pozycja` z ilością JUŻ ZREALIZOWANĄ na zamówieniu. Nasz opis
     * struktury jej nie wymienia, więc domyślna nazwa to [WERYFIKUJ] — sprawdź
     * ją jednym SELECT-em (DEPLOY §6).
     *
     * Gdy kolumny nie ma, import NIE przerywa się: powtarza zapytanie bez niej,
     * wpisuje zero i melduje to w /api/health. Ilość jest wtedy zawyżona
     * o odebrane sztuki, a karta mówi wprost, że to szacunek. Cicha degradacja
     * byłaby gorsza niż brak funkcji: magazynier liczyłby na towar, którego
     * nikt już nie wyśle. Puste = świadoma rezygnacja, bez komunikatu.
     */
    zdZrealColumn: process.env.MSSQL_ZD_ZREAL_COLUMN ?? "ob_IloscZrealizowana",
    /**
     * Kolumna `dok__Dokument` z terminem realizacji zamówienia. Puste = karta
     * pokazuje zamówienia bez terminu (na końcu listy) — bo „nie wiem kiedy"
     * jest uczciwsze niż podstawienie daty wystawienia w miejsce terminu.
     */
    zdTerminColumn: process.env.MSSQL_ZD_TERMIN_COLUMN ?? "",
    /**
     * Wyrażenie SQL 0/1: dokument w buforze. `dok_Status` ma udokumentowane
     * wartości {0-wycofany, 1-wykonany, 2-unieważniony, 3-odłożony, 4-MM wydany,
     * 5..8-zamówienia}. Bufor to dokument **odłożony** (3); poprzednie domyślne
     * `= 0` wskazywało dokumenty **wycofane**, czyli mylił się w obie strony.
     */
    bufferExpr: process.env.MSSQL_BUFFER_EXPR ?? "CASE WHEN d.dok_Status = 3 THEN 1 ELSE 0 END",
    /** Interwał odświeżania read-modelu sgt_* z MSSQL [ms]. */
    syncMs: num(process.env.MSSQL_SYNC_MS, 60000, "MSSQL_SYNC_MS"),
    /**
     * Limit pojedynczego zapytania do bazy Subiekta [ms]. Domyślne 15 s
     * drivera było za krótkie dla odczytów wsadowych importu na obciążonej
     * maszynie (0.53.1) — 30 s daje zapas, a dłużej znaczy, że baza naprawdę
     * nie wyrabia i błąd jest właściwą odpowiedzią.
     */
    requestTimeoutMs: num(process.env.MSSQL_REQUEST_TIMEOUT_MS, 30000, "MSSQL_REQUEST_TIMEOUT_MS"),
    /**
     * Dokumenty SPRZEDAŻY do dopasowywania zwrotów Allegro (0.53.0).
     *
     * FS i PA z tej samej listy kodów co wyżej, więc wartości pewne. Sprzedaż
     * w tej firmie idzie OBIEMA drogami (część zamówień na fakturę, część na
     * paragon) — dlatego dwa typy, a nie jeden przełącznik.
     */
    dokTypFS: num(process.env.DOK_TYP_FS, 2, "DOK_TYP_FS"),
    dokTypPA: num(process.env.DOK_TYP_PA, 21, "DOK_TYP_PA"),
    /**
     * Okno importu dokumentów sprzedaży [dni]. WŁASNE, szersze niż okno dostaw:
     * klient ma prawo zwrotu liczone od doręczenia, a paczka wraca i po dwóch
     * miesiącach. Dokument wskazany przez NIEROZLICZONY zwrot zostaje w imporcie
     * niezależnie od wieku (ten sam wyjątek co `otwarteDokumenty`).
     */
    sprzedazDniWstecz: num(process.env.DOK_SPRZEDAZ_DNI_WSTECZ, 90, "DOK_SPRZEDAZ_DNI_WSTECZ"),
    /**
     * Kolumna `dok__Dokument` z numerem obcym/oryginalnym dokumentu.
     * Integracje sprzedażowe zwykle wpisują tam numer zamówienia — jeśli tak
     * jest i tu, dopasowanie zwrotu do dokumentu staje się jednoznaczne.
     * ISTNIENIE kolumny potwierdzone w opisie struktury 1.8731.31.6933
     * (`dok_NrPelnyOryg`, varchar 30); [WERYFIKUJ] zostaje tylko to, czy
     * integracja faktycznie wpisuje tam numer Allegro. Gdy kolumny nie ma
     * (inna wersja bazy), import ponawia zapytanie bez niej i melduje
     * w /api/health. Puste = świadoma rezygnacja z tego sygnału.
     */
    sprzedazNrOrygColumn: process.env.MSSQL_SPRZEDAZ_NR_ORYG_COLUMN ?? "dok_NrPelnyOryg",
    /**
     * Kolumna `dok__Dokument` z uwagami — drugi kandydat na miejsce, gdzie
     * integracja zostawia numer zamówienia Allegro. Domyślnie `dok_Uwagi`
     * (varchar 500) — istnienie potwierdzone w tym samym opisie struktury
     * (0.53.1; wcześniej pusta z ostrożności). Dopasowanie bez tego sygnału
     * degraduje do nakładki pozycji + ręcznego wyboru, nie do awarii.
     */
    sprzedazUwagiColumn: process.env.MSSQL_SPRZEDAZ_UWAGI_COLUMN ?? "dok_Uwagi",
  },

  /**
   * Zwroty Allegro (0.53.0) — pierwsza integracja HTTP wychodząca w tym
   * serwerze. Klient na globalnym `fetch` (Node ≥22.5), zero zależności.
   *
   * `clientId` jest WYŁĄCZNIKIEM I KONFIGURACJĄ W JEDNYM (wzorzec
   * `zdjecia.zrodlo`): puste znaczy „funkcji nie ma" i to jest domyślne.
   * Zakładka ZWROTY w /biuro mówi to wtedy wprost, /api/health milczy.
   * Ustawiony client_id BEZ sparowanego konta → zdanie w /api/health.
   *
   * Poświadczenia aplikacji rejestruje się na developer.allegro.pl (typ
   * „urządzenie" / device flow — bez redirect URI). Token konta NIE mieszka
   * w env, tylko w tabeli allegro_token: odświeżenie wydaje nową parę, więc
   * to stan, nie konfiguracja.
   */
  allegro: {
    clientId: process.env.ALLEGRO_CLIENT_ID ?? "",
    clientSecret: process.env.ALLEGRO_CLIENT_SECRET ?? "",
    /** 1 = środowisko testowe allegro.pl.allegrosandbox.pl. */
    sandbox: process.env.ALLEGRO_SANDBOX === "1",
    /**
     * Wybór adaptera. Puste = wynika z SGT_MODE (seeded → dev, mssql → http)
     * — ten sam wzorzec co `sferaMode`. `dev` wymusza fikcyjne zwroty
     * (demo na produkcyjnej maszynie, testy); `http` wymusza prawdziwe API.
     */
    mode: (process.env.ALLEGRO_MODE ?? "") as "" | "dev" | "http",
    /** Host autoryzacji (device flow + tokeny). Nadpisywalny na czarną godzinę. */
    authUrl:
      process.env.ALLEGRO_AUTH_URL ??
      (process.env.ALLEGRO_SANDBOX === "1"
        ? "https://allegro.pl.allegrosandbox.pl/auth/oauth"
        : "https://allegro.pl/auth/oauth"),
    /** Host REST API. */
    apiUrl:
      process.env.ALLEGRO_API_URL ??
      (process.env.ALLEGRO_SANDBOX === "1"
        ? "https://api.allegro.pl.allegrosandbox.pl"
        : "https://api.allegro.pl"),
  },

  /**
   * Kartoteka demo dla `npm run seed`. Leżała pod `web/public/data`, bo
   * serwowała ją skasowana już PWA — po usunięciu aplikacji webowej to są
   * po prostu DANE SERWERA i mieszkają razem z nim.
   */
  seedProducts:
    process.env.SEED_PRODUCTS ?? path.resolve(__dirname, "../seed/products.json"),

  /** Identyfikatory magazynów w SGT (spec §11 pkt 5; [WERYFIKUJ] na własnej bazie). */
  magId: {
    MAG: num(process.env.MAG_ID_MAG, 1, "MAG_ID_MAG"),
    MGP: num(process.env.MAG_ID_MGP, 2, "MAG_ID_MGP"),
    /** Magazyn zwrotów od klientów (biuro kompletuje kartony i wystawia dokument). */
    ZWROTY: num(process.env.MAG_ID_ZWROTY, 3, "MAG_ID_ZWROTY"),
  },

  /**
   * Symbole kartotek, które na dokumencie NIE są towarem (CSV).
   *
   * Domyślnie `PRZESYŁKA` — wiersz „koszt transportu" stojący na części faktur
   * zakupu. Nie ma go czym zeskanować ani gdzie położyć, więc wypada ze
   * snapshotu dostawy w ogóle; uzasadnienie i cena tej decyzji stoją
   * w `src/pomijane.ts`.
   *
   * Puste = funkcja wyłączona, wszystkie pozycje idą na listę jak dotąd.
   * Porównanie ignoruje wielkość liter, polskie ogonki i myślniki (`zwin`),
   * więc `przesylka` i `PRZESYŁKA` to jedno ustawienie.
   */
  pozycjeNieTowarowe: (process.env.POZYCJE_NIE_TOWAROWE ?? "PRZESYŁKA")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),

  /** Limit długości pola tw_Lokalizacja (spec §5.2, COL_LENGTH; [WERYFIKUJ]). */
  locFieldLimit: num(process.env.LOC_FIELD_LIMIT, 50, "LOC_FIELD_LIMIT"),

  /**
   * Strefa czasowa do WYŚWIETLANIA godzin (`src/czas.ts`). W bazie wszystko
   * zostaje w UTC — to jest wyłącznie warstwa prezentacji.
   *
   * Ustawienie, nie strefa maszyny: serwer bywa postawiony z lokalizacją
   * systemu inną niż magazyn (obraz z chmury, angielski Windows), a wtedy
   * godzina w kolejce rozjeżdża się z zegarem na ścianie bez żadnego tropu.
   */
  strefaCzasu: process.env.STREFA_CZASU ?? "Europe/Warsaw",

  /**
   * Zdjęcia kartotek na karcie towaru (0.30.0).
   *
   * `zrodlo` jest WYŁĄCZNIKIEM I KONFIGURACJĄ W JEDNYM — puste znaczy „funkcji
   * nie ma" i to jest domyślne. Dwa osobne klucze (włącznik + źródło) mogłyby
   * się rozjechać ze sobą, a jeden nie może.
   *
   * Gdzie Subiekt trzyma zdjęcie z zakładki „Opis", repozytorium NIE WIE —
   * `docs/subiekt-gt-struktura.md` nie wymienia ani jednej kolumny binarnej.
   * Nazwy tabeli i kolumn są więc [WERYFIKUJ] i ustala się je zapytaniami
   * z rozdziału „Gdzie Subiekt trzyma zdjęcie kartoteki".
   */
  zdjecia: {
    /** `""` (brak funkcji) | `blob` (kolumna w MSSQL) | `plik` (katalog na dysku). */
    zrodlo: (process.env.ZDJECIA_ZRODLO ?? "") as "" | "blob" | "plik",
    /** [WERYFIKUJ] tabela ze zdjęciem; puste = `tw__Towar`. */
    tabela: process.env.ZDJECIA_TABELA ?? "",
    /** [WERYFIKUJ] kolumna wiążąca wiersz z kartoteką. */
    kolumnaKlucza: process.env.ZDJECIA_KOLUMNA_KLUCZA ?? "tw_Id",
    /** [WERYFIKUJ] kolumna varbinary/image ze zdjęciem. */
    kolumna: process.env.ZDJECIA_KOLUMNA ?? "",
    /**
     * [WERYFIKUJ] kolumna „zdjęcie główne" (0/1). Kartoteka może mieć kilka
     * zdjęć — zakładka „Opis" w Subiekcie ma „Ustaw jako główną", „Sortuj"
     * i strzałki między nimi. Kolektor pokazuje jedno i ma to być TO SAMO,
     * które biuro widzi jako główne.
     */
    kolumnaGlowne: process.env.ZDJECIA_KOLUMNA_GLOWNE ?? "",
    /** [WERYFIKUJ] kolumna kolejności („Sortuj") — rozstrzyga przy równych. */
    kolumnaKolejnosc: process.env.ZDJECIA_KOLUMNA_KOLEJNOSC ?? "",
    /** Katalog źródłowy przy `zrodlo=plik` (udział sieciowy albo dysk lokalny). */
    katalog: process.env.ZDJECIA_KATALOG ?? "",
    /** Nazwa pliku przy `zrodlo=plik`: `{symbol}` i `{twId}` są podstawiane. */
    wzorzecPliku: process.env.ZDJECIA_WZORZEC_PLIKU ?? "{symbol}.jpg",
    /**
     * Ponad tyle kilobajtów zdjęcia NIE bierzemy wcale. Serwer nie umie
     * zmniejszać obrazów (zero modułów natywnych — patrz db/db.ts), więc
     * jedyną obroną przed kartoteką ze skanem 20 MB jest odmowa.
     */
    maxKb: num(process.env.ZDJECIA_MAX_KB, 2048, "ZDJECIA_MAX_KB"),
    /** Limit katalogu `data/zdjecia` [MB]; ponad to wypada najdawniej oglądane. */
    cacheMb: num(process.env.ZDJECIA_CACHE_MB, 512, "ZDJECIA_CACHE_MB"),
    /** Po ilu godzinach pytamy źródło ponownie o to samo zdjęcie. */
    ttlH: num(process.env.ZDJECIA_TTL_H, 168, "ZDJECIA_TTL_H"),
    /**
     * Po ilu godzinach pytamy ponownie o kartotekę, która zdjęcia NIE MIAŁA.
     *
     * MUSI być krótsze niż `ttlH` i krótsze niż doba, a to drugie jest twardym
     * wymaganiem, nie ostrożnością. Kolektor pamięta własny „brak" przez 24 h
     * i obiecuje, że zdjęcie dodane dziś w Subiekcie pojawi się najdalej jutro
     * (`core/product/ZdjecieCache.kt`). Gdy serwer trzyma swój brak dłużej,
     * kolektor po dobie grzecznie pyta, dostaje 404 z tygodniowej pamięci
     * serwera i uzbraja negatyw na kolejne 24 h — obietnica jest wtedy pusta,
     * a zdjęcie pojawia się po tygodniu.
     *
     * Koszt jest mały: to pojedyncze SELECT-y po kluczu głównym i tylko dla
     * kartotek, które ktoś naprawdę otworzył.
     */
    brakTtlH: num(process.env.ZDJECIA_BRAK_TTL_H, 12, "ZDJECIA_BRAK_TTL_H"),
    /**
     * Jak długo NIE ponawiamy po błędzie źródła. Bez tej przerwy zepsute
     * źródło zamienia każde wejście na kartę w kilkusekundowy timeout —
     * objaw „aplikacja zamarła", którego nikt nie skojarzy ze zdjęciami.
     */
    bladTtlMin: num(process.env.ZDJECIA_BLAD_TTL_MIN, 5, "ZDJECIA_BLAD_TTL_MIN"),
  },

  /**
   * Wzorce kodu lokalizacji — JEDNO źródło prawdy dla całego systemu (plan §3).
   * Serwer jest właścicielem tej reguły; kolektor pobiera ją w `GET /api/locations`
   * i nie ma własnej kopii. Wcześniej żyła w czterech miejscach o trzech różnych
   * kształtach i to była przyczyna, dla której symbol towaru `W32-0203` udawał
   * lokalizację.
   *
   * Formaty są rozłączne po liczbie myślników i to jest cały dyskryminator:
   *   regał  `A01-02-03`  2 myślniki    paleta `PAL-042`  1 myślnik + prefiks
   *   EAN    `5901…`      0            symbol `W32-0203` 0–1 myślnik
   */
  locPatterns: [
    process.env.LOC_FORMAT_STANDARD ?? "^[A-Z]\\d{2}-\\d{2}-\\d{2}$",
    process.env.LOC_FORMAT_PALLET ?? "^PAL-\\d{3}$",
  ],
  /**
   * Twarde egzekwowanie wzorca poza trybem A (karta towaru, ekran skanu).
   * Domyślnie WŁĄCZONE: format jest znany i stabilny, a tryb luźny istniał na
   * czas, gdy nie był. Wyłącza się jawnie przez `LOC_STRICT=0`.
   */
  locStrict: process.env.LOC_STRICT !== "0",
  /** Czy zezwolić na ręczne wpisywanie lokalizacji na kolektorze. */
  allowManualLoc: process.env.ALLOW_MANUAL_LOC !== "0",

  /** Symulacja workera (dev): opóźnienie zapisu Sfery [ms] i tryb błędów. */
  worker: {
    pollMs: num(process.env.WORKER_POLL_MS, 1200, "WORKER_POLL_MS"),
    simErrors: process.env.WORKER_SIM_ERRORS === "1",
    // backoff dla retry (spec §9): 5s / 30s / 2min
    backoffMs: [5000, 30000, 120000],
    maxAttempts: 3,
    waitingRetryMs: 60000,
  },

};

/**
 * Walidacja trybu przy starcie. Bez tego literówka cicho degradowała działanie —
 * a w usłudze NSSM z `AppExit Default Restart` kończyła się pętlą restartów bez
 * śladu w logu.
 */
function assertMode(name: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(`${name}=${value} — nieobsługiwana wartość. Dozwolone: ${allowed.join(" | ")}.`);
  }
}
assertMode("SGT_MODE", config.sgtMode, ["seeded", "mssql"]);

/**
 * Reguły, które muszą być spełnione, żeby wdrożenie w ogóle mogło działać.
 *
 * Zwraca listę zdań zamiast rzucać — tej samej funkcji używa diagnostyka, a ta
 * ma pokazać WSZYSTKIE problemy naraz. Naprawianie konfiguracji po jednym
 * błędzie na restart to najgorszy możliwy sposób spędzania czasu przy wdrożeniu.
 */
export function bledyKonfiguracji(c: Config = config): string[] {
  const bledy: string[] = [];

  /* Magazyn skutku rozstrzyga, którym trybem idzie dokument. Dwa te same id
     znaczą, że dostawa i kontener trafiają do tej samej zakładki — a to wygląda
     jak „brakuje dostaw", nie jak błąd konfiguracji. Reguła istniała dotąd
     wyłącznie jako test (config.test.ts); tu pracuje na produkcji. */
  const mag = [c.magId.MAG, c.magId.MGP, c.magId.ZWROTY];
  if (new Set(mag).size !== 3) {
    bledy.push(
      `MAG_ID_MAG/_MGP/_ZWROTY muszą być różne, są [${mag.join(", ")}] — ` +
        "sprawdź SELECT mag_Id, mag_Symbol, mag_Nazwa FROM sl_Magazyn (DEPLOY §6).",
    );
  }

  /* Puste dane logowania przechodziły przez start i wywalały się dopiero przy
     pierwszym zapytaniu — czyli po tym, jak instalator uznał, że skończył. */
  if (c.sgtMode === "mssql") {
    const brak = (["database", "user", "password"] as const).filter((k) => !c.mssql[k]);
    if (brak.length) {
      bledy.push(
        `SGT_MODE=mssql wymaga ${brak.map((k) => "MSSQL_" + k.toUpperCase()).join(", ")} — ` +
          "bez tego nie ma połączenia z bazą Subiekta.",
      );
    }
  }

  /* W demo MM obsługuje DevSferaAdapter w workerze Node. Włączony przełącznik
     kazałby Node'owi omijać zadania mm, których nikt inny tu nie wykona —
     wisiałyby w pending na zawsze, bez objawu poza rosnącą kolejką. */
  if (c.sferaWorker && c.sgtMode === "seeded") {
    bledy.push(
      "SFERA_WORKER=1 wymaga SGT_MODE=mssql — w trybie seeded dokumenty MM " +
        "wykonuje worker Node i zadania mm nie miałyby wykonawcy.",
    );
  }

  /* Zdjęcia kartotek. Każda z tych pomyłek daje ten sam objaw — pusty slot na
     karcie towaru — i żadna nie prowadzi do przyczyny, bo brak zdjęcia wygląda
     dokładnie tak samo jak zła nazwa kolumny. */
  if (!["", "blob", "plik"].includes(c.zdjecia.zrodlo)) {
    bledy.push(
      `ZDJECIA_ZRODLO=${c.zdjecia.zrodlo} — dozwolone: puste (bez zdjęć), blob, plik.`,
    );
  }
  if (c.zdjecia.zrodlo === "blob") {
    if (!c.zdjecia.kolumna) {
      bledy.push(
        "ZDJECIA_ZRODLO=blob wymaga ZDJECIA_KOLUMNA — nazwę ustala się na własnej " +
          "bazie zapytaniami z docs/subiekt-gt-struktura.md.",
      );
    }
    if (c.sgtMode === "seeded") {
      bledy.push(
        "ZDJECIA_ZRODLO=blob wymaga SGT_MODE=mssql — w trybie demo nie ma bazy " +
          "Subiekta, z której dałoby się zdjęcia wziąć.",
      );
    }
    /* Osobna tabela znaczy klucz OBCY: `tw_ZdjecieTw.zd_IdTowar` jest ten sam
       dla wszystkich zdjęć jednego towaru, więc jako ostatnie kryterium
       porządku nie rozstrzyga NICZEGO. Bez kolumny kolejności (dla tej tabeli
       `zd_Id`) baza zwracałaby raz jedno zdjęcie, raz drugie — a objawem nie
       byłby błąd, tylko ETag skaczący przy każdym odczycie i kolektory
       ściągające obraz w kółko. */
    if (c.zdjecia.tabela && !c.zdjecia.kolumnaKolejnosc) {
      bledy.push(
        `ZDJECIA_TABELA=${c.zdjecia.tabela} wymaga ZDJECIA_KOLUMNA_KOLEJNOSC — ` +
          "w osobnej tabeli klucz jest obcy i nie rozstrzyga, które zdjęcie wziąć " +
          "(dla tw_ZdjecieTw ustaw zd_Id).",
      );
    }
  }
  if (c.zdjecia.zrodlo === "plik" && !c.zdjecia.katalog) {
    bledy.push("ZDJECIA_ZRODLO=plik wymaga ZDJECIA_KATALOG — katalogu ze zdjęciami.");
  }
  /* Kolektor pamięta własny „brak zdjęcia" przez 24 h i na tym stoi obietnica
     „dodane dziś, widoczne jutro". Dłuższa pamięć serwera unieważnia ją po
     cichu: kolektor pyta po dobie i dostaje 404 ze starego wpisu. */
  if (c.zdjecia.zrodlo !== "" && c.zdjecia.brakTtlH >= 24) {
    bledy.push(
      `ZDJECIA_BRAK_TTL_H=${c.zdjecia.brakTtlH} — musi być mniejsze niż 24. ` +
        "Kolektor pamięta brak zdjęcia przez dobę, więc dłuższa pamięć serwera " +
        "opóźniałaby nowe zdjęcia o tydzień zamiast o dzień.",
    );
  }

  // Wzorce adresów przychodzą z env; zły regex wysypuje każdy skan, nie start.
  for (const p of c.locPatterns) {
    try {
      new RegExp(p);
    } catch {
      bledy.push(`Wzorzec lokalizacji "${p}" nie jest poprawnym wyrażeniem regularnym.`);
    }
  }

  /* Zwroty Allegro. Client_id bez sekretu przechodziłby start i wywalał się
     dopiero przy parowaniu — czyli w chwili, gdy ktoś przy panelu czeka na
     kod. Objaw („nie da się połączyć konta") nie prowadzi do przyczyny. */
  if (c.allegro.clientId && !c.allegro.clientSecret) {
    bledy.push(
      "ALLEGRO_CLIENT_ID bez ALLEGRO_CLIENT_SECRET — oba wydaje rejestracja " +
        "aplikacji na developer.allegro.pl (typ „urządzenie”). Uzupełnij wertis.env.",
    );
  }
  if (!["", "dev", "http"].includes(c.allegro.mode)) {
    bledy.push(
      `ALLEGRO_MODE=${c.allegro.mode} — dozwolone: puste (wg SGT_MODE), dev, http.`,
    );
  }
  /* Tryb http bez poświadczeń aplikacji nie ma jak zapytać o cokolwiek —
     a wymuszony jawnie znaczy, że ktoś liczy na prawdziwe API. */
  if (c.allegro.mode === "http" && !c.allegro.clientId) {
    bledy.push("ALLEGRO_MODE=http wymaga ALLEGRO_CLIENT_ID i ALLEGRO_CLIENT_SECRET.");
  }
  if (c.mssql.dokTypFS === c.mssql.dokTypPA) {
    bledy.push(
      `DOK_TYP_FS i DOK_TYP_PA są równe (${c.mssql.dokTypFS}) — faktura i paragon ` +
        "to różne kody dok_Typ (lista w docs/subiekt-gt-struktura.md).",
    );
  }

  return bledy;
}

const bledy = bledyKonfiguracji();
if (bledy.length) {
  throw new Error("Błędna konfiguracja:\n  - " + bledy.join("\n  - "));
}

export type Config = typeof config;
