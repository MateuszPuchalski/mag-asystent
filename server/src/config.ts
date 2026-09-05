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
/**
 * Adres URL z odwrotnymi ukośnikami wyprostowany na zwykłe.
 *
 * POWSTAŁO Z WDROŻENIA, KTÓRE POŁOŻYŁO MAGAZYN. Ktoś wpisał
 * `TLO_URL=http:\\127.0.0.1:8791`, serwer odmówił startu, a `wertis-api`
 * i `wertis-worker` przestały wstawać. Objawem na ekranie było
 * `SERVICE_PAUSED` z NSSM — nikt nie kojarzy tego z ukośnikiem.
 *
 * Ta pomyłka jest na Windowsie NATURALNA, a nie niedbała: w tym samym pliku
 * konfiguracyjnym KAŻDA inna wartość ze znakiem podziału używa `\` — bo są to
 * ścieżki (`C:\wertis`, `ZDJECIA_KATALOG=D:\zdjecia`, `TLO_MODEL`). Ręka
 * pisze dalej to samo.
 *
 * Prostujemy, zamiast odmawiać, bo `\` w adresie hosta NIE MA żadnego innego
 * możliwego znaczenia — przeglądarki robią dokładnie to samo od zawsze.
 * Bramka zostaje: adres bez `http://` albo `https://` nadal zatrzymuje start.
 * Naprawiamy pomyłkę jednoznaczną, nie zgadujemy przy niejednoznacznej.
 */
export const prostujUkosniki = (v: string): string => v.replace(/\\/g, "/");

const num = (v: string | undefined, def: number, name?: string) => {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`${name ?? "wartość"}=${v} — oczekiwano liczby. Popraw w wertis.env.`);
  }
  return n;
};

/**
 * Granica czasu z `wertis.env` jako ISO. Data ma być USTAWIENIEM, nie stałą
 * w kodzie: zabetonowana w źródle jest datą, której nikt nie przesunie bez
 * wydania, a właściciel przesuwa takie progi sam.
 *
 * Puste znaczy „bez granicy" i to jest wartość poprawna, nie brak — inaczej
 * nie dałoby się wyłączyć progu bez edycji kodu.
 */
const data = (v: string | undefined, def: string, name: string): string | null => {
  const s = (v ?? def).trim();
  if (s === "") return null;
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) {
    throw new Error(
      `${name}=${s} — oczekiwano daty ISO, np. 2026-08-31T22:00:00Z. Popraw w wertis.env.`,
    );
  }
  /* Normalizujemy do ISO w UTC, bo porównania idą po TEKŚCIE: daty z Allegro
     przyjeżdżają w tym samym kształcie i tylko wtedy `<` znaczy „wcześniej". */
  return new Date(ms).toISOString();
};

export const config = {
  /** Port serwera API. */
  port: num(process.env.PORT, 3001, "PORT"),
  host: process.env.HOST ?? "0.0.0.0",

  /** Ścieżka pliku bazy SQLite aplikacji. */
  dbPath:
    process.env.DB_PATH ?? path.resolve(__dirname, "../data/wertis.db"),

  /**
   * Etykieta instancji — „produkcja" albo nazwa środowiska (np. „dev").
   *
   * Wolny tekst BEZ walidacji, bo to etykieta, nie tryb: nie zmienia żadnego
   * zachowania serwera. Zmienia zachowanie LUDZI — biuro i kolektor rysują
   * z niej ostrzeżenie, żeby nikt nie pomylił instancji dev z produkcją,
   * gdy obie chodzą na tej samej maszynie (DEPLOY.md, dev obok produkcji).
   */
  srodowisko: process.env.SRODOWISKO ?? "produkcja",

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
     * Ile dni wstecz czytać przesunięcia MM NA regał zwrotów — dokumenty,
     * których numery magazyn pisze na koszach. Domyślne 30 dni to okno,
     * którego biuro używa w Subiekcie („ostatnie 30 dni" na liście przyjęć).
     */
    mmZwrotyDniWstecz: num(process.env.MM_ZWROTY_DNI_WSTECZ, 30, "MM_ZWROTY_DNI_WSTECZ"),
    /**
     * `dok_Typ` przesunięcia międzymagazynowego. Wartość z oficjalnego opisu
     * struktury (9-MM), ta sama lista co pozostałe kody dokumentów.
     */
    dokTypMM: num(process.env.DOK_TYP_MM, 9, "DOK_TYP_MM"),
    /**
     * Ile dni wstecz czytać dokumenty sprzedaży (FS/PA) do read-modelu
     * `sgt_faktura` (0.174.0).
     *
     * Zwrot z Allegro wraca zwykle w ustawowych czternastu dniach, ale paczka
     * potrafi poleżeć w „do wyjaśnienia", a odstąpienie liczy się od
     * DORĘCZENIA. Sześćdziesiąt dni to zapas nad tym oknem; wyżej rośnie już
     * tylko koszt zapytania do bazy firmy.
     */
    fakturyDniWstecz: num(process.env.DOK_SPRZEDAZ_DNI_WSTECZ, 60, "DOK_SPRZEDAZ_DNI_WSTECZ"),
    /**
     * Kolumna `dok__Dokument` z numerem obcym — tym, który integracja
     * sprzedażowa wpisuje na dokument.
     *
     * `dok_NrPelnyOryg` to varchar(30), a identyfikator zamówienia Allegro
     * jest UUID-em (36 znaków, `format: uuid` w schemacie). CAŁY numer się
     * tam NIE ZMIEŚCI i to nie jest przypuszczenie, tylko arytmetyka. Kolumna
     * zostaje, bo integracja bywa ustawiona na własny, krótszy numer — ale
     * dopasowanie po niej jest premią, nie fundamentem.
     *
     * Puste = świadoma rezygnacja; wtedy zostaje dopasowanie po pozycjach.
     */
    fakturyNrOrygColumn: process.env.MSSQL_SPRZEDAZ_NR_ORYG_COLUMN ?? "dok_NrPelnyOryg",
    /**
     * Kolumna `dok__Dokument` wskazująca dokument KORYGOWANY.
     *
     * Nazwa sprawdzona na bazie firmy (0.201.0), nie zgadnięta: trójka
     * `dok_DoDokId` / `dok_DoDokNrPelny` / `dok_DoDokDataWyst` odpowiada
     * właściwościom obiektu Sfery (`DoDokumentuId`, `DoDokumentuNumerPelny`,
     * `DoDokumentuDataWystawienia`). Zgodność w obie strony jest tu całym
     * dowodem — w tym repo zgadnięta nazwa kosztowała już cztery wydania.
     *
     * Puste = automat numerów korekt wyłączony; biuro przepisuje je ręką, jak
     * przed 0.201.0. Tak samo działa brak kolumny albo brak prawa do niej:
     * import sprzedaży schodzi wtedy o szczebel niżej, zamiast się wywrócić.
     */
    korektaColumn: process.env.MSSQL_KOREKTA_COLUMN ?? "dok_DoDokId",
    /**
     * Kody `dok_Typ` dokumentów, które ODDAJĄ TOWAR NA STAN po zwrocie.
     *
     * Domyślnie `6` (KFS — korekta faktury sprzedaży) i `14` (ZW — zwrot
     * detaliczny), oba ze struktury bazy 1.8731.31.6933
     * (`docs/subiekt-gt-struktura.md`). Lista, a nie para, bo praktyka
     * podmiotu bywa inna niż kod ze struktury: firma księgująca zwroty do
     * paragonu inaczej przestawia to jedną wartością w `wertis.env`.
     */
    dokTypyKorekt: (process.env.DOK_TYPY_KOREKT ?? "6,14")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
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
    /**
     * Nagłówek User-Agent do KAŻDEGO żądania (auth i API). Allegro wymaga go
     * wprost — ekran po rejestracji aplikacji ostrzega, że brak prawidłowego
     * nagłówka może skończyć się ZABLOKOWANIEM klucza. Wklej tu wartość
     * z przycisku „Wygeneruj nagłówek User-Agent" na developer.allegro.pl.
     * Puste = rozsądny fallback `WERTIS/<wersja>` — działa, ale wygenerowany
     * identyfikuje aplikację jednoznacznie i jego użycie jest bezpieczniejsze.
     */
    userAgent: process.env.ALLEGRO_USER_AGENT ?? "",
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
    /** Takt synchronizacji Centrum wiadomości; 0 wyłącza ticker. */
    inboxSyncMs: num(process.env.ALLEGRO_INBOX_SYNC_MS, 60_000, "ALLEGRO_INBOX_SYNC_MS"),
    /**
     * Od kiedy skrzynka w ogóle widzi rozmowy. Decyzja właściciela z 0.152.0:
     * 1 września 2026, czyli dzień uruchomienia obsługi klienta.
     *
     * Domyślna wartość to PÓŁNOC CZASU LOKALNEGO, zapisana w UTC — Polska jest
     * we wrześniu na UTC+2. Data w kodzie musi być w UTC, bo porównuje się ją
     * z `lastMessageDateTime` od Allegro, a to jest UTC.
     *
     * Granica działa na WĄTEK, nie na wiadomość: rozmowa z jakąkolwiek
     * wiadomością po tej dacie wchodzi w całości. Agent, który widzi pytanie
     * bez jego początku, odpowiada w ciemno.
     */
    inboxOd: data(process.env.ALLEGRO_INBOX_OD, "2026-08-31T22:00:00Z", "ALLEGRO_INBOX_OD"),
    /**
     * Takt synchronizacji zwrotów klienckich; 0 wyłącza ticker.
     *
     * RZADZIEJ NIŻ SKRZYNKA, i to jest decyzja, nie zaniedbanie. Zwrot ma
     * termin liczony w dniach, więc pięć minut opóźnienia nie kosztuje nic;
     * pytanie klienta czeka na odpowiedź i kosztuje. Dwa tickery na jednym
     * adresie mają też różnić się rytmem, bo równy chór jest tą sygnaturą
     * maszyny, którą anti-bot Allegro rozpoznaje (patrz `services/takt.ts`).
     */
    zwrotySyncMs: num(process.env.ALLEGRO_ZWROTY_SYNC_MS, 300_000, "ALLEGRO_ZWROTY_SYNC_MS"),
    /* Wnioski o rabat transakcyjny zmieniają stan po stronie Allegro godzinami,
       nie minutami — Allegro część z nich rozpatruje samo. Rzadziej niż zwroty. */
    rabatySyncMs: num(process.env.ALLEGRO_RABATY_SYNC_MS, 900_000, "ALLEGRO_RABATY_SYNC_MS"),
    /**
     * Ile dni ma sprzedawca na oddanie pieniędzy od oświadczenia klienta.
     * Ustawowo czternaście; w env, bo to liczba z prawa, a nie z naszego
     * kodu — zmiana przepisu ma być wpisem w `wertis.env`, nie wydaniem.
     */
    zwrotTerminDni: num(process.env.ZWROT_TERMIN_DNI, 14, "ZWROT_TERMIN_DNI"),
    /**
     * Od kiedy widzimy zwroty. Decyzja właściciela: 20 SIERPNIA 2026, północ
     * czasu lokalnego (stąd 19 sierpnia 22:00 UTC — Polska jest w sierpniu
     * na UTC+2). Do 0.152.0 stało tu 20 lipca; właściciel przesunął próg
     * o miesiąc, a że to jest ustawienie, a nie stała, przesunie go znowu
     * bez wydania.
     *
     * ZASTĄPIŁO OKNO WZGLĘDNE `ALLEGRO_ZWROTY_DNI_WSTECZ`, i to jest zmiana
     * natury, nie jednostki. Tamto liczyło się WYŁĄCZNIE przy pierwszym
     * przebiegu, bo dalej rządził kursor; próg bezwzględny obowiązuje zawsze,
     * także wtedy, gdy kursor już stoi. Bez tej różnicy zwrot sprzed granicy
     * wjechałby przy pierwszej zmianie po stronie Allegro.
     *
     * Próg zastępuje też tamten bezpiecznik: bez niego pierwszy przebieg
     * ściągnąłby całą historię konta jednym ciągiem zapytań, czyli prostą
     * drogą do 429 przy starcie usługi.
     */
    zwrotyOd: data(process.env.ALLEGRO_ZWROTY_OD, "2026-08-19T22:00:00Z", "ALLEGRO_ZWROTY_OD"),
    /**
     * Takt uzupełniania OFERT do rozmów; 0 wyłącza ticker.
     *
     * Rzadszy niż skrzynka i gęstszy niż zamówienia: tytuł oferty jest
     * potrzebny do PIERWSZEJ odpowiedzi, a pytanie klienta czeka na nią
     * w godzinach, nie w dniach. Rytm inny niż u sąsiadów, bo wszystkie trzy
     * takty wychodzą z tego samego adresu IP (nagłówek `services/takt.ts`).
     */
    ofertySyncMs: num(process.env.ALLEGRO_OFERTY_SYNC_MS, 420_000, "ALLEGRO_OFERTY_SYNC_MS"),
    /** Takt uzupełniania zamówień do zwrotów; 0 wyłącza ticker. */
    zamowieniaSyncMs: num(
      process.env.ALLEGRO_ZAMOWIENIA_SYNC_MS, 600_000, "ALLEGRO_ZAMOWIENIA_SYNC_MS"
    ),
    /**
     * Wzorce adresów PANELU SPRZEDAWCY — `{id}` w miejscu identyfikatora.
     *
     * To są strony UI, a nie API, więc NIE opisuje ich `docs/allegro/swagger.yaml`
     * ani żadna inna specyfikacja. Domyślne wartości niżej są założeniem
     * (`[WERYFIKUJ]` w `docs/allegro-ksztalt.md`), a link trafiający w 404
     * kosztuje kliknięcie i zaufanie do całego ekranu.
     *
     * Dlatego stoją w konfiguracji: gdy Allegro przestawi adres, poprawia się
     * to wpisem w `wertis.env`, a nie wydaniem aplikacji.
     */
    /**
     * Zwrot — CENTRUM SPRZEDAŻY z wyszukiwaniem po numerze (0.207.0).
     *
     * Do tego wydania stał tu `moje-allegro/sprzedaz/zwroty/{id}`: adres
     * zgadnięty, bo zwrot nie ma w panelu własnej strony pod identyfikatorem.
     * Właściciel podał działający — lista zwrotów Centrum Sprzedaży
     * z numerem w `search`. To jedyny z trzech wzorców tutaj, który przeszedł
     * przez żywe konto.
     *
     * `{od}` to dolna granica zakresu dat listy. Bierzemy DZIEŃ ZGŁOSZENIA
     * tego zwrotu, nie stałą sprzed trzech miesięcy: filtr zakresu wycina
     * wiersze spoza okna, więc stała data odcięłaby starsze zwroty i wyszukanie
     * oddałoby pustą listę przy poprawnym numerze.
     *
     * Sandboks zostaje przy dawnym wzorcu — hosta Centrum Sprzedaży dla
     * sandboksu nie znamy, a zgadywanie go drugi raz kosztowałoby to samo.
     */
    panelZwrot:
      process.env.ALLEGRO_PANEL_ZWROT ??
      (process.env.ALLEGRO_SANDBOX === "1"
        ? "https://allegro.pl.allegrosandbox.pl/moje-allegro/sprzedaz/zwroty/{id}"
        : "https://salescenter.allegro.com/returns?page=1&limit=25&from={od}&search={id}"),
    panelZamowienie:
      process.env.ALLEGRO_PANEL_ZAMOWIENIE ??
      (process.env.ALLEGRO_SANDBOX === "1"
        ? "https://allegro.pl.allegrosandbox.pl/moje-allegro/sprzedaz/zamowienia/{id}"
        : "https://allegro.pl/moje-allegro/sprzedaz/zamowienia/{id}"),
    /**
     * Oferta — adres PUBLICZNY, nie panel sprzedawcy (0.178.0).
     *
     * Agent klikający ofertę z rozmowy chce zobaczyć to, co widzi klient:
     * zdjęcia, parametry i opis. Panel sprzedawcy pokazałby formularz edycji,
     * czyli nie to pytanie.
     */
    panelOferta:
      process.env.ALLEGRO_PANEL_OFERTA ??
      (process.env.ALLEGRO_SANDBOX === "1"
        ? "https://allegro.pl.allegrosandbox.pl/oferta/{id}"
        : "https://allegro.pl/oferta/{id}"),
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
    /**
     * Magazyn ODPADU — towar z oceny „utylizacja" (0.211.0).
     *
     * ZERO ZNACZY WYŁĄCZONE i to jest cała domyślna wartość. Pozostałe trzy
     * magazyny mają domyślne numery, bo pomyłka daje najwyżej pusty ekran.
     * Tutaj pomyłka WYSTAWIA DOKUMENT: zgadnięty numer przesunąłby złom na
     * cudzy magazyn, a MM się nie cofa jednym kliknięciem. Dopóki numeru nie
     * ma w `wertis.env`, ocena „utylizacja" zapisuje się jak dotąd i nie
     * zakłada koszyka — czyli zachowanie sprzed tego wydania.
     */
    ODP: num(process.env.MAG_ID_ODP, 0, "MAG_ID_ODP"),
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

    /* ── Dodawanie zdjęcia z kolektora (0.88.0) ──────────────────────────────
       Do 0.87.0 zdjęcia były WYŁĄCZNIE do odczytu i tak to opisywała
       `docs/subiekt-gt-struktura.md`. Ten klucz tę granicę przesuwa — trzeci
       raz po lokalizacji (spec §5.2) i kodzie kreskowym (0.37.0), a pierwszy
       raz INSERT-em, nie zmianą jednej kolumny.

       JEDEN KLUCZ, nie dwa, i to z tego samego powodu co przy `ZDJECIA_ZRODLO`
       wyżej: jest zarazem wyłącznikiem i wyborem miejsca zapisu. Osobny
       przełącznik „włączone" i osobny „gdzie" mogłyby się rozjechać ze sobą,
       a objawem rozjazdu byłby przycisk, który nie robi nic.                  */

    /**
     * `""` (nie da się dodać) | `wertis` (zdjęcie zostaje u nas) |
     * `subiekt` (dodatkowo wchodzi do kartoteki).
     *
     * Domyślnie puste i to nie jest ostrożność na zapas. `subiekt` żąda
     * `GRANT INSERT` na tabelę zdjęć, a takiego prawa nie nadaje się dlatego,
     * że ktoś zaktualizował aplikację. Przy `wertis` zdjęcie i tak widać na
     * karcie — leży w bazie WERTIS, tak jak `ean_alias` niesie kod kreskowy
     * mimo nieudanego `set_ean`.
     */
    dodawanie: (process.env.ZDJECIA_DODAWANIE ?? "") as "" | "wertis" | "subiekt",
    /**
     * [WERYFIKUJ] kolumna sumy kontrolnej (`zd_CRC` w `tw_ZdjecieTw`).
     *
     * PUSTE ZNACZY „nie wpisujemy jej wcale" i to jest wartość domyślna.
     * Algorytmu, którym Subiekt liczy tę sumę, repozytorium NIE ZNA — wpisanie
     * własnej liczby byłoby zgadywaniem, a wynik zgadywania siedziałby w bazie
     * firmy. Czy Subiekt znosi `NULL`, rozstrzyga kartoteka próbna (DEPLOY §6).
     */
    kolumnaCrc: process.env.ZDJECIA_KOLUMNA_CRC ?? "",
    /**
     * Ile kilobajtów wolno przyjąć od kolektora.
     *
     * Osobno od `maxKb` (2048), bo to inny kierunek i inny nadawca. `maxKb`
     * broni się przed kartoteką ze skanem 20 MB, której nikt nie kontroluje;
     * tutaj nadawcą jest nasz własny kolektor, który zdjęcie ZMNIEJSZA przed
     * wysyłką (`PhotoCapture`, 1600 px). Przekroczenie tej liczby znaczy więc,
     * że coś poszło z pominięciem kolektora — i wtedy odmowa jest odpowiedzią
     * właściwą, a nie utrudnieniem.
     */
    uploadMaxKb: num(process.env.ZDJECIA_UPLOAD_MAX_KB, 512, "ZDJECIA_UPLOAD_MAX_KB"),
    /**
     * Ile minut żyje podgląd między wysłaniem zdjęcia a jego zatwierdzeniem.
     *
     * Człowiek ogląda wycięte tło kilkanaście sekund. Kwadrans to zapas na
     * przerwane połączenie i na kolektor odłożony na regał w połowie roboty —
     * po tym czasie wiersz kasuje się sam, bo nikt do niego nie wróci.
     */
    podgladMin: num(process.env.ZDJECIA_PODGLAD_MIN, 15, "ZDJECIA_PODGLAD_MIN"),
  },

  /**
   * Zdjęcia listingowe ofert Allegro (0.213.0).
   *
   * OSOBNY BLOK od `zdjecia`, choć oba opisują cache obrazów — i to nie jest
   * symetria dla samej symetrii. Tamte zdjęcia idą z bazy firmy przez sieć
   * lokalną i bywają skanami po kilka megabajtów; te idą z publicznego CDN-u
   * i są już przygotowane pod stronę www. Jeden komplet progów na oba znaczyłby
   * próg dobrany pod gorszy przypadek i stosowany do lepszego.
   *
   * Wyłącznika nie ma i to jest decyzja: adres jedzie w odpowiedzi, którą
   * pobieramy tak czy owak, a plik ciągnie się dopiero wtedy, gdy ktoś na
   * ekranie na niego patrzy. Nie ma czego wyłączać, bo nie ma stałego kosztu.
   */
  allegroZdjecia: {
    /**
     * Szerokość miniatury w pikselach — segment `/s{px}/` w adresie CDN-u.
     * `0` wyłącza próbę i zostawia sam oryginał.
     *
     * 320, bo najszerszy kafel w panelu ma 72 px, a przy podwójnej gęstości
     * ekranu to 144 px; zapas idzie na powiększenie po kliknięciu, które
     * pokazuje ten sam plik. Wariant rozmiarowy jest konwencją CDN-u, nie
     * częścią specyfikacji — dlatego `services/zdjecia-ofert.ts` traktuje go
     * jako PRÓBĘ z powrotem do oryginału, a nie jako pewnik.
     */
    miniaturaPx: num(process.env.ALLEGRO_ZDJECIA_PX, 320, "ALLEGRO_ZDJECIA_PX"),
    /** Ponad tyle kilobajtów obrazu NIE bierzemy — serwer nie skaluje. */
    maxKb: num(process.env.ALLEGRO_ZDJECIA_MAX_KB, 1024, "ALLEGRO_ZDJECIA_MAX_KB"),
    /** Limit katalogu `data/zdjecia-ofert` [MB]; ponad to wypada najdawniej oglądane. */
    cacheMb: num(process.env.ALLEGRO_ZDJECIA_CACHE_MB, 256, "ALLEGRO_ZDJECIA_CACHE_MB"),
    /** Ile czekamy na CDN. Bez limitu jedno zawieszone żądanie blokuje trasę. */
    timeoutMs: num(process.env.ALLEGRO_ZDJECIA_TIMEOUT_MS, 8000, "ALLEGRO_ZDJECIA_TIMEOUT_MS"),
    /** Jak długo NIE ponawiamy po błędzie — jak przy kartotekach. */
    bladTtlMin: num(process.env.ALLEGRO_ZDJECIA_BLAD_TTL_MIN, 5, "ALLEGRO_ZDJECIA_BLAD_TTL_MIN"),
  },

  /**
   * Usuwanie tła ze zdjęcia wgrywanego z kolektora (0.88.0).
   *
   * OSOBNY PROCES, nie biblioteka. Model działa na runtime ONNX, czyli na
   * module natywnym — a serwer WERTIS ma dwie zależności i zero modułów
   * natywnych, i to jest reguła powtórzona w `db/db.ts`, `services/zdjecia.ts`
   * i `services/logo-dostawcy.ts`. Wzorzec na taki przypadek repozytorium już
   * ma: `sfera-worker/` to trzeci proces, domyślnie wyłączony, a bez niego
   * reszta systemu działa i mówi wprost, czego brakuje.
   *
   * PUSTE `TLO_URL` = funkcja wyłączona. Podgląd pokazuje wtedy zdjęcie
   * z tłem i mówi o tym magazynierowi; nie jest to awaria i nie udaje jej.
   */
  tlo: {
    /**
     * Adres usługi `wertis-tlo`, np. `http://127.0.0.1:8791`. Puste = bez usługi.
     *
     * Odwrotne ukośniki prostujemy — na Windowsie to pomyłka naturalna, a nie
     * niedbała (patrz `prostujUkosniki`). Adres bez schematu nadal zatrzymuje
     * start; tam nie ma czego prostować.
     */
    url: prostujUkosniki(process.env.TLO_URL ?? ""),
    /**
     * Ile milisekund czekamy na wycięcie tła.
     *
     * Człowiek stoi przy regale i patrzy na kręcące się kółko, więc ta liczba
     * jest granicą cierpliwości, nie granicą modelu. Po jej upływie podgląd
     * pokazuje zdjęcie z tłem — gorzej, ale od razu.
     */
    timeoutMs: num(process.env.TLO_TIMEOUT_MS, 20_000, "TLO_TIMEOUT_MS"),
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
    /* Symulacja losowych porażek kolejki jest narzędziem developerskim —
       włączona na produkcji (mssql) wyglądałaby jak awaria Sfery i nikt by
       nie zgadł, że to zmienna środowiskowa. Twardy błąd startu, jak przy
       ALLEGRO_POLL_MS: tańszy niż tydzień szukania ducha. */
    simErrors: (() => {
      const wlaczone = process.env.WORKER_SIM_ERRORS === "1";
      if (wlaczone && (process.env.SGT_MODE ?? "seeded") === "mssql") {
        throw new Error(
          "WORKER_SIM_ERRORS=1 przy SGT_MODE=mssql — symulacja błędów kolejki " +
            "nie może chodzić na produkcji. Usuń zmienną z wertis.env."
        );
      }
      return wlaczone;
    })(),
    // backoff dla retry (spec §9): 5s / 30s / 2min
    backoffMs: [5000, 30000, 120000],
    maxAttempts: 3,
    waitingRetryMs: 60000,
  },

  /* ── Copilot obsługi klienta (etap F, §14) ────────────────────────────────
     KLUCZA TU NIE MA I NIE BĘDZIE. `config` bywa wypisywany do diagnostyki
     i do komunikatów błędów — dokładnie tą drogą klucz Anthropic trafił do
     `logs\\wertis-api.err.log` w 0.84.1 i trzeba go było unieważnić. Klient
     SDK czyta `ANTHROPIC_API_KEY` ze środowiska sam; my trzymamy wyłącznie
     odpowiedź na pytanie „czy jest".

     Do 0.140.1 stały tu pola `AI_PROVIDER`, `AI_MODEL`, `ANTHROPIC_API_KEY`
     i `AI_TIMEOUT_MS` — odeszły razem z funkcją, którą opisywały. To jest
     nowa konfiguracja pisana od zera, nie wskrzeszenie tamtej. */
  copilot: {
    /** `off` = wyłączony i to jest stan domyślny (decyzja właściciela). */
    mode: (process.env.COPILOT_MODE ?? "off") as "off" | "anthropic",
    /**
     * Model do klasyfikacji. Zejście na tańszy ma być JEDNĄ zmianą tutaj,
     * podjętą po pomiarze trafności — dlatego stoi w konfiguracji, nie w kodzie.
     */
    model: process.env.COPILOT_MODEL ?? "claude-opus-5",
    /**
     * Ile rozmów bierze jedno kliknięcie. Limit stoi TU, a nie w panelu, bo
     * to jest hamulec na wydatek, a nie szczegół wyglądu przycisku.
     */
    maxPartia: Math.max(1, Number(process.env.COPILOT_MAX_PARTIA ?? 20) || 20),
    /**
     * Czy klucz w ogóle jest. `Boolean`, nigdy sama wartość — patrz nagłówek.
     * SDK i tak czyta zmienną sam, więc to pole odpowiada wyłącznie ekranowi
     * na pytanie „czy da się kliknąć".
     */
    klucz: Boolean(process.env.ANTHROPIC_API_KEY),
  },

};

/**
 * Walidacja trybu przy starcie. Bez tego literówka cicho degradowała działanie —
 * a w usłudze NSSM z `AppExit Default Restart` kończyła się pętlą restartów bez
 * śladu w logu.
 */
/**
 * Prefiksy, po których poznaje się klucz API wklejony nie w to pole.
 *
 * Lista jest krótka i taka ma zostać: rozpoznajemy DWA formaty, których ta
 * aplikacja używa, a wszystko dłuższe niż nazwa trybu i tak schodzi pod
 * maskę regułą niżej.
 */
const PREFIKSY_KLUCZY = ["sk-ant-", "sk-", "Bearer "];

/**
 * Wartość zmiennej środowiskowej bezpieczna do wypisania w komunikacie błędu.
 *
 * Powód jest z produkcji (0.84.1): ktoś wkleił klucz Anthropic do
 * `AI_PROVIDER` zamiast do `ANTHROPIC_API_KEY` — pola sąsiadują ze sobą
 * w `wertis.env.example`. Serwer odmówił startu i wypisał wartość zmiennej
 * do komunikatu, NSSM podniósł go automatycznie, a każdy obieg pętli dopisał
 * kolejną kopię klucza do `logs\wertis-api.err.log`. Klucz trzeba było
 * unieważnić.
 *
 * Komunikat o błędnej konfiguracji ma powiedzieć CO jest nie tak, a nie
 * przepisać sekret na dysk. Wartość dłuższa niż jakakolwiek dozwolona nazwa
 * trybu nie niesie już informacji diagnostycznej — literówkę widać w pierwszych
 * znakach, a reszta to tylko materiał do wycieku.
 */
export function bezpiecznaWartosc(v: string): string {
  if (PREFIKSY_KLUCZY.some((p) => v.startsWith(p))) {
    return "(ukryte — ta wartość wygląda na klucz API, a nie na nazwę trybu)";
  }
  return v.length <= 24 ? v : `${v.slice(0, 12)}… (${v.length} znaków)`;
}

function assertMode(name: string, value: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(
      `${name}=${bezpiecznaWartosc(value)} — nieobsługiwana wartość. ` +
        `Dozwolone: ${allowed.join(" | ")}.`
    );
  }
}
assertMode("SGT_MODE", config.sgtMode, ["seeded", "mssql"]);
/* COPILOT_MODE idzie przez `assertMode` z jednego powodu: w `wertis.env.example`
   sąsiaduje z ANTHROPIC_API_KEY, czyli stoi dokładnie w tej samej pułapce,
   w którą wpadł AI_PROVIDER w 0.84.1. Maska nie jest tu ostrożnością na wyrost,
   tylko powtórzeniem strażnika, którego to pole jeszcze nie ma. */
assertMode("COPILOT_MODE", config.copilot.mode, ["off", "anthropic"]);

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

  /* Copilot (etap F). BRAK KLUCZA NIE JEST BŁĘDEM KONFIGURACJI i to jest
     odwrotność 0.84.x, gdzie ustawiony dostawca bez klucza wywracał start.
     Odmowa startu w usłudze NSSM znaczy pętlę restartów, czyli ten sam objaw,
     który tamta blizna zostawiła. Serwer ma wstać, a ekran ma powiedzieć, że
     Copilot jest niepodłączony. */
  if (c.copilot.mode === "anthropic" && !c.copilot.klucz) {
    bledy.push(
      "COPILOT_MODE=anthropic bez ANTHROPIC_API_KEY — Copilot będzie wyłączony, " +
        "a przycisk w panelu powie o tym wprost. Serwer działa dalej.",
    );
  }
  /* Model spoza rodziny `claude-` to niemal na pewno wklejka nie w to pole.
     Wartość przez maskę, bo to pole sąsiaduje z kluczem w wertis.env.example. */
  if (c.copilot.model && !c.copilot.model.startsWith("claude-")) {
    bledy.push(
      `COPILOT_MODEL=${bezpiecznaWartosc(c.copilot.model)} — nazwa modelu Anthropic ` +
        "zaczyna się od „claude-" + "\u201d (np. claude-opus-5).",
    );
  }

  /* Zdjęcia kartotek. Każda z tych pomyłek daje ten sam objaw — pusty slot na
     karcie towaru — i żadna nie prowadzi do przyczyny, bo brak zdjęcia wygląda
     dokładnie tak samo jak zła nazwa kolumny. */
  if (!["", "blob", "plik"].includes(c.zdjecia.zrodlo)) {
    bledy.push(
      `ZDJECIA_ZRODLO=${bezpiecznaWartosc(c.zdjecia.zrodlo)} — dozwolone: puste (bez zdjęć), blob, plik.`,
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
  /* Zapis zdjęcia do Subiekta (0.88.0). Objaw pomyłki byłby tu gorszy niż
     pusty slot: magazynier robi zdjęcie, widzi je na karcie — bo leży w bazie
     WERTIS — a do kartoteki nic nie wchodzi, bo zadanie ląduje w błędzie.
     Praca wygląda na wykonaną i nikt nie sprawdza kolejki. Dlatego niepełna
     konfiguracja zatrzymuje start, zamiast czekać na pierwsze zadanie. */
  if (!["", "wertis", "subiekt"].includes(c.zdjecia.dodawanie)) {
    bledy.push(
      `ZDJECIA_DODAWANIE=${bezpiecznaWartosc(c.zdjecia.dodawanie)} — dozwolone: ` +
        "puste (bez dodawania), wertis, subiekt.",
    );
  }
  if (c.zdjecia.dodawanie === "subiekt") {
    if (c.zdjecia.zrodlo !== "blob") {
      /* Zdanie kończy się DROGĄ WYJŚCIA, nie samą diagnozą. Ten błąd czyta się
         z logu usługi, która właśnie nie wstała — najczęściej rano, pod presją,
         na cudzej maszynie. „Czego brakuje" bez „co wpisać zamiast" zostawia
         człowieka przy zgaszonym API. */
      bledy.push(
        "ZDJECIA_DODAWANIE=subiekt wymaga ZDJECIA_ZRODLO=blob — dopisujemy wiersz do tej " +
          "samej tabeli, z której czytamy, a przy źródle plikowym nie ma jej gdzie szukać. " +
          "Nie masz włączonego odczytu zdjęć? Wpisz ZDJECIA_DODAWANIE=wertis — zdjęcia " +
          "będą działać na kolektorze, tylko nie wejdą do kartoteki.",
      );
    }
    if (c.sgtMode === "seeded") {
      bledy.push(
        "ZDJECIA_DODAWANIE=subiekt wymaga SGT_MODE=mssql — w trybie demo nie ma bazy " +
          "Subiekta, do której dałoby się zdjęcie dopisać. Zostaw ZDJECIA_DODAWANIE=wertis.",
      );
    }
    if (!c.zdjecia.tabela) {
      bledy.push(
        "ZDJECIA_DODAWANIE=subiekt wymaga ZDJECIA_TABELA — INSERT musi nazwać tabelę wprost " +
          "(dla tej bazy tw_ZdjecieTw). Zapis do samej kartoteki tw__Towar nie wchodzi w grę.",
      );
    }
    if (!c.zdjecia.kolumnaKlucza) {
      bledy.push(
        "ZDJECIA_DODAWANIE=subiekt wymaga ZDJECIA_KOLUMNA_KLUCZA — bez niej wiersz nie wskaże kartoteki.",
      );
    }
    /* Bez kolumny „główne" pierwszy dopisany wiersz nigdy nie byłby zdjęciem
       głównym, a odczyt bierze WŁAŚNIE główne. Zdjęcie wchodziłoby do Subiekta
       i nie pokazywało się ani tam, ani na karcie po zsynchronizowaniu. */
    if (!c.zdjecia.kolumnaGlowne) {
      bledy.push(
        "ZDJECIA_DODAWANIE=subiekt wymaga ZDJECIA_KOLUMNA_GLOWNE — nowe zdjęcie kartoteki " +
          "bez zdjęć musi stać się głównym, inaczej odczyt go nie znajdzie.",
      );
    }
  }
  if (c.tlo.url && !/^https?:\/\//.test(c.tlo.url)) {
    bledy.push(
      `TLO_URL=${bezpiecznaWartosc(c.tlo.url)} — ma być adresem http(s), np. http://127.0.0.1:8791.`,
    );
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
      `ALLEGRO_MODE=${bezpiecznaWartosc(c.allegro.mode)} — dozwolone: puste (wg SGT_MODE), dev, http.`,
    );
  }
  /* Tryb http bez poświadczeń aplikacji nie ma jak zapytać o cokolwiek —
     a wymuszony jawnie znaczy, że ktoś liczy na prawdziwe API. */
  if (c.allegro.mode === "http" && !c.allegro.clientId) {
    bledy.push("ALLEGRO_MODE=http wymaga ALLEGRO_CLIENT_ID i ALLEGRO_CLIENT_SECRET.");
  }
  /* Ustawienie zdjęte w 0.152.0. Ciche zignorowanie byłoby gorsze niż błąd:
     kto je zostawił, ten liczy, że działa, a zwroty milczałyby wtedy inaczej,
     niż każe wpis w `wertis.env`. */
  if ((process.env.ALLEGRO_ZWROTY_DNI_WSTECZ ?? "") !== "") {
    bledy.push(
      "ALLEGRO_ZWROTY_DNI_WSTECZ zniknęło w 0.152.0 — okno względne zastąpił próg " +
        "bezwzględny ALLEGRO_ZWROTY_OD (data ISO). Usuń stary wpis z wertis.env.",
    );
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
