import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { odkodujEncje } from "../tekst.js";

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
  zwrotNieobowiazkowyWKoszu(database);
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
  /* Kto prowadzi pytanie klienta (0.89.0). Tabela `pytanie` istnieje od
     0.80.0, więc kolumny muszą dojść migracją — bazy z tamtego wydania nie
     przechodzą przez CREATE TABLE. Nullowalne: sprawa bez prowadzącego jest
     stanem normalnym, nie brakiem danych. */
  addColumn("pytanie", "prowadzi", "TEXT");
  addColumn("pytanie", "prowadzi_at", "TEXT");
  addColumn("pytanie", "nowa_wiadomosc_at", "TEXT");
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
  /* Sygnał dla biura, że odpowiedź na notatkę już przyszła (0.57.0). */
  addColumn("delivery_note", "odp_widziana_at", "TEXT");
  /* Identyfikator kupującego przy zwrocie (0.56.6). `CREATE TABLE IF NOT
     EXISTS` nie dokłada kolumny do tabeli, która już istnieje — a `zwrot`
     stoi u klienta od 0.53.0. Bez tej linii wyszukiwanie wątku wiadomości
     wywracałoby się na nieznanej kolumnie. */
  addColumn("zwrot", "kupujacy_id", "TEXT");
  dosypIdKupujacego(database);
  /* Etap 2 zwrotów (0.58.0): korekta + MM na bufor. `zwrot` i `sfera_queue`
     stoją u klienta od dawna, a `sgt_sprzedaz` odświeża się w całości przy
     imporcie — ale kolumna musi ISTNIEĆ, zanim import spróbuje do niej pisać. */
  addColumn("zwrot", "korekta_queue_id", "INTEGER");
  addColumn("sfera_queue", "wynik_json", "TEXT");
  addColumn("sgt_sprzedaz", "mag_id", "INTEGER");
  /* Etap 3 zwrotów (0.59.0): kosze i ścieżka reklamacyjna. Nowe tabele idą
     z CREATE TABLE IF NOT EXISTS; tu tylko kolumny w tabelach zastanych. */
  addColumn("zwrot", "kosz_id", "INTEGER");
  addColumn("zwrot_pozycja", "rekl_wynik", "TEXT");
  addColumn("zwrot_pozycja", "rekl_at", "TEXT");
  addColumn("zwrot_pozycja", "rekl_przez", "TEXT");
  addColumn("zwrot_pozycja", "rekl_notatka", "TEXT");
  addColumn("zwrot_pozycja", "rekl_polka", "TEXT");
  addColumn("zwrot_zapowiedz", "status_allegro", "TEXT");
  /* Kosz z dokumentu MM (0.75.0): numer z kartki wskazuje przesunięcie
     z Subiekta, a nie kod nadany w biurze. NULL = kosz złożony w aplikacji. */
  addColumn("kosz", "mm_dok_id", "INTEGER");
  addColumn("kosz", "mm_numer", "TEXT");
  /* Rodzaj kosza (0.122.0): `zwroty` albo `karton`. Karton to towar źle
     zebrany, odłożony przez pakujących do jednego pudła — ta sama praca
     rozkładania, ale bez dokumentu i bez zwrotu.

     Domyślna wartość załatwia zastane wiersze i to nie jest wygoda, tylko
     prawda: wszystko, co dziś leży w tej tabeli, powstało ze zwrotu albo
     z przesunięcia MM. Kolumna stoi TU, a nie w schema.sql, żeby nie
     rozjeżdżać się z `mm_dok_id` — kosz od 0.75.0 opisują dwa miejsca
     i trzecie byłoby o jedno za dużo. */
  addColumn("kosz", "rodzaj", "TEXT NOT NULL DEFAULT 'zwroty'");
  /* Anulowanie kartonu (0.123.0). Pudło otwarte przez pomyłkę albo porzucone
     musi mieć jak zniknąć — do tej wersji jedynym wyjściem było rozłożenie
     wszystkiego. Kolumny nullowalne: brak znacznika znaczy „nie anulowano". */
  addColumn("kosz", "anulowano_at", "TEXT");
  addColumn("kosz", "anulowano_przez", "TEXT");
  przebudujIndeksKoduKosza(database);
  /* 0.76.1 — instalacja z 0.75.0 ma tę tabelę bez snapshotu nazwy,
     a CREATE TABLE IF NOT EXISTS jej nie ruszy. */
  /* 0.77.0 — powód pominięcia pozycji kosza (status `skipped`). */
  addColumn("kosz_pozycja", "powod", "TEXT");
  /* Kiedy pominięto — bez tego lista pominięć w biurze nie umie powiedzieć,
     która sprawa czeka najdłużej, a to jest jej cała treść. */
  addColumn("kosz_pozycja", "pominieto_at", "TEXT");
  addColumn("kosz_pozycja", "zalatwione_at", "TEXT");
  addColumn("kosz_pozycja", "zalatwione_przez", "TEXT");
  addColumn("kosz_pozycja", "zalatwione_notatka", "TEXT");
  addColumn("kosz_pozycja", "loc_queue_id", "INTEGER");
  addColumn("kosz_pozycja", "pozniej_at", "TEXT");
  addColumn("sgt_mm_zwrot_pozycja", "symbol", "TEXT NOT NULL DEFAULT ''");
  addColumn("sgt_mm_zwrot_pozycja", "nazwa", "TEXT NOT NULL DEFAULT ''");
  /* Kto prowadzi ZWROT (0.121.0). Jako jedyny z czterech rejestrów zwrot nie
     miał gdzie zapisać znacznika prowadzenia — a kolejka spraw pokazuje go
     przy wszystkich czterech, więc bez tej kolumny zwrot byłby jedyną sprawą,
     której nie da się wziąć. Tabela stoi u klienta od 0.53.0, więc migracja.
     Znacznik, nie blokada: mówi „ktoś to wziął", nie „tobie nie wolno". */
  addColumn("zwrot", "prowadzi", "TEXT");
  addColumn("zwrot", "prowadzi_at", "TEXT");
  /* Kto prowadzi reklamację. `zwrot_pozycja` stoi u klienta od 0.53.0, więc
     kolumny muszą dojść migracją — jak `pytanie.prowadzi` (0.89.0), z tego
     samego powodu i z tą samą naturą znacznika, nie blokady. */
  addColumn("zwrot_pozycja", "rekl_prowadzi", "TEXT");
  addColumn("zwrot_pozycja", "rekl_prowadzi_at", "TEXT");
  /* Odpowiedzi w dyskusjach Allegro (0.104.0). Tabela `dyskusja` stoi
     u klienta od 0.103.0, więc kolumny muszą dojść migracją. Nazwy lustrzane
     z `pytanie` — celowo: jedna para pojęć (szkic/odpowiedź) w całym biurze. */
  addColumn("dyskusja", "szkic_ai", "TEXT");
  addColumn("dyskusja", "szkic_at", "TEXT");
  addColumn("dyskusja", "odpowiedz", "TEXT");
  addColumn("dyskusja", "edytowano", "INTEGER NOT NULL DEFAULT 0");
  addColumn("dyskusja", "wyslano_at", "TEXT");
  addColumn("dyskusja", "odpowiedzial", "TEXT");
  /* Przełącznik automatycznych szkiców (0.107.0). `ai_config` stoi u klienta
     od 0.80.0, więc kolumna musi dojść migracją. Domyślne 0 znaczy, że po
     aktualizacji szkice przestają powstawać same — świadomie, bo o to
     poprosił właściciel. */
  addColumn("ai_config", "auto_szkic", "INTEGER NOT NULL DEFAULT 0");
  naLoginIHaslo(database);
  bezBrygadzisty(database);
  ziarnoStrefyZlotej(database);
  odkodujEncjeWBazie(database);
}

/**
 * Jednorazowe zdjęcie encji HTML z zastanych wierszy (0.127.0).
 *
 * Do 0.127.0 adapter zapisywał teksty Allegro dosłownie, więc w bazie leżą
 * `zwr&oacute;cić` — a panel escape'uje przy renderowaniu, więc encja szła
 * na ekran. Nowe dane dekoduje adapter; tu doganiamy stare. Wzorzec
 * `dosypIdKupujacego`: idempotentnie (po dekodzie encji nie ma), w try/catch,
 * bez zatrzymywania startu. Dwa procesy (API + worker) mogą wejść tu naraz —
 * wynik dekodowania jest deterministyczny, więc wyścig jest niegroźny.
 * Pochodne `szkic_ai`/`odpowiedz` ŚWIADOMIE nietknięte: to teksty redagowane
 * ręką człowieka — jeśli encja tam została, człowiek ją widział i wysłał.
 */
function odkodujEncjeWBazie(database: DatabaseSync) {
  const cele: Array<[tabela: string, kolumna: string]> = [
    ["dyskusja", "temat"],
    ["pytanie", "tresc"],
    ["pytanie", "oferta_tytul"],
  ];
  for (const [tabela, kolumna] of cele) {
    try {
      /* LIKE to luźny prefiltr (dopuszcza fałszywe trafienia) — rozstrzyga
         porównanie w JS. Wierszy są setki, nie miliony. */
      const wiersze = database
        .prepare(`SELECT id, ${kolumna} AS v FROM ${tabela} WHERE ${kolumna} LIKE '%&%;%'`)
        .all() as Array<{ id: number; v: string | null }>;
      const update = database.prepare(`UPDATE ${tabela} SET ${kolumna} = ? WHERE id = ?`);
      for (const w of wiersze) {
        if (typeof w.v !== "string") continue;
        const czysty = odkodujEncje(w.v);
        if (czysty !== w.v) update.run(czysty, w.id);
      }
    } catch {
      /* Encja w starym wierszu zostaje widoczna na ekranie — usterka
         kosmetyczna nie ma prawa zatrzymać startu serwera. */
    }
  }
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
/**
 * `kosz_pozycja.zwrot_id` przestaje być obowiązkowe (0.75.0).
 *
 * Kosz z dokumentu MM nie ma zwrotu przypiętego w aplikacji — pozycje niesie
 * przesunięcie wystawione w Subiekcie. DRUGA przebudowa tabeli w tym repo
 * (pierwsza: `naLoginIHaslo`) i z tego samego powodu: SQLite nie umie zdjąć
 * NOT NULL zwykłym ALTER-em. Wiersze zostają co do jednego.
 */
/**
 * Indeks unikalności kodu kosza — PRZEBUDOWA, nie dopisanie (0.123.0).
 *
 * `CREATE UNIQUE INDEX IF NOT EXISTS` nie rusza indeksu, który już istnieje,
 * więc zmiana predykatu w schema.sql sama z siebie nie dociera do instalacji
 * stojącej u klienta. Bez tej funkcji anulowany karton trzymałby swój kod
 * zajęty na zawsze — a to kod nadany przez aplikację, nie napisany na etykiecie.
 *
 * Porównujemy TREŚĆ indeksu z `sqlite_master`, żeby nie przebudowywać go przy
 * każdym starcie: to tanie na tej tabeli, ale praca bez powodu w ścieżce
 * uruchomienia zawsze kiedyś urośnie.
 */
function przebudujIndeksKoduKosza(database: DatabaseSync) {
  const CEL = "WHERE status NOT IN ('rozlozony', 'anulowany')";
  const w = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='ix_kosz_kod_aktywny'")
    .get() as { sql: string | null } | undefined;
  if (w?.sql && w.sql.includes("anulowany")) return;
  database.exec("DROP INDEX IF EXISTS ix_kosz_kod_aktywny");
  database.exec(`CREATE UNIQUE INDEX ix_kosz_kod_aktywny ON kosz(kod) ${CEL}`);
}

function zwrotNieobowiazkowyWKoszu(database: DatabaseSync) {
  const wymagany = () =>
    (
      database.prepare("PRAGMA table_info(kosz_pozycja)").all() as Array<{
        name: string;
        notnull: number;
      }>
    ).some((c) => c.name === "zwrot_id" && c.notnull === 1);
  if (!wymagany()) return;

  /* Klucze obce schodzą PRZED transakcją — w transakcji `PRAGMA foreign_keys`
     jest ignorowane po cichu (ta sama pułapka co przy `naLoginIHaslo`). */
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      if (!wymagany()) return; // drugi proces mógł zdążyć pierwszy
      database.exec(`
        CREATE TABLE kosz_pozycja_nowa (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          kosz_id       INTEGER NOT NULL REFERENCES kosz(id),
          zwrot_id      INTEGER REFERENCES zwrot(id),
          tw_id         INTEGER NOT NULL,
          symbol        TEXT NOT NULL,
          nazwa         TEXT NOT NULL,
          ilosc         REAL NOT NULL,
          status        TEXT NOT NULL DEFAULT 'todo',
          lok_faktyczna TEXT,
          odlozono_at   TEXT,
          odlozono_przez TEXT,
          mm_queue_id   INTEGER REFERENCES sfera_queue(id)
        );
        INSERT INTO kosz_pozycja_nowa(id, kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc,
                                      status, lok_faktyczna, odlozono_at, odlozono_przez, mm_queue_id)
          SELECT id, kosz_id, zwrot_id, tw_id, symbol, nazwa, ilosc,
                 status, lok_faktyczna, odlozono_at, odlozono_przez, mm_queue_id
            FROM kosz_pozycja;
        DROP TABLE kosz_pozycja;
        ALTER TABLE kosz_pozycja_nowa RENAME TO kosz_pozycja;
        CREATE INDEX IF NOT EXISTS ix_kosz_poz ON kosz_pozycja(kosz_id);
      `);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

function usunSesjeRozkladania(database: DatabaseSync) {
  // `IF EXISTS` załatwia idempotencję w całości: to dwa DROP-y bez stanu
  // pośredniego, więc API i worker mogą je wykonać w dowolnym przeplocie
  database.exec("DROP TABLE IF EXISTS putaway_items");
  database.exec("DROP TABLE IF EXISTS putaway_sessions");
}

/**
 * Uzupełnia `zwrot.kupujacy_id` w zwrotach sprzed 0.56.6.
 *
 * Zwroty założone wcześniej mają pustą kolumnę, więc szukanie wątku
 * wiadomości nie miałoby dla nich czego użyć. Identyfikator siedzi jednak
 * w zapamiętanej odpowiedzi Allegro (`surowe_json`) — wyciągamy go stamtąd
 * raz, zamiast kazać biuru zakładać te zwroty od nowa. Brak `json_extract`
 * w SQLite tylko zostawia kolumnę pustą; migracja nie zatrzyma startu.
 */
function dosypIdKupujacego(database: DatabaseSync) {
  try {
    database.exec(
      `UPDATE zwrot
          SET kupujacy_id = json_extract(surowe_json, '$.buyer.id')
        WHERE kupujacy_id IS NULL
          AND surowe_json IS NOT NULL
          AND json_extract(surowe_json, '$.buyer.id') IS NOT NULL`
    );
  } catch {
    /* Pusto — zwrot bez identyfikatora dalej szuka wątku po loginie. */
  }
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

/** Kolejny numer korekty sprzedaży (dev; w prod numeruje Subiekt). */
export function nextKorektaNumber(typ: "FS" | "PA"): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='korekta' RETURNING value")
    .get() as { value: number };
  /* Nazewnictwo jak w Subiekcie: korekta faktury to KFS, korekta paragonu
     to KPA. Numer jest atrapą — liczy się to, że karta zwrotu pokazuje ten
     sam kształt, co pokaże produkcja. */
  return `${typ === "PA" ? "KPA" : "KFS"} ${row.value}/07/2026`;
}

/** Kolejny numer RW — rozchód zniszczonych zwrotów (dev; w prod nadaje Subiekt). */
export function nextRwNumber(): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='rw' RETURNING value")
    .get() as { value: number };
  return `RW ${row.value}/07/2026`;
}

/** Kolejny numer dokumentu MM (dev; w prod nadaje Subiekt). */
export function nextMmNumber(): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='mm' RETURNING value")
    .get() as { value: number };
  return `${row.value}/07/2026`;
}
