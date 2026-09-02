-- ── WERTIS · schemat bazy aplikacji (SQLite) ──────────────────────────────
-- Tabele aplikacji odwzorowują spec §7 (JSONB→TEXT JSON, TIMESTAMPTZ→TEXT ISO,
-- BIGSERIAL→INTEGER PK AUTOINCREMENT). Tabele sgt_* to read-model Subiekta GT —
-- w produkcji pochodzą z MSSQL (SELECT read-only), tu są zasilane z mag.xlsx.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Kolejka zadań dla workera Sfery (spec §7) ─────────────────────────────
CREATE TABLE IF NOT EXISTS sfera_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  type           TEXT NOT NULL,                 -- set_location | mm (przesunięcie stanu)
  payload        TEXT NOT NULL,                 -- JSON
  status         TEXT NOT NULL DEFAULT 'pending', -- pending|processing|waiting_for_doc|done|error|cancelled
  attempts       INTEGER NOT NULL DEFAULT 0,
  error_msg      TEXT,
  sgt_doc_number TEXT,                          -- nr dokumentu po utworzeniu (zwrotnie)
  -- Zadanie, które tworzy WIĘCEJ NIŻ JEDEN dokument, nie mieści się w jednej
  -- kolumnie z numerem. `korekta_zwrot` wystawia korektę i MM naraz, a karta
  -- zwrotu pokazuje oba numery — stąd wynik strukturalny obok. JSON, jak
  -- `payload`: kształt zależy od typu zadania i nie jest niczyim kluczem.
  wynik_json     TEXT,
  label          TEXT,                          -- etykieta dla kolektora
  detail         TEXT,                          -- opis dla kolektora
  tw_id          INTEGER,                       -- powiązany towar (dla korekty stanów)
  source_doc_id  INTEGER,                       -- dok. źródłowy (waiting_for_doc)
  created_by     TEXT NOT NULL,
  created_by_ref INTEGER,                       -- konto autora; nazwa wyżej to snapshot
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  next_attempt_at TEXT,                         -- backoff / waiting_for_doc
  processed_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_queue_status ON sfera_queue(status, id);
CREATE INDEX IF NOT EXISTS ix_queue_tw ON sfera_queue(tw_id);
-- korekty stanów i lokalizacji filtrują po typie zadania przy każdym
-- odświeżeniu karty (co 2 s) — bez indeksu to pełny skan kolejki
CREATE INDEX IF NOT EXISTS ix_queue_type_status ON sfera_queue(type, status);

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

-- ── Rozmowy wielokanałowe ────────────────────────────────────────────────
-- Konto jest osobnym korzeniem modelu. Nie utożsamiamy kanału „allegro"
-- z kontem, bo jedna firma może podłączyć kilka kont tego kanału.
CREATE TABLE IF NOT EXISTS channel_account (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  channel             TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  display_name        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(channel, external_account_id)
);

CREATE TABLE IF NOT EXISTS conversation (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id       INTEGER NOT NULL REFERENCES channel_account(id),
  external_conversation_id TEXT NOT NULL,
  subject                  TEXT,
  assigned_user_id         INTEGER REFERENCES app_user(user_id),
  version                  INTEGER NOT NULL DEFAULT 1,
  -- Flaga „nieprzeczytana" pochodzi z Allegro, nie z naszego stanu. Kanał wie,
  -- czy sprzedawca odpisał; my tylko odzwierciedlamy to, co widzi klient.
  unread                   INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Status rozmowy (§7 projektu panelu, 0.158.0). Do tego wydania kolumny nie
  -- było wcale: kolejka nie odróżniała sprawy załatwionej od nietkniętej.
  -- Lista jest ZAMKNIĘTA i pochodzi wprost z §7, a `CHECK` jest tu strażnikiem
  -- projektu: status spoza niej znaczyłby, że ktoś dołożył pojęcie, którego
  -- dokument nie zna. Ten sam warunek stoi w migracji `db.ts`.
  status                   TEXT NOT NULL DEFAULT 'new' CHECK(status IN
    ('new','open','waiting_for_customer','waiting_for_internal','snoozed',
     'resolved','closed','spam')),
  -- Do kiedy odłożona. Osobno od statusu, bo `snoozed` bez terminu byłby
  -- stanem, z którego nic nie wyprowadza — §7 nie zna „odłożonej na zawsze".
  snoozed_until            TEXT,
  UNIQUE(channel_account_id, external_conversation_id)
);

CREATE TABLE IF NOT EXISTS message (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id    INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_message_id TEXT NOT NULL,
  direction          TEXT NOT NULL CHECK(direction IN ('incoming', 'outgoing')),
  body               TEXT NOT NULL,
  -- Powiązanie wiadomości z ofertą kanału. Bez tych dwóch kolumn model
  -- kanoniczny nie wystarcza do obsługi rozmowy i trzeba by zaglądać do
  -- surowego lądowiska — a wtedy `conversation`/`message` nie byłyby modelem.
  related_object_type TEXT,
  related_object_id   TEXT,
  sent_at             TEXT NOT NULL,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Ponowne pobranie tej samej strony kanału ma skończyć się konfliktem,
  -- który importer zamienia na no-op, a nie drugim wierszem wiadomości.
  UNIQUE(channel_account_id, external_message_id)
);
CREATE INDEX IF NOT EXISTS ix_message_conversation ON message(conversation_id, sent_at);

-- ── Sprawa: jeden problem klienta ponad rozmowami (§6.1, 0.161.0) ──────────
-- Nazwa ma DWA powody i oba są blizną.
--
-- Nie `case`, choć tak nazywa ją §15 projektu: `case` jest słowem kluczowym
-- SQLite i każde zapytanie musiałoby ją cytować. Dokument dostaje nazwę
-- z kodu, nie odwrotnie — tak samo rozstrzyga to jego własna preambuła.
--
-- Nie samo `sprawa`, bo tę tabelę `migrate()` KASUJE: stoi na liście nakładek
-- po starej implementacji, którą każda baza klienta musi stracić. Tabela
-- nazwana tak samo powstałaby ze `schema.sql` i znikała sekundę później,
-- po cichu i bez błędu, bo `migrate()` chodzi PO schemacie. Ten sam powód
-- dał w 0.150.0 `zwrot_klienta` zamiast `zwrot`.
--
-- Sprawa NIE MA własnego statusu ani osi. §7 nie zna statusów sprawy, a blizna
-- z 0.130.0 mówi wprost: zdarzenia wiszą przy ŹRÓDLE, nie przy sprawie —
-- historia sklejona z rozmów ginęła przy pierwszym rozklejeniu. Sprawa jest
-- tu WYŁĄCZNIE klamrą: tytułem i listą rozmów.
CREATE TABLE IF NOT EXISTS sprawa_klienta (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tytul        TEXT NOT NULL,
  utworzyl     INTEGER REFERENCES app_user(user_id),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rozmowa należy do CO NAJWYŻEJ JEDNEJ sprawy — stąd `conversation_id` jako
-- klucz główny, a nie para. Poprzednia odpowiedź o tym samym kształcie
-- kosztowała cztery tabele nakładki oraz ręczne SCAL i ROZKLEJ
-- (`docs/obsluga-klienta.md`, pytanie 1). Jedna kolumna z kluczem obcym
-- zamyka tę drogę: sklejenie to jeden wiersz, rozklejenie to jego skasowanie.
CREATE TABLE IF NOT EXISTS sprawa_klienta_rozmowa (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  sprawa_id       INTEGER NOT NULL REFERENCES sprawa_klienta(id) ON DELETE CASCADE,
  dolaczyl        INTEGER REFERENCES app_user(user_id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sprawa_klienta_rozmowa_sprawa ON sprawa_klienta_rozmowa(sprawa_id);

CREATE TABLE IF NOT EXISTS conversation_event (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  message_id      INTEGER REFERENCES message(id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  payload         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_conversation_event_time
  ON conversation_event(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS conversation_assignment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  assigned_to     INTEGER NOT NULL REFERENCES app_user(user_id),
  assigned_by     INTEGER REFERENCES app_user(user_id),
  assigned_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  unassigned_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_conversation_assignment
  ON conversation_assignment(conversation_id, unassigned_at);

-- Szkic jest współdzielonym dokumentem z kontrolą optymistyczną. Punkt
-- odniesienia do ostatniej wiadomości chroni również przed wysłaniem szkicu,
-- który zestarzał się, gdy klient dopisał kolejną wiadomość.
CREATE TABLE IF NOT EXISTS conversation_draft (
  conversation_id          INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  body                     TEXT NOT NULL,
  expected_last_message_id INTEGER REFERENCES message(id) ON DELETE SET NULL,
  version                  INTEGER NOT NULL DEFAULT 1,
  updated_by               INTEGER NOT NULL REFERENCES app_user(user_id),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Komentarz wewnętrzny nie jest wiadomością kanału. Osobna tabela jest
-- fizyczną granicą bezpieczeństwa: adapter Allegro czyta wyłącznie message.
CREATE TABLE IF NOT EXISTS conversation_comment (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  author_user_id  INTEGER NOT NULL REFERENCES app_user(user_id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_conversation_comment_time
  ON conversation_comment(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS conversation_mention (
  comment_id INTEGER NOT NULL REFERENCES conversation_comment(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES app_user(user_id),
  -- Kiedy wzmiankowany ją ODHACZYŁ (0.160.0). NULL znaczy „jeszcze czeka".
  -- Znacznik jest PER PARA: dwie osoby wzmiankowane w jednym komentarzu
  -- odhaczają go niezależnie, bo każda ma z nim inną sprawę do załatwienia.
  -- Odhaczenie jest JAWNYM kliknięciem, nie skutkiem otwarcia listy —
  -- reguła „zero zapisu przy patrzeniu" obowiązuje też tutaj, a wzmianka
  -- kasowana samym spojrzeniem gubiłaby się dokładnie wtedy, gdy agent
  -- przewija listę w biegu.
  seen_at    TEXT,
  PRIMARY KEY(comment_id, user_id)
);
-- Indeks po (user_id, seen_at) zakłada MIGRACJA, nie ten plik: `schema.sql`
-- wykonuje się PRZED nią, a na bazie sprzed 0.160.0 kolumny `seen_at` jeszcze
-- wtedy nie ma i `CREATE INDEX` wywróciłby start serwera.

-- ── Konta pracowników (plan §7) ────────────────────────────────────────────
-- Do lipca 2026 „użytkownik" to był DOWOLNY łańcuch wpisywany ręcznie na
-- kolektorze i wysyłany w nagłówku X-User. Skutek: `events.user_id` zawiera
-- literówki i warianty tej samej osoby (Jan, jan, Jan K, JanK), więc audyt
-- nadawał się tylko do czytania oczami — nie do żadnego zestawienia. Do tego
-- każdy mógł podać się za kogokolwiek jednym wpisem.
--
-- Wejście to LOGIN I HASŁO — ten sam wzorzec, co reszta systemów w firmie.
-- Wcześniej był nim skan plakietki; wyszedł w 0.20.0 razem z PIN-em.
-- ── Kolejka wysyłek (0.148.0) ──────────────────────────────────────────────
-- Jeden wiersz na PRÓBĘ wysyłki, nie na wysłaną wiadomość. Bez tego rozdziału
-- niejednoznaczny timeout nie ma gdzie zostać: żądanie poszło, odpowiedź nie
-- wróciła, a `message` mówiłby albo „wysłano", albo nic — obie odpowiedzi
-- nieprawdziwe.
--
-- `CHECK` na statusie stoi od razu z pełnym zbiorem z §7 projektu panelu.
-- Rozszerzanie CHECK w SQLite wymaga przebudowy tabeli (blizna 0.135.0),
-- więc dokładanie wartości po jednej kosztowałoby migrację za każdym razem.
CREATE TABLE IF NOT EXISTS outbox (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id          INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  -- Klucz wylicza SERWER z rozmowy, ostatniej wiadomości i treści. Gdyby
  -- podawał go klient, podwójne kliknięcie z dwiema zakładkami dałoby dwa
  -- klucze i dwie odpowiedzi u klienta.
  idempotency_key          TEXT NOT NULL UNIQUE,
  body                     TEXT NOT NULL,
  expected_version         INTEGER NOT NULL,
  expected_last_message_id INTEGER REFERENCES message(id) ON DELETE SET NULL,
  status                   TEXT NOT NULL
    CHECK (status IN ('sending','sent','send_uncertain','send_failed')),
  -- Numer nadany przez Allegro. Po niejednoznacznym timeoucie zostaje pusty
  -- i dopiero synchronizacja rozstrzyga, czy odpowiedź tam jest.
  external_message_id      TEXT,
  blad                     TEXT,
  created_by               INTEGER NOT NULL REFERENCES app_user(user_id),
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at              TEXT
);
CREATE INDEX IF NOT EXISTS ix_outbox_rozmowa ON outbox(conversation_id, id);

CREATE TABLE IF NOT EXISTS app_user (
  user_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  -- NULL jest stanem prawidłowym i celowym: konto-ślad. Powstaje przy migracji
  -- historii (`events.user_id` → konto) i po przejściu z plakietek. Ma na co
  -- wskazywać audyt, ale nie ma czym się zalogować — i tak ma zostać.
  login      TEXT UNIQUE,
  -- scrypt, sól per konto, format `sol_hex:hash_hex`. NULL = konto nie loguje się.
  haslo_hash TEXT,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'magazynier', -- magazynier | biuro | admin
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Sesja urządzenia: login i hasło → token. Nagłówek `X-User` przestaje być
-- tożsamością (dało się go wpisać ręcznie), a staje się co najwyżej podpowiedzią.
CREATE TABLE IF NOT EXISTS device_session (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES app_user(user_id),
  device_id  TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Ostatnia aktywność. NICZEGO NIE BRAMKUJE od czasu usunięcia blokady po
  -- bezczynności — jest jedynym śladem, kiedy dany kolektor się odezwał, i tyle.
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
  -- Identyfikator kontrahenta z Subiekta. Po nim, a nie po nazwie, przypina
  -- się logo dostawcy (0.56.0): symbol wolno w Subiekcie poprawić, a ta sama
  -- firma potrafi wystąpić pod dwoma napisami. NULL = dokument bez płatnika.
  kh_id      INTEGER,
  w_buforze  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sgt_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_dokument(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pozycja_dok ON sgt_pozycja(dok_id);
-- karta towaru pyta „na których dokumentach stoi TEN towar" (dostawy-towaru)
CREATE INDEX IF NOT EXISTS ix_pozycja_tw ON sgt_pozycja(tw_id);

-- ── Zamówienia do dostawcy (ZD) ────────────────────────────────────────────
-- OSOBNE tabele, a nie kolejny typ w sgt_dokument, i to nie jest kwestia gustu.
-- Zamówienie do dostawcy nie jest dostawą: zapisane obok niej zależałoby od
-- tego, czy filtr listy rozkładania akurat pyta o typ dokumentu. Rozdział tabel
-- czyni tę pomyłkę niemożliwą, zamiast pilnować jej warunkiem, który ktoś
-- kiedyś rozluźni.
CREATE TABLE IF NOT EXISTS sgt_zamowienie (
  dok_id    INTEGER PRIMARY KEY,
  nr_pelny  TEXT NOT NULL,
  data_wyst TEXT NOT NULL,                        -- ISO date
  termin    TEXT,                                 -- NULL gdy kolumna terminu nieskonfigurowana
  dostawca  TEXT
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
-- licznik kodów kartonów (0.122.0). Jedyny licznik, który liczy NA SERIO
-- i w produkcji: karton nie ma dokumentu w Subiekcie, więc numeru nie ma mu
-- kto nadać poza aplikacją. `OR IGNORE` obsługuje bazę nową i zastaną naraz,
-- bo schemat wykonuje się przy każdym starcie.
INSERT OR IGNORE INTO counters(name, value) VALUES ('karton', 0);

-- ── Rozkładanie dostaw (redesign v2.0) ─────────────────────────────────────
-- Jednostką pracy jest DOKUMENT, nie sesja (D2). Rozkładanie zapisuje WYŁĄCZNIE
-- lokalizację (D1): żadnego MM, żadnego waiting_for_doc. Dzięki temu można
-- rozkładać dostawę, zanim księgowość zaksięguje FZ (dokument w buforze).
--
-- Dostawa krajowa księguje się wprost na MAG, więc po odłożeniu nie zostaje nic.
-- Kontener księguje się na MGP i po odłożeniu adresów wymaga jeszcze
-- PRZESUNIĘCIA STANU na halę — to osobna czynność (services/przesuniecie.ts),
-- a nie inny tryb rozkładania. `source_mag_id` niżej jest tym, co je odróżnia.
CREATE TABLE IF NOT EXISTS delivery (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sgt_dok_id    INTEGER NOT NULL UNIQUE,
  sgt_dok_numer TEXT NOT NULL,
  dostawca      TEXT,
  data_dok      TEXT,
  -- `abandoned` zostaje w słowniku wartości dla wierszy historycznych: ustawiał
  -- go mechanizm flagi faktury, którego już nie ma. Nowe dostawy chodzą
  -- open → done albo open → external.
  --
  -- `external` = ROZŁOŻONE POZA WERTIS. Osobna wartość, nie `done`, i to jest
  -- sedno: `done` znaczy „ludzie odłożyli to tutaj, mamy z tego skany", a tego
  -- o takiej dostawie powiedzieć nie można. Jedna wartość na oba stany kazałaby
  -- czytać raporty odłożeń jako pracę, której nikt nie wykonał w tej aplikacji.
  status        TEXT NOT NULL DEFAULT 'open',   -- open | done | external | (abandoned: historyczne)
  opened_at     TEXT NOT NULL,
  closed_at     TEXT,
  -- Kto i dlaczego zamknął dostawę poza WERTIS. Powód jest WYMAGANY przy
  -- zapisie: to jedyna operacja, która zdejmuje pracę z listy bez ani jednego
  -- skanu, więc pole „dlaczego" jest tu całym dowodem.
  closed_by     TEXT,
  powod_zamkniecia TEXT,
  -- Magazyn skutku dokumentu (snapshot z chwili otwarcia).
  source_mag_id INTEGER,
  -- Przesyłka (formularz „Niezgodność w dostawie", kategoria uszkodzeń
  -- w transporcie). Numer i odpowiedź o protokole kuriera dotyczą CAŁEJ
  -- paczki, nie pojedynczego artykułu — wpisane przy każdym uszkodzonym
  -- towarze z osobna mogłyby się różnić, a to jedna paczka.
  --
  -- ZAŁOŻENIE, nie fakt: jedna faktura przyjeżdża jedną paczką. Gdy okaże się
  -- fałszywe, drogą jest tabela `delivery_parcel` i `problem.parcel_id`.
  nr_przesylki  TEXT,
  kurier_protokol TEXT,             -- tak | nie | NULL (nie pytano)
  przesylka_at  TEXT,
  przesylka_by  TEXT
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
  done_by        TEXT
);
CREATE INDEX IF NOT EXISTS ix_dline_delivery ON delivery_line(delivery_id);
CREATE INDEX IF NOT EXISTS ix_dline_tw ON delivery_line(delivery_id, tw_id);

-- ── Notatki biura do dostawy (0.43.0) ──────────────────────────────────────
-- Dostawca dosyła czasem brak, którego NIE MA na fakturze — biuro wie o tym
-- z rozmowy albo z maila, a rozkładający nie ma tego skąd wiedzieć. Do 0.43.0
-- jedyną drogą było „powiedz Krzyśkowi, jak przyjdzie", czyli kanał, który
-- gubi się przy zmianie i nie zostawia śladu.
--
-- Klucz to `sgt_dok_id`, a NIE `delivery_id`, i to jest cała różnica: biuro
-- pisze notatkę, zanim ktokolwiek otworzy rozkładanie, więc lokalnego wiersza
-- dostawy zwykle jeszcze nie ma. Wiązanie przez dokument znaczy też, że
-- notatka przeżywa cofnięcie zamknięcia „poza WERTIS" i ponowne otwarcie.
--
-- ODPOWIEDŹ JEST OBOWIĄZKOWA. Dopóki `odpowiedz` jest NULL, dostawa się nie
-- domyka — ani ręcznie, ani sama po ostatniej pozycji. Pytanie bez wymuszonej
-- odpowiedzi wraca do punktu wyjścia: ktoś je przeczyta i pójdzie dalej.
CREATE TABLE IF NOT EXISTS delivery_note (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sgt_dok_id INTEGER NOT NULL,
  tresc      TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  -- NULL = nikt jeszcze nie odpowiedział; to ta wartość trzyma dostawę otwartą
  odpowiedz  TEXT,
  odp_at     TEXT,
  odp_by     TEXT,
  -- NULL = biuro jeszcze nie widziało odpowiedzi (0.57.0). Stan trzymamy
  -- W BAZIE, nie w przeglądarce: biuro to dwa biurka, a licznik z localStorage
  -- pokazywałby każdemu co innego i wracałby po wyczyszczeniu przeglądarki.
  odp_widziana_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_note_dok ON delivery_note(sgt_dok_id);
-- lista „czeka na odpowiedź" jest odpytywana przy każdym domknięciu dostawy
CREATE INDEX IF NOT EXISTS ix_note_otwarte ON delivery_note(sgt_dok_id, odpowiedz);

-- ── Faza 2: wyjątki jako obiekt pierwszej klasy (D8) ────────────────────────
-- Bez tego nie da się zmierzyć, ile kosztują. Kategorie zamknięte — od 0.21.0
-- są to DOSŁOWNIE kategorie firmowego formularza „Niezgodność w dostawie",
-- żeby biuro przepisywało gotowe wiersze, a nie dopytywało z pamięci.
-- Zdjęcie obowiązkowe przy `damaged` i `wrong_item` — egzekwowane w serwisie,
-- bo to reguła domenowa, nie schematu.
CREATE TABLE IF NOT EXISTS problem (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id   INTEGER REFERENCES delivery(id),
  -- Linia dokumentu, której wyjątek dotyczy. NULL przy artykule, którego na
  -- dokumencie NIE MA — wtedy numer katalogowy trzyma `sym_obcy`.
  line_id       INTEGER REFERENCES delivery_line(id),
  typ           TEXT NOT NULL,      -- wrong_item|missing_item|damaged|qty_mismatch|extra_item (+ historyczne)
  ilosc         REAL,               -- ilość faktyczna, której dotyczy zgłoszenie
  -- Numer katalogowy artykułu spoza dokumentu: co PRZYSZŁO przy `wrong_item`,
  -- co przyjechało nadto przy `extra_item`. Do 0.21.0 takiego towaru nie dało
  -- się zgłosić w ogóle — skan kończył się toastem „nie jest w tym dokumencie".
  sym_obcy      TEXT,
  -- Ile miało przyjść tego, co zamówiono, a nie dostarczono (`wrong_item`).
  -- Symbol tego artykułu wynika z `line_id`, więc nie ma go tu drugi raz.
  zamiast_ilosc REAL,
  -- Ilość z dokumentu w CHWILI ZGŁOSZENIA. Snapshot, nie odczyt: dokument
  -- w Subiekcie da się poprawić, a protokół ma pokazywać, co widzieliśmy.
  ilosc_dok     REAL,
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
  auto          INTEGER NOT NULL DEFAULT 0,
  seen_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ean_conflict_ean ON ean_conflict(ean);

-- ── Kody kreskowe nadane w WERTIS (0.37.0) ────────────────────────────────
-- Magazynier trzyma karton, na kartonie jest kod, a kartoteka go nie ma — do
-- 0.37.0 jedynym wyjściem było „zapamiętaj i powiedz biuru", czyli nic.
--
-- Kod ląduje TUTAJ od razu i dopiero potem, przez kolejkę, w Subiekcie. Ta
-- kolejność jest celowa: zapis do Subiekta bywa opóźniony (worker), a bywa
-- NIEMOŻLIWY (brak GRANT-u na tw_PodstKodKresk). W obu przypadkach skan ma
-- działać na kolektorze natychmiast, bo to jest jedyny powód, dla którego ktoś
-- ten kod w ogóle nadał.
--
-- TABELA NIE JEST CZĘŚCIĄ READ-MODELU i nie wolno jej dopisać do listy
-- kasowanej przy imporcie (`subiekt.mssql.ts`) — import zaorałby dokładnie tę
-- wiedzę, której Subiekt jeszcze nie ma.
--
-- `ean` jest kluczem GŁÓWNYM, bo jeden kod ma wskazywać jedną kartotekę.
-- Alias wskazujący na dwie odtworzyłby kolizję (§4.5), przed którą chroni
-- odmowa zapisu — tu pilnuje tego baza, a nie tylko kod.
CREATE TABLE IF NOT EXISTS ean_alias (
  ean        TEXT PRIMARY KEY,
  tw_id      INTEGER NOT NULL,
  -- kod stojący na kartotece PRZED podmianą; NULL = pole było puste
  ean_przed  TEXT,
  -- zadanie, które niesie ten kod do Subiekta; po nim idzie diagnoza „czemu
  -- Subiekt dalej go nie ma"
  queue_id   INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ean_alias_tw ON ean_alias(tw_id);

-- Meldunek procesu (API i worker). POWSTAŁO, ŻEBY ROZJAZD KONFIGURACJI DAŁ SIĘ
-- ZOBACZYĆ. API i worker to osobne procesy; worker bez SGT_MODE=mssql pisze do
-- lokalnej bazy i ZGŁASZA SUKCES, więc awaria nie ma żadnego objawu. Zalecana
-- w dokumentacji weryfikacja `curl /api/health` nie mogła tego wykryć, bo
-- raportowała wyłącznie proces API. Teraz każdy proces melduje swój tryb tutaj,
-- a /api/health je porównuje.
-- ── Cache zdjęć kartotek (0.30.0) ─────────────────────────────────────────
-- NIE jest częścią read-modelu sgt_* i dlatego NIE stoi na liście kasowanej
-- przy imporcie (subiekt.mssql.ts): wpis musi przeżyć synchronizację, bo jego
-- jedynym zadaniem jest sprawić, żeby blob NIE jechał z bazy Subiekta drugi raz.
--
-- `plik IS NULL AND blad IS NULL` znaczy POTWIERDZONY BRAK zdjęcia i to jest
-- stan trzeci, nie brak wpisu. Bez niego kartoteki bez zdjęcia — a jest ich
-- sporo — pytałyby Subiekta przy każdym otwarciu karty.
CREATE TABLE IF NOT EXISTS zdjecie_cache (
  tw_id      INTEGER PRIMARY KEY,
  plik       TEXT,                 -- nazwa pliku w data/zdjecia; NULL = brak zdjęcia
  mime       TEXT,
  bajtow     INTEGER NOT NULL DEFAULT 0,
  etag       TEXT,                 -- sha1 treści — po nim idzie 304
  pobrano_at TEXT NOT NULL,
  uzyto_at   TEXT NOT NULL,        -- ostatnie UŻYCIE; po nim idzie eviction
  blad       TEXT                  -- zdanie o BŁĘDZIE, nigdy o braku zdjęcia
);
CREATE INDEX IF NOT EXISTS ix_zdjecie_uzyto ON zdjecie_cache(uzyto_at);

-- Logo dostawcy (0.56.0). Wgrywane ręcznie w panelu biura, pokazywane po lewej
-- stronie wiersza na liście dostaw w kolektorze.
--
-- OBRAZ SIEDZI W BAZIE, a nie na dysku obok zdjęć kartotek — i to jest różnica
-- celowa. Zdjęcia są CACHE'M ściąganym z Subiekta: wolno je skasować, bo
-- odtworzą się same, więc mają katalog i eviction. Logo nikt nie odtworzy —
-- ktoś je raz znalazł i wgrał. Należy do kopii bazy, nie do cache'u.
--
-- Klucz to `kh_Id` z Subiekta, nie nazwa. Symbol kontrahenta wolno poprawić,
-- a ta sama firma potrafi wystąpić pod dwoma napisami; identyfikator przeżywa
-- jedno i drugie. Obraz jest ZAWSZE PNG — normalizuje go przeglądarka przy
-- wgrywaniu, bo serwer nie ma czym przerabiać obrazów i mieć nie będzie.
CREATE TABLE IF NOT EXISTS dostawca_logo (
  kh_id     INTEGER PRIMARY KEY,
  nazwa     TEXT NOT NULL,      -- symbol z chwili wgrania, do pokazania w panelu
  obraz     BLOB NOT NULL,
  bajtow    INTEGER NOT NULL,
  etag      TEXT NOT NULL,      -- sha1 treści — po nim idzie 304
  dodane_at TEXT NOT NULL,
  dodane_by TEXT NOT NULL
);

-- Zdjęcie kartoteki DODANE Z KOLEKTORA (0.88.0).
--
-- OBRAZ SIEDZI W BAZIE, nie w data/zdjecia, i to jest ta sama różnica co przy
-- `dostawca_logo` obok. `zdjecie_cache` jest CACHE'M: wolno go skasować, bo
-- odtworzy się z Subiekta. Tego nikt nie odtworzy — ktoś stanął przy regale
-- z towarem w ręku i zrobił zdjęcie. Należy do kopii bazy, nie do cache'u.
--
-- Wiersz jest zarazem ZAPASOWĄ DROGĄ. Kartę rysuje się z niego natychmiast po
-- zapisie, niezależnie od tego, czy baza firmy ma `GRANT INSERT` i czy worker
-- zdążył wykonać zadanie — dokładnie tak `ean_alias` niesie kod kreskowy mimo
-- nieudanego `set_ean`. Znika dopiero wtedy, gdy zapis do Subiekta NAPRAWDĘ
-- wszedł; od tej chwili źródłem jest znowu Subiekt.
CREATE TABLE IF NOT EXISTS zdjecie_wlasne (
  tw_id          INTEGER PRIMARY KEY,
  obraz          BLOB NOT NULL,
  mime           TEXT NOT NULL,
  bajtow         INTEGER NOT NULL,
  etag           TEXT NOT NULL,      -- sha1 treści — po nim idzie 304
  tlo_usuniete   INTEGER NOT NULL,   -- 0 = człowiek wybrał „ZOSTAW TŁO"
  dodane_at      TEXT NOT NULL,
  dodane_by      TEXT NOT NULL,      -- nazwa z chwili zapisu (snapshot)
  dodane_by_ref  INTEGER,            -- konto — po nim wiąże audyt
  queue_id       INTEGER,            -- zadanie set_zdjecie; NULL = zapis wyłączony
  w_subiekcie_at TEXT                -- NULL = do kartoteki jeszcze nie weszło
);

-- Podgląd między zrobieniem zdjęcia a jego zatwierdzeniem (0.88.0).
--
-- Istnieje, bo wycięcie tła bywa nieudane i człowiek ma je zobaczyć, ZANIM
-- cokolwiek trafi do bazy firmy. Trzymamy obie wersje: wyciętą i oryginał —
-- przycisk „ZOSTAW TŁO" musi mieć co zapisać bez drugiego przesyłania zdjęcia
-- przez Wi-Fi hali.
--
-- Wiersz żyje minuty (ZDJECIA_PODGLAD_MIN) i kasuje się sam. Bez tego jeden
-- porzucony kadr zostawałby w bazie na zawsze, a jest ich tyle, ile prób.
CREATE TABLE IF NOT EXISTS zdjecie_podglad (
  id           TEXT PRIMARY KEY,     -- losowy, nadany przez serwer
  tw_id        INTEGER NOT NULL,
  bez_tla      BLOB,                 -- NULL = usługa tła nie działa albo odmówiła
  oryginal     BLOB NOT NULL,
  mime         TEXT NOT NULL,        -- typ ORYGINAŁU; wycięte tło jest zawsze PNG
  utworzone_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_zdjecie_podglad_czas ON zdjecie_podglad(utworzone_at);

CREATE TABLE IF NOT EXISTS process_state (
  name       TEXT PRIMARY KEY,   -- 'api' | 'worker' | 'sfera' (worker MM, sfera-worker/)
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

-- Zbiórki z systemu sprzedażowego (Sellasist) — import CSV z panelu biura,
-- docelowo automatyczny POST z integracji. Surowe WIERSZE, nie agregaty:
-- `koszyk_id` z eksportu jest unikalny per pozycja koszyka, więc INSERT OR
-- IGNORE czyni import idempotentnym — nakładające się okresy i powtórne
-- wgranie tego samego pliku niczego nie dublują. Agregaty (zbiórki na dzień,
-- kandydaci do strefy złotej) liczą się na żądanie z indeksów niżej.
-- Historii nie kasujemy — ta sama zasada co przy `events`.
CREATE TABLE IF NOT EXISTS zbiorka (
  koszyk_id  INTEGER PRIMARY KEY,
  tw_id      INTEGER,               -- NULL = wiersz niedopasowany do kartoteki
  symbol_csv TEXT NOT NULL,         -- co stało w pliku; diagnoza dopasowań
  data       TEXT NOT NULL,         -- dzień zbiórki z pliku (RRRR-MM-DD)
  ilosc      REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_zbiorka_tw_data ON zbiorka(tw_id, data);
CREATE INDEX IF NOT EXISTS ix_zbiorka_data ON zbiorka(data);

-- Reguły strefy złotej — edytowalne z panelu biura (0.50.0). Do tej wersji
-- reguły były stałą w kodzie (services/strefa-zlota.ts); tamta tablica została
-- ZIARNEM wsiewanym przy migracji, gdy tabela jest pusta. Raport reslot
-- i adnotacja na karcie czytają te same wiersze — jedno źródło prawdy.
-- `alejka` XOR (`regal_od`,`regal_do`): cała alejka albo zakres regałów.
CREATE TABLE IF NOT EXISTS strefa_regula (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  alejka   TEXT,                    -- np. 'A' — cała alejka
  regal_od TEXT,                    -- np. 'D01' — zakres włącznie
  regal_do TEXT,
  poziomy  TEXT NOT NULL            -- CSV numerów poziomów, np. '2,3,4'
);

-- ── Obsługa klienta: skasowana w 0.140.0 ───────────────────────────────────
-- Stały tu rejestry pytań, dyskusji, opinii i zwrotów Allegro plus nakładka
-- spraw. Wszystkie zniknęły razem z kodem, który je czytał: model danych stał
-- na kształcie odpowiedzi API, którego nikt nie sprawdził na żywym koncie,
-- a każda kolejna warstwa dziedziczyła po nim niepewność. Nowa obsługa
-- powstaje od zera (patrz docs/obsluga-klienta.md) i przyniesie własne tabele.

-- ── Zadania terenowe obsługi klienta (0.141.0) ───────────────────────────────
-- Biuro nie wysyła magazynierowi wiadomości na prywatny komunikator. Zleca
-- konkretną czynność przy towarze, a wynik wraca do tego samego panelu.
CREATE TABLE IF NOT EXISTS zadanie_terenowe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rodzaj TEXT NOT NULL CHECK (rodzaj IN ('pomiar','zdjecie','weryfikacja','inne')),
  tytul TEXT NOT NULL,
  instrukcja TEXT NOT NULL,
  -- ON DELETE SET NULL, bo `sgt_towar` jest READ-MODELEM odtwarzanym przy
  -- każdym imporcie z Subiekta: `importFromMssql` kasuje całą tabelę i wstawia
  -- ją od nowa. Bez tej klauzuli klucz obcy trzymał wiersz towaru w zakładnikach
  -- i KASOWANIE PADAŁO, a razem z nim całe API — import biegnie przed
  -- nasłuchem, więc jedno zadanie ze wskazanym towarem kładło serwer w pętli
  -- restartów. Zadanie i tak niesie własny snapshot symbolu oraz nazwy, więc
  -- utrata samego powiązania nic mu nie zabiera.
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
  -- Zadanie może pochodzić z rozmowy z klientem (0.142.0). NULL znaczy
  -- „zlecone ręcznie z panelu" i tak zostaje dla wszystkiego sprzed tej
  -- wersji — migracja nie zgaduje powiązań po dacie ani po treści.
  conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  message_id INTEGER REFERENCES message(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_status
  ON zadanie_terenowe(status, priorytet, utworzono_at);
CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_przypisane
  ON zadanie_terenowe(przypisano_user_id, status);
CREATE INDEX IF NOT EXISTS ix_zadanie_terenowe_towar
  ON zadanie_terenowe(tw_id, utworzono_at);

-- Token OAuth konta Allegro. JEDEN wiersz (id=1): aplikacja obsługuje jedno
-- konto sprzedawcy. Refresh token jest STANEM, nie konfiguracją — Allegro
-- wydaje nową parę przy każdym odświeżeniu, więc env nie ma tu czego trzymać.
-- NIE jest częścią read-modelu: import z MSSQL nie ma prawa go dotknąć.
CREATE TABLE IF NOT EXISTS allegro_token (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  wygasa_at       TEXT NOT NULL,      -- ISO UTC; odświeżamy 5 min przed
  scope           TEXT,
  -- prod | sandbox. Token NIE przeżywa zmiany środowiska: parowanie na
  -- sandboksie i przełączenie na produkcję ma wymusić ponowne parowanie,
  -- a nie sypać 401 bez wyjaśnienia.
  srodowisko      TEXT NOT NULL,
  polaczono_at    TEXT NOT NULL,
  polaczono_przez TEXT NOT NULL
);

-- Surowy read-model Centrum wiadomości. Kolumny są wyłącznie polami
-- potwierdzonymi przez docs/allegro-ksztalt.md; JSON zachowuje dowód źródłowy.
CREATE TABLE IF NOT EXISTS allegro_inbox_thread (
  id TEXT PRIMARY KEY,
  read INTEGER NOT NULL,
  -- NULL jest POPRAWNĄ wartością obu tych kolumn i mówi o tym schemat Allegro:
  -- `Thread` wymaga wyłącznie `id` i `read`, a `lastMessageDateTime`
  -- i `interlocutor` są opcjonalne i dopuszczają null. Wątek bez ostatniej
  -- wiadomości to wątek świeżo założony, a nie wątek uszkodzony — do 0.151.0
  -- stało tu `NOT NULL` i taki wątek nie miał jak wejść do skrzynki.
  last_message_at TEXT,
  interlocutor_login TEXT,
  surowe_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
-- Kolumny odpowiadają POLOM ALLEGRO, nie naszym wyobrażeniom o nich.
-- Do 0.151.0 stało tu `author_role NOT NULL` i `read NOT NULL` — dwa pola,
-- których Centrum wiadomości nie przysyła w ogóle. To lądowisko ma trzymać
-- odpowiedź w kształcie, w jakim przyszła; własny słownik należy do modelu
-- kanonicznego (`message.direction`), nie tutaj.
CREATE TABLE IF NOT EXISTS allegro_inbox_message (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES allegro_inbox_thread(id) ON DELETE CASCADE,
  author_login TEXT NOT NULL,
  -- `author.isInterlocutor`: rozmówca to ten, który nie jest nami. Z tego
  -- wynika kierunek wiadomości i nie ma innego źródła.
  author_is_interlocutor INTEGER NOT NULL,
  text TEXT NOT NULL,
  subject TEXT,
  -- `status` (np. `DELIVERED`) mówi o DORĘCZENIU, nie o przeczytaniu.
  -- Przeczytanie niesie wątek, nie wiadomość.
  status TEXT,
  -- Data POJEDYNCZEJ wiadomości. Dopóki jej nie czytaliśmy, oś czasu rozmowy
  -- stała na dacie wątku i wszystkie wiadomości miały jedną godzinę.
  created_at TEXT,
  related_object_type TEXT,
  related_object_id TEXT,
  surowe_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_allegro_inbox_message_thread
  ON allegro_inbox_message(thread_id);

-- Osobny, pojedynczy model stanu synchronizatora (nie stan tokena).
-- Załączniki wiadomości (0.155.0). Sonda z żywego konta pokazała je w 7 z 39
-- wiadomości — do tej pory agent ich nie widział, choć klient przysyłał
-- zdjęcie części.
--
-- `url` JEST NULLOWALNE i to nie jest ostrożność na wyrost: schemat Allegro
-- (`MessageAttachmentInfo`) wymaga wyłącznie `fileName` i `status`. Załącznik
-- wygasły albo odrzucony jako niebezpieczny nie ma adresu i nadal musi być
-- widoczny — inaczej rozmowa kłamie, że nic nie przyszło.
CREATE TABLE IF NOT EXISTS message_attachment (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES message(id) ON DELETE CASCADE,
  file_name  TEXT NOT NULL,
  mime_type  TEXT,
  url        TEXT,
  -- `NEW`, `SAFE`, `UNSAFE`, `EXPIRED` wprost ze schematu Allegro. Pobranie
  -- oferujemy wyłącznie przy `SAFE`: `UNSAFE` znaczy, że Allegro uznało plik
  -- za niebezpieczny, a my nie mamy powodu wiedzieć lepiej.
  status     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_message_attachment_wiadomosc
  ON message_attachment(message_id);

CREATE TABLE IF NOT EXISTS allegro_inbox_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_at TEXT,
  cursor_id TEXT,
  last_success_at TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  -- Ostatnia PRÓBA, nie ostatni sukces: bez niej ekran nie odróżnia
  -- synchronizatora, który stanął, od takiego, który bije w zamknięte drzwi.
  last_attempt_at  TEXT,
  -- Kod HTTP ostatniej porażki. Status z §7 (`rate_limited`,
  -- `authentication_error`) wynika z niego, a nie z samej liczby błędów.
  last_error_code  INTEGER,
  -- Powód SŁOWEM. Nie każda porażka ma kod HTTP: brak parowania, timeout
  -- i odmowa wersji zasobu to gołe wyjątki, a to WŁAŚNIE one najczęściej
  -- zatrzymują skrzynkę na dłużej.
  last_error_text  TEXT,
  error_thread_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  -- Data najstarszego wątku przebiegu, który ZSZEDŁ DO DNA listy: do granicy
  -- czasu albo do końca historii. NULL znaczy „jeszcze nigdy", a to jedyny
  -- stan, w którym sufit stron nie obowiązuje — inaczej instalacja
  -- z zaległością większą niż sufit nigdy by jej nie nadrobiła.
  dno_at TEXT
);

-- ── Zwroty klienckie z Allegro (0.150.0) ────────────────────────────────────
-- Zwrot jest DWOMA BYTAMI O JEDNYM NUMERZE: sprawą klienta w Allegro (zegar
-- ustawowy, pieniądze) i procesem magazynowym w Subiekcie (paczka wraca,
-- korekta, MM na bufor). Te tabele spinają oba i NIE budują trzeciego obiegu
-- magazynowego: fizyczne odłożenie zostaje w koszach z dokumentu MM ZWROTY,
-- a ocena towaru idzie istniejącym `zadanie_terenowe`.
--
-- Podział na lądowisko i model pracy jest ten sam co przy skrzynce:
-- `allegro_zwrot` trzyma odpowiedź w kształcie, w jakim przyszła, a panel
-- czyta wyłącznie `zwrot_klienta`.
--
-- NAZWY `zwrot` I `zwrot_pozycja` SĄ SPALONE — `bezObslugiKlienta()` kasuje
-- je przy KAŻDEJ migracji, więc tabela o takiej nazwie znikałaby po cichu
-- sekundę po powstaniu. Powód i strażnik stoją w `db/db.ts`.
CREATE TABLE IF NOT EXISTS allegro_zwrot (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  surowe_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

-- Model pracy. KUBEŁKA NIE MA W KOLUMNIE: wynika z faktów niżej i liczy go
-- `services/zwroty.ts`. Zdenormalizowany kubełek rozjechałby się z werdyktem
-- przy pierwszym zapisie, który go zapomni — a to jest dokładnie ten gatunek
-- usterki, który kosztował licznik błędów w 0.147.0.
CREATE TABLE IF NOT EXISTS zwrot_klienta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  reference_number TEXT,
  order_id TEXT,
  -- Moment z Allegro. Od niego liczy się zegar ustawowy, więc jest NOT NULL:
  -- zwrot bez daty nie ma terminu, a termin steruje kolejnością pracy.
  created_at TEXT NOT NULL,
  -- Pierwsza paczka. NULL znaczy „towar jeszcze nie wrócił" i zapala sygnał
  -- „brak dowodu", gdy termin już biegnie.
  paczka_at TEXT,
  -- Odrzucenie POBRANE z Allegro (ktoś kliknął w panelu Allegro, nie u nas).
  -- Nasze własne odrzucenie ma osobne kolumny `werdykt_*`, bo pochodzenie
  -- decyzji jest tu informacją, a nie szczegółem.
  rejection_code TEXT,
  rejection_reason TEXT,
  -- ── Decyzje biura (zapisywane od 0.151.0) ──────────────────────────────
  werdykt TEXT CHECK (werdykt IN ('przyjety','odrzucony')),
  werdykt_at TEXT, werdykt_przez TEXT,
  werdykt_user_id INTEGER REFERENCES app_user(user_id),
  werdykt_powod TEXT,
  -- `kwota_wariant` jest ETYKIETĄ tego, co zaznaczono, a nie wyborem z menu:
  -- operator odhacza pozycje i dostawę, a wariant wylicza się z zaznaczenia
  -- (wszystko z dostawą = pełna, wszystko bez = bez_wysylki, reszta = inna).
  kwota_wariant TEXT CHECK (kwota_wariant IN ('pelna','bez_wysylki','inna')),
  kwota_grosze INTEGER,
  -- Ile z kwoty to DOSTAWA. Osobno od sumy, bo bez tego nie da się odtworzyć,
  -- czy operator ją oddał, czy tylko pozycje wyszły akurat na tyle samo.
  kwota_dostawa_grosze INTEGER,
  kwota_at TEXT, kwota_przez TEXT,
  -- Oś czasu zwrotu PO STRONIE ALLEGRO (0.164.0) — nie mylić z `werdykt`
  -- ani `zamkniety_at`, które są naszymi decyzjami. Jedenaście wartości
  -- opisuje `docs/allegro-ksztalt.md`; BEZ `CHECK`, bo schemat Allegro
  -- wymienia je słownie i nie zamyka enumem, a nieznana wartość ma przejść,
  -- nie wywrócić synchronizację.
  --
  -- Dwie z nich mówią o PROWIZJI, nie o pieniądzach klienta:
  -- `COMMISSION_REFUND_CLAIMED` i `COMMISSION_REFUNDED`. Kolejka bramek NIE
  -- routuje po tym polu — w obserwacji z 2 września 95 zwrotów na 100 miało
  -- `COMMISSION_REFUNDED`, więc routowanie opustoszyłoby ją prawie całkiem.
  status_allegro TEXT,
  korekta_queue_id INTEGER REFERENCES sfera_queue(id),
  korekta_numer TEXT,
  zamkniety_at TEXT,
  -- Ocena towaru wraca z hali. `zadanie_terenowe` niesie ją w `wynik`;
  -- tu stoi samo powiązanie, żeby oś zwrotu miała po czym trafić do zadania.
  zadanie_id INTEGER REFERENCES zadanie_terenowe(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  -- Kontrola współbieżności, jak przy rozmowie: dwóch agentów nie zamyka
  -- jednego zwrotu dwiema różnymi kwotami.
  wersja INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL,
  UNIQUE (channel_account_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_zwrot_klienta_termin
  ON zwrot_klienta(created_at);

CREATE TABLE IF NOT EXISTS zwrot_klienta_pozycja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
  offer_id TEXT,
  nazwa TEXT NOT NULL,
  ilosc REAL NOT NULL,
  -- Grosze w INTEGER, choć Allegro oddaje kwotę STRINGIEM. Powód jest ten
  -- sam po obu stronach: liczba zmiennoprzecinkowa gubi grosz przy sumowaniu,
  -- a tu sumujemy pozycje, żeby zaproponować kwotę zwrotu.
  cena_grosze INTEGER NOT NULL,
  waluta TEXT NOT NULL,
  powod TEXT,
  powod_komentarz TEXT,
  -- Adres oferty wprost z `items[].url` — JEDYNY odnośnik, który specyfikacja
  -- Allegro opisuje, więc jedyny bez znacznika `[WERYFIKUJ]`.
  url TEXT,
  ocena TEXT CHECK (ocena IN ('stan','przecena','utylizacja')),
  ocena_at TEXT, ocena_przez TEXT,
  -- Czy ta pozycja weszła do zwracanej kwoty. Zaznaczenie trzeba zapamiętać,
  -- bo sama suma nie mówi, KTÓRE pozycje operator oddał — a przy sporze
  -- z klientem to jest właśnie pytanie.
  w_zwrocie INTEGER NOT NULL DEFAULT 0,
  -- Klucz naturalny pozycji: `offer_id|nazwa`, wyliczany w kodzie. Kolumna
  -- istnieje, bo SQLite traktuje NULL-e w UNIQUE jako RÓŻNE — a `offer_id`
  -- bywa puste, więc `UNIQUE (zwrot_id, offer_id, nazwa)` przepuszczałoby
  -- duplikaty dokładnie tam, gdzie najbardziej bolą.
  --
  -- Do 0.153.1 pozycje kasowało się i wstawiało od nowa przy każdym
  -- przebiegu, a pracę człowieka odtwarzało z mapy. Kosztowało to dwie
  -- rzeczy: `id` pozycji zmieniało się pod otwartym panelem (potwierdzenie
  -- trafiało w cudzy wiersz albo w „nie znaleziono"), a dwie pozycje o tej
  -- samej nazwie bez `offer_id` sklejały się w jeden klucz mapy i jedna
  -- traciła ocenę. Upsert po tym kluczu znosi oba.
  klucz TEXT NOT NULL,
  -- ── Kartoteka Subiekta (0.152.0) ──────────────────────────────────────
  -- Bez niej pozycja nie ma zdjęcia: `zdjecie_cache` i `zdjecie_wlasne` są
  -- kluczowane po `tw_id`, więc to jedyna droga do obrazu.
  --
  -- BEZ KLUCZA OBCEGO DO `sgt_towar`, i to jest poprawka z 0.154.0. Do niej
  -- stało tu `REFERENCES sgt_towar(tw_id) ON DELETE SET NULL` — a import
  -- z Subiekta kasuje CAŁY read-model i wstawia go od nowa co
  -- `MSSQL_SYNC_MS` (domyślnie minutę). Skutek: każda potwierdzona przez
  -- człowieka kartoteka znikała po minucie, cicho. Ponowny INSERT tego
  -- samego `tw_id` nie cofa `SET NULL`.
  --
  -- Przewrotność tamtego stanu: instalacja sprzed 0.152.0 dostała kolumnę
  -- przez `ALTER TABLE`, który w SQLite nie umie dołożyć klucza obcego,
  -- więc TRZYMAŁA powiązania. Traciła je dopiero baza świeża.
  --
  -- Wzorzec bierzemy z `ean_alias.tw_id`: zwykły INTEGER, żadnych
  -- `REFERENCES`. Powiązanie nadane przez człowieka NIE jest częścią
  -- read-modelu i nie ma prawa ginąć razem z nim. Wiszące `tw_id` odsiewa
  -- odczyt, który i tak sprawdza istnienie towaru, a `tw_symbol` niesie
  -- sens nawet bez trafienia w kartotekę.
  tw_id INTEGER,
  tw_symbol TEXT,
  -- `sku` = automat dopasował po `offer.external.id`, `reczne` = wskazał
  -- człowiek. Źródło jest tu równie ważne jak sam fakt: projekt panelu §4.3
  -- żąda, żeby wybór człowieka nie udawał faktu z Allegro — a wybór automatu
  -- tym bardziej.
  tw_zrodlo TEXT CHECK (tw_zrodlo IN ('sku','reczne')),
  tw_at TEXT, tw_przez TEXT
);
CREATE INDEX IF NOT EXISTS ix_zwrot_klienta_pozycja_zwrot
  ON zwrot_klienta_pozycja(zwrot_id);
-- Indeks na `klucz` powstaje w `migrate()`, NIE tutaj. Na istniejącej bazie
-- `CREATE TABLE IF NOT EXISTS` nie dokłada kolumny, więc w chwili wykonania
-- schematu `klucz` jeszcze nie istnieje i indeks wywalałby start. To ta sama
-- reguła co przy `ix_events_ref_time`.

-- ── Pamięć powiązań oferta → kartoteka (0.154.0) ────────────────────────────
-- Człowiek wskazuje kartotekę RAZ. Ten sam towar wraca za miesiąc na innym
-- zwrocie i ma się powiązać sam — inaczej praca powtarza się w nieskończoność,
-- a to jest dokładnie ten koszt, który panel zwrotów miał zdejmować.
--
-- Wzorzec i uzasadnienie wprost z `ean_alias`: BEZ klucza obcego do
-- `sgt_towar`, bo wpis ma przeżyć import kasujący read-model. To nie jest
-- niedopatrzenie, tylko warunek działania.
--
-- Klucz to identyfikator oferty RAZEM z kontem kanału — projekt panelu §15.1
-- zabrania zakładać wspólnej przestrzeni identyfikatorów, a ta sama oferta
-- na drugim koncie sprzedawcy jest inną ofertą.
CREATE TABLE IF NOT EXISTS oferta_kartoteka (
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  offer_id TEXT NOT NULL,
  tw_id INTEGER NOT NULL,
  tw_symbol TEXT NOT NULL,
  -- SKU, po którym trafiło, gdy trafiło. NULL = człowiek wskazał ręcznie.
  sku TEXT,
  wskazano_at TEXT NOT NULL,
  wskazano_przez TEXT NOT NULL,
  PRIMARY KEY (channel_account_id, offer_id)
);
CREATE INDEX IF NOT EXISTS ix_oferta_kartoteka_tw ON oferta_kartoteka(tw_id);

-- Oś zwrotu. Wpisy wiszą przy ŹRÓDLE, nie przy sprawie — blizna 0.130.0,
-- gdzie historia ginęła przy scalaniu.
-- ── Wnioski o rabat transakcyjny (0.164.0) ─────────────────────────────────
-- Zwrot prowizji od sprzedaży. Do 0.162.1 firma klikała po niego ręcznie przy
-- każdym zwrocie w panelu Allegro; obserwacja z 2 września pokazuje, ile to
-- pracy: `type` to MANUAL ×60 i AUTOMATIC ×40 na sto wniosków.
--
-- Tabela jest LUSTREM odczytu z `/order/refund-claims`, nie naszym rejestrem
-- decyzji — stąd sam `external_id` jako klucz naturalny i żadnych kolumn
-- „kto u nas kliknął". Kto kliknął, mówi dziennik zdarzeń i oś zwrotu.
--
-- `line_item_id` to identyfikator POZYCJI ZAMÓWIENIA (`lineItems[].id`),
-- czyli to samo, co `zamowienie_klienta_pozycja.external_id`. Po nim, i tylko
-- po nim, wiąże się wniosek ze zwrotem: `items[].offerId` zwrotu należy do
-- przestrzeni, której wciąż nie znamy (`[WERYFIKUJ]` w allegro-ksztalt.md).
CREATE TABLE IF NOT EXISTS allegro_rabat (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  line_item_id TEXT,
  offer_id TEXT,
  ilosc REAL,
  -- Prowizja przyjeżdża LICZBĄ, gdy wszędzie indziej Allegro oddaje kwotę
  -- tekstem (`docs/allegro-ksztalt.md`). Grosze w INTEGER jak wszędzie u nas.
  prowizja_grosze INTEGER,
  waluta TEXT,
  -- Bez `CHECK` z tego samego powodu co przy `status_allegro`: siedem wartości
  -- zna filtr listy, ale schemat odpowiedzi ich nie zamyka.
  status TEXT,
  -- `MANUAL` albo `AUTOMATIC` — czyli czy wniosek złożył człowiek, czy Allegro
  -- samo. To ta liczba mówi, ile pracy zdejmuje przycisk w panelu.
  typ TEXT,
  created_at TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE (channel_account_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_allegro_rabat_pozycja
  ON allegro_rabat(line_item_id);

CREATE TABLE IF NOT EXISTS zwrot_zdarzenie (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zwrot_id INTEGER NOT NULL REFERENCES zwrot_klienta(id) ON DELETE CASCADE,
  rodzaj TEXT NOT NULL,
  tresc TEXT,
  dane_json TEXT,
  kiedy_at TEXT NOT NULL,
  kto TEXT,
  kto_user_id INTEGER REFERENCES app_user(user_id)
);
CREATE INDEX IF NOT EXISTS ix_zwrot_zdarzenie_zwrot
  ON zwrot_zdarzenie(zwrot_id, kiedy_at);

-- Stan synchronizatora zwrotów. Osobny wiersz od skrzynki, bo to osobna
-- rodzina końcówek z własnym limitem i własnym kursorem.
CREATE TABLE IF NOT EXISTS allegro_zwroty_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  -- Identyfikator ostatnio widzianego zwrotu. Allegro przyjmuje go jako
  -- `from` i oddaje zwroty utworzone PO nim — kursor, nie offset.
  cursor_id TEXT,
  cursor_at TEXT,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error_code INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT
);

-- ── Zamówienia klienckie z Allegro (0.152.0) ────────────────────────────────
-- Zwrot niesie sam numer zamówienia, a decyzja potrzebuje jego treści: co
-- jeszcze klient kupił, ile kosztowała dostawa i jaki SKU ma sprzedana
-- oferta. To ostatnie jest tu najważniejsze — `offer.external.id` to
-- identyfikator oferty w systemie sprzedawcy, czyli mostek do kartoteki,
-- z którego bierze się zdjęcie.
--
-- NAZWA `zamowienie_klienta`, nie `zamowienie`: `sgt_zamowienie` to już
-- zamówienia DO DOSTAWCY z Subiekta i pomylenie ich kosztowałoby czytelnika
-- godzinę. Wzór nazwy ten sam co przy `zwrot_klienta`.
CREATE TABLE IF NOT EXISTS allegro_zamowienie (
  id TEXT PRIMARY KEY,
  -- Odpowiedź PO oczyszczeniu (`services/allegro-oczyszczanie.ts`). Adres,
  -- e-mail i telefon kupującego mają tu znacznik zamiast wartości; klucze
  -- zostają, żeby kształt dało się obejrzeć przy sporze.
  surowe_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zamowienie_klienta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  status TEXT,
  -- Login kupującego — jedyna dana osobowa, którą polityka danych skrzynki
  -- dopuszcza wprost. Bez niej nie da się powiązać zamówienia z rozmową.
  kupujacy_login TEXT,
  -- Koszt dostawy, czyli składnik, którego zwrotowi BRAKOWAŁO w 0.150.0.
  -- Bez niego wariant „bez wysyłki" był nieodróżnialny od pełnej kwoty.
  dostawa_grosze INTEGER,
  dostawa_metoda TEXT,
  suma_grosze INTEGER,
  waluta TEXT NOT NULL DEFAULT 'PLN',
  kupiono_at TEXT,
  zmieniono_at TEXT,
  synced_at TEXT NOT NULL,
  UNIQUE (channel_account_id, external_id)
);

CREATE TABLE IF NOT EXISTS zamowienie_klienta_pozycja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zamowienie_id INTEGER NOT NULL REFERENCES zamowienie_klienta(id) ON DELETE CASCADE,
  external_id TEXT,
  offer_id TEXT,
  nazwa TEXT NOT NULL,
  -- SKU sprzedawcy z `offer.external.id`. Trzymamy go SUROWO, bez
  -- normalizacji: dopasowanie do kartoteki jest osobną decyzją i ma być
  -- widać, na czym stanęło.
  sku TEXT,
  ilosc REAL NOT NULL,
  cena_grosze INTEGER NOT NULL,
  waluta TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_zamowienie_klienta_pozycja_zam
  ON zamowienie_klienta_pozycja(zamowienie_id);

-- ── Cyfrowe kosze zwrotowe (Etap 3) ─────────────────────────────────────────
-- Kosz zastępuje papierową kartkę wożoną z towarem: biuro przypina zwroty do
-- kosza skanem jego kodu, zamyka go, a magazynier na kolektorze rozkłada
-- zawartość i tym samym zwalnia bufor (MM ZWROTY→MAG idzie samo).
--
-- Kod kosza WRACA DO OBIEGU: etykieta na fizycznym koszu jest wielorazowa,
-- więc unikalność obowiązuje tylko wśród koszy nierozłożonych — stąd indeks
-- częściowy zamiast UNIQUE na kolumnie. Anulowany karton (0.123.0) też oddaje
-- kod: pudło, którego nikt nie rozłoży, nie ma prawa blokować numeru.
-- Predykat jest ŻYWY — przy zmianie trzeba przebudować indeks w `migrate()`,
-- bo `CREATE ... IF NOT EXISTS` nie rusza indeksu, który już stoi u klienta.
CREATE TABLE IF NOT EXISTS kosz (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Kod kosza. Dla koszy z Subiekta to LICZBA z numeru MM napisana na kartce
  -- („1209"), dla koszy składanych w aplikacji — kod nadany przez biuro.
  kod           TEXT NOT NULL,
  -- otwarty   = biuro dokłada zwroty
  -- zamkniety = gotowy do rozłożenia, widoczny na kolektorze
  -- rozlozony = rozłożony, bufor cofnięty; kod wolny do ponownego użycia
  status        TEXT NOT NULL DEFAULT 'otwarty',
  utworzono_at  TEXT NOT NULL,
  utworzono_przez TEXT NOT NULL,
  zamknieto_at  TEXT,
  zamknieto_przez TEXT,
  rozlozono_at  TEXT,
  rozlozono_przez TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_kosz_kod_aktywny ON kosz(kod)
  WHERE status NOT IN ('rozlozony', 'anulowany');

-- Pozycje kosza — SNAPSHOT z chwili otwarcia przyjęcia: to, co fizycznie leży
-- w koszu, przepisane z dokumentu MM ZWROTY. Snapshot danych DOKUMENTU chroni
-- pracę magazyniera przed późniejszą zmianą; ADRES snapshotem nie jest —
-- liczy się żywy, jak przy dostawach (lekcja z `adresyOczekiwane`
-- w services/delivery.ts).
CREATE TABLE IF NOT EXISTS kosz_pozycja (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kosz_id       INTEGER NOT NULL REFERENCES kosz(id),
  tw_id         INTEGER NOT NULL,
  symbol        TEXT NOT NULL,
  nazwa         TEXT NOT NULL,
  ilosc         REAL NOT NULL,
  status        TEXT NOT NULL DEFAULT 'todo',  -- todo | done | skipped
  lok_faktyczna TEXT,                          -- zeskanowana przy odkładaniu (fakt)
  odlozono_at   TEXT,
  odlozono_przez TEXT,
  -- Dlaczego pozycji nie odłożono (0.77.0). Nazwa statusu `skipped` jest ta
  -- sama co w delivery_line, bo to ten sam byt: praca zdjęta z rutyny z podaną
  -- przyczyną. Pominięta pozycja NIE dostaje MM — nigdzie nie pojechała.
  powod         TEXT,
  pominieto_at  TEXT,                          -- kiedy; po tym liczy się wiek sprawy
  -- Zamknięcie sprawy przez BIURO (0.77.0). Pozycja zostaje pominięta — to
  -- fakt z hali i historii się nie przepisuje — ale znika z listy pracy.
  -- Notatka mówi, czym się skończyło: znaleziony, reklamowany, skorygowany.
  zalatwione_at TEXT,
  zalatwione_przez TEXT,
  zalatwione_notatka TEXT,
  -- Zadanie zapisu ADRESU z tego odłożenia (0.79.0). Trzymane po to, żeby
  -- cofnięcie pomyłki wiedziało, czy adres zdążył pójść do Subiekta: zadanie
  -- oczekujące da się anulować, zapisanego nie cofa już aplikacja.
  loc_queue_id  INTEGER REFERENCES sfera_queue(id),
  -- „Wrócę do tego" (0.79.0): pozycja zjeżdża na KONIEC listy, zachowując stan
  -- `todo`. To co innego niż pominięcie — towar jest w koszu, tylko nie teraz.
  -- Znacznik czasu, nie flaga, bo dwie odłożone na później mają zachować
  -- kolejność między sobą.
  pozniej_at    TEXT,
  -- Zadanie MM ZWROTY→MAG cofające bufor dla TEJ pozycji. Jednopozycyjne MM
  -- świadomie: guard „adres przed sprzedawalnością" w obu workerach porządkuje
  -- zadania po tw_id, a MM wielopozycyjne wypadałoby spod niego.
  mm_queue_id   INTEGER REFERENCES sfera_queue(id)
);
CREATE INDEX IF NOT EXISTS ix_kosz_poz ON kosz_pozycja(kosz_id);

-- ── Przyjęcia na regał zwrotów (MM z Subiekta) ──────────────────────────────
-- Prawdziwy obieg magazynu jest starszy niż ta aplikacja: biuro składa koszyk
-- ze zwróconym towarem, wystawia w Subiekcie przesunięcie MM z magazynu
-- głównego NA regał zwrotów i pisze numer tego dokumentu ODRĘCZNIE na kartce
-- przypiętej do kosza („1209"). Kosz jedzie na halę, magazynier rozkłada
-- zawartość na regały, a dokument powrotny (ZWR→MAG) wystawia biuro.
--
-- Read-model, nie prawda: wipe+insert przy każdym imporcie, dokładnie jak
-- sgt_sprzedaz. Aplikacja czyta stąd WYŁĄCZNIE listę „co jest w koszu".
CREATE TABLE IF NOT EXISTS sgt_mm_zwrot (
  dok_id    INTEGER PRIMARY KEY,
  nr_pelny  TEXT NOT NULL,           -- „MM 1240/MAG/2026"
  -- Sama liczba z numeru — TO ONA jest napisana na kartce przy koszu i po niej
  -- magazynier odnajduje dokument. Wyliczana przy imporcie, żeby wyszukiwanie
  -- nie parsowało numeru przy każdym skanie.
  numer     TEXT NOT NULL,
  data_wyst TEXT NOT NULL,           -- ISO date
  mag_z     INTEGER,                 -- dok_MagId — magazyn źródłowy (główny)
  mag_do    INTEGER                  -- dok_OdbiorcaId — magazyn docelowy (zwroty)
);
CREATE INDEX IF NOT EXISTS ix_mm_zwrot_numer ON sgt_mm_zwrot(numer);
CREATE INDEX IF NOT EXISTS ix_mm_zwrot_data ON sgt_mm_zwrot(data_wyst);

CREATE TABLE IF NOT EXISTS sgt_mm_zwrot_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_mm_zwrot(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL,
  -- Snapshot z dokumentu (0.76.1). Kartoteka zablokowana w Subiekcie nie wchodzi
  -- do importu, a taki towar leży na regale zwrotów najczęściej — bez tych
  -- dwóch kolumn pozycja miałaby w koszu identyfikator zamiast nazwy.
  symbol TEXT NOT NULL DEFAULT '',
  nazwa  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_mm_zwrot_poz_dok ON sgt_mm_zwrot_pozycja(dok_id);

-- Przyjęcie uznane za rozłożone POZA aplikacją. Pierwszego dnia po wdrożeniu
-- lista niesie dokumenty sprzed niej — towar z nich dawno leży na regałach,
-- ale aplikacja nie ma skąd tego wiedzieć. Zdejmuje je z listy admin, ręką,
-- ze śladem kto i kiedy. Osobna tabela, bo to NIE jest kosz: nie ma pozycji,
-- nikt go nie rozkładał i nie ma czego pokazywać na kolektorze.
CREATE TABLE IF NOT EXISTS przyjecie_pominiete (
  dok_id INTEGER PRIMARY KEY,
  at     TEXT NOT NULL,
  przez  TEXT NOT NULL
);
