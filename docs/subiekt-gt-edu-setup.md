# Test z prawdziwym Subiektem GT (wersja edu) — krok po kroku

Instrukcja podłączenia WERTIS do **Subiekta GT edu** na Twoim komputerze,
żeby aplikacja działała na prawdziwych danych z Subiekta zamiast seedu
z `mag.xlsx`.

## Co działa, a co nie (edu = bez Sfery)

| Funkcja | edu | Jak |
|---|---|---|
| Skan / wyszukiwarka / karta towaru | ✅ | odczyt z bazy MSSQL Subiekta (import do read-modelu) |
| Stany MAG / MGP, lokalizacje | ✅ | jw. |
| Lista dokumentów FZ/PZ do rozłożenia | ✅ | jw. |
| Zmiana lokalizacji (`set_location`) | ✅ | bezpośredni `UPDATE` na wybranym polu dodatkowym `tw__Towar` (plan B ze spec §9 — patrz §1a niżej) |
| Dokumenty MM (MGP→MAG, zatwierdź wózek) | ❌ | wymaga **Sfery** (COM) — brak w edu; zadanie w kolejce dostanie status `error` z komunikatem |

Dwie twarde zasady środowiska:

1. **Wszystko dzieje się na Windowsie z Subiektem** (lub w jego LAN).
   Instalator InsERT stawia SQL Server jako instancję nazwaną — zwykle
   `.\INSERTGT`. Aplikacji nie podłączysz do Subiekta z chmury.
2. Tryb wybierają dwie zmienne: `SGT_MODE=mssql` (odczyt z bazy Subiekta)
   i `SFERA_MODE=sql` (zapis lokalizacji po SQL; to domyślne przy
   `SGT_MODE=mssql`).

Jak to działa w środku: interfejs odczytu aplikacji jest synchroniczny, więc
zamiast żywych SELECT-ów per skan **importujemy** dane Subiekta do lokalnego
read-modelu `sgt_*` (SQLite) — przy starcie API, potem co `MSSQL_SYNC_MS`
(domyślnie 60 s) i na żądanie (`POST /api/admin/resync`). Stany na ekranie są
i tak korygowane o kolejkę, więc lag odświeżania nie przekłamuje obrazu.

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

## 1a. Lokalizacja: nie ma kolumny `tw_Lokalizacja` — wybierz pole dodatkowe

Zweryfikowane empirycznie (na edu): nowsze wersje Subiekta GT (z polami KSeF)
**nie mają natywnej kolumny lokalizacji** na `tw__Towar`. Zamiast tego są
generyczne pola dodatkowe **`tw_Pole1` … `tw_Pole8`** (każde `varchar(50)`) —
InsERT zostawia użytkownikowi decyzję, do czego ich użyć.

Skoro budujesz dane testowe w edu **od zera**, to Ty decydujesz. Domyślnie
aplikacja używa **`tw_Pole1`** jako lokalizacji (`MSSQL_LOC_COLUMN=tw_Pole1`,
patrz §4) — możesz to zmienić na inne pole, jeśli wolisz. Jedyna zasada: pole
dodatkowe, które wybierzesz, wpisujesz w Subiekcie na karcie towaru (zakładka
**Pola dodatkowe**) — tam, gdzie normalnie magazynier wpisywałby kod regału.

> Jeśli kiedyś dostaniesz dostęp do prawdziwej, produkcyjnej bazy WERTIS —
> **nie zakładaj**, że tam też jest `tw_Pole1`. To osobna instalacja z osobną
> konfiguracją; ktoś z dostępem do niej musi sprawdzić, którego pola
> faktycznie używają (ten sam sposób co niżej — `INFORMATION_SCHEMA.COLUMNS`
> + porównanie wartości ze znanym rekordem), i ustawić `MSSQL_LOC_COLUMN`
> odpowiednio.

## 1b. Zbuduj dane testowe w edu

Baza edu jest pusta/demo — nie ma w niej danych z Twojego `magmat.xlsx`
(to osobny, niepowiązany system, do którego nie masz dostępu). Żeby przetestować
połączenie appki z Subiektem, dopisz w samym Subiekcie kilka rzeczy:

1. **Magazyn MGP** (jeśli go nie masz): *Ustawienia → Słowniki → Magazyny* →
   dodaj drugi magazyn obok domyślnego (np. kod `MGP`, nazwa „Strefa przyjęć").
2. **Kilka kartotek towaru** (*Towary → Dodaj*): wypełnij Symbol, Nazwę, Kod
   kreskowy (EAN), stan na obu magazynach, a w zakładce **Pola dodatkowe**
   wpisz kod lokalizacji w polu, które wybrałeś w §1a (np. `tw_Pole1` →
   `H04-05-02`). Dla części towarów zostaw to pole puste — to przetestuje
   ścieżkę „BRAK LOK".
3. **Jeden dokument PZ/FZ** na magazyn MGP (*Dokumenty → Nowy → PZ*), z kilkoma
   pozycjami z kroku 2 — to da Ci dane do checklisty §3 (a) i (c) oraz coś do
   rozłożenia w module put-away.

Nie musisz wpisywać setek rekordów — kilkanaście kartotek i jeden dokument
wystarczą, żeby end-to-end zweryfikować połączenie.

## 2. Utwórz loginy SQL (najmniejsze uprawnienia)

W SSMS, na bazie podmiotu (podmień `NAZWA_BAZY` i hasła). Skrypt jest
idempotentny — bezpiecznie uruchomić go ponownie (np. po zmianie
`MSSQL_LOC_COLUMN`), `CREATE LOGIN`/`CREATE USER` nie wysypią się błędem
„already exists", jeśli loginy już są:

```sql
USE [NAZWA_BAZY];

-- login ODCZYTU: wyłącznie SELECT na tabelach potrzebnych aplikacji
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wertis_read')
    CREATE LOGIN wertis_read WITH PASSWORD = 'silne-haslo-1', CHECK_POLICY = ON;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wertis_read')
    CREATE USER wertis_read FOR LOGIN wertis_read;
GRANT SELECT ON dbo.tw__Towar      TO wertis_read;
GRANT SELECT ON dbo.tw_Stan        TO wertis_read;
GRANT SELECT ON dbo.dok__Dokument  TO wertis_read;
GRANT SELECT ON dbo.dok_Pozycja    TO wertis_read;
GRANT SELECT ON dbo.kh__Kontrahent TO wertis_read;

-- login ZAPISU: UPDATE wyłącznie na jednej kolumnie (plan B, spec §9).
-- Podmień tw_Pole1 na pole, które wybrałeś w §1a (MSSQL_LOC_COLUMN musi się
-- z tym zgadzać!).
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = 'wertis_write')
    CREATE LOGIN wertis_write WITH PASSWORD = 'silne-haslo-2', CHECK_POLICY = ON;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = 'wertis_write')
    CREATE USER wertis_write FOR LOGIN wertis_write;
GRANT SELECT ON dbo.tw__Towar TO wertis_write;                 -- WHERE tw_Id=…
GRANT UPDATE ON dbo.tw__Towar (tw_Pole1) TO wertis_write;
```

Weryfikacja, że uprawnienia faktycznie się nadały (przydaje się też po każdym
`GRANT`, bo błąd na `CREATE LOGIN`/`CREATE USER` nie przerywa reszty skryptu —
kolejne `GRANT`-y w SSMS i tak się wykonują):

```sql
SELECT dp.permission_name, dp.state_desc,
       OBJECT_NAME(dp.major_id) AS obiekt,
       c.name AS kolumna,
       pr.name AS login
FROM sys.database_permissions dp
LEFT JOIN sys.columns c ON c.object_id = dp.major_id AND c.column_id = dp.minor_id
JOIN sys.database_principals pr ON pr.principal_id = dp.grantee_principal_id
WHERE pr.name IN ('wertis_read','wertis_write')
ORDER BY pr.name, dp.permission_name;
```

## 3. Checklist `[WERYFIKUJ]` — ustal wartości dla SWOJEJ bazy

Nazwy/kody różnią się między wersjami SGT (spec §6, §11) — a jak się
przekonaliśmy na tw_Lokalizacja, czasem różnią się też same kolumny. Nie
zgaduj — uruchom w SSMS na kartotece/dokumencie, które utworzyłeś w §1b,
i zanotuj wyniki:

```sql
-- 0) potwierdź, że wybrane pole dodatkowe faktycznie trzyma to, co wpisałeś
--    na karcie towaru (podmień symbol i tw_Pole1 na swój wybór z §1a):
SELECT tw_Symbol, tw_Pole1 FROM tw__Towar WHERE tw_Symbol = 'TWOJ-SYMBOL';
--    → jeśli wartość się zgadza z tym, co wpisałeś w Subiekcie: env
--      MSSQL_LOC_COLUMN=tw_Pole1 (albo inne pole, jeśli wybrałeś inne)

-- a) kody dok_Typ dla FZ i PZ (na dokumencie utworzonym w §1b):
SELECT dok_Id, dok_Typ, dok_NrPelny, dok_MagId, dok_Status
FROM dok__Dokument ORDER BY dok_Id DESC;   -- → env DOK_TYP_FZ / DOK_TYP_PZ

-- b) mag_Id magazynów (głównego i strefy przyjęć MGP z §1b):
SELECT * FROM sl_Magazyn;                  -- → env MAG_ID_MAG / MAG_ID_MGP
-- (jeśli SELECT nie przejdzie na loginie wertis_read, wykonaj jako sa —
--  tabela słownikowa nie jest potrzebna aplikacji w runtime)

-- c) flaga bufora: zapisz dokument „do bufora" w Subiekcie i porównaj
--    kolumny (najczęściej dok_Status; odłożony/bufor vs wystawiony):
SELECT dok_Id, dok_NrPelny, dok_Status FROM dok__Dokument ORDER BY dok_Id DESC;
--    → env MSSQL_BUFFER_EXPR, np. 'CASE WHEN d.dok_Status = 0 THEN 1 ELSE 0 END'

-- d) limit wybranego pola lokalizacji (tw_Pole1..8 to zawsze varchar(50),
--    ale podmień nazwę, jeśli wybrałeś inne pole):
SELECT COL_LENGTH('tw__Towar','tw_Pole1');   -- → env LOC_FIELD_LIMIT
```

Uwaga do (a): interesuje Cię typ, który **niesie skutek magazynowy** na MGP —
to on ma się pokazywać na liście „do rozłożenia".

## 4. Konfiguracja i uruchomienie aplikacji

Na maszynie z Subiektem (PowerShell, w katalogu repo):

```powershell
npm ci
npm run build

# połączenie (instancja nazwana; przy stałym porcie zamiast MSSQL_INSTANCE
# ustaw MSSQL_PORT=1433)
$env:SGT_MODE        = "mssql"
$env:MSSQL_SERVER    = "localhost"
$env:MSSQL_INSTANCE  = "INSERTGT"
$env:MSSQL_DATABASE  = "NAZWA_BAZY"
$env:MSSQL_USER      = "wertis_read"
$env:MSSQL_PASSWORD  = "silne-haslo-1"
$env:MSSQL_WRITE_USER     = "wertis_write"
$env:MSSQL_WRITE_PASSWORD = "silne-haslo-2"

# wartości z checklisty [WERYFIKUJ]:
$env:MSSQL_LOC_COLUMN  = "tw_Pole1"   # pole dodatkowe wybrane w §1a
$env:DOK_TYP_FZ   = "1"
$env:DOK_TYP_PZ   = "5"
$env:MAG_ID_MAG   = "1"
$env:MAG_ID_MGP   = "2"
$env:MSSQL_BUFFER_EXPR = "CASE WHEN d.dok_Status = 0 THEN 1 ELSE 0 END"
$env:LOC_FIELD_LIMIT   = "50"

# test importu (jednorazowy — loguje liczby zaimportowanych wierszy):
npm run import:mssql

# API (importuje przy starcie i odświeża co MSSQL_SYNC_MS, domyślnie 60 s):
node server\dist\index.js
# w drugim oknie (z tymi samymi $env:) worker zapisu:
node server\dist\worker\worker.js
```

Przeglądarka / kolektor: `http://localhost:3001`.
Kontrola: `http://localhost:3001/api/health` →
`{ ok: true, mode: "mssql", sferaMode: "sql", lastSync: { towary: …, … } }`.

Wymuszenie odświeżenia po zmianach w Subiekcie (np. nowe PZ):
`POST http://localhost:3001/api/admin/resync`.

## 5. Test end-to-end

1. **Odczyt:** zeskanuj / wyszukaj towar, który widzisz w Subiekcie —
   porównaj stany MAG/MGP i lokalizację z kartoteką.
2. **Zapis lokalizacji:** zmień lokalizację testowej kartoteki w aplikacji;
   po przejściu zadania w kolejce na `done` sprawdź w Subiekcie (karta
   towaru → Pola dodatkowe) lub w SSMS:
   `SELECT tw_Pole1 FROM tw__Towar WHERE tw_Id = …` (nazwa pola jak w
   `MSSQL_LOC_COLUMN`).
3. **MM (oczekiwany błąd):** zatwierdź MM/wózek — zadanie po 3 próbach
   dostanie `error` z komunikatem „Dokument MM wymaga Sfery…". To poprawne
   zachowanie na edu.

## Ograniczenia i uwagi

- **edu** ma limity ilości zapisów/dokumentów i jest wyłącznie do nauki/testów
  — idealne do tego scenariusza, nie do produkcji.
- **edu to osobna instalacja, niepowiązana z prawdziwą bazą produkcyjną**
  (skąd np. pochodzi eksport `magmat.xlsx`). Wartości ustalone tu (kolumna
  lokalizacji, kody `dok_Typ`, `mag_Id`) dotyczą TYLKO tej instalacji edu —
  przy podłączaniu do prawdziwego Subiekta trzeba je ustalić od nowa, na tamtej
  bazie (ktoś z dostępem do niej powtarza checklistę §3).
- Kolumna „Zamówione" w karcie towaru pokazuje 0 w trybie mssql (w bazie SGT
  nie ma prostej kolumny; wartość pochodzi z dokumentów ZK/ZD) — do
  ewentualnej rozbudowy importera.
- Nazwa dostawcy na liście dokumentów to `kh_Symbol` (pewna kolumna w każdej
  wersji). Pełną nazwę można dociągnąć z `adr__Ekran (adr_NazwaPelna)` —
  wymaga dodatkowego `GRANT SELECT` i korekty JOIN-a w
  `server/src/adapters/subiekt.mssql.ts`.
- Pełny obieg z MM wymaga licencji **Sfery** na produkcyjnym Subiekcie —
  wtedy `SFERA_MODE=com` i implementacja `server/src/adapters/sfera.com.ts`
  (etap 2 w [DEPLOY.md](../DEPLOY.md), §7).
