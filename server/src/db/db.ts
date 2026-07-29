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
  /* Bazę otwierają DWA procesy: API i worker. WAL rozdziela czytających od
     piszących, ale NIE dwóch piszących — a piszą obaj: API przy każdym
     odłożeniu, worker przy każdym zadaniu z kolejki. Bez tego ustawienia
     kolizja kończy się natychmiastowym SQLITE_BUSY: losowe 500 dla
     magazyniera albo zadanie w statusie `error`, bez wzorca i bez tropu.

     Domyślna wartość w `node:sqlite` to zero, więc trzeba ją podać wprost.
     Pięć sekund to dużo ponad najdłuższą transakcję w tym kodzie (kilka
     INSERT-ów) — czekanie tyle znaczyłoby, że drugi proces wisi, i wtedy
     błąd jest poprawną odpowiedzią.                                        */
  database.exec("PRAGMA busy_timeout = 5000");
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
 *
 * BEGIN **IMMEDIATE**, nie zwykłe BEGIN, i to nie jest drobiazg przy dwóch
 * procesach. Zwykłe BEGIN jest odroczone: blokadę zapisu bierze dopiero przy
 * pierwszym INSERT-cie, czyli podnosi transakcję z odczytu na zapis. Gdy
 * w międzyczasie zapisał ktoś inny, SQLite zwraca SQLITE_BUSY **natychmiast
 * i wbrew `busy_timeout`** — bo czekanie mogłoby zakleszczyć oba procesy.
 * IMMEDIATE bierze blokadę od razu, więc `busy_timeout` faktycznie działa
 * i kolizja kończy się chwilą czekania zamiast błędem.
 */
export function transaction<A extends unknown[], R>(
  database: DatabaseSync,
  fn: (...args: A) => R,
): (...args: A) => R {
  return (...args: A): R => {
    database.exec("BEGIN IMMEDIATE");
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
  /* Konto autora zadania. `created_by` (nazwa) zostaje — to snapshot tego, co
     aplikacja wtedy wiedziała. Worker działa poza żądaniem, więc bez tej
     kolumny nie umiałby przypisać zdarzenia „zapis wszedł do Subiekta" do
     konta, a nazwa nie jest tożsamością. Stare zadania mają NULL i tak
     zostaje: zgadywanie po nazwie byłoby gorsze niż uczciwy brak. */
  addColumn("sfera_queue", "created_by_ref", "INTEGER");
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
  /* Indeks po towarze. `CREATE INDEX IF NOT EXISTS` w schema.sql wystarcza dla
     NOWEJ bazy, ale istniejąca instalacja wykonała schemat dawno — bez tej
     linii filtr audytu po towarze skanowałby u niej całą tabelę. */
  database.exec("CREATE INDEX IF NOT EXISTS ix_events_tw_time ON events(tw_id, created_at)");
  /* Nazwa magazynu z sl_Magazyn. `CREATE TABLE IF NOT EXISTS` nie dokłada
     kolumny do tabeli, która już istnieje — bez tej linii istniejąca instalacja
     miałaby `sgt_magazyn` bez `nazwa` i import wywaliłby się na INSERT. */
  addColumn("sgt_magazyn", "nazwa", "TEXT NOT NULL DEFAULT ''");
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
