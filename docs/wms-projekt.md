# WMS w WERTIS — projekt i architektura

Dokument dla kogoś, kto to zbuduje. Opisuje **model danych, przebiegi, ekrany
i granice** warstwy magazynowej. Nie powtarza uzasadnień biznesowych — te stoją
w [`wms-strategia.md`](wms-strategia.md), a decyzja o kolejności prac w jej
sekcji 9.

> **Status.** To jest PROJEKT, nie opis kodu. Żadna z tabel niżej nie istnieje
> w `server/src/db/schema.sql`. Sekcja 13 jest audytem tego projektu i listą
> poprawek, które z audytu weszły do tekstu wyżej.

---

## 1. Zakres

Ten projekt rozstrzyga pięć rzeczy i nic więcej.

1. Gdzie i ile towaru leży — z dokładnością do miejsca.
2. Jak powstaje i znika rezerwacja pod zamówienie.
3. Jak wygląda praca zlecana hali: pobranie, odłożenie, uzupełnienie, liczenie.
4. Jak zamówienie klienta staje się spakowanym kartonem.
5. Jak to wszystko rozlicza się z Subiektem.

**Poza zakresem:** sklep, oferty, kurierzy, dokument sprzedaży. Te siedzą
w systemie sprzedaży i zostają tam do etapu 4 ze strategii.

---

## 2. Zasady wiążące

Projekt nie ma prawa łamać reguł, które już obowiązują w tym repo.

| reguła | źródło | skutek dla projektu |
|---|---|---|
| zero zapisu przy patrzeniu | `CLAUDE.md` | otwarcie listy zbiórek niczego nie tworzy |
| liczniki zapisów są umową | `routes/biuro.test.ts` | każda nowa trasa zapisu ma uzasadnienie |
| cienkie trasy, logika w serwisach | `CLAUDE.md` | każdy serwis z testem obok |
| każda mutacja woła `logEvent` | `CLAUDE.md` | także każdy ruch zapasu |
| schemat migruje wyłącznie API | `architektura.md` §3 | worker nie zakłada tabel |
| tickery tylko w `main()` | `CLAUDE.md` | uzupełnianie liczy się na żądanie |
| dekalog ergonomii | `ergonomia-magazynu.md` | ekrany hali według punktów 1–10 |
| cel dotyku ≥ 48 dp | `tools/ergonomia_check.py` | bez zwolnień w nowych ekranach |
| nowy front nie powstaje | `CLAUDE.md` | hala do kolektora, biuro do `biuro.html` |

Jedna reguła rządzi całą resztą: **Subiekt zostaje właścicielem stanu**.
WERTIS trzyma rozbicie tej liczby na miejsca i rozlicza się z nią codziennie.

---

## 3. Model danych

Dziesięć tabel w siedmiu grupach. Nazwy polskie, jak reszta tabel aplikacji.

### 3.1. `miejsce` — adres jako byt

Dziś adres jest ciągiem znaków w polu kartoteki. WMS potrzebuje bytu, bo miejsce
ma własne cechy: strefę, wysokość, pojemność i stan.

```sql
CREATE TABLE IF NOT EXISTS miejsce (
  kod        TEXT PRIMARY KEY,          -- 'A01-02-03' albo 'PAL-042'
  mag_id     INTEGER NOT NULL,          -- magazyn Subiekta, do którego należy
  -- Rozbiór adresu trzymamy WYLICZONY, nie liczony przy każdym zapytaniu:
  -- sortowanie trasy zbiórki idzie po tych kolumnach tysiące razy dziennie.
  -- Źródłem pozostaje `parseAdres` z `server/src/locs.ts` — jeden parser.
  alejka     TEXT, regal TEXT, kolumna INTEGER, poziom INTEGER,
  rodzaj     TEXT NOT NULL
             CHECK (rodzaj IN ('polka','paleta','podloga','stol','wozek','nieznane')),
  -- `wozek` to przegroda wózka zbiórkowego, `nieznane` — jedno miejsce na
  -- magazyn z zapasem nieprzypisanym jeszcze do półki. Oba są miejscami
  -- naprawdę, a nie wyjątkiem w kodzie: pobranie i zasiew są wtedy zwykłym
  -- ruchem, a nie osobną ścieżką omijającą dziennik.
  -- Stan miejsca, nie towaru. `zablokowane` znaczy: nie bierz stąd i nie kładź
  -- tu nic, dopóki człowiek nie rozstrzygnie. Tak wygląda miejsce w trakcie
  -- liczenia i miejsce z rozjazdem.
  stan       TEXT NOT NULL DEFAULT 'czynne'
             CHECK (stan IN ('czynne','zablokowane','wycofane')),
  -- Czy z tego miejsca wolno pobierać pod zamówienie klienta. Kwarantanna
  -- zwrotów ma stan sprzedażowo NIEDOSTĘPNY i to jest cała różnica między
  -- „mamy" a „możemy sprzedać".
  sprzedazne INTEGER NOT NULL DEFAULT 1,
  utworzono_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_miejsce_trasa ON miejsce(mag_id, alejka, regal, kolumna, poziom);
```

**Każdy magazyn dostaje dokładnie jedno miejsce `nieznane`.** Tam ląduje cały
stan z Subiekta w chwili uruchomienia. Stamtąd towar schodzi przy pierwszym
skanie półki, a to, ile jeszcze tam stoi, jest miarą postępu wdrożenia.

**Pojemności NIE MA i to jest decyzja.** Pojemność półki wymaga wymiarów
towaru, których kartoteka nie zna. Kolumna bez danych kłamie i blokuje
odłożenie, które w rzeczywistości się mieści.

### 3.2. `zapas` — ile czego leży pod adresem

To jest serce WMS-a i jedyna tabela, o którą cały projekt chodzi.

```sql
CREATE TABLE IF NOT EXISTS zapas (
  miejsce_kod TEXT NOT NULL REFERENCES miejsce(kod),
  tw_id       INTEGER NOT NULL,          -- BEZ klucza obcego: `sgt_towar` jest
                                         -- read-modelem kasowanym przy imporcie
                                         -- (blizna 0.154.0, patrz schema.sql)
  ilosc       REAL NOT NULL,
  -- Ile z tej ilości jest już obiecane zleceniom. Nigdy większe od `ilosc`;
  -- pilnuje tego niezmiennik N3 z sekcji 4, nie CHECK — bo CHECK w SQLite
  -- nie widzi drugiej kolumny w trakcie wielowierszowej transakcji.
  zarezerwowane REAL NOT NULL DEFAULT 0,
  zmieniono_at TEXT NOT NULL,
  PRIMARY KEY (miejsce_kod, tw_id)
);
CREATE INDEX IF NOT EXISTS ix_zapas_tw ON zapas(tw_id);
```

**To jest SALDO WYLICZONE, nie prawda pierwotna.** Prawdą jest dziennik ruchów
niżej. Saldo stoi osobno z powodu wydajności. Karta towaru pyta o nie co dwie sekundy
z każdego otwartego ekranu. Sumowanie dziennika przy każdym pytaniu byłoby
skanem tabeli rosnącej bez końca.

### 3.3. `ruch_zapasu` — dziennik, z którego wynika saldo

```sql
CREATE TABLE IF NOT EXISTS ruch_zapasu (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  at          TEXT NOT NULL,
  tw_id       INTEGER NOT NULL,
  -- Skąd i dokąd. NULL po jednej stronie znaczy wejście albo wyjście ze świata
  -- WERTIS: przyjęcie ma puste źródło, wydanie klientowi puste przeznaczenie.
  z_miejsca   TEXT REFERENCES miejsce(kod),
  do_miejsca  TEXT REFERENCES miejsce(kod),
  ilosc       REAL NOT NULL CHECK (ilosc > 0),
  powod       TEXT NOT NULL              -- przyjecie | odlozenie | pobranie
                                         -- | uzupelnienie | liczenie | zwrot
                                         -- | korekta | przeniesienie
  ,
  -- Co ten ruch zlecało. Para (rodzaj, id) zamiast siedmiu kolumn obcych:
  -- rodzajów zleceń przybędzie, a kolumna pusta w 90% wierszy niczego nie uczy.
  zrodlo_rodzaj TEXT, zrodlo_id INTEGER,
  -- Klucz powtórzenia. Kolektor bufora offline potrafi wysłać ten sam skan
  -- drugi raz po powrocie sieci; bez tego klucza dwa udane wysłania to dwa
  -- ruchy. Wylicza go SERWER z (urządzenie, znacznik skanu, pozycja zadania),
  -- bo klientowi nie wolno wybierać tożsamości zapisu.
  klucz_powt  TEXT NOT NULL,
  przez       TEXT NOT NULL,
  przez_user_id INTEGER REFERENCES app_user(user_id),
  -- Ruch bez obu stron nie znaczy nic, a bez tego warunku daje się zapisać.
  -- Warunek TABELI, nie kolumny: patrzy na dwie kolumny naraz.
  CHECK (z_miejsca IS NOT NULL OR do_miejsca IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_ruch_powt ON ruch_zapasu(klucz_powt);
CREATE INDEX IF NOT EXISTS ix_ruch_tw_at ON ruch_zapasu(tw_id, at);
CREATE INDEX IF NOT EXISTS ix_ruch_zrodlo ON ruch_zapasu(zrodlo_rodzaj, zrodlo_id);
```

Dziennik jest **tylko dopisywany**. Pomyłkę odwraca ruch przeciwny z powodem
`korekta`, nigdy `UPDATE` ani `DELETE`. Saldo, którego nie da się wyprowadzić
z listy zdarzeń, jest saldem, którego nie da się wytłumaczyć.

### 3.4. `zlecenie_wydania` i `zlecenie_pozycja`

Zlecenie jest odpowiednikiem zamówienia klienta **po stronie magazynu**. Nie
zna ceny, płatności ani kanału; zna towar, ilość i termin.

```sql
CREATE TABLE IF NOT EXISTS zlecenie_wydania (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Numer u nadawcy zlecenia (system sprzedaży). Para z `zrodlo` jest kluczem
  -- powtórzeń importu: ten sam plik wgrany dwa razy nie robi dwóch zbiórek.
  zrodlo       TEXT NOT NULL,            -- 'sellasist' | 'reczne'
  zrodlo_nr    TEXT NOT NULL,
  odbiorca     TEXT,                     -- NAZWA z naklejki, nic więcej (0.367.0)
  termin       TEXT,
  status       TEXT NOT NULL DEFAULT 'nowe'
               CHECK (status IN ('nowe','zarezerwowane','w_zbiorce','spakowane',
                                 'wydane','anulowane','wstrzymane')),
  utworzono_at TEXT NOT NULL,
  UNIQUE (zrodlo, zrodlo_nr)
);

CREATE TABLE IF NOT EXISTS zlecenie_pozycja (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  zlecenie_id  INTEGER NOT NULL REFERENCES zlecenie_wydania(id) ON DELETE CASCADE,
  tw_id        INTEGER,                  -- NULL, gdy SKU nie trafiło w kartotekę
  sku_zrodla   TEXT NOT NULL,            -- surowo, bez normalizacji
  nazwa_zrodla TEXT NOT NULL,
  ilosc        REAL NOT NULL,
  ilosc_pobrana REAL NOT NULL DEFAULT 0,
  -- Numer wiersza u nadawcy. To on jest kluczem powtórzenia importu, NIE SKU:
  -- jedno zamówienie potrafi nieść ten sam symbol w dwóch wierszach, a klucz
  -- po symbolu odrzucałby wtedy poprawne dane.
  zrodlo_poz_nr TEXT NOT NULL,
  UNIQUE (zlecenie_id, zrodlo_poz_nr)
);
```

**Pozycja bez kartoteki wchodzi z `tw_id` pustym i to jest celowe.** Import,
który odrzuca całe zamówienie przez jeden nierozpoznany symbol, zatrzymuje
wysyłkę reszty. Pozycja bez wskazania staje się pracą dla biura, nie błędem.

### 3.5. `rezerwacja` — obietnica w dwóch krokach

```sql
CREATE TABLE IF NOT EXISTS rezerwacja (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  zlecenie_poz_id INTEGER NOT NULL REFERENCES zlecenie_pozycja(id) ON DELETE CASCADE,
  tw_id         INTEGER NOT NULL,
  -- MIĘKKA rezerwacja ma `miejsce_kod` puste: obiecuje sztukę, nie wskazuje
  -- półki. TWARDA wskazuje miejsce i podnosi `zapas.zarezerwowane`.
  --
  -- Dwa kroki, bo między zwolnieniem zamówienia a zbiórką mija czas, a w tym
  -- czasie towar bywa przenoszony. Rezerwacja twarda założona za wcześnie
  -- wskazywałaby półkę, na której już nic nie ma.
  miejsce_kod   TEXT REFERENCES miejsce(kod),
  ilosc         REAL NOT NULL CHECK (ilosc > 0),
  stan          TEXT NOT NULL DEFAULT 'miekka'
                CHECK (stan IN ('miekka','twarda','zdjeta','zrealizowana')),
  utworzono_at  TEXT NOT NULL,
  zmieniono_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_rezerwacja_poz ON rezerwacja(zlecenie_poz_id, stan);
CREATE INDEX IF NOT EXISTS ix_rezerwacja_miejsce ON rezerwacja(miejsce_kod, stan);
```

### 3.6. `zadanie_magazynowe` i `zadanie_pozycja`

Jedna tabela na całą pracę hali. Rodzaj mówi, co to za praca.

```sql
CREATE TABLE IF NOT EXISTS zadanie_magazynowe (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rodzaj      TEXT NOT NULL CHECK (rodzaj IN
              ('pobranie','odlozenie','uzupelnienie','liczenie','przeniesienie')),
  -- Zbiórka zbiorcza: jedno zadanie obsługuje kilka zleceń naraz, a przegroda
  -- wózka wiąże pozycję ze zleceniem. Stąd przegroda stoi przy POZYCJI.
  status      TEXT NOT NULL DEFAULT 'nowe'
              CHECK (status IN ('nowe','w_toku','wykonane','anulowane','odeslane')),
  priorytet   TEXT NOT NULL DEFAULT 'normalny'
              CHECK (priorytet IN ('normalny','pilny')),
  utworzono_at TEXT NOT NULL, utworzono_przez TEXT NOT NULL,
  przypisano_user_id INTEGER REFERENCES app_user(user_id),
  wykonano_at TEXT, wykonano_przez TEXT,
  -- Odesłanie z hali, jak w `zadanie_terenowe` (0.352.0). Powód KODEM, treść
  -- nieobowiązkowa: kciuk w rękawicy dotyka kafla, nie pisze zdania.
  odeslano_at TEXT, powod_kod TEXT
              CHECK (powod_kod IS NULL OR powod_kod IN
                     ('brak_towaru','zle_miejsce','uszkodzony','nie_da_sie'))
);
CREATE INDEX IF NOT EXISTS ix_zadanie_mag_kolejka
  ON zadanie_magazynowe(status, priorytet, utworzono_at);

CREATE TABLE IF NOT EXISTS zadanie_pozycja (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zadanie_id  INTEGER NOT NULL REFERENCES zadanie_magazynowe(id) ON DELETE CASCADE,
  tw_id       INTEGER NOT NULL,
  z_miejsca   TEXT REFERENCES miejsce(kod),
  do_miejsca  TEXT REFERENCES miejsce(kod),
  ilosc_zlecona REAL NOT NULL,
  ilosc_zrobiona REAL NOT NULL DEFAULT 0,
  -- Do którego zlecenia idzie ta pozycja i do której przegrody wózka.
  -- Puste przy odłożeniu, uzupełnieniu i liczeniu.
  zlecenie_poz_id INTEGER REFERENCES zlecenie_pozycja(id) ON DELETE SET NULL,
  przegroda   INTEGER,
  -- Kolejność na trasie, wyliczona przy tworzeniu zadania. Zapisana, nie
  -- liczona przy każdym otwarciu: kolektor ma pokazać tę samą kolejność po
  -- powrocie z przerwy, także gdy w międzyczasie coś się przesunęło.
  kolejnosc   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_zadanie_poz ON zadanie_pozycja(zadanie_id, kolejnosc);
```

### 3.7. `inwentura` i `inwentura_pozycja`

```sql
CREATE TABLE IF NOT EXISTS inwentura (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rodzaj       TEXT NOT NULL CHECK (rodzaj IN ('ciagla','wyzwolona','pelna')),
  -- Co wyzwoliło liczenie: pobranie z brakiem, miejsce na zerze, cisza roczna.
  powod        TEXT,
  status       TEXT NOT NULL DEFAULT 'otwarta'
               CHECK (status IN ('otwarta','policzona','rozliczona','anulowana')),
  utworzono_at TEXT NOT NULL,
  rozliczono_at TEXT, rozliczono_przez TEXT
);

CREATE TABLE IF NOT EXISTS inwentura_pozycja (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  inwentura_id INTEGER NOT NULL REFERENCES inwentura(id) ON DELETE CASCADE,
  miejsce_kod  TEXT NOT NULL REFERENCES miejsce(kod),
  tw_id        INTEGER NOT NULL,
  -- Ilość z systemu ZAMROŻONA w chwili wydania arkusza. Bez zamrożenia różnica
  -- liczy się względem stanu, który zmienił się w trakcie liczenia.
  ilosc_systemowa REAL NOT NULL,
  ilosc_policzona REAL,
  policzono_at TEXT, policzono_przez TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_inwentura_poz
  ON inwentura_pozycja(inwentura_id, miejsce_kod, tw_id);
```

---

## 4. Niezmienniki i ich pomiar

Niezmiennik bez pomiaru jest deklaracją. Każdy z poniższych dokłada wpis do
`server/src/services/reconcile.ts` i ma własny rodzaj rozjazdu.

| nr | niezmiennik | pomiar |
|---|---|---|
| N1 | saldo `zapas` równa się sumie ruchów | nocna suma per kartoteka |
| N2 | suma `zapas` per magazyn równa się `sgt_stan` | nocne porównanie z Subiektem |
| N2a | ile zapasu stoi jeszcze w miejscu `nieznane` | miara postępu, nie rozjazd |
| N3 | `zarezerwowane` ≤ `ilosc` w każdym wierszu | zapytanie, próg zero |
| N4 | suma rezerwacji twardych równa się `zarezerwowane` | zapytanie, próg zero |
| N5 | zlecenie `wydane` ma komplet ruchów pobrania | zapytanie po zleceniach |
| N6 | miejsce `zablokowane` nie ma otwartych zadań | zapytanie, próg zero |

**N2 trzyma się od pierwszego dnia wyłącznie dzięki miejscu `nieznane`.** Bez
niego suma z półek nigdy nie dorówna Subiektowi, bo większość towaru nie ma
jeszcze zeskanowanej półki. Niezmiennik czerwony od początku przestaje być
czytany po tygodniu i nie chroni już przed niczym.

Rozjazd mierzy się więc inaczej niż postęp. N2 pokazuje różnicę trwającą dłużej
niż dobę, bo tylko taka znaczy błąd, a nie opóźnienie dokumentu. N2a pokazuje,
ile pracy zostało do końca wdrożenia.

---

## 5. Przebiegi

### 5.1. Przyjęcie i odłożenie

Przyjęcie zostaje takie, jakie jest: rozkładanie faktury zakupu z kolektora.
Zmienia się jedna rzecz — skan półki dopisuje **ruch zapasu**, a nie tylko
adres na kartotece.

1. Magazynier otwiera dostawę i wybiera pozycję.
2. Skanuje towar, potem półkę, potem podaje liczbę sztuk.
3. Serwer zapisuje ruch: brak źródła, miejsce docelowe, powód `przyjecie`.
4. Pole adresu na kartotece Subiekta dostaje adres pobrania, jak dziś.

### 5.2. Zlecenie wchodzi i dostaje rezerwację

1. Import zlecenia zakłada `zlecenie_wydania` ze statusem `nowe`.
2. Serwis rezerwacji liczy dostępność i zakłada rezerwacje miękkie.
3. Pozycja bez pokrycia zostaje z brakiem i trafia na listę biura.
4. Zlecenie z kompletem rezerwacji dostaje status `zarezerwowane`.

**Dostępność liczy się tak:** suma `ilosc` z miejsc sprzedażnych, minus
`zarezerwowane`, minus zapas w miejscach zablokowanych. Kwarantanna zwrotów
i towar w trakcie liczenia nie są dostępne, choć fizycznie są.

### 5.3. Zbiórka zbiorcza

Najważniejszy przebieg w całym projekcie i jedyna optymalizacja trasy, która
przy 342 m² ma sens. Osiem zamówień po dwie pozycje to osiem przejść albo
jedno.

1. Biuro albo automat składa zadanie `pobranie` z kilku zleceń.
2. Rezerwacje miękkie twardnieją: dostają miejsce i podnoszą `zarezerwowane`.
3. Pozycje układają się po adresie rosnąco, przegroda wiąże je ze zleceniem.
4. Kolektor prowadzi po miejscach; skan półki potwierdza, że stoisz gdzie trzeba.
5. Skan towaru potwierdza, co bierzesz; liczba sztuk wchodzi na ekranie.
6. Ruch zapasu idzie z półki do przegrody wózka, czyli miejsca rodzaju `wozek`.
7. Brak sztuk kończy pozycję odesłaniem z kodem `brak_towaru`.

**Odesłanie zakłada liczenie tego miejsca.** To jest cała pętla sprzężenia
zwrotnego: pomyłka znaleziona przy zbiórce sama zamawia sprawdzenie półki.

**Limit wózka jest liczbą przegród, nie liczbą zamówień.** Osiem przegród to
osiem zleceń i tyle; zlecenie większe niż przegroda idzie zbiórką osobną.

### 5.4. Pakowanie z kontrolą

1. Pakujący skanuje przegrodę albo kartę zlecenia.
2. Ekran pokazuje, co ma być w kartonie, bez liczb przy pozycjach.
3. Pakujący skanuje każdą sztukę; ekran odhacza ją sam.
4. Nadmiar i brak zatrzymują pakowanie z komunikatem mówiącym, czego brakuje.
5. Zamknięcie kartonu przenosi zapas z przegrody wózka do świata.

**Liczby przy pozycjach pojawiają się DOPIERO po skanie.** Lista z liczbami
zamienia kontrolę w przepisywanie: człowiek widzi „2 szt" i odhacza dwie, nie
patrząc na to, co trzyma.

**Kontroli wagowej w tym projekcie NIE MA.** Wymagałaby masy kartoteki, której
Subiekt nie niesie, a `wymiar_kartoteki` trzyma wyłącznie milimetry wyłuskane
z opisu. Kontrola wagowa wraca, gdy pojawi się źródło masy.

### 5.5. Wydanie i rozliczenie z Subiektem

1. Zamknięcie kartonu daje ruch wyjścia, zdejmuje rezerwację, status `spakowane`.
2. Zlecenie czeka na potwierdzenie nadania z systemu sprzedaży.
3. Dokument wydania w Subiekcie powstaje przez kolejkę, nowym typem zadania.
4. Zlecenie bez odpowiedzi kolejki zostaje `spakowane` i widać je w biurze.

**Do etapu 4 dokument sprzedaży wystawia system sprzedaży, nie WERTIS.** Punkt
trzeci wchodzi w życie razem z decyzją o wystawianiu dokumentów i nie wcześniej.

### 5.6. Uzupełnianie strefy złotej

1. Analiza kandydatów wskazuje kartotekę stojącą poza strefą złotą.
2. Biuro zamienia kandydata na zadanie `uzupelnienie` jednym dotknięciem.
3. Hala przenosi towar i potwierdza skanem obu miejsc.

**Automat sam zadań nie zakłada.** Kandydat to zdanie o rotacji, a nie polecenie
przeniesienia; miejsce docelowe wybiera człowiek znający półkę.

### 5.7. Inwentura ciągła

1. Wyzwalacz zakłada inwenturę: brak przy zbiórce, zero na miejscu, cisza roczna.
2. Miejsce dostaje stan `zablokowane` i zamrożoną ilość systemową.
3. Hala liczy i podaje wynik jednym ekranem.
4. Różnica zerowa rozlicza się sama; każda niezerowa idzie do biura.
5. Rozliczenie tworzy ruch `liczenie` i odblokowuje miejsce.

**Różnica NIE jedzie od razu do Subiekta.** Korekta stanu w Subiekcie jest
dokumentem księgowym i zatwierdza ją biuro, zbiorczo, nie kolektor przy półce.

---

## 6. Ekrany kolektora

Cztery nowe, żaden nie jest menu. Punkty dekalogu przy każdym.

| ekran | co robi | punkty dekalogu |
|---|---|---|
| MOJA PRACA | kolejka zadań dla tej osoby | 1, 5 |
| ZBIÓRKA | prowadzi po miejscach, przyjmuje skany | 1, 2, 3, 7, 9 |
| PAKOWANIE | kontrola zawartości kartonu skanem | 2, 6 |
| LICZENIE | jedno miejsce, jedna liczba | 2, 5, 6 |

Ekran ZBIÓRKA pokazuje w kolejności: adres, towar, ilość, czynność. Adres jest
największy, bo rozstrzyga pierwszy krok. Reszta danych schodzi pod zwijany blok.

**Pakowanie jest pracą przy stole, nie przy półce.** Mimo to zostaje na
kolektorze: to samo urządzenie, ten sam skaner, brak trzeciego frontu.

---

## 7. Trasy i role

Trasy cienkie, logika w serwisach, test obok każdego serwisu.

| trasa | rola | zapis |
|---|---|---|
| `GET /api/zadania/moje` | magazynier | nie |
| `POST /api/zadania/:id/start` | magazynier | tak |
| `POST /api/zadania/:id/pozycja/:pid/skan` | magazynier | tak |
| `POST /api/zadania/:id/odeslij` | magazynier | tak |
| `GET /api/biuro/zlecenia` | biuro | nie |
| `POST /api/biuro/zlecenia/import` | biuro | tak |
| `POST /api/biuro/zbiorka` | biuro | tak |
| `GET /api/pakowanie/:zlecenieId` | magazynier | nie |
| `POST /api/pakowanie/:zlecenieId/skan` | magazynier | tak |
| `POST /api/pakowanie/:zlecenieId/zamknij` | magazynier | tak |
| `POST /api/biuro/inwentura/:id/rozlicz` | biuro, admin | tak |

Zapisów przybywa dziesięć. Licznik w `server/src/routes/biuro.test.ts` rośnie
o tyle samo, a każdy dostaje zdanie uzasadnienia — tak każe `CLAUDE.md`.

**Żaden `GET` niczego nie zakłada.** Zbiórka powstaje wyłącznie żądaniem
`POST /api/biuro/zbiorka`, nigdy przy otwarciu listy.

---

## 8. Integracja

### 8.1. Subiekt

Odczyt bez zmian: `sgt_*` co 60 s. Zapis dostaje **jeden nowy typ zadania**
kolejki i ani jednej nowej drogi.

| zdarzenie | typ zadania | kiedy |
|---|---|---|
| odłożenie MGP → MAG | `mm` (istnieje) | po odłożeniu dostawy |
| korekta z inwentury | `korekta` (nowy) | po zatwierdzeniu przez biuro |
| dokument wydania | — | dopiero etap 4 |

**Nowy typ zadania to zmiana w DWÓCH procesach.** Lista `TYPY_SFERY`
w `server/src/adapters/sfera.ts` i zapytania workera w `sfera-worker/` biorą
te same nazwy. Dołożenie typu tylko po stronie Node zostawia zadanie w kolejce
na zawsze.

### 8.2. System sprzedaży

Do etapu 4 kontrakt jest jednostronny i plikowy, jak dzisiejszy import zbiórek.

1. Wejście: zlecenia do realizacji, w formacie ustalonym z dostawcą systemu.
2. Wyjście: plik wyników zbiórki i pakowania, gotowy do odczytania.

**Ilość wolną do sprzedaży liczymy, ale jej nie wysyłamy.** Liczba jedzie do
kanału dopiero po etapie 4; do tego czasu stoi na ekranie biura jako ostrzeżenie.

---

## 9. Współbieżność, offline i wydajność

Baza to jeden plik SQLite w trybie WAL. Pisze jeden proces naraz, a przy
zbiórce piszą trzy kolektory jednocześnie.

- Każdy skan to **jedna krótka transakcja**, nigdy otwarta przez cały ekran.
- Twardnienie rezerwacji idzie w `BEGIN IMMEDIATE`, bo czyta i pisze te same wiersze.
- Zapytania trasy sortują po kolumnach z indeksu `ix_miejsce_trasa`.
- Karta towaru czyta `zapas`, nie sumuje dziennika.

**Powtórzenie z bufora offline jest pewne, nie hipotetyczne.** Kolektor wysyła
zapis po powrocie sieci, a pierwsza próba mogła dojść przed zerwaniem. Klucz
`klucz_powt` zamienia drugie wysłanie w brak skutku.

Klucz liczy serwer z trójki: urządzenie, znacznik skanu z kolektora, pozycja
zadania. **Znacznik skanu jest tu daną wejściową, nie tożsamością zapisu** —
dwa prawdziwe skany tej samej pozycji różnią się milisekundą i oba wejdą.

---

## 10. Awaria i praca na papierze

Po etapie 2 awaria serwera zatrzymuje wysyłkę, a nie tylko podgląd. Procedura
papierowa jest tańsza od drugiego serwera i wchodzi razem z etapem 2.

1. Biuro drukuje listy zbiórek na zmianę do przodu, raz dziennie.
2. Hala zbiera z papieru i zapisuje ilości ołówkiem.
3. Po powrocie serwera biuro wprowadza wyniki jednym ekranem.

**Wprowadzenie z papieru jest osobną trasą i osobnym powodem ruchu.** Bez tego
praca z awarii wygląda w dzienniku jak praca normalna i nikt nie wie, co było
liczone, a co przepisane.

---

## 11. Wdrożenie i migracje

Schemat zakłada wyłącznie API przy starcie. Tabele wchodzą pustymi migracjami,
a dane dosypuje osobne polecenie.

| etap | co wchodzi | bramka |
|---|---|---|
| 1a | `miejsce`, zasiew z adresów kartotek | adresy z kartotek mają swój wiersz |
| 1b | `zapas`, `ruch_zapasu`, zasiew do miejsca `nieznane` | N1 i N2 zielone od pierwszej nocy |
| 1c | skan półki zdejmuje towar z miejsca `nieznane` | zgodność w liczonych miejscach ≥ 98% |
| 2a | `zlecenie_*`, `rezerwacja`, import z pliku | zlecenia wchodzą bez dubli |
| 2b | `zadanie_*`, zbiórka i pakowanie | pomyłki wysyłkowe niżej niż w etapie 0 |
| 3 | `inwentura_*`, uzupełnianie | hala ma pracę bez zleceń z biura |

**Zasiew miejsc bierze adresy z kartotek i nic więcej.** Miejsce, którego nie
wskazuje żadna kartoteka, nie istnieje dla systemu, dopóki ktoś go nie zeskanuje.

**Pierwszy zapas NIE bierze się z liczenia całego magazynu.** Etap 1b wpisuje
stan z Subiekta do miejsca `nieznane` każdego magazynu, jednym ruchem na
kartotekę. Od tej chwili suma się zgadza, a praca hali polega na przenoszeniu
towaru z miejsca nieznanego na półki.

Liczenie całego magazynu przed startem kosztowałoby tydzień postoju i i tak
zestarzałoby się w trakcie. Zasiew z Subiekta jest tańszy i mierzalny: widać,
ile kartotek ma już prawdziwe miejsce.

---

## 12. Czego ten projekt świadomie nie robi

- **Nie liczy trasy najkrótszej.** Sortowanie po adresie wystarcza przy 342 m²,
  a dekalog zabrania uznawać najkrótszą za najtańszą bez pomiaru.
- **Nie zna partii ani numerów seryjnych.** Części ogrodnicze ich nie mają,
  a kolumna bez danych kłamie.
- **Nie prowadzi hierarchii opakowań.** Wróci, gdy pojawi się dostawa liczona
  w kartonach zbiorczych.
- **Nie waży kartonu.** Powód w sekcji 5.4.
- **Nie zarządza pracą ludzi.** Zadania mają priorytet i przypisanie, i tyle.

---

## 13. Audyt projektu

Audyt szukał trzech rzeczy: sprzeczności z regułami repo, dziur w modelu danych
i założeń bez pokrycia w danych. Poszedł DWIEMA RUNDAMI i to rozróżnienie jest
uczciwe, a nie kosmetyczne.

Runda pierwsza szła razem z pisaniem, więc łapała to, co autor sam u siebie
widzi. Runda druga czytała gotowy tekst jako cudzy i znalazła jedenaście rzeczy
więcej — w tym dwie, które zatrzymałyby wdrożenie. Wszystkie poprawki są już
w tekście wyżej; ta sekcja mówi, co było nie tak.

### Runda pierwsza — dziewięć rzeczy złapanych przy pisaniu

| nr | waga | co znalazł audyt | gdzie naprawione |
|---|---|---|---|
| A1 | wysoka | kontrola wagowa bez źródła masy | 5.4 |
| A2 | wysoka | brak klucza powtórzeń przy buforze offline | 3.3, 9 |
| A3 | wysoka | klucz obcy do `sgt_towar` kładący import | 3.2 |
| A4 | średnia | rezerwacja jednostopniowa wskazująca pustą półkę | 3.4 |
| A5 | średnia | brak wyjścia „nie ma towaru" dla hali | 3.6, 5.3 |
| A6 | średnia | inwentura bez zamrożenia ilości systemowej | 3.7 |
| A7 | średnia | import zlecenia odrzucany przez jedno SKU | 3.5 |
| A8 | niska | pojemność miejsca bez danych do jej wyliczenia | 3.1 |
| A9 | niska | lista pakowania pokazująca liczby przed skanem | 5.4 |

### A1 — kontrola wagowa bez źródła masy

Pierwsza wersja projektu stawiała wagę przy stanowisku pakowania i porównywała
masę kartonu z sumą mas kartotek. **Masy kartoteki nie ma nigdzie.**
`wymiar_kartoteki` trzyma milimetry wyłuskane z nazwy i opisu, i to tabelę
pochodną, przebudowywaną po imporcie.

Pomiar bez źródła danych to nie funkcja, tylko obietnica. Kontrola wagowa
wypadła z projektu i wróci razem ze źródłem masy.

### A2 — powtórzenie z bufora offline tworzyło drugi ruch

Kolektor ma trwały bufor plikowy i wysyła zapisy po powrocie sieci. Pierwsza
wersja `ruch_zapasu` nie miała klucza powtórzenia, więc jedno pobranie wysłane
dwa razy zmniejszało stan dwa razy.

To jest błąd cichy: nic nie wygląda na zepsute aż do inwentury. Dziennik dostał
`klucz_powt` z indeksem unikalnym, a sekcja 9 mówi, z czego serwer go liczy.

### A3 — klucz obcy, który kładł import

Pierwsza wersja `zapas` miała `tw_id INTEGER REFERENCES sgt_towar(tw_id)`. To
jest dokładnie ta mina, która w 0.154.0 położyła API. `importFromMssql` kasuje
cały read-model i wstawia go od nowa, a klucz obcy trzyma wiersze w zakładnikach.

Konsekwencja byłaby gorsza niż wtedy — padłby import przy każdym cyklu, więc
serwer stałby w pętli restartów. Klucz obcy zniknął, powód stoi w komentarzu.

### A4 — rezerwacja jednostopniowa

Pierwsza wersja rezerwowała od razu konkretne miejsce, przy zwolnieniu
zamówienia. Między zwolnieniem a zbiórką mija czas, w którym towar bywa
przenoszony i uzupełniany.

Rezerwacja wskazywałaby wtedy półkę, z której towar już zszedł, a zbiórka
zaczynałaby się od odesłania. Stąd dwa stopnie: miękka przy zleceniu, twarda
przy składaniu zbiórki.

### A5 — hala bez wyjścia „nie ma towaru"

Pierwsza wersja `zadanie_magazynowe` miała cztery statusy, bez `odeslane`.
Repo kupiło tę bliznę w 0.352.0 przy zadaniach terenowych: bez uczciwego wyjścia
człowiek albo kłamie wynikiem, albo zostawia zadanie otwarte na zawsze.

Oba kłamstwa wchodzą potem do miar jako czas pracy. Status wrócił razem
z kodem powodu, a przy zbiórce odesłanie zakłada liczenie miejsca.

### A6 — inwentura bez zamrożenia

Pierwsza wersja liczyła różnicę wobec bieżącego stanu w chwili rozliczenia.
Liczenie trwa, a w tym czasie z miejsca schodzi towar pod zbiórkę.

Różnica mierzyłaby wtedy ruch, a nie pomyłkę. Arkusz zamraża ilość systemową,
a miejsce na czas liczenia jest zablokowane.

### A7 — jedno SKU zatrzymywało całe zamówienie

Pierwsza wersja importu wymagała wskazania kartoteki dla każdej pozycji.
Zamówienie z jednym nierozpoznanym symbolem nie wchodziło w całości, więc
reszta pozycji czekała na decyzję biura.

Dopasowanie SKU jest osobną pracą i ma swój serwis. Pozycja wchodzi
z pustym `tw_id`, a brak wskazania jest pracą, nie błędem importu.

### A8 — pojemność miejsca

Pierwsza wersja `miejsce` miała kolumnę pojemności. Nie ma z czego jej
wyliczyć: wymiarów towaru kartoteka nie zna, a pomiar półek to osobny projekt.

Pusta kolumna albo zgadywana liczba blokowałaby odłożenie, które się mieści.
Kolumna wypadła, powód stoi w tekście.

### A9 — lista pakowania z liczbami

Pierwsza wersja ekranu pakowania pokazywała pozycje z ilościami od razu.
Kontrola zamienia się wtedy w przepisywanie: człowiek czyta „2 szt" i odhacza
dwie sztuki, nie patrząc na to, co trzyma.

Liczby pojawiają się po skanie, a nie przed nim. Skan jest dowodem, lista jest
tylko zakresem pracy.

### Runda druga — jedenaście rzeczy w gotowym tekście

| nr | waga | co znalazł audyt | gdzie naprawione |
|---|---|---|---|
| A10 | wysoka | **zasiew zapasu wymagał liczenia całego magazynu** | 3.1, 11 |
| A11 | wysoka | **N2 czerwony od pierwszego dnia, więc martwy** | 3.1, 4 |
| A12 | średnia | wózek zbiórkowy nieobecny w modelu, a ruch do niego był | 3.1, 5.3 |
| A13 | średnia | klucz powtórzeń importu po SKU odrzucał poprawne dane | 3.4 |
| A14 | średnia | dwa opisy zamknięcia kartonu, sprzeczne ze sobą | 5.4, 5.5 |
| A15 | średnia | ruch bez obu stron dawał się zapisać | 3.3 |
| A16 | niska | rezerwacja wskazywała tabelę deklarowaną niżej | 3.4, 3.5 |
| A17 | niska | pakowanie miało ekran, ale nie miało tras | 7 |
| A18 | niska | przedział różnicy inwentury bez rozstrzygnięcia | 5.7 |
| A19 | niska | nowy typ zadania kolejki opisany jako zmiana w jednym procesie | 8.1 |
| A20 | niska | zapowiedź „siedem tabel" przy dziesięciu tabelach | 3 |

Cztery zasługują na zdanie więcej.

**A10 — zasiew przez liczenie całego magazynu.** Pierwsza wersja sekcji 11
zakładała `zapas` pusty i napełniany skanami. Napełnienie go uczciwie znaczy
policzyć wszystko przed startem, czyli tydzień postoju magazynu.

Miejsce `nieznane` na magazyn usuwa ten koszt w całości. Stan z Subiekta wchodzi
tam jednym ruchem na kartotekę, a hala przenosi towar na półki w tempie
normalnej pracy.

**A11 — niezmiennik czerwony od początku.** N2 porównuje sumę z półek ze stanem
Subiekta. Dopóki większość towaru nie ma zeskanowanej półki, ta suma nie ma
prawa się zgadzać.

`reconcile.ts` mówi w komentarzu, że raport przychodzący codziennie przestaje
być czytany po tygodniu. Niezmiennik czerwony z projektu jest tym samym błędem,
tylko wcześniej. Miejsce `nieznane` naprawia i to: N2 trzyma się od pierwszej
nocy, a postęp mierzy osobna liczba N2a.

**A13 — klucz importu po symbolu.** Pierwsza wersja miała
`UNIQUE (zlecenie_id, sku_zrodla)`, żeby ten sam plik wgrany dwa razy nie
zakładał dwóch zbiórek. Zamówienie potrafi jednak nieść ten sam symbol
w dwóch wierszach.

Klucz odrzucałby wtedy poprawne dane, a wyglądałoby to na skuteczną ochronę
przed dublem. Kluczem jest numer wiersza u nadawcy.

**A12 — wózek, którego nie było.** Sekcja 5.3 kazała przenieść zapas „do miejsca
postojowego zbiórki", a takiego bytu model nie miał. Ruch do miejsca, które nie
istnieje, to albo wyjątek w kodzie, albo pobranie bez dziennika.

Przegroda wózka jest teraz miejscem rodzaju `wozek`. Pobranie i pakowanie są
dzięki temu zwykłymi ruchami, a towar w drodze widać tam, gdzie naprawdę jest.

### Czego audyt NIE sprawdził

Audyt czytał projekt, nie kod — kodu jeszcze nie ma. Nie sprawdził więc
wydajności przy trzech kolektorach naraz ani zachowania kolejki pod obciążeniem.

Obie rzeczy są do zmierzenia na działającym etapie 1b i żaden przegląd tekstu
tego nie zastąpi.
