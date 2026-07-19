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
   * Adapter zapisu (worker): 'dev' (mutacja sgt_*), 'sql' (UPDATE tw_Lokalizacja
   * bezpośrednio w MSSQL — plan B ze spec §9; MM niedostępne, wersja edu bez
   * Sfery), 'com' (Sfera COM — wymaga licencji). Domyślnie: 'sql' gdy
   * SGT_MODE=mssql, inaczej 'dev'.
   */
  sferaMode: (process.env.SFERA_MODE ??
    (process.env.SGT_MODE === "mssql" ? "sql" : "dev")) as "dev" | "sql" | "com",

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
    /** Login zapisu (GRANT UPDATE tylko na tw__Towar.tw_Lokalizacja); domyślnie login odczytu. */
    writeUser: process.env.MSSQL_WRITE_USER ?? process.env.MSSQL_USER ?? "",
    writePassword: process.env.MSSQL_WRITE_PASSWORD ?? process.env.MSSQL_PASSWORD ?? "",
    /** Kody dok_Typ dla FZ/PZ ([WERYFIKUJ] na własnej bazie). */
    dokTypFZ: num(process.env.DOK_TYP_FZ, 1),
    dokTypPZ: num(process.env.DOK_TYP_PZ, 5),
    /**
     * Kody dok_Typ dokumentów zwrotów listowanych na magazynie Zwroty
     * (CSV, np. "14,7"). Puste = każdy dokument na tym magazynie — biuro
     * wystawia różne typy ([WERYFIKUJ] na własnej bazie).
     */
    dokTypyZwroty: (process.env.DOK_TYP_ZWROTY ?? "")
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
    /** Wyrażenie SQL 0/1: dokument w buforze ([WERYFIKUJ], np. inna kolumna/status). */
    bufferExpr: process.env.MSSQL_BUFFER_EXPR ?? "CASE WHEN d.dok_Status = 0 THEN 1 ELSE 0 END",
    /** Interwał odświeżania read-modelu sgt_* z MSSQL [ms]. */
    syncMs: num(process.env.MSSQL_SYNC_MS, 60000),
  },

  /** Katalog seedu (products.json z web/public/data). */
  seedProducts:
    process.env.SEED_PRODUCTS ??
    path.resolve(__dirname, "../../web/public/data/products.json"),

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
   * Format kodu lokalizacji (regex). Domyślnie wzorzec regału „E08-03-01"
   * (litera + 3 grupy po 2 cyfry) — 96% realnych kodów w mag.xlsx. Egzekwowany
   * jako twardy błąd tylko przy `locStrict=1`; inaczej służy tylko do
   * podpowiedzi. Walidacja bazowa (bez EAN, ze spacją, z literą) działa zawsze.
   */
  locFormat: process.env.LOC_FORMAT ?? "^[A-Z]\\d{2}-\\d{2}-\\d{2}$",
  /** Twarde egzekwowanie `locFormat` (odrzuca kody spoza wzorca). */
  locStrict: process.env.LOC_STRICT === "1",
  /** Czy zezwolić na ręczne wpisywanie lokalizacji na kolektorze. */
  allowManualLoc: process.env.ALLOW_MANUAL_LOC !== "0",

  /**
   * Karencja COFNIJ [ms]: zadanie set_location z kolektora dostaje next_attempt_at
   * w przyszłości, więc worker nie weźmie go zanim minie okno anulowania na UI.
   */
  undoGraceMs: num(process.env.UNDO_GRACE_MS, 5000),

  /** Symulacja workera (dev): opóźnienie zapisu Sfery [ms] i tryb błędów. */
  worker: {
    pollMs: num(process.env.WORKER_POLL_MS, 1200),
    delayMs: num(process.env.WORKER_DELAY_MS, 1500),
    simErrors: process.env.WORKER_SIM_ERRORS === "1",
    // backoff dla retry (spec §9): 5s / 30s / 2min
    backoffMs: [5000, 30000, 120000],
    maxAttempts: 3,
    waitingRetryMs: 60000,
  },

  /** Serwowanie zbudowanego frontendu (prod). */
  webDist: process.env.WEB_DIST ?? path.resolve(__dirname, "../../web/dist"),
};

export type Config = typeof config;
