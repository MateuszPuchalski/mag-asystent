# Sfera Subiekta GT — kształt COM, który mamy ustalony

`CLAUDE.md` mówi o Allegro: kształt czyta się z pliku, nie z pamięci. Mapowanie
z pamięci kosztowało tam trzy wydania. Sfera stała do 0.197.0 dokładnie po tej
złej stronie reguły: dwadzieścia cztery znaczniki `[WERYFIKUJ]` w jednym pliku,
zero zapisanych źródeł.

Ten dokument zbiera to, co udało się ustalić **z dokumentacji i z opublikowanych
przykładów producenta**, oraz nazywa wprost to, czego stamtąd ustalić się nie da.
Autorytetem pozostaje **InfoSfera** — pomoc instalowana razem ze Sferą, na
maszynie klienta. Nie ma jej w tym repozytorium i nie będzie: to cudza treść,
a repozytorium jest publiczne.

Kod, którego to dotyczy: [`sfera-worker/src/SferaComAdapter.cs`](../sfera-worker/src/SferaComAdapter.cs).
Lista punktów `[WERYFIKUJ]`: [`sfera-worker/README.md`](../sfera-worker/README.md).

## 1. Logowanie — komplet właściwości

Przykład producenta ma osiem kroków przed `Uruchom`. Nasz kod miał sześć.

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

Wynikają z tego dwie poprawki, obie wydane w 0.197.0.

**Login SQL to osobna para kluczy.** `Uzytkownik` i `UzytkownikHaslo` to
uwierzytelnienie w bazie. `Operator` i `OperatorHaslo` to użytkownik Subiekta.
Przy autentykacji mieszanej Sfera potrzebuje obu par. Nasz kod ustawiał tylko
drugą, więc połączenie nie miało czym otworzyć bazy.

Warto to rozdzielić dokładnie, bo nazwy mylą.

| pole | co to jest | kto to zwykle podaje |
|---|---|---|
| `Operator` | **login do Subiekta** — ten sam, który wpisujesz przy otwieraniu programu (np. „Szef") | człowiek, w oknie logowania |
| `Uzytkownik` | login do **SQL Servera**, na którym stoi baza podmiotu | sam Subiekt, z ustawień połączenia podmiotu |

Uruchamiając Subiekta z pulpitu, drugiego z nich nigdy nie widzisz — program
bierze go z własnej konfiguracji. Przez Sferę to **Ty tworzysz obiekt GT**,
więc podajesz oba. Przy autentykacji Windows loginu SQL nie ma wcale: bazę
otwiera konto, na którym działa proces.

Stąd praktyczny wniosek dla usługi. `wertis-sfera` działa na koncie usługi,
a nie na Twoim — przy autentykacji Windows to konto musi mieć dostęp do bazy.

To **nie jest** `MSSQL_USER` z `wertis.env`. Tamten login ma z założenia prawo
`SELECT` na sześciu tabelach i `UPDATE` na dwóch kolumnach (`DEPLOY.md` §6).
Sfera wystawia dokumenty i potrzebuje pełnych praw podmiotu. Stąd osobne klucze
`SFERA_SQL_LOGIN` i `SFERA_SQL_HASLO`.

**Adres serwera zawiera instancję.** Przykład podaje `serwer\insertgt`, a
instalator InsERT-u zakłada instancję `INSERTGT`. Nasz kod wysyłał samo
`MSSQL_SERVER`, czyli celował w instancję domyślną. Teraz skleja
`HOST\INSTANCJA` tak samo jak `config.mssql` po stronie Node.

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

Worker wysyłał do 0.198.4 `Uruchom(0x0, 0x0 | 0x4)`, a wcześniej gołe
`Uruchom(0, 4)` — te same liczby, bez śladu, skąd się wzięły. Dziś wysyła
`gtaUruchomNowy | gtaUruchomWTle`; powód opisuje §2f.

## 2a. Co potwierdziła sonda na maszynie firmy (0.197.2)

Pierwszy przebieg `sonda.ps1` u właściciela zamknął punkt 1 i większość punktu
2. Obiekt COM `InsERT.GT` **powstaje**, a jego składowe wyglądają tak:

| rodzaj | nazwy |
|---|---|
| metody | `Uruchom`, `Wczytaj` |
| właściwości | `Autentykacja`, `Baza`, `Klucz`, `Konfiguracja`, `Operator`, `OperatorHaslo`, `Polaczenie`, `Produkt`, `ProduktNazwa`, `Serwer`, `Uzytkownik`, `UzytkownikHaslo` |

Z tego wynikają trzy rzeczy.

**Poprawka z 0.197.0 trafiła.** `Uzytkownik` i `UzytkownikHaslo` naprawdę są na
obiekcie, więc login SQL miał gdzie jechać. Wcześniejszy kod ich nie ustawiał.

**Wszystkie nazwy z naszego kodu istnieją.** Żadna właściwość logowania nie
okazała się zmyślona.

**`ProduktNazwa` daje numer produktu za darmo.** Czyta się ją zaraz po
ustawieniu `Produkt`, bez logowania i bez licencji. Sonda przechodzi teraz
wartości od 0 do 8 i wypisuje nazwy, więc `gtaProduktSubiekt` ustala się
bez jednego dokumentu.

## 2b. Pułapka: HRESULT `0x8004xxxx` kłamie w komunikacie

`Uruchom()` odmówił z kodem `0x80041329`, a Windows dokleił do niego zdanie
o „aparacie planowania". To zdanie **nie ma ze Sferą nic wspólnego**.

Kody `0x8004xxxx` należą do grupy interfejsowej: znaczenie nadaje im ta
biblioteka, która je zwróciła. Windows zna z tej puli kody Harmonogramu zadań
i podstawia jego opis. Liczy się sama liczba, nie tekst.

Dla Sfery `0x80041329` znaczy co innego: **hasło loginu SQL zaczyna się od
cyfry albo od litery `a`–`f`**. Rozwiązanie brzmi absurdalnie i takie jest —
hasło ma się zaczynać od litery z zakresu `g`–`z`. Ten sam kod pada przy pustym
albo błędnym loginie SQL, a tak było w pierwszym przebiegu.

## 2c. `ProduktEnum` — ustalone na żywej Sferze (0.197.4)

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
konsoli, nie błąd Sfery. Sonda ustawia teraz wyjście na UTF-8.

`gtaProduktSubiekt` to **1**, czyli domyślna wartość
`SFERA_PRODUKT` była trafna. Punkt 1 listy `[WERYFIKUJ]` zamknięty.

## 2d. Dwa różne kody odmowy przy `Uruchom()`

Pierwsze logowanie na produkcji dało **różne kody dla dwóch wartości
`Autentykacja`**, a ta różnica jest całą diagnozą.

| `Autentykacja` | kod | co znaczy |
|---|---|---|
| 0 | `0x8004132B` | baza otwarta, przewróciło się URUCHOMIENIE Subiekta w tle |
| 1 | `0x80041329` | Sfera nie weszła do bazy — login albo hasło SQL |

Producent opisuje `0x8004132B` zdaniem „nie udało się uruchomić instancji
Subiekta w tle — sprawdź dane logowania do Subiekta". To kieruje uwagę na
**operatora**, nie na login SQL. Cztery rzeczy do sprawdzenia po kolei:

1. `SFERA_OPERATOR` — dokładna nazwa operatora z Subiekta.
2. `SFERA_OPERATOR_HASLO` — jego hasło; puste też bywa błędem.
3. Prawo do Sfery na tym operatorze, nadawane w Subiekcie.
4. Licencja Sfery na tym podmiocie.

Wartość `0` prowadzi więc dalej niż `1` i to ona zostaje domyślna. Że blokadą
jest sam tryb w tle, rozstrzygnął kolejny przebieg — §2f.

## 2e. Pierwsza otwarta sesja — model obiektowy Subiekta (0.198.4)

Sonda z przełącznikiem `-ZOknem` weszła do Subiekta i wypisała, co naprawdę
wisi na obiekcie sesji. Wynik jest bezlitosny dla naszego kodu.

**Managerów jest jedenaście i nie ma wśród nich żadnego z naszych dwóch:**

```
CesjeManager            EFakturyKSeFManager   FinManager
InwentaryzacjaManager   KontrahenciManager    RaportyKasoweManager
SesjeKasoweManager      SMSManager            SuDokumentyManager
TowaryManager           WyciagiBankoweManager
```

`DokumentyMagazynoweManager` i `DokumentyHandloweManager` **nie istnieją**.
Obie nazwy przyszły ze szkicu kontraktu w `sfera.ts` i przez cały czas były
zgadywane. Dokumenty siedzą pod **`SuDokumentyManager`**.

To jest dokładnie ta cena, którą `CLAUDE.md` opisuje przy Allegro: mapowanie
z pamięci kosztuje wydania. Metod `Dodaj*` nie zgadujemy trzeci raz — sonda
wypisuje teraz składowe KAŻDEGO managera, więc następny przebieg poda nazwy.

## 2f. Tryb w tle: podłączenie kontra własna instancja

Ta sama sesja rozstrzygnęła drugą rzecz. Przy identycznych danych logowania:

| wywołanie | wynik |
|---|---|
| `Uruchom(dopasuj, gtaUruchom \| gtaUruchomWTle)` | `0x8004132B` |
| `Uruchom(dopasuj, gtaUruchom)` — z oknem | **sesja otwarta** |

Czyli dane były dobre od początku, a blokował sam tryb. Wyjaśnienie jest
proste: `gtaUruchom` znaczy „podłącz się do działającego Subiekta". Na tej
maszynie Subiekt był otwarty, więc Sfera próbowała podłączyć się do instancji
z interfejsem i jednocześnie zażądać pracy bez okna.

Worker wysyła od 0.198.4 `gtaUruchomNowy | gtaUruchomWTle`, czyli **własną
instancję w tle**. Tak brzmi też wywołanie z dokumentacji producenta. Usługa
i tak nie ma prawa zależeć od czyjegoś pulpitu: instancję otwartą przez
człowieka ktoś kiedyś zamknie albo zablokuje oknem dialogowym.

Wartość da się nadpisać przez `SFERA_TRYB_URUCHOMIENIA`.

## 2g. Tryb w tle działa — zmierzone (0.198.5)

Po zamknięciu Subiekta i z trybem `gtaUruchomNowy | gtaUruchomWTle` sonda
otworzyła sesję **bez okna**, za pierwszym podejściem:

```
JEST  sesja otwarta BEZ OKNA — Autentykacja=0, tryb NOWY|W_TLE (0x6)
```

To zamyka punkt 3 i odpowiada na pytanie, które ważyło najwięcej dla wdrożenia:
**usługa `wertis-sfera` da się uruchomić bez pulpitu.** Potwierdzone też
`SFERA_AUTENTYKACJA=0` jako właściwa wartość na tej instalacji.

## 2h. Metody `SuDokumentyManager` — punkty 4 i 8 zamknięte

Manager wystawia dokumenty metodami nazwanymi **symbolem dokumentu**. Stąd
nasze `DodajKorekte` nie miało prawa istnieć. Wyciąg z tego, co nas dotyczy:

| metoda | dokument | punkt |
|---|---|---|
| `DodajMM` | przesunięcie międzymagazynowe | 4 — **zamknięty** |
| `DodajRW` | rozchód wewnętrzny | 8 — **zamknięty** |
| `DodajKFS` | korekta faktury sprzedaży | 6 — nazwa wybrana, sygnatura otwarta |
| `DodajPW`, `DodajPZ`, `DodajWZ`, `DodajFS`, `DodajZD` … | reszta rodzajów | — |

Nazwy metod `DodajMM` i `DodajRW` okazały się trafione; zmyślony był sam
manager. Kod woła je od 0.198.5 przez `SuDokumentyManager`.

**Punkt 5 przestał być zgadywanką.** Na managerze siedzą cztery metody skutku
magazynowego:

```
SkutekMagazynowyWywolaj   SkutekMagazynowyOdloz
SkutekMagazynowyCofnij    SkutekMagazynowyWywolajTylkoNaMagZrodl
```

Czyli „wykonany kontra bufor" to nie jest domyślne zachowanie `Zapisz()`, tylko
**osobna decyzja z własnym wywołaniem**. Której użyć i czy `Zapisz()` sam już
coś robi — rozstrzyga bramka 2, bo to zachowanie, nie nazwa.

Sonda wypisuje od 0.198.5 także **sygnatury metod**, więc następny przebieg
poda listę argumentów `DodajKFS` i `SkutekMagazynowy*`.

## 2i. Sygnatury — i zgadnięta sygnatura, która była błędna (0.198.6)

Sonda wypisała listy argumentów. Dwie linie zmieniają kod:

```
SuDokument DodajKFS ()
void SkutekMagazynowyWywolaj (int)
```

**`DodajKFS` nie bierze żadnego argumentu.** Kod z 0.198.5 wołał
`DodajKFS(dok_Id)` i wywróciłby się na liczbie argumentów. Zgadnięcie sygnatury
kosztowało dokładnie tyle samo, co wcześniejsze zgadnięcie nazwy — to już drugi
raz w tym samym miejscu.

Wszystkie `Dodaj*` na `SuDokumentyManager` są bezargumentowe i zwracają
`SuDokument`. Dokument powstaje więc najpierw jako **obiekt**, a dopiero
`Zapisz()` go utrwala. Powiązanie korekty z dokumentem pierwotnym siedzi na
obiekcie; manager ma osobne `SuDokument WczytajDokument(Variant)`.

**Skutek magazynowy bierze `int`** — czyli identyfikator dokumentu. Po zapisie
MM da się więc jawnie zażądać wykonania, zamiast liczyć na domyślne zachowanie
`Zapisz()`.

Z tego wynika też droga do ostatniego punktu. Skoro `DodajMM()` tworzy obiekt
bez zapisu, jego właściwości można obejrzeć bez wystawiania dokumentu —
robi to sonda z przełącznikiem `-SzkicMM`. Domyślnie wyłączony, bo to jedyne
`Dodaj*` w całym skrypcie.

## 2j. Szkic MM — właściwości dokumentu, trzecia zgadnięta nazwa (0.198.7)

Przełącznik `-SzkicMM` utworzył MM w pamięci i wypisał jego właściwości.
Dokument nie powstał: `Zapisz()` nie padł ani razu.

**Magazynów na dokumencie nie nazywa się tak, jak stało w kodzie.**

```
Property     MagazynNadawczyId
Property     MagazynOdbiorczyId
```

`MagazynZrodlowyId` i `MagazynDocelowyId` nie istnieją. Adapter stał na nich
od pierwszego szkicu. To trzecia zgadnięta nazwa z rzędu, która wywróciłaby
się dopiero przy pierwszym zwrocie u klienta.

`MagazynId` na dokumencie też nie ma — ta właściwość stoi na SESJI. RW dostaje
więc `MagazynNadawczyId`, bo rozchód wyprowadza towar. Lista składowych jest
wspólna dla wszystkich typów dokumentu, więc istnienie właściwości nie dowodzi
jeszcze, że RW jej używa. Wołanie zastępcze to `su.MagazynId` przed `DodajRW()`.

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

**Potwierdzone bez zmian:** `NumerPelny`, `Zapisz()`, `Pozycje`.

**`Pozycje` nie były `null` — były PUSTE, a odmowa wyszła z sondy** (0.198.9).
`Get-Member` dostawał kolekcję potokiem, a potok ją ROZWIJA: pusta kolekcja nie
wysyła ani jednego elementu i wraca „You must specify an object". Wygląda to na
brak obiektu i tak to odczytałem. Poprawne wywołanie to
`Get-Member -InputObject`.

Ustawienie magazynów na dokumencie przeszło bez odmowy (`nadawczy=1`,
`odbiorczy=12`), więc nazwy z sekcji wyżej są potwierdzone na żywym obiekcie.

Dwie metody warte zapamiętania na bramkę 2: `SprawdzPoprawnosc()`
i `ZapiszSymulacja()`. Pierwsze prawdziwe MM da się nimi sprawdzić przed
`Zapisz()`. Dokument ma też własną właściwość `SkutekMagazynowy` — to ona
odpowie, czy zapis wykonał ruch, czy odłożył go do bufora.

## 2k. Kolekcja pozycji — i czwarta zgadnięta nazwa (0.198.11)

Po poprawce z 0.198.9 sonda wypisała wreszcie składowe `Pozycje`:

```
IDispatch Dodaj (Variant)
IDispatch DodajUslugeJednorazowa ()
IDispatch DodajUslugeJednorazowaWgOrygLp (int)
IDispatch DodajWgOrygLp (Variant, int)
IDispatch Wczytaj (Variant)
ParameterizedProperty Element
Property Liczba
```

**`Dodaj(Variant)` istnieje i bierze jeden argument** — dokładnie tak, jak woła
adapter przy MM i RW. Pierwsza zgadnięta nazwa w tej historii, która okazała
się trafiona.

**`SzukajTowar` nie istnieje.** Na tej nazwie stało adresowanie pozycji korekty
od pierwszego szkicu. To czwarta zgadnięta nazwa z rzędu, która nie przeżyła
zderzenia z listą składowych.

Kolekcja daje trzy drogi do pozycji: indeks `Element`, `Wczytaj(Variant)`
i licznik `Liczba`. Żadna z nich nie szuka po kartotece, więc korekta wymaga
przejścia po wierszach. Brakuje do tego dwóch rzeczy: nazwy właściwości
kartoteki na POZYCJI oraz podstawy indeksu `Element`.

Adapter nie zgaduje ich piąty raz. Krok adresowania pozycji korekty rzuca
wyjątek, który wymienia brakujące nazwy i wskazuje sondę. Korekty do tego czasu
wystawia biuro — czyli tak, jak przed workerem.

Zamyka to `sonda.ps1 -SzkicMM -Towar <tw_Id>`. Pozycja powstaje w PAMIĘCI, tak
samo jak sam dokument: `Zapisz()` nadal nie pada, więc w bazie nie zostaje ślad.
Sonda wypisze składowe pozycji i sprawdzi `Element(0)` oraz `Element(1)`.

## 2l. Pozycja dokumentu — komplet nazw (0.198.12)

`-SzkicMM -Towar 7341` dodał pozycję w pamięci i wypisał jej składowe.
`Zapisz()` nie padł, dokument nie powstał.

**Ilość nazywa się `IloscJm`** — dokładnie tak, jak stało w kodzie. Pozycja ma
obok `Ilosc` i `Jm`; `IloscJm` liczy w jednostce miary z kartoteki.

**Kartotekę na pozycji niesie `TowarId`.** Obok stoją `TowarSymbol`,
`TowarNazwa` i `TowarRodzaj`. To zamyka adresowanie pozycji korekty: przejście
po wierszach z porównaniem `TowarId`.

**`Element` liczy OD JEDYNKI.** Zmierzone, nie założone:

```
Liczba pozycji po Dodaj: 1
Element(0) -> odmowa: Wartość jest spoza oczekiwanego zakresu.
Element(1) -> obiekt
```

Pomyłka o jeden nie wywróciłaby tu pętli. Zgubiłaby PIERWSZĄ albo OSTATNIĄ
pozycję korekty, a dokument powstałby poprawny dla Sfery i zły dla klienta.

**`IloscPoKorekcie` nie istnieje.** Pozycja ma jedno pole ilości, więc korekta
ustawia ilość docelową — tak samo, jak Subiekt pyta o nią na ekranie. To już
pytanie o znaczenie, nie o nazwę, więc zostaje `[WERYFIKUJ]` do pierwszej
prawdziwej korekty.

**Pozycja ma własne `MagazynId`.** Trzecia droga do magazynu dla RW, obok
właściwości dokumentu i właściwości sesji. Rozstrzyga pierwszy RW.

Warte zapamiętania na później: `Dysponuj(Variant, Variant)`,
`PodajDostepneDostawy()` i `DostepnaIlosc`. Wskazywanie dostaw przy rozchodzie
ma tu gotowy mechanizm, gdyby firma go kiedyś potrzebowała.

## 2m. Szkic ZW — zwrot do paragonu (15 września 2026)

Sonda `-SzkicZW` utworzyła ZW w pamięci i podpięła go pod paragon
PA 3/MAG/02/2026. `Zapisz()` nie padł, dokument nie powstał.

**`DodajZW()` istnieje i daje dokument typu 14.** To ten sam typ, który import
czyta jako ZW (`DOK_TYPY_KOREKT`). Numer ZW wróci więc do zwrotu sam.

**`NaPodstawie(dok_Id)` działa dla paragonu.** Ustawia `DoDokumentuId`
i `DoDokumentuNumerPelny`, a datę sprzedaży bierze z PA. Faktura z 2016 roku
odpadła zdaniem „Nie można wystawić korekty do dokumentu".

**Pozycje przychodzą z paragonu — tylko te, które jeszcze nie wróciły.** Pierwszy
paragon dał jedną pozycję z pełną ilością. PA 12102/MAG/07/2026 miał już ZW 772
na produkt. Drugi szkic do niego dostał wyłącznie przesyłkę. Biuro zeruje w oknie
ZW produkty, które nie wróciły — worker zrobi to samo.

**`DokHanLp` to numer wiersza na ZW, nie na paragonie.** W ręcznym ZW 772
przesyłka ma `DokHanLp = 2`, a w drugim szkicu do tego samego paragonu `1`.
Worker dopasowuje więc pozycje po `TowarId`, tak jak przy KFS.

**Przelew startuje od kwoty paragonu i idzie za zmianami ilości.** Na PA
8995/MAG/03/2026 przelew po powiązaniu miał 26,89 zł, tyle co wartość. Po
wyzerowaniu wiersza wartość, `KwotaDoZaplaty` i przelew zeszły razem do 14,99 zł.

Paragon z wcześniejszym ZW daje jednak zły punkt wyjścia. Drugi szkic do PA 12102
miał wartość 10,49 zł, a `PlatnoscPrzelewKwota` 17,83 zł — cały paragon. Worker
ustawia więc przelew jawnie, równy `WartoscBrutto` ZW.

**„Zwrot ze sprzedaży" to `RodzajZwrotuDetal = 1`.** Szkic ma tam 0, a ZW
772/MAG/07/2026 wystawiony ręcznie przez biuro ma 1. Odczytała to sonda
`-WzorZW`. Worker ustawia więc 1 sam, bo `NaPodstawie` tego nie robi.

**Wyzerowana pozycja zostaje na ZW.** Ten sam ręczny ZW do paragonu z dwiema
pozycjami ma dwa wiersze: pierwszy z `IloscJm = 1`, drugi z `IloscJm = 0`.
Worker zeruje wiersze, nie usuwa ich.

**Na zapisanym ZW przelew równa się wartości po zerach.** Na ZW 772
`PlatnoscPrzelewKwota` i `WartoscBrutto` to po 7,34 zł.

**`NaPodstawie` odmawia dla WZ.** Komunikat brzmi „Nie można wystawić korekty
do dokumentu WZ…". Paragonem jest wyłącznie `dok_Typ = 21`.

**`NaPodstawie` blokuje paragon.** Drugi przebieg na tym samym PA odmówił:
„Nie można zablokować obiektu. Obiekt został zablokowany przez operatora…
na stacji…". Blokadę trzymało okno Subiekta tego operatora albo szkic
z pierwszego przebiegu. Sonda do 0.348.3 nie zamykała szkicu ani sesji.

Dokument ma `void Zamknij()`, a sesja `bool Zakoncz()`. Dla automatycznego ZW
wynikają z tego dwie zasady. Po `Zapisz()` worker zamyka dokument, bo inaczej
biuro nie otworzy paragonu. Odmowa blokady znaczy „spróbuj później", nie błąd
zwrotu — biuro może mieć paragon otwarty.

`[WERYFIKUJ]` Worker nie woła dziś `Zamknij()` po `Zapisz()` przy MM ani KFS.
Czy zapisany dokument zostaje przez to zablokowany dla biura, pokaże pierwsze
MM na produkcji.

**Po `IloscJm = 0` Subiekt przelicza dokument sam.** Na szkicu do PA 8995 wiersz
towaru 466 dostał `WartoscBruttoPoRabacie = 0` i został na ZW. Netto, VAT
i brutto dokumentu zeszły o jego kwotę bez wołania `Przelicz()`.

**ZW wywołuje skutek magazynowy: przyjmuje towar z powrotem na magazyn główny**
(właściciel, 15 września 2026). Zgrywa się to z obiegiem koszyka bez zmian.
MM koszyka czeka, aż każdy zwrot w nim ma `korekta_numer` (`brakujaceKorekty`
w `kosze-zwrotow.ts`). Kolejność jest więc stała: ZW oddaje towar na MAG, MM
koszyka zabiera go na bufor zwrotów albo odpad, MM powrotu wraca na MAG.

`[WERYFIKUJ]` Dlaczego szkic do PA 8995 miał `SkutekMagazynowy = False`, a do
PA 3/MAG/02 i PA 12102 — `True`. Pozycje PA 8995 mają `CenaMagazynowa = 0`.
Do czasu ustalenia automat NIE wystawia ZW z `False` i oddaje zwrot biuru. ZW
bez przyjęcia na MAG, a po nim MM koszyka, zdjęłyby ze stanu towar dwa razy.

**Automat w 0.349.0 składa te ustalenia w jedno zadanie `zw`.** Serwer zleca
je po zapisaniu kwoty (`services/zw-automat.ts`), worker Sfery wystawia ZW
(`SferaComAdapter.WystawZw`). Kolejność kroków w workerze:

1. `DodajZW()` i `NaPodstawie(dok_Id)`. Blokada paragonu odkłada zadanie
   o 2 minuty bez zużycia próby.
2. `SkutekMagazynowy = False` kończy zadanie błędem dla biura.
3. `RodzajZwrotuDetal = 1`.
4. Pozycje po `TowarId`. Zwracane dostają swoją ilość, reszta 0, przesyłka
   idzie za polem dostawy.
5. Wartość ZW porównana z pełną wartością zwrotu co do grosza. Rozjazd kończy
   zadanie bez `Zapisz()`.
6. `PlatnoscPrzelewKwota = WartoscBrutto`, `Zapisz()`, `NumerPelny`, zawsze
   `Zamknij()`.

Numer ZW wpisuje do zwrotu worker Node co minutę, jako `korekta_zrodlo='sfera'`.
Wtedy ruszają koszyki czekające na numer.

`[WERYFIKUJ]` Pierwszy prawdziwy ZW z automatu: czy `Zapisz()` daje dokument
wykonany i czy przelew na zapisanym ZW zgadza się z wartością.

**Pierwsza próba na produkcji: `Zapisz()` odmówił bez przyczyny** (15 września
2026, PA 745/MAG/09/2026, jedna pozycja). Sfera zwróciła tylko „Nie można
zapisać dokumentu.". Dokument ma `SzczegolyOstatniegoBledu` i `SprawdzPoprawnosc()`.
Od 0.349.1 worker woła `SprawdzPoprawnosc()` przed zapisem i dopisuje szczegóły
do błędu. Sonda `-SzkicZW -Paragon <dok_Id> -Towary "tw=ilosc" -Sprawdz` pokazuje
tę samą przyczynę bez zapisu.

**Druga próba na produkcji padła tak samo — i to jest wynik** (16 września 2026,
zadanie `#1075`). Trzy dopisane drogi diagnostyki oddały trzy puste ręce:
`SzczegolyOstatniegoBledu` puste, komunikat Sfery to dalej jedno zdanie, a cały
nowy materiał z 0.350.1 to kod `COMException 0x80040F20`. Facility tego kodu to
`ITF`, czyli numer WEWNĘTRZNY Sfery, nie błąd Windows — bez tabeli producenta nie
mówi nic.

`[WERYFIKUJ]` Co dokładnie znaczy `0x80040F20` przy `SuDokument.Zapisz()`.

Wniosek dla workera stoi gdzie indziej: skoro Sfera nie powie DLACZEGO, treść
odmowy ma powiedzieć CZEGO dotyczyła. Od 0.372.0 błąd niesie stan dokumentu,
który nie przeszedł: numer paragonu, `dok_Id`, wartość, przelew, rodzaj zwrotu,
skutek magazynowy i liczbę wierszy. Niesie też gotową komendę sondy z tymi
numerami.
Do 0.371.0 biuro dostawało wyłącznie numer zadania i musiało dojść do paragonu
samo, zanim w ogóle mogło zacząć mierzyć.

Dwa pytania rozstrzyga potem człowiek, nie kod. Czy ten sam ZW przechodzi
RĘCZNIE w Subiekcie — jeśli tak, odmowa dotyczy tego, co ustawia worker.
Jeśli nie, przyczyna siedzi w paragonie albo w uprawnieniach operatora.

**Trzecia próba wykluczyła konto usługi** (17 września 2026, zadanie `#1116`,
PA 14781/MAG/08/2026, sześć wierszy, 189,24 zł). Sesja Sfery wstaje już na
koncie użytkownika, nie na `LocalSystem`, a ZW odmawia tym samym
`0x80040F20`. Hipoteza o profilu użytkownika upadła.

**Rozstrzygające jest to, co zrobiło MM z TEJ SAMEJ sesji.** Zadanie `#1119`,
ten sam proces i ten sam operator, odmówiło MERYTORYCZNIE: `Brak towaru
w magazynie`. Jeden proces, jedna sesja COM, dwa dokumenty, dwa różne
zachowania. Przyczyna nie leży więc ani w połączeniu, ani w koncie Windows,
ani w samym operatorze Subiekta.

`[WERYFIKUJ]` Czego ZW wymaga, a MM nie. Pierwszy kandydat to KASA: ZW oddaje
pieniądze, a MM nie rusza żadnych, więc brak kasy domyślnej albo prawa do niej
uderzyłby wyłącznie w ZW. Drugi to paragon z zamkniętego miesiąca.

Trzeci kandydat jest rozstrzygający: ten sam ZW wystawiony ręką NA KONCIE
OPERATORA WORKERA, a nie na koncie biura. Dopiero to rozdziela „dokument jest
zły" od „operator nie ma prawa".

`[WERYFIKUJ]` Przyczyna odmowy zapisu ZW z tamtej próby.

**Ten sam ZW przeszedł ręką, na koncie operatora workera** (właściciel,
17 września 2026). To zamyka trzy tropy naraz. Dokument nie jest zły, operator
ma prawa, a kasa, zamknięty miesiąc i sam paragon odpadają. Zostaje wyłącznie
różnica między tym, co ustawia okno Subiekta, a tym, co ustawia worker.

**Wzorzec poprawnego ZW** (zrzut ekranu właściciela, 17 września 2026).
ZW do PA 11657/MAG/09/2026, jeden wiersz, rodzaj zwrotu „zwrot ze sprzedaży".
Płatność: „Zapłacono przelewem" 100,0%, czyli 129,98 zł — całość wartości.
Przedpłata, gotówka, karta i kredyt kupiecki mają po 0,00. Nabywca jest
wypełniony nazwiskiem i adresem. Skutek magazynowy stoi jako osobne działanie
obok „Zapisz", nie jako pole formularza.

**To OSŁABIA podejrzenie o kwotę przelewu.** Worker ustawia dokładnie to samo:
przelew równy pełnej wartości ZW. Dokument, który przeszedł, wygląda tak samo,
więc sama liczba nie może być powodem odmowy.

Podejrzenie nie znika, tylko się przesuwa. Okno wypełnia PIĘĆ form płatności
naraz i pilnuje, żeby ich suma równała się kwocie do zapłaty. Worker ustawia
JEDNĄ. Szkic po `NaPodstawie` dziedziczy płatność z paragonu, a paragon
z Allegro bywa opłacony inaczej niż przelewem. Wtedy po ustawieniu przelewu na
dokumencie stoją dwie formy, a ich suma jest dwa razy za duża.

Drugi kandydat to nabywca. Worker nie ustawia go nigdy, a dokument, który
przeszedł, go niesie.

**Pierwszy zrzut workera zamknął obie hipotezy** (23 września 2026, zadanie
`#1474`, PA 4242/MAG/09/2026, dwa wiersze, 46,09 zł). Zrzut powstał w chwili
odmowy, na dokumencie, który nie przeszedł.

Płatność się zgadza. Przelew 46,09 zł równa się kwocie do zapłaty i wartości
brutto. Gotówka, karta, kredyt, zaliczka i przedpłaty gotówkowe mają po zero,
a kwota rat jest pusta. Drugiej formy płatności na szkicu nie ma.

Nabywca jest. `KontrahentId` i `OdbiorcaId` są wypełnione, więc `NaPodstawie`
bierze nabywcę z paragonu. Pusty nabywca nie jest więc przyczyną odmowy.

Jedna rzecz została niepewna i to przez błąd zrzutu, nie przez Sferę. Do
0.456.0 pola prywatne sprawdzały zero jako napis „0", więc `0.0000` i `False`
wychodziły jako „wypełnione". Tak wyszły `PrzedplatyBankowe`
i `BankOperacjaGotowkowa`. Poprawka jest w 0.457.0.

**`PrzedplatyBankowe` są zerem** (zadanie `#1481`, zrzut po poprawce 0.457.0).
`BankOperacjaGotowkowa` też jest puste. Płatność jest więc zamknięta w całości.

Następny krok to zestawienie pole w pole z ZW, który przeszedł. Zrzut workera
i `-WzorZW` sondy biorą od 0.457.0 ten sam zestaw pól.

Obie rzeczy mierzy sonda, bez zapisu. Po ustawieniu „jak worker" wypisuje
wszystkie pola płatności i kwoty. O polach nabywcy i rachunku mówi wyłącznie
„puste" albo „wypełnione" — wartości zostają w Subiekcie, bo adres dostawy nie
ma prawa stąd wyjść. Ten sam zrzut robi `-WzorZW` na dokumencie, który
przeszedł. Dwie kolumny obok siebie rozstrzygają obie hipotezy w jednym
przebiegu.

**Nagłówek odmówionego ZW jest identyczny z ręcznym** (23 września 2026).
Zadanie `#1481` padło na PA 12083/MAG/09/2026, jeden towar za 45 zł. Biuro
wystawiło potem ręcznie ZW 748/MAG/09/2026 do tego samego paragonu. Sonda
`-WzorZW` przeczytała go tym samym zestawem pól, co zrzut workera.

Zgadza się każde pole z wartością. Przelew, kwota do zapłaty i brutto mają po
45 zł, a wartość magazynowa 23,76 zł. `KasaId` 1, `KasaKatId` 8, termin
kredytu, rodzaj zwrotu 1 i skutek magazynowy są te same.

Pola nabywcy i rachunku też się zgadzają, łącznie z `OstatniKomunikatKontrahenta`
wypełnionym po obu stronach. Oba dokumenty mają dwa wiersze: zwracany z ilością 1
i drugi z zerem.

Jedyna różnica to `WartoscVatPP`: `null` na szkicu, `0.0000` na zapisanym ZW.
Niezapisany szkic sondy ma tam też `null`, więc to raczej ślad samego zapisu.
Kasa, termin, komunikat kontrahenta i rachunek przestają być podejrzane.

Zostają wiersze. Zrzut workera i sonda wypisywały dotąd z wierszy najwyżej
towar, ilość i numer. Od 0.458.0 oba wypisują ten sam szerszy zestaw pól
każdego wiersza. `-WzorZW` działa też bez `-SzkicZW`.

**Wiersze też się zgadzają** (23 września 2026, zadanie `#1484`, PA
9186/MAG/09/2026, jeden wiersz za 25 zł). Zrzut workera ma ten sam komplet pól
wiersza co ZW 748: ceny, VAT, magazyn, cenę magazynową i obie ilości.

Jedno pole różni się tylko pozornie. `PozycjaTypPromocji` u workera odmawia
kodem `0x8004197F`, a w sondzie stoi `null`. PowerShell zamienia jednak odmowę
odczytu COM w `null`. Tak samo wyszły w sondzie pola, które worker czyta jako
`E_NOTIMPL`, np. `MagazynOdbiorczyId`. Sonda nie rozróżnia więc tych dwóch
stanów.

Właściciel potwierdził, że MM z workera zapisują się w Subiekcie. Sesja umie
więc pisać, a dokument wygląda jak ręczny. Zostaje to, czego pola nie
pokazują: co `Zapisz()` robi przy okazji. ZW przyjmuje towar na magazyn, a MM
tylko go przesuwa.

**Eksperyment od 0.459.0, za zgodą właściciela.** Worker ustawia
`SkutekMagazynowy = False` i zapisuje ZW z odłożonym skutkiem. Potem zamyka
dokument i woła `SkutekMagazynowyWywolaj(dok_Id)` na managerze. Setter, który
odmówi, zostawia starą drogę.

Trzy możliwe wyniki:
- Zapis odmawia dalej: przyczyna nie siedzi w przyjęciu na magazyn.
- Zapis przechodzi, skutek odmawia: błąd niesie odmowę skutku, a ZW stoi
  w Subiekcie z odłożonym skutkiem. Biuro wywołuje go ręcznie, zanim koszyk
  pójdzie MM.
- Oba przechodzą: ZW powstaje w całości, a przyczyną był skutek wołany
  w środku zapisu.

**Eksperyment odpadł: zapis odmawia także z odłożonym skutkiem** (23 września
2026, zadania `#1490`–`#1494`). Zrzut potwierdza `SkutekMagazynowy = False`
w chwili odmowy. Przyczyna nie siedzi więc w przyjęciu na magazyn. Od 0.460.0
worker zapisuje ZW znowu ze skutkiem, jak przed eksperymentem.

Tego samego dnia odpadły jeszcze trzy tropy:
- **Wydruk po zapisie.** Biuro odznaczyło „Drukuj dokument po zapisie" w
  parametrach zwrotu detalicznego. Po restarcie usługi ZW odmówił tak samo.
- **Ukryte okno.** Przebieg `--once` z `SFERA_TRYB_URUCHOMIENIA=2` otworzył
  widoczne okno Subiekta. Żaden komunikat się nie pojawił, a zapis odmówił tak samo.
- **Tryb w tle.** Ten sam przebieg z oknem wyklucza też sam tryb `W_TLE`.

Sygnał dźwiękowy Windows, który właściciel słyszał przy odmowach, nie ma
z tym związku. Rozległ się także przy przebiegu `--once`, który nie wziął
żadnego zadania i nie otworzył sesji Subiekta.

Zostaje jeden ślad w zrzutach. `PozycjaTypPromocji` odmawia na KAŻDYM wierszu
każdego odrzuconego szkicu kodem `0x8004197F`. To nie jest `E_NOTIMPL`, tylko
własny kod Sfery. Sonda pokazała na ręcznym ZW `null`, ale PowerShell maskuje
odmowy odczytu jako `null`.

Od 0.460.0 worker ma tryb `--zrzut <dok_Id>`. Czyta istniejący dokument tą samą
drogą z C#, która dała zrzuty odmów. Przebieg na ZW 748 rozstrzygnie, czy
zapisany dokument też odmawia tego pola.

```powershell
& C:\wertis\sfera-worker\wertis-sfera-worker.exe --zrzut 9253431
```

**`PozycjaTypPromocji` odpadła** (23 września 2026). `--zrzut 9253431` odczytał
ZW 748 z C#. Pole odmawia kodem `0x8004197F` także na zapisanym dokumencie.
To zwykła cecha pola, nie przyczyna odmowy.

Ten sam zrzut zestawiony z odmową `#1481` zgadza się w każdym polu nagłówka
i wierszy. Wyjątki to numer, nadawany przy zapisie, i jedno pole:
`WartoscVatPP`. Zapisany ZW ma tam `0.0000`, każdy szkic z COM ma `null`.

**Od 0.461.0 worker ustawia `WartoscVatPP = 0`, gdy szkic ma tam pustkę.**
To wartość przepisana z ZW biura, przy `PodzielonaPlatnosc = False` po obu
stronach. Treść odmowy i dziennik mówią, czy setter przyjął zero.

**`WartoscVatPP = 0` nie pomogło** (23 września 2026, PA 11458/MAG/09/2026).
Setter przyjął zero, zrzut pokazuje `0.0000`, a zapis odmówił tym samym
`0x80040F20`. Szkic zgadza się teraz z ręcznym ZW w każdym polu, które zrzut
wypisywał.

Zrzut wypisywał jednak tylko pola z dwóch list: płatności i kwot oraz nabywcy.
Od 0.462.0 dopisuje resztę właściwości nagłówka i wierszy. O każdej mówi
„puste", „wypełnione" albo kod odmowy odczytu. Wartości tych pól nie wychodzą,
bo pod nieznaną nazwą może stać nazwisko albo adres.

`--zrzut 9253431` i następna odmowa dadzą dwie listy do zestawienia pole w pole.

**Pełny zrzut wskazał dwa pola** (23 września 2026). `--zrzut 9253431` i odmowa
z PA 11458 różnią się w nagłówku `Identyfikatorem` i `DokumentyZrodlowe`.
To naturalna różnica między dokumentem zapisanym a szkicem. Poza tym różnią się
jeszcze dwa pola:
- `Wystawil` — wypełnione na ZW biura, puste na szkicu workera.
- `WydanieKatId` — wypełnione na ZW biura, puste na szkicu workera.

Wiersze zgadzają się w każdym polu. Oba pola wypełnia okno Subiekta, a worker
nie ustawiał ich nigdy.

Od 0.463.0 worker wpisuje w `Wystawil` nazwę operatora sesji, jak okno.
Kategorii nie zgaduje. Numer bierze z `wertis.env` (`SFERA_ZW_WYDANIE_KAT_ID`),
a odczytuje go `--zrzut` ZW biura. Zrzut podaje od tego wydania wartości
`WydanieKatId` i `PrzyjecieKatId`.

`[WERYFIKUJ]` Czy ZW z `Wystawil` i `WydanieKatId` przechodzi zapis.

**Od 0.456.0 worker robi ten zrzut sam, w chwili odmowy.** Właściciel zapytany,
czy uruchomi sondę z komunikatu, odpowiedział: „niech robi to sam". Po odmowie
zapisu ZW worker wylicza właściwości dokumentu z informacji o typie IDispatch.
To ta sama droga, którą idzie `Get-Member` w sondzie.

Do treści błędu dopisuje wartości pól płatności, kwot i rodzaju. O polach
nabywcy, adresu i rachunku mówi tylko „puste" albo „wypełnione". Zrzut powstaje na obiekcie, który nie przeszedł,
zanim worker go zamknie. Udany ZW nie płaci ani jednego wywołania więcej.

Porównanie z dokumentem, który przeszedł, dalej robi sonda `-WzorZW`. Worker
nie wie, który ZW biuro uzna za wzór.

**Odmowa zapisu potrafi zostawić numer, którego nie ma** (15 września 2026).
Worker w 0.349.1 powtórzył zapis dwa razy, a `SprawdzPoprawnosc()` przeszło
także na szkicu z sondy. Subiekt odmówił bez szczegółów. Dziewięć sekund później
import przypiął zwrotowi „ZW 463/MAG/09/2026”, którego w Subiekcie nie było.
Import czyta dokumenty z `NOLOCK` i zobaczył wiersz z zapisu, który Subiekt
wycofał. Ten sam ZW wystawiony ręcznie w Subiekcie przeszedł bez komunikatu.

Od 0.350.1 korekta wchodzi do read-modelu dopiero przy drugim imporcie
(`adapters/korekty-dojrzale.ts`). Worker dopisuje do odmowy łańcuch wyjątków
z kodem HRESULT i numer, jeśli Subiekt zdążył go nadać. Ręczny zapis przechodzi,
a zapis z usługi nie — podejrzane jest konto LocalSystem, na którym działa
`wertis-sfera`.

**Paragon z Allegro ma wiersz przesyłki.** Pozycja 943 „PRZESYŁKA" to usługa
z `CenaMagazynowa = 0`. Na ZW 772 biuro ją wyzerowało.

**Przesyłka na ZW idzie za polem „Koszt dostawy" w panelu zwrotów** (decyzja
właściciela, 15 września 2026). Odznaczone pole daje `kwota_dostawa_grosze`
równe 0 i zero na wierszu przesyłki. Zaznaczone zostawia go z ilością 1 —
tak jak `delivery` w zwrocie pieniędzy Allegro. Jedno pole steruje więc
i przelewem klienta, i dokumentem.

## 3. Czego z publicznych źródeł ustalić się nie da

Trzy grupy. Wszystkie zostają jako `[WERYFIKUJ]`.

1. **Wartości liczbowe `ProduktEnum` i `AutentykacjaEnum`.** Nazwy stałych są
   opublikowane, liczby nie. Domyślne wartości siedzą teraz w `wertis.env`
   (`SFERA_PRODUKT`, `SFERA_AUTENTYKACJA`), nie w kodzie. Poprawka na hali
   kosztuje restart usługi, nie przebudowanie exe.
2. **Model dokumentów.** Nazwy managerów, metod `Dodaj*` i właściwości
   dokumentu opisuje wyłącznie InfoSfera. Odpowiada na nie sonda, punkt niżej.
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

Wartości wyżej pochodzą z opublikowanych przykładów i opisu wyliczeń Sfery,
cytowanych w poniższych wątkach. Nie są potwierdzone na naszej instalacji —
od tego jest sonda i bramka 2.

- [Subiekt GT Sfera — przykład logowania](https://programowanie.cal.pl/forum/viewtopic.php?f=2&t=2222) (pełna sekwencja właściwości obiektu GT)
- [Sfera Subiekt GT — wywołanie Uruchom w C#](https://4programmers.net/Forum/C_i_C++/191405-sfera_subiekt_gt) (maska trybu uruchomienia)
- [Problem z integracją przez Sferę](https://forumsubiekta.pl/dodatki-zestawienia/problem-z-integracja-\(polaczenie-przez-sfere\)/10?wap2=) (wartości `UruchomEnum` i `UruchomDopasujEnum`)
- [Sfera dla InsERT GT — informacje zaawansowane](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/7667,sfera-dla-insert-gt-%E2%80%93-informacje-zaawansowane.html) (gdzie szukać InfoSfery)
- [Konfiguracja integracji z Subiektem GT](https://docs.easystorage.io/pl/panel-web/konfiguracja/integracje/subiekt-gt) (`0x80041329` a pierwszy znak hasła SQL)
- [Najczęstsze problemy przy połączeniu ze Sferą](https://pomoc.integratory.pl/subsync-integracja-z-subiektem/rozwiazywanie-problemow/najczestsze-problemy/) (to samo, niezależnie)

Sekcje od 2a do 2l mają inne źródło: **przebiegi sondy na maszynie firmy**,
4 września 2026. To jedyne ustalenia w tym pliku potwierdzone na żywej Sferze.
