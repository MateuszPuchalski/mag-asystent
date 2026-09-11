-- ── WERTIS · schemat bazy aplikacji (SQLite) ──────────────────────────────
-- Tabele aplikacji odwzorowują spec §7 (JSONB→TEXT JSON, TIMESTAMPTZ→TEXT ISO,
-- BIGSERIAL→INTEGER PK AUTOINCREMENT). Tabele sgt_* to read-model Subiekta GT —
-- w produkcji pochodzą z MSSQL (SELECT read-only), tu są zasilane z mag.xlsx.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- WMS prowadzi fizyczny zapas niezależnie od odświeżanego lustra ERP.
-- Snapshot kartoteki w pozycji przeżywa usunięcie lub zmianę symbolu w ERP.
CREATE TABLE IF NOT EXISTS wms_product (
  tw_id INTEGER PRIMARY KEY,
  symbol TEXT NOT NULL,
  nazwa TEXT NOT NULL,
  ean TEXT
);
CREATE TABLE IF NOT EXISTS wms_stock (
  tw_id INTEGER NOT NULL,
  bin TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0 CHECK(on_hand >= 0),
  reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved >= 0 AND reserved <= on_hand),
  minimum INTEGER NOT NULL DEFAULT 0 CHECK(minimum >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(tw_id, bin)
);
CREATE INDEX IF NOT EXISTS ix_wms_stock_bin ON wms_stock(bin, tw_id);
-- Zapas kwarantanny i zapas zaplecza są widoczne, ale nie trafiają do zbiórki.
CREATE TABLE IF NOT EXISTS wms_bin (
  bin TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('pick','reserve','quarantine')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE IF NOT EXISTS wms_order (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','allocated','picking','picked','packing','packed','shipped','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 2),
  due_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  allocated_at TEXT,
  picked_at TEXT,
  packed_at TEXT,
  shipped_at TEXT,
  picker_id INTEGER,
  packer_id INTEGER,
  tote TEXT,
  hold_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(channel, reference)
);
CREATE INDEX IF NOT EXISTS ix_wms_order_queue ON wms_order(status, priority DESC, due_at, id);
CREATE INDEX IF NOT EXISTS ix_wms_order_open ON wms_order(priority DESC, due_at, id)
  WHERE status NOT IN ('shipped','cancelled');
CREATE INDEX IF NOT EXISTS ix_wms_order_created ON wms_order(created_at);
CREATE INDEX IF NOT EXISTS ix_wms_order_shipped ON wms_order(shipped_at);
CREATE UNIQUE INDEX IF NOT EXISTS ix_wms_active_tote ON wms_order(tote)
  WHERE tote IS NOT NULL AND status NOT IN ('shipped','cancelled');
CREATE TABLE IF NOT EXISTS wms_wave (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  picker_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wms_wave_picker ON wms_wave(picker_id,id);
CREATE TABLE IF NOT EXISTS wms_wave_order (
  wave_id INTEGER NOT NULL REFERENCES wms_wave(id),
  order_id INTEGER NOT NULL UNIQUE REFERENCES wms_order(id),
  PRIMARY KEY(wave_id,order_id)
);
CREATE TABLE IF NOT EXISTS wms_line (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES wms_order(id),
  tw_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  barcode TEXT,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  picked INTEGER NOT NULL DEFAULT 0 CHECK(picked >= 0 AND picked <= quantity),
  packed INTEGER NOT NULL DEFAULT 0 CHECK(packed >= 0 AND packed <= picked),
  UNIQUE(order_id, tw_id)
);
CREATE INDEX IF NOT EXISTS ix_wms_line_tw ON wms_line(tw_id, order_id);
CREATE TABLE IF NOT EXISTS wms_allocation (
  id INTEGER PRIMARY KEY,
  line_id INTEGER NOT NULL REFERENCES wms_line(id),
  bin TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  picked INTEGER NOT NULL DEFAULT 0 CHECK(picked >= 0 AND picked <= quantity),
  UNIQUE(line_id, bin)
);
CREATE TABLE IF NOT EXISTS wms_movement (
  id INTEGER PRIMARY KEY,
  tw_id INTEGER NOT NULL,
  bin TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reserved_delta INTEGER NOT NULL,
  kind TEXT NOT NULL,
  order_id INTEGER REFERENCES wms_order(id),
  reason TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_wms_movement_stock ON wms_movement(tw_id, bin, id);
-- Pokrycie agregacji ogranicza odczyty tabeli przy ponad milionie ruchów w raporcie 90 dni.
CREATE INDEX IF NOT EXISTS ix_wms_movement_time_cover ON wms_movement(created_at, kind, delta);
DROP INDEX IF EXISTS ix_wms_movement_time;
CREATE INDEX IF NOT EXISTS ix_wms_movement_pick_report ON wms_movement(created_at, user_id, order_id, delta) WHERE kind='pick';
CREATE INDEX IF NOT EXISTS ix_wms_movement_count_report ON wms_movement(created_at, tw_id, delta) WHERE kind='count';
CREATE TRIGGER IF NOT EXISTS wms_movement_no_update BEFORE UPDATE ON wms_movement
BEGIN SELECT RAISE(ABORT, 'WMS movement is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wms_movement_no_delete BEFORE DELETE ON wms_movement
BEGIN SELECT RAISE(ABORT, 'WMS movement is immutable'); END;
CREATE TABLE IF NOT EXISTS wms_shipment (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES wms_order(id),
  package_no INTEGER NOT NULL DEFAULT 1 CHECK(package_no>0),
  carrier TEXT NOT NULL,
  tracking TEXT NOT NULL,
  weight_g INTEGER NOT NULL CHECK(weight_g > 0),
  created_at TEXT NOT NULL,
  UNIQUE(carrier, tracking),
  UNIQUE(order_id, package_no)
);
CREATE INDEX IF NOT EXISTS ix_wms_shipment_dispatch ON wms_shipment(created_at, id);
-- Odpowiedź i zmiana stanu zatwierdzają się razem, także po utracie sieci.
CREATE TABLE IF NOT EXISTS wms_command (
  key TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- Numer dokumentu chroni zapas przed ponownym przyjęciem z innej sesji.
CREATE TABLE IF NOT EXISTS wms_stock_document (
  reference TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL,
  user_id INTEGER NOT NULL
);
-- Usunięcie numeru pozwoliłoby przyjąć drugi raz ten sam dokument.
CREATE TRIGGER IF NOT EXISTS wms_stock_document_no_update BEFORE UPDATE ON wms_stock_document
BEGIN SELECT RAISE(ABORT, 'WMS stock document is immutable'); END;
CREATE TRIGGER IF NOT EXISTS wms_stock_document_no_delete BEFORE DELETE ON wms_stock_document
BEGIN SELECT RAISE(ABORT, 'WMS stock document is immutable'); END;

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
  -- Priorytet rozmowy (§10.2, 0.181.0). Dwie wartości, jak przy zadaniach
  -- terenowych — trzecia („niski") nie ma pytania, na które odpowiada, bo
  -- kolejność i tak niesie czas oczekiwania. Flaga jest RĘCZNA: automat nie
  -- ma z czego jej wyliczyć, dopóki nie ma terminu odpowiedzi (§26).
  priorytet                TEXT NOT NULL DEFAULT 'normalny'
                           CHECK(priorytet IN ('normalny','pilny')),
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
  -- Zamówienie, którego dotyczy wiadomość (0.166.0). Allegro daje `relatesTo`
  -- z DWIEMA niezależnymi gałęziami, `offer` i `order`, i wiadomość może
  -- nieść obie naraz — dlatego osobna kolumna, a nie trzecia wartość
  -- `related_object_type`. Do 0.165.0 gałąź `order` była wyrzucana przy
  -- mapowaniu, choć sonda pokazuje ją częściej niż ofertę (7 z 33 wobec 5).
  related_order_id    TEXT,
  sent_at             TEXT NOT NULL,
  -- Nasza automatyczna odpowiedź „Dziękujemy za kontakt" (0.227.0). Liczona RAZ,
  -- przy zapisie, przez `czyAutoresponder` — a nie przy każdym odczycie i nie
  -- drugi raz w SQL-u. Dwie kopie tej reguły rozjechałyby się przy pierwszej
  -- poprawce, a objawem byłaby rozmowa uznana za odpisaną, bo odbiła się echem.
  auto_odpowiedz      INTEGER NOT NULL DEFAULT 0,
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

-- ── Dobór części przy rozmowie (§11, etap E1) ──────────────────────────────
-- Nazwa z sufiksem tym samym ruchem co `sprawa_klienta` i `zwrot_klienta`:
-- `dopasowanie` stoi na liście nakładek, które `migrate()` KASUJE przy każdym
-- starcie. Tabela o tamtej nazwie powstałaby stąd i znikała sekundę później.
--
-- Jedna rozmowa = jeden dobór, więc `conversation_id` jest kluczem głównym,
-- a nie kolumną z indeksem. Pilnuje tego kształt tabeli, nie serwis — wzorzec
-- `sprawa_klienta_rozmowa`. Sprawa widzi dobory PRZEZ swoje rozmowy.
--
-- Brak wiersza znaczy `not_started` i liczy się przy odczycie: otwarcie
-- zakładki niczego nie wstawia („zero zapisu przy patrzeniu").
--
-- `wersja` jest WŁASNA, nie `conversation.version`. Tamta pilnuje przejęcia
-- i szkicu; edycja chipów doboru podnosząca ją wywracałaby cudzy szkic na 409.
--
-- Dane wejściowe §11.1 jako KOLUMNY, nie jeden JSON: etapy E2/E3 filtrują po
-- marce i modelu, a `json_extract` w każdym takim zapytaniu to skan tabeli.
-- Parametry i wymiary zostają w `parametry_json`, bo ich lista jest otwarta.
--
-- Bez klucza obcego do `sgt_towar`: import z Subiekta kasuje i odtwarza
-- read-model co `MSSQL_SYNC_MS` (blizna 0.154.0). Goły `wybrany_tw_id` plus
-- snapshot `wybrany_symbol`, jak w `oferta_kartoteka` i `ean_alias`.
CREATE TABLE IF NOT EXISTS dobor_rozmowy (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  -- DZIEWIĘĆ wartości z §7. `CHECK` jest strażnikiem dokumentu, tak jak przy
  -- `conversation.status` (0.158.0). `extracting_data` nie ma w etapie E
  -- nadawcy: serwis go odrzuca, nada mu go dopiero Copilot (etap F).
  status          TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN (
                    'not_started','extracting_data','missing_information','searching',
                    'candidates_found','requires_expert','confirmed','rejected',
                    'not_applicable')),
  wersja          INTEGER NOT NULL DEFAULT 1,
  marka           TEXT,
  model           TEXT,
  wariant         TEXT,
  rocznik         TEXT,
  nr_seryjny      TEXT,
  silnik          TEXT,
  oem             TEXT,
  nazwa_czesci    TEXT,
  parametry_json  TEXT,
  -- Czego jeszcze dopytać klienta; zdanie agenta, nie lista kodów.
  brakuje         TEXT,
  wybrany_tw_id   INTEGER,
  wybrany_symbol  TEXT,
  -- JEDENAŚCIE dróg z §11.2. `silnik` doszła z `zabudowa_silnika` (0.229.0),
  -- `pasowanie` z `pasowanie_czesci` (0.230.0), `wymiar` z `wymiar_kartoteki`;
  -- bazy sprzed tych wydań znają osiem, dziewięć albo dziesięć, więc `CHECK`
  -- przebudowuje `doborZnaDrogi()` w `migrate()` — RAZ, do kształtu
  -- docelowego. Bez tego „Wybierz" przy kandydacie z nowej drogi rzuciłby
  -- `SQLITE_CONSTRAINT` dopiero u klienta.
  wybrany_droga   TEXT CHECK (wybrany_droga IS NULL OR wybrany_droga IN (
                    'oferta','zamiennik','symbol','ean','wyszukiwarka',
                    'zastosowanie','silnik','pasowanie','oem','pelnotekst','wymiar')),
  wybrano_przez   TEXT,
  wybrano_user_id INTEGER REFERENCES app_user(user_id),
  wybrano_at      TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by      TEXT,
  updated_user_id INTEGER REFERENCES app_user(user_id)
);

-- ── Copilot: klasyfikacja wiadomości (§14, etap F) ───────────────────────
-- Odpowiada na pytanie „O CO CHODZI w tej rozmowie" i jest PROSTOPADŁA do
-- statusu, który odpowiada na „CZYJ JEST RUCH". Rozmowa `waiting_for_customer`
-- bywa reklamacją, a `new` bywa pytaniem o dostępność — mieszanie tych dwóch
-- wymiarów zepsułoby oba.
--
-- OSOBNA TABELA, nie kolumny na `conversation`, i to nie jest kwestia gustu:
-- `conversation.version` pilnuje przejęcia rozmowy i szkicu. Klasyfikacja
-- podnosząca ją wywracałaby komuś szkic na 409 W TRAKCIE PISANIA. Ten sam
-- powód dał doborowi własną kolumnę `wersja`.
--
-- Brak wiersza znaczy „nierozpoznana" i liczy się przy odczycie — otwarcie
-- kolejki niczego nie wstawia.
CREATE TABLE IF NOT EXISTS klasyfikacja_rozmowy (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  -- BEZ `CHECK` I TO JEST DECYZJA, NIE PRZEOCZENIE (blizna 0.135.0).
  -- Statusy mają `CHECK`, bo ich lista pochodzi z dokumentu i jest zamknięta.
  -- Słownik kategorii jest odwrotnością tego przypadku: ma ROSNĄĆ od pomiaru,
  -- a kategoria zwrócona spoza listy jest sygnałem, że słownik jest za krótki.
  -- `CHECK` zamieniłby każde takie odkrycie w przebudowę tabeli.
  -- Strażnik stoi w `services/copilot-klasyfikacja.ts` (`KATEGORIE`) i w typie
  -- panelu (`Record<Kategoria, string>` nie skompiluje się bez nazwy) — dwie
  -- kopie zamiast trzech, i żadna nie kosztuje migracji.
  kategoria       TEXT NOT NULL,
  pewnosc         TEXT NOT NULL CHECK (pewnosc IN ('wysoka','srednia','niska')),
  -- Jedno zdanie modelu. Służy człowiekowi do oceny trafności, nie automatowi.
  uzasadnienie    TEXT,
  -- NA CZYM liczono. Nowsza wiadomość klienta czyni etykietę nieaktualną,
  -- a rozmowa wraca do partii — bez tego pola trzeba by przycisku w rozmowie.
  message_id      INTEGER REFERENCES message(id),
  model           TEXT NOT NULL,
  at              TEXT NOT NULL,
  przez           TEXT NOT NULL,
  przez_user_id   INTEGER REFERENCES app_user(user_id),
  -- WERDYKT CZŁOWIEKA o propozycji maszyny. Bez niego trafności nie da się
  -- policzyć, a decyzja „po pomiarze zejść na tańszy model" tego wymaga.
  ocena           TEXT CHECK (ocena IS NULL OR ocena IN ('trafna','nietrafna')),
  ocenil_user_id  INTEGER REFERENCES app_user(user_id),
  ocena_at        TEXT
);

-- Księga wywołań Copilota. OSOBNO od klasyfikacji, bo zużycie należy do
-- WYWOŁANIA, nie do odpowiedzi: próba zakończona błędem nie daje wiersza
-- klasyfikacji, a kosztować może (429 po wysłaniu wejścia, ucięcie na
-- `max_tokens`, odmowa). To jest dokładnie ta część rachunku, którą najłatwiej
-- zgubić, a którą pomiar musi widzieć.
--
-- STOJĄ TU TOKENY, NIE ZŁOTÓWKI. Cennik mieszka w `services/copilot-koszt.ts`
-- z datą odczytu; kwota zapisana w bazie jest kłamstwem od dnia zmiany cennika,
-- a liczba tokenów jest faktem na zawsze.
CREATE TABLE IF NOT EXISTS copilot_wywolanie (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  -- BEZ `CHECK` z tego samego powodu, co kategoria: kolejne przyrosty etapu F
  -- (ekstrakcja, szkic, OCR) dopiszą tu swoje zadania.
  zadanie         TEXT NOT NULL,
  conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  -- Sprawa posprzedażowa (0.275.0). Reklamacja nie ma wiersza w `conversation`,
  -- więc rozpoznanie karty faktów wisi tutaj, a nie tam.
  reklamacja_id   INTEGER REFERENCES reklamacja_klienta(id) ON DELETE SET NULL,
  model           TEXT NOT NULL,
  tokeny_wej      INTEGER NOT NULL DEFAULT 0,
  tokeny_wyj      INTEGER NOT NULL DEFAULT 0,
  tokeny_cache_zapis  INTEGER NOT NULL DEFAULT 0,
  tokeny_cache_odczyt INTEGER NOT NULL DEFAULT 0,
  ms              INTEGER,
  wynik           TEXT NOT NULL CHECK (wynik IN ('ok','blad')),
  -- Klasa błędu i status. NIGDY treść wiadomości — §19 i polityka danych.
  blad            TEXT,
  przez_user_id   INTEGER REFERENCES app_user(user_id),
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_copilot_wywolanie_at ON copilot_wywolanie(at);

-- ── Copilot: szkic odpowiedzi z faktów (§14.6, etap F, przyrost drugi) ────
-- Propozycja modelu, NIE szkic agenta. Szkic agenta mieszka w
-- `conversation_draft` i pilnuje go `conversation.version`; gdyby model pisał
-- prosto tam, wywracałby komuś szkic na 409 w trakcie pisania — ten sam
-- powód, dla którego klasyfikacja dostała własną tabelę.
--
-- JEDEN WIERSZ NA ROZMOWĘ: poprzednia propozycja po nowej nie ma czytelnika,
-- a historia kosztu i tak stoi w `copilot_wywolanie`.
--
-- `ocena` to miernik z krytyki właściciela („confidence bez konsekwencji to
-- dekoracja"): odsetek szkiców, które agent wstawił albo którymi zastąpił
-- własny, jest jedyną liczbą mówiącą, czy ten przycisk jest wart pieniędzy.
CREATE TABLE IF NOT EXISTS szkic_copilota (
  conversation_id INTEGER PRIMARY KEY REFERENCES conversation(id) ON DELETE CASCADE,
  tresc           TEXT NOT NULL,
  -- JSON: zdania o tym, czego model NIE znalazł w faktach. To jest treść
  -- dla agenta, nie dla klienta — stoi nad szkicem na bursztynowo.
  zastrzezenia    TEXT NOT NULL DEFAULT '[]',
  -- JSON: identyfikatory faktów (F1, F2…), na których model oparł zdania.
  uzyte_fakty     TEXT NOT NULL DEFAULT '[]',
  -- NA CZYM liczono. Dopisek klienta czyni propozycję nieświeżą, a ekran
  -- ma to powiedzieć zamiast udawać, że szkic odpowiada na nowe pytanie.
  message_id      INTEGER REFERENCES message(id),
  model           TEXT NOT NULL,
  at              TEXT NOT NULL,
  przez           TEXT NOT NULL,
  przez_user_id   INTEGER REFERENCES app_user(user_id),
  ocena           TEXT CHECK (ocena IS NULL OR ocena IN ('wstawiony','zastapiony','odrzucony')),
  ocena_at        TEXT,
  -- DANE DOBORU ROZPOZNANE W ROZMOWIE (etap F, przyrost trzeci). JSON w kształcie
  -- `DaneDoboru`; NULL = model niczego nie znalazł albo nic nie przeszło
  -- sprawdzenia. Kolumny PRZY SZKICU, nie osobna tabela: propozycja rodzi się
  -- z tego samego wywołania i ginie z następnym, a jej los liczy się tak samo
  -- jak los szkicu. To NIE jest `dobor_rozmowy` — tam trafia wyłącznie to, co
  -- agent kliknął (blizna szarpaka: szczeble czytają tylko tamtą tabelę).
  dane_doboru     TEXT,
  -- Los propozycji danych: `wpisane` = agent kliknął i puste pola dostały
  -- wartości; `odrzucone` = odesłał. Osobno od `ocena`, bo szkic i dane mają
  -- różne losy — dobry szkic z błędnym modelem i odwrotnie.
  dane_ocena      TEXT CHECK (dane_ocena IS NULL OR dane_ocena IN ('wpisane','odrzucone')),
  dane_ocena_at   TEXT,
  -- Wersja `dobor_rozmowy` w chwili szkicu: zmiana danych doboru po szkicu
  -- czyni go nieświeżym tak samo jak dopisek klienta.
  dobor_wersja    INTEGER NOT NULL DEFAULT 0,
  -- PASOWANIE ROZPOZNANE W ROZMOWIE (etap F, przyrost czwarty). JSON
  -- {czesc:{twId,symbol,nazwa}, doCzego:{…}, rola, pozycja}; OBA końce to
  -- kartoteki z kontekstu tej rozmowy, sprawdzone przez serwer. NULL = model
  -- niczego nie nazwał albo nic nie przeszło. Przy szkicu, nie w
  -- `pasowanie_czesci`: tam trafia dopiero to, co agent kliknął — biuro
  -- rozstrzyga w kolejce Wiedza. Los osobno od losu szkicu i danych, bo
  -- każdy z nich bywa inny.
  pasowanie_propozycja TEXT,
  pasowanie_ocena      TEXT CHECK (pasowanie_ocena IS NULL OR pasowanie_ocena IN ('zaproponowane','odrzucone')),
  pasowanie_ocena_at   TEXT,
  -- ── SKĄD MODEL TO WIE (0.253.0) ────────────────────────────────────────
  -- JSON: lista `{teza, zrodlo, odwolanie, pewnosc}`. Do 0.252.0 model nie
  -- miał prawa użyć własnej wiedzy — każdy numer spoza faktów odrzucał cały
  -- szkic. Właściciel zdjął ten zakaz i postawił w jego miejsce inny warunek:
  -- „pełna swoboda, ale niech przy tym załącza źródła".
  --
  -- Ta kolumna JEST tą ceną. Wiedza własna modelu wolno wchodzi do szkicu
  -- dokładnie wtedy, gdy stoi tutaj wpisana i podpisana źródłem; zdanie bez
  -- wpisu dalej wywraca szkic. Pewność przyznaje SERWER, nie model — patrz
  -- `ustalPewnosc` w `services/copilot-szkic.ts`.
  --
  -- Przy szkicu, nie w osobnej tabeli: lista rodzi się z tego samego wywołania
  -- i ginie z następnym, tak samo jak zastrzeżenia.
  twierdzenia          TEXT NOT NULL DEFAULT '[]',
  -- ── LUKI W KARTOTECE (0.254.0) ─────────────────────────────────────────
  -- JSON: oznaczenia, które zna OFERTA, a nie zna ich nasza kartoteka.
  -- Właściciel: „jeśli jakieś numery są w ofercie, a nie ma w kartotece,
  -- zaznacz — to jest organiczna okazja do uzupełnienia danych".
  --
  -- Liczy je KOD, nie model: to porównanie dwóch list, a lista braków, która
  -- raz jest a raz jej nie ma, przestaje być listą braków. Do faktów nie
  -- wchodzi, więc model nie ma jak jej zdradzić klientowi — czego nam brakuje
  -- w danych, to zdanie o nas, nie o jego maszynie.
  luki_kartoteki       TEXT NOT NULL DEFAULT '[]'
);

-- ── Baza wiedzy zastosowań (§11.3, §11.4, §12, etap E2) ──────────────────
-- Pięć tabel zamiast dziesięciu bytów z §12 (`Manufacturer`, `Part`,
-- `Measurement`, `KnowledgeRevision`…): każda z tamtych byłaby dziś tabelą bez
-- czytelnika — blizna 0.157.0. Nazwy polskie, jak `sprawa_klienta`; żadna nie
-- stoi na liście spalonych w `bezObslugiKlienta()` (tam jest `dopasowanie`).
--
-- Model maszyny i silnika w JEDNEJ tabeli z `rodzaj`: kosiarka i jej silnik
-- to dwa wiersze, a nie dwie tabele o tym samym kształcie. `klucz` liczy
-- `kluczModelu()` z `services/wiedza.ts` przez `zwin()` z `tekst.ts`, więc
-- „NAC LS 46-450", „nac ls46450" i „Nac LS 46 450" to jedna kosiarka.
CREATE TABLE IF NOT EXISTS model_urzadzenia (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  rodzaj            TEXT NOT NULL CHECK (rodzaj IN ('maszyna','silnik')),
  marka             TEXT NOT NULL,
  nazwa             TEXT NOT NULL,
  wariant           TEXT,
  lata              TEXT,
  klucz             TEXT NOT NULL UNIQUE,
  utworzono_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  utworzono_przez   TEXT NOT NULL,
  utworzono_user_id INTEGER REFERENCES app_user(user_id)
);

-- Zastosowanie: część pasuje ALBO nie pasuje do modelu. Pozytywne i negatywne
-- w jednym wierszu z `polaryzacja`, bo kandydaci i ostrzeżenia to wtedy jedno
-- zapytanie po parze (towar, model), a sprzeczność „pasuje" kontra „nie
-- pasuje" wykrywa się w jednym miejscu. Negatyw ZAWSZE niesie powód z
-- zamkniętej listy §11.4 — pilnuje tego CHECK sprzęgający obie kolumny,
-- bo „nie pasuje" bez powodu jest ostrzeżeniem, którego nie da się sprawdzić.
--
-- Cykl życia: propozycja → zatwierdzone | odrzucone | wycofane. Propozycję
-- może złożyć automat (dobór, pomiar, w E3 opis, w F Copilot); rozstrzyga
-- WYŁĄCZNIE człowiek z biura — pilnuje tego serwis, nie baza. `opis`
-- i `copilot` stoją na liście bez nadawcy, bo CHECK nie da się rozszerzyć bez
-- przebudowy tabeli (blizna 0.135.0) — jak `extracting_data` w doborze.
--
-- Historia wersji bez `KnowledgeRevision`: wiersz jest niezmienny poza
-- stanem, poprawka to NOWY wiersz z `zastepuje_id`, a stary schodzi na
-- `wycofane`. `events` niesie pełny wiersz przy każdej zmianie.
--
-- Bez klucza obcego do `sgt_towar`: import odtwarza read-model (blizna
-- 0.154.0). `ON DELETE RESTRICT` na modelu: model z wiedzą nie znika po cichu.
-- Rozmowa może zniknąć — wiedza zostaje, bo nie jest jej własnością.
CREATE TABLE IF NOT EXISTS zastosowanie (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id                 INTEGER NOT NULL,
  tw_symbol             TEXT NOT NULL,
  model_id              INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  polaryzacja           TEXT NOT NULL CHECK (polaryzacja IN ('pasuje','nie_pasuje')),
  powod_negatywny       TEXT CHECK (powod_negatywny IS NULL OR powod_negatywny IN (
                          'nie_pasuje','tylko_inny_wariant','niewlasciwy_rozstaw',
                          'srednica_ok_inne_mocowanie','mylace_oznaczenie','wymaga_pomiaru')),
  stan                  TEXT NOT NULL DEFAULT 'propozycja'
                          CHECK (stan IN ('propozycja','zatwierdzone','odrzucone','wycofane')),
  -- `oferta` (0.264.0): propozycja zrodzona z pozycji listy zgodności oferty,
  -- przerobionej ręką biura w kolejce Wiedzy. Osobno od `opis`, bo ekran
  -- tłumaczy te wartości na zdania („z opisu kartoteki" kontra „z oferty
  -- Allegro") i bo po tym polu liczy się skuteczność źródeł.
  zrodlo_propozycji     TEXT NOT NULL
                          CHECK (zrodlo_propozycji IN ('dobor','pomiar','reczne','opis','copilot','oferta')),
  komentarz             TEXT,
  conversation_id       INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  zastepuje_id          INTEGER REFERENCES zastosowanie(id),
  zaproponowal          TEXT NOT NULL,
  zaproponowal_user_id  INTEGER REFERENCES app_user(user_id),
  zaproponowano_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rozstrzygnal          TEXT,
  rozstrzygnal_user_id  INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at     TEXT,
  powod_rozstrzygniecia TEXT,
  -- Ograniczenie tabelowe MUSI stać po kolumnach — SQLite inaczej nie parsuje.
  CHECK ((polaryzacja = 'nie_pasuje') = (powod_negatywny IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_zastosowanie_towar ON zastosowanie(tw_id, stan);
CREATE INDEX IF NOT EXISTS ix_zastosowanie_model ON zastosowanie(model_id, stan);
CREATE INDEX IF NOT EXISTS ix_zastosowanie_stan  ON zastosowanie(stan, zaproponowano_at);

-- Dowód zastosowania (§11.3) — APPEND-ONLY: kod nie ma na tę tabelę ani
-- UPDATE, ani DELETE. Dowód, który da się poprawić po cichu, przestaje być
-- dowodem. Rodzaj `decyzja_biura` stoi tam, gdzie projekt pisał „ekspert":
-- roli eksperta nie ma decyzją właściciela. `rozmowa` to ślad, nie dowód
-- techniczny — pewność liczy `pewnoscZastosowania()` w serwisie.
CREATE TABLE IF NOT EXISTS dowod_zastosowania (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  zastosowanie_id INTEGER NOT NULL REFERENCES zastosowanie(id) ON DELETE CASCADE,
  rodzaj          TEXT NOT NULL CHECK (rodzaj IN ('producent','katalog_dostawcy','pomiar_wlasny',
                    'decyzja_biura','sprzedaz_weryfikacja','rozmowa')),
  tresc           TEXT NOT NULL,
  link            TEXT,
  zadanie_id      INTEGER REFERENCES zadanie_terenowe(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  autor           TEXT NOT NULL,
  autor_user_id   INTEGER REFERENCES app_user(user_id),
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_dowod_zastosowania ON dowod_zastosowania(zastosowanie_id);

-- ── Zabudowa silnika: który silnik stoi w której maszynie (§11.2) ──────────
-- Część silnikowa — filtr, gaźnik, świeca, linka rozrusznika — pasuje do
-- SILNIKA, a kupujący zna wyłącznie model kosiarki. Bez tej relacji pytanie
-- „filtr do NAC LS 46-450" nie ma jak trafić na filtr Loncina, choć oba wpisy
-- leżą w bazie. To jest jedyny powód istnienia tej tabeli.
--
-- Wiele do wielu, w obie strony: jedna kosiarka bywa sprzedawana w dwóch
-- wersjach silnikowych, a jeden silnik stoi w setkach maszyn. Kolumna
-- w `model_urzadzenia` zapisałaby najwyżej jeden silnik na maszynę i nie
-- miałaby gdzie trzymać stanu, dowodu ani autora rozstrzygnięcia.
--
-- DLACZEGO NIE `zastosowanie`: tam `tw_id` to kartoteka Subiekta i wierzy w to
-- cała warstwa odczytu — `zaproponujZastosowanie` czyta `sgt_towar`,
-- `tw_symbol` jest NOT NULL, a `pokrycieWiedzy()` liczy wiersze bez filtra.
-- Wiersz, w którym `tw_id` znaczy „model", zatruwałby każdego z tych
-- czytelników po cichu.
--
-- DOWÓD STOI W WIERSZU, nie w osobnej tabeli. Dowody zabudowy się NIE
-- kumulują: „ten silnik stoi w tej kosiarce" ma jedno źródło naraz — IPL,
-- tabliczkę albo katalog dealera. Drugie źródło albo mówi to samo, albo mówi
-- co innego, a wtedy chcemy nowego wiersza z `zastepuje_id`, nie dopisku.
-- Fitment części kumuluje się inaczej i dlatego ma `dowod_zastosowania`.
-- `rodzaj_dowodu` jest NOT NULL, więc para bez dowodu nie powstaje wcale.
--
-- BEZ UNIQUE na parze: wycofany wiersz musi móc stać obok nowego. Dubel łapie
-- serwis, dokładnie jak przy `zaproponujZastosowanie`.
--
-- Że `maszyna_id` wskazuje wiersz o `rodzaj='maszyna'`, pilnuje SERWIS —
-- SQLite nie umie podzapytania w CHECK. `copilot` stoi na liście źródeł bez
-- nadawcy, bo rozszerzenie CHECK to przebudowa tabeli (blizna 0.135.0).
CREATE TABLE IF NOT EXISTS zabudowa_silnika (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  maszyna_id            INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  silnik_id             INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  stan                  TEXT NOT NULL DEFAULT 'propozycja'
                          CHECK (stan IN ('propozycja','zatwierdzone','odrzucone','wycofane')),
  zrodlo_propozycji     TEXT NOT NULL CHECK (zrodlo_propozycji IN ('reczne','dobor','copilot')),
  rodzaj_dowodu         TEXT NOT NULL CHECK (rodzaj_dowodu IN ('producent','katalog_dostawcy',
                          'pomiar_wlasny','decyzja_biura','sprzedaz_weryfikacja','rozmowa')),
  dowod_tresc           TEXT NOT NULL,
  dowod_link            TEXT,
  komentarz             TEXT,
  conversation_id       INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  zastepuje_id          INTEGER REFERENCES zabudowa_silnika(id),
  zaproponowal          TEXT NOT NULL,
  zaproponowal_user_id  INTEGER REFERENCES app_user(user_id),
  zaproponowano_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rozstrzygnal          TEXT,
  rozstrzygnal_user_id  INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at     TEXT,
  powod_rozstrzygniecia TEXT,
  CHECK (maszyna_id != silnik_id)
);
CREATE INDEX IF NOT EXISTS ix_zabudowa_maszyna ON zabudowa_silnika(maszyna_id, stan);
CREATE INDEX IF NOT EXISTS ix_zabudowa_silnik  ON zabudowa_silnika(silnik_id, stan);
CREATE INDEX IF NOT EXISTS ix_zabudowa_stan    ON zabudowa_silnika(stan, zaproponowano_at);

-- ── Słownik silników: co znaczy tekst z pola „Silnik" (§12) ──────────────
-- Agent (albo Copilot z rozmowy, 0.237.0) wpisuje w pole „Silnik" wolny
-- tekst: „Lonci v200", „B&S 450E". Szczebel „przez silnik" go nie czyta
-- (0.229.0) — rozbijanie na markę i nazwę byłoby zgadywaniem. Słownik to
-- LUDZKI most: biuro wpisuje, że „B&S 450E" znaczy silnik Briggs & Stratton
-- 450E, a system dopasowuje tekst DOKŁADNIE po zwinięciu (`zwin`, jak
-- `towar_identyfikator.wartosc_norm`), bez furtki na literówki.
--
-- Bez cyklu życia (propozycja/zatwierdzone), inaczej niż zabudowa: alias jest
-- zapisem ręki biura, nie propozycją automatu — pomyłkę się USUWA. Że
-- `silnik_id` wskazuje `rodzaj='silnik'`, pilnuje serwis (SQLite nie ma
-- podzapytań w CHECK — ta sama umowa, co przy zabudowie).
CREATE TABLE IF NOT EXISTS alias_silnika (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tekst         TEXT NOT NULL,
  -- `zwin(tekst)`: „B&S 450E", „b&s-450e" i „B&S450E" to jeden alias.
  tekst_norm    TEXT NOT NULL UNIQUE,
  silnik_id     INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  dodal         TEXT NOT NULL,
  dodal_user_id INTEGER REFERENCES app_user(user_id),
  dodano_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_alias_silnika_silnik ON alias_silnika(silnik_id);

-- ── Pasowanie części: uszczelka pasuje DO gaźnika (§11.2) ─────────────────
-- Klienci pytają „czy ta uszczelka pasuje do tego gaźnika" (także membrany,
-- zestawy naprawcze, łączniki kolektora). Do tej tabeli relacji część↔część
-- nie było wcale: `zastosowanie` wiąże część z MODELEM, `zabudowa_silnika`
-- model z modelem. Jedyna relacja część↔część — zamiennik — jest liczona na
-- żądanie z tekstu opisu i nigdzie nie zapisana.
--
-- KIERUNEK: `tw_id` pasuje DO `do_tw_id` (uszczelka → gaźnik). Relacja nie
-- jest symetryczna znaczeniowo — gaźnik nie „pasuje do uszczelki". Odczyt
-- jest symetryczny: ekran gaźnika czyta wiersze po `do_tw_id`, ekran
-- uszczelki po `tw_id`.
--
-- DLACZEGO NIE `zastosowanie`: tam po drugiej stronie stoi model
-- z `model_urzadzenia`, a nie kartoteka. Wiersz, w którym `model_id` znaczyłby
-- „inna część", zatruwałby każdego czytelnika tamtej tabeli po cichu.
--
-- ROLA to własność CZĘŚCI (uszczelka jest uszczelką niezależnie od gaźnika),
-- zapisana w relacji tylko dlatego, że nazwa kartoteki to wolny tekst i nie ma
-- gdzie indziej. Lista zamknięta w CHECK, bo kod na niej gałęzi się
-- (nagłówki grup); `inne` to furtka, żeby piąty rodzaj nie wymagał przebudowy.
-- NIE wyprowadzać roli z nazwy automatem — to ta sama pułapka, co rozbijanie
-- „B&S 450E" na markę i nazwę.
--
-- POZYCJA („od strony filtra", „od strony kolektora", „między dystansem") to
-- wolny tekst: cztery wiersze w danych, trzy sformułowania, czyta je człowiek
-- i klient, żaden kod się na niej nie gałęzi. Enum byłby trzecią listą do
-- pilnowania dla czterech wierszy.
--
-- DOWÓD W WIERSZU (wzorzec zabudowy): „ta uszczelka pasuje do tego gaźnika"
-- ma jedno źródło naraz; drugie albo mówi to samo, albo co innego — wtedy nowy
-- wiersz z `zastepuje_id`. `rodzaj_dowodu NOT NULL` daje „zatwierdzenie wymaga
-- dowodu" strukturalnie. Negatyw ZAWSZE z powodem z §11.4 — te powody
-- (niewłaściwy rozstaw, średnica ok inne mocowanie) są kształtu uszczelkowego.
--
-- BEZ UNIQUE: wycofany wiersz stoi obok nowego; dubel łapie serwis. BEZ klucza
-- obcego do `sgt_towar`: import odtwarza read-model (blizna 0.154.0).
-- `element_zestawu`, `opis` i `copilot` stoją w CHECK bez nadawcy — rozszerzenie
-- CHECK to przebudowa tabeli (blizna 0.135.0).
CREATE TABLE IF NOT EXISTS pasowanie_czesci (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id                 INTEGER NOT NULL,
  tw_symbol             TEXT NOT NULL,
  do_tw_id              INTEGER NOT NULL,
  do_tw_symbol          TEXT NOT NULL,
  rola                  TEXT NOT NULL CHECK (rola IN ('uszczelka','membrana','zestaw_naprawczy',
                          'lacznik','element_zestawu','inne')),
  pozycja               TEXT,
  polaryzacja           TEXT NOT NULL CHECK (polaryzacja IN ('pasuje','nie_pasuje')),
  powod_negatywny       TEXT CHECK (powod_negatywny IS NULL OR powod_negatywny IN (
                          'nie_pasuje','tylko_inny_wariant','niewlasciwy_rozstaw',
                          'srednica_ok_inne_mocowanie','mylace_oznaczenie','wymaga_pomiaru')),
  stan                  TEXT NOT NULL DEFAULT 'propozycja'
                          CHECK (stan IN ('propozycja','zatwierdzone','odrzucone','wycofane')),
  zrodlo_propozycji     TEXT NOT NULL CHECK (zrodlo_propozycji IN ('reczne','dobor','opis','copilot')),
  rodzaj_dowodu         TEXT NOT NULL CHECK (rodzaj_dowodu IN ('producent','katalog_dostawcy',
                          'pomiar_wlasny','decyzja_biura','sprzedaz_weryfikacja','rozmowa')),
  dowod_tresc           TEXT NOT NULL,
  dowod_link            TEXT,
  komentarz             TEXT,
  conversation_id       INTEGER REFERENCES conversation(id) ON DELETE SET NULL,
  zastepuje_id          INTEGER REFERENCES pasowanie_czesci(id),
  zaproponowal          TEXT NOT NULL,
  zaproponowal_user_id  INTEGER REFERENCES app_user(user_id),
  zaproponowano_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  rozstrzygnal          TEXT,
  rozstrzygnal_user_id  INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at     TEXT,
  powod_rozstrzygniecia TEXT,
  CHECK (tw_id != do_tw_id),
  CHECK ((polaryzacja = 'nie_pasuje') = (powod_negatywny IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_pasowanie_czesc ON pasowanie_czesci(tw_id, stan);
CREATE INDEX IF NOT EXISTS ix_pasowanie_do    ON pasowanie_czesci(do_tw_id, stan);
CREATE INDEX IF NOT EXISTS ix_pasowanie_stan  ON pasowanie_czesci(stan, zaproponowano_at);

-- ── Identyfikatory części z opisów (§11.2, etap E3) ─────────────────────────
-- Parser zamienników od 0.61.0 wycina z opisów kartotek tokeny, które NIE są
-- naszymi symbolami — numery OEM i katalogi obcych producentów — i wyrzuca
-- je. Ta tabela je zatrzymuje, żeby numer z pytania klienta trafiał
-- w kartotekę w drugą stronę: numer → towar. Przy odczycie byłby to skan
-- 2255 opisów regexem na każde pytanie.
--
-- To TABELA POCHODNA: wiersze `zrodlo='opis'` powstają przy przebudowie po
-- każdym imporcie z Subiekta i giną przy następnej. Wpisy `reczne` (biuro
-- dopisało numer z katalogu) przebudowa omija. Bez klucza obcego do
-- `sgt_towar` — import odtwarza read-model (blizna 0.154.0).
CREATE TABLE IF NOT EXISTS towar_identyfikator (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id           INTEGER NOT NULL,
  tw_symbol       TEXT NOT NULL,
  -- `katalog_obcy` nie ma parsera — to rezerwa dla wpisu ręcznego. CHECK
  -- zamknięty od razu, bo rozszerzenie to przebudowa tabeli (blizna 0.135.0).
  --
  -- `zamiennik` doszedł w 0.234.0 i kosztował dokładnie tę przebudowę.
  -- Numery obcych katalogów stoją w opisach nie tylko po `OEM:`, ale też po
  -- `Zamiennik:`, `Zamiennie:` i `ZAM:` — a stamtąd czytał je wyłącznie parser
  -- zamienników, który wyrzuca wszystko, co nie jest NASZĄ kartoteką. Numer
  -- z pytania klienta nie prowadził więc do towaru, choć stał w opisie.
  -- Osobny rodzaj, a nie `oem`: sekcja zamienników jest słabszym świadectwem
  -- niż numer producenta i ekran ma to mówić (§11.3).
  rodzaj          TEXT NOT NULL CHECK (rodzaj IN ('oem','nr_oryg','katalog_obcy','stare_sku','zamiennik')),
  wartosc         TEXT NOT NULL,
  -- `zwin(wartosc)`: `532 16 56-30`, `5321656-30` i `532165630` to jeden numer.
  wartosc_norm    TEXT NOT NULL,
  -- `oferta` doszło w 0.264.0 i kosztowało drugą przebudowę tej tabeli.
  -- Numery, które sprzedawca wpisał w opisie oferty Allegro, nie były
  -- wyszukiwalne: indeks czyta opisy KARTOTEK, nie ofert. Osobne źródło,
  -- a nie `opis`, bo tamte wiersze kasuje przebudowa po każdym imporcie
  -- z Subiekta, a numeru z oferty nie ma z czego odtworzyć. I nie `reczne`,
  -- bo agent go nie napisał — kliknął przycisk, a to mówi dziennik.
  zrodlo          TEXT NOT NULL CHECK (zrodlo IN ('opis','reczne','oferta')),
  dodal           TEXT NOT NULL,
  dodal_user_id   INTEGER REFERENCES app_user(user_id),
  -- Z KTÓREJ oferty. NULL dla `opis` i `reczne`. Bez tego nie da się
  -- odpowiedzieć na pytanie „skąd to się wzięło", gdy numer okaże się błędny.
  oferta_id       TEXT,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tw_id, rodzaj, wartosc_norm)
);
CREATE INDEX IF NOT EXISTS ix_towar_identyfikator_norm ON towar_identyfikator(wartosc_norm);
CREATE INDEX IF NOT EXISTS ix_towar_identyfikator_tw ON towar_identyfikator(tw_id);

-- Wymiary z nazw i opisów kartotek — szczebel „zgodne wymiary" (§11.2).
-- Blizna: klient pytał o „linkę 148 cm", katalog miał „1170x1480", a żaden
-- szczebel liczby nie czytał. TABELA POCHODNA jak `towar_identyfikator`:
-- powstaje przy przebudowie po imporcie, bez cyklu życia i bez wpisów
-- ręcznych. Czyta NAZWĘ i OPIS — wymiar w opisie nie bywa negacją, inaczej
-- niż tokeny silników. Milimetry całkowite, dokładne: tolerancja byłaby
-- zgadywaniem. Bez klucza obcego do `sgt_towar` (blizna 0.154.0).
CREATE TABLE IF NOT EXISTS wymiar_kartoteki (
  tw_id     INTEGER NOT NULL,
  tw_symbol TEXT NOT NULL,
  mm        INTEGER NOT NULL,
  -- Oryginalny zapis („1170x1480", „148 cm") do zdania źródła kandydata.
  zapis     TEXT NOT NULL,
  pole      TEXT NOT NULL CHECK (pole IN ('nazwa','opis')),
  PRIMARY KEY (tw_id, mm)
);
CREATE INDEX IF NOT EXISTS ix_wymiar_kartoteki_mm ON wymiar_kartoteki(mm);

-- Sekcje „Modele:" z opisów kartotek do PRZEROBIENIA przez człowieka.
-- Decyzja właściciela: automat nie zgaduje marki z `FS450` ani `236; 240`.
-- Jedna sekcja = jeden wiersz (`FS350 FS400 FS450` to jedna decyzja, nie
-- trzy). `INSERT OR IGNORE` po `(tw_id, tekst_norm)` sprawia, że odrzucony
-- i przerobiony wiersz nie wraca po przebudowie.
CREATE TABLE IF NOT EXISTS model_z_opisu (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tw_id               INTEGER NOT NULL,
  tw_symbol           TEXT NOT NULL,
  tekst               TEXT NOT NULL,
  tekst_norm          TEXT NOT NULL,
  -- SKĄD wziął się tekst (0.264.0). Tabela nazywa się `z_opisu`, ale niesie
  -- teraz dwa źródła: sekcje „Modele:" z opisów kartotek Subiekta oraz pozycje
  -- listy zgodności z ofert Allegro. To jedno zadanie — tekst, z którego
  -- CZŁOWIEK składa klucz modelu — więc jedna tabela i jedna kolejka.
  --
  -- Kolumna jest KONIECZNA, nie ozdobna: przebudowa po imporcie kasuje wiersze
  -- `stan='nowy'`, których nie ma w świeżym zbiorze z opisów kartotek. Wiersz
  -- z oferty nigdy w tym zbiorze nie stanie, więc bez tego rozróżnienia ginąłby
  -- przy pierwszym imporcie — bezpowrotnie, bo nie ma z czego się odrodzić.
  zrodlo              TEXT NOT NULL DEFAULT 'opis' CHECK (zrodlo IN ('opis','oferta')),
  -- Z KTÓREJ oferty; NULL dla `opis`. Człowiek w kolejce ma prawo wiedzieć,
  -- czy patrzy na wycinek opisu magazynu, czy na deklarację sprzedawcy.
  oferta_id           TEXT,
  stan                TEXT NOT NULL DEFAULT 'nowy' CHECK (stan IN ('nowy','przerobiony','odrzucony')),
  zastosowanie_id     INTEGER REFERENCES zastosowanie(id) ON DELETE SET NULL,
  rozstrzygnal        TEXT,
  rozstrzygnal_user_id INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at   TEXT,
  at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (tw_id, tekst_norm)
);
CREATE INDEX IF NOT EXISTS ix_model_z_opisu_stan ON model_z_opisu(stan, at);

-- ── Tokeny silników w NAZWACH kartotek (§12, 0.239.0) ────────────────────
-- Zapowiedź z 0.230.0: „token w nazwie kartoteki → model, wpisywany ręką
-- biura". Nazwa „Gaźnik do silników HONDA GX160" mówi wprost, do czego
-- pasuje część, ale to CZŁOWIEK wpisuje, że „GX160" to silnik Honda GX160
-- — automat nie zgaduje marki z tokenu (0.186.0). Osobno od `alias_silnika`:
-- alias to DOKŁADNY tekst pola „Silnik", token to PODŁAŃCUCH nazwy; jedna
-- tabela z flagą byłaby dwiema prawdami w jednej kolumnie. Dopasowanie po
-- `zwin` (nazwa i token bez separatorów); tylko nazwa, nigdy opis — opis
-- bywa notatką i mówi też „nie pasuje do…".
CREATE TABLE IF NOT EXISTS token_silnika (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL,
  token_norm    TEXT NOT NULL UNIQUE,
  silnik_id     INTEGER NOT NULL REFERENCES model_urzadzenia(id) ON DELETE RESTRICT,
  dodal         TEXT NOT NULL,
  dodal_user_id INTEGER REFERENCES app_user(user_id),
  dodano_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Para (token, kartoteka) z cyklem jak `model_z_opisu`: `nowa` czeka na
-- człowieka, `zatwierdzona` wskazuje zastosowanie, `pominieta` nie wraca po
-- imporcie. `nowa`, której nazwa przestała pasować, schodzi przy przebudowie.
-- Bez FK do `sgt_towar`: import odbudowuje read-model (blizna 0.154.0).
CREATE TABLE IF NOT EXISTS token_silnika_kartoteka (
  token_id             INTEGER NOT NULL REFERENCES token_silnika(id) ON DELETE CASCADE,
  tw_id                INTEGER NOT NULL,
  tw_symbol            TEXT NOT NULL,
  stan                 TEXT NOT NULL DEFAULT 'nowa' CHECK (stan IN ('nowa','zatwierdzona','pominieta')),
  zastosowanie_id      INTEGER REFERENCES zastosowanie(id) ON DELETE SET NULL,
  rozstrzygnal         TEXT,
  rozstrzygnal_user_id INTEGER REFERENCES app_user(user_id),
  rozstrzygnieto_at    TEXT,
  at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (token_id, tw_id)
);
CREATE INDEX IF NOT EXISTS ix_token_silnika_kartoteka_stan ON token_silnika_kartoteka(token_id, stan);

-- Indeks pełnotekstowy `towar_fts` (FTS5) NIE stoi w tym pliku: `db()` wykonuje
-- schemat bez try/catch, a FTS5 zależy od flag builda SQLite w Node. Tabelę
-- wirtualną zakłada `migrate()` w try/catch i wystawia `ftsDostepne()`.

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
-- Klucz naturalny `UNIQUE(message_id, file_name)` zakłada `migrate()`
-- (`zalacznikiBezDubli`), nie ten plik: bazy sprzed przyrostu „zdjęcia
-- w rozmowach" mają duplikaty, a `schema.sql` wykonuje się przed migracją.
-- Załączniki są od tego przyrostu UPSERTOWANE przy każdym przebiegu
-- (`services/zalaczniki-wiadomosci.ts`), bo `NEW` musi móc stać się `SAFE`.

-- ── Załącznik CZEKAJĄCY na wysyłkę (0.195.0) ────────────────────────────────
-- `message_attachment` opisuje pliki, które PRZYSZŁY; ta tabela — te, które
-- dopiero pójdą. Dwie tabele, bo to dwa różne byty: tamten wisi przy istniejącej
-- wiadomości, ten przy szkicu, którego wiadomością jeszcze nie ma.
--
-- Stoi przy ROZMOWIE, nie w pamięci przeglądarki, z tego samego powodu co
-- `conversation_draft`: szkic jest współdzielony z zespołem (§6.4), więc kolega
-- ma widzieć nie tylko tekst, ale i to, co do niego dołączono. Odświeżenie
-- karty nie ma prawa zgubić pliku, który poszedł już do Allegro.
--
-- `allegro_id` to identyfikator z DEKLARACJI — jego wgranie już się odbyło,
-- więc wysyłka wiadomości tylko go cytuje.
CREATE TABLE IF NOT EXISTS wysylka_zalacznik (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  allegro_id      TEXT NOT NULL,
  nazwa           TEXT NOT NULL,
  typ             TEXT NOT NULL,
  rozmiar         INTEGER NOT NULL,
  dodal_user_id   INTEGER REFERENCES app_user(user_id),
  dodano_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (conversation_id, allegro_id)
);
CREATE INDEX IF NOT EXISTS ix_wysylka_zalacznik_rozmowa
  ON wysylka_zalacznik(conversation_id);

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
  -- ── Zapis do Allegro (0.190.0) ─────────────────────────────────────────
  -- Do 0.190.0 panel zapisywał WYŁĄCZNIE fakt, że ktoś oddał pieniądze ręcznie
  -- w panelu Allegro. Te kolumny opisują nasz własny zapis przez API.
  --
  -- `zwrot_pieniedzy_command_id` powstaje RAZ na zwrot i nie zmienia się przy
  -- ponowieniu. To jest cała idempotencja tej końcówki: Allegro obiecuje, że
  -- żądanie z tym samym `commandId` nie odda pieniędzy drugi raz. Nowy
  -- identyfikator przy każdej próbie zamieniłby ponowienie po zerwanej sieci
  -- w drugi przelew.
  zwrot_pieniedzy_command_id TEXT,
  -- Numer zwrotu płatności oddany przez Allegro (`RefundDetails.id`) i status,
  -- który przy nim przyszedł. Puste przy próbie, która nie doszła.
  zwrot_pieniedzy_id TEXT,
  zwrot_pieniedzy_status TEXT,
  zwrot_pieniedzy_at TEXT, zwrot_pieniedzy_przez TEXT,
  zwrot_pieniedzy_user_id INTEGER REFERENCES app_user(user_id),
  -- Odmowa zwrotu pieniędzy WYSŁANA PRZEZ NAS. Osobno od `rejection_code`,
  -- które przyjeżdża z Allegro: pochodzenie decyzji jest tu informacją, tak
  -- samo jak przy werdykcie.
  odmowa_kod TEXT,
  odmowa_powod TEXT,
  odmowa_at TEXT, odmowa_przez TEXT,
  odmowa_user_id INTEGER REFERENCES app_user(user_id),
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
  -- Login kupującego (0.169.0). Zwrot niesie go ZAWSZE, a zamówienie bywa
  -- jeszcze niepobrane — dlatego stoi tu, a nie tylko przy zamówieniu. To
  -- jedyna dana osobowa dopuszczona przez politykę danych zwrotów wprost;
  -- imienia i nazwiska Allegro przy zwrocie nie podaje w ogóle.
  -- ── Skąd wziął się ten wiersz (0.172.0) ────────────────────────────────────
  -- `allegro` to zwrot ZGŁOSZONY przez klienta. `nieodebrana` to paczka, która
  -- wróciła sama, bo nikt jej nie odebrał — Allegro takiego bytu nie zna wcale
  -- (`CustomerReturn` powstaje z deklaracji klienta), a pieniądze i tak trzeba
  -- oddać. Bez tej kolumny obie rzeczy wyglądałyby na ekranie identycznie.
  zrodlo TEXT NOT NULL DEFAULT 'allegro' CHECK(zrodlo IN ('allegro','nieodebrana')),
  -- Numer listu przewozowego — WYŁĄCZNIE dla paczek nieodebranych i to jest
  -- świadomy wyjątek od polityki z 0.163.0. Tam numeru nie zapisujemy, bo leży
  -- w kopii odpowiedzi Allegro i tam go szukamy. Tu takiej kopii NIE MA:
  -- paczka nie ma zwrotu w Allegro, więc numer z etykiety jest jedynym
  -- uchwytem, po którym da się ją potem znaleźć skanem.
  waybill TEXT,
  notatka TEXT,
  -- ── Kiedy paczka DO NAS dotarła (0.187.0) ───────────────────────────────
  -- `paczka_at` to data NADANIA przez klienta i tylko tyle. Moment doręczenia
  -- podaje osobna końcówka `/order/carriers/{id}/tracking`, po numerze listu.
  -- Do 0.186.0 panel twierdził, że Allegro tej daty nie podaje — nieprawda
  -- wzięta ze zbyt wąskiego czytania jednego schematu.
  --
  -- Numeru listu nadal tu NIE MA (polityka 0.163.0): synchronizacja ma go
  -- w ręku podczas przebiegu i zapisuje sam WYNIK odpytania.
  dostarczono_at TEXT,
  -- Ostatni kod przewoźnika: IN_TRANSIT, NOTICE_LEFT, ISSUE, RETURNED…
  -- Bez `CHECK`, bo lista przewoźników bywa szersza niż specyfikacja Allegro
  -- (sonda złapała już `UNKNOWN` przy `carrierId`).
  przesylka_status TEXT,
  kupujacy_login TEXT,
  -- Przewoźnik z pierwszej paczki. Bez `CHECK`: Allegro nie publikuje
  -- zamkniętej listy, a sonda złapała `UNKNOWN`, którego nie ma w specyfikacji.
  przewoznik TEXT,
  -- ── Dokument sprzedaży z Subiekta (0.174.0) ─────────────────────────────
  -- Numer, po którym biuro odnajduje sprzedaż, żeby wystawić korektę. Wskazuje
  -- go CZŁOWIEK z listy kandydatów albo automat, ale wyłącznie wtedy, gdy na
  -- dokumencie stoi numer zamówienia — nakładka pozycji jest poszlaką, a zły
  -- dokument znaczy korektę do cudzej sprzedaży.
  faktura_dok_id INTEGER,
  -- Snapshot numeru i typu. Read-model `sgt_faktura` czyści się przy KAŻDYM
  -- imporcie, a dokument wypada z okna po dwóch miesiącach — bez kopii numer
  -- zniknąłby biuru z ekranu razem z nim.
  faktura_numer TEXT,
  faktura_typ TEXT,
  -- `numer` = automat po numerze zamówienia, `reczne` = wskazanie człowieka.
  -- Ta sama zasada co przy kartotece: wybór człowieka nie udaje faktu z danych.
  faktura_zrodlo TEXT CHECK (faktura_zrodlo IN ('numer','reczne')),
  faktura_at TEXT, faktura_przez TEXT,
  korekta_queue_id INTEGER REFERENCES sfera_queue(id),
  korekta_numer TEXT,
  -- `subiekt` = automat znalazł dokument korygujący, `reczne` = człowiek
  -- przepisał numer. Bez CHECK: kolumna dochodzi migracją do istniejących baz,
  -- a ALTER TABLE w SQLite nie umie dołożyć ograniczenia.
  korekta_zrodlo TEXT,
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
  -- Skąd wziął się ten wiersz (0.184.0). `allegro` = ze zgłoszenia klienta,
  -- `biuro` = dopisany u nas, bo w kartonie było więcej, niż klient zgłosił.
  --
  -- Kolumna nie jest opisem, tylko OSŁONĄ. Synchronizacja kasuje pozycje,
  -- których Allegro już nie oddaje — i skasowałaby też dopisaną, razem
  -- z oceną hali i zaznaczeniem do kwoty. Cicho, bo nic nie wygląda na
  -- zepsute, dopóki ktoś nie policzy pieniędzy.
  zrodlo TEXT NOT NULL DEFAULT 'allegro' CHECK (zrodlo IN ('allegro','biuro')),
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
  -- Oceny są DWIE od 0.209.0. „Przecena" nie prowadziła donikąd: nie dokładała
  -- do koszyka, nie ruszała stanu, nie zakładała zadania. Zdjęta razem
  -- z przyciskiem — wraca dopiero ze ścieżką przeceny, jeśli powstanie.
  ocena TEXT CHECK (ocena IN ('stan','utylizacja')),
  ocena_at TEXT, ocena_przez TEXT,
  -- ── Potrącenie za utratę wartości (0.170.0) ────────────────────────────────
  -- Ile MNIEJ oddajemy za tę pozycję, bo wróciła używana albo uszkodzona.
  -- Kwota, nie procent: klient widzi złotówki, a zaokrąglanie procentu przy
  -- każdej pozycji dawałoby końcówki, których nikt nie umie wytłumaczyć.
  --
  -- Powód jest OBOWIĄZKOWY i to nie pedanteria — jego treść trzeba pokazać
  -- klientowi, gdy zapyta, czemu dostał mniej. Bez powodu potrącenie byłoby
  -- liczbą bez uzasadnienia, czyli dokładnie tym, czego zabrania §25a.3.
  potracenie_grosze INTEGER,
  potracenie_powod TEXT,
  potracenie_at TEXT,
  potracenie_przez TEXT,
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
  -- Sygnatura oferty W CHWILI wskazania (0.219.0). Sprzedawca przepina
  -- sygnaturę, gdy towar od jednego dostawcy się wyczerpie — para zapamiętana
  -- przy dawnej sygnaturze przestaje wtedy obowiązywać. NULL = wiersz sprzed
  -- 0.219.0 albo oferta bez snapshotu; taki wiersz obowiązuje jak dotąd.
  sku_wtedy TEXT,
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
  next_attempt_at TEXT,
  -- Ile zwrotów Allegro miało jeszcze do oddania, gdy przebieg się skończył
  -- (0.209.0). Bezpiecznik stron urywał listę CICHO: przebieg kończył się
  -- sukcesem, kursor szedł naprzód, a reszta nie wracała nigdy. `NULL` znaczy
  -- „nie wiem" — Allegro nie podało liczby — i to co innego niż zero.
  pozostalo INTEGER
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
  -- Forma płatności (0.169.0). Przy zwrocie to nie ciekawostka:
  -- `CASH_ON_DELIVERY` znaczy, że nie ma karty, na którą oddać pieniądze.
  platnosc_typ TEXT,
  platnosc_at TEXT,
  -- Identyfikator płatności (0.190.0). `POST /payments/refunds` żąda go
  -- WPROST (`payment.id` w `required` schematu `InitializeRefund`), a bez
  -- niego oddanie pieniędzy przez API nie ma jak powstać. Formularz zakupowy
  -- niósł go od zawsze (`CheckoutFormPaymentReference.id`) — mapowanie brało
  -- z tego obiektu wyłącznie typ i moment.
  platnosc_id TEXT,
  -- Czy kupujący zażądał faktury. SAMA FLAGA — dane firmy z `invoice.address`
  -- niosą ulicę i miasto, a adresy nie przechodzą przez mapowanie.
  faktura_zadana INTEGER,
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

-- Pamięć NEGATYWU: numery zamówień, których Allegro nie zna (0.249.1).
--
-- Portal deweloperski pokazał 432 wywołania `GET /order/checkout-forms/{id}`
-- zakończone 404 w krótkim czasie. To nie był skok ruchu, tylko pętla bez
-- wyjścia: numer prowadzący ze zwrotu albo z wiadomości nigdy nie dostawał
-- wiersza w `zamowienie_klienta`, więc warunek `k.id IS NULL` był prawdą na
-- zawsze i ten sam zbiór ≤20 numerów wracał w KAŻDYM przebiegu tickera.
-- Brak odpowiedzi JEST odpowiedzią i trzeba go zapamiętać.
--
-- OSOBNA TABELA, a nie kolumna `brak_u_allegro_at` z wierszem-szkieletem
-- w `zamowienie_klienta`: tamta tabela jest MODELEM PRACY, który czytają
-- ekrany. Szkielet bez statusu i bez pozycji pokazałby się jako zamówienie,
-- którego nie ma, a `synced_at NOT NULL` kazałby wpisać datę czegoś, co się
-- nie wydarzyło.
--
-- NAZWA z członem `klienta`: `sgt_zamowienie` to zamówienia DO DOSTAWCY
-- z Subiekta, więc samo `zamowienie_brak` kosztowałoby czytelnika godzinę.
-- Ta sama zasada, dla której wyżej stoi `zamowienie_klienta`, nie `zamowienie`.
CREATE TABLE IF NOT EXISTS zamowienie_klienta_brak (
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  -- Kiedy Allegro ostatni raz powiedziało „nie ma".
  sprawdzono_at TEXT NOT NULL,
  -- Kiedy wolno zapytać PONOWNIE. Liczone w JS i zapisywane przez
  -- `toISOString()`, a nie wyprowadzane w SQL z `sprawdzono_at`: SQLite-owe
  -- `datetime(x,'+7 days')` oddaje `'RRRR-MM-DD HH:MM:SS'` bez `T` i bez `Z`,
  -- więc porównanie napisów z resztą dat w tej bazie by kłamało. Wzór stoi
  -- obok — `allegro_zwroty_sync_state.next_attempt_at`.
  --
  -- Porównanie jest NAPISOWE i poprawne tylko dopóki każdy piszący używa
  -- `toISOString()`, czyli UTC z `Z`. Data z przesunięciem strefy przeszłaby
  -- tędy po cichu i źle.
  ponow_po_at TEXT NOT NULL,
  -- Który to raz z rzędu. Nie jest ozdobą: wydłuża odstęp (7, 14, 21, 28 dni)
  -- i mówi operatorowi, że numer przy `prob = 10` to nie martwe zamówienie,
  -- tylko błąd mapowania po NASZEJ stronie.
  prob INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (channel_account_id, external_id)
);

-- Snapshot OFERTY kanału (0.178.0). Wiadomość niesie sam numer oferty
-- (`relatesTo.offer.id`), a mail powiadamiający z Allegro pokazuje obok niego
-- tytuł, cenę i zdjęcie. Panel pokazywał do 0.177.1 goły numer, więc agent
-- szukał towaru drugi raz — w panelu Allegro, czyli dokładnie tam, gdzie
-- `panel-obslugi-klienta.md` §25 obiecuje nie zaglądać.
--
-- SNAPSHOT, nie odczyt na żywo (§15.2): tytuł i cena mają opisywać ofertę
-- z chwili, w której klient pytał. Oferta bywa poprawiana i kończona, a
-- rozmowa sprzed tygodnia ma zostać czytelna.
--
-- ZDJĘCIE JEST OD 0.213.0, a do 0.210.0 nie było — z uzasadnieniem, które
-- zakazywało czego innego, niż się wydawało. Brzmiało: „obrazek z serwera
-- Allegro znaczyłby wyjście przeglądarki biura poza własną sieć". To jest
-- zakaz HOTLINKA i on obowiązuje dalej: `<img src="https://a.allegroimg.com/…">`
-- w panelu nie stanie. Plik ciągnie SERWER, panel dostaje go z naszej trasy —
-- czyli dokładnie tak, jak zdjęcia kartotek od 0.30.0.
--
-- Trzymamy sam ADRES, nie bajty: obraz mieszka w `zdjecie_oferty_cache`, który
-- wolno skasować w każdej chwili. Ten wiersz ma przeżyć czyszczenie cache'u.
CREATE TABLE IF NOT EXISTS offer_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  nazwa TEXT NOT NULL,
  -- SKU sprzedawcy z `external.id` OFERTY — surowo, bez normalizacji, jak
  -- w `zamowienie_klienta_pozycja`. To jest mostek do kartoteki dla pytania
  -- SPRZED zakupu, czyli tam, gdzie zamówienia jeszcze nie ma.
  sku TEXT,
  cena_grosze INTEGER,
  waluta TEXT,
  -- `publication.status` z Allegro. Bez `CHECK`: lista wartości jest po ich
  -- stronie i rośnie, a zablokowany zapis byłby gorszy niż nieznana wartość.
  status TEXT,
  -- `primaryImage.url` — zdjęcie LISTINGOWE oferty (0.213.0). Specyfikacja
  -- opisuje je wprost: „The image used as a thumbnail on the listings"
  -- (`OfferListingDtoImage`, docs/allegro/swagger.yaml). Jedzie w tej samej
  -- odpowiedzi `GET /sale/offers`, którą i tak pobieramy po tytuł i cenę, więc
  -- nie kosztuje ani jednego żądania więcej.
  --
  -- TRZY WARTOŚCI, TRZY ZNACZENIA (0.214.0). `NULL` = nikt jeszcze nie pytał
  -- Allegro o tę ofertę (wiersz sprzed 0.213.0 albo świeżo dołożony);
  -- `''` = pytaliśmy i `primaryImage` nie przyszło — `OfferListingDto` nie ma
  -- bloku `required`, więc to jest normalna odpowiedź; adres = mamy obraz.
  --
  -- Do 0.213.0 pierwsze dwa dzieliły `NULL` i nie dawało się ich rozróżnić.
  -- Kosztowało to ekran mówiący „bez zdjęcia" przy ofercie, która na Allegro
  -- zdjęcie miała — bo snapshot był po prostu starszy niż ta kolumna.
  primary_image_url TEXT,
  synced_at TEXT NOT NULL,
  -- ── TREŚĆ OFERTY DLA COPILOTA (0.253.0) ────────────────────────────────
  -- Właściciel: „często oferta ma w sobie opis, do jakich wersji pasuje,
  -- wymiary z oferty, dane techniczne". To jest wiedza, którą sprzedawca już
  -- zapisał, a Copilot odpowiadał bez niej — znał wyłącznie tytuł.
  --
  -- OSOBNA KOŃCÓWKA, więc osobna świeżość. Tytuł, cenę i zdjęcie oddaje
  -- `GET /sale/offers` po dwadzieścia ofert na żądanie; opis, parametry
  -- i listę zgodności wyłącznie `GET /sale/product-offers/{id}`, czyli jedno
  -- żądanie NA OFERTĘ. Jedna kolumna `synced_at` na oba rytmy zmuszałaby do
  -- wyboru: albo dociągamy drogi opis co dobę razem z ceną, albo trzymamy
  -- nieświeżą cenę, żeby oszczędzić opis. `tresc_synced_at` znosi ten wybór.
  --
  -- NULL znaczy „nie pytaliśmy jeszcze o treść tej oferty" i to jedyny stan,
  -- w którym sięgamy do sieci poza upływem świeżości.
  opis TEXT,
  -- `parameters[].{name, values}` — parametry techniczne WPROST, bez
  -- wyciągania ich z prozy. Wymiar stojący tu jest wart więcej niż ten sam
  -- wymiar wypatrzony w zdaniu opisu, bo sprzedawca wpisał go w pole.
  parametry_json TEXT,
  -- `compatibilityList.items[].text` — „pasuje do wersji" w formie LISTY,
  -- nie zdania. Obie odmiany listy (`MANUAL`, `PRODUCT_BASED`) oddają `text`;
  -- pozycja typu `ID` bez tekstu nie niesie nic dla człowieka i wypada.
  pasuje_do_json TEXT,
  tresc_synced_at TEXT,
  UNIQUE (channel_account_id, external_id)
);

-- ── Cache zdjęć ofert Allegro (0.213.0) ──────────────────────────────────────
-- Osobna tabela i OSOBNY KATALOG względem `zdjecie_cache`, choć oba trzymają
-- obrazy. Powód jest mechaniczny: każdy cache ma własną sprzątaczkę liczącą
-- sumę bajtów SWOICH wpisów, a dwie sprzątaczki nad jednym katalogiem kasują
-- sobie nawzajem pliki spod nóg. Powód drugi jest znaczeniowy: klucz kartoteki
-- to `tw_id` z Subiekta, klucz oferty to para (konto kanału, numer oferty).
--
-- ADRES TEŻ JEST KLUCZEM ŚWIEŻOŚCI. Sprzedawca podmienia zdjęcie w ofercie
-- i Allegro wydaje wtedy NOWY adres; ten sam adres znaczy ten sam obraz.
-- Dlatego nie ma tu TTL-a jak przy kartotekach — jest porównanie adresu.
CREATE TABLE IF NOT EXISTS zdjecie_oferty_cache (
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  -- Adres, Z KTÓREGO pobrano ten plik. Różny od `offer_snapshot` znaczy
  -- „obraz w ofercie się zmienił, pobierz od nowa".
  zrodlo_url TEXT NOT NULL,
  -- Nazwa pliku w `data/zdjecia-ofert`; `NULL` = pobranie się nie udało
  -- i `blad` mówi dlaczego.
  plik TEXT,
  mime TEXT,
  bajtow INTEGER NOT NULL DEFAULT 0,
  etag TEXT,
  pobrano_at TEXT NOT NULL,
  uzyto_at TEXT NOT NULL,
  -- Zdanie o BŁĘDZIE. Nigdy o braku zdjęcia — to dwie różne rzeczy, jak
  -- w `zdjecie_cache`.
  blad TEXT,
  PRIMARY KEY (channel_account_id, external_id)
);

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
  -- Reszta kolumn (mm_dok_id, rodzaj, powrot_queue_id, powrot_poza_aplikacja)
  -- dochodzi migracją: tabela stoi na produkcji od 0.59.0.
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
-- ── Dokumenty sprzedaży (FS/PA) — read-model wskrzeszony w 0.174.0 ──────────
-- Biuro zwrotów potrzebuje NUMERU dokumentu: po nim, i tylko po nim, odnajduje
-- sprzedaż w Subiekcie, żeby wystawić korektę. Do 0.140.0 stały tu tabele
-- `sgt_sprzedaz*`; ta nazwa jest SPALONA (migracja kasuje ją przy każdym
-- starcie), więc read-model wraca jako `sgt_faktura`.
--
-- Nazwy `kontrahent` tu NIE MA i to jest decyzja, nie przeoczenie. Stary model
-- kopiował `kh_Symbol`, a przy sprzedaży konsumenckiej bywa tam imię i nazwisko
-- człowieka — polityka danych dopuszcza wprost sam login kupującego. Tak samo
-- odpada `dok_Uwagi`: pięćset znaków dowolnego tekstu, w które ktoś kiedyś
-- wpisze adres albo telefon.
--
-- Read-model, nie prawda: wipe+insert przy każdym imporcie.
CREATE TABLE IF NOT EXISTS sgt_faktura (
  dok_id    INTEGER PRIMARY KEY,
  typ       TEXT NOT NULL,           -- FS | PA
  nr_pelny  TEXT NOT NULL,           -- „FS 1240/2026" — to widzi biuro
  -- Numer obcy z dokumentu (`dok_NrPelnyOryg`, varchar(30)). Identyfikator
  -- zamówienia Allegro jest UUID-em o 36 znakach, więc CAŁY tam nie wejdzie —
  -- kolumna zostaje, bo integracja bywa ustawiona na własny, krótszy numer.
  nr_oryg   TEXT,
  -- Identyfikator zamówienia Allegro WYCIĘTY z `dok_Uwagi` po stronie SQL
  -- (0.175.0). Samej kolumny uwag nie kopiujemy — przechodzi wyłącznie ciąg
  -- o kształcie UUID-a; uzasadnienie w `adapters/subiekt.uuid.ts`.
  -- Bez indeksu, i to celowo: kolumna dochodzi migracją, a indeks w tym pliku
  -- wywracałby start na bazie sprzed 0.175.0 (ta sama mina co przy
  -- `ix_conversation_mention_user`). Dopasowanie i tak czyta okno dat.
  zamowienie_z_uwag TEXT,
  -- Dokument KORYGOWANY (`dok__Dokument.dok_DoDokId`, 0.201.0). Niepuste tylko
  -- na korektach; po nim automat wiąże korektę ze zwrotem. Bez indeksu z tego
  -- samego powodu co przy `zamowienie_z_uwag` — kolumna dochodzi migracją.
  koryguje_dok_id INTEGER,
  data_wyst TEXT NOT NULL            -- ISO date
);
CREATE INDEX IF NOT EXISTS ix_faktura_data ON sgt_faktura(data_wyst);
CREATE INDEX IF NOT EXISTS ix_faktura_oryg ON sgt_faktura(nr_oryg);

CREATE TABLE IF NOT EXISTS sgt_faktura_pozycja (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  dok_id INTEGER NOT NULL REFERENCES sgt_faktura(dok_id),
  tw_id  INTEGER NOT NULL,
  ilosc  REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_faktura_poz_dok ON sgt_faktura_pozycja(dok_id);
-- Dopasowanie pyta „na których dokumentach stoi TEN towar" — bez tego indeksu
-- każde otwarcie zwrotu skanowałoby pozycje z całego okna importu.
CREATE INDEX IF NOT EXISTS ix_faktura_poz_tw ON sgt_faktura_pozycja(tw_id);

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

-- ── Reklamacje klienckie z Allegro (0.222.0) ────────────────────────────────
-- Allegro trzyma dyskusje i reklamacje w JEDNYM zasobie `/sale/issues`,
-- rozróżnia je polem `type` (`DISPUTE`|`CLAIM`). Panel prowadzi wyłącznie
-- reklamacje — decyzja właściciela z 6 września 2026. Filtr stoi w mapowaniu
-- synchronizatora, a nie tutaj: kolumna `typ` zostaje, bo bez niej nie dałoby
-- się pokazać, że coś odsialiśmy.
--
-- NAZWA `reklamacja_klienta`, nie `reklamacja`. Wzór ten sam co przy
-- `zwrot_klienta` i `sprawa_klienta`: krótkie nazwy po starej obsłudze klienta
-- kasuje `bezObslugiKlienta()` przy każdym starcie. `reklamacja` nie stoi na
-- tamtej liście, bo stare reklamacje żyły jako kolumny `rekl_*` w
-- `zwrot_pozycja` — ale sufiks zdejmuje to pytanie na zawsze.
CREATE TABLE IF NOT EXISTS allegro_reklamacja (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  surowe_json TEXT NOT NULL,
  synced_at TEXT NOT NULL
);

-- Model pracy. KUBEŁKA NIE MA W KOLUMNIE — wynika ze statusu i z czatu,
-- a liczy go `services/reklamacje.ts`. Ten sam powód co przy zwrotach.
CREATE TABLE IF NOT EXISTS reklamacja_klienta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_account_id INTEGER NOT NULL REFERENCES channel_account(id),
  external_id TEXT NOT NULL,
  -- `referenceNumber` — czytelny numer reklamacji, na przykład „123/2024".
  -- Specyfikacja mówi wprost: NULL dla dyskusji. Po nim szuka człowiek.
  reference_number TEXT,
  -- `checkoutForm.id`. To jest MOSTEK do reszty danych: zamówienia, zwrotów
  -- i wiadomości ze skrzynki. Innego wiązania nie budujemy (§3 planu).
  order_id TEXT,
  -- `checkoutForm.createdAt` — JEDYNA data zamówienia, jaką niesie ładunek
  -- sprawy (`PostPurchaseIssueCheckoutForm` ma dokładnie dwa pola: `id`
  -- i `createdAt`). Do 0.282.0 wyrzucaliśmy ją na etapie typu, a Copilot
  -- wypisywał „data zakupu" w liście braków — pytał o to, co przyszło z nią
  -- w tej samej odpowiedzi.
  --
  -- TO NIE JEST `boughtAt`. Kanoniczna data zakupu stoi przy POZYCJI
  -- zamówienia (`LineItem.boughtAt`) i bywa inna, gdy koszyk zbierano przez
  -- kilka dni. Gdy mamy wiersz `zamowienie_klienta`, wygrywa tamta; ta jest
  -- zawsze dostępna i dlatego zostaje. Ekran nazywa je RÓŻNIE i to jest
  -- sedno: blizna 0.121.0 wzięła się z nazwania jednego zegara drugim.
  zamowienie_at TEXT,
  offer_id TEXT,
  kupujacy_login TEXT,
  typ TEXT NOT NULL DEFAULT 'CLAIM',
  -- `right`: WARRANTY (gwarancja) albo COMPLAINT (rękojmia). Sonda z żywego
  -- konta pokazała COMPLAINT przy wszystkich 65 reklamacjach — ale to jest
  -- obserwacja jednej próbki, nie kontrakt, więc kolumna dopuszcza obie.
  prawo TEXT,
  powod_typ TEXT,
  powod_opis TEXT,
  temat TEXT,
  opis TEXT,
  -- Czego klient chce: REPAIR, EXCHANGE, REFUND albo PARTIAL_REFUND, plus
  -- kwota, jeśli ją podał. Bierzemy PIERWSZE oczekiwanie z listy — tablica
  -- `expectations` bywa dłuższa, a wiersz kolejki niesie jedno zdanie.
  oczekiwanie TEXT,
  oczekiwana_kwota_grosze INTEGER,
  waluta TEXT NOT NULL DEFAULT 'PLN',
  status_allegro TEXT,
  -- ZEGAR CZYTAMY, NIE LICZYMY. `decisionDueDate` to termin na uznanie albo
  -- odrzucenie reklamacji; poprzednia implementacja liczyła ustawowe 14 dni
  -- sama, bo nie wiedziała, że pole istnieje. NULL znaczy „Allegro terminu nie
  -- podało" i to co innego niż „termin minął".
  decyzja_do TEXT,
  status_do TEXT,
  -- Decyzja sprzedawcy o zwrocie towaru: 1 wymagany, 0 niewymagany,
  -- NULL „jeszcze nie zdecydowano". Trzy stany, więc kolumna, a nie flaga.
  -- POKAZUJEMY, nie obsługujemy: obieg magazynowy zostaje przy zwrotach.
  zwrot_wymagany INTEGER,
  -- `chatActive` — czy Allegro w ogóle przyjmie nową wiadomość. Bez tego
  -- ekran obiecywałby odpowiedź, którą Allegro odrzuci z 409.
  czat_aktywny INTEGER NOT NULL DEFAULT 1,
  wiadomosci_ile INTEGER NOT NULL DEFAULT 0,
  -- Czy rozmowę urwał NASZ bezpiecznik stron (0.273.0). Rozmowa dłuższa niż
  -- `MAKS_STRON_CZATU` × 100 wiadomości nie zmieści się w jednym przebiegu,
  -- a bez tego znaku wiersz wracałby po nią w kółko i głodził budżet innych
  -- spraw — ekran obiecywałby przy tym resztę, która nie ma skąd przyjść.
  czat_urwany INTEGER NOT NULL DEFAULT 0,
  ostatnia_wiadomosc_status TEXT,
  ostatnia_wiadomosc_at TEXT,
  -- `openedDate` — moment otwarcia albo PONOWNEGO otwarcia sprawy.
  otwarto_at TEXT NOT NULL,
  -- Kto wziął sprawę. ZNACZNIK dla reszty biura, nie zamek: reklamacja przed
  -- werdyktem nie ma żadnego zapisu, przy którym nazwisko pojawiłoby się samo.
  --
  -- DWIE KOLUMNY NA JEDNĄ RZECZ I TO JEST ŚWIADOME. `prowadzi` niesie imię
  -- i służy OKU: czip na wierszu ma zostać czytelny także wtedy, gdy ktoś
  -- zmieni nazwisko albo konto zniknie. `prowadzi_user_id` niesie tożsamość
  -- i służy MASZYNIE: po nim rozstrzyga się przełącznik znacznika oraz filtr
  -- „Moje". Porównywanie imion działa do dnia, w którym w biurze są dwie Ale —
  -- wtedy jedna zdejmuje znacznik drugiej, a objawem jest cudza sprawa
  -- w moim kubełku.
  prowadzi TEXT,
  prowadzi_user_id INTEGER REFERENCES app_user(user_id),
  prowadzi_at TEXT,
  notatka TEXT,
  -- ── Droga powrotna z notatki (0.280.0) ────────────────────────────────────
  -- Notatka jest polem SWOBODNYM, które nadpisuje ten, kto pisze ostatni.
  -- Do 0.280.0 poprzedniego zdania nie dało się odzyskać niczym: do dziennika
  -- idzie świadomie sama DŁUGOŚĆ, bo treść bywa zdaniem o kliencie,
  -- a `events` nie ma retencji (§9 architektury).
  --
  -- JEDEN SZCZEBEL, nie tabela historii. Cofnięcie jest ZAMIANĄ: bieżąca treść
  -- ląduje tutaj, więc drugie kliknięcie wraca tam, gdzie było. Tabela historii
  -- dla pola, którego nikt nie audytuje, byłaby drugim miejscem na te same
  -- dane osobowe — i drugim miejscem do sprzątania.
  --
  -- Poprzednia treść mieszka NA WIERSZU i ginie razem ze sprawą. Do `events`
  -- nie trafia ani przed cofnięciem, ani po nim.
  notatka_poprzednia TEXT,
  notatka_at TEXT,
  notatka_przez TEXT,
  notatka_user_id INTEGER REFERENCES app_user(user_id),
  -- ── Werdykt biura (przyrost trzeci) ────────────────────────────────────────
  -- OSOBNE KOLUMNY, nie `status_allegro`. Tamta kolumna należy do Allegro
  -- i przestawia ją wyłącznie synchronizacja; tu stoi to, co MY wysłaliśmy.
  -- Pochodzenie decyzji jest informacją: werdykt z Centrum Sprzedaży zostawia
  -- `werdykt` pusty przy `status_allegro='CLAIM_ACCEPTED'` i to widać.
  -- PEŁNY zbiór jedenastu wartości `ClaimStatusChangeRequest.status` od razu
  -- (blizna 0.135.0: `CHECK` nie rośnie bez przebudowy tabeli).
  werdykt TEXT CHECK (werdykt IS NULL OR werdykt IN (
    'ACCEPTED_REPAIR','ACCEPTED_REFUND','ACCEPTED_EXCHANGE','ACCEPTED_PARTIAL_REFUND',
    'REJECTED_ADDITIONAL_REQUIREMENTS_NOT_COMPLETED','REJECTED_PRODUCT_NOT_RETURNED',
    'REJECTED_PRODUCT_DAMAGED_BY_USER','REJECTED_PRODUCT_CONFORMS_TO_CONTRACT',
    'REJECTED_MINOR_DEFECT','REJECTED_OTHER','REJECTED_CLAIM_WITHDRAWN_BY_BUYER')),
  -- Wiadomość WYMAGANA przez schemat (`required: [status, message]`) i czytana
  -- przez kupującego. Kopia zostaje, bo Allegro nie oddaje jej w czacie.
  werdykt_wiadomosc TEXT,
  -- Tylko przy `ACCEPTED_PARTIAL_REFUND`; przy innych werdyktach NULL.
  werdykt_kwota_grosze INTEGER,
  werdykt_at TEXT,
  werdykt_przez TEXT,
  werdykt_user_id INTEGER REFERENCES app_user(user_id),
  -- LOS PRÓBY na wierszu, nie w osobnym outboxie: werdykt jest JEDEN na
  -- sprawę, więc tabela prób miałaby jeden wiersz na klucz. Te same cztery
  -- stany co `reklamacja_outbox.status`; `send_uncertain` rozstrzyga
  -- synchronizacja, gdy Allegro odda `CLAIM_ACCEPTED`/`CLAIM_REJECTED`.
  werdykt_status TEXT CHECK (werdykt_status IS NULL OR
    werdykt_status IN ('sending','sent','send_uncertain','send_failed')),
  -- Kod HTTP i zdanie, nigdy treść wiadomości.
  werdykt_blad TEXT,
  -- Krok „towar do odesłania?" po uznaniu — decyzja LOKALNA. Wychodzi jako
  -- wiadomość `RETURN_REQUIRED_CUSTOM` albo `RETURN_NOT_REQUIRED` przez
  -- `reklamacja_outbox` (kolumna `typ`), a `zwrot_wymagany` z Allegro zostaje
  -- potwierdzeniem, że Allegro tak to zrozumiało. Niezweryfikowane na żywym
  -- koncie — znacznik stoi w `docs/allegro-ksztalt.md`.
  zwrot_towaru TEXT CHECK (zwrot_towaru IS NULL OR zwrot_towaru IN ('wymagany','niewymagany')),
  zwrot_towaru_at TEXT,
  -- `offer.quantity` — ile sztuk oferty obejmuje sprawa. Sufit częściowego
  -- zwrotu pieniędzy, gdy klient nie podał własnej kwoty: cena × ilość.
  ilosc INTEGER,
  -- ── Prośba o zakończenie DYSKUSJI (0.245.0) ───────────────────────────────
  -- WŁASNE kolumny, nie `werdykt_*`, i to nie jest kwestia porządku. Werdykt
  -- to formalne rozstrzygnięcie reklamacji z jedenastu wartości; `END_REQUEST`
  -- jest prośbą wysłaną kupującemu w dyskusji i Allegro nigdzie nie obiecuje,
  -- że cokolwiek nią zamyka. Jedna kolumna na oba znaczenia kazałaby czytać
  -- `werdykt_status='sent'` raz jako „decyzja zapadła", raz jako „poprosiliśmy".
  --
  -- Stanu SAMEJ dyskusji tu nie ma: należy do Allegro i przychodzi
  -- w `status_allegro` po synchronizacji.
  -- DWIE wartości, nie cztery jak przy werdykcie. Porażka kodem NIE dotyka
  -- tego wiersza: zostaje w `reklamacja_outbox`, a agent może spróbować jeszcze
  -- raz — ten sam wzorzec co krok „towar do odesłania?" z 0.242.0. Na wierszu
  -- stoi więc wyłącznie to, po czym drugiej próby robić NIE WOLNO.
  zakonczenie_status TEXT CHECK (zakonczenie_status IS NULL OR
    zakonczenie_status IN ('sent','send_uncertain')),
  zakonczenie_at TEXT,
  zakonczenie_przez TEXT,
  zakonczenie_user_id INTEGER REFERENCES app_user(user_id),
  wersja INTEGER NOT NULL DEFAULT 1,
  synced_at TEXT NOT NULL,
  UNIQUE(channel_account_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_reklamacja_termin
  ON reklamacja_klienta(decyzja_do);
CREATE INDEX IF NOT EXISTS ix_reklamacja_zamowienie
  ON reklamacja_klienta(order_id);

-- Czat sprawy. Idempotencja po identyfikatorze wiadomości z Allegro — blizna
-- 0.128.0: drugi przebieg nie ma prawa robić duplikatów.
CREATE TABLE IF NOT EXISTS reklamacja_wiadomosc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reklamacja_id INTEGER NOT NULL REFERENCES reklamacja_klienta(id),
  external_id TEXT NOT NULL,
  -- `author.login` bywa PUSTY i to jest udokumentowane: schemat mówi „not
  -- present if role is ADMIN, SYSTEM or FULFILLMENT". Doradca Allegro odpisał
  -- w 61 sprawach na 100, więc to jest przypadek typowy, nie brzegowy.
  autor_login TEXT,
  autor_rola TEXT,
  tresc TEXT NOT NULL DEFAULT '',
  utworzono_at TEXT,
  UNIQUE(reklamacja_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_reklamacja_wiadomosc_czas
  ON reklamacja_wiadomosc(reklamacja_id, utworzono_at);

-- Załączniki. PLIKÓW NIE TRZYMAMY — polityka danych skrzynki z 0.143.0.
-- Zostaje nazwa i adres u Allegro; pobranie idzie przez nasz serwer, żeby
-- token firmy nie opuścił maszyny.
CREATE TABLE IF NOT EXISTS reklamacja_zalacznik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reklamacja_id INTEGER NOT NULL REFERENCES reklamacja_klienta(id),
  wiadomosc_id INTEGER REFERENCES reklamacja_wiadomosc(id),
  nazwa TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  UNIQUE(reklamacja_id, url)
);

-- Stan synchronizatora reklamacji. Osobny wiersz od zwrotów i od skrzynki, bo
-- to osobna rodzina końcówek z własnym limitem i własnym rytmem.
--
-- KURSORA NIE MA, i to jest różnica wobec zwrotów. `getListOfIssuesUsingGET`
-- nie przyjmuje ani `from`, ani filtra daty — wyłącznie `offset`, `limit`,
-- `status` i `checkoutForm.id`. Każdy przebieg czyta więc listę od początku.
CREATE TABLE IF NOT EXISTS allegro_reklamacje_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error_code INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  -- Ile spraw Allegro miało jeszcze do oddania, gdy przebieg się skończył.
  -- `NULL` znaczy „nie wiem", zero — „lista skończyła się sama". Blizna
  -- 0.127.0: rejestr widział pierwszą setkę i gubił resztę po cichu.
  pozostalo INTEGER,
  -- Ile spraw odsialiśmy jako dyskusje. Nie jest to błąd, tylko decyzja
  -- właściciela — ale liczba musi być widoczna, żeby nikt nie szukał
  -- „zaginionych" reklamacji, które nigdy reklamacjami nie były.
  dyskusji INTEGER
);

-- ── Kolejka odpowiedzi w reklamacjach (0.224.0) ─────────────────────────────
-- Jeden wiersz na PRÓBĘ wysyłki, nie na wysłaną wiadomość — dokładnie jak
-- `outbox` przy skrzynce. Bez tego rozdziału niejednoznaczny timeout nie ma
-- gdzie zostać: żądanie poszło, odpowiedź nie wróciła, a `reklamacja_wiadomosc`
-- mówiłaby albo „wysłano", albo nic — obie odpowiedzi nieprawdziwe.
--
-- OSOBNA TABELA, nie kolumna `rodzaj` w `outbox`. Tamta ma `conversation_id`
-- jako NOT NULL z kluczem obcym do `conversation` i `expected_last_message_id`
-- do `message`; reklamacja nie ma ani jednego, ani drugiego. Wspólna tabela
-- znaczyłaby dwie kolumny obce, z których zawsze jedna jest pusta.
--
-- `CHECK` z PEŁNYM zbiorem od razu — blizna 0.135.0: SQLite nie rozszerza
-- `CHECK` bez przebudowy tabeli, więc dokładanie wartości po jednej
-- kosztowałoby migrację za każdym razem.
-- Załączniki WYCHODZĄCE przy odpowiedzi w sprawie (0.274.0). Lustro
-- `wysylka_zalacznik` ze skrzynki: plik leży u Allegro od chwili dodania,
-- u nas zostaje sam numer, nazwa i rozmiar. BAJTÓW NIE TRZYMAMY.
-- ── Copilot reklamacyjny: karta faktów ze sprawy (0.275.0) ──────────────────
-- ZBIERA DANE, NIE RADZI. Kolumny opisują to, czego agent szuka w rozmowie za
-- każdym razem ręcznie; werdyktu wśród nich nie ma i nie będzie — uznanie
-- i odrzucenie są nieodwracalne wobec kupującego i należą do człowieka.
-- Każde pole niesie CYTAT (numer wiadomości), bo zdanie bez pokrycia w rozmowie
-- jest zgadywaniem, a nie faktem.
CREATE TABLE IF NOT EXISTS reklamacja_karta (
  reklamacja_id      INTEGER PRIMARY KEY REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
  usterka            TEXT,
  usterka_zrodlo     TEXT,
  kiedy              TEXT,
  kiedy_zrodlo       TEXT,
  oczekiwanie        TEXT,
  oczekiwanie_zrodlo TEXT,
  -- Listy jako JSON: to są dane DO POKAZANIA, nie do zapytań. Osobne tabele
  -- kosztowałyby dwa złączenia przy każdym otwarciu sprawy i nic nie dawały.
  dowody             TEXT NOT NULL DEFAULT '[]',
  brakuje            TEXT NOT NULL DEFAULT '[]',
  -- ── Rada maszyny (0.276.0) ────────────────────────────────────────────────
  -- Do 0.275.0 tych kolumn nie było, bo Copilot miał wyłącznie zbierać fakty.
  -- Właściciel odwrócił tę decyzję: „copilot powinien też radzić w reklamacji".
  -- BEZ `CHECK` na wartość, z tego samego powodu co przy `zadanie` w księdze:
  -- dwunasta wartość (`POPROSIC_O_DOWODY`) jest nasza, a lista Allegro może
  -- urosnąć — strażnik stoi w `REKOMENDACJE` w `services/copilot-reklamacja.ts`
  -- i w schemacie zod adaptera, czyli tam, gdzie da się go poszerzyć bez
  -- przebudowy tabeli (blizna 0.135.0).
  rekomendacja       TEXT,
  pewnosc            TEXT,
  uzasadnienie       TEXT,
  uzasadnienie_zrodlo TEXT,
  -- Czego maszyna NIE WIE. Przeciwwaga dla `pewnosc`, nie ozdoba: deklaracja
  -- „wysoka" bez ani jednej pozycji tutaj jest odrzucana przy zapisie.
  czego_nie_wiem     TEXT NOT NULL DEFAULT '[]',
  -- Trafność liczona z FAKTU: rada kontra werdykt, który agent naprawdę
  -- wysłał. Żadnej ankiety — rekomendacja jest typowana tym samym słownikiem.
  ocena              TEXT CHECK (ocena IS NULL OR ocena IN ('trafna','nietrafna')),
  ocena_at           TEXT,
  -- Które zdjęcie było którym `Z` (0.283.0). Bez tej mapy cytat `Z2` na karcie
  -- jest niesprawdzalny: agent widzi numer i nie ma jak dojść, o który plik
  -- chodziło. Sprawdzalny cytat jest całą doktryną tego modułu, więc mapa
  -- zostaje przy karcie, a nie tylko w pamięci jednego wywołania.
  -- JSON, bo to dane DO POKAZANIA, nie do zapytań — tak samo jak `dowody`.
  zdjecia            TEXT NOT NULL DEFAULT '[]',
  model              TEXT NOT NULL DEFAULT '',
  przez              TEXT,
  przez_user_id      INTEGER REFERENCES app_user(user_id),
  at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Tagi spraw posprzedażowych (0.279.0) ────────────────────────────────────
-- Właściciel poprosił o tagi w jednym celu: „abym łatwiej mógł znaleźć
-- reklamacje, którymi się zajmuję". Tag jest więc SITEM, nie ozdobą, i nie ma
-- prawa przestawiać kolejki — §14.5 rozstrzygnął to przy kategoriach Copilota,
-- a powód jest ten sam: kolejność liczy termin i czas czekania, czyli fakty.
--
-- JEDNA PARA TABEL NA OBA EKRANY, bo dyskusja i reklamacja to jeden wiersz
-- `reklamacja_klienta` rozróżniany polem `typ`. Tak samo robią
-- `reklamacja_wiadomosc` i `reklamacja_zalacznik_wysylki`.
--
-- NAZWA `sprawa_tag` JEST SPALONA NA ZAWSZE (`db/db.ts`) i to nie jest
-- ciekawostka: lista spalonych nazw chodzi przy KAŻDEJ migracji, więc tabela
-- nazwana tak powstałaby stąd i znikała sekundę później, po cichu i bez błędu.
CREATE TABLE IF NOT EXISTS reklamacja_tag (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  nazwa            TEXT NOT NULL,
  -- Tag się WYŁĄCZA, nigdy nie kasuje. Skasowany zniknąłby po cichu ze spraw
  -- historycznych, a wtedy „dlaczego ta sprawa stała trzy tygodnie" traci
  -- odpowiedź. Wyłączony nie podpowiada się przy nowej sprawie i tyle.
  aktywny          INTEGER NOT NULL DEFAULT 1,
  utworzyl_user_id INTEGER REFERENCES app_user(user_id),
  utworzono_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Jednoznaczność po MAŁYCH LITERACH: „Gwarancja" po „gwarancja" to jeden tag
-- w głowie i dwie pigułki w filtrze. Indeks na wyrażeniu, bo `COLLATE NOCASE`
-- w SQLite nie zna polskich znaków — „Część" i „część" przeszłyby obok siebie.
CREATE UNIQUE INDEX IF NOT EXISTS ux_reklamacja_tag_nazwa
  ON reklamacja_tag(lower(nazwa));

CREATE TABLE IF NOT EXISTS reklamacja_tag_sprawy (
  reklamacja_id INTEGER NOT NULL REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
  tag_id        INTEGER NOT NULL REFERENCES reklamacja_tag(id) ON DELETE CASCADE,
  dodal_user_id INTEGER REFERENCES app_user(user_id),
  dodano_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Klucz z dwóch kolumn zamiast własnego `id`: ten sam tag na tej samej
  -- sprawie drugi raz nie jest drugim faktem, tylko drugim kliknięciem.
  PRIMARY KEY (reklamacja_id, tag_id)
);
CREATE INDEX IF NOT EXISTS ix_reklamacja_tag_sprawy_tag
  ON reklamacja_tag_sprawy(tag_id);

CREATE TABLE IF NOT EXISTS reklamacja_zalacznik_wysylki (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reklamacja_id  INTEGER NOT NULL REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
  allegro_id     TEXT NOT NULL,
  nazwa          TEXT NOT NULL,
  typ            TEXT NOT NULL,
  rozmiar        INTEGER NOT NULL,
  dodal_user_id  INTEGER REFERENCES app_user(user_id),
  dodano_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (reklamacja_id, allegro_id)
);
CREATE INDEX IF NOT EXISTS ix_reklamacja_zalacznik_wysylki_sprawa
  ON reklamacja_zalacznik_wysylki(reklamacja_id);

CREATE TABLE IF NOT EXISTS reklamacja_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reklamacja_id INTEGER NOT NULL REFERENCES reklamacja_klienta(id) ON DELETE CASCADE,
  -- Klucz wylicza SERWER (`services/idempotencja.ts`), nigdy panel. Gdyby
  -- podawał go klient, podwójne kliknięcie z dwiema zakładkami dałoby dwa
  -- klucze i dwie wiadomości u kupującego.
  idempotency_key TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  -- `MessageRequest.type`. Do przyrostu trzeciego zawsze `REGULAR`; krok
  -- „towar do odesłania?" wysyła `RETURN_REQUIRED_CUSTOM` albo
  -- `RETURN_NOT_REQUIRED` tą samą końcówką, więc typ jest cechą PRÓBY.
  -- `RETURN_REQUIRED_SELLER_LABEL` w zbiorze od razu (blizna 0.135.0), choć
  -- etykiety od sprzedawcy panel jeszcze nie wysyła.
  --
  -- `END_REQUEST` doszedł w 0.245.0 razem z ekranem dyskusji i jest jedyną
  -- wartością, której Allegro NIE przyjmie przy reklamacji („`END_REQUEST` is
  -- only allowed for disputes"). Odwrotnie niż trzy `RETURN_*`, które są
  -- wyłącznie dla reklamacji — jeden zbiór na dwa rodzaje spraw, bo skrzynka
  -- nadawcza jest jedna, tak jak tabela spraw.
  typ TEXT NOT NULL DEFAULT 'REGULAR' CHECK (typ IN
    ('REGULAR','RETURN_REQUIRED_SELLER_LABEL','RETURN_REQUIRED_CUSTOM',
     'RETURN_NOT_REQUIRED','END_REQUEST')),
  expected_wersja INTEGER NOT NULL,
  -- Ostatnia wiadomość NIE NASZA w chwili pisania. Punktem odniesienia jest
  -- rola autora, bo `reklamacja_wiadomosc` nie ma kolumny kierunku — a doradca
  -- Allegro (`ADMIN`) zmienia treść odpowiedzi tak samo jak dopisek klienta.
  expected_last_message_id INTEGER REFERENCES reklamacja_wiadomosc(id) ON DELETE SET NULL,
  status TEXT NOT NULL
    CHECK (status IN ('sending','sent','send_uncertain','send_failed')),
  -- Numer nadany przez Allegro. Po niejednoznacznym timeoucie zostaje pusty
  -- i dopiero synchronizacja rozstrzyga, czy wiadomość tam jest.
  external_message_id TEXT,
  blad TEXT,
  created_by INTEGER NOT NULL REFERENCES app_user(user_id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_reklamacja_outbox_sprawa
  ON reklamacja_outbox(reklamacja_id, id);
