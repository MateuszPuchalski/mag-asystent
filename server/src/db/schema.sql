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

-- ── Konta pracowników (plan §7) ────────────────────────────────────────────
-- Do lipca 2026 „użytkownik" to był DOWOLNY łańcuch wpisywany ręcznie na
-- kolektorze i wysyłany w nagłówku X-User. Skutek: `events.user_id` zawiera
-- literówki i warianty tej samej osoby (Jan, jan, Jan K, JanK), więc audyt
-- nadawał się tylko do czytania oczami — nie do żadnego zestawienia. Do tego
-- każdy mógł podać się za kogokolwiek jednym wpisem.
--
-- Wejście to LOGIN I HASŁO — ten sam wzorzec, co reszta systemów w firmie.
-- Wcześniej był nim skan plakietki; wyszedł w 0.20.0 razem z PIN-em.
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
-- licznik korekt sprzedaży (dev — w prod numeruje Subiekt)
INSERT OR IGNORE INTO counters(name, value) VALUES ('korekta', 12);
-- licznik RW zniszczonych zwrotów (dev — w prod numeruje Subiekt)
INSERT OR IGNORE INTO counters(name, value) VALUES ('rw', 3);

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

-- ── Zwroty Allegro (Etap 1: skan → decyzja → dopasowanie dokumentu) ─────────
-- Poprzedni moduł zwrotów wyszedł w 0.17.0 (koszyki+MM bez wejścia — jego
-- finał wymagał workera Sfery, którego wtedy nie było). Ten jest INNY:
-- jednostką jest ZWROT KLIENTA pobrany z Allegro API, nie dokument z Subiekta.
-- Nazw martwych kolumn tamtego modułu (koszyk, mm_ilosc, mm_queue_id) nie
-- używamy — stare bazy je mają i znaczyły co innego.
--
-- Etap 1 NICZEGO nie zapisuje do Subiekta (sfera_queue nietknięta): korekta
-- i MM na magazyn zwrotów to Etap 2, stąd słownik statusów otwarty tekstem.

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

CREATE TABLE IF NOT EXISTS zwrot (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  -- id z GET /order/customer-returns. UNIQUE robi skan idempotentnym: druga
  -- osoba skanująca tę samą paczkę dostaje ISTNIEJĄCY zwrot, nie duplikat.
  -- NULL = zwrot założony ręcznie (etykieta, której Allegro nie znało).
  allegro_return_id TEXT UNIQUE,
  allegro_order_id  TEXT,
  -- referenceNumber — TEN numer widzi klient i panel sprzedawcy; UI pokazuje
  -- go dużą czcionką, bo po nim pracownik odnajduje zwrot w panelu Allegro.
  referencja        TEXT,
  -- Co ZESKANOWANO (fakt) — niezależnie od parcels[] z API. Etykieta u drzwi
  -- bywa numerem przewoźnika DORĘCZAJĄCEGO (transportingWaybill), innym niż
  -- waybill nadania.
  waybill           TEXT NOT NULL,
  status_allegro    TEXT,              -- status z API, informacyjnie
  kupujacy_login    TEXT,
  -- Identyfikator kupującego z Allegro. Po NIM, a nie po loginie, odnajduje
  -- się wątek Centrum wiadomości: lista wątków podaje rozmówcę zamaskowanym
  -- `client:44300444`, więc porównanie po loginie z zamówienia nie trafia (0.56.6).
  kupujacy_id       TEXT,
  kupujacy_email    TEXT,
  utworzono_allegro TEXT,              -- createdAt zwrotu w Allegro (ISO)
  -- Maszyna stanów zwrotu. Otwarty tekst, nie CHECK — kolejne etapy dopisują
  -- wartości, a stara baza nie ma prawa odrzucić wiersza z nowym stanem.
  --   nowy       = przyjęty skanem, czeka na ocenę towaru
  --   oceniony   = każda pozycja ma decyzję
  --   rozliczony = oceniony + odnotowany zwrot środków
  -- Stan DOKUMENTÓW (korekta + MM) NIE jest tu trzymany: wynika z wiersza
  -- kolejki wskazanego przez `korekta_queue_id`.
  status            TEXT NOT NULL DEFAULT 'nowy',
  -- Dokument źródłowy sprzedaży w Subiekcie. Numer i typ obok id ŚWIADOMIE:
  -- read-model sgt_sprzedaz jest oknem czasowym i wiersz może z niego wypaść,
  -- a zwrot ma dalej pokazywać, do czego został przypięty.
  sgt_dok_id        INTEGER,
  sgt_dok_numer     TEXT,
  sgt_dok_typ       TEXT,              -- FS | PA (sprzedaż idzie OBIEMA drogami)
  dopasowanie       TEXT NOT NULL DEFAULT 'brak',  -- brak | auto | reczne
  -- Zadanie „korekta + MM na bufor" w sfera_queue (Etap 2). JEDNA kolumna,
  -- bo status, numery dokumentów i błąd czyta się PRZEZ NIĄ z wiersza kolejki.
  -- Kopiowanie ich tutaj dałoby drugą prawdę, która rozjeżdża się przy każdym
  -- ponowieniu — a kolejka i tak jest miejscem, w którym biuro klika PONÓW.
  korekta_queue_id  INTEGER REFERENCES sfera_queue(id),
  -- Kosz zwrotowy, w którym fizycznie leży towar tego zwrotu (Etap 3).
  -- Wiązanie per ZWROT, nie per pozycja: do kosza idą pozycje pełnowartościowe
  -- razem z korektą, a rozdzielanie jednego zwrotu na kilka koszy mnożyłoby
  -- pytanie „gdzie to leży" bez żadnej korzyści.
  kosz_id           INTEGER REFERENCES kosz(id),
  -- Zwrot środków jest PÓŁAUTOMATYCZNY: link do panelu Allegro + stempel ręką.
  -- Wywołań payments API nie ma — pieniądze rusza człowiek.
  zwrot_srodkow_at  TEXT,
  zwrot_srodkow_przez TEXT,
  -- Pełna odpowiedź API. Diagnoza dopasowań dziś, paliwo korekty w Etapie 2.
  surowe_json       TEXT,
  utworzono_at      TEXT NOT NULL,
  utworzono_przez   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_zwrot_status ON zwrot(status, id);
-- skan sprawdza najpierw, czy etykieta już ma rekord — przy każdym skanie
CREATE INDEX IF NOT EXISTS ix_zwrot_waybill ON zwrot(waybill);

CREATE TABLE IF NOT EXISTS zwrot_pozycja (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zwrot_id      INTEGER NOT NULL REFERENCES zwrot(id),
  offer_id      TEXT,                -- items[].offerId z Allegro
  nazwa         TEXT NOT NULL,       -- nazwa oferty (snapshot — oferta znika po latach)
  -- offer.external.id z zamówienia — sygnatura sprzedawcy, którą integracja
  -- sprzedażowa zwykle wypełnia symbolem kartoteki ([WERYFIKUJ] na własnym koncie).
  external_id   TEXT,
  tw_id         INTEGER,             -- dopasowana kartoteka; NULL = uczciwy brak
  ilosc         REAL NOT NULL DEFAULT 1,
  powod         TEXT,                -- powód zwrotu z Allegro
  powod_opis    TEXT,                -- komentarz kupującego
  -- Decyzja pracownika po obejrzeniu towaru — per POZYCJA, bo jedna paczka
  -- miewa artykuł pełnowartościowy i uszkodzony naraz. Zwrot per-paczka
  -- wymuszałby najgorszy wspólny mianownik.
  -- pelnowartosciowy | reklamacja | do_wyjasnienia | do_zniszczenia
  decyzja       TEXT,
  decyzja_at    TEXT,
  decyzja_przez TEXT,
  notatka       TEXT,                -- swobodna notatka do decyzji (opcjonalna)
  -- Rozpatrzenie reklamacji (Etap 3). Puste = reklamacja OTWARTA — to na
  -- pustych liczy się priorytet wg dni do terminu ustawowego. Wynik jest
  -- otwartym tekstem (uznana | odrzucona), z tego samego powodu co statusy.
  rekl_wynik    TEXT,
  rekl_at       TEXT,
  rekl_przez    TEXT,
  rekl_notatka  TEXT,
  -- Półka reklamacyjna (Etap 6): GDZIE fizycznie leży reklamowany towar,
  -- dopóki sprawa trwa. Ewidencja w aplikacji, nie ruch w Subiekcie — towar
  -- reklamowany nie jest na stanie (korekta go nie objęła), więc MM nie ma
  -- czego przesuwać. Zostaje po rozpatrzeniu: historia mówi, skąd zszedł.
  rekl_polka    TEXT
);
CREATE INDEX IF NOT EXISTS ix_zwrot_poz ON zwrot_pozycja(zwrot_id);

-- ── Cyfrowe kosze zwrotowe (Etap 3) ─────────────────────────────────────────
-- Kosz zastępuje papierową kartkę wożoną z towarem: biuro przypina zwroty do
-- kosza skanem jego kodu, zamyka go, a magazynier na kolektorze rozkłada
-- zawartość i tym samym zwalnia bufor (MM ZWROTY→MAG idzie samo).
--
-- Kod kosza WRACA DO OBIEGU: etykieta na fizycznym koszu jest wielorazowa,
-- więc unikalność obowiązuje tylko wśród koszy nierozłożonych — stąd indeks
-- częściowy zamiast UNIQUE na kolumnie.
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
CREATE UNIQUE INDEX IF NOT EXISTS ix_kosz_kod_aktywny ON kosz(kod) WHERE status <> 'rozlozony';

-- Pozycje kosza — SNAPSHOT z chwili zamknięcia: to, co fizycznie leży w koszu
-- (pozycje pełnowartościowe zwrotów kosza, te same, które poszły na korektę).
-- Snapshot danych DOKUMENTU chroni pracę magazyniera przed późniejszą zmianą;
-- ADRES snapshotem nie jest — liczy się żywy, jak przy dostawach (lekcja
-- z `adresyOczekiwane` w services/delivery.ts).
CREATE TABLE IF NOT EXISTS kosz_pozycja (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kosz_id       INTEGER NOT NULL REFERENCES kosz(id),
  -- NULL = kosz z dokumentu MM (0.75.0): pozycja pochodzi z przesunięcia
  -- wystawionego w Subiekcie, a nie ze zwrotu przypiętego w aplikacji.
  zwrot_id      INTEGER REFERENCES zwrot(id),
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
  -- Zadanie MM ZWROTY→MAG cofające bufor dla TEJ pozycji. Jednopozycyjne MM
  -- świadomie: guard „adres przed sprzedawalnością" w obu workerach porządkuje
  -- zadania po tw_id, a MM wielopozycyjne wypadałoby spod niego.
  mm_queue_id   INTEGER REFERENCES sfera_queue(id)
);
CREATE INDEX IF NOT EXISTS ix_kosz_poz ON kosz_pozycja(kosz_id);

-- ── Read-model sprzedaży (FS/PA) do dopasowywania zwrotów ───────────────────
-- OSOBNE tabele, nie kolejne typy w sgt_dokument — ten sam argument co przy
-- sgt_zamowienie: dokument sprzedaży na liście rozkładania byłby błędem,
-- a rozdział tabel czyni go niemożliwym. Okno importu własne
-- (DOK_SPRZEDAZ_DNI_WSTECZ, domyślnie 90 dni), bo prawo zwrotu liczy się od
-- dostawy do klienta, nie od naszego okna dostaw.
CREATE TABLE IF NOT EXISTS sgt_sprzedaz (
  dok_id     INTEGER PRIMARY KEY,
  typ        TEXT NOT NULL,           -- FS | PA
  nr_pelny   TEXT NOT NULL,
  -- numer obcy/oryginalny dokumentu (MSSQL_SPRZEDAZ_NR_ORYG_COLUMN);
  -- [WERYFIKUJ] czy integracja sprzedażowa wpisuje tam numer zamówienia Allegro
  nr_oryg    TEXT,
  data_wyst  TEXT NOT NULL,           -- ISO date
  kontrahent TEXT,                    -- kh_Symbol płatnika
  uwagi      TEXT,                    -- kolumna z MSSQL_SPRZEDAZ_UWAGI_COLUMN; NULL gdy pominięta
  -- Magazyn, z którego towar wyszedł. To ON jest źródłem MM na bufor zwrotowy:
  -- korekta oddaje stan tam, skąd sprzedano, a nie zawsze jest to magazyn
  -- główny. NULL (import sprzed 0.58.0) → fallback na MAG_ID_MAG.
  mag_id     INTEGER
);
CREATE INDEX IF NOT EXISTS ix_sprzedaz_data ON sgt_sprzedaz(data_wyst);

CREATE TABLE IF NOT EXISTS sgt_sprzedaz_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_sprzedaz(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sprzedaz_poz_dok ON sgt_sprzedaz_pozycja(dok_id);
-- dopasowanie zwrotu pyta „które dokumenty mają TEN towar"
CREATE INDEX IF NOT EXISTS ix_sprzedaz_poz_tw ON sgt_sprzedaz_pozycja(tw_id);

-- Pozycje ZAMÓWIENIA, z którego przyszedł zwrot (0.56.4).
-- Biuro pyta „co klient zamawiał razem z tym, co wraca": czy odesłał całość,
-- czy jedną rzecz z kompletu, czy część zestawu została u niego. Bez tego
-- decyzja o zwrocie zapada w oderwaniu od zamówienia, a odpowiedź wymagała
-- otwarcia panelu Allegro obok.
--
-- OSOBNA tabela, nie kolumna JSON na `zwrot`: to lista wierszy, którą się
-- czyta wierszami i łączy z kartoteką po `tw_id`. Dane są SNAPSHOTEM z chwili
-- skanu — oferta potrafi zmienić nazwę albo zniknąć, a karta zwrotu ma
-- pokazywać, co kupiono wtedy.
--
-- Zwrot ręczny i zwrot bez `allegro_order_id` po prostu nie mają tu wierszy;
-- karta ukrywa wtedy całą sekcję zamiast pokazywać pustą tabelę.
CREATE TABLE IF NOT EXISTS zwrot_zam_pozycja (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zwrot_id    INTEGER NOT NULL REFERENCES zwrot(id),
  offer_id    TEXT,                -- po nim poznajemy, która pozycja WRACA
  nazwa       TEXT NOT NULL,       -- nazwa oferty (snapshot)
  external_id TEXT,                -- sygnatura sprzedawcy = symbol kartoteki
  tw_id       INTEGER,             -- dopasowana kartoteka; NULL = spoza katalogu
  ilosc       REAL NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_zwrot_zam_poz ON zwrot_zam_pozycja(zwrot_id);

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

-- Zapowiedzi zwrotów (Etap 4). Klient rejestruje zwrot w Allegro dużo
-- wcześniej, niż paczka dojedzie — ticker ściąga te zgłoszenia w tle, więc
-- skan etykiety trafia w znany zwrot bez przeszukiwania API, a zgłoszenia
-- bez paczki widać jako „brakujące paczki" zamiast nie istnieć wcale.
--
-- To DROGOWSKAZ, nie kopia zwrotu: pozycje, powody i pełny JSON przynosi
-- dopiero skan (GET szczegółu, jak dotąd). Trzymamy wyłącznie to, czym
-- panel brakujących paczek podpisuje wiersz i czym skan znajduje zgłoszenie.
CREATE TABLE IF NOT EXISTS zwrot_zapowiedz (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  allegro_return_id TEXT NOT NULL UNIQUE, -- klucz upsertu — ticker widuje ten sam zwrot wielokrotnie
  referencja        TEXT,                 -- numer, po którym biuro odnajdzie sprawę w panelu
  kupujacy_login    TEXT,
  utworzono_allegro TEXT,                 -- od tej daty liczą się dni oczekiwania na paczkę
  -- WSZYSTKIE numery paczek zgłoszenia (waybill + transportingWaybill) jako
  -- tablica JSON — skan porównuje przez json_each, bo etykieta u drzwi nosi
  -- którykolwiek z nich.
  waybills          TEXT NOT NULL DEFAULT '[]',
  --   oczekuje  = czekamy na paczkę (albo na decyzję człowieka)
  --   dotarl    = zwrot przyjęty skanem u nas
  --   pominieta = człowiek zdjął zgłoszenie z listy (sprawa załatwiona poza aplikacją)
  status            TEXT NOT NULL DEFAULT 'oczekuje',
  -- Status zwrotu PO STRONIE ALLEGRO (CREATED, IN_TRANSIT, DELIVERED, FINISHED,
  -- REJECTED, COMMISSION_*, WAREHOUSE_*). Bez niego panel „brakujące paczki"
  -- nie odróżniał sprawy zamkniętej w panelu od paczki, która naprawdę nie
  -- dojechała — i pokazywał alarm dla zwrotów rozliczonych tygodnie temu.
  status_allegro    TEXT,
  zwrot_id          INTEGER REFERENCES zwrot(id),     -- zwrot przyjęty skanem
  widziano_at       TEXT NOT NULL         -- ostatni raz w odpowiedzi API (diagnostyka tickera)
);
CREATE INDEX IF NOT EXISTS ix_zapowiedz_status ON zwrot_zapowiedz(status);
