# Worker Sfery — dokumenty w Subiekcie (C#/.NET)

Trzeci proces WERTIS, obok `wertis-api` i `wertis-worker`. Czyta tę samą
tabelę `sfera_queue` w SQLite i wykonuje **zadania dokumentowe** przez COM
Sfery Subiekta GT:

| typ zadania | co powstaje |
|---|---|
| `mm` | dokument przesunięcia magazynowego |
| `korekta_zwrot` | korekta sprzedaży, MM na magazyn zwrotów oraz (0.67.0) RW dla pozycji zniszczonych — atomowo |

`set_location` zostaje w workerze Node (bezpośredni UPDATE jednej kolumny,
Sfera do niego niepotrzebna).

**Atomowo** znaczy: gdy któreś ogniwo padnie, wszystko przed nim zostaje
usunięte — pad RW wycofuje MM i korektę, pad MM wycofuje korektę. Subiekt nie
ma transakcji obejmującej kilka dokumentów, więc wycofanie robi ten kod ręką.
Gdy nie uda się i wycofanie, zadanie kończy się błędem wymieniającym Z IMIENIA
dokumenty do ręcznego usunięcia w Subiekcie przed ponowieniem.

Dlaczego MM nie da się zrobić SQL-em i dlaczego to osobny proces — spec §9
oraz [`docs/architektura.md`](../docs/architektura.md). Kontrakt wywołań,
z którego wynika ten kod: [`server/src/adapters/sfera.ts`](../server/src/adapters/sfera.ts).

## Wymagania

| co | po co |
|---|---|
| Windows z zainstalowanym Subiektem GT | COM Sfery jest biblioteką lokalną |
| **licencja Sfery** do Subiekta GT | bez niej COM nie wystartuje; na podmiocie testowym wystarczy próbna Sfera (15 dni) |
| konto operatora Subiekta z prawem wystawiania MM i korekt | to użytkownik Subiekta, nie login SQL |
| dostęp do `C:\wertis\server\data\wertis.db` | wspólna kolejka z API i workerem Node |
| `SFERA_WORKER=1` w `wertis.env` | inaczej zadania dokumentowe bierze worker Node — proces odmawia startu, żeby nie było dwóch wykonawców |

## Budowa i wdrożenie

**Najkrócej: weź exe z CI.** Workflow `Worker Sfery` buduje przy każdej zmianie
w `sfera-worker/` samowystarczalny `wertis-sfera-worker.exe` dla Windows x64
i wiesza go jako artefakt przebiegu (Actions → wybrany przebieg → Artifacts →
`wertis-sfera-worker`). Late binding sprawia, że kompilacja nie potrzebuje ani
Subiekta, ani Windowsa, więc ta sama maszyna, która sprawdza testy, produkuje
gotowy plik. Wtedy **nie instalujesz .NET SDK nigdzie** — ani u siebie, ani
u klienta — i nie ma pytania „skąd ten exe".

Droga poniżej zostaje na wypadek pracy bez sieci albo poprawki, której nie ma
jeszcze w repozytorium.

**Bez .NET 8 SDK ten skrypt nie ruszy.** Instalacja na Windowsie:

```powershell
winget install Microsoft.DotNet.SDK.8
```

Potem otwórz **nowe** okno PowerShella (instalator zmienia `PATH`, bieżąca sesja
go nie widzi) i sprawdź `dotnet --version` — ma wyjść `8.x`.

Pobierając ręcznie, weź **SDK**, nie Runtime, i wariant **Windows x64 `.exe`**.
Plik `.pkg` jest instalatorem macOS i na Windowsie się nie otworzy.

SDK idzie na maszynę dewelopera, **nie na serwer firmy**. Po to jest
`--self-contained`: gotowy exe niesie runtime w sobie, więc pod `C:\wertis\`
nie trzeba instalować niczego.

```powershell
# maszyna z .NET 8 SDK (deweloper — NIE serwer firmy).
# Ścieżka jest względna wobec katalogu, w którym stoisz — stąd dwie drogi:
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\build.ps1  # z korzenia repo
powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1                # z katalogu sfera-worker
# → sfera-worker\publish\wertis-sfera-worker.exe (samowystarczalny, win-x64)

# serwer firmy:
#  1. skopiuj exe do C:\wertis\sfera-worker\
#  2. dopisz do C:\wertis\wertis.env:  SFERA_WORKER=1, SFERA_OPERATOR, SFERA_OPERATOR_HASLO
#  3. uruchom instalator (zarejestruje usługę wertis-sfera) albo ręcznie:
nssm install wertis-sfera C:\wertis\sfera-worker\wertis-sfera-worker.exe
#  4. zrestartuj WSZYSTKIE usługi (wszystkie czytają wertis.env)
```

Kolejność i bramki wdrożenia — [`DEPLOY.md`](../DEPLOY.md) §6, etap 2 oraz
[`docs/wdrozenie.md`](../docs/wdrozenie.md). Najkrócej: najpierw `--dry-run`
na PODMIOCIE TESTOWYM (na kopii bazy Sfera nie wstaje — traci licencję), potem
jedno MM na kartotece próbnej, dopiero potem produkcja.

## Konfiguracja — ten sam `wertis.env` co API i worker

Szuka pliku: `WERTIS_ENV_FILE` → katalog exe → katalog wyżej (`C:\wertis`) →
bieżący. Zmienna środowiskowa wygrywa z plikiem (semantyka jak w Node).
Czytane klucze: `DB_PATH`, `SGT_MODE` (wymagane `mssql`), `WORKER_POLL_MS`,
`MSSQL_SERVER`, `MSSQL_INSTANCE`, `MSSQL_PORT`, `MSSQL_DATABASE`,
`SFERA_WORKER`, `SFERA_OPERATOR`, `SFERA_OPERATOR_HASLO`, `SFERA_SQL_LOGIN`,
`SFERA_SQL_HASLO`, `SFERA_PROGID`, `SFERA_PRODUKT`, `SFERA_AUTENTYKACJA`.

Dwie rzeczy warto wiedzieć, zanim się je wypełni. **Login SQL jest osobny od
operatora**: `SFERA_SQL_LOGIN` otwiera bazę, `SFERA_OPERATOR` jest użytkownikiem
Subiekta, a przy autentykacji mieszanej Sfera chce obu. To nie jest `MSSQL_USER`
— tamten login ma prawa do sześciu tabel, a Sfera wystawia dokumenty.
**Adres serwera niesie instancję**: worker skleja `MSSQL_SERVER\MSSQL_INSTANCE`
(domyślnie `INSERTGT`), bo tego oczekuje Sfera. Powód i źródła:
[`docs/sfera-com.md`](../docs/sfera-com.md).

Stałe retry (backoff 5 s / 30 s / 2 min, trzy próby, ponowienie bufora co
60 s) są zaszyte identycznie jak w workerze Node — źródłem jest
`config.worker` w [`server/src/config.ts`](../server/src/config.ts).

## Flagi

| flaga | działanie |
|---|---|
| `--dry-run` | pełny cykl pick → done **bez Sfery**; numer `MM DRY-RUN/n` w `sgt_doc_number`, `sfera_mode='dry-run'` w heartbeacie. Działa też na Linuksie. |
| `--once` | jeden tick pętli i wyjście — do testów |

Obie razem bramkują całą kolejkę w CI — `test-dymny.sh` zakłada bazę ze schematu
serwera, przepuszcza przez workera jedno MM i sprawdza status, numer, zdarzenie
audytu, heartbeat oraz guard kolejności. Uruchamiasz to samo u siebie:

```bash
sfera-worker/test-dymny.sh
```

## Sonda — nazwy Sfery bez wystawiania dokumentu

[`sonda.ps1`](sonda.ps1) otwiera sesję Subiekta i wypisuje nazwy składowych:
obiektu GT, Subiekta, managerów dokumentów. **Niczego nie zapisuje** — żadnego
`Dodaj*`, żadnego `Zapisz()`. Odpowiada na większość listy niżej w jednym
przebiegu, bez pakietu SDK i bez śladu w bazie.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\sonda.ps1
```

Ustawienia bierze z `wertis.env`: szuka go od katalogu skryptu i od katalogu
roboczego, w górę aż do korzenia dysku, na końcu w `C:\wertis`. Gdy nie znajdzie,
wypisuje wszystkie sprawdzone ścieżki. Można też wskazać plik wprost albo podać
wartości z ręki:

```powershell
powershell ... -File sonda.ps1 -PlikEnv C:\wertis\wertis.env
powershell ... -File sonda.ps1 -Baza PODMIOT -Operator Szef -OperatorHaslo *** -LoginSql sa -HasloSql ***
```

Wynik ląduje na ekranie i w `sonda-sfery.txt`. To on wraca do repozytorium jako
wypełniona lista — ustalenia dopisuje się do
[`docs/sfera-com.md`](../docs/sfera-com.md).

## `[WERYFIKUJ]` — do ustalenia na maszynie ze Sferą

Wszystko, co dotyczy COM, siedzi w **jednym pliku**
[`src/SferaComAdapter.cs`](src/SferaComAdapter.cs) i jest oznaczone
`[WERYFIKUJ]` (konwencja repo — wartość do potwierdzenia na własnym systemie):

1. **Zamknięte (0.197.4):** ProgID `"InsERT.GT"` działa, a `gtaProduktSubiekt`
   to **1** — sonda odczytała `ProduktNazwa` dla kolejnych numerów.
   Tabela w `docs/sfera-com.md` §2c.
2. **Nazwy ustalone (0.197.2)**, sonda wypisała komplet właściwości logowania.
   Do potwierdzenia zostaje sama wartość `SFERA_AUTENTYKACJA` — mieszana kontra
   Windows. Przy mieszanej Sfera chce ZARÓWNO `Uzytkownik`/`UzytkownikHaslo`,
   jak i `Operator`/`OperatorHaslo`.

   > Odmowa z kodem `0x80041329` to najczęściej **hasło loginu SQL zaczynające
   > się od cyfry albo litery `a`–`f`**. Windows dokleja do tego kodu opis
   > Harmonogramu zadań — tekst o „aparacie planowania" jest mylący i nie
   > dotyczy Sfery. Szczegóły: `docs/sfera-com.md` §2b.
3. **Ustalone (0.197.0):** `Uruchom(gtaUruchomDopasuj, gtaUruchom | gtaUruchomWTle)`
   — czyli `Uruchom(0x0, 0x4)`. Wartości i źródła: `docs/sfera-com.md` §2.
4. Manager i metoda dodania MM (`DokumentyMagazynoweManager.DodajMM()`),
   nazwy właściwości magazynów i pozycji.
5. Czy `Zapisz()` wystawia dokument **wykonany**, czy odkłada do bufora —
   decyzja domyślna: wykonany (sens operacji to „towar sprzedawalny").
6. Wystawienie korekty do istniejącego dokumentu
   (`DokumentyHandloweManager.DodajKorekte(dokId)`), sposób adresowania
   pozycji (`Pozycje.SzukajTowar`) i pole ilości po korekcie.
7. Usunięcie dokumentu (`Usun()`) — na nim stoi wycofanie łańcucha, gdy
   dalsze ogniwo padnie.
8. RW dla pozycji zniszczonych (`DokumentyMagazynoweManager.DodajRW()`,
   właściwość magazynu) — pierwsze RW na podmiocie testowym, na zwrocie próbnym.

Po ustaleniach poprawia się wyłącznie ten plik i buduje exe od nowa. Trzy
wartości, które najczęściej wymagają korekty na miejscu, poprawia się jednak
**bez budowania** — `SFERA_PROGID`, `SFERA_PRODUKT` i `SFERA_AUTENTYKACJA` stoją
w `wertis.env`, więc kosztują restart usługi.

Kolejność, która oszczędza wyjazdy: najpierw [sonda](#sonda--nazwy-sfery-bez-wystawiania-dokumentu)
(punkty 1, 2, 4, 6, 8), potem jedno MM na kartotece próbnej (punkty 5 i 7 oraz
nazwy właściwości dokumentu). Ustalenia zapisuje się w
[`docs/sfera-com.md`](../docs/sfera-com.md), razem ze źródłem.

Gdy nazwa jest zła, worker mówi to wprost: komunikat nazywa wywołanie i **numer
punktu z tej listy**, zamiast zostawiać gołe „`__ComObject` does not contain
a definition for `DodajMM`" w środku wystawiania dokumentu.

## Niezmienniki, których pilnuje ten proces

- **Adres przed sprzedawalnością** — zapytania wyboru zadania
  ([`sql/pick_mm_pending.sql`](sql/pick_mm_pending.sql)) pomijają MM, dopóki
  wcześniejsze niewykonane `set_location` tego samego towaru nie wejdzie.
  Te same pliki SQL wykonuje test po stronie Node
  (`server/src/worker/sfera-pick.test.ts`) — zmiana guardu jest mierzona w CI.
- **Dokument w buforze** → `waiting_for_doc`, ponawiane co 60 s.
- **Audyt**: `queue_retry` / `queue_applied` / `queue_failed` z autorem
  z wiersza kolejki — te same typy i klucze co worker Node.
- **Padnięcie w trakcie zapisu** → zadanie w `error` z ostrzeżeniem
  o możliwym duplikacie; wznowienie to decyzja człowieka (PONÓW), nie automatu.
- **Heartbeat** co tick do `process_state` (`name='sfera'`) — brak meldunku
  przez 30 s widzi `/api/health` (przy `SFERA_WORKER=1`).
