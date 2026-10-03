# Architektura WERTIS

Dokument dla kogoś, kto ma ten system utrzymywać albo rozszerzać. Opisuje, **jak
to jest zbudowane i dlaczego tak**. Wdrożenie opisuje `DEPLOY.md`, podpięcie
Subiekta `docs/subiekt-gt-edu-setup.md`, a historię `CHANGELOG.md` i git.

## 1. Po co to istnieje

Subiekt GT wie, ile czegoś jest na magazynie, ale nie wie, **gdzie to leży**.
W magazynie o 342 m² z ~3600 kartotekami znalezienie towaru jest więc zadaniem
pamięciowym. WERTIS dokłada Subiektowi tę warstwę, a obok niej obsługę klienta
Allegro. Do Subiekta pisze **wyłącznie to, co wymienia tabela niżej** — z tego
zdania wynikają wszystkie granice opisane dalej.

| co | gdzie | kto | warunek |
|---|---|---|---|
| pole lokalizacji | `tw__Towar.tw_Pole1..8` (konfigurowalne) | worker Node | zawsze |
| podstawowy kod kreskowy | `tw__Towar.tw_PodstKodKresk` | worker Node | osobny `GRANT UPDATE` |
| zdjęcie kartoteki | tabela zdjęć Subiekta (`INSERT`) | worker Node | `ZDJECIA_DODAWANIE` i `GRANT INSERT` |
| MM, korekta ze zwrotem, ZW | Sfera COM (`sfera-worker/`) | worker Sfery | `SFERA_WORKER=1` |

Każdy zapis idzie przez kolejkę `sfera_queue`, a każde prawo zapisu to osobny
`GRANT`. Bez niego funkcja nie pada: zadanie czeka ze statusem `error`, a kod
nadany kartotece działa na kolektorze od razu (`ean_alias`). **Procesy Node nie
tworzą dokumentów, nie zmieniają stanów i nie ruszają cen.** Bez workera Sfery
najgorsze, co WERTIS może zrobić Subiektowi, to zły adres w polu kartoteki.
Worker Sfery świadomie rozszerza pole rażenia o dokumenty, więc ma osobne
bramki wdrożenia (`docs/wdrozenie.md`), a zmiany jego kodu czekają na zgodę
właściciela (`.github/workflows/zgoda.yml`).

## 2. Rzut oka

```
Kolektor (Android: :core logika, :app ekrany)   Panel biura (React, /obsluga)
            └──────── REST/JSON po HTTP w LAN, nagłówek x-session ────────┘
                                      │
      wertis-api — Fastify 5 + TypeScript; migruje schemat, trasy, takty (§10)
      SQLite (node:sqlite, WAL): server/data/wertis.db
         │ ta sama baza              │ ta sama baza            │ HTTP, pętla lokalna
   wertis-worker (Node)      wertis-sfera (C#, opcja)     wertis-tlo (C#, opcja)
   lokalizacja, kod, zdjęcie MM, korekta, ZW przez COM   zdjęcie bez tła
         └──────── MSSQL Subiekta GT ─┘   (odczyt do sgt_* co MSSQL_SYNC_MS)
```

Na zewnątrz serwer rozmawia z Allegro i, przy włączonym Copilocie, z dostawcami
modeli (§11). Panel serwuje proces API z `dist/web/obsluga`. **Obszary bazy**
(`server/src/db/schema.sql`): rozkładanie i wyjątki (`delivery*`, `problem`,
`ean_*`), kosze i kartony (`kosz*`), zlecenia dla hali (`zadanie_terenowe`),
rotacja (`zbiorka`, `strefa_regula`), zdjęcia i logo, kolejka zapisów
(`sfera_queue`), tożsamość (`app_user`, `device_session`), audyt i pomiar
(`events`, `migawka_dnia`, `raport_tygodnia`), meldunki procesów
(`process_state`), read-model Subiekta (`sgt_*`), surowe lądowiska Allegro
(`allegro_*`), sprawy klienta (`conversation*`, `outbox`, `zwrot_klienta*`,
`reklamacja_*`, `klient_*`) oraz Copilot i wiedza o częściach (`copilot_*`,
`pasowanie_*`, `towar_identyfikator`). Obok stoi indeks FTS5 kartoteki. Dane
osobowe przechodzące z lądowisk do spraw pilnuje
`server/src/db/prywatnosc-schematu.test.ts`.

## 3. Dlaczego osobne procesy

API i worker to **osobne procesy z tą samą bazą**. Zapis do Subiekta potrafi
się zawiesić, a COM Sfery nie jest thread-safe. Gdyby zapisywał proces
obsługujący skany, jedno zawieszenie zamrażałoby **cały magazyn**. Skan
odpowiada więc od razu, bo API tylko wpisuje wiersz do kolejki (cel p95: 150 ms,
mierzony na kolektorze przez `scan_timing`). Zapis ponawia się bez wiedzy
magazyniera (3 próby, 5 s / 30 s / 2 min), a zatrzymany worker zostawia zadania
w kolejce. Cena: stan w Subiekcie jest opóźniony o sekundy, więc karta towaru
pokazuje stany **skorygowane o kolejkę** (`services/stock.ts`) i chipy „w drodze”.

**Schemat bazy ma jednego właściciela: API, przy starcie.** Pozostałe procesy
bazę otwierają, ale schematu nie dotykają. Migracja w każdym procesie kładłaby
wszystkie naraz, a NSSM zrobiłby z tego pętlę restartów. Worker, który zastanie
stary schemat, czeka i próbuje dalej.

**Trzeci proces: worker Sfery (`sfera-worker/`, opcjonalny).** Dokumentu nie da
się wystawić SQL-em: numeracja, skutki magazynowe i wycena to domena Sfery COM,
a COM żyje tylko na Windows z Subiektem. Worker w C# bierze wyłącznie zadania
dokumentowe (`mm`, `korekta_zwrot`, `zw`). Bez `SFERA_WORKER=1` takie zadanie
kończy się czytelnym błędem, a dokument wystawia biuro. Przy `SFERA_WORKER=1`
worker Node nie dotyka zadań dokumentowych (`pickTask` w `worker/kolejka.ts`).
Worker Sfery pomija zadanie, dopóki wcześniejsze `set_location` tego towaru nie
wejdzie (`sfera-worker/sql/pick_mm_pending.sql`, niezmiennik z §5). Te same
pliki SQL wykonuje `server/src/worker/sfera-pick.test.ts`, więc guard jest
mierzony w CI bez dotneta. Szczegóły:
[`sfera-worker/README.md`](../sfera-worker/README.md).

**Czwarty proces: usługa tła (`tlo-worker/`, opcjonalna).** Wycinanie tła wymaga
runtime'u ONNX, czyli modułu natywnego. Serwer nie ma modułów natywnych, bo
instaluje się go bez kompilatora na maszynie biura. Usługa słucha na pętli
lokalnej (`TLO_URL`); bez niej zdjęcie zapisuje się z tłem. Szczegóły:
[`tlo-worker/README.md`](../tlo-worker/README.md).

## 4. Granica do Subiekta — adaptery

Cała wiedza o Subiekcie siedzi za dwoma interfejsami. Reszta kodu nie wie, czy
pracuje na prawdziwej bazie, czy na demo.

**Odczyt** to `adapters/subiekt.ts` (`subiekt.seeded.ts` z `products.json`,
`subiekt.mssql.ts`). **Zapis** to `adapters/sfera.ts` (`sfera.dev.ts` mutuje
`sgt_*`, `sfera.sql.ts` robi UPDATE i INSERT w MSSQL, dokumenty `sfera-worker/`).
Wybór to **jeden przełącznik**: `SGT_MODE=seeded|mssql`. Adapter zapisu wynika
ze źródła danych (`config.sferaMode`), więc nie da się czytać z demo i pisać do
produkcji. `SFERA_WORKER` wybiera tylko **wykonawcę** zadań dokumentowych
i wymaga `SGT_MODE=mssql` (walidacja w `config.ts`).

**Czego ta granica NIE przepuszcza: okna Subiekta.** Kliknięcie w numer
dokumentu w panelu nie otworzy go w Subiekcie. Okno wystawia **program na
stanowisku**: przeglądarka nie sięga do COM, a Sfera na serwerze otworzyłaby
okno na maszynie, której nikt nie ogląda. Wymagałoby to na KAŻDYM stanowisku
protokołu `wertis://dokument/<dok_id>`, programu lokalnego i licencji Sfery — to
ostatnie jest decyzją zakupową. Czy Sfera umie POKAZAĆ istniejący dokument, jest
pytaniem otwartym w `docs/subiekt-gt-struktura.md`. Do tego czasu numer ma
przycisk kopiowania do „Znajdź dokument” Subiekta.

**Read-model `sgt_*`.** Serwer **nie odpytuje MSSQL przy każdym skanie**.
Importer kopiuje kartoteki, stany i dokumenty do `sgt_*` przy starcie, co
`MSSQL_SYNC_MS` (domyślnie 60 s) i na żądanie (`POST /api/admin/resync`). Potem
`services/po-imporcie.ts` odbudowuje identyfikatory, sekcje „Modele:” i indeks
FTS5. Baza Subiekta stoi na maszynie, na której biuro wystawia faktury, więc
odpytywanie jej w rytmie skanów obciążałoby tę pracę. Do rozkładania wystarczy
stan sprzed minuty.

**Stan to nie to samo co „leży w regale”**, bo dokument krajowy księguje towar
na MAG, zanim zejdzie z palety. Karta pokazuje więc „w dostawie, nierozłożone”
(`services/dostawy-towaru.ts`). Kryterium „co jest dostawą” stoi w jednym
miejscu, obok `listDeliveryDocuments`, bo dwie kopie liczyłyby towar podwójnie.

## 5. Rozkładanie i przesunięcie stanu

Kroki i reguły opisuje `docs/analiza-rozkladanie.md`. **Rozkładanie jest
jedno** i zapisuje wyłącznie adres. Po odłożeniu na `MAG` (dostawa krajowa) nie
zostaje nic, a na `MGP` (kontener) zostaje stan do przesunięcia na halę.
O skutku decyduje **magazyn, nie typ dokumentu**, bo ten sam `dok_Typ` bywa
księgowany na różne magazyny. **Przesunięcie stanu jest osobną czynnością**
z karty towaru albo z wiersza dostawy; MM wystawia worker Sfery albo biuro.

**Niezmiennik: adres przed sprzedawalnością.** `set_location` trafia do kolejki
**przed** `mm`, inaczej handlowiec widziałby towar, a magazynier nie wiedziałby,
gdzie po niego iść. **Pomyłkę w liczeniu odkręca korekta (`korygujIlosc`), nie
wyjątek.** `ilosc_odlozona` jest licznikiem po stronie WERTIS, a wyjątek jest
twierdzeniem wobec dostawcy i idzie do protokołu. Blokad pozycji nie ma, bo
dostawę rozkłada jedna osoba; podwójne odłożenie poprawia ta sama korekta.
**Notatka biura trzyma dostawę otwartą**: bramka stoi w `closeIfComplete`, bo
ostatnie odłożenie też domyka dostawę. **Karton jest rodzajem kosza** (tabela
`kosz`, kolumna `rodzaj`), bo po zatwierdzeniu rozkłada się co do znaku jak
kosz. Dla kartonu `zakonczKosz` nie kolejkuje dokumentu: towar nie opuścił
magazynu.

## 6. Tożsamość

**Login i hasło → token sesji urządzenia.** Hasło leży w `app_user` jako hasz
(scrypt, sól per konto, porównanie stałoczasowe), minimum osiem znaków. Każda
operacja niesie `user_ref`. Nagłówek `x-user` zostaje podpowiedzią nazwy,
kodowaną procentowo w UTF-8 (`userOf()`), bo OkHttp odmawia polskiej litery.
Nieznany login i błędne hasło wyglądają identycznie, także w czasie odpowiedzi,
bo czas zdradzałby istniejące konta. Pięć pomyłek zamyka login na minutę
odpowiedzią 429, nie 401: kolektor po 401 kasuje operację z bufora offline.
Login jest daną osobową, więc `GET /api/users` dostają tylko role biura. Kont
się nie kasuje (`active = 0`), bo `events` musi mieć na co wskazywać.

**Sesja nie wygasa sama** — trwa do wylogowania, bo kolektory nie opuszczają
hali. **Role:** `magazynier`, `biuro`, `admin`. Role biura bierze się
z `ROLE_BIUROWE` (`services/users.ts`). Operacje uprzywilejowane — konta,
domknięcie dostawy poza WERTIS, zwrot pieniędzy, werdykt reklamacji,
konfiguracja i aktualizacja serwera — stoją w jednej tabeli w
`services/auth.ts` i przechodzą przez `autoryzuj()`. Drugiego czynnika nie ma:
porzucony zalogowany kolektor pozwala na wszystko, co może jego właściciel.

**Pierwsze konto** powstaje bez sesji (`POST /api/users`) z panelu albo
z kreatora na kolektorze, z wymuszoną rolą `admin`. Furtka zamyka się przy
pierwszym koncie Z LOGINEM, bo konta-ślady po migracji zamknęłyby ją na każdej
istniejącej instalacji. W trybie `seeded` pusta baza dostaje konto demo
`admin`/`admin`; w `mssql` nie powstaje nigdy.

**Aktualizacja kolektora idzie z serwera.** APK leży w `server/data/apk/`,
a wersję niesie nazwa pliku. `GET /api/aktualizacja` i `/api/aktualizacja/apk`
są poza bramką sesji, bo zepsutej aplikacji nie da się inaczej doprowadzić do
logowania. Do APK nie wolno więc wbudować niczego tajnego. Obcy plik odrzuca
Android po PODPISIE, a suma SHA-256 chroni tylko transport. Klucz wydania jest
zabezpieczeniem nośnym i nie leży w repozytorium.

## 7. Klasyfikacja skanu — jedno źródło reguły

```
prefiks LOC:   →  adres (etykieta QR)
wzorzec adresu →  adres          A01-02-03 (2 myślniki) | PAL-042
13 cyfr        →  EAN
reszta         →  tekst (wyszukiwarka)
```

**`LOC` jest kategorią ZAMKNIĘTĄ**: kod spoza wzorca adresem nie jest. Wzorzec
należy do serwera (`config.locPatterns`), a kolektor pobiera go z
`GET /api/locations`. Adres i symbol są rozłączne **po liczbie myślników**;
reguła w kilku kopiach pozwoliłaby symbolowi `W32-0203` zapisywać widmowe
adresy. Przed pobraniem reguły adresem jest tylko kod z prefiksem `LOC:`.

**Kontekstem jest otwarty ekran**: skan regału przy otwartej karcie nadaje
adres TEMU towarowi, bez karty pokazuje regał, a skan towaru otwiera kartę.
Ukrytego stanu między skanami nie ma, bo adres na złym towarze to błąd cichy.

## 8. Offline

Magazyn ma martwe punkty Wi-Fi, więc bufor jest wymaganiem. **Buforujemy tylko
awarie sieci**; błąd serwera (`ApiError`) idzie do UI, bo zbuforowana odmowa
wracałaby w kółko. Przejściowe 5xx, 408 i 429 zostawiają operację w buforze.
Operacja z bufora niesie **konto autora z chwili wykonania**
(`x-buffered-user`), żeby praca Jana nie dostała nazwiska Piotra, który przejął
kolektor.

## 9. Audyt i pomiar

`events` to jedyna tabela, do której piszą wszystkie warstwy; każda mutacja
woła `logEvent`. Kolektor przysyła tylko typy z listy w `routes/device.ts`.
Wiersz niesie `user_id`, `user_ref`, `device_id` i payload JSON. Historii **nie
kasujemy i nie nadpisujemy**; zdarzenie bez autora zostaje z `NULL`. **`events`
nie ma retencji**: to rząd 10⁵ wierszy rocznie, a reklamacja przychodzi po
miesiącach. O archiwizacji decyduje właściciel, nie kod, więc do `events` nie
trafia treść, którą trzeba by kiedyś skasować.

Raporty: cztery liczby (`GET /api/metrics`: dotknięcia na pozycję, p95 skanu,
etykiety do przedruku, towary bez kodu), rekoncyliacja (`GET /api/reconcile`,
`npm run reconcile`; zerowy wynik nie tworzy raportu), analiza
(`GET /api/analiza` + `/csv`), przeslotowanie (`npm run reslot`, 1–2× w roku),
kandydaci do strefy złotej (`GET /api/biuro/zbiorki/kandydaci`) i ślad audytowy
(`GET /api/events` + `/csv`, role biura).

**Łańcuch „poprosił → wykonane” jest pełny.** Po `location_set` oba workery
dopisują `queue_applied`, `queue_retry` albo `queue_failed`, z autorem
z `sfera_queue.created_by_ref` (strona C#: `sfera-worker/src/Queue.cs`).
Odrzucone żądania zapisuje hook `onSend` jako `http_rejected`. **Ciała żądania
nie zapisujemy nigdy**, bo przez `POST /api/users` idzie hasło
(`routes/audyt.test.ts`). `BEZ_AUDYTU_404` w `context.ts` wycisza 404 tras
pytanych przy każdym rysowaniu wiersza, gdzie „nie ma” jest normą. Śladu nie
zostawi operacja z bufora urządzenia, które zginie przed powrotem sieci.
Odrzuconą trwale kolektor zgłasza jako `klient_odrzucona`.

**Raport wydajności to monitoring pracowniczy.** Raport per osoba podlega
Kodeksowi pracy (art. 22² i nast.): wymaga zapisu w regulaminie albo
obwieszczeniu i uprzedzenia pracowników **2 tygodnie przed** uruchomieniem.
Odpowiedź niesie pole `podstawaPrawna`. Raport widzi tylko admin
w `GET /api/analiza`; biuro dostaje `wydajnosc: null`. Sprawy klienta też nie mają
zestawień per osoba (`docs/obsluga-klienta-calosc.md`). Reguły raportu mają
testy: zgłoszony problem nie obciąża zgłaszającego, kolumny błędów nie ma, a
tempo poniżej 20 pozycji to `null`.

**Migawka doby i raport tygodnia.** `events` pamięta czynności, nie stan.
Takt `raporty` (§10) zapisuje `migawka_dnia` tymi samymi funkcjami co ekrany
i zamrożony `raport_tygodnia`; zmiana reguły podbija `WERSJA_RAPORTU`. Raport
nie niesie ludzi. `pominiecia_dzien` liczy rozmowy zostawione bez ruchu, bez
autora i godziny, i nie woła `logEvent` (`services/tarcie.ts`).

## 10. Praca w tle — takty

Pracę w tle uruchamia wyłącznie `main()` w `server/src/index.ts`, nigdy
`buildApp()`. Testy tras nie mają prawa strzelać do Allegro ani wydawać
pieniędzy na model. Każda pętla idzie przez `uruchomTakt`
(`services/takt.ts`): rozrzut ±10% odstępu, losowy start i odczekanie
`Retry-After` po 429. Równy rytm kilku pętli z jednego adresu wygląda dla
Allegro jak maszyna i skończył się już blokadą IP.

Takty Allegro (skrzynka, zwroty, rabaty, reklamacje, zamówienia, oferty,
dosyłki, sonda rzeczywistości) wymagają `ALLEGRO_CLIENT_ID` i trybu `http`.
Takty modelu (auto-szkic, auto-klasyfikacja, szkice przed pracą, automat wiedzy,
pasowanie z sieci) wymagają przełącznika w `wertis.env` i klucza. Zawsze chodzą
`noc` (kopia bazy, rekoncyliacja), `raporty`, `wydania` i `autoaktualizacja`.
Każda końcówka Allegro ma **własny takt**, żeby błąd jednej nie zabierał
drugiej. Kopia bazy to `VACUUM INTO`, w nocy i przed każdą migracją, bo zwykłe
kopiowanie w trybie WAL gubi zapisy.

**Allegro.** Klient HTTP stoi w `adapters/allegro.http.ts`, a kształt czyta się
z `docs/allegro/swagger.yaml`, nie z pamięci. Dane lądują w surowych tabelach
`allegro_*`, a do spraw przechodzą tylko pola opisane w
`docs/obsluga-klienta.md`. Wysyłki idą przez `outbox`, jeden wiersz na próbę,
żeby niejednoznaczny timeout miał gdzie zostać. Kolejki — skrzynka, zwroty,
reklamacje, dyskusje — są NASZE, nie klienta. `services/droga-klienta.ts`
wiąże je po numerze zamówienia w obie strony (`docs/obsluga-klienta-calosc.md`).

## 11. Copilot

Tekst dla klienta układa Claude, wołany wyłącznie z
`adapters/copilot.anthropic.ts` — to jedyny import `@anthropic-ai/sdk`.
Rozpoznawanie wiadomości klientów robi Jev z TypeSafe
(`adapters/copilot.jev.ts`), gdy stoi `TYPESAFE_API_KEY`, a bez klucza ten sam
Claude. Jev nie generuje tekstu, więc szkice zostają przy Claude. Klasyfikację
woła się przez `nadawcaKlasyfikacji` (`adapters/copilot.klasyfikator.ts`),
żeby wszystkie drogi szły do jednego dostawcy. Sam klucz jest przełącznikiem,
bo osobny przełącznik dawał stan „Jev bez klucza” bez rozpoznawania. Głównym
wyłącznikiem jest `COPILOT_MODE`. Każde wywołanie modelu bez kliknięcia ma
własny przełącznik, domyślnie wyłączony: coś, co wydaje pieniądze samo, włącza
się decyzją, nie aktualizacją. Klucza nie ma w `config`, bo `config` bywa
wypisywany do diagnostyki; SDK czyta `ANTHROPIC_API_KEY` sam.

## 12. Wydanie i aktualizacja

PR z fragmentem `zmiany/<nazwa>.md` → zielone CI → auto-scalanie →
`wydanie.yml` (numer, CHANGELOG, tag) → `android.yml` (podpisany APK)
i `paczka.yml` (ZIP serwera z SHA-256) → takt `wydania` na serwerze. Numer
nadaje automat z fragmentów `zmiany/*.md`, więc PR-y nie kłócą się
o wersję. Zmiany zapisu do Subiekta czekają na zgodę właściciela, bo złego
dokumentu następne wydanie nie cofnie. Paczka niesie własny Node i gotowy
build, więc na serwerze nic się nie kompiluje.

**Serwer sam się nie aktualizuje**, bo zatrzymanie `wertis-api` kończy całe
drzewo jego procesów. Kładzie zlecenie i woła zadanie Harmonogramu, a resztę
robi `instalator/zlecenie.ps1`. Wersja, która nie wstanie, oddaje miejsce
poprzedniej razem z bazą sprzed migracji. Automat (`AKTUALIZACJA_AUTO`) nie
klika przy „[wymaga działania]” po drodze, przy zbyt młodym wydaniu, gdy kanarek
dev nie pracuje na tej wersji, gdy wersja już raz padła albo gdy ktoś pracuje.
Decyzja jest czystą funkcją (`services/aktualizacja-auto.ts`).

**Ustawienia z panelu zapisują `wertis.env`**, jedyne źródło konfiguracji
wszystkich procesów. Przed zapisem osobny proces ładuje `config.ts` na
kandydacie, więc panel nie zapisze pliku, z którym serwer by nie wstał.
Procedury: `DEPLOY.md` §0a–§0d i
[`instalator/README.md`](../instalator/README.md).

## 13. Testy i bramki

Serwer: `cd server && npm test`. Panel: `cd panel && npm test`. `:core`:
`cd android && ./gradlew :core:test`, bez Android SDK. `:app` buduje tylko CI.
Liczb testów ten dokument nie podaje, bo starzeją się po cichu.

**`:core` jest osobnym modułem**, żeby logika dała się testować bez Androida.
**DTO z serwera są modelem kolektora** (`core/net/Dtos.kt`), bez mappera:
kształt danych ma jednego właściciela, serwer. Regułę, co z danymi zrobić,
wypycha się do `:core`, nie do ekranu (komentarz przy `AppGraph`).

## 14. Decyzje, które wyglądają dziwnie, a mają powód

**SQLite**, bo jeden host i zero administracji. **Brak HTTPS**, bo LAN
magazynowy i klient natywny; lokalne CA na kolektorach kosztuje więcej, niż
wnosi. **Polling 2 s zamiast WebSocketów**, bo kolektor traci Wi-Fi kilkanaście
razy dziennie, a polling nie ma kodu reconnectu. **Zero modułów natywnych
w serwerze**, bo instaluje się go bez kompilatora; natywne rzeczy idą do
procesów C#. **Unikalności loginu pilnuje baza**, bo dwa takie same loginy to
jedno żądanie od pomyłki.

## 15. Znane ograniczenia

- **Brak testów adapterów MSSQL** (`subiekt.mssql.ts`, `sfera.sql.ts`) i modułu
  `:app`. Adaptery sprawdza ręczna checklista (`docs/subiekt-gt-edu-setup.md` §5).
- **Część wywołań COM** nosi `[WERYFIKUJ]`; lista w `sfera-worker/README.md`.
- **Zdjęcia kartotek** ruszają po wpisaniu `ZDJECIA_*` do `wertis.env`
  i nadaniu `GRANT SELECT` na tabelę zdjęć (`docs/subiekt-gt-struktura.md`).
- **Otwarte `[WERYFIKUJ]`** własnej bazy: `MAG_ID_*`, `MSSQL_LOC_COLUMN`,
  `DOK_STATUS_ZD_OTWARTE`, `MSSQL_ZD_ZREAL_COLUMN`, `LOC_FIELD_LIMIT`
  (`docs/subiekt-gt-edu-setup.md` §3).
- **Reguły strefy złotej** nie pokrywają regałów `D00`, `D06`, `D07`, `E01`;
  raporty pokazują je jako „brak reguły”, a lukę zamyka wpis w panelu.
