# Instalator WERTIS dla Windows

Stawia serwer WERTIS na maszynie z Subiektem GT. Instaluje zależności, pobiera
i buduje aplikację, rejestruje dwie usługi Windows i otwiera port dla
kolektorów. Wypełnia konfigurację odpytując bazę Subiekta. Zakłada konto SQL
o minimalnych uprawnieniach.

Robi to, co [`DEPLOY.md`](../DEPLOY.md) każe zrobić ręcznie. **Tamta instrukcja
zostaje i jest referencją tego katalogu.** Gdy instalator zawiedzie w połowie,
ręczna droga nadal działa. Każdy krok da się dokończyć z palca.

## Uruchomienie

Pobierz `WERTIS-Instalator.exe` z [wydań](https://github.com/MateuszPuchalski/mag-asystent/releases)
i uruchom **jako administrator**.

Z repo albo z gołego `.ps1` — **`URUCHOM.cmd`**, prawym przyciskiem →
*Uruchom jako administrator*. Windows domyślnie odmawia uruchamiania plików
`.ps1` (`running scripts is disabled on this system`), a ten plik omija to
dla jednego uruchomienia, nie ruszając polityki systemowej:

```powershell
# to samo z wiersza poleceń:
powershell -ExecutionPolicy Bypass -File instalator\wertis-instalator.ps1
```

| przełącznik | do czego |
|---|---|
| *(brak)* | pełna instalacja z kreatorem i kontem SQL |
| `-Demo` | instalacja pilotażowa: dane demonstracyjne, **Subiekt nietknięty** (Etap 0 z `DEPLOY.md` §6) |
| `-TylkoKonfiguracja` | sam kreator na działającej instalacji — do zmiany ustawień albo dokończenia po nieudanym podłączeniu |
| `-DryRun` | wypisuje, co by zrobił, i **nie zmienia niczego**; nie zadaje pytań |
| `-Odinstaluj` | zdejmuje usługi, regułę zapory i katalog; **Subiekta nie rusza** — patrz [`docs/wdrozenie.md`](../docs/wdrozenie.md) |
| `-UsunDane` | tylko z `-Odinstaluj`: kasuje też ślad audytowy, po drugim potwierdzeniu |
| `-Katalog`, `-Port`, `-Galaz` | odstępstwa od domyślnych `C:\wertis`, `3001`, `main` |

> **Windows PowerShell, nie `pwsh`.** Instalator używa `System.Data.SqlClient`
> z .NET Framework — w PowerShellu 7 tego typu nie ma w komplecie. Plik `.exe`
> ma właściwy silnik w środku; przy uruchamianiu `.ps1` użyj `powershell.exe`.

## Co instalator robi

1. **Zależności** — Node.js LTS i Git przez `winget` (bez wingeta: instalator
   MSI z nodejs.org). Sprawdza też **wersję Node**: aplikacja wymaga co
   najmniej 22.5. Git jest w komplecie celowo. Bieżąca obsługa
   z `DEPLOY.md` §7 stoi na `git pull` i Git Bashu.

   > **Dlaczego wersja, a nie sama obecność.** Serwer używa wbudowanego
   > sterownika SQLite, którego starsze wersje nie mają. Starszy Node przechodzi
   > zwykłe „czy jest node?". Wywala się dopiero przy starcie usługi.
2. **Aplikacja** — `git clone` do `C:\wertis`, `npm ci`, `npm run build`.
   Ponowne uruchomienie instalatora jest zarazem **aktualizacją** (`git pull`).
3. **Usługi** — `wertis-api` i `wertis-worker` przez NSSM, z logami, rotacją,
   autostartem i restartem po awarii.
4. **Sieć** — reguła zapory na porcie API, wpuszczająca **tylko sieć lokalną**.
5. **Kreator** — odpytuje bazę i podsuwa listy do wyboru zamiast kazać
   przepisywać identyfikatory z SSMS: magazyny, pole lokalizacji, flagi faktur.
6. **Konto SQL** — zakłada login `wertis` z losowym hasłem i uprawnieniami
   **kolumnowymi**, po czym sprawdza, co faktycznie zostało nadane.

### Konfiguracja: jeden plik i sprzątanie po starych instalacjach

API i worker to **osobne procesy**, ale czytają dziś ten sam `wertis.env`
wprost z dysku ([`server/src/env-file.ts`](../server/src/env-file.ts)) — NSSM
nie przenosi już żadnej konfiguracji. Instalator zapisuje więc **jeden plik**.

Robi przy tym drugą rzecz, mniej oczywistą: **kasuje środowisko obu usług**.
Zmienne środowiskowe mają pierwszeństwo nad plikiem, więc pozostałość po
starszej instalacji — choćby hasło sprzed zmiany — po cichu wygrałaby z tym,
co instalator właśnie zapisał. Bez żadnego objawu poza „u mnie nie działa".

> **Dwa ustawienia, nie jedno.** `AppEnvironmentExtra` **dokłada** zmienne do
> środowiska procesu, a `AppEnvironment` **zastępuje je w całości**. Z nazw tej
> różnicy nie widać, a kosztowała jedno wdrożenie.
>
> Kreator przeszedł wtedy do końca i zapisał `SGT_MODE=mssql`. Aplikacja i tak
> wstała na danych demo, bo kasowane było tylko pierwsze z tych dwóch. Od
> 0.12.0 lecą oba.

Na koniec instalator odpytuje `/api/health` i pokazuje **stan obu procesów**:
tryb API, tryb workera i listę `problemy`. Zapis do Subiekta idzie przez
workera, więc samo zielone API mówiłoby o połowie instalacji.

### Konto SQL: wartością są uprawnienia, nie samo konto

Skrypt pochodzi z [`docs/subiekt-gt-edu-setup.md`](../docs/subiekt-gt-edu-setup.md) §2
i nadaje:

- `SELECT` na **ośmiu** tabelach,
- `UPDATE` na **jednej kolumnie** kartoteki (tej wybranej na lokalizację),
- `INSERT, UPDATE` na tabeli przypisań flag,
- **ani jednego prawa zapisu do `dok__Dokument`**.

Przy przejęciu tego credentiala da się zmienić adres na półce i flagę faktury.
Nic więcej — dokumenty, stany i numeracja pozostają nietykalne. Właśnie to
ograniczenie ginie pierwsze, gdy konto zakłada się ręcznie w pośpiechu.

Instalator **weryfikuje nadane uprawnienia po fakcie**, bo błąd `CREATE LOGIN`
nie przerywa reszty skryptu: bez sprawdzenia „udana" instalacja mogłaby zostawić
konto bez ani jednego uprawnienia.

**Gdy nie ma praw administratora bazy**, instalator nie przerywa wdrożenia:
zapisuje gotowy, podstawiony skrypt do `C:\wertis\nadaj-uprawnienia-wertis.sql`
i mówi, komu go przekazać. Hasło jest już w środku i w `wertis.env`, więc nic
nie trzeba podmieniać — po wykonaniu skryptu wystarczy restart obu usług.

## Czego instalator NIE robi

- **Nie zakłada kont pracowników.** Badge'e powstają z kolektora
  (`DEPLOY.md` §5a) — pierwsze konto to konto biura z PIN-em, a komplet kodów
  widać dokładnie raz, na ekranie kolektora. Wypisywanie listy tożsamości na
  monitorze w biurze byłoby krokiem w złą stronę.
- **Nie stawia workera Sfery** (dokumenty MM, Etap 2 z `DEPLOY.md` §6) — to
  osobny proces COM.
- **Nie konfiguruje kopii zapasowej ani nocnej rekoncyliacji.** Obie są
  w `DEPLOY.md` §7 i obie trzeba ustawić, **zanim** ruszy praca na prawdziwych
  danych.
- **Nie usuwa loginu SQL przy deinstalacji.** `-Odinstaluj` zdejmuje usługi,
  zaporę i katalog, ale login `wertis` zostaje: powstał na poziomie **instancji**,
  więc pomyłka dotknęłaby wszystkich baz na serwerze. Skrypt podaje gotowe
  `DROP USER` i `DROP LOGIN` do wykonania przez administratora bazy.
- **Nie cofa tego, co aplikacja zapisała do Subiekta.** Deinstalacja usuwa
  program, nie jego pracę. Pole lokalizacji i flagi faktur odwraca wyłącznie
  kopia bazy — patrz [`docs/wdrozenie.md`](../docs/wdrozenie.md).

## Trzy rzeczy, o których instalator pyta osobno

**Baza podmiotu, a nie jej kopia.**

> ⚠️ Kopia podmiotu ma **te same tabele** co baza produkcyjna. Kontrola „czy to
> jest baza Subiekta" jej nie odsieje — odpowiada na inne pytanie niż „czy to
> jest TA baza".

Pomyłka jest cicha i dlatego kosztowna. Konto powstałoby na kopii, aplikacja
czytałaby nieaktualne stany i zapisywała lokalizacje w martwą bazę. Wszystko
wyglądałoby poprawnie, a objawem byłby dopiero magazynier, któremu stany nie
zgadzają się z półką.

Kreator pokazuje przy każdej bazie **datę ostatniego dokumentu**, liczbę
dokumentów i datę utworzenia, a listę sortuje od najświeższej:

```
 *  1. WERTIS            ost. dokument: 2026-07-29   dok:    48 210   utw.: 2019-03-11
    2. WERTIS_KOPIA      ost. dokument: 2026-06-30   dok:    47 001   utw.: 2026-07-01
    3. FK_ARCHIWUM       (nie jest bazą Subiekta)
```

Gwiazdka to podpowiedź Enterem. Pojawia się **tylko przy ściśle najświeższej**
bazie — dwie kopie z tego samego dnia podpowiedzi nie dostaną, bo byłaby rzutem
monetą udającym radę.

Po wyborze bazy z dokumentem starszym niż tydzień kreator ostrzega i pyta
o potwierdzenie. To heurystyka, nie dowód: firma z przerwą w wystawianiu
dokumentów wygląda tak samo jak kopia, więc instalator nigdy nie odrzuca bazy
sam.

**Restart usługi SQL.**

> ⚠️ Restart instancji **wyrzuca wszystkich z Subiekta** na kilkanaście sekund.
> To jedyny krok instalatora o skutku poza samą aplikacją.

Restartu wymaga włączenie TCP/IP i uwierzytelniania mieszanego. Gdy oba
ustawienia są już włączone — a zwykle są — restartu nie ma wcale.

**Pole lokalizacji.**

> ⚠️ Aplikacja **nadpisuje wybrane pole bezwarunkowo**. Wskazanie pola, którego
> firma używa do czegoś innego, kasuje te dane bezpowrotnie.

Subiekt w tych wersjach nie ma kolumny „lokalizacja". Używa się jednego
z ośmiu pól własnych kartoteki. Kreator pokazuje, ile kartotek ma każde pole
zajęte i czym. Przy niepustym polu żąda potwierdzenia.

## Rozwój

```powershell
.\testy.ps1                 # asercje — najtańsza i najkonkretniejsza bramka
.\build.ps1                 # scalenie do dist\WERTIS-Instalator.ps1
.\build.ps1 -Exe            # dodatkowo .exe (wymaga modulu ps2exe)
.\wertis-instalator.ps1 -DryRun -Katalog C:\proba
```

| plik | rola |
|---|---|
| `wertis-instalator.ps1` | przebieg główny — kolejność kroków i wszystkie pytania |
| `ui.ps1` | komunikaty, pytania, generator hasła |
| `sql.ps1` | połączenie z SQL Serverem, checklista, konto aplikacji |
| `uslugi.ps1` | zależności, NSSM, zapora, publikacja konfiguracji |
| `testy.ps1` | asercje na logice wywoływalnej bez dotykania systemu |
| `build.ps1` | scalenie czterech plików w jeden + `.exe` + `URUCHOM.cmd` |
| `URUCHOM.cmd` | uruchomienie z pominięciem polityki wykonywania |

`build.ps1` podmienia blok między znacznikami `MODULY-POCZATEK` i
`MODULY-KONIEC` w skrypcie głównym. Scalanie jest konieczne, bo `ps2exe` pakuje
dokładnie jeden plik, a `.exe` u klienta nie ma obok siebie tego katalogu.

**Pliki `.ps1` muszą być zapisane w UTF-8 z BOM.** Windows PowerShell 5.1 czyta
skrypt bez BOM jako ANSI i polskie znaki w komunikatach rozsypują się na
ekranie osoby przeprowadzającej instalację. Pilnuje tego osobny krok w
[`.github/workflows/instalator.yml`](../.github/workflows/instalator.yml).

### Co bramkuje CI, a czego nie

CI sprawdza kodowanie, składnię, **asercje z `testy.ps1`**, scalanie i przebieg
`-DryRun` (wariant zwykły i `-Demo`) na `windows-latest`, przez Windows
PowerShell.

**`-DryRun` dowodzi PRZEBIEGU STEROWANIA, nie poprawności kroków** — i to
zdanie jest tu po przejściach. Każdy krok wykonawczy siedzi za `Test-DryRun`
i w przebiegu próbnym jest pomijany, więc zielone CI nie znaczy, że kroki
działają. Tak przeszła awaria z 27 lipca: `New-Item` na korzeniu dysku
(`Split-Path "C:\wertis"` → `C:\`) wywracał instalację przy **domyślnych**
ustawieniach, a CI świeciło zielono. Od tego czasu asercje w `testy.ps1`
obejmują całą logikę wywoływalną bez dotykania systemu. To one, a nie
`-DryRun`, są bramką na tę klasę błędów.

Nadal **nie sprawdzamy** niczego, co wymaga Subiekta: połączenia z bazą,
zakładania konta, rejestracji usług i reguły zapory. Te cztery rzeczy
weryfikuje się ręcznie — najtaniej na Subiekcie w wersji edu, wg
[`docs/subiekt-gt-edu-setup.md`](../docs/subiekt-gt-edu-setup.md).

## Antywirus zablokował instalator (IDP.Generic i podobne)

**To jest spodziewane i nie znaczy, że plik jest zarażony.** `IDP.Generic`
(AVG/Avast), `Trojan:Script/Wacatac` (Defender) i pokrewne to detekcje
**heurystyczne** — reagują na zachowanie, nie na sygnaturę znanego szkodnika.

Instalator robi po kolei sześć rzeczy, z których każda osobno jest niewinna,
a razem układają się w podręcznikowy profil droppera:

| zachowanie | gdzie |
|---|---|
| pobiera archiwum z sieci, rozpakowuje i uruchamia z niego plik | `uslugi.ps1` — NSSM |
| sam **NSSM jest narzędziem dwojakiego użytku** — malware zakłada nim usługi | `uslugi.ps1` |
| cicha instalacja MSI (`/qn`, bez pytania) | `uslugi.ps1` — Node |
| rozpakowanie `SecureString` do jawnego hasła | `wertis-instalator.ps1` — hasło `sa` |
| nadpisanie protokołu TLS | `Initialize-WertisSiec` |
| podniesienie uprawnień i zakładanie usług | `Test-Administrator`, `Register-WertisUsluga` |

Sześć na sześć. Antywirus zachował się poprawnie — kłopot w tym, że legalny
instalator usługi Windows i dropper wykonują te same czynności.

### Sprawdź to sam, nie na słowo

`.ps1` to **czysty tekst** i to jest jego przewaga nad `.exe`: da się go
przeczytać przed uruchomieniem.

```powershell
notepad .\WERTIS-Instalator.ps1
Get-FileHash .\WERTIS-Instalator.ps1 -Algorithm SHA256
```

Instalator sięga do **trzech** adresów i żadnego innego:

- `github.com/MateuszPuchalski/mag-asystent.git` — kod aplikacji,
- `nodejs.org` — instalator Node (suma kontrolna sprawdzana, patrz niżej),
- `nssm.cc` — opakowanie usług Windows.

**Kiedy zacząć się naprawdę martwić.** Jeśli w pliku zobaczysz długi ciąg
base64, `Invoke-Expression`, `IEX (New-Object Net.WebClient).DownloadString(...)`,
`-EncodedCommand` albo adres spoza tej trójki — to **nie jest** fałszywy alarm.
Nie uruchamiaj i zgłoś. W wydanym pliku żadnej z tych rzeczy nie ma.

Dodatkowo wrzuć plik na [VirusTotal](https://www.virustotal.com). Jeden silnik
na siedemdziesiąt to fałszywka; dwadzieścia silników to nie fałszywka.

### Co zrobić

1. **Zgłoś fałszywy alarm producentowi.** AVG i Avast:
   `https://www.avg.com/false-positive-file-form` (Avast ma bliźniaczy).
   Microsoft: `https://www.microsoft.com/wdsi/filesubmission`. Zwykle poprawiają
   w kilka dni i problem znika u wszystkich klientów naraz.
2. **Użyj `.ps1` zamiast `.exe`.** Binarka z `ps2exe` jest flagowana **znacznie
   częściej** — pakowanie skryptu w plik wykonywalny samo w sobie jest sygnałem
   dla heurystyki. Każde wydanie niesie oba pliki.
3. **Wykluczenie tylko w ostateczności** i **wyłącznie na konkretny plik**, na
   czas instalacji. Nie wyłączaj ochrony i nie wykluczaj całego katalogu — to
   zamienia jeden fałszywy alarm w trwałą dziurę.

### Sumy kontrolne pobieranych plików

Instalator ściąga dwa pliki i **uruchamia je z uprawnieniami administratora**.
Do sierpnia 2026 robił to bez żadnej weryfikacji — czyli przejęcie DNS w sieci
klienta wystarczyło, żeby maszyna wykonała cudzy kod jako SYSTEM. **To była
realna dziura**, w odróżnieniu od detekcji heurystycznej opisanej wyżej.

Dziś obie pozycje mają sprawdzaną sumę SHA-256 **przed uruchomieniem**:

- **Node** — suma z oficjalnego `SHASUMS256.txt` na nodejs.org; niezgodność
  przerywa instalację.
- **NSSM** — sumę policzył runner Windows w CI. Pobrał plik wprost
  z `nssm.cc`. Nie jest wpisana „z pamięci", bo weryfikacja pozorna jest gorsza
  od jawnego jej braku.

  **Czego ta suma dowodzi, a czego nie.** Nie jest dowodem, że `nssm.cc` było
  wtedy nienaruszone — to zaufanie przy pierwszym użyciu. Jest natomiast
  gwarancją, że **od tamtej chwili plik się nie zmienił**. Podmiana zatrzyma
  instalację u klienta, a w CI **zatrzyma budowę**. Niedostępne `nssm.cc` jest
  odróżniane od niezgodnej sumy i samo w sobie CI nie psuje.

## Znane ograniczenia

- **`.exe` jest niepodpisany.** SmartScreen pokaże ostrzeżenie („Więcej
  informacji" → „Uruchom mimo to"). Podpisanie wymaga certyfikatu
  code-signing (OV około 400–600 zł rocznie), czyli decyzji i kosztu po stronie
  firmy. Szczegóły detekcji antywirusowych — w sekcji wyżej.
- **Sonda grupy flag jest heurystyczna.** Kreator dobiera parę „grupa flag / typ
  obiektu" po tym, która najczęściej trafia w faktury zakupu, i **prosi
  o potwierdzenie**. Gdy żadna faktura nie jest jeszcze oflagowana, zostawia
  puste — wtedy oflaguj ręcznie jedną fakturę w Subiekcie i wróć przez
  `-TylkoKonfiguracja`.
- **Instalator zakłada, że SQL Server jest na tej samej maszynie**, bo tak
  wygląda instalacja Subiekta. Zdalna instancja zadziała, ale wykrywanie TCP/IP
  i uwierzytelniania mieszanego czyta rejestr **lokalny** — tam trzeba ustawić
  je samodzielnie.
