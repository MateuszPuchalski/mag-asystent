-- ── WERTIS · schemat bazy aplikacji (SQLite) ──────────────────────────────
-- Tabele aplikacji odwzorowują spec §7 (JSONB→TEXT JSON, TIMESTAMPTZ→TEXT ISO,
-- BIGSERIAL→INTEGER PK AUTOINCREMENT). Tabele sgt_* to read-model Subiekta GT —
-- w produkcji pochodzą z MSSQL (SELECT read-only), tu są zasilane z mag.xlsx.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Kolejka zadań dla workera Sfery (spec §7) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sfera_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,                 -- set_location | mm | combo
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

-- ── Inwentaryzacja / kontrola lokalizacji (analiza) ───────────────────────
CREATE TABLE IF NOT EXISTS inventory_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  status     TEXT NOT NULL DEFAULT 'open',   -- open | closed
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at  TEXT
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES inventory_sessions(id),
  location   TEXT NOT NULL,                  -- skanowana lokalizacja
  tw_id      INTEGER NOT NULL,
  expected   INTEGER NOT NULL DEFAULT 1,     -- 1 = wg kartoteki tu być powinno; 0 = nadmiar
  counted    INTEGER,                        -- NULL = niesprawdzone; 1 = obecny; 0 = brak
  note       TEXT
);
CREATE INDEX IF NOT EXISTS ix_inv_session ON inventory_items(session_id);

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
  mag_id     INTEGER NOT NULL,                  -- magazyn skutku (MGP)
  dostawca   TEXT,
  w_buforze  INTEGER NOT NULL DEFAULT 0
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
