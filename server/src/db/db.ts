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

/* ── Kto jest właścicielem schematu (0.177.1) ────────────────────────────────
   Do tego wydania migrację wykonywał KAŻDY proces otwierający bazę, bo siedzi
   ona w `db()`. Skutek zobaczyliśmy 2 września: wyjątek w `migrate()` położył
   API i workera naraz, a `AppExit Default Restart` bez opóźnienia zamienił to
   w pętlę. W logu workera zostawało „database is locked" — objaw prowadzący
   diagnozę w złe miejsce, bo baza była zablokowana przez API mielące migrację
   w kółko.

   Odtąd schemat zakłada i migruje WYŁĄCZNIE serwer API. Nie jest to pomysł
   nowy w tym repo: worker Sfery w C# pracuje tak od początku i mówi to wprost
   w `sfera-worker/src/Db.cs` — otwiera bazę w trybie, który jej nie utworzy,
   sprawdza obecność tabel i odmawia startu, gdy ich nie ma. Worker w Node był
   jedynym procesem piszącym, który tej zasady nie dostał.

   Jedna różnica wobec C# jest świadoma: tamten ODMAWIA startu, a worker Node
   CZEKA (decyzja właściciela). Proces, który pada, NSSM restartuje — a to jest
   pętla restartów z wyboru, dokładnie ten stan, z którego wychodzimy.        */
let migrowac = true;

/**
 * Deklaracja: ten proces NIE jest właścicielem schematu.
 *
 * Woła się PRZED pierwszym `db()` — i tylko wtedy, bo zmiana zachowania po
 * otwarciu połączenia nie cofnęłaby migracji, która już przeszła. Cicha
 * nieskuteczność byłaby gorsza niż brak tej funkcji, więc to jest wyjątek.
 */
export function bezMigracji(): void {
  if (_db) {
    throw new Error(
      "bezMigracji() po otwarciu bazy — migracja już przeszła. " +
      "Wywołanie musi stać przed pierwszym db() w tym procesie.");
  }
  migrowac = false;
}

/** Tabele, bez których worker nie ma czego robić — lustro `sfera-worker/src/Db.cs`. */
const TABELE_WORKERA = ["sfera_queue", "process_state", "sgt_dokument", "events"];

/**
 * Nazwa pierwszej brakującej tabeli albo `null`, gdy schemat jest gotowy.
 *
 * Sprawdzamy SAME TABELE, nie kolumny. Lista kolumn byłaby drugą definicją
 * schematu, a dwie definicje rozjeżdżają się przy pierwszej zmianie, której
 * ktoś nie przepisze w obie strony.
 */
export function brakujacaTabela(database: DatabaseSync = db()): string | null {
  for (const tabela of TABELE_WORKERA) {
    const jest = database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(tabela);
    if (!jest) return tabela;
  }
  return null;
}

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
  /* Proces bez migracji nie wykonuje TAKŻE `schema.sql`. Sam plik to `CREATE
     TABLE IF NOT EXISTS`, więc na gotowej bazie byłby niby-nieszkodliwy — ale
     na PUSTEJ założyłby połowę schematu bez migracji, czyli dokładnie ten stan
     pośredni, którego ta zmiana ma nie dopuścić. */
  if (migrowac) {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    database.exec(schema);
    migrate(database);
  }
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

/**
 * Dostawki do istniejących baz (CREATE TABLE IF NOT EXISTS nie dodaje kolumn).
 *
 * Eksportowane, bo baza zbudowana z samego `schema.sql` NIE JEST tym, na czym
 * chodzi aplikacja — część kolumn i indeksów dokłada dopiero ta funkcja.
 * Test stawiający bazę bez niej sprawdza kształt, którego nie ma na produkcji.
 */
export function migrate(database: DatabaseSync) {
  const addColumn = (table: string, column: string, decl: string) => {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  };
  usunSesjeRozkladania(database);
  /* Status zwrotu po stronie Allegro (0.164.0). Bez `CHECK` — schemat Allegro
     wymienia wartości słownie i nie zamyka ich enumem, a nieznana wartość ma
     przejść, nie wywrócić synchronizację. */
  addColumn("zwrot_klienta", "status_allegro", "TEXT");
  /* Ile zwrotów Allegro miało jeszcze do oddania, gdy przebieg się skończył
     (0.209.0). Bez tej liczby urwanie na limicie stron było CICHE: przebieg
     kończył się sukcesem, kursor szedł naprzód, a zwroty spoza dziesiątej
     strony nie wracały nigdy. `NULL` znaczy „nie wiem", nie „zero". */
  addColumn("allegro_zwroty_sync_state", "pozostalo", "INTEGER");
  /* Zejście oceny „przecena" (0.209.0).

     MUSI STAĆ PRZED przebudową `zwrot_klienta_pozycja` niżej w tym samym
     przebiegu. Nowa definicja tamtej tabeli nie zna już `przecena`, więc
     `INSERT ... SELECT` przepisujący wiersz z tą oceną wywróciłby CHECK
     i całą migrację — a `migrate()` woła KAŻDY proces, więc instalacja nie
     wstałaby wcale. To ta sama blizna co przy przekluczaniu pozycji.

     Ocena schodzi na `NULL`, nie na „stan" ani „utylizacja". Obie tamte są
     decyzją o towarze, której nikt nie podjął; `NULL` mówi prawdę — pozycja
     czeka na ocenę i wróci do kubełka „do oceny". Zwrotu zamkniętego to nie
     odemknie: `kubelekZwrotu` rozstrzyga stany końcowe pierwsze.

     KOLUMNY PYTAMY, zanim ją odczytamy. Baza sprzed 0.156.0 nie ma jeszcze
     `ocena` — dokłada ją dopiero przebudowa niżej — a `UPDATE` na nieistniejącej
     kolumnie wywraca całą migrację i z nią start każdego procesu. Tam nie ma
     zresztą czego czyścić: bez kolumny nie było jak zapisać przeceny. */
  const maOcene = (database.prepare("PRAGMA table_info(zwrot_klienta_pozycja)")
    .all() as Array<{ name: string }>).some((c) => c.name === "ocena");
  if (maOcene) {
    database.exec(`UPDATE zwrot_klienta_pozycja
      SET ocena=NULL, ocena_at=NULL, ocena_przez=NULL WHERE ocena='przecena'`);
  }
  /* Odhaczenie wzmianki (0.160.0). Do tego wydania `conversation_mention`
     mówiła tylko „ktoś cię wymienił" i nie znała odpowiedzi na „czy już się
     tym zająłeś" — a bez niej skrzynka wzmianek pokazywałaby w kółko to samo. */
  addColumn("conversation_mention", "seen_at", "TEXT");
  /* Zdjęcie listingowe oferty (0.213.0). `offer_snapshot` stoi u klienta od
     0.178.0, więc adres musi dojść migracją. `NULL` znaczy „Allegro nie podało
     adresu" — pole jest w specyfikacji opcjonalne — a nie „oferta bez zdjęcia";
     wiersze sprzed tego wydania uzupełni najbliższy przebieg synchronizacji,
     bo warunek świeżości w `brakujaceOferty` i tak przepuszcza dobowe. */
  addColumn("offer_snapshot", "primary_image_url", "TEXT");
  /* Indeks stoi TUTAJ, nie w `schema.sql`: tamten plik wykonuje się przed
     migracją, więc na bazie sprzed 0.160.0 wywróciłby start na nieistniejącej
     kolumnie. Skrzynka wzmianek pyta zawsze o jednego użytkownika i najczęściej
     o same nieodhaczone. */
  database.exec(`CREATE INDEX IF NOT EXISTS ix_conversation_mention_user
    ON conversation_mention(user_id, seen_at)`);
  /* Status rozmowy (§7, 0.158.0). `new` jako domyślny opisuje prawdę
     o rozmowach zastanych: przyjechały z synchronizacji i nikt ich nie tknął.
     `CHECK` powtarza listę ze `schema.sql`, bo baza założona przed tym
     wydaniem dostaje kolumnę TĘDY i inaczej stałaby bez strażnika. */
  addColumn("conversation", "status", `TEXT NOT NULL DEFAULT 'new' CHECK(status IN
    ('new','open','waiting_for_customer','waiting_for_internal','snoozed',
     'resolved','closed','spam'))`);
  /* Do kiedy odłożona. Osobno od statusu, bo `snoozed` bez terminu byłby
     stanem, z którego nic nie wyprowadza — a §7 nie zna „odłożona na zawsze". */
  addColumn("conversation", "snoozed_until", "TEXT");
  /* Priorytet rozmowy (§10.2, 0.181.0). `CHECK` powtarza listę ze `schema.sql`
     z tego samego powodu co przy statusie: baza sprzed tego wydania dostaje
     kolumnę TĘDY i inaczej stałaby bez strażnika. */
  addColumn("conversation", "priorytet",
    "TEXT NOT NULL DEFAULT 'normalny' CHECK(priorytet IN ('normalny','pilny'))");
  /* Decyzje biura przy zwrocie (0.156.0). Do niego kolejka bramek routowała
     po kolumnach, których nic nie zapisywało — każdy zwrot stał w DO DECYZJI
     na zawsze. Te dwie kolumny domykają zapis kwoty: co weszło do sumy. */
  addColumn("zwrot_klienta", "kwota_dostawa_grosze", "INTEGER");
  addColumn("zwrot_klienta_pozycja", "w_zwrocie", "INTEGER NOT NULL DEFAULT 0");
  /* Cztery rzeczy, o które prosiło biuro zwrotów (0.169.0). Wszystkie
     przyjeżdżały z Allegro od początku i wszystkie były wyrzucane przy
     mapowaniu — pracownik szukał ich potem w panelu sprzedawcy.

     Login kupującego stoi PRZY ZWROCIE, nie tylko przy zamówieniu: zwrot
     niesie go zawsze (sonda: 100 na 100), a zamówienie bywa jeszcze
     niepobrane. To jedyna dana osobowa, którą polityka danych zwrotów
     dopuszcza wprost — imienia i nazwiska Allegro przy zwrocie nie podaje
     wcale, a przy zamówieniu ich nie mapujemy.

     Przewoźnik bez `CHECK`: Allegro nie publikuje zamkniętej listy, a sonda
     złapała `UNKNOWN`, którego nie ma w żadnej specyfikacji. */
  /* Potrącenie za utratę wartości (0.170.0). Do tego wydania kwota do oddania
     była binarna per pozycja: cała cena albo nic. Towar wracający używany nie
     miał jak zjechać w dół, a to jest codzienność biura zwrotów.

     Kwota, nie procent — klient widzi złotówki. Powód obowiązkowy, bo to jego
     treść tłumaczy klientowi, czemu dostał mniej. */
  /* Paczki nieodebrane (0.172.0). Allegro nie zna takiego bytu — `CustomerReturn`
     powstaje z DEKLARACJI klienta, a nieodebrana przesyłka wraca sama. Pieniądze
     i tak trzeba oddać, więc idzie tą samą kolejką, ale z jawnym oznaczeniem.

     `CHECK` dokłada się TĄ drogą, bo baza sprzed tego wydania inaczej stałaby
     bez strażnika — ta sama lekcja co przy statusie rozmowy w 0.158.0. */
  addColumn("zwrot_klienta", "zrodlo",
    "TEXT NOT NULL DEFAULT 'allegro' CHECK(zrodlo IN ('allegro','nieodebrana'))");
  /* Numer listu WYŁĄCZNIE dla paczek nieodebranych — świadomy wyjątek od
     polityki z 0.163.0. Tam numer leży w kopii odpowiedzi Allegro; tu takiej
     kopii nie ma, więc numer z etykiety jest jedynym uchwytem do skanu. */
  addColumn("zwrot_klienta", "waybill", "TEXT");
  addColumn("zwrot_klienta", "notatka", "TEXT");
  /* Pozycja dopisana przez biuro (0.184.0). `CHECK` tą samą drogą co przy
     `zwrot_klienta.zrodlo` — baza sprzed wydania stałaby inaczej bez
     strażnika. Wartość domyślna `allegro` jest tu jedyną poprawną: wszystko,
     co stoi w bazie przed tą migracją, przyszło ze zgłoszenia klienta. */
  addColumn("zwrot_klienta_pozycja", "zrodlo",
    "TEXT NOT NULL DEFAULT 'allegro' CHECK(zrodlo IN ('allegro','biuro'))");
  addColumn("zwrot_klienta_pozycja", "potracenie_grosze", "INTEGER");
  addColumn("zwrot_klienta_pozycja", "potracenie_powod", "TEXT");
  addColumn("zwrot_klienta_pozycja", "potracenie_at", "TEXT");
  addColumn("zwrot_klienta_pozycja", "potracenie_przez", "TEXT");
  /* Doręczenie paczki zwrotnej (0.187.0). Data z trackingu przewoźnika, nie
     z obiektu zwrotu — ten podaje wyłącznie moment nadania. */
  addColumn("zwrot_klienta", "dostarczono_at", "TEXT");
  addColumn("zwrot_klienta", "przesylka_status", "TEXT");
  /* Paczka nieodebrana LEŻY U NAS w chwili rejestracji — biuro wpisuje ją
     dopiero wtedy, gdy trzyma karton w ręku (0.172.0). Trackingu dla niej nie
     ma i nie będzie: przewoźnika nie znamy, a Allegro takiego zwrotu nie zna
     wcale. Dlatego data powrotu jest tu równa dacie rejestracji — to niezmiennik,
     a nie jednorazowa łatka, więc stoi w migracji i przy każdym starcie
     domyka wiersze, którym jej brakuje. Bez niego panel pytał „czy dotarła"
     o karton stojący na biurku operatora. */
  database.exec(`UPDATE zwrot_klienta SET dostarczono_at = paczka_at
                  WHERE zrodlo = 'nieodebrana' AND dostarczono_at IS NULL
                    AND paczka_at IS NOT NULL`);
  addColumn("zwrot_klienta", "kupujacy_login", "TEXT");
  addColumn("zwrot_klienta", "przewoznik", "TEXT");
  /* Dokument sprzedaży z Subiekta przy zwrocie (0.174.0). Numer trzymamy
     SNAPSHOTEM, bo `sgt_faktura` czyści się przy każdym imporcie i dokument
     wypada z okna — powiązanie musi przeżyć własne źródło. */
  addColumn("zwrot_klienta", "faktura_dok_id", "INTEGER");
  addColumn("zwrot_klienta", "faktura_numer", "TEXT");
  addColumn("zwrot_klienta", "faktura_typ", "TEXT");
  /* `CHECK` tą samą drogą co przy `zrodlo` — baza sprzed wydania stałaby
     inaczej bez strażnika. */
  addColumn("zwrot_klienta", "faktura_zrodlo",
    "TEXT CHECK(faktura_zrodlo IN ('numer','reczne'))");
  addColumn("zwrot_klienta", "faktura_at", "TEXT");
  addColumn("zwrot_klienta", "faktura_przez", "TEXT");
  /* ── Zapis do Allegro: zwrot pieniędzy i odmowa (0.190.0) ────────────────
     Do 0.190.0 z tego systemu wychodziła do Allegro wiadomość do klienta
     i wniosek o rabat. Pieniądze oddawał człowiek w panelu Allegro, a panel
     zapisywał sam FAKT — czyli kończył pracę tam, gdzie §25 obiecuje nie
     zaglądać.

     `zwrot_pieniedzy_command_id` powstaje RAZ na zwrot. Allegro daje przy tej
     końcówce idempotencję po `commandId` i to jest jedyne zabezpieczenie przed
     drugim przelewem, gdy sieć zerwie się po wysłaniu żądania, a przed
     odpowiedzią. Nowy identyfikator przy ponowieniu zamieniłby ostrożność
     w podwójny zwrot cudzych pieniędzy.

     `platnosc_id` idzie do `zamowienie_klienta`, bo tam jest jego źródło:
     `payment.id` z formularza zakupowego. Zwrot go nie niesie. */
  addColumn("zwrot_klienta", "zwrot_pieniedzy_command_id", "TEXT");
  addColumn("zwrot_klienta", "zwrot_pieniedzy_id", "TEXT");
  addColumn("zwrot_klienta", "zwrot_pieniedzy_status", "TEXT");
  addColumn("zwrot_klienta", "zwrot_pieniedzy_at", "TEXT");
  addColumn("zwrot_klienta", "zwrot_pieniedzy_przez", "TEXT");
  addColumn("zwrot_klienta", "zwrot_pieniedzy_user_id", "INTEGER");
  addColumn("zwrot_klienta", "odmowa_kod", "TEXT");
  addColumn("zwrot_klienta", "odmowa_powod", "TEXT");
  addColumn("zwrot_klienta", "odmowa_at", "TEXT");
  addColumn("zwrot_klienta", "odmowa_przez", "TEXT");
  addColumn("zwrot_klienta", "odmowa_user_id", "INTEGER");
  addColumn("zamowienie_klienta", "platnosc_id", "TEXT");
  /* Forma płatności i żądanie faktury (0.169.0). Przy zwrocie to nie
     ciekawostka: `CASH_ON_DELIVERY` znaczy, że nie ma karty, na którą oddać
     pieniądze, a `faktura_zadana` mówi, czy do zwrotu trzeba korekty faktury,
     czy paragonu.

     `faktura_zadana` to SAMA FLAGA. Dane firmy z `invoice.address` niosą
     ulicę i miasto, a adresy nie przechodzą przez mapowanie — ta reguła nie
     ma wyjątku i tutaj też go nie dostaje. */
  addColumn("zamowienie_klienta", "platnosc_typ", "TEXT");
  addColumn("zamowienie_klienta", "platnosc_at", "TEXT");
  addColumn("zamowienie_klienta", "faktura_zadana", "INTEGER");
  /* Powód porażki SŁOWEM, nie tylko kodem HTTP (0.152.0). Przez sześćdziesiąt
     dwa przebiegi panel mówił „failed", bo skrzynka stała na błędzie BEZ kodu
     („Konto Allegro niepołączone — /biuro → …"). Serwer znał to zdanie
     i pisał je do dziennika; na ekran nie trafiało nic. */
  addColumn("allegro_inbox_sync_state", "last_error_text", "TEXT");
  /* Dno przejrzanej listy (0.164.1). Bez tej kolumny sufit stron musiałby
     obowiązywać od pierwszego przebiegu — a wtedy instalacja z zaległością
     większą niż sufit czytałaby w kółko te same 25 stron i nigdy nie zobaczyła
     resztę. NULL na bazie zastanej jest poprawny: znaczy „zejdź raz do dna
     bez sufitu", czyli dokładnie to, co robił kod do 0.164.0. */
  addColumn("allegro_inbox_sync_state", "dno_at", "TEXT");
  /* Numer zamówienia wycięty z uwag dokumentu sprzedaży (0.175.0). Read-model
     `sgt_faktura` czyści się przy imporcie, ale jego SCHEMAT zostaje — bez
     dostawki `INSERT` z nową kolumną wywracałby pierwszą synchronizację po
     aktualizacji. */
  addColumn("sgt_faktura", "zamowienie_z_uwag", "TEXT");
  /* Dokument korygowany (0.201.0) — ten sam powód co wyżej: read-model czyści
     się przy imporcie, ale SCHEMAT zostaje, więc bez dostawki pierwszy INSERT
     po aktualizacji wywróciłby synchronizację. */
  addColumn("sgt_faktura", "koryguje_dok_id", "INTEGER");
  /* Skąd wziął się numer korekty: `subiekt` = automat znalazł dokument
     korygujący, `reczne` = człowiek przepisał. Ta sama zasada co przy
     `faktura_zrodlo` — wybór człowieka nie ma udawać faktu z danych. */
  /* Ile sztuk NAPRAWDĘ wróciło (0.212.0). `ilosc` niesie DEKLARACJĘ klienta
     i nadpisuje ją synchronizator przy każdym takcie; tej kolumny nie rusza
     nic poza biurem.

     Puste znaczy „nie liczono" i to nie to samo co zero: zero jest zdaniem
     „klient zgłosił dwie, nie wróciła żadna", a puste — „nikt jeszcze nie
     otworzył kartonu". Kwota i koszyk biorą tę liczbę, gdy jest, a deklarację
     tylko wtedy, gdy jej nie ma.

     Rozjazd ilości sprawdza BIURO — decyzja właściciela: „biuro zajmuje się
     otwieraniem i procesowaniem zwrotów". */
  addColumn("zwrot_klienta_pozycja", "ilosc_zwrocona", "REAL");
  addColumn("zwrot_klienta", "korekta_zrodlo", "TEXT");
  /* Konto autora zadania. `created_by` (nazwa) zostaje — to snapshot tego, co
     aplikacja wtedy wiedziała. Worker działa poza żądaniem, więc bez tej
     kolumny nie umiałby przypisać zdarzenia „zapis wszedł do Subiekta" do
     konta, a nazwa nie jest tożsamością. Stare zadania mają NULL i tak
     zostaje: zgadywanie po nazwie byłoby gorsze niż uczciwy brak. */
  addColumn("sfera_queue", "created_by_ref", "INTEGER");
  /* Zadania istniejące przed odbudową obsługi klienta nie mają rozmowy,
     z której pochodzą. NULL zachowuje tę prawdę; migracja nie zgaduje
     powiązań po opisie ani dacie. */
  addColumn("zadanie_terenowe", "conversation_id", "INTEGER REFERENCES conversation(id) ON DELETE SET NULL");
  addColumn("zadanie_terenowe", "message_id", "INTEGER REFERENCES message(id) ON DELETE SET NULL");
  /* Model kanoniczny zaczyna być zasilany w 0.144.0. Wiadomość musi unieść
     powiązanie z ofertą, a rozmowa flagę nieprzeczytanej — inaczej skrzynka
     dalej musiałaby czytać surowe lądowisko Allegro. */
  addColumn("message", "related_object_type", "TEXT");
  addColumn("message", "related_object_id", "TEXT");
  /* Zamówienie przy wiadomości (0.166.0). Kolumna dochodzi do tabeli, która
     stoi u klienta od 0.144.0, a jej treść dla starych wiadomości bierze się
     z lądowiska — patrz `dosypZamowienieWiadomosci` niżej. */
  addColumn("message", "related_order_id", "TEXT");
  dosypZamowienieWiadomosci(database);
  addColumn("conversation", "unread", "INTEGER NOT NULL DEFAULT 0");
  addColumn("conversation", "assigned_user_id", "INTEGER REFERENCES app_user(user_id)");
  addColumn("conversation", "version", "INTEGER NOT NULL DEFAULT 1");
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
  /* Odmaskowany identyfikator kupującego (0.128.0) — ten sam wzorzec co
     `zwrot.kupujacy_id`: po nim, nie po loginie-masce, pytanie spotyka
     zwroty tego samego klienta. */
  dosypIdZMaski(database);
  /* Konta pracowników (§7). `events.user_id` ZOSTAJE jako tekst — to snapshot
     tego, co aplikacja wtedy wiedziała, i jedyny ślad po zdarzeniach sprzed
     kont. Obok dochodzi `user_ref` wskazujące na app_user. Historii się nie
     kasuje ani nie nadpisuje: zdarzenie, którego nie da się przypisać, zostaje
     z `user_ref = NULL`, bo to jest uczciwe, w odróżnieniu od zgadywania. */
  addColumn("events", "user_ref", "INTEGER");
  /* Stan synchronizacji urósł w 0.147.0 o to, czego żąda §21 projektu panelu:
     moment ostatniej PRÓBY i kod jej porażki. Bez nich panel umie powiedzieć
     tylko „nie udało się", a agent nie wie, czy czekać, czy wołać admina. */
  /* Kartoteka Subiekta przy pozycji zwrotu (0.152.0). `zwrot_klienta_pozycja`
     stoi u klienta od 0.150.0, więc te kolumny muszą dojść migracją — bez
     nich pozycja nie ma jak nieść zdjęcia, bo `zdjecie_cache` i
     `zdjecie_wlasne` są kluczowane po `tw_id`.

     `ALTER TABLE ... ADD COLUMN` w SQLite NIE przyjmuje klucza obcego, więc
     `REFERENCES sgt_towar(tw_id) ON DELETE SET NULL` ze `schema.sql` obowiązuje
     wyłącznie bazy założone od 0.152.0. Dla starszych zostaje sama kolumna
     i to WYSTARCZA: `sgt_towar` jest read-modelem kasowanym przy każdym
     imporcie, a twardy klucz obcy właśnie tam kładł kiedyś API (blizna
     0.148.1). Wiszące `tw_id` odsiewa odczyt, który i tak sprawdza istnienie
     towaru przed pokazaniem zdjęcia. */
  addColumn("zwrot_klienta_pozycja", "url", "TEXT");
  addColumn("zwrot_klienta_pozycja", "tw_id", "INTEGER");
  addColumn("zwrot_klienta_pozycja", "tw_symbol", "TEXT");
  addColumn("zwrot_klienta_pozycja", "tw_zrodlo", "TEXT");
  addColumn("zwrot_klienta_pozycja", "tw_at", "TEXT");
  addColumn("zwrot_klienta_pozycja", "tw_przez", "TEXT");
  addColumn("allegro_inbox_sync_state", "last_attempt_at", "TEXT");
  addColumn("allegro_inbox_sync_state", "last_error_code", "INTEGER");
  addColumn("allegro_inbox_sync_state", "error_thread_count", "INTEGER NOT NULL DEFAULT 0");
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
  dosypIdKupujacego(database);
  /* Etap 2 zwrotów (0.58.0): korekta + MM na bufor. `zwrot` i `sfera_queue`
     stoją u klienta od dawna, a `sgt_sprzedaz` odświeża się w całości przy
     imporcie — ale kolumna musi ISTNIEĆ, zanim import spróbuje do niej pisać. */
  addColumn("sfera_queue", "wynik_json", "TEXT");
  /* Etap 3 zwrotów (0.59.0): kosze i ścieżka reklamacyjna. Nowe tabele idą
     z CREATE TABLE IF NOT EXISTS; tu tylko kolumny w tabelach zastanych. */
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
  /* Zadanie MM MAG→ZWROTY, kolejkowane przy domknięciu koszyka składanego
     w panelu (0.192.0). `kosz_pozycja.mm_queue_id` to co INNEGO: tamto jest
     przesunięciem powrotnym ZWROTY→MAG dla jednej rozłożonej pozycji. */
  addColumn("kosz", "mm_queue_id", "INTEGER REFERENCES sfera_queue(id)");
  /* Skąd wiersz koszyka się wziął — po tym cofnięcie oceny go zdejmuje.
     Kosz z dokumentu Subiekta ma tu `NULL`: tamten rodzi się z pozycji MM. */
  addColumn("kosz_pozycja", "zwrot_pozycja_id", "INTEGER");
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
  /* Kto prowadzi reklamację. `zwrot_pozycja` stoi u klienta od 0.53.0, więc
     kolumny muszą dojść migracją — jak `pytanie.prowadzi` (0.89.0), z tego
     samego powodu i z tą samą naturą znacznika, nie blokady. */
  /* Odpowiedzi w dyskusjach Allegro (0.104.0). Tabela `dyskusja` stoi
     u klienta od 0.103.0, więc kolumny muszą dojść migracją. Nazwy lustrzane
     z `pytanie` — celowo: jedna para pojęć (szkic/odpowiedź) w całym biurze. */
  /* Przełącznik automatycznych szkiców (0.107.0). `ai_config` stoi u klienta
     od 0.80.0, więc kolumna musi dojść migracją. Domyślne 0 znaczy, że po
     aktualizacji szkice przestają powstawać same — świadomie, bo o to
     poprosił właściciel. */
  naLoginIHaslo(database);
  bezBrygadzisty(database);
  ziarnoStrefyZlotej(database);
  bezObslugiKlienta(database);
  pozycjaZwrotuBezReadModelu(database);
  indeksKluczaPozycji(database);
  /* NA KOŃCU, po wszystkich `addColumn`: przebudowa kopiuje kolumny po
     nazwach, więc musi widzieć tabelę już kompletną. */
  zadanieNieTrzymaTowaru(database);
  watekInboxuDopuszczaBrakDaty(database);
  wiadomoscInboxuMaKsztaltAllegro(database);
  /* NA KOŃCU, po przebudowach: kasowanie ma zastać tabele już w docelowym
     kształcie. */
  sprzatnijSprzedGranicy(database);
  odkodujEncjeWZastanych(database);
  tabelaFts(database);
}

/* ── Indeks pełnotekstowy kartotek (etap E3) ────────────────────────────────
   Tabela wirtualna FTS5, contentless (`content=''`): wiersze to same tokeny
   z `rowid = tw_id`. Zewnętrzna treść na `sgt_towar` wymagałaby triggerów na
   tabeli, którą import z Subiekta WYCINA co `MSSQL_SYNC_MS` — indeks
   przebudowuje się po imporcie w `services/po-imporcie.ts`, nie triggerami.

   W try/catch, bo FTS5 zależy od flag builda SQLite w Node. Instalacja bez
   niego STARTUJE: szczebel pełnotekstowy melduje się jako niedostępny,
   a raport pokrycia to pokazuje. `unicode61 remove_diacritics 2` zdejmuje
   ogonki po stronie SQLite; treść i tak wchodzi przez `zloz()`, żeby JS
   i SQL trzymały jedną prawdę normalizacji (patrz `tekst.ts`). */
let ftsStan: "ok" | "niedostepne" | "nieznane" = "nieznane";

function tabelaFts(database: DatabaseSync): void {
  try {
    database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS towar_fts
      USING fts5(symbol, nazwa, opis, content='', tokenize='unicode61 remove_diacritics 2')`);
    ftsStan = "ok";
  } catch (e) {
    ftsStan = "niedostepne";
    console.warn(`[db] FTS5 niedostępne — szczebel pełnotekstowy doboru wyłączony: ${(e as Error).message}`);
  }
}

/** Czy ta instalacja ma FTS5. `false` także PRZED migracją — odczyt bez indeksu to brak indeksu. */
export function ftsDostepne(): boolean {
  return ftsStan === "ok";
}

/** Wyłącznie dla testów: udawanie instalacji bez FTS5. */
export function udawajBrakFts(brak: boolean): void {
  ftsStan = brak ? "niedostepne" : "ok";
}

/**
 * Pozycja zwrotu przestaje wisieć na read-modelu (0.154.0).
 *
 * DO 0.153.1 `zwrot_klienta_pozycja.tw_id` miało
 * `REFERENCES sgt_towar(tw_id) ON DELETE SET NULL`. Import z Subiekta kasuje
 * CAŁY read-model i wstawia go od nowa co `MSSQL_SYNC_MS` — czyli domyślnie
 * co minutę zerował KAŻDĄ kartotekę potwierdzoną przez człowieka. Cicho,
 * bez błędu, z „Bez kartoteki" jako jedynym objawem.
 *
 * Przewrotność tamtego stanu: `ALTER TABLE` w SQLite nie umie dołożyć klucza
 * obcego, więc instalacja sprzed 0.152.0 dostała samą kolumnę i powiązania
 * TRZYMAŁA. Traciła je dopiero baza założona ze świeżego schematu.
 *
 * Przy okazji dochodzi `klucz` — naturalny identyfikator pozycji w obrębie
 * zwrotu (`offer_id|nazwa`). Bez niego synchronizator musiał kasować pozycje
 * i wstawiać od nowa, a `id` zmieniało się pod otwartym panelem.
 *
 * Zabieg ten sam co przy `kosz_pozycja` w 0.140.0: nowa tabela, przepisanie
 * kolumn WSPÓLNYCH, podmiana nazwy. Klucze obce schodzą PRZED transakcją, bo
 * w transakcji `PRAGMA foreign_keys` jest ignorowane po cichu.
 */
/**
 * Rozplata duplikaty `klucz` w obrębie zwrotu — PRZED założeniem indeksu.
 *
 * Blizna 0.174.2, druga z tej samej rodziny. 0.162.1 dołożyło przyrostek
 * `|#n` dla powtórzonej pary `offer_id|nazwa` i to załatwiło duplikaty
 * WPROST. Nie załatwiło zderzenia: pozycja, której NAZWA niesie już tekst
 * `|#2`, dostaje klucz identyczny z drugim wystąpieniem sąsiada. Indeks
 * UNIQUE odrzucał go po przemianowaniu tabeli, `migrate()` rzucał wyjątkiem,
 * a `db()` woła migrację w KAŻDYM procesie — API i worker wpadały w pętlę
 * restartów NSSM, a w logu zostawało „database is locked" jako jedyny objaw.
 *
 * Dlatego klucza nie liczymy odtąd „mądrzej". Wyliczenie zostaje takie samo,
 * bo do klucza przywiązana jest praca człowieka (ocena, kartoteka, zaznaczenie
 * kwoty) i przeliczenie wszystkiego zerwałoby ją w zmigrowanych bazach.
 * Zamiast tego duplikat, który mimo wszystko powstał, dostaje przyrostek
 * z `id` — a `id` jest unikalne z definicji, więc druga taka kolizja nie ma
 * z czego powstać.
 *
 * Pętla, bo naprawiony klucz teoretycznie może trafić w kolejny zastany.
 * Bez niej zostałaby ta sama mina, tyle że o oczko dalej.
 */
function rozplacDuplikatyKluczy(database: DatabaseSync): number {
  let naprawionych = 0;
  for (let proba = 0; proba < 5; proba++) {
    const wynik = database.prepare(`UPDATE zwrot_klienta_pozycja
      SET klucz = klucz || '|#id' || id
      WHERE id IN (SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY zwrot_id, klucz ORDER BY id) AS n
        FROM zwrot_klienta_pozycja) WHERE n > 1)`).run();
    const ile = Number(wynik.changes ?? 0);
    naprawionych += ile;
    if (ile === 0) break;
  }
  /* Głośno, bo to zmiana danych, której nikt nie zlecił. Cisza tutaj znaczyłaby,
     że klucz pozycji zmienił się pod otwartym panelem bez śladu. */
  if (naprawionych) {
    console.warn(
      `[migracja] rozplotłem ${naprawionych} zduplikowanych kluczy pozycji zwrotu ` +
      "— przyrostek |#id<id>. Bez tego indeks UNIQUE kładł start aplikacji.");
  }
  return naprawionych;
}

function pozycjaZwrotuBezReadModelu(database: DatabaseSync) {
  const kolumny = (tabela: string) =>
    (database.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>)
      .map((c) => c.name);

  /* Bazy budowane w testach bywają MINIMALNE — mają dwie tabele, których
     akurat dotyczy dany test, i nic poza tym. Migracja nie ma prawa się na
     nich wywalić; ta sama ostrożność co przy `maKolumne` wyżej. */
  const jest = database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='zwrot_klienta_pozycja'"
  ).get();
  if (!jest) return;

  /* Przebudowujemy TYLKO wtedy, gdy klucz obcy naprawdę tam jest albo brakuje
     `klucz`. Bez tego warunku każdy start przepisywałby całą tabelę. */
  const obce = database.prepare("PRAGMA foreign_key_list(zwrot_klienta_pozycja)")
    .all() as Array<{ table: string }>;
  const maObcyDoTowaru = obce.some((f) => f.table === "sgt_towar");
  const maKlucz = kolumny("zwrot_klienta_pozycja").includes("klucz");
  if (!maObcyDoTowaru && maKlucz) return;

  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      /* Warunek sprawdzany PONOWNIE, już pod blokadą zapisu — tak samo jak przy
         `zadanie_terenowe` i wiadomości skrzynki. Od 0.177.1 migruje wyłącznie
         API, więc równoległych przebiegów jest mniej, ale nie zero: `npm run
         seed` potrafi chodzić przy żywym serwerze. Bez tego sprawdzenia drugi
         przebieg przeliczałby klucze policzone przez pierwszy. */
      const obceTeraz = database.prepare("PRAGMA foreign_key_list(zwrot_klienta_pozycja)")
        .all() as Array<{ table: string }>;
      if (!obceTeraz.some((f) => f.table === "sgt_towar")
          && kolumny("zwrot_klienta_pozycja").includes("klucz")) return;
      const stare = kolumny("zwrot_klienta_pozycja");
      database.exec(`
        CREATE TABLE zwrot_klienta_pozycja_nowa (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
          offer_id TEXT,
          nazwa TEXT NOT NULL,
          ilosc REAL NOT NULL,
          cena_grosze INTEGER NOT NULL,
          waluta TEXT NOT NULL,
          powod TEXT,
          powod_komentarz TEXT,
          url TEXT,
          -- Kolumna w_zwrocie MUSI tu być, choć addColumn dokłada ją
          -- kilkadziesiąt linii wyżej w tym samym przebiegu: przebudowa kasuje
          -- starą tabelę, więc kolumny nieobecne w TEJ definicji znikają razem
          -- z nią i wracają dopiero przy następnym starcie. Do tego czasu
          -- zapiszKwote leci na nieistniejącą kolumnę.
          w_zwrocie INTEGER NOT NULL DEFAULT 0,
          klucz TEXT NOT NULL,
          ocena TEXT CHECK (ocena IN ('stan','utylizacja')),
          ocena_at TEXT, ocena_przez TEXT,
          tw_id INTEGER,
          tw_symbol TEXT,
          tw_zrodlo TEXT CHECK (tw_zrodlo IN ('sku','reczne')),
          tw_at TEXT, tw_przez TEXT
        );
      `);
      const nowe = kolumny("zwrot_klienta_pozycja_nowa");
      /* `klucz` liczymy przy przepisaniu, bo w starej tabeli go nie było. */
      const wspolne = nowe.filter((c) => c !== "klucz" && stare.includes(c));
      /* NUMER WYSTĄPIENIA, i to jest poprawka z 0.162.1. Sam `offer_id|nazwa`
         NIE JEST unikalny w obrębie zwrotu: `CustomerReturnItem` w specyfikacji
         Allegro nie ma żadnego identyfikatora pozycji, więc ta sama oferta
         potrafi wystąpić dwa razy — a do 0.153.1 synchronizator wstawiał takie
         pary bez żadnego ograniczenia. Przy skoku 0.153.1 → 0.162.0 ta
         przebudowa liczyła im identyczny klucz, indeks UNIQUE go odrzucał
         i wywracał `migrate()`: instalacja nie wstawała wcale, bo `db()` woła
         migrację, a `db()` woła KAŻDY proces.

         Pierwsze wystąpienie zostaje przy kluczu bez przyrostka. Dzięki temu
         bazy już zmigrowane nie przekluczają ani jednego wiersza — a do klucza
         przywiązana jest praca człowieka: ocena, kartoteka, zaznaczenie kwoty. */
      database.exec(`
        INSERT INTO zwrot_klienta_pozycja_nowa(${wspolne.join(", ")}, klucz)
          SELECT ${wspolne.join(", ")},
                 COALESCE(offer_id,'') || '|' || nazwa ||
                   CASE WHEN n = 1 THEN '' ELSE '|#' || n END
          FROM (SELECT *, ROW_NUMBER() OVER (
                  PARTITION BY zwrot_id, COALESCE(offer_id,'') || '|' || nazwa
                  ORDER BY id) AS n
                FROM zwrot_klienta_pozycja);
        DROP TABLE zwrot_klienta_pozycja;
        ALTER TABLE zwrot_klienta_pozycja_nowa RENAME TO zwrot_klienta_pozycja;
        CREATE INDEX IF NOT EXISTS ix_zwrot_klienta_pozycja_zwrot
          ON zwrot_klienta_pozycja(zwrot_id);
      `);
      /* Indeks UNIQUE zakłada się DOPIERO po rozplątaniu, i to jest cała
         poprawka 0.174.2. Wcześniej stał w tym samym `exec` co przepisanie,
         więc jeden zderzony klucz wycofywał transakcję i kładł start. */
      rozplacDuplikatyKluczy(database);
      database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_zwrot_klienta_pozycja_klucz
        ON zwrot_klienta_pozycja(zwrot_id, klucz)`);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Indeks klucza naturalnego pozycji zwrotu.
 *
 * Stoi TUTAJ, nie w `schema.sql`, bo kolumna `klucz` dochodzi przebudową:
 * w chwili wykonania schematu istniejąca baza jeszcze jej nie ma, a indeks
 * na nieistniejącej kolumnie wywala start. Ta sama reguła co przy
 * `ix_events_ref_time`.
 */
function indeksKluczaPozycji(database: DatabaseSync) {
  const ma = (database.prepare("PRAGMA table_info(zwrot_klienta_pozycja)")
    .all() as Array<{ name: string }>).some((c) => c.name === "klucz");
  if (!ma) return;
  /* Także tutaj, nie tylko w przebudowie (0.174.2). Baza, która przebudowę ma
     już za sobą, wchodzi w tę ścieżkę — a duplikat mógł do niej trafić
     zapisem aplikacji, zanim indeks w ogóle powstał. */
  rozplacDuplikatyKluczy(database);
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_zwrot_klienta_pozycja_klucz
    ON zwrot_klienta_pozycja(zwrot_id, klucz)`);
}

/**
 * Zadanie terenowe przestaje blokować przebudowę read-modelu (0.148.1).
 *
 * `zadanie_terenowe.tw_id` wskazywał na `sgt_towar(tw_id)` BEZ `ON DELETE`,
 * czyli z domyślnym `NO ACTION`. Tymczasem `sgt_towar` jest read-modelem:
 * `importFromMssql` kasuje całą tabelę i wstawia ją od nowa przy każdym
 * odświeżeniu z Subiekta.
 *
 * Skutek był taki, że JEDNO zadanie ze wskazanym towarem wywracało `DELETE
 * FROM sgt_towar` na `FOREIGN KEY constraint failed` — a że import biegnie
 * w `main()` PRZED `app.listen()`, kładło to całe API w pętli restartów NSSM.
 * Mina leżała uzbrojona od 0.141.0 i wybuchła, gdy 0.145.0 dało agentom
 * wyszukiwarkę towaru, czyli pierwszy łatwy sposób na wpisanie `tw_id`.
 *
 * `SET NULL` jest właściwą odpowiedzią, nie obejściem: zadanie niesie własny
 * snapshot symbolu i nazwy, więc po utracie powiązania nadal mówi hali, o co
 * chodziło. Ta sama tabela trzyma tak `conversation_id` i `message_id`.
 *
 * Zmiana klucza obcego w SQLite wymaga przebudowy tabeli (blizna 0.135.0).
 */
function zadanieNieTrzymaTowaru(database: DatabaseSync) {
  const trzymaTowar = () => (database.prepare(
    "PRAGMA foreign_key_list(zadanie_terenowe)").all() as Array<{ table: string; on_delete: string }>)
    .some((k) => k.table === "sgt_towar" && k.on_delete !== "SET NULL");
  if (!trzymaTowar()) return;

  /* Klucze obce MUSZĄ zejść PRZED transakcją: w transakcji `PRAGMA
     foreign_keys` jest ignorowane po cichu, a `DROP TABLE` rodzica przy
     wierszach dziecka skończyłby się błędem przy starcie usługi. */
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      /* Warunek sprawdzany PONOWNIE, już pod blokadą zapisu: API i worker to
         dwa procesy startowane razem przez NSSM i oba wołają `migrate()`. */
      if (!trzymaTowar()) return;
      database.exec(`
        CREATE TABLE zadanie_terenowe_nowe (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rodzaj TEXT NOT NULL CHECK (rodzaj IN ('pomiar','zdjecie','weryfikacja','inne')),
          tytul TEXT NOT NULL,
          instrukcja TEXT NOT NULL,
          tw_id INTEGER REFERENCES sgt_towar(tw_id) ON DELETE SET NULL,
          zrodlo TEXT NOT NULL DEFAULT 'reczne',
          zrodlo_ref TEXT,
          priorytet TEXT NOT NULL DEFAULT 'normalny' CHECK (priorytet IN ('normalny','pilny')),
          status TEXT NOT NULL DEFAULT 'nowe' CHECK (status IN ('nowe','w_toku','wykonane','anulowane')),
          utworzono_at TEXT NOT NULL, utworzono_przez TEXT NOT NULL,
          utworzono_user_id INTEGER REFERENCES app_user(user_id),
          przypisano_at TEXT, przypisano_przez TEXT,
          przypisano_user_id INTEGER REFERENCES app_user(user_id),
          wynik TEXT, wykonano_at TEXT, wykonano_przez TEXT,
          wykonano_user_id INTEGER REFERENCES app_user(user_id),
          anulowano_at TEXT, anulowano_przez TEXT,
          conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
          message_id INTEGER REFERENCES message(id) ON DELETE SET NULL
        );
        INSERT INTO zadanie_terenowe_nowe(
          id, rodzaj, tytul, instrukcja, tw_id, zrodlo, zrodlo_ref, priorytet, status,
          utworzono_at, utworzono_przez, utworzono_user_id,
          przypisano_at, przypisano_przez, przypisano_user_id,
          wynik, wykonano_at, wykonano_przez, wykonano_user_id,
          anulowano_at, anulowano_przez, conversation_id, message_id)
        SELECT
          id, rodzaj, tytul, instrukcja, tw_id, zrodlo, zrodlo_ref, priorytet, status,
          utworzono_at, utworzono_przez, utworzono_user_id,
          przypisano_at, przypisano_przez, przypisano_user_id,
          wynik, wykonano_at, wykonano_przez, wykonano_user_id,
          anulowano_at, anulowano_przez, conversation_id, message_id
        FROM zadanie_terenowe;
        DROP TABLE zadanie_terenowe;
        ALTER TABLE zadanie_terenowe_nowe RENAME TO zadanie_terenowe;
      `);
      /* Indeksy giną razem z tabelą, a `schema.sql` odtworzy je dopiero przy
         NASTĘPNYM otwarciu bazy. Do tego czasu kolejka zadań na kolektorze
         skanowałaby całą tabelę, więc stawiamy je tutaj. */
      database.exec(`
        CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_status
          ON zadanie_terenowe(status, priorytet, utworzono_at);
        CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_przypisane
          ON zadanie_terenowe(przypisano_user_id, status);
        CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_towar
          ON zadanie_terenowe(tw_id, utworzono_at);
      `);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}


/**
 * Wątek bez ostatniej wiadomości wchodzi do skrzynki (0.151.0).
 *
 * Schemat `Thread` w specyfikacji Allegro wymaga WYŁĄCZNIE `id` i `read`.
 * `lastMessageDateTime` i `interlocutor` są opcjonalne, a do tego jawnie
 * `nullable`. Nasze `NOT NULL` na obu kolumnach zamieniało więc poprawną
 * odpowiedź Allegro w błąd zapisu — i to nie teoretycznie, bo wątek świeżo
 * założony żadnej ostatniej wiadomości mieć nie może.
 *
 * Kursor synchronizatora porównuje się PARĄ (data, id), więc wątek bez daty
 * nie ma jak w tej parze stanąć — i nie staje, patrz `allegro-inbox-sync.ts`.
 * To osobna sprawa od zapisu i została rozwiązana osobno.
 */
function watekInboxuDopuszczaBrakDaty(database: DatabaseSync) {
  const wymagaDaty = () => (database.prepare(
    "PRAGMA table_info(allegro_inbox_thread)").all() as Array<{ name: string; notnull: number }>)
    .some((k) => k.name === "last_message_at" && k.notnull === 1);
  if (!wymagaDaty()) return;

  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      if (!wymagaDaty()) return;
      database.exec(`
        CREATE TABLE allegro_inbox_thread_nowy (
          id TEXT PRIMARY KEY,
          read INTEGER NOT NULL,
          last_message_at TEXT,
          interlocutor_login TEXT,
          surowe_json TEXT NOT NULL,
          synced_at TEXT NOT NULL
        );
        INSERT INTO allegro_inbox_thread_nowy(
          id, read, last_message_at, interlocutor_login, surowe_json, synced_at)
        SELECT id, read, last_message_at, interlocutor_login, surowe_json, synced_at
        FROM allegro_inbox_thread;
        DROP TABLE allegro_inbox_thread;
        ALTER TABLE allegro_inbox_thread_nowy RENAME TO allegro_inbox_thread;
      `);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Lądowisko skrzynki przestaje opisywać Allegro, którego nie ma (0.151.0).
 *
 * `allegro_inbox_message` miała `author_role NOT NULL` i `read NOT NULL`.
 * Centrum wiadomości nie przysyła ani jednego z tych pól: autora opisuje
 * `author.isInterlocutor`, a stan wiadomości — `status`. Nie miały więc
 * źródła, tylko wartość zmyśloną przy zapisie.
 *
 * To nie jest kosmetyka nazw. Cały kształt odczytu był wymyślony razem
 * z kodem (`lastMessageDate` zamiast `lastMessageDateTime`, `relatedObject`
 * zamiast `relatesTo`), więc synchronizacja NIGDY nie zapisała ani jednego
 * wiersza — każdy wątek wywracał wstawkę na niezwiązanym parametrze. Tabela
 * jest u klienta pusta i przebudowa nic nie kosztuje.
 *
 * Mimo to przebudowa PRZEPISUJE dane zamiast kasować tabelę: gdyby gdzieś
 * stały wiersze z ręcznego eksperymentu, kasowanie zabrałoby też `surowe_json`,
 * czyli jedyny ślad prawdziwej odpowiedzi Allegro. `author_is_interlocutor`
 * wyliczamy ze starej roli (wszystko poza `SELLER` to rozmówca).
 */
function wiadomoscInboxuMaKsztaltAllegro(database: DatabaseSync) {
  const maStaryKsztalt = () => (database.prepare(
    "PRAGMA table_info(allegro_inbox_message)").all() as Array<{ name: string }>)
    .some((k) => k.name === "author_role");
  if (!maStaryKsztalt()) return;

  /* Tak samo jak przy `zadanie_terenowe`: klucze obce schodzą PRZED
     transakcją, bo w transakcji `PRAGMA foreign_keys` jest ignorowane. */
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      /* Ponowne sprawdzenie pod blokadą zapisu — API i worker wołają
         `migrate()` równolegle, bo NSSM startuje je razem. */
      if (!maStaryKsztalt()) return;
      database.exec(`
        CREATE TABLE allegro_inbox_message_nowa (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES allegro_inbox_thread(id) ON DELETE CASCADE,
          author_login TEXT NOT NULL,
          author_is_interlocutor INTEGER NOT NULL,
          text TEXT NOT NULL,
          subject TEXT,
          status TEXT,
          created_at TEXT,
          related_object_type TEXT,
          related_object_id TEXT,
          surowe_json TEXT NOT NULL
        );
        INSERT INTO allegro_inbox_message_nowa(
          id, thread_id, author_login, author_is_interlocutor, text,
          related_object_type, related_object_id, surowe_json)
        SELECT
          id, thread_id, author_login,
          CASE WHEN upper(author_role) = 'SELLER' THEN 0 ELSE 1 END,
          text, related_object_type, related_object_id, surowe_json
        FROM allegro_inbox_message;
        DROP TABLE allegro_inbox_message;
        ALTER TABLE allegro_inbox_message_nowa RENAME TO allegro_inbox_message;
      `);
      /* Indeks ginie razem z tabelą, a `schema.sql` odtworzy go dopiero przy
         następnym otwarciu bazy — do tego czasu każdy odczyt wątku skanowałby
         całą skrzynkę. */
      database.exec(`CREATE INDEX IF NOT EXISTS ix_allegro_inbox_message_thread
        ON allegro_inbox_message(thread_id);`);
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Kasacja obsługi klienta (0.140.0).
 *
 * Rejestry pytań, dyskusji, opinii i zwrotów Allegro oraz nakładka spraw
 * odeszły razem z kodem, który je czytał. Tabela bez czytelnika nie jest
 * archiwum, tylko pułapką: następna osoba czytająca schemat zobaczy model
 * danych, którego nikt nie utrzymuje, i uzna go za obowiązujący.
 *
 * KTO CHCE TYCH LICZB, robi kopię bazy PRZED aktualizacją — mówi o tym
 * DEPLOY.md, a `npm run inwentarz` czyta taką kopię i wypisuje z niej raport.
 *
 * Kolejność kasowania wynika z kluczy obcych: najpierw dzieci. `kosz_pozycja`
 * przebudowujemy, bo jej `zwrot_id` wskazywał na znikającą tabelę — SQLite
 * nie umie skasować kolumny z kluczem obcym inaczej niż przez nową tabelę
 * (ten sam zabieg co przy `zwrotNieobowiazkowyWKoszu` w 0.75.0).
 */
function bezObslugiKlienta(database: DatabaseSync) {
  const maKolumne = (tabela: string, kolumna: string) =>
    (database.prepare(`PRAGMA table_info(${tabela})`).all() as Array<{ name: string }>).some(
      (c) => c.name === kolumna
    );

  /* Klucze obce schodzą PRZED transakcją — w transakcji `PRAGMA foreign_keys`
     jest ignorowane po cichu (ta sama pułapka co przy `naLoginIHaslo`). */
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    transaction(database, () => {
      if (maKolumne("kosz_pozycja", "zwrot_id")) {
        /* Kolumny przepisujemy WSPÓLNE dla obu kształtów: baza klienta bywa
           starsza niż schemat i nie ma wszystkich pól z 0.79.0. */
        const stare = (
          database.prepare("PRAGMA table_info(kosz_pozycja)").all() as Array<{ name: string }>
        ).map((c) => c.name);
        database.exec(`
          CREATE TABLE kosz_pozycja_nowa (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            kosz_id       INTEGER NOT NULL REFERENCES kosz(id),
            tw_id         INTEGER NOT NULL,
            symbol        TEXT NOT NULL,
            nazwa         TEXT NOT NULL,
            ilosc         REAL NOT NULL,
            status        TEXT NOT NULL DEFAULT 'todo',
            lok_faktyczna TEXT,
            odlozono_at   TEXT,
            odlozono_przez TEXT,
            powod         TEXT,
            pominieto_at  TEXT,
            zalatwione_at TEXT,
            zalatwione_przez TEXT,
            zalatwione_notatka TEXT,
            loc_queue_id  INTEGER REFERENCES sfera_queue(id),
            pozniej_at    TEXT,
            mm_queue_id   INTEGER REFERENCES sfera_queue(id)
          );
        `);
        const nowe = (
          database.prepare("PRAGMA table_info(kosz_pozycja_nowa)").all() as Array<{ name: string }>
        ).map((c) => c.name);
        const wspolne = nowe.filter((c) => stare.includes(c)).join(", ");
        database.exec(`
          INSERT INTO kosz_pozycja_nowa(${wspolne}) SELECT ${wspolne} FROM kosz_pozycja;
          DROP TABLE kosz_pozycja;
          ALTER TABLE kosz_pozycja_nowa RENAME TO kosz_pozycja;
          CREATE INDEX IF NOT EXISTS ix_kosz_poz ON kosz_pozycja(kosz_id);
        `);
      }

      /* TE NAZWY SĄ SPALONE NA ZAWSZE. Lista chodzi przy KAŻDEJ migracji, a nie
         raz za znacznikiem — bo bazy klientów wciąż mają te tabele i każda
         musi je stracić. Skutek uboczny: tabela nazwana tak samo powstałaby
         ze `schema.sql` i znikała sekundę później, po cichu i bez błędu,
         bo `migrate()` chodzi PO schemacie.

         Dlatego zwroty wróciły w 0.150.0 jako `zwrot_klienta`, a nie `zwrot`.
         Kto następnym razem wskrzesza read-model sprzedaży, nazywa go
         `sgt_faktura`, nie `sgt_sprzedaz`. Pilnuje tego `db/migracja-zwrotow.test.ts`. */
      for (const tabela of [
        "sprawa_tag", "sprawa_zdarzenie", "sprawa_zrodlo", "sprawa", "regula", "szablon",
        "watek_meta", "opinia", "dyskusja", "dopasowanie", "pytanie", "ai_config",
        "zwrot_zam_pozycja", "zwrot_pozycja", "zwrot_zapowiedz", "zwrot",
        "sgt_sprzedaz_pozycja", "sgt_sprzedaz",
      ]) {
        database.exec(`DROP TABLE IF EXISTS ${tabela}`);
      }
    })();
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
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
/**
 * Uzupełnia `pytanie.kupujacy_id` z maski loginu (0.128.0).
 *
 * Centrum wiadomości oddaje rozmówcę jako `client:44300444`, a liczba spod
 * maski to buyer.id (dowód: test `normalizujRef` i adapter dev). GLOB jest
 * celowo wąski — prawdziwy login nie jest identyfikatorem i lepszy uczciwy
 * NULL niż zgadywanie. Wzorzec `dosypIdKupujacego`: idempotentny UPDATE
 * z warunkiem, try/catch, start serwera ważniejszy niż dosypka.
 */
function dosypIdZMaski(database: DatabaseSync) {
  try {
    database.exec(
      `UPDATE pytanie
          SET kupujacy_id = substr(kupujacy_login, 8)
        WHERE kupujacy_id IS NULL
          AND kupujacy_login GLOB 'client:[0-9]*'`
    );
  } catch {
    /* Pytanie bez identyfikatora dalej łączy się najwyżej po loginie. */
  }
}

/**
 * Uzupełnia `message.related_order_id` z lądowiska (0.166.0).
 *
 * Do 0.165.0 synchronizator mapował z `relatesTo` wyłącznie gałąź `offer`,
 * a `order.id` „zostawał w `surowe_json` do czasu, aż będzie miał ekran".
 * Ekran jest, a wiadomości sprzed tego wydania nie przyjadą drugi raz —
 * `INSERT … DO NOTHING` w synchronizatorze celowo ich nie nadpisuje. Numer
 * siedzi jednak w `allegro_inbox_message.surowe_json`, złączonym po
 * identyfikatorze Allegro, więc dosypujemy go stamtąd raz.
 *
 * Wzorzec `dosypIdKupujacego`: idempotentny UPDATE z warunkiem, `try/catch`,
 * start serwera ważniejszy niż dosypka. Wiadomość bez gałęzi `order` zostaje
 * przy NULL — `json_extract` oddaje wtedy NULL i warunek ją omija.
 */
function dosypZamowienieWiadomosci(database: DatabaseSync) {
  try {
    database.exec(
      `UPDATE message
          SET related_order_id = (
            SELECT json_extract(l.surowe_json, '$.relatesTo.order.id')
              FROM allegro_inbox_message l
             WHERE l.id = message.external_message_id)
        WHERE related_order_id IS NULL
          AND EXISTS (
            SELECT 1 FROM allegro_inbox_message l
             WHERE l.id = message.external_message_id
               AND json_extract(l.surowe_json, '$.relatesTo.order.id') IS NOT NULL)`
    );
  } catch {
    /* Pusto — rozmowa bez numeru zamówienia dalej pokazuje samą ofertę. */
  }
}

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

/** Kolejny numer dokumentu MM (dev; w prod nadaje Subiekt). */
export function nextMmNumber(): string {
  const d = db();
  const row = d
    .prepare("UPDATE counters SET value = value + 1 WHERE name='mm' RETURNING value")
    .get() as { value: number };
  return `${row.value}/07/2026`;
}


/**
 * Zastane dane sprzed granic czasu znikają (0.152.0).
 *
 * Właściciel wyznaczył progi: skrzynka od 1 września 2026, zwroty od 20 lipca
 * 2026. Pierwsza synchronizacja po naprawie mapowania zdążyła wciągnąć całą
 * historię konta, więc w bazie leży to, czego panel ma nie pokazywać.
 *
 * KASUJEMY, a nie ukrywamy zapytaniem. Baza, która trzyma co innego, niż widać
 * na ekranie, to rozjazd — a rozjazd między tym, co jest, a tym, co widać,
 * kosztował w tym repo już kilka wieczorów. Utrata jest zresztą pozorna:
 * przesunięcie progu w `wertis.env` i ponowna synchronizacja sprowadzą te dane
 * z powrotem z Allegro.
 *
 * Bieg PRZY KAŻDYM STARCIE jest celowy, mimo że wygląda na jednorazowy zabieg.
 * Próg jest ustawieniem, więc może się przesunąć w przód — i wtedy baza ma za
 * nim nadążyć bez ręcznego SQL-a. Gdy nic nie wystaje ponad próg, funkcja nie
 * dotyka niczego.
 *
 * Audyt piszemy SUROWYM SQL-em zamiast przez `logEvent`, i to jest wymuszone
 * warstwami: `services/events.ts` importuje ten moduł, więc odwrotny import
 * domknąłby cykl. Ta sama zasada, dla której `odkodujEncje` mieszka
 * w `tekst.ts`, a nie w adapterze.
 */
function sprzatnijSprzedGranicy(database: DatabaseSync) {
  const audyt = (typ: string, ile: number, granica: string) => {
    if (ile === 0) return;
    database.prepare(
      "INSERT INTO events(type, user_id, payload) VALUES (?,?,?)",
    ).run(typ, "migracja", JSON.stringify({ usunieto: ile, granica }));
  };

  const inboxOd = config.allegro.inboxOd;
  if (inboxOd) {
    /* Kolejność ma znaczenie: `message` przed `conversation`, bo rozmowa jest
       rodzicem. Rozmowę kasujemy tylko wtedy, gdy CAŁA jest sprzed progu —
       granica stoi na wątku, więc rozmowa z jedną wrześniową wiadomością
       zostaje razem ze swoim sierpniowym kontekstem. */
    const doKasacji = `SELECT c.id FROM conversation c
      WHERE NOT EXISTS (SELECT 1 FROM message m
        WHERE m.conversation_id = c.id AND m.sent_at >= ?)
        AND c.updated_at < ?`;
    const ile = (database.prepare(
      `SELECT count(*) n FROM (${doKasacji})`).get(inboxOd, inboxOd) as { n: number }).n;
    if (ile > 0) {
      transaction(database, () => {
        database.prepare(
          `DELETE FROM message WHERE conversation_id IN (${doKasacji})`).run(inboxOd, inboxOd);
        database.prepare(`DELETE FROM conversation WHERE id IN (${doKasacji})`).run(inboxOd, inboxOd);
        /* Lądowisko idzie tą samą granicą. Wątek bez daty zostaje: schemat
           Allegro dopuszcza brak `last_message_at`, a `NULL < próg` i tak nie
           jest prawdą w SQLite. */
        database.prepare("DELETE FROM allegro_inbox_thread WHERE last_message_at < ?").run(inboxOd);
      })();
      audyt("inbox.granica.sprzatanie", ile, inboxOd);
    }
  }

  const zwrotyOd = config.allegro.zwrotyOd;
  if (zwrotyOd) {
    const ile = (database.prepare(
      "SELECT count(*) n FROM zwrot_klienta WHERE created_at < ?").get(zwrotyOd) as { n: number }).n;
    if (ile > 0) {
      transaction(database, () => {
        database.prepare("DELETE FROM zwrot_klienta WHERE created_at < ?").run(zwrotyOd);
        database.prepare("DELETE FROM allegro_zwrot WHERE created_at < ?").run(zwrotyOd);
      })();
      audyt("zwroty.granica.sprzatanie", ile, zwrotyOd);
    }
  }
}

/**
 * Encje HTML znikają z wierszy zapisanych przed 0.152.0.
 *
 * Blizna 0.127.0 kupiona drugi raz: `odkodujEncje` czekała gotowa w `tekst.ts`,
 * a mapowanie jej nie wołało, więc `kt&oacute;ry` stał na ekranie dosłownie.
 * Poprawka w synchronizatorze naprawia tylko to, co przyjdzie od teraz — ta
 * migracja bierze to, co już leży.
 *
 * Dotyka WYŁĄCZNIE modelu pracy (`message.body`, `conversation.subject`).
 * Lądowisko `allegro_inbox_*` zostaje surowe, bo taka jest jego rola.
 *
 * Warunek `LIKE '%&%'` nie jest optymalizacją, tylko warunkiem POPRAWNOŚCI:
 * bez niego funkcja przepisywałaby wszystkie wiersze przy każdym starcie, a na
 * tekście już odkodowanym drugi przebieg mógłby zjeść znak `&`, który należał
 * do treści.
 */
function odkodujEncjeWZastanych(database: DatabaseSync) {
  const napraw = (tabela: string, kolumna: string) => {
    const wiersze = database.prepare(
      `SELECT id, ${kolumna} AS v FROM ${tabela} WHERE ${kolumna} LIKE '%&%'`,
    ).all() as Array<{ id: number; v: string }>;
    const zmiany = wiersze
      .map((w) => ({ id: w.id, v: odkodujEncje(w.v) }))
      .filter((w, i) => w.v !== wiersze[i].v);
    if (zmiany.length === 0) return;
    transaction(database, () => {
      const upd = database.prepare(`UPDATE ${tabela} SET ${kolumna}=? WHERE id=?`);
      for (const z of zmiany) upd.run(z.v, z.id);
    })();
  };
  napraw("message", "body");
  napraw("conversation", "subject");
}
