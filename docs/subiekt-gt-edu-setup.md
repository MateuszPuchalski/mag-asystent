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
| Zmiana lokalizacji (`set_location`) | ✅ | bezpośredni `UPDATE tw__Towar.tw_Lokalizacja` (plan B ze spec §9) |
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

## 2. Utwórz loginy SQL (najmniejsze uprawnienia)

W SSMS, na bazie podmiotu (podmień `NAZWA_BAZY` i hasła):

```sql
USE [NAZWA_BAZY];

-- login ODCZYTU: wyłącznie SELECT na tabelach potrzebnych aplikacji
CREATE LOGIN wertis_read WITH PASSWORD = 'silne-haslo-1', CHECK_POLICY = ON;
CREATE USER wertis_read FOR LOGIN wertis_read;
GRANT SELECT ON dbo.tw__Towar      TO wertis_read;
GRANT SELECT ON dbo.tw_Stan        TO wertis_read;
GRANT SELECT ON dbo.dok__Dokument  TO wertis_read;
GRANT SELECT ON dbo.dok_Pozycja    TO wertis_read;
GRANT SELECT ON dbo.kh__Kontrahent TO wertis_read;

-- login ZAPISU: UPDATE wyłącznie na jednej kolumnie (plan B, spec §9)
CREATE LOGIN wertis_write WITH PASSWORD = 'silne-haslo-2', CHECK_POLICY = ON;
CREATE USER wertis_write FOR LOGIN wertis_write;
GRANT SELECT ON dbo.tw__Towar TO wertis_write;                 -- WHERE tw_Id=…
GRANT UPDATE ON dbo.tw__Towar (tw_Lokalizacja) TO wertis_write;
```

## 3. Checklist `[WERYFIKUJ]` — ustal wartości dla SWOJEJ bazy

Nazwy/kody różnią się między wersjami SGT (spec §6, §11). Uruchom w SSMS
i zanotuj wyniki:

```sql
-- a) kody dok_Typ dla FZ i PZ: wystaw w Subiekcie po jednym FZ i PZ,
--    potem sprawdź po numerze:
SELECT dok_Id, dok_Typ, dok_NrPelny, dok_MagId, dok_Status
FROM dok__Dokument ORDER BY dok_Id DESC;   -- → env DOK_TYP_FZ / DOK_TYP_PZ

-- b) mag_Id magazynów (głównego i strefy przyjęć — MGP utwórz w Subiekcie,
--    jeśli nie istnieje: Podmiot → Magazyny):
SELECT * FROM sl_Magazyn;                  -- → env MAG_ID_MAG / MAG_ID_MGP
-- (jeśli SELECT nie przejdzie na loginie wertis_read, wykonaj jako sa —
--  tabela słownikowa nie jest potrzebna aplikacji w runtime)

-- c) flaga bufora: zapisz dokument „do bufora" w Subiekcie i porównaj
--    kolumny (najczęściej dok_Status; odłożony/bufor vs wystawiony):
SELECT dok_Id, dok_NrPelny, dok_Status FROM dok__Dokument ORDER BY dok_Id DESC;
--    → env MSSQL_BUFFER_EXPR, np. 'CASE WHEN d.dok_Status = 0 THEN 1 ELSE 0 END'

-- d) limit pola lokalizacji:
SELECT COL_LENGTH('tw__Towar','tw_Lokalizacja');   -- → env LOC_FIELD_LIMIT
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
   towaru → Lokalizacja) lub w SSMS:
   `SELECT tw_Lokalizacja FROM tw__Towar WHERE tw_Id = …`.
3. **MM (oczekiwany błąd):** zatwierdź MM/wózek — zadanie po 3 próbach
   dostanie `error` z komunikatem „Dokument MM wymaga Sfery…". To poprawne
   zachowanie na edu.

## Ograniczenia i uwagi

- **edu** ma limity ilości zapisów/dokumentów i jest wyłącznie do nauki/testów
  — idealne do tego scenariusza, nie do produkcji.
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
