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

  /**
   * Interfejs nasłuchu.
   *
   * `0.0.0.0` znaczy WSZYSTKIE karty sieciowe, także tę od operatora, jeśli
   * maszyna ma dwie. Jedyne, co dzieli wtedy API od internetu, to reguła
   * zapory — czyli jedno ustawienie, którego zniknięcia nic nie zgłosi.
   * Wpisanie adresu LAN maszyny zamyka to na poziomie gniazda: pod adresem
   * WAN nie ma czego zaatakować, bo nikt tam nie słucha (DEPLOY.md §4).
   */
  host: process.env.HOST ?? "0.0.0.0",

  /**
   * Port UDP, na którym serwer odpowiada na rozgłoszenia kolektorów szukających
   * adresu (`services/odkrywanie.ts`). `0` wyłącza odpowiadanie — wtedy adres
   * podaje kod QR ze strony `/parowanie` albo konfiguracja z MDM.
   */
  discoveryPort: num(process.env.DISCOVERY_PORT, 3002, "DISCOVERY_PORT"),

  /** Ścieżka pliku bazy SQLite aplikacji. */
  dbPath:
    process.env.DB_PATH ?? path.resolve(__dirname, "../data/wertis.db"),

  /** Źródło danych Subiekta: 'seeded' (SQLite z magmat.xlsx) lub 'mssql' (produkcja). */
  sgtMode: (process.env.SGT_MODE ?? "seeded") as "seeded" | "mssql",

  /**
   * Adapter zapisu (worker) NIE jest osobną decyzją — wynika wprost ze źródła
   * danych: 'mssql' → UPDATE dwóch kolumn w bazie Subiekta, 'seeded' → mutacja
   * sgt_* (demo). Jeden przełącznik mniej do pomylenia; dawne SFERA_MODE
   * usunięte. Dokumenty MM tworzy przyszły worker Sfery (osobny proces COM na
   * Windows, kontrakt w `adapters/sfera.ts`) — nigdy ten proces.
   */
  sferaMode: (process.env.SGT_MODE === "mssql" ? "sql" : "dev") as "dev" | "sql",

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

  /** Limit długości pola tw_Lokalizacja (spec §5.2, COL_LENGTH; [WERYFIKUJ]). */
  locFieldLimit: num(process.env.LOC_FIELD_LIMIT, 50, "LOC_FIELD_LIMIT"),

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

  // Wzorce adresów przychodzą z env; zły regex wysypuje każdy skan, nie start.
  for (const p of c.locPatterns) {
    try {
      new RegExp(p);
    } catch {
      bledy.push(`Wzorzec lokalizacji "${p}" nie jest poprawnym wyrażeniem regularnym.`);
    }
  }

  return bledy;
}

const bledy = bledyKonfiguracji();
if (bledy.length) {
  throw new Error("Błędna konfiguracja:\n  - " + bledy.join("\n  - "));
}

export type Config = typeof config;
