-- ── WERTIS · schemat bazy aplikacji (SQLite) ──────────────────────────────
-- Tabele aplikacji odwzorowują spec §7 (JSONB→TEXT JSON, TIMESTAMPTZ→TEXT ISO,
-- BIGSERIAL→INTEGER PK AUTOINCREMENT). Tabele sgt_* to read-model Subiekta GT —
-- w produkcji pochodzą z MSSQL (SELECT read-only), tu są zasilane z mag.xlsx.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Kolejka zadań dla workera Sfery (spec §7) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sfera_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,                 -- set_location | set_doc_flag | mm (mm: wyłącznie tryb B)
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
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_type ON events(type);

-- ── Read-model Subiekta GT (seed z mag.xlsx; prod = MSSQL) ─────────────────
CREATE TABLE IF NOT EXISTS sgt_magazyn (
  mag_id INTEGER PRIMARY KEY,
  kod    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sgt_towar (
  tw_id       INTEGER PRIMARY KEY,
  symbol      TEXT NOT NULL,
  nazwa       TEXT NOT NULL,
  ean         TEXT,
  unit        TEXT NOT NULL DEFAULT 'szt.',
  ordered     REAL NOT NULL DEFAULT 0,
  opis        TEXT,
  lokalizacja TEXT NOT NULL DEFAULT ''          -- string rozdzielany spacją (wariant B, spec D1)
);
CREATE INDEX IF NOT EXISTS ix_towar_symbol ON sgt_towar(symbol);
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
  w_buforze  INTEGER NOT NULL DEFAULT 0,
  flaga      TEXT                               -- flaga sprawdzenia faktury (§ wywiad)
);

CREATE TABLE IF NOT EXISTS sgt_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_dokument(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pozycja_dok ON sgt_pozycja(dok_id);

-- licznik numeracji MM (dev — w prod nadaje Subiekt)
CREATE TABLE IF NOT EXISTS counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters(name, value) VALUES ('mm', 46);

-- ── Tryb A: rozkładanie dostaw krajowych (redesign v2.0) ────────────────────
-- Jednostką pracy jest DOKUMENT FZ/PZ, nie sesja (D2). Skutek magazynowy niesie
-- sam dokument w Subiekcie (księgowany wprost na MAG), więc aplikacja zapisuje
-- WYŁĄCZNIE lokalizację (D1): żadnego MM, żadnego waiting_for_doc. Dzięki temu
-- można rozkładać dostawę, zanim księgowość zaksięguje FZ (dokument w buforze).
CREATE TABLE IF NOT EXISTS delivery (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sgt_dok_id    INTEGER NOT NULL UNIQUE,
  sgt_dok_numer TEXT NOT NULL,
  dostawca      TEXT,
  data_dok      TEXT,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done | abandoned
  opened_at     TEXT NOT NULL,
  closed_at     TEXT,
  -- Ostatnia flaga wysłana do Subiekta. Służy do dwóch rzeczy: nie kolejkujemy
  -- tego samego stanu w kółko, a rozjazd z sgt_dokument.flaga jest dowodem, że
  -- biuro ustawiło flagę poza aplikacją (i wtedy jego decyzja wygrywa).
  flaga_wyslana TEXT,
  -- Ostatni dotyk człowieka (otwarcie, skan, odłożenie). Odróżnia „ktoś przy tym
  -- stoi TERAZ" od „leży zaczęte" — lock na pojedynczej linii to za wąski sygnał,
  -- bo magazynier jest przy palecie także zanim cokolwiek zeskanuje.
  active_at     TEXT
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
  done_at        TEXT,
  done_by        TEXT,
  -- Przy natłoku jedną dostawę rozkłada kilka osób (TTL w services/locks.ts).
  -- Świeży lock jest zarazem jedynym sygnałem „ktoś pracuje TERAZ", na którym
  -- opiera się flaga „W trakcie sprawdzania".
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
