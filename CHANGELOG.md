# Historia zmian WERTIS

Numer wersji stoi w **jednym miejscu** — polu `version` w `package.json`
w korzeniu repo. Bierze go stamtąd serwer (`/api/health`) i APK
(`android/app/build.gradle.kts` czyta ten plik przy budowaniu i wylicza z niego
`versionCode`). Kolektor pokazuje obie wersje na dole ekranu.

Do sierpnia 2026 numer był wpisany w trzech miejscach z komentarzem „zgodnie
z wersją monorepo" — i właśnie tak przestał być zgodny: `0.3.0` przetrwało
sześć zmergowanych zmian, w tym takie, które wymagały nowego uprawnienia SQL.
Komentarz nie jest mechanizmem.

## Kiedy który człon rośnie

Ta skala mierzy **koszt wdrożenia u klienta**, a nie zgodność API. WERTIS nie ma
publicznego API — jedynym klientem jest własny kolektor. Pytanie, na które numer
ma odpowiadać, brzmi: *„czy przy tej aktualizacji muszę coś zrobić ręką?"*

| człon | kiedy | co to znaczy dla wdrożenia |
|---|---|---|
| **MINOR** (`0.X.0`) | nowa funkcja widoczna dla człowieka **albo** zmiana wymagająca działania przy wdrożeniu | przeczytaj wpis: pozycje **[wymaga działania]** mówią, co zrobić poza `git pull` |
| **PATCH** (`0.3.X`) | poprawka błędu, dokumentacja, refaktor bez śladu na ekranie | `git pull`, `npm ci`, `npm run build`, restart usług — nic więcej |
| **MAJOR** (`1.0.0`) | **dopiero gdy system pracuje na produkcji codziennie** | zostaje `0` do tego czasu; podbicie będzie decyzją właściciela, nie skutkiem ubocznym |

**Nowy APK to nadal osobna czynność, ale od 0.52.0 nie ręczna.** `git pull`
przestawia serwer od razu; APK kładzie obok niego instalator, a kolektory
proponują go same przy otwarciu aplikacji. Pasek na dole ekranu dalej pokazuje
obie wersje i podświetla rozjazd — to stan przejściowy, nie awaria. MDM zostaje
dla pierwszej instalacji i dla flot, które blokują instalowanie spoza sklepu.

Wpisy sprzed 0.52.0 mówią „nowy APK przez MDM" i tak było w dniu wydania —
historii nie przepisujemy.

---


## 0.198.10 — 4 września 2026

**Gotowy exe workera nie jest już plikiem nieznanym dla gita.** `.gitignore`
pokrywał `publish/`, ale instalator szuka exe o poziom wyżej — w
`<katalog>\sfera-worker\`. U klienta ten katalog jest jednocześnie checkoutem
repozytorium, więc skopiowany plik pokazywał się w `git status` jako 30 MB
śmiecia. Doszły `sfera-worker/*.exe` i `tlo-worker/*.exe`.

## 0.198.9 — 4 września 2026

**„Pozycje są puste" wyglądało jak „Pozycji nie ma" — przez błąd w sondzie.**
Szkic MM z 0.198.8 ustawił magazyny bez odmowy, a i tak wypisał:

```
--- SuDokument.Pozycje ---
  (Get-Member odmowil: You must specify an object for the Get-Member cmdlet.)
```

Kolekcja szła do `Get-Member` POTOKIEM, a potok ją rozwija. Pusta kolekcja nie
wysyła ani jednego elementu, więc `Get-Member` mówi, że nie dostał obiektu.
Brzmi to jak brak właściwości i tak to odczytałem w 0.198.8.

`Skladowe` i `Ma-Nazwe` wołają teraz `Get-Member -InputObject`. Sonda wypisuje
też `Pozycje.Liczba`: zero potwierdza, że kolekcja jest pusta, a nie że jej nie
ma. Przy okazji potwierdzone na żywym obiekcie: `MagazynNadawczyId`
i `MagazynOdbiorczyId` przyjmują wartości bez odmowy.

## 0.198.8 — 4 września 2026

**Sonda bierze magazyny z `wertis.env`.** Przykład w README pokazywał
`-MagNadawczy N -MagOdbiorczy M`, gdzie `N` i `M` miały być liczbami. Wklejony
dosłownie kończył się odmową PowerShella przy przekształceniu argumentu.

Przełącznik `-SzkicMM` bierze teraz magazyny z pliku: `MAG_ID_MAG` jako
nadawczy, `MAG_ID_ZWROTY` jako odbiorczy. To ten sam kierunek, którym idzie MM
zwrotu w `kosze-zwrotow.ts`. Parametry nadal biorą górę nad plikiem, a gdy
w pliku ich nie ma, sonda mówi to wprost i podaje przykład z liczbami.

Przykład, w którym trzeba coś podmienić, jest przykładem do podmienienia przy
wklejaniu — a wkleja się go w konsoli na maszynie firmy, nie w edytorze.

## 0.198.7 — 4 września 2026

**Trzecia zgadnięta nazwa z rzędu okazała się błędna — i to ta, na której stał
adapter od pierwszego dnia.** Przełącznik `-SzkicMM` utworzył MM w pamięci
i wypisał właściwości dokumentu. `Zapisz()` nie padł, więc dokument nie powstał.

### Magazyny nazywają się inaczej

```
Property     MagazynNadawczyId
Property     MagazynOdbiorczyId
```

`MagazynZrodlowyId` i `MagazynDocelowyId` nie istnieją. Kod stał na nich od
szkicu w `sfera.ts` i wywróciłby się przy pierwszym zwrocie u klienta.

`MagazynId` na dokumencie też nie ma — ta właściwość stoi na SESJI. RW dostaje
`MagazynNadawczyId`, bo rozchód wyprowadza towar z magazynu.

### Korektę wiąże się wywołaniem, nie właściwością

`void NaPodstawie(Variant)` — a bliźniacze `NaPodstawieWielu(SAFEARRAY(int))`
mówi, że Variant bierze identyfikator. To zamyka punkt 6 listy `[WERYFIKUJ]`
poza samym adresowaniem pozycji.

### `Usun` bierze flagę

`void Usun(bool)`. Sygnatura jest znana, znaczenie flagi nie. Wycofanie łańcucha
podaje `false`, bo w każdym czytaniu tej flagi to działanie węższe: jeden
dokument i bez pytania. Usługa nie ma pulpitu, na którym odpowiedziałaby na
pytanie.

### Kolekcja `Pozycje` na pustym dokumencie jest pusta

Wróciła jako `null`, więc składowych nie oddała. Sonda przyjmuje teraz
`-MagNadawczy` i `-MagOdbiorczy`: sprawdzą, czy kolekcja potrzebuje magazynu,
zanim w ogóle powstanie.

Potwierdzone bez zmian: `NumerPelny`, `Zapisz()`, `Pozycje`. Ustalenia
w `docs/sfera-com.md` §2j, stan listy w `sfera-worker/README.md`.

## 0.198.6 — 4 września 2026

**Sygnatury pokazały, że wczorajsze zgadnięcie było błędne — drugi raz w tym
samym miejscu.** Sonda wypisuje od 0.198.5 listy argumentów i pierwszy przebieg
z nimi od razu na to trafił.

### `DodajKFS` nie bierze żadnego argumentu

```
SuDokument DodajKFS ()
```

Kod z 0.198.5 wołał `DodajKFS(dok_Id)` i wywróciłby się na liczbie argumentów.
Najpierw zgadnięta była nazwa managera, teraz sygnatura metody — ta sama lekcja
dwa razy pod rząd.

Wszystkie `Dodaj*` są bezargumentowe i zwracają `SuDokument`. Korekta powstaje
więc jako pusty dokument, a wskazanie dokumentu pierwotnego siedzi na obiekcie.
Manager ma osobne `WczytajDokument(dok_Id)`; którą właściwością te dwa się
wiąże, widać dopiero na obiekcie korekty.

### Skutek magazynowy bierze identyfikator

```
void SkutekMagazynowyWywolaj (int)
```

Po zapisie MM da się więc jawnie zażądać wykonania, zamiast liczyć na domyślne
zachowanie `Zapisz()`.

### Ostatni punkt też da się zamknąć bez dokumentu

Skoro `DodajMM()` tworzy obiekt, a utrwala dopiero `Zapisz()`, właściwości
dokumentu można obejrzeć bez wystawiania czegokolwiek. Robi to sonda
z przełącznikiem `-SzkicMM`, domyślnie wyłączonym: obietnica „sonda niczego nie
tworzy" ma zostać dosłowna, więc jedyne `Dodaj*` w skrypcie włącza się ręką.


## 0.198.5 — 4 września 2026

**Sesja bez okna działa, a `SuDokumentyManager` oddał nazwy metod.** Przebieg
sondy po zamknięciu Subiekta zamknął trzy punkty listy `[WERYFIKUJ]` naraz.

### Usługa da się uruchomić bez pulpitu

```
JEST  sesja otwarta BEZ OKNA — Autentykacja=0, tryb NOWY|W_TLE (0x6)
```

To było pytanie ważące najwięcej dla całego wdrożenia. Poprawka trybu z 0.198.4
okazała się trafiona, a `SFERA_AUTENTYKACJA=0` jest właściwą wartością na tej
instalacji.

### Kod woła wreszcie istniejące nazwy

Manager wystawia dokumenty metodami nazwanymi **symbolem dokumentu**, więc
`DodajKorekte` nie miało prawa istnieć. Za to `DodajMM` i `DodajRW` były
trafione od początku — zmyślony był sam manager.

| wywołanie | stan |
|---|---|
| `SuDokumentyManager.DodajMM()` | ustalone, w kodzie |
| `SuDokumentyManager.DodajRW()` | ustalone, w kodzie |
| `SuDokumentyManager.DodajKFS(…)` | nazwa ustalona, sygnatura otwarta |

### Punkt 5 przestał być zgadywanką

Na managerze siedzą `SkutekMagazynowyWywolaj`, `SkutekMagazynowyOdloz`,
`SkutekMagazynowyCofnij` i `SkutekMagazynowyWywolajTylkoNaMagZrodl`. Czyli
„dokument wykonany kontra bufor" to **osobna decyzja z własnym wywołaniem**,
a nie domyślne zachowanie `Zapisz()`. Której użyć — pokaże pierwszy dokument.

### Sonda wypisuje teraz sygnatury

Sama nazwa nie mówi, czy `DodajKFS` bierze `dok_Id`, czy wczytany dokument.
Definicja metody to mówi, więc następny przebieg poda listy argumentów zamiast
zostawiać kolejne zgadywanie.


## 0.198.4 — 4 września 2026

**Pierwsza otwarta sesja Sfery. Dwie nazwy w naszym kodzie okazały się
zmyślone, a tryb uruchomienia — źle dobrany.** Sonda z przełącznikiem
`-ZOknem` weszła do Subiekta i wypisała, co naprawdę wisi na obiekcie sesji.

### Managerów jest jedenaście i żaden nie nazywa się tak, jak myśleliśmy

`DokumentyMagazynoweManager` i `DokumentyHandloweManager` **nie istnieją**.
Obie nazwy przyszły ze szkicu kontraktu w `sfera.ts` i przez cały czas były
zgadywane. Dokumenty siedzą pod `SuDokumentyManager`.

To ta sama cena, którą `CLAUDE.md` opisuje przy Allegro. Metod `Dodaj*` nie
zgadujemy trzeci raz: sonda wypisuje teraz składowe KAŻDEGO managera, więc
następny przebieg poda nazwy zamiast pytania.

### Blokadą był tryb, nie hasło

Przy identycznych danych logowania `Uruchom(dopasuj, w tle)` odmawiał kodem
`0x8004132B`, a `Uruchom(dopasuj)` z widocznym oknem **otwierał sesję**.

Wyjaśnienie jest proste: `gtaUruchom` znaczy „podłącz się do działającego
Subiekta". Na tej maszynie Subiekt był otwarty, więc Sfera miała podłączyć się
do instancji z interfejsem i naraz pracować bez okna.

Worker wysyła teraz `gtaUruchomNowy | gtaUruchomWTle` — **własną instancję
w tle**. Tak brzmi też wywołanie z dokumentacji producenta, a usługa i tak nie
ma prawa zależeć od czyjegoś pulpitu: instancję otwartą przez człowieka ktoś
kiedyś zamknie albo zablokuje oknem. Wartość zmienia `SFERA_TRYB_URUCHOMIENIA`.

Sonda próbuje teraz trybów po kolei i mówi, który wpuścił.


## 0.198.3 — 4 września 2026

**Sam cache w CI daje pięć sekund — zmierzone.** Krok instalacji: 9 s przy
nietrafionym cache'u, 4 s przy trafionym. Pierwsze prawdziwe trafienie
potwierdza log: „Cache hit occurred on the primary key
nm-Linux-X64-node22-37ddd58…".

Pełna droga tego pomiaru: 3 min 41 s i 7 min 03 s przed zmianą, 9 s po dodaniu
`--no-audit` przy nietrafionym cache'u, 4 s przy trafionym. Skok jest między
drugim a trzecim pomiarem i nie ma z cache'em nic wspólnego.

**Cache zostaje decyzją właściciela, z tymi liczbami na stole.** Nagłówek akcji
niósł regułę, że przy takim wyniku jest do usunięcia. Reguła znika, bo kazałaby
skasować coś, o czym już zapadło rozstrzygnięcie.

Zapisane też, czego cache NIE robi. Wolne przebiegi miały `cache: npm`, czyli
ciepły katalog pobrań — paczki już tam leżały, wolny był audyt. Cache drzewa
nie ubezpiecza przed tamtą awarią. Pomoże przy nowej zależności albo gdy
rejestr padnie przy pobieraniu.

## 0.198.2 — 4 września 2026

**Sprostowanie do 0.198.1: zysku nie dał cache, tylko `--no-audit`.**
Wpis 0.198.1 mówił, że bramkę spowalniało rozpakowywanie 372 MB w 27 tysiącach
plików. To była diagnoza z jednej próbki i była błędna.

Rozstrzygnął przebieg już po tamtej zmianie. Krok instalacji trwał 9 sekund
PRZY NIETRAFIONYM cache'u: drzewo instalowało się od zera, bo cache zapisał
minutę później równoległy przebieg bramki workera Sfery. Skoro bez cache'a
wyszło 9 sekund, kosztem nie było rozpakowywanie, tylko `npm audit` — wysyła
całe drzewo do rejestru i czeka na odpowiedź.

Trzy pomiary tego samego kroku na tej samej gałęzi: 3 min 41 s i 7 min 03 s
przed zmianą, 9 s po niej. Sam rozrzut między dwoma pierwszymi, przy
identycznej konfiguracji, powinien był zatrzymać tamtą diagnozę.

**Cache drzewa zostaje, ale jako jawny ZAKŁAD bez pomiaru.** Ma zdejmować tę
zmienność, bo `--no-audit` nie chroni przed wolnym pobieraniem paczek. Jeśli
kolejne przebiegi pokażą instalację w sekundach także bez cache'a, cache jest
do usunięcia — i tak stoi w nagłówku akcji.

To wydanie nie rusza kodu bramek. Poprawia nagłówek akcji i komentarz
w `server.yml`, bo tam stoi żywa dokumentacja, którą ktoś przeczyta następnym
razem. Wpisu 0.198.1 nie przepisuje: historia ma pokazywać, że pomyliliśmy
przyczynę, a nie udawać, że od razu było wiadomo.

## 0.198.1 — 4 września 2026

> **Uzasadnienie w tym wpisie jest błędne — patrz 0.198.2.**
> Zysk dało `--no-audit`, nie cache drzewa.

**Bramka CI przestała czekać siedem minut na `npm ci`.**
Pomiar z przebiegu, który przeszedł na zielono: `npm ci` trwał 7 min 03 s
z 8 min 59 s całej bramki „Serwer". Cała reszta — typy, testy serwera, testy
panelu, build i dwa skrypty dokumentacji — trwa razem minutę czterdzieści.
Drzewo ma 372 MB w 27 tysiącach plików i było rozpakowywane od nowa przy
każdym przebiegu.

Stojące tam wcześniej `cache: npm` tego nie ruszało: trzyma katalog pobrań
`~/.npm`, a nie `node_modules`. Teraz obie bramki instalujące zależności biorą
wspólną akcję, która cache'uje samo drzewo. Klucz liczy się z OBCYCH paczek,
nie z całego lockfile'a — inaczej rozjeżdżałby się przy każdym wydaniu, bo
numer wersji stoi także w `package-lock.json`.

Przy wdrożeniu: pierwszy przebieg po scaleniu nadal płaci pełną instalację,
bo zapisuje cache. Dopiero drugi jest szybki. Bramka workera Sfery nie miała
cache'a wcale i dostaje go przy okazji.

## 0.198.0 — 4 września 2026

**Oferta i towar w JEDNEJ zakładce kontekstu — kolumna przestała świecić bielą.**
Właściciel przysłał zrzut z pracy: kolumna po prawej stronie skrzynki niosła
jedenaście linijek — numer oferty, tytuł, SKU, cena — a resztę z ośmiuset
pikseli zostawiała pustą. Zdjęcie towaru, stan magazynowy, półka i parametry
kartoteki leżały pod sąsiednią zakładką, niewidoczne. Na tamtym zrzucie klient
prosił o wymiar gwintu korka.

Zakładki „Oferta" i „Towar" zeszły się w jedną: „Oferta i towar". Bloki stoją
w jednym przewijaniu, w kolejności od tego, co klient widział kupując, do tego,
co my mamy na półce — oferta, zamówienie, kartoteka. „Dobór" zostaje osobno, bo
to nie karta faktów, tylko robota z własnymi krokami i przyciskami.

**Opis kartoteki wreszcie widać.** Pole `desc` jechało w odpowiedzi
`/api/products/:twId` od dawna i panel nie pokazywał go NIGDZIE. A to w nim ta
firma trzyma gwinty, wymiary, rozstawy i sekcje „Modele:" — czyli odpowiedzi na
pytania zadawane najczęściej. Blok jest zwinięty do sześciu linijek
i rozwija się jednym kliknięciem, bez pytania serwera.

**Ekran bierze całą szerokość okna.** `<main>` miał `max-w-[1500px]`
z makiety, bez uzasadnienia w kodzie. Na monitorze 1920 oddawał 210 pikseli
na margines z każdej strony, na 2560 — po 530, a kolumny stały wąskie mimo
wolnego miejsca. Rosną kolumny skrajne: kolejka i kontekst zamieniają
szerokość na treść. Środkowa nie rośnie bez końca — wypowiedzi mają próg 75
znaków i dosuwają się do przeciwnych krawędzi, klient do lewej, my do prawej.

Szerokości obu ekranów obsługi stoją teraz w jednym miejscu. Skrzynka miała
kolejkę 22 rem, a zwroty 320 px, choć projekt wymienia szerokości kolumn jako
część „jednego nawyku".

Przycisku „wstaw do szkicu" opis NIE dostał i to jest decyzja. Wstawka
parametrów wybiera pola świadomie, bo szkic idzie do klienta; w opisie bywa
notatka dla magazynu. Agent skopiuje zdanie, które przeczytał — ale nie wyśle
całości, nie wiedząc, co w niej stoi.

## 0.197.4 — 4 września 2026

**Drugi przebieg sondy: `ProduktEnum` zamknięty, a odmowa logowania okazała
się DWIEMA różnymi odmowami.** Sonda wczytała wreszcie `wertis.env`
(`C:\wertis\wertis.env`), więc doszła dalej niż kiedykolwiek.

### Który numer znaczy Subiekt — już wiadomo

`ProduktNazwa` odczytana bez logowania dała komplet: 1 to Subiekt, 2 Rachmistrz,
3 Rewizor, 4 Gratyfikant, 5 MikroGratyfikant, 6 Gestor. Domyślne
`SFERA_PRODUKT=1` było trafne, a punkt 1 listy `[WERYFIKUJ]` jest zamknięty.

Nazwa pod numerem 8 przyszła jako krzaki — to strona kodowa konsoli, nie błąd
Sfery. Sonda ustawia teraz wyjście na UTF-8.

### Dwa kody, dwie różne diagnozy

`Autentykacja=0` odmówiła kodem `0x8004132B`, a `Autentykacja=1` kodem
`0x80041329`. To nie jest ta sama porażka dwa razy.

`0x80041329` znaczy, że Sfera **nie weszła do bazy** — login albo hasło SQL.
`0x8004132B` znaczy, że weszła i przewróciła się dopiero na **uruchomieniu
Subiekta w tle**; producent opisuje ten kod zdaniem „sprawdź dane logowania do
Subiekta". Czyli wartość `0` prowadzi dalej, a szukać trzeba przy operatorze,
nie przy loginie SQL.

### Co sonda robi z tym teraz

Rozpoznaje oba kody osobno i przy `0x8004132B` wypisuje listę czterech rzeczy
do sprawdzenia: nazwa operatora, jego hasło, prawo do Sfery na tym operatorze
i licencja Sfery na podmiocie.

Mówi też o hasłach tyle, ile trzeba do diagnozy, i ani słowa więcej: czy są
ustawione, ile mają znaków i **czy hasło SQL zaczyna się od znaku
szesnastkowego** — bo to jest dokładnie ta cecha, którą Sfera odrzuca.
Samych haseł nie wypisuje, bo wynik wraca do repozytorium.

Doszedł przełącznik `-ZOknem`: trzecia próba logowania z widocznym oknem
Subiekta. Rozstrzyga, czy blokadą jest sam tryb w tle, a to pytanie ma dla
usługi `wertis-sfera` znaczenie zasadnicze — usługa pulpitu nie ma.


## 0.197.3 — 4 września 2026

**Bramka instalatora przestaje czerwienić `main` przez chwilową awarię
PowerShell Gallery.** Przebieg na `main` padł na `Install-Module ps2exe`
komunikatem „No match was found for module 'ps2exe'". Trzydzieści minut
wcześniej ten sam krok przeszedł na zielono, a w międzyczasie nikt nie tknął
katalogu `instalator/`.

Komunikat myli: brzmi, jakby moduł nie istniał, więc wysyła diagnozę w stronę
nazwy pakietu zamiast w stronę sieci. Krok dociąga teraz jawnie dostawcę NuGet,
rejestruje i ufa repozytorium PSGallery, a instalację powtarza trzy razy
z rosnącą przerwą. Gdy Gallery leży naprawdę, bramka dalej pada — ale z własnym
zdaniem zamiast cudzego.


## 0.197.2 — 4 września 2026

**Pierwszy przebieg sondy u właściciela: dwa ustalenia i trzy błędy w samej
sondzie.** Narzędzie z 0.197.0 pojechało na maszynę z Subiektem i od razu
zarobiło na siebie — w obie strony.

### Co potwierdziła Sfera

Obiekt COM `InsERT.GT` powstaje, a jego składowe zgadzają się z tym, co
wpisaliśmy w kod. Widać wprost `Uzytkownik` i `UzytkownikHaslo`, więc poprawka
z 0.197.0 trafiła: login SQL ma gdzie jechać.

Doszła też droga na skróty. Właściwość `ProduktNazwa` czyta się po samym
ustawieniu `Produkt`, bez logowania — więc numer `gtaProduktSubiekt` da się
potwierdzić bez sesji. Sonda przechodzi teraz wartości od 0 do 8 i wypisuje
nazwy.

### Trzy błędy w sondzie, wszystkie wyszły w tym jednym przebiegu

**Brak `wertis.env` wywracał start.** `Test-Path` na pustej ścieżce sypał dwie
czerwone ściany tekstu, zanim sonda zdążyła cokolwiek powiedzieć. Doszły też
parametry `-Baza`, `-Operator`, `-LoginSql` i reszta, bo na maszynie z Subiektem
repozytorium stoi gdzie indziej niż plik ustawień.

**Parametry i tak by nie zadziałały.** W PowerShellu `$Baza` i `$baza` to jedna
zmienna, więc odczyt z pliku kasował to, co podał człowiek. Po cichu.

**Bez nazwy podmiotu sonda szła prosto na `Uruchom()`** i dostawała kod
HRESULT zamiast zdania. Teraz odmawia wcześniej i mówi, czego brakuje.

**Szukanie `wertis.env` sięgało jeden katalog w górę i tyle.** Właściciel miał
plik piętro wyżej i sonda go nie wzięła, a jedyne, co powiedziała, to „nie
znaleziono". Teraz idzie w górę aż do korzenia dysku — jak Node i jak
`EnvFile.cs` — a gdy nie znajdzie, **wypisuje wszystkie sprawdzone ścieżki**.
Taką pomyłkę jak `wertis.env.txt` z Notatnika widać wtedy od razu.

Katalog skryptu bierze się teraz z `$PSScriptRoot`, a nie z `$MyInvocation`.
Ten drugi bywa pusty zależnie od sposobu uruchomienia, a wtedy cała lista
kandydatów po cichu degenerowała się do katalogu bieżącego — czyli dokładnie
ten objaw, który właściciel zobaczył przy poprawnie nazwanym pliku.

### Komunikat błędu, który kłamie

`Uruchom()` odmówił kodem `0x80041329`, a Windows dokleił do niego zdanie
o „aparacie planowania". Kody `0x8004xxxx` są interfejsowe — znaczenie nadaje
im biblioteka, która je zwróciła, a Windows podstawia opis Harmonogramu zadań.

U Sfery ten kod znaczy co innego: hasło loginu SQL zaczyna się od cyfry albo
litery `a`–`f`. Ten sam kod pada przy pustym loginie SQL i tak było tym razem.
Sonda rozpoznaje go teraz sama i mówi, co zrobić.

Skoro wartości `AutentykacjaEnum` nikt nie publikuje, sonda próbuje obu i mówi,
która otworzyła sesję. Dwie próby, nie pętla — konta SQL potrafią się blokować.


## 0.197.1 — 4 września 2026

**Piaskownicą dla workera Sfery nie jest kopia bazy.** Właściciel sprawdził to
na własnej instalacji: na kopii Sfera nie wstaje. Powód jest po stronie
InsERT-a — licencje siedzą w bazie podmiotu, a podmiot przywrócony z archiwum
chodzi jako demo. W demie Sfery nie ma.

Bramki z `docs/wdrozenie.md` mówiły „wszystkie na kopii bazy" i były przez to
niewykonalne. Piaskownicą jest **podmiot testowy** zakładany w Subiekcie
(Nowy → Wersja próbna → dane przykładowe, 45 dni), z próbną Sferą włączaną na
nim osobno na 15 dni.

Doszła też bramka 6: jedno MM na produkcji, na kartotece próbnej, po kopii
zapasowej. Nie służy ustalaniu `mag_Id` — te są znane i stoją w `wertis.env`
od etapu 1. Jest pierwszym dokumentem, jaki Sfera wystawia na podmiocie
produkcyjnym: inna licencja, inny operator, inne uprawnienia.

Ostrzeżenie przy okazji: „wymiana licencji" z programu serwisowego przenosi
licencję między podmiotami i potrafi rozbroić produkcję. Nie tędy droga do
Sfery na podmiocie testowym.

Etapów 1 i 2 to nie dotyczy. Tam pracuje worker Node, który pisze do bazy
wprost, i kopia zostaje właściwym miejscem.


## 0.197.0 — 4 września 2026

**Worker Sfery przed pierwszym wdrożeniem: dwie poprawki z dokumentacji,
własny test i exe prosto z CI.** Nic z tego nie zmienia ekranu; wszystko
zmienia to, ile podejść kosztuje etap 2 z `docs/wdrozenie.md`.

### Logowanie do Sfery miało dwie dziury, obie z pamięci zamiast z dokumentacji

Przykład producenta ustawia przed `Uruchom` osiem właściwości. Kod ustawiał
sześć. Brakowało pary `Uzytkownik` / `UzytkownikHaslo`, czyli **loginu SQL** —
osobnego od operatora Subiekta i wymaganego przy autentykacji mieszanej.
Doszły klucze `SFERA_SQL_LOGIN` i `SFERA_SQL_HASLO`; celowo NIE jest to
`MSSQL_USER`, bo tamten login ma z założenia prawo do sześciu tabel, a Sfera
wystawia dokumenty.

Druga dziura to adres serwera. Sfera chce postaci `HOST\INSTANCJA`, a worker
wysyłał samo `MSSQL_SERVER` — czyli celował w instancję domyślną, podczas gdy
instalator InsERT-u zakłada `INSERTGT`. Teraz skleja adres tak samo jak serwer
po stronie Node.

Ustalenia i ich źródła zebrane są w nowym `docs/sfera-com.md`. To ta sama
zasada, którą `CLAUDE.md` trzyma dla Allegro: kształt czyta się z pliku, nie
z pamięci.

### Sonda: nazwy Sfery bez wystawiania dokumentu

`sfera-worker/sonda.ps1` otwiera sesję Subiekta i wypisuje nazwy składowych —
obiektu GT, Subiekta, managerów. Nie woła żadnego `Dodaj*` ani `Zapisz()`,
więc nie zostawia śladu w bazie. Zamyka większość listy `[WERYFIKUJ]` w jednym
przebiegu, zamiast pętli „popraw C#, zbuduj exe, skopiuj, zrestartuj usługę".

Gdy nazwa mimo to okaże się zła, worker mówi to wprost: komunikat nazywa
wywołanie i numer punktu z listy w `sfera-worker/README.md`.

### Kod C# dostał pierwszy test w historii tego repo

Do dziś CI sprawdzało wyłącznie, że projekt się kompiluje. Pierwszym
uruchomieniem `Queue.cs` była więc bramka na maszynie klienta. `test-dymny.sh`
przepuszcza przez workera jedno MM w trybie `--dry-run` i sprawdza status,
numer dokumentu, zdarzenie audytu, heartbeat oraz guard kolejności.

Test zwrócił się przy pierwszym uruchomieniu. Bazę zakłada **kod serwera**,
z migracjami — bo `events.user_ref` dochodzi właśnie migracją, a baza z samego
`schema.sql` wywracała zapis audytu i zostawiała zadanie w `processing`. Na
hali zobaczyłby to ktoś dopiero po wystawieniu dokumentu w Subiekcie.

### Exe schodzi z CI, a `e_sqlite3.dll` wreszcie siedzi w środku

Przebieg workflow wiesza gotowy `wertis-sfera-worker.exe` jako artefakt, więc
**wdrożenie nie potrzebuje już .NET SDK na żadnej maszynie**. Late binding
sprawia, że Windows nie jest potrzebny nawet do kompilacji.

Przy okazji wyszło, że `PublishSingleFile` zostawiał `e_sqlite3.dll` OBOK exe,
a instrukcja każe skopiować na serwer sam plik wykonywalny. Skończyłoby się
to „Unable to load DLL" przy pierwszym otwarciu bazy. Ustawienie stoi teraz
w `.csproj`, więc obowiązuje każdą drogę budowania.

**[wymaga działania]** tylko przy wdrażaniu workera Sfery: usługę
`wertis-sfera` rejestruje się jako OSTATNIĄ, po ręcznym `--dry-run --once`.
Błąd widać wtedy na ekranie, a nie w przekierowanym dzienniku NSSM.


## 0.196.0 — 3 września 2026

**Obecność przestała ściągać całą listę rozmów.** Zdarzenie obecności —
wejście do rozmowy, wyjście, „pisze" — zmienia w kolejce jedną rzecz: znacznik
„ktoś tu siedzi". Do 0.195.0 robiło to przez ponowne pobranie CAŁEJ listy.

### Rachunek, nie przeczucie

`listaRozmow()` nie ma `LIMIT`-u ani odsiewu po statusie: oddaje każdą
zsynchronizowaną rozmowę z dwudziestoma jeden kolumnami. Zamknięte i spam
odsiewa dopiero przeglądarka, czyli po przesłaniu.

Pomiar na tym repo, przy treści pytania realnej długości:

```
  100 rozmów →    54 kB,   2 ms zapytania
 1000 rozmów →   537 kB,  26 ms zapytania
 5000 rozmów →  2688 kB,  81 ms zapytania
```

Znak „pisze" jest dławiony co pięć sekund, a `useRozmowy` nie ma `staleTime`,
więc każde unieważnienie to natychmiastowe pobranie. Kolega redagujący
odpowiedź ściągał całą listę wszystkim otwartym kartom co pięć sekund.

### Czego NIE zrobiliśmy i dlaczego

Pierwszy pomysł brzmiał „dołóż `staleTime`". Sprawdzony pomiarem: nie działa.
`invalidateQueries` znaczy zapytanie stałe niezależnie od `staleTime`
i odświeża aktywne obserwacje tak samo — dwa pobrania z nim i dwa bez.

Odrzucone zostało też dławienie unieważnień. Opóźniałoby zdarzenia RZADKIE
i ważne: nowa wiadomość klienta pojawiałaby się na liście z sekundowym
poślizgiem, żeby zaoszczędzić na czymś, co da się usunąć zupełnie.

### Co robi teraz

Zdarzenie obecności podmienia pole w pamięci panelu, bez żadnego żądania.
Reguła „kto trzyma rozmowę" nie powstaje przy tym drugi raz: serwer oddaje
obecnych posortowanych po czasie wejścia, a panel bierze pierwszego z listy,
zamiast wyprowadzać porządek od nowa.

Efekt uboczny jest dodatni: znacznik pojawia się natychmiast, bez czekania na
odpowiedź serwera. Pozostałe zdarzenia — nowa wiadomość, przejęcie, wynik
z hali — odświeżają kolejkę dokładnie jak dotąd.

To jest jedna z trzech rzeczy z przeglądu ładunku listy. Dwie zostają:
odsiew zamkniętych po stronie serwera i `LIMIT` z dociąganiem.

## 0.195.0 — 3 września 2026

**Trzy braki w skrzynce pytań, wskazane przy przeglądzie panelu.** Wszystkie
trzy dotyczą tego, co agent robi z pytaniem klienta, i wszystkie trzy kończyły
się wyjściem do panelu Allegro.

### Odpowiedź zostawiała wątek nieprzeczytany w Allegro

Specyfikacja ma `PUT /messaging/threads/{threadId}/read` od zawsze. W całym
serwerze nie było ani jednego wywołania — używaliśmy wyłącznie listy wątków
i wysyłki wiadomości.

Sprawa załatwiona w WERTIS zostawała więc **nieprzeczytana** w Centrum
Wiadomości Allegro. Im lepiej działał panel, tym bardziej kłamał tamten
licznik: czerwona plakietka przy sprawach dawno zamkniętych, a po niej nie
sposób poznać, co jeszcze czeka.

Znacznik idzie po UDANEJ wysyłce i tylko po niej. Nie idzie przy otwarciu
rozmowy: „zero zapisu przy patrzeniu" obowiązuje także zapisy do cudzego
systemu, a przeczytana ma znaczyć „odpisaliśmy", nie „ktoś zajrzał". Odmowa
oznaczenia nie wywraca wysyłki — wiadomość jest już u klienta, więc porażka
idzie do audytu, a nie na ekran jako „nie udało się wysłać".

### Do odpowiedzi nie dało się dołączyć pliku

Odczyt załączników działał od 0.155.0, wysyłka nie istniała wcale. Przy
pytaniach o części zdjęcie bywa całą odpowiedzią: „ten gwint, nie tamten"
pokazuje się szybciej, niż opisuje. Agent szedł po to do panelu Allegro,
czyli tam, skąd panel miał go zabrać.

Allegro wgrywa załącznik dwoma żądaniami: deklaracja `{ filename, size }`
oddaje numer, dopiero drugie niesie bajty. **Plik leci do Allegro przy
DODANIU**, nie przy WYŚLIJ — odmowę typu albo rozmiaru widać wtedy, gdy
jeszcze da się wybrać inny plik.

Załączniki wiszą przy rozmowie, nie w przeglądarce: szkic jest współdzielony
z zespołem, więc kolega widzi i tekst, i pliki, a odświeżenie karty niczego
nie gubi. Po udanej wysyłce znikają razem ze szkicem; po nieudanej zostają.

Identyfikatory weszły do klucza idempotencji. Bez tego „ten sam tekst z innym
zdjęciem" trafiłby na strażnika dubletu, a zdjęcie po cichu nie poszłoby do
klienta.

Nasz próg to 4 MB przy 5 MB Allegro. Plik jedzie do serwera base64 w JSON,
czyli rośnie o jedną trzecią, a limit ciała całego API stoi na 6 MB.
Podniesienie tamtego progu dla jednej funkcji otworzyłoby każdą trasę.

### Kolejka nie miała wyszukiwania

Zwroty mają je od 0.165.0. W skrzynce kubełek mówił „czyje to", kategoria
„o czym to", a pytania „czy TA rozmowa gdzieś tu jest" nie zadawał nikt, bo
nie było jak. „Klient pisał o tym miesiąc temu" znaczyło przewijanie listy.

Pole zawęża po loginie, po treści ostatniej wiadomości i po prowadzącym.
Liczy się w pamięci ekranu, bez ruchu do serwera. Pusty wynik cytuje frazę
i nie udaje pustego kubełka — to dwa różne zdania.

## 0.194.1 — 3 września 2026

**[wymaga działania] Poprawione nazwy checków w instrukcji reguły.** Wydanie
0.194.0 kazało wymagać checków `Serwer / test`, `Android / build` i trzech
podobnych. Tak ich nie widać: GitHub bierze nazwę checka z pola `name` zadania,
a bez niego z klucza — więc cztery workflow'y zgłaszały check o tej samej
nazwie `build`. Wymagany check dopasowuje się PO NAZWIE, więc reguła oparta
na tamtej instrukcji dawałaby bramkę słabszą, niż wygląda.

**Każde zadanie ma teraz nazwę własną:** `Serwer`, `Android`, `Instalator`,
`Worker Sfery`, `Usługa tła`, `Auto-scalanie`, `Konflikty`.

**Regułę importuje się z pliku, nie klika.** `.github/rulesets/main.json`
wchodzi przez Settings → Rules → Rulesets → Import a ruleset i zakłada naraz
wymagane checki, wymóg świeżej gałęzi oraz blokadę skasowania `main`
i wymuszania historii. Pięć nazw wpisywanych z palca to pięć okazji do
literówki, a literówka daje regułę czekającą na check, którego nikt nie zgłasza.

## 0.194.0 — 3 września 2026

**[wymaga działania] PR-y scalają się same, gdy CI jest zielone.** Automat
włącza natywne auto-scalanie GitHuba na każdym PR-ze wyjętym z wersji roboczej.
Trzy ustawienia repozytorium trzeba włączyć ręcznie raz — opisuje je `DEPLOY.md`.

**Konflikty dostają etykietę, nie automatyczne rozstrzygnięcie.** PR, który
przestał się scalać, dostaje etykietę i jeden komentarz. Rozstrzyga człowiek.
Powód stoi w liczbach: trzy najgroźniejsze defekty ostatnich wydań przeszły
z zielonym CI, a dwa z nich bez żadnego konfliktu.

**Każdy check raportuje zawsze.** Filtr ścieżek przeniósł się z wyzwalacza na
kroki. Wymagany check, którego workflow nie ruszył, zostawał w GitHubie
w wiecznym oczekiwaniu i blokował scalenie — bez tej zmiany nie dało się
uczynić wymaganym żadnego. Zadanie kończy się zielone także wtedy, gdy nie ma
czego sprawdzać.

**Zmiana poza obszarem workflow'ów przestaje przechodzić bez kontroli.** PR
dotykający wyłącznie `.gitignore` albo `wertis.env.example` nie uruchamiał
dotąd żadnego zadania — a „nic nie jest czerwone" znaczyło wtedy „nic nie
zostało sprawdzone".

**Podwójna definicja tabeli nie przejdzie drugi raz.** Nowy strażnik czyta
`schema.sql` i odrzuca powtórzoną tabelę lub indeks. Przy `CREATE TABLE IF NOT
EXISTS` druga definicja nie jest błędem składni, tylko cichą podmianą schematu
— tak w 0.142.0 scaliła się bez jednego znacznika konfliktu atrapa
`zadanie_terenowe`.

## 0.193.1 — 3 września 2026

**Trzy poprawki narzędziowe: mniej hałasu z testów, ostrzeżenie o starych
zależnościach, uczciwy komentarz o cache'owaniu.** Wszystkie z przeglądu
kosztów pracy nad repo; żadna nie zmienia niczego na ekranie.

**Testy serwera drukują kropki zamiast protokołu TAP.** Pełne wyjście miało
613 KB i 13 695 linii, z czego treścią było kilkanaście. Reporter `dot` daje
te same 46 sekund, ten sam kod wyjścia i te same szczegóły porażek —
asercję, różnicę, plik i linię — w 1,6 KB. To 385 razy mniej do przeczytania
przez człowieka i przez sesję asystenta, która ma to polecenie w instrukcji.

Kropki nie niosą jednej rzeczy: liczby testów, a tę cytuje się w opisach
wydań. Stąd `npm run test:licznik` — ten sam przebieg z reporterem TAP,
z którego zostają trzy wiersze podsumowania.

**`co_w_toku.sh` ostrzega, gdy `node_modules` jest starsze niż `package.json`.**
Nieaktualna instalacja UDAJE zepsute repozytorium: `npm test` pokazał kiedyś
290 porażek na czystym `main`, bo pakiet dołożony w międzyczasie nie był
zainstalowany. Fałszywa awaria kosztuje więcej niż prawdziwa, bo przy
prawdziwej wiadomo przynajmniej, czego szukać. Skrypt sprawdza istnienie
katalogów pakietów i jak zawsze kończy się zerem.

**Komentarz przy prompcie Copilota mówi teraz prawdę.** Prompt jest oznaczony
do cache'owania, ale ma około 380 tokenów, a próg wejścia do cache'u zaczyna
się od 512. API nie zgłasza tego błędem — po prostu nie cache'uje. Znacznik
zostaje, bo nic nie kosztuje i zadziała, gdy instrukcja urośnie; zmienił się
komentarz, żeby nikt nie liczył na oszczędność, której nie ma.


## 0.193.0 — 3 września 2026

**Hierarchia informacji w skrzynce pytań.** Właściciel powiedział wprost, że
ekran nie ustawia treści w kolejności ważności. Zrzut ekranu pokazał sześć
miejsc; poprawione są wszystkie, w trzech skupiskach.

### Oś rozmowy miała jedną cechę z czterech

Makieta `docs/projekt-widokow/Main.dc.html` odróżnia rodzaje wpisów tłem,
ramką, ikoną i wcięciem, a do tego podpisuje rodzaj: „Klient · Allegro",
„Odpowiedź firmy". Komentarz przy tokenach w `tailwind.config.js` mówi to samo
od początku. Front doszedł do jednej cechy — tło `#ffffff` kontra `#f8fafc`
przy tej samej ramce. Na ekranie to jest różnica niewidoczna.

Wychodziło z tego, że najwyraźniejszym wpisem osi była notatka wewnętrzna,
czyli rzecz, której klient nie zobaczy, a najsłabszym — podział „kto to
powiedział". Wróciły ikona, podpis rodzaju i wcięcie: klient odsunięty od
prawej, my od lewej. Widać to, zanim wzrok dojdzie do podpisu.

Przy okazji doszła godzina wpisu. `at` jechał w kontrakcie od początku, a oś
go nie pokazywała wcale — czytało się rozmowę bez wiedzy, czy między pytaniem
a odpowiedzią minęła minuta, czy trzy dni.

### Nagłówek rozmowy mówił „OTWARTA" dwa razy

W jednym paśmie stała plakietka ze stanem i pole wyboru z tą samą wartością.
Plakietka zeszła, barwa przeniosła się na samo pole. §7 żąda, żeby nagłówek
pokazywał stan zawsze — pokazuje, w rzeczy, którą się go zmienia. Pasek
statusu przestał też łamać wiersz, gdy miejsce jest: nagłówek zajmuje jedno
pasmo zamiast dwóch, a pytanie klienta zaczyna się wyżej.

### W kolejce najgrubszym drukiem stał login kupującego

Pytanie leżało pod nim, mniejsze i szare. Login Allegro nie mówi nic —
„Kupujący 44300444" to nie jest osoba, którą się zna. Triaż robi się po
treści, więc treść dostała pierwszy plan, a login zszedł do podpisu obok
czasu. Makieta rysowała to tak od początku.

Czas oczekiwania stanął w prawym rogu górnej linii, razem z PILNE — to jedyna
para sygnałów, po której układa się kolejność pracy. Po terminie robi się
czerwony. Znacznik nieprzeczytanej wiadomości to teraz KROPKA: słowo „NOWE"
stało obok plakietki „NOWA" i mówiło dwa różne fakty jednym wyrazem.

Data synchronizacji zeszła z własnego pasma do podpisu pod tytułem kolumny.
Pasm sterujących nad listą było pięć i zjadały ćwierć jej wysokości, a tę samą
datę niesie pigułka w pasku górnym, na każdym ekranie panelu.


## 0.192.0 — 3 września 2026

**Koszyk zwrotów wraca — tym razem z wejściem.** Właściciel opisał obieg,
który biuro robi ręką od lat: „gdy agent zasiada do zwrotów, to otwiera pustą
MM i dodaje kolejno przedmioty ze zwrotów; gdy koszyk się zapełni, zamyka MM
i tak w kółko". Panel jest teraz tą pustą MM.

### Dokłada ocena, nie przycisk

Naciśnięcie „Na stan", które operator i tak wykonuje przy towarze, JEST
dołożeniem do koszyka. Osobnego ruchu nie ma i osobnej trasy też — dekalog
ergonomii, punkt 5. To zarazem odpowiedź na pytanie o prędkość decyzji przy
zwrotach: najszybsza jest ta, której nie podejmuje się dwa razy.

Domknięcie kolejkuje dokument MM z magazynu głównego na regał zwrotów.
Numer wraca z Subiekta, więc kartka z liczbą pisaną odręcznie przestaje być
potrzebna. Kosz zamyka się OD RAZU, nie po powrocie numeru: hala ma co
rozkładać, nie czekając na Subiekta.

Kolektor nie wymaga zmian. Bierze kosz tą samą drogą co kosze z dokumentu.

### Dwie decyzje właściciela

Do koszyka wchodzi **wyłącznie towar oceniony „na stan"**. Utylizacja ma zejść
ze stanu, więc MM na regał zwrotów byłby dla niej ruchem w złą stronę.

Otwarty koszyk jest **jeden na operatora**. Fizyczny kosz stoi przy jednym
biurku, więc dwie osoby przy zwrotach nie mieszają towaru w jednym dokumencie.

### Pozycja bez kartoteki mówi o sobie

MM przesuwa stany kartotek, a nie nazwy, więc pozycja bez kartoteki na
dokument nie wejdzie. Ocena zapisuje się mimo to, bo jest faktem o towarze,
a ekran pisze wprost, czego nie zrobił. Cicha strata kończyłaby się kartonem
na hali z towarem spoza dokumentu.

### Dlaczego to wraca dopiero teraz

Ścieżka koszyków istniała i wypadła w 0.17.0 z jednym twardym powodem:
„domknięcie koszyka kolejkuje MM, a dokumentów MM na produkcji nie da się dziś
wystawić". Ten powód wygasł — worker Sfery ma prawdziwe `CreateMM`. Schemat
`kosz` czekał bez zmian: status `otwarty` nosi w komentarzu zdanie „biuro
dokłada zwroty", które przez rok nie miało kto wykonać.

Reguła „tylko lokalizacja" z 0.16.0 nie jest złamana. Dotyczy SUROWYCH zapisów
do bazy Subiekta, a dokumenty idą przez Sferę — tak samo jak korekta zwrotu.

### Liczby

Tras POST przy zwrotach jest osiemnaście; osiemnasta domyka koszyk. Licznik
w `routes/zwroty.test.ts` jest umową i podnosi się razem z uzasadnieniem.

## 0.191.1 — 3 września 2026

**Przeciążenie dostawcy nie bije dwadzieścia razy w ten sam mur.** Pierwsze
kliknięcie „Rozpoznaj" na produkcji dostało od Anthropic `529 overloaded_error`.
Ścieżka zadziałała w całości — poszło zamaskowane, wróciła prawdziwa odpowiedź
API, księga zapisała nieudaną próbę — ale obsługa tej odpowiedzi była zła na
trzy sposoby.

PIERWSZY: 529 lądowało w koszu „wszystko inne", więc partia leciała dalej.
Przy dwudziestu rozmowach to sześćdziesiąt daremnych prób (SDK ponawia dwa
razy), dwadzieścia wierszy w księdze i zero informacji ponad tę z pierwszej.
Dokładnie ten argument zatrzymywał już partię przy złym kluczu. Przeciążenie
dostało własną klasę i zatrzymuje partię tak samo, bo opisuje stan DOSTAWCY,
nie tej rozmowy — następna dostałaby identyczną odpowiedź.

DRUGI: ekran nazywał to „1 bez rozstrzygnięcia", czyli zwalał winę na sąd
modelu. Model nie został nawet zapytany. Teraz idzie zdanie mówiące, co zrobić,
a surowa odpowiedź JSON dostawcy nie trafia ani na ekran, ani do księgi —
w księdze stoi typ błędu, status i identyfikator żądania.

TRZECI, znaleziony przy pisaniu testu mapowania: `APIConnectionError`
DZIEDZICZY po `APIError`, więc gałąź o braku internetu stała niżej i była
nieosiągalna. Zerwane łącze meldowało się jako „Anthropic odpowiedziało ?" —
twierdziło, że dostawca odpowiedział, choć nie został zapytany. Kolejność
`instanceof` jest tu logiką, nie stylem, i pilnuje jej test.

Przy okazji ekran przestał gubić połowę wyniku: przerwana partia pokazuje
zdanie o przerwie RAZEM z liczbą rozpoznanych rozmów. Bez tej liczby człowiek
nie wie, że osiem z czternastu jest już zapłaconych, klika ponownie i płaci
drugi raz — a właśnie po to trasa oddaje 200, a nie błąd.

Nowe testy: sześć na mapowanie błędów SDK (budowane fabryką `APIError.generate`,
nie ręcznie — inaczej testowałyby nasze wyobrażenie o SDK), dwa na zatrzymanie
partii i rozdział „zdanie na ekran, ślad do księgi", dwa na panel.

## 0.191.0 — 3 września 2026

**Etap F ruszył: Copilot rozpoznaje, o co pyta klient.** Pierwsza rzecz z §14.1
i pierwsze miejsce w tej aplikacji, z którego treść rozmowy wychodzi poza
firmę. Domyślnie WYŁĄCZONE — bez klucza w `wertis.env` nie wychodzi ani jeden
znak, a serwer wstaje normalnie.

### Przycisk stoi NAD kolejką, nie w rozmowie

Klasyfikacja ma pomóc ułożyć pracę w skrzynce. Przycisk w otwartej rozmowie
etykietowałby treść, którą agent WŁAŚNIE PRZECZYTAŁ — wartość bliska zeru,
a koszt byłby kroplówką: każde otwarcie zaprasza do kliknięcia, nikt ich nie
liczy i po miesiącu nie wiadomo, na co poszły pieniądze. Rozmowa, której nikt
nie otworzył, i tak nie dostałaby etykiety.

Partia bierze nierozpoznane rozmowy z OGLĄDANEGO kubełka, przycięte do
`COPILOT_MAX_PARTIA` (domyślnie 20). Przycisk niesie liczbę, potwierdzenie mówi
wprost, że treść idzie do dostawcy i że to kosztuje. Trasa przyjmuje LISTĘ
identyfikatorów, więc przyszły przycisk w pojedynczej rozmowie wyśle jeden —
bez nowej trasy i bez podnoszenia licznika tras zapisu.

Etykieta starzeje się sama. Zapisujemy `message_id`, na którym ją liczono;
dopisek klienta czyni ją nieaktualną, plakietka szarzeje, a rozmowa znów
kwalifikuje się do partii.

### Kategoria NIE przestawia kolejki i to jest decyzja

Klucze kolejności — ręczna flaga „pilne" i czas oczekiwania klienta — są
FAKTAMI. Kategoria jest przypuszczeniem maszyny, a jedna pomyłka
klasyfikatora zakopałaby prawdziwe pytanie na dole listy tak, że nikt by tego
nie zauważył. Ekran daje plakietkę na wierszu, pasek liczników nad kubełkami
i filtr po kategorii. `ORDER BY` zostaje nietknięte, a test pilnuje tego
wprost — po stronie zapytania i po stronie ekranu.

Regułę kolejności wolno dołożyć w etapie G. To wydanie dostarczy liczb, którymi
da się ją uzasadnić: przy 95 % trafności przestawianie jest bezpieczne, przy
70 % jest szkodliwe.

### Prywatność ma dwa zamki, a jeden z nich jest w typie

Nadawca przyjmuje wyłącznie `TrescBezpieczna` — typ, który umie wyprodukować
tylko `zamaskuj()`. „Zapomniałem zamaskować" nie jest więc pomyłką do
wyłapania w przeglądzie, tylko błędem kompilacji. Drugi zamek to asercja tuż
przed wysyłką.

Znika e-mail, telefon, kod pocztowy z miastem, wiersz z markerem adresu, ciąg
szesnastu cyfr i login kupującego. W miejscu wartości zostaje znacznik, żeby
model wiedział, że coś tam było.

Granica jest zapisana, nie przemilczana. Adres bez markera i bez kodu
pocztowego przejdzie. W drugą stronę: numer OEM zapisany jak telefon zniknie
jako `[telefon]` — klasyfikacji nie jest potrzebny, ale przyrost ekstrakcji
będzie musiał tę regułę zawęzić. Oba kierunki mają test. Wzorzec kodu
pocztowego wymaga miasta po numerze, bo bez tego zjadał `NAC LS 46-450`,
czyli dokładnie tę daną, po którą klasyfikacja przyszła.

### Zużycie zapisujemy od pierwszego wywołania, w tokenach

Kwota w bazie jest kłamstwem od dnia zmiany cennika; liczba tokenów jest
faktem na zawsze. Cennik stoi w `services/copilot-koszt.ts` z datą odczytu.

Księga `copilot_wywolanie` jest OSOBNA od klasyfikacji, bo wywołanie
zakończone błędem kosztuje i nie daje odpowiedzi — trzymanie tokenów przy
klasyfikacji zgubiłoby tę część rachunku. Trafność mierzy werdykt człowieka
przy plakietce w otwartej rozmowie. Karta pomiaru za zębatką podaje `n`
i liczbę nieocenionych, żeby „100 % trafności" z dwóch ocen nie udawało
pomiaru.

Na `kategoria` nie ma `CHECK`-a i to jest decyzja, nie przeoczenie: w SQLite
rozszerzenie zamkniętej listy to przebudowa tabeli (0.135.0), a słownik
kategorii będzie rósł. Listy pilnuje serwis, a na ekranie `Record` z nazwami
po polsku nie skompiluje się bez nazwy dla nowej wartości.

### Limit dostawcy zatrzymuje partię czysto

429 w połowie partii oddaje **200 z wypełnionym `przerwane`**, nie błąd: część
rozmów została rozpoznana i ZAPŁACONA, a kod błędu kazałby ekranowi wyrzucić
wynik, za który już zapłaciliśmy. Zły klucz zatrzymuje partię od razu —
dwadzieścia prób z tym samym złym kluczem to dwadzieścia śladów w logu i zero
informacji ponad tę z pierwszej. Ponowień nie ma: tickera nie ma i limit
obsługuje człowiek.

Każda rozmowa to własna transakcja. Jedna wielka cofnęłaby przy limicie
kilkanaście zapłaconych odpowiedzi.

### [wymaga działania] Klucz wpisz WYŁĄCZNIE do `ANTHROPIC_API_KEY`

Bez `COPILOT_MODE=anthropic` nic się nie włączy i nic nie wyjdzie na zewnątrz.
Klucza NIE MA w konfiguracji serwera — jest tam tylko odpowiedź na pytanie
„czy jest". SDK czyta zmienną środowiskową sam, a własna kopia byłaby trzecim
miejscem, z którego sekret mógłby wyciec do komunikatu.

W 0.84.1 klucz wklejony do pola trybu wywrócił start, NSSM restartował usługę
w kółko, a wartość szła do `logs\wertis-api.err.log` przy każdym obiegu.
Dlatego brak klucza NIE zatrzymuje dziś startu, a `JSON.stringify(config)`
dostał własny test — ten, którego wtedy nie było.

Migracja dokłada dwie tabele sama. Akapit o włączeniu stoi w `DEPLOY.md`,
polityka danych — w `docs/obsluga-klienta.md`.

### Czego to wydanie NIE robi

Nie wyciąga danych doboru (`extracting_data` nadal bez nadawcy), nie czyta
zdjęć, nie pisze szkicu, nie proponuje wpisów do bazy wiedzy, nie ma taktu
w tle i nie wysyła do klienta ani jednego znaku. Nie rusza `conversation.status`,
`priorytet` ani `conversation.version` — ta ostatnia pilnuje przejęcia
i szkicu, więc podniesienie jej wywracałoby komuś szkic na 409 w trakcie
pisania.

## 0.190.0 — 3 września 2026

**Cztery braki z planu obsługi i z makiet, w tym ten najdroższy: pieniądze.**

### 1. Zwrot pieniędzy i odmowa bez otwierania Allegro

Panel rozstrzygał zwrot, liczył kwotę z zaznaczenia — i kazał operatorowi pójść
oddać pieniądze do panelu Allegro. §25 obiecuje pracę BEZ tamtego panelu,
a przy zwrocie nie było to spełnione ani razu.

**Dwie końcówki, dwa różne kształty**, oba czytane ze schematu w kopii
specyfikacji, nie z pamięci. Zwrot pieniędzy: `POST /payments/refunds`,
wersja `public.v1`, uprawnienie `allegro:api:payments:write`. Odmowa wypłaty:
`POST /order/customer-returns/{id}/rejection`, wersja `beta.v1`, uprawnienie
`allegro:api:orders:write`.

**[wymaga działania] Nowe uprawnienie `allegro:api:payments:write`.** Bez niego
przycisk ODDAJ PIENIĄDZE odpowie odmową z nazwą brakującego zakresu. Szczegóły
w `DEPLOY.md`.

**`commandId` powstaje RAZ na zwrot i wraca ten sam przy ponowieniu.** To jest
jedyna osłona przed drugim przelewem, gdy sieć zerwie się po wysłaniu żądania,
a przed odpowiedzią. Nowy identyfikator przy drugiej próbie oddałby pieniądze
dwa razy. Różnica względem rabatu, gdzie końcówka idempotencji NIE MA.

**Kwoty nie ma w ciele żądania.** Serwer bierze tę, którą sam policzył
z zaznaczenia — ta sama decyzja co przy `zapiszKwote` w 0.156.0. Panel podający
liczbę pozwoliłby oddać dowolną kwotę z pominięciem ekranu.

**Przeszkoda jest zdaniem, nie wyłączonym przyciskiem.** Serwer wymienia po
imieniu, czego brakuje: werdyktu, kwoty, numeru zamówienia albo identyfikatora
płatności. Zamówienie za pobraniem dostaje własne zdanie: tych pieniędzy
Allegro nigdy nie trzymało, więc wracają przelewem.

**Odmowa pyta o powód, zwrot nie pyta o nic** (§25a.5). Zwrot cofa się dopłatą,
odmowa jest oświadczeniem wobec klienta i drugiej Allegro nie przyjmie. Powód
czyta kupujący i ekran mówi to przy polu.

Obie trasy stoją za `autoryzuj(…, "zwrot_pieniedzy")` — to jedyne miejsca tej
aplikacji ruszające cudze pieniądze na zewnątrz, więc każde kliknięcie zostawia
wpis `privileged`.

Migracja dokłada kolumny sama. Doszedł też `platnosc_id` przy zamówieniu:
`payment.id` jechał w formularzu zakupowym od zawsze, a mapowanie brało z tego
obiektu wyłącznie typ i moment.

### 2. Widać, kto jeszcze siedzi przy rozmowie

Serwer liczył obecność i „pisze" od 0.144.0. Kolejka pokazywała trzymającego,
ale w otwartej rozmowie nie było NIC — a to tam pisze się odpowiedź, którą
drugi agent właśnie dubluje.

Dane docierały do panelu i były wyrzucane: `useSzynaZdarzen` zwracał
`obecnosc`, a ekran brał hook wyłącznie dla efektu ubocznego.

**Znaku „pisze" nie wysyłał nikt.** Trasa `presence` przyjmowała `typing` od
0.159.0, panel meldował samą obecność — więc sygnał nie mógł się pojawić,
bo nie powstawał. Teraz idzie z pola tekstowego, dławiony: odświeżenie co 5 s,
zgaszenie po 3 s ciszy, przy TTL 12 s po stronie serwera.

Pasek jest cienki i szary, bo obecność to stan chwilowy, nie status rozmowy.

### 3. Parametry towaru wchodzą do szkicu jednym kliknięciem

§10.4 wymienia to od początku. Wstawka bierze nazwę, symbol, EAN, numery
zamienne i dostępność — a NIE bierze półki, rezerwacji ani rozbicia na
magazyny. Szkic czyta klient, a adres regału mówi obcemu, jak zbudowany jest
nasz magazyn. Pilnuje tego osobny test.

Brak stanu mówi „brak na stanie", nie „0 szt.". Zero czyta się jak awaria
systemu, a to zdanie idzie do kupującego.

### 4. Makieta doboru przestała rysować rolę, której nie ma

Stopka `Dobor.dc.html` miała wyłączony przycisk „ZATWIERDŹ ZASTOSOWANIE —
tylko ekspert". Roli eksperta technicznego NIE MA: zniosła ją decyzja
właściciela z etapów E1 i E2, a §26 zdjęła pytanie „kto zatwierdza" z listy.

Makieta z nieistniejącą rolą jest gorsza od jej braku — następna sesja
zbudowałaby bramkę uprawnień pod byt, którego nikt nie zamawiał. Przycisk
nazywa się dziś tak jak w kodzie: ZATWIERDŹ DOBÓR.

### Poprawki w dokumentacji, które kłamała o sobie

`docs/allegro-ksztalt.md` twierdził, że kopia specyfikacji nie ma `commandId`
ani `order` przy zwrocie płatności. Nieprawda: oba stoją w `required` schematu
`InitializeRefund`. Zdanie zestarzało się przy odświeżeniu kopii i nikt go nie
przeczytał ponownie. Kodów odmowy jest SIEDEM, nie cztery; powodów zwrotu też
siedem, nie cztery.

§28 pisał o obecności „działa" — działał serwer, nie ekran. `Kontekst.tsx`
tłumaczył brak zakładki „Wiedza" tym, że nie ma skąd wziąć danych; E2 i E3
dały jej źródło, a zakładka nie wraca z innego powodu (dowody stoją już
w „Doborze").

### Liczby

Tras POST przy zwrotach jest siedemnaście, trzy wychodzą do Allegro — licznik
w `routes/zwroty.test.ts` jest umową i podnosi się razem z uzasadnieniem.

## 0.189.0 — 3 września 2026

**Drugi skan tego samego towaru kończy odłożenie.** Zgłoszenie właściciela:
„przy rozkładaniu koszyków zwrotów jeśli towar jest wybrany i zeskanuje go
drugi raz zatwierdź rozkładanie".

Rozłożenie pozycji wymagało dotąd dwóch różnych ruchów. Skan towaru wskazywał
pozycję, a kończył ją skan regału albo dotknięcie ODŁÓŻ TUTAJ. Gdy towar wracał
na półkę, którą aplikacja i tak podała, ten drugi ruch był formalnością —
wykonywaną w rękawicy, z kartonem w drugiej ręce.

Skan półki zostaje bez zmian i pozostaje drogą, która adres WERYFIKUJE.

Trzy warunki bronią przed odłożeniem, którego nikt nie chciał. Uzbraja
wyłącznie skan, nie automat: po każdym odłożeniu ekran sam wskazuje następną
pozycję, więc inaczej pierwszy skan przy nowej pozycji odkładałby ją, zanim
człowiek sprawdził, co trzyma. Między skanami musi minąć 800 ms, bo skaner
trzymany na spuście wysyła ten sam kod dwa razy. Towar bez adresu w kartotece
odmawia, tak samo jak przycisk.

**Dziennik mówi teraz, CZYM potwierdzono adres**: skanem półki, drugim skanem
towaru czy wpisem. Bez tego pola nie dałoby się po pomyłce sprawdzić, czy ktoś
tę półkę w ogóle zeskanował. Zdarzenie `manual_entry` zapisuje wyłącznie wpis
z klawiatury — drugi skan tam nie wpada, więc raport etykiet do przedruku
i kolumna „ręczne" przy pracowniku zostają prawdziwe.

Ten sam ekran rozkłada kosze zwrotowe i kartony, więc zmiana dotyczy obu.

## 0.188.1 — 3 września 2026

**Którą dostawę oddajemy — decyzja zapisana, kod bez zmian.**

Pytanie stało otwarte od 0.184.0: czy Allegro zwraca koszt najtańszej opcji
dostawy z oferty, czy tej, którą wybrał klient. Właściciel odpowiedział: tej,
którą wybrał klient. Panel liczył tak od początku, więc nic się nie zmienia
w działaniu.

Zmienia się to, że decyzja jest teraz ZAPISANA. Ustawa pozwala oddać mniej:
gdy klient wybrał opcję droższą niż najtańsza zwykła, sprzedawca nie musi
dopłacać różnicy. Oddajemy więcej świadomie — tak samo rozlicza to Allegro,
a liczenie najtańszej opcji wymagałoby cennika oferty, którego przy zwrocie
nie mamy.

Bez zapisu wyglądało to na niedopatrzenie i doczekałoby się „poprawki".
Dlatego stoi w trzech miejscach: komentarz przy `zapiszKwote`, akapit
w §25a.3 i test, który pilnuje kwoty.

## 0.188.0 — 3 września 2026

**Data doręczenia zwrotu naprawdę się pojawia.**

0.187.0 zapowiedziało ją i nie dowiozło. Właściciel zobaczył to tego samego
dnia: „pokazuje przy każdej paczce zwrotnej że do nas nie dotarła mimo że
w panelu allegro jest data".

### Dlaczego nie działało

Lista paczek do odpytania powstawała z tego, co WŁAŚNIE przyszło z Allegro.
Synchronizacja chodzi jednak kursorem: `from` w `getCustomerReturns` znaczy
„zwroty utworzone PO tym zwrocie", więc raz zobaczony zwrot nigdy nie wraca na
listę. Pytaliśmy zatem o tracking wyłącznie zwrotów zgłoszonych przed chwilą,
a zwrot zgłoszony przed chwilą nie jest doręczony. Kolumna `dostarczono_at`
nie zapełniła się ani razu.

Teraz lista powstaje z BAZY: paczki w drodze wybiera zapytanie po
`zwrot_klienta`, a numer listu czyta z kopii odpowiedzi Allegro. Polityka
0.163.0 zostaje bez zmian — numeru nadal nie zapisujemy przy zwrocie.

Testy tego nie złapały, bo sprawdzały serwis trackingu w izolacji. Nowy
strażnik stoi na SZWIE: przebieg z pustą stroną zwrotów ma i tak zapytać
o paczkę w drodze.

### Ekran przestaje zgadywać

Gdy przewoźnik nie podał nic, panel pisze „Nie wiadomo, czy dotarła", a nie
„Jeszcze do nas nie dotarła". To była trzecia z rzędu nieprawda w tej sekcji:
zdanie twierdzące stawiane bez podstawy. Paczka leżąca w magazynie od trzech
dni wyglądała identycznie jak zaginiona.

### Paczka nieodebrana ma datę powrotu z definicji

Biuro rejestruje ją, trzymając karton w ręku (0.172.0), więc `dostarczono_at`
wpisuje się od razu. Trackingu dla niej nie ma: przewoźnika nie znamy, a
Allegro tego zwrotu nie zna wcale. Wiersze sprzed poprawki domyka migracja.
Ekran nie pisze przy niej „nadana przez klienta" — klient jej właśnie nie
odebrał i niczego nie nadawał.

### Sprzeczność w dokumentacji

`docs/allegro-ksztalt.md` mówił w jednej sekcji, że `waybill` jest pusty w 88
rekordach z 94, a dwie sekcje niżej — że wypełniony w 88 z 94. Prawdziwe jest
drugie. Poprawka 0.187.0 zdjęła pomyłkę tylko w jednym miejscu.

## 0.187.0 — 3 września 2026

**Przy zwrocie widać, kiedy paczka do nas dotarła.** Właściciel zobaczył tę
datę we własnym panelu sprzedawcy Allegro i zapytał, czemu u nas jej nie ma.

### Odpowiedź była wstydliwa: bo napisałem, że Allegro jej nie podaje

Obiekt `CustomerReturn` i jego `parcels[]` mają wyłącznie `createdAt`, czyli
moment NADANIA przez klienta. Z tego jednego schematu wyszedł wniosek o CAŁYM
API — i przez trzy wydania panel pisał wprost „Allegro nie podaje daty
doręczenia do nas". Nieprawda.

Czas doręczenia podaje osobna końcówka:

    GET /order/carriers/{carrierId}/tracking?waybill=…

Każdy wpis historii niesie `occurredAt` („actual shipment status change time"),
a wśród ośmiu kodów jest `DELIVERED`. Jedno wywołanie bierze do dwudziestu
numerów listu.

### Numeru listu dalej nie zapisujemy

Polityka z 0.163.0 zostaje nienaruszona i nie trzeba jej ruszać.
Synchronizacja ma numer w ręku podczas przebiegu, więc pyta tracking od razu
i zapisuje WYŁĄCZNIE wynik: moment doręczenia i kod statusu. Numer żyje przez
jedno żądanie.

Pytamy tylko o paczki w drodze — decyzja właściciela. Zwrot z zapisaną datą
nie jest pytany drugi raz. Partie idą po przewoźniku, po dwadzieścia numerów.

### Dwie pomyłki w dokumentacji, obie znalezione przy okazji

**Sonda była odczytana ODWROTNIE.** `docs/allegro-ksztalt.md` twierdził, że
`waybill` „jest pusty w 88 z 94 rekordów" — a kolumna nosi nagłówek `niepuste`.
Numer jest WYPEŁNIONY w 88 na 94, czyli prawie zawsze, gdy zwrot ma paczkę.
Ta pomyłka kazałaby uznać całą drogę za bezużyteczną.

**`status` zwrotu nie odpowiada na pytanie o doręczenie**, choć ma wartość
`DELIVERED`. Sonda pokazuje, czym to pole bywa naprawdę: `COMMISSION_REFUNDED`
×95, `COMMISSION_REFUND_CLAIMED` ×3, `DELIVERED` ×2. Stan prowizji nadpisuje
stan przesyłki — z tego samego powodu kolejka nie routuje po nim od 0.164.0.

### Sygnał „brak dowodu" liczy się odtąd z DORĘCZENIA

Do 0.186.0 gasł, gdy klient nadał paczkę. Zwrot doręczony i ten jadący od
tygodnia wyglądały w kolejce identycznie, a to jest różnica między „mam towar"
a „czekam na towar". Gdy trackingu nie ma — przewoźnik nie odpowiada, numeru
brak — zostaje dawne kryterium: lepszy sygnał z daty nadania niż jego brak.

Ekran mówi też, gdy przesyłka ma kłopot: awizo, problem, powrót do nadawcy.
Kod spoza listy pokazuje się surowy, jak przy przewoźniku.

### Reszta

Odpytanie trackingu idzie PO transakcji zapisu, bo wychodzi do sieci: otwarta
transakcja SQLite na czas żądania HTTP blokowałaby workera. Awaria przewoźnika
degraduje — zwroty i tak wchodzą, data dojdzie przy następnym takcie.

Dziewięć nowych testów serwisu i trzy panelu. Trzy panelowe padają bez
poprawki; jeden z nich zastąpił test, który utrwalał tamto nieprawdziwe zdanie.

## 0.186.0 — 3 września 2026

**Identyfikatory z opisów i pełny tekst (§11.2, etap E3).** Dobór miał od E1
dwa szczeble „pominięte do E3”: numer OEM i pełny tekst. Surowiec leżał
w opisach kartotek — 460 sekcji `OEM:`, 99 `Nr. oryg.`, 37 `Modele:` —
a wyszukiwarka nie czytała kolumny `opis` wcale. Teraz po każdym imporcie
serwer buduje z opisów tabelę `towar_identyfikator`, listę `model_z_opisu`
i indeks FTS5 `towar_fts`. Dobór dostał oba brakujące szczeble, ekran Wiedza
czwartą zakładkę „Z opisów”, karta towaru identyfikatory, a ustawienia kartę
pokrycia wiedzy.

### Dwie decyzje właściciela

- **Numer OEM bez kartoteki to kandydat bez wiersza** — jak w makiecie:
  symbol „OEM 118550127/0”, pewność „wymaga danych”, bez stanu i bez
  przycisku Wybierz. „Nie mamy tego” jest odpowiedzią dla klienta.
- **Sekcje `Modele:` nie idą do kolejki propozycji.** Automat nie zgadnie,
  czyja to maszyna. Człowiek wskazuje markę i model na liście „Z opisów”,
  dopiero to tworzy propozycję ze źródłem `opis` i dowodem `decyzja_biura`.
  Odrzucony wiersz nie wraca po imporcie.

### Zasady, które stoją w kształcie

- Pochodne opisów odbudowuje `poImporcie` PO transakcji importu, po seedzie
  i raz przy starcie, gdy są puste. Nigdy z `buildApp()` ani z `migrate()`.
  Każda przebudowa w osobnym try/catch, czas w dzienniku; strażnik < 5 s.
- Żadnych kluczy obcych do `sgt_towar` — import wycina read-model. Ręczne
  identyfikatory i odrzucone sekcje przeżywają przebudowę (`INSERT OR IGNORE`).
- `CREATE VIRTUAL TABLE` stoi w `migrate()` w try/catch, nie w `schema.sql`:
  bez FTS5 serwer wstaje, szczebel melduje „niedostępne — SQLite bez FTS5”.
- Pełny tekst pyta WYŁĄCZNIE o dane wpisane przez agenta, nigdy o treść
  wiadomości (blizna „szarpaka”). Marka i model podnoszą ranking bm25, nie
  warunkują trafienia. Trafienie po treści to „wymaga danych”, nie dowód.
- Cyfry ze spacjami to JEDEN numer (`532 16 56-30`); granica sekcji opisu
  to nadal pierwsze generyczne „Słowo:” — wspólny moduł `opis-sekcje.ts`,
  a `zamienniki.test.ts` jest strażnikiem refaktoru.
- Tras zapisu wiedzy jest siedem (było cztery); licznik w teście jest umową.

## 0.185.0 — 3 września 2026

**Baza wiedzy zastosowań (§11.3, §11.4, §12, etap E2).** Do tego wydania
zatwierdzony dobór był zdaniem agenta bez dowodu, a negatywne dopasowania nie
miały gdzie mieszkać. Teraz są trzy tabele — `model_urzadzenia`,
`zastosowanie`, `dowod_zastosowania` — nowy ekran „Wiedza” w pasku z kolejką
propozycji i licznikiem, a zakładka Dobór pokazuje dowody wybranej kartoteki,
negatywy i pomiary z tej rozmowy. Domyka to oba brakujące kryteria §25:
rekomendacja pokazuje źródło, negatywne dopasowania są widoczne.

Numer 0.184.0 zajął w międzyczasie otwarty PR ze zwrotami — stąd 0.185.0.

### Skąd bierze się wiedza

Zawsze z pracy i zawsze jako PROPOZYCJA. Zatwierdzenie doboru z marką
i modelem składa ją automatycznie, z dowodem „rozmowa”. Wynik pomiaru z hali
trafia do kolejki na kliknięcie w zakładce Dobór — jako dowód `pomiar_wlasny`,
nigdy fakt (§13.4). Wpis ręczny z ekranu Wiedza niesie dowód z katalogu albo
z decyzji biura. Negatywy wchodzą wyłącznie ręcznie, z powodem z listy §11.4.

### Kto rozstrzyga

Każdy z biura, także autor propozycji — decyzja właściciela. Roli „ekspert”
nie ma; w kodzie stoi rodzaj dowodu `decyzja_biura`. Automat nie zatwierdza
nigdy: serwis sprawdza konto biura PRZED zapisem, a test odmawia hali
i nieistniejącemu kontu. Odrzucenie wymaga powodu; negatyw wycofuje się
wyłącznie z powodem (§14.2).

### Zasady, które stoją w kształcie

- Nazwy polskie, żadna ze spalonej listy (`dopasowanie`); adres `wiedza/*`
  zamiast projektowego `dopasowania/*`. Test migracji pilnuje obu połów.
- Pięć list `CHECK` zamkniętych od razu: `opis` (E3) i `copilot` (F) stoją
  bez nadawcy, bo `CHECK` nie da się rozszerzyć bez przebudowy tabeli.
- Negatyw ZAWSZE z powodem — `CHECK` sprzęgający polaryzację z powodem.
- Dowody append-only; historia wersji przez `zastepuje_id`, bez tabeli wersji.
- Pewność: `potwierdzone` przy choć jednym dowodzie technicznym; same ślady
  rozmów to `prawdopodobne`. Reguła makiety „z najsłabszego dowodu” odrzucona
  świadomie i opisana w §11.3.
- Zdanie źródła pisze serwer — kandydat, ostrzeżenie i szkic mówią to samo.
- Zatwierdzone zastosowanie jest od razu szczeblem doboru (`zastosowanie`,
  przed ofertą) i wchodzi do zdania szkicu z dowodem.

### Trasy

Siedem tras `GET/POST /api/obsluga/wiedza/*` w nowym `routes/wiedza.ts`
z własną bramką biura i własnym strażnikiem adresów panelu (czyta
`panel/src/api/wiedza.ts`). Dwie przy doborze: `GET …/dobor/wiedza`
i `POST …/dobor/pomiar-do-wiedzy`.

Poza zakresem: identyfikatory OEM i pełny tekst (E3), Copilot (F).

## 0.184.0 — 2 września 2026

**Do zwrotu da się dopisać produkt, którego klient nie zgłosił.** Decyzja
właściciela: „czasami klient zgłosi tylko jeden produkt do zwrotu, a wyśle
dwa".

### Regulamin Allegro nie wymaga, żeby jedno zgadzało się z drugim

Klient ma czternaście dni na OŚWIADCZENIE o odstąpieniu i liczy się jego
termin, nie zgodność przesyłki ze zgłoszeniem. Opóźnienie samej wysyłki
odstąpienia nie unieważnia. Formularz zwrotu wypełnia się przy tym na ekranie,
a paczkę pakuje przy stole — i wtedy dokłada się to, co też nie pasowało.

Pieniądze i tak trzeba oddać, więc biuro musi mieć czym zapisać to, co
naprawdę przyszło.

### Produkt bierze się z ZAMÓWIENIA, nie z pola tekstowego

Klient może odesłać wyłącznie to, co kupił, więc lista zamówienia jest granicą
naturalną — a ograniczenie jest tańsze od komunikatu. Przy okazji pozycja
przynosi cenę i walutę, więc kwota do oddania dalej liczy się z faktów.
§25a.3 zostaje nienaruszone: panel przysyła zaznaczenie, sumę składa serwer.

Lista pokazuje RÓŻNICĘ zamówienia i zwrotu, nie całe zamówienie. Gdy różnicy
nie ma, nie ma też przycisku.

### Oznaczenie `zrodlo='biuro'` pracuje w dwie strony

Na ekranie mówi, że to zapis człowieka, a nie zgłoszenie klienta (§4.3).
W bazie CHRONI — i to jest cichy błąd, który ta zmiana usuwa przy okazji.

Synchronizacja kasuje pozycje, których Allegro już nie oddaje. Pozycji
dopisanej przez biuro Allegro nie zna i nigdy nie odda, więc bez warunku
`zrodlo='allegro'` każdy takt kasowałby ją razem z oceną hali i zaznaczeniem
do kwoty. Nic nie wygląda na zepsute, dopóki ktoś nie policzy pieniędzy.
Osobny test pilnuje obu połówek: dopisana przeżywa takt, a wycofana przez
klienta nadal znika.

Zdjąć da się wyłącznie pozycję biura (§25a.5). Zgłoszona przez klienta
wróciłaby przy najbliższej synchronizacji, więc przycisk obiecywałby skutek,
którego nie ma.

### Pierwsze zastosowanie dekalogu ergonomii poza kolektorem

`docs/ergonomia-magazynu.md` obowiązuje panel biura w punktach 1, 2, 5, 6
i 10. Cztery z nich widać tutaj: lista pokazuje różnicę, nie całe zamówienie
(5); otwiera się na żądanie, jak potrącenie (2); nie ma pola tekstowego, bo
zamówienie jest granicą (6); przycisk stoi pod listą produktów, bo tam operator
zauważa brak (1).

Punktu 10 nie da się tu spełnić i mówimy to wprost: tej czynności nie mierzy
żaden licznik. Dekalog sam każe narzędziu mówić, czego NIE dowodzi.

### Reszta

Dopisanie cofa zwrot do kubełka DO OCENY, bo nowa pozycja nie ma jeszcze oceny
hali. To wychodzi z istniejącej logiki kubełków, bez ani jednej nowej linii.

Trasy zapisujące rosną do piętnastu. **Anulowanie wniosku o rabat schodzi
z planu** — decyzja właściciela: Allegro anuluje wniosek samo.

## 0.183.0 — 2 września 2026

**Dobór części przy rozmowie (§11, etap E1).** §1 nazywa dobór najważniejszym
przypadkiem panelu, a do tego wydania panel nie miał go wcale: ani stanu,
ani miejsca na to, o jaką maszynę chodzi. Teraz kolumna kontekstu ma trzecią
zakładkę „Dobór”: dane wejściowe (marka, model, wariant, rocznik, numer
seryjny, silnik, numer OEM, część, parametry), status z §7, kandydaci z drogą
i źródłem, wybór kartoteki i zatwierdzenie doboru. Status doboru wchodzi do
wiersza kolejki (§10.2), a każdy krok zostawia kreskę na osi rozmowy.

### Co daje kandydatów

Cztery szczeble z §11.2: dokładny symbol, EAN, kartoteka oferty (pamięć wskazań
albo SKU) i zamiennik z opisu tej kartoteki. Numer OEM, potwierdzone
zastosowanie i pełny tekst raportują się jako POMINIĘTE do E2/E3 — szczebel
bez danych mówi, że go nie sprawdzono, zamiast udawać „zero wyników”.
Wyszukiwarka klikana ręcznie nie jest kandydatem, tylko wyborem podpisanym
agentem. Furtki na literówki dobór nie używa (blizna „szarpaka”).

### Zasady, które stoją w kształcie

- Tabela nazywa się `dobor_rozmowy`, nie `dopasowanie`: tamtą nazwę
  `migrate()` kasuje przy każdym starcie. Test migracji pilnuje obu połów.
- Jedna rozmowa = jeden dobór (klucz główny). Brak wiersza znaczy
  `not_started` i liczy się przy odczycie — otwarcie zakładki nic nie wstawia.
- Dobór ma WŁASNĄ wersję, nie `conversation.version`: edycja chipów nie
  wywraca cudzego szkicu na 409. Konflikt danych nie kasuje wpisanego.
- Symbol wybranej kartoteki idzie z bazy, nie z żądania; bez klucza obcego do
  `sgt_towar`, bo import odtwarza read-model.
- `extracting_data` nie ma nadawcy do etapu F: serwer odrzuca go z ręki.
  `confirmed` wymaga wyboru. Zatwierdza każdy z biura — roli „ekspert” nie ma
  decyzją właściciela, automat nie zatwierdza nigdy.
- Zdanie do szkicu pisze serwer, ze źródłem (§14.3). Panel go nie układa.

### Trasy

`GET …/rozmowy/:id/dobor/kandydaci`, `PUT …/dobor/dane` (409 przy rozjeździe
wersji), `POST …/dobor/status`, `POST …/dobor/wybor`. Wszystkie za bramką
biura; strażnik adresów panelu z 0.181.1 obejmuje nowe hooki.

Poza zakresem tego wydania: baza zastosowań i dowodów (E2), identyfikatory OEM
i pełny tekst (E3), Copilot (F).

## 0.182.0 — 2 września 2026

**Ergonomia magazynu przestaje być kwestią gustu.**

### Co było źle

Reguły projektowania ekranów magazynowych żyły w komentarzach przy kodzie
i w pamięci osób, które je kiedyś ustaliły. Nie dało się na nie wskazać przy
sporze o kształt ekranu, więc każdy taki spór zaczynał się od zera.

Kosztowało to konkretnie, nie teoretycznie. Kolektor deklarował JEDEN minimalny
cel dotyku — `MinTap = 48 dp` w `Common.kt` — a dwadzieścia linii niżej,
w tym samym pliku, `LocChip` brał 44 dp. Komentarz w `KartonScreen.kt` nazywał
te 44 dp „minimalnym CELEM DLA PALCA". Dwie liczby twierdziły o sobie to samo.

Trzy inne miejsca zjechały poniżej progu bez śladu decyzji: awatar wchodzący
w ustawienia, pastylka kolejki Sfery i pastylka adresu. Nic tego nie mierzyło,
więc rozjazd był niewidoczny aż do przeczytania kodu z linijką w ręku.

### Co się zmienia

**Dekalog stoi w `docs/ergonomia-magazynu.md`.** Dziesięć reguł z zakresem,
z wiązaniem do konkretnych plików i z listą miar. Rozstrzyga spór na korzyść
tego projektu, który wymaga mniej decyzji, interakcji, uwagi, pamiętania,
ruchu i błędów — w tej kolejności, a urody dopiero po nich.

Dokument mówi też, czego NIE obejmuje: biuro i panel obsługi klienta biorą
z niego punkty 1, 2, 5, 6 i 10, bo mysz na blacie ma inną charakterystykę niż
kciuk w rękawicy. Reguła bez zakresu przestaje bramkować cokolwiek po
pierwszym sporze.

**Punkt 4 dostaje bramkę: `tools/ergonomia_check.py`.** Szuka łańcuchów
`Modifier` z `clickable`, które same schodzą poniżej 48 dp. Liczy wyłącznie
ogniwa łańcucha, nigdy rozmiarów z ich argumentów — ikona 20 dp w środku
przycisku 48 dp jest poprawna i nie ma prawa się zapalić. Bramka biegnie w CI
przed Gradle'em, tak jak kontrola importów, i w sekundy.

**Zwolnienie jest jawne i kosztuje zdanie.** Cel mniejszy niż 48 dp wymaga
komentarza `ergonomia: <powód>` o co najmniej trzech wyrazach. Dekalog sam
dopuszcza mniejszy cel przy czynności rzadkiej albo groźnej; skrypt ma wymusić
uzasadnienie, nie zabronić decyzji.

**Trzy cele urosły do 48 dp.** Awatar zachowuje kółko 40 dp, ale klikalne pole
ma teraz 48 — rozmiar widoczny i rozmiar dotykany to dwie różne rzeczy,
a pasek górny ma 62 dp, więc pionowo to nic nie kosztuje. Pastylka Sfery
i pastylka adresu biorą wysokość z `MinTap`, czyli z jednego źródła.

**Trzy zostały mniejsze świadomie i mają to napisane.** Krzyżyk kasujący
pozycję z kartonu — bo kasuje pracę i stoi tuż przy poprawianiu ilości.
Krzyżyk zwijający wiersz dostawy — bo ten sam skutek daje powtórny tap w cały
pasek. Wejście w przesunięcie z MGP — bo pełne 48 dp rozpycha nagłówek karty,
a wejście jest rzadkie; było tam kiedyś 15 dp, więc 40 dp to i tak naprawa.

**Dekalog wszedł pod `styl_check.py`.** Dokument o dyscyplinie, który sam łamie
limit długości zdania, przekonuje tyle, co komentarz „zgodnie z wersją
monorepo".

### Czego ta zmiana NIE robi

Nie mierzy dziewięciu pozostałych punktów. Liczby decyzji, kolejności
informacji, kosztu ruchu i trasy nie sprawdza tu nic — zostają do przeglądu
przez człowieka, a dokument mówi to wprost. Nie wykrywa też celu za małego
przez sam brak wymiaru: łańcuch bez zadeklarowanej wysokości mierzy się
dopiero na urządzeniu.

Trasy zbiórki nie liczy nadal nic w kodzie. Punkt 9 stoi w dokumencie po to,
żeby pierwsza implementacja nie zaczęła od najkrótszej drogi jako jedynego celu.

### Przy wdrożeniu

Nic ręcznie. Baza i konfiguracja bez zmian. Nowe cele dotyku widać dopiero
po aktualizacji APK, którą kolektory proponują same.

## 0.181.1 — 2 września 2026

**Komentarz wewnętrzny ze skrzynki dostawał 404 od 0.157.0.** Panel wołał
`/api/obsluga/rozmowy/:id/komentarz`, a serwer wystawiał wyłącznie
`/api/conversations/:id/comments`. Ciało żądania pasowało, adres nie.

### Dlaczego nikt tego nie widział przez siedem wydań

Testy tras (`TRASY()` w `routes/skrzynka.test.ts`) pilnują tras, które
ISTNIEJĄ — 401 bez sesji, 403 dla magazyniera, „patrzenie niczego nie
zapisuje". Nie pilnują tego, że panel woła te same adresy. Test komponentu
`Komentarz.test.tsx` renderuje komponent z propsami, nie sięga do sieci. Oba
zestawy były zielone, a komentarz szedł w próżnię.

### Co się zmienia

Adres w `useDodajKomentarz` poprawiony. Do testów tras dochodzi STRAŻNIK:
czyta źródło hooków panelu, wyciąga każdy adres z metodą i puszcza prawdziwe
żądanie przez router. Brak trasy poznaje po domyślnym 404 Fastify, więc 404
aplikacji („nie znaleziono rozmowy") go nie myli. Sprawdzone przez cofnięcie
poprawki: strażnik wskazał dokładnie ten adres.

Przy okazji: `beforeEach` w testach tras nie sprzątał `sprawa_klienta`, więc
każdy test dopisany po teście spraw padał na kluczu obcym. Naprawione.

**Widok mobilny (§10.5) zdjęty z planu** decyzją właściciela — panel pracuje
na monitorach biura. Dokument zachowuje pierwotny projekt dla historii.

---

## 0.181.0 — 2 września 2026

**Wiersz kolejki mówi, za co wziąć się najpierw.**

### Co było źle

§10.2 wymienia jedenaście rzeczy, które ma nieść wiersz. Panel niósł sześć.
Brakowało priorytetu, czasu oczekiwania, liczby nowych wiadomości i znaku
oczekującego zadania — czyli wszystkiego, co odpowiada na pytanie „za co się
teraz wziąć". Data ostatniej wiadomości sama tego nie mówi: trzeba ją odjąć
w głowie od dzisiaj.

### Co się zmienia

Wiersz niesie **PILNE**, **czas oczekiwania** („czeka 2 g 14 min"), **licznik
dopisków klienta** i **znak zadania w toku**. Kolejność listy bierze najpierw
flagę, potem najdłużej czekające pytanie.

**Zegar liczy się od PYTANIA klienta**, nie od ostatniej wiadomości w wątku.
Rozmowa, w której klient nic nie napisał, nie dostaje zegara wcale — nie ma
tam nikogo, kto czeka, a licznik od naszej wiadomości kłamałby o cudzej
cierpliwości.

**Licznik mówi to, co mierzy.** To dopiski klienta od NASZEJ ostatniej
odpowiedzi, nie „nieprzeczytane przez agenta". Tamtego policzyć się nie da:
Allegro oddaje samą flagę wątku (`thread.read`), a `message` nie ma znacznika
odczytu. Ekran nie obiecuje pomiaru, którego nie robi.

**Flaga „pilne" jest RĘCZNA** i zostawia ślad na osi oraz w dzienniku. Automat
nie ma z czego jej wyliczyć, dopóki §26 nie rozstrzygnie terminu odpowiedzi —
bez terminu „pilne" znaczyłoby tylko „stare".

### Czego dalej nie ma

**Termin odpowiedzi** czeka na decyzję z §26; bez niej byłby zmyślony, a kubełek
„po terminie" zostaje przy dzisiejszym znaczeniu, czyli wygasłym odłożeniu.
**Status doboru** czeka na etap E — dobór nie ma jeszcze własnego bytu.

---

## 0.180.0 — 2 września 2026

**Skrzynka dostaje trzecią kolumnę — kontekst przestaje spychać pytanie
klienta poniżej krawędzi okna.**

### Co było źle

Układ z trzema kolumnami stoi w §10.1 od początku, a makieta narysowała go
poprawnie. Front miał dwie: kolejkę i rozmowę. Kontekst — sprawa, oferta,
towar, zamówienie — leżał w środkowej kolumnie, nad osią. Cztery bloki jeden
pod drugim spychały pytanie klienta poniżej krawędzi okna, czyli chowały to,
po co agent w ogóle otwiera rozmowę.

### Co się zmienia

Oferta, towar i zamówienie przenoszą się do kolumny kontekstu z DWIEMA
zakładkami. Środkowa kolumna niesie odtąd rozmowę i nic poza nią.

Zakładek jest dwie, nie pięć jak w makiecie. „Dobór", „Klient" i „Wiedza" nie
mają dziś skąd wziąć danych — tabel `part`, `fitment`, `customer`
i `customer_machine` nie ma wcale. Zakładka, która zawsze mówi „wkrótce", uczy
nie klikać.

**Zakładki przy rozmowie, sekcje przy zwrocie.** Kolumna dowodów zwrotu to
jedna lista faktów o jednej sprawie. Kontekst rozmowy niesie dwa równorzędne
tematy, a sekcje kazałyby przewijać obok tego, którego akurat nie czytasz.
§25a.4 niesie to rozstrzygnięcie.

### Dług spłacony przy okazji

Środkowa kolumna zwęziła się o 340 px i to obnażyło brak, który czekał
w kodzie: `Os` była jedynym blokiem z bazą 0, więc kurczyłaby się pierwsza —
do zera. Nagłówek, sprawa, banery i edytor dostają `shrink-0`, a lista kolejki
`min-h-0`. Wzorzec pochodzi z ekranu zwrotów, gdzie stoi od 0.165.0.

Testy tego nie złapią: jsdom nie liczy układu. Sprawdzone okiem w przeglądarce
przy 1280 i 1920 — dokument się nie przewija, nic nie wychodzi poza okno,
a kolumna kontekstu ma swoje 340 px.

---

## 0.179.0 — 2 września 2026

**Rozmowa pokazuje towar z Subiekta, nie tylko ofertę z Allegro.**

### Co było źle

SKU sprzedawcy leżało w `offer_snapshot` od 0.178.0 i nie prowadziło donikąd.
Agent widział tytuł i cenę oferty, a żeby powiedzieć „jest, leży na R12-B3",
otwierał Subiekta. To ten sam koszt, który §25 obiecuje zdjąć przy panelu
Allegro — tylko po drugiej stronie.

Mostek oferta→kartoteka istniał od 0.152.0, ale wymagał ZAMÓWIENIA. Pytanie
pod ofertą pada zwykle przed zakupem, więc zamówienia nie ma i mieć nie będzie.

### Co się zmienia

`kartotekaOferty` łączy dwa ogniwa, które działają bez zamówienia: pamięć
wcześniejszych wskazań i SKU ze snapshotu oferty. Kolejność jest kolejnością
pewności — za pamięcią stoi decyzja człowieka, więc bije automat.

Blok towaru przy rozmowie pokazuje stan, rezerwacje, stan DOSTĘPNY, półkę,
EAN i zdjęcie. Dostępny stoi osobno od stanu, bo to on odpowiada na pytanie
klienta: stan bez odjętych rezerwacji obiecuje towar, który jest już czyjś.

**Brak kartoteki niesie POWÓD.** „Oferty jeszcze nie pobrano" naprawi się samo
w kilka minut, a „oferta bez SKU" nigdy — i to są dwa różne zdania na ekranie.
Do tego wydania oba wyglądałyby identycznie.

**Propozycja nie udaje faktu.** Automat proponuje kartotekę i czeka na jedno
kliknięcie; dopiero potwierdzenie zapisuje parę oferta–kartoteka do pamięci
wspólnej ze zwrotami. Wskazanie ręczne podpisuje się imieniem człowieka, a nie
udaje danej z Allegro (§4.3).

**Zdjęcie idzie z NASZEJ trasy**, nie z serwera Allegro. Zastrzeżenie z 0.178.0
dotyczyło obrazka z ich serwera — ten pochodzi z `/api/products/:twId/zdjecie`
i nie wyprowadza przeglądarki biura poza sieć firmy.

### Czego to jeszcze nie robi

Kartoteka nie wchodzi do zadania terenowego automatycznie — agent dalej wskazuje
towar wyszukiwarką przy zlecaniu pomiaru. To osobna zmiana.

---

## 0.178.0 — 2 września 2026

**Rozmowa pokazuje ofertę, pod którą padło pytanie — tytuł, cenę i SKU, nie
sam numer.**

### Co było źle

Klient pyta pod ofertą, Allegro przysyła `relatesTo.offer.id`, a panel
pokazywał ten numer i na tym kończył. Mail powiadamiający z Allegro ma w bloku
„Wiadomość dotyczy" tytuł, zdjęcie i cenę — panel miał więc MNIEJ niż
powiadomienie, od którego zaczyna się cała ta skrzynka. Agent szedł po tytuł do
panelu Allegro, czyli tam, gdzie `panel-obslugi-klienta.md` §25 obiecuje nie
zaglądać.

Tytuł znaliśmy dotąd wyłącznie z pozycji zamówienia o tym numerze oferty. To
działa po zakupie i nie działa nigdy przy pytaniu SPRZED zakupu — a takie
właśnie przychodzi pod ofertą.

### Co się zmienia

Nowy takt `allegro-oferty` dociąga oferty, na które wskazują wiadomości, i
zapisuje je jako `offer_snapshot`: tytuł, cena w groszach, SKU sprzedawcy
(`external.id`) i status publikacji. Rozmowa dostaje nad osią blok oferty —
bliźniaczy do bloku zamówienia z 0.167.0 — a tytuł wchodzi też na oś, przy
wiadomości.

`GET /sale/offers` przyjmuje `offer.id` TABLICĄ, więc cała partia kosztuje
JEDNO żądanie, a nie jedno na ofertę. Rytm taktu jest inny niż u trzech
sąsiadów, bo wszystkie wychodzą z tego samego adresu IP.

To SNAPSHOT, nie odczyt na żywo: cena opisuje chwilę pytania, a nie dzisiejszy
cennik. Odświeża się po dobie — rozmowa sprzed tygodnia ma zostać czytelna,
ale ekran nie ma też kłamać ceną w nieskończoność.

**Zdjęcia nie pobieramy.** Ta sama decyzja, co przy awatarze rozmówcy: obrazek
z serwera Allegro znaczyłby wyjście przeglądarki biura poza własną sieć przy
każdym otwarciu skrzynki.

### Czego to jeszcze nie robi

SKU z oferty leży w bazie i NIE jest jeszcze wiązane z kartoteką. Mostek
`services/dopasowanie-sku.ts` istnieje od 0.152.0 i chodzi po pozycjach
zamówień; podłączenie go do ofert to osobna zmiana.

**[wymaga działania]** Konto Allegro musi mieć uprawnienie
`allegro:api:sale:offers:read`. Bez niego takt dostanie 403, zapisze ostrzeżenie
w logu i nic więcej — panel zostanie przy gołym numerze, czyli przy stanie
sprzed tego wydania. Odmowa nazywa brakujący scope po imieniu.

---

## 0.177.1 — 2 września 2026

**Schemat bazy ma odtąd jednego właściciela: serwer API.** Domknięcie awarii
z 0.174.2 — tamto wydanie usunęło konkretny wyjątek, to usuwa układ, który
zamieniał jedną awarię migracji w awarię dwóch usług.

### Co było źle

Migracja siedziała w `db()`, więc wykonywał ją KAŻDY proces otwierający bazę:
API, worker, sonda, inwentarz, rekoncyliacja. 2 września jeden wyjątek położył
API i workera naraz, a `AppExit Default Restart` bez opóźnienia zamienił to
w pętlę. W logu workera zostawało „database is locked" — objaw, który prowadził
diagnozę w złe miejsce, bo bazę blokowało API mielące migrację w kółko.

Że układ jest zły, repo wiedziało i obchodziło to po kawałku. Dwie przebudowy
tabel sprawdzają swój warunek DRUGI RAZ pod blokadą zapisu, obie z tym samym
uzasadnieniem: „API i worker to dwa procesy startowane razem przez NSSM i oba
wołają `migrate()`".

### Wzorzec był już w repo, tylko nie u nas

Worker Sfery w C# pracuje tak od początku i mówi to wprost
(`sfera-worker/src/Db.cs`): otwiera bazę w trybie, który jej nie utworzy,
sprawdza obecność tabel i odmawia startu, gdy ich nie ma. Worker w Node był
jedynym procesem piszącym, który tej zasady nie dostał.

### Worker CZEKA, a nie odmawia

Jedna różnica wobec C# jest świadoma. Proces, który pada, NSSM podnosi
z powrotem — czyli odmowa startu byłaby pętlą restartów z wyboru, dokładnie tym
stanem, z którego wychodzimy. Worker wypisuje JEDNO zdanie o tym, na co czeka,
i próbuje dalej; gdy API zmigruje, wraca do pracy sam i mówi o tym drugim
zdaniem. Restart usługi nie jest do tego potrzebny.

Zdanie pada przy ZMIANIE stanu, nie co takt. Przy takcie rzędu sekundy druga
droga zapełniłaby dziennik kopiami — tę cenę repo już raz zapłaciło.

### Zrzeczenie się migracji jest jawne i nie da się go przegapić

`bezMigracji()` wywołane PO otwarciu bazy rzuca wyjątkiem, zamiast po cichu nie
zadziałać: proces myślałby wtedy, że nie migruje, a migracja już by przeszła.
Proces bez migracji nie wykonuje też `schema.sql` — na gotowej bazie byłby
niby-nieszkodliwy, ale na pustej założyłby pół schematu bez migracji.

Dostają je: worker, `npm run sonda`, `npm run inwentarz`, `npm run reconcile`.
**`seed` i `seed:scenariusze` migrują nadal** — one bazę BUDUJĄ. To nie wyjątek
od reguły, tylko jej druga strona: schemat zakłada ten, kto tworzy bazę.

### Reszta

Przebudowa pozycji zwrotu dostała brakujące sprawdzenie warunku pod blokadą
zapisu — miały je dwie inne przebudowy, ta nie. Migrujących procesów jest teraz
mniej, ale nie zero: `seed` potrafi chodzić przy żywym API.

**Poprawka błędu z 0.174.2:** procedura wychodzenia z awarii kazała odpytać
`localhost:3000`, a serwer stoi na 3001. Zły port w instrukcji ratunkowej to
najgorsze możliwe miejsce na literówkę.

Sześć nowych testów, każdy uruchamiany we WŁASNYM procesie, bo zrzeczenie się
migracji jest stanem modułu. Pięć z nich pada bez poprawki; szósty jest
kontrolą i ma przechodzić w obie strony — inaczej pierwszy nic by nie mierzył.

## 0.177.0 — 2 września 2026

**Login kupującego widać przy każdym zwrocie.** Zgłoszenie właściciela: „nie
widzę nigdzie w otwartym zwrocie loginu klienta".

Wiersz **Kupujący** rysował się tylko wtedy, gdy pole nie było puste. Przy
pustym znikał bez śladu — ekran nie mówił ani loginu, ani tego, że go nie ma.
Szuka się wtedy czegoś, czego nie widać, i nie wiadomo, czy to brak danych,
czy usterka panelu.

Puste pole miało zresztą swój własny powód. Allegro podaje login w DWÓCH
odpowiedziach: przy zwrocie (`CustomerReturn.buyer.login`) i przy zamówieniu
(`checkout-forms.buyer.login`). Oba synchronizatory go mapują, ale ekran
czytał wyłącznie pierwszy. Zwrot bez `buyer` — albo zaciągnięty przed
0.164.0, gdy tamtego mapowania jeszcze nie było — zostawał więc bez
kupującego, choć jego zamówienie leżało obok z wypełnioną kolumną.

Teraz login spada z zamówienia, gdy zwrot go nie niesie. Pierwszeństwo ma
zwrot, bo jest bliżej sprawy. Gdy nie ma go w żadnym z dwóch miejsc, ekran
mówi wprost „Allegro nie podało" — zgadywania nie ma. Login ma też przycisk
kopiowania, bo wkleja się go w wyszukiwanie Allegro.

Zysk nie kończy się na ekranie: po tym samym polu idzie kolumna „Kupujacy"
w eksporcie CSV zwrotów.

## 0.176.0 — 2 września 2026

**Cztery rzeczy z jednego ekranu zwrotu.** Właściciel przeszedł po nim palcem
i pokazał, co kłamie albo stoi nie tam, gdzie się go szuka.

### Wniosek o rabat złożony w panelu Allegro był niewidoczny

Zgłoszenie brzmiało: „rabat transakcyjny został zlecony przez panel allegro,
do tego zwrotu w appce nie widać". Ekran pisał **„brak wniosku"** i stawiał
obok przycisk ZGŁOŚ RABAT.

Przyczyna była w rozjeździe między odczytem a zapisem. Zapis
(`zlozWniosekORabat`) od 0.164.0 miał drugiego strażnika: gdy zwrot niesie
status `COMMISSION_REFUND_CLAIMED` albo `COMMISSION_REFUNDED`, Allegro samo
mówi, że prowizja jest już objęta wnioskiem. Odczyt (`stanRabatu`) tego
statusu **nie czytał wcale** — patrzył wyłącznie w nasze lustro
`allegro_rabat`, do którego wniosek z panelu Allegro trafia dopiero po
przewinięciu przez listę wniosków.

Panel obiecywał więc pracę, której serwer nie przyjmował: kliknięcie kończyło
się konfliktem, zawsze. Teraz oba źródła czyta jedno zdanie, a ekran mówi,
z którego wie. Ze statusu zwrotu nie znamy numeru wniosku ani kwoty prowizji
i ekran się do tego przyznaje. Lustro ma pierwszeństwo, bo wie więcej.

### Plakietka „wraca" niosła liczbę kupionych sztuk

„Wraca dwie sztuki jest mylące, bo w tym zamówieniu wracała jedna". Plakietka
mówiła sam FAKT powrotu, a stała obok liczby sztuk KUPIONYCH — więc czytało
się ją jako liczbę wracających. Teraz niesie sztuki wracające, a przy zwrocie
części zakupu dopisuje, ile z ilu: **wraca 1 z 2**. Przy zwrocie całości
dopisku nie ma, bo nic u klienta nie zostaje.

### Dokument sprzedaży wrócił do zamówienia

„Dokument sprzedaży powinien być w zamówieniu". Stał osobną sekcją na dnie
kolumny, pod wiadomościami, a w sekcji zamówienia stał wiersz **Dokument**
mówiący o czym innym — o tym, czy klient chciał faktury. Dwa razy to samo
słowo, dwa razy o czym innym, i „Dokument: nie wiadomo" tuż nad znalezionym
paragonem. Numer paragonu stoi teraz w zamówieniu, a wiersz nazywa się
**Klient chciał**.

### Kliknięcie w paragon a okno Subiekta

Pytanie właściciela: czy kliknięcie może otworzyć ten paragon w Subiekcie.
Nie z samego panelu — okno wystawia program na stanowisku, a przeglądarka nie
sięga do COM Subiekta. Wywołanie Sfery po stronie serwera otworzyłoby okno na
maszynie, której nikt nie ogląda. Co byłoby potrzebne, opisuje
`docs/architektura.md` §4: własny protokół w rejestrze Windows, mały program
lokalny i licencja Sfery na każdym biurku.

Do tego czasu numer dokumentu ma przycisk kopiowania. Wklejony w „Znajdź
dokument" Subiekta prowadzi do tego samego okna.

## 0.175.0 — 2 września 2026

**Dokument sprzedaży wiąże się sam, bo numer zamówienia czyta się z uwag.**
Właściciel pokazał paragon z Subiekta: w polu *Uwagi* stoi
`b9732a20-a621-11f1-8e66-3787b0f6d855 ; Client:143874145`, a kolumna numeru
obcego jest pusta. Tam — i tylko tam — Sellasist wpisuje identyfikator
zamówienia Allegro.

### Dlaczego automat nie wiązał nic

Mechanizm z 0.174.0 czytał wyłącznie `dok_NrPelnyOryg`. Skoro integracja jej
nie wypełnia, jedyny sygnał, który wiąże automatycznie, nie miał prawa
zadziałać ani razu — i każdy zwrot kończył na liście kandydatów „wskaż
właściwy", nawet gdy dokument był oczywisty.

### Uwag nie kopiujemy — wycinamy z nich UUID w SQL

0.174.0 celowo nie czytało `dok_Uwagi`: to pięćset znaków wolnego tekstu,
w które ktoś kiedyś wpisze adres albo telefon, a read-model idzie do kopii
zapasowych. **Ta decyzja stoi.** Kolumna dalej nie jest kopiowana. Z uwag
wycinany jest po stronie serwera Subiekta — `PATINDEX` i `SUBSTRING` —
wyłącznie ciąg o kształcie UUID-a: 36 znaków szesnastkowych z myślnikami
w ustalonych miejscach. Wolny tekst nie opuszcza bazy firmy. Po naszej stronie
stoi druga zapora: wynik przechodzi jeszcze raz przez sprawdzenie kształtu,
zanim trafi do bazy.

Ustawienie `MSSQL_SPRZEDAZ_UWAGI_COLUMN` nie wraca — ono kopiowało całą
kolumnę. To jest inna rzecz.

Brak dostępu do `dok_Uwagi` (kolumna albo uprawnienie) degraduje, nie
przerywa: import idzie dalej bez tej drogi, a `/api/health` mówi zdaniem, że
automat nie ma czym wiązać. Obie kolumny numeru są opcjonalne z osobna —
brak jednej nie zabiera drugiej.

### Paragon sprzed dnia zakupu przestaje być kandydatem

Ten sam zrzut ekranu pokazał drugą rzecz: zamówienie kupione 17.08, a wśród
kandydatów paragony z 13.08 i 23.07. Okno liczyło się wyłącznie od daty
ZWROTU, sześćdziesiąt dni wstecz. Data zakupu leżała w bazie obok
(`zamowienie_klienta.kupiono_at`) i ekran ją pokazywał — tylko dopasowanie jej
nie czytało. Teraz dolna granica okna to późniejsza z dwóch dat: sześćdziesiąt
dni przed zwrotem albo dzień przed zakupem. Dzień luzu, bo zakup jest chwilą
w UTC, a data dokumentu datą lokalną Subiekta.

Na zrzucie z pytania zostałyby dwa kandydaty zamiast czterech — a z numerem
z uwag zostałby jeden i związał się sam.

### Testy

Pięć nowych dla dopasowania, pięć dla wycinania UUID-a. Wśród nich dokładny
napis z pola *Uwagi* ze zrzutu: przechodzi z niego sam identyfikator, numer
klienta po średniku zostaje w Subiekcie. Adres i telefon nie przechodzą.

Wdrożenie: nic ręką. Kolumna `zamowienie_z_uwag` dochodzi migracją, a numer
z uwag wchodzi przy najbliższym imporcie z Subiekta. Konto `wertis` ma już
`SELECT` na `dok__Dokument`, więc nowego grantu nie potrzebuje.

## 0.174.2 — 2 września 2026

**Awaria produkcyjna: instalacja nie wstawała wcale.** API i worker padały
w kółko, restartowane przez NSSM. W logu workera zostawało „database is
locked" — objaw, nie przyczyna. Przyczyna stała w logu API:

```
Error: UNIQUE constraint failed: zwrot_klienta_pozycja.zwrot_id, …klucz
    at migrate (dist/db/db.js) → at db() → at main()
```

`db()` woła `migrate()` w KAŻDYM procesie, więc wyjątek w migracji kładł
oba naraz. Worker nie mógł się dobić do bazy, bo API właśnie ją przemielało
w pętli restartów.

### Ta sama rodzina błędu co 0.162.1, o oczko dalej

0.162.1 dołożyło powtórzonej parze `offer_id|nazwa` przyrostek `|#n`
i to załatwiło duplikaty WPROST. Nie załatwiło ZDERZENIA: pozycja, której
NAZWA niesie już tekst `|#2`, dostaje klucz identyczny z drugim wystąpieniem
sąsiada. Indeks UNIQUE odrzucał go po przemianowaniu tabeli, transakcja się
wycofywała, a start padał — przy każdym uruchomieniu, bez wyjścia.

**Klucza nie liczymy odtąd „mądrzej".** Wyliczenie zostaje takie samo, bo do
klucza przywiązana jest praca człowieka: ocena hali, kartoteka, zaznaczenie
kwoty. Przeliczenie wszystkiego zerwałoby ją w bazach już zmigrowanych.

Zamiast tego indeks UNIQUE zakłada się DOPIERO po rozplątaniu duplikatów.
Duplikat, który mimo wszystko powstał, dostaje przyrostek z `id` — a `id`
jest unikalne z definicji, więc druga taka kolizja nie ma z czego powstać.
Rozplatanie chodzi w pętli, bo naprawiony klucz teoretycznie może trafić
w kolejny zastany, i melduje się w logu: to zmiana danych, której nikt nie
zlecił.

Ta sama ochrona stoi też na ścieżce SAMEGO indeksu, nie tylko w przebudowie.
Baza z przebudową za sobą wchodzi tamtędy, a duplikat mógł do niej trafić
zapisem aplikacji, zanim indeks w ogóle powstał.

### Skąd brały się takie nazwy — błąd z 0.172.0

Rejestracja paczki nieodebranej liczyła przyrostek klucza po NUMERZE WIERSZA
z pętli, nie po powtórzeniu. Druga pozycja zamówienia dostawała więc `|#2`,
choć niczego nie powtarzała. Taki napis w kluczu jest dokładnie tym, co
zderza się w migracji z prawdziwym duplikatem sąsiada. Poprawione: przyrostek
liczy powtórzenia pary `offer_id|nazwa`.

### Testy

Dwa nowe testy migracji i jeden serwisu. Wszystkie trzy **padają bez
poprawki** — sprawdzone, bo test regresji, który przechodzi na zepsutym
kodzie, jest gorszy niż jego brak.

**[wymaga działania]** Zatrzymaj usługi, zrób kopię bazy, zaktualizuj,
uruchom API RĘCZNIE i przeczytaj log. Krok po kroku w DEPLOY §7.

## 0.174.1 — 2 września 2026

**`tools/co_w_toku.sh` widzi otwarte PR-y i numery, które już zajmują.**

Do tego wydania skrypt kończył się zdaniem „otwarte PR-y sprawdź narzędziami
GitHuba — ten skrypt ich nie widzi". Właśnie dlatego nikt ich nie sprawdzał:
instrukcja bez wykonania jest kosztem, a nie pomocą.

Rachunek jest policzalny. Numer wydania zderzył się z cudzą gałęzią cztery razy
w jeden dzień — 0.166.0, 0.168.0, 0.171.0 i 0.173.0 — za każdym razem po tym,
jak numer trafił już do komentarzy w kodzie. Każde przenumerowanie to kilkanaście
plików i jedna okazja, żeby przy okazji ruszyć cudzy komentarz. Raz się to
zdarzyło.

Gałąź z commitami spoza `main` mówi „ktoś tu pracuje". Otwarty PR mówi więcej:
ktoś to ZAMYKA i zaraz zajmie numer.

Skrypt wypisuje teraz numer PR-a, tytuł, gałąź i to, czy jest szkicem. Pod listą
stoi wiersz „Numery zajęte przez otwarte PR-y", a numer nazwany w CUDZYM PR-ze
i wpisany zarazem w lokalne `package.json` podnosi głośne ostrzeżenie. Własna
gałąź go nie podnosi — ostrzeżenie przed samym sobą uczy ignorować ostrzeżenia.

`gh` jest OPCJONALNE i to jest warunek, nie wygoda. Skrypt NIGDY nie kończy się
błędem, więc brak `gh`, zerwana sieć i wygasły token dają zdanie o tym, czego
nie wiadomo, i kod wyjścia zero. Wywołanie chodzi pod `timeout 10`, bo hak
`SessionStart` nie ma prawa wisieć na cudzym narzędziu.

`CLAUDE.md` mówi teraz wprost, żeby **numer wydania wybierać przy commicie**,
a nie przy pisaniu kodu.

## 0.174.0 — 2 września 2026

**Przy zwrocie widać numer dokumentu sprzedaży z Subiekta.** Ostatnia pozycja
z listy biura zwrotów: „widoczny numer paragonu". Decyzja właściciela:
„wskrzesić read-model sprzedaży z Subiekta".

### Po tym numerze wystawia się korektę

Pracownik szukał go w Subiekcie ręcznie — po dacie i nazwisku, bo nic innego
nie miał. Read-model dokumentów sprzedaży istniał do 0.140.0 i odszedł razem
z rejestrem zwrotów. Kolejka zwrotów odbudowana od 0.150.0 potrzebuje go
z powrotem.

Wraca pod NOWĄ nazwą — `sgt_faktura`, nie `sgt_sprzedaz`. Ta druga jest spalona
na zawsze: stoi na liście kasowania, która chodzi przy KAŻDEJ migracji. Tabela
nazwana tak samo powstałaby ze `schema.sql` i znikała sekundę później, po cichu
i bez błędu. Pilnuje tego osobny test migracji.

### Automat wiąże wyłącznie pewność

Sygnałem rozstrzygającym jest numer zamówienia stojący NA dokumencie. Jeden
taki dokument wiąże się sam, w takcie synchronizacji; dwa to spór, nie
trafienie, i zostają dla człowieka.

**Nakładka pozycji nie wiąże nigdy.** Firma ogrodnicza sprzedaje ten sam
sekator dziesięć razy dziennie, więc „wszystkie zwracane towary są na tym
dokumencie" bywa prawdą o kilkunastu dokumentach naraz. To poszlaka: kandydat
z nią trafia na listę, ale wskazuje człowiek. Ta sama doktryna co przy
sygnaturze w 0.169.0 — powiązanie prowadzi do korekty, a zła korekta idzie do
cudzej sprzedaży.

Kandydat pokazuje SWÓJ powód, nie sam numer. Po wybraniu widać pochodzenie:
automat mówi „numer zamówienia stoi na tym dokumencie", a wskazanie ręczne
podpisuje się imieniem. Zdjęcie powiązania to droga wyjścia z pomyłki.

### Arytmetyka, która unieważniła stare założenie

`dok_NrPelnyOryg` jest kolumną varchar(30). Identyfikator zamówienia Allegro to
UUID o 36 znakach. **Cały numer się tam nie mieści** i nie trzeba tego
sprawdzać na bazie — wystarczy odjąć.

Wersja z 0.53.0 szukała w tej kolumnie całego numeru, więc ten sygnał nie miał
prawa zadziałać ani razu. Teraz dopasowanie uznaje dwie drogi: numer zawarty
w numerze obcym albo numer obcy będący jego początkiem uciętym dokładnie do
trzydziestu znaków. Krótszego prefiksu nie uznajemy — „1234" pasowałoby do co
drugiego dokumentu w oknie.

### Read-model bierze cztery kolumny i ani jednej więcej

Identyfikator, typ, numer pełny, numer obcy i data. Nie ma `kh_Symbol`, bo przy
sprzedaży konsumenckiej bywa w nim imię i nazwisko człowieka — polityka danych
zwrotów dopuszcza wprost sam login kupującego. Nie ma `dok_Uwagi`: pięćset
znaków dowolnego tekstu, w które ktoś kiedyś wpisze adres albo telefon.

Stary model kopiował oba te pola i punktował kontrahenta przeciw loginowi
kupującego. Wskrzeszenie nie jest przywróceniem.

### Reszta

Numer stoi przy zwrocie SNAPSHOTEM: read-model czyści się przy każdym imporcie,
a dokument wypada z okna po dwóch miesiącach — powiązanie musi przeżyć własne
źródło. Wchodzi też do eksportu CSV, osobną kolumną. Trasa
`POST /api/obsluga/zwroty/:id/faktura` podnosi umowę tras zapisujących do
trzynastu; obie mutacje piszą do dziennika.

Dwa zdania w `/api/health` osierocone w 0.140.0 wracają do swoich wartości:
brak kolumny numeru obcego i awaria odczytu sprzedaży. Odczyt DEGRADUJE, nie
przerywa importu — stany i lokalizacje są pracą hali, a numer faktury wygodą
biura.

**[wymaga działania]** Nic, jeśli zostawisz domyślne. `DOK_SPRZEDAZ_DNI_WSTECZ`
(60 dni) i `MSSQL_SPRZEDAZ_NR_ORYG_COLUMN` (`dok_NrPelnyOryg`) wracają do
`wertis.env` i działają bez wpisywania. Warto sprawdzić na własnej bazie, czy
integracja tę kolumnę wypełnia — zapytanie stoi w DEPLOY §6.
`MSSQL_SPRZEDAZ_UWAGI_COLUMN` nie wraca i nie wróci.

## 0.173.0 — 2 września 2026

**Odpowiadanie w wiadomościach Allegro nie było wyłączone — było opisane
nieprawdą i wysyłane niezadeklarowanym typem treści.**

Prośba właściciela brzmiała „aktywuj odpowiadanie w wiadomości Allegro".
Włączać nie było czego: wysyłka działa od 0.148.0 i jest podpięta na całej
drodze — przycisk w panelu, `POST /api/conversations/:id/send`, kolejka
`outbox` z kluczem idempotencji, `POST /messaging/threads/{id}/messages`.
Znalazły się za to dwie rzeczy, które kazałyby każdemu myśleć inaczej.

### Ekran twierdził, że wysyłka jest wyłączona

`/api/health` oddawał stałą `"wysyłka wyłączona"` wpisaną na sztywno. Zdanie
było prawdziwe, gdy powstawało — mechanizmu wtedy nie było. Od 0.148.0 mówiło
coś przeciwnego do tego, co robi kod, a od 0.168.0 stało na ekranie ustawień,
w karcie stanu integracji.

To gorszy rodzaj błędu niż brak wskaźnika. Brak każe szukać; napis
„wyłączona" każe NIE szukać i prowadzi wprost do wniosku „trzeba to włączyć".

Teraz pole opisuje stan kolejki: ile poszło, ile jest w toku, ile nieudanych
i niepewnych. Osobna liczba `wysylkiDoSprawdzenia` mówi, ile z tego czeka na
człowieka — nieudana wysyłka znaczy, że odpowiedź NIE dotarła do klienta,
a niepewna, że nie wiadomo. Wiersz w panelu zmienia wtedy rangę na uwagę,
bo zasada 10 projektu żąda, żeby awaria integracji była widoczna.

### Ciało żądania szło typem, którego specyfikacja nie wymienia

`zapytajAllegro` deklarował `content-type: application/json`. Specyfikacja
wymienia przy `POST /messaging/threads/{id}/messages` dwa typy —
`application/vnd.allegro.public.v1+json` i `…beta.v1+json` — a przy wniosku
o rabat tylko pierwszy. Gołego `application/json` nie ma tam ani razu;
odpowiedzią na niezadeklarowany typ treści bywa 415.

Klient wysyła teraz w `content-type` tę samą wersję zasobu, którą negocjuje
w `accept`, a 415 traktuje jak 406: próbuje następnej. To jest ta sama klasa
pomyłki, która przy mapowaniu ODCZYTU kosztowała trzy wydania — kształt wzięty
z pamięci zamiast z pliku, który leży w repo.

Pilnuje tego pierwszy test tej funkcji z podstawionym `fetch`. Do 0.172.0
sprawdzaliśmy budowę adresów i obsługę błędów, ale nigdy tego, CO NAPRAWDĘ
wychodzi na sieć.

### Przy okazji, ze specyfikacji

Uprawnienie do pisania jest to samo co do czytania (`allegro:api:messaging`),
więc konto czytające wiadomości ma czym odpisywać i nie wymaga ponownego
parowania. Sama końcówka ma natomiast limit **jednego żądania na sekundę dla
użytkownika**. Odpowiedzi pisze człowiek, więc limit nie dotyka pracy biura —
ale to pierwsza liczba do sprawdzenia przy każdym pomyśle na wysyłkę masową.

Wdrożenie: nic ręką.

## 0.172.0 — 2 września 2026

**Paczka, której klient nie odebrał, wchodzi do kolejki jawnie oznaczona.**
Przedostatnia pozycja z listy biura zwrotów: „żeby skanowały się nieodebrane
paczki". Decyzja właściciela: „do tych paczek też wykonujemy zwrot pieniędzy,
oznacz, że jest to nieodebrana paczka, a nie świadomy zwrot klienta".

### Allegro takiego zdarzenia nie zna

`CustomerReturn` powstaje wyłącznie ze ZGŁOSZENIA klienta. Przesyłka
nieodebrana wraca sama, po dwóch awizach, i zwrotem po tamtej stronie nigdy
nie zostanie. Skan takiej etykiety nie trafiał więc w nic, a „Poszukaj
w Allegro" prowadziło donikąd — bo szukać nie było czego.

Pieniądze klientowi i tak trzeba oddać. Karton leżał dotąd poza panelem,
z kartką przy monitorze.

### Druga droga wyjścia z nieznanego kodu

Ekran nietrafionego skanu dostaje obok „Poszukaj w Allegro" przycisk „To
nieodebrana paczka". Pytanie do Allegro zostaje pierwsze, bo paczka bywa
u nas szybciej niż synchronizacja i większość nietrafionych skanów to zwykły
wyścig, nie nowy byt.

Rejestracja pyta o numer zamówienia i notatkę. Numer jest OPCJONALNY, ale za
niego są pozycje: podany przepisuje pozycje zamówienia do zwrotu, więc jest co
ocenić i co wycenić. Ekran mówi to wprost przy polu, zamiast zostawiać wybór
bez skutku. Bez numeru zostaje pusty uchwyt na paczkę — dalej lepszy niż
kartka.

### Oznaczenie jest jawne i widać je wszędzie

Kolumna `zwrot_klienta.zrodlo` przyjmuje `allegro` albo `nieodebrana`. Plakietka
stoi w kolejce, w nagłówku zwrotu i w nowej kolumnie eksportu CSV, a pod
nagłówkiem stoi zdanie „Klient nie zgłosił zwrotu — przesyłka wróciła
nieodebrana".

Bez tego biuro liczyłoby świadome odstąpienia razem z nieodebranymi i nie
miałoby jak ich rozdzielić. To dwie różne rozmowy z klientem i dwa różne
wnioski o tym, co się dzieje ze sprzedażą.

Odnośnika do panelu sprzedawcy taki wiersz nie dostaje. Prowadziłby na stronę
zwrotu, którego po tamtej stronie nie ma.

### Numer listu stoi w modelu pracy — świadomy wyjątek

Polityka z 0.163.0 mówi, że numeru listu nie zapisujemy: przy zwrocie z Allegro
szuka się go w kopii odpowiedzi w lądowisku. Paczka nieodebrana żadnej kopii
nie ma i mieć nie będzie, więc numer jest jedynym uchwytem, po którym operator
zeskanuje ten sam karton drugi raz.

Wyjątek jest wąski: kolumna wypełnia się tylko dla `zrodlo='nieodebrana'`,
wpisuje ją człowiek ze skanu, a eksport CSV jej nie niesie. Zapisano go
w `docs/obsluga-klienta.md` i w `docs/allegro-ksztalt.md`, żeby następne
czytanie tamtych zdań nie wyglądało na złamaną obietnicę.

### Reszta

Skan szuka teraz także po kolumnie `waybill` — inaczej zarejestrowana paczka
nie otwierałaby się z tej samej etykiety, z której powstała. Trasa
`POST /api/obsluga/zwroty/nieodebrana` podnosi umowę tras zapisujących do
dwunastu; rejestracja pisze `zwrot_nieodebrana` do dziennika, jak każda mutacja.
Duplikat numeru listu jest odmawiany, bo dwa wiersze na jedną paczkę znaczą
dwa zwroty pieniędzy.

## 0.171.0 — 2 września 2026

**Sygnatura wiąże kartotekę sama, a ekran ustawień mówi, ile wiąże.** Dwie
decyzje właściciela: „wiąż zamówienia z Allegro z Subiektem po sygnaturze"
i „zrób, abym nie musiał zatwierdzać kartotek".

### Wiązanie działało od 0.152.0 — brakowało dwóch rzeczy

Sygnatura oferty (`offer.external.id`, pole „Sygnatura" w edycji przedmiotu)
ląduje w `zamowienie_klienta_pozycja.sku` od 0.152.0, a `kartotekaPoSku` szuka
po niej symbolu w kartotece Subiekta. Brakowało czego innego. Po pierwsze,
wynik był **propozycją do kliknięcia** — nawet gdy sygnatura wskazywała
dokładnie jedną kartotekę i nie było czego rozstrzygać. Po drugie, **nikt nie
widział skuteczności**: wynik pokazywał się przy pojedynczej pozycji zwrotu
i tylko wtedy, gdy kartoteki jeszcze nie było.

### Pewne trafienie wiąże się samo

Pozycja zwrotu, której sygnatura wskazuje **dokładnie jedną** kartotekę,
wiąże się bez kliknięcia. W `tw_zrodlo` zostaje `sku`, więc dalej widać, że
zrobił to automat, a nie człowiek; w audycie podpisuje się jako
`automat (sygnatura)`.

Wiąże się WYŁĄCZNIE ta jedna pewność i to nie jest ostrożność na zapas.
Dopasowanie po jedynej pozycji zamówienia albo po nazwie jest ZGADYWANIEM,
a powiązanie prowadzi do korekty stanu w Subiekcie — pomyłka wraca towarem na
złej półce, nie czerwonym napisem na ekranie. Symbol zdublowany nie wiąże się
nigdy, bo dwie kartoteki o tym samym symbolu to spór, nie trafienie.

Pamięć wcześniejszych wskazań (`oferta_kartoteka`) zostaje nietknięta: znaczy
„wskazał to człowiek" i jest przy dopasowaniu mocniejsza od automatu. Wpis od
automatu podszyłby się pod tamtą decyzję i nadpisał cudze imię.

Wiązanie idzie z TAKTU synchronizacji i z przycisku „dociągnij zamówienia",
nigdy z otwarcia ekranu — „zero zapisu przy patrzeniu" obowiązuje też tutaj.
Dwa takty, bo zamówienie dochodzi zwykle PO zwrocie i dopiero ono niesie
sygnaturę. Człowiek zachowuje ostatnie słowo: wskazanie ręczne nadpisuje
automat, a zdjęcie powiązania kasuje je razem z pamięcią.

### Ekran ustawień pokazuje pokrycie

Nowa karta „Sygnatura → kartoteka Subiekta" na `/obsluga/ustawienia`: ile jest
pozycji zamówień, ile ma sygnaturę, ile wiąże się samo, ile jest różnych
sygnatur. Pod spodem dwie listy, osobno, bo to dwie różne naprawy — sygnatury
bez kartoteki (literówka w Allegro albo brak kartoteki) i symbole zdublowane
w Subiekcie (porządek w kartotekach).

Raport liczy DOKŁADNIE to, co wiąże automat: symbol zdublowany nie jest
trafieniem. Pilnuje tego test porównujący wynik wiersz po wierszu
z `kartotekaPoSku` — raport obiecujący pokrycie, którego nie ma, byłby gorszy
od braku raportu.

Wdrożenie: nic ręką. Pozycje zwrotów czekające dziś na zatwierdzenie powiążą
się przy najbliższym przebiegu synchronizacji.

## 0.170.0 — 2 września 2026

**Za towar, który wrócił używany, da się oddać mniej.**

Do tego wydania kwota była BINARNA per pozycja: cała cena albo nic. Operator
wyceniający zwrot mógł zaznaczyć pozycję albo jej nie zaznaczyć, a trzeciej
drogi nie było — mimo że towar wracający zniszczony to codzienność biura.
Druga pozycja z listy pracownika od zwrotów.

### Kwota, nie procent

Decyzja właściciela. Klient widzi złotówki, a procent przy każdej pozycji
zostawiałby końcówki, których nikt nie umie wytłumaczyć.

**Powód jest obowiązkowy** i pilnuje go najpierw pole, potem serwer. To jego
treść tłumaczy klientowi, czemu dostał mniej — potrącenie bez uzasadnienia
byłoby liczbą, której nie da się obronić. Razem z kwotą i powodem zapisuje się
autor i czas, a cofnięcie zdejmuje wszystko naraz.

### Reguła o cudzych pieniądzach zostaje nienaruszona

§25a.3 mówi, że sumę liczy serwer, bo panel przysyłający gotową kwotę pozwalałby
oddać dowolną liczbę żądaniem z pominięciem ekranu. Ta zasada nie ustąpiła:
panel dalej przysyła ZAZNACZENIE, a potrącenie jest **osobnym zapisem przy
pozycji**, nie liczbą doklejaną do sumy.

Ta jedna trasa przyjmuje więc od panelu liczbę o pieniądzach — i jako jedyna
trzyma ją w widełkach `0…cena × ilość`. Potrącenie większe niż wartość pozycji
znaczyłoby, że klient dopłaca nam za własny zwrot; ekran zatrzymuje to u siebie,
a serwer odmawia drugi raz.

Licznik tras zapisu rośnie do jedenastu.

### Gdzie to stoi

Formularz otwiera się dopiero na żądanie, jak ręczne wskazanie kartoteki:
typowy zwrot wraca w porządku, a pole pod każdą pozycją byłoby ścianą pytań
o wyjątek. Propozycja pojawia się w kubełku DO ZWROTU, bo tam zapada decyzja
o pieniądzach.

Zapisane potrącenie widać w KAŻDYM kubełku — to fakt o pozycji, jak ocena hali.
Po zamknięciu zwrotu trzeba umieć powiedzieć, czemu klient dostał mniej. Wchodzi
też do zestawienia CSV, razem z powodem.

### Przy wdrożeniu

Nic. Migracja dokłada cztery kolumny i chodzi sama przy starcie.

---


## 0.169.0 — 2 września 2026

**Dziesięć rzeczy z listy biura zwrotów — wszystkie z danych, które już mamy.**

Pracownik od zwrotów przysłał listę osiemnastu życzeń. Po analizie okazało się,
że większość z nich Allegro przysyła od początku, a nasze mapowanie po prostu
je wyrzucało. To wydanie podnosi je z podłogi.

### Kupujący, przewoźnik, płatność, dokument

Login kupującego stoi teraz PRZY ZWROCIE, nie tylko przy zamówieniu: zwrot
niesie go zawsze, a zamówienie bywa jeszcze niepobrane. Przewoźnik idzie z tej
samej paczki, co data — inaczej zwrot w dwóch przesyłkach pokazywałby datę
jednej, a firmę drugiej. Nieznanego przewoźnika pokazujemy surowo, bo Allegro
nie publikuje zamkniętej listy: sonda złapała `UNKNOWN`, którego nie ma
w żadnej specyfikacji.

Przy zamówieniu doszła forma płatności i rodzaj dokumentu. To przy zwrocie nie
ciekawostka: przy pobraniu nie ma karty, na którą oddać pieniądze. Z faktury
bierzemy SAMĄ FLAGĘ — jej adres niesie ulicę i miasto, a adresy nie przechodzą
przez mapowanie. Brak informacji pokazuje się jako „nie wiadomo", bo paragon
wpisany na ślepo kazałby wystawić niewłaściwą korektę.

### Kody towaru i siedemnaście powodów

Wiersz produktu dostał EAN i SKU. EAN wisi przy KARTOTECE i pojawia się dopiero
po jej potwierdzeniu — Allegro nie podaje go przy zwrocie wcale (jest tylko
w One Fulfillment, którego ta firma nie używa). SKU idzie z pozycji ZAMÓWIENIA,
bo pozycja zwrotu własnego nie ma.

Powodów zwrotu tłumaczymy siedemnaście zamiast jedenastu. Tyle wymienia schemat;
jedenaście to te, które zaobserwowała sonda, a pozostałe sześć szło na ekran
surowym kodem.

### Ekran przestał nazywać datę nadania powrotem towaru

Przy paczce stało „Wróciła 1.09.2026" i to była nieprawda: Allegro podaje datę
UTWORZENIA paczki przez klienta, a daty doręczenia do nas nie podaje w obiekcie
zwrotu wcale. Teraz ekran pisze „Nadana przez klienta" i mówi wprost, czego nie
wie. Sygnał kolejki zmienił się z tego samego powodu: „nie nadana" zamiast
„bez paczki".

### Wiadomości o tym zakupie

Prawa kolumna pokazuje rozmowy dotyczące tego samego zamówienia, z odnośnikiem
do skrzynki. Mostkiem jest numer zamówienia przy wiadomości, mapowany od
0.166.0 — ani jednego nowego żądania do Allegro.

Pusty wynik mówi „Allegro nie powiązało z tym zamówieniem żadnej wiadomości",
a nie „klient nie pisał". Allegro oznacza zamówieniem tylko część wiadomości,
więc klient piszący z poziomu oferty tym mostkiem się nie znajdzie — i lepiej,
żeby ekran to powiedział, niż udawał pewność.

### Lista, filtry, Excel

Siódma zakładka WSZYSTKIE jest do SZUKANIA, nie do pracy: kubełki zostają
silnikiem, bo rejestr mieszający jedno z drugim skasowaliśmy w 0.140.0. Doszedł
filtr przewoźnika — budowany z tego, co przyjechało, nie ze słownika — oraz
przełącznik kolejności po dacie nadania. Domyślna kolejność zostaje po zegarze
ustawowym, bo to termin steruje pracą (blizna 0.121.0).

Eksport CSV ma separator `;`, żeby Excel PL otwierał plik bez kreatora importu,
i jeden wiersz na POZYCJĘ, bo w Excelu liczy się towary. Numeru listu
przewozowego w nim nie ma. Trasa jest jedynym GET-em zwrotów, który zostawia
ślad w dzienniku, i to jest świadome: umowa „odczyt niczego nie zapisuje" mówi
o PATRZENIU, a wyniesienie pliku z loginami kupujących na dysk patrzeniem nie
jest.

### Przy wdrożeniu

Nic. Migracja dokłada pięć kolumn i chodzi sama przy starcie.

---


## 0.168.0 — 2 września 2026

**Stan integracji schodzi ze Skrzynki za zębatkę.** Decyzja właściciela.
Panel obsługi dostaje pierwszy ekran ustawień — `/obsluga/ustawienia` — i tam
przenosi się trzynastowierszowa tabela z `/api/health`.

Skrzynka jest ekranem PRACY: kolejka rozmów po lewej, odpowiedź po prawej.
Tabela opisuje TŁO tej pracy i czyta się ją raz na tydzień, a pion pod kolejką
zabierała na każdym otwarciu ekranu. To ten sam podział, który biuro ma
od 0.76.0: praca na pasku, konfiguracja za zębatką.

### Co zostaje na wierzchu

Pigułka synchronizacji w nagłówku, widoczna z każdej zakładki, oraz trwały
alarm nad kolejką rozmów. Zasada 10 projektu panelu brzmi „awaria integracji
musi być widoczna", a §21 żąda trwałego alarmu — za zębatkę schodzi TABELA,
nie ostrzeżenie. Skrzynka stała już raz 62 przebiegi (0.152.0), bo powodu nie
było gdzie zobaczyć, i drugi raz tego nie kupujemy.

Zębatka stoi POZA paskiem zakładek, tak samo jak w biurze. Pasek niesie cztery
kolejki pracy, do których agent wraca w kółko; ustawienia otwiera się razy
kilka w miesiącu i piąta pastylka ważyłaby w rzędzie tyle samo co Skrzynka.

Ekran ma dziś jedną kartę i to jest w porządku — USTAWIENIA w biurze zaczynały
tak samo. Miejsce już jest, więc następne ustawienie obsługi trafi tam, zamiast
dokładać się do ekranu pracy.

### Skąd numer

`0.167.0` nazwała wcześniej gałąź zwrotów i to ona weszła pod tym numerem.
Numery przydzielamy raz — dwa wydania o tym samym numerze kosztowały już
osobne scalenie (0.159.0).

Wdrożenie: nic ręką. Nowy ekran wchodzi razem z buildem panelu.

## 0.167.0 — 2 września 2026

**Produkty ze zwrotu przenoszą się do głównego okna, razem z decyzją o nich.**

Prośba właściciela: „produkty ze zwrotu powinny być w środkowym głównym oknie".

### 340 px to za mało na nazwę towaru

Pozycje stały w prawej kolumnie, szerokiej na 340 px. Nazwy ucinały się
w połowie — „Podkaszarka elektry…", „Nożyce do żywopłotu…" — zdjęcia miały
56 px, a środek ekranu, najszerszy z trzech, świecił pustką pod paskiem
decyzji. Teraz środek niesie towar: pełne nazwy, zdjęcia 72 px, powód zwrotu,
kartoteka i rabat.

Prawa kolumna została kolumną dowodów o ZWROCIE, nie o towarze: zegar
ustawowy, numery i odnośniki, zamówienie klienta, fakt powrotu paczki.

### Ocena i wycena zeszły na wiersz produktu

To jest właściwa treść tej zmiany. Kubełki DO OCENY i DO ZWROTU wypisywały
te same pozycje DRUGI RAZ, jako gołe nazwy z przyciskami — bez zdjęcia, bez
powodu zwrotu, bez kartoteki. Operator oceniał towar, patrząc na listę, która
towaru nie pokazywała, a właściwy widok miał w drugiej kolumnie.

Teraz jest jeden wiersz produktu, a na nim przycisk oceny albo pole
zaznaczenia. Pasek decyzji zostaje przy tym, co dotyczy CAŁEGO zwrotu:
werdykt, numer korekty, cofnięcie. W kubełkach pozycyjnych paska nie ma wcale.

Pasek nie przewija się razem z listą: decyzja o zwrocie ma być pod ręką także
wtedy, gdy operator zjechał na dziewiątą pozycję.

### Dwie liczby o pieniądzach nie stają jedna nad drugą

Przy wycenie znika „Suma pozycji" — zostaje sama kwota do oddania, ta, która
idzie do klienta. Dwie liczby jedna nad drugą czytają się jak jedna, a mylenie
ich kosztuje cudze pieniądze. W pozostałych kubełkach jest odwrotnie: suma
pozycji i kwota z dostawą, bo nie ma tam czego zaznaczać.

### Przy wdrożeniu

Nic. Zmiana jest w samym panelu obsługi.

---


## 0.166.0 — 2 września 2026

**Kolejka pokazuje pytanie klienta, a rozmowa wie, którego zamówienia dotyczy.**

Dwa zgłoszenia właściciela z jednego ekranu, oba ze zrzutów.

### W kolejce stała nasza autoodpowiedź zamiast pytania

Podgląd wiersza brał ostatnią wiadomość JAKĄKOLWIEK. Autoodpowiedź konta
Allegro („Dziękujemy za kontakt…") nie powstaje u nas — wjeżdża synchronizacją
jako zwykła wiadomość wychodząca i zasłaniała pytanie. W bazie nie ma flagi
automatu: autoresponder i odpowiedź agenta wyglądają identycznie, więc jedynym
pewnym filtrem jest kierunek. Podgląd to od dziś ostatnia wiadomość klienta,
a data pod nim — data TEJ wiadomości, nie data wątku z Allegro.

Gdy klient nic nie napisał, stoi nasza wiadomość z podpisem „Biuro". Kolejność
listy dalej niesie datę wątku, czyli tę samą, co panel sprzedawcy.

Test serwisu asertował dotąd wiadomość wychodzącą jako podgląd — utrwalał
usterkę. Dostał nowe oczekiwanie i komentarz, dlaczego stare było złe.

### Zamówienie z `relatesTo.order` wjeżdża do modelu

Mail Allegro „Wiadomość dotyczy" pokazuje towar; panel nie mówił o zamówieniu
wcale. Allegro daje `relatesTo` z dwiema niezależnymi gałęziami, `offer`
i `order`, a synchronizator mapował tylko pierwszą. Sonda z 2 września liczy
zamówienie w 7 z 33 wiadomości, ofertę w 5 z 33 — częstsze powiązanie było
wyrzucane.

Numer idzie do osobnej kolumny `message.related_order_id`, bo wiadomość może
nieść obie gałęzie naraz. Stare wiadomości nie przyjadą drugi raz, ale numer
został w surowym lądowisku — migracja dosypuje go stamtąd raz, bez nadpisywania
i bez zatrzymywania startu.

Treść zamówienia dociąga istniejący ticker zamówień: do kandydatów ze zwrotów
dochodzą numery z wiadomości, ten sam limit i takt. Otwarcie ekranu niczego nie
pobiera — „zero zapisu przy patrzeniu" obowiązuje, a liczniki tras skrzynki
stoją bez zmian. Rozmowa dostaje blok zamówienia pod sprawą: numer z odnośnikiem
od razu, pozycje z nazwą i ceną po dociągnięciu, a przed nim zdanie, że treść
dopiero przyjedzie.

Oferta przy wiadomości dostaje nazwę towaru — z zamówienia, nie z oferty, bo
ofert nadal nie pobieramy. Rozmowa z numerem zamówienia nie pokazuje już bloku
„brak powiązania z ofertą": zamówienie nazywa towar dokładniej.

Mapowanie wiersza zamówienia na kształt dla panelu wyjechało ze zwrotów do
`services/zamowienia.ts`, bo to samo zamówienie pokazują teraz dwa ekrany.

## 0.165.0 — 2 września 2026

**Panel trzyma się okna, a zwrot da się znaleźć po kawałku numeru.**

Dwie prośby właściciela o tym samym: o zwrotach, których zrobiło się za dużo
na jeden ekran.

### Przewijają się kolumny, nie strona

Ekran zwrotów rósł do wysokości najwyższej kolumny — a najwyższa jest zawsze
kolumna dowodów. Przewijał się więc dokument, czyli wszystkie trzy kolumny
naraz: żeby dojść do dołu dowodów, operator zjeżdżał z oczu kolejce i paskowi
decyzji. Karty miały `overflow-hidden`, ale to samo przycięcie rogów — bez
limitu wysokości nie tworzy obszaru przewijania.

Wzorca nie trzeba było wymyślać: leżał gotowy w makiecie własnego panelu
(`docs/projekt-widokow/Main.dc.html`), do której front nigdy nie doszedł.
Rama zamyka okno, kolumny przewijają się u siebie. Skrzynka traci przy okazji
`max-h-[75vh]` — obejście z czasów, gdy nic nie ograniczało wysokości z góry,
które pod zablokowaną ramą zostawiałoby ćwierć okna pustą.

Blokada zaczyna się od szerokości `lg`. Niżej grid jest jednokolumnowy, a trzy
scrollery po dwieście pikseli czytałoby się gorzej niż przewijaną stronę.
Poniżej tej granicy wszystko zostaje jak było, razem z `sticky` nagłówkiem.

**Kursor musi teraz gonić widok.** Klawisze `j`/`k` przesuwały zaznaczenie bez
fokusu, a dopóki przewijała się strona, wiersz i tak bywał widoczny. Zamknięty
w scrollerze kolejki wyjeżdżałby poza widok przy trzecim naciśnięciu, więc
kolejka dogania go `scrollIntoView({ block: "nearest" })`. `nearest` załatwia
przy okazji mysz: wiersz widoczny w całości nie jest przewijany wcale.

### Jedno pole szuka i skanuje

Kolejkę dało się dotąd zawęzić WYŁĄCZNIE kubełkiem. Gdy operator pamiętał
„coś z 5678", nie miał czego użyć: pole skanu z 0.163.0 owszem, otwierało
zwrot po wpisanym numerze, ale dopasowanie miało dokładne i nazywało się
„Zeskanuj etykietę".

Teraz każdy wpisany znak zawęża listę po fragmencie numeru zwrotu,
identyfikatora z Allegro, numeru zamówienia albo numeru korekty. Pole zmieniło
nazwę na `Szukanie.tsx`, żeby następny agent znalazł je po tym, czego szuka.

**Serwer nie dostał ani jednej nowej trasy.** Lista zwrotów przyjeżdża
w całości od 0.150.0, więc filtr liczy się w pamięci ekranu — tą samą drogą co
filtr kubełka. Szukanie po fragmencie na serwerze musiałoby albo rozluźnić
`znajdzZwrotPoKodzie`, które ma być dokładne, bo samo otwiera zwrot, albo
dołożyć trasę z dziennikiem — czyli zapisać, czego ktoś szukał.

**Szukanie przebija kubełek**, a wiersz wyniku niesie etykietę swojego. Bez
tego operator wpisuje numer, widzi „ten kubełek jest pusty" i nie ma jak się
dowiedzieć, że zwrot stoi w ZAMKNIĘTYCH. Kliknięcie w kubełek zdejmuje filtr.

**Fragment zawęża, otwiera dopiero CAŁY kod.** Ekran sam otwiera przy jednym
wyniku, więc przybliżenie prowadziłoby do cudzej sprawy — przy zwrocie znaczy
to cudzego klienta i cudze pieniądze. Numeru listu przewozowego filtr nie
widzi, bo nie ma go w modelu pracy; od niego jest Enter i skan z 0.163.0.

### Przy wdrożeniu

Nic. Zmiana jest w samym panelu obsługi, bez migracji i bez wpisu
w `wertis.env`.

---

## 0.164.1 — 2 września 2026

**Skrzynka przestaje móc przeczytać całą historię konta w kółko.** Statystyki
aplikacji na developer.allegro.pl pokazały za 1 września **315 986 żądań**
przy zerowym odsetku błędów po stronie Allegro. Zero błędów jest tu ważniejsze
od tej dużej liczby: Allegro przyjęło każde z tych żądań i odpowiedziało
poprawnie. To nie była blokada ani lawina ponowień, tylko nasza własna pętla,
która przez siedem godzin czytała to samo.

### Skąd tyle

Skrzynka była JEDYNĄ z czterech pętli Allegro bez ogranicznika. Zwroty mają
`MAKS_STRON`, rabaty mają, zamówienia mają `NA_PRZEBIEG` — a przebieg skrzynki
szedł tyle stron, ile Allegro miało do oddania. Złożyły się trzy rzeczy naraz,
wszystkie z tego samego dnia:

- **Nic się nie zapisywało** (do 0.151.0 nazwy pól były wymyślone, nie ze
  specyfikacji), więc każdy wątek wyglądał na nowy i dostawał własne żądanie
  o wiadomości — w KAŻDYM przebiegu.
- **Kursor nigdy nie ruszał**, bo zapis i kursor szły dopiero po całej pętli,
  a pętla do nich nie dochodziła.
- **Nie było granicy czasu** (weszła w 0.152.0), więc każdy przebieg zaczynał
  od najnowszego wątku i schodził do początku historii konta.

Przy takcie 60 s i przebiegu dłuższym od minuty znaczyło to pracę ciągłą:
315 986 żądań przez siedem godzin to 12,5 żądania na sekundę, czyli dokładnie
tempo pętli wysyłającej żądania jedno po drugim.

### Co się zmienia

**Sufit 25 stron na przebieg.** Jest bezpieczny, bo lista przychodzi
posortowana po dacie ostatniej wiadomości, od najnowszej — tak mówi
specyfikacja w `docs/allegro/swagger.yaml`. Wątek, w którym coś się dzieje,
wskakuje na górę listy. Pod sufit może zejść wyłącznie rozmowa, w której nic
się nie zmieniło od 500 nowszych wątków.

**Zapis po każdej stronie, nie na końcu przebiegu.** Awaria na stronie
trzechsetnej kasowała dotąd dorobek dwustu dziewięćdziesięciu dziewięciu,
a następny przebieg pytał o te same wiadomości raz jeszcze. Strona jest
najmniejszą jednostką zapisu: wątki strony niedoczytanej nadal nie wchodzą
pojedynczo.

**Kursor przesuwa się także po przebiegu obciętym sufitem.** Bez tego następny
przebieg czytałby te same 25 stron co minutę, w kółko. Wolno, bo nowa kolumna
`dno_at` zapamiętuje, że jakiś wcześniejszy przebieg zszedł do granicy czasu —
a więc to, co pod sufitem, już przez skrzynkę przeszło.

**Pierwsze zejście idzie bez sufitu.** Dopóki `dno_at` jest puste, ogranicznik
nie obowiązuje: instalacja z zaległością większą niż 25 stron nigdy by jej
inaczej nie nadrobiła, bo każdy przebieg czytałby te same 500 wątków i zawracał.
To zejście jest jednorazowe i ograniczone progiem `ALLEGRO_INBOX_OD`.

Czego to wydanie **nie** rozstrzyga: gdyby między dwoma przebiegami przybyło
ponad 500 wątków z nowymi wiadomościami, te spod sufitu poczekają na następny
przebieg. Przy takcie 60 s to jest ruch, którego ta firma nie generuje — ale
to jest założenie, nie prawo, i dlatego stoi wypisane przy stałej w kodzie.

Wdrożenie: nic ręką. Kolumna `dno_at` dochodzi migracją przy pierwszym starcie,
a jej pusta wartość na bazie zastanej znaczy „zejdź raz do dna bez sufitu",
czyli dokładnie to, co robił kod do 0.164.0.

## 0.164.0 — 2 września 2026

**Rabat transakcyjny widać przy zwrocie i składa się jednym kliknięciem.**

Firma odzyskiwała zwrot prowizji klikając ręcznie przy KAŻDYM zwrocie w panelu
Allegro. Nie z konieczności — po prostu znikąd nie było widać, przy którym
wniosek już jest. Obserwacja sondy z 2 września pokazuje skalę: 60 wniosków
na 100 złożył człowiek, 40 Allegro samo.

### Stan przy każdej pozycji, nie przy zwrocie

Wniosek składa się na POZYCJĘ ZAMÓWIENIA, więc zwrot z dwiema pozycjami ma dwa
osobne rabaty. Stany są cztery i każdy każe co innego zrobić: brak wniosku daje
przycisk, złożony każe czekać, przyznany pokazuje kwotę prowizji, odrzucony
odsyła po odwołanie do panelu Allegro. Piąty mówi „nie wiadomo" i podaje POWÓD,
bo milczenie wygląda jak usterka, a jest zerwanym ogniwem w danych.

Wnioski przyjeżdżają własnym taktem z `/order/refund-claims`, osobnym od
zwrotów: jedna końcówka nie ma prawa zabrać drugiej ze sobą, gdy odpowie
błędem. To blizna 0.149.2 zastosowana z góry.

### Pierwszy zapis tego systemu do Allegro

Dotąd wychodziła stąd wyłącznie wiadomość do klienta. `POST /order/refund-claims`
żąda dwóch rzeczy: pozycji zamówienia i ilości.

**Identyfikator bierze się z pozycji ZAMÓWIENIA, nigdy z `offerId` zwrotu.**
Do której przestrzeni należy ten drugi, jest wciąż pytaniem otwartym — a idąc
przez zamówienie, pytanie nas nie dotyczy.

**Ta końcówka nie ma idempotencji.** `commandId` jest przy zwrocie pieniędzy,
nie tutaj, więc powtórzone żądanie zakłada DRUGI wniosek. Strażnik jest nasz,
potrójny, i stoi PRZED wyjściem do sieci: nasze lustro wniosków, status zwrotu
z Allegro (`COMMISSION_REFUND_CLAIMED`, `COMMISSION_REFUNDED`) oraz zniknięcie
przycisku po złożeniu. Zapis lokalny idzie PO udanej odpowiedzi — odwrotna
kolejność zostawiłaby wniosek-widmo i zablokowała pozycję na zawsze.

Automatu nie ma i nie planujemy: Allegro zakłada 40 wniosków na 100 samo, więc
ticker po naszej stronie dublowałby ich pracę bez niczyjej wiedzy.

### `scopeDlaUrl` uczy się metody

Zapis na zamówieniach żąda `allegro:api:orders:write`, odczyt
`orders:read` — a ta funkcja patrzyła dotąd na sam adres. Odmowa 403 przy
składaniu wniosku kazałaby dodać uprawnienie, które konto już ma. Dokładnie ta
pomyłka kosztowała wydanie przy opiniach: zła instrukcja jest gorsza niż jej
brak, bo wysyła człowieka po coś, co ma.

### Sonda mierzyła zero tam, gdzie są dane

Sekcja „rozmowa dyskusji" była pusta przy stu sprawach z niezerowym licznikiem
wiadomości. Adres był dobry; zły był klucz listy — sonda pytała o `messages`,
a odpowiedź niesie `chat`. Helper przy nietrafionym kluczu cicho oddawał pustą
tablicę, więc HTTP 200 z pełnym ciałem liczyło się jako zero rekordów.

Helper przeniósł się do `services/ksztalt.ts`, gdzie ma testy; do próbki doszedł
jawny `limit=100`, bo przy tej jednej końcówce specyfikacja daje domyślne 10.

### Raport sondy wchodzi do repo

`docs/allegro-sonda.md` — obserwacja z datą, bez zmian w treści. Kontrakt mówi,
co WOLNO czytać kodowi; raport mówi, co konto naprawdę oddało. Przy rozjeździe
wygrywa obserwacja, więc kontrakt dostał sześć poprawek: zwrot ma `status`,
`buyer` i `isFulfillment`, `rejection.code` ma siedem kodów zamiast czterech,
doszła sekcja o szczególe zwrotu i pokrycie `external.id` (165 na 165 niepuste —
mostek do kartoteki stoi na pewnym gruncie).

Znacznik `[WERYFIKUJ]` przy `status` zwrotu ZDJĘTY: twierdził, że specyfikacja
go nie zawiera, a leży ona w tym repo od 0.151.0. Licznik zszedł z 13 na 12.

Poprawione też trzy zdania, które kłamały o stanie rzeczy — w tym jedno
niebezpieczne: `docs/obsluga-klienta.md` kazał zapisać raport sondy jako
`allegro-ksztalt.md`, czyli NADPISAĆ kontrakt raportem. Tak powstała blizna
0.151.0.

**[wymaga działania]** Na developer.allegro.pl trzeba dodać aplikacji
uprawnienie `allegro:api:orders:write` i sparować konto ponownie — bez tego
przycisk zwróci 403 z nazwą brakującego uprawnienia. Migracja dokłada kolumnę
i tabelę sama; panel wymaga przebudowy.

## 0.163.0 — 2 września 2026

**Zwrot otwiera się skanem etykiety zwrotnej.**

Kolejka zwrotów była domknięta od 0.162.0 — werdykt, ocena, kwota, korekta,
kartoteki, zdjęcia — ale brakowało w niej wejścia od strony fizycznej paczki.
Karton lądował na biurku, a operator szukał właściwego zwrotu oczami. Teraz
ciągnie po naklejce czytnikiem USB i zwrot otwiera się sam.

### Jedno pole rozpoznaje kod samo

Serwer próbuje po kolei i pierwsze trafienie wygrywa: numer zwrotu
(`1234/Z04A`), identyfikator zwrotu z Allegro, na końcu numer listu
przewozowego. Odpowiedź mówi, KTÓRA droga zadziałała.

Dopasowanie jest dokładne, nigdy przybliżone, a **dwa trafienia to brak
trafienia** — ekran pokazuje wtedy oba i każe wybrać. Ekran sam otwiera zwrot
przy jednym wyniku, więc przybliżenie prowadziłoby do cudzej sprawy, a przy
zwrocie znaczy to cudzego klienta i cudze pieniądze. Ten sam wzorzec stoi przy
kodach EAN (`ktoMaTenKod`), gdzie każde dodatkowe trafienie jest powodem
odmowy.

### Numeru listu nie zapisujemy

`zwrot_klienta` nie dostaje kolumny na numer listu i nie dostanie. Numer i tak
leży w kopii odpowiedzi Allegro (`allegro_zwrot.surowe_json`) i tam go szukamy,
zapytaniem po `json_each`. Jest UŻYTY, nie ZAPAMIĘTANY.

Z tego samego powodu trasa skanu jest POST-em, choć **niczego nie zapisuje**:
kod w adresie wylądowałby w logu żądań serwera, czyli stałby się trwały tylnymi
drzwiami. Nie ma go też w dzienniku zdarzeń.

Przy okazji znika sprzeczność dwóch plików. `services/ksztalt.ts` nazywa numer
listu daną osobową okrężną drogą, a czyszczenie lądowisk przepuszcza go bez
zmian. Obie oceny są prawdziwe o różnych miejscach: raport sondy wchodzi do
repo, lądowisko jest prywatną kopią w bazie biura. Oba komentarze wskazują
teraz jeden akapit polityki w `docs/obsluga-klienta.md`.

### Paczka bywa szybsza niż synchronizacja

Nieznany kod nie kończy się samym „nie znam". Ekran wypisuje zeskanowany kod,
mówi, czego szukał, i daje przycisk „Poszukaj w Allegro" — pytanie o ten jeden
numer listu filtrem `parcels.waybill`, poza rytmem tickera. Kursor
synchronizacji zostaje nietknięty, żeby ręczne pytanie nie zgubiło zwrotów
pomiędzy.

Przy czytniku samo „nie znalazłem" wygląda identycznie jak zepsuty czytnik —
dlatego kod jest na ekranie, choćby naklejka była pomięta, a skan urwany.

### Czytnik przestał walczyć ze skrótami

To była konkretna usterka, nie ryzyko teoretyczne. Cyfry `1`–`6` przełączają
kubełek kolejki od 0.150.0, a etykieta InPostu `600000367616070023174201`
zawiera je wszystkie: bez zabezpieczenia jeden skan przerzuciłby kubełek sześć
razy, zanim doleciałby Enter.

Panel dostaje wzorzec, który kolektor ma od pięciu wydań
(`scan/WedgeKeySource.kt`): przerwa 300 ms resetuje bufor, Enter kończy serię,
seria krótsza niż sześć znaków nie jest kodem, a w polu tekstowym hook milczy.
Doszło jedno: **pierwszy znak serii czeka czterdzieści milisekund**, zanim
trafi do skrótów. Bez tego pierwsza cyfra kodu i tak przełączyłaby kubełek —
w chwili jej naciśnięcia nikt jeszcze nie wie, czy to skan, czy skrót.
Człowiek nie wciska dwóch klawiszy w takim czasie, a czytnik wysyła znak co
kilka.

Pojedyncza „3" naciśnięta ręką dalej przełącza kubełek.

### Przy wdrożeniu

Czytnik ma być klawiaturowy i kończyć kod Enterem — tak wychodzą z pudełka
niemal wszystkie. Nic do wpisania w `wertis.env`. Opisuje to `DEPLOY.md` §6e.

---

## 0.162.1 — 2 września 2026

**Aktualizacja 0.153.1 → 0.162.0 nie podnosiła instalacji wcale.**

`wertis-api` i `wertis-worker` zostawały w `SERVICE_PAUSED`, a `npm run sonda`
kończył się kodem 1. Wszystkie trzy padały na tym samym zdaniu:
`UNIQUE constraint failed: zwrot_klienta_pozycja.zwrot_id, …klucz`, w migracji
wołanej przez `db()` — czyli przez każdy proces, który otwiera bazę.

### Klucz naturalny pozycji obiecywał więcej, niż dane mogą dać

`CustomerReturnItem` w specyfikacji Allegro nie ma ŻADNEGO identyfikatora
pozycji: są `offerId`, `quantity`, `name`, `price`, `url`, `reason`
i `serialNumbers`. Ta sama oferta potrafi więc wystąpić w jednym zwrocie dwa
razy, a klucz `offer_id|nazwa` sklejał takie pozycje w jedną.

Do 0.153.1 nie bolało: synchronizator kasował pozycje i wstawiał od nowa bez
żadnego ograniczenia, więc duplikaty spokojnie leżały w bazie. Przebudowa
z 0.154.0 liczyła im identyczny klucz i zakładała na niego indeks UNIQUE —
na bazie z takim zwrotem wywracała się w kółko, przy każdym starcie.

Klucz dostaje NUMER WYSTĄPIENIA: pierwsza pozycja zostaje przy dzisiejszym
kluczu, druga dostaje `|#2`. Bazy już zmigrowane nie przekluczają ani jednego
wiersza, a to do klucza przywiązana jest praca człowieka — ocena, kartoteka
i zaznaczenie do kwoty.

### Ta sama wada żyła w synchronizatorze

Dwie pozycje tej samej oferty nadpisywały się nawzajem przez `DO UPDATE`, więc
zwrot cicho gubił wiersz, a kwota liczyła się z jednej sztuki zamiast dwóch.
Utrwalał to test, którego NAZWA mówiła „nie zlewają się", a asercja dowodziła,
że jednak się zlewają. Teraz obie pozycje mają własny wiersz, a test pilnuje
też tego, że drugi przebieg synchronizacji ich nie mnoży.

### Przebudowa gubiła po drodze `w_zwrocie`

Druga wada na tej samej ścieżce, widoczna dopiero po odblokowaniu startu. Nowa
tabela nie miała tej kolumny, choć `addColumn` dokłada ją kilkadziesiąt linii
wyżej w tym samym przebiegu — przebudowa kasowała ją razem ze starą tabelą,
a wracała dopiero przy następnym starcie. Do tego czasu zapis kwoty leciał na
nieistniejącą kolumnę.

### Test, który miał to złapać

Istniejący test przepisania wstawiał do starej tabeli JEDEN wiersz i dlatego
przepuścił awarię. Nowy stawia bazę w kształcie sprzed 0.154.0 z dwiema parami
duplikatów i sprawdza komplet: wszystkie cztery pozycje przeżywają, klucze są
różne, oceny się nie nadpisują, `w_zwrocie` istnieje, indeks unikalny stoi,
a drugi przebieg migracji nie robi nic.

Migracja NIE dostaje trybu „przełknij błąd i jedź dalej". Baza w połowie
przebudowana jest gorsza niż start, który uczciwie staje.

### Sonda mówiła o sobie nieprawdę

Nagłówek obiecywał, że sonda „nie dotyka bazy poza odczytem tokenu". Odczyt
tokenu idzie przez `db()`, a `db()` wykonuje schemat i całą migrację. To zdanie
kazało szukać przyczyny w sondzie, choć tak samo padały wtedy API i worker.

**[wymaga działania]** Migracja naprawia się sama przy pierwszym starcie —
w bazie nic nie trzeba ruszać. Usługi trzeba jednak wystartować RĘCZNIE, bo
NSSM zostawił je w `SERVICE_PAUSED` po nieudanych próbach.

## 0.162.0 — 2 września 2026

**Piąty kubełek kolejki zwrotów był ślepym zaułkiem.**

`kubelekZwrotu` routuje po `korekta_numer`, a tej kolumny nic nie zapisywało —
tak samo jak przed 0.156.0 nic nie zapisywało werdyktu i kwoty. Zwrot z ustaloną
kwotą stał w DO KOREKTY na zawsze, a ekran pisał przy nim „czeka na własne
wydanie".

### Korektę wystawia człowiek, panel zapisuje jej numer

To nie jest półśrodek w drodze do automatu. Zadanie `korekta_zwrot` w kolejce
Sfery potrzebuje `dok_Id` dokumentu SPRZEDAŻY, a read-model `sgt_dokument`
trzyma wyłącznie zakupy — FZ i PZ. Bez tego identyfikatora automat musiałby go
zgadywać, a zgadywanie kształtu cudzej bazy kosztowało w tym repo trzy wydania.
§28 nazywa to teraz wprost: automat korekty jest POZA ZASIĘGIEM, nie „w planie".

Zapisany numer zamyka zwrot i zdejmuje go z kolejki pracy. Zamknięcie zapisujemy
wprost w `zamkniety_at`, choć kubełek wywiódłby je z samego numeru: godzina
zejścia sprawy z biurka jest faktem, którego z obecności napisu nie da się
odtworzyć.

### Pieniądze nadal oddaje człowiek

Zamknięcie znaczy „nasza część jest zrobiona", nie „klient dostał przelew" —
i ekran mówi to wprost przy przycisku. Bez tego zdania zamknięcie zwrotu
obiecywałoby przelew, którego panel nie robi.

### Cofnięcie, bo numer przepisuje się ręką

§25a.5 daje potwierdzenie dwóm rzeczom nieodwracalnym, a reszcie cofnięcie.
Literówka w numerze przepisanym z Subiekta jest zdarzeniem normalnym, więc
cofnięcie korekty jest JEDYNĄ operacją dozwoloną na zwrocie zamkniętym.
Przywraca go do DO KOREKTY: werdykt, oceny i kwota zostają, bo cofamy korektę,
a nie całą pracę nad zwrotem.

Kolejność bramek jest umową kolejki i pilnuje jej serwer: numer zapisany przed
kwotą przeskoczyłby zwrot z DO ZWROTU wprost do zamkniętych, czyli domknąłby
sprawę pieniędzy, o których nikt nie zdecydował.

**[wymaga działania]** Bez migracji — kolumny stoją w schemacie od 0.150.0.
Panel trzeba przebudować (`npm run build`), bo pole numeru żyje po jego stronie.

## 0.161.1 — 1 września 2026

**Dwie sesje zderzyły się dwa razy w ciągu jednego dnia, więc repo dostaje
sprawdzenie na starcie.** Statusy rozmowy powstały DWA RAZY, w dwóch gałęziach
naraz (0.157.0 i 0.158.0), i jedną implementację trzeba było wyrzucić w całości
przy scalaniu — diff jednego PR-a skurczył się z 2091 do 716 dodanych linii
i to jest miara straty. Kilka godzin później numer 0.159.0 nazwały dwie gałęzie
jednocześnie, każda co innego.

Zdalnych gałęzi jest ponad trzydzieści, w tym prawie trzydzieści `claude/*`.
Mimo to `CLAUDE.md` nie wspominał o pracy równoległej ANI RAZU — w całym repo
nie było jednej reguły mówiącej, żeby przed zaczęciem sprawdzić, co budują
inni. Decyzja właściciela: sprawdzać na starcie.

**`tools/co_w_toku.sh`** wypisuje gałęzie z commitami spoza `main` (okno 48
godzin, po trzy commity, bez merge'y — „Scalenie main do gałęzi X" nie mówi,
co ktoś buduje) oraz wersję `main` obok lokalnej. Kolizja dwóch sesji objawia
się najpierw wyścigiem numerów wydania i to jest najtańszy sygnał.

Skrypt NIGDY nie kończy się błędem. Brak sieci, świeży klon bez `origin`,
uruchomienie spoza repo — każdy z tych przypadków daje zdanie o tym, czego nie
wiadomo, i kod wyjścia zero. Sprawdzenie informacyjne nie ma prawa położyć
startu sesji. Pustka też mówi o sobie wprost: cisza jest nieodróżnialna od
awarii skryptu.

**`.claude/settings.json`** to pierwszy plik konfiguracji Claude Code W TYM
REPO. Hak `SessionStart` woła skrypt, więc wynik stoi w kontekście, zanim
padnie pierwsza linijka kodu. Plik jest wersjonowany i przez to działa dla
każdej przyszłej sesji, także cudzej — to cała różnica wobec haków z katalogu
domowego, które znikają razem z kontenerem.

Hak niczego nie blokuje. Bramka odmawiająca startu kosztowałaby przy każdej
sesji, a płacić ma tylko ta, w której kolizja naprawdę jest.

**`CLAUDE.md` dostaje sekcję „Zanim zaczniesz"**, symetryczną do „Zanim
wypchniesz": bramka na wejściu i bramka na wyjściu. Mówi też, czego skrypt NIE
widzi — otwartych PR-ów, bo to shell, a GitHub stoi za osobnymi narzędziami.

Reguła przy kolizji jest jedna i twarda: gdy ktoś buduje to samo, powiedz
właścicielowi i **czekaj na decyzję, zanim napiszesz linijkę kodu**. Jedna
wymiana zdań kosztuje mniej niż wydanie do wyrzucenia.

Wdrożenie: nic. To narzędzie dla sesji, nie dla firmy.

## 0.161.0 — 1 września 2026

**Sprawa istniała w projekcie od §6.1 i nie miała tabeli.**

Rozmowa, sprawa, dobór i zadanie to cztery osobne byty — decyzja właściciela
z `docs/obsluga-klienta.md` (pytanie 1). Sprawa stoi ponad rozmowami i skleja
te, które dotyczą jednego problemu klienta. Do tego wydania nie miała gdzie
mieszkać, więc druga rozmowa o tej samej kosiarce była rozmową obcą.

### Klamra, nie byt z historią

Sprawa ma tytuł i listę rozmów. Nie ma statusu, bo §7 go dla niej nie zna, i nie
ma własnej osi, bo zdarzenia wiszą przy ŹRÓDLE — blizna z 0.130.0 mówi wprost,
że historia sprawy ginęła przy scalaniu. Sklejenie i rozklejenie widać na osi
KAŻDEJ rozmowy, której dotyczyło, więc odklejenie nie zabiera historii ze sobą.

Rozmowa należy do co najwyżej jednej sprawy i pilnuje tego klucz główny, nie
dyscyplina serwisu: druga sprawa odbija się o SQL nawet wtedy, gdy ktoś ominie
serwis. Odmowa niesie TYTUŁ tej pierwszej sprawy — „należy już do innej"
kazałoby agentowi szukać, którą odkleić.

Ekranu sprawy nie ma i to jest wybór. Pasek nad rozmową pokazuje tytuł
i rodzeństwo, bo to jedyne pytanie, na które sprawa dziś odpowiada. Poprzednia
odpowiedź o tym samym kształcie kosztowała cztery tabele nakładki plus ręczne
SCAL i ROZKLEJ.

### Mina, która wybuchła przy pisaniu

Tabela nazwana wprost `sprawa` powstawała ze `schema.sql` i ZNIKAŁA sekundę
później. `migrate()` kasuje ją przy każdym starcie, bo stoi na liście nakładek
po starej implementacji — bazy klientów wciąż je mają i każda musi je stracić.
Bez błędu i bez wyjątku; jedynym objawem był test, który nie widział własnej
tabeli.

Stąd `sprawa_klienta`, tym samym ruchem, którym zwroty wróciły w 0.150.0 jako
`zwrot_klienta`. Komentarz w `db.ts` ostrzegał przed tym od 0.150.0 i właśnie
zarobił na siebie drugi raz. Pilnuje tego teraz `db/migracja-sprawy.test.ts`:
nowe nazwy mają przeżyć migrację, stare mają nadal znikać.

Nazwy `case` z §15 projektu też nie ma: to słowo kluczowe SQLite i każde
zapytanie musiałoby ją cytować. Dokument dostał nazwę z kodu, nie odwrotnie.

**[wymaga działania]** Migracja dokłada dwie tabele. Panel trzeba przebudować
(`npm run build`), bo pasek sprawy żyje po jego stronie.

## 0.160.0 — 1 września 2026

**Wzmianka docierała tylko do tego, kto zgadł, w której rozmowie ją zostawiono.**

`conversation_mention` zapełniała się przy każdym komentarzu z „@", ale jedyną
drogą do niej było OTWARCIE tego właśnie wątku. To ta sama blizna, którą
komentarze dostały w 0.157.0: zapis bez odczytu. Wzmianka jest prośbą o zajęcie
się czymś, więc niedostarczona kosztuje tyle, co niezadana.

### Zakładka „Wzmianki" z licznikiem

Skrzynka pokazuje wzmianki JEDNEGO konta — adresat bierze się z sesji, nigdy
z parametru żądania. Wzmianka niesie fragment komentarza wewnętrznego, a te
bywają równie wrażliwe co treść klienta, więc cudzej nikt tu nie zobaczy.

Licznik nieodhaczonych stoi przy zakładce, nie na jej ekranie. Prośba, o której
wie tylko własny ekran, dociera wtedy, gdy ktoś na niego wejdzie — czyli
dokładnie wtedy, gdy nie jest już potrzebna.

### Odhaczenie jest jawne i osobne dla każdego

Ani otwarcie listy, ani wejście do rozmowy niczego nie kasuje: reguła „zero
zapisu przy patrzeniu" obowiązuje też tutaj, a wzmianka gasnąca od samego
spojrzenia ginęłaby przy przewijaniu listy w biegu.

Odhacza się PARĘ komentarz–osoba. Dwoje ludzi wzmiankowanych w jednym zdaniu ma
z nim dwie różne sprawy, więc wspólne odhaczenie kasowałoby cudzą robotę jednym
kliknięciem. Powtórne kliknięcie nie przestawia godziny — data odhaczenia mówi,
KIEDY ktoś się tym zajął.

Odhaczone zostają na liście jako dowód „pisałam ci o tym w środę", ale domyślnie
schodzą z oczu. Każde odhaczenie idzie do dziennika jako `wzmianka_odhaczona`,
bez treści komentarza.

**[wymaga działania]** Migracja dokłada `seen_at` do `conversation_mention`
i indeks po parze konto–stan. Wzmianki zastane wchodzą jako nieodhaczone, bo
nikt ich dotąd nie mógł odhaczyć.

## 0.159.0 — 1 września 2026

**Wejście w pytanie przydziela je agentowi, odpowiedź przydziela na stałe.**
Decyzja właściciela. Do 0.158.0 przydział był jeden i wymagał osobnego
kliknięcia: agent, który wszedł w pytanie i napisał odpowiedź, dostawał na
końcu „Rozmowę prowadzi kto inny — najpierw ją przejmij" i tracił ruch, choć
rozmowa nie należała do nikogo.

**Uchwyt tymczasowy nie dotyka bazy** i to jest cała jego istota. §6.3 projektu
napisano w 0.141.0: „Obecność i »pisze« nie są tabelą. To stan krótkotrwały,
żyjący w pamięci procesu i wygasający sam. Zapisany do bazy stałby się trwałym
statusem rozmowy, czyli dokładnie tym, czym nie jest — a po restarcie serwera
kłamałby o tym, kto siedzi przy sprawie". Ten akapit czekał na zastosowanie
i właśnie je dostał.

Dwa skutki. Wejście na ekran nie zapisuje ani jednego wiersza, więc „zero
zapisu przy patrzeniu" obowiązuje mimo trasy `POST`. I żadna rozmowa nie
zostaje zablokowana przez agenta, który wyszedł z pracy w czwartek — po
restarcie usługi wszystkie uchwyty znikają.

**Trzyma PIERWSZY, który wszedł.** Nie ostatni: inaczej kolega otwierający
rozmowę „na chwilę" odbierałby ją komuś w połowie pisania odpowiedzi.

Uchwyt puszcza po czterdziestu pięciu sekundach bez znaku życia; panel bije
sercem co piętnaście. Trzykrotny zapas jest po to, żeby jedno zgubione żądanie
nie oddało rozmowy komuś innemu. Wyjście z ekranu i zamknięcie karty puszczają
uchwyt od razu — wymeldowanie idzie z `keepalive`, bo bez niego przeglądarka
przerywa żądanie w locie.

**Blokada jest MIĘKKA.** Gdy przy rozmowie siedzi kto inny, wysyłka odpada
z 409 i nazwiskiem, a ekran daje jawne „Odpowiedz mimo to" obok „Zostaw
koledze". Twarda blokada zatrzymywałaby biuro za każdym razem, gdy kolega
zostawił otwartą zakładkę i wyszedł na obiad. To ta sama zasada co przy
dopisku klienta z 0.110.0: zgoda ma być jawna, nigdy domyślna.

**Kto odpisał klientowi, ten prowadzi sprawę.** Przypisanie idzie tą samą
transakcją co wiadomość wychodząca: przypisanie bez wysłanej odpowiedzi albo
odwrotnie to dwa różne rodzaje kłamstwa. Trwały właściciel dalej bije
wszystko — rozmowy prowadzonej przez kogoś innego nie odblokuje ani uchwyt,
ani „mimo to".

**Widać to, ZANIM padnie pierwsze słowo odpowiedzi.** Wiersz kolejki pokazuje
oko z nazwiskiem kolegi, który tam siedzi. Bez tego dwóch agentów pisze tę samą
odpowiedź i dowiaduje się o sobie dopiero przy wysyłce, czyli po straconej
pracy.

**`waiting_for_internal` dostaje nadawcę.** Status z §7 wszedł do bazy
w 0.158.0 i stał w liście dopuszczonych wartości bez ani jednego automatu,
który by go ustawiał — agent musiał wybrać go ręcznie, choć fakt już się
wydarzył. Teraz zlecenie pomiaru przestawia rozmowę na „czeka na nas", a wynik
z hali ten stan zdejmuje. Oba przejścia lądują na osi; to drugie podpisuje
HALA, nie agent — tak samo jak przebudzenie podpisuje klient.

## 0.158.0 — 1 września 2026

**Rozmowa nie miała statusu, więc kolejka nie odróżniała sprawy załatwionej
od nietkniętej.**

`conversation` nie miała kolumny stanu. Lista pokazywała wszystko obok siebie
w kolejności ostatniej wiadomości, a jedynym podziałem był właściciel. Sprawa
zamknięta wczoraj leżała między pytaniami z dzisiaj, a §7 projektu panelu —
osiem statusów rozmowy — istniał wyłącznie na papierze.

### Osiem statusów z §7 wchodzi do bazy

`conversation.status` z `CHECK` na zamkniętej liście i `snoozed_until` obok.
Lista stoi w trzech miejscach: w bazie, w `STATUSY_ROZMOWY` na serwerze
i w typach panelu. Każda kopia pilnuje innej granicy, a rozjazd wychodzi przy
kompilacji albo przy zapisie.

### Trzy przejścia dzieją się same

Przejęcie rozmowy prowadzi `new` → `open`. Wysłana odpowiedź stawia
`waiting_for_customer`. Przychodząca wiadomość klienta budzi rozmowę do `open`
i to jest sedno wydania: bez tego przejścia klient dopisuje do sprawy uznanej
za rozwiązaną, a rozmowa zostaje na liście „rozwiązane" i nikt do niej nie
zagląda. Status, który nie wraca sam, jest gorszy niż jego brak.

Budzenie omija `closed` i `spam`. To jawne werdykty człowieka, a automat, który
je cofa, kazałby zamykać tę samą rozmowę w kółko.

### Odłożenie kończy się samo, bez tickera

`snoozed` wymaga terminu — §7 nie zna rozmowy odłożonej na zawsze. Koniec
odłożenia liczymy PRZY ODCZYCIE: stan wyliczalny nie potrzebuje procesu, który
go pilnuje, a ticker, który raz nie wstanie, zostawiłby rozmowy odłożone na
zawsze. Rozmowa po minionym terminie wraca jako otwarta i niesie znacznik
„po terminie", bo inaczej nie różniłaby się od świeżo otwartej.

### Kolejka dostaje kubełki z §10.1

Wszystkie, Nieprzypisane, Moje, Oczekujące, Po terminie — z licznikiem przy
każdym. Zamknięte i spam schodzą z kolejki roboczej, ale zostają
we „Wszystkich": ukrycie ich wszędzie znaczyłoby, że pomyłkowego zamknięcia nie
da się cofnąć. Pusty kubełek mówi co innego niż pusta skrzynka.

### Zmiana statusu ląduje na osi

§10.3 wymienia ją wśród wpisów osi. Wpis jest kreską, nie kafelkiem — to nie
czyjaś wypowiedź, tylko znak, że sprawa przeszła dalej. Autorem bywa KLIENT,
nie agent: podpisanie budzenia agentem kłamałoby w audycie o tym, kto co
zrobił. Każda zmiana idzie też do dziennika jako `rozmowa_status`.

Automatycznego zamknięcia po N dniach NIE MA i nie wchodzi tym wydaniem —
§26 wymienia je wśród pytań do właściciela.

**[wymaga działania]** Migracja dokłada dwie kolumny do `conversation`.
Rozmowy zastane dostają status `new`, bo tak wygląda prawda o nich: przyjechały
z synchronizacji i nikt ich nie tknął.

## 0.157.0 — 1 września 2026

**Komentarz wewnętrzny był funkcją do zapisu bez odczytu.**

`conversation_comment` miała w całym kodzie serwera JEDEN INSERT i ZERO
odczytów. Agent mógł dodać notatkę, wiersz wpadał do tabeli i nie było drogi,
którą wróciłby do kogokolwiek. Trasa istniała od 0.144.0, ekranu nie było
nigdy, a §28 opisywał to jako „model gotowy, brak ekranu" — za łagodnie, bo
brakowało też połowy modelu.

### Komentarz wraca na oś

§10.3 wymienia komentarz wśród rzeczy, które ma nieść oś rozmowy. Wchodzi jako
trzeci rodzaj wpisu, razem z autorem i wzmiankami.

`odKlienta` zostaje przy nim fałszem i to nie jest szczegół: na tym polu stoi
cały wygląd wpisu klienta, więc komentarz z zapaloną flagą wyglądałby jak cudza
wiadomość — dokładnie odwrotnie, niż żąda §6.4.

### Oś jest chronologiczna

Do tego wydania wyniki zadań doklejały się za wszystkimi wiadomościami bez
względu na czas. Przy dwóch źródłach było to znośne; przy trzech oś przestawała
opowiadać przebieg sprawy.

Sortowanie jest STABILNE, więc wiadomości z tą samą datą zostają w kolejności
identyfikatorów. To ważne: Allegro potrafi oddać dwie wiadomości z jedną
sekundą, a wtedy porządek niesie `message.id`.

### Dwa tryby, dwa pola, dwa przyciski

§10.4 żąda, żeby przycisk komentarza i przycisk wysyłki były jednoznacznie
rozdzielone; §6.4 dodaje, że komentarz „nie może przypadkiem trafić do
klienta"; §25 stawia to wśród kryteriów gotowości.

Rozdzieliliśmy najmocniej, jak się dało. **W trybie komentarza przycisk wysyłki
nie istnieje w drzewie** — wyłączony da się kliknąć, gdy tryb zmieni się
o ułamek sekundy za późno; nieistniejącego nie da się nigdy.

Pola też są osobne. Gdyby oba tryby dzieliły jeden tekst, notatka „klient bywa
trudny" zostawałaby w szkicu po przełączeniu z powrotem i czekała na kliknięcie
WYŚLIJ.

Komentowanie nie wymaga prowadzenia rozmowy: notatka zespołu to nie odpowiedź,
a kolega ma prawo dopisać „to ten sam klient co wczoraj" bez przejmowania
sprawy.

### Wzmianki

Wybiera się je z listy kont, nie wpisuje z palca. Lista idzie z istniejącej
trasy `/api/users` — bez własnej końcówki, bo drugi adres na te same dane
znaczyłby dwa miejsca do pilnowania przy zmianie ról. Hala dostaje tam 403
i to jest poprawne: wtedy po prostu nie ma kogo wzmiankować.

### Test, który przechodził przypadkiem

Pierwsza wersja strażnika §25 wołała `payloadAllegroWiadomosci` z numerem
komentarza i sprawdzała, że funkcja rzuci. Przechodziła — ale z niewłaściwego
powodu.

`conversation_comment.id` i `message.id` to dwie NIEZALEŻNE sekwencje, więc oba
bywają jedynką. Przy kolizji tamta funkcja oddałaby cudzą wiadomość zamiast
rzucić; test mierzył szczęście w doborze danych. Sprawdzone osobnym skryptem:
przy pierwszym komentarzu i pierwszej wiadomości oba identyfikatory to 1.

Granica okazała się zdrowa z innego powodu: wysyłka bierze TEKST ze szkicu, nie
identyfikator, a `payloadAllegroWiadomosci` nie ma dziś żadnego wołającego.
Nowy test sprawdza to, co jest prawdą — treść komentarza nie trafia ani do
`message`, ani do `conversation_draft`.

Wdrożenie: nic ręką, bez migracji.

## 0.156.0 — 1 września 2026

**Kolejka bramek przestaje być dekoracją.**

`kubelekZwrotu` routuje po czterech kolumnach — werdykt, ocena pozycji, kwota
i numer korekty. Żadnej z nich nic nie zapisywało, więc każdy zwrot stał
w DO DECYZJI na zawsze, chyba że ktoś odrzucił go w panelu Allegro. Maszyna
kubełków była zbudowana i nie miała paliwa.

Trzy zapisy domykają trzy pierwsze kubełki.

### Werdykt

Przyjęcie idzie jednym kliknięciem. Odmowa **wymaga powodu** i dostaje
potwierdzenie — §25a.5 stawia ją wśród dwóch rzeczy nieodwracalnych, a zwrotu
odrzuconego bez uzasadnienia nie da się obronić przed klientem.

Nasza odmowa siedzi w osobnych kolumnach niż `rejection_code` z Allegro, bo
pochodzenie decyzji jest informacją, a nie szczegółem.

### Ocena towaru

Na stan, na przecenę albo do utylizacji, osobno dla każdej pozycji. Weszła
razem z resztą nie z rozpędu: bez niej nic nie przechodzi z DO OCENY do
DO ZWROTU i wydania nie dałoby się sprawdzić od początku do końca.

### Kwota z zaznaczenia

Operator odhacza pozycje i koszt dostawy, suma rośnie na oczach, jedno
kliknięcie ją zapisuje. Trzy warianty z projektu — pełna, bez wysyłki, inna —
zostały ETYKIETĄ wyliczaną z zaznaczenia, a nie pozycją w menu.

Do serwera idzie samo zaznaczenie. §25a.3 mówi „liczy ją serwer, panel niczego
nie zgaduje", więc suma na ekranie jest podglądem — gdyby panel wysyłał gotową
liczbę, dałoby się oddać dowolną kwotę żądaniem z pominięciem ekranu. Pilnuje
tego test, który wkłada do żądania absurdalne `kwotaGrosze` i sprawdza, że
trasa go nie czyta.

Koszt dostawy bierze się z zamówienia. Komentarz przy `sumaPozycji` mówił, że
wariantu „bez wysyłki" nie da się odróżnić od pełnego, „dopóki panel nie
zacznie dociągać zamówienia" — zaczął w 0.152.0, więc blokada zniknęła.

### Współbieżność i audyt

Kolumna `wersja` stoi w schemacie od 0.150.0 z komentarzem „dwóch agentów nie
zamyka jednego zwrotu dwiema różnymi kwotami". Dopiero teraz ma czego pilnować:
każda z trzech decyzji niesie wersję, a spóźniony agent dostaje 409 ze
szczegółami — tak samo jak przy przejmowaniu rozmowy.

Każda decyzja zostawia zdarzenie w audycie.

### Umowa licznika tras

Zwroty miały dwie trasy zapisu, mają pięć. Uzasadnienie każdej stoi w teście,
jak przy `biuro.html`. Korekta i oddanie pieniędzy nadal nie mają trasy:
pierwsze idzie do Subiekta, drugie po końcówki ZAPISU Allegro, których sonda
nie potwierdzi, bo jest GET-em.

### Przy okazji

`docs/panel-obslugi-klienta.md` §28 nie wymieniał załączników z 0.155.0. Ta
tabela istnieje po to, żeby nikt nie zbudował czegoś drugi raz — jej własna
preambuła mówi, że w tym repo zdarzyło się to już dwa razy. Wiersz dopisany.

Wdrożenie: nic ręką, dwie kolumny dochodzą migracją.

## 0.155.0 — 1 września 2026

Sonda pobiegła pierwszy raz na żywym koncie. Potwierdziła całe mapowanie
odczytu i wyciągnęła cztery rzeczy, których nie mówiła ani specyfikacja,
ani kod.

### Sonda wynosiła numery listów przewozowych

Raport z produkcji niósł sześć prawdziwych numerów przesyłek InPost przy polu
`parcels[].waybill`. Numer listu prowadzi w systemie kuriera do adresu
i odbiorcy, a raport ma z założenia trafiać do repo.

Zawiodły obie zapory naraz. Lista zakazanych nazw znała `address`, `phone`
i `iban` — nie znała listu przewozowego. Wzorzec słownika nie odróżnia
`A000H44281` od `INPOST`, bo jedno i drugie to wersaliki z cyframi.

Sufit dwunastu wartości też nie pomógł i to jest najciekawsza część: wzorzec
odsiał 82 numery o innym formacie, więc mapa nigdy nie urosła ponad sześć.
**Zapora, która wyglądała na drugą, była tą samą co pierwsza.**

Dochodzi trzecia reguła, niezależna od dwóch pozostałych i od nazwy pola:
wartość widziana RAZ w dużej próbce nie jest słownikiem. Enum się powtarza
(`INPOST` ×79, `PLN` ×127); identyfikator nie. Przy małej próbce reguła
milczy, bo tam każda wartość bywa unikalna z natury.

Raportu z 1 września nie commitujemy. Do repo wejdzie dopiero przebieg po tej
poprawce.

### Załączniki wchodzą do rozmowy

Sonda pokazała je w 7 z 39 wiadomości. Klient przysyłający zdjęcie pękniętej
części był dla agenta niewidzialny, bo mapowanie kończyło się na treści.

Specyfikacja mówi więcej niż raport: `MessageAttachmentInfo` wymaga wyłącznie
`fileName` i `status`, więc **adres bywa pusty**, a stan ma cztery wartości —
`NEW`, `SAFE`, `UNSAFE`, `EXPIRED`. Załącznik bez adresu nie jest usterką,
tylko stanem, i zostaje widoczny: ukrycie kłamałoby, że klient nic nie
przysłał.

Pobranie oferujemy tylko przy `SAFE`. `UNSAFE` znaczy, że Allegro uznało plik
za niebezpieczny, a my nie mamy powodu wiedzieć lepiej.

**Adres Allegro nie trafia do przeglądarki.** Pobranie idzie przez naszą trasę,
która dokłada token po stronie serwera i sprawdza, czy adres prowadzi do
Allegro. Czy `upload.allegro.pl` otwiera się bez tokena — nie wiemy i nie
zgadujemy; ta droga działa niezależnie od odpowiedzi.

### Dwa złe adresy — jeden zgadnięty, jeden wymyślony

`/sale/disputes/{id}/messages` **nie istnieje**. W całej specyfikacji nie ma
ani jednej ścieżki `/sale/disputes`. Sonda oddawała przy tej końcówce zero
rekordów, choć `chat.messagesCount` na tych samych sprawach był większy od
zera. Prawdziwy adres to `GET /sale/issues/{issueId}/chat`.

Komentarz w kodzie prosił o sprawdzenie, czy sprawy i dyskusje dzielą
przestrzeń identyfikatorów. Dzielą — specyfikacja opisuje `issueId` jako
„Dispute or claim identifier". Zgadnięty był sam adres.

`scopeDlaUrl` wysyłał po złe uprawnienie. `/sale/user-ratings` nie miał własnej
gałęzi, więc wpadał w domyślną i przy odmowie 403 radził dodać
`allegro:api:orders:read` — czyli to, którym sonda w tym samym przebiegu
pobrała sto zamówień. Specyfikacja mówi `allegro:api:ratings`. Zła instrukcja
jest gorsza niż jej brak: wysyła człowieka po coś, co już ma.

Doszedł test sprawdzający KOMPLET rodzin końcówek używanych przez sondę.
Domyślne uprawnienie jest poprawne tylko dla rodziny `/order/`; wszędzie
indziej znaczy „zapomniano o gałęzi".

### Czego sonda nie zdejmuje

Wcześniejsze wpisy sugerowały, że sonda zdejmie jedenaście znaczników
weryfikacji. Nie zdejmuje żadnego. Siedem dotyczy Subiekta GT, pozostałe
opisują końcówki ZAPISU w Allegro — a sonda jest z założenia GET-em.

### Liczby, które zmieniają decyzje

`relatesTo.offer` jest niepuste w 5 z 39 wiadomości, więc ekran zbudowany na
numerze oferty byłby pusty przy większości rozmów. `subject` też w 5 z 39 —
temat mają praktycznie tylko maile. Obie liczby stoją w kontrakcie.

Wdrożenie: nic ręką. Tabela załączników dochodzi sama.

## 0.154.0 — 1 września 2026

**Zwroty gubiły powiązania z kartotekami, a ekran mówił o tym jednym zdaniem
dla sześciu różnych przyczyn.** Pytanie właściciela brzmiało: „dlaczego zwroty
mają problem z linkowaniem towarów do kartotek?". Odpowiedź miała trzy części
i wszystkie trzy są tu naprawione.

**Po pierwsze: potwierdzona kartoteka kasowała się co minutę.** Kolumna
`zwrot_klienta_pozycja.tw_id` miała `REFERENCES sgt_towar(tw_id) ON DELETE SET
NULL`, a import z Subiekta kasuje cały read-model i wstawia go od nowa co
`MSSQL_SYNC_MS` (domyślnie 60 sekund). Każdy taki cykl zerował pracę człowieka.

To była usterka wprowadzona w 0.152.0 razem z samą funkcją, a komentarz przy
migracji oceniał ją odwrotnie: pisał, że brak klucza obcego w starszych bazach
„wystarcza". To OBECNOŚĆ klucza była szkodliwa. Skutek był przewrotny —
instalacja sprzed 0.152.0 trzymała powiązania, świeża traciła je co minutę.

Wzorzec był w repo od dawna: `ean_alias.tw_id` jest zwykłym `INTEGER` bez
klucza obcego właśnie dlatego, że ma przeżyć import. Tabela pozycji zwrotu
przebudowuje się teraz tak samo. Testem jest przeżycie `DELETE FROM sgt_towar`
razem z ponownym wstawieniem tego samego towaru.

**Po drugie: złączenie mogło iść po złej kolumnie.** Pozycja zwrotu niosła
`offerId`, a szukaliśmy go w `zamowienie_klienta_pozycja.offer_id`. Trzy
przesłanki ze specyfikacji w repo mówią, że to bywają RÓŻNE przestrzenie
identyfikatorów: przykład `offerId` jest UUID-em, `offer.id` numerem, a UUID
pokrywa się kształtem z `lineItems[].id`, czyli z pozycją zamówienia.

Ale to są przykłady, a `docs/allegro/README.md` ostrzega, że bywają niezgodne
ze schematem. Oba pola to `type: string` bez `format`, więc plik nie
rozstrzyga. Sonda też nie — pokazuje wartości wyłącznie dla pól słownikowych.

Zamiast zgadywać, łączymy po OBU kolumnach i zapisujemy, która trafiła
(`poKolumnie`). Poprawne pod każdym odczytem, a odpowiedź przyjedzie z
produkcji. Test odwzorowuje ROZJAZD: UUID po stronie zwrotu, numer po stronie
zamówienia. Dotychczasowy test wstawiał tę samą stałą po obu stronach i
dlatego usterki nie widział.

**Po trzecie: identyfikator pozycji zwrotu zmieniał się przy każdej
synchronizacji.** Pozycje kasowaliśmy i wstawialiśmy od nowa, a pracę
człowieka odtwarzaliśmy po mapie. Otwarty panel trzymał nieaktualne `id`,
a dwie pozycje o tej samej nazwie bez `offer_id` sklejały się w jeden klucz.
Teraz pozycja ma klucz naturalny (`offer_id|nazwa`) i jest UPSERTOWANA.

**Ekran mówi, KTÓRE ogniwo pękło.** Zamiast „Bez kartoteki" pozycja niesie
powód: zwrot bez numeru zamówienia, zamówienie niepobrane, oferty nie ma
w pobranym zamówieniu, oferta bez SKU w Allegro, SKU nie trafia w kartotekę,
symbol zdublowany. Nad kolejką stoi licznik zbiorczy — ile pozycji czeka i z
jakiego powodu. Bez tych liczb nie da się powiedzieć, czy problem jest
w kodzie, czy w danych Allegro.

**Pamięć wskazań.** Potwierdzenie zapisuje parę oferta–kartoteka w nowej
tabeli `oferta_kartoteka` (wzorzec `ean_alias`: bez klucza obcego, poza listą
kasowaną przy imporcie). Następny zwrot tej samej oferty dostaje propozycję
bez udziału zamówienia. To jedyna zmiana, która realnie zdejmuje pracę
powtarzalną. Zdjęcie powiązania kasuje też wpis z pamięci.

**Dopasowanie zapasowe — wyłącznie w obrębie jednego zamówienia.** Gdy
identyfikator nie trafia: zamówienie z jedną pozycją to ta pozycja, a przy
kilku liczy się dokładnie jedna o zgodnej nazwie. To nie jest zakazane
szukanie po nazwie w kartotece — tamto przeszukuje trzy i pół tysiąca kart
i prowadzi do cudzego towaru. Tu zbiór ma dwie do pięciu pozycji jednej
transakcji. Każdy wariant niesie własny poziom pewności i własne zdanie
o źródle.

**Jawny odnośnik do oferty [wymaga działania: sprawdź wzorce].** Przy każdej
zwracanej pozycji stoi teraz podpisany link „Zobacz ofertę". Do 0.153.0
odnośnikiem była sama nazwa towaru — istniał, ale nikt go tak nie czytał.
Gdy Allegro nie podało adresu, ekran mówi to wprost.

**Ręczne dociągnięcie zamówień.** Przycisk „Dociągnij teraz" stoi przy
zamówieniu, którego jeszcze nie pobrano. Wcześniej diagnoza wymagała czekania
dziesięciu minut na najrzadszy z trzech tickerów. Przycisku nie ma tam, gdzie
Allegro nie podało numeru zamówienia — nie byłoby czego pobrać.

Zamówienia odświeżają się też same, gdy wszystkie ich pozycje mają puste SKU,
ale nie częściej niż raz na dobę. Do 0.153.1 zamówienie zapisane raz z pustymi
SKU nie było odpytywane NIGDY.

**Trim po obu stronach porównania symbolu.** `subiekt.mssql.ts` nie trimuje
`tw_Symbol` przy imporcie (`mag_Symbol` tuż obok — trimuje), więc symbol
z białym znakiem na końcu nie trafiał nigdy.

Licznik tras zapisu zwrotów rośnie z jednej na dwie. Druga wychodzi do Allegro
wyłącznie po odczyt i tak samo jak ticker przerywa na 429.

Znaczników `[WERYFIKUJ]` jest teraz trzynaście: doszła przestrzeń
identyfikatora oferty w zwrocie. Ten znacznik zdejmie produkcja, nie kolejna
lektura specyfikacji.

## 0.153.1 — 1 września 2026

**Narzędzia z konsoli czytają `wertis.env` z katalogu instalacji.** Zgłoszenie
z produkcji, z `C:\wertis\server`:

    npm run sonda
    Konto Allegro nie jest sparowane (stan: dev). Sonda czyta żywe konto, więc
    bez tokenu nie ma czego oglądać — sparuj konto w panelu: /biuro → REJESTRY
    → KONTO ALLEGRO.

Konto było sparowane. Sondzie brakowało czego innego — ustawień. npm uruchamia
skrypt workspace'u w `C:\wertis\server`, a `wertis.env` leży piętro wyżej, obok
usług. Lista miejsc, w których szukamy pliku, kończyła się na katalogu
roboczym, więc plik nie był wczytywany wcale. Proces wracał do wartości
domyślnych: puste `SGT_MODE` znaczy tryb demo, a demo znaczy „bez kontaktu
z Allegro".

Dotyczyło to każdego narzędzia z konsoli — `sonda`, `reconcile`, `reslot`,
`inwentarz` — a także `npm run dev`. DEPLOY obiecywał przy tym od dawna, że
proces deweloperski czyta plik z katalogu roboczego. Usługi problemu nie miały
i to jest cała przyczyna, dla której nikt tego nie zauważył wcześniej: NSSM ma
`AppDirectory C:\wertis`, więc plik leży dokładnie tam, gdzie usługa patrzy.

Teraz szukanie idzie w górę: katalog roboczy, potem jego rodzice. Wygrywa plik
najbliższy, a `/api/health` dalej pokazuje, który to był — pomyłka w wyborze ma
więc gdzie wyjść na jaw. `WERTIS_ENV_FILE` bez zmian: wskazana ścieżka ucina
szukanie, bo jawna decyzja człowieka nie ma prawa po cichu wczytać czegoś
innego.

**Sonda przestaje kłamać o powodzie odmowy.** Jedno zdanie obsługiwało pięć
stanów połączenia i przy dwóch trafiało obok. Tryb `dev` nie jest brakiem
parowania — w trybie demo nie ma czego parować i karta w panelu mówi to wprost,
więc odesłanie do niej kończyło się szukaniem przycisku, którego tam nie ma.
Drugi błąd był starszy: zdanie prowadziło do zakładki REJESTRY, skasowanej
w 0.140.0 razem z obsługą klienta. Karta KONTO ALLEGRO stoi od tamtej pory
w STANIE SYSTEMU.

Każdy stan ma teraz własne wyjście: `dev` — ustawienie `SGT_MODE` albo
`ALLEGRO_MODE`, `wylaczone` — poświadczenia aplikacji, `niepolaczone`
i `zle_srodowisko` — parowanie w panelu, ze wskazaniem właściwej zakładki.
Do każdego dochodzi zdanie o tym, Z KTÓREGO pliku ten proces wziął ustawienia
albo że nie znalazł żadnego. Bez tego jedyną różnicą między procesem konsoli
a usługą jest słowo „dev", z którego nikt niczego nie odczyta.

Instrukcji nawigacji pilnuje odtąd test. Bierze pierwszy człon każdego zdania
w rodzaju „/biuro → …" z kodu serwera i sprawdza go wobec paska zakładek.
Martwa instrukcja w stringu nie zapala dziś niczego: nie widzi jej ani
kompilator, ani przegląd kodu. Widzi ją wyłącznie człowiek, który ma już
problem i szuka wyjścia.

Wdrożenie: nic ręką. Sama aktualizacja usług. Jeśli w katalogu NAD instalacją
leży inny `wertis.env`, zostanie teraz zauważony — sprawdź `configZPliku`
w `/api/health` po restarcie.

## 0.153.0 — 1 września 2026

**Zwrot pokazuje CAŁE zamówienie, ze zdjęciami i drogą do Allegro.** Kolumna
ZAMÓWIENIE pokazywała dotąd goły identyfikator `7669d920-5cf4-11f1-…`, a towar
opisywała sama nazwa. Operator i tak otwierał panel Allegro, żeby zobaczyć, co
klient kupił i jak to wygląda — czyli robił dokładnie to, czego ten ekran miał
go pozbawić.

**Jedno pobranie zamówienia załatwia trzy rzeczy naraz.** Komplet pozycji, więc
widać, że klient kupił trzy rzeczy, a oddaje jedną. Koszt dostawy, czyli
brakujący składnik kwoty pełnej — do 0.151.0 ekran musiał pisać zdanie „bez
kosztu dostawy", bo ten stoi przy zamówieniu, nie przy zwrocie. I SKU
sprzedawcy, czyli mostek do kartoteki.

**Kartoteka wywiedziona z oferty przestaje być „następnym".** Schemat
`OfferReference` w specyfikacji, która weszła do repo w 0.151.0, ma pole
`external.id` — „identyfikator oferty w systemie sprzedawcy", u tej firmy
symbol z Subiekta. Projekt panelu §28 czekał na tę dokumentację od 0.141.0.

**Automat proponuje, człowiek zatwierdza — jednym kliknięciem.** Dopasowanie
niesie źródło i poziom pewności, jak żąda §11.3. Zero trafień i dwa trafienia
dają brak, nigdy pierwszy z brzegu; po nazwie towaru nie dopasowujemy wcale,
bo furtka na literówki prowadzi do CUDZEJ kartoteki i wysyła na halę zadanie
o cudzym towarze.

**Zdjęcia towaru wchodzą do panelu obsługi po raz pierwszy.** Miniatura
w wierszu kolejki, kafel przy pozycji, powiększenie po kliknięciu. Trasa
zdjęć stoi za sesją, więc obraz idzie przez `fetch` i `blob:` — gołe
`<img src>` dostałoby 401. Razem z nią przyszły trzy lekcje z panelu
magazynu, każda kupiona tam osobno: pamięć negatywu (o brak pytamy raz),
najwyżej trzy pobrania naraz (przy pierwszym trafieniu serwer ciągnie plik
z bazy firmy) i stały rozmiar kafla (rosnący przesuwa wiersze pod kursorem).

**Numer zwrotu i zamówienie są klikalne.** Nazwa pozycji prowadzi do oferty —
ten jeden adres opisuje specyfikacja, więc idzie bez znacznika. Adresy panelu
sprzedawcy to strony UI, których nie opisuje nikt, więc wzorce stoją
w konfiguracji i noszą `[WERYFIKUJ]`: gdy link trafi w 404, poprawia się to
wpisem w `wertis.env`, a nie nowym wydaniem. Obok UUID-a zamówienia stanął
przycisk kopiowania.

**[wymaga działania] Próg zwrotów przesuwa się z 20 lipca na 20 sierpnia
2026.** Decyzja właściciela. Mechanika progu przyszła w 0.152.0 i zostaje bez
zmian — to jest sama data, wpisana jako `ALLEGRO_ZWROTY_OD`, więc następne
przesunięcie też nie będzie wymagało wydania.

Zwroty sprzed tej daty przestaną być widoczne przy najbliższym przebiegu.

**[wymaga działania] Lądowiska przestają trzymać dane osobowe.** To jest
poprawka nieprawdziwego zdania: polityka danych z 0.150.0 mówiła „konta
bankowego i telefonu nadawcy nie pobieramy", a `allegro_zwrot.surowe_json`
zapisywało odpowiedź DOSŁOWNIE — razem z IBAN-em, właścicielem konta i jego
adresem. Model pracy był czysty, kopia zapasowa nie.

Od tego wydania obie odpowiedzi przechodzą przez czyszczenie, zanim trafią do
bazy: **wartość znika, klucz zostaje**. Lądowisko dalej niesie kształt, po
który istnieje. Lista pól idzie po NAZWIE, nie po ścieżce, żeby pole dodane
kiedyś przez Allegro pod tą samą nazwą odpadło samo. Wiersze zapisane
wcześniej trzeba usunąć ręcznie — mówi o tym `DEPLOY.md`.

To ten sam gatunek poprawki co w 0.143.0, gdzie szkic polityki twierdził, że
treści rozmów nie trafiają do bazy. Wtedy poprawiliśmy zdanie, bo kopia treści
była ceną za działający ekran. Tu poprawiliśmy kod, bo konto bankowe nie
kupuje nam niczego.

**Zwroty dostają pierwszą trasę zapisu.** Licznik tras zapisu w teście stał
na zerze od 0.150.0 i był umową, jak licznik `method:` dla panelu magazynu.
Jedynym zapisem jest potwierdzenie kartoteki — bez `tw_id` pozycja nie ma czym
pokazać zdjęcia. Werdykt, kwota, ocena hali i korekta nadal nie mają tu
trasy, a do Allegro z tego ekranu wciąż nie wychodzi nic.

**Trzeci ticker Allegro jest najrzadszy z całej trójki.** Dociąga wyłącznie
zamówienia do zwrotów, które już mamy, najwyżej dwadzieścia na przebieg — po
kilku przebiegach nie ma czego pobierać i milczy. Bezpiecznik jest tu po to,
żeby pierwsze uruchomienie nie wystrzeliło dziewięćdziesięciu żądań w jednym
ciągu z jednego adresu.
Pierwsze uruchomienie skrzynki wyciągnęło cztery rzeczy naraz.

### Granice czasu

Decyzja właściciela: **skrzynka pokazuje rozmowy od 1 września 2026, zwroty —
od 20 lipca 2026.** Obie daty to północ czasu lokalnego, w konfiguracji
zapisana w UTC (`ALLEGRO_INBOX_OD`, `ALLEGRO_ZWROTY_OD`), bo w tej strefie
przychodzą daty z Allegro.

Granica skrzynki stoi na WĄTKU, nie na wiadomości. Rozmowa z jakąkolwiek
wiadomością po progu wchodzi w całości, razem z wcześniejszym kontekstem —
agent, który widzi pytanie bez jego początku, odpowiada w ciemno.

Lista wątków przychodzi od najnowszego, więc skanowanie zatrzymuje się na
pierwszym wątku poniżej progu. To przy okazji naprawia drugą rzecz:
synchronizacja przestała przemielać całą historię konta przy każdym przebiegu.

**`ALLEGRO_ZWROTY_DNI_WSTECZ` znika.** Okno względne liczyło się wyłącznie przy
pierwszym przebiegu, bo dalej rządził kursor; próg bezwzględny obowiązuje
zawsze. Bez tej różnicy zwrot sprzed granicy wjeżdżałby przy pierwszej zmianie
po stronie Allegro. Zostawiony w `wertis.env` stary wpis zatrzyma start
z komunikatem — ciche zignorowanie znaczyłoby, że ktoś liczy na ustawienie,
które nic nie robi.

Migracja kasuje z bazy to, co sprzed granic. Kasuje, a nie ukrywa zapytaniem:
baza trzymająca co innego, niż widać na ekranie, to rozjazd, który potem
kosztuje wieczór. Liczba usuniętych wierszy idzie do audytu, bo to kasowanie
danych, a nie porządki. Utrata jest pozorna — cofnięcie progu i ponowna
synchronizacja sprowadzą je z powrotem z Allegro.

### Encje HTML — blizna kupiona DRUGI RAZ

Na ekranie stało `kt&oacute;ry`, `zam&oacute;wienia`, `&ndash;` — w każdej
polskiej wiadomości. Panel escape'uje przy renderowaniu, więc encja z bazy
wyświetla się dosłownie.

To nie było odkrycie. `odkodujEncje` leżała w `server/src/tekst.ts` od 0.127.0,
gotowa, ze słownikiem polskich encji i kompletem testów, a jej komentarz mówił
wprost: „nowa obsługa ma ją wziąć gotową, nie odkryć drugi raz na produkcji".
Lista blizn w `docs/obsluga-klienta.md` niosła ten sam wpis razem z wnioskiem:
dekodowanie przy wejściu, nie przy wyświetlaniu.

Nowa obsługa odkryła ją drugi raz na produkcji.

Dekodowanie wchodzi przy wjeździe do modelu pracy. Lądowisko `allegro_inbox_*`
zostaje surowe — to jedyny ślad, gdyby dekodowanie kiedyś skrzywdziło cudzy
tekst. Migracja odkodowuje wiersze już zapisane; warunek jest tak postawiony,
żeby drugie wejście nie zjadło znaku `&`, który należy do treści.

Specyfikacja tego nie zapowiada: `Message.text` to goły `type: string`, bez
słowa o HTML-u. Tak wygląda różnica między tym, co Allegro DEKLARUJE, a tym,
co przysyła — czyli luka, na którą odpowiada sonda, a nie `swagger.yaml`.

### Panel nie umiał nazwać powodu przez 62 przebiegi

Skrzynka stała, bo konto nie było sparowane. Serwer **znał to zdanie** i pisał
je do dziennika przy każdym przebiegu, razem z instrukcją, co kliknąć. Na ekran
trafiało słowo `failed`.

Złożyły się na to trzy rzeczy:

`allegro_inbox_sync_state` trzymała wyłącznie kod HTTP, a ta porażka kodu nie
miała — brak parowania, timeout i odmowa wersji zasobu to gołe wyjątki.
Dochodzi `last_error_text`; udany przebieg czyści je razem z licznikiem.

Wiersz podpisany „Połączenie Allegro" pokazywał stan SYNCHRONIZACJI. Prawdziwy
stan połączenia — ze stanami `niepolaczone` i `zle_srodowisko` — jechał w tej
samej odpowiedzi `/api/health` i nie był rysowany nigdzie. Teraz to dwa osobne
wiersze, a przy porażce bez kodu dochodzi trzeci: „Ostatni błąd" ze zdaniem.

Baner oferował SYNCHRONIZUJ TERAZ, czyli przycisk wywołujący dokładnie ten sam
błąd. Przy niesparowanym koncie przycisk znika, a baner pokazuje zdanie
z trasy zdrowia — to, które mówi, gdzie kliknąć.

### Nazwa pliku dziennika

`DEPLOY.md` kazał szukać awarii w `C:\wertis\logs\api.err.log`, a instalator
tworzy `wertis-api.err.log` — nazwą usługi. Ten sam dokument w innym miejscu
pisał już poprawnie. Właściciel dostał `PathNotFound` w środku diagnozy.

### Wdrożenie

Migracje robią się same, ale **`wertis.env` wymaga ruchu ręką**: usunięcia
`ALLEGRO_ZWROTY_DNI_WSTECZ`. Szczegóły w `DEPLOY.md`.

## 0.152.0 — 1 września 2026

Pierwsze uruchomienie skrzynki wyciągnęło cztery rzeczy naraz.

### Granice czasu

Decyzja właściciela: **skrzynka pokazuje rozmowy od 1 września 2026, zwroty —
od 20 lipca 2026.** Obie daty to północ czasu lokalnego, w konfiguracji
zapisana w UTC (`ALLEGRO_INBOX_OD`, `ALLEGRO_ZWROTY_OD`), bo w tej strefie
przychodzą daty z Allegro.

Granica skrzynki stoi na WĄTKU, nie na wiadomości. Rozmowa z jakąkolwiek
wiadomością po progu wchodzi w całości, razem z wcześniejszym kontekstem —
agent, który widzi pytanie bez jego początku, odpowiada w ciemno.

Lista wątków przychodzi od najnowszego, więc skanowanie zatrzymuje się na
pierwszym wątku poniżej progu. To przy okazji naprawia drugą rzecz:
synchronizacja przestała przemielać całą historię konta przy każdym przebiegu.

**`ALLEGRO_ZWROTY_DNI_WSTECZ` znika.** Okno względne liczyło się wyłącznie przy
pierwszym przebiegu, bo dalej rządził kursor; próg bezwzględny obowiązuje
zawsze. Bez tej różnicy zwrot sprzed granicy wjeżdżałby przy pierwszej zmianie
po stronie Allegro. Zostawiony w `wertis.env` stary wpis zatrzyma start
z komunikatem — ciche zignorowanie znaczyłoby, że ktoś liczy na ustawienie,
które nic nie robi.

Migracja kasuje z bazy to, co sprzed granic. Kasuje, a nie ukrywa zapytaniem:
baza trzymająca co innego, niż widać na ekranie, to rozjazd, który potem
kosztuje wieczór. Liczba usuniętych wierszy idzie do audytu, bo to kasowanie
danych, a nie porządki. Utrata jest pozorna — cofnięcie progu i ponowna
synchronizacja sprowadzą je z powrotem z Allegro.

### Encje HTML — blizna kupiona DRUGI RAZ

Na ekranie stało `kt&oacute;ry`, `zam&oacute;wienia`, `&ndash;` — w każdej
polskiej wiadomości. Panel escape'uje przy renderowaniu, więc encja z bazy
wyświetla się dosłownie.

To nie było odkrycie. `odkodujEncje` leżała w `server/src/tekst.ts` od 0.127.0,
gotowa, ze słownikiem polskich encji i kompletem testów, a jej komentarz mówił
wprost: „nowa obsługa ma ją wziąć gotową, nie odkryć drugi raz na produkcji".
Lista blizn w `docs/obsluga-klienta.md` niosła ten sam wpis razem z wnioskiem:
dekodowanie przy wejściu, nie przy wyświetlaniu.

Nowa obsługa odkryła ją drugi raz na produkcji.

Dekodowanie wchodzi przy wjeździe do modelu pracy. Lądowisko `allegro_inbox_*`
zostaje surowe — to jedyny ślad, gdyby dekodowanie kiedyś skrzywdziło cudzy
tekst. Migracja odkodowuje wiersze już zapisane; warunek jest tak postawiony,
żeby drugie wejście nie zjadło znaku `&`, który należy do treści.

Specyfikacja tego nie zapowiada: `Message.text` to goły `type: string`, bez
słowa o HTML-u. Tak wygląda różnica między tym, co Allegro DEKLARUJE, a tym,
co przysyła — czyli luka, na którą odpowiada sonda, a nie `swagger.yaml`.

### Panel nie umiał nazwać powodu przez 62 przebiegi

Skrzynka stała, bo konto nie było sparowane. Serwer **znał to zdanie** i pisał
je do dziennika przy każdym przebiegu, razem z instrukcją, co kliknąć. Na ekran
trafiało słowo `failed`.

Złożyły się na to trzy rzeczy:

`allegro_inbox_sync_state` trzymała wyłącznie kod HTTP, a ta porażka kodu nie
miała — brak parowania, timeout i odmowa wersji zasobu to gołe wyjątki.
Dochodzi `last_error_text`; udany przebieg czyści je razem z licznikiem.

Wiersz podpisany „Połączenie Allegro" pokazywał stan SYNCHRONIZACJI. Prawdziwy
stan połączenia — ze stanami `niepolaczone` i `zle_srodowisko` — jechał w tej
samej odpowiedzi `/api/health` i nie był rysowany nigdzie. Teraz to dwa osobne
wiersze, a przy porażce bez kodu dochodzi trzeci: „Ostatni błąd" ze zdaniem.

Baner oferował SYNCHRONIZUJ TERAZ, czyli przycisk wywołujący dokładnie ten sam
błąd. Przy niesparowanym koncie przycisk znika, a baner pokazuje zdanie
z trasy zdrowia — to, które mówi, gdzie kliknąć.

### Nazwa pliku dziennika

`DEPLOY.md` kazał szukać awarii w `C:\wertis\logs\api.err.log`, a instalator
tworzy `wertis-api.err.log` — nazwą usługi. Ten sam dokument w innym miejscu
pisał już poprawnie. Właściciel dostał `PathNotFound` w środku diagnozy.

### Wdrożenie

Migracje robią się same, ale **`wertis.env` wymaga ruchu ręką**: usunięcia
`ALLEGRO_ZWROTY_DNI_WSTECZ`. Szczegóły w `DEPLOY.md`.

## 0.151.0 — 1 września 2026

**Mapowanie odczytu skrzynki Allegro było błędne w każdym polu. Skrzynka nie
zapisała ani jednego wątku, odkąd powstała.**

Właściciel wgrał `swagger.yaml` — oficjalną specyfikację OpenAPI Allegro.
Rozstrzygnęła dwie sprawy naraz i obie inaczej, niż się spodziewaliśmy.

### Zgadnięta wysyłka była trafiona

`POST /messaging/threads/{id}/messages` przyjmuje `{ text, attachments? }`
i oddaje wiadomość z polem `id`. Dokładnie to zakłada kod od 0.148.0, napisany
z pamięci wbrew §8.2, na polecenie właściciela. Dwa znaczniki `[WERYFIKUJ]`
schodzą.

Doszedł jeden warunek, którego nie znaliśmy: `text` ma `maxLength` 2000 znaków.
Sprawdzamy go przed wysłaniem. Po wysłaniu jedyną informacją zwrotną byłoby 400
od Allegro i `send_failed` w kolejce — agent traciłby napisany tekst i nie
wiedziałby dlaczego.

### Nieoznaczony odczyt był zmyślony

Prawdziwe pole to `lastMessageDateTime`, nie `lastMessageDate`. Autora opisuje
`author.isInterlocutor`, nie `author.role` z `BUYER`/`SELLER`. Ofertę niesie
`relatesTo.offer.id`, nie `relatedObject`. Wiadomość ma własne `createdAt`
i `subject`, których nie czytaliśmy wcale. Odpowiedź nie ma `totalCount`.

`lastMessageDate` był trzecim parametrem wstawki wątku, więc `undefined`
wywracał zapis KAŻDEGO wątku — nie rzadkiego egzemplarza, tylko wszystkich.
Ta nazwa stoi w kodzie od pierwszego commita synchronizacji. Tabele
`allegro_inbox_*`, `conversation` i `message` są u klienta puste.

**To prostuje diagnozę z 0.149.2.** Tamten wpis mówi „Allegro przysłało wątek
bez tego pola". Nieprawda — pole nazywa się inaczej i nie przysyła go żaden
wątek. Sama poprawka z 0.149.2 była potrzebna i zostaje: bez niej ta zmiana
zamieniłaby awarię głośną w cichą.

### Schemat obalił też nasze poprawki

Pierwsza wersja tej zmiany zakładała, że wątek bez daty jest uszkodzony
i należy go pominąć. Schemat `Thread` wymaga WYŁĄCZNIE `id` i `read`;
`lastMessageDateTime` i `interlocutor` są opcjonalne i jawnie `nullable`. Wątek
świeżo założony nie ma jak mieć ostatniej wiadomości — pomijanie go znaczyłoby
rozmowę, której panel nie pokazuje. Obie kolumny dopuszczają teraz NULL.

### Zmiany w bazie

`allegro_inbox_message` traci `author_role` i `read` — dwa pola, których
Centrum wiadomości nie przysyła — a zyskuje `author_is_interlocutor`, `status`,
`created_at` i `subject`. `allegro_inbox_thread` traci `NOT NULL` na dacie
i loginie rozmówcy. Obie przebudowy przepisują wiersze zamiast kasować tabelę:
gdyby gdzieś stał wiersz z ręcznego eksperymentu, kasowanie zabrałoby też
`surowe_json`, czyli jedyny ślad prawdziwej odpowiedzi Allegro.

`message.sent_at` bierze `createdAt` wiadomości, a nie datę wątku — do tej pory
wszystkie wiadomości rozmowy miały jedną godzinę i oś czasu była zmyślona.
`conversation.subject` bierze temat, a nie login rozmówcy.

### Skąd to się wzięło

`docs/allegro-ksztalt.md` przedstawiał się jako „raport zanonimizowanej
odpowiedzi produkcyjnej" i jako „jedyny kontrakt mapowania". Powstał w tym
samym commicie co kod i fixture'y, a `npm run sonda` — narzędzie napisane
właśnie po to, żeby ten raport wyprodukować — nigdy przeciw temu kontu nie
pobiegła.

To ta sama blizna trzeci raz. Za drugim razem założenie nosiło `[WERYFIKUJ]`
i było uczciwe. Za trzecim nosiło etykietę „raport z produkcji" — i dlatego
nikt go nie sprawdził. Znacznik mierzy to, komu się przyznano, a nie to, co
jest sprawdzone.

Ciekawostka nie bez znaczenia: wymyślone `author.role` z `BUYER`/`SELLER`
odpowiada wersji `beta.v1` zasobu, która naprawdę istnieje i ma inny kształt
niż `public.v1`, którym chodzimy. Zgadywanie trafiło w kształt prawdziwy —
tylko nie w ten, który dostajemy.

### Specyfikacja wchodzi do repo

`docs/allegro/swagger.yaml` — kopia oficjalnej specyfikacji OpenAPI Allegro,
1,5 MB i 40 842 linie, wraz z notatką o pochodzeniu i odświeżaniu
w `docs/allegro/README.md`.

To jest ta część, która naprawia PRZYCZYNĘ, a nie kolejny jej skutek. Trzy razy
z rzędu mapowanie powstawało ze zgadywania, bo `developer.allegro.pl` jest
nieosiągalny z maszyny, na której pisze się kod. Teraz kształt pola sprawdza się
odczytem pliku.

Plik jest CUDZY i ma cudzy zostać. Sumę kontrolną pilnuje `tools/docs_check.py`
— nie dla bezpieczeństwa, tylko dlatego, że przy czterdziestu tysiącach linii
poprawka wsunięta w środek nie ma szans zostać zauważona w przeglądzie zmian.
Od tej chwili mapowanie stałoby znowu na czymś wymyślonym, tyle że wyglądającym
na dokumentację. `.gitattributes` oznacza plik jako obcy, żeby nie zalewał
diffów ani statystyki języków.

`CLAUDE.md` mówi teraz wprost, jak z tego korzystać: czytać SCHEMAT, nie
przykład, bo przykłady Allegro bywają niezgodne z własnym schematem; sprawdzać
listę `required`, bo tylko ona mówi o wymagalności; pamiętać, że `public.v1`
i `beta.v1` to bywają różne kształty, a nie warianty.

Czego kopia NIE zastępuje: sondy. Specyfikacja mówi, co Allegro deklaruje,
a nie co dostaje konto firmy — które pola bywają puste i dokąd sięgają
uprawnienia. Znaczniki `[WERYFIKUJ]` zdejmuje `npm run sonda`, nie ten plik.

Wdrożenie: nic ręką, migracja robi się sama. **Skrzynka zapełni się historią,
której panel do tej pory nie pokazywał ani razu.**

## 0.150.0 — 1 września 2026

**Zwroty Allegro wracają — jako kolejka decyzji, nie jako rejestr.** Panel
obsługi dostaje trzecią zakładkę: ZWROTY. Biuro widzi wszystkie zwroty
klienckie razem z terminem ustawowym, nie otwierając panelu Allegro. To jest
odpowiedź na pytanie §6 z `docs/obsluga-klienta.md`, jedyne z ośmiu, które od
0.140.0 stało puste.

**Zwrot jest dwoma bytami o jednym numerze i ekran to pokazuje.** Sprawa
klienta żyje w Allegro, proces magazynowy w Subiekcie, a WERTIS trzyma wiersz
spinający oba. Trzeciego obiegu magazynowego nie ma: towar wraca na półkę
dalej wyłącznie dokumentem MM ZWROTY, a ocena pójdzie istniejącym zadaniem
terenowym. Rejestr skasowany w 0.140.0 próbował być naraz kartą zwrotu,
dokumentem i kolejką korekt — ten nie próbuje.

**Praca dzieli się na kubełki, a w kubełku stoi jedno pytanie.** Rejestr każe
najpierw znaleźć zwrot, potem wybrać akcję z menu — dwa kliknięcia przed
jakąkolwiek decyzją. Tu operator nie wybiera, co zrobić: kubełek już to
powiedział. Wiersz przyjeżdża z policzoną kwotą, więc typowy zwrot ma być
jednym klawiszem. Strzałki chodzą po kolejce, cyfry przełączają kubełek.

**Kolejność bierze się z zegara ustawowego, nie z daty wpływu.** Zwrot
z dwoma dniami zapasu stoi nad wczorajszym. To blizna 0.121.0 zastosowana do
zwrotów: ustawowy termin jest osobnym bytem i steruje kolejnością pracy.
Liczbę dni podaje `ZWROT_TERMIN_DNI`, bo to liczba z prawa, a nie z kodu.

**Sygnały są trzy, bo czwarty nie miałby z czego się zapalić.** Termin blisko,
towar jeszcze nie wrócił, sprawa rozstrzygnięta już w panelu Allegro.
Rozjazd liczby sztuk czeka na ocenę hali. Kolor zapalany zawsze uczy
operatora go ignorować.

**Mapowanie pochodzi z oficjalnej specyfikacji Allegro, nie z pamięci.**
`developer.allegro.pl` jest niedostępny z sieci, w której powstał ten kod,
więc pola odczytano z publicznej kopii wygenerowanego klienta OpenAPI.
Spełnia to regułę §8.2 projektu panelu, ale kopia ma dwa lata — rzeczy od
niej młodsze noszą `[WERYFIKUJ]`. Licznik w preambule
`docs/subiekt-gt-struktura.md` urósł z ośmiu na trzynaście i zejdzie po
pierwszym `npm run sonda` na żywym koncie.

**Synchronizator idzie kursorem, nie offsetem.** Allegro przyjmuje przy liście
zwrotów parametr `from` — identyfikator ostatnio widzianego zwrotu. Offset
gubi rekord, gdy w środku strony pojawi się nowy; kursor nie. To blizna
0.127.0 zdjęta u źródła, a nie obchodzona bezpiecznikiem. Bezpiecznik i tak
stoi: dziesięć stron na przebieg.

**Konta bankowego i telefonu nadawcy nie pobieramy.** Odpowiedź Allegro niesie
przy zwrocie IBAN, właściciela konta i jego adres, a przy paczce telefon
nadawcy. Zwrot da się rozstrzygnąć bez nich. Kolumn na te pola nie ma wcale,
więc nieuważne mapowanie wywali się na zapytaniu, zamiast wyciec po cichu do
kopii zapasowej. Zostaje sam fakt powrotu paczki.

**To wydanie wyłącznie czyta.** Ani jednej trasy zapisu, ani jednego żądania
POST do Allegro — pilnuje tego test tras, tak jak licznik `method:` pilnuje
panelu biura. Werdykt, kwota, ocena i korekta wchodzą w 0.151.0; kolumny
i klawisze już na nie czekają, a ekran mówi o tym wprost zamiast pokazywać
przyciski, które nie działają.

**Nazwy `zwrot` i `zwrot_pozycja` są spalone na zawsze.** Migracja kasująca
obsługę klienta chodzi przy KAŻDYM starcie, bo bazy klientów wciąż mają tamte
tabele. Tabela nazwana tak samo powstałaby ze schematu i znikała sekundę
później, po cichu i bez błędu, z pustym ekranem jako jedynym objawem. Zwroty
wróciły więc jako `zwrot_klienta`, a strażnik tej miny stoi w
`db/migracja-zwrotow.test.ts`.

**Drugi ticker Allegro ma inny rytm, nie tylko inne przesunięcie.** Zwroty
tykają co pięć minut, skrzynka co minutę: zwrot ma termin w dniach, pytanie
klienta czeka na odpowiedź. Równy chór dwóch pętli z jednego adresu to ta
sygnatura maszyny, która w sierpniu 2026 skończyła się blokadą IP.

**Aktywna zakładka panelu przestaje wynikać z liczby zakładek.** Wyrażenie
wybierające ją działało dla dwóch i przy trzeciej podświetlałoby ZADANIA na
ekranie zwrotów. Mina uzbrojona od 0.146.0, rozbrojona przy pierwszym
ekranie, który ją uruchamiał.

**Licznik `[WERYFIKUJ]` przestaje kończyć się na dziewięciu.** Słownik
liczebników w `tools/docs_check.py` nie znał większych liczb, więc pierwsza
sekcja przekraczająca próg zatrzymywałaby bramkę — a jedynym wyjściem
wyglądającym na łatwe byłoby skasowanie znacznika. Licznik ma zmuszać do
sprawdzenia rzeczy, nie do jej ukrycia.

**Konto kanału ma jedną funkcję zamiast dwóch kopii.** `kontoKanalu` stało
prywatnie w synchronizatorze skrzynki; zwroty potrzebują tego samego wiersza.
Druga kopia rozjechałaby się przy pierwszej zmianie klucza konta, a wtedy
rozmowy i zwroty tego samego sprzedawcy wylądowałyby na dwóch kontach.

**Nic ręcznego przy wdrożeniu.** Pięć nowych tabel dochodzi schematem, ticker
zwrotów startuje tylko przy sparowanym koncie Allegro w trybie `http`, a
domyślne wartości `ALLEGRO_ZWROTY_SYNC_MS`, `ALLEGRO_ZWROTY_DNI_WSTECZ`
i `ZWROT_TERMIN_DNI` działają bez wpisu w `wertis.env`.
## 0.149.2 — 1 września 2026

**Jeden zepsuty wątek przestaje zatrzymywać całą skrzynkę.**

Z dziennika produkcji, w kółko przez wiele przebiegów:

    [allegro-inbox] przebieg nieudany: Provided value cannot be bound to
    SQLite parameter 3.

Trzeci parametr wstawki wątku to `lastMessageDate`. Allegro przysłało wątek bez
tego pola, a `node:sqlite` nie umie związać `undefined`. Cała partia szła jedną
transakcją, więc wycofanie zabrało ze sobą wszystkie zdrowe wątki z tego samego
przebiegu — skrzynka stała, choć zepsuty był jeden wątek.

Projekt panelu żądał czegoś innego od początku: §9 mówi, że synchronizator
„izoluje błąd pojedynczego wątku". Teraz każdy wątek ma własną transakcję.
Zepsuty zostaje poza skrzynką, jego identyfikator idzie do dziennika, a przebieg
leci dalej i domyka się normalnie.

Kursor przestaje móc stanąć na wątku, którego nie zapisaliśmy. To osobna,
cichsza usterka tej samej sytuacji: §8.3 zabrania przesuwać kursor „po
niepełnym zapisie", a stary kod brał go z pierwszego wątku strony, nie pytając,
czy ten wątek w ogóle wszedł. Kursor stojący na pominiętym wątku zabrałby ze
sobą całą historię za nim.

`error_thread_count` dostaje wreszcie pisarza. Kolumna i wiersz „Wątki z błędem"
w panelu istnieją od 0.147.0 i do dziś pokazywały zero także wtedy, gdy skrzynka
gubiła wątki. Licznik stoi osobno od `error_count`, bo liczy co innego: przebieg
z pominiętym wątkiem domknął się i nie jest porażką przebiegu.

Czego to wydanie **nie** rozstrzyga: czy wątek bez daty ma prawo wejść do
skrzynki z pustą datą, czy słusznie zostaje odrzucony. To mówi specyfikacja
Allegro, której wciąż nie mamy — `developer.allegro.pl` jest niedostępny z
maszyny budującej, a `docs/allegro-ksztalt.md` nosi z tego powodu znaczniki
`[WERYFIKUJ]`. Do czasu odczytu kontraktu taki wątek jest odrzucany, czyli
zachowuje się tak jak dotąd; zmienia się wyłącznie to, że nie zabiera reszty
przebiegu ze sobą. Zgadywanie predykatu byłoby drugą pamięcią wpisaną w kod.

Wdrożenie: nic ręką. Sama aktualizacja usług.

## 0.149.1 — 1 września 2026

**Przycisk SYNCHRONIZUJ TERAZ przestaje zwracać „Bad Request".** Klient HTTP
panelu obsługi wysyłał nagłówek `content-type: application/json` przy każdym
żądaniu, także tym bez ciała. Domyślny parser Fastify odrzuca taką parę, więc
jedyne wywołanie bez ciała — ręczna synchronizacja skrzynki — kończyło się
kodem 400.

To jest przycisk z banera awarii, czyli ten, który ma pomóc, gdy synchronizacja
stoi. Nie działał dokładnie wtedy, gdy ktoś go naciskał.

**To była blizna kupiona drugi raz.** Panel magazynu naprawił dokładnie to samo
i nosi przy swojej funkcji `api()` zdanie „Kusi, żeby to uprościć z powrotem do
jednego obiektu. Nie upraszczaj". Kolektor zna tę regułę osobno i wysyła puste
ciało bez nagłówka typu. Panel obsługi był jedynym klientem, który jej nie znał.

Strażnik tamtej reguły czyta źródło `biuro.html` wyrażeniem regularnym, bo tego
pliku nie da się zaimportować — i dlatego nie miał jak objąć drugiego frontu.
Panel dostaje własnego, sprawdzającego zachowanie zamiast tekstu. `CLAUDE.md`
mówi teraz wprost, że dokładając front, dokłada się też jego strażnika.

## 0.149.0 — 1 września 2026

**Awaria Subiekta przestaje kłaść całe API.** Import read-modelu przy starcie
był twardym błędem: `main()` czekał na niego przed nasłuchem, a wyjątek kończył
proces. Jeden zerwany klucz obcy położył w ten sposób kolektory, które
o Subiekta nie pytają, i panel biura, który czyta własne tabele.

Nowa reguła: read-model ma prawo być nieświeży, API nie ma prawa nie wstać.
Dane sprzed ostatniego udanego importu zostają w bazie, a `/api/health` mówi
zdaniem, że tak jest. To ta sama lekcja co 0.53.1 — tym razem z mechanizmem.

**Trasa zdrowia nie pada w całości przez jeden licznik.** Zbiera kilkanaście
liczb z bazy i z adapterów; dotąd rzut jednej zabierał całą odpowiedź.
Instalator odróżnia wtedy martwy proces od zepsutego licznika tylko po tym, że
oba wyglądają identycznie. Blok, który padnie, zwraca puste pole i melduje się
zdaniem wśród problemów.

**`/api/health` dostaje pierwsze testy.** Nie miała ich wcale, choć to po niej
instalator poznaje, że system żyje.

**Status synchronizacji Allegro bierze kod z klasy błędu, nie ze zdania.**
Wyrażenie szukające kodu w nawiasie łapało „(401)", ale nie „Allegro
odpowiedziało 503: …" — czyli milczało akurat przy odmowach, które ten status
ma nazywać.

**Instalator nie pobiera już przeglądarek Playwrighta.** Od 0.146.0 są
zależnością deweloperską panelu, a ich instalacja dociąga kilkaset megabajtów
Chromium, których magazyn nigdy nie użyje. CI blokuje to od początku, produkcja
nie blokowała wcale.

**Plik blokady dogania wersję i dostaje strażnika.** Został na 0.145.1 przez
trzy podbicia. `tools/docs_check.py` pilnuje teraz obu miejsc, w których numer
tam stoi — precedens bez mechanizmu wraca.

## 0.148.1 — 1 września 2026

**[wymaga działania]** API padało w pętli restartów po każdym starcie usług.
Aktualizacja do tej wersji naprawia to sama, przy pierwszym uruchomieniu.

**Zadanie terenowe blokowało import z Subiekta.** `zadanie_terenowe.tw_id`
wskazywał na `sgt_towar` bez `ON DELETE`, a import kasuje całą tę tabelę
i wstawia ją od nowa. Wystarczyło jedno zadanie ze wskazanym towarem, żeby
`DELETE FROM sgt_towar` padał na `FOREIGN KEY constraint failed`.

Import biegnie przed nasłuchem serwera, więc ten błąd kończył proces. NSSM
restartował usługę, import padał znowu, i tak w kółko. Z zewnątrz wyglądało to
jak martwe API, a instalator meldował „API nie odpowiedziało".

Klucz obcy dostaje `ON DELETE SET NULL` — tak samo, jak ta sama tabela trzyma
już powiązanie z rozmową i wiadomością. Zadanie niesie własny snapshot symbolu
i nazwy, więc po utracie powiązania nadal mówi hali, o co chodziło.

**Mina leżała uzbrojona od 0.141.0.** Wybuchła, gdy 0.145.0 dało agentom
wyszukiwarkę towaru, czyli pierwszy łatwy sposób na wpisanie `tw_id`. Cofnięcie
do wcześniejszej wersji jej NIE naprawiało — usterka jest starsza.

**Test odtwarza awarię, zanim ją naprawi.** `db/migracja-zadania.test.ts` stawia
bazę w kształcie z 0.141.0, sprawdza, że kasowanie towaru faktycznie pada,
i dopiero potem uruchamia migrację. Test, który nie umie pokazać usterki, nie
dowodzi jej naprawy.

## 0.148.0 — 1 września 2026

**[wymaga działania]** Wysyłka odpowiedzi do Allegro jest włączona. Od tego
wydania treść wychodzi z WERTIS na zewnątrz. Polityka danych w
`docs/obsluga-klienta.md` dostała osobny rozdział o tym, co dokładnie wychodzi
i na czyje kliknięcie.

**[wymaga działania]** Kształt żądania POST pochodzi z pamięci, nie
z dokumentacji Allegro. Decyzja właściciela, podjęta wbrew regule z rozdziału 8
projektu panelu. Mapowanie stoi w jednej funkcji, nosi znacznik `[WERYFIKUJ]`
i ma osobną sekcję w `docs/allegro-ksztalt.md`. Pierwsza wysyłka na produkcji
jest testem kontraktu — zrób ją świadomie, na rozmowie, którą znasz.

Jeśli kształt jest inny, Allegro odpowie 400 albo 422. Kolejka zapisze to jako
`send_failed` razem z odpowiedzią serwera i to ona poda właściwy kształt.
Do klienta nie wyjdzie nic po cichu.

**Podwójne kliknięcie nie tworzy drugiej odpowiedzi.** Klucz idempotencji
wylicza serwer z rozmowy, pytania i treści. Dwie zakładki i dwa kliknięcia dają
ten sam klucz, więc drugi strzał nie idzie do Allegro.

**Dopisek klienta zatrzymuje wysyłkę.** Serwer zwraca 409, szkic zostaje
nietknięty, a panel stawia dialog z porównaniem szkicu i nowej wiadomości.
Wysyłka mimo to wymaga zaznaczenia zgody — to blizna 0.110.0.

Kontrola świeżości porównuje ostatnią wiadomość KLIENTA, nie ostatnią w ogóle.
Inaczej własna odpowiedź blokowałaby kolejną w tej samej rozmowie.

**Po niejednoznacznym timeoucie nic nie idzie ponownie.** Próba zostaje w stanie
`send_uncertain` i blokuje kolejną, dopóki synchronizacja nie sprawdzi, czy
odpowiedź już jest w wątku.

**Wiadomość wychodząca powstaje tylko z numerem od Allegro.** Bez numeru
synchronizacja przyniosłaby ją drugi raz i na osi stanęłyby dwie.

**Szkic znika dopiero po udanej wysyłce.** Przy każdym innym końcu zostaje.

**Licznik `[WERYFIKUJ]` obejmuje teraz oba dokumenty kontraktowe.** Do tej pory
skanował wyłącznie `docs/subiekt-gt-struktura.md`, więc znacznik postawiony
gdziekolwiek indziej przechodził bez kontroli.

## 0.147.0 — 1 września 2026

**Awaria synchronizacji przestaje być cicha.** Po więcej niż dwóch nieudanych
przebiegach panel pokazuje trwały baner: ile przebiegów padło, dlaczego i jak
stare są dane na ekranie. Kolejka dostaje wtedy plakietkę „STAN Z", gasnie
i mówi, że dalsze wiersze mogą czekać w Allegro.

Pusta kolejka o 9:41 znaczy co innego, gdy synchronizator stanął o 7:05.
Do tej pory ekran nie odróżniał tych dwóch rzeczy.

**Synchronizacja ma status, a nie samą liczbę błędów.** Kod porażki rozstrzyga
przed jej liczbą: 401 znaczy „zawołaj admina", 429 znaczy „poczekaj". Statusy
pochodzą z rozdziału 7 projektu panelu.

**[wymaga działania]** Licznik błędów zeruje się przy udanym przebiegu. Do tej
pory klauzula zapisu go pomijała, więc rósł do końca życia bazy — pierwsza
w tygodniu odmowa Allegro zostawiała w panelu „błędów: 1" na stałe. Po
aktualizacji licznik pokazuje nieudane przebiegi Z RZĘDU. Istniejące bazy
wyzerują go przy pierwszej udanej synchronizacji.

**Ręczna synchronizacja z panelu.** Przycisk nie omija przerwy, o którą
poprosiło Allegro — skraca tylko czekanie po jej końcu. Ekran mówi to wprost.

**Przegrany wyścig o rozmowę pokazuje trzy rzeczy.** Kto prowadzi, kiedy
przejął i na której wersji stoi rozmowa wobec tej, którą niosło żądanie.
Czas bierze się z historii przypisań, nie ze znacznika zmiany rozmowy.

**Administrator może odebrać rozmowę, ale wyłącznie z powodem.** Powód idzie
do dziennika razem z autorem, czasem i wersją przed i po. Poprzednie
przypisanie zamyka się, zamiast zniknąć.

**Pytanie bez numeru oferty dostaje trzy wyjścia.** Agent wskazuje ofertę
ręcznie, wskazuje kartotekę wyszukiwarką albo dopytuje klienta. Wskazanie
ręczne zapisuje się jako wybór agenta i tak wygląda na osi — panel nadal nie
dobiera towaru z najdłuższych słów treści.

**`/api/health` raportuje stan integracji.** Status połączenia, ostatnia próba
z kodem, wiek danych, wątki z błędem, rozmowy oczekujące i wiek najstarszego
zadania. Panel pokazuje to w osobnym kafelku.

## 0.146.0 — 1 września 2026

**[wymaga działania]** Panel obsługi ma nowe zależności, więc po `git pull`
trzeba `npm ci`, a nie samo `npm run build`.

**Rozmowa ma własny adres.** `/obsluga/skrzynka/4821` otwiera tę rozmowę,
przetrwa odświeżenie strony i da się wkleić koledze. Do tej pory panel
zapisywał numer rozmowy w adresie i nigdy go stamtąd nie odczytywał, więc
odświeżenie wracało do pustego ekranu.

**Panel przestaje być trzema plikami.** `main.tsx` trzymał całą aplikację
w trzynastu linijkach, razem z logowaniem, ekranem zadań i nagłówkiem.
Teraz stoi tam sam router, a reszta mieszka w `api/`, `ui/`, `ekrany/`
i `skrzynka/`. Kolejne ekrany mają dokładać pliki, a nie puchnąć te same.

**Wspólny cache zapytań zastępuje odświeżanie co piętnaście sekund.** Lista
zadań odpytywała serwer zegarem, a skrzynka przeładowywała się w całości przy
każdym zdarzeniu. Teraz zdarzenie unieważnia dokładnie ten fragment, którego
dotyczy.

**Szyna zdarzeń łączy się ponownie po zerwaniu.** Wcześniej zerwany strumień
zostawiał ekran, który wyglądał na żywy i milczał do końca zmiany. Odczekiwanie
rośnie dwukrotnie do pół minuty, żeby padnięty serwer nie dostał pętli żądań.

**Formularze mają walidację w jednym miejscu.** Logowanie i zadanie dla
magazynu sprawdzają dane schematem, a nie warunkami wpisanymi przy wysyłce.

**Front dostaje testy — pierwsze w historii panelu.** Dziewięć testów Vitest
pilnuje kolejki i rozdziału trzech odpowiedzi serwera: wygasłej sesji,
konfliktu wersji i zwykłego błędu. Dwa testy Playwrighta sprawdzają, że
adresy ekranów prowadzą do panelu. Testy Vitest wchodzą do CI.

**Serwer przestaje wypisywać ścieżki ekranów z ręki.** Stały tam dwie sztuki
i każdy nowy ekran dawał 404 po odświeżeniu, dopóki ktoś nie dopisał go
w kodzie serwera.

**Tokeny makiet wchodzą do konfiguracji Tailwinda.** Barwy statusów rozmowy,
rangi wierszy stanu i tła wpisów osi mają jedno źródło.

## 0.145.1 — 1 września 2026

**Przejęcie rozmowy przestaje zapisywać się w ciszy.** Przejęcie, zapis szkicu
i komentarz wewnętrzny zostawiają wpis w dzienniku zdarzeń. Do tej pory
`services/conversations.ts` nie wołał `logEvent` ani razu.

To jest blizna 0.137.1 kupiona drugi raz. Wtedy trzy przejęcia sprawy
przechodziły bez śladu; teraz to samo dotyczyło rozmów z nowego modelu obsługi.
Dziennik niesie wersję rozmowy przed i po, ale nigdy treści — rozdział 19
projektu panelu zabrania wpuszczać wiadomości do ogólnego logu.

**Rozmowa zapisuje historię przypisań, nie samo pole właściciela.** Tabela
`conversation_assignment` stała pusta od 0.144.0, bo nikt do niej nie pisał.
Bez czasu przejęcia ekran przegranego wyścigu nie ma czego pokazać poza nazwiskiem.

**Trasy skrzynki i serwis rozmów dostają testy.** Osiem tras stało bez ani
jednego sprawdzenia, w tym bramka roli na odczycie. Nowe testy pilnują, że hala
nie zobaczy rozmów, że patrzenie na skrzynkę niczego nie zapisuje i że konflikt
wersji wraca jako 409 z właścicielem.

**`logEvent` przyjmuje bazę parametrem.** Bez tego audyt mutacji rozmowy pisałby
poza transakcją, która tę mutację obejmuje. Przy okazji `migrate` jest
eksportowane: baza zbudowana z samego `schema.sql` nie ma kolumny `user_ref`,
więc test na takiej bazie sprawdzał kształt nieistniejący na produkcji.

**Panel przestaje zamawiać dziewięć bibliotek jako `"latest"`.** Tak React
przeskoczył z 18 na 19 przy zwykłym `npm install`, bez decyzji i bez wpisu tutaj.

## 0.145.0 — 1 września 2026

**Agent przestaje wpisywać numer towaru z pamięci.** Formularz zadania
i zlecenie pomiaru ze skrzynki dostają wyszukiwarkę po symbolu, nazwie i EAN-ie.
Wybrany towar pokazuje symbol, nazwę i półkę, więc widać, co poszło na halę.

**Wskazana kartoteka jest podpisana nazwiskiem.** Zadanie zapisuje, że towar
wskazał agent, a nie że wynika z oferty Allegro. Gdy dojdzie kartoteka
wywiedziona z oferty, te dwie rzeczy nie będą wyglądać tak samo.

**Projekt docelowy panelu wchodzi do repo.** `docs/panel-obslugi-klienta.md`
opisuje skrzynkę zespołową, dobór części, bazę wiedzy, zadania terenowe
i granicę automatu. Rozdział 28 mówi, co z tego już działa i od której wersji —
w tym repo dwa razy zdarzyło się zbudować drugi raz coś, co stało.

**Osiem pytań z `docs/obsluga-klienta.md` ma pięć nowych odpowiedzi.** Bez
odpowiedzi zostaje pytanie o zwroty, których projekt nie dotyka, oraz połowa
pytania o gotowość: dopuszczalnej długości przerwy w pracy biura nikt nie nazwał.

**Panel kosztuje odtąd osiem bibliotek zamiast trzech.** Decyzja właściciela
zapisana w §7 razem z tym, co za nie kupujemy. Odwraca to odrzucenie TanStacka
z 0.143.0 — przedwczesny przestaje być, gdy ekranów jest kilka.

## 0.144.0 — 1 września 2026

**Rozmowy z Allegro trafiają wreszcie do modelu obsługi.** Synchronizator
zasila `channel_account`, `conversation` i `message`, a surowe `allegro_inbox_*`
zostaje lądowiskiem odpowiedzi kanału. Do 0.143.1 nikt nie zapisywał do
`conversation`, więc przejmowanie rozmowy i współdzielony szkic z 0.143.0 były
kodem nieosiągalnym: trasy przyjmowały liczbowy numer rozmowy, której nic nie
tworzyło.

**Agent przejmuje rozmowę, a drugi widzi właściciela.** Przejęcie rozstrzyga
warunkowy zapis, więc z dwóch kliknięć wygrywa jedno. Przegrany dostaje imię
właściciela zamiast cichej porażki, a nazwisko prowadzącego stoi też na liście.

**Szkic odpowiedzi jest współdzielony i trwały.** Zapisuje go właściciel
rozmowy, jawnym kliknięciem i z numerem wersji. Szkic napisany do
nieaktualnej osi zostaje odrzucony, zamiast nadpisać cudzą pracę.

**Panel mówi o nowej wiadomości, gdy ona przychodzi.** Zdarzenia idą jedną
szyną z serwera; otwarta rozmowa dostaje pasek „klient dopisał nową
wiadomość". Wcześniej agent dowiadywał się o niej przy następnym kliknięciu.

**Wynik z hali wraca na oś właściwej rozmowy kluczem obcym.** Zadanie ze
skrzynki niesie `conversation_id` i `message_id`, a nie samą nazwę źródła.

**Wysyłka do Allegro pozostaje wyłączona.** Nic z panelu nie wychodzi na
zewnątrz; polityka odpowiedzi ma najpierw stanąć w `docs/obsluga-klienta.md`.

## 0.143.1 — 1 września 2026

**Panel wchodzi do wspólnych poleceń.** `npm run dev` podnosi go razem z API
i workerem, więc rozwój nie wymaga już drugiego terminala ani pamiętania nazwy
workspace'u. `npm run build` budował go od 0.141.0 i to się nie zmienia.

**CI w końcu buduje to, co idzie na produkcję.** Do tej pory żadne zadanie nie
uruchamiało `npm run build`: kontrola typów używa konfiguracji deweloperskiej,
a wydanie idzie z `tsconfig.build.json` i przez Vite. Błąd w panelu albo
w buildzie serwera wychodził dopiero po `git pull` na produkcji.

**Zmiana w samym panelu nie uruchamiała żadnego zadania.** Workflow serwera nie
miał `panel/` na liście ścieżek — ta sama dziura, którą ten plik opisuje dla
`docs/`, otwarta ponownie przy drugim froncie.

**Panel traci własny numer wersji.** Miał 0.141.0, gdy reszta była na 0.143.0.
Numer stoi w korzeniu i w `server/`, a trzecia kopia to dokładnie ten mechanizm,
który raz już się rozjechał — opisuje to preambuła tego pliku.

## 0.143.0 — 1 września 2026

**Skrzynka obsługi klienta czyta rozmowy.** Panel pod `/obsluga/skrzynka`
pokazuje listę rozmów Allegro, oś czasu wybranej rozmowy i numer oferty przy
wiadomości. Ekran stoi w istniejącym panelu React, bez drugiego bundlera.

**Ekran czyta bazę, nie Allegro.** Rozmowy bierze z tabel, które wypełnia
synchronizator skrzynki. Dzięki temu otwiera się także wtedy, gdy Allegro nie
odpowiada, i pokazuje wprost moment ostatniej udanej synchronizacji.

**Pomiar zleca się z konkretnej wiadomości.** Kontekst składa serwer z bazy:
pytanie klienta w oryginale, numer oferty oraz namiary rozmowy. Agent podaje
tylko identyfikatory, więc nie wskaże hali cudzej oferty.

**Wynik z hali jest dopiskiem, nie podmianą.** Wraca na oś rozmowy jako osobny
wpis. Do szkicu odpowiedzi trafia wyłącznie na jawne kliknięcie agenta.
Wysyłka odpowiedzi do Allegro zostaje wyłączona w tym wydaniu.

**Zadanie ze skrzynki nie dostaje numeru kartoteki.** Synchronizator nie pobiera
ofert, więc mapowania oferta→kartoteka nie ma z czego zrobić. Ekran mówi to
wprost ostrzeżeniem, zamiast zgadywać.

## 0.142.0 — 1 września 2026

**Wraca fundament obsługi rozmów.** Baza rozróżnia kanał od konkretnego
konta kanału, więc firma może podłączyć więcej niż jedno konto Allegro.
Rozmowy, wiadomości, zdarzenia osi oraz historia przypisań mają osobne tabele.

**Synchronizację można bezpiecznie powtarzać.** Zewnętrzne identyfikatory są
unikalne w obrębie konta, a ponownie pobrana wiadomość nie tworzy kopii.

**Zadanie terenowe może wskazać rozmowę i wiadomość.** Wynik zadania trafia
na oś rozmowy jako osobne zdarzenie. Treść wiadomości klienta pozostaje
oryginalna. Zastane zadania zachowują dane i dostają puste powiązania.

**Wynik zapisuje nadal ten, kto zadanie przejął.** Zmiana dokłada oś rozmowy
do istniejącej ścieżki `wykonajZadanie`, zamiast otwierać drugą. Osobna
droga „zakończ zadanie" omijała bramkę własności i `logEvent` — nie weszła.

## 0.141.0 — 31 sierpnia 2026

**Pierwszy kawałek nowej obsługi klienta: zadania terenowe.** Biuro otwiera
osobny panel pod `/obsluga`, zbudowany w React i Tailwind CSS. Z panelu zleca
magazynowi pomiar, zdjęcie albo weryfikację fizycznego towaru.

**Zadanie trafia prosto na kolektory.** Bursztynowy baner pokazuje liczbę
oczekujących zadań na każdym ekranie. Magazynier przejmuje zadanie, widzi
symbol oraz półkę, a wynik odsyła bez komunikatora i bez zmiany aplikacji.

**Jedno zadanie ma jednego wykonawcę.** Warunkowy zapis w bazie rozstrzyga
wyścig dwóch kolektorów. Utworzenie, przejęcie, wykonanie i anulowanie zostawia
imienny wpis w audycie.

**Reguła „jeden front" zastąpiona regułą dwóch.** `biuro.html` zostaje bez
bundlera i obsługuje magazyn; obsługa klienta dostaje `panel/`. Uzasadnienie
wraz z kosztem stoi w `docs/obsluga-klienta.md` §7 — rozdziale, który
`CLAUDE.md` wskazywał jako jedyne miejsce na tę zmianę. Trzeciego frontu nie ma.

**[wymaga działania] Nowy APK.** Serwer udostępnia nowe API od razu po
aktualizacji. Zadania na hali wymagają aktualizacji aplikacji kolektora.

## 0.140.1 — 30 sierpnia 2026

**Sprzątanie po kasacji obsługi klienta.** Zero zmian w działaniu: 725 wierszy
mniej, żadnej nowej ani zmienionej funkcji. Wszystko, co tu ubyło, było
martwe od 0.140.0 — a martwy kod kłamie o tym, co aplikacja robi.

**Trzy sekcje ustawień, których nikt nie czytał.** `AI_PROVIDER`, `AI_MODEL`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` i `AI_TIMEOUT_MS` opisywały doradcę,
który odszedł razem z pytaniami klientów. Z nimi walidacja startu: serwer
odmawiał wstania przy `AI_PROVIDER` bez klucza, w imię funkcji, której nie
ma. To samo z `REKLAMACJA_DNI`, `BRAKUJACA_PACZKA_DNI`, `ALLEGRO_POLL_MS`
oraz kluczami read-modelu sprzedaży. Zostawione w `wertis.env` nic nie robią
i nie trzeba ich stamtąd usuwać.

**Numeratory korekty i RW.** `nextKorektaNumber` i `nextRwNumber` nadawały
atrapy numerów dokumentów zwrotu w trybie demo; razem z nimi znikają wiersze
`korekta` i `rw` z tabeli `counters`. Licznik `mm` i `karton` zostają — te
liczą na serio.

**Panel schudł o 328 wierszy stylów.** 106 reguł CSS nie miało prawa trafić
w nic: opisywały konsolę SPRAW, pasma pilności kolejki, czipy tagów, kartę
zwrotu i liczniki zakładek. Razem z nimi odeszły zdjęcia karty zwrotu
(`dolozZdjeciaZwrotu`) i pięć bloków komentarza opisujących sekcje ANALIZY,
których w pliku już nie było.

**Filtr OSOBA zniknął zamiast się chować.** Do 0.140.0 stał ukryty na stałe,
z komentarzem „nowa obsługa pewnie znów będzie mierzyć per osoba". Ukryte
pole, którego nic nie wypełnia, to obietnica bez pokrycia — nowa obsługa doda
własny filtr, gdy będzie wiedziała, co filtruje.

**Strażnik „konsola to tafle" przepisany na to, co zostało.** Pilnował dwóch
połówek: układu konsoli SPRAW i tego, że karta zostaje kartą. Pierwsza
połówka straciła przedmiot, druga jest ważniejsza niż była — na promieniu
i cieniu stoją dziś ANALIZA i STAN SYSTEMU.

**Zasada w `CLAUDE.md` o dublach nazw dostała drugą połowę:** panel nie może
też wołać funkcji, której nie ma. To strażnik z 0.140.0, który złapał dwa
takie braki przy cięciu.

## 0.140.0 — 30 sierpnia 2026

**Cała obsługa klienta skasowana.** Odchodzą pytania, dyskusje, opinie,
nakładka spraw z osią czasu i tagami, szablony, kanały, czasy obsługi,
a razem z nimi cały rejestr zwrotów Allegro: skan etykiety zwrotnej,
dopasowanie dokumentu sprzedaży, decyzje o pozycjach, korekty, zniszczenia,
zwrot środków, reklamacje, zapowiedzi i statystyki zwrotów. Ubyło blisko
dwadzieścia dziewięć tysięcy linii i ponad trzysta testów.

**Powód stoi w `docs/obsluga-klienta.md`.** Model danych opierał się na
kształcie JSON-a wymyślonym w naszych testach i nigdy nie sprawdzonym na
żywym koncie. Pytanie o rozrusznik bez numeru oferty było objawem, nie
przyczyną. Nowa obsługa ma powstać z raportu sondy (`npm run sonda`), pole po
polu, a nie z poprawiania starego kodu.

**[wymaga działania] Jedyną drogą towaru z powrotem na półkę jest teraz
dokument MM ZWROTY wystawiony w Subiekcie.** Ta droga działała już wcześniej
i nic w niej nie zmieniamy: biuro wystawia MM, pisze numer na kartce przy
koszu, hala rozkłada zawartość kolektorem. Znika natomiast druga droga —
przypinanie zwrotu do kosza z rejestru. Decyzje o pozycjach zwrotu, korekty
sprzedaży i zwrot środków robi się od tej wersji poza aplikacją: w Subiekcie
i w panelu Allegro.

**[wymaga działania] Zrób kopię bazy przed aktualizacją.** Migracja kasuje
osiemnaście tabel bezpowrotnie. Liczby, które w nich siedzą, zdejmuje
`npm run inwentarz` — uruchom go na KOPII sprzed aktualizacji, bo po niej nie
ma z czego ich odtworzyć.

**[wymaga działania] Opróżnij kolejkę z zadań `korekta_zwrot`.** Aplikacja
przestaje je nadawać, ale zadania nadane wcześniej niczego nie tracą — worker
Sfery umie je dalej. Zadanie stojące w błędzie rozstrzygnij przed
aktualizacją, bo karty zwrotu, z której było widać jego powód, już nie będzie.

**Kolektor bez zmian.** Zakładki SKAN, DOSTAWY, ZWROTY i KARTON nie dotykały
kasowanych tras. Nowego APK to wydanie nie wymaga.

**Panel schudł o połowę.** Zniknął widok SPRAW z całym szczegółem sprawy
i zwrotu, cztery rejestry per-typ, karta BRAKUJĄCE PACZKI i zakresy ANALIZY
liczone ze spraw. Zakładka REJESTRY odeszła razem z nimi, a karta KONTO
ALLEGRO przeniosła się do STANU SYSTEMU — ikona ALLEGRO w pasku prowadzi
tam, gdzie karta naprawdę stoi. Zostają DOSTAWY, MAGAZYN ZWROTÓW, ANALIZA,
DZIENNIK i STAN SYSTEMU.

**Konto Allegro zostaje.** Token nie należał do zwrotów: to jedno połączenie
konta sprzedawcy, z którego korzysta dziś sonda kształtu, a jutro nowa obsługa
klienta. Parowanie i rozłączenie dalej wymaga roli admin, sam stan czyta
biuro. Trasy przeprowadziły się z `routes/zwroty.ts` do `routes/allegro.ts`.

**Import z Subiekta czyta o dwa zapytania mniej.** Read-model dokumentów
sprzedaży (FS/PA) istniał wyłącznie po to, żeby dopasować zwrot do faktury.
Razem z nim przestają cokolwiek robić `DOK_SPRZEDAZ_DNI_WSTECZ`,
`MSSQL_SPRZEDAZ_NR_ORYG_COLUMN` i `MSSQL_SPRZEDAZ_UWAGI_COLUMN` — zostawione
w `wertis.env` są nieszkodliwe.

**Adapter Allegro zszedł do samego połączenia.** Kontrakt rozmów, zwrotów
i opinii wraz z kompletem funkcji `mapuj*` i adapterem dev odszedł, bo to on
był usterką. Zostają budowa URL-i, negocjacja nagłówka `Accept`, scope
w komunikacie 403 i jedno wyjście do sieci — czyli to, czego używa sonda.

**Nowy strażnik: panel nie woła funkcji, której nie ma.** Kasowanie ekranu
zabrało pomocników, z których korzystały ekrany zostające — i lista dostaw
przestała się rysować w ciszy, bo `rysujDostawy` wołało skasowany `wiekPytania`.
Test skanuje `<script>` panelu, pomijając komentarze i tekst dla człowieka,
i porównuje wywołania z definicjami. Złapał dwa takie braki w tym wydaniu.

**Licznik zapisów w `routes/biuro.test.ts` spadł z 47 na 16.** To nie jest
poluzowanie umowy „zero zapisu przy patrzeniu", tylko jej skutek: zniknęły
trasy, które te zapisy robiły. Szesnastym zostaje masowa zmiana lokalizacji
z 0.138.0.

**Tryb demo nie udaje już zwrotów.** Adapter dev odszedł razem z resztą,
więc karta KONTO ALLEGRO mówi wprost: bez danych Subiekta nie ma czego
parować. Do 0.139.0 zachęcała do skanu fikcyjnej etykiety, której nikt już
nie obsłuży.

## 0.139.0 — 30 sierpnia 2026

**Arkusz nie zdejmuje już adresów, o których nic nie wie.**

Zgłoszenie właściciela: „jeśli produkt ma kilka lokalizacji dodaj opcję aby
zaznaczyć które ma podmienić". To była realna dziura w 0.138.0.

**Kartoteka bywa w kilku miejscach naraz i nie wszystkie dotyczą regału, który
przestawiasz.** Obok adresu stoi paleta, bufor albo kod sprzed wzorca — w bazie
właściciela to `KT1`, `paleta64`, `PALETA65`. Arkusz z jednym adresem
podmieniał CAŁE pole, więc zdejmował je wszystkie. Po cichu, bo w arkuszu ich
nie widać.

**Kolumna ZDJĄĆ OBECNE w podglądzie.** Przy każdym wierszu stoją pola wyboru
z tymi obecnymi kodami, których w arkuszu NIE MA — czyli dokładnie z tymi,
które podmiana zdejmie. Zaznaczone znaczy „zdejmij" i takie są domyślnie:
arkusz nadal PODMIENIA pole, a to jest wyjątek od tej reguły, nie nowa reguła.
Odznaczenie zostawia kod obok adresu z arkusza.

**Kod obecny w arkuszu i w Subiekcie do wyboru nie trafia.** I tak zostaje,
więc pytanie o niego byłoby wyborem bez różnicy.

**Dla całego pliku dwa przyciski**, bo osiemdziesiąt wierszy odklikanych po
jednym to nie jest opcja: ZDEJMIJ WSZYSTKIE i ZOSTAW WSZYSTKIE.

**Zachowany kod wraca w oryginalnej pisowni** i liczy się do limitu pola.
Porównanie idzie bez względu na wielkość liter — bez tego `paleta64` znikał
mimo zaznaczenia „zostaw", bo pole w Subiekcie niesie kody pisane ręką przez
lata. Przepisanie ich wielkimi literami odpada: to byłaby zmiana danych,
o którą nikt nie prosił.

Wybory jadą na serwer mapą symbol–kody, OBOK wierszy. Plik CSV rozbiera
serwer, więc przeglądarka nie ma tam wierszy, do których mogłaby wybór
dokleić — jedna mapa działa tak samo dla obu wejść.

## 0.138.0 — 30 sierpnia 2026

**Masowa zmiana lokalizacji z arkusza — STAN SYSTEMU, tylko admin.**

Zgłoszenie właściciela: „dodaje arkusz z symbolami produktów i podmienia mi na
lokalizacje wskazane w arkuszu". Przestawienie jednego regału to sto
kilkadziesiąt kartotek, a jedyną drogą była karta towaru na kolektorze, jeden
towar na raz. Dzień pracy zamiast dwóch minut.

**Wgrywasz .xlsx wprost z Subiekta — bez zapisywania jako CSV.** Arkusz
rozbiera PRZEGLĄDARKA, nie serwer: `.xlsx` to ZIP z XML-ami, a przeglądarka umie
oba (`DecompressionStream`, `DOMParser`). Na serwer jedzie lista symbol–adres,
nigdy bajty pliku. Ta sama zasada, dla której obrazy przerabia przeglądarka —
i dzięki niej serwer nadal ma dwie zależności, a strona zero. CSV też działa,
tą samą trasą.

**Kolumny rozpoznajemy po nagłówkach `Symbol` i `Lokalizacja`**, nie po literze
kolumny. Eksport o innym układzie wgrałby inaczej „Nazwę" jako adres — po cichu.

**Najpierw podgląd, dopiero potem zapis.** Widzisz tabelę BYŁO → BĘDZIE, a obok
niej dwie listy Z NAZWAMI: wiersze odrzucone z powodem i symbole spoza
kartoteki. To jest lista do poprawienia w arkuszu, więc liczba by nie
wystarczyła. Podgląd nie kolejkuje ani jednego zadania i nie zostawia wpisu
w audycie — wybranie pliku to jeszcze nie operacja.

**Wiersz z jednym złym adresem odpada W CAŁOŚCI.** „A05-02-02 PAL38II
A10-06-06" zapisane bez palety byłoby cichym skasowaniem adresu, którego nikt
nie kazał kasować — a po zapisie nie ma go z czego odtworzyć.

**Wiersz, który niczego nie zmienia, nie jedzie do Subiekta.** Arkusz jest
EKSPORTEM, więc przy poprawianiu jednego regału większość wierszy niesie adres,
który już tam stoi. Bez tego jedno kliknięcie posyłałoby sto zapisów po nic.
Tak samo z wgraniem tego samego pliku drugi raz, zanim kolejka się wykona:
zmiany, które już w niej czekają, liczą się osobno i nie kolejkują się ponownie.

**Operacja należy do administratora**, nie do biura. Import zbiórek i reguły
strefy zmieniają dane, z których liczą się PODPOWIEDZI; ta zmienia adresy
w bazie firmy, a magazynier przy regale znajdzie towar tam, gdzie ten arkusz
powiedział. Kartę widać przy każdej roli — odmowę wypowiada serwer, zgodnie
z konwencją panelu.

Sprawdzone na prawdziwym arkuszu właściciela: 125 wierszy, 72 zmiany, 52
symbole spoza kartoteki i jeden odrzucony adres. Wdrożenie nie wymaga niczego:
zapis idzie istniejącym zadaniem `set_location`, na którego uprawnienie SQL
jest już nadane.
## 0.137.2 — 30 sierpnia 2026

**Dwa narzędzia i dokument, od których zaczyna się przebudowa obsługi
klienta.** Właściciel zdecydował o skasowaniu rozmów, spraw, rejestru zwrotów
i reklamacji, i zbudowaniu obsługi od nowa. Ta wersja nie kasuje niczego —
zbiera dowody, bez których nowe zasady byłyby kolejnym domysłem.

**Powód głębszy niż jedna usterka.** Pytanie o rozrusznik przyjechało bez
numeru oferty, choć mail z Allegro tę ofertę nazywa — i dopasowanie zeszło do
zgadywania z treści. Ale sedno jest inne: model danych stał na kształcie
JSON-a wymyślonym w naszych testach i nigdy nie sprawdzonym na żywym koncie.

**`npm run sonda` — kształt odpowiedzi Allegro, bez treści.** Wyłącznie GET po
siedmiu rodzinach końcówek. Wypisuje nazwy pól, typy oraz to, w ilu rekordach
pole było obecne i w ilu niepuste. Nie wypisuje wiadomości, loginów, nazwisk
ani numerów; wartości pokazuje tylko dla pól słownikowych pisanych wersalikami,
czyli enumów Allegro. Raport ma wejść do repo, więc te granice pilnują testy,
a nie ostrożność autora.

**Kolumna „niepuste" jest w tym raporcie najważniejsza.** Pole obecne
w każdym rekordzie, ale puste w połowie, wygląda w kodzie na pewne i pewne nie
jest. Dokładnie tak zachował się numer oferty przy pytaniach.

**`npm run inwentarz` — liczby, których po skasowaniu nikt nie odtworzy.**
Wpływ pytań, dyskusji, opinii, zwrotów i reklamacji miesiąc po miesiącu; ile
pytań miało numer oferty, a ile nie; ile trafiło w kartotekę; ile szkiców
poszło bez edycji; czasy odpowiedzi; decyzje na pozycjach zwrotu. I tabelka
najważniejsza dla magazynu: którędy napełniały się kosze — dokumentem MM
z Subiekta czy przypiętym zwrotem. Po cięciu zostaje tylko pierwsza droga.

**`docs/obsluga-klienta.md` — osiem pytań i lista blizn.** Dokument zasad
pisany od zera, z odpowiedziami jeszcze pustymi: każda ma się oprzeć na
dowodzie z sondy albo z inwentarza. Lista blizn spisuje trzynaście usterek już
zapłaconych wydaniem — nowy kod ma prawo wyglądać inaczej, ale nie ma prawa
kupić ich drugi raz.

**Klient HTTP Allegro wyszedł z klasy adaptera.** `zapytajAllegro` stoi teraz
na poziomie modułu, a metoda klasy jest jego delegatem. Sonda potrzebuje
dokładnie tej obsługi 401/403/406/429, a nie potrzebuje ani jednego mapowania;
drugi klient obok znaczyłby drugie miejsce, w którym trzeba pamiętać
o User-Agencie i o wersjach zasobów.

## 0.137.1 — 30 sierpnia 2026

**Trzy przejęcia sprawy zapisywały się w ciszy.** Audyt logu zdarzeń: stempel
prowadzącego przy PYTANIU, DYSKUSJI i OPINII zmieniał bazę i nie zostawiał
wpisu w dzienniku. Przy zwrocie i reklamacji zostawiał od początku. Dziennik
nie umiał więc odpowiedzieć „kto wziął tę sprawę i kiedy" dla trzech z pięciu
rejestrów — a to jest pytanie, dla którego ten log w ogóle istnieje.

**Wpis powstaje przy ZMIANIE ręki, nie przy każdym zapisie.** Stempel stawia
każdy zapis przy sprawie — tak ma być, bo nazwisko pojawia się z pracy, a nie
z zaglądania. Bezwarunkowy wpis dokładałby to samo zdanie po każdym kliknięciu
ZAPISZ. Zdarzeniem wartym audytu jest przejęcie; wpis niesie też nazwisko
poprzednika, więc widać, komu sprawa wypadła z rąk.

**Redakcja odpowiedzi w dyskusji brała sprawę drugą drogą.** Zapis odpowiedzi
ustawiał kolumnę `prowadzi` własną klauzulą UPDATE, obok funkcji stempla —
więc tędy sprawa zmieniała właściciela bez wpisu w dzienniku i bez zdarzenia
na osi czasu. Teraz obie drogi to jedna droga.

**Inwentarz w `docs/architektura-spraw.md` zmurszał i został poprawiony.**
Trzy zdania opisywały stan sprzed etapów B, D1 i D3: paginację dyskusji,
brak kontroli świeżości poza pytaniami i nierysowany blok klienta przy
dyskusji. Nieaktualny inwentarz podpowiada złą decyzję — dokument stoi na
przeglądzie kodu, nie na pamięci.

**Reszta zaległości okazała się wzorcem, nie długiem.** Usługi magazynowe
(kartoteka, strefa złota, zdjęcia, konta) logują z TRASY, nie z serwisu —
tak jak mówi komentarz przy `zapiszReguly`. Zmiana tego byłaby przepisywaniem
działającej konwencji, nie naprawą.

## 0.137.0 — 30 sierpnia 2026

**Tagi sterują kolejką.** Domknięcie etapu E5: do 0.136.0 tag było widać
dopiero po wejściu w sprawę, więc reguła tagująca nie zmieniała w kolejce ani
jednego piksela. Etykieta, której nie widać tam, gdzie się wybiera następną
robotę, jest ozdobą.

**Wiersz kolejki pokazuje etykiety sprawy.** Tę samą sumę tagów wszystkich
źródeł, co ekran sprawy — wiersz i szczegół nie mówią dwóch różnych rzeczy
o jednej sprawie. Tagi stoją na końcu stopki wiersza: termin i „klient
dopisał" odpowiadają, czy brać sprawę teraz, tag mówi tylko, czego dotyczy.

**Drugi rząd czipów filtruje po tagu.** Liczba przy tagu mówi, ile spraw pod
nim stoi, i liczy się z całej kolejki — wybranie tagu nie zeruje liczb przy
pozostałych. Czip jest przełącznikiem: drugi klik w ten sam tag zdejmuje
filtr, więc rząd nie potrzebuje pozycji „Wszystkie".

**Oba filtry się składają.** Rodzaj sprawy (albo MOJE) przecina się z tagiem,
bo „moje zwroty z etykietą #uszkodzenie" to pytanie, które biuro zadaje
naprawdę. Pusty wynik filtra mówi „Nic w tym filtrze", a nie „Żadna sprawa nie
czeka na obsługę" — pierwsze zdejmuje się klikiem, drugie znaczy, że kolejka
jest zrobiona.

**Rząd tagów znika, gdy tagów nie ma.** Pusty pasek filtrów uczy oko, że pasek
filtrów nic nie niesie. Z tego samego powodu filtr wskazujący tag, który
wypadł z kolejki, zdejmuje się sam, zamiast pokazywać pustą tabelę.

**Kolejka nie pojechała po tagi drugim zapytaniem.** Jadą razem z wierszami,
bo dwa zapytania potrafiłyby pokazać etykiety z innej chwili niż sprawy pod
nimi. Zero nowych zapisów — cała zmiana jest odczytem.

## 0.136.0 — 29 sierpnia 2026

**Tagi spraw i reguły ich nadawania.** Etap E5 z mapy
w `docs/architektura-spraw.md` — ostatni z pięciu kawałków etapu E.

**Tag jest etykietą problemu.** „uszkodzenie", „vip", „do windykacji" —
dopisuje się go przy sprawie jednym polem, a sprawa pokazuje sumę tagów
wszystkich swoich źródeł. Tag wisi przy ŹRÓDLE, nie przy sprawie, więc
przeżywa SCAL, ROZKLEJ i przebudowę nakładki spraw.

**Reguła szuka FRAZY, nie wyrażenia regularnego.** To jest decyzja, nie
uproszczenie: regexp w polu redagowanym przez biuro jest pułapką na dwa
sposoby — nikt go tam nie napisze poprawnie, a zły potrafi zawiesić serwer na
własnym backtrackingu. Fraza szuka się w tytule sprawy i loginie klienta, bez
rozróżniania wielkości liter, i daje się sprawdzić okiem przed zapisaniem.

**Reguła może przypisać sprawę osobie, ale nikomu jej nie odbierze.** Sprawa,
którą ktoś już prowadzi, zostaje przy nim. Tag nadany automatem jest podpisany
regułą, więc widać, czego nie zrobił człowiek.

**To jest CAŁA lista rzeczy, które automatowi wolno.** Zasada 6 mówi wprost:
tagowanie i przydział mogą być regułami, ale do klienta mówi wyłącznie
człowiek. Ani tag, ani przydział nie wysyłają niczego.

**Reguły chodzą po każdym pobraniu i na żądanie.** Nowa sprawa trafia na ekran
już otagowana; świeżo zapisaną regułę można sprawdzić przyciskiem ZASTOSUJ
TERAZ, bez czekania na następne pobranie.

## 0.135.0 — 29 sierpnia 2026

**Opinie o sprzedawcy jako piąte źródło sprawy.** Etap E4 z mapy
w `docs/architektura-spraw.md`. Do tej wersji opinii nie było w aplikacji
wcale: agent dowiadywał się o jednej gwiazdce z panelu Allegro albo od
właściciela, zwykle po fakcie.

**Zła ocena stoi przy sprawie, której dotyczy.** Opinia z numerem zamówienia
dopina się do sprawy tego zamówienia — widać ją przy zwrocie i przy dyskusji,
razem z resztą historii. Opinia bez zamówienia zostaje osobną sprawą: po samym
loginie automat nie skleja niczego.

**Rejestr jest cienki i to jest decyzja.** Opinia nie ma u nas mechaniki
(koszy, korekt, werdyktów) — ma trzy stany: NOWA, PRZEJRZANA, ZAŁATWIONA.
Cała jej wartość bierze się ze sklejenia w sprawę, nie z osobnego ekranu.

**Treść opinii trzymamy, treści rozmów nadal nie.** To nie jest wyłom
w prywatności, tylko inna klasa danych: rozmowa jest prywatna między nami
a klientem, opinia wisi publicznie na ofercie i widzi ją każdy kupujący.

**Odpowiadanie przez API czeka na weryfikację.** Końcówka odpowiedzi na opinię
jest niepotwierdzona na żywym koncie, a pisanie do klienta przez niesprawdzony
zasób to jedyny błąd, którego nie da się cofnąć. Odpowiedź piszesz w panelu
Allegro; w rejestrze oznaczasz, że sprawa jest załatwiona.

**Pierwsze uruchomienie przebuduje dwie tabele nakładki [wymaga działania:
nic, dzieje się samo].** SQLite nie umie dopisać wartości do ograniczenia
CHECK, więc `sprawa_zrodlo` i `sprawa_zdarzenie` powstają na nowo z piątym
rodzajem. Dane, wiązania ręczne i indeksy przechodzą w całości — pilnuje tego
osobny test na bazie w starym kształcie.

## 0.134.0 — 29 sierpnia 2026

**Czasy odpowiedzi jako piąty zakres ANALIZY.** Etap E3 z mapy
w `docs/architektura-spraw.md` — ile klient czekał na odpowiedź, na kanał
i na osobę.

**Liczone z osi czasu sprawy, bez nowej tabeli.** Fakt „klient napisał"
i „odpowiedzieliśmy" leży w `sprawa_zdarzenie` od 0.130.0 z dokładnością do
minuty i z nazwiskiem przy naszej stronie — raport tylko go czyta.

**Seria wiadomości klienta liczy się od PIERWSZEJ.** Kto pisze trzy razy pod
rząd, czeka od pierwszej próby, nie od ostatniej. Liczenie od ostatniej
dawałoby najlepszy wynik dokładnie tam, gdzie obsługa była najgorsza.

**Okno tnie po ODPOWIEDZI, nie po pytaniu.** Ta sama decyzja co przy czasach
zwrotów: przy cięciu po pytaniu rozmowy jeszcze nieodpowiedziane, czyli te
najwolniejsze, nigdy nie weszłyby do mediany. Cenę tego wyboru płaci tabela
KTO CZEKA TERAZ — najdłużej czekające na górze, kliknięcie wiersza otwiera
sprawę.

**Rozbiór per osoba z podstawą prawną przy danych.** Mediana z próbki poniżej
dwudziestu odpowiedzi jest podpisana jako niewiarygodna, a nota o monitoringu
pracowniczym jedzie razem z tabelą — nie obok niej.

## 0.133.0 — 29 sierpnia 2026

**Szablony odpowiedzi.** Etap E2 z mapy w `docs/architektura-spraw.md`:
gotowe teksty wstawiane do pola odpowiedzi jednym kliknięciem.

**Wybierak stoi przy każdym polu odpowiedzi** — przy pytaniu, przy dyskusji
i w bloku ODPOWIEDZ W SPRAWIE. Lista jest zawężona do kanału, w którym się
odpowiada; szablony oznaczone jako `dowolny` widać wszędzie. Tekst ląduje
w miejscu kursora, a nie zamiast całego pola.

**Pola w klamrach podstawia serwer.** `{{klient}}`, `{{zamowienie}}`,
`{{zwrot}}`, `{{oferta}}` i `{{ja}}` wypełniają się danymi tej sprawy —
tylko serwer wie, co w niej naprawdę stoi. Pole, którego sprawa nie zna,
ZOSTAJE w tekście jako klamra, a panel wypisuje, czego zabrakło. Pusty
łańcuch dałby zdanie z dziurą, które poszłoby do klienta niezauważone.
Zamaskowany login `client:44300444` nigdy nie trafia w powitanie.

**Redaguje biuro, nie admin.** Kto odpowiada klientom, ten wie, które zdania
działają — karta SZABLONY ODPOWIEDZI stoi pierwsza w ustawieniach, bo dopisuje
się do niej po każdej rozmowie, która się powtórzyła. Dodanie, edycja
i skasowanie zostawiają ślad w dzienniku zdarzeń.

**Wstawienie szablonu niczego nie zapisuje.** To odczyt — wysyła dalej
człowiek, osobnym kliknięciem i za potwierdzeniem. Automat nie mówi do
klienta sam i nic w tej wersji tego nie zmienia.

**Trzy szablony na start.** Nowa instalacja demo dostaje „Zwrot przyjęty",
„Prośba o numer zamówienia" i „Środki wracają dziś" — pusta lista uczyłaby,
że funkcji nie ma.

## 0.132.0 — 29 sierpnia 2026

**Zamówienie, płatność i paczka przy sprawie.** Etap E1 z mapy
w `docs/architektura-spraw.md`: nowa zwijana sekcja ZAMÓWIENIE I PRZESYŁKA
w szczególe zwrotu i dyskusji.

**Status płatności widać wreszcie w aplikacji.** Pole `payment` z zamówienia
Allegro leżało nietknięte od pierwszej integracji — a „czy klient zapłacił"
rozstrzyga rozmowę o zwrocie środków i o wysyłce za pobraniem. Sekcja pokazuje
kwotę, sposób zapłaty i to, czy pieniądze doszły, obok statusu zamówienia,
metody dostawy, nadanych paczek i ostatniego zdarzenia śledzenia.

**Numer zamówienia bierze się ze SPRAWY, nie z jednego rejestru.** Dyskusja
bez własnego `order_id` dostaje numer od zwrotu z tej samej sprawy — dokładnie
tak, jak sklejają je etapy C i D. Sprawa bez zamówienia (pytanie, zwrot ręczny)
mówi to wprost jednym zdaniem, zamiast pokazywać puste wiersze.

**Czyta się NA KLIK i nie zapisuje.** To jedyna sekcja spraw, która pyta
Allegro, więc jedzie dopiero po rozwinięciu — wejście w sprawę niczego nie
pobiera. Nic nie ląduje w bazie: status paczki i płatności starzeje się
w godziny, więc kopia u nas kłamałaby od pierwszego odświeżenia.

**Adres dostawy dalej nie przechodzi przez mapowanie.** Do odpowiedzi nie
jest potrzebny, a dane osobowe nie mają czego szukać w pamięci procesu —
ta sama granica, co przy przesyłkach klienta z 0.105.0. Pilnują jej testy
po obu stronach: adaptera i panelu.

## 0.131.0 — 29 sierpnia 2026

**Odpowiadasz z tego ekranu, na którym stoisz.** Etap D3 z mapy
w `docs/architektura-spraw.md`: jedno pole odpowiedzi z wyborem kanału.

**Zwrot dostał drogę do klienta.** Agent oceniający zwrot musiał dotąd
zgadnąć, że klient czeka w dyskusji tej samej sprawy, i przejść na drugi
ekran, żeby odpisać. Teraz pod oceną pozycji stoi blok ODPOWIEDZ W SPRAWIE
z polem gotowym do pisania — sam zwrot kanałem nie jest, bo nie ma przez co
napisać, ale sprawa zwykle ma dyskusję.

**Gwiazdka pokazuje, gdzie klient odezwał się ostatni.** Polecenie liczy się
z metadanych rozmów, więc nie kosztuje ani jednego zapytania do Allegro.
Kanał, w którym ostatnie słowo należy do nas, nie wygrywa polecenia — piłka
jest tam u klienta. Wybór zostaje przy człowieku: gwiazdka podpowiada, nie
decyduje.

**Ekran z własnym polem odpowiedzi nie dostaje drugiego.** Blok pokazuje
wyłącznie kanały INNE niż ten, w którym stoi otwarty szczegół, i jest
zwinięty do czasu kliknięcia. Dwa pola obok siebie byłyby pytaniem, w które
z nich pisać.

**Wysyłka idzie tą samą drogą co dotąd.** Odpowiedź z bloku wychodzi trasą
rejestru — kontrola świeżości, znacznik prowadzącego i wpis na osi czasu
działają identycznie jak przy własnym polu pytania czy dyskusji. Gdy w
międzyczasie przyszła nowa wiadomość, blok mówi o tym i pozwala wysłać mimo
to, dokładnie jak dotychczasowe pola.

## 0.130.0 — 29 sierpnia 2026

**Sprawa pamięta, co się w niej działo.** Etap D2 z mapy
w `docs/architektura-spraw.md`: nowa sekcja OŚ CZASU SPRAWY w szczególe
pytania, zwrotu i dyskusji.

**Jeden wykaz na wszystkie kanały.** Rejestry pamiętają OSTATNI stan:
`wyslano_at` mówi o ostatniej odpowiedzi, status o dzisiejszym statusie.
Historii nie pamiętał nikt. Teraz każda praca w sprawie zostawia ślad —
wpłynięcie, głos klienta, odpowiedź, szkic modelu, przejęcie, decyzja
o pozycji zwrotu, dokumenty, zwrot środków, werdykt reklamacji, zamknięcie
oraz SCAL i ROZKLEJ. Sprawa złożona ze zwrotu i dyskusji pokazuje jedną
listę z kolumną kanału, a nie dwie historie w dwóch miejscach.

**Treści rozmów tam nie ma i nie będzie.** Wpis mówi, ŻE klient napisał
i kiedy — nigdy CO napisał. Rozmowa dalej czyta się na klik z Allegro
i nie jest u nas zapisywana. Wiadomość od mediatora Allegro ma własny wpis,
bo to trzeci głos w sprawie, nie głos kupującego.

**Historia jedzie ze źródłem, nie ze sprawą.** Zdarzenie wisi przy zwrocie
albo dyskusji, więc SCAL i ROZKLEJ niczego nie przepisują: oś czasu sprawy
to suma zdarzeń jej dzisiejszych źródeł. Zapis jest idempotentny, więc
powtórzone pobranie nie dubluje wpisów.

**Sprawy sprzed aktualizacji też mają historię.** Pierwsze uruchomienie
przepisuje na oś czasu stemple, które rejestry już trzymały: kiedy sprawa
wpłynęła, kto ją wziął, kiedy poszła odpowiedź, kiedy ją zamknięto. Nic
ręcznego — i nic ponad to, co w bazie już było.

**Sekcja pobiera dane po rozwinięciu.** Ta sama reguła co przy historii
klienta i powiązaniach: wejście w sprawę niczego nie pobiera i niczego nie
zapisuje.

## 0.129.0 — 29 sierpnia 2026

**Kolejka układa się po tym, KTO MA RUCH.** Etap D1 z mapy
w `docs/architektura-spraw.md`: najważniejszym stanem sprawy jest piłka.

**Piłka: MY, KLIENT albo NIKT.** Liczy się przy każdym odczycie ze statusów
rejestrów i z metadanych rozmów (`watek_meta`) — nie ma kolumny, więc nie ma
czego przeterminować. Sprawa wielźródłowa bierze najostrzejszą piłkę
z otwartych źródeł: jedno pytanie bez odpowiedzi wystarczy, żeby cały problem
klienta czekał na nas. Piłka ŚWIAT (przewoźnik, Allegro) dojdzie później —
dziś nikt tych danych nie zapisuje.

**Pasma kolejki przeszły z wieku na piłkę × termin [zmiana kolejności].**
Góra kolejki zostaje bez zmian: PO TERMINIE, potem TERMIN ≤7 DNI, potem
TERMIN USTAWOWY. Zmienia się OGON — sprawy czekające na nas stoją nad
sprawami, w których piłka jest u klienta, a wiek dzieli je dopiero wewnątrz
piłki (ponad tydzień, kilka dni, dziś i wczoraj). CZEKA NA KLIENTA jest
zwinięte: to nie jest praca do zrobienia teraz. Pasmo BEZ POTWIERDZENIA
znikło — pytało „czy ktoś tu czeka", a na to odpowiada teraz piłka.

**POBIERZ DYSKUSJE trwa dłużej [wymaga działania: nic, tylko cierpliwość].**
Pobranie dociąga metadane rozmów otwartych dyskusji — kto powiedział ostatnie
słowo i kiedy — bo bez tego rejestr dyskusji nie wie, czyja jest piłka. Sufit
to sto rozmów na przebieg, więc przy większym rejestrze pełne pokrycie zbiera
się przez kilka pobrań; kolejne biorą najstarsze metadane. Treść rozmów dalej
czyta się na klik i NIE zapisuje. Linia pod tickerem mówi, ile rozmów
pobrano, ile odłożono na później i ile nie miało rozmowy.

**SCAL i ROZKLEJ pod podpowiedzią „ten sam kupujący".** Automat dalej skleja
wyłącznie po numerze zamówienia — dwa niezależne pytania jednego klienta to
dwa problemy. Gdy jednak to JEDEN problem, człowiek klika SCAL w sekcji
POWIĄZANE SPRAWY i sprawy zrastają się w jeden wiersz kolejki. ROZKLEJ cofa
całe scalenie: ręczne wiązania znikają, a rekoncyliacja układa źródła
z powrotem tak, jak widzi je automat.

**Rekoncyliacja domyka sprawy złożone z samych ręcznych wiązań.** Wcześniej
takie sprawy wypadały z denormalizacji i zostawały bez kupującego, numeru
zamówienia i daty zamknięcia. Poprawka wchodzi razem ze scalaniem, bo dopiero
ono pozwala takie sprawy w ogóle zbudować.

## 0.128.0 — 29 sierpnia 2026

**Kolejka pokazuje SPRAWY, nie obiekty Allegro.** Etap C z mapy
w `docs/architektura-spraw.md`: jednostką pracy jest problem klienta.

**Encja sprawy.** Nowe tabele `sprawa` i `sprawa_zrodlo` sklejają obiekty
rejestrów w problemy klientów — automatycznie WYŁĄCZNIE po numerze
zamówienia. Zwrot, dyskusja i reklamacja jednego zamówienia to odtąd JEDEN
wiersz kolejki z pastylkami pozostałych źródeł. Pytanie nie ma zamówienia,
więc zostaje osobną sprawą. Tabele utrzymuje idempotentna rekoncyliacja
wołana przy mutacjach; przy pierwszym starcie po aktualizacji nakładka
dogania zastane rejestry sama.

**Liczby w czipach i pigułce MALEJĄ po sklejeniu — to cel, nie usterka.**
Trzy obiekty jednego zamówienia liczyły się potrójnie; teraz liczą się raz,
bo tyle jest problemów do rozwiązania. Karty per-typ dalej mówią o obiektach.

**WEZMĘ TO bierze całą sprawę.** Przejęcie wiersza wielźródłowego stempluje
prowadzącego na sprawie i na KAŻDYM otwartym źródle naraz — połowiczne
wzięcie zostawiałoby drugą połowę problemu bez nazwiska.

**Odmaskowanie kupującego przy pytaniach.** Centrum wiadomości oddaje
rozmówcę jako `client:44300444`, więc pytanie nigdy nie spotykało zwrotów
tego klienta po loginie. Liczba spod maski to identyfikator kupującego —
nowa kolumna trzyma ją osobno, a jednorazowa migracja dosypuje ją do
zastanych pytań. W powiązaniach sprawy pojawia się sekcja „TEN SAM
KUPUJĄCY — podpowiedź spod maski": sam odczyt do obejrzenia, sklejenie
jednym klikiem (SCAL) wejdzie w etapie D.

## 0.127.0 — 29 sierpnia 2026

**Uszczelnienie wjazdu spraw: pełna lista dyskusji, czyste polskie znaki,
świeżość wysyłki po stronie serwera.** Etap B z mapy
w `docs/architektura-spraw.md`.

**Rejestr dyskusji widzi wszystko, nie pierwszą setkę.** Pobranie czytało
JEDNĄ stronę `/sale/issues` po 100 spraw — konto z większą liczbą gubiło
resztę po cichu. Teraz pobranie kartkuje do 10 stron (1000 spraw), z tym
samym bezpiecznikiem co przy zwrotach.

**Encje HTML znikają z ekranu.** Allegro potrafi oddać tekst z encjami
(`zwr&oacute;cić`), a panel słusznie escape'uje wszystko przy renderowaniu —
więc encja szła na ekran dosłownie. Dekoder rozbraja je przy wjeździe
w polach czytanych przez człowieka: tematy, treści, tytuły ofert. Id,
loginy i adresy zostają bajt w bajt. Zastane wiersze przelicza jednorazowa
migracja przy starcie; szkice i odpowiedzi redagowane ręką człowieka
świadomie nietknięte.

**Metadane piłki bez treści.** Nowa tabela `watek_meta` pamięta z każdej
rozmowy tylko: kto powiedział ostatnie słowo, kiedy i ile wiadomości padło.
Wypełnia ją synchronizacja pytań (rozmowa i tak przelatuje), odczyt rozmowy
na klik i wysyłka. Treść rozmów dalej czyta się na klik i NIE zapisuje —
decyzja właściciela: metadane tak, treść nie. To fundament pod pasma
„kto ma piłkę" z mapy etapów.

**Wysyłka do dyskusji pilnuje świeżości sama.** Dotąd kontrola działała
tylko, gdy przeglądarka przysłała id ostatniej widzianej wiadomości. Teraz
punktem odniesienia jest też `watek_meta` — serwer pamięta, co człowiek
czytał, więc odpowiedź na nieaktualną rozmowę dostaje 409 również bez id
z panelu. Nowość liczą wyłącznie cudze głosy: własna wiadomość nie blokuje
następnej odpowiedzi.

**Nieznane statusy Allegro świecą przy DYSKUSJACH.** Lista statusów
końcowych `/sale/issues` jest niezweryfikowana na żywym koncie. Wartości
spoza znanych list liczą się przy każdym pobraniu, zapisują w dzienniku
i pokazują czerwoną linią pod tickerem dyskusji — zgłoszenie ich pozwoli
potwierdzić listę i zdjąć znacznik osobną poprawką.
## 0.126.0 — 29 sierpnia 2026

**Rozwinięta pozycja przy rozkładaniu zeszła z 81 do 58 procent ekranu.**
Zgłoszenie właściciela: „otwarta pozycja zajmuje około 70 % ekranu, nie
powinno tak być".

Pomiar potwierdził. Karta wskazanej pozycji miała około 518 dp przy liście
mającej około 640 dp. Trzy rzeczy zabierały najwięcej, każda bez powodu.

**Adres stał na ekranie dwa razy.** Raz w 28 sp, raz w polu tekstowym pod
spodem, do którego kolektor sam go wpisywał. Pole chowa się teraz za napisem
„wpisz ręcznie" i otwiera samo w trzech sytuacjach: gdy towar nie ma adresu
w kartotece, gdy adres różni się od pickingowego (bo ktoś dotknął innej półki)
albo gdy człowiek poprosi. Skan regału działa bez zmian — to droga podstawowa,
a klawiatura jest wyjściem przy zdartej etykiecie.

**Trzy przyciski pełnej szerokości pod sobą.** Pełna szerokość należy się
czynności głównej, więc ODŁÓŻ TUTAJ ją zachowuje, a PÓŹNIEJ i POMIŃ stanęły
obok siebie po połowie. Zostają osobnymi przyciskami, bo znaczą co innego:
„później" zostawia pracę w koszu, „pomiń" oddaje ją biuru.

**Osiemdziesiąt dp na same odstępy.** Odstępy między blokami zeszły z 8 na
6 dp, a nagłówek STANY MAGAZYNOWE zniknął — kafelek niesie liczbę i kod
magazynu, więc podpisuje się sam.

Stany magazynowe i pozostałe półki zostają widoczne bez stukania. To było
osobne zgłoszenie z 0.118.0 i ta zmiana go nie cofa.

Ten sam ekran rozkłada kosze zwrotowe i kartony, więc zmiana dotyczy obu.

## 0.125.0 — 29 sierpnia 2026

**Nawigacja boczna zamiast górnego paska; SPRAWY rozprężone na trzy widoki.**
Pierwszy etap ewolucji spraw w system tiketowy — mapa całości w nowym
`docs/architektura-spraw.md`.

**Pasek boczny.** Górny pasek 52 px znika w całości; zakładki, stan SYSTEM
i ALLEGRO, zębatka i wylogowanie mieszkają w ciemnym pionie po lewej.
Zakładek zrobiło się siedem i poziomy rząd przestał je mieścić; pion grupuje
je w Pracę, Archiwum i Wgląd. Konsole liczą odtąd pełne `100dvh` — wysokość
chromu nad treścią przestała istnieć, więc pomiar `mierzChrome` zszedł.
Poniżej 1280 px pasek zwęża się do samych ikon z podpisem w dymku.

**SPRAWY = tylko praca agenta.** Zakładka trzymała naraz pracę trzech ról:
rozmowy z klientami, archiwum rejestrów i fizyczny magazyn zwrotów. Szyna
boczna znika; kolejka i alarmy stoją na pełnej szerokości. Wklejka z poczty
została trzecią ikonką narzędzi — to wejście nowej sprawy, nie archiwum.

**MAGAZYN ZWROTÓW** (nowy widok) — praca fizyczna: brakujące paczki, kosze
zwrotowe, pominięte pozycje. To powierzchnia do czytania i decyzji, więc
klasyczne karty, nie konsola. Alarmowość nie ginie: gdy coś czeka, pozycja
w nawigacji dostaje czerwoną kropkę.

**REJESTRY** (nowy widok) — archiwum czterech rejestrów i KONTO ALLEGRO.
Ikona stanu Allegro i pas „SPARUJ KONTO" prowadzą odtąd tutaj.

Testy-strażnicy nagłówka i zakładek przepisane na pasek boczny w tym samym
wydaniu — szósta odsłona usterki „delegacja została w starym domu" grozi
dokładnie przy takiej przeprowadzce.
## 0.124.0 — 29 sierpnia 2026

**Pozycja w kartonie schudła o jedną trzecią.** Zgłoszenie właściciela:
„otwarta pozycja w karton zajmuje za dużo miejsca".

Pomiar potwierdził zarzut. Karta miała 118 dp, z czego rząd chipów z adresami
zabierał 52 dp — 44 procent. Ta wysokość bierze się z minimalnego celu dla
palca, a w zbiórce chipy były nieklikalne: odkładanie zaczyna się dopiero po
ZATWIERDŹ. Karta płaciła rozmiarem kciuka za coś, czego żaden kciuk nie dotyka.

Adres zszedł pod nazwę, do tej samej kolumny, i drugi rząd zniknął razem
z odstępem. Karta ma teraz około 76 dp, czyli na ekranie mieści się **pięć
pozycji zamiast trzech**. Treść zostaje: adres pickingowy pełnym kodem
z bursztynową kropką, a reszta półek jako licznik („+2 półki").

Nazwa towaru zwija się teraz do jednej linii — druga wracałaby z połową
odzyskanego miejsca.

Rozkładanie kosza i kartonu chipy ZACHOWUJE. Tam są klikalne: wpisują adres
i pokazują stan zapisu, więc cel dla palca jest tam zarobiony.

## 0.123.0 — 28 sierpnia 2026

**Zbiórka do kartonu pokazuje półki, szuka jak człowiek i daje się odwołać.**
Trzy zgłoszenia właściciela po pierwszym dniu z KARTONEM.

**Adres na liście zbiórki.** Wiersz pokazywał symbol, nazwę i ilość, a pierwsze
pytanie przy pudle brzmi „na którą półkę to wróci". Adres pickingowy stoi teraz
wyróżniony, za nim reszta półek tego towaru. Dane jechały w tej samej
odpowiedzi serwera od pierwszego dnia — ekran ich nie rysował.

**Wpisywanie SZUKA zamiast dodawać w ciemno.** Pole wysyłało napis na serwer,
więc literówka albo pół nazwy kończyły się „Nieznany kod" — ta sama usterka,
którą 0.117.0 naprawiło w otwartej dostawie. Teraz wpis pyta wyszukiwarki
kartoteki: bez ogonków, symbol bez myślnika, furtka na literówki przy zerze
trafień. Wyniki są listą z miniaturą, symbolem, nazwą, półkami i stanem;
dotknięcie wiersza dokłada towar do pudła. Gdy trafienie wyszło z furtki,
lista mówi „nie znalazłem dosłownie — to są podobne".

Wybór z listy posyła identyfikator towaru, nie napis. Człowiek wybrał wzrokiem
i rozwiązywanie tego drugi raz mogłoby zmienić jego decyzję.

**ANULUJ KARTON.** Pudło otwarte przez pomyłkę albo porzucone nie miało jak
zniknąć — jedynym wyjściem było rozłożenie wszystkiego. Anulowanie działa na
każdym etapie, także w trakcie rozkładania, i pyta o potwierdzenie zdaniem,
które podaje liczbę pozycji. Pusty karton znika z bazy; karton z zawartością
zostaje ze statusem ANULOWANY, bo ktoś te rzeczy zeskanował i biuro o to
zapyta. Pozycje już odłożone ZOSTAJĄ odłożone: towar stoi na półce naprawdę,
więc cofnięcie adresu zrobiłoby z niej kłamstwo.

Kod anulowanego kartonu wraca do obiegu — indeks unikalności pomija anulowane.

## 0.122.0 — 28 sierpnia 2026

**Kolektor dostał zakładkę KARTON: rozkładanie od zera.** Zgłoszenie
właściciela: „zdarza się, że towary, które ktoś źle zebrał, są odkładane przez
pakujących do jednego kartonu. Ktoś to potem musi rozłożyć na lokalizację".

Do tej wersji rozkładanie znało wyłącznie DOKUMENT: dostawę albo kosz zwrotowy
z przesunięcia MM. Pudło z towarem źle zebranym nie ma dokumentu i nigdy nie
będzie go miało — towar nie opuścił magazynu, więc nie ma czego przesuwać.
Nie miało więc jak trafić na kolektor i wracało na półki z pamięci.

Nowa zakładka prowadzi przez dwie fazy. NOWY KARTON otwiera puste pudło,
skanowanie dokłada zawartość (skan to jedna sztuka, drugi skan tego samego
towaru sumuje, większą liczbę wpisuje się z klawiatury), ZATWIERDŹ zamyka
listę. Od tej chwili karton jest zwykłym koszem do rozłożenia: ten sam ekran,
ten sam skan półki, ten sam ZAKOŃCZ.

Karton mieszka w tabeli `kosz` z nową kolumną `rodzaj`, bo rozkładanie obu jest
tą samą pracą — osobna tabela znaczyłaby drugi zestaw usterek w sześciuset
liniach. ZAKOŃCZ na kartonie **nie wystawia żadnego dokumentu** i pilnuje tego
test: MM ZWROTY→MAG zdjęłoby z bufora zwrotów stan, którego tam nigdy nie było.
Zapisuje się wyłącznie adres półki.

Biuro widzi kartony na liście koszy z pastylką KARTON i wyłącznie je ogląda —
zawartość zna hala. Zakładek na dolnym pasku jest teraz cztery.

## 0.121.1 — 28 sierpnia 2026

**Karta ROZŁOŻONE POZA WERTIS jest zwinięta.** Zgłoszenie właściciela:
„schowaj gdzieś rozłożone poza wertis".

To archiwum, nie praca: ta sama lista jedzie od 0.97.0 pod czipem „Poza
WERTIS" w tabeli dostaw, a karta niesie ponad to jedną rzecz — przycisk
PRZYWRÓĆ, którego nie da się sensownie wcisnąć w wiersz szyny. Rozwinięta
rosła z każdym zamknięciem i spychała REKLAMACJE, czyli wyjątki czekające na
człowieka, coraz niżej.

Liczba dokumentów stoi w nagłówku, więc zwinięcie niczego nie ukrywa: widać,
czy w ogóle warto tam zaglądać. Ten sam wzorzec, co rejestry per-typ w szynie
spraw — zwinięta sekcja NIE PYTA serwera.

## 0.121.0 — 28 sierpnia 2026

**Kolejka spraw dostała pasma pilności, przejmowanie spraw i wiersz, który
niesie treść zamiast myślników.** Zgłoszenie właściciela ze zrzutem produkcji:
„this is disaster" — 168 spraw w jednej płaskiej liście.

Zakładkę przeprojektowano wcześniej przy dziewięciu sprawach z ziarna i przy
tej liczbie czytała się dobrze. Przy 168 przestała odpowiadać na pytanie, dla
którego powstała — „co teraz zrobić" — i stała się zrzutem bazy.

**Pasma są WIDOKIEM istniejącego sortu, nie drugą regułą.** Sort po pilności
(termin, potem najstarsze) był poprawny od 0.108.0, tylko nigdzie nie było go
widać. Teraz kolejka rysuje granice tam, gdzie ten sam sort i tak je stawiał:
PO TERMINIE, TERMIN ZA ≤7 DNI, CZEKA PONAD TYDZIEŃ, CZEKA KILKA DNI, DZIŚ
I WCZORAJ. Pasmo bez spraw się nie rysuje, po terminie nie daje się zwinąć,
a domyślnie zwinięte jest tylko najświeższe — i to ono zamienia 168 wierszy
w ekran.

**Osobne pasmo dla dyskusji bez potwierdzenia.** Kolejka NIE WIE, czy dyskusja
czeka na nas: synchronizacja czyta status z Allegro, nie treść rozmowy. Pytania
mają ten mechanizm od dawna — rejestrujemy sprawę tylko wtedy, gdy ostatnie
słowo należy do klienta — dyskusje nie mają odpowiednika. Takie sprawy schodzą
pod kolejkę pracy zamiast udawać zadania.

**Kolumny TERMIN i PROWADZI zeszły z nagłówka.** Miały myślnik w każdym
wierszu i nie była to zapomniana wartość: zegar mają wyłącznie CLAIM-y
i reklamacje, a znacznik prowadzenia stawiało dopiero wejście w sprawę. Są
teraz pastylkami, które pokazują się tylko wtedy, gdy coś niosą. Odzyskane
~200 px poszło na treść sprawy — dwie linijki zamiast ucięcia na 90 znakach.

**Klika się cały wiersz.** Kolumna z bursztynowym OTWÓRZ zniknęła: bursztyn
znaczy w tym panelu „ta jedna rzecz do zrobienia", a powtórzony 168 razy
przestawał cokolwiek znaczyć.

**„WEZMĘ TO" — przejęcie sprawy z kolejki.** Znacznik, nie blokada: nie
odbiera nikomu dostępu, mówi tylko, że ktoś przy tej sprawie siedzi. Przy
kilku osobach w biurze to jedyna ochrona przed dwiema odpowiedziami na to samo
pytanie. Zwrot dostał przy okazji kolumnę `prowadzi` — jako jedyny z czterech
rejestrów jej nie miał, więc jako jedyny nie dawał się wziąć.

**CLAIM przestał wyglądać jak pogawędka** — ma ustawowy zegar 14 dni, a dostawał
tę samą plakietkę co zwykła dyskusja.

**Czipy niosą liczby**, bo „Dyskusje" bez liczby nie mówi, czy warto tam
patrzeć. Doszedł czip MOJE. Filtr jest odtąd stanem ekranu, nie zapytaniem:
jedno pobranie zamiast jednego na każde kliknięcie.

**Skan etykiety i wyszukiwarka klientów zwinęły się do ikon.** Rozwinięte na
stałe zajmowały ~110 px, zawsze puste, i spychały pierwszy wiersz pod krawędź.

**Alarm blokujący pracę jest wreszcie alarmem.** „Konto niesparowane — nie
odpowiesz na żadną z tych spraw" stoi pasem nad kolejką, nie szarą notką
w szynie. Pokazuje się wyłącznie wtedy, gdy praca jest naprawdę zablokowana.

**W szynie nie ma już uciętych tabel.** Brakujące paczki, pominięte pozycje
i kosze rysowały tam sześć kolumn w 352 px — wszystkie trzy ucięte, każda
z własnym przewijaniem. Dostały ten sam wiersz pionowy, co kolejka w szynie.

## 0.120.0 — 28 sierpnia 2026

**Zakładka USTAWIENIA to jeden arkusz, nie pięć pływających kartek.**

Zgłoszenie właściciela: „uporządkuj zakładkę ustawień w biuro, pozbądź się
zaokrągleń i niepotrzebnych marginesów". To trzecie takie zgłoszenie i dwa
pierwsze mają już odpowiedź w repo — konsola spraw w 0.112.0, cała zakładka
SPRAWY w 0.116.0. Została z nich reguła: **konsola pracy to tafle,
powierzchnia do czytania to karty.** Ustawienia były ostatnią zakładką, która
jej nie przeszła.

**Pięć kartek robiło z jednego kompletu pięć dokumentów.** Siatka rozkładała
je na monitorze na dwie kolumny różnej wysokości, każdą z własnym promieniem
i cieniem. A ustawienia są jedną rzeczą: kompletem wartości ustawianych raz
i obowiązujących wszystkich. Teraz są jedną taflą — jedna kolumna, sekcje
stykają się kreską, zero promienia i zero cienia.

**Arkusz ma szerokość do redagowania, nie do oglądania.** Sekcje są
formularzami, a rozciągnięte na monitor 2560 zostawiały metr pustego papieru
przy sześciopolowym formularzu i robiły z pola promptu linijkę na 300 znaków.

**Osiemnaście marginesów z palca zastąpiła jedna liczba.** Widok niósł
osiemnaście atrybutów `style` na 135 wierszach, w tym osiem różnych odstępów
— 4, 6, 8, 10 i 14 px. Żaden nie wynikał z reguły; każdy powstał przy
dopisywaniu kolejnej sekcji. Rytm niesie dziś arkusz, więc następna sekcja
dostaje ten sam odstęp bez pamiętania o nim. W znaczniku ustawień nie ma już
ani jednego `style` — i pilnuje tego liczbowa asercja w teście.

**Pusty wiersz wyniku przestał zabierać odstęp.** Zdania o zapisie reguł,
zapisie logo i stanie konfiguracji pytań nie istnieją do pierwszej akcji,
a odstęp za nimi stał od początku.

**Promień zdjęty jest WYŁĄCZNIE tutaj.** `.card` to jedna klasa na cały panel,
więc globalne zero skasowałoby różnicę między stanowiskiem pracy a
zestawieniem do czytania. ANALIZA, NADZÓR i DZIENNIK zostają na kartach —
test pilnuje obu połówek naraz, tak jak przy konsoli.

## 0.119.1 — 28 sierpnia 2026

**Ikony SYSTEM i ALLEGRO przeniosły się do górnego paska, a biały pasek stanu
pod nim zniknął.** Zgłoszenie właściciela: „indykator system i allegro wrzuć
do top bara".

Pasm chromu było dwa: ciemny nagłówek z zakładkami i biały pasek pod nim
z dwiema ikonami stanu oraz plakietką odpowiedzi na notatki. Ten drugi był
PUSTY, gdy odpowiedzi nie było — czyli prawie zawsze — i kosztował ~43 px
na KAŻDEJ zakładce. Ta sama arytmetyka, która w 0.95.0 wygnała zakładki do
nagłówka.

Wszystkie trzy rzeczy stoją teraz w klastrze sesji, obok „kto" i WYLOGUJ —
tam, gdzie mieszka to, co dotyczy całej sesji, a nie jednego widoku.

**Spokojna pastylka jest obrysem, alarm zostaje wypełniony.** Na grafitowym
pasku biała pastylka byłaby jaśniejsza od zakładki bieżącej, czyli krzyczałaby
wtedy, gdy nie ma o czym. Wypełnienie zostaje dla wyjątku — i jasna plama na
ciemnym tle jest mocniejszym alarmem niż na białym. Żadnego nowego koloru:
ta sama para, co dotąd.

**Poniżej 1280 px z pastylki zostaje sama kropka.** Zmierzone, nie
przewidziane: przy 1180 px nagłówek zawijał się do drugiego wiersza i oddawał
dokładnie te 43 px, po które ta zmiana przyszła. Schodzą napisy, nie ikony —
zgodnie z tym, po co ikony powstały w 0.114.0: kolor odpowiada na jedyne
pytanie biura, a treść i tak mieszka w tooltipie.

Zmienna `--hChrome` znaczy dalej „ile chromu stoi nad treścią", więc dziewięć
reguł konsoli nie musiało się o tej przeprowadzce dowiedzieć — o to chodzi
w mierzeniu wysokości zamiast wpisywania jej. `--hGora` zeszła razem z paskiem,
bo pozycjonowała wyłącznie jego.

## 0.119.0 — 28 sierpnia 2026

**Kolektor znowu widzi aktualizacje. Nie widział ich od 0.100.0.** Zgłoszenie
brzmiało „kolektor się nie aktualizuje po aktualizacji aplikacji" i było
dokładnie tym, na co wygląda: samoaktualizacja z 0.52.0 milczała od
osiemnastu wydań.

**Co się stało.** Numer wersji zamienia się na liczbę porównywalną w TRZECH
miejscach: przy budowaniu APK (`versionCode` w Gradle), na serwerze
(`services/aktualizacja.ts`) i na kolektorze (`core/update/Aktualizacja.kt`).
Przy wydaniu 0.100.0 dwa pierwsze przeszły na wzór z zapasem 999 — bo przy
starym `0.100.0` dawało 10 000, dokładnie tyle co `1.0.0`. Trzecie miejsce
zostało przy zapasie 99.

Skutkiem nie był zły numer, tylko CISZA. Człon powyżej zapasu jest tam
odrzucany świadomie (kolizja czytałaby się jako „ta sama wersja"), więc
`0.100.0` i wszystko po nim znaczyło dla kolektora „nie rozumiem tego napisu".
A reguła samoaktualizacji przy każdej wątpliwości odpowiada „nie" — i to jest
reguła słuszna, bo instalacja wersji starszej kosztuje odinstalowanie aplikacji
razem z buforem offline. Kolektor nie miał więc czego pokazać: bez błędu, bez
wpisu w dzienniku, z jedynym śladem w postaci bursztynowego paska „wersje
różne", który świecił i nic z tym nie robił.

Wzór jest teraz ten sam we wszystkich trzech miejscach, a test w `:core` pilnuje
setnego minora wprost: `0.100.0` musi być większe od `0.99.0` i mniejsze od
`1.0.0`.

**[wymaga działania]** — kolektory z wersją od **0.100.0 do 0.118.0** trzeba
zaktualizować RAZ ręką: przez MDM albo `adb install -r wertis-kolektor-0.119.0.apk`.
Poprawka jedzie w pliku, którego zepsuty kolektor sam nie pobierze. Od tej
jednej instalacji samoaktualizacja działa dalej sama. Urządzenia z wersją
0.99.0 albo starszą pobiorą 0.119.0 same, bez niczyjej pomocy.

## 0.118.0 — 28 sierpnia 2026

**Panel pozycji kosza zwrotów mówi wreszcie, gdzie ten towar jest.** Dwie
zmiany z hali: wszystkie półki zamiast samej pickingowej i stany magazynowe,
które widać.

**Kosz zwrotów pokazuje wszystkie półki towaru, nie samą pickingową.** Kartoteka
Subiekta trzyma kilka adresów rozdzielonych spacjami, a kolektor czytał z tego
pola wyłącznie pierwszy. Przy dostawie to wystarcza — karton jedzie tam, gdzie
towar ma być. Przy zwrocie nie: wraca jedna sztuka i najtaniej dołożyć ją tam,
gdzie ten towar JUŻ leży, bo półka pickingowa bywa pełna albo stoi w drugim
końcu hali.

Pozostałe adresy stoją teraz pod tym dużym, jako pastylki. **Dotknięcie wpisuje
adres w pole niżej, nie odkłada** — odłożenie zostaje przy skanie regału
i przycisku, bo dotknięcie jednego z kilku adresów obok siebie w rękawicy jest
zbyt tanie na czynność nieodwracalną.

Do tej wersji po tę samą wiedzę trzeba było wyjść z kosza do karty towaru,
czyli zgubić wskazaną pozycję i wrócić do niej skanem.

Lista adresów jest **żywa tak samo jak adres pickingowy**: zadanie czekające
w kolejce liczy się, zanim worker dopisze je do Subiekta. Serwer wyprowadza
obie rzeczy z jednego miejsca (`poleAdresow`), więc nie ma jak się rozjechać —
pokazujemy to, co BĘDZIE w kartotece, bo zapis jest opóźniony, nie niepewny.

**Stany magazynowe przestały być przypisem.** Stały pod adresem jako linijka
`MAG 12 · ZWR 3` drobnym, przygaszonym drukiem — a to jest liczba, na której
stoi decyzja: ile z tego kosza zostało jeszcze na regale zwrotów i czy na hali
w ogóle coś leży. Teraz każdy magazyn ma własny kafelek z liczbą w 20 sp
i kodem jako podpisem: pytanie brzmi „ile", a „gdzie" tylko rozstrzyga, którego
magazynu dotyczy.

**Regał zwrotów świeci bursztynem**, bo to jego licznik schodzi do zera w miarę
rozkładania. Kolektor poznaje go po ROLI z serwera, nie po kodzie — kod jest
napisem z konfiguracji klienta i porównywanie go w interfejsie byłoby magicznym
łańcuchem, który psuje się przy pierwszej zmianie w Subiekcie.

## 0.117.0 — 27 sierpnia 2026

**Filtr w otwartej dostawie wybacza to samo, co wyszukiwarka.** Zgłoszenie
z hali brzmiało „szukanie nie działa" i było trafne: pole nad listą pozycji
porównywało wpisany tekst DOSŁOWNIE, przez zwykłe „zawiera" na małych literach.
Wystarczyło każde z czterech odstępstw, które w magazynie są normą, żeby lista
wyszła pusta przy towarze leżącym w kartonie:

- `gaznik` nie znajdował `Gaźnika` — ogonków przy palecie nikt nie pisze,
- `ls51139` nie znajdował `LS51-139` — myślnik jest ozdobnikiem, nie treścią,
- `kosa spalin` nie znajdowało `Spalinowej kosy` — kolejność słów jest luźna,
- `gaznk` nie znajdowało niczego — literówka w rękawicy zdarza się co chwilę.

Serwer rozwiązał to samo dawno, dla wyszukiwarki kartotek. Te reguły przeszły
teraz do modułu `:core` i **filtr kolektora liczy dopasowanie dokładnie tak
samo**: składa polskie znaki, zwija myślniki i spacje w symbolach, a każde
słowo zapytania musi trafić osobno — w symbol albo w nazwę. Dwie różne
odpowiedzi na „czy ten towar pasuje" byłyby gorsze niż brak jednej: ten sam
towar szukany dwoma polami dawałby dwa różne wyniki.

**Literówka wchodzi DOPIERO przy zerze wyników** i to jest cała jej bezpieczna
postać — tak samo jak na serwerze. Dopasowanie rozmyte wmieszane w wynik
dosłowny wciąga sąsiadów (`gaz` łapie `gips`) i psuje trafienie, które było
dobre. Krótkie słowa nie mają do niej prawa wcale: jeden błąd na trzech znakach
dopasowuje pół kartoteki.

Ta sama zmiana obejmuje pole filtra na **liście faktur** — `fz214` znajduje
`FZ 214/MAG/08/2026`, a `ogrod` firmę `OGRÓD-POL`. Kolejność listy zostaje
nietknięta: filtr zawęża, a nie sortuje, bo trasa alejkami i grupa zrobionych
należą do rozkładania, nie do szukania.

## 0.116.0 — 27 sierpnia 2026

**Zakładka SPRAWY: jedna kolejka zamiast trzech, konsola na wysokość okna.**

Zgłoszenie właściciela: „uporządkuj zakładkę sprawy, usuń zaokrąglone końcówki
i marginesy, okno sprawy powinno mieć ograniczoną wysokość, reszta scrolowana".

Zakładka miała TRZY kolejki: wspólną „SPRAWY KLIENTÓW", kolejkę zwrotów
i skrzynkę pytań. Każda z własnym nagłówkiem, filtrem i kompletem wierszy,
a wszystkie pokazywały te same sprawy w innej kolejności. Wybór, w którą
patrzeć, był pracą samą w sobie i nie odpowiadał na pytanie „co teraz zrobić".

Zostaje jedna kolejka. Rejestry per-typ — zwroty, pytania, dyskusje,
reklamacje — zeszły do szyny po prawej jako **zwijane**: to archiwum, do
którego wchodzi się po zwrot rozliczony albo pytanie wysłane. Nic nie zginęło.

Narzędzia, które w nich mieszkały, przeprowadziły się do głowy kolejki, bo
należą do kolejki, a nie do rejestru: skan etykiety zwrotu, wyszukiwarka
klientów i rząd trzech pobrań z Allegro. Obok otwartej sprawy stoi teraz TA
SAMA kolejka, z której się do niej weszło — do tej wersji były to dwie różne
listy zależnie od typu sprawy.

Konsola z 0.112.0 obejmuje wreszcie CAŁĄ zakładkę, nie tylko stan po otwarciu
sprawy: pełny bleed, zero promienia, dwie tafle na wysokość okna, każda
z własnym przewijaniem. Strona nie przewija się wcale.

Przy okazji wyszła usterka starsza od tej zmiany. Strefa obok kolejki rozpina
się na 50 rzędów siatki, żeby objąć stos jej kart — a nadmiar jej wysokości
rozkładał się po pustych rzędach i robił **800 px pustego przewijania pod
konsolą**. Dotyczyło to także DOSTAW. Siatka konsoli ma teraz wysokość okna.

## 0.115.0 — 27 sierpnia 2026

**Skrzynka pytań ma wyszukiwarkę klientów.** Wpisujesz fragment loginu,
dostajesz listę pasujących klientów, klik otwiera Klienta 360.

**Domknięcie drogi, która była zbudowana w trzech czwartych.** Klient 360
istnieje od 0.109.0 i pokazuje wszystkie pytania, zwroty, dyskusje
i reklamacje jednego loginu — ale wchodziło się tam WYŁĄCZNIE klikiem w login
na otwartej sprawie. Żeby zobaczyć, co u kogoś słychać, trzeba było najpierw
znaleźć jakąś jego sprawę.

**A szuka się go zwykle wtedy, gdy nic otwartego nie ma.** Klient dzwoni
z pytaniem „co u mnie" — i właśnie ten przypadek był nieosiągalny. Dlatego
wyszukiwarka przeszukuje CAŁĄ historię, nie kolejkę: wynik „nic nie czeka ·
ostatnio 3 dni" jest tu równie dobrą odpowiedzią jak „1 sprawa czeka".

**Liczby zgadzają się z Klientem 360 z konstrukcji, nie z dobrych chęci.**
Wyszukiwarka woła tych samych budowniczych, co kolejka i karta klienta, tylko
z innym warunkiem `WHERE`. Gdyby przepisać warunki „otwartości" drugi raz,
pokazywałaby „3 otwarte" przy karcie wypisującej cztery — i rozjazd wyszedłby
dopiero komuś przy biurku. Pilnuje tego test porównujący obie liczby.

**Pole stoi NAD czipami**, bo to inna oś: czipy zawężają skrzynkę, a to z niej
wyprowadza. Wynikiem jest karta klienta, nie krótsza kolejka.

**Sprawy bez loginu nie wypływają w wynikach.** Wklejka ze screenshota i zwrot
ręczny trafiają do kubełka „bez klienta", który istnieje w Kliencie 360 — ale
nie ma nazwy, po której dałoby się go szukać, więc udawanie, że da się go
znaleźć, byłoby mylące. Fraza krótsza niż dwa znaki to pusty wynik, nie błąd:
jedna litera przeczesuje cztery rejestry i zwraca pół bazy.
## 0.114.0 — 27 sierpnia 2026

**Guzik POŁĄCZ Z ALLEGRO przestał umierać po restarcie serwera, a pasek stanu
zmienił rząd kafli na dwie ikony.** Obie rzeczy z jednego zgłoszenia
właściciela: „nie działa mi guzik do połączenia, jego miejsce jest mylące,
a pasek zredukuj do jednej ikony z tooltipem".

**Naprawa martwego guzika.** Sesja parowania żyje w pamięci procesu serwera.
Restart w trakcie parowania (typowe wdrożenie) ją zjadał, a front kręcił
odpowiedzią `brak` wieczną pętlę jak stanem „czekam". Flaga trwającego
parowania zostawała podniesiona i zabijała guzik aż do przeładowania strony.
Teraz `brak` kończy pętlę: panel mówi „sesja parowania przepadła — zacznij od
nowa" i od razu oddaje żywy guzik.

**Ikona ALLEGRO w pasku na górze.** Wejście do parowania stało dotąd trzy
ekrany w głąb zakładki SPRAWY. Ikona mówi kolorem: zielony — połączone,
bursztyn — parowanie w toku, czerwień — niepołączone, szary — adapter dev albo
funkcja wyłączona. Klik otwiera kartę KONTO ALLEGRO i przy czerwieni sam
zaczyna parowanie. Stan płynie z `/api/health` (nowe pole `allegro`: stan,
środowisko, data wygaśnięcia — bez sekretów), więc ikona żyje na każdej
zakładce, nie dopiero po odczycie listy zwrotów.

**Jedna ikona SYSTEM zamiast kafli.** Rząd „serwer OK · worker OK · kolejka
bez błędów" świecił na zielono cały dzień i uczył siebie nie czytać. Ikona
odpowiada kolorem na jedno pytanie: czy coś wymaga uwagi. Czerwień — serwer
zgłasza problemy, worker padł, kolejka w błędzie albo są rozjazdy. Bursztyn —
działa, ale ostatnie odświeżenie panelu nie doszło (sygnał z 0.111.0, dotąd
osobny znacznik). Dymek po najechaniu niesie wszystko, co niosły kafle:
etykietę środowiska, wersję i tryb, workera, kolejkę i pełne zdania
`problemy[]`. Klik prowadzi do STANU SYSTEMU. Plakietka „odpowiedzi na
notatki" zostaje osobno — to sygnał roboczy z własną drogą do karty, nie
zdrowie systemu.

Przy okazji sprostowany komentarz serwera: PRZERWIJ przy parowaniu jest
wyłącznie frontowy i sesji na serwerze świadomie nie czyści — nowy kod jest
dopiero po wygaśnięciu starego.

---

## 0.113.0 — 27 sierpnia 2026

**Zrobiona pozycja dostawy przestała być przekreślonym napisem, a ilość da się
wpisać.** Cztery zmiany na jednym ekranie, z czterech zgłoszeń z hali. Trzy
pierwsze dotyczą grupy zrobionych i mają wspólny mianownik: nie czyta się jej
po kolei, tylko wraca do niej ze sprawdzeniem, czy ostatnia rzecz poszła tam,
gdzie miała. Czwarta kończy z wyklikiwaniem stu sztuk.

**Ostatnio odłożona stoi na górze zrobionych.** Kolejność alejkowa nie znaczyła
w tej grupie nic — nikt nie idzie do tych półek drugi raz — a szukana pozycja
lądowała gdzieś w środku listy. Teraz jest pierwszym paskiem pod pracą do
zrobienia. Pozycja bez godziny (pominięta bez odłożenia, odpowiedź starszego
serwera) siada za tymi z godziną, w kolejności z serwera.

**Przekreślenie ustąpiło zielonej odznace.** Symbol towaru to ciąg znaków bez
sensu słownego („LS51-139"), więc kreska przez środek każe go składać literami
przez przeszkodę — a właśnie po nim sprawdza się, CO poszło na półkę. Stan
niesie teraz krążek z fajką, stojący POZA tekstem, w jednej kolumnie przez całą
grupę. Sam napis jest przygaszony, ale nietknięty. Przy okazji pozycja
**pominięta** dostała bursztyn i wykrzyknik zamiast zielonej fajki — do tej
wersji obie wyglądały tak samo, choć jedna leży na półce, a druga nie.

**Zdjęcie wróciło do paska.** Decyzja z 0.55.0 mówiła „pozycja odłożona, więc
rozpoznawanie towaru nic już nie wnosi" i pomijała to, po co się do tej grupy
wraca. Miniatura 28 dp kosztuje sześć punktów wysokości paska i odpowiada na
pytanie „czy to na pewno ten towar" szybciej, niż zrobi to symbol.

Serwer dokłada do pozycji dostawy `doneAt` — godzinę odłożenia, którą panel
biura czyta od 0.36.0, a kolektor dostawał dotąd bez niej. Reguła kolejności
mieszka w module `:core` i ma własne testy: bez znacznika czasu cicho wraca do
tego, co było, i wygląda przy tym poprawnie.

**ILOŚĆ MOŻNA WPISAĆ, nie tylko wyklikać.** Ze zgłoszenia z hali: przy stu
sztukach ponad fakturę licznik `+` znaczył sto stuknięć, czyli drogę, której
nikt nie przejdzie. Dotknięcie samej liczby otwiera pole z klawiaturą
numeryczną — pod kaflami, tak samo jak ręczny wpis adresu. To samo dostała
**POPRAW ILOŚĆ**: tam poprawka setnej pozycji z dokumentu kosztowała dokładnie
tyle samo stuknięć.

Licznik − / + zostaje domyślną drogą i to się nie zmienia — rękawica na
klawiaturze numerycznej to trzy pomyłki na dziesięć wpisów, a różnice bywają
tu małe („trzy z dziesięciu leżą na wierzchu"). Wpis jest drogą dla liczb,
których nikt nie wyklika.

Wpisana liczba **nie omija pytania o nadmiar**: „120" przy fakturze na 20
przechodzi tą samą drogą co dwudzieste stuknięcie w `+` i dalej wymaga zgody,
tyle że potwierdzenie mówi teraz, na co się zgadzasz („odkładasz 120, a na
fakturze jest 20"). Przecinek i kropka znaczą to samo, spacje lecą, a liczba
ujemna albo absurdalnie duża jest odrzucana zamiast po cichu przycięta —
regułę liczy `:core` i ma na to siedem testów.

## 0.112.0 — 27 sierpnia 2026

**Konsola spraw przestała być trzema pływającymi kartkami.** Zgłoszenie
brzmiało „usuń te zaokrąglone przerwy między sekcjami" i dotyczyło czegoś,
co makieta rozstrzygnęła dawno, a panel nigdy nie wdrożył.

**Makieta rozdziela dwa wyglądy, panel znał jeden.** `Main` rysuje konsolę
pracy jako płaskie tafle stykające się krawędziami: kontekst ma tam kreskę
z lewej, zero promienia i zero cienia. `Analiza` rysuje bloki jako KARTY —
promień 14, cień, odstęp. Panel dawał kartę wszędzie, bo `.card` jest jedną
klasą na cały arkusz, więc trzy strefy pracy pływały na papierze jak trzy
osobne dokumenty. A są jednym stanowiskiem.

**Reguła, która z tego zostaje: konsola pracy to tafle, powierzchnia do
czytania to karty.** Pilnuje jej test, w obie strony — bo pierwsze
porządkowanie CSS scaliłoby te dwa wyglądy z powrotem i nikt by nie zauważył.

**Konsola dotyka krawędzi okna.** Wyłamuje się z marginesu strony ujemnym
marginesem — dokładnie o `--brzeg`, czyli o tę samą zmienną, z której margines
bierze strona. Na monitorze to trzydzieści kilka pikseli więcej dla wątku
klienta, a na laptopie obok Subiekta liczy się każdy.

**Strefy sięgają dołu okna** zamiast kończyć się tam, gdzie kończy się treść.
Krótka sprawa zostawiała pod sobą pas papieru i znowu wyglądała jak kartka
położona na tle.

**Kolejka przewija się własnym przewijaniem**, jak dwie pozostałe strefy. Do
tej wersji jechała ze stroną, podczas gdy sprawa i kontekst stały — przy
kilkudziesięciu sprawach wyglądało to jak usterka.

**Poniżej 1024 px nie zmienia się nic.** Tam widok jest pionowym stosem kart
i stos kart jest poprawny — makieta `Waski` też go tak rysuje. ANALIZA, STAN
SYSTEMU i DZIENNIK zostają na kartach na każdej szerokości.

**Złapane przy weryfikacji: kolejka bywa STOSEM, nie jedną taflą.** Przy
zwrocie stoi pod nią karta brakujących paczek, przy dostawach „poza WERTIS".
Sztywna wysokość dała każdej z nich pełne okno osobno, czyli kolumnę dwa razy
wyższą od ekranu. Sprawa i kontekst dostają sztywną wysokość, bo są zawsze
pojedyncze; kolejka dostaje limit, a karty w niej rozdziela kreska zamiast
odstępu.

## 0.111.0 — 26 sierpnia 2026

**Panel, który naprawia, nie tylko patrzy.** Przegląd dojrzałości pokazał
jeden wzorzec: miejsca, w których problem widać, nie były miejscami,
w których da się go naprawić. Do tego garść porządków.

- **Kolejka błędów z przyciskami.** STAN SYSTEMU dostał PONÓW przy zadaniu
  w błędzie i ANULUJ przy oczekującym — te same trasy, których używa
  kolektor. Zapis do Subiekta rusza z biurka, bez chodzenia po urządzenie.
- **Dwie operacje ratunkowe zeszły z DEPLOY.md na przyciski.** PEŁNY RESYNC
  Z SUBIEKTA i ODŚWIEŻ BRAKUJĄCE ZDJĘCIA stoją w karcie SERWER, oba za
  groźnym potwierdzeniem.
- **KONTA I SESJE w ustawieniach.** Reset hasła, włączenie/wyłączenie konta
  i — po raz pierwszy — wgląd w sesje (urządzenie, ostatnio widziane) oraz
  WYLOGUJ WSZĘDZIE: przycisk na zgubiony kolektor. Dotąd wszystko to było
  poleceniami curl; mutacje przechodzą wyłącznie adminowi (odmowę
  wypowiada serwer). Nowe trasy: `GET /api/users/:id/sesje`,
  `POST /api/users/:id/wyloguj`.
- **DZIENNIK filtruje po osobie.** „Co robił wczoraj Jan" przestało wymagać
  CSV i Excela — trasa umiała to od dawna, brakowało kontrolki.
- **Kulejący cykl ma jeden znacznik.** Pięć niemych `console.warn`
  w odświeżaczach zastąpił wspólny sygnał w pasku stanu: mówi, że
  odświeżanie nie doszło i gdzie, gaśnie przy pierwszym czystym przebiegu.
- **Porządki:** jedna lista ról zamiast czterech kopii; `WORKER_SIM_ERRORS`
  zatrzymuje start na produkcji (symulacja błędów kolejki wyglądałaby jak
  awaria Sfery); `ALLOW_MANUAL_LOC` trafił do `wertis.env.example`;
  DEPLOY.md wskazuje JEDNĄ drogę aktualizacji (instalator, ręczna
  sekwencja tylko awaryjnie); zdanie o pokryciu testami w porównaniu
  urealnione; nowy `CLAUDE.md` z zasadami pracy w repo.

Bez zmian w kolektorze i bez działania przy wdrożeniu.

## 0.110.0 — 26 sierpnia 2026

**Klient nie przestaje pisać dlatego, że biuro ma jego sprawę na ekranie.**
Dotąd otwarta sprawa niczego o tym nie mówiła: dopisek klienta potrafił
założyć DRUGĄ sprawę z tego samego wątku, a odpowiedź szła na starą wersję
pytania. Trzy zmiany, wszystkie zgodne z audytem 0.109.1 — żadnego nowego
odpytywania Allegro.

- **Kontrola świeżości przy WYŚLIJ.** W chwili wysyłki serwer porównuje
  rozmowę z tym, na czym stoi sprawa (jedno zapytanie NA WYSYŁKĘ, nie
  w cyklu). Gdy klient dopisał — wysyłka staje (409), panel pokazuje
  dopiski i przycisk WYŚLIJ MIMO TO. Przy dyskusjach punktem odniesienia
  jest ostatnia wiadomość widziana na ekranie; po odświeżeniu rozmowy
  ponowna wysyłka przechodzi sama. Awaria pobrania degraduje do wysyłki
  bez kontroli — czkawka API nie może zatrzymać odpowiedzi klientowi.
- **Dopisek aktualizuje sprawę, nie zakłada drugiej.** Synchronizacja,
  widząc nową wiadomość kupującego w wątku z OTWARTĄ sprawą, aktualizuje
  jej wiersz (treść, stempel „klient dopisał") zamiast tworzyć nowy.
  Szkic i odpowiedź biura zostają NIETKNIĘTE — znika tylko domniemanie
  ich świeżości. Rozbicie synchronizacji dostało kubełek „dopisane".
- **Puls klienta w otwartej sprawie.** Co cykl (30 s) panel czyta NASZĄ
  bazę — trasę `/sprawy/klient` — i pokazuje banery: KLIENT DOPISAŁ
  (z przyciskiem POKAŻ ROZMOWĘ) i NOWA SPRAWA KLIENTA (z wejściem do
  karty klienta). Zero ruchu do Allegro; opóźnienie dopisku = rytm
  synchronizacji.

Bez zmian w kolektorze, bez nowych uprawnień i bez działania przy
wdrożeniu (nowa kolumna zakłada się sama przy starcie).

## 0.109.1 — 26 sierpnia 2026

**Utwardzenie użycia API Allegro po audycie.** Domyślny profil ruchu był
bezpieczny; poprawki zamykają wektory, które jedną literówką w `wertis.env`
zmieniłyby go w maszynowy — czyli w sygnaturę, która już raz skończyła się
blokadą adresu IP.

- **Podłoga na `ALLEGRO_POLL_MS`.** Wartość dodatnia poniżej minuty
  zatrzymuje start serwera ze zdaniem o minimum. To niemal na pewno
  literówka (sekundy zamiast milisekund), a skutkiem byłyby trzy pętle
  bijące w Allegro co ułamek sekundy. Zero (domyślne, tło wyłączone)
  działa jak dotąd.
- **Wspólny takt trzech pętli tła** (zapowiedzi, pytania, dyskusje):
  startują w różnych sekundach, a każdy odstęp ma rozrzut ±10%. Równy,
  zegarowy rytm z jednego adresu wygląda dla anti-bota jak automat —
  rozrzut zdejmuje tę sygnaturę, nie psując przewidywalności.
- **Respekt dla 429.** Odpowiedź „za dużo zapytań" jest teraz rozpoznawana
  (osobna klasa błędu, odczyt `Retry-After`) zamiast lecieć jako surowy
  kod. Ponowień nadal NIE MA — pętla tła wydłuża następny przebieg o tyle,
  ile prosi Allegro, hurtowe szkice przerywają się od razu, a człowiek
  dostaje zdanie „spróbuj za N s". Ta sama gałąź na logowaniu (apex).

Audyt potwierdził też rzeczy, których NIE trzeba było zmieniać: jeden punkt
wyjścia z User-Agentem i timeoutem, zero automatycznych ponowień, twarde
sufity stron we wszystkich listach, rozmowy czytane na klik, przyciski
synchronizacji już blokujące się na czas trwania.

Bez zmian w kolektorze i bez działania przy wdrożeniu (domyślne `0` dla
`ALLEGRO_POLL_MS` nietknięte).

## 0.109.0 — 26 sierpnia 2026

**SPRAWY są teraz jedynym oknem obsługi klienta.** Karty dawnych zakładek
ZWROTY ALLEGRO i PYTANIA KLIENTÓW przeprowadziły się w całości do SPRAW,
a same zakładki znikły. To domknięcie decyzji z 0.108.0: cztery rejestry,
jedna kolejka, jedno okno.

- **Wszystko w jednym widoku.** Skaner zwrotów, kosze, pominięte,
  zapowiedzi, reklamacje, dyskusje, skrzynka pytań, wklejka i konto Allegro
  stoją teraz pod wspólną kolejką spraw. Identyfikatory kart i tras bez
  zmian — zmieniło się tylko to, w którym widoku stoją.
- **Sprawy otwierają się na miejscu.** Klik w kolejce, w karcie klienta
  i w powiązanych sprawach nie przełącza już zakładek. Przycisk powrotu
  mówi, dokąd wraca: „← SPRAWY KLIENTA", gdy sprawę otwarto z karty
  klienta, inaczej „← KOLEJKA SPRAW". Escape schodzi warstwami: szuflada,
  sprawa, karta klienta.
- **Jedno rodzeństwo zamiast trzech.** Widocznością kart i sekcji rządzi
  jedna funkcja z tabelą stanów — dwie osobne (zwroty i pytania)
  nadeptywałyby sobie na wspólny widok. Naraz otwarta jest najwyżej jedna
  sprawa; obok niej na szerokim ekranie zostaje jej własna kolejka.
- **Jedna pigułka, jedna trasa w cyklu.** Licznik SPRAW karmi też
  podsumowanie skrzynki pytań i ślad synchronizacji — trzy zapytania
  licznikowe co pół minuty zeszły do jednego. Stare trasy `/licznik`
  zostają dla zgodności.
- **Zapamiętana zakładka przeżywa przeprowadzkę.** Zapisane w przeglądarce
  „zwroty" albo „pytania" otwiera SPRAWY zamiast pustego panelu.

Bez zmian w kolektorze, bez nowych uprawnień Allegro i bez działania przy
wdrożeniu.

## 0.108.0 — 26 sierpnia 2026

**SPRAWY: jedna kolejka obsługi klienta.** Pytania, zwroty, dyskusje Allegro
i reklamacje to w backendzie osobne rejestry — i tak zostaje. Ale biuro nie
pracuje w czterech modułach: pyta „co mam teraz zrobić?". Nowa zakładka
SPRAWY odpowiada jedną listą wszystkich otwartych spraw, posortowaną po
pilności: najpierw ustawowy termin (reklamacje i CLAIM-y, przeterminowane na
górze), potem najstarsze. Chipy filtrują po typie, pigułka na zakładce liczy
wszystko naraz. Klik otwiera sprawę w jej dotychczasowym szczególe;
reklamacja otwiera swój zwrot, bo tam mieszkają jej akcje.

- **Karta klienta (360) jako drugi poziom.** Klik w login — z kolejki albo
  z nagłówka otwartej sprawy (pytania, zwrotu, dyskusji) — otwiera kartę ze
  wszystkimi sprawami tej osoby: aktywne po pilności, historia od
  najnowszej. Sprawy bez konta Allegro (wklejki z poczty, zwroty ręczne)
  mają wspólny kubełek (BEZ LOGINU), żeby nic nie ginęło poza kolejką.
- **POWIĄZANE SPRAWY w kontekście.** Zwrot, dyskusja i reklamacja bywają
  odsłonami jednego problemu, choć Allegro trzyma je osobno. Kontekst
  pytania i zwrotu dostaje zwijaną sekcję z ciągiem sprawy: najpierw to
  samo zamówienie (mocny dowód), potem ten sam login (podpisany słabiej).
  Pobierane po otwarciu, jak historia klienta.
- **Historia klienta zna czwarty rejestr.** Reklamacje tego loginu były
  jedyną rzeczą niewidoczną przy odpowiadaniu — teraz stoją obok pytań,
  zwrotów i dyskusji.
- **Wyłącznie odczyt.** Nowe trasy (`/api/biuro/sprawy*`) tylko czytają;
  mutacje zostają przy rejestrach źródłowych. Licznik zakładki jest
  składany z liczników per-typ, żeby liczby nie mogły się rozjechać.

Zakładki ZWROTY ALLEGRO i PYTANIA KLIENTÓW na razie zostają — w następnym
wydaniu ich karty przeprowadzą się do SPRAW, a same zakładki znikną.
Bez zmian w kolektorze, bez nowych uprawnień Allegro i bez działania przy
wdrożeniu.

## 0.107.0 — 26 sierpnia 2026

**Trzy skargi z jednego dnia pracy na pytaniach klientów.**

- **Rozmowa czytała się od końca.** Allegro potrafi oddać wątek od najnowszej
  wiadomości, a my braliśmy listę tak, jak przyszła. Poza wyglądem psuło to
  coś gorszego: synchronizacja brała za „ostatnią wiadomość klienta" tę
  najstarszą, więc na worklistę trafiało pytanie sprzed tygodni zamiast
  bieżącego. Wiadomości wątków i dyskusji są teraz sortowane rosnąco po
  dacie u nas, niezależnie od kolejności z API; wiadomość bez daty ląduje na
  końcu, w kolejności z API.
- **Aukcja, o którą pyta klient, wchodzi do sprawy.** Kupujący klika PYTANIE
  przy konkretnej ofercie i Allegro wpina ją w tę wiadomość
  (`relatedObject`) — a my czytaliśmy wyłącznie nagłówek wątku, czyli
  pierwszą sprawę, jaką ten klient kiedykolwiek zgłosił. Przy stałym kliencie
  to zupełnie inny towar. Teraz oferta idzie z wiadomości (nagłówek wątku
  zostaje jako zapas), aplikacja dociąga jej szczegóły i pokazuje je
  w nagłówku sprawy: symbol, cena, dostępność, link. Symbol z aukcji
  (`external.id`) prowadzi też szukanie w kartotece i stoi osobnym akapitem
  w kontekście szkicu. Oferta zakończona nie znika po cichu — panel i model
  dostają „aukcji już nie ma, dopytaj klienta" zamiast zgadywania.
- **Szkic AI przestał powstawać sam.** Do tej wersji model pisał odpowiedź do
  każdego pobranego pytania, także do tych, których nikt nie otworzy — to
  rachunek u dostawcy AI za nic. Domyślnie odświeżenie tylko pobiera sprawy,
  a szkic powstaje po kliknięciu **GENERUJ** przy konkretnym pytaniu. Kto
  woli mieć gotowe od ręki, włącza w karcie AI przełącznik **„Licz szkice
  automatycznie, bez pytania"** — należy do admina, bo to on płaci za model.

Bez zmian w kolektorze, bez nowych uprawnień Allegro i bez działania przy
wdrożeniu. Ustawienie automatycznego szkicu startuje **wyłączone** — także
tam, gdzie szkice liczyły się dotąd same.

## 0.106.0 — 26 sierpnia 2026

**Allegro zablokowało adres IP w trakcie parowania konta** („Zostałeś
zablokowany", powód: ruch szybszy niż człowiek / robot w tej samej sieci).
Analiza wskazała jedno miejsce: **endpointy parowania stoją na apeksie
`allegro.pl`**, czyli za tym samym zabezpieczeniem co sklep — a nie na
`api.allegro.pl`. Odpytywanie stanu parowania było więc jedynym ruchem tej
aplikacji, który widzi anti-bot sklepu, i wyglądało dokładnie jak maszyna:
przeglądarka pytała co 3 s, serwer trzymał podłogę 5 s, więc żądanie leciało
co ~6 sekund równym rytmem przez całe życie kodu. Zostawiona zakładka
wysyłała tak kilkaset żądań z jednego adresu w godzinę.

**Co się zmienia:**

- **Odstęp rośnie z czasem czekania**: 5 s przez pierwszą minutę, 10 s do
  trzeciej, potem 20 s. Człowiek potwierdza kod w kilkanaście sekund; cisza
  po trzech minutach znaczy, że odszedł od komputera — pytanie co pięć sekund
  przez pół godziny niczego wtedy nie przyspiesza. Rytm dyktuje teraz serwer
  (`nastepnyPollMs`), nie sztywna liczba w przeglądarce, a podłoga 5 s
  obowiązuje nawet gdyby Allegro podało mniej.
- **Drugi klik POŁĄCZ nie startuje drugiej pętli.** Do tej wersji każde
  kliknięcie wysyłało nowe żądanie o kod i uruchamiało kolejne, równoległe
  odpytywanie — trzy kliknięcia dawały potrójny rytm. Teraz serwer oddaje tę
  samą, wciąż ważną sesję, a strona pilnuje jednej pętli.
- **PRZERWIJ** obok „Czekam na potwierdzenie…". Do tej pory jedynym wyjściem
  było przeładowanie strony.
- **Strona blokady rozpoznana jako blokada.** Zamiast błędu parsowania JSON-a
  (bo przyszedł HTML) panel mówi, co się stało i co zrobić: przerwać, odczekać,
  otworzyć link z innej sieci — np. z telefonu po danych komórkowych.
- **[wymaga działania] Brak `ALLEGRO_USER_AGENT` widać w STANIE SYSTEMU.**
  Allegro wymaga własnego nagłówka i ostrzega, że jego brak grozi
  zablokowaniem klucza — a aplikacja nie mówiła o tym nic, aż do blokady.
  Wygeneruj nagłówek na developer.allegro.pl, wpisz do `wertis.env`
  (`ALLEGRO_USER_AGENT=`) i zrestartuj `wertis-api`.

DEPLOY.md §6 dostał krótką instrukcję „Gdy Allegro pokaże stronę
«Zostałeś zablokowany»", razem ze sposobem sprawdzenia własnego adresu IP.

Sprawdzone przy okazji i **wykluczone** jako przyczyny: aplikacja nigdzie nie
pobiera stron allegro.pl (linki do aukcji to sam tekst), cykl odświeżania
panelu co 30 s czyta wyłącznie SQLite, tickery w tle są domyślnie wyłączone,
a pętli ponowień po błędach nie ma w ogóle.

## 0.105.0 — 26 sierpnia 2026

**„Kiedy dojdzie moja paczka?" — odpowiedź bez panelu Allegro.** Aplikacja
czyta ostatnie zamówienia kupującego (status wysyłki po polsku, kurier,
numer przesyłki, ostatnie zdarzenie śledzenia) z końcówek rodziny `/order/`
— i podaje je dwiema drogami:

- **automatycznie**: gdy pytanie brzmi jak pytanie o wysyłkę (heurystyka
  słów + kategoria po klasyfikacji), blok przesyłek wchodzi do kontekstu
  szkicu AI z twardą zasadą „statusy i daty dokładnie jak wyżej, terminu
  doręczenia nie obiecuj". Pytanie o dobór części nie ciągnie żadnych
  dodatkowych zapytań — bramka jest po to, żeby szkic nie dostawał szumu,
  a Allegro zbędnych strzałów;
- **ręcznie**: sekcja PRZESYŁKI KLIENTA w kontekście sprawy (ładowana
  dopiero po otwarciu, jak historia klienta) z przyciskiem **WSTAW
  STATUS** — jedno kliknięcie wkleja do odpowiedzi gotowe zdanie
  z realnym statusem, w miejscu kursora, tym samym mechanizmem co
  WSTAW LINK przy aukcjach.

**Prywatność wprost:** adres dostawy i punkt odbioru nie przechodzą przez
mapowanie w ogóle — pilnuje tego test. Do odpowiedzi wystarczy status,
data, kurier i numer.

**Bez nowych uprawnień i bez ponownego parowania.** Całość chodzi na już
wymaganym `allegro:api:orders:read`; `allegro:api:shipments:read` (WZA)
nie jest używane. Kupujący z wątków bywa maską `client:NNN` — adapter
obsługuje obie postaci (filtr po loginie albo skan ostatnich 60 dni po
`buyer.id`), a miejsca niepewne w becie są oznaczone `[WERYFIKUJ]`.
Wysyłka etykietą spoza integracji Allegro daje uczciwe „jeszcze nie
nadane", nie błąd.

Bez zmian w kolektorze i bez działania przy wdrożeniu.

## 0.104.0 — 26 sierpnia 2026

**Dyskusje Allegro w całości w aplikacji.** 0.103.0 zrobiło z dyskusji
rejestr pracy, ale rozmowa i odpowiedź nadal wymagały przejścia do panelu
Allegro. Teraz przycisk OTWÓRZ na karcie dyskusji pokazuje pełną rozmowę
(czytaną z API `/sale/disputes` na klik, bez zapisu u nas — ta sama zasada
co przy wątkach pytań), a odpowiedź wysyła się prosto stąd, za
potwierdzeniem. Wysyłka podbija sprawę z „nowa" na „w toku" i NIE zamyka
jej — dyskusja to wiele odpowiedzi, a koniec ogłasza Allegro (sync
auto-zamyka po statusie finalnym). Nadawca zostaje prowadzącym: to on czeka
teraz na klienta.

**Szkic pisze model — na jawne kliknięcie, bez automatu.** GENERUJ SZKIC
składa kontekst sprawy: transkrypt rozmowy, powiązany zwrot z decyzjami
biura (powód klienta, werdykt, półka), historię klienta i notatkę — i podaje
gotową odpowiedź do redakcji. Świadomie bez tickera: wolumen jest mały,
stawka wysoka (formalny CLAIM), a szkic starzeje się z każdą nową
wiadomością klienta. Flaga redakcji (`edytowano`) liczy się jak przy
pytaniach — miara „ile poprawiamy po modelu" działa od pierwszego dnia.

**Załącznik do odpowiedzi.** Zdjęcie albo PDF (do 4 MB) dokłada się
przyciskiem lub wklejeniem ze schowka przy otwartej sprawie. Plik jedzie
do Allegro dwustopniowo (deklaracja + binaria) i NIE jest u nas zapisywany —
ta sama zasada prywatności co przy screenshotach pytań.

**Uczciwa degradacja zamiast założeń.** API dyskusji jest w becie i id
sprawy z `/sale/issues` może nie pasować do `/sale/disputes` — wszystkie
takie miejsca są oznaczone `[WERYFIKUJ]`. Gdy API nie zna sprawy, szczegół
mówi „Rozmowa niedostępna przez API — otwórz panel Allegro", a rejestr
z 0.103.0 działa dalej bez zmian. Przy 403 komunikat wskazuje brakujące
uprawnienie z nazwy.

Przy okazji: karta dyskusji dołączyła do listy kart chowanych przy otwartym
szczególe zwrotu (w 0.103.0 jako jedyna zostawała na ekranie).

Bez zmian w kolektorze i bez działania przy wdrożeniu: nowe kolumny dochodzą
migracją przy starcie, uprawnienie `allegro:api:disputes` było wnioskowane
od 0.68.0.

## 0.103.0 — 26 sierpnia 2026

**Dyskusje i reklamacje Allegro są rejestrem pracy biura, nie podglądem.**
Do tej pory sekcja na zakładce ZWROTY pobierała listę spraw z Allegro na
kliknięcie i nic z tego nie zostawało: sprawa bez właściciela i bez statusu
potrafiła czekać niezauważona aż do terminu ustawowego, a przy dwóch biurkach
dwie osoby brały tę samą. Teraz POBIERZ Z ALLEGRO zapisuje sprawy do lokalnej
tabeli `dyskusja` (ten sam wzorzec co pytania klientów): lista pokazuje status
naszej pracy (nowa → w toku → zamknięta/pominięta), prowadzącego, notatkę
z ustaleń i powiązany zwrot po numerze zamówienia. Formalna reklamacja (CLAIM)
dostaje termin ustawowy liczony tą samą arytmetyką co reklamacje ze zwrotów
i idzie na górę listy. Sprawa zamknięta w panelu Allegro schodzi z worklisty
sama przy najbliższym pobraniu, podpisana przez `allegro` — licznik nie kłamie
o sprawach dawno rozstrzygniętych.

**Odpowiada się nadal w panelu Allegro** — `GET /sale/issues` nie zwraca
treści wiadomości, więc rozmowa ma jedno miejsce prawdy tam. U nas zostaje
to, czego panel Allegro nie daje: kolejka, właściciel, termin i notatka.
Ticker pobierania dzieli `ALLEGRO_POLL_MS` z zapowiedziami i pytaniami,
domyślnie wyłączony. Uprawnienie bez zmian (`allegro:api:disputes`).

**Reklamacje ze zwrotów mają prowadzącego.** Ten sam znacznik co przy
pytaniach (0.89.0) i z tego samego powodu: dwie osoby w biurze potrafiły
rozpatrywać tę samą sprawę. Nazwisko pojawia się przy odłożeniu na półkę albo
po kliknięciu PROWADZĘ — reklamacja, inaczej niż pytanie, nie ma przed
werdyktem zapisu treści, przy którym pojawiłoby się samo. Rozpatrzenie
zdejmuje znacznik; kto rozstrzygnął, dalej mówi stempel rozpatrzenia.

**Zakładka ZWROTY nosi pigułkę uwagi** jak PYTANIA KLIENTÓW: reklamacje po
terminie plus nieobsłużone dyskusje, z rozbiciem w dymku. Biuro widzi
czekającą sprawę, siedząc na dostawach.

**Kontekst klienta w jednym miejscu.** Karta historii przy pytaniu i szczegół
zwrotu pokazują teraz także dyskusje tego samego kupującego — trzy rejestry
jednego loginu składa jeden serwis (`kontekstKlienta`), zamiast trzech kopii
tych samych zapytań. Szczegół zwrotu ostrzega o otwartej sprawie Allegro do
tego samego zamówienia, zanim ktoś odda środki.

Bez zmian w kolektorze i bez działania przy wdrożeniu: nowa tabela zakłada
się sama przy starcie, stary podgląd znika razem ze swoją trasą
(`GET /api/biuro/zwroty/dyskusje` — jedynym klientem był panel).

## 0.102.1 — 26 sierpnia 2026

**Pytania z Allegro nie wchodziły w ogóle.** Zgłoszenie z produkcji: „nie
pobiera zapytań, mailowo normalnie przychodzą". Panel po kliknięciu ODŚWIEŻ
pokazywał **„nowych 0 · przejrzano 60 rozmów"** — czyli token działał,
uprawnienie było, lista wątków wracała, a odpadał każdy z sześćdziesięciu.

**Przyczyna: martwa ścieżka rozpoznawania stron rozmowy.** Kto pisał, ustala
się najpierw po `author.role`, a gdy Allegro jej nie poda — po loginie
rozmówcy. Ta druga ścieżka była nieosiągalna, bo **oba wywołania przekazywały
`null`** zamiast loginu. Na koncie bez ról każda wiadomość liczyła się jako
NASZA, więc żaden wątek nie kończył się pytaniem klienta i nie importowało się
nic — bez jednego błędu w logu.

**Login kupującego był pod ręką przez cały czas** — jedzie z listą wątków jako
`interlokutor` i z samym pytaniem jako `kupujacyLogin`. Naprawa to przekazanie
go tam, gdzie zawsze miał trafiać.

**Dlaczego nie wyszło wcześniej.** Adapter dev trzyma gotowe wiadomości
z ustawioną stroną rozmowy i przez to mapowanie w ogóle nie przechodzi — więc
demo i scenariusze nie miały jak tej funkcji dotknąć. A test, który miał jej
pilnować, nazywał się „brak roli → login rozmówcy" i **tej ścieżki nie
wykonywał**: obie wiadomości w nim miały rolę. Nazwa obiecywała pokrycie,
którego nie było.

**To samo dotyczyło podglądu rozmowy.** Wątek otwarty z karty pytania też
mapował się bez loginu, więc na koncie bez ról cała korespondencja
wyświetlałaby się jako nasza.

**Zero mówi teraz, DLACZEGO.** Jedno `continue` łykało pięć różnych sytuacji
i wszystkie wyglądały na ekranie tak samo. Linijka pod przyciskiem dopowiada
je, gdy nic nie weszło: „przejrzano 60 rozmów — 58 już mamy, 2 kończą się naszą
odpowiedzią". Wątki, z których nie da się nic wyjąć, idą pogrubione — bo to
jedyny z tych powodów, który znaczy usterkę, a nie poprawną skrzynkę na zero.

**Rachunek się domyka i test tego pilnuje:** nowe plus pięć powodów pominięcia
równa się liczbie przejrzanych rozmów. Szósty powód dopisany bez uzupełnienia
sumy zepsuje test głośno, zamiast po cichu wrócić do zera bez wyjaśnienia.

**Strażnik na wywołania.** Samego mapowania nie da się złapać testem
integracyjnym — adapter dev go omija, a klient HTTP nie ma atrapy `fetch`.
Doszło więc sprawdzenie ŹRÓDŁA: żadne wywołanie nie może przekazać `null`
zamiast rozmówcy. Ten sam zabieg, co przy delegacji przycisków, i z tego samego
powodu — pomyłka nie wywraca niczego głośno, tylko cicho gasi zakładkę.

## 0.102.0 — 26 sierpnia 2026

**Skrzynka na zero mówi teraz, KIEDY ostatnio pytaliśmy Allegro.** Ostatnia
rzecz z makiety `Stany`, której panel nie miał.

**Zero na ekranie znaczyło dwie różne rzeczy naraz.** „Nic nie czeka na
odpowiedź" wygląda identycznie, gdy dziś nikt nie napisał, i gdy od wczoraj
nikt nie kliknął ODŚWIEŻ. Pierwsze jest dobrą wiadomością, drugie cichą awarią
procesu — a rozróżnienia nie było jak zrobić.

**Liczby z pobrania leciały w toast i ginęły razem z nim.** Po odświeżeniu
strony nie zostawał po nich ślad. Teraz stoją pod przyciskiem: „Ostatnio: dziś
14:02 · nowych 3 · przejrzano 12 rozmów".

**Ślad powstaje ZAWSZE, także przy zerze nowych** — i to jest cała treść tej
zmiany. Zdarzenie `pytanie_sync` w audycie leci dalej tylko przy nowych
pytaniach i słusznie: przebieg bez zmian nie jest faktem o towarze ani
o ludziach. Ale ekran biura pyta o co innego — „czy ktoś dziś w ogóle pytał" —
i na to zdarzenie nie odpowiada.

**W pamięci, nie w bazie**, dokładnie jak ślad tickera zapowiedzi zwrotów.
Restart serwera kasuje go i to jest poprawne: „nie wiem, kiedy ostatnio
pytaliśmy" jest wtedy prawdą, a nie brakiem danych do odzyskania. Zdanie
wskazuje wtedy przycisk, zamiast milczeć.

## 0.101.1 — 26 sierpnia 2026

**Poprawka wpisu, nie kodu.** Wydanie 0.101.0 zamyka warstwę treści i ostatnią
makietę; ta pozycja prostuje jedno zdanie, które poszło z 0.100.0.

**Wpis o `versionCode` nie jest pozycją [wymaga działania].** Mówił „zbuduj
nowy APK po tej zmianie", a budować niczego nie trzeba: workflow `android.yml`
chodzi na każdą zmianę `package.json`, podpisuje APK i wystawia go jako wydanie
na GitHubie. Wydania `v0.100.0` i `v0.101.0` powstały same, z plikami
`wertis-kolektor-0.100.0.apk` i `.sha256` w środku.

Znacznik **[wymaga działania]** ma jedno zadanie: powiedzieć, co zrobić poza
`git pull`. Fałszywa pozycja kosztuje więcej niż brakująca — kto raz sprawdzi,
że nie ma czego robić, przestaje ufać pozostałym. Sama zmiana wzoru zostaje
opisana, bo jest prawdziwa i była konieczna: bez niej serwer odrzuciłby plik
`wertis-kolektor-0.100.0.apk` po samej nazwie.

## 0.101.0 — 26 sierpnia 2026

**Kontekst przestał spadać pod sprawę na wąskim oknie.** Ostatnia nietknięta
makieta — `Waski` — rysowała trzecią strefę jako szufladę wywoływaną
przyciskiem. To ona wchodzi tym wydaniem.

**Pasma szerokości są trzy, a były dwa.** Powyżej 1280 px bez zmian: kolejka,
sprawa, kontekst obok siebie. Poniżej 1024 px bez zmian: sprawa zasłania
wszystko. Między nimi jest nowe pasmo, w którym **kolejka zostaje widoczna**,
sprawa stoi obok niej, a kontekst chowa się za przyciskiem KONTEKST.

**To jest ten laptop obok Subiekta, który kod cytuje od 0.83.0.** Trzy strefy
na 1180 px zepchnęłyby kolumnę wątku poniżej miary, przy której da się czytać;
zasłonięcie kolejki było stratą odwrotną — biuro traciło z oczu listę, nad
którą pracuje, i po powrocie wracało na jej górę. Z trzech stref kontekst jest
najrzadziej potrzebny: do dopasowanego towaru albo notatki zagląda się raz na
sprawę, a wątek i kolejkę ma się przed oczami cały czas.

**Szuflada ma trzy wyjścia:** przycisk ZAMKNIJ w jej głowie, kliknięcie
w przyciemnienie i Escape. Escape zamyka SAMĄ szufladę i na tym kończy —
jeden klawisz zdejmujący szufladę i sprawę pod nią naraz byłby wyjściem
z pracy, a nie z panelu obok niej.

**Wszystkie trzy zakładki spraw**, nie tylko pytania z makiety. Powłoka trzech
stref jest wspólna od 0.93.0, więc ta sama czynność ma się zachowywać tak samo
w PYTANIACH, DOSTAWACH i ZWROTACH.

**Bez licznika przy napisie KONTEKST**, choć makieta go rysuje. Liczyłby co
innego na każdej zakładce: dopasowane towary przy pytaniu, notatki przy
dostawie, kandydatów na dokument przy zwrocie. Jedna pigułka o trzech
znaczeniach jest gorsza od braku pigułki.

**Przyciemnienie obejmuje też kolejkę**, choć makieta zostawia ją jasną.
Kliknięcie obok panelu zamyka panel — to jedna reguła zamiast dwóch, a szeroki
lewy margines szuflady jest najbliższym miejscem, w które trafi mysz.

**Poprawione przy okazji: kolejka rysowała się wariantem szerokim w wąskiej
szynie.** Warunek wyboru wariantu pytał o próg trzech stref, a pyta naprawdę
o to, czy sprawa ZASŁANIA listę — i ta odpowiedź zmienia się na 1024 px, nie
na 1280. Ten sam błąd dotyczył odświeżania kolejki i licznika odpowiedzi nad
listą dostaw: wszystkie trzy zachowywały się tak, jakby listy nie było widać,
a widać ją. `trybSzeroki()` ustąpiło miejsca `kolejkaZostaje()`.

**Test progów pilnuje teraz kompletu.** Znał jeden literał `matchMedia` i brał
z pliku pierwsze dopasowanie. Drugi próg wpisany tylko do skryptu dawałby
szufladę bez stylów, czyli kontekst znikający bez śladu na jednej szerokości
okna — sprawdzone, że test to łapie.

## 0.100.0 — 26 sierpnia 2026

**Czwarty zakres ANALIZY: dostawy.** Warstwa treści jest tym samym skończona
na wszystkich sześciu zakładkach.

**Jedyny zakres, który nie powstał z przenosin.** Pytania, zwroty i ślad
audytowy miały swoje liczby policzone gdzie indziej — chodziło o to, żeby
stanęły tam, gdzie ich miejsce. Zakładka DOSTAWY nie miała ani jednej karty
wglądu, a jedyne liczby o dostawcy stały w kontekście otwartej faktury, po
jednym dostawcy naraz.

**Pytanie brzmi „u kogo się psuje".** Do tego wydania panel odpowiadał na nie
przez otwieranie faktur po kolei i czytanie kafla dostawcy w każdej z osobna.

**Tabela dostawców sortuje po UDZIALE, nie po liczbie dostaw.** Dostawca
z dwiema fakturami i połową pozycji do wyjaśnienia jest ważniejszy od tego
z czterdziestoma bez ani jednej. Kolejność po liczbie zepchnęłaby go na dół,
czyli schowała dokładnie ten wniosek, po który się tu przychodzi.

**Dostawa zdjęta poza WERTIS wchodzi do liczby, nie do mediany czasu.** Ta sama
reguła co przy kaflu dostawcy: przyszła i ktoś się nią zajął, ale nikt jej
tutaj nie rozkładał, więc nie ma czego zmierzyć. Kolumna mediany ma przy niej
myślnik, a kafel „z tego poza WERTIS" nie jest czerwony — to legalna droga,
nie wpadka.

**Wyjątki liczą się po dacie zgłoszenia, nie po dacie domknięcia dostawy.**
Zgłoszenie sprzed dwóch miesięcy na fakturze domkniętej wczoraj opisuje tamten
tydzień. Otwarte i rozwiązane w osobnych kolumnach, ze wspólną skalą słupków:
dwie skale robiłyby dłuższy pasek przy mniejszej liczbie.

**Nowa trasa `/api/biuro/dostawy/analiza` stoi za bramką biura**, choć dane nie
są imienne. Powód jest inny niż przy śladzie audytowym: to ocena kontrahenta,
którą wnosi się na rozmowę handlową.

**Poprawione: zerowa wartość rysowała kreskę.** Słupek miał podłogę 2%, żeby
„jeden przy stu" nie wyglądał jak zero — i przez to samo zero też rysowało
kreskę. Pusty tor jest jedyną rzeczą, którą można odczytać jako „nic".

**Numer wersji APK zmienił wzór.** `versionCode` liczył się jako
`major × 10 000 + minor × 100 + patch`, więc setny minor dawał 10 000 —
dokładnie tyle, co przyszłe `1.0.0`. Gorzej: serwer odrzucał plik z członem
powyżej 99, czyli `wertis-kolektor-0.100.0.apk` przestałby być widoczny dla
kolektorów **bez ani jednego błędu w logu**. Zapas podniesiony do 999 po obu
stronach naraz — w `android/app/build.gradle.kts` i w `services/aktualizacja.ts`.
Nowe kody są większe od wszystkich starych (0.99.0: 9 900 → 99 000), więc
urządzenia w terenie przyjmą aktualizację normalnie. Nic nie trzeba robić
ręcznie: workflow `android.yml` chodzi na każdą zmianę `package.json`
i wystawia podpisany APK jako wydanie na GitHubie.

**Ziarno scenariuszy: osiem domkniętych dostaw zamiast jednej.** Jedna, u
jednego dostawcy, w jednym tygodniu, wystarczała do opisania POJEDYNCZEJ
sprawy. Zestawienie potrzebuje czterech dostawców, sześciu tygodni i jednej
dostawy zdjętej poza WERTIS — inaczej nie widać ani sortowania, ani reguły
o medianie. Trzeci raz ta sama lekcja, po pytaniach w 0.96.0 i wykresie
tygodni w 0.99.0: ekran zestawień trzeba zasiać inaczej niż ekran sprawy.
Doszedł scenariusz S77.

## 0.99.0 — 26 sierpnia 2026

**Analiza dostała warstwę treści i trzeci zakres.** Ostatnia zakładka po
pytaniach (0.96.0), dostawach (0.97.0) i zwrotach (0.98.0).

**Wgląd w zwroty wyprowadził się z zakładki pracy.** Raport procesu, statystyki
i czasy obsługi były zwijanymi sekcjami na ZWROTACH, z własnym oknem. Teraz
stoją w ANALIZIE pod zakresem „zwroty" — tą samą drogą, którą statystyki pytań
przeszły w 0.96.0. Zakładka ZWROTY jest odtąd samą pracą: skan, kolejka, kosze,
reklamacje, zapowiedzi. Konto Allegro zostaje przy niej, bo to stan połączenia,
a nie liczba o pracy.

**Okno przestało być w dwóch miejscach naraz.** Karta wglądu miała własny
selektor okna obok czipów w pasku ANALIZY. To było jedyne miejsce w panelu,
gdzie ta sama rzecz miała dwie kontrolki.

**Słupki w tabelach.** Liczba w kolumnie mówi „trzydzieści cztery" i nie mówi,
czy to dużo. Pasek robi porównanie z największą wartością w tej tabeli za
czytelnika. Liczba zostaje pod paskiem — tabela bez odczytywalnych wartości
przestaje być tabelą.

**Do wydajności per osoba słupków nie ma i to jest decyzja.** Ta tabela jest
monitoringiem pracowniczym, niesie podstawę prawną i osobne zdanie o tym, że
zgłoszone wyjątki nie są miarą błędu. Pasek zamienia zestawienie w ranking
i kasuje obie te ostrożności.

**Zdanie interpretujące pod wykresami.** Który tydzień odstaje, ile razy wobec
mediany pozostałych i jakie pytania w nim przeważały. Liczone, nie zmyślone:
makieta pisała w tym miejscu o „sezonie kosiarek", a tego z bazy policzyć się
nie da. Przy próbce zbyt cienkiej, żeby cokolwiek twierdzić, zdania po prostu
nie ma — milczenie jest lepsze od zdania, które brzmi jak wniosek, a jest szumem.

**„Dane do 26.08, 08:36" w pasku filtrów.** Liczone z najświeższego rekordu,
nie z zegara serwera. Zegar mówiłby zawsze „przed chwilą", także wtedy, gdy
synchronizacja z Allegro stanęła wczoraj.

**Kolumna STAN przy najczęściej pytanych towarach.** Lista mówiła dotąd
„pytają o to dwadzieścia razy" i nie mówiła, czy jest co sprzedać — a to dwa
różne wnioski zakupowe. Towar spoza kartoteki ma myślnik, nie zero: „nie mamy
ani sztuki" i „nie wiemy, o czym mowa" to dwie różne odpowiedzi.

**Kolumna URZĄDZENIE przy pytaniach o towar spoza oferty.** Model maszyny był
wyłuskiwany z pytania od dawna i nikt go w tej tabeli nie pokazywał.

**Piąty kafel: potwierdzone dopasowania.** Jedyna liczba na tej karcie, która
mówi o WIEDZY, a nie o tempie — potwierdzona para maszyna→część zostaje
i skraca każde następne pytanie o tę samą maszynę. Ma autora, więc jako jedyny
z przekrojów produktowych wchodzi pod filtr OSOBA.

**Klauzula pod listą pytań spoza oferty.** Treści są dosłownymi cytatami
z Centrum wiadomości — zestawienie mówi, do czego jest, zanim ktoś użyje go do
czegoś innego.

**Poprawione: wykres rozdymał się razem z kartą.** SVG skaluje się w całości,
razem z wysokością i podpisami osi, więc wykres w karcie na pełną szerokość
urósł do czterystu pikseli wysokości. Do 0.99.0 wszystkie pięć wykresów stało
w wąskich kolumnach i nikt tego nie zobaczył.

**Poprawione: przenosiny kart zgasiły zakładkę zwrotów.** Lista sterująca
chowaniem kart przy otwartym zwrocie wskazywała na kartę, która właśnie
wyjechała do ANALIZY — a `hidden` na `null` wywala całą zakładkę. Klik w wiersz
„co stoi teraz" prowadzi teraz przez granicę zakładek: przełącza widok na
ZWROTY i dopiero tam otwiera kosz albo sprawę.

**Ziarno scenariuszy: dziewięć pytań zamiast czterech.** Cztery stały w jednym
tygodniu i opisywały stany sprawy. Wykres tygodni, słupki proporcji i zdanie
o szczycie potrzebują rozrzutu w czasie — bez niego nie dało się zobaczyć, czy
w ogóle działają. Ta sama luka, przez którą skrzynka pytań stała pusta
do 0.96.0. Doszły scenariusze S75 i S76.

## 0.98.0 — 26 sierpnia 2026

**Zwroty dostały warstwę treści**, po pytaniach (0.96.0) i dostawach (0.97.0).

**Skan wszedł do głowy kolejki.** Pole na numer etykiety stało dotąd własną
kartą nad listą, a lista drugą pod nią. To jedna czynność w dwóch kartach:
skanujesz, żeby coś na tej liście otworzyć. Teraz karta jest jedna — nagłówek,
licznik, skan, czipy, lista. „POBIERZ Z ALLEGRO" zeszło pod listę i ucichło.

**Czipy zamiast listy rozwijanej.** Do oceny · Czeka na środki · Rozliczone ·
Wszystkie. Zakładka otwiera się na „Do oceny", czyli na pracy; poprzedni wybór
startował od „wszystkie" i pokazywał archiwum razem z tym, co czeka.

**Wiersz szyny ma kropkę stanu, nie pigułkę.** Pigułka w każdym z kilkunastu
wierszy robiła z listy szachownicę i kolor przestawał cokolwiek znaczyć.
Pigułka zostaje na nagłówku sprawy, gdzie jest jedna.

**Pozycja zwrotu jest kartą.** Symbol, ilość i nazwa, plakietka powodu po
prawej, pod nimi cytat klienta i pasek czterech decyzji. Powód opisowy —
zdanie, które kupujący napisał sam — siedział dotąd w kolumnie tabeli i ginął
w niej. To jedyne zdanie w całej sprawie, które mówi, CO SIĘ STAŁO.

**Wybrana decyzja jest grafitowa, nie bursztynowa.** Zwrot na trzy pozycje dawał
trzy bursztynowe przyciski plus bursztynową akcję główną. Grafit to w tym
panelu „stan wybrany w segmencie"; bursztyn zostaje dla tego, co się klika.

**Blok zamówienia pokazuje resztę, nie całość.** Dotąd wypisywał wszystkie
pozycje zamówienia z plakietkami WRACA i zostaje — czyli powtarzał drobniej to,
co stoi wyżej jako karty. Pytanie brzmi „czy wraca komplet, czy jedna rzecz
z zestawu", więc odpowiada teraz sama lista tego, co u klienta zostało.

**TEN KLIENT: dwie liczby i zdanie o tym, czym one są.** Zwroty w dwunastu
miesiącach i ile z nich to reklamacje. Bez zdania ramującego licznik reklamacji
czyta się jak nota wystawiona człowiekowi. Sekcja milczy przy zwrocie ręcznym —
zero nie znaczyłoby wtedy „nie zwracał", tylko „nie wiemy, kto to".

**Rozliczenie zbiera oba końce sprawy.** „OCEŃ I ZLEĆ KOREKTĘ" przeszło ze
środka sprawy do kontekstu, do pary ze stemplem oddanych środków — tak jak
domknięcie dostawy od 0.92.0. Pod tabelą został spis tego, co pójdzie na
korektę: przycisk pyta, ta lista odpowiada.

**Poprawione: przenosiny przycisku nie urwały mu nasłuchu.** Ta sama usterka
zdarzyła się w 0.92.0, 0.96.0 i 0.97.0 — delegacja zostawała na pojemniku,
który przycisk właśnie opuścił, a martwy przycisk wygląda jak żywy. Zwroty
przeszły więc na nasłuch na SEKCJI, jak pytania i dostawy, a test regresji
dopisał sobie oba porzucone pojemniki.

## 0.97.0 — 26 sierpnia 2026

**Dostawy dostały warstwę treści**, tak jak pytania w 0.96.0.

**Kolejka mówi, ile pracy stoi.** Nagłówek to „DO ROZŁOŻENIA" z liczbą
dokumentów i pozycji za nimi. „Cztery faktury" i „cztery faktury na sto
osiemnaście pozycji" to dwie różne wiadomości o dniu, który przed kimś stoi.

**Czipy zamiast trzech kart.** W toku · Zamknięte · Poza WERTIS. Ostatnie
stało dotąd własną kartą na dole zakładki i biuro trafiało tam przypadkiem;
jako trzeci stan tej samej kolejki jest tam, gdzie się go szuka.

**Jeden kształt wiersza zamiast dwóch.** Lista miała postać tabeli na sześć
kolumn przy zamkniętym dokumencie i wiersza łamanego w pionie po otwarciu.
Tabela była ciasna wszędzie poniżej pełnej szerokości: data łamała się na dwie
linie, nazwa dostawcy na trzy. Wiersz zwarty niesie dokładnie to samo, a pasek
postępu podkreśla go na całej szerokości.

**Wyjątki wyszły na górę sprawy.** Tabela na trzydzieści cztery wiersze
zawiera zwykle dwa, przy których ktoś czeka na decyzję — i stały w niej
wymieszane z resztą, rozpoznawalne po plakietce w czwartej kolumnie. Teraz
mają własną sekcję nad pozostałymi pozycjami, a zgłoszenie magazyniera dostaje
własną linię na całą szerokość zamiast komórki na dwie piąte tabeli.

**Dostawca niesie trzy liczby.** Ile dostaw w tym roku, jaki udział pozycji
z wyjątkiem i mediana czasu rozłożenia — liczone z naszych tabel, nie
z Subiekta. Biuro rozstrzyga wyjątek, patrząc na jedną pozycję jednej faktury,
i bez nich nie ma z czego wiedzieć, czy niedobór u tego dostawcy zdarza się co
drugi raz, czy pierwszy raz w tym roku. To jest cała różnica między
„policzyć ponownie" a „reklamować".

**Notatki są rozmową.** Pytanie biura bursztynowym dymkiem, odpowiedź z hali
szarym — te same dymki, którymi czyta się wątek klienta. Dotąd obie strony
siedziały w jednym prostokącie, a odpowiedź zaczynała się od słowa
„Odpowiedź:", bo inaczej nie dało się poznać, gdzie kończy się pytanie.

**Poprawione: nagłówek wyjątków liczył pozycje, a nazywał je wyjątkami.** Po
zamknięciu zgłoszenia dalej pisał „2 wyjątki" przy jednym otwartym. Teraz
nagłówek liczy pozycje, a plakietka otwarte wyjątki — i gaśnie na zielono,
gdy nic już nie czeka na decyzję.

## 0.96.0 — 25 sierpnia 2026

**Zakładka pytań dostała treść, nie samą powłokę.** Wydania 0.89.1 → 0.95.0
przeniosły istniejące bloki do nowego układu; makiety przeprojektowywały też
to, co jest w środku, i tej połowy nie robił żaden etap. To pierwsze wydanie
warstwy treści.

**Skrzynka mówi, ile i czego.** Nagłówek szyny to teraz liczba spraw
z rozbiciem na te ze szkicem i te, które dopiero czekają na model. Liczby
przychodziły od dawna — trasa licznika je zwraca — i lądowały wyłącznie
w dymku pod kursorem, czyli tam, gdzie nikt go nie trzyma.

**Filtr to czipy, nie lista rozwijana.** Przy trzech stanach wyliczenie ich
jest krótsze niż schowanie. Doszedł stan „wszystkie", którego wcześniej nie
dało się wybrać: brak filtra znaczył worklistę, a archiwum było poza zasięgiem.

**Stan sprawy to kropka i słowo.** Wypełniona pigułka zostaje dla wyjątków —
„poza ofertą", „po terminie". Pięć pigułek w wierszu przestaje być sygnałem.

**Widać, kto napisał odpowiedź.** Bursztynowa szyna przy krawędzi pola znaczy
„tego nie napisał człowiek" i gaśnie przy pierwszym wpisanym znaku.
Przywrócenie szkicu zapala ją z powrotem. Dotąd mówiło o tym jedno zdanie nad
polem, które czyta się raz i przestaje.

**Przyciski rozeszły się na trzy miejsca.** Stało ich siedem w jednym rzędzie
pod polem: „POMIŃ" sąsiadowało z „WYŚLIJ PRZEZ ALLEGRO", czyli wyjście ze
sprawy z jej domknięciem. Teraz przy tytule stoi to, co sprawę zdejmuje, przy
etykiecie ODPOWIEDŹ to, co podmienia tekst, a pod polem to, co robi się
z tekstem gotowym. Doszedł skrót **Ctrl+Enter** do wysłania.

**Statystyki wyprowadziły się na ANALIZĘ** — pod nowy filtr ZAKRES. Zakładki
pracy zostają czystą kolejką spraw, zgodnie z podziałem, który pasek zakładek
ogłasza od 0.74.1. Doszedł filtr OSOBA; karta mówi wprost, czego on nie
obejmuje, bo pytania przychodzą od klientów i autora po naszej stronie nie
mają. Okno jest czipami i **zależy od zakresu** — ślad audytowy mierzy się od
tygodnia, pytania od miesiąca.

**Pusta skrzynka przestała wyglądać jak awaria.** To najczęstszy stan tej
zakładki w spokojny dzień, a pokazywał trzy karty z samymi zerami: trzy strefy
włączają się dopiero przy otwartej sprawie, więc przy zerze nie było czego
otworzyć. Teraz zostaje zdanie o pustej skrzynce i wklejka z poczty.

**[wymaga działania] Ziarno scenariuszy zakłada teraz cztery pytania.** Do tej
wersji nie zakładało ani jednego, więc zakładki nie dało się obejrzeć w demo
z treścią — od 0.91.0 nikt jej takiej nie widział. Po `git pull` przebuduj
dane demo: `npm run seed:scenariusze`. Na bazie produkcyjnej seed się nie
uruchamia i nic tam nie zmienia.

## 0.95.0 — 25 sierpnia 2026

**Zakładki wjechały do ciemnego paska.** Stały dotąd pod nagłówkiem, we
własnej białej karcie — trzecie pasmo chromu nad treścią, obok paska stanu.
Panel bywa otwarty na laptopie obok Subiekta i ten pion był najdroższą rzeczą
na ekranie: **chrom schudł ze 159 do 95 pikseli**, czyli sprawa zaczyna się
o sześćdziesiąt kilka pikseli wyżej, na każdej zakładce.

**Podpisy grup zostają**, i to jest decyzja, nie przeoczenie. Makiety
zastępowały je samym separatorem, ale „Praca" i „Wgląd" to słownik całej
przebudowy: pierwsza trójka daje trzy strefy z kolejką, druga jedną z paskiem
filtrów. Sam separator mówi tylko, że grupy są dwie. W ciemnym pasku podpis
stoi w tej samej linii co pastylki, a nie nad nimi — inaczej nagłówek urósłby
o drugi wiersz i oddał połowę tego, po co zakładki tam pojechały.

**Podtytuł „Podgląd biura" pokazuje się już tylko przed zalogowaniem.** Mówi
to samo, co podświetlona pastylka, a w jednym rzędzie z sześcioma innymi
zabierał szerokość, której na laptopie nie ma.

**Kto · ustawienia · wyloguj zawijają się razem.** Każde z nich było osobnym
dzieckiem nagłówka, więc gdy zakładki zajęły cały rząd, „Wyloguj" spadał do
drugiego wiersza sam, zostawiając nad sobą zębatkę.

Mechanizm się nie zmienia: `data-widok` zostaje nietknięte, więc obsługa
kliknięcia i podświetlenie bieżącej zakładki szukają przycisków po atrybucie,
a nie po miejscu w drzewie. Przyklejone szyny kontekstu i pasek filtrów liczą
się z wysokości mierzonej w JS, więc same zeszły w górę razem z chromem.

## 0.94.0 — 25 sierpnia 2026

**Zakładki wglądu przestały udawać zakładki pracy.** STAN SYSTEMU, DZIENNIK
i ANALIZA nie mają kolejki, bo nie ma tu spraw do wzięcia — jest jedna
powierzchnia do czytania. Do tej wersji wyglądały jednak identycznie jak
dostawy czy zwroty: ten sam stos białych kart na tej samej siatce.

**Karty przestały się rozciągać.** Karta w rzędzie siatki rosła do wysokości
najwyższej sąsiadki. REKONCYLIACJA to jeden przycisk, a stała obok kolejki na
kilkanaście wierszy — i miała pod tym przyciskiem trzysta pikseli pustej
bieli. To wyglądało na usterkę, nie na układ. Teraz karta jest tak wysoka, jak
jej treść.

**Tytuł bloku jest tytułem.** Nagłówek karty to było 10 px wersalikami —
stopień słuszny na zakładce pracy, gdzie podpisuje sprawę stojącą obok i ma
z nią nie konkurować. We wglądzie sprawy nie ma: bloki SĄ treścią. Podnagłówki
w środku bloku zostają ciche.

**Filtry wyszły z pierwszej karty do własnego pasma.** Osiem kontrolek
dziennika i wybór okna analizy rządzą całym widokiem, a stojąc wewnątrz karty
obiecywały, że dotyczą tylko jej. Pasek przykleja się pod zakładkami, więc
przy tysiącu wierszy dziennika zmiana zakresu nie wymaga przewijania na samą
górę. Nie jest kartą, tylko pasmem na papierze — filtry to chrom, nie treść.

**STAN SYSTEMU paska NIE dostał, i to jest decyzja, nie przeoczenie.** Jego
OKNO dotyczy wyłącznie metryk: kolejka zapisów, rekoncyliacja, kolizje kodów
i stan serwera mówią o teraz i żaden zakres dni ich nie zmienia. Pasek nad
kartami obiecywałby, że filtruje całą zakładkę — a filtrowałby jedną kartę.
**Od tej wersji pilnuje tego test**, bo wyniesienie tamtego OKNA „dla
spójności" wyrównałoby układ i zarazem kazałoby interfejsowi kłamać.

**Naprawione przy okazji: jeden nieczytelny wiersz śladu kładł oba raporty.**
Reguła odsiewająca dublowane zdarzenia lokalizacji czyta źródło z payloadu,
a `json_extract` na uszkodzonym payloadzie nie zwraca pustki — przerywa całe
zapytanie. Wystarczyło, żeby okno sięgnęło dnia, w którym taki wiersz powstał:
`ANALIZA` i `STAN SYSTEMU` na 90 dniach odpowiadały błędem serwera, razem
z eksportem CSV. Na 7 dniach działało, więc usterka nie rzucała się w oczy.
Wiersz nie do odczytania liczy się teraz jak wiersz bez zapisanego źródła,
czyli jako zmiana z karty — tak samo jak dane sprzed wprowadzenia tego pola.

## 0.93.0 — 25 sierpnia 2026

**Zwroty domykają komplet zakładek pracy w trzech strefach.** Kolejka zwrotów
po lewej, ocena pozycji na środku, sprawa dookoła po prawej — każda strefa
z własnym przewijaniem.

**Środek to jedna robota: ocenić towar z paczki.** Zostały tam pozycje
z decyzjami, dopisywanie pozycji zwrotu ręcznego i tabela dokumentów, które
z tych decyzji wychodzą. Zdjęcia kartoteki zostają przy wierszach, bo decyzję
podejmuje się z paczką w ręku.

**Do kontekstu poszło to, co sprawę otacza:** dokument sprzedaży, rozmowa
z klientem, kosz zwrotowy i zwrot środków. Wszystkie cztery stały dotąd
w jednym pionowym stosie pod tabelą pozycji, więc przy zwrocie na kilka
pozycji przycisk zwrotu środków wypadał z ekranu — a to jest ostatni krok
całej sprawy.

**Kandydaci na dokument sprzedaży są kafelkami, nie tabelą.** Sześć kolumn
mieści się w karcie na całą szerokość, ale nie w szynie kontekstu: ucinało
kontrahenta w połowie, a powód dopasowania — jedyną przesłankę do wyboru —
zjadało w całości.

**Lista zwrotów ma wariant zwarty**, jak listy dostaw i pytań: numer z datą,
kupujący, a pod spodem status z licznikiem pozycji i numerem dokumentu.

**Decyzja odświeża też kolejkę obok.** Do tej wersji szło samo odświeżenie
karty zwrotu i to wystarczało, bo listy przy otwartym zwrocie nie było widać.
W trzech strefach kolejka stoi tuż obok nagłówka: po decyzji nagłówek mówił
„OCENIONY", a wiersz obok „NOWY · 1/3 poz." — dwie sprzeczne prawdy na jednym
ekranie. Zapytanie jest lokalne i nie idzie do Allegro.

**Potwierdzenie zwrotu środków przestało być bursztynowe.** Bursztyn znaczy
„to jest ta jedna rzecz do zrobienia tutaj", a odkąd strefy stoją obok siebie,
świecił obok przycisku wystawienia dokumentów. Ten przycisk tylko odnotowuje
zwrot środków wykonany w panelu Allegro.

Poniżej progu, przy którym kolumny się nie mieszczą, wszystko wraca do układu
sprzed zmiany: sprawa zasłania kolejkę, a kontekst schodzi pod nią.

## 0.92.0 — 25 sierpnia 2026

**Dostawy dostały ten sam trójpodział co pytania klientów.** Lista dokumentów
po lewej, pozycje na środku, dostawca z notatkami po prawej — każda strefa
z własnym przewijaniem.

**Notatki wyszły z nagłówka.** Siedziały nad tabelą pozycji, więc przy
dokumencie na kilkadziesiąt wierszy wypadały z ekranu razem z przyciskiem
dodania kolejnej. A to jest rozmowa z halą, na którą czeka domknięcie
dostawy — i przycisk zdjęcia dostawy z listy pracy, czyli decyzja, nie
element czytania pozycji. Jedno i drugie stoi teraz w strefie kontekstu,
zawsze widoczne, niezależnie od długości dokumentu.

**Numer dokumentu jest tytułem sprawy** i dostaje stopień tytułu, tak jak
temat oferty przy pytaniach.

**Lista dostaw ma wariant zwarty.** Sześć kolumn mieści się w karcie na całą
szerokość, ale nie w szynie: status z licznikiem wyjątków uciekał poza
krawędź. W szynie ten sam wiersz stoi w czterech linijkach — numer z datą,
dostawca, stan, pasek postępu.

Poniżej progu, przy którym kolumny się nie mieszczą, wszystko wraca do układu
sprzed zmiany.

## 0.91.0 — 25 sierpnia 2026

**Wątek klienta stanął na środku.** Zakładka PYTANIA KLIENTÓW rozkłada się na
trzy niezależnie przewijane strefy: kolejka spraw po lewej, sprawa na środku,
kontekst po prawej. Do tej wersji wszystko stało w jednej kolumnie jedno pod
drugim, więc weryfikacja doboru części wymagała przewinięcia wątku w dół,
a potem z powrotem w górę do pola odpowiedzi.

**Rozmowa przewija się, odpowiedź zostaje na dole.** Przy dłuższym wątku pole
odpowiedzi uciekało pod krawędź ekranu i biuro skakało między tym, co klient
napisał, a tym, co pisze samo. Teraz rozmowa ma własne przewijanie, a pole
odpowiedzi stoi pod nią na stałe.

**Kolejka i kontekst dostały układ zwarty.** Siedmiokolumnowa tabela pytań
mieści się w karcie na całą szerokość, ale nie w szynie — tekst pytania
wychodził poza kartę i był przycinany. W szynie ten sam wiersz stoi w trzech
linijkach: klient z wiekiem, temat oferty, stan sprawy. Tak samo kartoteka
w kontekście: zamiast pięciu kolumn, z których cena i aukcja uciekały poza
krawędź, jest kafelek z ceną i przyciskiem wstawienia linku.

**Miara wiersza.** Na monitorze dwudziestocalowym kolumna sprawy ma ponad
tysiąc stu pikseli, a wiersz tej długości czyta się źle niezależnie od stopnia
pisma. Treść ma teraz górną granicę szerokości.

Poniżej progu, przy którym kolumny się nie mieszczą, wszystko wraca do układu
sprzed zmiany: sprawa zasłania kolejkę, a kontekst schodzi pod nią. Próg jest
ten sam, którego zakładka używała dotąd, i **od tej wersji pilnuje go test** —
stał w dwóch miejscach naraz, w arkuszu i w skrypcie, a rozjazd objawiłby się
tylko na jednej szerokości okna.

## 0.90.0 — 25 sierpnia 2026

**Panel biura odzyskał hierarchię.** Zgłoszenie brzmiało „zero hierarchii, wątek
klienta powinien być na środku" i miało pokrycie w wartościach, nie w guście.
Etykieta sekcji była tym samym pismem co treść i opisywała **wszystko** —
pytanie klienta tak samo jak statystyki. Skala kończyła się na piętnastu
pikselach symbolu towaru, więc nic na ekranie nie było ani tytułem sprawy,
ani tekstem do czytania.

**Etykieta cichnie, treść rośnie.** Nagłówki sekcji schodzą do dziesięciu
pikseli pisma wąskiego w kolorze przygaszonym — nazywają sekcję, zamiast z nią
konkurować. W drugą stronę idą dwa stopnie, których panel nie miał wcale:
**temat sprawy** i **rozmiar do czytania**. Tytuł oferty stoi teraz osobno,
w stopniu tytułu; wcześniej jechał w jednej linii z loginem, tym samym pismem
co reszta, więc sprawa nie miała na ekranie nazwy — tylko wiersz danych.

Rozmowa z klientem i pole odpowiedzi czytają się w piętnastu pikselach
z interlinią jeden i sześć dziesiątych. Do tej wersji wątek czytało się
w rozmiarze komórki tabeli, a to jest tekst, nad którym siedzi się minutami.

**Bursztyn odzyskuje znaczenie.** Był w logo, zakładkach, plakietkach,
przyciskach, odnośnikach, ramkach i pierścieniu zaznaczenia — kolor, który
wskazuje wszystko, nie wskazuje niczego. Na karcie sprawy trzy sąsiadujące
przyciski świeciły nim naraz. Zostaje przy **jednej akcji głównej**: wysłaniu
odpowiedzi do klienta. Przeliczenie szkicu i zapis to kroki po drodze i mają
wygląd drugorzędny. Strzałka sekcji zwijanej też przestaje być bursztynowa.

**Przycisk zablokowany wreszcie na to wygląda.** Kod używał atrybutu
`disabled`, a arkusz stylów nie miał dla niego ani jednej reguły — przycisk,
którego nie da się kliknąć, wyglądał identycznie jak czynny.

Przy okazji dwie usterki widoczne gołym okiem: karta sprawy pisała **„1 dni"**,
a ostrzeżenie o cudzej sprawie — **„od 1 godz.. Odezwij się"** z dwiema
kropkami, bo licznik wieku sam kończy się kropką.

Zmiana jest wyłącznie wizualna. Układ, struktura strony i zapisy zostają
nietknięte — przebudowa układu idzie osobno.

## 0.89.1 — 25 sierpnia 2026

**Odpowiedzi do klientów przestały się pisać maszynowym krojem.** Reguła
`font: inherit` obowiązywała w panelu wyłącznie dla pola w oknie dialogowym,
więc cztery pola wielowierszowe poza nim renderowała przeglądarka: domyślnym
monospace'em, bez ramki i bez zaokrąglenia, jakich używa reszta panelu.

Najgorzej wypadało pole odpowiedzi na zakładce PYTANIA KLIENTÓW. Tekst, który
klient czyta potem na Allegro, redagowało się w kroju, w którym nigdy się nie
pokaże — więc długość akapitu i łamanie wierszy na ekranie nie mówiły nic
o tym, jak wiadomość wygląda naprawdę. Ten sam los miały treść pytania
wklejana z poczty oraz prompt eksperta i fakty firmowe w ustawieniach.

Wygląd pola jest teraz jeden dla całego panelu, a pierścień bursztynowy przy
zaznaczeniu obowiązuje tak samo jak przy zwykłych polach jednowierszowych.
Reguła dla pola w dialogu została odchudzona do tego, co dotyczy wyłącznie
dialogu: szerokości i odstępu z góry.

## 0.89.0 — 25 sierpnia 2026

**Zakładka PYTANIA KLIENTÓW przestała być formularzem, a zaczęła być
stanowiskiem pracy.** Serwer liczył od 0.80.0 znacznie więcej, niż panel
rysował, a najcenniejsze dane magazynowe nie wchodziły do kontekstu wcale.

**Treści pytania NIE BYŁO na ekranie.** Szczegół nie używał jej ani razu:
pytanie widać było na liście, obcięte do 120 znaków, albo w ROZMOWIE — a ta
jedzie z Allegro osobnym zapytaniem. Przy wklejce ze screenshota transkrypcja
nie pojawiała się nigdzie, a gdy Allegro nie odpowiadało, zostawał pusty
prostokąt, choć treść leżała w naszej bazie. Teraz stoi nad rozmową i pochodzi
stąd, gdzie zawsze była.

**„Nie mamy" to nie to samo co „nie sprawdziliśmy".** Awaria pobierania aukcji
dawała komunikat „Nic nie pasuje" — zdanie, które biuro mogło w dobrej wierze
przepisać klientowi. Powód niepowodzenia szedł dotąd wyłącznie do modelu;
teraz panel mówi wprost, że lista jest niepełna, i odradza odpisywanie „brak".

**Termin dostawy w odpowiedzi dla klienta.** Kontekst niósł sam stan, więc
„nie mamy, ale przyjdzie 20.08" było odpowiedzią nie do napisania — mimo że
karta towaru liczy to od dawna. Kartoteka przy pytaniu niesie teraz towar
zamówiony u dostawcy wraz z terminem, towar przyjęty i jeszcze nierozłożony,
EAN, stan skorygowany o kolejkę zapisów oraz zamienniki **rozstrzygnięte
kartoteką**: nasz symbol wolno klientowi obiecać, cudzy numer katalogowy służy
wyłącznie do rozpoznania części. Wszystko z naszej bazy — ani jednego
wywołania Allegro więcej, bo po blokadzie z 0.85.0 to jedyny zasób, którego
trzeba tu pilnować.

**Widać, skąd wzięło się dopasowanie.** Po czym szukaliśmy, co potwierdziliśmy
wcześniej i co odpowiadaliśmy na pytania o tę samą ofertę — wszystko to szło
do modelu i ginęło. Stoi w zwijanej sekcji, razem ze znacznikiem przy
pozycjach, które wskazał MODEL. To one trafiają do bazy dopasowań przy
wysyłce, więc człowiek zatwierdzał je dotąd w ciemno.

**HISTORIA KLIENTA.** Ten sam login pisze drugi raz częściej, niż się wydaje,
a odpowiedź brzmi inaczej, gdy widać, że tydzień temu coś zwracał. Karta jest
zwinięta i pyta serwer dopiero po rozwinięciu — otwarcie sprawy ma zostać
tanie. Zwroty i pytania po loginie kupującego dostały indeksy; dotąd szło to
pełnym skanem tabeli.

**Kto prowadzi sprawę.** Przy kilku osobach w biurze dwie odpowiedzi na jedno
pytanie to nie teoria, a klient zobaczy obie. Kolumna na liście mówi, kto
sprawę wziął; wejście w cudzą wita ostrzeżenie z nazwiskiem i czasem.

To jest ZNACZNIK, nie zamek — i nie stawia własnego przycisku. Nazwisko
stempluje **praca**: policzenie szkicu dla tej jednej sprawy albo zapisanie
odpowiedzi. Otwarcie ekranu nie zapisuje niczego, bo panel biura ma tę regułę
od 0.18.0 i ta zmiana nie jest od niej wyjątkiem. Zbiorcze liczenie szkiców
też nie stempluje: ticker wstawiłby nazwę usługi, a ODŚWIEŻ zająłby pięć
spraw komuś, kto chciał tylko sprawdzić, co przyszło. Wysłanie i zamknięcie
zwalniają sprawę.

**Licznik przy zakładce rozróżnia dwa stany.** Suma zlewała sprawę gotową do
przeczytania ze sprawą, dla której nikt jeszcze nie policzył szkicu — a od
0.85.0 ta druga grupa rośnie sama, bo ręczne ODŚWIEŻ liczy najwyżej pięć
szkiców naraz. Podpowiedź pod kursorem podaje oba.

**Drobiazgi z tej samej rodziny.** Licznik znaków wobec limitu Allegro (2000)
— dotąd limit egzekwował serwer PO napisaniu całości. PRZYWRÓĆ SZKIC, gdy
poprawka wyszła gorzej od oryginału. Stan konta Allegro na banerze, bo WYŚLIJ
od niego zależy, a zakładka nie miała jak uprzedzić. Dokładna data pytania
pod kursorem.

**Układ.** Zakładka nigdy nie dostawała klasy układu dwukolumnowego, więc
otwarte pytanie chowało kolejkę nawet na ekranie 3440 px — inaczej niż
DOSTAWY i ZWROTY. Ten sam próg, ta sama reguła, wiersz listy zaznaczony.

## 0.88.5 — 23 sierpnia 2026

<!-- docs_check: historia -->
**Odwrotny ukośnik w `TLO_URL` przestaje kłaść magazyn.** W `wertis.env`
wpisano `TLO_URL=http:\\127.0.0.1:8791`. Serwer odmówił startu, `wertis-api`
i `wertis-worker` przestały wstawać, a na ekranie było `SERVICE_PAUSED`
z NSSM — objaw, którego nikt nie kojarzy z ukośnikiem.

### Ta pomyłka jest na Windowsie naturalna

W tym samym pliku konfiguracyjnym **każda inna wartość ze znakiem podziału
używa `\`** — bo są to ścieżki: `C:\wertis`, `ZDJECIA_KATALOG=D:\zdjecia`,
`TLO_MODEL=C:\wertis\tlo-worker\model\…`. Ręka pisze dalej to samo i nie
ma w tym niedbałości.

Prostujemy więc ukośniki przy odczycie klucza. `\` w adresie hosta **nie ma
żadnego innego możliwego znaczenia** — przeglądarki robią dokładnie to samo
od zawsze. Naprawiamy pomyłkę jednoznaczną; przy niejednoznacznej nadal nie
zgadujemy.

### Bramka zostaje

Adres **bez schematu** (`127.0.0.1:8791`) nadal zatrzymuje start — tam nie ma
czego prostować, a ciche przyjęcie znaczyłoby usługę tła wołaną pod adresem,
którego nie da się otworzyć, i nikt by się o tym nie dowiedział.

Pilnują tego dwa nowe pliki testów. `tlo-url.test.ts` sprawdza, że wersja
z odwrotnymi ukośnikami **nie rzuca przy imporcie** i że adres da się potem
złożyć przez `new URL`. `tlo-url-bramka.test.ts` uruchamia `config.ts`
w OSOBNYCH procesach — odmowa jest zdarzeniem przy imporcie, więc inaczej się
jej nie zmierzy — i potwierdza, że schemat nadal jest wymagany.

### Czego ta wersja NIE zmienia

Filozofii głośnej odmowy. Rozważano zdegradowanie złego `TLO_URL` do wpisu
w `problemy` z `/api/health` — bo jedynym skutkiem jest „zdjęcia zapisują się
z tłem", a to nie jest powód, żeby zatrzymywać halę. Właściciel wybrał węższą
poprawkę: naprawiamy konkretną literówkę, reguła zostaje nietknięta.

---

## 0.88.4 — 22 sierpnia 2026

<!-- docs_check: historia -->
**`ZDJECIA_DODAWANIE=subiekt` przestaje wyglądać na równorzędny wybór — bo nie
jest.** Instrukcja wdrożenia stawiała `wertis` i `subiekt` obok siebie, jakby
różniły się tylko miejscem zapisu. Różnią się warunkami wstępnymi, a cena
pomyłki jest wysoka: **API nie wstaje**.

### Co się stało

`subiekt` zakłada, że na instalacji działa już ODCZYT zdjęć — `ZDJECIA_ZRODLO=blob`
wraz z nazwami tabeli i kolumn, przy `SGT_MODE=mssql`. Bez kompletu `config.ts`
rzuca przy starcie i proces ginie. NSSM melduje wtedy `SERVICE_PAUSED`, co brzmi
jak awaria usługi, a jest odmową konfiguracji.

Instalator włącza odczyt zdjęć TYLKO wtedy, gdy w bazie firmy jest tabela
`tw_ZdjecieTw`. Na instalacji bez zdjęć wykonanie punktu 4 z DEPLOY kładło więc
`wertis-api` — instrukcją, nie kodem.

### Odmowa mówi teraz, co wpisać zamiast

Komunikat kończył się na diagnozie. Czyta się go z logu usługi, która właśnie
nie wstała, najczęściej pod presją i na cudzej maszynie — „czego brakuje" bez
„co wpisać zamiast" zostawia człowieka przy zgaszonym API.

Dochodzi więc droga wyjścia: `ZDJECIA_DODAWANIE=wertis` działa zawsze, bez
odczytu zdjęć i bez ósmego grantu. Zdjęcia widać na kolektorze od razu, a do
kartoteki przenosi się je później — bez zmian w kolektorze.

### Czego NIE zmieniono

Samej bramki. Odmowa startu przy niepełnej konfiguracji to reguła całego tego
repozytorium — `ZDJECIA_ZRODLO=blob` bez `ZDJECIA_KOLUMNA` zachowuje się tak od
0.30.0 — i jest słuszna. Cicha zła konfiguracja przy ZAPISIE do bazy firmy
byłaby gorsza niż głośna odmowa. Winna była instrukcja, nie bramka.

---

## 0.88.3 — 22 sierpnia 2026

<!-- docs_check: historia -->
**Suma kontrolna modelu jest ustalona, a cztery `[WERYFIKUJ]` z 0.88.0 —
zamknięte.** Wszystko na pliku, który naprawdę pobrano, a nie na założeniu.

### Suma kontrolna

`build.ps1` odmawiał budowania, bo `$modelSha` było puste. Tak miało być: liczba
wpisana z pamięci przechodziłaby sprawdzenie, nie sprawdzając niczego.

Wartość potwierdzono **trzema niezależnymi odczytami**:

| źródło | wynik |
|---|---|
| pobranie na maszynie wdrożeniowej | `sha256 309c8469…f4ddd8` |
| pobranie z innej maszyny i innej sieci | `sha256 309c8469…f4ddd8` |
| `rembg`, plik `rembg/sessions/u2netp.py` | `md5:8e83ca70e441ab06c318d82300c84806` |

Trzeci wpis jest tym, który rozstrzyga: to suma **deklarowana przez wydawcę**
w jego własnym źródle, a MD5 pobranego pliku jest z nią identyczne.

Dowodzi to, że pobrane bajty są dokładnie tymi, które rembg publikuje. NIE
dowodzi, że model jest dobry ani bezpieczny — zaufanie do rembg jest osobną
decyzją i zapadło przy wyborze modelu.

### Nazwa wejścia była inna, niż zakładał komentarz

Model odpytany wprost odpowiedział na wszystkie cztery pytania:

| pytanie | odpowiedź |
|---|---|
| nazwa i kształt wejścia | `input.1` — **nie** `input` — 1 × 3 × 320 × 320 NCHW |
| który tensor jest maską | wyjść siedem, maską pierwsze, 1 × 1 × 320 × 320 |
| czy jest sigmoida | siedem operacji `Sigmoid` na końcu grafu |
| adres i suma modelu | wpisane w `build.ps1` |

Jedna z tych odpowiedzi różni się od tego, co zakładał komentarz w kodzie:
wejście nazywa się `input.1`. Nie wymagało to poprawki, bo `UsuwanieTla.cs`
nigdy nie wpisywał tej nazwy na sztywno — bierze ją z metadanych sesji.
Gdyby wpisywał, model odmówiłby pracy przy pierwszym zdjęciu, a objawem byłby
wyjątek w usłudze, nie błąd budowania.

### Co zostaje do sprawdzenia

Jakość wycięcia na **towarze magazynowym**. Tego nie rozstrzygnie żaden plik
`.onnx` — tylko zdjęcia zrobione w hali. Dlatego w kolektorze stoi przycisk
„ZOSTAW TŁO", a model podmienia się jednym kluczem `TLO_MODEL`.

---

## 0.88.2 — 22 sierpnia 2026

<!-- docs_check: historia -->
**Instrukcje obu workerów mówią wreszcie, skąd wziąć .NET SDK.** Trzecie
potknięcie tego samego wdrożenia i znowu nie w kodzie: README obu usług żądały
„maszyny z .NET 8 SDK", ale ani jedno nie mówiło, jak go zainstalować.

Skutek był konkretny: pobrany plik `.pkg` — czyli instalator **macOS**, który
na Windowsie nie otwiera się wcale. `android/README.md` podaje przy JDK gotową
linijkę `winget` od dawna; workery nie podawały niczego.

Teraz podają — razem z trzema rzeczami, które przy ręcznym pobieraniu decydują:
bierze się **SDK**, nie Runtime, wariant **Windows x64 `.exe`**, i otwiera się
**nowe** okno PowerShella, bo instalator zmienia `PATH` i bieżąca sesja go nie
widzi. Do tego zdanie, którego brakowało najbardziej: SDK idzie na maszynę
dewelopera, a nie na serwer firmy — po to jest `--self-contained`.

### Przy okazji: `sfera-worker` miał tę samą usterkę co `tlo-worker`

Polecenie budowania workera Sfery nie miało `-ExecutionPolicy Bypass` ani
informacji, z którego katalogu je uruchomić. Dokładnie to, co 0.88.1 poprawiło
po drugiej stronie repozytorium — tylko że tam potknął się człowiek, a tu nikt
jeszcze nie zdążył. Obie instrukcje wyglądają teraz tak samo.

---

## 0.88.1 — 22 sierpnia 2026

<!-- docs_check: historia -->
**Skrypt budujący usługę tła przestaje mylić osobę, która go uruchamia.** Trzy
usterki wyszły przy pierwszym budowaniu na Windowsie, godzinę po scaleniu
0.88.0. Żadna nie dotyczy kodu — wszystkie dotyczą tego, co człowiek widzi.

### Skrypt, którego nie dało się URUCHOMIĆ

`tlo-worker/build.ps1` pojechał **bez BOM-u**, a `sfera-worker/build.ps1` go ma.
Windows PowerShell 5.1 czyta UTF-8 bez BOM jako ANSI — i to nie kończy się na
krzakach w komunikacie. Kończy się **błędem składni**:

```
The string is missing the terminator: ".
```

Mechanizm jest wart zapamiętania, bo wygląda niewinnie. Myślnik `—` to w UTF-8
bajty `E2 80 94`. Czytane jako ANSI dają trzy znaki, z których ostatni — bajt
`0x94` — jest **prawym cudzysłowem drukarskim** `”`. PowerShell przyjmuje
cudzysłowy drukarskie jako ogranicznik napisu, więc napis zamyka się na
myślniku, a reszta linii przestaje się parsować.

Skutek: każdy myślnik i każdy polski cudzysłów WEWNĄTRZ napisu to bomba
zegarowa. Poza napisem, w komentarzu, byłby tylko brzydki.

Instalator ma tę bramkę od dawna, ale liczy **wyłącznie** `instalator\*.ps1`.
Nowy katalog nie był objęty niczym i przeszedł przez CI zielono. Sprawdzenie
dochodzi teraz do `tlo-worker.yml` **oraz** do `sfera-worker.yml` — tamten plik
BOM ma, ale nic go nie pilnowało.

### Odesłanie do rozdziału, w którym nic nie ma

README i skrypt odsyłały do „DEPLOY.md §6, **etap 3**". Usługa tła to **etap 2a**;
etap 3 to „pełny obieg" i nie ma w nim ani słowa o `wertis-tlo`.

### Cztery słowa, bez których Windows odmawia

Polecenia budowania nie miały `-ExecutionPolicy Bypass`, więc kończyły się
zdaniem „running scripts is disabled on this system". Repozytorium przerabiało
to już raz — przy instalatorze — i wtedy `-ExecutionPolicy Bypass` trafiło
**wprost do każdego polecenia** w jego instrukcji. Nowy katalog powtórzył
pominięcie od zera.

Bypass dotyczy tego jednego uruchomienia; polityka systemowa zostaje nietknięta.
To samo zdanie stoi teraz w `tlo-worker/README.md`, co w `instalator/README.md`.

### „The argument does not exist"

`powershell -File tlo-worker\build.ps1` jest napisane dla korzenia repozytorium,
ale nigdzie tego nie mówiło — a człowiek naturalnie wchodzi najpierw do katalogu,
który widzi w nazwie, i dostaje odmowę. Sam skrypt liczy swój katalog
z `$MyInvocation` i działa z dowolnego miejsca; myliła **wyłącznie instrukcja**.

Obie drogi są teraz wypisane wprost, razem z ostrzeżeniem, żeby nie budować
w `C:\wertis\tlo-worker` — to katalog docelowy, nie miejsce pracy.

Przy okazji ostrzeżenie o odmowie sumy kontrolnej przeniosło się **nad** blok
z poleceniami. Przychodzi po kilku minutach `dotnet publish` i bez uprzedzenia
wygląda jak awaria buildu, a jest krokiem procedury. Wcześniej nie dało się —
żeby policzyć sumę pliku, trzeba go najpierw pobrać.

---

## 0.88.0 — 22 sierpnia 2026

**Magazynier dodaje zdjęcie kartoteki z kolektora.** Do 0.87.0 kartoteka bez
zdjęcia pokazywała na karcie szary kwadrat z ikoną pudełka i nic więcej.
Człowiek stał przy regale z towarem w ręku, widział, że zdjęcia nie ma, i nie
miał czym tego naprawić — jedyną drogą było „powiedz biuru". Ta sama ślepa
uliczka, którą 0.37.0 zlikwidowało dla kodów kreskowych.

Teraz pusty slot jest przyciskiem. Dotknięcie otwiera aparat albo galerię,
zdjęcie jedzie na serwer, tam osobna usługa wycina tło, a magazynier ogląda
wynik i dopiero wtedy zapisuje.

**[wymaga działania — opcjonalne]** Funkcja jest **domyślnie wyłączona**
i niczego nie zmienia, dopóki nikt nie ustawi `ZDJECIA_DODAWANIE`. Uruchomienie
w pełnym zakresie wymaga trzech rzeczy: nowej usługi `wertis-tlo`, **ósmego
`GRANT`** i nowego APK. Komplet: [`DEPLOY.md`](DEPLOY.md) §6, etap 2a.

### Pierwszy raz dopisujemy wiersz do bazy firmy

`docs/subiekt-gt-struktura.md` mówił dotąd wprost: zdjęcia są tylko do odczytu,
zero `INSERT` do tabel Subiekta. To zdanie przestaje być prawdziwe i zostało
w dokumencie poprawione, a nie przemilczane.

Granica zapisu rozszerza się trzeci raz — po lokalizacji (spec §5.2) i kodzie
kreskowym (0.37.0) — ale po raz pierwszy o **dopisanie wiersza**, nie o zmianę
jednej kolumny istniejącego. Kosztuje to osobne uprawnienie:

```sql
GRANT INSERT ON dbo.tw_ZdjecieTw TO wertis;
```

Nadaje je instalator uruchomiony z `-ZdjeciaZapis`, i tylko z nim. Takiego prawa
nie daje się komuś dlatego, że zaktualizował aplikację.

`zd_Glowne` dostaje `1` wyłącznie wtedy, gdy kartoteka nie ma jeszcze żadnego
zdjęcia — liczone w tej samej transakcji co `INSERT`. Dwa wiersze oznaczone jako
główne dawałyby przy odczycie raz jedno zdjęcie, raz drugie, czyli ETag skaczący
przy każdym wejściu na kartę i kolektory pobierające obraz w kółko. To ta sama
pułapka, przez którą `ZDJECIA_KOLUMNA_KOLEJNOSC` jest obowiązkowe od 0.30.0.

### Bez ósmego grantu funkcja NIE przestaje działać

Zapisane zdjęcie ląduje najpierw w bazie WERTIS i karta rysuje je stamtąd
natychmiast — niezależnie od tego, czy zapis do Subiekta jest włączony, czy
zadanie w kolejce już się wykonało. Dokładnie tak `ean_alias` niesie kod
kreskowy mimo nieudanego `set_ean`.

Kopia znika dopiero po UDANYM zapisie do kartoteki. Od tej chwili źródłem jest
znowu Subiekt, więc poprawka zdjęcia zrobiona później w biurze dociera na
kolektor normalną drogą. Ile zdjęć czeka na wejście do Subiekta, pokazuje
`/api/health` w polu `zdjeciaWlasne`; liczba rosnąca z dnia na dzień jest
jedynym objawem zadań stojących w błędzie — karta wygląda wtedy poprawnie.

### Czwarty proces, bo model nie mieści się w serwerze

Wycinanie tła robi model open source na runtime ONNX, czyli moduł natywny.
Serwer WERTIS ma dwie zależności i zero modułów natywnych — nie z upodobania,
tylko dlatego, że stoi na maszynie, na której biuro wystawia faktury, i ma się
dać zainstalować bez kompilatora. Ta sama reguła nie pozwala mu skalować zdjęć
kartotek ani przerabiać logotypów dostawców.

Repozytorium miało już na to wzorzec: `sfera-worker/` jest trzecim procesem,
samowystarczalnym exe pod `nssm`, domyślnie wyłączonym. `tlo-worker/` jest
czwartym i działa tak samo. Bez niego zdjęcia zapisują się **z tłem**, a kolektor
mówi o tym wprost — funkcja robi mniej, nie przestaje działać.

Domyślny model to `u2netp` (Apache-2.0, ~4,7 MB). Nie leży w repozytorium, tak
samo jak AAR Honeywella: pobiera go `build.ps1` i sprawdza sumę kontrolną.
Przy pierwszym budowaniu skrypt **odmawia** — suma nie jest jeszcze ustalona,
a wpisanie liczby z pamięci dałoby weryfikację pozorną.

### Dlaczego człowiek ogląda wynik przed zapisem

Zdjęcie regału z pięcioma kartonami wygląda dla modelu tak samo jak zdjęcie
noża. Wycięcie bywa nieudane, a nieudane zdjęcie w kartotece Subiekta odkręca
już tylko biuro.

Dlatego droga ma dwa kroki. Pierwszy robi podgląd i nie zapisuje niczego, drugi
zatwierdza. W podglądzie stoją trzy przyciski: ZAPISZ, ZOSTAW TŁO (dla towaru,
którego model nie umiał wyciąć) i JESZCZE RAZ. „ZOSTAW TŁO" pojawia się
wyłącznie wtedy, gdy tło naprawdę usunięto — przycisk proponujący wybór między
dwiema identycznymi wersjami zdjęcia jest gorszy niż jego brak.

Podgląd stoi na szachownicy, nie na białym tle arkusza. Wycięte zdjęcie na
białym wygląda identycznie jak zdjęcie na białym stole, więc człowiek nie miałby
po czym poznać, czy tło zniknęło.

### „+" pojawia się po POTWIERDZONYM braku, nie w trakcie ładowania

Do tej pory „nie wiadomo jeszcze" i „zdjęcia nie ma" były w kolektorze jednym
stanem — dla rysowania szarego kwadratu to bez różnicy. Przy przycisku różnica
jest cała: bez niej „+" mignąłby przy każdym wejściu na kartę, także na
kartotece, która zdjęcie MA, i przesuwałby cel dotyku pod kciukiem. Slot
zachowuje przy tym stały rozmiar we wszystkich stanach, tak jak od 0.30.0.

Galeria idzie przez systemowy wybierak, więc **nie dochodzi żadne uprawnienie**
w manifeście. Aplikacja potrzebuje jednego pliku wskazanego ręką, a nie dostępu
do wszystkich zdjęć z urządzenia. Aparat jak dotąd nie wymaga uprawnienia
`CAMERA` — kadr robi `ACTION_IMAGE_CAPTURE`.

Ta operacja świadomie **nie działa offline** i arkusz mówi to wprost. Bufor
plikowy niesie meldunki, nie obrazy, a wycięcie tła i tak wymaga serwera.

### Zdjęcie kartoteki jedzie ostrzej niż dowodowe

Dowód do reklamacji ma pokazać rozbity karton i druk na etykiecie; 1280 px
i jakość 70 wystarczają. Zdjęcie kartoteki idzie do modelu, który tnie po
krawędziach przedmiotu, a artefakty JPEG-a robią z krawędzi strzępy — i te
strzępy zostają w obrazie na zawsze, także po wejściu do Subiekta. Stąd 1600 px
i jakość 85 na tej jednej drodze.

---

## 0.87.0 — 22 sierpnia 2026

**Logo dostawcy wchodzi do panelu biura i przestaje być znaczkiem na
kolektorze.** Dwie zmiany z jednego zgłoszenia: „dodajcie loga do wglądu
biura" i „na liście dostaw logo jest za małe, jakby miało za duży margines".
Druga okazała się usterką, nie sprawą gustu.

**Skąd brał się margines.** Panel zapisywał każde logo wyśrodkowane
w KWADRACIE 128×128, a logotyp jest zwykle szerokim paskiem z nazwą firmy —
więc dwie trzecie zapisanego obrazu to przezroczyste powietrze. Kolektor skaluje
obraz w całości, razem z tym powietrzem, i dlatego poszerzenie slotu w 0.64.0
nie dało nic widocznego: rósł margines, nie logo.

Teraz panel **przycina obraz do samego znaku** przed wysyłką i zapisuje go
z dłuższym bokiem 256 px zamiast 128 px, bo kolektor rysuje go dziś większy.
Loga wgrane wcześniej leżą w bazie takie, jakie były — serwer nie ma czym ich
przerobić i nie będzie miał — więc **kolektor przycina je sam przy
dekodowaniu**, raz na logo. Biuro nie musi wgrywać niczego od nowa, choć przy
najstarszych plikach warto: przycięcie z oryginału jest ostrzejsze niż
z miniatury.

Tniemy WYŁĄCZNIE przezroczystość. Logo na białym prostokącie (zwykły JPG)
zostaje, jak jest: „prawie biały" piksel bywa częścią znaku, a obcięcie go
byłoby zniekształceniem cudzego logotypu. Sama arytmetyka ramki mieszka
w module `:core` i ma dziewięć testów — pomyłka o jeden piksel przy krawędzi
obcina literę, a moduł `:app` testów nie ma.

Slot w wierszu listy dostaw rośnie przy okazji z 64 dp do 84 dp. Dwadzieścia
punktów zabiera nazwie dostawcy w środkowej kolumnie i to jest świadoma
wymiana: logo odpowiada na pytanie „kto to przywiózł" szybciej niż napis,
a napis zostaje pod nim.

Limit wagi pliku rośnie przy okazji z 64 kB do 128 kB — obraz o dłuższym boku
256 px waży więcej. Panel sam zmniejsza logo, dopóki się w tym limicie nie
zmieści, więc zdjęcie szyldu wgrane zamiast logotypu też przejdzie: odmowa
„wgraj jeszcze raz przez panel" byłaby przy nim ślepym zaułkiem, bo panel
właśnie to zrobił.

**W panelu biura logo stoi teraz w trzech miejscach:** przy dostawcy w tabeli
dostaw, w nagłówku otwartego dokumentu i — jak dotąd — na liście za zębatką,
gdzie się je wgrywa. Obraz pobiera się RAZ na kontrahenta i jest wspólny dla
wszystkich trzech widoków; panel pyta o niego wyłącznie wtedy, gdy serwer
powiedział, że logo istnieje.

## 0.86.0 — 22 sierpnia 2026

**Konfiguracja zeszła z zakładek pracy za ikonę ustawień.**

Prompt eksperta i fakty firmowe zajmowały pół ekranu na zakładce PYTANIA
KLIENTÓW, do której biuro wchodzi kilkanaście razy dziennie. Zmienia je
wyłącznie admin i robi to razy kilka w roku. Ten sam problem miały reguły
strefy złotej na ANALIZIE i dane firmy w środku karty REKLAMACJE.

Wszystkie trzy stoją teraz za **zębatką** w prawym górnym rogu, obok logo
dostawców, które mieszkało tam od 0.76.0. Kryterium jest jedno: rzecz
ustawiana raz i obowiązująca wszystkich nie jest sprawą do załatwienia,
więc nie zabiera miejsca sprawom, które nią są.

Pobierają się dopiero po wejściu w ustawienia. Do 0.85.0 prompt jechał przy
każdym wejściu na PYTANIA, a reguły przy każdym wejściu na ANALIZĘ.

**Objaśnienia kart schowane za ikoną „i".** Prawie każda karta miała pod
nagłówkiem akapit tłumaczący, co robi. Tekst czyta się raz, a pion zabierał
codziennie — suma tych akapitów spychała pracę pod krawędź ekranu. Teraz
otwiera je kliknięcie ikony przy nagłówku. Kasowanie ich byłoby stratą:
niosą wiedzę, której nie ma nigdzie indziej, a nowa osoba dostaje ją stąd.

Podstawa prawna monitoringu na ANALIZIE i klauzula o danych osobowych
w statystykach zwrotów **zostają na wierzchu**. To nie są objaśnienia.

**Statystyki pytań zwinięte**, wzorem WGLĄDU ze zwrotów. Zwinięta sekcja nie
pyta serwera — zakładka PYTANIA mieści się teraz na laptopie bez przewijania.

**Kolejność kart za priorytetem.** Na DOSTAWACH reklamacje stoją przed
zamkniętymi dostawami, na PYTANIACH lista przed wklejką z poczty. Siatka
układa karty w kolejności dokumentu, więc kolejność w kodzie jest kolejnością
na ekranie — i pilnują jej teraz testy.

## 0.85.0 — 22 sierpnia 2026

**Allegro odpytuje się teraz PRZYCISKIEM, nie samo.**

Biuro dostało od Allegro stronę „Zostałeś zablokowany" z adnotacją, że w tej
samej sieci operuje robot. Aplikacja nie scrapuje `allegro.pl` — cały ruch idzie
przez `api.allegro.pl` z tokenem OAuth, czyli sankcjonowaną integracją. Ale dwa
tickery odpytywały API co pięć minut, a od 0.80.0 dzielą jedno pokrętło, więc
każde tyknięcie kosztowało więcej wywołań niż przed zakładką PYTANIA.

`ALLEGRO_POLL_MS` stoi od tej wersji domyślnie na **zerze**. Zapowiedzi zwrotów
pobiera przycisk **POBIERZ Z ALLEGRO** na karcie ZWROTY, pytania klientów —
**ODŚWIEŻ Z ALLEGRO** na ich karcie, który istnieje od 0.80.0. Liczba
milisekund przywraca pobieranie w tle.

To jest właściwe ustawienie domyślne niezależnie od tamtej blokady. Ruch w tle
na cudzym serwisie jest decyzją właściciela firmy, a nie czymś, co aplikacja
postanawia za niego przy instalacji.

Przycisk stoi na karcie ZWROTY, a **nie** na BRAKUJĄCYCH PACZKACH, choć to tam
lądują wyniki. Tamta karta chowa się, gdy nie ma czego pokazać — czyli dokładnie
wtedy, gdy człowiek chce sprawdzić, czy coś nowego przyszło.

Toast po kliknięciu mówi, co przyszło („Nowych zgłoszeń: 3 · odświeżonych
statusów: 0" albo „Allegro nie ma nic nowego"). Cichy przycisk kazałby klikać
drugi raz na wszelki wypadek, czyli robiłby dokładnie to, czego ta zmiana ma
uniknąć.

**Token na tym nie traci** i to było jedyne realne ryzyko. Refresh Allegro żyje
kwartał i odnawia się przy KAŻDYM użyciu, a skan etykiety zwrotu też go używa —
trzy miesiące bez ani jednego zwrotu nie są scenariuszem tej firmy. Zdanie
w DEPLOY, że „regularne odpytywanie odświeża token", było prawdziwe, gdy ticker
był jedynym stałym rozmówcą; teraz jest sprostowane.

Ticker i przycisk wołają JEDNĄ funkcję (`pobierzZapowiedzi`). Dwie kopie tej
roboty rozjechałyby się przy pierwszej zmianie jednej z nich, a objawem byłoby
„przycisk pobiera co innego niż tło".

Test trasy sprawdza obie połówki naraz: po starcie lista jest pusta i taka
zostaje, a po kliknięciu przestaje być pusta. Sama pierwsza asercja przeszłaby
też przy trasie zepsutej na głucho — czyli w stanie, w którym karta BRAKUJĄCE
PACZKI nigdy nic nie pokaże i nikt się nie dowie dlaczego.

---

## 0.84.1 — 22 sierpnia 2026

**Komunikat o błędnej konfiguracji przestał przepisywać sekrety na dysk.**

Zgłoszenie z produkcji: po aktualizacji API nie wstało, a `nssm restart`
odpowiadał `SERVICE_PAUSED`. Przyczyna była prosta — klucz Anthropic trafił do
`AI_PROVIDER` zamiast do `ANTHROPIC_API_KEY`. Te dwa pola sąsiadują ze sobą
w `wertis.env.example` i pomyłka przy wklejaniu jest naturalna.

Gorsze było to, co zrobiła z nią aplikacja. Walidator wypisał WARTOŚĆ zmiennej
do komunikatu błędu, NSSM podnosił usługę w pętli (`AppExit Default Restart`),
a każdy obieg dopisywał kolejną kopię klucza do `logs\wertis-api.err.log`.
Klucz trzeba było unieważnić.

Od tej wersji wartość wyglądająca na klucz API nie trafia do komunikatu —
zamiast niej stoi zdanie, że to wygląda na klucz, oraz wskazówka, w które pole
klucz naprawdę się wpisuje. Maska nie jest jednak lekiem gorszym od choroby:
krótkie wartości widać w całości, bo literówki w `antropic` nie da się zauważyć
inaczej niż na oczy. Pod maskę schodzi też każda wartość dłuższa niż
dwadzieścia kilka znaków — nie każdy sekret zaczyna się od `sk-`, a nazwa
trybu nigdy nie jest długa.

Ta sama reguła objęła `ALLEGRO_MODE`, `ZDJECIA_ZRODLO` i `SGT_MODE`. Trzy
testy pilnują obu połówek naraz: sekret ma nie przeciec, a komunikat ma dalej
mówić, co zrobić — sama maska zostawiłaby człowieka z „coś jest źle".

DEPLOY §7 dostał wpis o stanie `SERVICE_PAUSED`: to nie jest wstrzymana usługa,
tylko throttling NSSM-a po natychmiastowym wyjściu procesu. Wraz z jedną
komendą, która pokazuje przyczynę z pominięciem NSSM-a, i przypomnieniem, żeby
przy błędzie konfiguracji NAJPIERW zatrzymać usługi — pętla restartów mnoży
w dzienniku to, co akurat wypisał serwer.

---

## 0.84.0 — 22 sierpnia 2026

**Biuro widzi, kto rozłożył kosz i o której.** Dane leżały w bazie od
pierwszego zakończenia — `zakonczKosz` zapisuje nazwisko i znacznik czasu — ale
nie miały drogi na ekran. Biuro pytało „kto to zrobił" i szło po odpowiedź do
dziennika audytowego, czyli tam, gdzie szuka się rzeczy podejrzanych, a nie
zwykłych.

Lista KOSZE ZWROTOWE dostaje kolumnę **ROZŁOŻYŁ**: nazwisko, pod nim godzina.
Podgląd kosza pokazuje cały cykl życia jedną linią — kto zamknął i kto
rozłożył. To dwie różne odpowiedzi na dwa różne pytania: lista mówi rzutem oka
„czy zrobione i przez kogo", podgląd mówi przy sprawie „co się z tym działo".

Kosz nierozłożony ma w kolumnie **myślnik, nie pustkę**. Pusta komórka wygląda
na brak danych, a to jest odpowiedź „jeszcze nikt". Po COFNIJ ZAKOŃCZENIE ślad
znika razem z rozłożeniem: nazwisko, które by zostało, mówiłoby o pracy,
której w tej chwili nie ma.

Przy okazji dwie rzeczy w tym samym rejonie. Pozycja odłożona pokazywała
nazwisko bez godziny — czyli pół odpowiedzi na to samo pytanie; teraz niesie
oba. A wyszukiwarka towaru w koszach formatowała datę własnym cięciem napisu,
z pominięciem strefy — dwie metody formatowania w jednym pliku rozjeżdżają się
o godzinę prędzej czy później.

**Na kolektorze ZAKOŃCZ przeniósł się nad listę.** Przy koszu na dwadzieścia
pozycji magazynier odkładał ostatnią rzecz i musiał przewinąć przez całą
zrobioną robotę, żeby domknąć pracę — kciukiem, w rękawicy, z koszem w drugiej
ręce.

Reguła z dostaw zostaje w mocy i to ona rozstrzygnęła kształt tej zmiany.
Zakończenie pojawia się dokładnie tak jak dotąd: dopiero gdy nie ma już nic do
odłożenia. Zmienia się miejsce, nie warunek — więc dalej nie ma jak kusić na
starcie pracy.

Samo przestawienie przycisku nad listę odwróciłoby tylko kierunek przewijania:
ostatnie odłożenie zostawia listę tam, gdzie stał palec. Dlatego szapka
**wychodzi spod przewijania** — pasek stoi, lista przewija się pod nim.
Dorzucenie zamiast tego skoku na górę odbierałoby przewinięcie w chwili,
w której człowiek sprawdza wzrokiem właśnie zwinięty wiersz.

Nagłówek dopisuje przy komplecie słowo **KOMPLET** na zielono. „ODŁOŻONE 12/12"
wymaga porównania dwóch liczb, a jedno słowo czyta się z odległości ramienia.
Kosz z pominięciem go nie dostaje, bo kompletem nie jest.

COFNIJ ZAKOŃCZENIE **zostaje pod listą** i to nie jest przeoczenie. Zdanie
o stanie kosza idzie do szapki, bo bez niego ekran nie odpowiada, dlaczego nic
się na nim nie da zrobić. Ale sam przycisk to droga powrotna z pomyłki, a nie
wyjście z ekranu — od tego jest WSTECZ w pasku zakładek. Przypięty u góry byłby
najbardziej rzucającą się w oczy rzeczą na ekranie, na którym poprawnym ruchem
jest odejście.

---

## 0.83.0 — 22 sierpnia 2026
**Panel biura przestał siedzieć w kolumnie pośrodku ekranu.** Układ nie zmienił
się od pierwszej wersji: `main` miał szerokość 1080 px, a każdy widok był jedną
kolumną kart. Na monitorze 1920 px dwie trzecie szerokości było pustym
marginesem, a zakładka ZWROTY miała jedenaście kart jedna pod drugą.

Karty układają się teraz w tyle kolumn, ile mieści okno. **Progów rozdzielczości
nie ma** — liczba kolumn wychodzi z arytmetyki siatki, więc nie ma czego
utrzymywać przy następnym monitorze. Laptop dostaje jedną kolumnę na pełną
szerokość, 1920 px dwie, 2560 px trzy. Panel otwarty na pół ekranu obok
Subiekta zagęszcza się sam.

Szerokość kolumny dobrana jest pod TREŚĆ, nie pod ekran: tabela zwrotów ma
sześć kolumn i poniżej 44 rem zaczyna się zawijać. Klasy „karta na dwie
kolumny" świadomie nie ma — przy trzech kolumnach zostawiała trzecią pustą,
bo karty rozpięte na dwie nie mają się z czym sparować.

**Pasek stanu i zakładki są przyklejone.** Przewinięcie listy dostaw nie zabiera
z ekranu ani nawigacji, ani alarmu o kolejce w błędzie — a to jest jedyny powód,
dla którego ten pasek w ogóle stoi na górze. Jego wysokość jest MIERZONA, nie
wpisana: nagłówek zawija się na wąskim oknie, a pasek stanu rośnie o kafle
alarmów. Od tej liczby zależy też `scroll-margin-top`, więc karta, do której
prowadzi kliknięcie kafla, nie wjeżdża pod pasek.

`main` musiał przy okazji przestać być siatką. Element `position: sticky` będący
elementem siatki dostaje obszar dokładnie własnej wysokości, więc nie ma zakresu
ruchu i po prostu się nie przykleja. Siatką jest teraz każdy widok osobno.

**Tabele mają własne przewijanie**, a listy o nieograniczonej długości —
ograniczoną wysokość z przyklejonym nagłówkiem kolumn. Jedna dostawa na
siedemdziesiąt pozycji nie wypycha już wszystkiego poniżej poza ekran.
Zakładka DZIENNIK zeszła przez to z 3700 px do 850 px, czyli mieści się
w oknie razem z filtrami.

**Karta WGLĄD** zbiera na zakładce ZWROTY raport procesu, statystyki, czasy
obsługi i konto Allegro. Domyślnie rozwinięty jest sam raport. Zwinięta sekcja
NIE PYTA SERWERA — to nie jest chowanie pikseli: raport szedł dotąd w każdym
trzydziestosekundowym cyklu odświeżania, a statystyki i czasy to osobne
żądania liczące do stu osiemdziesięciu dni wstecz.

Wybór zapamiętuje przeglądarka. Jeden wyjątek jest twardy: rozerwane parowanie
z Allegro otwiera sekcję KONTO ALLEGRO samo. Skan etykiety wtedy nie zadziała,
a to nie jest rzecz do odkrycia przez rozwijanie sekcji. Alarm się nie chowa.

**Szczegół staje obok listy.** Wejście w zwrot albo w dostawę ukrywało dotąd
wszystkie karty rodzeństwa — biuro traciło listę, nad którą pracowało, i po
powrocie wracało na jej górę. Na oknie szerszym niż 1280 px lista zostaje po
lewej, szczegół stoi obok niej z własnym przewijaniem, a otwarty wiersz jest
podświetlony. Na węższym oknie zostaje zachowanie sprzed tej wersji: dwie
kolumny nie mieszczą się na laptopie obok siebie.

Widoczność kart rodzeństwa liczy się teraz w JEDNYM miejscu na widok, zamiast
w dwóch listach identyfikatorów wypisanych z ręki. Te dwie listy zdążyły się
już rozjechać: zamknięcie zwrotu nie przywracało karty brakujących paczek.

Zagęszczenie: `td` z 9 na 6 px, karta z 16/18 na 12/14, `h2` z 10 na 7.
Wysokość przycisków i pól zostaje bez zmian — to są cele kliknięcia i one nie
są miejscem na oszczędności. Akapity objaśniające dostały granicę 74 znaków
w wierszu, bo karta rozciągnięta na 900 px daje wiersz nieczytelny.

Zakładka PYTANIA KLIENTÓW z 0.80.0 dostała ten sam układ przy scaleniu —
zostawienie jej w jednej wąskiej kolumnie obok pięciu płynnych byłoby
konfliktem rozwiązanym w połowie.

Sprawdzone w Chromium na ośmiu szerokościach od 900 do 3440 px, na wszystkich
sześciu zakładkach: żadna nie rozpycha strony w poziomie.

## 0.82.0 — 22 sierpnia 2026

**Biuro widzi wreszcie, ile towar STOI.** Zwroty miały dwie karty liczb:
RAPORT mówił, ile czego jest, STATYSTYKI — co wraca najczęściej. Żadna nie
odpowiadała na pytanie, które przelicza się wprost na pieniądze: jak długo
zwrócony towar jest niesprzedawalny.

Nowa karta **CZASY OBSŁUGI ZWROTU** mierzy pięć odcinków drogi, każdy medianą
i p90. Cała droga to przyjęcie → półka. Odcinki składowe: przyjęcie → ocena,
ocena → zamknięcie kosza oraz zamknięcie kosza → półka, czyli sam czas
rozłożenia. Osobno idzie przyjęcie → zwrot środków. Okno 30/90/180 dni dzieli
ze statystykami produktowymi.

**Okno liczy się od zdarzenia KOŃCZĄCEGO odcinek**, nie od przyjęcia paczki.
Karta odpowiada więc na pytanie „ile trwało to, co się w tym oknie skończyło".
Liczenie od przyjęcia wypychałoby ze statystyki sprawy niedokończone, czyli
z definicji najwolniejsze, i proces wyglądałby na szybszy, niż jest.

Ceną tego wyboru jest to, że rzeczy stojące nie ruszają mediany. Dlatego karta
niesie sekcję **CO STOI TERAZ**: kosze czekające na rozłożenie i zwroty bez
domknięcia, od najstarszej sprawy, z nazwanym etapem. Kliknięcie wiersza
otwiera kosz albo kartę zwrotu. Mediana mówi o przeszłości, tamta lista
o dzisiaj — dopiero razem nie kłamią.

Odcinek bez danych pokazuje POWÓD zamiast samego myślnika. Najczęstszy jest
jeden: kosze z dokumentu MM nie mają przypiętego zwrotu, więc do całej drogi
nie wchodzą. Pusty kafel bez tego zdania wygląda jak awaria karty.

Na dole stoi **tempo rozkładania per osoba** — monitoring pracowniczy z tą samą
podstawą prawną co raport wydajności na zakładce ANALIZA, wysyłaną przez serwer
razem z danymi. Miarą jest czas aktywny z `services/raporty.ts`, w którym
przerwy dłuższe niż 15 minut nie liczą się jako praca.

Odstęp od zamknięcia kosza byłby miarą nieuczciwą: mierzyłby głównie to, jak
długo kosz czekał na kogokolwiek, i karałby człowieka za sięgnięcie po
najstarszą robotę. Próbka poniżej 20 pozycji nie dostaje liczby.

Nowa trasa `GET /api/biuro/zwroty/czasy?dni=90` pod bramką biura. Nic nie
zmienia się w bazie ani na kolektorze — to sam odczyt ze znaczników, które
aplikacja i tak zapisywała.

## 0.81.0 — 22 sierpnia 2026

**Listy zwrotów odpowiadają wreszcie na pytanie „co jeszcze zostało".** Trzy
zmiany o kolejności pracy, wszystkie z jednego zgłoszenia z hali: robota już
wykonana zajmowała miejsce roboty do wykonania. Za nimi dwie o samym wierszu
kosza — ilość i symbol towaru, czyli to, co magazynier czyta, stojąc z rzeczą
w ręce.

**Rozłożone kosze schodzą na dół listy przyjęć.** O kolejności rozstrzygała
sama data z dokumentu, więc kosz rozłożony wczoraj stał nad tym, który dziś
przyjechał na halę. Rozłożone i zdjęte ręką z listy zostają — magazynier ma
widzieć, że dokument jest znany i zrobiony, zamiast szukać go w nieskończoność
— ale stoją POD tym, co czeka. Wewnątrz obu grup data dalej rządzi.

**W otwartym koszu odłożona pozycja zjeżdża na koniec listy.** Zwinięty pasek
zrobionej pozycji dalej zajmuje ekran, więc przy koszu na dwadzieścia pozycji
do roboty trzeba się było PRZEWIJAĆ przez robotę już wykonaną. Lista ma teraz
trzy grupy: czekające w kolejności alejkowej, odłożone „na później" i zrobione.
Te ostatnie stoją w kolejności wykonania, czyli ostatnio tknięta jest na samym
dole — tam, gdzie się jej szuka, wracając po COFNIJ. Pominięta liczy się jako
zrobiona: to praca zdjęta z rutyny, a nie towar czekający na półkę.

To ta sama decyzja, którą rozkładanie dostaw podjęło w 0.35.0, i płaci się za
nią tym samym: wiersze skaczą po każdym zapisie. Skok kosztuje mniej niż
przewijanie, bo następną pozycję bierze się SKANEM, a skan trafia w towar po
symbolu, nie w miejsce na ekranie.

Kolejność liczy SERWER, nie kolektor. Tę samą listę czyta panel biura, a dwa
niezależne sortowania rozjechałyby się przy pierwszej zmianie jednego z nich —
objawem byłoby „biuro czyta co innego, niż ja mam na ekranie".

**Po odłożeniu kolektor sam wskazuje kolejny przedmiot** — i robi to OD RAZU,
nie dopiero z powracającą listą. Między jednym a drugim mieści się skan
następnego regału, a trafiał on w pozycję właśnie odłożoną: zamiast odłożyć
kolejny towar, poprawiał adres poprzedniego. Odległość między półkami jest
krótsza niż runda do serwera i z powrotem. Tak samo zachowują się POMIŃ
i PÓŹNIEJ — jedno i drugie zdejmuje pozycję z drogi, więc jedno i drugie
pokazuje następną zamiast pustego ekranu.

**Ilość inna niż jedna sztuka dostaje bursztynową pastylkę.** Zwrot wraca
pojedynczo, więc oko czyta wiersz jak „jedna rzecz na jedną półkę" i idzie
dalej — a przy „3 szt." zostawia dwie w koszu. Kosz zamyka się z licznikiem
POZYCJI, nie sztuk, więc taka pomyłka wychodzi dopiero przy inwentaryzacji.
Pastylka, a nie sam kolor: bursztynem świeci obok pozycja bez adresu, a dwa
znaczenia jednej barwy nie niosłyby żadnego — kształt odróżnia je bez czytania.
Wiersz zrobiony zostaje przygaszonym paskiem, ale liczbę dalej na nim widać, bo
to po niej sprawdza się kompletność kosza.

**Symbol wskazanego towaru urósł do 22 sp.** To jego szuka się wzrokiem, mając
towar w ręce i pytanie „czy to na pewno ten"; czyta się go z odległości
ramienia, tak samo jak adres w panelu niżej. Pozostałe wiersze zostają przy
17 sp, bo cała lista w tym rozmiarze przestałaby mieścić się na ekranie.

## 0.80.0 — 22 sierpnia 2026

**Pytania klientów o dobór części dostały własną zakładkę — ze szkicem
odpowiedzi.** Dotąd była to praca POZA aplikacją: screenshot pytania z poczty
szedł do zewnętrznego czata skonfigurowanego jako ekspert od części, a gotowa
odpowiedź wracała przez schowek. Aplikacja, która zna kartotekę, stany
i zamienniki, nie brała w tym udziału.

Teraz bierze. Zakładka **PYTANIA KLIENTÓW** ściąga pytania z Centrum wiadomości
Allegro, przygotowuje szkic odpowiedzi z linkami do naszych aukcji i po
akceptacji człowieka wysyła ją do klienta.

Cztery rzeczy, które decydują o tym, czy to naprawdę oszczędza czas:

- **Szkic czeka gotowy.** Liczy go ticker w tle razem z synchronizacją, więc
  otwarte pytanie ma odpowiedź do przeczytania, a nie przycisk „wygeneruj”.
- **Karty towarów stoją obok pola odpowiedzi** — zdjęcie kartoteki, stan,
  półka, cena i link do aukcji. Dobór weryfikuje się okiem, bez przełączania
  do Subiekta; przycisk WSTAW LINK dokleja adres w miejscu kursora.
- **Fakty firmowe są osobnym polem.** Cennik wysyłek zagranicznych, terminy
  i zasady płatności wpisuje admin, i to jedyne źródło, z którego model może
  je podać. Zgadnięty koszt wysyłki do Chorwacji jest gorszy niż jego brak.
- **Po wysłaniu panel otwiera następne pytanie**, aż licznik przy zakładce
  zejdzie do zera.

Aplikacja przy tym **uczy się z wysłanych odpowiedzi**, nie z własnych
zgadywanek: poprawione odpowiedzi wracają jako wzór stylu, a potwierdzone pary
maszyna→część jako tabela `dopasowanie` — jedno i drugie zapisuje się dopiero
przy wysyłce, czyli po akceptacji człowieka.

Statystyki odpowiadają na pytanie właściciela: o co klienci pytają najczęściej,
w jakich kategoriach, jak długo czekają na odpowiedź, ile szkiców idzie bez
poprawki — i **o jaki towar pytali, a nie było czego sprzedać**. Ta ostatnia
lista jest najtańszym researchem asortymentu, jaki firma może mieć.

Odpowiedź wysyła **człowiek** i to się nie zmienia. Model pisze szkic, biuro go
czyta, poprawia i klika. Automatycznej wysyłki nie ma i pilnuje tego test.

Pytania spoza Allegro (screenshot z poczty) wchodzą przez wklejkę — Ctrl+V
w zakładce. **Obrazu nie zapisujemy**: zostaje wyłącznie przepisana treść
pytania. To dane osobowe klienta, a wartość ma sama treść.

**[wymaga działania]** — trzy rzeczy przy wdrożeniu:

1. **Klucz modelu w `wertis.env`.** `AI_PROVIDER=anthropic` (albo `openai`)
   plus `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Bez tego funkcja jest
   wyłączona, a zakładka mówi wprost, co dopisać. Serwer bez klucza przy
   ustawionym dostawcy NIE wystartuje — lepiej twardy błąd przy starcie niż
   przy pierwszym pytaniu klienta. Szczegóły i wybór modelu:
   sekcja „Pytania klientów” w `wertis.env.example`.
2. **Nowe uprawnienia aplikacji Allegro i PONOWNE PAROWANIE KONTA.** Ta
   funkcja czyta i pisze w Centrum wiadomości oraz czyta nasze oferty:
   `allegro:api:messaging` i `allegro:api:sale:offers:read`. Dopisanie ich na
   developer.allegro.pl nie wystarcza — token wydany pod stary zakres sam się
   nie rozszerzy, więc konto trzeba sparować ponownie
   (/biuro → ZWROTY → KONTO ALLEGRO). Bez tego pierwsze odświeżenie kończy się
   błędem 403, a komunikat wskazuje brakujące uprawnienie po nazwie.
3. **Decyzja o prywatności należy do właściciela.** Treść pytań klientów
   (i wklejone obrazy) trafia do zewnętrznego dostawcy modelu. Funkcja jest
   domyślnie wyłączona właśnie dlatego, że tej decyzji nie podejmuje
   aktualizacja.

Nowe tabele (`pytanie`, `ai_config`, `dopasowanie`) zakłada migracja przy
starcie — nic do zrobienia ręką. Częstotliwość ściągania pytań dzieli pokrętło
z zapowiedziami zwrotów (`ALLEGRO_POLL_MS`): to ta sama praca w tle na tym
samym koncie.

## 0.79.0 — 22 sierpnia 2026

**Rozkładanie zwrotów ma wreszcie drogi powrotne.** Praca w rękawicy, przy
koszu, jedną ręką — pomyłka jest normalnym elementem tej roboty, nie wyjątkiem.
Do tej wersji kolektor nie miał ani jednej: zły skan regału zamykał pozycję na
zawsze, a przedwczesne ZAKOŃCZ — cały kosz.

**COFNIJ ODŁOŻENIE** przywraca pozycję do pracy i kasuje adres. **COFNIJ
POMINIĘCIE** robi to samo z pozycją oddaną biuru. **COFNIJ ZAKOŃCZENIE**
otwiera z powrotem kosz zamknięty za wcześnie; pozycje zostają tam, gdzie były,
bo cofa się stan kosza, a nie cudzą pracę. Wszystko bez bramki roli — to
poprawianie WŁASNEJ pomyłki w jej trakcie, tak samo jak korekta ilości przy
dostawie. Ślad z nazwiskiem zostaje w dzienniku.

**Granica przechodzi przez Subiekta i jest twarda.** Dopóki zapis czeka
w kolejce, aplikacja go anuluje i cofa wszystko bez śladu w bazie firmy. Gdy
zapis już poszedł, cofnięcia NIE MA — aplikacja nie ma prawa udawać, że adres
albo dokument w Subiekcie nie istnieje. Mówi wtedy wprost, co zrobić zamiast
tego. Przy koszu WERTIS sprawdzane są WSZYSTKIE zadania MM przed anulowaniem
któregokolwiek: jedno przetworzone blokuje całość, żeby nie zostawić połowy
anulowanej przy koszu nadal zakończonym.

Stąd druga zmiana: **pozycja odłożona daje się POPRAWIĆ**. Zły regał prostuje
się skanem właściwego — nowy adres nadpisuje stary w koszu i w kartotece. Bez
tego odmowa cofnięcia zostawiałaby magazyniera z towarem na złej półce i bez
wyjścia.

**PÓŹNIEJ — NA KONIEC LISTY.** Regał zastawiony, towar na dnie kosza, coś
pilniejszego po drodze. Pozycja zjeżdża na koniec i nadal czeka: to NIE jest
pominięcie i nie trafia na listę spraw biura. ZAKOŃCZ jej nie przepuści.
Znacznik czasu zamiast flagi, więc druga odłożona staje za pierwszą, a ponowne
kliknięcie przesuwa na sam koniec.

## 0.78.1 — 22 sierpnia 2026

**Wskazana pozycja kosza i panel odkładania to znowu jedna karta.** Ze
zgłoszenia z hali: symbol towaru stał w jednym prostokącie, a adres, na który
ma pójść, w drugim — oko musiało wiązać jedno z drugim przez szczelinę między
kartami, choć to jest jedna myśl: „ten towar idzie na tę półkę".

Wiersz działa teraz dokładnie jak rozwinięty wiersz dostawy: wspólne tło,
wspólna obwódka, panel wcięty pod nagłówkiem. Przy okazji znika pastylka
adresu ze wskazanego wiersza — ten sam adres krzyczy oczko niżej w 28 sp,
a dwa razy tego samego nie czyta się lepiej. Ta reguła też jest z dostaw.

## 0.78.0 — 22 sierpnia 2026

**Biuro widzi wreszcie, KTÓRE produkty wracają.** Karta RAPORT liczy przebieg
procesu: ile zwrotów jest nowych, ile dokumentów czeka w kolejce, jaka jest
mediana czasu do rozliczenia. Żadna z tych liczb nie odpowiada na pytanie
właściciela — a odpowiedź siedziała w bazie od pierwszego zwrotu.

Nowa karta **STATYSTYKI ZWROTÓW** stoi pod raportem i ma okno 30, 90 albo
180 dni. Tabela produktów pokazuje trzy miary obok siebie: ile razy towar
wrócił, ile sztuk i **wskaźnik zwrotów** — zwrócone dzielone przez sprzedane
w tym samym oknie. Dopiero ta trzecia liczba mówi, czy jest problem: sprzedany
tysiąc razy i zwrócony dziesięć to norma, sprzedany dwadzieścia i zwrócony
dziesięć to wada opisu albo towaru.

**Wskaźnik woli zamilknąć, niż skłamać.** Mianownik bierze się ze sprzedaży
w read-modelu, a ta sięga tylko okna importu (`DOK_SPRZEDAZ_DNI_WSTECZ`,
domyślnie 90 dni). Przy oknie 180 dni licznik byłby pełny, a mianownik nie —
iloraz wyszedłby zawyżony i ktoś mógłby po nim wycofać dobrze sprzedający się
towar. W takim wypadku kolumna pokazuje myślnik, a pod tabelą stoi zdanie
dlaczego. Zero sprzedaży w oknie też nie daje „100% zwrotów": towar mógł
zostać sprzedany wcześniej, a wrócić teraz.

Pod tabelą trzy przekroje: **decyzje biura** (ile sztuk wraca do sprzedaży,
ile w reklamację, ile na zniszczenie), **zwroty per tydzień** i **kupujący
z więcej niż jednym zwrotem**. Wykres tygodni pokazuje też tygodnie PUSTE —
bez nich sąsiadami stawałyby się tygodnie odległe o miesiąc, a przerwa
wyglądałaby jak równy rytm.

Lista kupujących jest zestawieniem danych osobowych i karta mówi to wprost:
służy wykrywaniu nadużyć, nie ocenianiu klientów. Wchodzą na nią wyłącznie
loginy z więcej niż jednym zwrotem — pojedynczy zwrot to normalne zakupy.
Zakres danych się nie zmienia, login widać na każdej karcie zwrotu; nowe jest
zestawienie i dlatego ma podpis o celu.

Towar bez dopasowanej kartoteki NIE wypada ze statystyki — liczy się po nazwie
oferty i dostaje znacznik „poza kartoteką". Cicha strata takich pozycji
zafałszowałaby obraz akurat tam, gdzie najczęściej jest problem.

## 0.77.0 — 21 sierpnia 2026

**Otwarty kosz zwrotów mówi teraz tyle, co rozkładana dostawa.** Do tej wersji
wiersz kosza niósł symbol, nazwę, ilość i adres — i nic więcej. Przy zwrocie to
za mało: towar wraca pojedynczo, bywa wycofany ze sprzedaży, a pytanie „co to
właściwie jest i gdzie tego jeszcze mam" pada częściej niż przy dostawie.

Wiersz dostał **zdjęcie z kartoteki** (powiększa się dotknięciem), ilość
z prawdziwą jednostką zamiast wpisanego „szt." i pastylkę adresu — tę samą,
która stoi na dostawach. Pod wskazaną pozycją rozwija się panel: adres wielkim
drukiem, **stany wszystkich magazynów z niezerowym stanem** („MAG 12 · ZWR 3")
i podpowiedź strefy złotej. Druga liczba jest tu najważniejsza — mówi, ile
z tego towaru zostało jeszcze na regale zwrotów.

**Pozycję, której w koszu nie ma, można pominąć z powodem.** Wcześniej
blokowała ZAKOŃCZ, a razem z nim cały obieg: kosz wracał do biura nierozłożony
i bez śladu, CZEGO w nim zabrakło. Teraz magazynier wybiera powód — „nie ma
w koszu", „uszkodzony", „obcy towar" albo własny — i kończy pracę. Powód stoi
przy pozycji i w dzienniku.

**Pominięta pozycja NIE dostaje MM.** Kosz WERTIS cofa bufor przesunięciem za
każdą pozycję, ale wyłącznie za tę, która naprawdę wróciła na halę.
Przesunięcie pominiętej zdejmowałoby z bufora towar, którego nikt nie ruszył.
Odłożenie pozycji wcześniej pominiętej cofa pominięcie samo — kto znalazł
towar, po prostu go odkłada.

**Biuro widzi zawartość kosza, nie sam licznik.** Karta KOSZE ZWROTOWE
pokazywała dotąd „3/6 poz." i tyle — żeby sprawdzić, CO w koszu leży i gdzie
hala to odłożyła, trzeba było zapytać kogoś na hali. Kliknięcie wiersza
rozwija teraz podgląd: towar ze zdjęciem, ilość, adres odłożenia i stan każdej
pozycji. Podgląd czyta tę samą trasę co karta zwrotu, więc obie strony patrzą
na ten sam kosz.

Kosz z pominięciem woła o uwagę: wiersz na liście dostaje bursztynową
pastylkę, a podgląd zaczyna się od zdania **KOSZ NIEKOMPLETNY** wraz z powodem
przy pozycji. Przy okazji lista rozróżnia teraz kosze złożone w aplikacji od
tych z przesunięcia MM — te drugie podpisuje numerem dokumentu.

Do kompletu biuro dostało **listę pominięć ze wszystkich koszy** — osobną
kartę, na której najdłużej czekające sprawy są na górze. Pominięcie zamknięte
w jednym koszu byłoby wiedzą, do której nikt nie zagląda; tu jest listą pracy:
szukać dalej, reklamować u przewoźnika czy poprawić dokument.

Pominięcie zamyka się przyciskiem **ZAŁATWIONE** z dobrowolną notatką
(„znalazło się", „reklamacja u kuriera", „korekta dokumentu"). Sprawa schodzi
z listy pracy, ale pominięcie ZOSTAJE przy pozycji — hala naprawdę zgłosiła
brak i tego się nie przepisuje. W podglądzie kosza widać jedno pod drugim:
powód pominięcia i to, czym się skończyło. Ponowne zgłoszenie braku otwiera
sprawę na nowo, a odłożenie towaru kasuje jedno i drugie.

Obok stoi **szukanie towaru w koszach** — po symbolu, nazwie albo kodzie
kreskowym. Odpowiada na pytanie zadawane po fakcie: „w którym koszu to
jechało i gdzie hala to odłożyła". Szuka po snapshocie z kosza, bo to on mówi,
co w koszu naprawdę leżało, nawet gdy kartoteka zdążyła się zmienić.

Pozycja odłożona pokazuje wreszcie **stan swojego MM**. Kolejka zapisów
wychwytywała błędy od zawsze, ale globalnie — nie dawało się powiedzieć,
czy bufor cofnął się dla TEGO kosza.

Czego tu świadomie nie ma: **ilości częściowych**. Przy zwrocie sztuki idą na
jedną półkę, a licznik − / + kosztowałby dotknięcie przy każdej pozycji, żeby
obsłużyć przypadek, który się nie zdarza. Rozkładanie dostaw zostaje przy nim
bez zmian.

## 0.76.1 — 21 sierpnia 2026

**Każdy kosz na regale zwrotów pokazywał 0 pozycji.** Zgłoszenie z hali
pierwszego dnia po wdrożeniu 0.75.0: dokument `MM 1240/MAG/2026` ma w Subiekcie
sześć pozycji, a kolektor twierdzi, że kosz jest pusty. Dotyczyło to wszystkich
koszy, nie jednego.

Zapytanie o pozycje MM zostało przepisane z zapytania o sprzedaż i łączyło się
kolumną dokumentu **handlowego** (`ob_DokHanId`). MM jest dokumentem
**magazynowym** — na jego pozycjach ta kolumna jest NULL, a identyfikator niesie
`ob_DokMagId`. Potwierdzone zapytaniem na bazie firmy; reguła i zapytanie stoją
teraz w `docs/subiekt-gt-struktura.md`. Dokument handlowy łączy się przez
`ob_DokHanId`, magazynowy przez `ob_DokMagId`.

**Gorsza połowa tej pomyłki: pusty wynik nie miał jak o sobie powiedzieć.**
Zero pozycji przy sześciu dokumentach wyglądało na ekranie identycznie jak
spokojny dzień bez zwrotów. `/api/health` liczy teraz przesunięcia i ich pozycje
(`lastSync.mm`, `lastSync.mmPozycje`), a gdy dokumenty są bez pozycji — mówi to
zdaniem i nazywa kolumnę do sprawdzenia. Przy okazji na listę `problemy`
trafiła awaria odczytu MM, której 0.75.0 nie zgłaszała wcale.

**Towar zablokowany w kartotece zostaje w koszu.** Import kartotek pomija
pozycje z `tw_Zablokowany = 1`, a na regale zwrotów leży głównie towar wycofany
ze sprzedaży — czyli dokładnie ten. Do tej wersji taka pozycja wypadała z kosza
po cichu, więc lista na kolektorze bywała krótsza niż zawartość kosza. Nazwę
bierze teraz wprost z dokumentu MM.

Dwie rzeczy do wiedzenia o takiej pozycji: skan kodem jej nie znajdzie, bo
aplikacja nie zna tej kartoteki — magazynier wskazuje ją palcem. Odłożenie
zapisze adres także na zablokowanej kartotece, i tak ma być: towar naprawdę
leży na tej półce.

**Wiersz przyjęcia bez pozycji nie udaje pracy do zrobienia.** Pisze „0 poz. —
sprawdź import" i nie da się w niego wejść. Wcześniej zapraszał w kliknięcie
kończące się czerwonym komunikatem, co wygląda na awarię kolektora, a jest
brakiem danych.

## 0.76.0 — 21 sierpnia 2026

**Ustawienia biura wychodzą z paska zakładek za zębatkę.** Do tej wersji
DOSTAWCY stali w pasku jako osobna grupa z jedną pastylką — i ważyli w rzędzie
tyle samo co DOSTAWY, choć biuro wchodzi tam raz na kilka tygodni. Logo
dostawcy wgrywa się raz i wraca do tego ekranu wtedy, gdy dojdzie nowy
kontrahent. To jest konfiguracja, nie zakładka pracy.

Zębatka stoi w nagłówku, obok „Wyloguj", czyli tam, gdzie już mieszka to, co
dotyczy całej sesji, a nie jednego widoku. Otwiera DOSTAWCÓW wprost, bez menu:
rozwijana lista z jedną pozycją byłaby żartem. Menu jest drogą rozwoju na
moment, w którym dołączą import zbiórek i reguły strefy złotej — dziś schowane
pod ANALIZĄ, czyli konfiguracja pod raportem.

**Grupy w pasku rozdziela teraz kreska.** Sam odstęp (18 px) był za słaby przy
4 px między przyciskami w grupie i kazał czytać podpisy, żeby wiedzieć, gdzie
kończy się PRACA. Kreska pokazuje się tylko wtedy, gdy grupy stoją w jednym
rzędzie — po zawinięciu wyglądałaby na błąd renderowania.

Mechanizm został jeden: zębatka niesie ten sam atrybut `data-widok`, co
zakładki, więc obsługuje ją ta sama delegacja kliknięcia i ta sama pętla
`aria-current`. Sama świeci na bursztynowo, gdy DOSTAWCY są otwarci — w pasku
nie świeci wtedy nic i to jest prawda, bo żadna zakładka pracy nie jest
otwarta. Widok, jego dane i uprawnienia zostały nietknięte: zmieniło się
wejście, nie miejsce docelowe.

Panel jest czytany raz przy starcie, więc **zmianę widać po restarcie usługi**.
APK bez zmian.

---

## 0.75.0 — 21 sierpnia 2026

**Trzecia zakładka kolektora: ROZKŁADANIE ZWROTÓW.** Do tej wersji aplikacja
znała jeden obieg zwrotów — ten własny, z koszami pod kodem `KZ-01`. Magazyn
pracuje jednak inaczej i robi to od lat: biuro składa koszyk, wystawia
w Subiekcie przesunięcie MM z magazynu głównego na regał zwrotów, a numer tego
dokumentu pisze **odręcznie na kartce** przypiętej do kosza. Kosz jedzie na
halę z liczbą `1209` na kartce i to ona jest jednostką pracy.

Zakładka ZWROTY wchodzi w ten obieg zamiast zapraszać do nowego. Pole u góry
przyjmuje numer z kartki — ze skanera i z klawiatury, samą liczbę albo cały
`MM 1209/MAG/2026`. Zawartość kosza bierze się **z pozycji dokumentu MM**,
nie z tego, co ktoś do niego dorzucił w aplikacji. Drugi skan tej samej kartki
otwiera ten sam kosz, więc dwa kolektory przy jednym koszu nie zrobią dwóch.

**Kolektor NIE wystawia dokumentu powrotnego.** To najważniejsze zdanie tego
wydania. Przesunięcie na regał zrobiło biuro przed przywiezieniem kosza,
a powrotne (ZWR→MAG) zrobi po rozłożeniu. Zadanie w kolejce znaczyłoby ten sam
towar przesunięty drugi raz, więc `ZAKOŃCZ` na koszu z dokumentu zostawia
`sfera_queue` bez zadania MM. Zapisuje wyłącznie adresy półek — i tylko dla
towaru, który zmienił miejsce.

**Dwa obiegi stoją teraz obok siebie i jest to decyzja, nie przeoczenie.**
Kosze składane w aplikacji dalej kolejkują MM po rozłożeniu, bo tam nikt
wcześniej żadnego dokumentu nie wystawił. Kosze z dokumentu nie kolejkują nic.
Rozstrzyga o tym kolumna `kosz.mm_dok_id`, a nie domysł na ekranie. Kosze
z aplikacji zjechały przy okazji z zakładki DOSTAWY do drugiej sekcji zakładki
ZWROTY: jedno miejsce na jedną robotę, a DOSTAWY wracają do samych faktur.

**[wymaga działania] Importer czyta teraz dokumenty MM.** Do zapytań dochodzi
`dok__Dokument` z `dok_Typ = 9`, którego odbiorcą jest magazyn zwrotów, w oknie
`MM_ZWROTY_DNI_WSTECZ` (domyślnie 30 dni — tyle, ile filtr w Subiekcie). Login
odczytowy musi widzieć te dokumenty i ich pozycje. Bez tego odczytu reszta
aplikacji pracuje normalnie, lista przyjęć jest pusta, a `/api/health` niesie
zdanie o przyczynie.

Kolumna niosąca magazyn docelowy MM (`dok_OdbiorcaId`) nosi `[WERYFIKUJ]` —
opisuje ją tak dokumentacja struktury, ale nie potwierdzono jej na bazie firmy.
Pomyłka daje pustą listę przyjęć, nie złe dane. Zapytanie sprawdzające stoi
w DEPLOY §6a.

**Zaległość sprzed wdrożenia zdejmuje admin.** Dokumenty, których towar dawno
leży na regałach, znikają z listy akcją „już rozłożony". Magazynier jej nie ma:
to decyzja o pominięciu pracy, nie sposób jej wykonania. Ślad zostaje
w dzienniku.

## 0.74.1 — 21 sierpnia 2026

**Zakładki biura w trzech grupach.** Sześć pastylek stało w jednym rzędzie,
wszystkie o równej wadze — a to nieprawda o tym, jak się ich używa. Dostawy
i zwroty biuro otwiera po kilkanaście razy dziennie, dziennik i analizę wtedy,
gdy czegoś szuka, dostawców raz na kilka tygodni. Ze zgłoszenia: DZIENNIK
i ANALIZA nie powinny stać obok ZWROTÓW ALLEGRO.

Grupy noszą teraz podpisy: **PRACA**, **WGLĄD** i **USTAWIENIA**. Kosztuje to
jedną linijkę wysokości i mówi wprost to, czego sam odstęp nie powie — po co
się w daną zakładkę wchodzi.

USTAWIENIA z jedną pozycją to nie przeoczenie. ANALIZA niesie dziś import CSV
zbiórek i reguły strefy złotej, czyli konfigurację schowaną pod raportem;
ta grupa jest miejscem, do którego to kiedyś trafi. Przeniesienia teraz nie
robimy, bo to osobna zmiana i osobne ryzyko.

Sam mechanizm jest nietknięty: obsługa kliknięcia szuka przycisków po
`data-widok`, a nie po miejscu w rzędzie, więc ruszył się układ, nie działanie.
Zapamiętana zakładka przeżywa aktualizację.

## 0.74.0 — 21 sierpnia 2026

**Jedno zgłoszenie w błędzie zatrzymywało odświeżanie wszystkich.** Pętla
z 0.73.0 pytała Allegro o każde oczekujące zgłoszenie po kolei, ale bez
osłony na pojedynczą awarię. Pierwszy zwrot kończący się wyjątkiem — 403,
timeout, chwilowa awaria po stronie Allegro — przerywał cały przebieg, więc
reszta NIGDY nie dostawała statusu. Co gorsza, wyglądało to dokładnie tak
samo jak „ticker nie działa": wiersze uparcie pisały „status jeszcze
niepobrany" i nic więcej.

Każde zgłoszenie ma teraz własną osłonę. Wiersz w błędzie zostaje ze starym
znacznikiem czasu, więc wraca przy następnym przebiegu — awaria bywa chwilowa
i nie ma powodu karać go godziną kwarantanny.

**Widać, czy odświeżanie w ogóle chodzi.** Pod tabelą brakujących paczek
stoi teraz linijka: kiedy było ostatnie odświeżanie, ile zgłoszeń dostało
status, ile jeszcze czeka. Gdy Allegro odmawia, jest tam czerwone
`ALLEGRO ODMAWIA` z treścią błędu. Do tej wersji jedyną drogą do tej
odpowiedzi był log serwera, a pytanie „czemu ten wiersz nie ma statusu"
padało na ekranie biura.

## 0.73.0 — 21 sierpnia 2026

**Poprawka do 0.70.0: stare zgłoszenia nigdy nie dostawały statusu.** Ze
zgłoszenia z produkcji: zwrot 29YN/2026 doręczony 10 sierpnia i rozliczony
12-go wisiał na liście jako „W DRODZE, 15 dni". Obietnica z 0.70.0 — „sprawy
zamknięte schodzą z listy same" — działała wyłącznie dla zgłoszeń świeżych.

Powód siedział w oknie tickera. Lista zwrotów filtruje po dacie UTWORZENIA,
a okno zaczyna się dzień przed najnowszym znanym zgłoszeniem. Sprawa sprzed
dwóch tygodni nigdy w tym oknie nie wraca, więc jej `status_allegro` zostawał
pusty od migracji — a pusty status znaczy „w drodze", bo tak ma być bezpiecznie.

**Ticker odświeża teraz oczekujące zgłoszenia po identyfikatorze**, najwyżej
25 na przebieg, od najdawniej widzianych. Zaległość po wdrożeniu rozkłada się
na kilka przebiegów zamiast wystrzelić setką zapytań naraz, a zwrot, którego
Allegro już nie zna, dostaje tylko nowy znacznik czasu i wraca na koniec
kolejki. Odkrycie nowych zgłoszeń zostaje przy tanim oknie przyrostowym.

**Brak statusu jest teraz widoczny.** Wiersz bez odczytanego statusu pisze
wprost „status jeszcze niepobrany" zamiast milczeć — właśnie to milczenie
kazało zgadywać, czy reguła nie działa, czy nie ma czego czytać.
## 0.72.1 — 21 sierpnia 2026

**Świeży kolektor trafia w serwer bez wpisywania adresu.** Fabryczną wartością
było `http://10.0.2.2:3001` — alias hosta z EMULATORA Androida, który na
fizycznym kolektorze nie znaczy nic. Pierwsze uruchomienie kończyło się więc
ekranem „Nie widzę serwera" i wpisywaniem adresu z palca, na każdym urządzeniu
z osobna.

Teraz stoi tam adres serwera produkcyjnego. Emulator zszedł do roli przypadku
szczególnego: tam adres wpisuje się ręcznie.

Zmiana dotyczy **wyłącznie urządzeń instalowanych od zera**. Kolektor, który
ma już zapisany adres, trzyma go w swoich ustawieniach i niczego nie zauważy.

**[wymaga działania] Przeprowadzka serwera pod inny adres wymaga zmiany stałej
`DEFAULT_SERVER_URL` w kolektorze i nowego wydania APK.** Urządzenia już
pracujące przeprowadzki nie zauważą, więc pomyłka wyjdzie dopiero przy
pierwszej instalacji od zera — czyli długo później i bez oczywistego związku
z przyczyną. Adres trzyma rezerwacja DHCP opisana w `DEPLOY.md` §4.

Pole „ZMIEŃ ADRES SERWERA" na ekranie startowym ZOSTAJE. Adres bywa inny na
emulatorze, na instancji dev i po każdej przeprowadzce, a wtedy jest jedyną
drogą wyjścia z ekranu, na którym nie da się ani zalogować, ani założyć konta.

## 0.72.0 — 21 sierpnia 2026

**Zdjęcia towarów na karcie zwrotu.** Biuro ocenia towar z paczki w ręku,
a na ekranie miało dotąd sam symbol i nazwę oferty. Miniatura kartoteki mówi
od razu, czy w kartonie leży to samo, co klient kupił — zanim ktokolwiek
przeczyta sygnaturę. Kolumna doszła w trzech miejscach zakładki ZWROTY
ALLEGRO: przy pozycjach wracających, przy CAŁYM ZAMÓWIENIU i na liście
reklamacji.

Zero nowej maszynerii: to ta sama kolejka, która od 0.30.0 rysuje zdjęcia
w podglądzie dostawy — z cache'em, limitem trzech równoległych pobrań
i pamięcią o kartotekach bez zdjęcia. Kolumna pokazuje się tylko wtedy, gdy
`ZDJECIA_ZRODLO` jest ustawione; bez źródła znika razem z nagłówkiem.
Pozycja spoza kartoteki nie ma czego pokazać i zostaje pusta.

Przy okazji kolejka nauczyła się dwóch rzeczy. Pilnowanie „czy ten ekran
jeszcze istnieje" jest teraz pytaniem zadawanym per zadanie, bo ekranów ze
zdjęciami jest kilka i każdy odświeża się własnym rytmem. Ten sam towar
w dwóch wierszach dostaje zdjęcie w obu — wcześniej trafiał je tylko pierwszy.

**Naprawa: lista wyjątków dostawy była pusta.** W jednym pliku strony żyły
DWIE funkcje `rysujReklamacje` — dostawowa i zwrotowa, dodana w 0.59.0.
Druga deklaracja przesłania pierwszą, więc zakładka DOSTAWY wołała renderer
zwrotów: tabela wyjątków nie miała się czym wypełnić, a karta reklamacji
zwrotowych bywała nadpisywana wierszami z zupełnie innego ekranu. Zwrotowa
nazywa się teraz `rysujReklamacjeZwrotow`, a nowy test pilnuje, żeby żadna
nazwa funkcji nie powtórzyła się na stronie po raz drugi.
## 0.71.1 — 21 sierpnia 2026

**Pobieranie aktualizacji przerywało się timeoutem.** Z hali: „pobieranie jest
bardzo wolne i dostaję timeout". Winne nie było ani łącze, ani kod pobierania —
kolektor czyta strumieniem buforem 64 kB, a serwer strumieniem wysyła. Winny
był jeden limit czasu opisujący dwie zupełnie różne sytuacje.

Cała aplikacja chodzi na jednym kliencie HTTP z limitem odczytu **10 sekund**.
Ta wartość jest celowa: ekrany odpytują serwer co 1,5–2 sekundy, więc dziesięć
sekund ciszy przy kilku kilobajtach JSON-a naprawdę znaczy „sieci nie ma".
Kolektor ma to wykryć od razu, stojąc przy regale.

Tym samym klientem szło jednak APK ważące ponad osiem megabajtów. Tam dziesięć
sekund bez bajtu nie znaczy nic złego — Wi-Fi w hali bywa obciążone,
a przeskok między punktami dostępowymi robi dokładnie taką przerwę.

Limit jest teraz **zależny od trasy**: minuta dla pliku APK, dotychczasowe
dziesięć sekund dla wszystkiego innego. Odwrotna droga — dłuższy limit
globalnie — naprawiłaby rzecz zdarzającą się raz na wydanie kosztem rzeczy
używanej co dwie sekundy.

Reguła siedzi w `:core` z sześcioma testami, w tym takim, który pilnuje
DRUGIEJ strony: trasy odpytywane co dwie sekundy mają zostać przy krótkim
limicie. Ta pomyłka psułaby się cicho.

**[wymaga działania]** Kolektor, na którym pobieranie się urywa, **nie
zaktualizuje się tą poprawką sam** — to ta sama funkcja, która nie działa.
Pierwszy raz trzeba wgrać APK przez `adb install` albo z bliska, przy dobrym
zasięgu. Kolejne wydania pójdą już normalnie.

## 0.71.0 — 21 sierpnia 2026

**Z karty towaru wprost do jego pozycji w dostawie.** Linia „W dostawie 6 szt
— FZ 214/07/2026" jest teraz klikalna: otwiera dokument i od razu rozwija
pozycję TEGO towaru. Do tej wersji trzeba było zapamiętać numer dokumentu,
wyjść na listę dostaw, znaleźć go i odszukać pozycję wśród trzydziestu innych.

Klikalna jest **jedna linia, nie cała karta** — i to jest ta sama decyzja, co
wcześniej, tylko czytana dokładniej. Karta faktów była nieklikalna z zapisanym
powodem: wejście w dokument nie ma być skutkiem ubocznym zaglądania na kartę.
Powód dotyczył jednak całej powierzchni. Dotknięcie gdziekolwiek jest
przypadkiem, a dotknięcie wiersza z szewronem po prawej jest zamiarem. Linia
zamówienia i linia przeslotowania klikalne nie są, bo nie ma dokąd nimi pójść.

Wskazujemy kartotekę, nie wiersz dostawy: wiersz powstaje dopiero przy
otwarciu dokumentu, więc w chwili kliknięcia jeszcze go nie ma. Gdy ten sam
towar stoi w dokumencie w dwóch wierszach, otwiera się ten, przy którym jest
co robić.

**Wolumen zbierania przy rozkładaniu.** Pozycja dostawy niesie tę samą
podpowiedź, którą znała karta towaru: „Zbierany 12×/dzień — przenieś do strefy
złotej (poziom 2 albo 3)". Miejsce jest tu lepsze niż na karcie — magazynier
stoi z towarem w ręce i WŁAŚNIE wybiera półkę, więc rada trafia w moment
decyzji, a nie w moment zaglądania.

Tekst pochodzi z tej samej funkcji w `:core`, co na karcie. Dwa zdania o tej
samej rzeczy rozjechałyby się przy pierwszej poprawce jednego z nich.

Odczyt jest O(1) z cache'u zbiórek, więc trzydzieści pozycji nie kosztuje
trzydziestu zapytań — agregacja chodzi raz na dziesięć minut. Przy braku
danych o zbiórkach (świeża instalacja, instancja demo) pole po prostu znika
z odpowiedzi: „zbierany 0×/dzień" brzmiałoby jak zmierzony fakt, a nie jak
brak pomiaru.
## 0.70.0 — 21 sierpnia 2026

**Karta BRAKUJĄCE PACZKI pokazywała alarmy dla zwrotów rozliczonych tygodnie
temu.** Ze zgłoszenia z produkcji: zwrot 2905/2026 wisiał jako „11 dni bez
paczki", choć Allegro miało go za doręczony 11 sierpnia i rozliczony 13-go.
Nikt nie skanował tej etykiety u nas, bo sprawę załatwiono w panelu — a to
jedyny sygnał, jaki karta znała.

**Zapowiedź zna teraz status zwrotu po stronie Allegro.** Ticker zapisuje go
przy każdym przebiegu, więc lista widzi to samo co panel. Sprawy zamknięte
(`FINISHED`, `FINISHED_APT`, `REJECTED`, zwrot prowizji, magazyn Allegro)
schodzą z listy same. Nieznany status ŚWIADOMIE zostaje na liście: lepiej
pokazać zgłoszenie bez pracy niż ukryć paczkę, która naprawdę zaginęła.

**Dwa alarmy zamiast jednego, bo to dwa różne problemy.** „DORĘCZONA · NIE
PRZYJĘTA" znaczy, że paczka jest fizycznie u nas i nikt jej nie przyjął —
alarm natychmiast, bez progu dni, i na górze listy. „W DRODZE" to czekanie na
kuriera i alarmuje dopiero po `BRAKUJACA_PACZKA_DNI`. Do tej wersji jedno i
drugie wyglądało identycznie, więc pilne ginęło wśród cierpliwego.

**Przycisk SCHOWAJ na wierszu.** Zgłoszenie załatwione poza aplikacją znika
z listy decyzją człowieka, ze śladem w dzienniku. Schowanie nie blokuje
przyjęcia: skan szuka po numerze przesyłki, nie po stanie wiersza, więc
odnaleziona paczka wchodzi normalnie.

Karta raportu dostała kafel „doręczonych, nieprzyjętych", a surowy status
z Allegro stoi na ekranie obok każdego wiersza — regułę da się sprawdzić,
nie tylko jej zaufać.

## 0.69.0 — 20 sierpnia 2026

**Środowisko dev obok produkcji.** Magazyn pracuje na produkcji, a rozwój
przestaje na nią czyhać: instalator dostał przełącznik `-Dev`, który stawia
drugą, w pełni odseparowaną instancję na tej samej maszynie.

Do tej wersji drugiej instalacji nie dało się zrobić bezpiecznie. Nazwy usług
NSSM były zaszyte, więc ponowna instalacja PRZESTAWIAŁA usługi produkcyjne na
nowy katalog. Reguła zapory miała jedną nazwę, więc port drugiej instancji
zostawał zamknięty. Kanał APK był wspólny — kolektor wskazany na dev dostałby
propozycję testowego buildu, z którego nie ma powrotu, bo Android odmawia
obniżenia wersji.

`-Dev` rozbraja wszystkie trzy naraz: usługi z sufiksem `-dev`, reguła zapory
z portem w nazwie, katalog `apk/` celowo pusty. Dane wyłącznie demo — seed
towarów plus katalog scenariuszy S1–S71. Bramka odmawia `-Dev` na porcie 3001
i w katalogu produkcyjnym, bo każda z tych pomyłek kończy się rozstrojoną
produkcją. **[wymaga działania]** tylko dla chętnych: instalacja jedną
komendą, DEPLOY.md rozdział 6b.

Żeby nikt nie pomylił instancji, obie strony mówią, czym są. `/api/health`
niesie etykietę `srodowisko`; biuro na instancji dev pokazuje czerwony kafel
w pasku stanu, a kolektor — czerwoną pastylkę DEV na górnym pasku każdego
ekranu. Na produkcji nie zmienia się ani piksel: stały napis „PRODUKCJA"
uczyłby ignorować kolor.

## 0.68.0 — 20 sierpnia 2026

**Reklamacja dostaje półkę.** Towar w sprawie reklamacyjnej leżał „gdzieś" —
wiedza o miejscu mieszkała w głowach. Na liście reklamacji i karcie zwrotu
stoi teraz pole PÓŁKA (np. `REK-01`): wpis normalizowany jak skan
(trim + wielkie litery), puste pole zdejmuje z półki, a rozpatrzenie sprawy
półki NIE czyści — historia ma mówić, skąd towar zszedł.

To ewidencja w aplikacji, nie ruch w Subiekcie — świadomie: reklamowany towar
nie jest na stanie (korekta obejmuje pełnowartościowe i zniszczone), więc MM
nie miałoby czego przesuwać. Zmiana półki zostawia ślad w dzienniku.

**Dyskusje i reklamacje Allegro na podgląd.** W zakładce REKLAMACJE przycisk
POBIERZ Z ALLEGRO pokazuje otwarte dyskusje i formalne reklamacje klientów
(`GET /sale/issues`, zasób w becie — negocjacja Accept per rodzina końcówki
obejmuje teraz też `/sale/` i `/messaging/`). Sam odczyt, na kliknięcie:
sprawy toczą się w panelu Allegro i nic z nich nie zapisujemy u nas.
W dev — dwie fikcyjne sprawy, rozmowa i reklamacja.

## 0.67.0 — 20 sierpnia 2026

**Zniszczony towar przestaje znikać bez śladu.** Decyzja „do zniszczenia" była
ślepym zaułkiem: pozycja nie wchodziła na korektę, więc towar nigdy nie wracał
na stan — a fizycznie lądował w koszu na śmieci bez żadnego dokumentu. Stan
i papier mówiły co innego.

**Korekta obejmuje teraz pozycje pełnowartościowe I zniszczone.** Klient oddał
towar, więc sprzedaż koryguje się w całości — to rozszerzenie decyzji z 0.58.0
(„korekta tylko pełnowartościowe"), świadome: bez wejścia na stan RW nie
miałoby czego zdjąć. Na bufor zwrotowy dalej jadą wyłącznie pełnowartościowe;
zniszczone od razu schodzą dokumentem **RW** z magazynu sprzedaży. Netto stan
bez zmian, ale z dokumentem.

**Wszystko jednym zadaniem kolejki, z wycofaniem łańcuchowym.** Pad RW usuwa
MM i korektę, pad MM usuwa korektę; gdy wycofanie też padnie, błąd wymienia
z imienia dokumenty do ręcznego usunięcia. Zadanie bez pozycji zniszczonych
wygląda identycznie jak przed tą wersją — starszy worker Sfery wykona je bez
zmian. Zwrot w całości zniszczony też wystawia dokumenty (dotąd: żadnych).

Wywołanie RW przez Sferę (`DodajRW()`) jest szkicem `[WERYFIKUJ]` jak korekta
i MM — nowa pozycja na checkliście DEPLOY §6a i w README workera. W dev
RW dostaje atrapę numeru (`RW n/07/2026`), karta zwrotu pokazuje go obok
korekty i MM, a pozycje w tabeli mówią, dokąd każda pojedzie po korekcie.

## 0.66.0 — 20 sierpnia 2026

**Wyszukiwarka w dostawie uciszała skaner.** Ze zgłoszenia: „wyszukałem produkt
i nie mogę nadać lokalizacji ani zatwierdzić skanem, bo tekst input jest
aktywny".

Tak działa `WedgeKeySource`: skaner kolektora jest klawiaturą, więc zbiera
znaki wyłącznie wtedy, gdy nie ma ich gdzie wpisać. Pole tekstowe z fokusem
przejmuje znaki i skan trafia do pola zamiast na regał. Reguła jest słuszna —
bez niej hasło z klawiatury sprzętowej poleciałoby do wyszukiwarki towarów —
ale pole filtra nie oddawało fokusu nawet po schowaniu klawiatury. Kolektor
wyglądał więc na zepsuty: klawiatury nie widać, a skan nie robi nic.

Trzy poprawki, każda na inną drogę wyjścia:

- **„Gotowe" oddaje fokus**, nie tylko chowa klawiaturę. Dotyczy WSZYSTKICH
  pól w aplikacji, bo pułapka była wspólna.
- **Wybranie pozycji oddaje fokus.** Filtr jest drogą do pozycji, a nie trybem
  pracy: po jej wskazaniu idzie się do regału.
- **Pasek „Skaner milczy, dopóki piszesz" z przyciskiem GOTOWE.** Sama
  podpowiedź nie wystarcza — „gotowe" na klawiaturze ekranowej trzeba
  najpierw znaleźć, a robi się to w rękawicy.

## 0.65.0 — 20 sierpnia 2026

**System wie o zwrocie, zanim paczka dojedzie.** Klient rejestruje zwrot
w Allegro dniami przed nadaniem, a WERTIS dowiadywał się o sprawie dopiero od
skanu etykiety. Teraz serwer co pięć minut (`ALLEGRO_POLL_MS`; `0` wyłącza)
ściąga zapowiedzi zwrotów z `GET /order/customer-returns` i trzyma je jako
drogowskazy: numer referencyjny, login, numery paczek.

**Karta BRAKUJĄCE PACZKI.** Zgłoszenie czekające na paczkę dłużej niż
`BRAKUJACA_PACZKA_DNI` (domyślnie 3) pojawia się nad listą zwrotów — z dniami
oczekiwania i numerami do sprawdzenia u przewoźnika. Do tej pory zwrot
zgłoszony, a niedostarczony, NIE ISTNIAŁ w żadnym widoku: nikt nie wiedział,
że powinien czekać na paczkę. Karta znika, gdy nie ma o czym mówić; liczby
weszły też do karty RAPORT.

**Skan trafia w znane zgłoszenie.** Etykieta pasująca do zapowiedzi kończy się
jednym zapytaniem o szczegół zamiast dwóch przeszukiwań listy, a przyjęcie
odhacza zgłoszenie — każdą drogą: skan, wybór z kandydatów, szybka ścieżka.

**Token przestaje umierać z nudów.** Refresh token Allegro wygasał po
miesiącach bez użycia (DEPLOY §6a) — regularny przebieg tickera odświeża go
przy okazji. Ticker startuje z `main()`, nie z `buildApp()`: testy tras nie
strzelają do Allegro; w trybie http rusza dopiero po sparowaniu konta.

W DEPLOY stanęła też notatka o świadomie NIEwdrożonej automatyzacji: Allegro
umie zwrot środków z API (`POST /payments/refunds`, prowizja wraca sama),
ale pieniędzmi rusza człowiek — to decyzja właściciela, nie brak wiedzy.

## 0.64.0 — 20 sierpnia 2026

**Można odłożyć więcej, niż jest na fakturze.** Ze zgłoszenia: „dodaj
możliwość zatwierdzenia większej ilości niż jest na fakturze, idzie to do biura
jako problem po zakończeniu dostawy".

Do tej wersji `+` zatrzymywał się na liczbie z dokumentu. Magazynier z nadmiarem
na palecie miał do wyboru zgłoszenie wyjątku albo odłożenie części towaru poza
systemem. Teraz licznik idzie dalej, po jednym potwierdzeniu.

**Pytanie pada raz na pozycję.** Przy każdym kroku byłoby karą za liczenie
sztuk; bez żadnego pytania przypadkowe dotknięcie `+` wysyłałoby dostawcy
reklamację. Pasek mówi wprost, co się stanie po zamknięciu dostawy — zgoda na
skutek, którego nie widać, nie jest zgodą.

**Zgłoszenie powstaje przy domknięciu, nie przy odłożeniu.** Magazynier dokłada
sztuki w dwóch podejściach albo poprawia się korektą, więc reklamacja wysłana
przy pierwszym przekroczeniu opierałaby się na liczbie, która jeszcze się
zmieniała. Obie drogi domknięcia prowadzą przez ten sam lej, więc dostawa
zamknięta sama po ostatniej pozycji zgłasza nadmiar tak samo jak zamknięta
przyciskiem.

**Pozycja zostaje odłożona.** Status wyjątku odesłałby magazyniera do roboty,
której nie ma: towar leży na półce. Nadmiar jest sprawą biura wobec dostawcy —
ta sama reguła co D8, czytana z drugiej strony.

Zniknęła też odmowa „więcej nie da się odłożyć" przy korekcie ilości. Skoro `+`
wolno przekroczyć fakturę, korekta musi umieć to samo; inaczej jedyną drogą
wyjścia z omyłkowego nadmiaru byłaby reklamacja wystawiona za własną pomyłkę
w liczeniu.

**Logo dostawcy na liście dostaw jest większe.** Slot był kwadratem 40 dp,
a logotypy prawie nigdy nie są kwadratami — to szerokie paski z nazwą firmy.
`ContentScale.Fit` skalował je więc do kilkunastu punktów wysokości.

Slot ma teraz 64 dp szerokości przy tej samej wysokości. Rośnie samo logo,
a wiersz nie, więc lista nie traci ani jednej pozycji na ekranie. Kafelek stanu
zostaje kwadratem wyśrodkowanym w tym slocie: oba warianty MUSZĄ mieć ten sam
rozmiar, inaczej wiersz przeskakiwałby w bok w chwili doczytania logo.

## 0.63.0 — 20 sierpnia 2026

**Wskaźnik rozbieżności wraca na linijkę stanu.** Wersja 0.62.0 dokładała
osobny pasek z własnym zdaniem („ponad dokument 19 szt."). Mówił to samo dwa
razy: liczba stanu i ilość z dokumentu stoją tuż obok siebie, więc różnicę
widać, zamiast ją czytać.

Zostaje sam sygnał. Linijka „na hali 219 z tą dostawą" dostaje strzałkę
i kolor: ▲ bursztynowe przy nadwyżce, ▼ czerwone przy niedoborze. Przy
zgodnych liczbach zostaje szara i bez strzałki, dokładnie jak dotąd. Reguła
liczenia się nie zmienia — nadal jest w `:core` z siedmioma testami.

**Przy liczbie w kaflu znika „szt.".** Sztuki są domyślne i widać je w każdym
wierszu listy, więc podpis pod trzydziestopunktową cyfrą nie niósł nic. Metry,
litry i komplety ZOSTAJĄ: tam sama liczba zmienia znaczenie, a pomyłka kosztuje
odcięcie złej długości.

## 0.62.0 — 20 sierpnia 2026

**Wskaźnik rozbieżności w rozwiniętej pozycji.** Ze zgłoszenia: „jeśli ilość
z dostawy różni się z ilością na magazynie, dodaj jakiś indykator". Do tej pory
obie liczby stały obok siebie, a odejmowanie zostawało w głowie człowieka
stojącego przy regale.

Pasek pod stanem podaje **różnicę wraz z kierunkiem**. Nadwyżka jest
informacją: przy regale leży już zapas sprzed tej dostawy. Niedobór jest
ostrzeżeniem: system widzi mniej, niż mówi dokument, więc towar zszedł, zanim
ktokolwiek go rozłożył. Kolory są dwa, bo znaczenia są dwa.

Z którym magazynem wolno się porównywać, rozstrzyga sposób zaksięgowania.
Dostawa krajowa idzie wprost na MAG, więc stan hali zawiera już niesioną
partię. Kontener stoi na MGP do przesunięcia, więc partia siedzi tam, a hala
mówi tylko o zapasie sprzed dostawy. Porównanie z niewłaściwym magazynem
zapalałoby wskaźnik przy prawie każdej pozycji.

Reguła mieszka w `:core` i ma siedem testów, w tym trzy pilnujące przypadków,
w których wskaźnik ma MILCZEĆ. Wskaźnik zapalony bez powodu przestaje być
czytany, a wtedy nie działa także wtedy, gdy coś naprawdę się nie zgadza.

**Kafle ilości i lokalizacji mają wspólną wysokość.** Biały rósł o linijkę
„reszta zostaje" albo „w przyjęciach", a ciemny zostawał niższy — dwa kafle
tej samej rangi wyglądały jak kafel i przypis.

## 0.61.0 — 20 sierpnia 2026

**Zamienniki wypisane bez nagłówka są wreszcie klikalne.** Ze zgłoszenia:
opis kartoteki niesie `S11100 // G74050 // MF381350`, a sekcja zamienników
świeci pustką.

Parser wymagał etykiety — „Zamiennik:", „Zamiennie:", „Zastępuje:", „ZAM:".
Bez niej nie miał od czego zacząć i nie zwracał niczego. Opis złożony z samej
listy trafiał więc w próżnię, choć czytelny jest dla każdego człowieka.

Podwójny ukośnik jest teraz sygnałem sam w sobie. W prozie się nie zdarza,
a stawia go ktoś, kto wypisuje listę. Tryb bez etykiety jest jednak celowo
węższy od zwykłego:

- wymaga `//` — na przecinku czy ukośniku lista bez nagłówka byłaby
  zgadywaniem;
- kandydatem jest tylko token z cyfrą i bez spacji, więc proza nie zjada
  limitu przed symbolami;
- potrzebne są dwa trafienia w kartotece, bo numer modelu bywa naszym
  symbolem;
- numery obce z takiej listy nie powstają — bez nagłówka nie wiadomo, czy to
  zamienniki, czy modele.

Opis z etykietą działa dokładnie jak dotąd. Na pełnej kartotece liczba kartotek
z klikalnym zamiennikiem rośnie z 422 do **491**; te 69 to karty, na których
sekcja była wcześniej pusta.

Zmiana jest w całości po stronie serwera. Kolektor rysował te wiersze
poprawnie od zawsze, tylko nie miał czego rysować.

## 0.60.4 — 20 sierpnia 2026

**Kolektor odzyskuje serwer po przejściu pod inny punkt dostępowy.** Z hali:
„nie mogę się połączyć, wystarczyło rozłączyć i połączyć Wi-Fi". Ręczne
rozłączenie robiło dokładnie to, czego brakowało w kodzie.

Po przeskoku między punktami dostępowymi gniazda otwarte do poprzedniego AP
zostają w puli OkHttp. Z pozoru są żywe: pakiet wychodzi, odpowiedź nie wraca,
a żądanie stoi do timeoutu odczytu. Ekran wygląda wtedy jak zerwana łączność,
choć sieć jest.

Kolektor porzuca teraz te gniazda przy każdej zmianie sieci — także wtedy, gdy
Android nie zgłasza nowej sieci, a zmieniają się same adresy. Tak właśnie
wygląda przejście między AP tej samej sieci. Porzucane są wyłącznie połączenia
bezczynne, więc żądanie w locie nie urywa się w połowie.

Przy zmianie adresu serwera w ustawieniach dzieje się to samo. Stary adres ma
stare gniazda i nie mają one nic wspólnego z nowym serwerem.

Ekran startowy przestał też wymagać ludzkiej ręki. Komunikat „Nie widzę
serwera" wisiał, dopóki ktoś nie nacisnął ponowienia; teraz kolektor wyjęty
z kieszeni w zasięgu sam sprawdza serwer jeszcze raz.

`DEPLOY.md` §4 opisuje, jak ustawić kilka punktów dostępowych. Jest tam też
pułapka zapory: reguła z `remoteip=localsubnet` odcina kolektory z drugiej
podsieci, choć z zewnątrz wygląda to na jedną sieć.

## 0.60.3 — 20 sierpnia 2026

**Kolektor ginął przy nazwisku z polską literą.** Magazynier logował się
poprawnie, po czym aplikacja natychmiast się zamykała. Z `adb logcat -b crash`:

```
FATAL EXCEPTION: OkHttp Dispatcher
java.lang.IllegalArgumentException: Unexpected char 0x142 at 1 in x-user value: Błażej
```

`0x142` to `ł`. OkHttp przepuszcza w wartości nagłówka wyłącznie znaki
` `–`~` i przy każdym innym rzuca wyjątkiem. Leciał on z wątku dyspozytora,
gdzie nikt go nie łapał — aplikacja nie odmawiała połączenia, tylko ginęła.

Zasięg był szerszy, niż wyglądał. Nagłówek `x-user` dokleja się do **każdego**
żądania, a jego wartość to nazwa konta z serwera. Wywracał się więc każdy
magazynier z ł, ż, ó, ę, ą, ś, ć, ń albo ź w nazwie — przy pierwszym żądaniu
po zalogowaniu. To samo dotyczyło odtwarzania bufora offline, który przekazuje
nazwisko autora tym samym nagłówkiem.

Wartość jedzie teraz **zakodowana procentowo w UTF-8**, a serwer odkodowuje ją
w `userOf()`. Nie okrajamy ogonków, bo ta nazwa ląduje w `events.user_id`,
czyli w dzienniku audytu — „Blazej" byłby stratą danych, nie kosmetyką.

Kodowanie stosuje teraz **każdy** nagłówek doklejany przez kolektor, także
`x-device` i `x-session`. Te dwa niosą UUID i hex, więc dziś są bezpieczne —
ale interceptor, który może rzucić wyjątkiem, jest bombą z opóźnionym
zapłonem.

Zgodność w obie strony: stara nazwa ASCII nie zawiera procentu, więc przechodzi
przez dekodowanie bez zmian. Jedyne okno to **nowy APK na starym serwerze** —
do aktualizacji serwera dziennik pokazywałby wtedy `B%C5%82a%C5%BCej`. Serwer
i APK jadą w tym samym wydaniu, więc wystarczy nie rozdzielać aktualizacji.

## 0.60.2 — 20 sierpnia 2026

**Koniec z okienkami przeglądarki.** Notatka do decyzji wyskakiwała jako
systemowe „Komunikat ze strony localhost" — okno z innego świata, zasłaniające
kontekst i głuche na język wizualny strony. To samo robiły potwierdzenia
i błędy.

Wszystkie `prompt`/`confirm`/`alert` zastąpił jeden natywny `<dialog>`
w stylu WERTIS (Esc, fokus i przyciemnienie tła za darmo, nadal zero builda)
oraz toast na błędy. Dialogi mówią teraz PEŁNYM kontekstem: tytuł nazywa
decyzję, przycisk nazywa skutek („ZAPISZ DECYZJĘ", „ZAMKNIJ — NA HALĘ"),
a operacje niszczące mają czerwony przycisk.

Przy okazji naprawiona pułapka: ANULUJ przy notatce do decyzji ZAPISYWAŁ
decyzję bez notatki. Teraz przerywa całą operację — przycisk „nie" nie ma
prawa robić połowy „tak".

## 0.60.1 — 20 sierpnia 2026

**Licznik odpowiedzi na notatki prowadzi tam, gdzie obiecuje.** Sygnał
z 0.57.0 świecił poprawnie, ale odpowiedzi nie dało się znaleźć. Karta
`ODPOWIEDZI NA NOTATKI` stała pod tabelą dostaw, czyli ekran niżej. Kliknięcie
kafla wołało przełączenie na zakładkę, na której biuro już było — nie działo
się więc nic widocznego.

Karta przeniosła się **nad** tabelę dostaw. Ukryta, gdy nie ma odpowiedzi, nie
zajmuje w spokojny dzień ani piksela. Kafel paska stanu przewija do niej
i podświetla ją na dwie sekundy. Podświetlenie nie jest ozdobą: przewinięcie do
karty już widocznej wygląda tak samo jak brak reakcji.

Przy okazji wejście na zakładkę DOSTAWY odświeża tę kartę — tak samo jak
wejście na NADZÓR odświeża metryki. Dotąd zależało to od tego, czy ktoś
wcześniej wchodził w dokument.

Bez zmian po stronie serwera. Trasy, dane i stan „przeczytane" w bazie
działały od 0.57.0.

## 0.60.0 — 20 sierpnia 2026

**Biuro wygląda jak kolektor.** Strona `/biuro` dostała język wizualny hali:
te same tokeny kolorów (lustro `ui/theme/Color.kt`), te same fonty Barlow
i Barlow Condensed — dosłownie TE SAME pliki, kopiowane z zasobów Androida
i serwowane z własnego serwera (`/biuro/fonty/*`). Link do Google Fonts nie
wchodził w grę: biuro pracuje w LAN-ie bez wyjścia w świat.

Hierarchia informacji przepisana z kolektora, nie wymyślona od nowa:

- karty jak `cardSurface` — biel, promień 14, cienka ramka pod miękkim
  cieniem tintowanym grafitem;
- etykiety sekcji małe i rozstrzelone NAD treścią — podpisują, nie
  konkurują; identyfikatory i liczby w kondensacie, jak symbole na hali;
- zakładka aktywna to bursztynowa pigułka z AmberInk (wzór TabBara),
  nie odwrócone kolory;
- akcja główna jest BURSZTYNOWA z grafitowym napisem (PrimaryButton),
  cicha to biel z obrysem (OutlineButton) — przycisk mówi wagą, nie tylko
  miejscem;
- pastylki stanu w parach kolorów z kolektora: zieleń Success, bursztyn
  AmberBg/AmberInk, czerwień Destructive; pola dostają bursztynowy fokus.

Człowiek przechodzący między kolektorem a biurem widzi jedną aplikację —
kolor i waga znaczą wszędzie to samo.

## 0.59.0 — 20 sierpnia 2026

**Zwroty, Etap 3: cyfrowe kosze, rozkładanie na kolektorze i bufor, który
cofa się sam.** Do tego ścieżka reklamacyjna z priorytetem wg terminu
ustawowego i raport całego procesu. [wymaga działania] Nowy APK kolektora —
od 0.52.0 kolektory biorą go z serwera same.

**Koniec papierowej kartki.** Po wystawieniu korekty i MM biuro skanuje
etykietę kosza na karcie zwrotu — kosz powstaje przy pierwszym użyciu kodu,
rejestru nie ma. Zamknięcie kosza robi SNAPSHOT zawartości i wysyła go na
halę. Zamknąć nie da się, dopóki dokumenty nie weszły do Subiekta: kosz
z zadaniem w błędzie skończyłby się cofnięciem bufora, na którym towaru
nigdy nie było.

**Rozkładanie na kolektorze** mieszka na zakładce DOSTAWY, nad fakturami —
bo to też rozkładanie. Gramatyka skanu ta sama, co przy dostawach: towar
wskazuje pozycję (cudzy dostaje „nie z tego kosza"), regał ją odkłada.
Lista jest alejkowa, adres oczekiwany ŻYWY — z kartoteki skorygowanej
o kolejkę, jak przy dostawach, nie z zamrożonego snapshotu.

**Bufor cofa się sam.** Zakończenie rozkładania kolejkuje MM ze zwrotów na
magazyn główny — po jednym na pozycję, z tw_id, żeby guard „adres przed
sprzedawalnością" widział każdy towar. Zapis nowego adresu z odkładania
zawsze staje w kolejce przed MM tego samego towaru. To był krok 9 procesu:
dotąd ktoś przy komputerze musiał pamiętać o dokumencie cofającym.

**Reklamacje z zegarem.** Pozycje z decyzją „reklamacja" stoją na liście
sortowanej po dniach do terminu (`REKLAMACJA_DNI`, domyślnie ustawowe 14
od zgłoszenia w Allegro). Wiersze po terminie są czerwone. Rozpatrzenie
(uznana/odrzucona, z notatką) jest jednorazowe — klient dostał odpowiedź.

**Raport procesu** zbiera na jednej karcie: stany zwrotów, dokumenty
w kolejce i w błędzie, kosze, reklamacje po terminie i medianę czasu od
skanu do rozliczenia. Mediana zamiast średniej — jeden zwrot czekający
miesiąc na klienta nie zamazuje typowego tempa.

## 0.58.0 — 19 sierpnia 2026

**Zwroty, Etap 2: korekta sprzedaży i MM na bufor jednym kliknięciem.**
[wymaga działania] Dokumenty powstają w Subiekcie, więc ta funkcja żyje
dopiero z wdrożonym workerem Sfery (DEPLOY §6, etap 2) i poprawnym
`MAG_ID_ZWROTY`.

Do tej pory karta zwrotu kończyła się na decyzji i stemplu zwrotu środków.
Korektę i przesunięcie towaru robiło biuro ręcznie w Subiekcie, przepisując
z ekranu numer dokumentu i pozycje. Teraz robi to jeden przycisk.

**Jedno zadanie kolejki, nie dwa.** Korekta i MM idą razem jako
`korekta_zwrot`. Rozdzielenie ich dałoby chwilę, w której korekta jest
wystawiona, a towar leży w magazynie sprzedaży jako sprzedawalny — czyli
do sprzedania drugi raz, zanim ktokolwiek go obejrzał. Gdy MM padnie,
korekta jest usuwana; gdy nie uda się i to, zadanie mówi wprost, że trzeba
ją usunąć w Subiekcie przed ponowieniem.

**Na dokumenty idą wyłącznie pozycje pełnowartościowe** — towar wracający
do sprzedaży. Reklamacja, zniszczenie i pozycje do wyjaśnienia zostają poza
korektą, bo stan reklamacyjny w magazynie głównym byłby stanem nie do
sprzedania. Pozycja pełnowartościowa BEZ rozpoznanej kartoteki zatrzymuje
całość, zamiast wypaść po cichu: korekta na część zwrotu przy pieniądzach
za całość to błąd, którego nikt później nie zauważy.

**Magazyn źródłowy bierze się z dokumentu sprzedaży** (`dok_MagId`), nie
z magazynu głównego. Sprzedaż nie zawsze wychodzi z jedynki, a MM
z niewłaściwego magazynu to brak stanu i zadanie w błędzie.

**Numery obu dokumentów karta czyta przez wiersz kolejki**, nie z kopii na
zwrocie. Kopia rozjeżdżałaby się przy pierwszym ponowieniu, a ponowienie
i tak klika się w kolejce zapisów. Po zleceniu decyzji ani dokumentu już
się nie zmienia — dokumenty poszły na treść z chwili kliknięcia.

Strona biura po raz pierwszy zapisuje coś do `sfera_queue`, czyli do bazy
firmy. Test pilnujący listy jej zapisów wypisuje to teraz osobno.

---

## 0.57.0 — 19 sierpnia 2026

Cztery zmiany wokół jednej rzeczy: **co się dzieje, gdy coś idzie nie tak**.

**Wybrana pozycja przebudowana.** Panel odkładania urósł do dziewięciu sekcji
jedna pod drugą i spychał przyciski poza ekran. Teraz jest nagłówek z ✕
i **dwa kafle**: biały ze stepperem i stanem na hali, ciemny z adresem
i podpowiedzią skanu. Podział jest treścią, nie ozdobą — po lewej to, co
magazynier USTAWIA, po prawej to, dokąd IDZIE.

Adres schodzi z 28 na 24 sp. To jedyne miejsce, gdzie makieta odwraca
wcześniejszą decyzję („z lokalizacją idzie się do regału i czyta ją z odległości
ramienia") — rekompensatą jest biel na ciemnym zamiast bursztynu na kremowym,
bo kontrast rośnie mocniej, niż spada rozmiar. Kroki `−`/`+` **zostają 48 dp**,
nie 40 z makiety: cele dotyku są regułą całej aplikacji, kupioną pracą
w rękawicy. Liczba i jednostka rozdzielone, bo „192 szt" w 30 sp nie mieści się
między dwoma celami 48 dp na połowie szerokości.

`ANULUJ` znika — przejmuje go ✕ w nagłówku. Był ostatnim przyciskiem długiej
kolumny, czyli najdalej od miejsca, w którym człowiek trzyma wzrok.

**Kategorie problemu znają wreszcie swój zakres.** Arkusz rysował wszystkie
pięć bez względu na to, co się zgłasza. Na pozycji stał „Artykuł niezamówiony",
czyli z definicji towar SPOZA dokumentu, po którego wybraniu arkusz żądał
ręcznego numeru katalogowego mimo widocznego symbolu pozycji. A przy zgłoszeniu
dostawy stała „Zła ilość" — kafel **martwy**, bo serwer odmawiał go od zawsze.

Pozycja dostaje cztery kategorie, dostawa jedną. Walidacja działa teraz w OBIE
strony, a druga jej połowa jest nowa i zamyka dziurę: „artykuł niezamówiony"
dawało się przypiąć do dowolnej pozycji faktury i ustawić jej status `problem`.
Skrót `INNA ILOŚĆ` zniknął razem ze swoim powodem — „Zła ilość" stoi teraz
PIERWSZA wśród czterech kafli, więc skrót oszczędzał już tylko jedno tapnięcie.

**Panel biura przestał być ślepy na wyjątki.** Wyjątek liczy się jako pozycja
domknięta (D8, świadomie), więc dostawa z trzema reklamacjami pokazywała
**zielony pasek 100%** i wyglądała jak bezproblemowa. Wiersz listy dostaw ma
teraz licznik nierozwiązanych wyjątków; pasek postępu zostaje bez zmian —
zmieniamy sygnał, nie arytmetykę.

Karta reklamacji pokazuje datę, opis i ilość z dokumentu, a szczegół dodatkowo
numer katalogowy, „zamiast" i notatkę rozwiązania. Po stronie serwera nie
zmieniło się nic: te pola przychodziły od dawna i były wyrzucane.

I rzecz, która wyglądała na odwróconą: **biuro może wreszcie zamknąć wyjątek**.
Trasa istniała, działała i logowała — ale jej jedynym klientem był kolektor,
więc reklamację prowadziło biuro, a domykał ją magazynier na hali.

**Odpowiedź na notatkę wraca do biura sama.** Dotąd widać ją było wyłącznie po
wejściu w tę konkretną dostawę — a biuro nie miało powodu tam wracać. Pasek
stanu, widoczny z każdej zakładki, pokazuje teraz licznik odpowiedzi;
na zakładce DOSTAWY stoi karta z pytaniem, odpowiedzią i przyciskiem
`PRZECZYTANE`.

Stan „przeczytane" siedzi **w bazie, nie w przeglądarce**: biuro to dwa biurka,
a licznik z `localStorage` pokazywałby każdemu co innego i wracał po
wyczyszczeniu przeglądarki. Powtórne kliknięcie z drugiego biurka jest
nieszkodliwe i nie dubluje wpisu w audycie.

Bez powiadomień systemowych przeglądarki: wymagają bezpiecznego kontekstu,
a panel chodzi po LAN-ie po zwykłym HTTP. Okienko działałoby tylko na
instalacjach z HTTPS, czyli losowo — sygnał w pasku działa zawsze.

**[wymaga działania]** Nowy APK kolektora. Od 0.52.0 bierze go z serwera sam.

---

## 0.56.6 — 19 sierpnia 2026

**Rozmowa z klientem znajdowana po identyfikatorze, nie po loginie.**
Karta zwrotu pokazywała „brak korespondencji" także wtedy, gdy wątek
w Allegro istniał i był świeży.

Przyczyna siedzi w liście wątków. Allegro MASKUJE tam rozmówcę:
w `interlocutor.login` stoi `client:44300444`, a nie login kupującego
z zamówienia. Porównanie loginu z zamówieniem nie trafiało więc nigdy —
niezależnie od tego, ile stron przejrzeliśmy.

Zwrot zapamiętuje teraz `buyer.id`, a szukanie porównuje każdy
identyfikator rozmówcy z każdym, który mamy. Zwroty założone wcześniej
dostają identyfikator z zapamiętanej odpowiedzi Allegro przy starcie —
nie trzeba ich zakładać od nowa.

Zmienił się też zasięg szukania. Wcześniej sztywne sto najnowszych
rozmów, dziś: schodzimy do miesiąca przed zwrotem, z limitem stron jako
bezpiecznikiem. Klient pisze zwykle PRZED odesłaniem paczki.

Gdy wątku nie ma, ekran mówi ile rozmów przejrzał i do jakiej daty.
„Klient nie pisał" i „nie doszedłem tak głęboko" to dwie różne
odpowiedzi, a poprzednia wersja pokazywała je identycznie.

## 0.56.5 — 19 sierpnia 2026

**Powód zwrotu wreszcie na karcie — i rozmowa z klientem obok niego.**
Kolumna POWÓD była pusta przy każdym prawdziwym zwrocie, choć klient go
podawał.

Wina leżała w tym, którą odpowiedź Allegro czytaliśmy. Skan szuka zwrotu
na LIŚCIE (`/order/customer-returns?parcels.waybill=…`), a lista jest
streszczeniem: bez powodów i bez komentarzy kupującego. Te niesie dopiero
szczegół pojedynczego zwrotu. Skan dociąga go teraz po znalezieniu paczki;
nieudany szczegół degraduje do danych z listy, bo zwrot ma powstać.

Powód przychodzi KODEM (`NOT_AS_DESCRIBED`), więc karta tłumaczy go na
zdanie po polsku. Kod spoza słownika pokazujemy surowo — nigdy nie
ukrywamy tego, czego nie znamy — a `NONE` znaczy „klient nie podał
powodu" i zostaje pustką.

**Rozmowa z klientem** to nowa sekcja karty: wątek z Centrum wiadomości
Allegro, dymkami, ze stroną nadawcy widoczną na pierwszy rzut oka.
Trzy decyzje warte odnotowania:

- czytamy NA KLIKNIĘCIE, nie z kartą — karta odświeża się co 30 s, a wątek
  to dwa dodatkowe zapytania do Allegro;
- NIE zapisujemy rozmowy u siebie: toczy się dalej po ocenie towaru, więc
  kopia starzałaby się od pierwszej odpowiedzi i mnożyła dane osobowe;
- odpowiada się w Allegro (link obok) — wysyłanie wiadomości z WERTIS to
  osobna decyzja, nie skutek uboczny podglądu.

**[wymaga działania]** Rozmowa wymaga uprawnienia `allegro:api:messaging`
na aplikacji (developer.allegro.pl) i ponownego sparowania konta. Bez tego
reszta zwrotów działa bez zmian, a przycisk mówi, czego brakuje.

## 0.56.4 — 19 sierpnia 2026

**Karta zwrotu pokazuje CAŁE zamówienie, nie tylko to, co wraca.** Nowa
sekcja wylicza wszystkie pozycje zamówienia i znakuje je: WRACA albo
zostaje u klienta.

Pytanie „co on jeszcze z tym kupił" zapada przy każdej ocenie towaru.
Czy wraca komplet, czy jedna rzecz z zestawu? Czy pasująca część została
u kupującego? Odpowiedź wymagała dotąd otwarcia panelu Allegro obok —
a decyzja o zwrocie zapadała w oderwaniu od zamówienia.

Dane nie kosztują ani jednego dodatkowego zapytania: zamówienie i tak
pobieramy przy skanie, żeby wyciągnąć z niego sygnatury pozycji. Dotąd
resztę odpowiedzi wyrzucaliśmy. Teraz ląduje w `zwrot_zam_pozycja` jako
SNAPSHOT z chwili skanu — oferta potrafi zmienić nazwę albo zniknąć,
a karta ma pokazywać, co kupiono wtedy.

Zwroty ręczne i zwroty bez zamówienia nie mają tu wierszy, więc karta
ukrywa sekcję zamiast pokazywać pustą tabelę. Zwroty założone przed tą
wersją zostają bez zamówienia — nie zmyślamy im historii.

Zwykły PATCH; instalacji bez Allegro zmiana nie dotyczy wcale.

## 0.56.3 — 19 sierpnia 2026

**Skan etykiety zwrotu kończył się błędem 406 — pytaliśmy Allegro o złą
wersję zasobu.** Pierwsze prawdziwe zapytanie po sparowaniu konta wracało
z `NotAcceptableException` i zdaniem „Please check 'Accept' request header".

Wersja zasobu siedzi w Allegro w nagłówku `Accept` i NIE jest jedna dla
całego API: zasoby stabilne biorą `public.v1`, a zwroty klienckie chodzą
w becie, czyli `beta.v1`. Zapytanie nagłówkiem z niewłaściwej półki nie
zwraca pustej listy, tylko właśnie 406.

Zamiast wpisać betę na sztywno, adapter NEGOCJUJE wersję: próbuje kolejno
znanych nagłówków, a działający zapamiętuje osobno dla każdej rodziny
końcówek (`customer-returns`, `checkout-forms`). Dzięki temu wypromowanie
zwrotów do wersji stabilnej — albo wejście kolejnej bety przy Etapie 2 —
nie wymaga niczyjej interwencji, a jedna beta nie przestawia wersji
wszystkim pozostałym zapytaniom. Koszt to jedno dodatkowe zapytanie raz po
starcie procesu, nie przy każdym skanie.

Zwykły PATCH; instalacji bez Allegro zmiana nie dotyczy wcale.

---

## 0.56.2 — 19 sierpnia 2026

**Cztery czynności w panelu biura nie działały — wszystkie z tego samego
powodu.** Zgłoszenie brzmiało wąsko: kasowanie logo dostawcy kończy się
komunikatem „Nie usunięto: Bad Request".

Wina nie leżała w logo, tylko w `api()` — wspólnym opakowaniu wszystkich
wywołań panelu. Nagłówek `content-type: application/json` jechał **zawsze**,
także przy żądaniach bez treści. Domyślny parser Fastify odrzuca taką parę
u siebie i odpowiada 400 z polem `error: "Bad Request"` — czyli dokładnie tym
napisem, który zobaczyło biuro.

Martwe były przez to cztery rzeczy naraz, a trzy z nich milczały miesiącami,
bo robi się je raz na jakiś czas:

- cofnięcie zamknięcia „poza WERTIS" (od 0.40.0),
- odpięcie dokumentu od zwrotu (od 0.53.0),
- rozłączenie konta Allegro (od 0.53.0),
- skasowanie logo dostawcy (od 0.56.0).

Logo tylko wyprowadziło usterkę na światło, bo kasowanie robi się od razu po
wgraniu — reszta czekała na swoją rzadką okazję.

Nagłówek jedzie teraz **tylko wtedy, gdy jest co opisywać**. Serwera nie
rozluźniamy: komunikat bez treści nie ma prawa deklarować typu treści,
a własny parser przyjmujący pustkę działałby globalnie i przepuszczał do
procedur obsługi żądania, które dziś odbijają się od bramki.

**Dlaczego komplet testów tras tego nie złapał.** `app.inject` nie wysyła
nagłówków przeglądarki, więc serwer nie miał czego parsować i trasa
odpowiadała 200. Testy odtwarzały wywołanie, ale nie odtwarzały **żądania** —
a cała usterka siedziała w nagłówku. Bramka stoi teraz na samej regule
w `api()`, nie na jednym przycisku, i sprawdzono, że wywala się na kodzie
sprzed poprawki. Obok niej test zapisujący samo zachowanie Fastify, żeby ta
pułapka miała w repo swoje nazwisko.

**[wymaga działania]** Sam `-Aktualizuj` na serwerze. **Nowy APK NIE jest
potrzebny** — zmiana dotyczy wyłącznie strony biura. Restart usług jest
konieczny i następuje sam: `biuro.html` wczytuje się raz przy starcie, nie
przy każdym żądaniu.

---

## 0.56.1 — 19 sierpnia 2026

**Żądania do Allegro niosą nagłówek User-Agent — zanim Allegro zablokuje
klucz za jego brak.** Ekran po rejestracji aplikacji na developer.allegro.pl
mówi wprost: nagłówek jest obowiązkowy w każdym żądaniu, a brak prawidłowego
grozi zablokowaniem klucza API. Nasza integracja wysyłała dotąd domyślny
nagłówek fetcha — czyli dokładnie ten „nieprawidłowy".

Wartość z przycisku „Wygeneruj nagłówek User-Agent" wkleja się w nowy klucz
`ALLEGRO_USER_AGENT` (DEPLOY §6a). Puste pole nie zostawia dziury: fallback
`WERTIS/<wersja>` przedstawia się po imieniu, nigdy gołym „node". Nagłówek
idzie na wszystkie trzy końcówki: API, token i parowanie device flow.

Zwykły PATCH; instalacji bez Allegro ta zmiana nie dotyczy wcale.

## 0.56.0 — 19 sierpnia 2026

**Logo dostawcy: biuro wgrywa, magazynier widzi na liście dostaw.** Wiersz
dokumentu pokazuje je po lewej, w miejscu szarego kafelka. Firmę poznaje się
wtedy wzrokiem, zanim przeczyta się numer faktury.

Zgłoszenie przyszło z jedną uwagą, która przesądziła o całym projekcie:
*„niektóre loga są webp, niektóre svg"*. Serwer nie umie przerabiać obrazów
i **nie będzie** — ma dwie zależności i zero modułów natywnych, a rasteryzacja
SVG znaczyłaby moduł natywny na maszynie z Subiektem. Kolektor rysuje przez
`BitmapFactory`, który SVG nie zna.

Konwerter jednak już był, tylko nikt na niego nie patrzył: **panel biura to
przeglądarka**, a ta rysuje SVG, WebP, PNG i JPEG natywnie. Wybrany plik idzie
więc na `<canvas>` i wychodzi jako jeden PNG o jednym boku, ZANIM cokolwiek
pojedzie na serwer. Serwer i kolektor nigdy nie dowiadują się, że SVG istnieje,
i żadna ze stron nie dostała nowej zależności.

Po stronie serwera zostaje rola strażnika: sprawdzamy BAJTY, nie deklarację.
Obraz bez sygnatury PNG nie przeszedł przez tę konwersję i jest odrzucany
z powodem — zamiast wylądować w bazie i zniknąć dopiero na ekranie
magazyniera, najdalej od miejsca, w którym dałoby się zrozumieć dlaczego.

**Logo wiąże się z identyfikatorem kontrahenta, nie z nazwą.** `kh_Id` stało
dotąd w złączeniu zapytania o dokumenty i było natychmiast wyrzucane — teraz
jedzie do read-modelu. Nie kosztowało to ani jednego nowego uprawnienia SQL,
a rozwiązuje problem, który panel ma już przy szablonach druku: ta sama firma
potrafi wystąpić pod dwoma napisami, bo symbol w Subiekcie wolno poprawić.

**Kafelek stanu ustępuje miejsca.** Dotąd niósł kolor i ikonę stanu dostawy,
ale ta sama informacja stoi w wierszu jeszcze trzy razy: pasek postępu, prawa
kolumna („done/total" kontra „N poz.") i pastylka „DO ZAMKNIĘCIA". Czwarte
powtórzenie nie było warte jedynego miejsca, w którym da się pokazać, KTO to
przywiózł. Dostawca bez logo dostaje kafelek dokładnie taki jak dotąd.

**Lista pyta o logo tylko wtedy, gdy jest o co pytać.** Serwer podaje w wierszu
flagę `maLogo`, więc kolektor nie strzela serią zapytań o obrazy, których nie
ma. Do tego 404 z tej trasy nie idzie do dziennika — ta sama lekcja, po której
0.52.3 wyciszyło zapytania o zdjęcia kartotek: 355 wpisów na tysiąc przykryło
wtedy pięć prawdziwych odmów.

Nowa zakładka **DOSTAWCY** w `/biuro` pokazuje firmy z dokumentów dostaw, także
te bez logo — bo pytanie brzmi „komu jeszcze brakuje", a nie „co już wgrano".
Scenariusz **S70** stawia oba warianty wiersza obok siebie i niesie dwie bramki:
trzy formaty pliku oraz czysty dziennik.

**[wymaga działania]** Nowy APK kolektora. Od 0.52.0 bierze go z serwera sam.
Logo nie ma żadnej konfiguracji — działa od razu po aktualizacji.

---

## 0.55.0 — 19 sierpnia 2026

**Układ ekranu dostawy — trzy poprawki ze zrzutu z hali.** Wszystkie dotyczą
tego, gdzie oko szuka informacji, a ręka przycisku.

**Zdjęcie stoi po lewej także w wierszu rozwiniętym.** Dotąd wędrowało: przy
pozycji oczekującej było przy symbolu, a po rozwinięciu przeskakiwało na drugi
koniec paska, w rozmiarze 56 dp. Powód był kiedyś prawdziwy — zdjęcie miało nie
sąsiadować z pastylką adresu. Tylko że w rozwiniętym wierszu pastylki NIE MA,
bo adres krzyczy 28 sp w panelu odkładania tuż niżej. Zostawała sama
niespójność: ta sama pozycja pokazywała zdjęcie w dwóch różnych miejscach.
Teraz stoi w jednym, a lewy slot 36 dp i tak był na nie przygotowany —
zajmował go rysunek pudełka o tym samym rozmiarze.

**Symbol towaru urósł z 15 na 18 sp.** To po nim magazynier rozpoznaje towar
przy regale i ma być czytelny z ręki trzymającej karton. Pozycja zwinięta
zostaje na 13 sp: jej pasek jest o połowę niższy po to, żeby dziesięć pozycji
drobnicy zmieściło się bez przewijania.

**„ZGŁOŚ PROBLEM DOSTAWY" i „ZAKOŃCZ DOSTAWĘ" zjechały POD listę.** Stały nad
nią, czyli przed pracą, którą opisują. Lista jest kontrolą kompletności, więc
dojście do zakończenia ma prowadzić wzrokiem przez to, co jeszcze zostało
w kartonie. Nagłówek zostaje tym, po co się na ten ekran wchodzi: postęp,
podpowiedź o skanie i pole szukania.

Stan **„DOSTAWA ZAKOŃCZONA"** celowo został u góry. Na zamkniętej dostawie to
jedyne wyjście z ekranu, a schowanie go pod pozycjami przywróciłoby usterkę
naprawioną dzień wcześniej w 0.54.0 — dostawę dało się zamknąć, ale nie dało
się z niej wyjść.

Scenariusz S24 i checklisty w `android/README.md` mówią teraz, gdzie te rzeczy
stoją, a nie tylko jak działają. Zdanie „na jego miejscu stoi WRÓĆ DO LISTY
DOSTAW" przestało być prawdziwe i zniknęło.

**[wymaga działania]** Nowy APK kolektora. Od 0.52.0 bierze go z serwera sam.

---

## 0.54.0 — 18 sierpnia 2026

**Zakończona dostawa nie wypuszczała z ekranu.** Zgłoszenie z hali: *„klikam
zakończ dostawę, dostawa zostaje zamknięta, ale nie następuje wyjście do listy
dostaw"*. Kolektor pokazywał wtedy „Ta dostawa jest już zamknięta" — czyli
odmowę serwera, a nie potwierdzenie zapisu.

Przyczyna nie leżała w samym zamykaniu. **Dostawa domyka się sama**, gdy
ostatnia pozycja zostaje rozstrzygnięta; robi to `closeIfComplete` po każdym
odłożeniu. Człowiek odkłada ostatnią sztukę, dostawa jest już zamknięta,
a przycisk „ZAKOŃCZ DOSTAWĘ" stoi dalej i czeka na kliknięcie, po którym może
już tylko dostać odmowę. To nie był rzadki przypadek brzegowy, tylko
**najczęstsze zakończenie pracy w tej aplikacji**.

Na ekranie pozycji dostawy złożyły się na to dwie osobne usterki. Pole `status`
przychodziło z serwera i **nie było czytane ani razu**, więc przycisk nie miał
żadnego warunku widoczności. A powrót na listę leżał wyłącznie na ścieżce
sukcesu — każda odmowa kończyła się samym komunikatem i ekranem bez wyjścia.

Ekran czyta teraz status. Na dostawie zamkniętej zamiast przycisku stoi stan
końcowy: `DOSTAWA ZAKOŃCZONA` i `WRÓĆ DO LISTY DOSTAW`. Człowiek nie ma już jak
nacisnąć przycisku skazanego na odmowę.

Odmowa i tak może przyjść — dostawę potrafi domknąć drugi kolektor między
wczytaniem ekranu a naciśnięciem. Serwer nazywa ją teraz kodem
`juz_zamknieta`, a kolektor po tym kodzie **wraca na listę zamiast zawisnąć**.
Rozpoznanie po kodzie, nie po treści komunikatu: zdanie dla człowieka wolno
poprawiać, znaczenie odmowy nie. Ten stan nie jest porażką — dostawa JEST
zamknięta, więc nie ma prawa kończyć się dźwiękiem błędu.

Przy okazji `deliveryId` przestaje kłamać. Wyjście z zakończonej dostawy zeruje
kontekst pracy, więc pytanie „przejąć pracę?" i ślad w audycie nie meldują już
„dostawa #N" po czymś, czego nie ma. Zwykły powrót tego pola **nie** czyści —
z ekranu pozycji wchodzi się w kartę towaru, która przy powrocie tego kontekstu
potrzebuje.

Scenariusz S24 („dostawa zamknięta") dostał opis tego, co ekran ma pokazać —
obszar zakończenia dostawy stał dotąd bez ani jednej bramki, co CHANGELOG 0.52.1
wypisał jako jawny dług.

**[wymaga działania]** Nowy APK kolektora. Od 0.52.0 bierze go z serwera sam —
wystarczy `-Aktualizuj` na serwerze i potwierdzenie na urządzeniu.

---

## 0.53.2 — 18 sierpnia 2026

**Tryb demo loguje się od razu: konto `admin`/`admin` powstaje samo.** Start
API przy `SGT_MODE=seeded` na bazie bez żadnego konta z loginem zakłada konto
demo (rola `admin`) i mówi o tym w logu. Dotąd świeże demo witało ekranem
logowania, do którego nie istniały żadne dane — konto zakładał dopiero
`npm run seed` (hasło z `ADMIN_HASLO` albo wylosowane i wypisane raz), a kto
przegapił tę jedną linię konsoli, zostawał przed zamkniętą bramką.

To ŚWIADOME ODWRÓCENIE decyzji „żadnych stałych haseł demo" — decyzją
właściciela, tym samym trybem co odwrócenie przy raporcie wydajności
w 0.48.0. Tamta zasada broniła przed wyjątkiem „tylko na dev", który jedzie
potem na produkcję; tutaj ogrodzeniem jest TRYB, nie dyscyplina: `seeded`
nie ma prawa działać na produkcji, a przy `mssql` ziarno nie robi nic.
Nie wraca też w demo z własnymi kontami — wchodzi wyłącznie do pustej bazy.
Polityka minimum 8 znaków dla kont zakładanych ręcznie zostaje bez zmian.

Zwykły PATCH: produkcyjne wdrożenie tej zmiany nie widzi wcale.

## 0.53.1 — 18 sierpnia 2026

**Aktualizacja 0.53.0 kładła API na starcie — import sprzedaży nie udźwignął
skali Allegro.** Instalator kończył komunikatem „API nie odpowiedziało",
a dziennik usługi pokazywał na przemian błąd SQL Servera 8623 („query
processor ran out of internal resources") i timeout 15 s, przeplatane
nieudanymi połączeniami — bo NSSM restartował padający proces w pętli,
dobijając przy okazji serwer SQL.

Przyczyna: zapytanie o pozycje dokumentów sprzedaży pytało listą
`WHERE ob_DokHanId IN (id, id, …)` zawierającą WSZYSTKIE `dok_Id` z okna
90 dni. Ten wzorzec jest bezpieczny przy dostawach (okno 14 dni, dziesiątki
dokumentów) — sprzedaż wysyłkowa w kwartale to dziesiątki tysięcy
identyfikatorów w jednym SQL-u, czyli dokładnie to, na co SQL Server
odpowiada błędem 8623. A że import przy starcie API jest twardym błędem,
usterka jednego zapytania wyłączała cały magazyn.

Trzy zmiany:

- **Pozycje sprzedaży idą JOIN-em** z tymi samymi filtrami co nagłówki —
  długość SQL-a przestała zależeć od liczby dokumentów. Oba zapytania
  sprzedaży dostały `WITH (NOLOCK)`: to read-model odświeżany co 60 s,
  a w dzienniku był też deadlock z Subiektem pracującym obok.
- **Awaria odczytu sprzedaży degraduje, nie przerywa.** Stany i lokalizacje
  są ważniejsze od dopasowywania zwrotów: przy błędzie zostaje ostatni udany
  odczyt `sgt_sprzedaz`, magazyn pracuje, a `/api/health` mówi zdaniem, co
  się stało. API startuje zawsze.
- **`MSSQL_REQUEST_TIMEOUT_MS`** (domyślnie 30000): limit pojedynczego
  zapytania do bazy Subiekta przestał być zaszytym w driverze 15-sekundowym
  przypadkiem — odczyt stu tysięcy wierszy stanów na obciążonej maszynie
  bywał ścinany tuż przed metą.

Przy okazji domknięte dwa [WERYFIKUJ] z 0.53.0 — właściciel dostarczył opis
struktury bazy 1.8731.31.6933: `dok_NrPelnyOryg` (varchar 30) i `dok_Uwagi`
(varchar 500) ISTNIEJĄ na `dok__Dokument`, więc kolumna uwag weszła do
domyślnych sygnałów dopasowania (`MSSQL_SPRZEDAZ_UWAGI_COLUMN=dok_Uwagi`).
Potwierdzone też, że sygnatura oferty Allegro (`external.id`) to `tw_Symbol`
— dokładnie tak, jak dopasowuje serwis zwrotów. Do sprawdzenia na danych
zostało tylko, czy integracja wpisuje numer zamówienia w któreś z tych pól.

Zwykły PATCH: `git pull`, build, restart usług — nic ręcznego. Po starcie
log importu ma pokazywać `sprzedaz=N` z niezerowym N.

## 0.53.0 — 18 sierpnia 2026

**Zwroty Allegro, etap pierwszy: skan etykiety → rekord zwrotu → decyzje →
dokument sprzedaży.** Do tej wersji zwrot z Allegro zaczynał się od papierowej
kartki i ręcznego szukania w dwóch systemach: kto to odesłał, czemu, na którym
dokumencie stała ta sprzedaż. Teraz biuro skanuje etykietę z paczki w nowej
zakładce ZWROTY ALLEGRO w `/biuro` — aplikacja pyta Allegro API o zwrot,
zakłada rekord z kupującym, powodem i pozycjami, po czym sama wskazuje
dokument FS albo PA z Subiekta.

Co wchodzi w skład:

- **Skan etykiety.** Pytamy Allegro po numerze nadania ORAZ po numerze
  przewoźnika doręczającego — etykieta u drzwi bywa tym drugim. Drugi skan tej
  samej paczki otwiera istniejący zwrot, nie zakłada duplikatu. Etykieta
  nieznana Allegro dostaje ścieżkę **zwrotu ręcznego** z pozycjami wskazywanymi
  z kartoteki.
- **Decyzja per pozycja**, nie per paczka: pełnowartościowy / reklamacja /
  do wyjaśnienia / do zniszczenia — bo jedna paczka miewa artykuł
  pełnowartościowy i uszkodzony naraz. Status zwrotu jest pochodną decyzji
  (`nowy → oceniony → rozliczony`), decyzję można poprawić do rozliczenia,
  a wszystko zostaje w dzienniku.
- **Dopasowanie dokumentu.** Import z MSSQL zaciąga teraz też dokumenty
  sprzedaży (FS i PA, własne okno `DOK_SPRZEDAZ_DNI_WSTECZ` = 90 dni, zero
  nowych GRANT-ów). Numer zamówienia Allegro znaleziony na dokumencie
  ([WERYFIKUJ] którą kolumną — DEPLOY §6a) dopasowuje automatycznie;
  bez niego biuro wybiera z punktowanej listy kandydatów, która mówi wprost,
  skąd punkty.
- **Zwrot środków półautomatem.** Link do panelu zwrotów Allegro + przycisk
  ODDANO ŚRODKI — pieniądze rusza człowiek, aplikacja pilnuje kolejności
  (najpierw ocena towaru) i trzyma stempel kto/kiedy.
- **Parowanie konta Allegro** device flow z karty KONTO ALLEGRO (rola admin):
  kod + link, bez adresu przekierowania. Token mieszka w bazie aplikacji
  i odświeża się sam; brak parowania melduje `/api/health`.
- **Tryb demo bez Allegro:** przy `SGT_MODE=seeded` pracuje adapter `dev`
  z fikcyjnymi zwrotami, zestrojonymi z seedem scenariuszy — nowe scenariusze
  **S67–S69** (`docs/scenariusze-testowe.md`).

**Ten etap NICZEGO nie zapisuje do Subiekta** — `sfera_queue` nietknięta.
Korekta sprzedaży i MM na magazyn zwrotów jedną decyzją to etap drugi; kosze
zwrotowe, roznoszenie na kolektorze i automatyczne cofnięcie bufora — trzeci.
Poprzedni moduł zwrotów wyszedł w 0.17.0, bo jego finał wymagał workera Sfery,
którego wtedy nie było — ta droga jest teraz otwarta, ale wchodzi etapami.

Nowe tabele: `zwrot`, `zwrot_pozycja`, `allegro_token`, `sgt_sprzedaz`,
`sgt_sprzedaz_pozycja` — powstają same przy starcie. 27 nowych testów
(serwis, trasy, mapowanie API, filtry importu).

**[wymaga działania]** Tylko jeśli chcesz włączyć zwroty na produkcji:
rejestracja aplikacji na developer.allegro.pl, dwa klucze w `wertis.env`
i parowanie konta — krok po kroku w DEPLOY §6a. Bez tych kluczy zakładka
mówi, że funkcja jest wyłączona, i nic więcej się nie zmienia.

---

## 0.52.5 — 18 sierpnia 2026

**Instalator odrzucał poprawne APK z powodu własnego błędu w czytaniu sumy
kontrolnej.** Zgłoszenie z wdrożenia brzmiało tak, jak brzmi podmieniony plik:

```
APK kolektora - SUMA KONTROLNA SIE NIE ZGADZA. Przerywam.
        oczekiwana: 102
        otrzymana:  f5a36ce80529a8a19068c804dea2af58015f671b7e064dd23e0a50968704a969
```

Pobrany plik był w porządku — ta druga suma zgadza się co do znaku z tym, co
GitHub podaje dla `wertis-kolektor-0.52.4.apk`. Zepsuta była pierwsza. GitHub
wystawia `.sha256` jako `application/octet-stream`, więc `Invoke-WebRequest`
zwracał treść **tablicą bajtów**, a nie tekstem. Rozbicie takiej tablicy po
białych znakach dawało jej pierwszy element, czyli `102` — kod znaku `f`,
pierwszej litery sumy.

Suma jedzie teraz do pliku (`-OutFile`) i czyta ją nowa `Get-WertisSumaZPliku`,
której typ zawartości nie dotyczy. Doszła kontrola kształtu: 64 znaki
szesnastkowe albo nic. To celowe — suma, która nie wygląda jak suma, jest
gorsza od jej braku, bo braku nikt nie pomyli z weryfikacją, a śmieć odrzuca
poprawny plik razem ze złym. Gdy plik sumy przyjdzie w takim stanie, instalator
mówi o tym osobnym ostrzeżeniem i wypisuje sumę policzoną na miejscu.

Osiem asercji w `instalator/testy.ps1`, w tym ta z `102` wprost. Wszystkie
działają bez sieci, na plikach zapisanych na dysku.

**[wymaga działania]** Na serwerze uruchom ponownie `-Aktualizuj`. Poprzedni
przebieg skasował pobrane APK jako niezgodne, więc plik trzeba ściągnąć raz
jeszcze — tym razem skończy się wpisem „APK kolektora gotowy dla kolektorow".

---

## 0.52.4 — 18 sierpnia 2026

**Instrukcja klucza podpisu nie mówiła, skąd wziąć `keytool`.** Zgłoszenie
z wdrożenia: `keytool: command not found`. Polecenie przychodzi z JDK, a na
serwerze WERTIS jest sam Node — więc na tej maszynie nie mogło zadziałać ani
razu, a instrukcja stała w sekcji, którą wykonuje się właśnie tam.

Sekcja mówi teraz trzy rzeczy, których brakowało. Że klucz **nie jest serwerowi
do niczego potrzebny** — trafia do sekretów repozytorium, a podpisuje nim CI,
więc robi się go na dowolnej maszynie z Javą. Że JDK instaluje jedno polecenie
`winget`, a przy Android Studio `keytool` już jest, tylko poza `PATH`. I że po
instalacji trzeba otworzyć nowy terminal.

Doszło też to, co dalej blokowało: gotowe polecenie zamieniające keystore na
base64 do sekretu `WERTIS_KEYSTORE_B64` oraz zdanie, że pytania kreatora
o tożsamość w certyfikacie nie mają znaczenia technicznego. Bez nich człowiek
zatrzymywał się dwa kroki dalej, przy tej samej ścianie.

Doszło też **gdzie** te sekrety wpisać — ścieżka w ustawieniach repozytorium
i pełny adres, bo instrukcja wymieniała cztery nazwy i milczała o miejscu.
Razem z tabelą, co dokładnie wkleić w każdy z nich, i z regułą, której te nazwy
wprost nie zdradzają: **oba hasła muszą być identyczne**, bo magazyn PKCS12
nie obsługuje osobnego hasła klucza. Na końcu sprawdzian: artefakt
`wertis-kolektor-apk` i wydanie `v<wersja>` w zakładce Releases.

`android.yml` dostał przy okazji **ręczne uruchomienie** (`workflow_dispatch`).
Potrzebne dokładnie raz na instalację i właśnie w tym momencie: po dodaniu
sekretów podpisu nie ma czego wypchnąć, a bez biegu nie powstanie ani APK, ani
wydanie, z którego bierze go instalator. Warunki kroków wydania przyjmują teraz
każdy bieg na `main`, który nie jest sprawdzeniem PR-a.

Wariant **bashowy** stoi obok PowerShellowego, bo instrukcja zakładała dotąd
jedną powłokę: `base64 -w0`, wywołanie `keytool` z Android Studio pełną ścieżką
w Git Bashu i ostrzeżenie, żeby nie podawać hasła przełącznikiem `-storepass` —
zostaje wtedy w historii powłoki. Składnia sprawdzona uruchomieniem, nie
z pamięci: powstaje magazyn PKCS12 z kluczem `wertis` i podpisem SHA384withRSA.

**[wymaga działania]** Nic. Sama dokumentacja.

---

## 0.52.3 — 18 sierpnia 2026

**Audyt przestał tonąć we własnym szumie.** Eksport śladu audytowego
z produkcji pokazał, że **355 z 1000 zdarzeń** w oknie czterech dni to jeden
wpis: „404 Brak zdjęcia". Zapytano o 301 różnych kartotek i ani jedna nie miała
zdjęcia, bo instalacja nie ma włączonych `ZDJECIA_*`.

Prawdziwych odrzuceń było w tym samym oknie **pięć**: dwie pomyłki w haśle,
jedna zła reguła strefy, jedno puste żądanie i jedna próba odłożenia zera
sztuk. Wszystkie utonęły w trzystu pięćdziesięciu wierszach o zdjęciach.

Kolektor pyta o miniaturę KAŻDEGO rysowanego wiersza, więc częstotliwość tych
zapytań bierze się z rysowania ekranu, a nie z pracy człowieka. A brak zdjęcia
jest **odpowiedzią, nie odmową**: nikomu niczego nie odebrano, więc nie ma
czego dochodzić w reklamacji — a to jest jedyny powód, dla którego ten log
istnieje.

Hook `onSend` miał już dokładnie taki wyjątek dla `401` na `GET`, z tym samym
uzasadnieniem („karta odpytuje co 2 s i utopiłaby resztę audytu"). Zdjęcia były
tym samym przypadkiem, tylko nieobjętym regułą.

Lista wyciszonych tras jest wąska i jawna. Wpis wymaga OBU warunków naraz:
częstotliwości rysowania ekranu i normalności odpowiedzi „nie ma". Sam brak
czegoś nie wystarcza — 404 na każdej innej trasie zostaje w audycie, bo tam
znaczy „pytałeś o coś, czego nie ma", a to bywa tropem. Pilnuje tego test:
wycisza zdjęcia, a przy `GET /api/aktualizacja/apk` wymaga wpisu.

Czego to NIE naprawia: kolektor dalej pyta o zdjęcia, których nie ma. Tańsze
byłoby nie pytać, ale to zmiana w aplikacji i nowy APK. Najprostsze wyjście
jest inne — **włączyć `ZDJECIA_*` w `wertis.env`** (`DEPLOY.md` §6), bo funkcja
jest gotowa i czeka wyłącznie na konfigurację.

Cztery testy, serwer ma ich 654.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
usług. Bez nowego APK.

---

## 0.52.2 — 18 sierpnia 2026

**Poprawka: APK nie trafiał tam, skąd instalator go bierze.** Zgłoszenie
z serwera po `-Aktualizuj`: „Nie udalo sie pobrac APK kolektora
(wertis-kolektor-0.52.1.apk)". Serwer działał dalej, kolektory zostały na
swojej wersji — ostrzeżenie zachowało się dokładnie tak, jak miało.

Przyczyna jest po naszej stronie i była w 0.52.0 od pierwszego dnia. Instalator
pobiera plik z `releases/latest/download`, a CI wystawiało go **wyłącznie jako
artefakt Actions**. To dwa różne miejsca: artefakt wygasa po 90 dniach i nie da
się go pobrać bez zalogowania do GitHuba. Producent i odbiorca celowały obok
siebie, więc pobranie nie miało prawa się udać ani razu.

Doszedł krok tworzący **wydanie na każdą wersję** wchodzącą na `main`, z APK
i plikiem sumy kontrolnej. Nie na ręczny tag: serwer aktualizuje się z `main`
i zaraz potem pyta o APK w numerze, który właśnie zbudował. Wydanie robione
ręcznie i z opóźnieniem znaczyłoby okno, w którym plik po prostu nie istnieje.

Skutek uboczny wart wiedzy: `instalator.yml` reaguje na zdarzenie wydania, więc
do tego samego wydania dołączy się instalator Windows. Jedno wydanie na wersję
niesie od teraz oba artefakty.

**Druga przyczyna tego samego objawu, do zrobienia ręką:** bez sekretu
`WERTIS_KEYSTORE_B64` krok wydania jest pomijany z ostrzeżeniem w logu i żaden
podpisany APK nie powstaje. Dopóki sekrety nie są ustawione, wydanie będzie
puste, a instalator dalej wypisze to samo ostrzeżenie — tym razem zgodnie
z prawdą.

**[wymaga działania]** Ustawić cztery sekrety podpisu (`DEPLOY.md` §5), jeśli
jeszcze ich nie ma. Poza tym zwykła aktualizacja serwera. Bez nowego APK —
kod aplikacji się nie zmienił.

---

## 0.52.1 — 18 sierpnia 2026

**Dokumentacja doprowadzona do stanu kodu.** Siedem wydań weszło w krótkim
czasie z DWÓCH gałęzi naraz. Każda opisała swoją pracę u siebie i żadna nie
widziała drugiej, a dwie zmiany były USUNIĘCIAMI. Dokumentacja nie tyle nie
nadążyła, co miejscami zaczęła mówić nieprawdę — a zdanie nieprawdziwe czyta
się jak instrukcję.

Cztery rzeczy kosztowały realnie:

- **Prawa zapisu do bazy firmy podane za wąsko w trzech miejscach.** `DEPLOY.md`
  mówił `GRANT UPDATE` na jedną kolumnę, `porownanie-asystent.md` i `wdrozenie.md`
  — „wyłącznie pole lokalizacji". Od 0.37.0 kolumny są dwie: lokalizacja
  i `tw_PodstKodKresk`. Kto zakładał konto SQL z tych zdań, nadawał za mało
  praw, a nadanie kodu kreskowego padało dopiero na produkcji, w workerze.
- **Lista tras bez sesji krótsza o dwie pozycje.** README i DEPLOY mówiły „poza
  czterema"; w kodzie jest sześć, bo doszły obie trasy aktualizacji kolektora.
  To fakt o bramce sesji, więc rozjazd był tu najgorszy z możliwych.
- **`android/README.md` wskazywał artefakt debugowy** ze zdaniem „do wgrania na
  kolektory to wystarcza". Od 0.52.0 to pułapka: build debugowy dostaje losowy
  klucz przy każdym biegu CI, więc na urządzeniu wyłącza samoaktualizację.
- **`docs/wdrozenie.md` nie znało niczego z 0.52.0** — a to procedura
  wykonywana raz, pod presją, na cudzej maszynie. Dostała sekcję o podpisie
  wydania, jednorazowej reinstalacji floty i zgodzie „nieznane źródła".

Poza tym: `instalator/README.md` nie mówił „APK" ani razu, choć od 0.52.0
`-Aktualizuj` ten plik pobiera; zniknęła martwa rola brygadzisty i dwa
odwołania do blokad pozycji; zestarzałe liczby (18 tabel zamiast 23, 29 typów
zdarzeń zamiast 31, 153 i 92 testy zamiast 650 i 200) zostały policzone
u źródła; słowniczek dostał pojęcia z 0.49–0.52, żeby `styl_check` miał czego
pilnować.

**Bramka zamiast oka.** Lista `REMOVED` w `tools/docs_check.py` dostała byty
wycięte w 0.47.0. Od teraz dokument, który je nazwie, wywala bramkę — ta sama
sztuczka, dzięki której po sesjach rozkładania z 0.22.0 nie został w dokumentach ślad.

**Dług wypisany jawnie.** Dziesięć obszarów nie ma ani jednego scenariusza
testowego: korekta ilości, notatki biura, zakończenie dostawy, domknięcie poza
WERTIS, aktualizacja kolektora, nadanie kodu kreskowego, zbiórki i strefa
złota, zakładka ANALIZA, jednostka miary, zdjęcia kartotek. Każdy wymaga pary —
wpisu w katalogu `seed-scenariusze.ts` i opisu w `docs/scenariusze-testowe.md`
— bo test wymusza zgodność w obie strony. Świadomie zostawione na osobną
decyzję, żeby nie mieszać przeglądu dokumentacji z dopisywaniem danych
testowych.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
usług. Bez nowego APK — kod aplikacji się nie zmienił.

---

## 0.52.0 — 18 sierpnia 2026

**Kolektor aktualizuje się sam, z serwera WERTIS.** Do tej wersji nowy APK
wgrywał człowiek: zalogowanie do GitHuba, pobranie artefaktu z CI i obejście
wszystkich kolektorów przez MDM albo `adb install`. Jedynym sygnałem, że trzeba
to zrobić, był bursztynowy pasek „wersje różne" na dole ekranu — mówiący
o problemie i nieoferujący z niego żadnego wyjścia.

Teraz plik leży na serwerze w sieci magazynu, w `server/data/apk/`, a kolektor
pyta o niego **przy otwarciu aplikacji**. Kolektor nigdy nie wychodzi do
internetu; plik przynosi instalator przy `-Aktualizuj`, razem z aktualizacją
serwera. Nieudane pobranie APK nie przerywa aktualizacji serwera — kolektory
zostają wtedy tam, gdzie były przed tą wersją.

**Pytanie pada przy otwarciu, nie w Ustawieniach.** Ustawienia wiszą pod paskiem
górnym, a paska nie ma przed zalogowaniem, więc przycisk tam byłby pułapką dla
kogoś, kogo aplikacja właśnie nie wpuszcza. Z tego samego powodu obie trasy
aktualizacji działają bez sesji: urządzenie z zepsutą aplikacją da się naprawić
bez logowania się do niej. Cena jest jawna i zapisana przy trasie — do APK nie
wolno od teraz wbudować niczego tajnego.

Sam ekran startowy też by nie wystarczył. Przy żywej sesji Splash schodzi z drogi
od razu, a sesje nie wygasają od 0.20.0 — karta byłaby więc niewidoczna dokładnie
dla tych, którzy pracują na kolektorze codziennie. Dlatego pytanie żyje o piętro
wyżej, w `AppRoot`, i widzą je obie drogi.

Pasek wersji na dole przestał być tylko napisem: dotknięcie pyta serwer od razu.

**Kolejność kroków jest częścią projektu.** Zgody Androida na instalację pytamy
PRZED pobraniem, a nie po nim — kazać człowiekowi czekać na kilkanaście
megabajtów, żeby potem powiedzieć „system i tak nie pozwoli", to najgorsza
możliwa kolejność. Plik jedzie do pamięci trwałej, nie do cache'u, który system
czyści właśnie przy braku miejsca. Suma SHA-256 liczy się w trakcie strumienia,
a właściwą nazwę plik dostaje dopiero po jej sprawdzeniu, więc pobranie ucięte
w połowie nigdy nie wygląda na gotowe do instalacji.

Aktualizacja niczego nie kasuje: bufor offline, adres serwera i lista ostatnio
skanowanych zostają na miejscu. Nie blokuje też pracy — kartę da się zamknąć,
a logowanie pod spodem działa przez cały czas.

**Podpis wydania.** Android odmawia instalacji aktualizacji podpisanej innym
kluczem niż zainstalowana aplikacja, a repo nie miało dotąd żadnej konfiguracji
podpisu: CI budowało wariant debugowy, któremu runner GitHuba generuje losowy
klucz przy każdym biegu. Dwa kolejne artefakty z CI miały więc dwa różne podpisy
i żaden nie instalował się nad poprzednim. Bez tej zmiany reszta funkcji nie
zadziałałaby ani razu.

Klucz nie leży w repo — wchodzi zmiennymi środowiskowymi albo z pliku poza
gitem. Skrót „wrzućmy stały keystore debugowy do repo" został odrzucony
świadomie: od tej wersji podpis jest jedyną rzeczą odróżniającą aktualizację
WERTIS od dowolnego APK podanego kolektorowi z sieci magazynu, a klucz w repo
ma każdy, kto ma dostęp do kodu.

**R8 wyłączony dla wydania.** Reguły `proguard-rules.pro` nie przeszły nigdy
żadnego builda wydania, a Retrofit i kotlinx.serialization łamią się po
minifikacji dopiero w czasie działania. Plik, którego nikt nie uruchomił, jedzie
teraz sam na całą halę — więc do czasu sprawdzenia zminifikowanego wydania na
fizycznym kolektorze APK zostaje pełny. Rozmiar nie jest tu ceną: plik idzie po
sieci magazynu, nie przez sklep.

Trzynaście testów serwera i trzynaście w `:core`; razem serwer ma 650, `:core` 200.

**[wymaga działania]** Trzy rzeczy, po kolei:

1. Wygeneruj keystore i dodaj sekrety `WERTIS_KEYSTORE_B64`,
   `WERTIS_KEYSTORE_HASLO`, `WERTIS_KLUCZ_ALIAS`, `WERTIS_KLUCZ_HASLO`
   w ustawieniach repozytorium. Instrukcja: `DEPLOY.md` §5.
2. **Jednorazowo odinstaluj i zainstaluj aplikację na każdym kolektorze.**
   Zmiana podpisu sprawia, że aktualizacja po wierzchu nie przejdzie, a
   odinstalowanie kasuje dane lokalne urządzenia: adres serwera, listę ostatnio
   skanowanych i **bufor offline**. Rób to po zmianie i przed odinstalowaniem
   sprawdź na każdym urządzeniu, że bufor nie ma nic do wysłania.
3. Na kolektorze zezwól WERTIS na „Instalowanie nieznanych aplikacji" — aplikacja
   sama o to poprosi. Gdy MDM tego zabrania, aktualizacje idą dalej przez MDM
   i kolektor powie to wprost.

Serwer zwyczajnie: `git pull`, `npm ci`, `npm run build`, restart usług. Każda
kolejna aktualizacja kolektora wchodzi już po wierzchu i niczego nie kasuje.

---

## 0.51.0 — 17 sierpnia 2026

**Jednostka miary mówi prawdę — i milczy, gdy nie ma czego opisywać.** Dwie
strony tej samej sprawy, znalezione razem.

**[wymaga działania]** Nowy APK przez MDM. Serwer: zwykła aktualizacja
i restart; starsze APK działają dalej.

### Zniknęła tam, gdzie nie opisywała żadnej liczby

Linia EAN-u na karcie towaru pokazuje sam kod kreskowy: `EAN 5905947596430`
zamiast `EAN 5905947596430 · szt.`. Jednostka stała tuż pod wielką liczbą
dostępnych, która i tak podpisuje się „szt. dostępne" — mówiła więc to samo dwa
razy, w linii mającej jedno zadanie: podać kod albo drogę do jego nadania.
Kartoteka bez kodu ma dalej myślnik i wejście „✎ NADAJ KOD".

To samo na ekranie skanu lokalizacji, w rzędzie „symbol · EAN · jednostka".
Tamten ekran nie pokazuje ani jednej ilości, więc jednostka nie miała tam nawet
czego opisywać.

### Stała się prawdziwa tam, gdzie liczbę podpisuje

Cała ścieżka rozkładania dostawy pisała „szt" wpisane w kolektorze na sztywno,
bo serwer jednostki nie wysyłał. W kartotece 18 pozycji na 3415 mierzy się
inaczej — sześć w kompletach, sześć w parach. Dla nich „3 szt" na liście
znaczyło trzy sztuki tam, gdzie na dokumencie stały trzy KOMPLETY, czyli
trzydzieści sześć sztuk towaru. Karta towaru mówiła wtedy „kpl.", a lista
dostawy „szt" — o tym samym towarze.

Serwer wysyła teraz jednostkę wszystkimi czterema drogami, którymi ilość trafia
na ekran: lista pozycji, odpowiedź na skan, podsumowanie zamknięcia i lista
wyjątków. Kolektor przestał zgadywać w dwunastu miejscach, a reguła zapasowa
(„kartoteka nie ma jednostki → «szt.»") mieszka w jednym miejscu w `:core`
zamiast w każdym z nich osobno. Przy okazji zniknął rozjazd pisowni: `szt.`
z kropką wszędzie, tak jak w Subiekcie.

Pola są **addytywne** — starsze APK ignorują je i pokazują to co dotąd, a nowy
kolektor podłączony do starszego serwera podstawia „szt." zamiast pustki.

---

## 0.50.0 — 15 sierpnia 2026

**Strefa złota z danych o zbiórkach.** Biuro wgrywa eksport zbiórek
z Sellasist (CSV) w zakładce ANALIZA. Serwer liczy z niego, które towary są
w górnych 15% rotacji, a stoją poza strefą złotą — i dokłada im adnotację na
karcie w kolektorze: „Zbierany 12×/dzień — przenieś do strefy złotej (poziom
2 albo 3)". Do tego lista kandydatów w panelu biura z eksportem CSV oraz
edytor reguł strefy (które poziomy którego regału są „złote").

**[wymaga działania]** Nowy APK przez MDM (adnotacja na karcie towaru).
Serwer: zwykła aktualizacja i restart. Pierwsze użycie to wgranie pliku CSV
z Sellasist w `/biuro` → ANALIZA → „WGRAJ CSV ZBIÓREK" — bez pliku funkcja
po prostu milczy.

### Jak to działa

- Import jest **idempotentny**: kluczem jest `ID Koszyka` z eksportu, więc
  ponowne wgranie tego samego okresu (albo nakładających się) niczego nie
  dubluje. Plik, w którym do kartoteki dopasowało się mniej niż połowa
  wierszy, jest odrzucany w całości — z przykładami niedopasowanych symboli.
- Próg „szybkiej rotacji" to ta sama reguła co w rocznym raporcie
  przeslotowania (górne 15% liczby pobrań), więc obie ścieżki nigdy nie
  wskażą sprzecznych list. Okno to ostatnie 30 dni **obecne w danych**,
  nie kalendarzowe — adnotacje nie znikają, gdy plik wgrano z opóźnieniem.
- Reguły strefy złotej przeniosły się ze stałej w kodzie do bazy i są
  edytowalne z biura (rola `biuro`/`admin`). Dotychczasowa definicja
  (zapis właściciela) została ziarnem — wsiewa się przy pierwszej migracji.
  Regał bez reguły dalej znaczy „nie wiem", nie „poza strefą".
- Towar **przeniesiony** traci adnotację sam: liczy się ona z żywej
  lokalizacji, więc znika po zapisaniu nowego adresu kolektorem.
- Import ma być w przyszłości wołany automatycznie z Sellasist — trasa to
  zwykły `POST /api/biuro/zbiorki/import` z JSON-em `{ csv }`, integracja
  użyje jej bez zmian po naszej stronie.

---

## 0.49.0 — 15 sierpnia 2026

**Podmiana kodu kreskowego bez osobnego potwierdzenia.** Nadanie i zmiana idą
jednym zatwierdzeniem — decyzja właściciela.

**[wymaga działania]** Nowy APK przez MDM (arkusz kodu jest w kolektorze).
Serwer: zwykła aktualizacja i restart; starsze APK działają dalej, bo flaga
potwierdzenia jest nadal przyjmowana — po prostu już niczego nie bramkuje.

### Co się zmienia, a co świadomie zostaje

Do tej pory kartoteka z kodem dostawała przy zmianie osobny krok „Podmiana
wymaga potwierdzenia" — po stronie serwera i w arkuszu kolektora. Oba wymogi
są zdjęte: zapis idzie od razu.

Trzy rzeczy zostają i to jest granica tej zmiany:

- **Kod zajęty przez inną kartotekę to nadal twarda odmowa.** Tego nie dało
  się i nie da przejść żadnym potwierdzeniem — dwa towary z jednym kodem
  zatrzymują pracę w alejce, a próba zapisuje się do rejestru kolizji.
- **Arkusz nadal pokazuje „STARY → NOWY"** z ostrzeżeniem, że kartony ze
  starym kodem przestaną się skanować. Informacja zostaje; zniknęło tylko
  dopytywanie.
- **Stary kod jedzie do audytu** w każdym zapisie (`eanPrzed`) — gdyby trzeba
  było wrócić, widać dokładnie, co stało na kartotece.

Trasa nadania kodu dostała przy okazji własne testy — istniała od 0.37.0 bez
żadnego, więc zmiana zachowania byłaby niewidzialna dla CI w obie strony.

## 0.48.0 — 15 sierpnia 2026

**Zakładka ANALIZA w podglądzie biura.** Ślad audytowy zbierał wszystko od
pierwszego dnia, ale nic go nie liczyło — teraz odpowiada na cztery pytania:
kto ile robi i kiedy jest szczyt, czy magazyn nadąża, czego ludzie szukają
i nie znajdują, który kolektor się sypie. Do tego eksport CSV.

**[wymaga działania]** Restart `wertis-api` po aktualizacji, bez nowego APK.
**Zanim raport per osoba zostanie użyty do czegokolwiek kadrowego**: zapis
w regulaminie pracy albo obwieszczeniu i uprzedzenie załogi co najmniej
2 tygodnie wcześniej (Kodeks pracy art. 22² i nast.). To obowiązek formalny
pracodawcy — panel pokazuje podstawę prawną nad tabelą i w pliku CSV.

### Odwrócona decyzja: wydajność per osoba wchodzi na ekran

Od 0.27.0 raport wydajności istniał na serwerze, ale strona biura celowo go
nie odpytywała — pilnował tego test. Powód był formalny: monitoring
pracowniczy wymaga poinformowania załogi, a przycisk obok metryk robiłby
z tego obowiązku przypadek.

Właściciel, uprzedzony o konsekwencjach, zdecydował inaczej — raport jest
teraz na zakładce ANALIZA. Test strażnika został przepisany na odwrotny:
pilnuje, żeby sekcja imienna nigdy nie pojawiła się BEZ podstawy prawnej
i bez zdania, że zgłoszone problemy nie są miarą błędu. Trzy reguły raportu
nie drgnęły: zgłoszenie wyjątku to nie wpadka, kolumny błędów nie ma, tempo
z małej próbki pokazuje się jako „mało danych" zamiast liczby.

### Co liczy analiza

Operacje per dzień i rozkład po godzinach — z reguł wspólnych dla wszystkich
raportów: podwójne zdarzenia jednej czynności odsiane, dni bucketowane po
zegarze magazynu, nie po dobie UTC. Zdarzenie z 23:30 UTC to następny dzień
polski i na osi ląduje we właściwym.

Rytm dostaw liczy się z tabel operacyjnych, nie ze zdarzeń: dostawy
zamknięte, mediana czasu od otwarcia do zamknięcia, pozycje na dostawę,
problemy zgłoszone i rozwiązane w oknie oraz otwarte w ogóle.

Wyszukiwarka zaczęła zapisywać liczbę wyników przy każdym zapytaniu, więc
lista „szukane bez wyniku" pokazuje towary, których ludzie szukają, a których
kartoteka nie zna — najtańsza lista braków. Zdarzenia sprzed tej wersji nie
niosą liczby wyników i do listy braków nie wchodzą; potraktowane jako zero
zamieniłyby całą historię w fałszywe braki.

Zdrowie sprzętu grupuje po urządzeniu, nie po osobie: upadki, niskie baterie
i operacje z bufora odrzucone przez serwer — per kolektor.

Trasa `/api/analiza` ma bramkę jak ślad audytowy (biuro i admin), bo niesie
dane imienne — magazynier nie czyta zestawień o kolegach. Eksport CSV
zostawia ślad `analiza_eksport`: kto pobiera zestawienia o ludziach, sam
trafia do logu.

## 0.47.0 — 15 sierpnia 2026

**Rola brygadzisty i blokady pozycji wychodzą z systemu.** Zgłoszenie
z magazynu: specyfika pracy w firmie sprawia, że jedno i drugie jest zbędne.

Blokada per pozycja miała chronić przed dwukrotnym odłożeniem tego samego
towaru, gdy jedną dostawę rozkłada kilka osób. Tutaj rozkłada ją jedna, więc
lock nie rozstrzygał żadnego realnego sporu — a kosztował: wiszące „pozycję
rozkłada Jan" po kolektorze odłożonym na koniec zmiany, trzydziestominutowe
czekanie na TTL i całą ścieżkę odbierania cudzej pracy z dialogiem
potwierdzenia.

Rola brygadzisty istniała głównie po to, żeby ktoś mógł taką pozycję odebrać.
Bez blokad nie ma czego odbierać, a rola bez ani jednego uprawnienia jest gorsza
niż jej brak: widać ją w kreatorze kont, więc obiecuje coś, czego nie robi.
Zostają trzy role — magazynier, biuro, administrator.

**Cena jest jawna.** Dwie osoby przy jednym kartonie mogą odłożyć tę samą
pozycję dwa razy i licznik pokaże za dużo. Widać to na liście („odłożono 8 z 5")
i poprawia się przyciskiem POPRAW ILOŚĆ z 0.46.0, bez niczyjej zgody.

<!-- docs_check: historia -->
Co znika: `services/locks.ts` z TTL, kolumny `locked_by` i `locked_at`,
odpowiedź skanu `kind: locked`, trasy `/release` i `/force-release`, operacja
`zdjecie_cudzego_locka`, zdarzenie `lock_forced` i pastylka „w rękach: X"
w podglądzie biura. Ślad audytowy schodzi do biura i admina — hala czytała go
przez rolę, której już nie ma, a jest to pytanie zadawane przy biurku.

**Konta zostają, zmienia się wyłącznie rola.** Migracja przy starcie serwera
przestawia każde konto `brygadzista` na `magazynier`. Kasowanie kont zabrałoby
audytowi wskazanie, a odebranie hasła zabrałoby ludziom dostęp do pracy, którą
i tak wykonują.

Historyczne wpisy `lock_forced` w `events` **zostają** — historii się nie
przepisuje. Kolumny `locked_by` i `locked_at` zostają w istniejących bazach jako
martwe, tak samo jak `sfera_queue.session_id` po 0.22.0: przebudowa tabeli
trzymanej otwartą przez workera kosztowałaby bez żadnego zysku.

Serwer ma 583 testy, `:core` 183.

**[wymaga działania]** Nowy APK — kolektor nie ma już wariantu odpowiedzi
`locked` i pokazuje trzy role w kreatorze kont. Serwer zwyczajnie: `git pull`,
`npm ci`, `npm run build`, restart usług; migracja roli wykonuje się sama.

---

## 0.46.0 — 15 sierpnia 2026

**Korekta ilości odłożonej — przycisk w kolektorze.** Trasa powstała
w 0.45.0 i nie miała skąd być wywołana. Teraz w rozwiniętej pozycji, pod
„INNĄ ILOŚCIĄ", stoi **POPRAW ILOŚĆ (N)** — z liczbą, którą system ma dziś
zapisaną, żeby nie trzeba było jej szukać wzrokiem gdzie indziej.

Arkusz pyta o liczbę **całkowitą**, nie o różnicę: przy palecie przelicza się
sztuki na półce, a nie własną pomyłkę sprzed kwadransa. Suwak idzie od zera do
ilości z dokumentu i startuje od stanu obecnego, minusem i plusem po 48 dp —
klawiatura numeryczna w rękawicy to trzy pomyłki na dziesięć wpisów.

Arkusz mówi wprost, co się stanie po zapisie: pozycja zostanie odłożona
w całości, wróci jako częściowa albo jako nieodłożona. Skok „odłożone → do
zrobienia" bez uprzedzenia wygląda z hali jak skasowana praca. Drugie zdanie
pilnuje granicy, na której stoi cała ta funkcja: adres zostaje bez zmian,
a poprawka jest liczeniem w WERTIS, nie zgłoszeniem do dostawcy — do niego
braki jadą dopiero z „ZAKOŃCZ DOSTAWĘ".

Przycisku nie ma tam, gdzie serwer i tak odmówi: przy pozycji bez ani jednej
odłożonej sztuki (drogą jest zwykłe odłożenie) i przy zgłoszonym wyjątku.
Po zapisie pozycja jest zwalniana — korekta kończy pracę na niej tak samo jak
odłożenie.

Arkusz stoi **na poziomie ekranu**, nie w środku cudzego `?.let`. To reguła
kupiona usterką z 0.44.1, która zabrała widoczność dwóm arkuszom naraz przy
poprawnie kompilującym się kodzie.

**[wymaga działania]** Nowy APK — zmiana jest w kolektorze. Serwer wystarczy
zaktualizować zwyczajnie (`git pull`, restart usług); trasa działa od 0.45.0.

---

## 0.45.0 — 14 sierpnia 2026

**Korekta ilości odłożonej — serwer.** Rozkładający pomyli się w liczeniu
i chce poprawić, zanim zamknie fakturę. Do tej wersji nie było na to drogi: skan
półki wyłącznie DODAJE sztuki, a jedynym sposobem cofnięcia było zgłoszenie
wyjątku — czyli wpis do protokołu rozbieżności, dokumentu idącego do dostawcy.
Pomyłka w liczeniu zamieniała się w reklamację.

Korekta ustawia wartość **bezwzględną**, nie różnicę: człowiek przy palecie wie,
ile naprawdę odłożył, a nie o ile się pomylił. Status przelicza się z liczby,
więc poprawka w dół otwiera pozycję z powrotem do dokończenia, a w górę potrafi
domknąć ją razem z całą dostawą.

Czego korekta **nie robi**, i to jest jej cała lekkość: nie tworzy zadania
w kolejce Sfery, nie kasuje zapisanego adresu (nawet przy korekcie do zera —
adres naprawdę pojechał do Subiekta) i nie tworzy wyjątku. `ilosc_odlozona` to
licznik postępu po stronie WERTIS, więc poprawka jest lokalna.

Dwie rzeczy zostają nietykalne. Pozycja ze **zgłoszonym wyjątkiem** — wyjątek
jest twierdzeniem wobec dostawcy i żyje w protokole, więc ciche przestawienie
pod nim liczby zmieniałoby dokument, którego ta operacja nie widzi. I **dostawa
już zamknięta** — „przed zakończeniem faktury" było częścią zgłoszenia.

Bez bramki roli: to poprawianie własnej pomyłki, nie orzeczenie o czymkolwiek.
Obie liczby idą do `events` z nazwiskiem.

Trzynaście testów, serwer ma ich 590.

**[wymaga działania]** `git pull` i restart usług. **Kolektor nie ma jeszcze
przycisku korekty** — trasa istnieje i jest przetestowana, ekran dojdzie
w następnej wersji.

---

## 0.44.1 — 14 sierpnia 2026

**Dotknięcie notatki nie robiło nic — i to samo dotyczyło „ZAKOŃCZ DOSTAWĘ".**
Zgłoszenie z magazynu dotyczyło notatki; drugiej usterki nikt jeszcze nie
zdążył zauważyć, bo siedziała w tym samym miejscu.

Oba arkusze — odpowiedzi na notatkę (0.43.0) i zakończenia dostawy (0.42.0) —
wylądowały **wewnątrz** bloku `przesunFor?.let { … }`, czyli w gałęzi, która
rysuje arkusz przesunięcia stanu. Rysowały się więc wyłącznie wtedy, gdy
otwarte było przesunięcie — czyli praktycznie nigdy. Dotknięcie notatki
ustawiało stan i na tym się kończyło.

Kod był przy tym **poprawną Kotlinem** i miał zbilansowane nawiasy, więc nie
złapał go ani kompilator, ani `kt_imports_check.py`, ani bramka `build` na CI.
Zagnieżdżenie jednego `?.let` w drugim jest legalne; złe jest tylko to, co
z niego wynika na ekranie.

Oba arkusze wróciły na poziom ekranu, obok pozostałych.

**Faktura z kompletem zeskanowanych pozycji świeciła na zielono**, choć nikt
jej nie zamknął — drugie zgłoszenie z magazynu, i to następstwo notatek.

Do 0.43.0 komplet rozstrzygniętych pozycji ZNACZYŁ ukończenie, bo dostawa
zamykała się sama w tej samej sekundzie; równość była prawdziwa. Notatka bez
odpowiedzi ją zerwała: pozycje zrobione, faktura otwarta — i lista mówiła
„zrobione" o czymś, co czeka na człowieka.

Doszedł więc czwarty stan: **DO ZAMKNIĘCIA**. Bursztynowy jak „w toku", bo tak
samo czeka, z osobną etykietą na wierszu — bez niej człowiek wchodzi w dostawę,
widzi same odhaczone pozycje i wychodzi. Zielony zostaje wyłącznie dla dostawy
naprawdę zamkniętej (`status = done`). W kolejności listy stoi zaraz za pracą
zaczętą: jeden ruch od końca.

Jedna nazwa na dwie przyczyny — czeka notatka albo nikt nie nacisnął ZAKOŃCZ —
bo czynność jest ta sama: wejdź i dokończ.

**[wymaga działania]** Nic po stronie serwera — obie poprawki są wyłącznie
w kolektorze i wchodzą z **nowym APK**. Do tego czasu na notatkę nie da się
odpowiedzieć, więc dostawa z notatką się nie domknie.

---

## 0.44.0 — 14 sierpnia 2026

**Instalator dostaje tryb samej aktualizacji: `-Aktualizuj`.** Zatrzymuje
usługi, pobiera nową wersję, buduje i uruchamia z powrotem. Nie zadaje ani
jednego pytania.

Pełny przebieg instalatora też aktualizuje kod, ale robi przy tym jeszcze
siedem innych rzeczy: pyta o Subiekta, przelicza magazyny, sprawdza pole
lokalizacji, zakłada konto SQL, nadaje GRANT-y, przepisuje `wertis.env` i pyta
o konto administratora. Na działającej instalacji to jest siedem okazji do
zmiany czegoś, co działa — i siedem pytań do człowieka, który chciał tylko
wgrać nową wersję.

Czego ten tryb **nie dotyka**, wprost: bazy aplikacji (`server\data`), konta
SQL ani GRANT-ów, `wertis.env`, konfiguracji Subiekta, kont użytkowników,
reguły zapory i rejestracji usług w NSSM. Wszystko to już istnieje —
instalacja, której się nie stawia od nowa, nie potrzebuje niczego z tej listy.

Dwie decyzje warte zapisania. Usługi stoją przez **cały** czas budowania, a nie
tylko przy podmianie plików: `npm ci` kasuje `node_modules`, więc działający
worker traciłby moduły w locie — a objawem byłby proces, który padł „bez
powodu" w połowie aktualizacji. I dwie różne reakcje na błąd: po nieudanym
`git pull` usługi **wracają** na poprzedniej wersji (magazyn nie ma stać przez
nieudaną próbę), a po nieudanym budowaniu zostają **zatrzymane celowo**, bo
stary `dist` z nową bazą mieszałby dwie wersje.

**Wyszukiwarka w liście dostaw.** Filtruje po numerze faktury i po dostawcy.
Przy oknie trzydziestu dni lista ma kilkadziesiąt pozycji, a biuro dzwoni
z konkretnym numerem — przewijanie kciukiem w rękawicy jest wtedy najgorszą
możliwą odpowiedzią. Kolejność (do dokończenia → nowe → ukończone) liczy się po
odsianiu, więc wynik szukania zachowuje ten sam porządek co pełna lista.

Trzynaście nowych testów instalatora; pilnują głównie **nieobecności** — tego,
czego gałąź aktualizacji nie wywołuje. Dopisanie tam jednej linii ruszającej
konto SQL albo `wertis.env` nie wywraca niczego przy uruchomieniu i wyszłoby
dopiero na produkcji.

**[wymaga działania]** Nic — nowy tryb jest dodatkiem. Od następnej wersji
aktualizacja serwera to jeden wiersz, uruchomiony jako administrator:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj
```

---

## 0.43.0 — 14 sierpnia 2026

**Biuro może zostawić notatkę do dostawy, a rozkładający musi na nią
odpowiedzieć.** Dostawca dosyła czasem brak, którego nie ma na fakturze. Biuro
wie o tym z rozmowy albo z maila; człowiek przy palecie nie ma tego skąd
wiedzieć i musi sprawdzić, czy rzeczywiście dosłali. Do 0.43.0 jedyną drogą
było „powiedz Krzyśkowi, jak przyjdzie" — kanał, który gubi się przy zmianie
i nie zostawia po sobie ani śladu, ani odpowiedzi.

Notatka wisi na **dokumencie**, nie na lokalnym wierszu dostawy: biuro pisze ją,
zanim ktokolwiek otworzy rozkładanie, więc `delivery` zwykle jeszcze nie
istnieje. Przy okazji przeżywa zamknięcie „poza WERTIS" i jego cofnięcie.

**Odpowiedź jest obowiązkowa** i pilnują jej DWA miejsca, nie jedno. Oczywiste
to przycisk „ZAKOŃCZ DOSTAWĘ" — odmawia i cytuje treść notatki, żeby nie
trzeba jej było szukać. Drugie jest ważniejsze: **samoczynne domknięcie po
odłożeniu ostatniej pozycji**. Bramka pilnowana wyłącznie przy przycisku
obchodziłaby się przez zwykłe rozłożenie towaru, czyli przez najczęstszą
czynność w aplikacji i bez żadnej złej woli.

Na ekranie rozkładania notatka stoi **na górze**, przed podpowiedzią o skanie:
pytanie „czy dosłali trzy sztuki" trzeba przeczytać, zanim się zacznie, bo
odpowiedź bierze się z oglądania palety, a nie z pamięci pół godziny później.
Nieodpowiedziana jest bursztynowa i mówi wprost, że blokuje zamknięcie.

Odpowiedzi **nie da się podmienić**. To ona zdjęła blokadę z dokumentu, więc
zmieniona po fakcie zmieniałaby powód decyzji, która już zapadła — nowe
ustalenie to nowa notatka. Obie strony rozmowy idą do `events`.

Trzynaście nowych testów, serwer ma ich 577.

**[wymaga działania]** `git pull`, `npm run build` i restart usług — tabelę
`delivery_note` zakłada schemat przy starcie. Zmiany w kolektorze wchodzą
z **nowym APK**; do tego czasu notatki widać i pisze się je w `/biuro`, ale
odpowiedzieć nie ma jak, więc nie dodawaj ich przed rozesłaniem APK.

---

## 0.42.0 — 13 sierpnia 2026

**Trzy rzeczy w oknie dostawy: szukanie, częściowe odkładanie i zakończenie.**

**Częściowe odkładanie działało na serwerze od dawna — kolektor go nie używał.**
`putawayLine` przyjmuje ilość i sam nadaje status `partial`, ale skan półki
zawsze zamykał CAŁĄ pozycję. Trzy sztuki z dziesięciu na wierzchu kartonu nie
miały więc uczciwej odpowiedzi: albo odłożenie wszystkich dziesięciu
(nieprawda), albo wyjątek „zła ilość", czyli reklamacja do dostawcy o towarze,
który przyjechał w komplecie. W panelu odkładania są teraz **−** i **+**;
domyślnie idzie cała reszta, bo tak wygląda większość odłożeń. Przy okazji
poprawka w buforze offline: zapisywał `qtyDone = qtyDoc` niezależnie od ilości,
więc reszta partii znikała z listy pracy do czasu odpowiedzi serwera.

**Wyszukiwarka w oknie dostawy.** Filtruje po symbolu i nazwie. Droga
podstawowa to nadal skan — pole jest dla kartonu, którego kod nie chce zejść:
zdarty, zalany, zaklejony taśmą. Filtruje wyłącznie WIDOK: kolejność alejkowa,
sekcja „bez lokalizacji" i liczniki postępu liczą się z pełnej listy, bo „7
z 10" to stan dostawy, a nie stan ekranu.

**„ZAKOŃCZ DOSTAWĘ" — moment, którego nie było.** Dotąd dostawa domykała się
sama, gdy ostatnia pozycja stała się terminalna; praca porzucona w połowie
zostawała otwarta bez końca, a braki ilościowe nie zamieniały się w nic.
Magazynier, który znalazł 7 sztuk z 10, musiał pamiętać o osobnym zgłoszeniu —
jeśli nie pamiętał, różnica ginęła między dokumentem a półką.

Zakończenie robi dwie **świadomie różne** rzeczy:

- pozycja z częściowym odłożeniem → wyjątek **„zła ilość"**. Towar policzono
  i było go mniej: to fakt o dostawie i należy do protokołu rozbieżności;
- pozycja **nietknięta** → `pominięta`, **bez zgłoszenia**. Brak pracy to nie
  brak towaru — nikt tego kartonu nie otworzył, więc twierdzenie wobec dostawcy
  nie miałoby pokrycia. Karta towaru pokazuje ją dalej jako „w dostawie".

Przycisk otwiera najpierw **podsumowanie**: osobno lista idąca do dostawcy,
osobno pomijane, a przycisk potwierdzenia mówi wprost, ile zgłoszeń powstanie.
Zgłoszenie do dostawcy nie ma prawa powstać z przycisku, którego skutku nikt
nie widział.

Jedenaście nowych testów serwera, razem 564.

**[wymaga działania]** `git pull` i restart usług po stronie serwera; zmiany
w kolektorze wchodzą z **nowym APK**.

---

## 0.41.1 — 11 sierpnia 2026

**Baner „Serwer nie odpowiada" kłamał — serwer odpowiadał bez zarzutu.**
Zgłoszenie: baner wisi, choć wszystko działa. I działało: padał wyłącznie
odczyt kolejki Sfery.

Przyczyna nie ma nic wspólnego z siecią. Zadanie `set_ean` doszło po stronie
serwera w 0.37.0 i **nie doszło do enuma `QueueItemType`** w kolektorze. Pole
`type` nie miało wartości domyślnej, więc `coerceInputValues` nie miało czego
podstawić i nieznana wartość rzucała wyjątkiem. Skutek: pierwsze nadanie kodu
kreskowego wkładało do kolejki wiersz, którego kolektor nie umiał odczytać —
i od tej chwili **cała** odpowiedź `/api/queue` padała na deserializacji, co
1,5 sekundy, na każdym ekranie. Trzy porażki z rzędu zapalały baner i już nie
gasł.

Kosztowało to więcej niż jeden pasek na górze. Zamarzła pastylka kolejki,
a ekran KOLEJKA SFERY przestał pokazywać zadania **w błędzie** — czyli jedyne
miejsce, w którym widać, że zapis do Subiekta nie wszedł. Objaw wyglądał
przy tym jak słabe Wi-Fi przy regałach, więc mógł tak wyglądać miesiącami.

Poprawka jest dwuczęściowa i druga część jest ważniejsza:

- `set_ean` dochodzi do enuma pod własną nazwą,
- enum dostaje wartość `INNE`, a pole `type` **wartość domyślną**. Nieznany
  rodzaj zadania ląduje teraz w `INNE` i wiersz rysuje się normalnie —
  z `label` i `detail` od serwera — zamiast wywracać ekran. Rodzaj zadania
  dodany kiedyś po stronie serwera nie zabierze już ze sobą całej kolejki,
  a zadanie w błędzie zostanie widoczne razem z przyciskiem PONÓW.

Dwa nowe testy w `:core`: `set_ean` parsuje się pod swoją nazwą, a wiersz
o rodzaju z przyszłości nie zabiera ze sobą reszty listy. Razem 180.

**[wymaga działania]** Nic po stronie serwera — usterka była wyłącznie
w kolektorze i poprawka wchodzi z **nowym APK**. Do tego czasu obejście: baner
gaśnie sam, gdy w odpowiedzi `/api/queue` nie ma wiersza `set_ean` (czyli po
zejściu takich zadań z pierwszej setki), ale liczyć na to nie ma sensu.

---

## 0.41.0 — 11 sierpnia 2026

**Przycisk „ZMIEŃ LOKALIZACJĘ" znika z karty towaru.** Prowadził na ekran
skanu, który po zeskanowaniu półki robił dokładnie to samo, co ten sam skan
przy otwartej karcie: przy jednym adresie zastępował, przy kilku otwierał ten
sam arkusz. Duplikat, i to najgorszego rodzaju — bo był **największym
elementem karty**, choć ZASTĄP kasuje istniejący adres, a bezpieczne „+ DODAJ"
stoi wyżej jako mały chip. Waga na ekranie była odwrotna do ceny pomyłki.

Zostają dwie drogi do adresu i różnią się gestem, nie sąsiadującym przyciskiem:
**skan półki przy otwartej karcie** przenosi towar, **„+ DODAJ"** dokłada
kolejny adres.

Razem z przyciskiem wyszedł tryb zastępowania z ekranu skanu — nie miał już ani
jednego wołającego. Ekran ma teraz jedno znaczenie, więc znika stamtąd też
arkusz ZASTĄP/DODAJ (pytanie bez drugiej opcji) i nadpisywanie tytułu w pasku
górnym; pasek mówi „DODANIE LOKALIZACJI" na każdej drodze. Arkusz żyje dalej na
karcie towaru, gdzie skan przy kilku adresach jest realną decyzją.

**Cena tej zmiany, wprost:** ręczny wpis adresu przy PRZEPROWADZCE zniknął
razem z ekranem w trybie zastępowania. Przy zdartej etykiecie przeprowadzka to
teraz dwa kroki — „+ DODAJ" z wpisem ręcznym, potem USUŃ na starym chipie.
Skan półki działa jak dotąd, jednym gestem.

**Pastylka „+ DODAJ ADRES" ma tę samą bryłę co pastylka z adresem.** Obie stoją
w tym samym miejscu nagłówka i są tą samą rzeczą w dwóch stanach, a różniły się
cieniem i wysokością — karta towaru bez adresu wyglądała przez to jak inny
ekran, nie jak ta sama karta z pustym polem. Wysokość 52 dp, cień 3 dp, obrys
1,5 dp i wypełnienie przepisane wprost z `LocChip`. Napis został o dwa punkty
mniejszy od kodu adresu i to jedyna rozmyślna różnica: „+ DODAJ ADRES" ma
trzynaście znaków wobec dziewięciu w `A01-02-03` i przy pełnym rozmiarze
zjadłby wielokropek.

**[wymaga działania]** Nic po stronie serwera — to zmiana wyłącznie
w kolektorze i wchodzi z **nowym APK**.

---

## 0.40.0 — 11 sierpnia 2026

**Dostawę rozłożoną poza WERTIS można wreszcie zdjąć z listy.** Zgłoszenie
z magazynu: dostawy rozłożone starą aplikacją stoją w zakładce rozkładania
jako nietknięte, a karta towaru mówi „w dostawie, nierozłożone" o towarze,
który leży w regale.

Przyczyna jest w sposobie liczenia: postęp bierze się z `delivery_line`, więc
dokument, którego WERTIS nigdy nie widział, ma zero odłożone i całą ilość
zaległą. Sam z siebie nie wyzeruje się nigdy.

Gorzej — nie było z tego wyjścia. Dokument raz otwarty w WERTIS zostaje na
liście niezależnie od wieku (celowy wyjątek w imporcie: skrócenie okna nie ma
kasować niedokończonej pracy), a domyka się dopiero, gdy każda pozycja jest
odłożona, pominięta albo zgłoszona jako wyjątek. Towar już leży na półkach,
więc nikt tych pozycji nie zeskanuje. Jedyną drogą było zgłoszenie WYJĄTKU na
każdej z nich, czyli wpisanie fikcyjnych niezgodności do protokołów
rozbieżności — dokumentu księgowego. Narzędzie do sprzątania nie ma prawa
fałszować dowodów.

**Biuro dostaje przycisk „ROZŁOŻONE POZA WERTIS"** w panelu dokumentu, z polem
na powód. Dostawa znika z listy rozkładania i z linii „w dostawie" na karcie
towaru. Zamknięcie **nie udaje odłożenia**: nie dopisuje ani jednej pozycji,
nie zapisuje żadnego adresu, nie rusza Subiekta. Zamknięte leżą w osobnej
karcie z nazwiskiem, datą i powodem i wracają na listę jednym kliknięciem —
dostawa bez zapisanych pozycji wraca jako nietknięta, dostawa porzucona
w połowie wraca ze swoim postępem.

Status w bazie to `external`, a nie `done`, i to jest sedno. `done` znaczy
„ludzie odłożyli to tutaj i mamy z tego skany"; o takiej dostawie powiedzieć
się tego nie da. Jedna wartość na oba stany kazałaby czytać raporty odłożeń
jako pracę, której nikt nie wykonał.

Operacja jest zastrzeżona dla roli **`biuro`** i dostępna wyłącznie z `/biuro`
— nigdy z kolektora. Brygadzisty tu nie ma świadomie, choć zdejmuje cudze
locki: tamto przekłada pracę z rąk do rąk i zostaje na hali, a to orzeka, że
pracy nie ma. Skan nie wskrzesza zamkniętej dostawy po cichu — droga powrotna
prowadzi przez biuro.

Strona `/biuro` przestała tym samym być czystym odczytem, którym była od
0.18.0. Reguła nie zniknęła, tylko dostała jawną listę: test pilnuje, że
zapisy strony to dokładnie trzy rzeczy — logowanie, zamknięcie i cofnięcie.

**[wymaga działania]** Nic ponad `git pull` i restart usług. Kolumny `closed_by`
i `powod_zamkniecia` dokłada migracja przy starcie. **Nowy APK nie jest
potrzebny**: dokumenty odsiewa serwer, więc kolektor, który magazynierzy mają
dziś w rękach, przestanie je pokazywać od razu po restarcie.

---

## 0.39.1 — 11 sierpnia 2026

**„Ostatnio skanowane" pokazywało adres sprzed relokacji.** Zgłoszenie
z magazynu: wyszukać towar na ekranie głównym, wejść na kartę, zeskanować
półkę, wrócić — i pod „Ostatnio skanowane" stoi stary adres. Karta mówiła
jedno, ekran główny drugie, a nic na ekranie nie tłumaczyło, które jest
prawdą.

Lista jest migawką: wpis powstawał przy otwarciu karty i zapisywał adres
z tamtej chwili, po czym nigdy się nie odświeżał. Zły adres dożywał tak do
czterech kolejnych otwarć kart, bo dopiero piąte wypychało wpis z listy.

Teraz karta towaru odświeża swój wpis, gdy zmieni się adres albo nazwa.
Wpis idzie **za pastylką nagłówka** — za tym, co magazynier właśnie widział
— więc adres w drodze do Subiekta liczy się tak samo w obu miejscach.
Odświeżenie nie przestawia kolejności listy (kolejność mówi „co trzymałem
w ręku") i nie dopisuje towarów, których na liście nie ma.

Przy okazji: **dotknięcie pozycji listy gubiło jej nazwę.** Otwarcie karty
z „Ostatnio skanowane" zapisywało wpis bez pola `name`, więc towar, który
przed chwilą miał pod symbolem nazwę, zostawał już tylko z symbolem.

Reguły listy przeniesione do `:core` (`core/recent/OstatnioSkanowane.kt`)
razem z etykietą „brak lokalizacji", która stała wpisana z ręki w czterech
miejscach. Dziewięć nowych testów; `:core` ma ich 178.

**[wymaga działania]** Nic po stronie serwera — to zmiana wyłącznie
w kolektorze i wchodzi z **nowym APK**.

---

## 0.39.0 — 10 sierpnia 2026

**Linia „W dostawie" mówi też, od kogo ta dostawa jest.** Wiersz na karcie
towaru wygląda teraz tak: „W dostawie 6 szt — FZ 214/07/2026 · OGRÓD-POL ·
w toku".

Linia odpowiada na pytanie „stan mówi 12, a półka pusta — gdzie to jest?", więc
ma prowadzić do palety. Numer dokumentu tego nie robi: identyfikuje dostawę
w Subiekcie, ale w strefie przyjęć nie jest napisany nigdzie. Na palecie i na
kartonach widać dostawcę — i to jego magazynier czyta, szukając. Dotąd musiał
odłożyć telefon, wejść w zakładkę rozkładania i tam dopiero zobaczyć nazwę przy
tym samym dokumencie.

Dostawca stoi **między** numerem a statusem, nie na końcu. Koniec linii należy
do statusu („pominięte przy rozkładaniu", „zgłoszony problem") — to on ginie
przy zawijaniu, a niesie ostrzeżenie, że ktoś już się o tę pozycję potknął.
Dokument bez kontrahenta nie zostawia w linii wiszącej kropki.

Serwer miał tę wartość od początku — `kh_Symbol` jechał w tym samym wierszu
zapytania co numer i data, tylko nie wchodził do odpowiedzi. To ta sama
wartość, którą pokazuje lista rozkładania i linia „Zamówione u dostawcy”, więc
nazwa na karcie zgadza się z nazwą wszędzie indziej.

**[wymaga działania]** Nic ponad `git pull` — ale nazwa pojawi się na karcie
dopiero po **rozesłaniu nowego APK**. Starszy kolektor pomija nieznane pole
i rysuje linię jak dotąd, bez dostawcy.

---

## 0.38.1 — 10 sierpnia 2026

**Instalator nadaje uprawnienie do kodu kreskowego.** To on był przyczyną
odmowy `The UPDATE permission was denied on the column 'tw_PodstKodKresk'` na
produkcji: 0.37.0 dołożyło drugą kolumnę zapisu po stronie serwera, a kreator
dalej nadawał komplet sprzed tej zmiany.

**[wymaga działania]** Nic ponad `git pull` — ale **instalacja zastana dostaje
brakujący grant dopiero po ponownym uruchomieniu kreatora**. Skrypt jest
idempotentny, więc przebieg na działającej instalacji dokłada wyłącznie to,
czego brakuje. Kto nie chce uruchamiać kreatora, wykonuje jedną linię
z `docs/subiekt-gt-edu-setup.md` §2 i klika PONÓW na zadaniach w kolejce.

### Ta usterka miała już dwa precedensy i ten sam kształt

Liczba nadawanych grantów i liczba oczekiwanych rozjechały się w tym pliku
dwa razy wcześniej — po stronie ODCZYTU. Naprawiono to wtedy jedną listą
(`Get-WertisTabeleOdczytu`), z której idzie i skrypt, i próg weryfikacji.
Strona ZAPISU takiej listy nie miała: „jedna kolumna" stała wpisana z ręki
w trzech miejscach — w skrypcie, w progu i w teście — więc dołożenie drugiej
kolumny w serwerze nie miało jak pociągnąć instalatora za sobą.

Teraz zapis idzie z `Get-WertisKolumnyZapisu`, a próg i test liczą z tej samej
listy. Doszedł też test-regresja wprost na tę usterkę: uprawnienia sprzed
0.37.0 muszą zostać zgłoszone jako niekompletne, **z nazwą brakującej
kolumny** — bo „uprawnienia się nie zgadzają" nie mówi, którą linię GRANT-a
poprawić.

---

## 0.38.0 — 9 sierpnia 2026

Trzy rzeczy ze zgłoszeń po wdrożeniu 0.37.0. Jedna z nich to **cicha zmiana
danych w Subiekcie** — i to ona jest tu najważniejsza.

**[wymaga działania]** Nowy APK (dwie z trzech zmian są w kolektorze).
Poza tym `git pull`, `npm ci`, `npm run build`, restart usług.

### Ekran przetrwał przerwę i zamienił skan półki w zmianę lokalizacji

Magazynier otworzył kartę towaru, przełączył się do innej aplikacji, wrócił po
dwudziestu minutach i zeskanował etykietę regału, żeby sprawdzić jego zawartość.
Ale wciąż był na karcie towaru — a tam skan półki znaczy „ZMIEŃ LOKALIZACJĘ
TEGO TOWARU". Adres kartoteki zmienił się bez jednego pytania.

To nie była wina człowieka. Ekran przeżył przerwę, skaner nie ma pojęcia, że
minęło dwadzieścia minut, a zapis lokalizacji jest bezwarunkowy i nie ma po nim
cofnięcia. Od teraz **powrót po dłuższej niż dwuminutowej przerwie ląduje na
ekranie głównym**, gdzie skan półki pokazuje jej zawartość — czyli robi to,
czego ten człowiek chciał.

Próg, a nie „zawsze", i to jest świadomy wybór: powrót na główny po każdym
przełączeniu wyrzucałby z rozgrzebanej dostawy za każdym zerknięciem w inną
aplikację, czyli karałby rytm pracy za czynność bez żadnego ryzyka.
Niebezpieczna jest **przerwa, po której nie pamięta się, co było na ekranie** —
kilkanaście sekund pamięta się zawsze. Kreator kont jest wyjątkiem: to formularz
z wpisanymi danymi, a zakładanie konta nie reaguje na skan półki.

### Lokalizację poboczną da się uczynić podstawową

Pickingowa jest **pierwsza** lokalizacja z pola. Towar leżący w dwóch miejscach
zmienia „główne" wraz z rotacją, a jedyną drogą było dotąd skasowanie adresu
i nadanie go od nowa — czyli utrata informacji, że drugie miejsce istnieje.

Dotknięcie chipa lokalizacji daje teraz **PODSTAWOWA** obok USUŃ. Przycisk
pojawia się wyłącznie przy adresie, który podstawowy nie jest. Operacja
przestawia kolejność i **nic nie dopisuje ani nie kasuje**; prośba o podniesienie
adresu, którego towar nie ma, jest odmawiana (kolektor patrzy wtedy na inny stan
niż baza, a ciche dopisanie zamieniłoby ten rozjazd w zapis do kartoteki).

### Odmowa uprawnienia mówi teraz, co zrobić

Wdrożenie 0.37.0 potknęło się o komunikat `The UPDATE permission was denied on
the column 'tw_PodstKodKresk'` — prawdziwy, ale nie mówiący ANI SŁOWA o tym, co
z nim zrobić. Zadanie w kolejce niesie teraz gotowe polecenie:

> Konto SQL nie ma prawa zapisu do kolumny tw_PodstKodKresk. Wykonaj w SSMS na
> bazie podmiotu: `GRANT UPDATE ON dbo.tw__Towar (tw_PodstKodKresk) TO wertis;`
> — potem PONÓW to zadanie.

Oryginalny komunikat serwera SQL zostaje w drugim zdaniu: bez niego nie da się
odróżnić braku GRANT-u od `DENY` albo od wykonania polecenia na złej bazie. Ta
sama podpowiedź działa dla kolumny lokalizacji — brak GRANT-u wygląda tam
identycznie i tak samo nic nie mówił.

---

## 0.37.0 — 9 sierpnia 2026

**Kody kreskowe da się nadawać z kolektora.** Karton ma kod, kartoteka go nie ma
— do tej pory jedyną drogą było „zapamiętaj i powiedz biuru", czyli w praktyce
nic, a nazajutrz ten sam karton zatrzymywał pracę drugi raz.

**[wymaga działania]** **Nowe uprawnienie SQL i nowy APK.**

1. Na bazie Subiekta wykonaj (SSMS, konto administratora):
   ```sql
   GRANT UPDATE ON dbo.tw__Towar (tw_PodstKodKresk) TO wertis;
   ```
   Bez tego funkcja **nie pada** — kod działa na kolektorze od pierwszej chwili,
   a zapis do Subiekta czeka w kolejce ze statusem `error` i czytelnym
   komunikatem. Po nadaniu uprawnienia wystarczy PONÓW na zadaniu.
2. `git pull`, `npm ci`, `npm run build`, restart `wertis-api` i `wertis-worker`.
3. **Nowy APK** — cała obsługa nadawania jest w kolektorze.

### To jest rozszerzenie granicy zapisu i mówimy o tym wprost

Od początku projektu aplikacja zmieniała w bazie firmy **jedno** pole —
lokalizację. Teraz zmienia dwa. Zdanie „zapisuje jedną rzecz" zniknęło z README
i z opisu architektury, bo przestało być prawdziwe, a dokumentacja, która kłamie
o granicy zapisu, jest gorsza niż jej brak.

Nic poza tym się nie zmieniło: dalej zero `INSERT` do tabel dokumentów, zero
modyfikacji stanów, każdy zapis przez kolejkę i z wpisem w audycie.

### Zapis idzie dwiema drogami — i to nie jest dublowanie

Kod ląduje najpierw w bazie WERTIS (`ean_alias`), a dopiero potem, przez
kolejkę, w Subiekcie. Powód jest praktyczny: zapis do Subiekta bywa **opóźniony**
(worker pracuje sekwencyjnie) i bywa **niemożliwy** (brak GRANT-u). W obu
przypadkach skan ma zadziałać natychmiast — bo to jest jedyny powód, dla którego
ktoś ten kod nadał.

Kod nadany u nas jest **furtką, nie pierwszeństwem**: szukamy go dopiero wtedy,
gdy kartoteka Subiekta nie zwróciła ani jednego trafienia. Odwrotna kolejność
znaczyłaby, że kod nadany przy półce przykrywa kod z Subiekta — czyli że
magazynier cicho nadpisuje dane, których nie widzi.

### Trzy sytuacje, trzy różne odpowiedzi

- **Puste pole** — jeden skan i gotowe. Nic nie ginie, więc nie ma o co pytać.
- **Kartoteka ma już kod** — arkusz pokazuje `STARY → NOWY` i pyta wprost, bo
  stary kod zostaje na kartonach w hali i przestanie działać. Stary kod zapisuje
  się w audycie, więc na pytanie „czemu ten karton się nie skanuje" da się
  odpowiedzieć.
- **Kod należy do INNEJ kartoteki** — droga zamknięta, bez możliwości przejścia
  potwierdzeniem. Nadanie wyprodukowałoby kolizję (§4.5), czyli dokładnie ten
  defekt danych, który system mierzy i raportuje biuru. Próba jest przy okazji
  **zapisywana do rejestru kolizji** — widać ją, zanim zatrzyma pracę w alejce.

Zlanie dwóch ostatnich w jedno „na pewno?" byłoby najgorszym z uproszczeń:
pytanie wygląda tak samo, a odpowiedź „tak" raz naprawia kartotekę, a raz psuje
cudzą. Reguła siedzi w `:core` razem ze swoim testem.

### Gdzie się to nadaje

Dwa wejścia, oba w miejscu, w którym człowiek trzyma karton:

- **karta towaru** — linia „EAN —" była końcem drogi, teraz jest przyciskiem;
- **rozkładanie dostawy** — zeskanowany kod, którego kartoteka nie zna, zostaje
  zapamiętany; po dotknięciu właściwej pozycji z listy pojawia się propozycja
  nadania mu tego kodu. To jedyny moment, w którym wiadomo na pewno, że kod
  i towar do siebie pasują.

**Bez bufora offline** — świadomie, tak jak przesunięcie stanu. Pytanie „czy ten
kod nie należy już do innej kartoteki" musi paść, gdy człowiek stoi przy półce
i może odpowiedzieć, a nie godzinę później przy odbuforowaniu.

---

## 0.36.1 — 9 sierpnia 2026

**Poprawka: ten sam towar na dwóch dostawach pokazywał stary adres.** Magazynier
rozkładał pierwszą dostawę i nadawał towarowi nowy adres; w drugiej ten sam
towar dalej wskazywał starą półkę.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — cała poprawka siedzi po stronie serwera.

### Przyczyny były dwie i każda osobno wystarczyła

1. **Zamrożony snapshot.** `lok_oczekiwana` zapisywała się RAZ, przy otwarciu
   dostawy. Dostawa otwarta wcześniej pokazywała stary adres już na zawsze —
   także długo po tym, jak kartoteka w Subiekcie była poprawna.
2. **Opóźnienie zapisu.** Nawet dostawa otwarta ZARAZ po odłożeniu widziała
   stary adres: zapis leżał jeszcze w kolejce, worker go nie wykonał,
   a read-model `sgt_towar` odświeża się dopiero przy kolejnej synchronizacji.

### Skutek nie kończył się na złym adresie

Rozjazd (§4.3) liczył się względem zamrożonej wartości, więc odłożenie towaru
pod adresem **aktualnym** podnosiło fałszywy alarm ZAMIEŃ/DODAJ i dopisywało
`location_mismatch` do raportu przepełnionych gniazd. Kolejność alejkowa idzie
po tym samym polu, czyli trasa przez halę prowadziła do starej półki.

Jedno działało dobrze i tak zostaje: **zduplikowany zapis do Subiekta nie
powstawał** — odłożenie sprawdza przed zakolejkowaniem żywą kartotekę.

### Co się zmieniło

Snapshot ma sens dla danych DOKUMENTU (co i ile przyjechało) — tam chroni pracę
przed korektą faktury w trakcie. Adres nie jest daną dokumentu, tylko kartoteki,
i zamrażanie go nie chroniło niczego. Od teraz:

- pozycja, której **nikt jeszcze nie ruszył**, bierze adres żywy: z kartoteki,
  skorygowany o zapisy czekające w kolejce — ta sama zasada, którą stosuje już
  karta towaru i zawartość regału;
- pozycja **tknięta** zachowuje swój adres z chwili pracy, bo to zapis tego,
  czego się wtedy spodziewaliśmy, i na nim stoi udokumentowany rozjazd;
- pozycja **częściowo odłożona** też go zachowuje: reszta partii ma dojechać
  tam, gdzie pojechała pierwsza połowa, a nie gonić kartotekę w połowie pracy.

Cena jest jawna: gdy ktoś zmieni adres w trakcie czyjejś pracy, wiersz może
przeskoczyć w kolejności. Przeskakuje jednak dokładnie wtedy, kiedy człowiek ma
o tym wiedzieć, a alternatywą jest wysłanie go do złego regału.

Zaufanie do kolejki jest **skończone w czasie** (dwa cykle importu). Bez tego
zadanie wykonane tydzień temu przebijałoby w nieskończoność adres zmieniony
potem ręcznie w Subiekcie.

---

## 0.36.0 — 9 sierpnia 2026

**Biuro wchodzi w fakturę.** Kliknięcie dostawy w podglądzie pokazuje jej
pozycje: zdjęcie kartoteki, ile odłożono z ilu, adres, kto odłożył i kiedy.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — kolektor nie dostał ani jednego nowego pola
i to był warunek projektowy, nie przypadek (niżej).

### Pasek postępu nie odpowiadał na żadne pytanie

Lista dostaw mówiła „12/30" i na tym się kończyła. Które dwanaście, kto je
odłożył, gdzie faktycznie wylądowały — żeby to sprawdzić, trzeba było otworzyć
Subiekta obok. Najgorsze, że odpowiedzi leżały w bazie: kolumny `done_by`,
`done_at` i `lok_faktyczna` zapisywały się od 0.17.0 i **nie czytał ich nikt**.

Teraz wiersz dokumentu jest klikalny, a panel pokazuje pozycję po pozycji.
Trzy rzeczy poza samą listą:

- **Rozjazd adresu** jest wyróżniony na czerwono, z dopiskiem „zamiast X". To
  jedyna zmiana, jaką WERTIS zapisuje do Subiekta, więc biuro ma prawo widzieć
  ją przy fakturze, a nie tylko zbiorczo w rekoncyliacji.
- **„W rękach: X"** przy pozycji trzymanej właśnie przez kogoś — odpowiedź na
  „czemu to stoi", której nie było nigdzie.
- **Wyjątek w wierszu swojej pozycji**, ze zdjęciem dowodowym. Dotąd wyjątki
  żyły w osobnej sekcji i nie było widać, której pozycji faktury dotyczą.

### Wejść da się także w dokument, którego nikt nie zaczął

I to jest cała trudność tej zmiany. Otwarcie dostawy (`openDelivery`) jest
ZAPISEM: zakłada rekord, sprząta pozycje usługowe i przestawia dokument
z NIETKNIĘTA na W TOKU. Wywołanie go z biura sprawiłoby, że **samo patrzenie
zmienia stan magazynu** — lista pracy zapełniłaby się dostawami, których nikt
nie zaczął, a ludziom przy półce znikałyby blokady.

Podgląd czyta więc dwoma drogami: dokument otwarty wprost z bazy (snapshot jest
snapshotem — adres oczekiwany NIE jest odświeżany z kartoteki, bo na nim stoi
wykrywanie rozjazdu), a nietknięty przez tę samą funkcję, której użyje otwarcie.
Nagłówek mówi wprost, którą z dwóch list widzisz: druga jest prognozą i zmieni
się, gdy księgowość poprawi fakturę przed otwarciem.

Regułę „zero zapisu z podglądu" pilnuje teraz test, a nie tylko komentarz:
liczba zapisów w kodzie strony ma być równa **jeden** i jest nim logowanie.

### Dlaczego bez nowego APK

Kuszące byłoby dopisać `doneBy` do `DeliveryLineView`. Ale typy w `types.ts` są
lustrem DTO kolektora — zmiana wymusiłaby nowy APK i rozesłanie przez MDM
aplikacji, w której nic się nie zmieniło. Typy podglądu mieszkają więc
w `services/podglad-dostawy.ts` i czyta je wyłącznie strona biura.

### Zdjęcia po trzy naraz

Przy pierwszym trafieniu serwer ciągnie plik z Subiekta tą samą drogą, z której
korzystają kolektory stojące przy regale, więc otwarcie dużej dostawy nie ma
prawa ich zagłodzić. Brak zdjęcia pamiętamy — inaczej dokument z czterdziestoma
takimi kartotekami pytałby czterdzieści razy co pół minuty przez cały dzień.
Gdy `ZDJECIA_ZRODLO` jest puste, kolumna nie powstaje wcale: ramka „bez zdjęcia"
przy każdej pozycji mówiłaby o brakującej kartotece, choć brakuje ustawienia.

---

## 0.35.0 — 9 sierpnia 2026

**Pięć poprawek z hali.** Faktury do dokończenia na górze listy, odłożona
pozycja pokazuje adres, który dostała, stan magazynowy widać przy półce,
odłożone schodzą na dół, a wiersz „koszt transportu" znika z rozkładania.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api` i `wertis-worker`. **Nowy APK potrzebny** — trzy z pięciu zmian
siedzą w kolektorze.

### Faktury do dokończenia na górze

Lista dostaw szła dotąd po dacie dokumentu, więc rozgrzebana wczorajsza faktura
lądowała pod dzisiejszymi, których nikt jeszcze nie tknął. Teraz porządek jest
wprost o stanie pracy: **w toku → nowe → ukończone**, a wewnątrz grupy zostaje
kolejność z serwera. Reguła mieszka w `:core` (`ListaDokumentow.kt`), bo
„ukończona" to trzy różne rzeczy naraz — status dokumentu, licznik pozycji
i sam fakt, że ktoś zaczął.

### Odłożona pozycja pokazuje adres, który dostała

Towar bez lokalizacji w kartotece, odłożony i opatrzony adresem, dalej wyświetlał
**BRAK LOKALIZACJI**. Ekran czytał wyłącznie `locExpected` — snapshot z chwili
otwarcia dostawy, celowo niezmienny, bo na nim stoi wykrywanie rozjazdu i
kolejność listy. Brakowało drugiego pola: `locActual` mówi, gdzie towar
NAPRAWDĘ wylądował, i to ono wygrywa na zamkniętej pozycji. „BRAK" zostaje
zarezerwowany dla „jeszcze nigdzie".

### Stan magazynowy przy półce

Rozwinięty wiersz pokazuje, ile tego towaru już leży na hali i ile czeka
w przyjęciach. Odpowiada na pytanie zadawane przy regale — „czy tego już tam
coś nie ma" — bez schodzenia do karty towaru.

Stan jest SUROWY, bez korekty o kolejkę i rezerwacje: przy półce liczy się to,
co stoi fizycznie. Przy dostawie krajowej towar figuruje na MAG od zaksięgowania
dokumentu, więc `stanMag` zawiera już to, co magazynier niesie w rękach —
kolektor pisze o tym wprost („z tą dostawą"), zamiast liczyć za człowieka.

### Odłożone pozycje schodzą na dół

Odwrócona wcześniejsza decyzja i warto powiedzieć, czym za to płacimy. Do teraz
odłożone pozycje zostawały na swoim miejscu, tylko zwężone — z obawy, że
przenoszenie ich każe wierszom skakać po każdym zapisie. Praktyka pokazała drugą
stronę: dziesięć zwiniętych pasków dalej zajmuje ekran, więc przy większym
kartonie do pozycji „do zrobienia" trzeba się przewijać przez robotę wykonaną.

Skok kosztuje mniej, niż zakładano, bo następną pozycję bierze się SKANEM,
a skan trafia w towar po symbolu, nie w miejsce na ekranie. Dwa zabezpieczenia
zostają: **pozycja z problemem nie schodzi na dół** (wyjątek czeka na decyzję,
D8), a pozycje **bez lokalizacji** są osobną grupą tuż nad zrobionymi.

### Wiersz „koszt transportu" nie jest towarem

Na części faktur zakupu stoi pozycja o symbolu `PRZESYŁKA`. Nie ma jej czym
zeskanować ani gdzie położyć, a mimo to czekała do końca dnia jako jedyna
niezałatwiona linia i kazała komuś zgłaszać problem na coś, co problemem nie
jest. Teraz wypada ze **snapshotu** dostawy, czyli nie istnieje dla tej pracy
w ogóle.

To jest wyjątek od reguły „rozkładanie JEST sprawdzaniem faktury i liczy się
KAŻDĄ pozycję", więc cena jest jawna: dostawa z samą przesyłką zamyka się
natychmiast, a licznik pozycji jest o tę jedną mniejszy niż w Subiekcie.
Dlatego licznik PRZED otwarciem dostawy odsiewa dokładnie to samo — liczba
zmieniająca się od samego wejścia w ekran wyglądałaby jak zgubiona pozycja.

Rozpoznajemy po SYMBOLU, nie po opisie: opis jest polem swobodnym i różni się
między dostawcami. Lista symboli siedzi w `POZYCJE_NIE_TOWAROWE` (domyślnie
`PRZESYŁKA`, puste = funkcja wyłączona), a porównanie ignoruje wielkość liter,
polskie ogonki i myślniki — tym samym składaniem, którego używa wyszukiwarka.
Subiekt ma wprawdzie `tw_Rodzaj` z literą `U` dla usług i to byłoby źródło
pewniejsze, ale read-model tej kolumny nie ma; gdyby usług przybyło, jest to
właściwy następny krok.

Dostawy otwarte STARSZĄ wersją mają ten wiersz w snapshocie i bez sprzątania
zostałby tam na zawsze — dostawa raz otwarta nigdy nie wraca do gałęzi
snapshotującej. Wznowienie kasuje go, ale **wyłącznie z linii nietkniętych**:
jeśli ktoś zdążył na niej cokolwiek zrobić, to ślad ludzkiej decyzji i zostaje.

---

## 0.34.0 — 8 sierpnia 2026

**Wyszukiwarka wybacza.** Wpisany `gaznik` znajduje `gaźnik`, słowa mogą iść
w dowolnej kolejności, myślnik w symbolu nie ma znaczenia, a literówka nie
kończy szukania.

**[wymaga działania]** Nic. `git pull`, `npm ci`, `npm run build`, restart
`wertis-api`. **Bez nowego APK** — kolektor nie szuka lokalnie, tylko pyta
serwer, więc cała zmiana siedzi po jednej stronie.

### Zepsute były dwie rzeczy, nie jedna

Zgłoszenie brzmiało: „wpisuję gaznik i nie znajduje gaźnika". Przyczyna sięgała
głębiej, bo SQLite nie zna polskich liter w żadnej z funkcji, których
używaliśmy:

```
lower('GAŹNIK')                     → 'gaŹnik'
'gaźnik' = 'GAŹNIK' COLLATE NOCASE  → 0
```

Diakrytyki nie były składane — i to było zgłoszenie. Ale **wielkość liter też
nie działała dla polskich znaków**: wpisany `ŁAŃCUCH` nie znajdował kartoteki
`łańcuch`. Nikt tego nie zauważył, bo szuka się małymi literami.

Przy okazji wyszła trzecia, cicha wada: `%` i `_` wpisane w wyszukiwarkę
działały jako wieloznaczniki. Samo `%` zwracało całą kartotekę, a `Filtr 100%`
znajdowało też `Filtr 1005`.

### Cztery poziomy wyrozumiałości

**Polskie znaki i wielkość liter** — `gaznik`, `gaźnik`, `GAŹNIK` i `Gaznik`
znajdują to samo, w obie strony. Kartoteka zapisana bez ogonków też jest
znajdowana zapytaniem z ogonkami.

**Słowa w dowolnej kolejności** — `ssanie gaznik` znajduje `Gaźnik ssanie
ręczne`. Cała fraza w jednym kawałku wygrywa z rozproszonymi słowami, więc
kolejność nadal coś znaczy dla trafności, tylko nie decyduje o znalezieniu.

**Myślniki i spacje w symbolu** — `LS51139`, `ls51-139` i `LS51 139` to jedno
i to samo. Etykieta bywa zdarta, a numer przepisywany z ręki.

**Literówki, ale WYŁĄCZNIE gdy nic innego nie wyszło.** Odwrotność jest tu
świadoma: dopasowanie rozmyte wmieszane w ranking wypycha trafienia dokładne —
klasyczna wada wyszukiwarek, w których „gaz" wciąga „gips". Jako odpowiedź na
„nic nie znalazłem" nie ma czego zepsuć. Krótkie słowa nie dostają prawa do
literówki wcale: jeden błąd na trzech znakach zrównuje `kos`, `kot`, `koc`
i `kod`.

### Skan nigdy nie otworzy karty po literówce

Ścieżka skanu ma furtkę **wyłączoną** i to jest ważniejsze niż wygoda. Gdy skan
albo kod wpisany ręcznie daje dokładnie jeden wynik, serwer otwiera kartę bez
pytania — więc dopasowanie przybliżone prowadziłoby wprost do CUDZEJ kartoteki.
Zdarta etykieta, kod wpisany z błędem, jedno trafienie po literówce
i magazynier zapisuje adres półki nie na tym towarze. Zapis lokalizacji jest
bezwarunkowy i nie ma po nim cofnięcia.

### Pomiar zdecydował o kształcie rozwiązania

Pierwsza wersja składała obie kolumny łańcuchem osiemnastu `replace`. Na
prawdziwym katalogu demo (3415 kartotek, 2671 z polskimi znakami w nazwie)
kosztowało to **42–75 ms na zapytanie**, przy 5 ms wersji dotychczasowej.
Serwer jest jednowątkowy i w tym samym czasie odpowiada na odpytywanie listy
rozkładania, więc taki regres byłby widoczny na hali.

Nazwa idzie więc przez `GLOB` z klasami znaków (`[aAąĄ]`, `[zZźŹżŻ]`), który
niczego nie alokuje — tylko porównuje. Symbol nadal składamy, ale pełny łańcuch
liczy się wyłącznie dla wierszy ze znakiem spoza ASCII; w tej kartotece jest ich
**dwanaście na 3415**. Wynik: **10–12 ms** dla zapytania jednosłownego.

Gdyby kartoteka kiedyś urosła na tyle, że i to zacznie przeszkadzać, następnym
krokiem jest kolumna składana wyliczana przy imporcie — świadomie odrzucona
teraz, bo wymaga dopisania się do trzech miejsc zapisu, a każde przyszłe, które
o niej zapomni, robi towar po cichu niewyszukiwalnym.

## 0.33.1 — 8 sierpnia 2026

**Rysunek pudełka ustępuje zdjęciu.** W pasku listy rozkładania stały obok
siebie ikona pudełka i miniatura tego samego towaru.

**[wymaga działania]** Nowy APK przez MDM.

### Dwie ikony w jednym miejscu znaczyły to samo

Rysunek pudełka nie niósł nic — mówił „towar". Obok miniatury tego samego
towaru był powtórzeniem, bo zdjęcie mówi KTÓRY towar. Pojawia się teraz
wyłącznie wtedy, gdy kartoteka zdjęcia nie ma.

Ikony stanu zostają nietknięte i to jest granica tej zmiany. `Alert` mówi
„zgłoszony problem", `Check` mówi „odłożone" — zdjęcie żadnej z tych rzeczy nie
powie, więc podmiana zabrałaby z wiersza ostrzeżenie.

Rysunek zajmuje przy tym **tyle samo miejsca co miniatura**, choć sam jest
o połowę mniejszy. Bez tego wiersz przeskakiwałby w bok o 18 dp w chwili
doczytania zdjęcia — dokładnie ten ruch pod kciukiem, przed którym broni się
reszta tego ekranu.

Rozwinięty wiersz zostaje bez zmian. Jego zdjęcie stoi na drugim końcu paska,
w miejscu pastylki adresu, więc te dwa elementy nie sąsiadują.

## 0.33.0 — 8 sierpnia 2026

**Miniatura w pasku listy rozkładania i w ostatnio skanowanych.** Dwa miejsca,
w których zdjęcia jeszcze nie było, a decyzja „czy to ten towar" właśnie tam
zapada.

**[wymaga działania]** Nowy APK przez MDM. Po stronie serwera nic.

### Zdjęcie ma być tam, gdzie pada pytanie

Miniatury weszły wcześniej na kartę towaru, do wyników wyszukiwania, na listę
zawartości regału i do nagłówków arkuszy. W liście rozkładania stała jednak
wyłącznie w wierszu ROZWINIĘTYM — czyli po tym, jak człowiek już wybrał pozycję.

Zgłoszenie z magazynu wskazało moment wcześniejszy: pozycji szuka się wzrokiem
po pasku, zanim ręka sięgnie do kartonu. Miniatura stoi więc teraz po lewej
stronie symbolu w każdym pasku oczekującym. Rozwinięty wiersz ma swoją bez
zmian, w miejscu pastylki adresu.

Wiersz ZWINIĘTY jej nie dostaje. Pozycja jest odłożona, rozpoznawanie towaru nic
już nie wnosi, a pasek jest o połowę niższy właśnie po to, żeby dziesięć pozycji
drobnicy zmieściło się na ekranie.

Ikona stanu zostaje na swoim miejscu i to nie jest kompromis. Mówi „zrobione"
albo „zgłoszony problem" — co innego niż zdjęcie, które mówi „to ten towar".
Podmiana zabrałaby ostrzeżenie z wiersza.

Do tego lista ostatnio skanowanych: cztery pozycje, do których wraca się po
czymś, co przed chwilą trzymało się w ręku. Zdjęcia są tam już w cache'u, bo
kartę tego towaru otwierano chwilę wcześniej.

### Odczyt zdjęć z dysku schodzi z wątku rysującego

Usterka, którą odsłoniło dopiero wejście miniatur do list. Pobranie z sieci szło
na wątek dyskowy od początku, ale odczyt gotowego pliku — ścieżka NAJCZĘSTSZA,
bo plik zwykle już jest — zostawał na wątku wołającego. Przy jednym zdjęciu na
karcie nie miało to znaczenia. Jedno wejście na listę to i dwadzieścia odczytów
pod rząd, a wołane są z `LaunchedEffect`, czyli z wątku rysującego. Widać to
jako zacięcie przy przewijaniu.

## 0.32.1 — 8 sierpnia 2026

**Zdjęcie dodane w Subiekcie pojawia się nazajutrz, a nie po tygodniu.**
Do tego kartoteka z nietypowym zdjęciem głównym przestaje wyglądać na pustą.

**[wymaga działania]** Nic. Po aktualizacji nowe zdjęcia dochodzą same. Gdy
trzeba je zobaczyć od razu: `POST /api/admin/zdjecia/odswiez`.

### Dwie pamięci braku unieważniały się nawzajem

Kolektor pamięta „ta kartoteka zdjęcia nie ma" przez dobę i na tym stała
obietnica zapisana wprost w jego kodzie: zdjęcie dodane dziś w Subiekcie ma się
pokazać najdalej jutro. Serwer trzymał swój brak tak długo jak same zdjęcia,
czyli **tydzień** — jeden próg obsługiwał oba stany.

Skutek był taki, że obietnica nic nie znaczyła. Kolektor po dobie grzecznie
pytał, dostawał 404 z tygodniowej pamięci serwera i uzbrajał własny negatyw na
kolejne 24 godziny. I tak w kółko, aż do wygaśnięcia tego dłuższego progu.
Objawu nie było żadnego: zdjęcie po prostu nie pojawiało się przez tydzień,
a wszystko wyglądało na działające.

Rozdzielone. `ZDJECIA_BRAK_TTL_H` (12 godzin) dotyczy WYŁĄCZNIE stanu „nie ma
zdjęcia" — jedynego, który zmienia się przez dodanie czegoś w Subiekcie. Sam
obraz zmienia się rzadko i zostaje przy tygodniu. Konfiguracja odmawia startu,
gdy ktoś ustawi ten próg na dobę lub więcej, bo wracałby dokładnie ten błąd.

Doszło też wymuszenie: `POST /api/admin/zdjecia/odswiez` kasuje wpisy „brak"
i te po błędzie, zostawiając pobrane zdjęcia. Przy wdrożeniu, gdy sprawdza się
„czy już działa", kilkanaście godzin czekania nie jest odpowiedzią.

### Zdjęcie główne bywa czymś, czego nie da się narysować

Zakładka „Opis" w Subiekcie przyjmuje dowolną zawartość, więc jako główne
potrafi stać kontener OLE albo metaplik. Serwer brał dokładnie jeden wiersz,
nie rozpoznawał w nim obrazu i meldował „brak zdjęcia" — mimo normalnych
JPEG-ów leżących obok na tej samej kartotece.

Bierzemy teraz kilka pierwszych zdjęć w kolejności ustalonej przez Subiekt
i wybieramy pierwsze, które faktycznie jest obrazem. Liczba jest mała
świadomie: to są BLOB-y, a ciągnięcie pięciu skanów po to, żeby użyć jednego,
kosztowałoby więcej niż problem, który rozwiązuje.

Rozmiar celowo NIE jest tu kryterium. Zdjęcie za duże to nadal właściwe zdjęcie
kartoteki i zostaje przy nim zdanie mówiące, ile ważyło — po tej liczbie dobiera
się `ZDJECIA_MAX_KB`. Podmiana na inne ukryłaby powód, dla którego główne się
nie pokazuje.

## 0.32.0 — 8 sierpnia 2026

**Kreator sam włącza zdjęcia kartotek.** Sprawdza bazę, ustawia sześć kluczy
i nadaje siódmy grant — zamiast kazać przepisywać nazwy z dokumentacji.

**[wymaga działania]** Uruchom instalator z `-TylkoKonfiguracja`, żeby zdjęcia
włączyły się same. Kto wpisał klucze `ZDJECIA_*` ręką, nie musi robić nic —
scalanie z 0.31.2 zostawia je w spokoju. Miniatura wymaga APK **0.30.0 lub
nowszego**; serwer wyda zdjęcia od razu, starszy kolektor nie ma ich gdzie
narysować.

### Sześć kluczy do przepisania ręką było przeoczeniem

Gdy zdjęcia powstawały (0.30.0), nikt nie wiedział, gdzie Subiekt trzyma obraz.
Nazwy tabeli i kolumn nosiły znacznik `[WERYFIKUJ]`, więc kreator nie miał o co
zapytać — mógłby najwyżej kazać przepisać je z SSMS.

Rozpoznanie na bazie firmy zamknęło tamto pytanie w 0.31.0: `tw_ZdjecieTw`
z kolumnami `zd_IdTowar`, `zd_Zdjecie`, `zd_Glowne` i `zd_Id`. Skrypt uprawnień
od razu dostał siódmy `GRANT SELECT`. **Kreator nie dostał nic** i dalej o tym
nie wiedział, choć wszystkie sześć wartości było już znanych i stałych.
Uzasadnienie wygasło, a kod za nim nie poszedł.

Teraz kreator nie pyta, tylko sprawdza. Wymaga **kompletu czterech kolumn**,
nie samej obecności tabeli: bez `zd_Id` porządek traci rozstrzygalność, bo
`zd_IdTowar` jest kluczem obcym i przy kilku zdjęciach jednej kartoteki nie
domyka wyboru. Po wykryciu wypisuje, ile zdjęć i na ilu kartotekach znalazł.

### Siódmy grant na bazie bez tej tabeli kasował całe konto

Usterka wprowadzona razem z tamtym grantem i dotąd niewidoczna, bo w bazie
firmy tabela jest. Skrypt uprawnień idzie do serwera **jednym poleceniem**,
więc `GRANT SELECT` na nieistniejący obiekt przerywa wykonanie. Na instalacji
ze starszym Subiektem konto zostawało bez ani jednego uprawnienia, a instalator
proponował przekazanie skryptu administratorowi — skryptu, który u niego też by
się wywalił.

Grant jest teraz warunkowy, a próg weryfikacji idzie za tą samą decyzją. Obie
liczby biorą się z jednej listy, więc nie mają jak się rozjechać — ten rozjazd
zdarzył się już dwa razy i za każdym razem objawem było zdanie o niezgodnych
uprawnieniach po poprawnej instalacji.

### Kolumna ilości zrealizowanej: kreator sprawdza zamiast zgadywać

Domyślna nazwa `ob_IloscZrealizowana` była zgadnięta i zgadnięta źle — w tej
wersji bazy nie ma jej wcale, co potwierdził komplet 57 kolumn `dok_Pozycja`.
Poprawną wartością jest pusta, a dowiadywało się o tym z `/api/health` długo
po instalacji. Kreator ma otwarte połączenie i jedno zapytanie do `sys.columns`
rozstrzyga sprawę na miejscu.

Wymagało to poprawki w zapisie konfiguracji. Pusta wartość znaczyła dotąd
„nie ustawiono" i klucz nie wychodził do pliku — a przy kluczach o **niepustej
domyślnej** to jest różnica: brak wpisu przywraca wartość domyślną. Kreator nie
miał więc jak powiedzieć „tego nie ma". Dotyczyło to także `MSSQL_INSTANCE`,
gdzie pustka oznacza instancję domyślną i wracała do `INSERTGT` bez objawu.

## 0.31.2 — 8 sierpnia 2026

**Ponowne uruchomienie instalatora nie kasuje już ustawień dopisanych ręką.**
Wprowadza swoje zmiany i zostawia resztę pliku w spokoju.

**[wymaga działania]** Nic. Poprawka działa od pierwszego przebiegu po
aktualizacji; klucze, które zniknęły wcześniej, trzeba dopisać raz jeszcze.

### Plik ustawień był odtwarzany od zera

`Publish-WertisKonfiguracja` budowało `wertis.env` z listy odpowiedzi kreatora.
Klucz, o który kreator nie pyta, nie miał skąd się w tej liście wziąć — więc
znikał przy najbliższym przebiegu z `-TylkoKonfiguracja`. Dotyczyło to
dokładnie tych ustawień, które dokumentacja każe wpisać ręką: `DOK_TYPY_DOSTAW`,
`MSSQL_ZD_ZREAL_COLUMN` i komplet `ZDJECIA_*`.

Objawu nie było żadnego w chwili zdarzenia. Instalator meldował sukces, usługi
wstawały, a funkcja gasła — zakładka DOSTAWY wracała do samych FZ, sloty zdjęć
robiły się puste. Powiązanie tego z uruchomieniem kreatora sprzed tygodnia jest
pracą detektywistyczną, nie diagnozą.

### Zapis jest teraz scaleniem

Reguła mieści się w jednym zdaniu: **kreator wygrywa tam, gdzie ma zdanie**.
Klucz obecny w jego ustawieniach idzie z odpowiedzi — także wtedy, gdy jest
pusty, bo pusta nazwa instancji MSSQL znaczy „instancja domyślna" i stara
wartość musi wtedy zniknąć. Klucza, o który kreator nie pytał, funkcja nie
rusza.

Nie przeżywają dwie rzeczy i obie celowo. **Komentarze własne** — plik jest
generowany i nagłówek mówi to wprost. **Klucze od kont** (`ADMIN_LOGIN`,
`ADMIN_HASLO` i wycofany odpowiednik z 0.23.0) — sekret konta aplikacji idzie
przez API do bazy i nie ma prawa leżeć na dysku serwera. Skoro nieznany klucz przestał znaczyć
„zniknie", przebieg instalatora jest najlepszą okazją, żeby taki wpis wyczyścić.

Odczyt pliku robi `Read-WertisEnv` — odpowiednik `parseEnvFile`
z `server/src/env-file.ts`, bo obie strony muszą rozumieć tę samą składnię.
Instalator, który „nie widzi" klucza stosowanego przez aplikację, skasowałby go
mimo scalania. Zgodność parserów pilnują testy: apostrofy, cudzysłowy,
komentarz doklejony po białym znaku i `haslo#7` bez odstępu.

## 0.31.1 — 8 sierpnia 2026

**Godziny w logach przestają być dwie godziny do tyłu, a wyniki wyszukiwania
zaczynają się od tego, co realnie leży na półce.** Oba zgłoszenia z magazynu.

**[wymaga działania]** Nic obowiązkowego. Serwer wyświetla godziny w strefie
`Europe/Warsaw`; gdyby magazyn stał gdzie indziej, zmienia to `STREFA_CZASU`
w `wertis.env`. Nowy APK przez MDM — poprawka czasu na karcie towaru siedzi
po stronie kolektora.

### Czas: zapis w UTC zostaje, pokazywanie było błędem

Znaczniki w bazie są i pozostają w UTC — na tym stoi sortowanie po
`created_at`, progi rekoncyliacji i porównania leksykalne. Błąd był w warstwie
wyświetlania: godzinę wycinano z ciągu ISO (`.slice(11, 16)`, `at.drop(11)`),
czyli pokazywano czas z Greenwich przy zegarze wskazującym czas polski. Latem
dawało to dwie godziny wstecz, zimą jedną.

Objaw mylił podwójnie. Zapis sprzed chwili wyglądał na sprzed dwóch godzin, co
przy diagnozie „czy to weszło" prowadzi w złą stronę. Przy wpisach z okolic
północy myliła się też **data**: operacja o 01:30 czasu polskiego ma w bazie
23:30 UTC dnia poprzedniego i tak właśnie pokazywała się w historii.

Konwersję dostały trzy miejsca: kolejka na kolektorze (`src/czas.ts`, strefa
z ustawienia — nie ze strefy maszyny, bo serwer bywa stawiany z angielskiego
obrazu), historia na karcie towaru (`:core`, strefa urządzenia) i dziennik
w podglądzie biura (strefa przeglądarki). Znacznik bez strefy — starszy format
bez `Z` — wraca niezmieniony: zgadywanie strefy dla takiego wpisu byłoby gorsze
niż jego dosłowne powtórzenie.

Przy okazji data na **formularzu reklamacyjnym dla dostawcy**: wystawiony po
północy nosiłby datę dnia poprzedniego.

### Wyszukiwanie: najpierw to, co jest

Z ~3600 kartotek aktywnych jest ~1000, więc dwie trzecie trafień to kartoteki
martwe — zerowy stan na hali i w przyjęciach. Sortowanie po samym symbolu
wypychało je na górę alfabetem i magazynier przewijał listę, żeby dojść do
jedynej pozycji, którą można podać klientowi.

Wewnątrz tej samej trafności decyduje teraz **łączny stan** hali i przyjęć,
malejąco. Trafność zostaje kryterium pierwszym i to jest świadome: wpisany
symbol ma wygrać z przypadkowym trafieniem w nazwie, choćby tamto miało pełny
magazyn — inaczej szukanie po symbolu przestałoby działać. Symbol zostaje
ostatnim kryterium, żeby kolejność przy równym stanie była powtarzalna.

---

## 0.31.0 — 8 sierpnia 2026

**Wiadomo, gdzie Subiekt trzyma zdjęcia kartotek: `tw_ZdjecieTw`.** Ustalone
zapytaniami na bazie firmy, więc `ZDJECIA_*` przestają być zgadywanką —
komplet gotowych wartości leży w `wertis.env.example` i w opisie struktury.
Tabela ma `zd_IdTowar` (klucz obcy), `zd_Zdjecie` (obraz), `zd_Glowne`
(odpowiednik „Ustaw jako główną") i `zd_Id`.

**[wymaga działania]** Żeby włączyć zdjęcia: uruchom ponownie skrypt uprawnień
(doszedł **siódmy `GRANT SELECT`**, na `tw_ZdjecieTw`) albo instalator
z `-TylkoKonfiguracja`, wpisz sześć kluczy `ZDJECIA_*` do `wertis.env`
i zrestartuj `wertis-api`. Bez tego nic się nie zmienia.

### Klucz obcy nie rozstrzyga, które zdjęcie wziąć

Prawdziwa struktura obnażyła błąd, którego nie dało się zobaczyć bez niej.
Zapytanie kończyło porządek na kolumnie klucza, a w osobnej tabeli klucz jest
**obcy** — `zd_IdTowar` jest ten sam dla wszystkich zdjęć jednego towaru. Przy
dwóch zdjęciach bez flagi „główne" baza zwracałaby raz jedno, raz drugie;
objawem nie byłby błąd, tylko skaczący ETag i kolektory ściągające obraz przy
każdym wejściu na kartę — dokładnie to, czemu cały ten cache ma zapobiegać.

Porządek domyka teraz `ZDJECIA_KOLUMNA_KOLEJNOSC` (`zd_Id`), a **brak tego
ustawienia przy osobnej tabeli zatrzymuje start serwera**. Reguła jest
w walidacji, nie w komentarzu, bo tej pomyłki nie widać z ekranu.

### Lista tabel zamiast dwóch liczb, które się rozjeżdżają

Dodanie siódmego grantu natychmiast wywróciło test dopisany w 0.29.2 — próg
`Test-WertisUprawnienia` znowu został w tyle za skryptem i niepełny komplet
uprawnień znowu by przeszedł. To ten sam rozjazd co poprzednio, drugi raz pod
rząd, więc tym razem naprawa nie polega na przestawieniu liczby.

Tabele odczytu mieszkają teraz w **jednej liście** (`$script:WertisTabeleOdczytu`).
Skrypt generuje z niej granty, sprawdzenie bierze z niej próg, a testy liczą
z niej oczekiwanie. Dopisanie tabeli przestawia wszystko naraz — rozjazd nie
ma już jak powstać. Kreator przestał też podawać liczbę wpisaną w tekst
komunikatu.

### Czego przy okazji nie ma

`tw__Towar.tw_Logo` to `binary(50)` — pięćdziesiąt bajtów, więc nie zdjęcie.
Osobnej kolumny kolejności w `tw_ZdjecieTw` nie ma; „Sortuj" w Subiekcie
operuje kolejnością wierszy, którą odtwarza `zd_Id`. Są za to `zd_CRC`
i `tw_Zmiana.zt_ZmianaZdjecie` — pozwolą kiedyś wykrywać zmianę zdjęcia bez
pobierania obrazu, dziś rewalidację robi TTL.

---

## 0.30.0 — 8 sierpnia 2026

**Karta towaru pokazuje zdjęcie z Subiekta.** Magazynier po skanie widział
dotąd sam tekst, a nazwy się powtarzają — „nóż kosiarki" ma kilkanaście
kartotek. Zdjęcie odpowiada na pytanie zadawane przed wszystkimi innymi: czy
to na pewno TEN towar. Miniatura stoi w nagłówku karty, dotknięcie otwiera ją
na pełny ekran.

**[wymaga działania — opcjonalne]** Funkcja jest **domyślnie wyłączona**
i niczego nie zmienia, dopóki nie wskaże się źródła. Uruchomienie wymaga
ustalenia na własnej bazie, gdzie Subiekt trzyma zdjęcie — zapytania
w `docs/subiekt-gt-struktura.md`, rozdział „Gdzie Subiekt trzyma zdjęcie
kartoteki". Gdy zdjęcia leżą w osobnej tabeli, dochodzi **siódmy
`GRANT SELECT`** i ponowne uruchomienie skryptu uprawnień. Do tego nowe APK
przez MDM.

### Czego repozytorium nie wiedziało

Opis struktury InsERT GT nie wymienia ani jednej kolumny binarnej na
`tw__Towar`, a `tw_Opis` jest polem tekstowym — czyta je parser zamienników.
Gdzie naprawdę siedzi obraz, ustala się więc na kopii bazy; wszystkie nazwy
tabel i kolumn są `[WERYFIKUJ]` i mieszkają w JEDNYM pliku
(`adapters/zdjecia.sgt.ts`), tak jak wywołania COM w workerze Sfery.

Zakładka „Opis" w Subiekcie rozstrzygnęła jedną rzecz od razu: obok podglądu
stoją „Ustaw jako główną", „Sortuj" i strzałki, czyli **kartoteka może mieć
kilka zdjęć**. Kolektor pokazuje jedno i ma to być to samo, które biuro widzi
jako główne — stąd osobne ustawienia kolumny „główne" i kolumny kolejności.
Wybór bez ustalonego porządku byłby gorszy niż brak zdjęcia: `TOP 1` zwracałby
za każdym razem co innego, ETag skakałby, a kolektory pobierałyby obraz od
nowa przy każdym wejściu na kartę.

### Pół gigabajta, które nigdy nie jedzie

3415 kartotek po ~150 kB to ~500 MB. Import działa co 60 sekund na maszynie,
na której biuro wystawia faktury, więc zdjęcia **nie wchodzą do niego wcale**.
Zamiast tego cache przelotowy: pierwsze otwarcie karty pobiera jedno zdjęcie,
kolejne przez tydzień nie pytają o nic. Zmiana otwiera 100–300 kartotek, nie
3415 — pół gigabajta zamienia się w kilkaset pojedynczych zapytań po kluczu
głównym, wspólnych dla wszystkich kolektorów.

Cache siedzi w `server/data/zdjecia/` — **osobno od `data/photos/`**, i to nie
jest porządkowanie. Tamto są dowody do reklamacji, których nie wolno skasować
nigdy; to jest cache, który kasuje się sam po przekroczeniu limitu. Jeden
katalog na dwa takie cykle życia kończy się skasowanym dowodem.

### Zdjęcie jedzie przez Wi-Fi raz na towar

Karta jest odpytywana co dwie sekundy, więc zdjęcie nie mogło być jej polem —
150 kB w base64 w tym cyklu to ponad 4 MB na minutę z jednego kolektora. Jest
osobną trasą z ETagiem: kolejne wejście na kartę kończy się odpowiedzią „to
samo, co masz" o rozmiarze nagłówka. Kolektor trzyma pliki w pamięci trwałej
(nie w cache'u systemowym, który Android czyści właśnie wtedy, gdy brakuje
miejsca) — dzięki temu zdjęcie jest na ekranie także w martwej strefie hali.

Kartoteka bez zdjęcia jest zapamiętywana jako **potwierdzony brak**, na dobę.
Bez tego setki takich kartotek pytałyby Subiekta przy każdym otwarciu karty.
Błąd źródła to co innego niż brak zdjęcia i ponawia się po minutach, nie po
tygodniu — inaczej awaria sieci zapisałaby się jako trwale pusta karta.

### Slot ma stały rozmiar we wszystkich stanach

Ładowanie, zdjęcie, kartoteka bez zdjęcia i brak zasięgu wyglądają różnie, ale
zajmują tyle samo miejsca: element wskakujący po chwili przesuwa cele dotyku
pod kciukiem. Braku zdjęcia świadomie nie odróżniamy od braku zasięgu — dla
człowieka przy regale ta różnica nie jest wykonalna, a o braku sieci kolektor
mówi już globalnie.

---

## 0.29.2 — 8 sierpnia 2026

<!-- docs_check: historia -->
**Instalator przestaje meldować własną poprawną instalację jako niekompletną.**
`Test-WertisUprawnienia` żądało siedmiu `GRANT SELECT`, a skrypt uprawnień
nadaje sześć — od 0.16.0, kiedy razem z flagą sprawdzenia faktury wypadły
granty `fl_Wartosc` i `fl__Flagi`. Skrypt zszedł do sześciu, próg został przy
siedmiu i nikt tego nie zauważył, bo obie liczby żyły osobno.

Skutek dla instalującego: konto SQL z **kompletem** uprawnień nadanych przez
ten sam instalator kończyło etap czerwonym zdaniem „uprawnienia nie zgadzają
się z oczekiwanymi", a poniżej podpowiedzią „ma być 7". Naprawa jest jedną
cyfrą; wartość mają dopiero testy.

### Liczba bierze się teraz ze skryptu, nie z pamięci

Dwa nowe testy w `instalator/testy.ps1` **liczą granty w tekście skryptu**
i tę samą liczbę podają progowi. Rozjazd drugi raz nie przejdzie, a dopisanie
siódmego grantu (np. tabeli ze zdjęciami kartotek) przestawi oba naraz.
Trzeci test pilnuje reguły ważniejszej niż liczba tabel: prawo zapisu do
`dok__Dokument` ma odrzucać ocenę, choćby SELECT-ów było dość.

Przy okazji dwa zdania kreatora z tej samej epoki — jedno wymieniało kolumnę,
której instalator nie nadaje od 0.16.0, drugie podpowiadało siódemkę.

**[wymaga działania]** Nic — `git pull`, ponowne zbudowanie instalatora
(`instalator/build.ps1`), jeśli używasz wersji `.exe`.

---

## 0.29.1 — 8 sierpnia 2026

**Dokumentacja dogoniła workera Sfery.** Audyt `docs/architektura.md` przeciw
kodowi 0.29.0 znalazł osiemnaście rozjazdów — od „przyszłego workera COM",
który już istnieje, przez „zero modyfikacji stanów" (nieprawdziwe przy
`SFERA_WORKER=1`), po stare liczby tabel, typów zdarzeń, testów i workflowów.
Dokument mówi teraz prawdę: trzeci proces jest na diagramie, granica zapisu
nazywa oba warianty, niezmiennik „adres przed sprzedawalnością" wskazuje
swojego nowego strażnika (guard w zapytaniu wyboru), a lista `[WERYFIKUJ]`
jest kompletna. Przy okazji poprawione przestarzałe zdania „worker Sfery czeka
na wdrożenie" w pięciu innych dokumentach.

**Podgląd biura przestał kłamać w dwóch miejscach.** Zadanie ANULOWANE
pokazywało się jako „W DRODZE" (bursztyn obiecywał zapis, który świadomie
wycofano — teraz szara odznaka), a nowy rodzaj rekoncyliacji `mm_czeka`
wyświetlał surowy identyfikator zamiast nazwy.

**[wymaga działania]** Nic — `git pull`, `npm ci`, `npm run build`, restart
usług.

---

## 0.29.0 — 7 sierpnia 2026

**Przesunięcia magazynowe dostają wykonawcę: worker Sfery (`sfera-worker/`).**
Dokument MM — jedyna operacja, której nie da się bezpiecznie wystawić SQL-em —
ma teraz swój proces: osobna usługa Windows w C#/.NET, czytająca tę samą
kolejkę `sfera_queue` i wykonująca wyłącznie zadania `mm` przez COM Sfery.
Wymaga licencji Sfery; wywołania COM są oznaczone `[WERYFIKUJ]` i czekają na
potwierdzenie na maszynie testowej (wszystkie w jednym pliku
`sfera-worker/src/SferaComAdapter.cs`).

**[wymaga działania]** Nic dla istniejących instalacji: nowy przełącznik
`SFERA_WORKER` jest domyślnie **wyłączony** i wszystko działa jak dotąd
(MM kończy się czytelnym błędem, dokument wystawia biuro). Automatyzacja MM
to świadoma ścieżka: budowa exe wg `sfera-worker/README.md`, checklist
`[WERYFIKUJ]`, bramki z `docs/wdrozenie.md` („Dołączenie workera Sfery") —
wszystko najpierw na kopii bazy.

### Dlaczego

Rozkładanie kontenera kończyło się połowicznie: adres na półce zapisany,
a stan wisiał na MGP do ręcznego MM w biurze — każde przesunięcie lądowało
w kolejce jako czerwony błąd z przyciskiem PONÓW, który generował dokładnie
ten sam błąd. Sfera jest jedyną bezpieczną drogą do dokumentu MM (numeracja,
skutki magazynowe, wycena), a COM Sfery żyje tylko na Windows z Subiektem —
stąd osobny proces w C#, nie kod w serwerze Node.

### Podział pracy pilnowany z obu stron

Przy `SFERA_WORKER=1` worker Node **nie dotyka** zadań `mm` (filtr
w `pickTask`) — inaczej ubijałby je padającym adapterem SQL, zanim worker
Sfery zdąży je wziąć. Filtr to celowo `type <> 'mm'`, nie `= 'set_location'`:
zadanie nieznanego typu nadal dostaje czytelny błąd od Node'a zamiast wisieć
w ciszy.

### Niezmiennik „adres przed sprzedawalnością" przestał być dziełem przypadku

Przy jednym workerze kolejność wykonania była kolejnością wstawienia
(`ORDER BY id`) — dwa niezależne pollery łamią to konstrukcyjnie. Worker Sfery
pomija więc MM, dopóki wcześniejsze niewykonane `set_location` tego samego
towaru nie wejdzie; poprzednik w `error` **blokuje** (stan bezpieczny to
„adres zapisany, stan czeka"), a blokadę mierzy rekoncyliacja (nowy rodzaj
`mm_czeka`) i `/api/health`, więc nie ma cichego zakleszczenia. Zapytania
wyboru zadania mieszkają w `sfera-worker/sql/` i są wykonywane przez OBA
światy: C# jako zasób wbudowany, testy Node (`sfera-pick.test.ts`) wprost
z plików — jedno źródło prawdy, mierzone w CI bez dotneta.

### Bez nowych statusów, z pełnym audytem

Cały cykl życia mm mieści się w dotychczasowych statusach — enum na kolektorze
nie zna wartości domyślnej i nowy status wywróciłby deserializację na każdym
urządzeniu. Worker Sfery pisze te same zdarzenia audytowe
(`queue_retry`/`queue_applied`/`queue_failed`) z autorem z wiersza kolejki
i melduje się w `process_state` jak pozostałe procesy; `/api/health` przy
włączonym przełączniku raportuje blok `sfera` i zaległe MM. Padnięcie w trakcie
zapisu NIE wraca automatycznie do kolejki — zadanie ląduje w `error`
z ostrzeżeniem o możliwym duplikacie, bo COM mógł zdążyć z `Zapisz()`, a SQLite
nie; decyzję podejmuje człowiek (PONÓW).

### Instalator stawia trzecią usługę, gdy jest co stawiać

Gdy zbudowany `wertis-sfera-worker.exe` leży w `<katalog>\sfera-worker\`,
kreator pyta o włączenie, dopisuje `SFERA_WORKER`/`SFERA_OPERATOR*` do
`wertis.env` i rejestruje usługę `wertis-sfera`; bez exe — jedna linia
informacji i nic się nie zmienia. Restart i deinstalacja obejmują trzecią
usługę tylko wtedy, gdy istnieje.

---

## 0.28.0 — 4 sierpnia 2026

**Dostawca z własnym drukiem reklamacyjnym dostaje SWÓJ formularz.** Przycisk
FORMULARZ w podglądzie biura rozpoznaje dostawcę z dokumentu FZ: GEKO dostaje
swój „Protokół zgłoszenia reklamacji B2B" (tabela pozioma, przypisy, klauzula
RODO), PARTNER — swój protokół opisowy, strona na każdy wyjątek. Pozostali
dostawcy dostają protokół WERTIS jak dotąd.

**[wymaga działania]** Nic obowiązkowego. Warto raz wpisać dane firmy
(nazwa, NIP, adres, osoba kontaktowa) w sekcji REKLAMACJE podglądu biura —
nadrukują się na formularzach zamiast pustych kropek.

### Dlaczego

Serwis dostawcy rozpatruje reklamację ze SWOJEGO druku. Protokół WERTIS był
dla niego załącznikiem do przepisania: biuro przepisywało numer faktury, kod
towaru i opis usterki ręcznie do formularza GEKO albo PARTNER. Teraz wydruk
wychodzi od razu na właściwym druku, z wypełnionym tym, co system wie —
numer FZ, kod i nazwa towaru, ilość, rodzaj rozbieżności, opis.

Checkboxy zostają puste świadomie. Rodzaj usterki (mechaniczna/elektryczna)
i dowód zakupu klienta ostatecznego to wiedza biura, nie magazynu — udawanie,
że system ją ma, skończyłoby się błędnie zaznaczonym drukiem u dostawcy.

### Dane firmy żyją w przeglądarce

Druki dostawców pytają o dane zgłaszającego: nazwę firmy, NIP, adres, osobę
kontaktową. System ich nigdzie nie miał, bo nie są danymi magazynu. Mieszkają
teraz w localStorage przeglądarki biura, obok tokenu sesji — serwer nie musi
wiedzieć, jak firma się nazywa. Bez wpisanych danych formularz drukuje się
z kropkami do ręcznego uzupełnienia, jak oryginał.

### Rozpoznanie po nazwie, nie po identyfikatorze

Szablon wybiera fragment nazwy dostawcy (`GEKO`, `PARTNER`) z dokumentu FZ,
nie sztywny identyfikator kontrahenta. Nazwa rejestrowa w Subiekcie bywa
korygowana, a fragment przeżywa takie korekty. Zdjęcia dowodowe idą aneksem
za formularzem — na każdym z trzech szablonów tak samo.

---

## 0.27.0 — 4 sierpnia 2026

**Podgląd biura pokazuje metryki, kolejkę, rekoncyliacja i ślad audytowy.**
Trzy zakładki i pasek stanu widoczny z każdej z nich.

**[wymaga działania]** Nic. Zmiana dotyczy jednej strony HTML, którą serwuje
API — bez nowego APK i bez nowych uprawnień.

### Dlaczego

Te dane istniały od dawna i były dostępne **wyłącznie przez `curl`**.
Dokumentacja pisała o tym wprost: „metryki, rekoncyliacja i audyt są dostępne
przez REST", co w praktyce znaczyło, że nie oglądał ich nikt poza osobą, która
pisała ten kod. Biuro dostawało dwie karty o dostawach i nic więcej.

Najgorzej wypadał przez to `queue_failed` — najważniejszy wpis w całym
dzienniku. Magazynier zrobił swoje, kolektor przyjął, a do bazy firmy nic nie
weszło. Do dziś dowiadywało się o tym biuro, które akurat wpisało adres kolejki
w przeglądarce.

### Pasek stanu odpowiada na cztery pytania naraz

Wersja i tryb serwera, czy worker żyje, ile zadań stoi w błędzie, ile rozjazdów
zna rekoncyliacja. Stoi nad zakładkami, bo pytanie „czy zapisy wchodzą do
Subiekta" nie należy do żadnej z nich osobno. Kliknięcie prowadzi do szczegółu.

Martwy worker jest tu wyróżniony celowo: to jedyny stan, w którym aplikacja
wygląda na sprawną, a **żaden zapis nie dociera do bazy firmy**.

### Co świadomie zostało poza stroną

**Ponowienie zadania z kolejki.** Byłoby zapisem do Subiekta wykonanym przez
osobę, która nie stoi przy półce i nie wie, czy towar tam leży. Zasada „operacje
wykonuje się na kolektorze" jest starsza niż te zakładki i one jej nie zmieniają.

**Raport wydajności per osoba.** `GET /api/wydajnosc` istnieje i zostaje pod
REST-em. To monitoring pracowniczy w rozumieniu Kodeksu pracy (art. 22²):
wymaga zapisu w regulaminie i uprzedzenia ludzi na dwa tygodnie przed
uruchomieniem. Przycisk obok metryk zrobiłby z tego obowiązku przypadek, więc
pilnuje tego osobny test strony.

**Ślad audytowy zostaje za rolą.** Zakładka DZIENNIK czyta `GET /api/events`,
więc magazynier zalogowany w biurze zobaczy tam odmowę, a nie dane. Jedyną
trasą czytaną bez sesji jest `/api/health` — mówi o procesie, nie o towarze
ani o ludziach.

## 0.26.0 — 4 sierpnia 2026

**Mniej warstw, jedna kopia każdej reguły.** Przegląd architektury zdjął
z kodu to, co utrzymywało się bez pokrycia w potrzebie: fabrykę adaptera
o jednej implementacji, cztery kopie składania CSV, dwa moduły raportowe
z tą samą regułą w dwóch formach i dwa zakończone okresy przejściowe.

**[wymaga działania]** Nic. Nowego APK nie potrzeba — kolektor się nie
zmienił. Trasa `/sw.js` znika, ale komputery biura przeszły już przez jej
sprzątający skrypt.

### Co wypadło i dlaczego

**Fabryka i interfejs adaptera odczytu.** `makeSubiektAdapter()` od zawsze
zwracał jedną klasę, a interfejs miał jedną implementację — do tego część
serwisów i tak sięga do tabel `sgt_*` bezpośrednio. Została sama klasa
i alias typu; obietnica „podmienisz implementację", której nikt nie mógł
spełnić, zniknęła.

**Cztery kopie escapowania CSV.** Audyt, problemy, reslot i rekoncyliacja
składały pliki każde po swojemu i kopie zaczęły się rozjeżdżać w szczegółach
cytowania. Teraz jest jeden `services/csv.ts`; separatory zostały jak były
(`;` dla biura, `,` dla audytu — RFC 4180).

**Dwa moduły raportowe.** `metrics.ts` i `wydajnosc.ts` liczyły z tej samej
tabeli `events` i każdy niósł własną formę reguły odsiewu podwójnego
liczenia — a rozjazd tych kopii zawyżałby raport mierzący ludzi.
W `services/raporty.ts` reguła istnieje w jednym egzemplarzu. Trasy
`/api/metrics` i `/api/wydajnosc` odpowiadają dokładnie tym samym co dotąd.

**Wsady roczne w buildzie produkcyjnym.** `reslot` i `reconcile` chodzą
z checkoutu przez `npm run` — tak mówi ich własna dokumentacja. Wypadły
z `dist` i ze skryptów `start:*`; usługa niesie tylko to, co naprawdę chodzi
jako usługa.

**Dwa okresy przejściowe.** Trasa `/sw.js` (pogrzeb PWA usuniętej w 0.3.0)
zrobiła swoje. Klucze problemów sprzed 0.21.0 przestały być zapisywalne —
wszystkie kolektory mają już nowe APK. Etykiety historyczne zostają:
wyjątki z bazy muszą mieć nazwę na protokole dla dostawcy.

### Dokumentacja: jedno źródło prawdy na temat

Instrukcje operacyjne mieszkają teraz wyłącznie w `DEPLOY.md` — instalator
jako właściwa droga, procedura ręczna jako jego dokumentacja odniesienia,
plus nowy §8 o odinstalowaniu. `docs/wdrozenie.md` zwęża się do wdrożenia
organizacyjnego i nie zawiera ani jednego bloku poleceń. README oddał
treści krok-po-kroku i przestał twierdzić, że bufor offline używa Room —
to plik JSON + WorkManager, jak było od początku.

Audyt lustra DTO (`Dtos.kt` ↔ `types.ts`) pokazał, że każdy typ jest
używany — nie było czego wycinać. Nagłówki obu plików mówią teraz o sobie
nawzajem, zamiast odsyłać do klienta webowego usuniętego w 0.3.0.

Świadomie NIE ruszone: mechanika MM z `waiting_for_doc` (kolejka z błędem
„MM wystawia biuro" jest listą zadań biura), `env-file.ts`, narzędzia
w `tools/` i instalator.

---

## 0.25.0 — 4 sierpnia 2026

**`npm run seed:scenariusze` buduje 66 przypadków brzegowych w bazie demo.**
Kolizję kodów, cudzą blokadę pozycji, zadanie w błędzie sprzed trzech dni,
zdjęcie bez pliku i adres spoza wzorca — wszystko naraz, jednym poleceniem.

**[wymaga działania]** Nic. Nowego APK nie potrzeba, a na produkcji ten skrypt
się nie uruchomi.

### Dlaczego

`npm run seed` zasila kartotekę i kilkanaście dostaw. Wystarcza to do ścieżki
codziennej i do niczego więcej. Sprawdzenie wyjątku, kolejki albo rekoncyliacji
wymagało zbudowania stanu ręcznie — a po każdym skasowaniu bazy od nowa.

Części z tych stanów nie dało się zbudować z ekranu **wcale**. Nikt nie wystawi
z kolektora zadania, które czeka w buforze od pięciu dni, ani zdarzenia sprzed
wprowadzenia kont. Właśnie te przypadki są najdroższe w naprawie, bo nikt ich
nie ogląda przed wdrożeniem.

### Katalog jest jednym bytem, nie dwoma

Scenariusze mają numery (`S01`–`S66`), a ich opisy leżą
w `docs/scenariusze-testowe.md`. Zgodności katalogu z dokumentacją pilnuje test,
nie oko: scenariusz bez opisu i opis bez scenariusza zapalają się na czerwono.

To ta sama decyzja, co przy `tools/docs_check.py`. Komentarz „pamiętaj
zaktualizować" nie jest mechanizmem.

### Trzy reguły, które ten seed na siebie nakłada

**Nie tyka danych spoza swojego zakresu.** Kartoteki scenariuszy mają `tw_id` od
900001, dokumenty `dok_id` od 9001, konta własne loginy. Uruchomienie po
`npm run seed` niczego z niego nie kasuje.

**Jest idempotentny.** Każde uruchomienie kasuje najpierw własne wiersze, potem
buduje je od nowa. Da się nim wrócić do punktu wyjścia w środku pracy, bez
kasowania bazy.

**Nie uruchomi się przy `SGT_MODE=mssql`.** Zakłada konta ze znanym hasłem
i wystawia gotowe tokeny sesji, czyli robi dokładnie to, czego na bazie firmy
robić nie wolno. Odmowa jest tu jedynym zabezpieczeniem, bo polecenie wygląda
równie niewinnie jak `npm run seed`.

### Raport przeslotowania w końcu ma co liczyć

`npm run reslot -- --demo` odmawiał wypisania list eksmisji, awansów
i likwidacji — zawsze, od pierwszego dnia. Bezpiecznik działał poprawnie: bez
historii pobrań każdy indeks wygląda na martwy, więc raport kazałby opróżnić całą
strefę złotą. Tyle że seed nie zawierał **ani jednego** dokumentu WZ, więc
jedyna funkcja mierząca pracę magazynu nie dawała się zobaczyć przed wdrożeniem.

Seed scenariuszy zasila historię pobrań i ostatnie zakupy, więc raport wypisuje
wszystkie cztery listy. Liczby są syntetyczne i tak trzeba je czytać: nadają się
do sprawdzenia raportu, nigdy do decyzji o magazynie.

### Czego ten seed NIE zastępuje

Nie jest testem. Nie sprawdza niczego sam i nie zapali się na czerwono, gdy
aplikacja się zepsuje — daje wyłącznie stan, w którym da się to zobaczyć okiem.
Testy jednostkowe zostają tam, gdzie były.

### Poprawka po zderzeniu z 0.24.0
<!-- docs_check: historia -->

Ten wpis stał przez chwilę pod numerem 0.24.0, czyli pod cudzym. Obie zmiany
powstawały równolegle i scalenie skleiło je pod jednym nagłówkiem, a razem z nimi
weszła na `main` czerwona kontrola dokumentacji: `docs/scenariusze-testowe.md`
nazywał `tryb_serwisowy_start`, wycofany w 0.24.0 tego samego dnia.

Scenariusze idą za kodem, więc dziennik demo niesie dziś zdarzenia zarządzania
kontami (`user_created`, `user_active_changed`), a nie tryb serwisowy. Doszła
też **czwarta rola**: konto `admin.test` i scenariusz S66 na trzy operacje, które
umie sam admin — konto biurowe, odebranie hasła i wyłączenie konta.

Konta `admin` z `npm run seed` seed scenariuszy nie tyka. Nie zna jego hasła,
a podmiana cudzego byłaby najgorszym możliwym skutkiem polecenia, które ma
wyłącznie dopisywać dane.

---

## 0.24.0 — 4 sierpnia 2026
<!-- docs_check: historia -->

**Konto administratora zakłada instalator, a loguje się ono jak każde inne.**
Tryb serwisowy z 0.23.0 zostaje wycofany po jednym wydaniu.

**[wymaga działania]** Nowy APK. Jeśli gdziekolwiek ustawiłeś `WERTIS_ADMIN=1` —
usuń wpis; zmienna nie robi już nic, a jej obecność myli przy następnej
diagnozie.

### Dlaczego z powrotem

0.23.0 rozwiązywała prawdziwy problem — świeża baza nie ma konta — ale
rozwiązywała go **obejściem bramki**: brak sesji przestawał znaczyć „odmowa".
Cena była nazwana już wtedy i właściciel ją teraz odrzucił: dziennik z takiego
okresu nie mówi, kto co zrobił, a instalacja z zapomnianą flagą stoi otworem dla
całej sieci hali.

Problem zostaje ten sam, więc rozwiązujemy go tam, gdzie powstaje: **konto ma
istnieć, a nie być udawane**. Instalator pyta instalującego o login i hasło
i zakłada konto zaraz po starcie usług. `npm run seed` robi to samo dla pracy
nad kodem — hasło bierze z `ADMIN_HASLO` albo losuje i pokazuje raz.

Instalator hasła **nie wypisuje, tylko o nie pyta** — i to jest cała różnica
wobec zdania, które stało dotąd w `instalator/README.md` („nie zakłada kont
pracowników, bo wypisywanie loginów i haseł na monitorze byłoby krokiem w złą
stronę"). Zdanie zostało odwrócone świadomie.

### Czwarta rola i dziura, która wyszła po drodze

Rola `admin` może dwie rzeczy więcej niż biuro: zakładać konta **o roli `biuro`
i `admin`** oraz wyłączać konta i odbierać hasła. Poza tym jest równa biuru —
audytu ani raportu wydajności świadomie nie dostaje, bo raport o pracy ludzi
zostaje tam, gdzie był.

To rozdzielenie zamyka dziurę, która istniała wcześniej i nie była hipotezą:
„zarządzanie kontami" było **jedną** operacją, więc biuro zakładało konto biura
z własnym hasłem. Rola strzegąca tożsamości rozdawała ją sama sobie.

Druga rzecz wyszła przy pisaniu tej zmiany i była poważniejsza: `POST /api/users`
brał `role` prosto z ciała żądania, `createUser` wkładał je do `INSERT`, a kolumna
`role` nie ma `CHECK`. **Do bazy wchodziło dowolne słowo, łącznie z `admin`.**
Dopóki tak było, cała ta zmiana byłaby dekoracją. Rola jest teraz sprawdzana
przeciw zamkniętej liście i to jest najważniejszy nowy test w tym wydaniu.

### Cena, którą warto znać

**Biuro nie zresetuje hasła magazynierowi, który je zapomniał** — musi poprosić
admina. To wynika wprost z wyboru właściciela, a nie ze splotu okoliczności;
przeniesienie `:id/haslo` z powrotem do biura jest zmianą jednej linii
w `WYMAGANA_ROLA`.

Pierwsze konto na pustej bazie dostaje teraz rolę `admin`, nie `biuro` —
inaczej instalacja postawiona kreatorem na kolektorze nie miałaby jak dorobić
się kogokolwiek, kto zakłada konta biura.

### Co zostaje z 0.23.0

Refaktor sesji. Bramka rozpoznaje sesję raz na żądanie i trasy czytają wynik
z kontekstu zamiast pytać bazę po raz drugi — to była zmiana niezależna od
trybu i przeżyła jego wycofanie.

### Przy okazji: dwa testy instalatora nigdy się nie wykonały

<!-- docs_check: historia -->

`instalator/testy.ps1` kończy się `exit 0`, a dwa testy dopisane w 0.23.0 stały
**po** tej linii. W opisie PR-a napisałem, że przełącznika „pilnuje jego własny
zestaw testów" — to była nieprawda i wychodzi dopiero teraz. Martwy kod za
`exit 0` usunięty, nowe testy stoją przed sekcją wyniku.

**Znalezione, poza zakresem:** `GET /api/wydajnosc` nie sprawdza roli, choć
komentarz obok mówi „dla biura, nie dla kolektora". Dane per pracownik są dziś
dostępne każdej zalogowanej sesji. Nie ruszam tego w tym wydaniu, ale to jest do
zrobienia.

---

## 0.23.0 — 4 sierpnia 2026

<!-- docs_check: historia -->

> **Wycofane w 0.24.0**, po jednym wydaniu. Wpis zostaje, bo „wprowadziliśmy
> i wycofaliśmy" jest samo w sobie informacją — a powody, dla których to
> rozwiązanie wyglądało dobrze, warto mieć zapisane obok powodów, dla których
> nie wystarczyło.

**Przełącznik `WERTIS_ADMIN=1` wyłącza logowanie w całości — na kolektorze
i w podglądzie biura naraz.** Do pracy nad kodem, nigdy u klienta.

**[wymaga działania]** Nowy APK. Zmiennej nie ustawiaj na produkcji; instalator
jej nie zapisuje.

### Dlaczego

<!-- docs_check: historia -->

Postawienie WERTIS od zera kończy się krokiem, którego nie da się
zautomatyzować: ktoś musi ręcznie założyć pierwsze konto. Seed go nie zakłada,
instalator też nie. Przy bazie kasowanej kilka razy dziennie to piąty krok
w czterokrokowej procedurze — i wykonywany **dwa razy**, bo podgląd biura ma
własne logowanie i na pustej bazie jest ślepym zaułkiem.

### Konto bez hasła, i to jest sedno

<!-- docs_check: historia -->

Operacje w tym trybie podpisuje konto `ADMIN (TRYB SERWISOWY)`. Jest prawdziwym
wierszem w bazie, bo dziennik zdarzeń wskazuje na konta kluczem obcym — ale
**nie ma ani loginu, ani hasła**:

- nie da się nim zalogować żadną drogą, także po ręcznym nadaniu hasła;
- nie ma domyślnego hasła do wycieknięcia;
- nie dostaje tokenu sesji, więc **wyłączenie przełącznika odbiera dostęp
  natychmiast** — nie ma czego unieważniać.

Reguła „żadnych domyślnych haseł" zostaje więc nienaruszona. Zapisaliśmy ją
przy okazji wprost w `DEPLOY.md`, bo dotąd trzymał się jej wyłącznie kod.

### Co świadomie tracimy

<!-- docs_check: historia -->

**Dziennik z tego okresu nie mówi, kto co zrobił.** Wszystko jest podpisane
jedną nazwą — dlatego nazwa krzyczy, żeby historia z trybu serwisowego była
odróżnialna od pracy ludzi także za pół roku. Zalogowanie się prawdziwym kontem
dalej działa i wtedy operacje dostają nazwisko.

**Dwa skutki przeżywają wyłączenie przełącznika**: konta założone w tym trybie
i hasła w nim ustawione. Sam dostęp znika z chwilą wyłączenia, te dwie rzeczy
nie.

### Widać z trzech stron

<!-- docs_check: historia -->

Czerwony pasek na każdym ekranie kolektora i w biurze, `ok: false`
w `/api/health` z ostrzeżeniem na pierwszym miejscu, wpis
`tryb_serwisowy_start` w dzienniku. Przy `SGT_MODE=mssql` ostrzeżenie jest
ostrzejsze, ale tryb **nie jest blokowany**: Subiekt edu też jest trybem
`mssql`, a to jedyne środowisko, dla którego ten przełącznik powstał.

Sam wiersz `ADMIN (TRYB SERWISOWY)` w tabeli kont jest dowodem, że tryb
kiedykolwiek na tej instalacji chodził — konto powstaje wyłącznie przy włączonej
fladze.

### Przy okazji: trasy przestały pytać bazę o sesję

<!-- docs_check: historia -->

<!-- docs_check: historia -->

Bramka rozpoznaje sesję raz na żądanie, a osiem miejsc w czterech plikach
pytało o nią PONOWNIE, każde po swojemu. Poza podwójnym zapytaniem do bazy
znaczyło to, że „kto pyta" miało osiem niezależnych odpowiedzi zamiast jednej —
i tryb serwisowy wpuszczałby do odczytów, a odbijał od zarządzania kontami
i audytu. Odkryte przy pisaniu tej zmiany, naprawione osobnym commitem przed
nią.

---

## 0.22.1 — 4 sierpnia 2026

Dwa miejsca, w których konfiguracja obiecywała elastyczność, a kod jej nie
dowoził. Nic tu nie zmienia ekranu — to poprawki, których objawem byłby
dokument pod cudzą nazwą albo karta towaru milcząca o dostawie.

### Typ dokumentu tłumaczył się w dwóch miejscach, każde po swojemu

<!-- docs_check: historia -->

Subiekt trzyma typ dokumentu jako liczbę, read-model jako napis. Tłumaczenie
stało w dwóch plikach i **oba miały inny błąd**:

- importer (`adapters/subiekt.mssql.ts`) miał gałąź `else` — każdy kod inny niż
  FZ lądował w bazie jako **`PZ`**, czyli pod cudzą nazwą;
- odczyt (`adapters/subiekt.seeded.ts`) miał filtr — kod spoza pary FZ/PZ
  **wypadał** z listy etykiet.

Skutkiem było to, że dopisanie trzeciego typu do `DOK_TYPY_DOSTAW` — czynność
na jedno ustawienie — dawało dokumenty z fałszywym symbolem na ekranie
magazyniera, bez jednego słowa błędu po drodze. Test pilnował przy tym starego
zachowania, więc **utrwalał błąd zamiast go łapać**.

Teraz jedno źródło prawdy (`adapters/typy-dokumentow.ts`). Kod bez nazwy
dostaje symbol `TYP-<kod>`: brzydki, ale widoczny i nieudający niczego innego.
Że czegoś nie nazwano, mówi `/api/health` — razem z osobną uwagą o kodzie
zamówienia do dostawcy wpisanym między dostawy, bo to pomyłka co do znaczenia,
nie co do nazwy.

### Okno dostaw było w dwóch miejscach

`services/dostawy-towaru.ts` miał własną stałą `14` z komentarzem „tyle samo,
co lista w zakładce rozkładania" — czyli zgodności pilnowało zdanie, nie
mechanizm. Po zmianie `DOK_DNI_WSTECZ` na 30 karta towaru mówiłaby „nic nie
przyszło" o dokumencie wiszącym obok w zakładce rozkładania. Okno idzie teraz
z konfiguracji.

---

## 0.22.0 — 4 sierpnia 2026

<!-- docs_check: historia -->

**Kontener rozkłada się jak każda inna dostawa, a przesunięcie stanu przestało
być końcem sesji — stało się osobną czynnością dostępną z karty towaru.**

**[wymaga działania]** Nowy APK oraz kopia bazy przed aktualizacją: migracja
kasuje dwie tabele (szczegóły niżej).

### Dlaczego, skoro pół roku temu zapisaliśmy coś przeciwnego

<!-- docs_check: historia -->

Wpis 0.17.0 mówi wprost: *„tryb B (kontener, 4× w roku) zostaje nietknięty"*.
Wtedy była to decyzja poprawna — tryb kontenerowy był **jedynym konsumentem**
dokumentu MM, więc jego usunięcie zabrałoby MM ostatnie wejście.

Zmieniło się to, że proporcje przestały się bronić. Dwie tabele, dziesięć
funkcji serwisu, osiem tras i 803 linie Compose obsługiwały proces zdarzający
się cztery razy w roku — i cała ta machineria prowadziła do jednego wywołania,
które na produkcji rzuca wyjątkiem, bo workera Sfery nie ma.

Jednocześnie najzwyklejszego pytania nie dało się zadać: **„towar leży na MGP,
jak go przenieść na halę, nie otwierając sesji kontenerowej"**. Trasa
`POST /api/mm` istniała i została wycięta właśnie dlatego, że jedynym wejściem
miał być wózek.

### Co znika

<!-- docs_check: historia -->

Sesja z wózkiem w całości: `putaway_sessions` i `putaway_items`,
`services/putaway.ts` (441 linii), `routes/putaway.ts` (82), osiem metod API,
osiemnaście DTO kolektora, dwa ekrany i **tryb marszu** — nakładka „NASTĘPNE"
po zatwierdzeniu wózka, która istniała wyłącznie w sesji. `enum Screen` schodzi
z 13 na 11.

Zakładka KONTENERY też znika. Dokumenty z MGP wpadają do zwykłej listy dostaw,
oznaczone pastylką **przyjęcia**.

### Co świadomie tracimy

**Jeden dokument MM na rundę wózka.** Przesunięcie powstaje teraz per pozycja,
więc przy tysiącu kartonów będzie ich znacznie więcej niż kilkanaście. To jest
największa cena tej zmiany i trzeba ją znać przed najbliższym kontenerem.

**Historię sesji.** Migracja kasuje obie tabele, więc odpowiedź na pytanie „kto
rozkładał kontener w marcu" znika. Zdarzenia w dzienniku (`putaway_session_open`,
`putaway_confirm`, `putaway_commit_cart`) **zostają** — dziennik pamięta
czynność, traci tylko jej szczegóły, a `sessionId` w ich treści nie wskazuje już
na nic.

**Dodawanie towaru spoza dokumentu**, „pomiń z powodem" i zamknięcie sesji
z rozliczeniem. Pierwsze zastąpiło zgłoszenie „artykuł niezamówiony" z 0.21.0,
które robi to lepiej: trafia do formularza reklamacyjnego, a nie do wózka.

**Kontener kosztuje teraz dwa przejścia**: adresy przy rozkładaniu, potem
przesunięcia. Skrót „PRZESUŃ NA HALĘ" w wierszu dostawy skraca drugie z nich do
jednego dotknięcia, ale go nie eliminuje.

W zamian kontener dostaje wszystko, czego sesja z wózkiem nie miała nigdy:
zgłaszanie wyjątków ze zdjęciem, przycisk INNA ILOŚĆ, eksport problemów do CSV,
panel rozjazdu lokalizacji i auto-domknięcie dokumentu.

### Przesunięcie stanu

Jedna trasa, `POST /api/przesuniecie`, dla dowolnej pary magazynów. Wychodzi
z trzech miejsc: kafla magazynu na karcie towaru, podlinijki „MGP N" w nagłówku
karty oraz z rozwiniętego wiersza kontenera.

- **Kolejka jest zarazem rezerwacją.** Dostępne to stan minus przesunięcia
  czekające na workera, więc drugie przesunięcie widzi już pomniejszony stan.
  Bez tego dwa zgłoszenia zrobione przed przejściem kolejki wysłałyby sumę
  większą niż stan, a odmowa przyszłaby godzinę później i bez człowieka przy
  palecie.
- **Adres przed stanem.** `set_location` idzie do kolejki przed `mm` — ten sam
  niezmiennik, który wcześniej pilnował rundy wózka, razem z uzasadnieniem.
- **Skan półki obowiązkowy przy celu MAG, zabroniony przy innym.** Pole
  lokalizacji w kartotece jest jedno na towar i opisuje regał na hali; zapisane
  przy przesunięciu na inny magazyn wskazywałoby półkę, na której towaru nie ma.
- **Bez bufora offline**, świadomie inaczej niż zapis lokalizacji. Bufor
  przechowuje intencję, a walidacja liczy się w chwili zapisu.

Siedemnaście testów serwera i dziewięć w `:core`. Tryb kontenerowy nie miał ani
jednego testu serwera przez cały czas swojego istnienia.

### Czego ta zmiana NIE naprawia

**Dokument MM na produkcji dalej się nie tworzy.** Worker Sfery to Etap 2
wdrożenia i nie powstał; zadanie po trzech próbach ląduje w `error`, a dokument
wystawia biuro. Nowość polega na tym, że **arkusz mówi o tym przed dotknięciem
przycisku**, a nie po fakcie czerwoną pastylką kolejki.

**Adres po przesunięciu Z hali nie jest czyszczony.** Stan na MAG może spaść do
zera, a adres w kartotece zostaje — to zasila problem, który mierzy raport
przeslotowania. Czyszczenie adresu przy stanie zero to osobna decyzja.

**`waiting_for_doc` rezerwuje stan bez limitu czasu.** Zadanie wstrzymane na
dokumencie w buforze liczy się do „w drodze", a rekoncyliacja sygnalizuje je
dopiero po 72 godzinach.

### Stare bazy

<!-- docs_check: historia -->

Migracja kasuje `putaway_items`, a potem `putaway_sessions` — **w tej
kolejności**, bo baza chodzi z `PRAGMA foreign_keys = ON` i rodzic skasowany
przed dzieckiem wywaliłby start API oraz workera naraz. Kolumna
`sfera_queue.session_id` **zostaje** jako martwa: kolumn ze starych baz się nie
kasuje, a przebudowa tabeli trzymanej otwartej przez workera kosztowałaby bez
żadnego zysku. Ten sam wybór co przy 0.17.0.

Seed nadawał kontenerowi typ `PZ` z parzystości, a domyślne `DOK_TYPY_DOSTAW`
zna tylko `FZ`. Po objęciu MGP filtrem typu kontener wypadłby z demo bez jednego
słowa błędu — typ idzie teraz z konfiguracji.

---

## 0.21.0 — 3 sierpnia 2026

Zgłoszenie niezgodności na kolektorze zbiera teraz **dokładnie to, czego żąda
firmowy formularz „Niezgodność w dostawie"**. Do tej pory były to dwa różne
zestawy pól: magazynier wypełniał jeden przy palecie, biuro przepisywało drugi
do formularza dla dostawcy, a różnicę uzupełniało z pamięci i po fakcie.

**[wymaga działania]** Nowy APK. Do czasu rozesłania przez MDM kolektory ze
starym APK zgłaszają po staremu — serwer to przyjmuje, patrz niżej.

### Pięć kategorii z formularza zamiast siedmiu własnych typów

<!-- docs_check: historia -->

Lista zgłoszeń to teraz: **błędny artykuł**, **brak w przesyłce**, **uszkodzone
w transporcie**, **zła ilość**, **artykuł niezamówiony**. `wrong_item`
i `damaged` zachowały klucze, bo znaczą to samo co w formularzu — zmiana klucza
osierociłaby historię bez żadnego zysku.

Odchodzą: „za mało" i „za dużo" (zastąpione przez „złą ilość", która niesie
obie liczby naraz), „brak miejsca" i „nieznany kod". **Strata jest realna:**
magazynier traci sposób na powiedzenie „nie mam gdzie tego położyć". Kolizja
EAN ma własny mechanizm (`GET /api/ean-conflicts`) i nie potrzebowała pozycji
na tej liście.

Przy okazji doszło coś, czego wcześniej nie dało się zgłosić w ogóle: **artykuł
spoza dokumentu**. Skan towaru, którego nie ma na fakturze, kończył się toastem
„X nie jest w tym dokumencie" i niczym więcej. Teraz jest zgłoszeniem
z numerem katalogowym.

### Serwer przyjmuje stare klucze, choć kolektor ich nie oferuje

<!-- docs_check: historia -->

`git pull` przestawia serwer od razu, a APK czeka na MDM. Gdyby serwer odrzucał
`qty_short`, każdy nierozesłany kolektor dostawałby 400 przy palecie, w rękawicy,
w środku dostawy — przez cały czas wdrożenia. Klucze sprzed 0.21.0 są więc dalej
zapisywalne i **na zawsze nazywalne**: protokół dla dostawcy nie może pokazywać
surowego `qty_short`. Listę `TYPY_HISTORYCZNE` da się skasować, gdy wszystkie
kolektory będą miały nowy APK.

### Co arkusz pyta, a czego nie

Ilości wymaga **każda** kategoria — tak jak formularz. Zdjęcie zostaje
obowiązkowe przy uszkodzeniu i błędnym artykule. Nowe pola:

- **numer katalogowy** artykułu spoza dokumentu (błędny / niezamówiony) — nie
  ma linii, z której dałoby się go odczytać;
- **„a miało przyjść"** przy błędnym artykule — zwinięte, bo formularz ma to
  pole jako opcjonalne;
- **numer przesyłki i protokół kuriera** — pytane RAZ na dostawę i zapisywane
  na dostawie (`POST /api/delivery/:id/przesylka`), nie przy zgłoszeniu.
  Przesyłka jest jedna; wpisana przy każdym uszkodzonym artykule z osobna
  mogłaby się różnić sama ze sobą.

Nie pyta o numer faktury, dostawcę ani numer katalogowy pozycji z dokumentu —
to wszystko już jest w bazie. **Symbol z Subiekta JEST numerem katalogowym
dostawcy**, więc pytanie o niego byłoby przepisywaniem z ekranu na ekran.

Zgłoszenie zapisuje też **ilość z dokumentu jako snapshot**. Odczyt „na żywo"
przy druku protokołu pokazywałby stan po ewentualnej korekcie faktury
w Subiekcie, a protokół ma mówić, co widzieliśmy przy palecie.

### Czego ta zmiana NIE robi

Pole formularza **„Co zrobić z…?"** (do zwrotu / zafakturować / dołożyć do
kolejnego zamówienia / pilnie przysłać / korekta) zostaje po stronie biura —
decyzja handlowa nie zapada przy palecie. Kolumny na nią nie ma: kanał bez
odbiorcy to dokładnie ten kształt, który repo wycięło w 0.16.0 i 0.17.0.

Protokół dla dostawcy w `/biuro` i eksport CSV **zostały bez zmian**. Nowe pola
są w bazie i w API, ale nie na wydruku — dołożenie ich to osobna zmiana jednego
pliku.

### Ryzyko, które zostaje

Zgłoszenie **nie ma bufora offline** — arkusz woła API synchronicznie. Przy
uszkodzeniu z numerem przesyłki to najdłuższa ścieżka w aplikacji, a zerwane
Wi-Fi kasuje całość. Dlatego numer przesyłki idzie na serwer **przed**
zgłoszeniem: jeśli sieć padnie w połowie, zostaje to, czym przewoźnik odnajduje
paczkę.

---

## 0.20.1 — 3 sierpnia 2026

Przygotowanie pod przebudowę zgłaszania niezgodności w dostawie na wzór
firmowego formularza reklamacyjnego. Nic tu jeszcze nie zmienia ekranu — to
dwie rzeczy, bez których ta przebudowa poszłaby na ślepo.

### Wyjątki dostają testy po stronie serwera

`raiseProblem`, `resolveProblem` i `exportCsv` nie miały ani jednego. Reguły
kolektora (`core/problem/ProblemModel.kt`) mają test od początku, ale są
uprzejmością wobec człowieka w alejce, a nie bramką: stary APK albo `curl`
z sieci hali trafia wprost do serwisu. Trzynaście testów pilnuje teraz
walidacji, skutku dla linii dostawy, ponownego rozwiązania wyjątku oraz CSV —
łącznie z tym, że średnik wpisany w opis nie rozwala kolumn.

### Słownik typów zamiast trzech kopii

<!-- docs_check: historia -->

Lista typów wyjątku żyła w trzech miejscach: `services/problems.ts`,
`ProblemModel.kt` i `biuro.html`. Zgodności pilnował tylko test kotlinowy, więc
dopisanie typu na serwerze zostawiało stronę biura z surowym kluczem
(`qty_short`) na protokole dla dostawcy — i nikt by tego nie zauważył przed
wysłaniem.

`ProblemView` niesie teraz `typLabel` prosto z serwera, a strona biura straciła
własny słownik. Kolektor swoją kopię **zachowuje świadomie**: etykiety muszą być
na ekranie także wtedy, gdy Wi-Fi padło w połowie hali. Dwie kopie zamiast
trzech, obie z testem.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Bez zmian w bazie i bez
nowego APK — starszy kolektor po prostu ignoruje nowe pole.

## 0.20.0 — 1 sierpnia 2026

<!-- docs_check: historia -->

Wejście do WERTIS to **login i hasło** — na kolektorze, w biurze i w curl-u.
Skan plakietki `PRC-0007-3` i PIN przy operacjach nieodwracalnych wychodzą
z aplikacji.

### Dlaczego

Plakietka była szybka: jeden skan, około sekundy, bez wpisywania czegokolwiek
w rękawicach. Była też własnym, osobnym mechanizmem w firmie, która wszędzie
indziej loguje się loginem i hasłem — czyli drugą rzeczą do wytłumaczenia
każdej nowej osobie i drugim zbiorem etykiet do wydrukowania i pilnowania.

Cena jest realna i warto ją znać: wejście na kolektor kosztuje teraz kilkanaście
sekund zamiast jednej, a razem z PIN-em znika drugi czynnik przy operacjach,
których nie da się cofnąć. Porzucony zalogowany kolektor pozwala obcej osobie
na wszystko, co może jego właściciel.

### Co się zmienia w API

<!-- docs_check: historia -->

| było | jest |
|---|---|
| `POST /api/auth/badge` | `POST /api/auth/login` z ciałem `{login, haslo}` |
| `POST /api/auth/handover` | znika — zmiana osoby to wylogowanie i zalogowanie |
| `POST /api/users/:id/pin` | `POST /api/users/:id/haslo` |
| `pinAutora` w ciele żądania | nic — rozstrzyga rola z sesji |
| — | `POST /api/auth/haslo` do zmiany własnego hasła |

Hasło leży wyłącznie jako hasz (scrypt, sól per konto), minimum osiem znaków,
bez wymagań na wielkie litery i znaki specjalne. Nieznany login i błędne hasło
dają jeden komunikat i ten sam czas odpowiedzi. Pięć nieudanych prób zamyka
login na minutę — odpowiedzią jest 429, nie 401, bo kolektor po 401 kasuje
operację z bufora offline.

### Hasło mogło wyciec do logu serwera

Przy okazji wyszła dziura, która istniała już wcześniej.
`WedgeKeySource.textFieldFocused` było flagą `bool` ustawianą przez każde pole
tekstowe. Kolejność zdarzeń fokusu między dwoma polami nie jest gwarantowana,
więc spóźnione „stracił fokus" zostawiłoby zbieranie znaków włączone przy
aktywnym polu hasła — a wtedy wpisane hasło pojechałoby jako skan do
wyszukiwarki towarów i wylądowało w `events`. Flaga jest teraz licznikiem,
a na ekranie logowania skaner jest wyłączony.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług, nowy APK przez MDM.

1. **Migracja bazy jest automatyczna, ale kasuje wszystkie sesje.** Zrób
   aktualizację **poza godzinami pracy** i upewnij się, że kolektory wysłały
   bufor (`GET /api/queue` pusty) — operacja czekająca w buforze offline ginie
   przy odmowie 401.
2. **Konta zakłada się od nowa.** Stare zostają jako ślady w audycie: bez
   loginu i bez hasła, żeby `events.user_ref` miało na co wskazywać. Furtka
   pierwszego konta otwiera się sama, bo liczy konta z loginem — załóż konto
   biura z kolektora (**ZAŁÓŻ KONTA**) albo curl-em z DEPLOY §5a.
3. **Plakietki idą do kosza.** Zeskanowane na ekranie głównym pojadą teraz jako
   zwykły tekst do wyszukiwarki towarów.

## 0.19.0 — 1 sierpnia 2026

<!-- docs_check: historia -->

Serwer odpowiada pod `/sw.js` skryptem, który **grzebie starą aplikację
webową**. Nic poza tym się nie zmienia.

### Skasowany kod potrafi dalej stać na ekranie

Aplikacja webowa („Kolektor magazynowy · prototyp v0.2") wyszła z repo
26 lipca w 0.3.0 — katalog `web/`, trasy `/lookup` i `/`, `@fastify/static`.
Mimo to na komputerze, który ją kiedyś otworzył, dalej wita splash z napisem
„Dotknij, aby rozpocząć". Była PWA: `vite-plugin-pwa` zostawił service workera
z precache całej powłoki, a taki worker odpowiada na żądanie **zanim** ruszy ono
do sieci. Kasowanie kodu na serwerze nie mogło tego naprawić, bo serwer o tych
żądaniach nie wiedział.

Wyjście prowadzi przez ten sam adres, spod którego worker został zainstalowany.
Przeglądarka sama sprawdza `sw.js` przy wejściu na stronę, a nowy skrypt bez
rejestracji zdarzeń wymiata poprzednika: kasuje cache, wyrejestrowuje się
i przeładowuje otwarte karty. Po tym `/` pokazuje to, co ma pokazywać —
przekierowanie do podglądu biura.

To jednorazowe sprzątanie, nie funkcja. Trasa może zniknąć, gdy żaden komputer
w firmie nie będzie już miał starej PWA.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Potem na każdym komputerze
biura raz wejść na `http://serwer:3001/` i odświeżyć. Jeśli aplikacja była
**zainstalowana** jako osobne okno, trzeba ją odinstalować w przeglądarce
(Chrome → Ustawienia → Aplikacje).

## 0.18.0 — 1 sierpnia 2026

Biuro dostaje **podgląd pod `/biuro`** — pierwszy własny ekran od usunięcia
`/lookup`. Wycięcie flagi faktury (0.16.0) zamknęło jedyny kanał, którym biuro
widziało stan dostaw; CSV i REST istniały dalej, ale „wywołaj curlem z tokenem"
nie jest interfejsem dla księgowości.

### Co pokazuje

Dwie sekcje, sam odczyt:

- **DOSTAWY** — status rozkładania per dokument: nietknięta / w toku /
  rozłożona, pasek postępu, plakietka bufora, szukajka po numerze i dostawcy.
- **REKLAMACJE** — nierozwiązane wyjątki pogrupowane po dokumencie, z dwoma
  wyjściami: **protokół rozbieżności do wydruku** (tabela wyjątków + zdjęcia
  dowodowe + miejsca na podpisy) i **CSV** do arkusza.

Protokół w końcu domyka pętlę zdjęć dowodowych: kolektor je wysyłał, serwer
składował — a obejrzeć ich nie było gdzie. Teraz lądują na wydruku reklamacji,
czyli dokładnie tam, po co powstały.

### Jak to jest zbudowane — i czego świadomie NIE ma

Jedna strona HTML bez builda i frameworka (`server/src/web/biuro.html`),
serwowana przez API. Logowanie badge'em jak na kolektorze; dane czytane
istniejącymi trasami z tokenem sesji w nagłówku. Strona nie ma własnych
uprawnień ani żadnego zapisu — poprzedni podgląd zniknął razem z całym
klientem PWA, bo dwa fronty to dwa razy utrzymanie, więc nowy nie ma prawa
być drugim frontem.

Zdjęcia pozostają za sesją: strona pobiera je fetchem i wstawia jako blob —
nic nie jest publiczne w LAN. Wróciła trasa `GET /api/delivery/:id/problems`
(wycięta w 0.17.0 jako „bez klienta") — teraz ma klienta.

### [wymaga działania] przy wdrożeniu

`git pull`, `npm ci`, `npm run build`, restart usług. Adres dla biura:
`http://serwer:3001/biuro` (korzeń przekierowuje tamże). Konto dla biura
zakłada się jak każde inne — na kolektorze albo przez `POST /api/users`
(DEPLOY §5a); rola `biuro` nie jest wymagana do samego podglądu.

## 0.17.0 — 31 lipca 2026

<!-- docs_check: historia -->

Po wycięciu flagi padło pytanie, czy takich niepotrzebności jest w repo więcej.
Przegląd trzech warstw znalazł je w trzech kształtach. Ten wpis usuwa te, które
nie miały ani jednego konsumenta.

### Zwroty koszykami — machineria bez wejścia

Kompletna ścieżka po obu stronach: numer koszyka przy każdym odłożeniu, pasek
otwartych koszyków, domykanie przyciskiem, rozliczenie ilościami, czwarta
kontrola nocnej rekoncyliacji. **Wejścia do niej nie było od d131f75** —
zakładka DOSTAWY filtrowała zwroty, a komentarz nazywał to „ukryciem wejścia,
nie wycofaniem funkcji".

Przywrócenie wejścia nie wchodziło w grę, bo funkcja wróciłaby ZEPSUTA:
domknięcie koszyka kolejkuje MM, a dokumentów MM na produkcji nie da się dziś
wystawić. Dostawa zwrotowa zostawałaby w `open` na zawsze.

Zwroty rozlicza więc biuro w Subiekcie — tak jak faktycznie robi od roku.
Karta towaru przestaje obiecywać „zwrot, czeka na rozłożenie". **Magazyn Zwroty
zostaje**: kafel „gdzie jeszcze leży" ma nadal sens, zmienia się tylko podpis.

### Klucz wiersza faktury — zalążek kanału, który już odrzuciliśmy

<!-- docs_check: historia -->

`delivery_line.sgt_pozycje` (0.13.0) zapisywało się przy każdym otwarciu
dostawy i nie było czytane przez ani jedno miejsce w kodzie. Powstało pod
„opis różnic przy pozycji faktury", czyli **ten sam kanał do biura, który
wypadł w 0.16.0** — tylko droższy: docelowy zapis wymagałby prawa zapisu do
tabeli z ilościami i cenami.

Wypada razem z `MSSQL_POZ_ID_COLUMN`, dwoma podejściami w imporcie pozycji,
jednym komunikatem w `/api/health` i rozdziałem dokumentacji, który opisywał
niezaimplementowaną funkcję na 144 liniach.

### Drobny martwy kod

Kolumny pisane i nieczytane, cztery funkcje `:core` bez wołającego, trzy
deklaracje Retrofit bez ani jednego wywołania i pięć pól DTO bez czytelnika.
Przy okazji znika duplikat listy typów wyjątków — kolektor trzymał własną kopię
obok serwerowej, a wołał wyłącznie swoją.

Cyfra kontrolna badge'a ma teraz **jedną** implementację (serwer, z wektorami
w testach). Kolektor rozpoznaje sam kształt kodu — i tylko tego potrzebuje.

### Czego świadomie NIE ruszamy

**MM i worker Sfery.** Około 450 linii serwera prowadzi do wywołania, które na
produkcji zawsze rzuca wyjątek. To jest niedokończone, nie zbędne — tryb B
(kontener, 4× w roku) zostaje nietknięty razem z `waiting_for_doc`.

**Zdjęcia dowodowe i raporty dostępne tylko curlem.** Ślad audytowy ma wartość
dowodową także wtedy, gdy nikt go nie ogląda co tydzień.

### [wymaga działania] przy wdrożeniu

<!-- docs_check: historia -->

Zero pracy przy bazie Subiekta — ta zmiana **nie dotyka uprawnień**. Z
`wertis.env` można usunąć `MSSQL_POZ_ID_COLUMN` i `DOK_TYP_ZWROTY`; serwer ich
nie czyta. Poza tym `git pull`, `npm ci`, `npm run build` i restart usług.

Stare bazy zachowują nieużywane kolumny (`koszyk`, `mm_ilosc`, `mm_queue_id`,
`sgt_pozycje`, `ob_id`) — wszystkie nullowalne, nikt ich nie czyta, a
`DROP COLUMN` w SQLite przepisuje tabelę. Nowe bazy powstają bez nich.

## 0.16.0 — 31 lipca 2026

<!-- docs_check: historia -->

**Flaga sprawdzenia faktury wychodzi z aplikacji w całości.** Aplikacja nie
zapisuje już do bazy Subiekta niczego poza polem lokalizacji na kartotece —
reguła „tylko lokalizacja" nie ma od dziś ani jednego wyjątku.

### Dlaczego, skoro dzień wcześniej ją naprawialiśmy

Bo naprawa odpowiedziała na inne pytanie niż to, które padło potem: czy WERTIS
w ogóle **potrzebuje** flag, żeby kontrolować dostawy. Nie potrzebuje. Kontrolę
niesie w całości `delivery_line` — co odłożone, gdzie, przez kogo i z jakim
wyjątkiem. Flaga nigdy nie była do tego potrzebna ani magazynierowi, ani
serwerowi.

Flaga była kanałem do **biura**: kolumną „FW" na liście faktur zakupu, czyli
jedynym miejscem, w którym księgowość widziała stan rozkładania. Za ten jeden
kanał płaciło się około 1 275 liniami w 30 plikach, sześcioma zmiennymi env,
dwoma prawami zapisu do bazy firmy, tabelą read-modelu i typem zadania
w kolejce. Właściciel zdecydował, że kanał nie jest tego wart.

### Co znika

Serwis `delivery-flag.ts` w całości, `applyDocFlag` z obu adapterów zapisu
(w tym MERGE do tabeli przypisań flag), typ zadania w kolejce razem z gałęzią
workera i kompensacją, tabela słownika flag, kolumny `flaga`, `flaga_wyslana`
i `active_at`, pola `flaga`/`flagaKey` w dwóch DTO, pastylka na kolektorze,
sześć zmiennych env, krok kreatora w instalatorze i dwa `GRANT`-y.

Znika też cała klasa błędów wokół wykrywania „biuro nadpisało flagę" — łącznie
z tym z 0.14.0, w którym zwolniony worker potrafił porzucić dostawę magazyniera.

### Co świadomie tracimy

Biuro nie zobaczy już stanu rozkładania w Subiekcie. Zostaje `/api/events`
i eksport CSV, czyli surowe zdarzenia, a nie odpowiedź „czy FZ/123 sprawdzona"
jednym spojrzeniem. Kolektor przestaje też odróżniać fakturę rozłożoną poza
aplikacją od nietkniętej — pokazuje wyłącznie własny postęp.

### Stare bazy i stare kolejki

Kolumn nie kasujemy z istniejących plików `.db`: wszystkie są nullowalne, nic
ich nie czyta, a `DROP COLUMN` w SQLite przepisuje tabelę. Nowe bazy powstają
bez nich. Dawne dostawy w statusie `abandoned` zostają — ustawiał go usunięty
mechanizm, a przepisywanie historii byłoby gorsze od jednej martwej wartości.

Kolektor **nadal rozumie** dawny typ zadania na ekranie kolejki. Pole `type`
nie ma wartości domyślnej, więc usunięcie go z modelu wywracałoby ten ekran na
każdej instalacji z historią.

### [wymaga działania] odbierz uprawnienia zapisu

<!-- docs_check: historia -->

Po aktualizacji, na serwerze SQL firmy:

```sql
REVOKE INSERT, UPDATE ON dbo.fl_Wartosc FROM wertis;
REVOKE SELECT         ON dbo.fl_Wartosc FROM wertis;
REVOKE SELECT         ON dbo.fl__Flagi  FROM wertis;
```

Konto WERTIS-a zostaje wtedy z **jednym** prawem zapisu w całej bazie: `UPDATE`
na jednej kolumnie kartoteki. Wpisy `MSSQL_FLAG_*` i `DOC_FLAG_*` w `wertis.env`
można usunąć — serwer ich nie czyta. Flagi postawione wcześniej **zostają na
fakturach**; nic ich nie sprząta, bo to informacja biura, nie nasza.

Poza tym `git pull`, `npm ci`, `npm run build` i restart usług. APK bez pastylki
rozsyła MDM osobno.

## 0.15.0 — 31 lipca 2026

Karta towaru mieści się teraz na jednym ekranie. Wcześniej była kolumną sekcji
rozwijaną przewijaniem: dwa kafle stanów po pół ekranu, pod nimi dostawy,
zamówienia, magazyny, lokalizacje, przycisk, zamienniki i historia. Codzienne
pytanie brzmi „ile jest i gdzie leży", a odpowiedź na drugą jego połowę leżała
poniżej zgięcia ekranu.

### Nagłówek odpowiada na oba pytania naraz

Symbol stoi pierwszy i największy — to jedyny identyfikator używany przy
regale. Pod nim wielka liczba dostępnych sztuk, obok niej pastylka adresu
pickingowego. Rezerwacja, stan łączny i MGP zeszły do jednej podlinijki, bo
sięga się po nie dopiero wtedy, gdy liczba nie zgadza się z półką.

Pastylka adresu to ten sam komponent, co chipy pod spodem (`LocChip(big)`).
Dzięki temu niesie te same cztery stany zapisu: przekreślenie przy schodzącym
adresie, ⏳ przy dochodzącym, czerwony puls przy nieudanym zapisie. Osobny
widget znaczyłby, że stany trzeba napisać dwa razy — a wtedy rozjeżdżają się
przy pierwszej zmianie.

Towar bez adresu dostaje na tym samym miejscu bursztynową pastylkę
**„+ DODAJ ADRES"**, która prowadzi wprost do skanu półki. Kartoteka bez adresu
znaczy, że towar leży gdzieś na hali i nikt poza znalazcą nie wie gdzie — to
zadanie do wykonania, nie fakt do przyjęcia. Napis „brak lokalizacji" mówił to
samo, tyle że kazał szukać czynności gdzie indziej. Rząd chipów pod spodem
wtedy znika: „+ DODAJ" przeniósł się do nagłówka, a licznik pokazywałby
„0/50 zn.", czyli liczbę, która niczego nie ogranicza.

### Trzy sekcje zwijane zamiast czterech sekcji stale otwartych

HISTORIA, POZOSTAŁE MAGAZYNY oraz ZAMIENNIKI I OPIS są zwinięte po wejściu na
kartę. Każda niesie podsumowanie w nagłówku (`ost. Jan K · 07-28`,
`SKLEP 3 · SERWIS 0`, `24-04003 · MAG 4`), więc w typowym dniu nie trzeba
otwierać żadnej. Sekcja bez danych nie pokazuje się wcale — wyszarzony nagłówek
byłby obietnicą treści, której nie ma.

Wejście w zamiennik zwija je z powrotem: to inny towar i inne pytanie.

Opis kartoteki zszedł z góry ekranu do sekcji zamienników. Jest prozą z numerami
obcymi i dopiskami sprzed lat — czyta się go przy rozmowie z dostawcą, nie przy
regale, a dwa wiersze pod EAN-em i tak go ucinały.

### Dostawy i zamówienia w jednej karcie, po jednej linii

„W dostawie" i „Zamówione u dostawcy" dzielą jedną powierzchnię. Rozróżnia je
tusz i ikona: bursztyn przy dostawie, bo jest co zrobić — towar leży
w przyjęciach; szarość przy zamówieniu, bo nie ma i trzeba poczekać. Każdy
dokument to jedna linia z numerem, ilością i statusem; data wystawienia
wypadła, bo numer niesie miesiąc i rok.

Teksty tych linii oraz podsumowania sekcji liczy `:core`
(`core/product/KartaTekst.kt`, 21 testów). To reguły „co pokazać, gdy danych
brak albo jest ich osiem", a moduł `:app` nie ma testów w ogóle.

### Co zniknęło z ekranu

Kafel ZWROTY OD KLIENTÓW (stan wchodzi jako pierwszy wiersz POZOSTAŁYCH
MAGAZYNÓW, z dopiskiem), pasek „W kolejce Sfery N szt", linia „⏳ czeka na
zapis w Subiekcie" oraz podpowiedź o skanowaniu spod chipów. Sygnał nieudanego
zapisu zostaje tam, gdzie był zawsze: pulsujący chip prowadzący do kolejki.

## 0.14.0 — 31 lipca 2026

Flaga sprawdzenia faktury **wraca z Subiekta na kolektor**. Do tej pory szła
wyłącznie w jedną stronę, więc faktura oznaczona przez biuro wyglądała na
kolektorze dokładnie tak samo jak nietknięta: bez pastylki, na górze listy
pracy. Magazynier dostawał do rozłożenia dostawę, którą ktoś już rozłożył.

### Jedna flaga, dwa prawdziwe źródła

Aplikacja czytała `sgt_dokument.flaga` tylko po to, żeby wykryć nadpisanie
przez biuro — i tylko dla dostaw, które sama wcześniej oznaczyła. Dokument bez
wiersza w `delivery` nie miał więc na ekranie żadnego stanu, choć w Subiekcie
stan miał.

Pierwszeństwo rozstrzyga jedna czysta reguła (`widokFlagi`): dopóki aplikacja
prowadzi dokument, wygrywa jej wyliczenie, bo między policzeniem flagi a jej
zapisem stoi kolejka. Poza tym wygrywa Subiekt — i to w dwóch sytuacjach:
dokumentu nikt tu nie otwierał albo biuro przejęło flagę.

Sprawdzona faktura schodzi teraz na dół zakładki DOSTAWY, szarzeje i dostaje
ptaszek — tak samo jak dostawa rozłożona na kolektorze. Reguła mieszka
w `:core`, bo jest regułą, a nie wyglądem.

### Zwolniony worker nie porzuca już dostawy

Przy okazji wyszedł błąd starszy niż ta zmiana. `officeOverride` porównywał
Subiekta z tym, co sami wysłaliśmy, **nie patrząc na kolejkę**. Zadanie
czekające na workera wyglądało więc jak decyzja biura: aplikacja porzucała
własną dostawę zaraz po otwarciu, a flaga tej faktury nie zmieniała się już
nigdy.

Najłatwiej trafiała w to faktura z flagą postawioną wcześniej ręcznie — czyli
dokładnie ta, od której zaczyna się ten wpis. Teraz porównanie czeka, aż
kolejka opustoszeje.

### Obce flagi firmy mają nazwy

<!-- docs_check: historia -->

Firma trzyma w `fl__Flagi` więcej flag niż cztery nasze. Taka flaga pokazuje
się z nazwą ze słownika, ale **bez koloru stanu** — o fladze spoza tego procesu
wiadomo tylko tyle, że biuro ją postawiło. Słownik importuje się z `fl__Flagi`
do nowej tabeli read-modelu `sgt_flaga`.

Brak `GRANT SELECT` na `fl__Flagi` nie wywraca importu: pastylka zostaje bez
nazwy, a `/api/health` mówi, czego brakuje. Skrypt uprawnień nadaje to prawo
od dawna, więc typowa instalacja nie wymaga niczego.

### [wymaga działania] tylko gdy flagi nie były skonfigurowane

<!-- docs_check: historia -->

`MSSQL_FLAG_GRUPA` i `MSSQL_FLAG_TYP_OBIEKTU` rządzą teraz także **odczytem**.
Puste znaczą, że kolektor nie zobaczy żadnej flagi biura i każda faktura będzie
wyglądać na niesprawdzoną. Ustala się je jednym zapytaniem (DEPLOY §6).

Poza tym `git pull`, `npm ci`, `npm run build` i restart usług. Nowa tabela
powstaje sama przy starcie; APK z pastylkami rozsyła MDM osobno.

## 0.13.0 — 31 lipca 2026

WERTIS umie teraz wskazać **konkretny wiersz faktury**. Nic to jeszcze nie
zmienia na ekranie — to warunek konieczny zapisu opisu różnic do Subiekta,
policzony osobno, żeby tamta zmiana nie niosła przy okazji migracji schematu.

### Dlaczego to nie jest jedna kolumna

<!-- docs_check: historia -->

Naturalny odruch to dopisać `ob_id` do linii roboczej. **Byłby błędny.**
`openDelivery` agreguje ten sam towar z kilku wierszy dokumentu w jedną linię —
świadomie, bo magazynier ma przed sobą jedną paletę i ma ją zobaczyć raz.
W Subiekcie duplikat jest normalny: dwie ceny, dwie partie, dwa wiersze.

Linia dostaje więc `sgt_pozycje` — **listę** identyfikatorów, posortowaną
rosnąco. Sortowanie nie jest kosmetyką: czyni „pierwszą pozycję tego towaru"
pojęciem rozstrzygalnym, gdy przyjdzie wybrać komórkę zapisu.

Agregacja została nietknięta. Rozbicie na wiersz-per-pozycję pokazałoby ten sam
towar dwa razy przy jednej palecie — regresja w interfejsie wprowadzona po to,
żeby uprościć zapis, którego jeszcze nie ma.

### [wymaga działania] Nazwa kolumny jest ZAŁOŻENIEM

<!-- docs_check: historia -->

Nowe `MSSQL_POZ_ID_COLUMN`, domyślnie `ob_Id`. Nasz opis struktury tej kolumny
nie wymienia, więc domyślna jest **szóstym `[WERYFIKUJ]`** — dokładnie w tej
samej sytuacji `ob_IloscZrealizowana` okazało się zgadnięte źle.

Sprawdza to jedno zapytanie o komplet kolumn `dok_Pozycja`, to samo, które
odpowiada na pytanie o „Opis dostawy" (`docs/subiekt-gt-struktura.md`).

Brak kolumny **nie wywraca importu**: pozycje wczytują się bez identyfikatora,
`sgt_pozycje` zostaje puste, a `/api/health` mówi o tym wprost. Cisza byłaby tu
groźna — opis różnic trafiłby kiedyś w niewłaściwy wiersz i wyglądałby jak
zwykły wpis.

### Migracja

Kolumny dochodzą same, przez `migrate()` w `db/db.ts` — ten sam mechanizm co
przy `events.user_ref`. Sprawdzone na bazie założonej na schemacie sprzed
zmiany: kolumny dochodzą, dane zostają, **stare wiersze mają `NULL`**, a nie
zmyśloną wartość. Historii się nie dopisuje wstecz.

Seed dostał fakturę z **tym samym towarem w dwóch wierszach** — bez niej ścieżka,
dla której cała ta zmiana powstała, nie miałaby w demo ani jednego przebiegu.

---

## 0.12.3 — 31 lipca 2026

Zakładka rozkładania nazywa się teraz **DOSTAWY**, pokazuje **same faktury
zakupu** i przestaje kłamać o oknie czasowym.

### „ROZKŁADANIE" → „DOSTAWY"

Magazyn mówi „dostawy", nie „rozkładanie". Zmiana obejmuje etykietę zakładki
w dolnym pasku i tytuł ekranu; ścieżka pracy się nie zmienia.

### Tylko FZ, i to naprawdę tylko FZ

Domyślne `DOK_TYPY_DOSTAW` zmieniło się z `1,10` na `1`. U tego klienta towar
wchodzi wyłącznie fakturą zakupu, a PZ pochodzi z innego procesu i na liście
pracy magazyniera było szumem. Firmy przyjmujące obiema drogami wracają do
`DOK_TYPY_DOSTAW=1,10` — to nadal jedno ustawienie, nie zmiana kodu.

Samo przestawienie domyślnego by nie wystarczyło: adapter **seeded** miał parę
`('FZ','PZ')` ZASZYTĄ w dwóch zapytaniach i ustawienia nie czytał. Demo
pokazywało więc co innego niż produkcja z tej samej konfiguracji. Tłumaczenie
kodów `dok_Typ` na etykiety read-modelu jest teraz w jednym miejscu
(`etykietyDostaw`), z asercjami — w tym na kod spoza pary FZ/PZ, który wcześniej
wpadłby do SQL jako `null` i milczkiem opróżnił listę.

Zwroty znikają z tej zakładki. Serwerowa ścieżka koszyków i MM **zostaje
nietknięta** — to ukrycie wejścia, nie wycofanie funkcji.

### `DOK_DNI_WSTECZ` działało tylko w połowie

Trasa `/api/delivery/documents` miała `listDocuments(14)` zaszyte na sztywno,
więc ustawienie rządziło importem, ale nie zakresem samej listy:
`DOK_DNI_WSTECZ=30` nie pokazywało ani jednego dokumentu więcej. Teraz lista
bierze okno z konfiguracji.

Ta sama czternastka stała też w nagłówku kolektora („DOSTAWY FZ/PZ · OSTATNIE
14 DNI") — trzecie miejsce, w którym mogła się rozjechać, i jedyne, które
człowiek widzi. Serwer podaje teraz `dniWstecz` w odpowiedzi, a nagłówek go
pokazuje zamiast zgadywać.

### Gdzie biuro trzyma opis różnic — zwiad, nie implementacja

Rozbieżności z faktury magazyn wpisuje ręcznie w kolumnie **„Opis dostawy"**,
która — wbrew pierwszemu założeniu — stoi w siatce **pozycji** dokumentu, nie
w nagłówku. Opis dotyczy więc konkretnego towaru, co dobrze pasuje do wyjątków
WERTIS (`problem.line_id`).

`docs/subiekt-gt-struktura.md` dostał rozdział z procedurą ustalenia, gdzie to
pole mieszka (dwa niezależne tropy: po etykiecie i po zasianym znaczniku) oraz
**piąty znacznik `[WERYFIKUJ]`**. Rozdział mówi wprost, czego repo nie wie:
kolumn tekstowych `dok_Pozycja` nikt nie badał, a z `tw_Pole1..8` nie wynika
istnienie analogicznych pól na pozycji.

Odnotowana przy okazji luka: WERTIS **nie importuje identyfikatora pozycji**.
Dopasowanie po parze (dokument, towar) nie jest bezpieczne, bo ten sam towar
potrafi stać na fakturze w dwóch wierszach. Zapis do tego pola wymaga więc
zmiany schematu — policzonej osobno, po zwiadzie.

---

## 0.12.2 — 31 lipca 2026

Deinstalacja u klienta stanęła na ostatnim kroku: „jakiś proces używa tego
folderu". Usługi zeszły, reguła zapory zniknęła, `C:\wertis` został.

### Katalog trzymały dwie rzeczy naraz

**Powłoka wewnątrz.** Wcześniejsze etapy każą wpisać `cd C:\wertis`, a Windows
nie kasuje katalogu, w którym stoi proces. Instalator nie mówił o tym nic.
Teraz sprawdza katalog roboczy i ostrzega **przed** pytaniem o zgodę — po
zgodzie człowiek potwierdziłby deinstalację, która i tak nie dojdzie do końca.

**Osierocony `node.exe`.** `nssm remove` wyrejestrowuje usługę, ale gdy proces
wisiał (a wisiał — stąd `SERVICE_PAUSED`), zostaje z otwartymi uchwytami.
Deinstalacja zatrzymuje teraz procesy uruchomione z kasowanego katalogu, zanim
ruszy pliki: zablokowany plik wywraca także przenoszenie śladu audytowego, nie
tylko kasowanie.

Zasięg jest wąski celowo — liczy się plik wykonywalny **wewnątrz** kasowanego
katalogu. `node.exe` z `C:\Program Files` obsługujący cudzą aplikację jest poza
zasięgiem z definicji.

### Porównanie ścieżek, które musiało być dokładne

Prefiks bez separatora na końcu robi z `C:\wertis2\node.exe` mieszkańca
`C:\wertis` — czyli deinstalacja WERTIS ubija cudzy proces. To ta sama klasa
błędu co `Split-Path` na korzeniu dysku z 0.11.0. `Test-SciezkaWewnatrz` jest
czystą funkcją i ma własne asercje; sabotaż tego jednego porównania wywraca
dwa testy naraz.

### „Pliki w użyciu" mówi teraz, jakie

Komunikat bez nazwy winowajcy kończy się kasowaniem katalogu ręką, czyli
ominięciem bramki bezpieczeństwa. Instalator wypisuje nazwy i PID-y tego, co
trzyma katalog, a gdy lista jest pusta — kieruje do `resmon`, bo uchwyt trzyma
wtedy okno Eksploratora albo edytor, nie proces z plikiem w środku.

### Polecenia deinstalacji nie dało się wkleić

`docs/wdrozenie.md` podawał `.\wertis-instalator.ps1 -Odinstaluj`, a Windows
odpowiada na to `running scripts is disabled on this system` — i tak też
skończyło się u klienta. Instrukcja przy instalacji kieruje do `URUCHOM.cmd`,
ale deinstalacja potrzebuje argumentów, więc tamta osłona jej nie obejmuje.
Wszystkie polecenia w tej sekcji mają teraz `-ExecutionPolicy Bypass` wprost.

CI dostał przebieg próbny deinstalacji na **podrobionej instalacji**, gdzie
bramka się zgadza. Poprzedni wariant szedł na nieistniejącym katalogu i mijał
skanowanie procesów bokiem. Nowy woła `Get-Process` na prawdziwej tablicy
procesów — część z nich nie oddaje `.Path` i to wywracało pierwszą wersję kodu.

---

## 0.12.1 — 30 lipca 2026

`Login failed for user 'wertis'` — po instalacji, która zameldowała sukces.

### Idempotencja, która rozjeżdżała hasło

Skrypt uprawnień zakładał konto tak:

```sql
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wertis')
    CREATE LOGIN [wertis] WITH PASSWORD = '<nowe losowe>', CHECK_POLICY = ON;
```

Wygląda na bezpieczne przy ponownym uruchomieniu i takie było — **co do
istnienia konta, ale nie co do poświadczeń**.

Login jest obiektem **instancji**, więc przeżywa nieudany przebieg kreatora
i skasowanie bazy. Pierwsze podejście u klienta wywaliło się na literówce
w nazwie instancji, ale login zdążył powstać. Drugi przebieg trafił w
`IF NOT EXISTS`, pominął `CREATE LOGIN` i **zostawił stare hasło** — podczas
gdy instalator zapisał do `wertis.env` świeżo wylosowane.

Teraz istniejący login dostaje `ALTER LOGIN ... WITH PASSWORD` i `ENABLE`.
Wyłączone konto daje dokładnie ten sam objaw i tę samą ciszę.

### Weryfikacja sprawdzała uprawnienia, nie logowanie

<!-- docs_check: historia -->

To jest właściwa przyczyna tego, że awaria wyszła dopiero przy starcie usługi.
`Get-WertisUprawnienia` odpytuje `sys.database_permissions` **połączeniem
administratora**, więc odpowiada na pytanie „czy konto ma prawa" — nigdy „czy
da się na nie zalogować". Kreator meldował więc:

```
[ok] Konto gotowe: 8 tabel do odczytu, zapis tylko tw_Pole2 i fl_Wartosc.
```

o koncie, którego hasła nikt nie potwierdził.

Instalator otwiera teraz **osobne połączenie na tych poświadczeniach, które za
chwilę trafią do pliku**, i wykonuje `SELECT 1`. Nieudana próba jest błędem
kreatora z gotowym `ALTER LOGIN` do wklejenia — zamiast `Login failed for user`
w logu usługi, kwadrans później.

Gdy próba się nie uda, instalator idzie ścieżką „konto czeka na administratora"
i zapisuje skrypt do przekazania. Skrypt zawiera już `ALTER LOGIN`, więc jego
wykonanie naprawia dokładnie ten przypadek.

### Naprawa istniejącej instalacji

Ponowne uruchomienie kreatora (`-TylkoKonfiguracja`) wystarcza — przestawi
hasło i sprawdzi logowanie. Ręcznie, w SSMS:

```sql
ALTER LOGIN [wertis] WITH PASSWORD = 'hasło z wertis.env';
```

Po tym `nssm stop` i `nssm start` obu usług. Samo `start` nie wyjdzie ze stanu
`SERVICE_PAUSED`, w który NSSM wpada po kilku szybkich awariach startu.

## 0.12.0 — 30 lipca 2026

<!-- docs_check: historia -->

Kreator przeszedł do końca na prawdziwej bazie i wylądował na danych demo.

```
[ok] Konto gotowe: 8 tabel do odczytu, zapis tylko tw_Pole2 i fl_Wartosc.
[ok] Zapisano C:\wertis\wertis.env (17 ustawień).
[!]  Tryb: seeded - to DANE DEMO. Nic nie trafia do Subiekta.
```

**To jest dokładnie ta awaria, której cała architektura konfiguracji miała
zapobiec** — opisana słowo w słowo w komentarzu `env-file.ts`: *„rozjazd nie
dawał żadnego objawu, worker pisze do lokalnego SQLite i ZGŁASZA SUKCES.
Na kolektorze zielono, w Subiekcie zero zmian"*.

### Przyczyna: dwa ustawienia NSSM o tej samej nazwie w połowie

| ustawienie | co robi |
|---|---|
| `AppEnvironmentExtra` | **dokłada** zmienne do środowiska procesu |
| `AppEnvironment` | **zastępuje** je w całości |

Instalator kasował **wyłącznie pierwsze**. Instalacja, która kiedyś użyła
drugiego, przechodziła przez kreator nietknięta: plik dostawał `SGT_MODE=mssql`,
był poprawnie wczytany, a proces i tak startował w trybie `seeded` — bo
środowisko ma nad plikiem pierwszeństwo (zwykła semantyka dotenv).

Od tej wersji lecą **oba**, listą w jednej stałej, którą asertuje
`instalator/testy.ps1`.

### `/api/health` przestaje milczeć

`loadEnvFile()` **już liczył** listę przykrytych kluczy — i wyrzucał ją do
kosza. To jedyne pole, które nazwałoby tę awarię z jednego spojrzenia.

- **`configPrzykryte`** — które klucze z pliku przegrały ze środowiskiem.
  Same nazwy, **nigdy wartości**: w pliku leży `MSSQL_PASSWORD`. Pilnuje tego
  osobny test.
- **wpis w `problemy`**, gdy przykryty jest klucz zmieniający zachowanie
  (`SGT_MODE`, `MSSQL_*`). Wtedy `ok` jest fałszywe, a zdanie mówi, co zrobić.

Alarm milczy tam, gdzie nadpisywanie środowiskiem jest normalną drogą — bez
pliku (`npm run dev`, testy) i dla kluczy pokroju `LOG_LEVEL`. Bramka, która
krzyczy bez powodu, uczy ignorować `problemy`.

### Kreator nazywa rozjazd błędem, nie wyborem

Gdy instalator właśnie zapisał `SGT_MODE=mssql`, a `/api/health` melduje
`seeded`, to jest **błąd instalacji**. Dotąd leciał jako `[!]` z tekstem
o poprawnym wariancie pilotażowym — czyli mylił w tym akurat przypadku
najbardziej. Teraz wypisuje przykryte klucze i polecenie, którym się je czyści.

### Weryfikacja

Nowa bramka **sabotowana w dwie strony**: wyjęcie `SGT_MODE` z listy kluczy
krytycznych i wpuszczenie wartości do komunikatu czerwienią dokładnie te dwie
asercje, które mają czerwienić — w tym tę o niewyciekaniu hasła.

**[wymaga działania]** Sam `git pull` naprawia przyszłe instalacje. Maszyna już
dotknięta wymaga wyczyszczenia środowiska usług:

```powershell
nssm reset wertis-api AppEnvironment ; nssm reset wertis-worker AppEnvironment
nssm restart wertis-api ; nssm restart wertis-worker
```

Ponowne uruchomienie kreatora robi to samo przy okazji.

## 0.11.0 — 30 lipca 2026

Odinstalowanie jednym poleceniem — i uczciwa lista tego, czego ono **nie cofa**.

```powershell
.\wertis-instalator.ps1 -Odinstaluj
```

Do tej pory deinstalacji nie było w żadnej postaci: ani przełącznika, ani
sekcji dokumentacji, ani jednego `nssm remove` w całym repozytorium.

### Zdanie, które kłamało

`docs/wdrozenie.md` obiecywał przy Etapie 0:

> **Wycofanie:** odinstalowanie usług. Nic poza tym nie powstało.

**To była nieprawda.** Po Etapie 0 zostawał katalog `C:\wertis` z całym klonem
repo i `node_modules`, dwie usługi Windows, reguła zapory, `tools\nssm.exe`,
baza SQLite, katalog logów oraz zainstalowane systemowo Node i Git. Człowiek,
który zaufałby temu zdaniu przy pilocie, zostawał z instalacją, o której nie wie.

### Czego deinstalacja NIE cofa

To jest połowa wartości tej zmiany i skrypt wypisuje to na końcu przebiegu:

| co zostaje | dlaczego |
|---|---|
| **wartości w bazie Subiekta** | to dane firmy, nie aplikacji — odwraca je wyłącznie kopia bazy |
| **login SQL `wertis`** | stoi na poziomie **instancji**, więc pomyłka dotknęłaby wszystkich baz |
| **ustawienia SQL Servera** | uwierzytelnianie mieszane, TCP i SQL Browser bywają używane przez inne aplikacje |
| **Node.js i Git** | instalator dokłada je systemowo |

Pierwszy wiersz jest sednem. **Odinstalowanie aplikacji nie jest cofnięciem jej
pracy.** Pole lokalizacji na kartotekach i flagi na fakturach zostają dokładnie
tam, gdzie je wpisała.

### Ślad audytowy przeżywa deinstalację

Domyślnie `server\data` — baza z historią zmian, zdjęcia problemów, kolejka —
zostaje **przeniesiony obok** do `C:\wertis-dane-<data>`, a skrypt wypisuje tę
ścieżkę. Historia bywa potrzebna długo po tym, jak aplikacja zniknie z maszyny;
`docs/wdrozenie.md` czyni z niej jedyne źródło odpowiedzi na „co stało w polu
przed zmianą".

Skasowanie wymaga osobnego przełącznika `-UsunDane` i drugiego potwierdzenia.

### Bramka, bez której tego kodu nie wolno byłoby wypuścić

`Remove-Item -Recurse -Force` dostaje ścieżkę z parametru. To ta sama klasa
błędu, na której instalator wywalił się u klienta 27 lipca (`New-Item -Path
"C:\"`) — tylko że tam kosztowała nieudaną instalację, a tutaj kosztowałaby dysk.

Dlatego kasowanie wymaga **rozpoznania instalacji**: katalog musi zawierać
`server` oraz `.git` albo `wertis.env`. Sam `server` to za mało, bo bywa
w cudzych projektach. Korzeń dysku, `C:\Windows` i literówka w `-Katalog`
dostają odmowę z powodem, a nie usunięcie.

Decyzja jest wyprowadzona do czystej funkcji `Get-WertisPlanDeinstalacji`, więc
stoi za nią **dziesięć asercji** w `instalator/testy.ps1` — w większości na
odmowach, nie na sukcesach.

### Kolejność, która nie wynika z kodu

Usługi → `nssm remove` → zapora → katalog. Odwrotnie się nie da: `nssm.exe` leży
**wewnątrz** kasowanego katalogu, a działający `node.exe` trzyma uchwyty do
plików. Bez `confirm` w `nssm remove` NSSM otwiera okno dialogowe i skrypt wisi
w nieskończoność.

**Czego to nie dowodzi.** Samego usuwania nie da się sprawdzić poza Windowsem
z usługami — `-DryRun` z założenia pomija każdy krok wykonawczy. CI parsuje
skrypty, uruchamia asercje i przechodzi gałąź deinstalacji w trybie próbnym.
Pierwsze prawdziwe uruchomienie na maszynie testowej jest jedynym pełnym testem,
i dlatego dokument opisuje też **drogę ręczną**.

## 0.10.1 — 30 lipca 2026

Jak sprawdzić, **które z ośmiu pól własnych jest lokalizacją** — i cztery inne
ustawienia, o które kreator nie pyta wcale.

`docs/subiekt-gt-struktura.md` dostał rozdział „Jak ustalić wszystkie wartości",
ułożony **w kolejności pytań kreatora**. Podział idzie po tym, kto ustala
wartość, bo to rozstrzyga, czy trzeba cokolwiek zrobić ręką.

| grupa | co robisz |
|---|---|
| kreator ustala sam | potwierdzasz wybór z listy |
| kreator pyta wprost | wpisujesz |
| **kreator NIE pyta** | **dopisujesz do `wertis.env`** |
| ustalone ze struktury | nic |

Trzecia grupa jest sednem. Kreator kończy się słowem „Gotowe", więc brak tych
pięciu wartości **nie daje żadnego sygnału**. `MSSQL_PORT` jest tam luką osobnego
rodzaju: stoi na liście zapisu, ale żaden krok kreatora go nie przypisuje.

### Pole lokalizacji — pytanie, którego dotąd nie umiał zadać żaden dokument

Worker nadpisuje wskazaną kolumnę **bezwarunkowo**. Zapytania, które by na to
odpowiadało, nie było w żadnym pliku — istniało wyłącznie wewnątrz instalatora.
`DEPLOY.md` opisywał problem słowami i nie podawał ani jednego `SELECT`-a.

Zapytanie w dokumencie odpowiada teraz na trzy pytania, nie na dwa. Trzecie jest
najważniejsze: **czy któreś pole już zawiera adresy półek**. Magazyn, który dziś
jakoś notuje lokalizacje, robi to najczęściej w polu własnym — a wskazanie wtedy
innego pola daje dwa źródła prawdy o tym samym.

To samo rozpoznanie trafiło **do kreatora**, bo to w nim zapada decyzja.
`Get-WertisPolaDodatkowe` liczy dodatkowo wartości w kształcie regału
(`A01-02-03`) albo palety (`PAL-042`), tymi samymi wzorcami, którymi aplikacja
rozpoznaje skan.

Podpowiedź Enterem przestaje przez to padać na pierwsze puste pole:

- pole z adresami wygrywa z pustym,
- przy braku adresów reguła wraca do pierwszego pustego,
- **pole zajęte cudzymi danymi nie jest podpowiadane wcale** — dotąd kreator
  podpowiadał tam `tw_Pole1`, czyli akurat kasowanie danych firmy,
- dwa pola z adresami to remis i brak podpowiedzi, bo to człowiek musi
  rozstrzygnąć, które obowiązuje.

Ostrzeżenie przed nadpisaniem pyta teraz o to, co **naprawdę zniknie**: liczy
wartości, które nie wyglądają na adres. Straszenie adresami, które aplikacja
i tak przejmuje, uczyłoby klikać „tak" także tam, gdzie ostrzeżenie jest prawdziwe.

### Kolumna ilości zrealizowanej: `[WERYFIKUJ]` → ustalenie

Dokument mówił, że `ob_IloscZrealizowana` to „nazwa prawdopodobna, nie
potwierdzona". Została sprawdzona i jest **błędna**: pełna lista 57 kolumn
`dok_Pozycja` z bazy 1.8731.31.6933 nie zawiera stopnia realizacji w żadnym polu.
Poprawną wartością na tej wersji jest **pusta**.

Zapytanie w dokumencie było przy okazji **źródłem tej pomyłki**: filtr
`LIKE 'ob_Ilosc%'` przegapiłby kolumnę nazwaną inaczej. Nowa wersja wypisuje
wszystkie kolumny.

### Liczniki przestają być prozą

Trzy miejsca myliły się co do samych siebie — preambuła `struktura.md` mówiła
„cztery" przy pięciu znacznikach, `DEPLOY.md` „trzy" przy czterech punktach,
a komentarz w `config.ts` trzymał na liście `[WERYFIKUJ]` bufor rozstrzygnięty
pół roku wcześniej.

Poprawienie ich nie wystarcza, bo rozjadą się znowu. `tools/docs_check.py`
sprawdza teraz, że liczebnik w preambule zgadza się z liczbą znaczników — to ta
sama klasa zgnilizny, dla której cały ten skrypt powstał.

### Jedno miejsce zamiast dwóch

Pięć bloków SQL stało w `DEPLOY.md` i w `struktura.md` naraz, a czytelnik nie
miał jak poznać, która wersja jest aktualna — jedna z nich była błędna przez pół
roku. §6 mówi teraz **kiedy i po co**, `struktura.md` — **jak**.

**Czego to nie dowodzi.** Zmian w `sql.ps1` i w kreatorze nie da się sprawdzić
poza Windowsem z Subiektem: w CI nie ma `pwsh` z połączeniem do SQL, a `-DryRun`
do bazy się nie łączy. Regułę podpowiedzi pokrywa dziewięć asercji w
`instalator/testy.ps1`, ale samo zapytanie weryfikuje dopiero pierwsze prawdziwe
uruchomienie. Dlatego wersja z dokumentu zostaje jako droga niezależna.

## 0.10.0 — 30 lipca 2026

Co było w polu lokalizacji przed zmianą — w każdej z trzech ścieżek.

W `docs/wdrozenie.md` z 0.9.0 stało zdanie, że cofnięcie zmiany lokalizacji
opiera się wyłącznie o kopię bazy, bo audyt nie zna wartości sprzed zmiany.
**Research pokazał, że to zdanie było zbyt optymistyczne** — luka dotyczyła
trzech ścieżek, a na dwóch była szersza, niż napisałem.

| ścieżka | co wiedziała o polu |
|---|---|
| karta towaru | nową zawartość, **nie starą** |
| linia dostawy, tryb A | tylko kod półki, **żadnej zawartości pola** |
| koszyk, tryb B | **nic** — same `queueIds` |

### Dodane

- **`locsPrzed` i `zrodlo` w zdarzeniach lokalizacji.** Wartość sprzed zmiany
  jest zapisywana **surowa**, nie przepuszczona przez `parseLocs`: przywrócenie
  polega na wpisaniu z powrotem dokładnie tego, co w polu stało, a wartość
  znormalizowana byłaby rekonstrukcją.

- **Rozkładanie pojawia się w historii na karcie towaru.** Dotąd karta milczała
  o zmianach, których nie zrobiono z niej samej — a rozkładanie jest najczęstszą
  drogą, którą to pole się zmienia. Historia pokazuje teraz przejście
  `A01-02-03 → B05-01-02` z oznaczeniem źródła.

### Poprawione

- **Zdarzenie powstaje w JEDNYM miejscu — `enqueueSetLocation`.** Dane audytowe
  są tam **parametrem wymaganym**, więc zapisu lokalizacji nie da się
  zakolejkować bez śladu. Czwarta ścieżka, dopisana za pół roku, dostanie wpis
  bez pamiętania o tym. Dotąd każde z trzech miejsc logowało co innego i właśnie
  tak powstała ta luka.

- **Podwójne liczenie pracy w raporcie wydajności.** Ta zmiana sama je stworzyła:
  rozłożenie jednej linii daje teraz `putaway_line_done` ORAZ `location_set`,
  czyli dwa wiersze z jednej czynności człowieka. Bez odsiania raport zawyżałby
  tempo **każdemu, kto rozkłada** — czyli całej hali.

  W raporcie mierzącym ludzi zawyżenie jest gorsze niż brak liczby: trafia do
  rozmowy o pracy i nikt nie ma jak go zauważyć. Zdarzenia lokalizacji liczą się
  więc tylko z karty; rozkładanie ma już swoje.

### Uwagi

- **Wpisy sprzed tej zmiany nie mają `locsPrzed` ani `zrodlo`** i tak zostaje.
  Historia formatuje się wtedy po staremu, a liczniki traktują je jak zmiany
  z karty — bo wtedy tylko karta te zdarzenia emitowała.
- **Audyt nie jest mechanizmem przywracania.** Mówi, co wpisać; wpisać trzeba
  samemu. Przy większej liczbie kartotek kopia bazy zostaje jedyną rozsądną
  drogą, i `docs/wdrozenie.md` mówi to dalej wprost.
- Testy: 267 → **281**. Sabotażem sprawdzone cztery reguły: znormalizowana
  wartość „przed", podwójny wpis z trasy karty, brak emisji dla dostawy
  i koszyka oraz powrót podwójnego liczenia w raporcie.

---

## 0.9.0 — 29 lipca 2026

Procedura wdrożenia na produkcji plus dwie usterki, które ta procedura wykryła.

Pytanie brzmiało: *„jak bezpiecznie wprowadzić aplikację w firmie"*. Okazało
się, że **mechanizmy bezpiecznego wdrożenia już były** — brakowało dokumentu,
który każe ich użyć w odpowiedniej kolejności. Obie usterki niżej wyszły na
kopii bazy, gdzie kosztowały jedno zapytanie SQL.

### Dodane

- **`docs/wdrozenie.md` — sześć etapów z bramkami.** Od demo, przez kopię bazy,
  po jeden regał na produkcji. Każdy etap ma **zdanie sprawdzalne**, a nie
  wrażenie, że wygląda dobrze, oraz opisany sposób wycofania.

  Najważniejsze narzędzie było na miejscu od początku: `wertis-api`
  i `wertis-worker` to osobne usługi, a **worker jest jedynym procesem
  zapisującym do Subiekta**. Zatrzymanie go daje przebieg próbny na żywych
  danych — aplikacja czyta produkcję, kolejkuje zamierzone zapisy i nie wykonuje
  żadnego, a `/api/queue` staje się ich podglądem.

  Dokument mówi też wprost dwie rzeczy, które łatwo przemilczeć: **kopia bazy na
  tej samej instancji nie izoluje wszystkiego** (login powstaje na poziomie
  instancji), a **`sa` nie jest wymagane** — Enter pomija pytanie, a instalator
  zapisuje gotowy skrypt dla administratora bazy.

- **`DOK_TYPY_DOSTAW`** — typy dokumentów na liście rozkładania jako lista,
  domyślnie `1,10`.

- **`DOK_DNI_WSTECZ`** — okno importu dokumentów, **domyślnie 14** zamiast
  zaszytych 60.

### Poprawione

- **Para FZ/PZ była ZASZYTA w zapytaniu importu**, choć zwroty tuż obok miały już
  listę z konfiguracji. Niespójność, nie decyzja projektowa. Firma przyjmująca
  towar wyłącznie na FZ widziała na liście pracy magazyniera dokumenty
  z zupełnie innego procesu i nie mogła ich wyłączyć bez zmiany kodu.

- **Skrócenie okna importu kasowałoby niedokończoną pracę.** Okno obcina
  dokumenty po dacie wystawienia, więc przejście z 60 dni na 14 usunęłoby
  z ekranu dostawę sprzed trzech tygodni, której nikt nie rozłożył do końca.

  Okno ma teraz **wyjątek dla dostaw otwartych** — zostają widoczne niezależnie
  od wieku. Brak dostawy na liście wygląda identycznie jak dostawa rozłożona,
  a to dwie zupełnie różne sytuacje.

- **`MSSQL_ZD_ZREAL_COLUMN` może nie mieć żadnej poprawnej wartości.** Domyślne
  `ob_IloscZrealizowana` było oznaczone `[WERYFIKUJ]` i okazało się zgadnięte
  źle: na bazie 1.8731.31.6933 `dok_Pozycja` **nie niesie stopnia realizacji
  w żadnym z 57 pól**. Poprawnym ustawieniem jest wtedy wartość pusta, i tak to
  teraz opisują `DEPLOY.md` §6 oraz `wertis.env.example`.

  Zostawiona nazwa nieistniejącej kolumny daje to samo zachowanie plus
  ostrzeżenie, którego nie da się spełnić — a takie uczą ignorowania ostrzeżeń.

- **`docs/wdrozenie.md` wchodzi pod bramkę stylu.** Lista dokumentów w
  `tools/styl_check.py` jest zaszyta, więc nowy plik nie byłby sprawdzany —
  a wykonuje go człowiek pod presją, na cudzej maszynie, często pierwszy raz.

### Uwagi

- Testy: 260 → **267**. Budowanie fragmentów `WHERE` wydzielone jako czysta
  funkcja, bo bez serwera MSSQL to jedyna testowalna część importu.
  Sabotażem sprawdzone trzy reguły: powrót zaszytej pary FZ/PZ, usunięcie
  wyjątku na otwarte dostawy i wpuszczenie wszystkiego przy pustej liście typów.
- **Ilość odebraną dałoby się policzyć inaczej.** W `dok_Pozycja` jest
  `ob_DoId` — w Subiekcie pozycja dokumentu realizującego wskazuje nim pozycję
  realizowaną. To **hipoteza niezweryfikowana**; wymaga sprawdzenia na
  częściowo odebranym zamówieniu i jest zmianą kodu, nie ustawienia.

---

## 0.8.2 — 29 lipca 2026

Suma kontrolna NSSM wpisana — strażnik z 0.8.1 działa w obie strony.

W 0.8.1 stała `SUMA_NSSM_ZIP` została **celowo pusta**, bo `nssm.cc` nie było
osiągalne ze środowiska, w którym powstawał tamten kod. Wartość policzył runner
Windows w CI, pobierając plik wprost ze źródła:
`727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743`.

**Czego ta suma dowodzi, a czego nie.** Nie jest dowodem, że `nssm.cc` było
w tamtej chwili nienaruszone — to zaufanie przy pierwszym użyciu. Jest natomiast
gwarancją, że **od tamtej chwili plik się nie zmienił**.

### Poprawione

- **Krok CI stracił `continue-on-error`** i to jest sedno tej zmiany. Z pustą
  sumą krok tylko meldował wartość, więc pobłażliwość nic nie kosztowała.
  Z wpisaną — `continue-on-error` czyniłby strażnika **bezzębnym**: podmieniony
  plik dawałby zielone CI.

  Rozdzielone są za to dwa różne zdarzenia: **niedostępna sieć to nie to samo,
  co podmieniony plik**. Nieosiągalne `nssm.cc` daje ostrzeżenie i przepuszcza;
  niezgodna suma zatrzymuje budowę.

- **Wydanie powstawało PUSTE.** Workflow instalatora nie miał bloku
  `permissions`, więc `github.token` dostawał dostęp tylko do odczytu,
  a `gh release upload` kończył się `HTTP 403: Resource not accessible by
  integration`. Tag się tworzył, **plików przy nim nie było** — a to jedyna
  droga, którą instalator trafia do człowieka.

  Znalezione przy okazji, w logach nieudanego biegu z 12:56, nie zgłoszone.
  Dodane `contents: write` na poziomie zadania.

### Uwagi

- Przebieg próbny w CI potwierdził, że `-DryRun` **pomija pobieranie**, więc
  weryfikacja sum nie zmienia zachowania trybu próbnego.

---

## 0.8.1 — 29 lipca 2026

Antywirus zablokował instalator — i przy okazji wyszła realna dziura.

Zgłoszenie brzmiało: *„antywirus zablokował wertis-instalator.ps1, IDP.Generic,
zarażony"*. Audyt źródła: **plik jest czysty**. Zero kodu wykonywanego z sieci
(`IEX`, `DownloadString`, base64, `-EncodedCommand`), zero osadzonych binariów,
poprawny UTF-8 w całości, trzy adresy zewnętrzne — własne repo, `nodejs.org`,
`nssm.cc`. `IDP.Generic` to detekcja heurystyczna: ocenia zachowanie, nie
sygnaturę.

Instalator wykonuje sześć czynności, które razem dają profil droppera: pobiera
archiwum i uruchamia z niego plik, instaluje MSI po cichu (`/qn`), rozpakowuje
`SecureString` do jawnego hasła, nadpisuje TLS, podnosi uprawnienia i zakłada
usługi. Do tego **NSSM sam jest narzędziem dwojakiego użytku** — malware zakłada
nim usługi dla przetrwania restartu. Antywirus zachował się poprawnie.

### Poprawione

- **Pobierane pliki nie były w ŻADEN sposób weryfikowane.** Instalator ściągał
  instalator Node'a i `nssm.exe`, po czym uruchamiał je **z uprawnieniami
  administratora** — bez sprawdzenia, co właściwie przyszło. Przejęcie DNS
  w sieci klienta albo włamanie na serwer wydań wystarczyło, żeby ta maszyna
  wykonała cudzy kod jako SYSTEM.

  **To była realna dziura, nie fałszywy alarm** — znaleziona przy okazji, nie
  zgłoszona. Obie pozycje mają teraz sprawdzaną sumę SHA-256 **przed
  uruchomieniem**; niezgodność przerywa instalację i kasuje pobrany plik.

  Suma Node'a pochodzi z oficjalnego `SHASUMS256.txt` na nodejs.org. Suma NSSM
  została **celowo zostawiona pusta**: `nssm.cc` nie było osiągalne ze
  środowiska, w którym powstawał ten kod, a wpisanie wartości „z pamięci"
  dałoby weryfikację **pozorną** — gorszą od jawnego jej braku, bo wyglądającą
  na zabezpieczenie. Dopóki jest pusta, instalator ostrzega i wypisuje
  policzoną wartość. Ustala ją nowy krok CI na maszynie mającej dostęp do
  `nssm.cc`; późniejsza zmiana sumy **zatrzymuje budowę**, bo wymaga oczu
  człowieka.

### Dodane

- **`instalator/README.md` — sekcja „Antywirus zablokował instalator".** Co
  znaczy `IDP.Generic`, tabela sześciu zachowań, które go wywołują, jak
  **samodzielnie zweryfikować** plik (`.ps1` to czysty tekst — da się go
  przeczytać), gdzie zgłosić fałszywy alarm i **czego nie robić** (nie
  wykluczać całego katalogu, nie wyłączać ochrony).

  Osobno wypisane, **kiedy zacząć się naprawdę martwić**: base64,
  `Invoke-Expression`, `-EncodedCommand` albo adres spoza znanej trójki. Bez
  tego akapitu instrukcja „to fałszywka, kliknij zezwól" uczyłaby ignorowania
  antywirusa — czyli dokładnie odwrotnie, niż trzeba.

### Uwagi

- **`.exe` z `ps2exe` jest flagowany znacznie częściej niż `.ps1`.** Wydanie
  niesie oba; przy blokadzie używaj skryptu.
- **Wycięcie NSSM zostaje jako opcja.** Usunęłoby naraz pobieranie obcej
  binarki, zależność od `nssm.cc` i najczęściej flagowany składnik. Wymaga
  jednak przepisania rejestracji usług na Harmonogram zadań i **sprawdzenia na
  prawdziwym Windowsie** — a to jest mechanizm, od którego zależy uruchomienie
  produktu u klienta, więc nie idzie w ciemno razem z poprawką dokumentacji.

---

## 0.8.0 — 29 lipca 2026

Ślad audytowy odpowiada na reklamację faktem, a nie hipotezą.

Wymaganie brzmiało: *„za miesiąc ktoś powie «aplikacja mi zjadła 30 sztuk» —
chcesz mieć odpowiedź"*. Okazało się, że dane w większości **już były**: `events`
zbierał 28 typów zdarzeń od pierwszego dnia instalacji, z osobą, kontem,
urządzeniem i czasem, i nic ich nie kasuje. Brakowało czterech rzeczy — i to one
były robotą, nie „logowanie".

### Dodane

- **Trasa audytu `GET /api/events` i eksport CSV.** Filtr po osobie, towarze,
  urządzeniu, typie zdarzenia i zakresie dat. To był największy brak: odpowiedź
  na reklamację wymagała dotąd `sqlite3` na serwerze, czyli praktycznie nie
  istniała.

  Bramka na rolę **brygadzisty albo biura**, bez PIN-u — wzorem `GET
  /api/users`, gdzie PIN chroni zmiany, a nie odczyt. Log mówi, kto ile
  zeskanował, więc jest narzędziem nadzoru i hala go nie ogląda. **Kto wyniesie
  CSV, sam trafia do śladu** (`audyt_eksport`).

- **Wynik zapisu do Subiekta.** Worker zapisuje `queue_applied` (weszło i o
  której), `queue_retry` (nie weszło, wróci) i `queue_failed` (nie weszło
  i już nie wejdzie). `sfera_queue` dostała kolumnę `created_by_ref`, bo worker
  działa poza żądaniem i bez niej umiałby podać tylko nazwę, a nie konto.

- **`GET /api/health` mierzy wzrost historii** — liczba zdarzeń, data
  najstarszego i rozmiar bazy. Nie czyścimy `events` i to jest decyzja, ale
  „rośnie w nieskończoność" bez licznika kończy się pełnym dyskiem.

- **Indeks `ix_events_tw_time`.** „Co się działo z tym towarem" to najczęstsze
  pytanie przy reklamacji, a `tw_id` nie miało **żadnego** indeksu — nawet
  historia na karcie towaru skanowała całą tabelę.

### Poprawione

- **Bufor offline kasował operacje przy przejściowym błędzie serwera.**
  `OfflineQueue` klasyfikował `isNetworkError(e) = e !is ApiError`, więc
  **`ApiError(500)` nie był błędem sieci** — `flush()` wyrzucał operację
  z bufora i wołał lokalny toast. Restart serwera albo 503 spod reverse proxy
  zjadał zeskanowaną pracę magazyniera: bez śladu, bez ostrzeżenia, bez szansy
  na powtórkę.

  Teraz 5xx, 408 i 429 znaczą „serwer choruje, operacja jest zdrowa" —
  **zostaje w buforze** i wraca przy następnym flushu. Dopiero 4xx (żądanie
  wadliwe, ponowienie nic nie da) ją usuwa, i **melduje na serwer**
  (`klient_odrzucona`) z czasem wykonania na kolektorze, nie dosłania. Licznik
  `proby` pilnuje, żeby jedna chora operacja nie zamroziła kolejki na zawsze.

- **Odrzucone żądania nie zostawiały śladu.** 400 za przekroczony limit pola,
  zły kod półki czy nieznany towar wracały do kolektora i znikały — „skanowałem
  i się nie zapisało" nie miało po stronie serwera żadnego potwierdzenia. Hook
  `onSend` zapisuje je jako `http_rejected` z metodą, ścieżką, statusem
  i powodem.

  **Ciała żądania NIE zapisujemy i to jest zasada, nie przeoczenie** — przez
  `POST /api/users` przechodzi PIN. Pilnuje tego osobna asercja: log
  audytowy z PIN-ami w środku jest gorszy niż brak logu. `401` na `GET` jest
  pomijane, bo karta odpytuje serwer co 2 s i wygasła sesja utopiłaby resztę
  audytu w szumie; `401` na zapisie **jest** logowane.

- **Zdarzenia ilościowe niosą wartość sprzed zmiany** (`qtyPrzed`). Dotąd był
  sam stan po, więc „było 30, jest 0" trzeba było odtwarzać z całej sekwencji
  i ufać, że żadne zdarzenie nie zginęło.

### Czego to NIE naprawia

Operacja wykonana **bez Wi-Fi** żyje w pliku na kolektorze aż do połączenia.
Zginie urządzenie przed odzyskaniem sieci — śladu nie ma i **żadna zmiana po
stronie serwera tego nie zmieni**. Lukę zawęża to, że buforowana jest wyłącznie
zmiana lokalizacji; skany i rozkładanie offline po prostu nie działają.

### Uwagi

- Log audytowy jest narzędziem nadzoru. Warto powiedzieć zespołowi, że istnieje
  — cichy nadzór jest gorszy od jawnego.
- `klient_odrzucona` to **relacja urządzenia**, nie fakt zaobserwowany przez
  serwer. Prefiks `klient_` trzyma tę różnicę na wierzchu.
- Testy: 244 → **260** serwera, 92 → **96** w `:core`. Sabotażem sprawdzone:
  zdjęcie warunku metody przy `401` zapala 2 asercje, dopisanie ciała żądania
  do logu — asercję o PIN-ie, powrót starej klasyfikacji błędów — asercję 5xx.

---

## 0.7.0 — 29 lipca 2026

Karta towaru mówi, czego nie ma na półce, bo jeszcze nie przyjechało od dostawcy.

### Dodane

- **Sekcja „ZAMÓWIONE U DOSTAWCY" na karcie towaru.** Numer zamówienia, ilość
  pozostała do dostarczenia, termin i dostawca. Domyka pytanie otwarte przez
  0.6.0: tamta zmiana odpowiadała „towar przyjechał, poszukaj w przyjęciach",
  ta odpowiada „towaru nie ma i trzeba poczekać".

  Sekcja stoi **pod** „W DOSTAWIE, NIEROZŁOŻONE" i ma spokojne tło zamiast
  bursztynowego. Bursztyn na tej karcie znaczy „zrób coś teraz"; zamówienie nie
  daje żadnej czynności. Ten sam kolor w obu miejscach kazałby magazynierowi
  szukać towaru, którego w budynku nie ma.

  Zamówienie zrealizowane w całości znika z listy — pytanie brzmi „czego
  jeszcze nie ma", a nie „co zamówiono". Kolejność idzie po **terminie**, nie po
  dacie wystawienia; zamówienia bez terminu lądują na końcu z dopiskiem „termin
  nieznany", bo to uczciwsze niż podstawienie daty wystawienia w miejsce
  obietnicy dostawy.

### Poprawione

- **Napis „zam. u dostawcy" na kaflu MGP nie zapalił się nigdy na produkcji.**
  Karta brała go z pola `ordered`, a importer MSSQL wpisywał w nie **zero na
  sztywno** — „zamówione" nie ma w Subiekcie prostej kolumny, pochodzi
  z dokumentów ZD. Napis działał wyłącznie w trybie demo, gdzie seed czytał tę
  liczbę z arkusza. Czyli funkcja istniała dokładnie tam, gdzie nikt jej nie
  potrzebował.

  Pole `ordered` zniknęło z serwera, DTO i kafla. Ta sama liczba z arkusza
  zasila teraz syntetyczne zamówienia w seedzie, więc demo i produkcja chodzą
  **tym samym torem** — czego wcześniej nie robiły.

### Do sprawdzenia na własnej bazie

- **[wymaga działania — opcjonalne]** Doszły dwa `[WERYFIKUJ]` (łącznie cztery,
  `docs/subiekt-gt-struktura.md`). Bez nich karta działa, tylko mniej dokładnie:

  - `DOK_STATUS_ZD_OTWARTE` — opis struktury InsERT mówi tylko „5..8 —
    zamówienia (różne stany realizacji)" i nie rozpisuje ich. Domyślne bierze
    wszystkie cztery i jest **założeniem, nie ustaleniem**.
  - `MSSQL_ZD_ZREAL_COLUMN` — nazwy kolumny z ilością już odebraną nie ma
    w naszym opisie struktury. Gdy nie istnieje, import **nie przerywa się**:
    wpisuje zero, `/api/health` zgłasza zdanie z nazwą do poprawienia, a karta
    opisuje ilość jako oszacowanie. Zamówienie odebrane w połowie wygląda wtedy
    na nietknięte — dlatego to tryb awaryjny, nie docelowy.

  Oba `SELECT`-y są w DEPLOY §6. **Nowych uprawnień SQL nie trzeba** — ZD leży
  w tych samych tabelach co dostawy.

### Uwagi

- ZK (zamówienie **od klienta**, `dok_Typ = 16`) celowo poza zakresem. To ruch
  w drugą stronę i pokrywa go rezerwacja na kaflu MAG; wciągnięcie go do sekcji
  o nazwie „zamówione u dostawcy" pomyliłoby dwa przeciwne kierunki.
- Kolumna `sgt_towar.ordered` **zostaje w bazie** jako martwa. `DROP COLUMN`
  w SQLite to przepisanie tabeli, a kod jej już nie czyta ani nie zapisuje.
- Testy: 244 serwera (doszło 9), 92 w `:core` (doszły 2). Reguły „zrealizowane
  znika" i „kolejność po terminie" sprawdzone sabotażem — odwrócenie sortowania
  zapala dwie asercje, usunięcie odejmowania cztery.

---

## 0.6.1 — 29 lipca 2026

Instalator pokazuje, która baza Subiekta jest produkcyjna, a która jest jej kopią.

### Poprawione

- **Kreator nie odróżniał podmiotu od kopii.** Listował bazy alfabetycznie,
  a po wyborze sprawdzał obecność czterech tabel Subiekta. Kopia ma dokładnie
  te same tabele, więc przechodziła bez słowa — a sortowanie po nazwie potrafiło
  postawić ją **nad** produkcyjną.

  > **Dlaczego to bolało.** Pomyłka nie dawała objawu: konto SQL powstawało na
  > kopii, aplikacja czytała nieaktualne stany i zapisywała lokalizacje
  > w martwą bazę, a wszystko wyglądało poprawnie. Dowiedziałby się o tym
  > dopiero magazynier, któremu stany nie zgadzają się z półką.

- **Lista niesie teraz datę ostatniego dokumentu, liczbę dokumentów i datę
  utworzenia bazy**, posortowana od najświeższej. Żywa baza ma dzisiejszy
  dokument, kopia stoi na dniu zrzutu.
- **Podpowiedź Enterem tylko przy ściśle najświeższej bazie.** Dwie kopie z tego
  samego dnia podpowiedzi nie dostają — byłaby rzutem monetą udającym radę.
- **Ostrzeżenie po wyborze bazy z dokumentem starszym niż tydzień**, z potwierdzeniem
  domyślnie na „nie". Baza bez ani jednego dokumentu ma osobny komunikat: świeży
  podmiot jest pusty, a nie podejrzany.

Obie liczby są tanie celowo: `TOP 1 ... ORDER BY dok_Id DESC` idzie po kluczu
głównym, a licznik dokumentów bierze się z `sys.partitions`. `COUNT(*)` na
serwerze, z którego biuro właśnie korzysta, to nie jest cena za podpowiedź.

### Pod spodem

- `instalator/testy.ps1` — 14 nowych asercji na funkcjach czystych (21 → 35 przebiegów)
  (`Format-WertisEtykietaBazy`, `Sort-WertisBazy`, `Get-WertisSugerowanaBaza`,
  `Test-WertisBazaPodejrzana`). Decyzja i formatowanie są osobno od SQL-a
  właśnie po to, żeby reguła „przy remisie nie podpowiadaj" miała asercję,
  a nie komentarz.

**Wdrożenie: nic.** Zmiana dotyczy wyłącznie `instalator/**` i dokumentacji.
Działający system, konfiguracja i APK zostają bez zmian — dlatego PATCH,
mimo że osoba uruchamiająca instalator zobaczy inny ekran.

---

## 0.6.0 — 29 lipca 2026

Karta towaru mówi, czy towar przyszedł, ale nie leży jeszcze w regale.

### Nowe

- **„W dostawie, nierozłożone" na karcie towaru.** Pod kaflami stanów doszła
  sekcja z numerem dokumentu, datą i ilością, której jeszcze nie odłożono.
  Liczy się z dwóch źródeł: co przyszło (`sgt_pozycja`) minus co trafiło
  w regał (`delivery_line.ilosc_odlozona`). Okno to 14 dni, jak lista
  w zakładce rozkładania.

  > **Dlaczego.** Przy dostawie krajowej skutek magazynowy niesie sam dokument
  > w Subiekcie, więc towar figuruje na MAG od zaksięgowania. Kafel „MAG ·
  > DOSTĘPNE" pokazywał 12 szt przy pustej półce i nie mówił, że sześć z nich
  > stoi na palecie w przyjęciach. Odpowiadał na pytanie POZORNIE, a to gorsze
  > od milczenia.

- **Pominięte pozycje i te ze zgłoszonym wyjątkiem ZOSTAJĄ na liście.** Tak samo
  nie ma ich w regale, a magazynier, który właśnie ich szuka, ma prawo wiedzieć,
  że ktoś się już o nie potknął.

**Sekcja jest nieklikalna i to jest decyzja.** Wejście w dokument z karty
towaru wołałoby `openDelivery`, a ta trasa przestawia flagę faktury w Subiekcie
na „W trakcie sprawdzania". Biuro widziałoby, że ktoś sprawdza fakturę, bo
magazynier zajrzał na kartę towaru.

### Poza zakresem, świadomie

Kontener na MGP — idzie osobnym torem (`putaway_*`) i widać go na własnym kaflu
strefy przyjęć. Dokładanie go tutaj dublowałoby tę samą liczbę na jednym ekranie.

**Zamówienia u dostawcy (ZK/ZD) to osobna zmiana.** Karta odpowiada dziś na
„przyjechało, ale nie na półce", a nie na „nie ma w firmie, ale jedzie". Przy
okazji wyszło, że importer wpisuje `ordered: 0` na sztywno
(`subiekt.mssql.ts:246`), więc podpis „zam. u dostawcy" na kaflu MGP na
prawdziwych danych **nigdy się nie pokazuje**.

### Pod spodem

- Testy serwera 220 → 235: `services/dostawy-towaru.test.ts` (12 przypadków)
  i `routes/karta-towaru.test.ts` (przejście pola przez trasę).
- Adapter dostał `getDeliveryPositionsForProduct` — odwrotność
  `listDeliveryDocuments`, w tym samym pliku i z tym samym warunkiem `WHERE`.

**Nowy APK jest potrzebny**, inaczej kolektor nie narysuje sekcji. Serwer
wysyła pole niezależnie od wersji aplikacji.

---

## 0.5.0 — 27 lipca 2026

Ekran blokady po bezczynności zniknął. Sesja urządzenia nie wygasa sama.

### Zmiana zachowania

- **Kolektor nie pokazuje już ekranu „Sesja zablokowana".** Do tej pory
  dziesięć minut bez ruchu przełączało go na pełnoekranowy komunikat, a powrót
  do pracy kosztował skan badge'a. Kolektor odłożony na regale na całą przerwę
  wraca dziś do otwartej dostawy bez niczego.
- **Sesja kończy się wyłącznie jawną decyzją** — wylogowaniem z Ustawień albo
  przejęciem pracy cudzym badge'em. Blokada nigdy nie gubiła postępu, więc jej
  jedynym mierzalnym skutkiem był ten skan.
- **Tożsamości pilnuje dalej to, co pilnowało naprawdę:** skan cudzego badge'a
  nie przełącza po cichu — pyta człowieka i zapisuje przejęcie w `events`.

**Nowy APK nie jest do tego potrzebny.** Blokadę zgłaszał serwer, więc starsze
kolektory przestają ją pokazywać zaraz po restarcie usług. APK z tego wydania
usuwa już tylko martwy kod po stronie aplikacji.

### Usunięte

<!-- docs_check: historia -->

- `POST /api/auth/unlock` — trasa nie ma czego odblokowywać.
- Odpowiedzi `/api/auth/badge` i `/api/auth/me` nie niosą już `blokadaMin`
  ani `zablokowana`.
- Bramka `423 Sesja zablokowana` w `context.ts`. Razem z nią odpadł wyjątek dla
  `x-buffered-user`, który istniał wyłącznie po to, żeby wysyłka z bufora
  offline nie ginęła na zablokowanej sesji. Sam nagłówek **zostaje** — dalej
  rozstrzyga, kto podpisuje operację wykonaną poza zasięgiem.
- Stan `SessionState.Zablokowana` i akcja `BadgeAction.Odblokuj` w `:core`.

`device_session.last_seen` zostaje, ale niczego już nie bramkuje: to jedyny
ślad, kiedy dany kolektor się odezwał, i przydaje się przy pytaniu „to jedno
urządzenie czy wszystkie?".

### Pod spodem

- Testy serwera 223 → 220, testy `:core` 92 → 90. W obu miejscach doszła
  regresja na usunięty TTL: sesja bezczynna od godziny **pisze tak samo jak
  świeża**, a wcześniej dostawała 423.

---

## 0.4.1 — 27 lipca 2026

Dokumentacja przepisana według reguł ASD-STE100 w zakresie, jaki da się
przenieść na polski. PATCH, bo na ekranie nic się nie zmienia — `git pull`,
`npm ci`, `npm run build`, restart usług.

### Nowe

- **[`docs/slownik.md`](docs/slownik.md)** — jedno miejsce z regułami pisania
  dokumentacji i słowniczkiem terminów. Mówi też wprost, których reguł STE
  **nie** stosujemy, bo zależą od angielskiego. Zgodności ze standardem nie
  deklarujemy: poza angielskim nie da się jej spełnić.
- **`tools/styl_check.py`** — mierzy trzy reguły ze słownika: długość zdania
  (20 wyrazów w kroku procedury, 25 w prozie), długość akapitu i odrzucone
  warianty terminów. Bramkuje CI obok `docs_check.py`.

### Poprawione

- **Osiem dokumentów przepisanych.** Instrukcja została krótka i rozkazująca,
  a „dlaczego" zeszło pod nią do osobnych bloków. Najdłuższe zdanie w repo
  spadło z 52 do 25 wyrazów, ostrzeżenia stoją teraz **przed** krokiem, a
  40-pozycyjna checklista smoke-testu ma jedną rzecz do sprawdzenia na pozycję.
- **`README.md` mówił `better-sqlite3`** — moduł natywny zniknął w 0.4.0
  na rzecz wbudowanego `node:sqlite`.
- **`instalator/README.md` mówił o `SELECT` na siedmiu tabelach** — od 0.4.0
  jest ich osiem (`sl_Magazyn`).
- **CI nie uruchamiało się przy zmianie samego `DEPLOY.md`.** `docs_check.py`
  czytał ten plik od zawsze, ale nie było go w `paths` workflow — razem
  z `CHANGELOG.md` i `instalator/README.md`.

Poza zakresem świadomie zostały `docs/architektura.md`,
`docs/porownanie-asystent.md` i ten plik: to uzasadnienia decyzji, a limit
długości zdania wycina z nich dokładnie tę treść, dla której powstały.

---

## 0.4.0 — 27 lipca 2026

Pierwsze wydanie z numerem, który cokolwiek znaczy. Zbiera sześć zmian
zmergowanych po `0.3.0`.

### Wymaga działania

<!-- docs_check: historia -->

- **[wymaga działania] Nowe uprawnienie SQL: `GRANT SELECT ON dbo.sl_Magazyn`.**
  Bez niego karta towaru pokazuje tylko MAG, MGP i Zwroty, a `/api/health`
  mówi o tym w `problemy`. Aplikacja działa dalej — uruchom ponownie skrypt
  z [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2 albo
  instalator z `-TylkoKonfiguracja`.
- **[wymaga działania] API wymaga sesji.** Skrypty i `curl` uderzające w `/api/*`
  potrzebują teraz nagłówka `x-session` — poza czterema trasami
  (`GET /api/health`, `GET /api/setup`, `POST /api/auth/badge`,
  `POST /api/users` przy pustej bazie).
- **[wymaga działania] Konfiguracja przeniesiona do `wertis.env` na dysku.**
  `AppEnvironmentExtra` w usługach przestało być używane; instalator je kasuje,
  bo zmienne środowiskowe przykrywają plik.
- **[wymaga działania] Node ≥ 22.5.** Serwer używa wbudowanego `node:sqlite`.

### Nowe

- **Wszystkie magazyny na karcie towaru** — sekcja „pozostałe magazyny"
  odpowiada na pytanie „gdzie ten towar jeszcze leży". Biuro może wybrane
  ukryć: Ustawienia → Magazyny (konto biura + PIN). MAG, MGP i Zwroty zostają
  zawsze, bo prowadzą rozkładanie.
- **Instalator Windows** — jeden `.exe` zamiast ~500 linii poleceń: usługi,
  zapora, kreator konfiguracji odpytujący bazę Subiekta i konto SQL
  o uprawnieniach kolumnowych. [`instalator/README.md`](instalator/README.md).
- **Wersje widoczne na dole ekranu** — aplikacji i serwera, z podświetleniem
  rozjazdu.

### Poprawione

- **Bramka sesji na całym API.** Wcześniej sesji wymagały trzy trasy;
  `POST /api/products/:id/location` (zmiana lokalizacji w Subiekcie)
  i `GET /api/wydajnosc` (dane per pracownik) przechodziły bez tokenu,
  podpisując operację nagłówkiem `x-user` albo słowem „anonim".
- **`SQLITE_BUSY` przy dwóch procesach** — `busy_timeout` i `BEGIN IMMEDIATE`.
  Objawem były losowe 500 i zadania w statusie `error`, bez wzorca.
- **Żądanie bez pola `action` dawało 500 zamiast 400** — znalezione przez nowe
  testy tras.
- **Instalator wywracał się przy domyślnym `C:\wertis`** — `New-Item` na
  korzeniu dysku. Do tego brak sprawdzenia kodu wyjścia `git clone`, przez co
  nieudany klon meldował sukces i padał dwa kroki dalej.
- **Zero modułów natywnych** — `better-sqlite3` zastąpione wbudowanym
  `node:sqlite`, więc `npm ci` na Windows nie kompiluje już niczego.
- **Rozjazd trybu API i workera widoczny w `/api/health`** — wcześniej worker
  pracujący na danych demo wyglądał identycznie jak poprawny.

### Pod spodem

- Testy serwera 153 → 223, w tym pierwsze testy tras HTTP (`app.inject()`)
  i kolejki Sfery. Instalator dostał 21 asercji.
- `docs_check.py` pilnuje teraz także katalogu `instalator/` i zgodności wersji.

---

## 0.3.0 i wcześniej

Historia sprzed wprowadzenia tego pliku — patrz `git log` oraz opisy PR-ów.
