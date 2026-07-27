# Instalator WERTIS dla Windows

Stawia serwer WERTIS na maszynie z Subiektem GT: instaluje zależności, pobiera
i buduje aplikację, rejestruje dwie usługi Windows, otwiera port dla kolektorów,
wypełnia konfigurację odpytując bazę Subiekta i zakłada konto SQL o minimalnych
uprawnieniach.

Robi to, co [`DEPLOY.md`](../DEPLOY.md) każe zrobić ręcznie. **Tamta instrukcja
zostaje i jest referencją tego katalogu** — gdy instalator zawiedzie w połowie,
ręczna droga nadal działa, a każdy krok da się dokończyć z palca.

## Uruchomienie

Pobierz `WERTIS-Instalator.exe` z [wydań](https://github.com/MateuszPuchalski/mag-asystent/releases)
i uruchom **jako administrator**.

```powershell
# albo z repo, tym samym skutkiem:
powershell -ExecutionPolicy Bypass -File instalator\wertis-instalator.ps1
```

| przełącznik | do czego |
|---|---|
| *(brak)* | pełna instalacja z kreatorem i kontem SQL |
| `-Demo` | instalacja pilotażowa: dane demonstracyjne, **Subiekt nietknięty** (Etap 0 z `DEPLOY.md` §6) |
| `-TylkoKonfiguracja` | sam kreator na działającej instalacji — do zmiany ustawień albo dokończenia po nieudanym podłączeniu |
| `-DryRun` | wypisuje, co by zrobił, i **nie zmienia niczego**; nie zadaje pytań |
| `-Katalog`, `-Port`, `-Galaz` | odstępstwa od domyślnych `C:\wertis`, `3001`, `main` |

> **Windows PowerShell, nie `pwsh`.** Instalator używa `System.Data.SqlClient`
> z .NET Framework — w PowerShellu 7 tego typu nie ma w komplecie. Plik `.exe`
> ma właściwy silnik w środku; przy uruchamianiu `.ps1` użyj `powershell.exe`.

## Co instalator robi

1. **Zależności** — Node.js LTS i Git przez `winget` (bez wingeta: instalator
   MSI z nodejs.org). Sprawdza też **wersję Node**: aplikacja wymaga co
   najmniej 22.5, bo używa wbudowanego sterownika SQLite, a starszy Node
   przechodzi zwykłe „czy jest node?" i wywala się dopiero przy starcie usługi.
   Git jest w komplecie celowo: bieżąca obsługa z `DEPLOY.md` §7 stoi na
   `git pull` i Git Bashu.
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

Robi przy tym drugą rzecz, mniej oczywistą: **kasuje `AppEnvironmentExtra` obu
usług**. Zmienne środowiskowe mają pierwszeństwo nad plikiem, więc pozostałość
po starszej instalacji — choćby hasło sprzed zmiany — po cichu wygrałaby z tym,
co instalator właśnie zapisał. Bez żadnego objawu poza „u mnie nie działa".

Na koniec instalator odpytuje `/api/health` i pokazuje **stan obu procesów**:
tryb API, tryb workera i listę `problemy`. Zapis do Subiekta idzie przez
workera, więc samo zielone API mówiłoby o połowie instalacji.

### Konto SQL: wartością są uprawnienia, nie samo konto

Skrypt pochodzi z [`docs/subiekt-gt-edu-setup.md`](../docs/subiekt-gt-edu-setup.md) §2
i nadaje:

- `SELECT` na **siedmiu** tabelach,
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

## Dwie rzeczy, o których instalator pyta osobno

**Restart usługi SQL.** Włączenie TCP/IP i uwierzytelniania mieszanego wymaga
restartu instancji, czyli **wyrzucenia wszystkich z Subiekta** na kilkanaście
sekund. Jedyny krok o skutku poza samą aplikacją. Gdy oba ustawienia są już
włączone — a zwykle są — restartu nie ma wcale.

**Pole lokalizacji.** Subiekt w tych wersjach nie ma kolumny „lokalizacja";
używa się jednego z ośmiu pól własnych kartoteki, a aplikacja **nadpisuje je
bezwarunkowo**. Kreator pokazuje, ile kartotek ma każde pole zajęte i czym,
i przy niepustym żąda potwierdzenia. Wskazanie pola używanego przez firmę do
czegoś innego kasuje te dane bezpowrotnie.

## Rozwój

```powershell
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
| `build.ps1` | scalenie czterech plików w jeden + `.exe` |

`build.ps1` podmienia blok między znacznikami `MODULY-POCZATEK` i
`MODULY-KONIEC` w skrypcie głównym. Scalanie jest konieczne, bo `ps2exe` pakuje
dokładnie jeden plik, a `.exe` u klienta nie ma obok siebie tego katalogu.

**Pliki `.ps1` muszą być zapisane w UTF-8 z BOM.** Windows PowerShell 5.1 czyta
skrypt bez BOM jako ANSI i polskie znaki w komunikatach rozsypują się na
ekranie osoby przeprowadzającej instalację. Pilnuje tego osobny krok w
[`.github/workflows/instalator.yml`](../.github/workflows/instalator.yml).

### Co bramkuje CI, a czego nie

CI sprawdza kodowanie, składnię, scalanie i **pełny przebieg `-DryRun`** (wariant
zwykły i `-Demo`) na `windows-latest`, przez Windows PowerShell. Nie sprawdza
niczego, co wymaga Subiekta: prawdziwego połączenia z bazą, zakładania konta,
rejestracji usług i reguły zapory. Te cztery rzeczy weryfikuje się ręcznie —
najtaniej na Subiekcie w wersji edu, wg
[`docs/subiekt-gt-edu-setup.md`](../docs/subiekt-gt-edu-setup.md).

## Znane ograniczenia

- **`.exe` jest niepodpisany.** SmartScreen pokaże ostrzeżenie („Więcej
  informacji" → „Uruchom mimo to"), a część antywirusów oflaguje heurystycznie
  każdą binarkę z `ps2exe`. Dlatego każde wydanie niesie **także `.ps1`** — ten
  sam kod, bez opakowania. Podpisanie wymaga certyfikatu code-signing, czyli
  decyzji i kosztu po stronie firmy.
- **Sonda grupy flag jest heurystyczna.** Kreator dobiera parę „grupa flag / typ
  obiektu" po tym, która najczęściej trafia w faktury zakupu, i **prosi
  o potwierdzenie**. Gdy żadna faktura nie jest jeszcze oflagowana, zostawia
  puste — wtedy oflaguj ręcznie jedną fakturę w Subiekcie i wróć przez
  `-TylkoKonfiguracja`.
- **Instalator zakłada, że SQL Server jest na tej samej maszynie**, bo tak
  wygląda instalacja Subiekta. Zdalna instancja zadziała, ale wykrywanie TCP/IP
  i uwierzytelniania mieszanego czyta rejestr **lokalny** — tam trzeba ustawić
  je samodzielnie.
