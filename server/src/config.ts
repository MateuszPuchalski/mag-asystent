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

  /** Katalog seedu (products.json z web/public/data). */
  seedProducts:
    process.env.SEED_PRODUCTS ??
    path.resolve(__dirname, "../../web/public/data/products.json"),

  /** Identyfikatory magazynów w SGT (spec §11 pkt 5). */
  magId: { MAG: 1, MGP: 2 },

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
