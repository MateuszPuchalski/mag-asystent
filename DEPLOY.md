# Wdrożenie WERTIS — on-premise (serwer w magazynie)

Instrukcja wdrożenia na firmowej maszynie Windows z **Subiektem GT i Sferą**.
Usługi działają na jednym hoście w LAN magazynu, a kolektory łączą się przez
WiFi. Biuro ma **panel pod `http://serwer:3001/obsluga`**; adresy `/` i `/biuro`
przekierowują do niego. Operacje na towarze wykonuje się wyłącznie na
kolektorze. Zero chmury.

```
Kolektory Zebra/Honeywell (APK, WiFi LAN) ─── http://mag.wertis.local:3001
        ▼
Maszyna z Subiektem GT (Windows)
  ├─ wertis-api     Fastify: REST + panel biura pod /obsluga
  ├─ wertis-worker  kolejka → zapis lokalizacji i kodów do SGT
  ├─ wertis-sfera   (opcjonalna) worker Sfery: dokumenty MM i ZW
  ├─ wertis-tlo     (opcjonalna) usuwanie tła ze zdjęć kartotek
  ├─ wertis.db      SQLite: postęp dostaw, wyjątki, kolejka, audyt events
  ├─ data/photos/   zdjęcia dowodowe do reklamacji (poza gitem, w backupie)
  ├─ MSSQL Subiekta (odczyt: login o minimalnych uprawnieniach)
  └─ Sfera (COM)    (zapis dokumentów: wyłącznie przez workera Sfery)
```

> **Dlaczego tak jest zbudowane** — [`docs/architektura.md`](docs/architektura.md).
> **Kolejność etapów i bramki odbioru** — [`docs/wdrozenie.md`](docs/wdrozenie.md).
> Ten dokument mówi, jak to uruchomić i utrzymać.

## Na jednej stronie

**Nowy serwer albo odtworzenie po awarii** — na maszynie z Subiektem:

1. Pobierz `WERTIS-Instalator.exe` z [wydań](https://github.com/MateuszPuchalski/mag-asystent/releases)
   i uruchom go jako administrator. Nie instaluje żadnych programów.
2. Odpowiedz na pytania: zgoda na podłączenie do Subiekta, trzy magazyny
   (Enter przyjmuje podpowiedź) i pole lokalizacji. O bazę pyta tylko przy kilku.
3. Otwórz `http://<serwer>:3001/obsluga/` i załóż konto administratora.
4. Kolektory: w panelu **Ustawienia → Nowy kolektor**. Zeskanuj kod aparatem
   kolektora i zainstaluj aplikację.
5. Raz, przed pracą na prawdziwych danych: **odtwórz jedną kopię bazy** (§7).

Po awarii ten sam plik podpina dane z `C:\wertis-dane`, więc baza, zdjęcia
i kopie wracają. Nowa baza powstaje tylko wtedy, gdy tego katalogu nie ma.

**Na co dzień nie ma nic do zrobienia.** Aktualizacje wchodzą same (§0b),
a wydanie z „[wymaga działania]" czeka na przycisk. Ustawienia zmienia się
w panelu: Ustawienia → Konfiguracja. Kopia bazy powstaje co noc i przed każdą
migracją (§7). Nieudana wersja wraca sama do poprzedniej, a panel
i `/api/health` mówią o tym przez dobę.

**Raz, w ustawieniach repozytorium** (właściciel): klucz wydań i token
odświeżania (§0a, §0c). Bez nich scalony kod nie staje się wydaniem.

## 0. Instalator — właściwa droga

[**Instalator dla Windows**](instalator/README.md) wykonuje rozdziały 1–4
i checklistę z §6. Pobiera paczkę wydania z Nodem w środku, więc nie instaluje
Gita i niczego nie buduje. Rejestruje usługi, otwiera port, wypełnia
`wertis.env` **odpytując bazę Subiekta** i zakłada konto SQL o minimalnych
uprawnieniach. Trzy rzeczy robi lepiej niż ręczna droga:

- **pokazuje zajętość wszystkich ośmiu pól własnych**, zanim wybierzesz to na
  lokalizację (§6) — aplikacja nadpisuje wybrane pole bezwarunkowo;
- **kasuje `AppEnvironment` i `AppEnvironmentExtra` usług**, bo zmienne
  środowiskowe przykrywają `wertis.env` (§2a);
- **sprawdza wersję Node** (≥ 22.5, §1) przy instalacji z Gita.

```powershell
WERTIS-Instalator.exe -Demo         # pilot bez dotykania Subiekta (Etap 0 z §6)
WERTIS-Instalator.exe -Odinstaluj   # usługi, zapora i katalog; dane zostają obok (§8)
```

Deinstalacja **nie cofa tego, co aplikacja zapisała do Subiekta**, i nie usuwa
loginu SQL (§8).

**Rozdziały 1–4 to droga ręczna** — dokumentacja odniesienia instalatora.
Sięgnij po nie, gdy instalator zawiedzie w połowie. **Rozdziały 5–8 dotyczą
każdej instalacji.** Zostaje w nich jedna próba odtworzenia z kopii i kopia
bazy Subiekta, obie **zanim** ruszy praca na prawdziwych danych.

## 0a. Automatyczne scalanie PR-ów

**Czynność jednorazowa właściciela, w ustawieniach repozytorium.** API GitHuba
nie pozwala zrobić tego workflowowi ani agentowi. Bez tych kroków
`auto-scalanie.yml` nie ruszy wcale.

1. **Settings → General → Pull Requests → Allow auto-merge.** Zaznacz.
2. **Settings → Rules → Rulesets → New ruleset → Import a ruleset.** Wskaż
   plik `.github/rulesets/main.json` z tego repozytorium.

Reguła wymaga zielonych checków i świeżej gałęzi
(`strict_required_status_checks_policy`) oraz blokuje skasowanie `main`
i wymuszanie historii. **GitHub gałęzi sam nie odświeża** — robi to
`odswiezanie.yml`. Po każdym scaleniu i co dwadzieścia minut odświeża dwa
najstarsze PR-y z auto-scalaniem, które zostały w tyle. Pomija drafty,
konflikty i czerwone CI.

**Wymaga jednego sekretu, zakładanego raz:**

1. GitHub → Settings (konta) → Developer settings → Personal access tokens →
   **Fine-grained tokens → Generate new token**.
2. Repository access: tylko to repozytorium. Permissions: **Contents: Read and
   write** oraz **Pull requests: Read and write**.
3. Repozytorium → Settings → Secrets and variables → Actions → **New repository
   secret**, nazwa `ODSWIEZANIE_TOKEN`, wartość: token z punktu 1.

**Ten sam token włącza auto-scalanie.** Push i scalenie zwykłym tokenem
workflowu (`github.token`) nie uruchamiają CI, wydania ani APK. Bez sekretu
workflow zostawia ostrzeżenie, a wydanie trzeba uruchomić ręcznie (Actions →
Wydanie → Run workflow). Token wygasa w dniu podanym przy tworzeniu — ustaw
przypomnienie.

**Nazwy checków to `Serwer`, `Panel`, `Android`, `Instalator`, `Worker Sfery`,
`Usługa tła` i `Zgoda właściciela`** — pola `name` zadań w workflow'ach.
`Zgoda właściciela` wymaga przed importem kroku z §0d. Check dopasowuje się PO
NAZWIE. Zmieniając nazwę zadania, zmień ją w `main.json` i zaimportuj plik
ponownie, inaczej reguła zablokuje scalanie na zawsze. Każde zadanie startuje
zawsze i kończy się zielone, gdy nie ma czego sprawdzać.

**`bypass_actors` ma jedną pozycję: klucz wdrożeniowy** z §0c. Reguła
obowiązuje wszystkich ludzi łącznie z właścicielem. Nie dopisuj tu siebie
„na wszelki wypadek" — obejście reguły obchodzi też bramkę przed magazynem.

**Czego automat NIE robi.** Nie rozstrzyga konfliktów: PR, który przestał się
scalać, dostaje etykietę `konflikt` i jeden komentarz. **Jak zatrzymać
pojedynczy PR:** wyłącz na nim auto-scalanie w interfejsie GitHuba. Draft nie
jest scalany w ogóle.

## 0c. Numer wydania nadaje automat

**PR nie zmienia numeru wersji ani nie dopisuje wpisu w `CHANGELOG.md`.**
Opisuje zmianę w pliku `zmiany/<nazwa>.md` — wzór stoi w `zmiany/README.md`.
Po scaleniu `wydanie.yml` podbija wersję, składa wpis, kasuje fragmenty
i wypycha commit „<wersja> — <tytuł>" z tagiem. Ten commit uruchamia
`android.yml` i `paczka.yml`, które publikują wydanie. Fragmenty mają różne
nazwy plików, więc dwa otwarte PR-y nie konfliktują o numer.

**Wymaga klucza wdrożeniowego, zakładanego raz:**

1. Na dowolnym komputerze: `ssh-keygen -t ed25519 -N "" -C wertis-wydanie -f wertis-wydanie`.
2. Repozytorium → Settings → **Deploy keys → Add deploy key**. Tytuł
   `wydanie`, treść pliku `wertis-wydanie.pub`, zaznacz **Allow write access**.
3. Settings → Secrets and variables → Actions → **New repository secret**,
   nazwa `WYDANIE_KLUCZ`, treść pliku `wertis-wydanie` (bez `.pub`).
4. Zaimportuj ponownie `.github/rulesets/main.json` — dopisuje klucz
   wdrożeniowy jako jedyny wyjątek od reguły `main`.
5. Skasuj oba pliki klucza z komputera.

> **Dlaczego klucz, a nie token workflowu.** Reguła `main` wymaga zielonych
> checków także przy bezpośrednim pushu, a commit wydania powstaje po nich.
> Push tokenem workflowu nie uruchomiłby też publikacji.

Bez sekretu `wydanie.yml` kończy się na czerwono i scalona zmiana nie dostaje
numeru. Po dodaniu sekretu uruchom „Wydanie" ręcznie (Actions → Wydanie →
Run workflow).

**Znacznik w komentarzach.** Autor PR-a pisze w komentarzach i dokumentach
znacznik (`@` i `wydanie`, razem), a automat podmienia go na numer. Pomija
`CLAUDE.md`, `zmiany/README.md` i `tools/wydanie.mjs` z testem. **PR z samym CI
albo dokumentacją nie potrzebuje fragmentu**; wejdzie z najbliższym wydaniem.

## 0d. Zgoda właściciela na zapis do Subiekta

**Zmiana w kodzie, który pisze do Subiekta, czeka na kliknięcie właściciela.**
Błąd w reszcie repo cofa następne wydanie, a zły dokument w Subiekcie zostaje
w księgach. Listę chronionych ścieżek trzyma `.github/workflows/zgoda.yml`
i tylko tam się ją zmienia. CODEOWNERS nie zadziała, bo każdy PR otwiera konto
właściciela, a GitHub nie pozwala zatwierdzić własnego PR-a.

**Czynność jednorazowa, w tej kolejności:**

1. Settings → Environments → **New environment**, nazwa `zgoda-wlasciciela`.
   Jeśli środowisko już jest, otwórz je.
2. Zaznacz **Required reviewers** i dopisz siebie. **Prevent self-review**
   zostaw odznaczone, bo autorem PR-ów jest to samo konto.
3. Dopiero teraz zaimportuj ponownie `.github/rulesets/main.json`.

> **Kolejność nie jest dowolna.** Zadanie, które wskazuje nieistniejące
> środowisko, zakłada je bez ochrony i przechodzi. Import reguły przed
> krokiem 2 dałby wymagany check, który niczego nie pilnuje.

**Jak wygląda zgoda.** PR z chronionym plikiem ma check `Zgoda właściciela`
w stanie „Waiting". Actions → ten przebieg → **Review deployments** →
zaznacz `zgoda-wlasciciela` → **Approve and deploy**. Każdy nowy push pyta
od nowa. PR bez chronionych plików ma to zadanie pominięte, a GitHub liczy
pominięte jako zaliczone. Bramka łapie pomyłkę, nie złą wolę, więc sam
`zgoda.yml` też stoi na liście chronionej.

## 0b. Aktualizacja z panelu i z paczki

CI dokłada do każdego wydania paczkę `wertis-<wersja>.zip` z sumą SHA-256.
Instalator ją pobiera, sprawdza sumę i podmienia katalog aplikacji; na
serwerze nic się nie buduje. Powody takiego kształtu opisuje
[`docs/architektura.md`](docs/architektura.md) §12.

**Z panelu.** Ustawienia → „Aktualizacja serwera", tylko dla admina. Karta
pokazuje nowsze wydania i ich wpisy z `CHANGELOG.md`. Serwer zapisuje
zlecenie w `server\data\aktualizacja` i uruchamia zadanie Harmonogramu
„WERTIS aktualizacja" (dla dev: „WERTIS aktualizacja-dev"). Zadanie zakłada
instalator, bo usługa kończąca samą siebie zginęłaby w połowie.

**Z wiersza poleceń**, jako administrator:

```powershell
.\wertis-instalator.ps1 -Aktualizuj -Paczka najnowsza   # albo numer wersji, albo ścieżka do ZIP-a
```

1. Pobranie paczki i sumy; paczka bez sumy nie przechodzi. Starszej wersji
   niż obecna instalator nie wgra.
2. Rozpakowanie do `C:\wertis.nowa` — usługi dalej pracują.
3. Zatrzymanie usług. Za pierwszym razem `server\data` przenosi się do
   `C:\wertis-dane`, a w aplikacji zostaje dowiązanie (junction).
4. Przeniesienie `wertis.env`, `logs`, `tools`, `sfera-worker` i `tlo-worker`
   z poprzedniego katalogu.
5. Zamiana nazw: `C:\wertis` → `C:\wertis.poprzednia`, `C:\wertis.nowa` →
   `C:\wertis`. Start usług i próba zdrowia z porównaniem wersji.
6. Pobranie APK kolektora do `server\data\apk` (§5a).

**Gdy serwer nie wstanie**, nieudany katalog dostaje nazwę
`C:\wertis.nieudana-<wersja>`, a poprzedni wraca na miejsce. Baza wraca
z kopii `przed-*-do-<wersja>.db` (§7). Dziennik przebiegu:
`server\data\aktualizacja\ostatnia.log`.

**Instalacja z Gita** (starsza albo dev z gałęzi, `-Galaz`) aktualizuje się
samym `-Aktualizuj` (§7). Paczki powstają tylko z `main`.

### Wydania, które wymagają działania

Krok potrzebny przy konkretnym wydaniu — nowy klucz w `wertis.env`, GRANT,
krok w Subiekcie albo nowy APK — stoi w jego wpisie w `CHANGELOG.md` ze
znacznikiem `[wymaga działania]`. Serwer wstrzymuje wtedy automatyczną
aktualizację, aż ktoś potwierdzi ją przyciskiem w panelu.

### Aktualizacja automatyczna

Serwer sam klika przycisk z tej karty. Tryb ustawia `AKTUALIZACJA_AUTO`
w karcie „Serwer i kopie” (Ustawienia → Serwer):

| tryb | kiedy wgrywa | domyślny dla |
|---|---|---|
| `zaraz` | po dziesięciu minutach bez zapisu, także w dzień | produkcji i dev |
| `noc` | tylko w oknie `AKTUALIZACJA_OKNO` (domyślnie 3–5), po tej samej ciszy | — |
| `wylaczona` | nigdy — zostaje przycisk | — |

Automat NIE wgrywa wydania, gdy zachodzi którykolwiek z tych warunków:

- **wpis ma „[wymaga działania]"**, także pośredni — staje na wydaniu przed nim;
- **wydanie ma mniej niż `AKTUALIZACJA_DOJRZALOSC_H` godzin** (produkcja 1, dev 0);
- **wydanie nie ma paczki** — powstaje ona dopiero po zielonym „Serwer" na
  commicie wydania, więc wersja z czerwonymi testami nie wejdzie;
- **ta wersja już raz się nie udała** i została wycofana;
- **CHANGELOG się nie wczytał**, więc nie wiadomo, czy coś wymaga działania;
- **kanarek nie pracuje jeszcze na tej wersji** — gdy ustawiono
  `AKTUALIZACJA_KANAREK` (adres instancji dev, np. `http://localhost:3002`).

Magazyn pracuje na jedną zmianę, a dwie minuty postoju nie są problemem o żadnej
porze. Dlatego `zaraz` jest domyślne, decyzją właściciela. „Ruch" to zapis
z sesją, nie dowolne żądanie — panel otwarty na biurku odpytuje kolejki bez
przerwy.

**Wycofanie wydania z obiegu.** Na GitHubie: Releases → wydanie → Edit →
zaznacz **Set as a pre-release**. Znika z przycisku i z automatu najpóźniej
po godzinie.

## 1. Wymagania

Instalacja z paczki (§0) potrzebuje Windows z Subiektem GT, licencji Sfery
i stałego adresu maszyny. Paczka niesie Node, a NSSM pobiera instalator. Droga
ręczna z repozytorium potrzebuje dodatkowo:

- [Node.js LTS 22](https://nodejs.org) — **wymagane ≥ 22.5** (`node -v`), bo
  serwer używa wbudowanego `node:sqlite` z FTS5. Modułów natywnych nie ma,
  więc `npm ci` nie potrzebuje build tools;
- [Git](https://git-scm.com) z **Git Bash**, w którym wykonuje się polecenia
  bash z tej instrukcji (albo WSL);
- [NSSM](https://nssm.cc) do rejestracji usług (pojedynczy `nssm.exe`);
- stały adres maszyny w LAN (rezerwacja DHCP).

W bashu ścieżki windowsowe zapisuje się jako `/c/wertis`. Tam, gdzie narzędzie
Windows wymaga `C:\...` (NSSM), ścieżka stoi w apostrofach.

## 2. Instalacja aplikacji

```bash
cd /c
git clone https://github.com/MateuszPuchalski/mag-asystent.git wertis
cd /c/wertis
npm ci
npm run build      # panel → dist/web/obsluga, server → server/dist (API, /obsluga)
npm run seed       # zasila SQLite danymi demo (tryb seeded)

npm start                                   # API
npm -w server run start:worker              # worker, w drugim oknie
curl -s http://localhost:3001/api/health    # {"ok":true,...} = API stoi
```

> ⚠️ **To jest tryb DEMO, nie Subiekt.** Bez `SGT_MODE=mssql` aplikacja czyta
> i zapisuje wyłącznie własną bazę SQLite zasiloną z `magmat.xlsx`. Zmiana
> lokalizacji „się uda", a w Subiekcie nic się nie zmieni. Połączenie
> z prawdziwą bazą włącza **Etap 1 w §6**.

Serwer robi kopię `server\data\kopie\przed-*.db` przed każdą migracją (§7).
Migracje potrafią KASOWAĆ tabele, których aplikacja już nie czyta. Kto chce
tamtych danych, czyta je z kopii.

## 2a. Plik ustawień (`wertis.env`)

API i worker to **osobne procesy**. Gdy tylko jeden dostanie
`SGT_MODE=mssql`, zapisy po cichu wylądują w lokalnej bazie zamiast
w Subiekcie — i zgłoszą sukces. Dlatego **wszystkie procesy czytają ten sam
plik z dysku**:

```bash
cd /c/wertis
cp wertis.env.example wertis.env
nano wertis.env            # uzupełnij MSSQL_* i magazyny (§6 Etap 1)
```

Proces szuka `wertis.env` obok pliku wykonywalnego, w katalogu roboczym
i w katalogach nad nim. Wygrywa plik najbliższy, a który to był — pokazuje
`/api/health`. Zmienne środowiskowe mają pierwszeństwo nad plikiem.
`WERTIS_ENV_FILE` wskazuje inną ścieżkę i kończy szukanie. Plik jest
w `.gitignore`, bo trzyma hasło.

**Pełna lista kluczy** z opisami stoi w `wertis.env.example`. Klucze, które
czyta któryś z programów, wymienia `server/src/konfiguracja-rejestr.ts`, a test
pilnuje jego zgodności z kodem.

**Stan w panelu.** Ustawienia → Serwer → karta **Konfiguracja serwera**
(tylko admin) pokazuje ścieżkę wczytanego pliku i każdy klucz ze źródłem:
z pliku, przykryty przez zmienną usługi albo domyślny. Hasła i klucze API
widać wyłącznie jako „ustawione". Klucz, którego nie czyta żaden program,
staje na czerwono i w `problemy` na `/api/health` — to literówka albo
pozostałość po starszym wydaniu.

**Zmiana z panelu.** Decyzje właściciela mają przycisk **Zmień**: progi dat
Allegro, terminy zwrotów, Copilot i jego limity, klucze Allegro i API, kopie
na innym dysku, automat aktualizacji. Po „Zapisz” serwer:

1. sprawdza wartość według rodzaju (liczba, data ISO, wybór, tekst);
2. próbuje wstać z nowym plikiem w osobnym procesie — konfiguracja, przy
   której serwer odmówiłby startu, **nie trafia na dysk**;
3. zapisuje `wertis.env` atomowo, a poprzednią wersję zostawia
   w `wertis.env.poprzedni`;
4. pod NSSM kończy się sam i wstaje z nowym plikiem. Worker robi to samo
   w ciągu kilkunastu sekund.

Klucz dopisany z panelu staje pod linią `# ── zmienione z panelu ──`. Poza
NSSM (`npm run dev`, ręczne `node server\dist\index.js`) panel mówi, że zmiana
czeka na restart. **W pliku** zmienia się klucze instalatora, zaawansowane
i workerów C#. Trzy decyzje właściciela też: `MAG_ID_ODP`, `MAG_ID_SERWIS`
i `TW_ID_PRZESYLKA` wystawiają dokumenty, a `ZDJECIA_DODAWANIE=subiekt`
wymaga GRANT-u.

**Cofnięcie:** ten sam przycisk z poprzednią wartością albo **Domyślna**.
Gdyby panel nie wstał, przy zatrzymanych usługach:

```powershell
Copy-Item C:\wertis\wertis.env.poprzedni C:\wertis\wertis.env
```

Instalator **scala** ten plik, a nie nadpisuje. Klucz, o który kreator zapytał,
bierze z odpowiedzi; resztę zostawia. Przepadają tylko **komentarze własne**
i **klucze od kont** (`ADMIN_LOGIN`, `ADMIN_HASLO`), bo sekret konta idzie
przez API do bazy.

**Sprawdzenie, że oba procesy widzą Subiekta:**

```bash
curl -s http://localhost:3001/api/health
# → {"ok":true,"mode":"mssql","worker":{"zyje":true,"mode":"mssql"},...}
```

| co widzisz | co to znaczy |
|---|---|
| `"ok":true` | oba procesy żyją i pracują w tym samym trybie |
| `"mode":"seeded"` | pracujesz na danych demo, Subiekt nietknięty |
| `"problemy":[...]` | **przeczytaj zdanie** — mówi, co jest nie tak |
| `"worker":{"zyje":false}` | usługa `wertis-worker` nie działa; zapisy stoją w kolejce |
| `"panelObslugi"` inne niż `"wersja"` | **panel został na starym buildzie** — patrz niżej |

### Panel obsługi buduje się Z KORZENIA repo

`npm run build` w katalogu `server/` **nie przebudowuje panelu obsługi**;
buduje go to samo polecenie w korzeniu repo. Paczka wydania niesie gotowy
panel. Zbudowany `index.html` nosi pieczątkę `<meta name="wertis-panel">`,
a `/api/health` porównuje ją z wersją serwera. Rozjazd daje `"ok":false`
i zdanie w `problemy`. `"panelObslugi":null` znaczy „panelu tu nie ma" i nie
jest problemem. Starych plików w `server/dist/web` poza podkatalogiem
`obsluga` nikt nie serwuje.

## 3. Rejestracja usług Windows (NSSM)

Parametry są te same, których używa instalator (`instalator/uslugi.ps1`).
Instalacja z paczki uruchamia `C:\wertis\node\node.exe`, a `nssm.exe` leży
w `C:\wertis\tools`. Nazwy dzienników muszą się zgadzać z instalatorem, bo
tam szuka się awarii.

```bash
mkdir -p /c/wertis/logs

# API (razem z panelem biura pod /obsluga)
nssm install wertis-api 'C:\Program Files\nodejs\node.exe' 'C:\wertis\server\dist\index.js'
nssm set wertis-api AppDirectory 'C:\wertis'
nssm set wertis-api AppStdout 'C:\wertis\logs\wertis-api.log'
nssm set wertis-api AppStderr 'C:\wertis\logs\wertis-api.err.log'
nssm set wertis-api AppRotateFiles 1
nssm set wertis-api AppRotateBytes 10485760
nssm set wertis-api Start SERVICE_AUTO_START
nssm set wertis-api AppExit Default Restart

# Worker zapisu (lokalizacje; gdy SFERA_WORKER=0 bierze też zadania MM)
nssm install wertis-worker 'C:\Program Files\nodejs\node.exe' 'C:\wertis\server\dist\worker\worker.js'
nssm set wertis-worker AppDirectory 'C:\wertis'
nssm set wertis-worker AppStdout 'C:\wertis\logs\wertis-worker.log'
nssm set wertis-worker AppStderr 'C:\wertis\logs\wertis-worker.err.log'
nssm set wertis-worker AppRotateFiles 1
nssm set wertis-worker AppRotateBytes 10485760
nssm set wertis-worker Start SERVICE_AUTO_START
nssm set wertis-worker AppExit Default Restart

nssm start wertis-api
nssm start wertis-worker
```

Usługi mają `AppDirectory C:\wertis`, więc czytają `C:\wertis\wertis.env`
z §2a. Po zmianie pliku wystarczy restart:

```bash
nssm restart wertis-api ; nssm restart wertis-worker
```

Konfiguracji **nie wpisuje się w `AppEnvironmentExtra`**. Wartości wpisane
osobno dla każdej usługi rozjeżdżają się bez objawu, a niecytowana zmienna
rozbija się o spację w haśle.

> **Uwaga:** worker Sfery musi działać na TEJ maszynie (COM Sfery jest lokalny)
> i wszystkie procesy muszą widzieć ten sam plik `C:\wertis\server\data\wertis.db`.
> Nie przenoś API na inny host bez migracji kolejki na Postgres.

### Worker Sfery (`wertis-sfera`)

Usługa jest opcjonalna i dochodzi przy automatyzacji dokumentów (etap 2 z §6).
Wymaga licencji Sfery i `SFERA_WORKER=1`. Samowystarczalny exe zdejmujesz
z artefaktu CI (workflow „Worker Sfery" → Artifacts, `wertis-sfera-worker`),
więc .NET SDK nie jest potrzebny. Budowanie opisuje
[`sfera-worker/README.md`](sfera-worker/README.md).

**Aktualizacja WERTIS nie podmienia exe workera** — katalog `sfera-worker`
przechodzi do nowej wersji bez zmian. Gdy `CHANGELOG.md` każe wgrać nowe exe:
zatrzymaj `wertis-sfera`, podmień `wertis-sfera-worker.exe`, uruchom usługę.

> **Usługę rejestruj jako OSTATNIĄ.** Najpierw uruchom exe z ręki:
> `wertis-sfera-worker.exe --dry-run --once`. Błąd widać wtedy na ekranie,
> a nie w dzienniku NSSM. Nazwy Sfery sprawdza bez wystawiania dokumentu
> `sfera-worker\sonda.ps1`. Bramki i piaskownicę (podmiot testowy, nie kopia
> bazy) opisuje [`docs/wdrozenie.md`](docs/wdrozenie.md).

```powershell
nssm install wertis-sfera 'C:\wertis\sfera-worker\wertis-sfera-worker.exe'
nssm set wertis-sfera AppDirectory 'C:\wertis'
nssm set wertis-sfera AppStdout 'C:\wertis\logs\wertis-sfera.log'
nssm set wertis-sfera AppStderr 'C:\wertis\logs\wertis-sfera.err.log'
nssm set wertis-sfera AppRotateFiles 1
nssm set wertis-sfera Start SERVICE_AUTO_START
nssm set wertis-sfera AppExit Default Restart
```

Usługa bez `AppStdout` nie zapisuje nigdzie tego, co worker wypisuje. Brak
`wertis-sfera.log` przy działającej usłudze znaczy właśnie to — dopisz obie
ścieżki i zrestartuj usługę.

> **Konto usługi to warunek, nie szczegół.** Na koncie `LocalSystem` Subiekt
> potrafi oddać pustą sesję, a sonda przechodzi, bo idzie na koncie człowieka.
> Objaw w kolejce to „pusty obiekt" przy `SuDokumentyManager.DodajMM()`.
> Pierwsza linia `wertis-sfera.log` mówi, na jakim koncie działa usługa.
> Uruchom ją na koncie, na którym przechodzi sonda:

```powershell
nssm set wertis-sfera ObjectName '.\NazwaKonta' 'HasloKonta'
nssm restart wertis-sfera
```

Pustą sesję na właściwym koncie dają procesy „Subiekt GT (32-bitowy)”
pozostawione w tle. Wyczyść je; okna otwarte przez ludzi mają inny numer
sesji niż `0` i zostają nietknięte:

```powershell
nssm stop wertis-sfera
Get-Process | Where-Object { $_.Path -like '*InsERT*' -and $_.SessionId -eq 0 } | Stop-Process
nssm start wertis-sfera
```

Usługę usuwania tła (`wertis-tlo`) opisuje etap 2a w §6.

## 4. Sieć: stały adres + zapora + DNS

1. **Rezerwacja DHCP** dla maszyny (po MAC) w routerze.
2. **Wpis DNS** `mag.wertis.local → <IP maszyny>` w routerze / serwerze AD DNS.
   Bez własnego DNS: wpis w plikach hosts kolektorów albo samo IP.
3. **Zapora Windows** — wpuść port 3001 tylko z sieci LAN:

```bash
netsh advfirewall firewall add rule name="WERTIS kolektor" dir=in action=allow protocol=TCP localport=3001 remoteip=localsubnet
```

Kolektory łączą się z `http://mag.wertis.local:3001`. HTTPS nie jest wymagane
w LAN.

### Kilka punktów dostępowych w hali

Na wszystkich AP ustaw **jedną nazwę sieci (SSID), jedną podsieć, to samo
hasło i to samo pasmo**. Telefon przechodzi wtedy między nimi bez pytania,
a adres serwera się nie zmienia. Sprawdzenie: porównaj adres IP kolektora
z adresem serwera; zgodne trzy pierwsze liczby znaczą wspólną podsieć.

**Gdy sieci są osobne, zapora je odetnie**, bo `remoteip=localsubnet` wpuszcza
wyłącznie własną podsieć serwera. Najlepiej zepnij AP w jedną podsieć (most,
nie osobny DHCP). Albo rozszerz regułę zapory o drugą podsieć:

```bash
netsh advfirewall firewall set rule name="WERTIS kolektor" new remoteip=192.168.10.0/24,192.168.20.0/24
```

### Diagnostyka na kolektorze

**Ustawienia → DIAGNOSTYKA POŁĄCZENIA** mówi trzy rzeczy i żadnej nie zmienia:

1. **Serwer** — czy odpowiedział, po ilu milisekundach i w jakiej wersji.
   Cisza to zapora albo izolacja klientów. Odrzucone połączenie to zły port
   albo zgaszony serwer. Nieznana nazwa to DNS, brak trasy to druga sieć.
2. **Droga do serwera** — rodzaj sieci, adres kolektora, interfejs i DNS.
   Przy serwerze podanym adresem IP ekran sam porównuje podsieci.
3. **Przerwy w łączności** — początek, czas trwania, liczba prób i powód.

Przerwy od pięciu sekund jadą też do dziennika biura (`/obsluga` →
**Dziennik**, typ `siec_przerwa`, filtr po urządzeniu). Wpis powstaje PO
przerwie i odpowiada na pytanie „jedno urządzenie czy wszystkie?". Wyłącznik
stoi w **Ustawieniach → Log przerw w łączności**. Kolektor bez zalogowanej
osoby nic nie wysyła. Nazwy sieci (SSID) i punktu (BSSID) ekran nie zna, bo
od Androida 8 wymagają uprawnienia do lokalizacji.

### Sieć gościnna: adres jest, serwera nie ma

Kolektor dostaje adres z tej samej puli i ma internet, a serwera nie widzi.
Przyczyną jest **izolacja klientów**: punkt dostępowy blokuje ruch między
urządzeniami sieci, jak domyślnie w sieciach gościnnych. Rozpoznanie:

1. Porównaj adres **urządzenia** z adresem serwera; pole „Brama" się nie nadaje.
2. Z przeglądarki kolektora otwórz `http://<IP-serwera>:3001/api/setup` na każdej sieci.

Strona otwiera się tylko na jednej sieci — to izolacja. **Wyłącz izolację
klientów przy tym SSID-zie** („AP isolation", „Client isolation", „Guest
mode") albo trzymaj kolektory na sieci magazynowej. Aplikacja tego nie obejdzie.

## 5. Kolektory — natywna aplikacja Android (APK)

Kolektor to natywny klient REST z [`android/`](android/README.md). Skan idzie
przez SDK producenta (Zebra DataWedge / Honeywell DataCollection), offline przez
bufor plikowy JSON i WorkManager, kiosk przez Android lock-task/MDM.

**Na kolektory idzie wyłącznie APK wydania.** CI buduje go na `main`
(artefakt `wertis-kolektor-apk`) i publikuje jako wydanie GitHuba `v<wersja>`
z plikami `.apk` i `.apk.sha256`. Stamtąd bierze go aktualizacja serwera.
Build debugowy (`wertis-kolektor-debug-apk`) dostaje losowy klucz przy każdym
biegu CI. Android odmawia aktualizacji podpisanej innym kluczem, więc taki
build wyłącza samoaktualizację.

```bash
cd android
./gradlew :app:assembleDebug        # → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease      # → app/build/outputs/apk/release/ (wymaga klucza)
```

### Klucz podpisu — raz, na maszynie z Javą

Bez czterech sekretów podpisu żaden APK wydania nie powstaje. **`keytool`
przychodzi z JDK**, a serwer WERTIS ma sam Node. Klucz trafia do sekretów
repozytorium i podpisuje nim CI. Z Android Studio `keytool` leży w
`C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe`. Po instalacji
JDK otwórz **nowy** terminal.

```powershell
winget install EclipseAdoptium.Temurin.17.JDK   # ta sama dystrybucja co w CI
```

```bash
keytool -genkeypair -v -keystore wertis.keystore -alias wertis \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 wertis.keystore > klucz.txt      # sekret dla CI (bash)
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("wertis.keystore")) > klucz.txt
```

Pytania kreatora o tożsamość **nie mają znaczenia technicznego**. Hasło zapisz
od razu tam, gdzie trzymasz resztę haseł firmy. Nie podawaj go w `-storepass`,
bo zostaje w historii powłoki.

Sekrety **repozytorium** (nie środowiska) wpisuje się w **Settings → Secrets
and variables → Actions → New repository secret**
(`https://github.com/MateuszPuchalski/mag-asystent/settings/secrets/actions`):

| nazwa sekretu | co wkleić |
|---|---|
| `WERTIS_KEYSTORE_B64` | całą zawartość `klucz.txt`, jedną linią |
| `WERTIS_KEYSTORE_HASLO` | hasło podane przy tworzeniu klucza |
| `WERTIS_KLUCZ_ALIAS` | `wertis` |
| `WERTIS_KLUCZ_HASLO` | **to samo hasło** co wyżej — PKCS12 nie ma osobnego hasła klucza |

Nazwy muszą zgadzać się co do znaku z `.github/workflows/android.yml`.
Sekretu nie da się podejrzeć, tylko nadpisać. Bez zmiany w kodzie bieg odpala
**Actions → Android → Run workflow → gałąź `main`**. Build lokalny czyta te
same wartości ze zmiennych `WERTIS_KEYSTORE`, `WERTIS_KEYSTORE_HASLO`,
`WERTIS_KLUCZ_ALIAS` i `WERTIS_KLUCZ_HASLO`. Przyjmuje je też plik
`local.properties` w katalogu `android/` (`wertis.keystore`,
`wertis.keystore.haslo`, `wertis.klucz.alias`, `wertis.klucz.haslo`).

> **Kopia klucza jest równie ważna jak kopia bazy.** Bez niej żaden przyszły
> APK nie zainstaluje się nad obecnym i trzeba odinstalować aplikację na
> każdym kolektorze.

**Kolektor z buildem debugowym albo innym kluczem** odmówi aktualizacji
komunikatem „App not installed". Odinstalowanie kasuje adres serwera
i **bufor offline**, więc na każdym urządzeniu po kolei:

1. Sprawdź, czy pasek bufora offline pokazuje zero operacji do wysłania.
2. Odinstaluj aplikację.
3. Zainstaluj APK wydania.
4. Podaj adres serwera na ekranie startowym.

### Skaner i pierwsza instalacja

- **Zebra (DataWedge):** aplikacja sama tworzy profil `WERTIS` przy starcie.
  Gdy MDM blokuje zdalną konfigurację — profil ręcznie wg `android/README.md`.
- **Honeywell:** wrzuć `DataCollection.aar` z portalu Honeywell do
  `android/app/libs/honeywell-datacollection.aar` **przed** buildem. Bez niego
  aplikacja działa na skanerze klawiaturowym (wedge).
- **Pierwsza instalacja:** panel → **Ustawienia → Nowy kolektor**, MDM
  (SOTI / Honeywell / Zebra) albo `adb install`. Kiosk: lock-task / device owner.
- **Adres serwera** podajesz na ekranie startowym (`ZMIEŃ ADRES SERWERA`),
  a po zalogowaniu w **Ustawienia → Serwer WERTIS**.
- **Fabryczna wartość to adres produkcji** (`DEFAULT_SERVER_URL`), trzymany
  rezerwacją DHCP z §4. Przeprowadzka serwera wymaga zmiany tej stałej
  i nowego wydania APK.

Checklist smoke-test i integracja skanerów: [`android/README.md`](android/README.md).

### Play Protect blokuje instalację / aktualizację

Komunikat „Play Protect nie zna aplikacji tego dewelopera" **nie jest werdyktem
o aplikacji** — Google nie zna naszego klucza, a skan wraca przy każdej
aktualizacji.

1. Rozwiń **„Więcej szczegółów"** i kliknij **„Zainstaluj mimo to"**, jeśli jest.
2. Przy oknie z samym OK wyłącz skan: **Sklep Play → konto → Play Protect → zębatka**.
3. Ponów aktualizację z ekranu kolektora.
4. Na pytanie o wysłanie aplikacji do weryfikacji odpowiedz „Nie wysyłaj".

Na dedykowanych kolektorach zostaw skan wyłączony. Instalacja przez MDM
w trybie device owner omija Play Protect w całości.

## 5a. Konta pracowników i hasła

Każda trasa API wymaga nagłówka `x-session` poza sześcioma: `GET /api/health`,
`GET /api/setup`, `POST /api/auth/login`, `POST /api/users` przy pustej bazie
oraz `GET /api/aktualizacja` i `GET /api/aktualizacja/apk`. Bez tej bramki
dowolne urządzenie w sieci hali mogłoby zmienić lokalizację w Subiekcie.

**1. Konta zakłada się w panelu.** Pusta instalacja pokazuje pod `/obsluga/`
formularz pierwszego konta; jego rola to zawsze `admin`. Kolejne osoby dodaje
**Ustawienia → Konta i sesje → Dodaj osobę**. Biuro zakłada tam magazynierów,
a konta biura i admina zakłada wyłącznie admin.

**Albo z kolektora.** Przy pustej instalacji ekran startowy pokazuje
**ZAŁÓŻ KONTA**. Pierwsza pozycja kreatora to konto administratora. Gdy coś
padnie w połowie, ekran pokazuje, co już powstało — dopisz tylko brakujące.
Później osoby dochodzą przez **Ustawienia → DODAJ OSOBY**. Same pola logowania
bez przycisku znaczą, że kolektor NIE DOGADAŁ SIĘ Z SERWEREM.

**1b. Alternatywa: `curl`,** gdy konta zakłada się skryptem.

```bash
# pierwsze konto — bez sesji, TYLKO przy pustej bazie; rola `admin` jest wymuszona
curl -X POST http://<IP-serwera>:3001/api/users \
  -H 'content-type: application/json' \
  -d '{"name":"Właściciel","login":"wlasciciel","haslo":"tajnehaslo"}'

# zaloguj się nim i dopisz resztę
TOKEN=$(curl -s -X POST http://<IP-serwera>:3001/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"wlasciciel","haslo":"tajnehaslo"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Jan Kowalski","login":"jkowalski","haslo":"tajnehaslo"}'

# konto biura — tę linię wykona TYLKO admin; biuro dostanie 403
curl -X POST http://<IP-serwera>:3001/api/users \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Biuro Zakupy","role":"biuro","login":"biuro","haslo":"tajnehaslo"}'

curl http://<IP-serwera>:3001/api/users -H "x-session: $TOKEN"   # lista kont
```

Hasła z przykładu zmień. **Żadnych domyślnych haseł i żadnych domyślnych
kont.** Instalator losuje hasło konta SQL, hasło admina wpisuje człowiek,
a `npm run seed` losuje hasło i pokazuje je raz.

| rola | co może ponad poprzednią |
|---|---|
| `magazynier` | praca na hali: skanowanie, lokalizacje, zgłoszenia; panel go nie wpuszcza |
| `biuro` | panel, lista kont, zakładanie kont magazynierów, ślad audytowy, widoczność magazynów, zdjęcie dostawy z listy, resync z Subiekta |
| `admin` | wszystko, co biuro, **plus** konta `biuro` i `admin`, wyłączanie kont, odbieranie haseł, raport wydajności per osoba |

Zakładanie kont nie schodzi na halę, bo to jedyna operacja tworząca
tożsamość. Z tego samego powodu biuro nie zresetuje hasła magazynierowi —
robi to admin. Rola w `POST /api/users` jest sprawdzana przeciw zamkniętej
liście. Porzucony zalogowany kolektor pozwala na wszystko, co może jego
właściciel, więc wylogowanie po zmianie jest obowiązkiem.

**2. Hasła.** Swoje hasło każdy zmienia sam:

```bash
curl -X POST http://<IP-serwera>:3001/api/auth/haslo \
  -H "x-session: $TOKEN" -H 'content-type: application/json' \
  -d '{"stare":"tajnehaslo","nowe":"noweHaslo123"}'
```

Cudze ustawia admin na karcie **Konta i sesje** albo przez
`POST /api/users/:id/haslo` z `{"haslo":"…"}`; `null` odbiera hasło. Konta się
**nie kasuje** — wyłącza je `POST /api/users/:id/active` z `{"active":false}`,
bo historia w `events` musi mieć na co wskazywać.

**3. Migracja historii** zakłada konta-ślady bez loginu dla nazw z `events`
i wypełnia `events.user_ref`. Jest idempotentna i niczego nie kasuje:

```bash
curl -X POST http://<IP-serwera>:3001/api/users/migrate-history \
  -H "x-session: $TOKEN" -H 'content-type: application/json'
```

**4. Raport wydajności per osoba — obowiązek formalny PRZED uruchomieniem.**
Widzi go tylko admin (Analiza → Praca hali); ta sama reguła obejmuje tabelę
osób na karcie „Skuteczność doboru”. To **monitoring pracowniczy** w rozumieniu
Kodeksu pracy (art. 22² i nast.). Wymaga zapisu w **regulaminie pracy** albo
**obwieszczeniu**, **uprzedzenia pracowników na 2 tygodnie** i informacji dla
nowych osób **przed dopuszczeniem do pracy**. Kod tego nie blokuje, a raport
niesie tę informację w polu `podstawaPrawna`. Techniczny audyt „kto zmienił
lokalizację" to co innego.

**5. Aktualizacja kolektorów.** APK leży w `server\data\apk\` jako
`wertis-kolektor-<wersja>.apk`; kładzie go tam aktualizacja serwera albo
ręczna kopia. Kolektor pyta o nową wersję **przy otwarciu aplikacji**, także
przed zalogowaniem. Android poprosi raz o zgodę **„Instalowanie nieznanych
aplikacji"**. Gdy MDM blokuje instalowanie spoza sklepu, kolektor powie to
wprost i zostaje droga przez MDM. Aktualizacja niczego nie kasuje.

## 6. Przejście na prawdziwe dane Subiekta

Etapy, bramki i wycofanie opisuje [`docs/wdrozenie.md`](docs/wdrozenie.md).
Test na wersji edu (bez Sfery) krok po kroku —
[`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md).

### Najważniejsze narzędzie: zatrzymany worker

Worker jest jedynym procesem, który **zapisuje do Subiekta** lokalizacje
i kody. Zatrzymany worker daje przebieg próbny na żywych danych: aplikacja
czyta prawdziwą bazę i kolejkuje zapisy, a **do Subiekta nie idzie nic**.
`/api/health` zgłosi to jako problem, co na etapach próbnych jest oczekiwane.

```powershell
nssm stop wertis-worker
```

```bash
curl -s -H "x-session: $TOKEN" http://localhost:3001/api/queue | jq '.items[] | {label, detail, status}'
```

**Etap 0 — pilot (`seeded`):** dane z eksportu `magmat.xlsx`, Subiekt
nietknięty.

**Etap 1 — odczyt z MSSQL (`SGT_MODE=mssql`):**

1. Utwórz login SQL o minimalnych uprawnieniach — robi to kreator; skrypt ręczny w `docs/subiekt-gt-edu-setup.md` §2.
2. Ustal na własnej bazie trzy rzeczy z listy niżej.
3. Wpisz wartości do `wertis.env` (§2a).
4. Zrestartuj obie usługi (§3).
5. Sprawdź, że `/api/health` pokazuje `"ok":true`, `"mode":"mssql"` oraz `"worker":{"mode":"mssql"}`.

| uprawnienie | obiekt | po co |
|---|---|---|
| `SELECT` | `tw__Towar`, `tw_Stan`, `dok__Dokument`, `dok_Pozycja`, `kh__Kontrahent`, `sl_Magazyn`, `tw_Cena` | kartoteki, stany, dokumenty, ceny |
| `SELECT` | `tw_ZdjecieTw`, `vwPoziomyCen` (gdy są w bazie) | zdjęcia kartotek, nazwy poziomów cen |
| `UPDATE` | `tw__Towar`: kolumna z `MSSQL_LOC_COLUMN` i `tw_PodstKodKresk` | lokalizacja, kod kreskowy z kolektora |
| `INSERT` | `tw_ZdjecieTw` (tylko `-ZdjeciaZapis`) | zdjęcie dodane z kolektora (etap 2a) |

Aplikacja **nie ma innego prawa zapisu**. Kreator sprawdza obecność obiektów
opcjonalnych, bo `GRANT` na nieistniejący obiekt przerywa cały skrypt. Nazwy
tabel, typy FZ = 1 i PZ = 10 (**nie** 5 = KFZ) oraz bufor `dok_Status = 3` są
stałymi z [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).
Zapytania do ustalenia reszty stoją tam, w rozdziale „Jak ustalić wszystkie
wartości":

- **`mag_Id` magazynów MAG, MGP i Zwroty** (`MAG_ID_MAG` / `MAG_ID_MGP` /
  `MAG_ID_ZWROTY`). Pomyłka wysyła dostawę do złej zakładki.
- **pole lokalizacji** (`MSSQL_LOC_COLUMN`) — jedno z ośmiu pól własnych
  `tw_Pole1..tw_Pole8`, `varchar(50)` (`LOC_FIELD_LIMIT=50`). Natywnej kolumny
  lokalizacji nie ma. Kreator podpowiada pole, w którym firma notuje adresy.
- **zamówienia do dostawcy (ZD)** (`DOK_STATUS_ZD_OTWARTE`,
  `MSSQL_ZD_ZREAL_COLUMN`, `MSSQL_ZD_TERMIN_COLUMN`), wszystkie opcjonalne.
  Bez kolumny ilości zrealizowanej ustaw `MSSQL_ZD_ZREAL_COLUMN=` (puste).

> ⚠️ Worker **nadpisuje wybrane pole lokalizacji bezwarunkowo**. Wybierz takie,
> którego firma nie używa do niczego innego.

Kreator **nie pyta o ZD, typy dostaw ani okno importu** — te dopisuje się
ręcznie. Importer `server/src/adapters/subiekt.mssql.ts` zasila read-model
`sgt_*` przy starcie API, co `MSSQL_SYNC_MS` i przez `POST /api/admin/resync`.

### Konto SQL, gdy nie ma hasła `sa`

**`sa` nie jest wymagane** — wystarczy konto, które może założyć login i nadać
uprawnienia. Na pytanie o hasło **wciśnij Enter**. Instalator zapisze gotowy
skrypt `C:\wertis\nadaj-uprawnienia-wertis.sql` z hasłem w środku
i w `wertis.env`. Przekaż go administratorowi bazy, a po wykonaniu:

```powershell
nssm restart wertis-api ; nssm restart wertis-worker
```

Do tego czasu aplikacja **nie połączy się z bazą** — to jest oczekiwane.

### Czym grozi pomyłka w którym ustawieniu

Wartości oznaczone w kodzie `[WERYFIKUJ]` to założenia. Przejdź tę tabelę
przed pierwszą pracą na produkcji:

| ustawienie | co ustala | czym grozi pomyłka |
|---|---|---|
| `MSSQL_LOC_COLUMN` | pole lokalizacji na kartotece | **nadpisanie cudzych danych** — aplikacja pisze bezwarunkowo |
| `MSSQL_DATABASE` | baza podmiotu | praca na kopii zamiast produkcji, bez objawu |
| `DOK_TYPY_DOSTAW` | typy dokumentów w zakładce DOSTAWY (domyślnie sama FZ) | obce dokumenty na liście pracy magazyniera |
| `DOK_DNI_WSTECZ` | okno importu i zakres listy dostaw | nic nie ginie — niedokończone dostawy zostają mimo okna |
| `MSSQL_ZD_ZREAL_COLUMN` | ilość już odebrana z zamówienia | zawyżone ilości na karcie towaru |
| `DOK_STATUS_ZD_OTWARTE` | które zamówienia uznajemy za otwarte | zamknięte zamówienie wisi na karcie |
| `MM_ZWROTY_DNI_WSTECZ` | okno importu przesunięć na regał zwrotów (§6a) | starszy kosz z kartką nie otworzy się numerem |
| `MAG_ID_ZWROTY` | magazyn, na który biuro wystawia MM ZWROTY (§6a) | lista przyjęć pusta, bez błędu |
| `MAG_ID_ODP` | magazyn odpadu dla oceny „utylizacja" | brak wpisu wyłącza koszyk odpadu |
| `MAG_ID_SERWIS` | magazyn na braki w dostawie | brak wpisu wyłącza przesunięcie braku |
| `DOK_SPRZEDAZ_DNI_WSTECZ` | okno importu dokumentów sprzedaży (domyślnie 60) | starsza sprzedaż nie pokaże się przy zwrocie |
| `MSSQL_SPRZEDAZ_NR_ORYG_COLUMN` | kolumna z numerem obcym na dokumencie | dokument wskaże człowiek, nie automat |

Każdy z tych odczytów DEGRADUJE, a nie przerywa importu, a `/api/health` mówi
zdaniem, czego brakuje. Na obciążonym serwerze SQL podnieś
`MSSQL_REQUEST_TIMEOUT_MS` (domyślnie 30000).

**Etap 1a — zapis (automatyczny przy `SGT_MODE=mssql`):** login wykonuje
`set_location` UPDATE-em kolumny objętej grantem. Bez workera Sfery zadania MM
kończą się czytelnym błędem, a MM wystawia biuro w Subiekcie. Stan zjeżdża
wtedy z magazynu źródłowego dopiero po ręcznym MM.

**Zdjęcia kartotek (opcjonalne, sam odczyt).** Kreator włącza je sam, gdy
w bazie jest `tw_ZdjecieTw` z kompletem czterech kolumn: ustawia `ZDJECIA_*`
i nadaje `SELECT`. Ręcznie wpisuje się klucze tylko przy zdjęciach w katalogu
(`ZDJECIA_ZRODLO=plik`). Serwer pamięta „brak zdjęcia" 12 godzin, a kolektor
dobę. Szybciej, kontem biura albo admina:

```bash
curl -s -X POST -H "x-session: <token>" http://localhost:3001/api/admin/zdjecia/odswiez
```

Pobrane zdjęcia zostają. Pole `zdjecia` na `/api/health` podaje liczbę
i największy rozmiar — na tych liczbach dobiera się `ZDJECIA_MAX_KB`.

**Etap 2 — dokumenty przez Sferę.** Usługa `wertis-sfera` (§3) wykonuje
wyłącznie zadania dokumentowe z tej samej kolejki. Wymaga licencji Sfery
i operatora Subiekta z prawem wystawiania MM. **Wszystko najpierw na
podmiocie testowym:**

1. Połóż `wertis-sfera-worker.exe` w `C:\wertis\sfera-worker\`.
2. Przejdź listę `[WERYFIKUJ]` z [`sfera-worker/README.md`](sfera-worker/README.md).
3. Dopisz `SFERA_WORKER=1`, `SFERA_OPERATOR` i `SFERA_OPERATOR_HASLO` do `wertis.env`.
4. Przy autentykacji mieszanej dopisz `SFERA_SQL_LOGIN` i `SFERA_SQL_HASLO`.
5. Zarejestruj usługę: instalator z `-TylkoKonfiguracja` albo §3.
6. Zrestartuj WSZYSTKIE usługi — przełącznik zmienia też zachowanie workera Node.
7. Przejdź bramki z `docs/wdrozenie.md`, „Dołączenie workera Sfery".

**Etap 2a — zdjęcia dodawane z kolektora (opcjonalny).** Usługa `wertis-tlo`
wycina tło, a człowiek ogląda wynik przed zapisem. Sfera nie jest potrzebna.
Instrukcja: [`tlo-worker/README.md`](tlo-worker/README.md). Najpierw na KOPII bazy:

1. Na maszynie z .NET 8 SDK uruchom `powershell -NoProfile -ExecutionPolicy Bypass -File tlo-worker\build.ps1`.
2. Porównaj wypisaną sumę modelu ze źródłem u wydawcy i wpisz ją do skryptu.
3. Skopiuj katalog `publish` do `C:\wertis\tlo-worker\` i zarejestruj usługę `wertis-tlo` jak w §3.
4. Dopisz `TLO_URL=http://127.0.0.1:8791` i `ZDJECIA_DODAWANIE=wertis`.
5. Zrestartuj `wertis-api` i dodaj jedno zdjęcie z kolektora.

> **`ZDJECIA_DODAWANIE=subiekt` NIE jest równorzędnym wyborem.** Wymaga
> działającego odczytu (`ZDJECIA_ZRODLO=blob` z `ZDJECIA_TABELA`,
> `ZDJECIA_KOLUMNA_KLUCZA` i `ZDJECIA_KOLUMNA_GLOWNE`) przy `SGT_MODE=mssql`.
> Bez kompletu **serwer ODMAWIA STARTU** (`SERVICE_PAUSED`, powód
> w `wertis-api.err.log`). Wycofanie: wyczyść klucz i zrestartuj usługę.

Przy `subiekt` nadaj grant instalatorem z `-ZdjeciaZapis` albo w SSMS:
`GRANT INSERT ON dbo.tw_ZdjecieTw TO wertis;`. Potem otwórz kartotekę próbną
w Subiekcie, zakładka „Opis": zdjęcie ma się rysować bez czarnego prostokąta.
To **bramka**: przezroczystość i `zd_CRC` są `[WERYFIKUJ]`. Bez `wertis-tlo`
zdjęcie zapisuje się z tłem. Bez grantu zostaje w bazie WERTIS, a
`/api/health` liczy je w `zdjeciaWlasne`.

**Etap 3 — pełny obieg:** dostawy z prawdziwych FZ/PZ i przesunięcia stanu
przez workera Sfery.

## 6a. Zwroty na regale — kosze z dokumentu MM ZWROTY

Biuro prowadzi zwroty Allegro w panelu, zakładka **Zwroty** (§6g). **Towar
wraca na półkę wyłącznie koszem z dokumentu MM** na magazyn zwrotów:

1. Biuro wystawia w Subiekcie **MM z magazynu głównego na regał zwrotów**.
2. Numer tego dokumentu ktoś pisze **odręcznie na kartce** przypiętej do kosza.
3. Magazynier wpisuje albo skanuje numer na kolektorze i rozkłada kosz.
4. Po ZAKOŃCZ aplikacja sama zamawia dokument powrotny (ZWR→MAG).

> ⚠️ **Nie wystawiaj powrotu ręcznie.** Dodatkowy dokument w Subiekcie zdejmie
> stan z regału drugi raz.

Powrót idzie na **magazyn nadawcy** przesunięcia, zapisany przy otwarciu kosza.
Kosz bez znanego kierunku wypisuje rekoncyliacja (`kosz_bez_powrotu`),
a zamyka go biuro ręcznie. Bez workera Sfery zadanie powrotu stanie w błędzie
i powrót wystawia się ręcznie. **Koszyk złożony w panelu** („Z-…”) nie trafia
na kolektor: halę rozkłada kosz z numerem jego MM, a kierunek bierze się
z `MAG_ID_ZWROTY` → `MAG_ID_MAG`. Kosze odpadu na kolektor nie wchodzą.

Zawartość kosza to **pozycje dokumentu MM** (`dok_Typ = 9`, odbiorca =
magazyn zwrotów) z okna `MM_ZWROTY_DNI_WSTECZ` (domyślnie 30 dni). Kosz z **0
pozycji** tłumaczy `/api/health`: `lastSync.mm`, `lastSync.mmPozycje`
i `problemy`. Zero pozycji przy niezerowej liczbie dokumentów to zepsuty odczyt.

Na kolektorze **drugi skan tego samego towaru kończy odłożenie** (po 800 ms).
Towar zablokowany w kartotece wskazuje się palcem, a ten sam towar z kilku
zwrotów to jedna linijka. Pozycję, której nie ma, **pomija się z powodem** —
nie dostaje MM. COFNIJ ODŁOŻENIE, COFNIJ POMINIĘCIE i COFNIJ ZAKOŃCZENIE
działają, dopóki zapis czeka w kolejce.

Biuro ogląda kosze w `/obsluga` → Zwroty → Kosze, z kubełkiem POMINIĘTE
POZYCJE i przyciskiem ZAŁATWIONE. Dokumenty, których towar dawno leży na
regałach, zdejmuje **admin** akcją „już rozłożony".

### Rozkładanie od zera (zakładka KARTON)

Pudło z towarem źle zebranym pod zamówienia nie ma dokumentu, bo żaden stan
się nie zmienia.

1. Magazynier stuka NOWY KARTON — aplikacja nadaje kod (`K-1`, `K-2`, …).
2. Skanuje zawartość albo wyszukuje towar w polu u góry.
3. ZATWIERDŹ zamyka listę i robi z kartonu zwykły kosz do rozłożenia.
4. ZAKOŃCZ zapisuje **wyłącznie adresy półek**, bez dokumentu w Subiekcie.

Kartony widać w Zwroty → Kosze z pastylką KARTON. **ANULUJ KARTON** działa na
każdym etapie; karton z zawartością zostaje jako ANULOWANY.

## 6b. Konto Allegro — parowanie i token

Bez `ALLEGRO_CLIENT_ID` funkcje Allegro są **wyłączone**, a reszta pracuje
normalnie. Stan połączenia: `/obsluga → STAN SYSTEMU`, karta KONTO ALLEGRO.

1. Na <https://developer.allegro.pl> (konto sprzedawcy firmy) utwórz aplikację typu **„urządzenie”**.
2. Zaznacz uprawnienia z tabeli niżej.
3. Kliknij **„Wygeneruj nagłówek User-Agent”** — bez niego Allegro grozi blokadą klucza.
4. Wpisz `ALLEGRO_CLIENT_ID`, `ALLEGRO_CLIENT_SECRET` i `ALLEGRO_USER_AGENT` w panelu albo w `wertis.env`.
5. Zrestartuj `wertis-api`.
6. Na karcie KONTO ALLEGRO kliknij „Połącz z Allegro" (rola **admin**).
7. Otwórz pokazany link na zalogowanym koncie sprzedawcy i potwierdź kod.

| uprawnienie | do czego |
|---|---|
| `allegro:api:orders:read` | zamówienia (wymagane) |
| `allegro:api:orders:write` | wniosek o rabat transakcyjny przy zwrocie |
| `allegro:api:payments:read` | potwierdzenie wypłaty zwrotu |
| `allegro:api:payments:write` | przycisk ODDAJ PIENIĄDZE |
| `allegro:api:messaging` | skrzynka i załączniki |
| `allegro:api:disputes` | dyskusje i reklamacje |
| `allegro:api:sale:offers:read` | oferty, „Pasuje do” |

Token odświeża się sam i wygasa po ~3 miesiącach nieużywania. **Token nie
rozszerza się o nowe uprawnienie** — po jego dodaniu sparuj konto ponownie.
Brak uprawnienia daje odmowę z jego nazwą. Restart w trakcie parowania zjada
sesję; kliknij POŁĄCZ jeszcze raz. Sandbox: rejestracja na
<https://developer.allegro.pl.allegrosandbox.pl> i `ALLEGRO_SANDBOX=1`; token
nie przeżywa zmiany środowiska. Odpowiedź **429** wydłuża odstęp pętli tła.

#### Gdy Allegro pokaże stronę „Zostałeś zablokowany"

1. Kliknij PRZERWIJ albo zamknij zakładkę panelu.
2. Odczekaj kilkanaście minut. Ponawianie w kółko przedłuża blokadę.
3. Uzupełnij `ALLEGRO_USER_AGENT` i zrestartuj `wertis-api`.
4. Sparuj ponownie, ale link potwierdzenia otwórz z telefonu po danych komórkowych.
5. Nie otwieraj linku przez pulpit zdalny na serwerze.
6. Gdy blokada wraca, użyj formularza „wyślij nam wiadomość" z tej strony.

Adres serwera: `Invoke-RestMethod https://api.ipify.org` w PowerShellu. Adres
biura: <https://ifconfig.me>. Ten sam adres w obu miejscach znaczy wspólne
łącze — link zawsze otwieraj wtedy z telefonu.

**Progi i odnośniki** (panel albo `wertis.env`):

- `ALLEGRO_INBOX_OD`, `ALLEGRO_ZWROTY_OD` — od kiedy skrzynka i zwroty są
  w bazie. Starsze dane znikają przy starcie; granica skrzynki działa na wątek.
- `REKLAMACJE_OD` — próg WIDOKU reklamacji i dyskusji; pusty wyłącza próg.
- `ALLEGRO_PANEL_ZAMOWIENIE`, `_OFERTA`, `_ZWROT`, `_REKLAMACJA` — wzorce
  odnośników do panelu sprzedawcy. Odnośnik w 404 poprawia się wzorcem.
- `ALLEGRO_SELLER_ID` — zmienia się tylko przy innym koncie (`sellerId=`
  w adresie Centrum Sprzedaży).
- `ALLEGRO_WATKI_BETA=0` wyłącza odczyt typu wątku z `beta.v1`.
- `ALLEGRO_DOSYLKI_SYNC_MS=0` wyłącza śledzenie dosyłek.
- `ALLEGRO_ZWROTY_DNI_WSTECZ` zatrzymuje start z komunikatem — usuń wpis.

**Sondy**, na serwerze, bo biorą token z bazy: `npm --prefix server run sonda`
zapisuje kształt odpowiedzi Allegro, a `npm --prefix server run
sonda:zalacznik` pokazuje drogę pobrania załącznika.

### Do sprawdzenia na własnej bazie i koncie ([WERYFIKUJ])

1. **Kolumny przesunięcia MM:** magazyn docelowy w `dok_OdbiorcaId`, pozycje
   na `ob_DokMagId`. Pomyłka daje puste kosze, a `/api/health` o tym mówi.
2. **`MAG_ID_ZWROTY`** musi wskazywać magazyn, na który biuro wystawia
   MM ZWROTY. Zły daje pustą listę przyjęć.
3. **Numer obcy** (`MSSQL_SPRZEDAZ_NR_ORYG_COLUMN`, domyślnie
   `dok_NrPelnyOryg`, 30 znaków). Dopasowanie uznaje początek uciętego
   identyfikatora. UUID zamówienia wchodzi też z `dok_Uwagi` (Sellasist).
4. **Uprawnienia tokena** — tabela wyżej.

```sql
SELECT TOP 20 dok_NrPelny, dok_NrPelnyOryg, dok_Uwagi
FROM dok__Dokument WHERE dok_Typ IN (2,21) ORDER BY dok_Id DESC;
```

## 6c. Środowisko dev obok produkcji

Instancja dev stoi na TEJ SAMEJ maszynie: własny katalog, port, usługi, baza
i dane demo. Z produkcją dzieli wyłącznie procesor i dysk.

```powershell
.\wertis-instalator.ps1 -Dev -Katalog C:\wertis-dev -Port 3002
.\wertis-instalator.ps1 -Aktualizuj -Dev -Katalog C:\wertis-dev -Port 3002 [-Galaz <gałąź>]
```

Przełącznik `-Dev` robi cztery rzeczy i każda jest bezpiecznikiem:

1. **Usługi z sufiksem** `wertis-api-dev` i `wertis-worker-dev`.
2. **Własna reguła zapory** z portem w nazwie.
3. **Wymuszone dane demo**: `SGT_MODE=seeded`, seed towarów i scenariusze S1–S71.
4. **Pusty kanał APK**: dev nie proponuje kolektorom żadnej aktualizacji.

Bramka odmawia `-Dev` na porcie 3001 i w katalogu `C:\wertis`. Instancja dev
aktualizuje się też sama (§0b). `-Galaz` pozwala jej chodzić z gałęzi roboczej.

**Urządzenie testowe** wskazuje na stałe `http://<IP-serwera>:3002` i pokazuje
czerwoną pastylkę **DEV**; panel pod `:3002/obsluga` ma czerwoną pigułkę
w nagłówku. Buildy testowe wgrywa się przez `adb install` albo plikiem
w `C:\wertis-dev\server\data\apk\`.

> ⚠️ **NIE przełączaj kolektorów produkcyjnych na adres dev.** Testowy APK się
> zainstaluje, a powrotu do niższego numeru Android odmówi. Naprawa kosztuje
> odinstalowanie i bufor offline.

- **Bazy dev nie wolno podłożyć produkcji** — migracje są jednokierunkowe.
- `http://localhost:3002/api/health` → `srodowisko: "dev"`, `mode: "seeded"`.
  Produkcja mówi `produkcja` i `mssql`.
- `npm run dev` w katalogu instancji uruchamia API, worker i panel
  z przeładowaniem przy zmianie pliku.

## 6d. Masowa zmiana lokalizacji z arkusza

Przestawienie całego regału naraz, **wyłącznie administrator**, w `/obsluga →
STAN SYSTEMU`. Zapis idzie zwykłym zadaniem `set_location`.

1. W Subiekcie wyeksportuj kartoteki regału z kolumnami **Symbol** i **Lokalizacja**.
2. Popraw adresy i zapisz plik jako **.xlsx** albo **.csv**.
3. Kliknij **Wgraj arkusz** i przejrzyj podgląd BYŁO → BĘDZIE.
4. W kolumnie ZDJĄĆ OBECNE odznacz adresy, które mają zostać.
5. Kliknij **ZASTOSUJ** — kolejka dostaje jedno zadanie na kartotekę.

Adres ma format `A01-02-03` albo `PAL-042`; wiersz z błędnym kodem odpada
w całości. Pusta komórka **nie kasuje** lokalizacji. Naraz wolno wgrać **2000
wierszy**, a kolejka robi jedno zadanie na sekundę. Cofnięcia jednym
kliknięciem nie ma — zachowaj eksport sprzed zmiany.

## 6e. Czytnik kodów przy zwrotach

Skan etykiety kurierskiej otwiera zwrot w panelu. Czytnik ma być
**klawiaturowy (wedge) i kończyć kod Enterem** albo Tabem. Skanuje się prosto
w ekran kolejki zwrotów, bez klikania w pole. Skan szuka po numerze zwrotu,
identyfikatorze Allegro i numerze listu (`zwrot_klienta.waybill`). Nieznany kod
dostaje przycisk „Poszukaj w Allegro" (konto sparowane, §6b). Numeru listu nie
ma w dzienniku, w logu żądań ani w eksporcie CSV.

## 6f. Czyszczenie zwrotów i pobranie od nowa

Gdy decyzje biura po testach są nie do uratowania pojedynczo:

```bash
cd /c/wertis
npm --prefix server run zwroty:reset               # RAPORT, nic nie kasuje
npm --prefix server run zwroty:reset -- --wykonaj  # kasuje i pobiera od nowa
```

**Zwroty własne (nieodebrane paczki) NIE WRÓCĄ.** **Zwrot z oddanymi
pieniędzmi zatrzymuje całość**; świadome skasowanie wymaga `--mimo-pieniedzy`.
Decyzje biura wracają PUSTE. Zostają powiązania oferta–kartoteka, zamknięte
koszyki z zadaniami `mm` i dziennik. Pobranie startuje od `ALLEGRO_ZWROTY_OD`;
`--bez-pobrania` zostawia je taktowi.

## 6f-bis. Kasowanie zwrotów rozliczonych poza aplikacją

Zwrot załatwiony w Allegro bez jednego naszego śladu znika z bazy, decyzją
właściciela:

```bash
cd /c/wertis
npm --prefix server run zwroty:sprzatnij               # RAPORT, nic nie kasuje
npm --prefix server run zwroty:sprzatnij -- --wykonaj  # kasuje
```

Kasowany jest zwrot `FINISHED` albo `FINISHED_APT` bez zwrotu płatności,
notatki o przelewie, numeru korekty i pozycji w koszyku. Każdy ślad zatrzymuje
kasowanie, a raport liczy, ile spraw trzyma który. Kursor synchronizacji
zostaje, więc zwrot wraca tylko przyciskiem „Poszukaj w Allegro".

## 6g. Kolejność przy zwrotach: korekta, potem MM

MM koszyka zdejmuje towar z **magazynu głównego**, a towar ze zwrotu trafia
tam dopiero z korektą. Kolejność jest więc wymuszona:

1. Operator ocenia pozycje „na stan" — koszyk się napełnia.
2. **Zamknięcie koszyka jest natychmiastowe** — kosz jedzie na halę.
3. MM czeka, aż **każdy** zwrot w koszyku dostanie numer korekty.
4. Ostatni numer wypuszcza MM **natychmiast**.

Brakujące korekty widać w kubełku DO KOREKTY. Koszyk stojący ponad dobę trafia
do rekoncyliacji jako `kosz_czeka_na_korekte`. **Numer korekty czyta automat**
po kolumnie `dok_DoDokId`, ale dopiero przy ustalonej kwocie. Pole „numer
korekty" w panelu zostaje dla przypadków bez pewności. Kolumnę i typy
przestawiają `MSSQL_KOREKTA_COLUMN` i `DOK_TYPY_KOREKT` (domyślnie `6,14`).

**ODDAJ PIENIĄDZE i wniosek o rabat** ruszają pieniądze klienta bez pytania.
Pierwszy raz użyj ich na JEDNYM zamówieniu i sprawdź wynik w panelu Allegro.
Końcówka rabatu nie ma idempotencji. Zwrotu opłaconego ręcznie w Sales Center
nie oddawaj drugi raz przyciskiem.

### Automatyczny ZW do paragonu

Funkcja jest wyłączona. ZW to dokument fiskalny, więc włączaj po kolei:

1. Popraw konto usługi `wertis-sfera` (§3) i sprawdź, że MM z kolejki przechodzą.
2. Sprawdź w `CHANGELOG.md`, że wgrane exe workera Sfery zna zadanie `zw`.
3. Ustal numer kartoteki przesyłki zapytaniem niżej.
4. Dopisz `SFERA_ZW=1` i `TW_ID_PRZESYLKA=<numer>`, potem zrestartuj usługi.
5. Pierwszy zwrot do paragonu zapisz przy właścicielu.
6. Sprawdź w Subiekcie rodzaj „zwrot ze sprzedaży”, wyzerowane pozycje i przelew.

```sql
SELECT tw_Id FROM tw__Towar WHERE tw_Symbol = 'PRZESYŁKA';
```

Kategorię ZW ustawia `SFERA_ZW_WYDANIE_KAT_ID` (0 = domyślna). Powiedz biuru:
ZW wystawia automat po zapisaniu kwoty, a przy „Automat nie wystawił ZW”
wystawia się go ręcznie. Zwroty do faktur zostają ręczne.

## 6h. Ceny z kartoteki Subiekta

Karta towaru pokazuje ceny z cennika kartoteki. Uprawnienia nadaje instalator,
a jego ponowny przebieg dokłada brakujące. Ręcznie, w SSMS:

```sql
GRANT SELECT ON dbo.tw_Cena      TO wertis;   -- cennik kartoteki
GRANT SELECT ON dbo.vwPoziomyCen TO wertis;   -- nazwy poziomów cen
```

Drugą linię pomiń, gdy `SELECT OBJECT_ID('dbo.vwPoziomyCen')` zwraca NULL.
Bez uprawnień objaw na karcie jest NIEMY, a `/api/health` mówi w `problemy`,
czego brakuje. Licznik `ceny` w `lastImport` podaje wiersze po rozwinięciu
poziomów. Poziomy z nazwami pokazuje `tools/sonda-cen.sql`.

## 6i. Copilot i automaty wiedzy

Copilot układa szkice odpowiedzi i rozpoznaje wiadomości. **Kosztuje
pieniądze**, a do klienta nie idzie nic bez człowieka. Ustawienia: Ustawienia
→ Obsługa klienta → Copilot. Rachunek i trafność pokazuje karta „Copilot” —
zajrzyj na nią po pierwszej godzinie każdego automatu. Dlaczego tak:
[`docs/architektura.md`](docs/architektura.md) §11.

**Włączenie:** `COPILOT_MODE=anthropic` i `ANTHROPIC_API_KEY`, potem restart
`wertis-api`. **Klucz wpisz WYŁĄCZNIE do `ANTHROPIC_API_KEY`** — w innym polu
potrafi zatrzymać start. Model szkiców zmienia
`COPILOT_MODEL`, model klasyfikacji — `COPILOT_MODEL_KLASYFIKACJA`.
**Rozpoznawanie** wiadomości klientów robi ten sam Claude i ten sam klucz.
Wpisy `KLASYFIKATOR_DOSTAWCA`, `TYPESAFE_API_KEY` i `JEV_MODEL`, jeśli stoją
w `wertis.env`, niczego już nie robią. Serwer wstaje z nimi i ostrzega, że
można je usunąć.

| klucz | co włącza | hamulce |
|---|---|---|
| `COPILOT_MAX_PARTIA` | — | rozmów na jedno kliknięcie agenta |
| `COPILOT_AUTO_KLASYFIKACJA=1` | rozpoznanie każdej nowej wiadomości | `COPILOT_AUTO_KLASYFIKACJA_NA_PRZEBIEG`, `_NA_GODZINE`, `COPILOT_KLASYFIKACJA_OKNO_DNI` |
| `COPILOT_AUTO_SZKIC=1` | szkic sam dla nowego pytania | `COPILOT_AUTO_NA_PRZEBIEG`, `COPILOT_AUTO_NA_GODZINE` |
| `COPILOT_SZKIC_PO_ROZPOZNANIU` | szkic zaraz po rozpoznaniu (`0` wyłącza) | wspólny `COPILOT_AUTO_NA_GODZINE` |
| `COPILOT_PRZED_PRACA=1` | szkice zaległości przed biurem | `COPILOT_PRZED_PRACA_OKNO`, `COPILOT_PRZED_PRACA_LIMIT` |
| `WIEDZA_AUTOMAT=1` | automat zatwierdza wiedzę z kolejki | `WIEDZA_AUTOMAT_NA_PRZEBIEG` |
| `WIEDZA_AUTOMAT_MODEL=1` | model językowy jako źródło marki | ten sam |
| `PASOWANIE_Z_SIECI=1` | nocne szukanie pasowania w sieci poza Allegro | `PASOWANIE_Z_SIECI_NA_NOC` |

Sufity godzinowe liczy się **razem z błędami**, bo nieudane wywołanie też
kosztuje. Nie podnoś limitów przed przejrzeniem pierwszych wyników.
**`WIEDZA_AUTOMAT` odwraca zasadę**, że wiedzę zatwierdza człowiek — przejrzyj
kartę „Co automat dopisał do wiedzy" po pierwszym przebiegu.

**Dane u dostawcy.** Tekst wychodzi przez maskowanie telefonu i adresu.
**Zdjęć zamaskować się nie da** — idą w całości, najwyżej cztery najnowsze
przychodzące ze statusem `SAFE`. Pytanie agenta do Copilota nie przechodzi
przez maskowanie, więc nie pisze się w nim danych klienta. Polityka:
[`docs/obsluga-klienta.md`](docs/obsluga-klienta.md).

## 7. Backup i utrzymanie

### Kopia bazy aplikacji

`wertis-api` sam zapisuje kopie do `server\data\kopie\`:

| plik | kiedy | ile zostaje |
|---|---|---|
| `przed-<czas>-<stara>-do-<nowa>.db` | pierwszy start nowej wersji, PRZED migracją | 5 |
| `noc-<data>.db` | raz na noc, między 1:00 a 5:00 czasu magazynu | 14 |

Kopia to migawka `VACUUM INTO` sprawdzona `PRAGMA quick_check`; zwykłe `cp`
pliku w trybie WAL gubi ostatnie zapisy. **Kopie na inny dysk:**
`KOPIE_KATALOG=D:\kopie-wertis`, potem restart usług. `/api/health` ma blok
`kopie` i przy `SGT_MODE=mssql` zgłasza nocną kopię starszą niż dwie doby.
Dziennik biura ma wpis `kopia_bazy` z każdej nocy.

**Przywrócenie** — przy zatrzymanych usługach, w PowerShellu:

```powershell
cd C:\wertis\server\data
Rename-Item wertis.db wertis-uszkodzona.db
Remove-Item wertis.db-wal, wertis.db-shm -ErrorAction SilentlyContinue
Copy-Item kopie\noc-2026-09-24.db wertis.db
```

Pliki `-wal` i `-shm` MUSZĄ zniknąć, bo SQLite nałożyłby je na przywróconą
bazę. **Bazy Subiekta serwer NIE kopiuje** — robi się ją archiwizacją InsERT
GT albo backupem SQL Servera.

**Cofnięcie zapisu lokalizacji.** Ślad audytowy trzyma **starą i nową**
zawartość pola oraz ekran, z którego zmiana wyszła. Wartość „przed" wpisuje
się z powrotem ręcznie, a przy wielu kartotekach — z kopii bazy Subiekta:

```bash
curl -s -H "x-session: $TOKEN" \
  'http://localhost:3001/api/events?twId=507&typ=location_set,location_removed' | jq
```

**Zdjęcia dowodowe** (`C:\wertis\server\data\photos\`) to jedyne dane, których
nie da się odtworzyć z Subiekta. Kopiuj je razem z bazą:

```bash
cp -r /c/wertis/server/data/photos "/d/backup/photos-$(date +%Y%m%d)"
```

### Pamięć serwera

`/api/health` ma blok `pamiec`: pamięć procesu, zajętą stertę i jej limit.
Serwer zapisuje też próbkę co godzinę w logu usługi. Oś czasu daje:

```powershell
Select-String -Path C:\wertis\logs\wertis-api.log -Pattern "\[pamiec\]" | Select-Object -Last 24
```

Pojedynczy odczyt niczego nie dowodzi, bo sterta falowała przy każdym
odświeżeniu danych z Subiekta. Liczy się trend dna w `pamiec.trend`: o ile
najniższy odczyt młodszej połowy okna leży wyżej niż starszej. `rosnie: true`
znaczy wzrost dna o co najmniej 100 MB i co najmniej 10 MB na godzinę.
Trend pojawia się po sześciu godzinach pracy. Restart usługi zaczyna okno od
nowa. Trend jest daną, nie alarmem: nie wchodzi do `problemy` i nie
cofa aktualizacji.

### Kopia bazy bez danych osobowych

`anonimizuj-baze.mjs` robi z kopii bazy plik bez danych klientów i pracowników,
z zachowanym kształtem danych. Służy do oceny ekranów na prawdziwym wolumenie.

1. Weź najnowszą kopię `noc-RRRR-MM-DD.db` z `server\data\kopie` albo z `KOPIE_KATALOG`.
2. Nie wskazuj `wertis.db`: narzędzie odmawia żywej bazy i plików z niepustym `-wal`.
3. Uruchom polecenie niżej z nazwą własnej kopii i poczekaj na wiersz „Gotowe”.
4. Wyślij wyłącznie `wertis-anonim.db` i ewentualnie `wertis-anonim.db.kolumny.txt`.

```powershell
cd C:\wertis
New-Item -ItemType Directory -Force C:\anonim | Out-Null
.\node\node.exe narzedzia\anonimizuj-baze.mjs server\data\kopie\noc-2026-09-29.db C:\anonim\wertis-anonim.db
```

Instalacja z klonu repo używa `node` z PATH i `tools\anonimizuj-baze.mjs`.
**Kod wyjścia 2** i „Skaner znalazł” znaczą ślad danych osobowych w wyniku —
pliku nie ma, nic nie wysyłaj i zgłoś wypisane kolumny. Pełna kopia pracuje
w `%TEMP%\wertis-anonim-…`; po przerwanym przebiegu usuń ten folder.
Potrzebujesz miejsca na dwie kopie bazy w `%TEMP%`.

**Znika:** loginy Allegro, nazwiska, adresy, telefony, e-maile, treści
wiadomości, notatki, szkice, tokeny, sesje i skróty haseł; obrazy stają się
białym kwadratem. **Zostaje:** kartoteka, dokumenty Subiekta, statusy, czasy,
kwoty i identyfikatory Allegro. Jeśli kartoteka jest tajemnicą handlową, nie
wysyłaj pliku. Skaner nie widzi wartości krótszych niż 4 znaki ani imion
w wolnym tekście, a nazwy dostawców zostają.

### Rekoncyliacja i raporty

**Nocna rekoncyliacja chodzi sama**, w oknie nocnej kopii. Sprawdza adres
w Subiekcie kontra ostatni udany zapis, zadania w `error` starsze niż doba,
`waiting_for_doc` starsze niż trzy dni oraz kosze zwrotów. **Zerowy wynik nie
tworzy pliku.** Rozjazdy dają CSV w `reconcile/` obok bazy i zdanie
w `problemy`, a skrypt ręczny kończy się **kodem 2**. Podgląd:
`GET /api/reconcile`.

```bash
cd /c/wertis && npm run reconcile     # ręcznie, bez czekania do nocy
cd /c/wertis && npm run reslot        # przeslotowanie, 1–2× w roku przed sezonem
cd /c/wertis && npm --prefix server run zwroty:cykl -- --dni 30   # cykl zwrotu; --csv do pliku
```

**Raport przeslotowania** czyta Subiekta **wyłącznie do odczytu** i liczy
**pion, nie odległość**. Daje CSV z czterema listami: najpierw eksmisja
martwych indeksów ze strefy złotej, potem awanse. Bez historii pobrań
**odmawia list 1–3** — sprawdź wtedy `dok_Typ` dokumentów WZ i zakres dat.
Poziomy strefy złotej stoją w `server/src/services/strefa-zlota.ts`.

**Raport cyklu zwrotu** podaje mediany siedmiu odcinków życia kartonu i przy
każdym, czyja to praca. Niczego nie zapisuje.

### Aktualizacja do nowej wersji

Aktualizacja idzie sama albo przyciskiem (§0b). Z wiersza poleceń, **jako
administrator**:

```powershell
cd C:\wertis\instalator
# instalacja z paczki wydania:
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj -Paczka najnowsza
# instalacja z Gita:
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj
```

**Nie zadaje pytań** i nie dotyka bazy, konta SQL, GRANT-ów, `wertis.env`,
Subiekta ani kont. `-DryRun` daje podgląd. Aktualizowany jest katalog
z `-Katalog` (domyślnie `C:\wertis`), a nie ten ze skryptem. Bez
`-ExecutionPolicy Bypass` Windows odmawia: `running scripts is disabled on
this system`. Na instalacji z Gita nieudany `git pull` przywraca usługi, a
nieudane budowanie zostawia je zatrzymane. Ręczne `git pull; npm ci; npm run
build` to zejście awaryjne bez tych zabezpieczeń.

**Wycofanie aktualizacji.** Instalator nie wgra paczki starszej niż obecna
wersja. Poprzednia wersja zostaje w `C:\wertis.poprzednia`, a baza sprzed
migracji w `server\data\kopie\przed-*-do-<wersja>.db` (przywrócenie wyżej).

### Gdy coś nie działa

**Diagnoza:** `/api/health` → `problemy`. Dzienniki: `C:\wertis\logs\`
(rotacja NSSM). Historia zadań: tabela `sfera_queue` w `wertis.db`. Błąd
zapisu widać też na kolektorze (czerwona pastylka + PONÓW).

**Usługa w stanie `SERVICE_PAUSED`.** Proces zakończył się szybciej niż próg
`AppThrottle` (1,5 s), więc NSSM przestał go podnosić. **Najpierw zatrzymaj
usługi** — każdy obieg pętli dopisuje komunikat do dziennika, czasem
z sekretem. Potem uruchom serwer z pominięciem NSSM:

```powershell
nssm stop wertis-worker ; nssm stop wertis-api
cd C:\wertis
node server\dist\index.js
```

Przyczyna stoi na ekranie i w `C:\wertis\logs\wertis-api.err.log`. „database
is locked" w logu workera to zwykle skutek pętli restartów API. Gdy API
odpowie na `/api/health`, zatrzymaj je Ctrl-C i uruchom usługi.

**Schemat bazy ma jednego właściciela: `wertis-api`.** Worker uruchomiony
przed API nie pada, tylko CZEKA z jednym zdaniem:

```
[worker] czekam — w bazie nie ma tabeli sfera_queue. Schemat zakłada serwer
API (wertis-api); worker podejmie pracę sam, gdy tabela się pojawi.
```

Po migracji worker wraca sam (`[worker] schemat gotowy`). Awarią jest zdanie,
które stoi dłużej niż start API — przyczyny szukaj w logu `wertis-api`.

**„Tryb seeded, chociaż w `wertis.env` stoi `mssql`".** Plik przykryła zmienna
środowiskowa usługi; `/api/health` wypisuje takie klucze w `configPrzykryte`.
Wyczyść je przez `nssm reset <usługa> <ustawienie>` dla obu usług i zrestartuj
je. `Extra` dokłada zmienne, a `AppEnvironment` zastępuje całe środowisko.

```powershell
nssm get wertis-api AppEnvironment ; nssm get wertis-api AppEnvironmentExtra
```

## 8. Odinstalowanie

Jedno polecenie, uruchomione **jako administrator**. `-ExecutionPolicy Bypass`
dotyczy tego jednego uruchomienia; przy instalacji tę samą osłonę daje
`URUCHOM.cmd`.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -DryRun    # sam plan
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -UsunDane  # także dane
```

Zdejmuje usługi `wertis-api`, `wertis-worker` i `wertis-sfera`, regułę zapory
„WERTIS kolektor" oraz katalog `C:\wertis`, po potwierdzeniu. **Dane zostają**
w `C:\wertis-dane-<data>`: baza, ślad audytowy, zdjęcia, raporty i APK.
Historia lokalizacji bywa potrzebna długo po aplikacji. `-UsunDane` wymaga
drugiego potwierdzenia.

**Nie uruchamiaj instalatora z wnętrza kasowanego katalogu** — Windows nie
usunie katalogu, w którym stoi powłoka. Wynieś go i uruchom z `C:\`:

```powershell
cd C:\
Copy-Item C:\wertis\instalator C:\wertis-instalator -Recurse
powershell -NoProfile -ExecutionPolicy Bypass `
    -File C:\wertis-instalator\wertis-instalator.ps1 -Odinstaluj -Katalog C:\wertis
```

**Gdy katalog zostaje**, instalator wypisze, co go trzyma. Procesy z plikiem
wewnątrz `C:\wertis` zatrzymuje sam; resztę ubij i powtórz:

```powershell
Get-Process | Where-Object { $_.Path -like 'C:\wertis\*' } | Select-Object Id, ProcessName, Path
Stop-Process -Id <numer> -Force
```

Pusta lista znaczy okno Eksploratora, edytor albo drugą powłokę. Znajdziesz
je w `resmon` → **CPU** → **Skojarzone dojścia**, szukając `wertis`.

### Czego deinstalacja NIE cofa

| co zostaje | dlaczego | jak usunąć ręcznie |
|---|---|---|
| **wartości w bazie Subiekta** | aplikacja je tam zapisała — to dane firmy | wyłącznie z kopii bazy |
| **login SQL `wertis`** | stoi na poziomie **instancji**, nie bazy podmiotu | `DROP USER` i `DROP LOGIN` (niżej) |
| **ustawienia SQL Servera** | uwierzytelnianie mieszane, TCP i SQL Browser służą też innym | ręcznie, świadomie |
| **Node.js i Git** (instalacja z Gita) | instalator dokłada je systemowo | `winget uninstall` |

**Odinstalowanie aplikacji nie jest cofnięciem jej pracy.** Login usuwa
administrator bazy, w bazie podmiotu, bo pomyłka dotknęłaby całej instancji:

```sql
DROP USER [wertis];
DROP LOGIN [wertis];
```

**Droga ręczna**, gdy skryptu nie ma. Katalog kasuje się **na końcu**, bo leży
w nim `nssm.exe`; bez niego usługę zdejmuje `sc.exe delete wertis-api`.

```powershell
nssm stop wertis-api ; nssm stop wertis-worker
nssm remove wertis-api confirm ; nssm remove wertis-worker confirm
Remove-NetFirewallRule -DisplayName "WERTIS kolektor"
Remove-Item C:\wertis -Recurse -Force
```

## Dlaczego nie chmura

Worker rozmawia ze Sferą przez COM na maszynie z Subiektem, a odczyt idzie
z MSSQL w LAN — chmura nie ma dostępu do żadnego z nich. Kolektory też są
w LAN, więc frontend na zewnątrz dodałby tylko zależność od internetu w hali.
