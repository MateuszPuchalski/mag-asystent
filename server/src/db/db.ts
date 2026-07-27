import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ── Dlaczego wbudowany `node:sqlite`, a nie `better-sqlite3` ────────────────
   `better-sqlite3` był JEDYNYM modułem natywnym w całym serwerze i blokował
   dwie rzeczy naraz:

   1. Instalację. `npm ci` na Windows kompiluje go ze źródeł, co potrafi wymagać
      build tools — czego dokumentacja wdrożenia nawet nie wspominała.
   2. Spakowanie serwera do jednego pliku wykonywalnego. Moduł natywny nie
      wchodzi do bundla, a bez tego nie ma `.exe` dla osoby nietechnicznej.

   `node:sqlite` jest w środku Node'a, więc obie przeszkody znikają razem
   z zależnością. Reszta kodu tego nie zauważa: używaliśmy wyłącznie
   `prepare/run/all/get/exec/pragma`, bez `pluck`, `iterate`, `raw` i BigIntów.

   UWAGA przy budowaniu `.exe`: w Node 22 `node:sqlite` wypisuje ostrzeżenie
   o eksperymentalności na stderr (w usłudze NSSM ląduje ono w logu). Stabilne
   jest od Node 24 i stamtąd należy budować.                                   */

export type Db = DatabaseSync;

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const database = new DatabaseSync(config.dbPath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  database.exec(schema);
  migrate(database);
  _db = database;
  return database;
}

/**
 * Transakcja. `node:sqlite` nie ma odpowiednika `db.transaction(fn)`
 * z `better-sqlite3`, więc sterujemy nią wprost.
 *
 * Sygnatura celowo bierze i zwraca zwykłą funkcję — miejsca wywołania
 * wyglądają tak samo jak wcześniej, więc podmiana sterownika nie rozlała się
 * po serwisach.
 *
 * ROLLBACK jest tu istotny, a nie kosmetyczny: `putaway` i `delivery` zapisują
 * w jednej transakcji pozycję ORAZ zadanie do kolejki Sfery. Przerwanie
 * w połowie zostawiłoby zadanie zapisu bez pokrycia w danych albo odwrotnie.
 */
export function transaction<A extends unknown[], R>(
  database: DatabaseSync,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    database.exec("BEGIN");
    try {
      const out = fn(...args);
      database.exec("COMMIT");
      return out;
    } catch (e) {
      /* Wycofanie samo może paść (np. gdy transakcja została już zamknięta) —
         wtedy ważniejszy jest oryginalny błąd, bo to on mówi, co się stało. */
      try {
        database.exec("ROLLBACK");
      } catch {
        /* ignorujemy: przekazujemy dalej pierwotną przyczynę */
      }
      throw e;
    }
  };
}

/** Dostawki do istniejących baz (CREATE TABLE IF NOT EXISTS nie dodaje kolumn). */
function migrate(database: DatabaseSync) {
  const addColumn = (table: string, column: string, decl: string) => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  };
  addColumn("sfera_queue", "session_id", "INTEGER");
  addColumn("putaway_sessions", "source_mag_id", "INTEGER");
  // locki per linia (tryb A: dostawy i zwroty) — kilka osób przy jednym dokumencie
  addColumn("delivery_line", "locked_by", "TEXT");
  addColumn("delivery_line", "locked_at", "TEXT");
  // ostatnia flaga wysłana do Subiekta — rozjazd z sgt_dokument.flaga znaczy,
  // że biuro nadpisało ją poza aplikacją
  addColumn("delivery", "flaga_wyslana", "TEXT");
  addColumn("delivery", "active_at", "TEXT");
  addColumn("sgt_dokument", "flaga", "TEXT");
  // zwroty w trybie A: koszyk jako jednostka pracy + rozliczenie MM per linia
  addColumn("delivery", "source_mag_id", "INTEGER");
  addColumn("delivery_line", "koszyk", "TEXT");
  addColumn("delivery_line", "mm_ilosc", "REAL NOT NULL DEFAULT 0");
  addColumn("delivery_line", "mm_queue_id", "INTEGER");
  // telemetria: który egzemplarz kolektora wygenerował zdarzenie
  addColumn("events", "device_id", "TEXT");
  /* Konta pracowników (§7). `events.user_id` ZOSTAJE jako tekst — to snapshot
     tego, co aplikacja wtedy wiedziała, i jedyny ślad po zdarzeniach sprzed
     kont. Obok dochodzi `user_ref` wskazujące na app_user. Historii się nie
     kasuje ani nie nadpisuje: zdarzenie, którego nie da się przypisać, zostaje
     z `user_ref = NULL`, bo to jest uczciwe, w odróżnieniu od zgadywania. */
  addColumn("events", "user_ref", "INTEGER");
  /* Indeks MUSI powstać tutaj, nie w schema.sql: `user_ref` dochodzi migracją,
     więc w chwili wykonania schematu ta kolumna jeszcze nie istnieje. Raport
     wydajności (§7) grupuje właśnie po niej. */
  database.exec("CREATE INDEX IF NOT EXISTS ix_events_ref_time ON events(user_ref, created_at)");
}

/** ISO timestamp UTC (spójny z DEFAULT w schemacie). */
export const nowIso = () => new Date().toISOString();

/** Kolejny numer dokumentu MM (dev; w prod nadaje Subiekt). */
export function nextMmNumber(): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='mm' RETURNING value")
    .get() as { value: number };
  return `${row.value}/07/2026`;
}
