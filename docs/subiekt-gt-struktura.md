# Struktura bazy Subiekta GT — co WERTIS czyta i pisze

Zweryfikowane wprost z oficjalnego **„Opisu struktury zbiorów danych InsERT GT",
wersja bazy 1.8731.31.6933** — czyli dokładnie tej, którą ma firma (Subiekt GT
1.87 SP3 HF1). Ten dokument istnieje po to, żeby przestać zgadywać: wszystko
poniżej jest cytatem ze struktury, a nie domysłem z innej wersji.

To, czego dokumentacja **nie** zawiera (bo zależy od konkretnego podmiotu),
zostało wyraźnie oznaczone `[WERYFIKUJ]` — takich rzeczy zostało trzynaście.
Licznik obejmuje też `docs/allegro-ksztalt.md`: §8.2 projektu panelu kieruje
tutaj znaczniki z mapowania Allegro, żeby lista czekających na sprawdzenie
była jedna, a nie dwie.

Liczba urosła w 0.150.0 z ośmiu na trzynaście. Pięć nowych pozycji to zwroty
klienckie: mapowanie powstało z oficjalnej specyfikacji Allegro, ale
z jej kopii sprzed dwóch lat. `npm run sonda` na żywym koncie zdejmie te
znaczniki i wtedy liczba wróci w dół.

## Kody `dok_Typ` — już nie zgadujemy

```
1-FZ    2-FS    3-RZ    4-RS    5-KFZ   6-KFS   9-MM   10-PZ  11-WZ
12-PW  13-RW   14-ZW   15-ZD   16-ZK   21-PA   29-IW  35-ZPZ 36-ZWZ
```

Stąd domyślne w `config.ts`: `DOK_TYP_FZ=1`, `DOK_TYP_PZ=10`.

> **Uwaga historyczna.** WERTIS miał wcześniej `DOK_TYP_PZ=5`, a 5 to **KFZ —
> korekta faktury zakupu**. Na prawdziwej bazie aplikacja listowałaby korekty
> jako dostawy i nie zobaczyła ani jednego PZ. Poprawione po sprawdzeniu
> w strukturze.

## Tabele czytane przez importer

| Tabela | Kolumny używane przez WERTIS |
|---|---|
| `tw__Towar` (dwa podkreślenia) | `tw_Id`, `tw_Symbol`, `tw_Nazwa`, `tw_PodstKodKresk`, `tw_JednMiary`, `tw_Opis`, `tw_Zablokowany`, `tw_Pole1..8` |
| `tw_Stan` | `st_TowId`, `st_MagId`, `st_Stan`, `st_StanRez` (PK: `st_TowId`+`st_MagId`) |
| `dok__Dokument` | `dok_Id`, `dok_Typ`, `dok_NrPelny`, `dok_NrPelnyOryg` (varchar 30, numer dokumentu oryginalnego — integracje wpisują tu numer obcy), `dok_Uwagi` (varchar 500), `dok_DataWyst`, `dok_MagId`, `dok_PlatnikId`, `dok_Status` |
| `dok_Pozycja` | `ob_DokHanId` (→ `dok_Id` dokumentu **handlowego**), `ob_DokMagId` (→ `dok_Id` dokumentu **magazynowego**), `ob_TowId` (→ `tw_Id`), `ob_IloscMag` |
| `kh__Kontrahent` | `kh_Id`, `kh_Symbol` |
| `sl_Magazyn` | `mag_Id`, `mag_Symbol`, `mag_Nazwa` — nazwy magazynów na karcie towaru |

## Lokalizacja: pola własne, nie `tw_Lokalizacja`

Wersje z KSeF **nie mają** natywnej kolumny `tw_Lokalizacja`. Struktura
potwierdza za to osiem pól własnych na `tw__Towar`:

```
tw_Pole1 … tw_Pole8      varchar(50)      „Własne pole 1..8"
```

Stąd `MSSQL_LOC_COLUMN` (domyślnie `tw_Pole1`) i `LOC_FIELD_LIMIT=50` — limit nie
jest ostrożnym założeniem, tylko realnym rozmiarem kolumny.

`[WERYFIKUJ]` **które** z ośmiu pól firma przeznacza na lokalizację. Wybierz takie,
którego nie używa do niczego innego — worker nadpisuje je bezwarunkowo.

## Bufor: `dok_Status`

```
0-wycofany   1-wykonany   2-unieważniony   3-odłożony   4-MM wydany
5..8-zamówienia (różne stany realizacji)
```

Dokument „w buforze" to **odłożony (3)**. Domyślne `MSSQL_BUFFER_EXPR` sprawdza
więc `dok_Status = 3`.

> **Uwaga historyczna.** Wcześniej domyślne wyrażenie sprawdzało `= 0`, czyli
> **wycofany**. Myliło się w obie strony: dokument wycofany pokazywałby się jako
> bufor, a odłożony jako gotowy do pracy.

## Zamówienia do dostawcy (ZD) — karta towaru

Karta pokazuje, czego jeszcze nie ma na półce, ale jest zamówione u dostawcy.
Importer czyta zamówienia z tych samych tabel co dostawy (`dok__Dokument`,
`dok_Pozycja`, `kh__Kontrahent`), więc **nie potrzeba nowego GRANT-u**.

Zamówienie do dostawcy to `dok_Typ = 15` — ta wartość jest pewna, bo stoi
w liście kodów wyżej. Pewne kończy się jednak w tym miejscu i zaczynają się
dwie rzeczy do sprawdzenia na własnej bazie.

`[WERYFIKUJ]` **które statusy z zakresu 5..8 znaczą „zamówienie otwarte"**.
Struktura mówi tylko „5..8-zamówienia (różne stany realizacji)" i nie rozpisuje
ich. Domyślne `DOK_STATUS_ZD_OTWARTE=5,6,7,8` bierze więc wszystkie cztery i jest
**założeniem, nie ustaleniem**. Policz, jak rozkładają się u Ciebie:

```sql
SELECT dok_Status, COUNT(*) AS ile
FROM dok__Dokument
WHERE dok_Typ = 15
GROUP BY dok_Status
ORDER BY dok_Status;
```

**Ilości już zrealizowanej NIE MA w tej wersji bazy.** To ustalenie, nie
założenie: sprawdzono komplet 57 kolumn `dok_Pozycja` na bazie 1.8731.31.6933.
Są ilości tego dokumentu, ceny, wartości, podatki, akcyza, opłata cukrowa,
kaucje, GTU i węgiel. Stopnia realizacji nie niesie żadne pole.

Domyślne `MSSQL_ZD_ZREAL_COLUMN=ob_IloscZrealizowana` było więc **zgadnięte
i zgadnięte źle**. Właściwą wartością dla tej wersji jest **pusta**:

```bash
export MSSQL_ZD_ZREAL_COLUMN=
```

Sprawdź to u siebie **bez filtru na przedrostek** — filtr `LIKE 'ob_Ilosc%'`
przegapiłby kolumnę nazwaną inaczej i sam był kiedyś źródłem fałszywego tropu:

```sql
SELECT name, TYPE_NAME(system_type_id) AS typ
FROM sys.columns WHERE object_id = OBJECT_ID('dok_Pozycja')
ORDER BY name;
```

Bez tej kolumny import **nie przerywa się**: wpisuje zero, a karta pokazuje
ilość zamówioną z dopiskiem, że to górne oszacowanie. Zamówienie odebrane
w połowie wygląda wtedy na nietknięte.

Wartość pusta jest lepsza niż nazwa nieistniejącej kolumny. Obie dają to samo
zachowanie, ale druga zostawia w `/api/health` ostrzeżenie, **którego nie da się
spełnić** — a takie uczą ignorowania ostrzeżeń.

> **Trop na przyszłość, niezweryfikowany.** W `dok_Pozycja` jest `ob_DoId`.
> W Subiekcie pozycja dokumentu realizującego wskazuje nim pozycję realizowaną,
> więc ilość odebraną dałoby się policzyć sumą. Sprawdź na zamówieniu, o którym
> wiesz, że przyszło w części:
>
> ```sql
> SELECT p.ob_Id, p.ob_TowId, p.ob_Ilosc AS zamowiono, p.ob_Status,
>        (SELECT ISNULL(SUM(r.ob_Ilosc), 0)
>           FROM dok_Pozycja r WHERE r.ob_DoId = p.ob_Id) AS zrealizowano
> FROM dok_Pozycja p WHERE p.ob_DokHanId = 0;  -- podstaw dok_Id zamówienia
> ```
>
> Zgodność z tym, co faktycznie przyjechało, potwierdzi trop. To byłaby zmiana
> kodu, nie ustawienia.

Termin realizacji (`MSSQL_ZD_TERMIN_COLUMN`) jest **opcjonalny i domyślnie
pusty**. Bez niego karta pisze „termin nieznany", co jest uczciwsze niż
podstawienie daty wystawienia w miejsce obietnicy dostawy.

ZK (`dok_Typ = 16`, zamówienie **od klienta**) celowo nie jest czytane. To ruch
w drugą stronę i pokrywa go rezerwacja `st_StanRez` na kaflu MAG.

## Typy dostaw — czym towar naprawdę wchodzi na magazyn

Zakładka DOSTAWY pokazuje dokumenty, których typ stoi w `DOK_TYPY_DOSTAW`.
Domyślne `1` to sama FZ. Tak jest w firmie, dla której to powstało: towar wchodzi
wyłącznie fakturą zakupu. PZ pochodzi tam z zupełnie innego procesu i na liście
pracy magazyniera byłoby czystym szumem.

**Ale nie w każdej firmie.** Towar bywa przyjmowany obiema drogami: fakturą
zakupu księgowaną wprost na magazyn albo przyjęciem zewnętrznym, gdy dokument
handlowy przychodzi później. Dla magazyniera to ta sama praca — paleta do
rozłożenia. Wtedy wraca się do `DOK_TYPY_DOSTAW=1,10`.

Nie zgaduj — sprawdź, co faktycznie ląduje na magazynie głównym:

```sql
SELECT dok_Typ, COUNT(*) AS ile, MIN(dok_DataWyst) AS od, MAX(dok_DataWyst) AS do
FROM dok__Dokument
WHERE dok_MagId = 1                    -- podstaw MAG_ID_MAG
  AND dok_DataWyst >= DATEADD(month, -6, GETDATE())
GROUP BY dok_Typ ORDER BY ile DESC;
```

Kody odczytasz z listy `dok_Typ` na początku tego dokumentu. Typ, którego tam
nie ma albo który liczy pojedyncze sztuki, prawdopodobnie pochodzi z innego
procesu — wtedy zostawiasz listę zawężoną.

Pusta lista znaczy **żaden typ**, a nie „każdy". Literówka w ustawieniu daje
więc pustą listę pracy, zauważalną od razu.

> **Uwaga historyczna.** Do sierpnia 2026 para FZ/PZ była **zaszyta w zapytaniu
> importu**, choć zwroty tuż obok miały już listę z konfiguracji. Firma
> przyjmująca towar wyłącznie na FZ nie mogła odfiltrować PZ bez zmiany kodu.
> To była niespójność, nie decyzja projektowa.

## Magazyny

`sl_Magazyn`: `mag_Id`, `mag_Symbol` varchar(3), `mag_Nazwa`, `mag_Glowny` (bit).

Od sierpnia 2026 importer **czyta tę tabelę**. Pobiera stany ze WSZYSTKICH
magazynów, nie tylko z trzech skonfigurowanych. Karta towaru odpowiada dzięki
temu na pytanie „gdzie ten towar jeszcze leży".

Wymaga to `GRANT SELECT ON dbo.sl_Magazyn` (`docs/subiekt-gt-edu-setup.md` §2).
Bez tego grantu aplikacja degraduje się do trzech magazynów i mówi o tym
w `/api/health`.

`[WERYFIKUJ]` id magazynów MAG / MGP / Zwroty (`MAG_ID_*`). Magazyn główny da się
wykryć automatycznie (`mag_Glowny = 1`), ale MGP i Zwroty są nazwane po firmowemu:

```sql
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
```

## Jak ustalić wszystkie wartości — w kolejności kreatora

Ten rozdział jest przepisem do wykonania, nie opisem. Odpowiada na pytanie:
**co wpisać, żeby aplikacja czytała właściwe dane**.

Podział idzie po tym, **kto ustala wartość**. To rozstrzyga, czy musisz cokolwiek
zrobić ręką:

| grupa | ustawienia | co robisz |
|---|---|---|
| kreator ustala sam | baza, magazyny, pole lokalizacji | potwierdzasz wybór z listy |
| kreator pyta wprost | serwer i instancja SQL | wpisujesz |
| **kreator NIE pyta** | pięć pozycji niżej plus `MSSQL_PORT` | **dopisujesz do `wertis.env`** |
| ustalone ze struktury | kody `dok_Typ`, bufor, limit pola | nic |

Trzeci wiersz jest tu najważniejszy. Kreator kończy się słowem „Gotowe", więc
**brak tych wartości nie daje żadnego sygnału**.

### Grupa 1 — kreator ustala sam, Ty potwierdzasz

Wszystko poniżej działa tylko wtedy, gdy kreator **połączył się z bazą**. Bez
połączenia patrz ostrzeżenie na końcu rozdziału.

**Baza podmiotu** (`MSSQL_DATABASE`). Kopia podmiotu ma te same tabele co baza
produkcyjna, więc nazwa nie rozstrzyga. Rozstrzyga data ostatniego dokumentu:

```sql
SELECT DB_NAME() AS baza, MAX(dok_DataWyst) AS ostatni_dokument, COUNT(*) AS dokumentow
FROM dok__Dokument;
```

Żywa baza ma dzisiejszą datę. Kopia stoi na dniu zrzutu. Uruchom to w każdej
bazie kandydującej.

**Magazyny** (`MAG_ID_MAG`, `MAG_ID_MGP`, `MAG_ID_ZWROTY`):

```sql
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
```

Główny poznasz po `mag_Glowny = 1`. MGP i Zwroty są nazwane po firmowemu, więc
tu decyduje człowiek. Trzy identyfikatory **muszą być różne** — inaczej serwer
nie wystartuje. Magazyn skutku rozstrzyga tryb dokumentu, a dwa te same id
wyglądają jak „brakuje dostaw", nie jak błąd ustawień.

### Grupa 2 — które z ośmiu pól jest lokalizacją

**To jest najważniejsze ustawienie w całej konfiguracji.** Worker nadpisuje
wybrane pole **bezwarunkowo**. Wskazanie pola, w którym firma trzyma coś swojego,
kasuje te dane bez ostrzeżenia i bez możliwości cofnięcia.

Sama nazwa kolumny nie mówi nic. Zapytanie odpowiada na trzy pytania naraz:

```sql
SELECT p.pole, p.niepuste, p.adresy, p.przyklad
FROM (
  SELECT 'tw_Pole1' AS pole,
         COUNT(NULLIF(LTRIM(RTRIM(ISNULL(tw_Pole1,''))),'')) AS niepuste,
         SUM(CASE WHEN LTRIM(RTRIM(ISNULL(tw_Pole1,''))) LIKE '[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    OR LTRIM(RTRIM(ISNULL(tw_Pole1,''))) LIKE 'PAL-[0-9][0-9][0-9]'
                  THEN 1 ELSE 0 END) AS adresy,
         MAX(NULLIF(LTRIM(RTRIM(ISNULL(tw_Pole1,''))),'')) AS przyklad
  FROM tw__Towar
  UNION ALL SELECT 'tw_Pole2',
         COUNT(NULLIF(LTRIM(RTRIM(ISNULL(tw_Pole2,''))),'')),
         SUM(CASE WHEN LTRIM(RTRIM(ISNULL(tw_Pole2,''))) LIKE '[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
                    OR LTRIM(RTRIM(ISNULL(tw_Pole2,''))) LIKE 'PAL-[0-9][0-9][0-9]'
                  THEN 1 ELSE 0 END),
         MAX(NULLIF(LTRIM(RTRIM(ISNULL(tw_Pole2,''))),''))
  FROM tw__Towar
  -- powtórz blok dla tw_Pole3 … tw_Pole8
) p ORDER BY p.pole;
```

Kolumna `adresy` liczy wartości pasujące do wzorca regału albo palety — te same
wzorce, którymi aplikacja rozpoznaje skan (`LOC_FORMAT_STANDARD`,
`LOC_FORMAT_PALLET`). Wynik czyta się tak:

| co widzisz | co to znaczy | co zrobić |
|---|---|---|
| `niepuste = 0` | pole jest wolne | **weź je** |
| `adresy` bliskie `niepuste` | firma już tu zapisuje lokalizacje | **weź to samo pole** |
| `niepuste` duże, `adresy = 0` | pole trzyma dane firmy | **nie ruszaj** |

Drugi wiersz jest łatwy do przeoczenia i kosztowny. Magazyn, który dziś jakoś
notuje adresy, robi to najczęściej w polu własnym. Wskazanie wtedy innego pola
daje **dwa źródła prawdy o tym samym** — a starych adresów nikt nie skasuje.

Kreator liczy to samo i podpowiada Enterem pole z adresami, a dopiero w drugiej
kolejności pierwsze puste. Gdy adresy leżą w dwóch polach naraz, **nie podpowiada
nic** — rozstrzygnięcie, które pole obowiązuje, należy do człowieka.

Zapytanie wyżej zostaje mimo to, bo odpowiada na to samo pytanie **niezależnie od
kreatora**. Przydaje się, gdy sonda nie połączyła się z bazą.

`LOC_FIELD_LIMIT=50` to realny rozmiar kolumny `varchar(50)`, nie ostrożne
założenie. Adres dłuższy niż limit jest twardym błędem, nie cichym ucięciem.

### Grupa 3 — o te kreator NIE pyta

> ⚠️ Kreator ich **nie dotyka**. Po instalacji trzeba je dopisać do
> `C:\wertis\wertis.env` i zrestartować obie usługi.

**Statusy otwartych zamówień** (`DOK_STATUS_ZD_OTWARTE`). Struktura wylicza tylko
„5..8 — zamówienia (różne stany realizacji)" i nie mówi, który numer co znaczy:

```sql
SELECT dok_Status, COUNT(*) AS ile FROM dok__Dokument
WHERE dok_Typ = 15 GROUP BY dok_Status ORDER BY dok_Status;
```

Domyślne `5,6,7,8` bierze wszystkie cztery. Skutkiem zbyt szerokiej listy jest
zamknięte zamówienie wiszące na karcie towaru.

**Ilość już odebrana** (`MSSQL_ZD_ZREAL_COLUMN`) — patrz osobna sekcja wyżej.
Na tej wersji bazy właściwą wartością jest **pusta**.

**Termin realizacji** (`MSSQL_ZD_TERMIN_COLUMN`). Domyślnie pusty, bo „nie wiem
kiedy" jest uczciwsze niż podstawienie daty wystawienia. Ustaw go tylko wtedy,
gdy firma faktycznie wypełnia termin na zamówieniach.

**Typy dostaw** (`DOK_TYPY_DOSTAW`) — patrz osobna sekcja wyżej.

**Okno importu** (`DOK_DNI_WSTECZ`). Domyślnie 14 dni. To okno **importu**, nie
filtr widoku, ale dostawa nierozłożona do końca zostaje widoczna niezależnie od
wieku.

**Port SQL** (`MSSQL_PORT`). Kreator o niego nie pyta, choć zapisuje go do pliku.
Potrzebny, gdy SQL stoi na innej maszynie, a nie da się otworzyć portu UDP 1434
dla usługi SQL Browser. Wpisany port **ma pierwszeństwo** przed nazwą instancji.

### Gdy kreator nie połączył się z bazą

> ⚠️ Bez połączenia kreator podsuwa `1`, `2`, `3` dla magazynów oraz `tw_Pole1`
> dla lokalizacji. **To nie są podpowiedzi z Twojej bazy**, tylko wartości
> domyślne — a wyglądają identycznie jak wynik sondy.

Właściwą reakcją jest dokończenie konfiguracji później, po nadaniu uprawnień:

```powershell
.\wertis-instalator.ps1 -TylkoKonfiguracja
```

## Dokument MM — na przyszłość

Gdy worker Sfery (`sfera-worker/`, włączany `SFERA_WORKER=1`) zacznie tworzyć
dokumenty — albo gdyby wystarczył import EPP — przyda się to, że dla MM
struktura używa dwóch pól magazynowych:

- `dok_MagId` — magazyn **źródłowy**,
- `dok_OdbiorcaId` — „dla MM oznacza identyfikator magazynu" (docelowy).

Typ dokumentu MM to `dok_Typ = 9`. Obie kolumny magazynowe są **potwierdzone
na bazie firmy** — po nich chodzi import przyjęć na regał zwrotów (0.75.0).

### Pozycje MM wiszą na `ob_DokMagId`, nie na `ob_DokHanId`

To kosztowało wydanie. Pozycje dokumentu MAGAZYNOWEGO mają `ob_DokHanId`
ustawione na **NULL** — dokumentu handlowego po prostu nie ma. Zapytanie
przepisane ze sprzedaży nie zwracało błędu, tylko **pustkę**, więc każdy kosz
na kolektorze pokazywał zero pozycji i wyglądało to na dzień bez zwrotów.

Sprawdzone na produkcji (sierpień 2026) tym zapytaniem:

```sql
SELECT TOP 20 p.ob_Id, p.ob_DokHanId, p.ob_DokMagId, p.ob_TowId, p.ob_IloscMag
FROM dok_Pozycja p
JOIN dok__Dokument d ON d.dok_Id = p.ob_DokMagId
WHERE d.dok_Typ = 9 ORDER BY d.dok_Id DESC;
```

Wynik: kolumna `ob_DokHanId` pusta w każdym wierszu, `ob_DokMagId` z numerem
przesunięcia. Reguła: dokument handlowy (FZ, FS, ZD) łączy się przez
`ob_DokHanId`, magazynowy (MM, PZ, RW) przez `ob_DokMagId`.

## Audyt kolizji kodów — założenie klasyfikatora skanów

Od lipca 2026 kolektor rozpoznaje etykietę regału **po wzorcu**, nie po
heurystyce „ma literę, nie ma spacji". `LOC` jest kategorią **zamkniętą**:

```
regał   ^[A-Z]\d{2}-\d{2}-\d{2}$     A01-02-03    2 myślniki
paleta  ^PAL-\d{3}$                  PAL-042      1 myślnik + prefiks
EAN     ^\d{8}$|^\d{12,14}$                       0 myślników
symbol  wszystko pozostałe           W32-0203     0–1 myślnik
```

Ta reguła stoi na jednym założeniu: **żaden symbol towaru ani kod kreskowy
w kartotece nie ma kształtu lokalizacji.** Formaty są rozłączne po liczbie
myślników, więc założenie jest prawdopodobne. Kartoteka ma jednak ~3 600 pozycji
wprowadzanych ręcznie przez lata. Prawdopodobne to nie to samo co sprawdzone.

Weryfikuje je [`tools/audyt-kolizji.sql`](../tools/audyt-kolizji.sql). Uruchom
na produkcyjnej bazie loginem read-only:

```bash
sqlcmd -S localhost -d Subiekt_GT -U wertis -P "$MSSQL_PASSWORD" \
       -i tools/audyt-kolizji.sql -s ';' -W > audyt.txt
```

**Zapytanie A musi zwrócić 0 wierszy.** Gdy zwróci kilka — popraw symbole
w Subiekcie (taniej niż kod obronny na zawsze). Gdy kilkadziesiąt — to decyzja
właściciela, bo najprostszym wyjściem jest prefiks `L` na etykietach regałów
przy najbliższym przedruku.

### Wynik

| data | A (symbol = regał) | A2 (symbol = paleta) | D (kod kreskowy = regał) | kartotek |
|---|---|---|---|---|
| **2026-07-26** | **0** | **0** | **0** | 3415 |

**Założenie potwierdzone. Klasyfikator jest bezpieczny.**

**Jak, skoro audyt szedł bez dostępu do MSSQL.** Zapytanie C (rozkład liczby
myślników w symbolach) na produkcji dało `0:1403, 1:1878, 2:64, 3:32, 4:36,
5:2` — czyli **identycznie, we wszystkich sześciu kubełkach**, jak
`server/seed/products.json` w tym repo. To ta sama kartoteka, więc A, A2 i D
policzono na niej. To jest dowód przez zgodność rozkładu, nie skrót ani
założenie — i dlatego nie ma potrzeby powtarzać audytu bez zmiany kartoteki.

**Najbliższa kolizja: rodzina `B20-40-*`** („Akumulator 20V; 4Ah — B20-40-S").
`B20-40-S` ma 8 znaków, wzorzec regału wymaga 9 — czyli **jeden znak dzieli tę
rodzinę od kolizji**. Kartoteka nazwana `B20-40-01` zostałaby uznana za adres
regału. To jedyna trwała lekcja z tego audytu: przy zakładaniu kartotek unikać
schematu `litera + 2 cyfry - 2 cyfry - 2 cyfry`.

Pilnuje tego test `server/src/scan.test.ts` — czyta `products.json` i wywala się
przy pierwszym symbolu lub kodzie kreskowym w kształcie adresu. Jednorazowe
zapytanie chroniło przez jeden dzień; test chroni zawsze.

### Adresy niepasujące do wzorca (zapytanie E)

To samo uruchomienie pokazało **93 kody adresowe w 158 kartotekach**, które nie
pasują do żadnego wzorca. Nie są to literówki, tylko trzy całe konwencje:
`PALETA22` (31 kodów), `PAL38II` (24) i `KT1` (14). Do tego dochodzi
`PAL-SIE-<nn>` (3) i 21 realnych pomyłek.

**Ustalone z właścicielem: żadna z tych konwencji nie jest dziś używana.** To
dług danych, nie zablokowana praca. Aplikacja słusznie ich nie przyjmuje:
rozszerzenie wzorca o martwe formaty otworzyłoby z powrotem dziurę, przez którą
symbol towaru udawał adres. Lista do posprzątania w Subiekcie:
[`adresy-do-poprawy.md`](adresy-do-poprawy.md).

Konsekwencja dla konfiguracji: **`^PAL-\d{3}$` ma dziś zero trafień w całej
kartotece.** Zostaje w `config.locPatterns` jako format DOCELOWY, na który
migrują palety przy sprzątaniu — nie jako opis stanu obecnego.

## Gdzie Subiekt trzyma zdjęcie kartoteki — USTALONE

**Tabela `tw_ZdjecieTw`.** Opis struktury jej nie wymienia; ustalono ją
zapytaniami z tego rozdziału na bazie firmy (2026-08-08).

| kolumna | typ | rola |
|---|---|---|
| `zd_Id` | `int` | klucz wiersza — **jedyne pewne kryterium porządku** |
| `zd_IdTowar` | `int` | klucz obcy do `tw__Towar` |
| `zd_Zdjecie` | `image` | sam obraz |
| `zd_Glowne` | `bit` | zdjęcie główne („Ustaw jako główną" w Subiekcie) |
| `zd_CRC` | `int` | suma kontrolna treści |

Konfiguracja, która z tego wynika:

```bash
ZDJECIA_ZRODLO=blob
ZDJECIA_TABELA=tw_ZdjecieTw
ZDJECIA_KOLUMNA_KLUCZA=zd_IdTowar
ZDJECIA_KOLUMNA=zd_Zdjecie
ZDJECIA_KOLUMNA_GLOWNE=zd_Glowne
ZDJECIA_KOLUMNA_KOLEJNOSC=zd_Id
```

Do tego **siódmy `GRANT SELECT`** na `tw_ZdjecieTw` (skrypt uprawnień, §2).

### Dlaczego `zd_Id` jest w tej konfiguracji obowiązkowe

Zakładka „Opis" ma przyciski „Ustaw jako główną" i „Sortuj" oraz strzałki
między zdjęciami, więc **kartoteka może mieć ich kilka**. Kolektor pokazuje
jedno i ma to być to samo, które biuro widzi jako główne.

Kluczem wiążącym jest `zd_IdTowar` — **obcy**, czyli ten sam dla wszystkich
zdjęć jednego towaru. Jako ostatnie kryterium porządku nie rozstrzyga więc
niczego: przy dwóch zdjęciach bez flagi „główne" baza zwracałaby raz jedno, raz
drugie. Objawem nie byłby błąd, tylko skaczący ETag i kolektory ściągające
obraz przy każdym wejściu na kartę. Porządek domyka dopiero `zd_Id`, a brak
tego ustawienia zatrzymuje start serwera (walidacja w `config.ts`).

### Czego przy okazji NIE ma

- **`tw__Towar.tw_Logo`** to `binary(50)` — pięćdziesiąt bajtów, więc nie
  zdjęcie. Nie mylić z kolumną obrazu.
- Osobnego pola kolejności w `tw_ZdjecieTw` nie ma; „Sortuj" w Subiekcie
  operuje na kolejności wierszy, którą u nas odtwarza `zd_Id`.
- `tw_Zmiana.zt_ZmianaZdjecie` (`datetime`) i `zd_CRC` pozwoliłyby wykrywać
  zmianę zdjęcia bez pobierania obrazu. Dziś rewalidację robi TTL — to jest
  gotowe usprawnienie na później, nie luka.

### Zapytania, którymi to ustalono

Wszystko na **KOPII** bazy, kontem administratora (login `wertis` tych widoków
nie ma). Kolejność jest istotna — pierwsze kosztuje sekundę i potrafi zamknąć
sprawę.

```sql
-- 1. Czy zdjęcie siedzi w tw_Opis? Średnia ~200 bajtów znaczy, że NIE.
SELECT COUNT(*) AS kartotek,
       AVG(CAST(DATALENGTH(tw_Opis) AS bigint)) AS opis_bajtow_srednio,
       MAX(DATALENGTH(tw_Opis))                 AS opis_bajtow_max
FROM dbo.tw__Towar;

-- 2. Wszystkie kolumny binarne w bazie — tam mieszka zdjęcie, jeśli jest w bazie
SELECT t.name AS tabela, c.name AS kolumna, ty.name AS typ, c.max_length
FROM sys.columns c
JOIN sys.tables t  ON t.object_id     = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE ty.name IN ('varbinary','image','binary')
ORDER BY t.name, c.name;

-- 3. Tabele i kolumny o mówiącej nazwie
SELECT t.name AS tabela, c.name AS kolumna, ty.name AS typ
FROM sys.columns c
JOIN sys.tables t  ON t.object_id     = c.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE t.name LIKE '%zdj%' OR t.name LIKE '%zal%' OR t.name LIKE '%foto%'
   OR t.name LIKE '%obraz%' OR t.name LIKE '%grafik%'
   OR c.name LIKE '%zdj%' OR c.name LIKE '%glow%' OR c.name LIKE '%kolej%';

-- 4. Co wskazuje na kartotekę — klucze obce do tw__Towar
SELECT OBJECT_NAME(fk.parent_object_id) AS tabela, cp.name AS kolumna
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns cp ON cp.object_id = fkc.parent_object_id AND cp.column_id = fkc.parent_column_id
WHERE OBJECT_NAME(fk.referenced_object_id) = 'tw__Towar';
```

Dla znalezionego kandydata — rozmiar, pokrycie i format:

```sql
SELECT COUNT(<KOLUMNA>) AS niepustych,
       SUM(CAST(DATALENGTH(<KOLUMNA>) AS bigint))/1048576.0 AS mb_razem,
       AVG(CAST(DATALENGTH(<KOLUMNA>) AS bigint))/1024.0    AS kb_srednio,
       MAX(DATALENGTH(<KOLUMNA>))/1024.0                    AS kb_max
FROM dbo.<TABELA>;

-- Nagłówek mówi, czy to naprawdę obraz
SELECT TOP 20 DATALENGTH(<KOLUMNA>) AS bajtow,
       CONVERT(varchar(40), CAST(SUBSTRING(<KOLUMNA>,1,16) AS varbinary(16)), 2) AS naglowek
FROM dbo.<TABELA> WHERE <KOLUMNA> IS NOT NULL;
```

| nagłówek | co to | co robi aplikacja |
|---|---|---|
| `FFD8FF…` | JPEG | ścieżka podstawowa |
| `89504E47…` | PNG | przechodzi bez zmian |
| `424D…` / `47494638…` | BMP / GIF | przechodzi — kolektor je czyta |
| `D0CF11E0…` | kontener OLE | **odrzucane** — obraz siedziałby w środku |
| `7B5C727466` | RTF | **odrzucane** — jak wyżej |

Gdy żadne z powyższych nie wskaże tabeli: zapisz liczby wierszy wszystkich
tabel, wstaw zdjęcie do kartoteki testowej w Subiekcie podłączonym do kopii
i powtórz. **Tabela, której przybyło wierszy, jest odpowiedzią.**

```sql
SELECT t.name AS tabela, SUM(p.rows) AS wierszy
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
GROUP BY t.name ORDER BY t.name;
```

Ta firma trafiła na wariant „osobna tabela" (`tw_ZdjecieTw`, wyżej). Zapytania
zostają w dokumencie, bo inny podmiot albo inna wersja Subiekta mogą trafić na
co innego, a wtedy odpowiedzi szuka się tą samą drogą:

| wynik | GRANT | ustawienia |
|---|---|---|
| **osobna tabela** ← ten podmiot | **siódmy `GRANT SELECT`** | `ZDJECIA_TABELA`, `ZDJECIA_KOLUMNA_KLUCZA`, `ZDJECIA_KOLUMNA`, `ZDJECIA_KOLUMNA_GLOWNE`, `ZDJECIA_KOLUMNA_KOLEJNOSC` |
| kolumna na `tw__Towar` | żaden nowy | `ZDJECIA_ZRODLO=blob`, `ZDJECIA_KOLUMNA` |
| ścieżka do pliku w polu tekstowym | żaden | `ZDJECIA_ZRODLO=plik`, `ZDJECIA_KATALOG` |
| OLE / RTF / nic | — | funkcja zostaje wyłączona, wynik dopisujemy tutaj jako obalony |

## Dopisanie zdjęcia do kartoteki — 0.88.0

Do 0.87.0 zdjęcia były **tylko do odczytu**. Od 0.88.0 magazynier może dodać
zdjęcie z kolektora, a zadanie `set_zdjecie` dopisuje wiersz do `tw_ZdjecieTw`.

```sql
INSERT INTO tw_ZdjecieTw (zd_IdTowar, zd_Zdjecie, zd_Glowne)
VALUES (@id, @obraz, @glowne);
```

Nazwy kolumn biorą się z tej samej konfiguracji, co odczyt. Zapytanie składa
`budujZapytanieInsert` w [`server/src/adapters/sfera.sql.ts`](../server/src/adapters/sfera.sql.ts).

`zd_Glowne` dostaje `1` **tylko wtedy**, gdy kartoteka nie ma jeszcze żadnego
zdjęcia. Liczymy je w tej samej transakcji co `INSERT`. Dwa wiersze oznaczone
jako główne dałyby odczyt raz jednego zdjęcia, raz drugiego — i ETag skaczący
przy każdym wejściu na kartę.

Funkcja jest domyślnie **wyłączona**. Włącza ją `ZDJECIA_DODAWANIE=subiekt`
i **ósmy grant**:

```sql
GRANT INSERT ON dbo.tw_ZdjecieTw TO wertis;
```

Bez tego grantu zdjęcie nadal działa. Leży wtedy w bazie WERTIS i widać je na
karcie towaru. Zadanie stoi w kolejce z błędem, który podaje gotowe polecenie.
To ta sama droga zapasowa, którą `ean_alias` niesie kod kreskowy.

### Czego to nie rozstrzyga

Trzy rzeczy sprawdza się na **kartotece próbnej**, przed produkcją
([`DEPLOY.md`](../DEPLOY.md) §6).

`[WERYFIKUJ]` **czy Subiekt znosi pusty `zd_CRC`**. Algorytmu tej sumy
kontrolnej nie znamy. Domyślnie nie wpisujemy tej kolumny wcale, bo własna
liczba byłaby zgadywaniem zapisanym do bazy firmy. Gdy okaże się wymagana,
jej nazwę podaje się kluczem `ZDJECIA_KOLUMNA_CRC`.

`[WERYFIKUJ]` **jak podgląd Subiekta rysuje przezroczystość**. Zapisujemy PNG
z kanałem alfa. Możliwy jest czarny prostokąt zamiast wyciętego przedmiotu.
Poprawką byłby biały podkład nakładany przed zapisem — jedna funkcja
w `sfera.sql.ts`.

`[WERYFIKUJ]` **czy trzeba dotknąć `tw_Zmiana.zt_ZmianaZdjecie`**. Kolumna
istnieje i niesie datę zmiany zdjęcia, ale nikt jej dotąd nie zapisywał.

## Zasada nadrzędna

Zapis do bazy Subiekta ogranicza się do **trzech rzeczy**. Są to pole
lokalizacji i podstawowy kod kreskowy na `tw__Towar` oraz wiersz zdjęcia
w `tw_ZdjecieTw`. Wszystkie trzy wymagają osobnego, wąskiego grantu, a dwie
ostatnie są domyślnie wyłączone.

Poza nimi zapisu nie ma. Zero `INSERT` do tabel dokumentów, zero modyfikacji
stanów, zero ingerencji w numerację. Dokumenty MM tworzy Sfera (COM) albo
import EPP, nigdy bezpośredni SQL.
