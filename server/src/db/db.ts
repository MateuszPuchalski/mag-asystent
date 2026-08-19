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
 * ROLLBACK jest tu istotny, a nie kosmetyczny: rozkładanie i przesunięcie
 * stanu zapisują w jednej transakcji pozycję ORAZ zadanie do kolejki Sfery.
 * Przerwanie w połowie zostawiłoby zadanie zapisu bez pokrycia w danych albo
 * odwrotnie.
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
  usunSesjeRozkladania(database);
  /* Konto autora zadania. `created_by` (nazwa) zostaje — to snapshot tego, co
     aplikacja wtedy wiedziała. Worker działa poza żądaniem, więc bez tej
     kolumny nie umiałby przypisać zdarzenia „zapis wszedł do Subiekta" do
     konta, a nazwa nie jest tożsamością. Stare zadania mają NULL i tak
     zostaje: zgadywanie po nazwie byłoby gorsze niż uczciwy brak. */
  addColumn("sfera_queue", "created_by_ref", "INTEGER");
  addColumn("delivery", "source_mag_id", "INTEGER");
  /* Zamknięcie dostawy jako rozłożonej POZA WERTIS (0.40.0). Kolumny są
     nullowalne, więc dostawy zamknięte normalnie zostają nietknięte — a puste
     `closed_by` przy statusie `done` znaczy „domknęła się sama, gdy skończyły
     się pozycje", nie „nie wiadomo kto". */
  addColumn("delivery", "closed_by", "TEXT");
  addColumn("delivery", "powod_zamkniecia", "TEXT");
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
  /* Niezgodność w dostawie wg firmowego formularza (0.21.0). Kolumny są
     nullowalne, więc wyjątki sprzed zmiany zostają nietknięte — a `ilosc_dok`
     puste znaczy „zgłoszono, zanim zaczęliśmy zapisywać snapshot", nie zero. */
  addColumn("problem", "sym_obcy", "TEXT");
  addColumn("problem", "zamiast_ilosc", "REAL");
  addColumn("problem", "ilosc_dok", "REAL");
  addColumn("delivery", "nr_przesylki", "TEXT");
  addColumn("delivery", "kurier_protokol", "TEXT");
  addColumn("delivery", "przesylka_at", "TEXT");
  addColumn("delivery", "przesylka_by", "TEXT");
  /* Klucz kontrahenta pod logo dostawcy (0.56.0). Read-model odświeża się
     w całości przy każdej synchronizacji, więc kolumna wypełni się sama —
     ale musi ISTNIEĆ, zanim adapter spróbuje do niej pisać. */
  addColumn("sgt_dokument", "kh_id", "INTEGER");
  naLoginIHaslo(database);
  bezBrygadzisty(database);
  ziarnoStrefyZlotej(database);
}

/**
 * Ziarno reguł strefy złotej (0.50.0).
 *
 * Reguły były stałą w kodzie (`services/strefa-zlota.ts`); od 0.50.0 są
 * edytowalne z panelu biura, więc mieszkają w tabeli. Wsiewamy je WYŁĄCZNIE
 * do pustej tabeli: instalacja, w której biuro już cokolwiek zmieniło, nie ma
 * prawa dostać z powrotem wartości fabrycznych przy restarcie.
 *
 * Wartości są zapisem właściciela — komentarz przy `STREFA_ZLOTA` cytuje go
 * słowo w słowo; tu tylko postać tabelaryczna.
 */
function ziarnoStrefyZlotej(database: DatabaseSync) {
  const n = (database.prepare("SELECT COUNT(*) AS n FROM strefa_regula").get() as { n: number }).n;
  if (n > 0) return;
  const ins = database.prepare(
    "INSERT INTO strefa_regula(alejka, regal_od, regal_do, poziomy) VALUES (?,?,?,?)"
  );
  const ziarno: Array<[string | null, string | null, string | null, string]> = [
    ["A", null, null, "2,3,4"],
    ["B", null, null, "2,3,4"],
    ["H", null, null, "2,3,4"],
    ["J", null, null, "2,3,4"],
    ["C", null, null, "2,3"],
    [null, "D01", "D05", "2,3"],
    [null, "E03", "E04", "2"],
    [null, "E05", "E08", "2,3"],
    ["F", null, null, "4,8"],
    ["G", null, null, "3,7"],
  ];
  for (const [alejka, od, doR, poziomy] of ziarno) ins.run(alejka, od, doR, poziomy);
}

/**
 * Rola `brygadzista` wychodzi razem z blokadami pozycji (0.47.0).
 *
 * Istniała po to, żeby ktoś mógł odebrać koledze zajętą pozycję. Bez locków
 * nie ma czego odbierać, a rola bez ani jednego uprawnienia jest gorsza niż
 * jej brak: widać ją na ekranie, więc obiecuje coś, czego nie robi.
 *
 * Konta ZOSTAJĄ, zmienia się wyłącznie rola. Kasowanie kont zabrałoby audytowi
 * wskazanie (`events.user_ref`), a odebranie hasła zabrałoby ludziom dostęp do
 * pracy, którą i tak wykonują — brygadzista miał uprawnienia magazyniera plus
 * jedno, którego już nie ma.
 *
 * `UPDATE` z warunkiem jest idempotentny: po pierwszym przebiegu nie ma czego
 * dopasować, więc kolejne starty API i workera nic nie robią.
 */
function bezBrygadzisty(database: DatabaseSync) {
  database.exec("UPDATE app_user SET role = 'magazynier' WHERE role = 'brygadzista'");
}

/**
 * Sesje rozkładania wychodzą razem z trybem kontenerowym (0.22.0).
 *
 * KOLEJNOŚĆ JEST WARUNKIEM POPRAWNOŚCI, nie stylem. `putaway_items` miało
 * jedyny w tym schemacie klucz obcy (`session_id → putaway_sessions`), a baza
 * chodzi z `PRAGMA foreign_keys = ON`. Dziecko przed rodzicem znaczy „nie ma
 * już wierszy do sprawdzenia"; odwrotna kolejność wywaliłaby start API i workera
 * naraz, na każdej istniejącej instalacji.
 *
 * `PRAGMA foreign_keys = OFF` NIE jest tu potrzebna — inaczej niż przy
 * `naLoginIHaslo`, gdzie na kasowaną tabelę wskazywało coś Z ZEWNĄTRZ. Tutaj
 * jedyny klucz obcy siedzi wewnątrz kasowanej pary i znika razem z nią.
 *
 * `sfera_queue.session_id` zostaje w starych bazach jako martwa kolumna: INSERT
 * wymienia kolumny jawnie, więc działa i z nią, i bez niej, a przebudowa tabeli,
 * którą jednocześnie trzyma otwartą worker, kosztowałaby bez żadnego zysku.
 * To ten sam wybór co przy 0.17.0 (`koszyk`, `mm_ilosc`, `mm_queue_id`).
 */
function usunSesjeRozkladania(database: DatabaseSync) {
  // `IF EXISTS` załatwia idempotencję w całości: to dwa DROP-y bez stanu
  // pośredniego, więc API i worker mogą je wykonać w dowolnym przeplocie
  database.exec("DROP TABLE IF EXISTS putaway_items");
  database.exec("DROP TABLE IF EXISTS putaway_sessions");
}

/**
 * Przejście z plakietek na login i hasło (0.20.0).
 *
 * PIERWSZA przebudowa tabeli w tym repo — reszta migracji to `addColumn`.
 * Tutaj nie ma innej drogi: `badge_code` jest `UNIQUE`, czyli ma indeks,
 * a SQLite odmawia `DROP COLUMN` na kolumnie indeksowanej.
 *
 * Wiersze ZOSTAJĄ. Wskazują na nie `events.user_ref` i `sfera_queue.created_by_ref`,
 * więc skasowanie tabeli skasowałoby sens całego audytu. Zostają jednak bez
 * loginu i bez hasła, czyli jako konta-ślady: historia ma na co wskazywać,
 * a zalogować się nimi nie da. Konta ludzi biuro zakłada po aktualizacji od nowa.
 *
 * Sesje giną wszystkie. Token wydany po skanie plakietki nie ma prawa przeżyć
 * zmiany mechanizmu wejścia — inaczej kolektor odłożony w piątek pracuje
 * w poniedziałek na uprawnieniach, których nikt już nie potwierdził.
 */
const maKolumne = (database: DatabaseSync, tabela: string, kolumna: string): boolean =>
  (database.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).some(
    (c) => c.name === kolumna
  );

function naLoginIHaslo(database: DatabaseSync) {
  if (!maKolumne(database, "app_user", "badge_code")) return;

  /* Klucze obce MUSZĄ zejść PRZED transakcją, nie w środku: `PRAGMA
     foreign_keys` jest w transakcji ignorowane po cichu. Bez tego `DROP TABLE`
     rodzica przy wierszach w `device_session` kończy się błędem przy starcie
     usługi, czyli awarią dokładnie w chwili wdrożenia. */
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      /* Warunek sprawdzany PONOWNIE, już pod blokadą zapisu. API i worker to
         dwa procesy startowane razem przez NSSM i oba wołają `migrate()`.
         `BEGIN IMMEDIATE` bierze blokadę od razu, więc drugi poczeka i zobaczy
         tabelę już przebudowaną. */
      if (!maKolumne(database, "app_user", "badge_code")) return;
      database.exec(`
        CREATE TABLE app_user_nowy (
          user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
          login      TEXT UNIQUE,
          haslo_hash TEXT,
          name       TEXT NOT NULL,
          role       TEXT NOT NULL DEFAULT 'magazynier',
          active     INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        );
        INSERT INTO app_user_nowy(user_id, name, role, active, created_at)
          SELECT user_id, name, role, active, created_at FROM app_user;
        DROP TABLE app_user;
        ALTER TABLE app_user_nowy RENAME TO app_user;
      `);
      /* `user_id` przepisujemy JAWNIE. Poleganie na AUTOINCREMENT przy
         INSERT ... SELECT przenumerowałoby konta, a `events.user_ref`,
         `sfera_queue.created_by_ref` i `device_session.user_id` wskazywałyby
         wtedy cudze osoby — bez jednego objawu, aż do pierwszej reklamacji. */
      database
        .prepare("UPDATE device_session SET revoked_at = ? WHERE revoked_at IS NULL")
        .run(nowIso());
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
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
