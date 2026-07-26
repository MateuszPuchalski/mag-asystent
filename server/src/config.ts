import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

export const config = {
  /** Port serwera API. */
  port: num(process.env.PORT, 3001),
  host: process.env.HOST ?? "0.0.0.0",

  /** Ścieżka pliku bazy SQLite aplikacji. */
  dbPath:
    process.env.DB_PATH ?? path.resolve(__dirname, "../data/wertis.db"),

  /** Źródło danych Subiekta: 'seeded' (SQLite z mag.xlsx) lub 'mssql' (produkcja). */
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
   * Połączenie z bazą MSSQL Subiekta GT (SGT_MODE=mssql). Wartości [WERYFIKUJ]
   * (dok_Typ, mag_Id, flaga bufora) ustala się na własnej bazie — zapytania
   * pomocnicze w docs/subiekt-gt-edu-setup.md.
   */
  mssql: {
    server: process.env.MSSQL_SERVER ?? "localhost",
    /** Instancja nazwana (instalator InsERT tworzy zwykle INSERTGT). */
    instance: process.env.MSSQL_INSTANCE ?? "INSERTGT",
    /** Port TCP — gdy ustawiony, ma pierwszeństwo przed instancją nazwaną. */
    port: process.env.MSSQL_PORT ? num(process.env.MSSQL_PORT, 1433) : undefined,
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
    dokTypFZ: num(process.env.DOK_TYP_FZ, 1),
    dokTypPZ: num(process.env.DOK_TYP_PZ, 10),
    /**
     * Kody `dok_Typ` dokumentów zwrotów listowanych na magazynie Zwroty (CSV).
     * Domyślnie `14` = ZW (zwrot). Puste = każdy dokument na tym magazynie —
     * zostaw puste, jeśli biuro przyjmuje zwroty także innym typem.
     */
    dokTypyZwroty: (process.env.DOK_TYP_ZWROTY ?? "14")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
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
     * Flaga sprawdzenia faktury NIE jest kolumną `dok__Dokument` — to osobny
     * mechanizm InsERT-a: `fl__Flagi` (definicja: `flg_Id`, `flg_Text`,
     * `flg_Numer` = ikona) plus `fl_Wartosc` (przypisanie do obiektu, klucz
     * złożony `flw_IdGrupyFlag` + `flw_TypObiektu` + `flw_IdObiektu`).
     *
     * Te dwie liczby identyfikują „flagi dokumentów handlowych" i są jedynym,
     * czego nie da się odczytać z dokumentacji — trzeba je wziąć z własnej bazy
     * jednym SELECT-em (DEPLOY §6). Puste = zadania `set_doc_flag` kończą się
     * czytelnym błędem zamiast pisać w losową grupę flag ([WERYFIKUJ]).
     */
    flagGrupa: process.env.MSSQL_FLAG_GRUPA ? num(process.env.MSSQL_FLAG_GRUPA, 0) : 0,
    flagTypObiektu: process.env.MSSQL_FLAG_TYP_OBIEKTU ? num(process.env.MSSQL_FLAG_TYP_OBIEKTU, 0) : 0,
    /**
     * Wyrażenie SQL 0/1: dokument w buforze. `dok_Status` ma udokumentowane
     * wartości {0-wycofany, 1-wykonany, 2-unieważniony, 3-odłożony, 4-MM wydany,
     * 5..8-zamówienia}. Bufor to dokument **odłożony** (3); poprzednie domyślne
     * `= 0` wskazywało dokumenty **wycofane**, czyli mylił się w obie strony.
     */
    bufferExpr: process.env.MSSQL_BUFFER_EXPR ?? "CASE WHEN d.dok_Status = 3 THEN 1 ELSE 0 END",
    /** Interwał odświeżania read-modelu sgt_* z MSSQL [ms]. */
    syncMs: num(process.env.MSSQL_SYNC_MS, 60000),
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
    MAG: num(process.env.MAG_ID_MAG, 1),
    MGP: num(process.env.MAG_ID_MGP, 2),
    /** Magazyn zwrotów od klientów (biuro kompletuje kartony i wystawia dokument). */
    ZWROTY: num(process.env.MAG_ID_ZWROTY, 3),
  },

  /** Limit długości pola tw_Lokalizacja (spec §5.2, COL_LENGTH; [WERYFIKUJ]). */
  locFieldLimit: num(process.env.LOC_FIELD_LIMIT, 50),

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

  /**
   * Flaga sprawdzenia faktury dostawy w Subiekcie. W tej firmie rozkładanie JEST
   * sprawdzaniem faktury, więc postęp kolektora i flaga opisują to samo — trzymanie
   * dwóch prawd obok siebie kończy się rozjazdem między magazynem a biurem.
   *
   * ROZDZIELONE NA TRZY RZECZY, bo to trzy różne byty:
   *  • klucz    — stała domeny, nigdy się nie zmienia (nasze logi, dedupe, kolory),
   *  • `label`  — nazwa flagi jak w Subiekcie, do pokazania człowiekowi,
   *  • `sgt`    — co faktycznie wpisujemy do bazy Subiekta.
   *
   * Rozdział jest konieczny, bo firma używa WBUDOWANYCH flag dokumentu (kolumna
   * „FW" na liście faktur zakupu, filtr „Flaga:"). Struktura InsERT-a potwierdza
   * ten podział 1:1: `flg_Text` to nazwa pokazywana człowiekowi, a `flg_Id` —
   * liczba, którą wpisuje się w `fl_Wartosc.flw_IdFlagi`. Gdyby domena operowała
   * samą etykietą, zapis rozsypałby się na ostatnim calu, a przemianowanie flagi
   * w Subiekcie zerwałoby historię `flaga_wyslana`.
   *
   * [WERYFIKUJ] wartości `DOC_FLAG_*_SGT` to `flg_Id` czterech flag z `fl__Flagi`
   * — jeden SELECT na własnej bazie (DEPLOY §6). Puste `sgt` = zadanie kończy się
   * czytelnym błędem zamiast zapisu na oślep.
   */
  docFlag: {
    /** Praca trwa: ktoś stoi teraz przy tej dostawie. */
    in_progress: {
      label: process.env.DOC_FLAG_IN_PROGRESS ?? "W trakcie sprawdzania",
      sgt: process.env.DOC_FLAG_IN_PROGRESS_SGT ?? "",
    },
    /** Praca przerwana, ale postęp per pozycja jest zapisany. */
    paused: {
      label: process.env.DOC_FLAG_PAUSED ?? "Do sprawdzenia z zapisanym postępem",
      sgt: process.env.DOC_FLAG_PAUSED_SGT ?? "",
    },
    /** Wszystko policzone i odłożone, zero rozbieżności ilościowych. */
    done: {
      label: process.env.DOC_FLAG_DONE ?? "Sprawdzone",
      sgt: process.env.DOC_FLAG_DONE_SGT ?? "",
    },
    /**
     * Domknięte, ale ilości się nie zgadzały. WYŁĄCZNIE rozbieżność ilościowa —
     * uszkodzenie czy brak miejsca to sprawy reklamacyjne, nie zgodność faktury.
     */
    done_with_errors: {
      label: process.env.DOC_FLAG_DONE_ERRORS ?? "Sprawdzone z błędami",
      sgt: process.env.DOC_FLAG_DONE_ERRORS_SGT ?? "",
    },
  } as Record<string, { label: string; sgt: string }>,

  /** Symulacja workera (dev): opóźnienie zapisu Sfery [ms] i tryb błędów. */
  worker: {
    pollMs: num(process.env.WORKER_POLL_MS, 1200),
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

export type Config = typeof config;
