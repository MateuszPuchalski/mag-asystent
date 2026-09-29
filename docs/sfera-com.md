# Sfera Subiekta GT — kształt COM, który mamy ustalony

`CLAUDE.md` mówi o Allegro: kształt czyta się z pliku, nie z pamięci. Ta sama
reguła obowiązuje Sferę. Każda nazwa COM zgadnięta z pamięci okazywała się
tu błędna i wywracała się dopiero na maszynie klienta.

Ten dokument zbiera to, co ustalono **z dokumentacji, z opublikowanych
przykładów producenta i z sondy na maszynie firmy**. Nazywa też wprost to,
czego ustalić się nie da. Autorytetem pozostaje **InfoSfera** — pomoc
instalowana razem ze Sferą, na maszynie klienta. Nie ma jej w tym repozytorium
i nie będzie: to cudza treść, a repozytorium jest publiczne.

Kod, którego to dotyczy: [`sfera-worker/src/SferaComAdapter.cs`](../sfera-worker/src/SferaComAdapter.cs).
Lista punktów `[WERYFIKUJ]`: [`sfera-worker/README.md`](../sfera-worker/README.md).

## 1. Logowanie — komplet właściwości

Przykład producenta ma osiem kroków przed `Uruchom`:

```vb
gt.Produkt = InsERT.gtaProduktSubiekt
gt.Serwer = "serwer\insertgt"
gt.Baza = "BIMBO"
gt.Autentykacja = InsERT.gtaAutentykacjaMieszana
gt.Uzytkownik = "sa"            ' login SQL
gt.UzytkownikHaslo = ""
gt.Operator = "Szef"            ' operator Subiekta
gt.OperatorHaslo = ""
Set sgt = gt.Uruchom(InsERT.gtaUruchomDopasuj, InsERT.gtaUruchom)
```

Wynikają z tego dwie reguły.

**Login SQL to osobna para kluczy.** `Uzytkownik` i `UzytkownikHaslo` to
uwierzytelnienie w bazie. `Operator` i `OperatorHaslo` to użytkownik Subiekta.
Przy autentykacji mieszanej Sfera potrzebuje obu par, bo bez loginu SQL nie ma
czym otworzyć bazy. Nazwy mylą, więc rozdzielamy je dokładnie.

| pole | co to jest | kto to zwykle podaje |
|---|---|---|
| `Operator` | **login do Subiekta** — ten sam, który wpisujesz przy otwieraniu programu (np. „Szef") | człowiek, w oknie logowania |
| `Uzytkownik` | login do **SQL Servera**, na którym stoi baza podmiotu | sam Subiekt, z ustawień połączenia podmiotu |

Uruchamiając Subiekta z pulpitu, drugiego z nich nigdy nie widzisz — program
bierze go z własnej konfiguracji. Przez Sferę to **Ty tworzysz obiekt GT**,
więc podajesz oba. Przy autentykacji Windows loginu SQL nie ma wcale: bazę
otwiera konto, na którym działa proces. `wertis-sfera` działa na koncie usługi,
a nie na Twoim — przy autentykacji Windows to konto musi mieć dostęp do bazy.

To **nie jest** `MSSQL_USER` z `wertis.env`. Tamten login ma z założenia prawo
`SELECT` na sześciu tabelach i `UPDATE` na dwóch kolumnach (`DEPLOY.md` §6).
Sfera wystawia dokumenty i potrzebuje pełnych praw podmiotu. Stąd osobne klucze
`SFERA_SQL_LOGIN` i `SFERA_SQL_HASLO`.

**Adres serwera zawiera instancję.** Przykład podaje `serwer\insertgt`, a
instalator InsERT-u zakłada instancję `INSERTGT`. Samo `MSSQL_SERVER` celuje
w instancję domyślną. Worker skleja więc `HOST\INSTANCJA` tak samo jak
`config.mssql` po stronie Node.

## 2. Wartości wyliczeń, które są opublikowane

`UruchomEnum` — drugi argument `Uruchom`, maska bitowa:

| stała | wartość | znaczenie |
|---|---|---|
| `gtaUruchom` | `0x0` | podłącz się do działającej, uruchom dopiero, gdy jej nie ma |
| `gtaUruchomNieZablokowany` | `0x1` | pomiń aplikację zajętą interfejsem użytkownika |
| `gtaUruchomNowy` | `0x2` | zawsze nowa instancja |
| `gtaUruchomWTle` | `0x4` | bez interfejsu użytkownika, bez okna |

`UruchomDopasujEnum.gtaUruchomDopasuj` to `0x0`: pierwsza znaleziona aplikacja
tego typu, podłączona do wskazanego serwera i bazy.

Worker wysyła `gtaUruchomNowy | gtaUruchomWTle`; powód opisuje §2f.

## 2a. Składowe obiektu `InsERT.GT` (sonda na maszynie firmy)

Obiekt COM `InsERT.GT` **powstaje**, a jego składowe wyglądają tak:

| rodzaj | nazwy |
|---|---|
| metody | `Uruchom`, `Wczytaj` |
| właściwości | `Autentykacja`, `Baza`, `Klucz`, `Konfiguracja`, `Operator`, `OperatorHaslo`, `Polaczenie`, `Produkt`, `ProduktNazwa`, `Serwer`, `Uzytkownik`, `UzytkownikHaslo` |

Wszystkie nazwy logowania z naszego kodu istnieją, w tym `Uzytkownik`
i `UzytkownikHaslo`.

**`ProduktNazwa` daje numer produktu za darmo.** Czyta się ją zaraz po
ustawieniu `Produkt`, bez logowania i bez licencji. Sonda przechodzi wartości
od 0 do 8 i wypisuje nazwy, więc `gtaProduktSubiekt` ustala się bez jednego
dokumentu.

## 2b. Pułapka: HRESULT `0x8004xxxx` kłamie w komunikacie

`Uruchom()` odmawia z kodem `0x80041329`, a Windows dokleja do niego zdanie
o „aparacie planowania". To zdanie **nie ma ze Sferą nic wspólnego**.

Kody `0x8004xxxx` należą do grupy interfejsowej: znaczenie nadaje im ta
biblioteka, która je zwróciła. Windows zna z tej puli kody Harmonogramu zadań
i podstawia jego opis. Liczy się sama liczba, nie tekst.

Dla Sfery `0x80041329` znaczy: **hasło loginu SQL zaczyna się od cyfry albo od
litery `a`–`f`**. Rozwiązanie brzmi absurdalnie i takie jest — hasło ma się
zaczynać od litery z zakresu `g`–`z`. Ten sam kod pada przy pustym albo
błędnym loginie SQL.

## 2c. `ProduktEnum` — ustalone na żywej Sferze

Sonda odczytała `ProduktNazwa` dla kolejnych numerów, bez logowania:

| `Produkt` | nazwa |
|---|---|
| 1 | Subiekt |
| 2 | Rachmistrz |
| 3 | Rewizor |
| 4 | Gratyfikant |
| 5 | MikroGratyfikant |
| 6 | Gestor |
| 8 | nazwa nieczytelna w konsoli (polskie znaki) |

Numer 7 nie oddaje nazwy, a numer 8 przyszedł jako krzaki — to strona kodowa
konsoli, nie błąd Sfery. Sonda ustawia wyjście na UTF-8.

`gtaProduktSubiekt` to **1**, czyli domyślna wartość `SFERA_PRODUKT`. Punkt 1
listy `[WERYFIKUJ]` zamknięty.

## 2d. Dwa różne kody odmowy przy `Uruchom()`

Dwie wartości `Autentykacja` dają **różne kody**, a ta różnica jest całą
diagnozą.

| `Autentykacja` | kod | co znaczy |
|---|---|---|
| 0 | `0x8004132B` | baza otwarta, przewróciło się URUCHOMIENIE Subiekta w tle |
| 1 | `0x80041329` | Sfera nie weszła do bazy — login albo hasło SQL |

Producent opisuje `0x8004132B` zdaniem „nie udało się uruchomić instancji
Subiekta w tle — sprawdź dane logowania do Subiekta". To kieruje uwagę na
**operatora**, nie na login SQL. Sprawdź po kolei:

1. `SFERA_OPERATOR` — dokładna nazwa operatora z Subiekta.
2. `SFERA_OPERATOR_HASLO` — jego hasło; puste też bywa błędem.
3. Prawo do Sfery na tym operatorze, nadawane w Subiekcie.
4. Licencja Sfery na tym podmiocie.

Wartość `0` prowadzi dalej niż `1` i to ona jest domyślna. Ten sam kod daje
też podłączenie do otwartego Subiekta w trybie w tle — §2f.

## 2e. Model obiektowy Subiekta — managery sesji

Sonda z przełącznikiem `-ZOknem` weszła do Subiekta i wypisała, co wisi na
obiekcie sesji. **Managerów jest jedenaście:**

```
CesjeManager            EFakturyKSeFManager   FinManager
InwentaryzacjaManager   KontrahenciManager    RaportyKasoweManager
SesjeKasoweManager      SMSManager            SuDokumentyManager
TowaryManager           WyciagiBankoweManager
```

`DokumentyMagazynoweManager` i `DokumentyHandloweManager` **nie istnieją**.
Dokumenty siedzą pod **`SuDokumentyManager`**. Sonda wypisuje składowe KAŻDEGO
managera, więc nazw metod się nie zgaduje.

## 2f. Tryb w tle: podłączenie kontra własna instancja

Przy identycznych danych logowania:

| wywołanie | wynik |
|---|---|
| `Uruchom(dopasuj, gtaUruchom \| gtaUruchomWTle)` | `0x8004132B` |
| `Uruchom(dopasuj, gtaUruchom)` — z oknem | **sesja otwarta** |

Dane były dobre, a blokował sam tryb. `gtaUruchom` znaczy „podłącz się do
działającego Subiekta". Gdy Subiekt jest otwarty, Sfera próbuje podłączyć się
do instancji z interfejsem i jednocześnie żąda pracy bez okna.

Worker wysyła więc `gtaUruchomNowy | gtaUruchomWTle`, czyli **własną instancję
w tle**. Tak brzmi też wywołanie z dokumentacji producenta. Usługa nie ma prawa
zależeć od czyjegoś pulpitu: instancję otwartą przez człowieka ktoś kiedyś
zamknie albo zablokuje oknem dialogowym. Wartość da się nadpisać przez
`SFERA_TRYB_URUCHOMIENIA`.

## 2g. Tryb w tle działa — zmierzone

Po zamknięciu Subiekta i z trybem `gtaUruchomNowy | gtaUruchomWTle` sonda
otworzyła sesję **bez okna**, za pierwszym podejściem:

```
JEST  sesja otwarta BEZ OKNA — Autentykacja=0, tryb NOWY|W_TLE (0x6)
```

To zamyka punkt 3: **usługa `wertis-sfera` da się uruchomić bez pulpitu.**
`SFERA_AUTENTYKACJA=0` jest właściwą wartością na tej instalacji.

## 2h. Metody `SuDokumentyManager` — punkty 4 i 8 zamknięte

Manager wystawia dokumenty metodami nazwanymi **symbolem dokumentu**. Wyciąg
z tego, co nas dotyczy:

| metoda | dokument | punkt |
|---|---|---|
| `DodajMM` | przesunięcie międzymagazynowe | 4 — **zamknięty** |
| `DodajRW` | rozchód wewnętrzny | 8 — **zamknięty** |
| `DodajKFS` | korekta faktury sprzedaży | 6 — nazwa wybrana, sygnatura otwarta |
| `DodajPW`, `DodajPZ`, `DodajWZ`, `DodajFS`, `DodajZD` … | reszta rodzajów | — |

Na managerze siedzą cztery metody skutku magazynowego:

```
SkutekMagazynowyWywolaj   SkutekMagazynowyOdloz
SkutekMagazynowyCofnij    SkutekMagazynowyWywolajTylkoNaMagZrodl
```

„Wykonany kontra bufor" nie jest więc domyślnym zachowaniem `Zapisz()`, tylko
**osobną decyzją z własnym wywołaniem**. Której użyć i czy `Zapisz()` sam już
coś robi — rozstrzyga bramka 2, bo to zachowanie, nie nazwa.

## 2i. Sygnatury metod

Sonda wypisuje listy argumentów. Dwie linie zmieniają kod:

```
SuDokument DodajKFS ()
void SkutekMagazynowyWywolaj (int)
```

**Wszystkie `Dodaj*` na `SuDokumentyManager` są bezargumentowe** i zwracają
`SuDokument`, także `DodajKFS`. Dokument powstaje najpierw jako **obiekt**,
a dopiero `Zapisz()` go utrwala. Powiązanie korekty z dokumentem pierwotnym
siedzi na obiekcie; manager ma osobne `SuDokument WczytajDokument(Variant)`.

**Skutek magazynowy bierze `int`** — czyli identyfikator dokumentu. Po zapisie
MM da się więc jawnie zażądać wykonania, zamiast liczyć na domyślne zachowanie
`Zapisz()`.

Skoro `DodajMM()` tworzy obiekt bez zapisu, jego właściwości można obejrzeć
bez wystawiania dokumentu. Robi to sonda z przełącznikiem `-SzkicMM`, domyślnie
wyłączonym, bo to jedyne `Dodaj*` w całym skrypcie.

## 2j. Szkic MM — właściwości dokumentu

Przełącznik `-SzkicMM` tworzy MM w pamięci i wypisuje jego właściwości.
Dokument nie powstaje: `Zapisz()` nie pada ani razu.

**Magazyny na dokumencie:**

```
Property     MagazynNadawczyId
Property     MagazynOdbiorczyId
```

`MagazynZrodlowyId` i `MagazynDocelowyId` nie istnieją. Ustawienie magazynów
przeszło bez odmowy (`nadawczy=1`, `odbiorczy=12`), więc nazwy są potwierdzone
na żywym obiekcie.

`MagazynId` na dokumencie nie ma — ta właściwość stoi na SESJI. RW dostaje
więc `MagazynNadawczyId`, bo rozchód wyprowadza towar. Lista składowych jest
wspólna dla wszystkich typów dokumentu, więc istnienie właściwości nie dowodzi,
że RW jej używa. Wołanie zastępcze to `su.MagazynId` przed `DodajRW()`.

**Powiązanie korekty z dokumentem pierwotnym to metoda, nie właściwość.**

```
void NaPodstawie (Variant)
void NaPodstawieWielu (SAFEARRAY(int))
Property DoDokumentuId
Property DokumentyZrodlowe
```

Wariant „wielu" bierze tablicę `int`, więc `NaPodstawie` przyjmuje najpewniej
identyfikator. `DoDokumentuId` wygląda na pole odczytywane po powiązaniu.
Korekta musi przejąć pozycje dokumentu pierwotnego, a to robi wywołanie.

**`Usun` bierze flagę:** `void Usun (bool)`. Sygnatura jest znana, znaczenie
flagi nie. Adapter podaje `false`, bo w każdym czytaniu tej flagi to działanie
węższe: jeden dokument i bez pytania. Usługa nie ma pulpitu, na którym mogłaby
na pytanie odpowiedzieć.

**Potwierdzone:** `NumerPelny`, `Zapisz()`, `Pozycje`. Pustą kolekcję czyta się
przez `Get-Member -InputObject`. Potok ją ROZWIJA: pusta kolekcja nie wysyła
elementu i wraca „You must specify an object", co wygląda na brak obiektu.

Dwie metody przydają się przed pierwszym zapisem: `SprawdzPoprawnosc()`
i `ZapiszSymulacja()`. Dokument ma też własną właściwość `SkutekMagazynowy` —
to ona odpowie, czy zapis wykonał ruch, czy odłożył go do bufora.

## 2k. Kolekcja pozycji

Składowe `Pozycje`:

```
IDispatch Dodaj (Variant)
IDispatch DodajUslugeJednorazowa ()
IDispatch DodajUslugeJednorazowaWgOrygLp (int)
IDispatch DodajWgOrygLp (Variant, int)
IDispatch Wczytaj (Variant)
ParameterizedProperty Element
Property Liczba
```

**`Dodaj(Variant)` istnieje i bierze jeden argument** — tak woła adapter przy
MM i RW. **`SzukajTowar` nie istnieje.** Kolekcja daje trzy drogi do pozycji:
indeks `Element`, `Wczytaj(Variant)` i licznik `Liczba`. Żadna z nich nie
szuka po kartotece, więc korekta przechodzi po wierszach.

`sonda.ps1 -SzkicMM -Towar <tw_Id>` dodaje pozycję w PAMIĘCI, tak samo jak
sam dokument. `Zapisz()` nie pada, więc w bazie nie zostaje ślad. Sonda
wypisuje składowe pozycji i sprawdza `Element(0)` oraz `Element(1)`.

## 2l. Pozycja dokumentu — komplet nazw

`-SzkicMM -Towar 7341` dodał pozycję w pamięci i wypisał jej składowe.

**Ilość nazywa się `IloscJm`.** Pozycja ma obok `Ilosc` i `Jm`; `IloscJm`
liczy w jednostce miary z kartoteki.

**Kartotekę na pozycji niesie `TowarId`.** Obok stoją `TowarSymbol`,
`TowarNazwa` i `TowarRodzaj`. Pozycję korekty adresuje się przejściem po
wierszach z porównaniem `TowarId`.

**`Element` liczy OD JEDYNKI.** Zmierzone, nie założone:

```
Liczba pozycji po Dodaj: 1
Element(0) -> odmowa: Wartość jest spoza oczekiwanego zakresu.
Element(1) -> obiekt
```

Pomyłka o jeden nie wywróciłaby pętli. Zgubiłaby PIERWSZĄ albo OSTATNIĄ
pozycję korekty, a dokument powstałby poprawny dla Sfery i zły dla klienta.

**`IloscPoKorekcie` nie istnieje.** Pozycja ma jedno pole ilości, więc korekta
ustawia ilość docelową — tak samo, jak Subiekt pyta o nią na ekranie. To
pytanie o znaczenie, nie o nazwę, więc zostaje `[WERYFIKUJ]` do pierwszej
prawdziwej korekty.

**Pozycja ma własne `MagazynId`.** Trzecia droga do magazynu dla RW, obok
właściwości dokumentu i właściwości sesji. Rozstrzyga pierwszy RW.

Na później: `Dysponuj(Variant, Variant)`, `PodajDostepneDostawy()`
i `DostepnaIlosc`. Wskazywanie dostaw przy rozchodzie ma tu gotowy mechanizm,
gdyby firma go kiedyś potrzebowała.

## 2m. ZW — zwrot do paragonu

Ustalenia z sondy (`-SzkicZW`, `-WzorZW`) i z przebiegów workera na maszynie
firmy. Szkic sondy powstaje w pamięci: `Zapisz()` nie pada.

### Co robi Sfera

- **`DodajZW()` daje dokument typu 14.** To ten sam typ, który import czyta
  jako ZW (`DOK_TYPY_KOREKT`), więc numer ZW wraca do zwrotu sam.
- **`NaPodstawie(dok_Id)` działa dla paragonu** (`dok_Typ = 21`). Ustawia
  `DoDokumentuId` i `DoDokumentuNumerPelny`, a datę sprzedaży bierze z PA.
  Dla WZ odmawia zdaniem „Nie można wystawić korekty do dokumentu WZ…".
  Dla starej faktury odmawia zdaniem „Nie można wystawić korekty do
  dokumentu".
- **Pozycje przychodzą z paragonu — tylko te, które jeszcze nie wróciły.**
  Paragon z wcześniejszym ZW daje wyłącznie niezwrócone wiersze.
- **`DokHanLp` to numer wiersza na ZW, nie na paragonie.** Pozycje dopasowuje
  się więc po `TowarId`, tak jak przy KFS.
- **Przelew startuje od kwoty paragonu.** Po zmianie ilości wartość,
  `KwotaDoZaplaty` i przelew schodzą razem. Paragon z wcześniejszym ZW daje
  jednak przelew równy CAŁEMU paragonowi, więc przelew ustawia się jawnie.
- **Po `IloscJm = 0` Subiekt przelicza dokument sam**, bez `Przelicz()`.
  Wyzerowany wiersz zostaje na ZW z `WartoscBruttoPoRabacie = 0`.
- **„Zwrot ze sprzedaży" to `RodzajZwrotuDetal = 1`.** `NaPodstawie` zostawia
  tam 0, a ZW wystawiony ręcznie przez biuro ma 1.
- **`NaPodstawie` blokuje paragon.** Drugie powiązanie odmawia zdaniem „Nie
  można zablokować obiektu. Obiekt został zablokowany przez operatora…".
  Blokadę trzyma otwarty szkic albo okno Subiekta.
- **Dokument ma `void Zamknij()`, a sesja `bool Zakoncz()`.** Worker woła
  `Zakoncz()` przy każdym zamknięciu sesji, bo proces Subiekta zostawiony
  w tle po kilku sesjach oddaje sesję pustą.
- **ZW wywołuje skutek magazynowy: przyjmuje towar na magazyn główny**
  (właściciel). MM koszyka czeka, aż każdy zwrot w nim ma `korekta_numer`
  (`brakujaceKorekty` w `kosze-zwrotow.ts`). ZW oddaje towar na MAG, MM
  koszyka zabiera go na bufor zwrotów albo odpad, MM powrotu wraca na MAG.
- **Paragon z Allegro ma wiersz przesyłki.** Pozycja 943 „PRZESYŁKA" to usługa
  z `CenaMagazynowa = 0`.
- **`Wystawil` i `WydanieKatId` wypełnia okno Subiekta, nie pokazując ich.**
  Szkic z COM ma je puste, a bez nich `Zapisz()` odmawia kodem `0x80040F20`
  i zdaniem „Nie można zapisać dokumentu.". `SprawdzPoprawnosc()` taki szkic
  przepuszcza, a `SzczegolyOstatniegoBledu` jest puste.
- **`WartoscVatPP` jest `null` na każdym szkicu z COM**, a `0.0000` na
  zapisanym ZW biura. `PozycjaTypPromocji` odmawia odczytu kodem `0x8004197F`
  także na zapisanym dokumencie; to cecha pola, nie przyczyna odmowy.
- **Odmowa zapisu potrafi zostawić numer, którego nie ma.** Import czyta
  dokumenty z `NOLOCK` i widzi wiersz z zapisu, który Subiekt wycofał. Dlatego
  korekta wchodzi do read-modelu dopiero przy drugim imporcie
  (`adapters/korekty-dojrzale.ts`).

### Decyzje właściciela

- **Przesyłka na ZW idzie za polem „Koszt dostawy" w panelu zwrotów.**
  Odznaczone pole daje `kwota_dostawa_grosze` równe 0 i zero na wierszu
  przesyłki. Zaznaczone zostawia go z ilością 1, jak `delivery` w zwrocie
  pieniędzy Allegro.
- **Wyzerowana pozycja zostaje na ZW.** Biuro zeruje w oknie ZW produkty,
  które nie wróciły, i worker robi to samo. Nie usuwa wierszy.

### Kroki workera

Serwer zleca zadanie `zw` po zapisaniu kwoty (`services/zw-automat.ts`),
a worker Sfery wystawia ZW (`SferaComAdapter.WystawZw`). Kolejność kroków:

1. `DodajZW()` i `NaPodstawie(dok_Id)`. Blokada paragonu odkłada zadanie
   o 2 minuty bez zużycia próby.
2. `SkutekMagazynowy = False` kończy zadanie błędem dla biura.
3. `RodzajZwrotuDetal = 1`.
4. Pozycje po `TowarId`. Zwracane dostają swoją ilość, reszta 0, a przesyłka
   idzie za polem dostawy.
5. Wartość ZW porównana z pełną wartością zwrotu co do grosza. Rozjazd kończy
   zadanie bez `Zapisz()`.
6. `PlatnoscPrzelewKwota = WartoscBrutto`.
7. `WartoscVatPP = 0`, gdy szkic ma tam pustkę.
8. `Wystawil` dostaje nazwę operatora sesji, a `WydanieKatId` wartość
   `SFERA_ZW_WYDANIE_KAT_ID` z `wertis.env`.
9. `SprawdzPoprawnosc()`, `Zapisz()`, `NumerPelny` i zawsze `Zamknij()`.

`Zamknij()` pada zawsze, także po odmowie, bo inaczej biuro nie otworzy
paragonu. Odmowa blokady znaczy „spróbuj później", nie błąd zwrotu. Numer ZW
wpisuje do zwrotu worker Node co minutę, jako `korekta_zrodlo='sfera'`. Wtedy
ruszają koszyki czekające na numer.

Kategorii `WydanieKatId` worker nie zgaduje. Odczytuje ją `--zrzut` ZW
wystawionego przez biuro, który podaje `WydanieKatId` i `PrzyjecieKatId`. Bez
klucza worker dalej próbuje zapisać, a treść odmowy mówi, czego zabrakło.
Klucz opisuje `wertis.env.example`.

### Diagnostyka odmowy

Sfera przy odmowie nie mówi DLACZEGO, więc treść odmowy mówi CZEGO dotyczyła.
Błąd niesie numer paragonu, `dok_Id`, wartość, przelew, rodzaj zwrotu, skutek
magazynowy, liczbę wierszy i łańcuch wyjątków z HRESULT. Niesie też gotową
komendę sondy z tymi numerami.

**Worker robi zrzut pól sam, w chwili odmowy**, na obiekcie, który nie
przeszedł. Wylicza właściwości z informacji o typie IDispatch, tą samą drogą
co `Get-Member` w sondzie. Wartości płatności, kwot i rodzaju wypisuje wprost.
O polach nabywcy, adresu i rachunku mówi tylko „puste" albo „wypełnione".
Pozostałe pola nagłówka i wierszy dostają „puste", „wypełnione" albo kod
odmowy odczytu. Udany ZW nie płaci ani jednego wywołania więcej.

Tryb `--zrzut <dok_Id>` czyta istniejący dokument tą samą drogą z C#.
Porównanie z dokumentem, który przeszedł, robi sonda `-WzorZW` albo:

```powershell
& C:\wertis\sfera-worker\wertis-sfera-worker.exe --zrzut 9253431
```

Sonda `-SzkicZW -Paragon <dok_Id> -Towary "tw=ilosc" -Sprawdz` pokazuje
przyczynę bez zapisu. PowerShell zamienia odmowę odczytu COM w `null`, więc
sonda nie rozróżnia pola pustego od pola, które odmawia. Zrzut z C# je
rozróżnia.

**Reguła dla następnego dokumentu z COM:** zestaw PEŁNY zrzut szkicu z ręcznym
dokumentem, a nie tylko pola z listy. Przyczyna odmowy ZW stała w polu spoza
pierwszej listy.

**Wykluczone przyczyny odmowy ZW.** Każdą sprawdzono na produkcji:

- konto usługi `LocalSystem` — sesja na koncie użytkownika odmawia tak samo;
- połączenie i operator — MM z tej samej sesji zapisuje się poprawnie;
- dokument i uprawnienia — ten sam ZW przechodzi ręką na koncie operatora
  workera;
- suma form płatności i pusty nabywca — zrzut pokazuje przelew równy kwocie
  do zapłaty, pozostałe formy zerowe i nabywcę z paragonu;
- przyjęcie na magazyn w środku zapisu — zapis z odłożonym skutkiem odmawia
  tak samo;
- wydruk po zapisie, ukryte okno i sam tryb `W_TLE` — przebieg z widocznym
  oknem odmawia tak samo.

### Otwarte

`[WERYFIKUJ]` Worker nie woła `Zamknij()` po `Zapisz()` przy MM ani KFS.
Czy zapisany dokument zostaje przez to zablokowany dla biura, pokaże pierwsze
MM na produkcji.

`[WERYFIKUJ]` Dlaczego szkic do PA 8995 miał `SkutekMagazynowy = False`, a inne
szkice `True`. Pozycje PA 8995 mają `CenaMagazynowa = 0`. Do czasu ustalenia
automat NIE wystawia ZW z `False` i oddaje zwrot biuru. ZW bez przyjęcia na
MAG, a po nim MM koszyka, zdjęłyby ze stanu towar dwa razy.

`[WERYFIKUJ]` Pierwszy prawdziwy ZW z automatu: czy `Zapisz()` daje dokument
wykonany i czy przelew na zapisanym ZW zgadza się z wartością.

`[WERYFIKUJ]` Co dokładnie znaczy `0x80040F20` przy `SuDokument.Zapisz()`.
Facility tego kodu to `ITF`, czyli numer WEWNĘTRZNY Sfery, nie błąd Windows.

`[WERYFIKUJ]` Czy do zapisu ZW wystarcza `Wystawil`, czy potrzebna jest też
`WydanieKatId`. Worker ustawia oba naraz.

`[WERYFIKUJ]` Przyczyna odmowy zapisu ZW z próby workera. Ten sam ZW przeszedł
ręką na koncie operatora workera, więc podejrzane są pola ustawiane przez
worker. Potwierdzi to dopiero pierwszy ZW z automatu.

## 3. Czego z publicznych źródeł ustalić się nie da

Trzy grupy. Odpowiada na nie sonda (§2a–§2m) i bramka 2.

1. **Wartości liczbowe `ProduktEnum` i `AutentykacjaEnum`.** Nazwy stałych są
   opublikowane, liczby nie. Domyślne wartości siedzą w `wertis.env`
   (`SFERA_PRODUKT`, `SFERA_AUTENTYKACJA`), nie w kodzie. Poprawka na hali
   kosztuje restart usługi, nie przebudowanie exe.
2. **Model dokumentów.** Nazwy managerów, metod `Dodaj*` i właściwości
   dokumentu opisuje wyłącznie InfoSfera.
3. **Skutek `Zapisz()`.** Czy dokument powstaje wykonany, czy trafia do bufora.
   Tego nie widać po nazwach; to widać po jednym wystawionym MM.

## 4. Jak zamknąć resztę listy

**Najpierw sonda.** [`sfera-worker/sonda.ps1`](../sfera-worker/sonda.ps1)
otwiera sesję i wypisuje nazwy składowych. `Zapisz()` nie pada w niej ani razu,
więc w bazie nie zostaje ślad. Zamyka punkty od 1 do 4, 6 i 8, bez pakietu SDK.
Przełącznik `-SzkicMM` dokłada właściwości samego dokumentu.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\sonda.ps1
```

Sonda potrzebuje **działającej licencji Sfery**, bo otwiera prawdziwą sesję.
Kopia bazy do tego nie służy: przywrócony podmiot traci licencje i chodzi jako
demo. Właściwe miejsce to podmiot testowy z próbną Sferą albo produkcja —
sonda i tak niczego nie zapisuje.

**Potem bramka 2** z [`wdrozenie.md`](wdrozenie.md): jedno prawdziwe MM na
kartotece próbnej, na PODMIOCIE TESTOWYM. Ona rozstrzyga punkty 5 i 7 oraz nazwy
właściwości na samym dokumencie.

Po ustaleniach poprawia się jeden plik — `SferaComAdapter.cs` — i dopisuje
wynik tutaj. Znacznik zdjęty z listy w `sfera-worker/README.md` ma tu zostawić
zdanie o tym, co go zamknęło.

## Źródła

Wartości w §1 i §2 pochodzą z opublikowanych przykładów i opisu wyliczeń Sfery,
cytowanych w poniższych wątkach:

- [Subiekt GT Sfera — przykład logowania](https://programowanie.cal.pl/forum/viewtopic.php?f=2&t=2222) (pełna sekwencja właściwości obiektu GT)
- [Sfera Subiekt GT — wywołanie Uruchom w C#](https://4programmers.net/Forum/C_i_C++/191405-sfera_subiekt_gt) (maska trybu uruchomienia)
- [Problem z integracją przez Sferę](https://forumsubiekta.pl/dodatki-zestawienia/problem-z-integracja-\(polaczenie-przez-sfere\)/10?wap2=) (wartości `UruchomEnum` i `UruchomDopasujEnum`)
- [Sfera dla InsERT GT — informacje zaawansowane](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/7667,sfera-dla-insert-gt-%E2%80%93-informacje-zaawansowane.html) (gdzie szukać InfoSfery)
- [Konfiguracja integracji z Subiektem GT](https://docs.easystorage.io/pl/panel-web/konfiguracja/integracje/subiekt-gt) (`0x80041329` a pierwszy znak hasła SQL)
- [Najczęstsze problemy przy połączeniu ze Sferą](https://pomoc.integratory.pl/subsync-integracja-z-subiektem/rozwiazywanie-problemow/najczestsze-problemy/) (to samo, niezależnie)

Sekcje od 2a do 2l mają inne źródło: **przebiegi sondy na maszynie firmy**,
4 września 2026. Sekcja 2m pochodzi z przebiegów sondy i workera od 15 do
23 września 2026. To jedyne ustalenia w tym pliku potwierdzone na żywej Sferze.
