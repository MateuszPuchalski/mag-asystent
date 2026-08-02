# Test z prawdziwym Subiektem GT (wersja edu) — krok po kroku

Instrukcja podłączenia WERTIS do **Subiekta GT edu** na Twoim komputerze.
Aplikacja zadziała wtedy na prawdziwych danych z Subiekta zamiast na seedzie
z `magmat.xlsx`.

Docelowa wersja produkcyjna w firmie to **Subiekt GT 1.87 SP3 HF1** (era KSeF).
Potwierdza ona wybór pola własnego na lokalizację — natywnego
`tw_Lokalizacja` w tych wersjach nie ma.

## Co działa, a co nie (edu = bez Sfery)

| Funkcja | edu | Jak |
|---|---|---|
| Skan / wyszukiwarka / karta towaru | ✅ | odczyt z bazy MSSQL Subiekta (import do read-modelu) |
| Stany MAG / MGP, lokalizacje | ✅ | jw. |
| Lista dokumentów FZ/PZ do rozłożenia | ✅ | jw. |
| Zmiana lokalizacji (`set_location`) | ✅ | bezpośredni `UPDATE` na wybranym polu własnym `tw__Towar` (plan B ze spec §9 — patrz §1a niżej) |
| Dokumenty MM (MGP→MAG, zatwierdź wózek) | ❌ | wymaga **Sfery** (COM) — brak w edu; zadanie w kolejce dostanie status `error` z komunikatem |

> MM **próbuje** się wykonać i kończy błędem, bo to funkcja, którą firma ma na
> produkcji — chcemy widzieć, że jej brakuje. Postęp rozkładania i wyjątki
> działają w edu normalnie, bo mieszkają w bazie aplikacji.

Dwie twarde zasady środowiska:

1. **Wszystko dzieje się na Windowsie z Subiektem** (lub w jego LAN).
   Instalator InsERT stawia SQL Server jako instancję nazwaną — zwykle
   `.\INSERTGT`. Aplikacji nie podłączysz do Subiekta z chmury.
2. Tryb wybiera JEDNA zmienna: `SGT_MODE=mssql`. Zapis (bezpośredni UPDATE
   dwóch kolumn) wynika z niej automatycznie — osobnego przełącznika nie ma.

Jak to działa w środku: interfejs odczytu aplikacji jest synchroniczny. Zamiast
żywych SELECT-ów per skan **importujemy** dane Subiekta do lokalnego
read-modelu `sgt_*` (SQLite). Import idzie przy starcie API, potem
co `MSSQL_SYNC_MS` (domyślnie 60 s) i na żądanie (`POST /api/admin/resync`).

Stany na ekranie są i tak korygowane o kolejkę, więc lag odświeżania nie
przekłamuje obrazu.

## 1. Włącz TCP/IP i logowanie SQL w instancji INSERTGT

Domyślnie instancja Subiekta przyjmuje tylko lokalne połączenia Windows.

1. Uruchom **SQL Server Configuration Manager** (na maszynie z Subiektem).
2. *SQL Server Network Configuration → Protocols for INSERTGT* →
   **TCP/IP → Enabled**. (Opcjonalnie w *IP Addresses → IPAll* ustaw stały
   `TCP Port`, np. `1433` — wtedy nie potrzebujesz usługi SQL Browser.)
3. *SQL Server Services* → restart usługi **SQL Server (INSERTGT)**.
   Jeśli łączysz się po nazwie instancji (bez portu), uruchom też usługę
   **SQL Server Browser** (Start Mode: Automatic).
4. Włącz **mixed authentication** (SQL + Windows). Najprościej w SSMS
   (Management Studio): prawy klik na serwer → *Properties → Security →
   SQL Server and Windows Authentication mode* → restart usługi.
   Bez SSMS — w rejestrze instancji `LoginMode=2`.

> Nazwę bazy znajdziesz w Subiekcie (pasek tytułu / wybór podmiotu) albo
> w SSMS — baza podmiotu utworzona przy zakładaniu firmy testowej edu.

## 1a. Lokalizacja: nie ma kolumny `tw_Lokalizacja` — wybierz pole własne

Zweryfikowane empirycznie (na edu): nowsze wersje Subiekta GT (z polami KSeF)
**nie mają natywnej kolumny lokalizacji** na `tw__Towar`. Zamiast tego są
generyczne pola własne `tw_Pole1` … `tw_Pole8`, każde `varchar(50)`. InsERT
zostawia decyzję o ich przeznaczeniu firmie.

Skoro budujesz dane testowe w edu **od zera**, to Ty decydujesz. Domyślnie
aplikacja używa `tw_Pole1` jako lokalizacji (`MSSQL_LOC_COLUMN=tw_Pole1`,
patrz §4). Możesz wybrać inne pole.

Jedyna zasada: wybrane pole własne wpisujesz w Subiekcie na karcie towaru,
w zakładce **Pola dodatkowe**. To tam, gdzie normalnie magazynier wpisywałby
kod regału.

> ⚠️ Przy prawdziwej, produkcyjnej bazie **nie zakładaj**, że tam też jest
> `tw_Pole1`. To osobna instalacja z osobną konfiguracją.
>
> Ktoś z dostępem do niej musi sprawdzić, którego pola firma faktycznie używa,
> i ustawić `MSSQL_LOC_COLUMN`. Sposób jest ten sam co niżej:
> `INFORMATION_SCHEMA.COLUMNS` plus porównanie wartości ze znanym rekordem.

## 1b. Zbuduj dane testowe w edu

Baza edu jest pusta/demo — nie ma w niej danych z Twojego `magmat.xlsx`
(to osobny, niepowiązany system, do którego nie masz dostępu). Żeby przetestować
połączenie appki z Subiektem, dopisz w samym Subiekcie kilka rzeczy:

1. **Magazyn MGP** — w *Ustawienia → Słowniki → Magazyny* dodaj drugi magazyn
   obok domyślnego (np. kod `MGP`, nazwa „Strefa przyjęć").
2. **Kilka kartotek towaru** — w *Towary → Dodaj* wypełnij Symbol, Nazwę, kod
   kreskowy (EAN) i stan na obu magazynach.

   W zakładce **Pola dodatkowe** wpisz kod lokalizacji w polu wybranym w §1a
   (np. `tw_Pole1` → `H04-05-02`). Dla części towarów zostaw to pole puste —
   przetestuje to ścieżkę „BRAK LOK".
3. **Jeden dokument PZ/FZ** na magazyn MGP — *Dokumenty → Nowy → PZ*, z kilkoma
   pozycjami z kroku 2.

   Da Ci to dane do checklisty §3 oraz coś do rozłożenia w module put-away.

Nie musisz wpisywać setek rekordów — kilkanaście kartotek i jeden dokument
wystarczą, żeby end-to-end zweryfikować połączenie.

## 2. Utwórz JEDEN login SQL (najmniejsze uprawnienia)

Jeden login = jedna rzecz do założenia i jedna do pilnowania. Uprawnienia są
kolumnowe: nawet przy przejęciu credentiala da się zmienić wyłącznie dwie
kolumny, reszta bazy pozostaje nietykalna.

> **Instalacja sprzed sierpnia 2026 musi uruchomić ten skrypt PONOWNIE.**
> Doszedł `GRANT SELECT ON dbo.sl_Magazyn` — bez niego karta towaru pokazuje
> tylko MAG, MGP i Zwroty, a `/api/health` mówi o tym wprost w `problemy`.
> Aplikacja działa dalej; traci wyłącznie zestawienie „gdzie towar jeszcze leży".

> **Ten skrypt jest źródłem prawdy dla instalatora.** `Get-WertisSkryptUprawnien`
> w [`instalator/sql.ps1`](../instalator/sql.ps1) odtwarza go co do grantu —
> przy zmianie uprawnień poprawia się **oba miejsca**. Rozjazd nie rzuciłby
> błędem: aplikacja działałaby tak samo, tylko konto miałoby inne prawa, niż
> mówi ta instrukcja.

W SSMS, na bazie podmiotu (podmień `NAZWA_BAZY` i hasło). Skrypt jest
idempotentny — bezpiecznie uruchomić go ponownie (np. po zmianie
`MSSQL_LOC_COLUMN`):

```sql
USE [NAZWA_BAZY];

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wertis')
    CREATE LOGIN wertis WITH PASSWORD = 'silne-haslo', CHECK_POLICY = ON;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wertis')
    CREATE USER wertis FOR LOGIN wertis;

-- ODCZYT: wyłącznie tabele potrzebne aplikacji
GRANT SELECT ON dbo.tw__Towar      TO wertis;
GRANT SELECT ON dbo.tw_Stan        TO wertis;
GRANT SELECT ON dbo.dok__Dokument  TO wertis;
GRANT SELECT ON dbo.dok_Pozycja    TO wertis;
GRANT SELECT ON dbo.kh__Kontrahent TO wertis;
GRANT SELECT ON dbo.sl_Magazyn     TO wertis;   -- nazwy i symbole magazynów

-- ZAPIS — JEDNA rzecz i ani jednej więcej.
--
-- Lokalizacja: JEDNA kolumna na kartotece. Podmień tw_Pole1 na pole wybrane
-- w §1a (MSSQL_LOC_COLUMN musi się zgadzać!). Do dok__Dokument, tw_Stan
-- i tabel dokumentów aplikacja nie ma żadnego prawa zapisu.
GRANT UPDATE ON dbo.tw__Towar (tw_Pole1) TO wertis;
```

Sprawdź teraz, że uprawnienia faktycznie się nadały. Warto to robić po każdym
`GRANT`: błąd na `CREATE LOGIN` albo `CREATE USER` nie przerywa reszty skryptu,
bo kolejne `GRANT`-y w SSMS i tak się wykonują.

```sql
SELECT dp.permission_name, dp.state_desc,
       OBJECT_NAME(dp.major_id) AS obiekt,
       c.name AS kolumna,
       pr.name AS login
FROM sys.database_permissions dp
LEFT JOIN sys.columns c ON c.object_id = dp.major_id AND c.column_id = dp.minor_id
JOIN sys.database_principals pr ON pr.principal_id = dp.grantee_principal_id
WHERE pr.name = 'wertis'
ORDER BY dp.permission_name;
```

## 3. Checklist `[WERYFIKUJ]` — ustal wartości dla SWOJEJ bazy

Większość dawnej checklisty jest już **zamknięta**. Nazwy tabel i kolumn oraz
kody `dok_Typ` i `dok_Status` odczytaliśmy wprost z oficjalnego opisu struktury
InsERT dla wersji bazy 1.8731.31.6933 — patrz
[`subiekt-gt-struktura.md`](subiekt-gt-struktura.md).

Domyślne w `config.ts` są z niego wzięte, więc nie trzeba ich już ustalać:
`DOK_TYP_FZ=1`, `DOK_TYP_PZ=10`, bufor = `dok_Status = 3`.

Zostały **dwie** rzeczy, których dokumentacja nie zawiera, bo zależą od
konkretnego podmiotu. Uruchom w SSMS na kartotece/dokumencie z §1b:

```sql
-- 0) potwierdź, że wybrane pole własne faktycznie trzyma to, co wpisałeś
--    na karcie towaru (podmień symbol i tw_Pole1 na swój wybór z §1a):
SELECT tw_Symbol, tw_Pole1 FROM tw__Towar WHERE tw_Symbol = 'TWOJ-SYMBOL';
--    → jeśli wartość się zgadza z tym, co wpisałeś w Subiekcie: env
--      MSSQL_LOC_COLUMN=tw_Pole1 (albo inne pole, jeśli wybrałeś inne)

-- a) mag_Id magazynów: głównego, strefy przyjęć MGP i Zwrotów:
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
--    → env MAG_ID_MAG / MAG_ID_MGP / MAG_ID_ZWROTY
--    (magazyn główny poznasz po mag_Glowny = 1; MGP i Zwroty po nazwie firmowej)
```

Dwie rzeczy warto tylko **potwierdzić**, bo domyślne powinny pasować:

```sql
-- pole własne wybrane w §1a faktycznie trzyma lokalizację i ma 50 znaków:
SELECT COL_LENGTH('tw__Towar','tw_Pole1');          -- → LOC_FIELD_LIMIT (spodziewane 50)

-- odłóż dokument do bufora w Subiekcie i sprawdź, czy dostał dok_Status = 3:
SELECT dok_Id, dok_NrPelny, dok_Typ, dok_Status FROM dok__Dokument ORDER BY dok_Id DESC;
--    → jeśli tak, MSSQL_BUFFER_EXPR zostaje domyślne
```

## 4. Konfiguracja i uruchomienie aplikacji

Na maszynie z Subiektem, w katalogu repo (Git Bash albo WSL):

```bash
npm ci
npm run build
```

Ustawienia idą do **jednego pliku dla obu procesów** — API i worker mają osobne
środowiska, a rozjazd między nimi kończy się cichym gubieniem zapisów:

```bash
cp wertis.env.example wertis.env
nano wertis.env
```

```bash
# wertis.env — połączenie (przy stałym porcie zamiast MSSQL_INSTANCE
# ustaw MSSQL_PORT=1433)
export SGT_MODE=mssql
export MSSQL_SERVER=localhost
export MSSQL_INSTANCE=INSERTGT
export MSSQL_DATABASE=NAZWA_BAZY
export MSSQL_USER=wertis
export MSSQL_PASSWORD=silne-haslo

# wartości z checklisty §3:
export MSSQL_LOC_COLUMN=tw_Pole1      # pole własne wybrane w §1a
export MAG_ID_MAG=1                   # z checklisty (a)
export MAG_ID_MGP=2
export MAG_ID_ZWROTY=3
# DOK_TYP_* i MSSQL_BUFFER_EXPR mają poprawne domyślne (ze struktury InsERT) —
# ustawiaj je tylko, jeśli Twoja baza odbiega od standardu
```

Uruchomienie — **oba okna z tego samego pliku**:

```bash
# okno 1: API (importuje przy starcie i odświeża co MSSQL_SYNC_MS, domyślnie
# 60 s; liczby zaimportowanych wierszy widać w logu i w GET /api/health)
source wertis.env && npm start

# okno 2: worker zapisu
source wertis.env && npm -w server run start:worker
```

Przeglądarka / kolektor: `http://localhost:3001`.

**Najpierw sprawdź, czy w ogóle rozmawiasz z Subiektem:**

```bash
curl -s http://localhost:3001/api/health
# {"ok":true,"mode":"mssql","sferaMode":"sql","lastSync":{"towary":…,"at":"…"}}
```

`"mode":"seeded"` znaczy, że `SGT_MODE` nie doszło do procesu. Pracujesz wtedy
na danych demo z `magmat.xlsx`. Subiekt nie jest ani odczytywany, ani
zapisywany, mimo że wszystko wygląda normalnie.

Wymuszenie odświeżenia po zmianach w Subiekcie (np. nowe PZ):

```bash
curl -s -X POST http://localhost:3001/api/admin/resync
```

## 5. Test end-to-end

> **Najpierw konta.** Kolektor bez kont nie przepuszcza dalej niż ekran
> startowy — przy pustej instalacji zaproponuje kreator (**ZAŁÓŻ KONTA**).
> Bez konta nie zeskanujesz nic, więc ten krok wyprzedza wszystkie poniższe.
> Instrukcja: [DEPLOY §5a](../DEPLOY.md).

1. **Odczyt:** zeskanuj / wyszukaj towar, który widzisz w Subiekcie —
   porównaj stany MAG/MGP i lokalizację z kartoteką.
2. **Zapis lokalizacji:** zmień lokalizację testowej kartoteki w aplikacji.
   Poczekaj, aż zadanie w kolejce przejdzie na `done`.

   Sprawdź wynik w Subiekcie (karta towaru → **Pola dodatkowe**) albo w SSMS:
   `SELECT tw_Pole1 FROM tw__Towar WHERE tw_Id = …`. Nazwa pola jak
   w `MSSQL_LOC_COLUMN`.

   Jeśli zmianę widać w aplikacji, a w Subiekcie nie — sprawdź najpierw
   `curl -s http://localhost:3001/api/health`. `"mode":"seeded"` w którymkolwiek
   z procesów znaczy, że zapis poszedł do lokalnej bazy aplikacji. Zadanie
   i tak zakończyło się statusem `done`.

3. **Usunięcie lokalizacji:** wyczyść lokalizację i sprawdź to samo. Pusta
   wartość to osobna ścieżka zapisu i warto ją przejść świadomie.
4. **MM (oczekiwany błąd):** zatwierdź MM albo wózek. Zadanie po 3 próbach
   dostanie `error` z komunikatem „Dokument MM wymaga Sfery…". To poprawne
   zachowanie na edu.

## Ograniczenia i uwagi

- **edu** ma limity ilości zapisów i dokumentów. Służy wyłącznie do nauki
  i testów — idealnie do tego scenariusza, nie do produkcji.
- **edu to osobna instalacja, niepowiązana z prawdziwą bazą produkcyjną**
  (skąd pochodzi na przykład eksport `magmat.xlsx`).

  Wartości ustalone tutaj — kolumna lokalizacji, kody `dok_Typ`, `mag_Id` —
  dotyczą TYLKO tej instalacji edu. Przy podłączaniu do prawdziwego Subiekta
  ustala się je od nowa, na tamtej bazie. Checklistę §3 powtarza ktoś
  z dostępem do niej.
- Kolumna „Zamówione" w karcie towaru pokazuje 0 w trybie mssql. W bazie SGT
  nie ma prostej kolumny — wartość pochodzi z dokumentów ZK/ZD. Zostaje to do
  ewentualnej rozbudowy importera.
- Nazwa dostawcy na liście dokumentów to `kh_Symbol` (pewna kolumna w każdej
  wersji). Pełną nazwę można dociągnąć z `adr__Ekran (adr_NazwaPelna)`.
  Wymaga to dodatkowego `GRANT SELECT` i korekty JOIN-a
  w `server/src/adapters/subiekt.mssql.ts`.
- Dokumenty MM — z rundy wózka (kontener) — wymagają licencji **Sfery** na produkcyjnym Subiekcie. Potrzebny jest osobny
  worker COM na Windows (C#/pywin32) czytający tę samą tabelę `sfera_queue`.
  Kontrakt jest w `server/src/adapters/sfera.ts`, etap 2
  w [DEPLOY.md](../DEPLOY.md). Do tego czasu MM wystawia biuro.
