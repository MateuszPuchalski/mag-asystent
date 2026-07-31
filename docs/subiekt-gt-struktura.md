# Struktura bazy Subiekta GT — co WERTIS czyta i pisze

Zweryfikowane wprost z oficjalnego **„Opisu struktury zbiorów danych InsERT GT",
wersja bazy 1.8731.31.6933** — czyli dokładnie tej, którą ma firma (Subiekt GT
1.87 SP3 HF1). Ten dokument istnieje po to, żeby przestać zgadywać: wszystko
poniżej jest cytatem ze struktury, a nie domysłem z innej wersji.

To, czego dokumentacja **nie** zawiera (bo zależy od konkretnego podmiotu),
zostało wyraźnie oznaczone `[WERYFIKUJ]` — takich rzeczy zostały sześć.

## Kody `dok_Typ` — już nie zgadujemy

```
1-FZ    2-FS    3-RZ    4-RS    5-KFZ   6-KFS   9-MM   10-PZ  11-WZ
12-PW  13-RW   14-ZW   15-ZD   16-ZK   21-PA   29-IW  35-ZPZ 36-ZWZ
```

Stąd domyślne w `config.ts`: `DOK_TYP_FZ=1`, `DOK_TYP_PZ=10`, `DOK_TYP_ZWROTY=14`.

> **Uwaga historyczna.** WERTIS miał wcześniej `DOK_TYP_PZ=5`, a 5 to **KFZ —
> korekta faktury zakupu**. Na prawdziwej bazie aplikacja listowałaby korekty
> jako dostawy i nie zobaczyła ani jednego PZ. Poprawione po sprawdzeniu
> w strukturze.

## Tabele czytane przez importer

| Tabela | Kolumny używane przez WERTIS |
|---|---|
| `tw__Towar` (dwa podkreślenia) | `tw_Id`, `tw_Symbol`, `tw_Nazwa`, `tw_PodstKodKresk`, `tw_JednMiary`, `tw_Opis`, `tw_Zablokowany`, `tw_Pole1..8` |
| `tw_Stan` | `st_TowId`, `st_MagId`, `st_Stan`, `st_StanRez` (PK: `st_TowId`+`st_MagId`) |
| `dok__Dokument` | `dok_Id`, `dok_Typ`, `dok_NrPelny`, `dok_DataWyst`, `dok_MagId`, `dok_PlatnikId`, `dok_Status` |
| `dok_Pozycja` | `ob_DokHanId` (→ `dok_Id`), `ob_TowId` (→ `tw_Id`), `ob_IloscMag` |
| `kh__Kontrahent` | `kh_Id`, `kh_Symbol` |
| `fl_Wartosc` + `fl__Flagi` | flaga sprawdzenia faktury — patrz niżej |
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

## Flaga sprawdzenia faktury — osobny mechanizm, nie kolumna

To najważniejsze ustalenie. Kolumna „FW" na liście faktur zakupu **nie odpowiada
żadnej kolumnie `dok__Dokument`**. InsERT trzyma flagi w parze tabel:

**`fl__Flagi`** — definicje flag (co istnieje):

| Kolumna | Znaczenie |
|---|---|
| `flg_Id` | identyfikator flagi — **to wpisujemy jako `DOC_FLAG_*_SGT`** |
| `flg_Numer` | numer wyznaczający ikonę |
| `flg_Text` | tytuł flagi — **to widzi człowiek** (`DOC_FLAG_*`) |
| `flg_IdGrupy` | grupa flag (→ `fl_Grupy.flp_Id`) |

**`fl_Wartosc`** — przypisania (co jest oflagowane):

| Kolumna | Znaczenie |
|---|---|
| `flw_IdGrupyFlag` | grupa flag |
| `flw_TypObiektu` | typ obiektu w obrębie grupy |
| `flw_IdObiektu` | id flagowanego obiektu — dla dokumentu `dok_Id` |
| `flw_IdFlagi` | która flaga (→ `flg_Id`) |
| `flw_Komentarz` | komentarz do obiektu |
| `flw_IdUzytkownika` | kto ostatnio oflagował/zdjął |
| `flw_CzasOstatniejZmiany` | kiedy |

Klucz główny jest **złożony**: (`flw_IdGrupyFlag`, `flw_TypObiektu`,
`flw_IdObiektu`). Jeden obiekt ma więc najwyżej jedną flagę w grupie, a zapis to
MERGE — podmień, jeśli już jest, wstaw, jeśli nie (`adapters/sfera.sql.ts`).

Trzy konsekwencje dla WERTIS:

1. **Rozdział klucz / label / wartość okazał się trafny.** `flg_Text` to nazwa dla
   człowieka, `flg_Id` to liczba do zapisu — dokładnie te dwa byty, które
   `services/delivery-flag.ts` już rozróżnia.
2. **Aplikacja nie potrzebuje żadnego prawa zapisu do `dok__Dokument`.**
   To zawężenie uprawnień, nie rozszerzenie. `fl_Wartosc` nie uczestniczy
   w numeracji ani w skutkach magazynowych. Zapis tam nie może naruszyć
   integralności dokumentu.
3. **Wykrywanie „biuro nadpisało flagę" staje się precyzyjne.**
   `flw_IdUzytkownika` i `flw_CzasOstatniejZmiany` mówią wprost kto i kiedy.
   Wcześniej trzeba było wnioskować z samej różnicy wartości.

`[WERYFIKUJ]` para (`flw_IdGrupyFlag`, `flw_TypObiektu`) dla faktur zakupu — jedyna
rzecz w całym mechanizmie flag, której dokumentacja nie zawiera. Jeden SELECT:

```sql
-- podstaw numer faktury oflagowanej ręcznie w Subiekcie
SELECT w.flw_IdGrupyFlag, w.flw_TypObiektu, w.flw_IdFlagi, f.flg_Text, f.flg_Numer
FROM fl_Wartosc w
JOIN fl__Flagi  f ON f.flg_Id = w.flw_IdFlagi
JOIN dok__Dokument d ON d.dok_Id = w.flw_IdObiektu
WHERE d.dok_NrPelny = 'FZ 60/MAG/07/2026';
```

Wynik daje naraz: obie liczby do env (`MSSQL_FLAG_GRUPA`,
`MSSQL_FLAG_TYP_OBIEKTU`) oraz `flg_Id` + `flg_Text` tej flagi. Powtórz dla
czterech flag albo wypisz je hurtem:

```sql
SELECT flg_Id, flg_Text, flg_Numer, flg_IdGrupy FROM fl__Flagi ORDER BY flg_IdGrupy, flg_Numer;
```

→ `DOC_FLAG_IN_PROGRESS_SGT`, `DOC_FLAG_PAUSED_SGT`, `DOC_FLAG_DONE_SGT`,
`DOC_FLAG_DONE_ERRORS_SGT`.

## „Opis dostawy" — kolumna przy POZYCJI faktury zakupu

Magazyn zapisuje dziś różnice w towarze **ręcznie**, w kolumnie nazwanej
w Subiekcie firmy **„Opis dostawy"**. Na zrzucie z Subiekta klienta stoi ona
w siatce **pozycji** dokumentu, między „Nazwa" a „Ilość". Opis dotyczy więc
**konkretnego towaru na fakturze**, a nie faktury jako całości.

To dobra wiadomość dla mapowania: wyjątki WERTIS są już per pozycja
(`problem.line_id` → `delivery_line`), więc jedna rozbieżność ma dokładnie jedną
komórkę docelową. WERTIS te różnice zna — typ, ilość policzoną, opis, zdjęcie —
ale do Subiekta nie wysyła z nich ani jednego znaku. Biuro dostaje wyłącznie
czterowartościową flagę opisaną wyżej.

**Nazwa jest nadana przez firmę, nie przez InsERT.** Pole własne Subiekta
domyślnie nazywa się „Pole własne N". Etykieta opisująca proces tej konkretnej
firmy stawia je więc w tej samej kategorii co `MSSQL_LOC_COLUMN`: **ustawienie
podmiotu, nie struktura bazy.** Kolejny klient nazwie to inaczej albo nie będzie
miał tego pola wcale.

### Czego ten dokument NIE wie

Tabela na początku wymienia kolumny **używane przez WERTIS** — jej
niekompletność jest zamierzona. Z `dok_Pozycja` importer bierze dziś trzy:
`ob_DokHanId`, `ob_TowId`, `ob_IloscMag`. O kolumnach tekstowych tej tabeli ten
dokument nie mówi nic; nikt ich nie badał.

W szczególności **z `tw_Pole1..8` nie wynika istnienie analogicznych pól na
pozycji.** Pola własne kartoteki towaru są zmierzone i pewne; przeniesienie tego
wzorca gdziekolwiek indziej byłoby dokładnie tym zgadywaniem, przed którym broni
się preambuła.

> **Trop, który skraca zwiad.** Przy rozstrzyganiu ilości zrealizowanej
> przejrzano **komplet 57 kolumn `dok_Pozycja`** na bazie 1.8731.31.6933 (patrz
> rozdział o zamówieniach). Ta sama lista odpowiada na pytanie poniżej — jeśli
> zachowała się z tamtego sprawdzenia, wystarczy do niej zajrzeć.

### Jak WERTIS wskazuje wiersz faktury

Zapis per pozycja wymaga wskazania **konkretnego wiersza** `dok_Pozycja`.

Dopasowanie po parze (dokument, towar) **nie jest bezpieczne**. Ten sam towar
potrafi wystąpić na fakturze w dwóch wierszach — choćby w dwóch cenach albo
z dwóch partii. Wtedy nie wiadomo, do której komórki pisać.

Od 0.13.0 identyfikator jest **importowany**. Read-model `sgt_pozycja` ma
kolumnę `ob_id`, a linia robocza `delivery_line` — kolumnę `sgt_pozycje` z JSON-ową
listą identyfikatorów, rosnąco.

Lista, nie pojedyncza wartość: `openDelivery` agreguje ten sam towar z kilku
wierszy faktury w jedną linię, bo magazynier ma przed sobą jedną paletę.

`[WERYFIKUJ]` **nazwa kolumny klucza pozycji w `dok_Pozycja`**
(`MSSQL_POZ_ID_COLUMN`, domyślnie `ob_Id`). Nasz opis struktury jej nie
wymienia, więc domyślna jest **założeniem** — dokładnie w tej samej sytuacji
`ob_IloscZrealizowana` okazało się zgadnięte źle. Rozstrzyga to zapytanie
o komplet kolumn `dok_Pozycja` podane niżej, przy okazji „Opisu dostawy".

Brak kolumny nie wywraca importu: pozycje wczytują się bez identyfikatora,
`sgt_pozycje` zostaje puste, a `/api/health` mówi o tym wprost.

`[WERYFIKUJ]` **gdzie „Opis dostawy" mieszka w bazie.** Odpowiedź musi objąć
cztery rzeczy — tabelę, kolumnę, typ z długością oraz sposób powiązania
z pozycją dokumentu — bo bez czwartej `UPDATE` nadal nie da się napisać. Dwa
niezależne tropy, które powinny wskazać to samo pole:

**Trop 1 — po etykiecie.** Subiekt musi tę nazwę skądś brać, żeby narysować
formularz. Zamiatarka po wszystkich kolumnach tekstowych w bazie:

```sql
DECLARE @szukane nvarchar(100) = N'Opis dostawy';
DECLARE @sql nvarchar(max) = N'';

SELECT @sql = @sql + CASE WHEN @sql = N'' THEN N'' ELSE N' UNION ALL ' END +
  N'SELECT ' + QUOTENAME(t.name, '''') + N' AS tabela, '
             + QUOTENAME(c.name, '''') + N' AS kolumna, COUNT(*) AS trafien FROM '
             + QUOTENAME(s.name) + N'.' + QUOTENAME(t.name)
             + N' WHERE CAST(' + QUOTENAME(c.name) + N' AS nvarchar(max)) = @p'
FROM sys.tables t
JOIN sys.schemas s ON s.schema_id = t.schema_id
JOIN sys.columns c ON c.object_id = t.object_id
JOIN sys.types  ty ON ty.user_type_id = c.user_type_id
WHERE ty.name IN ('varchar','nvarchar','char','nchar','text','ntext');

SET @sql = N'SELECT * FROM (' + @sql + N') x WHERE trafien > 0 ORDER BY tabela;';
EXEC sp_executesql @sql, N'@p nvarchar(100)', @p = @szukane;
```

Trafienie wskazuje tabelę **definicji** pól własnych. Pusty wynik znaczy, że
etykieta siedzi poza bazą podmiotu — wtedy rozstrzyga wyłącznie trop 2.

**Trop 2 — po treści.** W Subiekcie wpisz ciąg `ZNACZNIK-WERTIS-001` w „Opis
dostawy" **przy jednej pozycji** dowolnej faktury zakupu. Zapisz dokument
i zanotuj numer faktury oraz symbol towaru z tego wiersza. Potem ta sama zamiatarka
z `@szukane = N'ZNACZNIK-WERTIS-001'` i porównaniem `LIKE N'%' + @p + N'%'`
zamiast `= @p`. Wynik wskazuje tabelę i kolumnę **przechowującą treść** — czyli
cel przyszłego zapisu.

Zasiew jest po to, żeby szukać czegoś unikalnego: szukanie po prawdziwej treści
(„brak 2 szt.") daje trafienia przypadkowe i nie rozstrzyga niczego. Po zwiadzie
skasuj znacznik — w Subiekcie, nie `UPDATE`-em w SQL.

Najprostszy wariant, gdy podejrzenie pada wprost na `dok_Pozycja`:

```sql
DECLARE @nr varchar(50) = 'FZ 123/2026';   -- faktura z zasiewem
SELECT p.* FROM dok_Pozycja p
JOIN dok__Dokument d ON d.dok_Id = p.ob_DokHanId
WHERE d.dok_NrPelny = @nr;
```

Wiersz z znacznikiem pokaże wprost nazwę kolumny **oraz** identyfikator pozycji,
którym trzeba będzie ją zaadresować. Gdy treść siedzi w tabeli osobnej:

```sql
SELECT * FROM <tabela z tropu 2>
WHERE CAST(<kolumna z tropu 2> AS nvarchar(max)) LIKE N'%ZNACZNIK-WERTIS-001%';
```

Sprawdź, czy wiersz **istnieje zawsze, czy powstaje dopiero przy pierwszym
wpisie**: to rozstrzyga między `UPDATE` a MERGE i między `GRANT UPDATE`
a `GRANT INSERT, UPDATE`.

### Zanim cokolwiek tam napisze

Trzy rzeczy do rozstrzygnięcia świadomie, nie przy implementacji:

1. **Gdyby to okazała się kolumna na `dok_Pozycja`.** Zapis tam wymaga
   `GRANT UPDATE` na tabelę pozycji, czyli na rdzeń ewidencji. Stoją tam ilości
   i ceny. Grant kolumnowy zawęża to do jednej kolumny, tak jak przy `tw_PoleN`.
   Sama decyzja jest jednak architektoniczna: dotąd aplikacja nie miała prawa
   zapisu do żadnej tabeli dokumentów. Patrz punkt 2 rozdziału o fladze.
2. **Faktura zatwierdzona.** Subiekt blokuje edycję takich dokumentów
   w interfejsie; `UPDATE` prosto w SQL tę blokadę obejdzie. Pytanie praktyczne,
   które to rozstrzyga: czy magazynier wpisuje różnice zanim biuro zatwierdzi
   fakturę, czy po. Dla dokumentu w buforze (`dok_Status = 3`) kolejka ma już
   osobny stan `waiting_for_doc`.
3. **Do której komórki przy towarze powtórzonym.** Linia robocza niesie listę
   identyfikatorów, a nie jeden — trzeba więc rozstrzygnąć regułę: pierwsza
   pozycja, wszystkie, czy ta o największej ilości. Lista jest posortowana
   rosnąco właśnie po to, żeby „pierwsza" była pojęciem jednoznacznym.

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
| kreator ustala sam | baza, magazyny, pole lokalizacji, flagi | potwierdzasz wybór z listy |
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

**Flagi faktury** (`MSSQL_FLAG_GRUPA`, `MSSQL_FLAG_TYP_OBIEKTU`). Oflaguj
najpierw ręcznie jedną fakturę w Subiekcie, potem podstaw jej numer:

```sql
SELECT w.flw_IdGrupyFlag, w.flw_TypObiektu, w.flw_IdFlagi, f.flg_Text, f.flg_Numer
FROM fl_Wartosc w
JOIN fl__Flagi  f ON f.flg_Id = w.flw_IdFlagi
JOIN dok__Dokument d ON d.dok_Id = w.flw_IdObiektu
WHERE d.dok_NrPelny = 'FZ 60/MAG/07/2026';
```

Identyfikatory czterech stanów (`DOC_FLAG_*_SGT`) bierzesz z listy flag:

```sql
SELECT flg_Id, flg_Text, flg_Numer, flg_IdGrupy FROM fl__Flagi ORDER BY flg_IdGrupy, flg_Numer;
```

Wpisujesz `flg_Id`, czyli liczbę — nie nazwę. Puste wartości znaczą, że zadania
flagowania kończą się czytelnym błędem. Reszta aplikacji działa normalnie.

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

Flagi są w tej ścieżce **pomijane bez słowa**, bo cały ich blok wymaga
połączenia. Zostają puste, więc zadania flagowania nie powstaną.

Właściwą reakcją jest dokończenie konfiguracji później, po nadaniu uprawnień:

```powershell
.\wertis-instalator.ps1 -TylkoKonfiguracja
```

## Dokument MM — na przyszłość

Gdy ruszy worker Sfery (albo import EPP), przyda się to, że dla MM struktura
używa dwóch pól magazynowych:

- `dok_MagId` — magazyn **źródłowy**,
- `dok_OdbiorcaId` — „dla MM oznacza identyfikator magazynu" (docelowy).

Typ dokumentu MM to `dok_Typ = 9`.

## Rodzaj zwrotu — niewykorzystana informacja

`dok_StatusEx` dla dokumentów ZW rozróżnia:

```
0-nieokreślony rodzaj zwrotu   1-zwrot ze sprzedaży   2-reklamacja
3-oczywista pomyłka
```

WERTIS tego dziś nie czyta. Reklamacja i zwrot ze sprzedaży to jednak różne
sytuacje na magazynie — reklamowany towar często nie wraca na półkę. Jeśli biuro
tę informację wypełnia, warto ją pokazać magazynierowi przy koszyku.

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

## Zasada nadrzędna

Zapis do bazy Subiekta ogranicza się do **dwóch rzeczy**: pola lokalizacji na
`tw__Towar` i przypisania flagi w `fl_Wartosc`. Zero `INSERT` do tabel
dokumentów, zero modyfikacji stanów, zero ingerencji w numerację — dokumenty MM
tworzy Sfera (COM) albo import EPP, nigdy bezpośredni SQL.
