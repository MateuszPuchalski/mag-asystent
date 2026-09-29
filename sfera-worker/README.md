# Worker Sfery — dokumenty w Subiekcie (C#/.NET)

Trzeci proces WERTIS, obok `wertis-api` i `wertis-worker`. Czyta tę samą
kolejkę `sfera_queue` w SQLite i wykonuje **zadania dokumentowe** przez COM
Sfery Subiekta GT. `set_location` zostaje w workerze Node, bo to UPDATE jednej
kolumny i Sfera nie jest do niego potrzebna.

| typ zadania | co powstaje |
|---|---|
| `mm` | dokument przesunięcia magazynowego |
| `korekta_zwrot` | korekta sprzedaży, MM na magazyn zwrotów i RW dla pozycji zniszczonych — atomowo |
| `zw` | ZW do paragonu, bez MM; kroki w `docs/sfera-com.md` §2m |

**Atomowo** znaczy: gdy ogniwo padnie, wszystko przed nim zostaje usunięte,
bo Subiekt nie ma transakcji na kilka dokumentów. Nieudane wycofanie kończy się
błędem, który wymienia Z IMIENIA dokumenty do ręcznego usunięcia. Dlaczego
osobny proces: [`docs/architektura.md`](../docs/architektura.md) §3. Kontrakt:
[`server/src/adapters/sfera.ts`](../server/src/adapters/sfera.ts).

## Wymagania

| co | po co |
|---|---|
| Windows z Subiektem GT | COM Sfery jest biblioteką lokalną |
| **licencja Sfery** | bez niej COM nie wystartuje; na podmiocie testowym wystarczy próbna |
| operator Subiekta z prawem do MM i korekt | to użytkownik Subiekta, nie login SQL |
| dostęp do `C:\wertis\server\data\wertis.db` | wspólna kolejka z API i workerem Node |
| `SFERA_WORKER=1` w `wertis.env` | bez tego proces odmawia startu, żeby nie było dwóch wykonawców |

## Budowa i wdrożenie

**Najkrócej: weź exe z CI** (workflow `Worker Sfery` → Artifacts →
`wertis-sfera-worker`). Late binding sprawia, że kompilacja nie potrzebuje
Subiekta ani Windowsa. Build lokalny wymaga **.NET 8 SDK**, nie Runtime
(`winget install Microsoft.DotNet.SDK.8`, potem nowe okno). SDK idzie na maszynę
dewelopera, **nie na serwer firmy**: `--self-contained` wkłada runtime do exe.

```powershell
# maszyna z .NET 8 SDK (NIE serwer firmy); ścieżka względna wobec katalogu:
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\build.ps1  # z korzenia repo
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1                # z katalogu sfera-worker
# → sfera-worker\publish\wertis-sfera-worker.exe

# serwer firmy:
#  1. skopiuj exe do C:\wertis\sfera-worker\
#  2. dopisz do C:\wertis\wertis.env:  SFERA_WORKER=1, SFERA_OPERATOR, SFERA_OPERATOR_HASLO
#  3. uruchom instalator (zarejestruje usługę wertis-sfera) albo ręcznie:
nssm install wertis-sfera C:\wertis\sfera-worker\wertis-sfera-worker.exe
#  4. zrestartuj WSZYSTKIE usługi (wszystkie czytają wertis.env)
```

Kolejność i bramki: [`DEPLOY.md`](../DEPLOY.md) §6, etap 2, oraz
[`docs/wdrozenie.md`](../docs/wdrozenie.md). Najpierw `--dry-run` na podmiocie
testowym (na kopii bazy Sfera traci licencję), potem jedno MM na kartotece
próbnej, dopiero potem produkcja.

## Konfiguracja — ten sam `wertis.env` co API i worker

Plik szuka się w kolejności: `WERTIS_ENV_FILE` → katalog exe → katalog wyżej
(`C:\wertis`) → bieżący. Zmienna środowiskowa wygrywa z plikiem. Klucze:
`DB_PATH`, `SGT_MODE` (wymagane `mssql`), `WORKER_POLL_MS`, `MSSQL_SERVER`,
`MSSQL_INSTANCE`, `MSSQL_PORT`, `MSSQL_DATABASE`, `SFERA_WORKER`,
`SFERA_OPERATOR`, `SFERA_OPERATOR_HASLO`, `SFERA_SQL_LOGIN`, `SFERA_SQL_HASLO`,
`SFERA_PROGID`, `SFERA_PRODUKT`, `SFERA_AUTENTYKACJA`, `SFERA_TRYB_URUCHOMIENIA`.

**Login SQL jest osobny od operatora**: `SFERA_SQL_LOGIN` otwiera bazę,
`SFERA_OPERATOR` jest użytkownikiem Subiekta, a przy autentykacji mieszanej
Sfera chce obu. To nie jest `MSSQL_USER`: tamten login ma wąskie prawa do kilku
tabel, a Sfera wystawia dokumenty. **Adres serwera niesie instancję**: worker
skleja `MSSQL_SERVER\MSSQL_INSTANCE` (domyślnie `INSERTGT`), bo tego oczekuje
Sfera ([`docs/sfera-com.md`](../docs/sfera-com.md)).

Retry (5 s / 30 s / 2 min, trzy próby, bufor co 60 s) jest taki sam jak
w workerze Node; źródłem jest `config.worker` w
[`server/src/config.ts`](../server/src/config.ts).

## Flagi

| flaga | działanie |
|---|---|
| `--dry-run` | pełny cykl pick → done **bez Sfery**; numer `MM DRY-RUN/n`, `sfera_mode='dry-run'` w heartbeacie. Działa też na Linuksie |
| `--once` | jeden tick pętli i wyjście — do testów |

Obie razem bramkują kolejkę w CI. `sfera-worker/test-dymny.sh` zakłada bazę ze
schematu serwera, przepuszcza jedno MM i sprawdza status, numer, zdarzenie
audytu, heartbeat oraz guard kolejności. To samo uruchamiasz u siebie.

## Sonda — nazwy Sfery bez wystawiania dokumentu

[`sonda.ps1`](sonda.ps1) otwiera sesję Subiekta i wypisuje nazwy składowych
obiektów z sygnaturami metod. **Niczego nie zapisuje** — `Zapisz()` nie pada
ani razu. Ustawienia bierze z `wertis.env` albo z parametrów (`-PlikEnv`,
`-Baza`, `-Operator`, `-LoginSql`). Wynik idzie na ekran i do
`sonda-sfery.txt`, a ustalenia do `docs/sfera-com.md`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\sonda.ps1
powershell ... -File sonda.ps1 -SzkicMM -Towar 1234    # MM z pozycją, tylko w pamięci
powershell ... -File sonda.ps1 -SzkicZW -Paragon 123456 -Ilosci "1=0,2=1" -WzorZW 654321
```

`-SzkicMM` i `-SzkicZW` to jedyne miejsca, gdzie sonda woła `Dodaj*`; dokument
powstaje w pamięci i nie jest zapisywany. Magazyny szkicu MM idą
z `MAG_ID_MAG` → `MAG_ID_ZWROTY` albo z `-MagNadawczy` i `-MagOdbiorczy`.
Paragon podaje się jego `dok_Id`. `-WzorZW` tylko WCZYTUJE ręczny ZW. Danych
kontrahenta sonda nie wypisuje, bo plik wynikowy wraca do repozytorium.

## `[WERYFIKUJ]` — do ustalenia na maszynie ze Sferą

Wszystko, co dotyczy COM, siedzi w jednym pliku,
[`src/SferaComAdapter.cs`](src/SferaComAdapter.cs). Gdy nazwa jest zła, worker
podaje w komunikacie wywołanie i **numer punktu z tej listy**:

1. **Zamknięte:** ProgID `"InsERT.GT"` działa, `gtaProduktSubiekt` to **1**
   (`docs/sfera-com.md` §2c).
2. Nazwy logowania ustalone. Otwarta zostaje wartość `SFERA_AUTENTYKACJA`
   (mieszana kontra Windows). Przy mieszanej Sfera chce `Uzytkownik`/
   `UzytkownikHaslo` oraz `Operator`/`OperatorHaslo`. Odmowa `0x80041329` to
   najczęściej hasło loginu SQL zaczynające się od cyfry albo litery `a`–`f`;
   opis o Harmonogramie zadań jest mylący (`docs/sfera-com.md` §2b).
3. **Zamknięte:** `Uruchom(0x0, 0x6)` otwiera sesję BEZ OKNA, więc usługa działa
   bez pulpitu (`docs/sfera-com.md` §2g).
4. **Zamknięte:** `SuDokumentyManager.DodajMM()`, `MagazynNadawczyId`,
   `MagazynOdbiorczyId`, `Pozycje.Dodaj(tw_Id)` i `IloscJm` na pozycji.
5. Czy `Zapisz()` wystawia dokument **wykonany**, czy odkłada do bufora.
   Skutek magazynowy ma własne wywołanie `SkutekMagazynowyWywolaj(int)`.
6. **Zamknięte:** `SuDokument DodajKFS()` i `NaPodstawie(dok_Id)`. Pozycję
   znajduje się przez `Element(i)` od jedynki i `TowarId`. Otwarte zostaje
   znaczenie `IloscJm` na korekcie; kod ustawia ilość docelową.
7. Sygnatura `void Usun(bool)` zamknięta, znaczenie flagi nie. Adapter podaje
   `false` jako działanie węższe; na tym stoi wycofanie łańcucha.
8. `SuDokumentyManager.DodajRW()` zamknięte. `MagazynId` istnieje na sesji,
   dokumencie i pozycji; właściwą drogę rozstrzyga pierwszy RW.

`SFERA_PROGID`, `SFERA_PRODUKT` i `SFERA_AUTENTYKACJA` stoją w `wertis.env`,
więc ich korekta kosztuje restart, nie budowanie. Kolejność oszczędzająca
wyjazdy: najpierw sonda (punkty 1, 2, 4, 6, 8), potem jedno MM na kartotece
próbnej (punkty 5 i 7). Ustalenia zapisuje się w `docs/sfera-com.md` ze źródłem.

## Niezmienniki, których pilnuje ten proces

- **Adres przed sprzedawalnością**:
  [`sql/pick_mm_pending.sql`](sql/pick_mm_pending.sql) pomija zadanie, dopóki
  wcześniejsze `set_location` tego towaru nie wejdzie.
- **Dokument w buforze** → `waiting_for_doc`, ponawiane co 60 s.
- **Audyt**: `queue_retry` / `queue_applied` / `queue_failed` z autorem
  z wiersza kolejki, jak w workerze Node.
- **Padnięcie w trakcie zapisu** → `error` z ostrzeżeniem o duplikacie;
  ponowienie to decyzja człowieka (PONÓW).
- **Heartbeat** do `process_state` (`sfera`); 30 s ciszy widzi `/api/health`.
