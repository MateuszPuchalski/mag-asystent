-- ── WERTIS · schemat bazy aplikacji (SQLite) ──────────────────────────────
-- Tabele aplikacji odwzorowują spec §7 (JSONB→TEXT JSON, TIMESTAMPTZ→TEXT ISO,
-- BIGSERIAL→INTEGER PK AUTOINCREMENT). Tabele sgt_* to read-model Subiekta GT —
-- w produkcji pochodzą z MSSQL (SELECT read-only), tu są zasilane z mag.xlsx.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Kolejka zadań dla workera Sfery (spec §7) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sfera_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,                 -- set_location | mm (mm: wyłącznie tryb B)
  payload        TEXT NOT NULL,                 -- JSON
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|waiting_for_doc|done|error
  attempts       INTEGER NOT NULL DEFAULT 0,
  error_msg      TEXT,
  sgt_doc_number TEXT,                          -- nr MM po utworzeniu (zwrotnie)
  label          TEXT,                          -- etykieta dla kolektora
  detail         TEXT,                          -- opis dla kolektora
  tw_id          INTEGER,                       -- powiązany towar (dla korekty stanów)
  source_doc_id  INTEGER,                       -- dok. źródłowy (waiting_for_doc)
  session_id     INTEGER,                       -- sesja rozkładania (alerty błędów w sesji)
  created_by     TEXT NOT NULL,
  created_by_ref INTEGER,                       -- konto autora; nazwa wyżej to snapshot
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  next_attempt_at TEXT,                         -- backoff / waiting_for_doc
  processed_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_queue_status ON sfera_queue(status, id);
CREATE INDEX IF NOT EXISTS ix_queue_tw ON sfera_queue(tw_id);

-- ── Sesje rozkładania (spec §7) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS putaway_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_doc_id     INTEGER,                    -- dok_Id z SGT; NULL = tryb "całe MGP"
  source_doc_number TEXT,
  source_mag_id     INTEGER,                    -- magazyn źródłowy (NULL = MGP; zwroty = mag Zwroty)
  status            TEXT NOT NULL DEFAULT 'open', -- open|closed|closed_with_deviations
  created_by        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at         TEXT
);

CREATE TABLE IF NOT EXISTS putaway_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER NOT NULL REFERENCES putaway_sessions(id),
  tw_id         INTEGER NOT NULL,
  target_loc    TEXT,                           -- lokalizacja docelowa (snapshot) lub NULL = BRAK LOK
  qty_expected  REAL NOT NULL,                  -- z dokumentu (po agregacji)
  qty_done      REAL NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',-- pending|on_cart|done|partial|skipped
  skip_reason   TEXT,
  locked_by     TEXT,                           -- multi-user lock
  locked_at     TEXT,                           -- TTL 30 min
  off_document  INTEGER NOT NULL DEFAULT 0,     -- dodane spoza dokumentu
  stage_qty     REAL,                           -- ilość na wózku (przed zatwierdzeniem)
  stage_loc     TEXT,                           -- zeskanowana lokalizacja docelowa
  stage_update_loc INTEGER NOT NULL DEFAULT 1   -- czy zapisać lokalizację w kartotece
);
CREATE INDEX IF NOT EXISTS ix_items_session ON putaway_items(session_id);

-- ── Log zdarzeń (audyt — spec §7, §12) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  tw_id      INTEGER,
  payload    TEXT,                              -- JSON
  user_id    TEXT NOT NULL,
  -- Który egzemplarz kolektora — pierwsze pytanie przy diagnozie („to jedno
  -- urządzenie czy wszystkie?"), a bez tego nie do odzyskania po fakcie.
  device_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_type ON events(type);
-- Bez indeksu po czasie każdy raport („ile dotknięć na pozycję w zeszłym
-- tygodniu") skanuje całą tabelę — a events rośnie z każdym skanem.
CREATE INDEX IF NOT EXISTS ix_events_time ON events(created_at);
CREATE INDEX IF NOT EXISTS ix_events_user_time ON events(user_id, created_at);
-- „Co się działo z TYM towarem" to najczęstsze pytanie przy reklamacji, a do
-- sierpnia 2026 `tw_id` nie miało ŻADNEGO indeksu — nawet historia na karcie
-- towaru skanowała całą tabelę, która rośnie z każdym skanem.
CREATE INDEX IF NOT EXISTS ix_events_tw_time ON events(tw_id, created_at);

-- ── Konta pracowników (plan §7) ────────────────────────────────────────────
-- Do lipca 2026 „użytkownik" to był DOWOLNY łańcuch wpisywany ręcznie na
-- kolektorze i wysyłany w nagłówku X-User. Skutek: `events.user_id` zawiera
-- literówki i warianty tej samej osoby (Jan, jan, Jan K, JanK), więc audyt
-- nadawał się tylko do czytania oczami — nie do żadnego zestawienia. Do tego
-- każdy mógł podać się za kogokolwiek jednym wpisem.
--
-- `badge_code` nie niesie nazwiska: badge się gubi i zostaje na kurtce.
-- Powiązanie kod → człowiek żyje wyłącznie tutaj.
CREATE TABLE IF NOT EXISTS app_user (
  user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  badge_code TEXT NOT NULL UNIQUE,               -- PRC-0007-3 (z cyfrą kontrolną)
  name       TEXT NOT NULL,
  -- Tylko dla ról uprzywilejowanych. Badge'e bywają pożyczane; PIN sprawia,
  -- że „ktoś użył mojego badge'a" jest kłamstwem, a nie wymówką.
  pin_hash   TEXT,
  role       TEXT NOT NULL DEFAULT 'magazynier', -- magazynier | brygadzista | biuro
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Sesja urządzenia: skan badge'a → token. Nagłówek `X-User` przestaje być
-- tożsamością (dało się go wpisać ręcznie), a staje się co najwyżej podpowiedzią.
CREATE TABLE IF NOT EXISTS device_session (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES app_user(user_id),
  device_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Ostatnia aktywność. BLOKADA po bezczynności, nigdy wylogowanie: wylogowanie
  -- gubiące 30 rozłożonych pozycji to sposób na aplikację leżącą w szufladzie.
  last_seen  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_session_user ON device_session(user_id);

-- ── Read-model Subiekta GT (seed z mag.xlsx; prod = MSSQL) ─────────────────
CREATE TABLE IF NOT EXISTS sgt_magazyn (
  mag_id INTEGER PRIMARY KEY,
  kod    TEXT NOT NULL,
  nazwa  TEXT NOT NULL DEFAULT ''    -- mag_Nazwa z sl_Magazyn; kod to mag_Symbol
);

CREATE TABLE IF NOT EXISTS sgt_towar (
  tw_id       INTEGER PRIMARY KEY,
  symbol      TEXT NOT NULL,
  nazwa       TEXT NOT NULL,
  ean         TEXT,
  unit        TEXT NOT NULL DEFAULT 'szt.',
  -- MARTWA od 0.7.0. „Zamówione" nie ma prostej kolumny w Subiekcie — pochodzi
  -- z dokumentów ZD — więc importer produkcyjny wpisywał tu 0 na sztywno i kafel
  -- „zam. u dostawcy" nie zapalił się ani razu na prawdziwych danych. Zastąpiona
  -- przez sgt_zamowienie/sgt_zam_pozycja, które działają tak samo w demo i na
  -- produkcji. Kolumna ZOSTAJE, bo DROP COLUMN w SQLite to przepisanie tabeli:
  -- nikt jej już nie czyta ani nie zapisuje.
  ordered     REAL NOT NULL DEFAULT 0,
  opis        TEXT,
  lokalizacja TEXT NOT NULL DEFAULT ''          -- string rozdzielany spacją (wariant B, spec D1)
);
CREATE INDEX IF NOT EXISTS ix_towar_symbol ON sgt_towar(symbol);
-- Szukanie po symbolu jest ZAWSZE bez rozróżniania wielkości liter (skan,
-- zamienniki z opisu), a indeksu z kolatacją BINARY SQLite do takiego
-- porównania nie użyje — bez tej pary każde takie zapytanie to skan kartoteki.
CREATE INDEX IF NOT EXISTS ix_towar_symbol_nocase ON sgt_towar(symbol COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS ix_towar_ean ON sgt_towar(ean);

CREATE TABLE IF NOT EXISTS sgt_stan (
  tw_id    INTEGER NOT NULL,
  mag_id   INTEGER NOT NULL,
  stan     REAL NOT NULL DEFAULT 0,
  stan_rez REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (tw_id, mag_id)
);

CREATE TABLE IF NOT EXISTS sgt_dokument (
  dok_id     INTEGER PRIMARY KEY,
  typ        TEXT NOT NULL,                     -- FZ | PZ
  nr_pelny   TEXT NOT NULL,
  data_wyst  TEXT NOT NULL,                     -- ISO date
  mag_id     INTEGER NOT NULL,                  -- magazyn skutku: MAG (tryb A) | MGP | Zwroty
  dostawca   TEXT,
  w_buforze  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sgt_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_dokument(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL,
  -- Identyfikator WIERSZA faktury w Subiekcie (klucz `dok_Pozycja`).
  --
  -- Potrzebny, bo ten sam towar potrafi stać na fakturze dwa razy — w dwóch
  -- cenach albo z dwóch partii. Dopasowanie po parze (dokument, towar) nie
  -- rozstrzyga wtedy, o który wiersz chodzi, a opis różnic biuro trzyma
  -- właśnie PRZY POZYCJI (patrz docs/subiekt-gt-struktura.md).
  --
  -- Nullowalny celowo: baza bez tej kolumny albo starszy read-model mają dać
  -- NULL, a nie wywrócić import.
  ob_id  INTEGER
);
CREATE INDEX IF NOT EXISTS ix_pozycja_dok ON sgt_pozycja(dok_id);

-- ── Zamówienia do dostawcy (ZD) ────────────────────────────────────────────
-- OSOBNE tabele, a nie kolejny typ w sgt_dokument, i to nie jest kwestia gustu:
-- `listPutawayDocuments` filtruje dokumenty po SAMYM `mag_id`, bez warunku na
-- typ. Zamówienie zapisane obok dostaw wskoczyłoby do zakładki rozkładania jako
-- kontener do rozłożenia. Rozdział tabel czyni tę pomyłkę niemożliwą, zamiast
-- pilnować jej warunkiem, który ktoś kiedyś rozluźni.
CREATE TABLE IF NOT EXISTS sgt_zamowienie (
  dok_id    INTEGER PRIMARY KEY,
  nr_pelny  TEXT NOT NULL,
  data_wyst TEXT NOT NULL,                        -- ISO date
  termin    TEXT,                                 -- NULL gdy kolumna terminu nieskonfigurowana
  dostawca  TEXT,
  status    INTEGER NOT NULL DEFAULT 0            -- surowy dok_Status, do diagnostyki
);

CREATE TABLE IF NOT EXISTS sgt_zam_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_zamowienie(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL,                           -- zamówiona
  zreal  REAL NOT NULL DEFAULT 0                  -- zrealizowana; 0 gdy baza nie ma tej kolumny
);
-- Karta towaru odświeża się co 2 s z każdego otwartego ekranu, a pyta właśnie
-- po towarze — bez tego indeksu każde odświeżenie skanuje wszystkie pozycje.
CREATE INDEX IF NOT EXISTS ix_zam_poz_tw ON sgt_zam_pozycja(tw_id);

-- licznik numeracji MM (dev — w prod nadaje Subiekt)
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters(name, value) VALUES ('mm', 46);

-- ── Tryb A: rozkładanie dostaw krajowych i zwrotów (redesign v2.0) ──────────
-- Jednostką pracy jest DOKUMENT, nie sesja (D2). Przy dostawie krajowej skutek
-- magazynowy niesie sam dokument w Subiekcie (księgowany wprost na MAG), więc
-- aplikacja zapisuje WYŁĄCZNIE lokalizację (D1): żadnego MM, żadnego
-- waiting_for_doc. Dzięki temu można rozkładać dostawę, zanim księgowość
-- zaksięguje FZ (dokument w buforze).
CREATE TABLE IF NOT EXISTS delivery (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sgt_dok_id    INTEGER NOT NULL UNIQUE,
  sgt_dok_numer TEXT NOT NULL,
  dostawca      TEXT,
  data_dok      TEXT,
  -- `abandoned` zostaje w słowniku wartości dla wierszy historycznych: ustawiał
  -- go mechanizm flagi faktury, którego już nie ma. Nowe dostawy chodzą
  -- wyłącznie open → done.
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done | (abandoned: historyczne)
  opened_at     TEXT NOT NULL,
  closed_at     TEXT,
  -- Magazyn skutku dokumentu (snapshot z chwili otwarcia).
  source_mag_id INTEGER
);

-- Postęp per linia (D4): zapis natychmiastowy, przerwanie pracy nic nie kosztuje.
CREATE TABLE IF NOT EXISTS delivery_line (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id    INTEGER NOT NULL REFERENCES delivery(id),
  tw_id          INTEGER NOT NULL,
  tw_symbol      TEXT NOT NULL,
  tw_nazwa       TEXT NOT NULL,
  ilosc_dok      REAL NOT NULL,                 -- snapshot z FZ w chwili otwarcia
  ilosc_odlozona REAL NOT NULL DEFAULT 0,
  lok_oczekiwana TEXT,                          -- tw_Lokalizacja w chwili otwarcia
  lok_faktyczna  TEXT,                          -- zeskanowana (fakt, nie intencja — D3)
  status         TEXT NOT NULL DEFAULT 'todo',  -- todo | done | partial | problem | skipped
  -- JSON: identyfikatory pozycji faktury składających się na tę linię, rosnąco.
  -- LISTA, nie jedna wartość, bo openDelivery agreguje ten sam towar z kilku
  -- wierszy dokumentu w jedną linię roboczą.
  sgt_pozycje    TEXT,
  done_at        TEXT,
  done_by        TEXT,
  -- Przy natłoku jedną dostawę rozkłada kilka osób (TTL w services/locks.ts).
  locked_by      TEXT,
  locked_at      TEXT
);
CREATE INDEX IF NOT EXISTS ix_dline_delivery ON delivery_line(delivery_id);
CREATE INDEX IF NOT EXISTS ix_dline_tw ON delivery_line(delivery_id, tw_id);

-- ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
-- Bez tego nie da się zmierzyć, ile kosztują. Typy zamknięte (§4.6); zdjęcie
-- obowiązkowe przy `damaged` / `wrong_item` / `unknown_barcode` — egzekwowane
-- w serwisie, bo to reguła domenowa, nie schematu.
CREATE TABLE IF NOT EXISTS problem (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id   INTEGER REFERENCES delivery(id),
  line_id       INTEGER REFERENCES delivery_line(id),
  typ           TEXT NOT NULL,      -- qty_short|qty_over|damaged|wrong_item|no_space|unknown_barcode|ean_conflict
  ilosc         REAL,
  opis          TEXT,
  foto_ref      TEXT,               -- nazwa pliku w data/photos
  created_at    TEXT NOT NULL,
  created_by    TEXT,
  resolved_at   TEXT,
  resolved_note TEXT
);
CREATE INDEX IF NOT EXISTS ix_problem_delivery ON problem(delivery_id);
-- lista „nierozwiązane" jest odpytywana przy każdym starcie aplikacji
CREATE INDEX IF NOT EXISTS ix_problem_unresolved ON problem(resolved_at);

-- Kolizje kodów kreskowych — raport dla biura. Aplikacja staje się instrumentem
-- pomiaru jakości danych, a nie tylko ich konsumentem (§4.5).
CREATE TABLE IF NOT EXISTS ean_conflict (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ean           TEXT NOT NULL,
  tw_ids        TEXT NOT NULL,      -- JSON array (SQLite nie ma INTEGER[])
  wybrany_tw_id INTEGER,
  auto          INTEGER NOT NULL DEFAULT 0,
  seen_at       TEXT NOT NULL,
  context       TEXT                -- 'przyjecie' | 'zmiana_lokalizacji' | 'podglad'
);
CREATE INDEX IF NOT EXISTS ix_ean_conflict_ean ON ean_conflict(ean);

-- Meldunek procesu (API i worker). POWSTAŁO, ŻEBY ROZJAZD KONFIGURACJI DAŁ SIĘ
-- ZOBACZYĆ. API i worker to osobne procesy; worker bez SGT_MODE=mssql pisze do
-- lokalnej bazy i ZGŁASZA SUKCES, więc awaria nie ma żadnego objawu. Zalecana
-- w dokumentacji weryfikacja `curl /api/health` nie mogła tego wykryć, bo
-- raportowała wyłącznie proces API. Teraz każdy proces melduje swój tryb tutaj,
-- a /api/health je porównuje.
CREATE TABLE IF NOT EXISTS process_state (
  name       TEXT PRIMARY KEY,   -- 'api' | 'worker'
  pid        INTEGER NOT NULL,
  sgt_mode   TEXT NOT NULL,
  sfera_mode TEXT NOT NULL,
  at         TEXT NOT NULL       -- ISO UTC, odświeżane w pętli
);

-- Widoczność magazynów na karcie towaru. OSOBNA tabela, nie kolumna
-- w `sgt_magazyn`, i to jest tu sedno: `sgt_*` to lustro Subiekta czyszczone
-- w całości przy każdym imporcie (co MSSQL_SYNC_MS, domyślnie 60 s). Flaga
-- trzymana tam znikałaby co minutę, a objawem byłoby „ukrywanie nie działa".
-- Ta tabela należy do aplikacji i importu nie dotyka.
--
-- Brak wiersza = magazyn widoczny. Zapisujemy więc tylko ukryte, dzięki czemu
-- magazyn dodany w Subiekcie pojawia się sam, bez żadnej akcji biura.
CREATE TABLE IF NOT EXISTS magazyn_widocznosc (
  mag_id INTEGER PRIMARY KEY,
  ukryty INTEGER NOT NULL DEFAULT 0,
  at     TEXT,                      -- kiedy ukryto (do audytu)
  przez  TEXT                       -- kto ukrył
);
