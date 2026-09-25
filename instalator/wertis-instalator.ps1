<#
.SYNOPSIS
    Instalator WERTIS dla maszyny z Subiektem GT.

.DESCRIPTION
    Robi to, co DEPLOY.md każe zrobić ręcznie: stawia Node i Gita, pobiera
    aplikację, buduje ją, rejestruje dwie usługi Windows, otwiera port dla
    kolektorów, wypełnia konfigurację odpytując bazę Subiekta i zakłada konto
    SQL o minimalnych uprawnieniach.

    Ręczna instrukcja w DEPLOY.md ZOSTAJE i jest referencją tego pliku —
    gdy instalator zawiedzie w połowie, tamta droga nadal działa.

    Uruchamiać jako administrator, w Windows PowerShell (powershell.exe).

.PARAMETER Katalog
    Gdzie ma zamieszkać aplikacja. Domyślnie C:\wertis.

.PARAMETER Port
    Port API. Domyślnie 3001 — ten sam trafia do reguły zapory i do adresu,
    który wpisuje się potem na kolektorze.

.PARAMETER Demo
    Instalacja bez dotykania Subiekta (Etap 0 z DEPLOY.md §6): aplikacja
    rusza na danych demo. Pomija kreator i zakładanie konta SQL.

.PARAMETER TylkoKonfiguracja
    Sam kreator, bez instalowania czegokolwiek — do zmiany ustawień na
    działającej instalacji.

.PARAMETER DryRun
    Przebieg próbny: wypisuje, co by zrobił, i nie zmienia niczego. Nie pyta
    o nic — przyjmuje odpowiedzi domyślne. Tym trybem instalator jest
    sprawdzany w CI.

.PARAMETER Aktualizuj
    SAMA AKTUALIZACJA KODU. Zatrzymuje usługi, pobiera nową wersję, buduje
    i uruchamia z powrotem. NIE dotyka bazy aplikacji, konta SQL, ustawień
    w wertis.env, konfiguracji Subiekta ani kont użytkowników — nie zadaje
    też ani jednego pytania.

.PARAMETER SerwerSql
    Komputer z SQL Serverem Subiekta; domyślnie localhost, bez pytania.

.PARAMETER InstancjaSql
    Instancja SQL Servera. Bez parametru instalator bierze INSERTGT albo
    jedyną instancję z rejestru, a pyta tylko przy kilku.

.PARAMETER Paczka
    Tylko z -Aktualizuj (0.492.0): aktualizacja z PACZKI WYDANIA zamiast
    budowania na tej maszynie. Wartość to numer wersji (0.492.0), słowo
    „najnowsza" albo ścieżka pobranego ZIP-a z plikiem .sha256 obok. Paczka
    rozpakowuje się obok działającej wersji, a nieudany start nowej wraca
    na starą razem z bazą. Tak aktualizuje przycisk w panelu.

.PARAMETER PlikPostepu
    Tylko z -Paczka (@wydanie): plik JSON, do którego instalator zapisuje
    bieżący krok aktualizacji. Podaje go `zlecenie.ps1`, a karta w panelu
    rysuje z niego pasek postępu. Bez parametru nic się nie zapisuje.

.PARAMETER Dev
    Druga, ROZWOJOWA instancja obok produkcji: usługi z sufiksem -dev, dane
    demo, pusty kanał APK (dev niczego kolektorom nie proponuje) i etykieta
    SRODOWISKO=dev widoczna w biurze i na kolektorze. Wymaga -Katalog innego
    niż C:\wertis i -Port innego niż 3001. Produkcji nie dotyka.

.PARAMETER Odinstaluj
    Zdejmuje usługi, regułę zapory i katalog aplikacji. NIE rusza Subiekta,
    loginu SQL, rejestru ani Node'a z Gitem — pełna lista na końcu przebiegu.

.PARAMETER UsunDane
    Tylko z -Odinstaluj: kasuje też ślad audytowy i zdjęcia problemów.
    Bez tego przełącznika `server\data` zostaje przeniesiony obok katalogu.

.PARAMETER ZdjeciaZapis
    Pozwala magazynierowi DODAĆ zdjęcie kartoteki z kolektora — prosto do
    Subiekta. Wymaga `GRANT INSERT` na tabelę zdjęć i dlatego jest osobnym
    przełącznikiem: to jedyne miejsce, w którym aplikacja dopisuje wiersz do
    bazy firmy. Bez niego zdjęć z kolektora nie da się dodać w ogóle.

.EXAMPLE
    .\wertis-instalator.ps1
    Pełna instalacja z kreatorem.

.EXAMPLE
    .\wertis-instalator.ps1 -Demo
    Instalacja pilotażowa: działa od razu, Subiekt nietknięty.

.EXAMPLE
    .\wertis-instalator.ps1 -Aktualizuj
    Wgrywa nową wersję na działającą instalację. Baza i konta nietknięte.

.EXAMPLE
    .\wertis-instalator.ps1 -Dev -Katalog C:\wertis-dev -Port 3002
    Środowisko dev obok produkcji: dane demo, własne usługi, własny port.

.EXAMPLE
    .\wertis-instalator.ps1 -Odinstaluj -DryRun
    Wypisuje, co zniknęłoby przy deinstalacji. Niczego nie usuwa.
#>
[CmdletBinding()]
param(
    [string]$Katalog = "C:\wertis",
    [string]$Repo = "https://github.com/MateuszPuchalski/mag-asystent.git",
    [string]$Galaz = "main",
    [int]$Port = 3001,
    [switch]$Demo,
    [switch]$Dev,
    [switch]$TylkoKonfiguracja,
    [switch]$DryRun,
    [switch]$Odinstaluj,
    [switch]$UsunDane,
    [switch]$Aktualizuj,
    [string]$Paczka,
    [string]$PlikPostepu,
    [switch]$ZdjeciaZapis,
    [string]$SerwerSql = "localhost",
    [string]$InstancjaSql
)

$ErrorActionPreference = "Stop"

# MODULY-POCZATEK
# Przy uruchamianiu z repo moduły dochodzą stąd. `instalator/build.ps1` wstawia
# w to miejsce ich treść i produkuje JEDEN plik — bo ps2exe pakuje dokładnie
# jeden skrypt, a skompilowany .exe nie ma obok siebie katalogu instalator/.
# Znaczników nie ruszać: build.ps1 podmienia dokładnie ten blok.
$katalogSkryptu = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $katalogSkryptu "ui.ps1")
. (Join-Path $katalogSkryptu "sql.ps1")
. (Join-Path $katalogSkryptu "uslugi.ps1")
. (Join-Path $katalogSkryptu "paczka.ps1")
# MODULY-KONIEC

$script:WertisDryRun = [bool]$DryRun
$script:WertisPlikPostepu = $PlikPostepu

# ── Instancja: produkcja albo dev (0.69.0) ──────────────────────────────────
# Nazwy usług i reguły zapory idą z jednego miejsca. Bramka odmawia od razu,
# bo -Dev z domyślnym portem/katalogiem ROZSTROIŁBY produkcję — dokładnie
# temu ten przełącznik ma zapobiegać.
$instancja = Get-WertisInstancja -Dev:$Dev -Port $Port -Katalog $Katalog
if (@($instancja.Bledy).Count -gt 0) {
    foreach ($b in $instancja.Bledy) { Write-Blad $b }
    exit 1
}
# Dev znaczy dane demo: rozwój nie ma prawa pisać do Subiekta ani czytać
# produkcyjnej bazy. Kto chce inaczej, stawia instancję ręcznie wg DEPLOY.md.
if ($Dev) { $Demo = $true }

# Ustawienia zbierane po drodze; na końcu idą w dwa miejsca naraz
# (wertis.env + środowisko obu usług) przez Publish-WertisKonfiguracja.
$ustawienia = @{ SGT_MODE = "seeded" }
# Konto SQL zostało do założenia przez administratora bazy (furtka z etapu 4).
$kontoCzeka = $false

Write-Naglowek "WERTIS - instalator"
if ($DryRun) {
    Write-Uwaga "PRZEBIEG PROBNY: nic nie zostanie zmienione, pytania mają odpowiedzi domyślne."
}

# ── Uprawnienia ─────────────────────────────────────────────────────────────
# Sprawdzane od razu, a nie przy pierwszej usłudze: instalator, który przerwie
# po pobraniu 200 MB zależności, jest gorszy od takiego, który odmówi na starcie.
if (-not (Test-Administrator)) {
    if ($DryRun) {
        Write-Proba "Bez uprawnień administratora - w prawdziwym przebiegu tutaj byłby koniec."
    } else {
        Write-Blad "Instalator wymaga uprawnień administratora."
        Write-Info "Kliknij prawym na PowerShell i wybierz 'Uruchom jako administrator'."
        exit 1
    }
}

# ═══ DEINSTALACJA ════════════════════════════════════════════════════════════
# Osobna gałąź kończąca się `exit 0`: usuwanie nie ma nic wspólnego z żadnym
# etapem instalacji i nie wolno mu się z nimi przepleść.

if ($Odinstaluj) {
    Write-Krok "Deinstalacja WERTIS$(if ($Dev) { ' (instancja dev)' })"
    Write-Info "Zniknie: usługi $($instancja.Uslugi -join ', '),"
    Write-Info "reguła zapory '$($instancja.Zapora)' oraz katalog $Katalog."
    Write-Host ""
    if ($UsunDane) {
        Write-Uwaga "-UsunDane: ślad audytowy i zdjęcia problemów zostaną SKASOWANE."
        Write-Uwaga "Historii zmian lokalizacji nie da się wtedy odtworzyć."
    } else {
        Write-Info "Dane (ślad audytowy, zdjęcia) zostaną przeniesione OBOK katalogu."
    }
    Write-Host ""

    # Powłoka stojąca w kasowanym katalogu blokuje go tak samo jak działający
    # proces, a Windows mówi wtedy tylko „jakiś proces używa". Ostrzeżenie idzie
    # PRZED pytaniem o zgodę: po zgodzie człowiek potwierdziłby deinstalację,
    # która i tak nie doszłaby do końca. Nie przerywamy — powłoka bywa
    # w podkatalogu, który zniknie bez oporu.
    if (Test-SciezkaWewnatrz -Sciezka (Get-Location).Path -Katalog $Katalog) {
        Write-Uwaga "Stoisz w kasowanym katalogu ($((Get-Location).Path))."
        Write-Info "Windows nie pozwoli usunąć katalogu, w którym stoi powłoka."
        Write-Info "Wyjdź poza niego i uruchom instalator z kopii spoza $Katalog"
        Write-Info "  cd C:\"
        Write-Host ""
    }

    # W przebiegu próbnym nie pytamy o zgodę — nic się nie dzieje, a Read-Tak
    # zwróciłby wtedy domyślne „nie" i -DryRun nie pokazałby ani jednego kroku.
    $zgoda = if ($DryRun) { $true } else { Read-Tak "Na pewno odinstalować WERTIS?" -Domyslnie $false }
    if (-not $zgoda) {
        Write-Info "Przerwane. Nic nie zostało usunięte."
        exit 0
    }
    if ($UsunDane -and -not $DryRun) {
        if (-not (Read-Tak "Skasować także ślad audytowy, bezpowrotnie?" -Domyslnie $false)) {
            Write-Info "Przerwane. Nic nie zostało usunięte."
            exit 0
        }
    }

    # Kolejność wymuszona przez Windows — patrz komentarz nad funkcjami
    # w uslugi.ps1. nssm.exe leży w kasowanym katalogu, więc idzie przed nim.
    Remove-WertisUslugi -Nssm (Join-Path $Katalog "tools\nssm.exe") -Uslugi $instancja.Uslugi
    Remove-WertisRegulaZapory -Nazwa $instancja.Zapora
    $plan = Remove-WertisKatalog -Katalog $Katalog -UsunDane:$UsunDane

    Write-Naglowek "Odinstalowane"
    if ($plan -and $plan.DaneDo) {
        Write-Ok "Ślad audytowy i zdjęcia leżą w: $($plan.DaneDo)"
    }

    # To jest połowa wartości tego trybu. Deinstalacja aplikacji NIE JEST
    # cofnięciem jej pracy, a człowiek, który tego nie usłyszy, uzna inaczej.
    Write-Host ""
    Write-Host "  Czego to NIE cofa:" -ForegroundColor Cyan
    Write-Uwaga "1. Zapisów w bazie Subiekta. Pole lokalizacji na kartotekach"
    Write-Info "   ZOSTAJE. Odwraca je wyłącznie kopia bazy."
    Write-Uwaga "2. Loginu SQL 'wertis'. Powstał na poziomie INSTANCJI, nie bazy."
    Write-Info "   Usuwa go administrator bazy, w bazie podmiotu:"
    Write-Info "     DROP USER [wertis];"
    Write-Info "     DROP LOGIN [wertis];"
    Write-Uwaga "3. Ustawień SQL Servera. Uwierzytelnianie mieszane, TCP i SQL Browser"
    Write-Info "   zostają. Cofnięcie odcięłoby inne aplikacje, które z nich żyją."
    Write-Uwaga "4. Node.js i Gita - instalator dokłada je systemowo."
    Write-Host ""
    Write-Info "Pełny opis: docs/wdrozenie.md, sekcja 'Jak odinstalować'."
    Write-Host ""
    exit 0
}

# ═══ AKTUALIZACJA ════════════════════════════════════════════════════════════
#
# Osobna gałąź kończąca się `exit 0`, tak samo jak deinstalacja — i z tego
# samego powodu: przeplecenie jej z etapami instalacji jest jedyną drogą do
# tego, żeby aktualizacja ruszyła coś, czego ruszać nie miała.
#
# Pełny przebieg instalatora AKTUALIZUJE kod (git pull wyżej), ale robi przy
# tym jeszcze siedem rzeczy: pyta o Subiekta, przelicza magazyny, sprawdza pole
# lokalizacji, zakłada konto SQL, nadaje GRANT-y, przepisuje wertis.env i pyta
# o konto administratora. Na działającej instalacji to jest siedem okazji do
# zmiany czegoś, co działa — i siedem pytań do człowieka, który chciał tylko
# wgrać nową wersję.
#
# CZEGO TA GAŁĄŹ NIE ROBI, wprost: nie tyka bazy aplikacji, konta SQL ani
# GRANT-ów, `wertis.env`, kont użytkowników, reguły zapory i rejestracji usług
# w NSSM. Wszystko to już istnieje — instalacja, której się nie stawia od nowa,
# nie potrzebuje niczego z tej listy.
#
# W `server\data` rusza JEDNO miejsce i od 0.52.0: katalog `apk`, do którego
# ląduje APK dla kolektorów. Baza i zdjęcia w sąsiednich katalogach zostają
# nietknięte — gdyby ta lista kiedyś urosła, tamto zdanie wyżej przestanie być
# prawdą i trzeba je zmienić razem z kodem.
#
# Usługi stoją przez CAŁY czas budowania, a nie tylko przy podmianie plików.
# `npm ci` kasuje `node_modules`, więc działający worker traciłby moduły
# w locie: objawem byłby proces, który padł „bez powodu" w połowie aktualizacji.

if ($Aktualizuj -and $Paczka) {
    # ── Aktualizacja z paczki wydania (0.492.0) ────────────────────────────
    # Osobna droga, bo nie ma w niej ani `git pull`, ani budowania. Całą pracę
    # i wycofanie robi `Update-WertisZPaczki` (paczka.ps1); tutaj zostaje
    # tylko zadanie Harmonogramu dla przycisku w panelu.
    Write-Naglowek "WERTIS - aktualizacja z paczki"
    if (-not (Test-Path (Join-Path $Katalog "server"))) {
        Write-Blad "W $Katalog nie ma instalacji WERTIS."
        exit 1
    }
    $kod = Update-WertisZPaczki -Katalog $Katalog -Repo $Repo -Paczka $Paczka -Uslugi $instancja.Uslugi -Port $Port
    if ($kod -eq 0) {
        Register-WertisZadanieAktualizacji -Katalog $Katalog -Nazwa "WERTIS aktualizacja$($instancja.Sufiks)"
    }
    exit $kod
}

if ($Aktualizuj) {
    Write-Naglowek "WERTIS - aktualizacja"

    if (-not (Test-Path (Join-Path $Katalog ".git"))) {
        if (Test-Path (Join-Path $Katalog "paczka.json")) {
            # Instalacja z paczki nie ma repozytorium i mieć go nie musi.
            Write-Blad "$Katalog jest instalacją z paczki wydania — nie ma tu repozytorium do git pull."
            Write-Info "Aktualizacja: .\wertis-instalator.ps1 -Aktualizuj -Paczka najnowsza"
            exit 1
        }
        Write-Blad "W $Katalog nie ma repozytorium WERTIS."
        Write-Info "Aktualizacja działa na ISTNIEJĄCEJ instalacji. Do pierwszej instalacji uruchom instalator bez -Aktualizuj."
        exit 1
    }

    $wersjaPrzed = Get-WertisWersja -Katalog $Katalog

    # Ta sama lista co przy starcie — z `Get-WertisInstancja`, nie z pamięci.
    # Pierwsza wersja zatrzymywała dwie usługi, a uruchamiała trzy: `wertis-sfera`
    # przechodziła całą aktualizację na chodzie. Nie jest procesem Node, więc
    # `npm ci` jej nie dotyka — ale pisze do SQLite przez kolejkę zadań MM,
    # a aktualizacja bywa zmianą SCHEMATU tej bazy. Zapis w trakcie migracji to
    # najgorszy moment, jaki można wybrać. Nieobecna usługa (wdrożenie bez Sfery)
    # jest normą i przechodzi bez słowa — dokładnie jak przy restarcie.
    $doZatrzymania = $instancja.Uslugi
    Write-Krok "Zatrzymanie usług"
    if (-not (Test-DryRun "Zatrzymałbym usługi: $($doZatrzymania -join ', ').")) {
        foreach ($u in $doZatrzymania) {
            if ($null -eq (Get-Service -Name $u -ErrorAction SilentlyContinue)) { continue }
            Stop-Service -Name $u -Force -ErrorAction SilentlyContinue
            Write-Ok "Usługa $u zatrzymana."
        }
    }

    Write-Krok "Pobranie nowej wersji"
    if (-not (Test-DryRun "Zaktualizowałbym repozytorium (git pull).")) {
        Push-Location $Katalog
        & git pull --ff-only origin $Galaz
        $kod = $LASTEXITCODE
        Pop-Location
        if ($kod -ne 0) {
            Write-Blad "git pull nie powiódł się (kod $kod)."
            Write-Info "Najczęstsza przyczyna: lokalne zmiany w $Katalog albo rozjazd z gałęzią $Galaz."
            # Usługi zostały zatrzymane — bez tego magazyn stoi, a nikt nie wie
            # dlaczego. Wracamy do stanu sprzed próby, zanim zgłosimy błąd.
            Write-Info "Przywracam usługi na POPRZEDNIEJ wersji."
            Restart-WertisUslugi -Uslugi $instancja.Uslugi
            exit 1
        }
        Write-Ok "Kod pobrany."
    }

    Write-Krok "Budowanie"
    if (-not (Test-DryRun "Uruchomiłbym npm ci i npm run build w $Katalog.")) {
        Push-Location $Katalog
        # Przeglądarki Playwrighta NIE schodzą na produkcję. Od 0.146.0
        # `@playwright/test` jest zależnością deweloperską panelu, a jego
        # instalacja domyślnie dociąga kilkaset megabajtów Chromium — których
        # ta maszyna nigdy nie użyje, bo testy end-to-end biegną u dewelopera
        # i w CI. Bez tej zmiennej aktualizacja w magazynie ciągnie je przez
        # łącze biura, a przy odciętej sieci potrafi się na nich wywrócić.
        # CI ustawia dokładnie to samo (.github/workflows/server.yml).
        $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
        & npm ci
        $kodCi = $LASTEXITCODE
        if ($kodCi -eq 0) { & npm run build; $kodCi = $LASTEXITCODE }
        Pop-Location
        if ($kodCi -ne 0) {
            Write-Blad "Budowanie nie powiodło się (kod $kodCi)."
            Write-Info "Kod jest już nowy, ale nie zbudowany - usługi zostają zatrzymane CELOWO."
            Write-Info "Uruchomienie starego dist z nowym server\data mieszałoby dwie wersje."
            Write-Info "Napraw przyczynę i powtórz: .\wertis-instalator.ps1 -Aktualizuj"
            exit 1
        }
        Write-Ok "Aplikacja zbudowana."
    }

    $wersjaPo = Get-WertisWersja -Katalog $Katalog

    # APK dla kolektorow (0.52.0). PO zbudowaniu, a PRZED startem uslug: serwer
    # ma wstac z plikiem juz na miejscu, zeby pierwszy kolektor, ktory zapyta,
    # dostal komplet, a nie 404 sprzed sekundy.
    Write-Krok "APK kolektora"
    if ($Dev) {
        # Świadomie NIC. Katalog apk/ instancji dev zostaje pusty, więc
        # GET /api/aktualizacja nie ma czego proponować — dev nie jest kanałem
        # dystrybucji. Kolektor produkcyjny omyłkowo wskazany na dev nie
        # dostanie propozycji buildu, z którego nie ma powrotu (Android
        # odmawia obniżenia wersji). Build testowy wgrywa się przez adb.
        Write-Info "Instancja dev nie serwuje APK - katalog apk/ zostaje pusty."
    } elseif (-not (Test-DryRun "Pobralbym wertis-kolektor-$wersjaPo.apk do server\data\apk.")) {
        [void](Get-WertisApk -Katalog $Katalog -Wersja $wersjaPo)
    }

    Write-Krok "Uruchamianie usług"
    Restart-WertisUslugi -Uslugi $instancja.Uslugi
    $health = Test-WertisHealth -Port $Port

    # Zadanie dla przycisku aktualizacji w panelu (0.492.0). Rejestrowane także
    # tą drogą, bo zwykła aktualizacja jest tym, co istniejące instalacje
    # uruchomią najpierw — i tak dostają przycisk bez pełnego instalatora.
    Register-WertisZadanieAktualizacji -Katalog $Katalog -Nazwa "WERTIS aktualizacja$($instancja.Sufiks)"

    Write-Naglowek "Aktualizacja zakonczona"
    Write-Info "Wersja: $wersjaPrzed -> $wersjaPo"
    Write-Info "Nietkniete: baza aplikacji, konto SQL i GRANT-y, wertis.env, konta uzytkownikow."
    # Kopię przed migracją robi serwer przy pierwszym starcie nowej wersji
    # (0.487.0), więc działa też przy aktualizacji ręcznej. Tu tylko o niej mówimy.
    Write-Info "Kopia bazy sprzed migracji: server\data\kopie\przed-*.db (robi ja serwer przy starcie)."
    Write-Info "Kolektory zaproponuja aktualizacje same, przy nastepnym otwarciu aplikacji."
    if (-not $health -and -not $DryRun) {
        Write-Uwaga "API nie odpowiedziało - sprawdź dziennik usługi wertis-api."
        exit 1
    }
    exit 0
}

# ═══ ETAP 1: instalacja ══════════════════════════════════════════════════════

if (-not $TylkoKonfiguracja) {
    # Instalacja z paczki wydania (0.492.0) nie ma repozytorium ani źródeł.
    # Ponowny przebieg instalatora na niej — po zmianę Subiekta albo konta —
    # nie pobiera i nie buduje niczego; nową wersję wgrywa -Aktualizuj -Paczka.
    $zPaczki = Test-Path (Join-Path $Katalog "paczka.json")
    # Od 0.496.0 NOWA instalacja idzie z paczki wydania: bez Gita, bez
    # `npm ci` na 372 MB i bez kompilacji na serwerze, z Nodem w paczce.
    # Git zostaje dla instalacji, która już go ma, i dla jawnego -Galaz
    # (dev z gałęzi) — paczki powstają wyłącznie z `main`.
    $zGita = -not $zPaczki -and ((Test-Path (Join-Path $Katalog ".git")) -or $PSBoundParameters.ContainsKey("Galaz"))

    Write-Krok "Zależności"
    if ($zGita) {
        $okNode = Install-WertisNarzedzie -Polecenie "node" -IdWinget "OpenJS.NodeJS.LTS" `
            -Opis "Node.js LTS" -UrlAwaryjny "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi"
        $okGit = Install-WertisNarzedzie -Polecenie "git" -IdWinget "Git.Git" -Opis "Git"
        if (-not ($okNode -and $okGit)) { exit 1 }
        if (-not (Test-WertisNode)) { exit 1 }
    } else {
        Write-Ok "Paczka wydania niesie własny Node — nie instaluję żadnych programów."
    }

    Write-Krok "Aplikacja w $Katalog"
    if ($zPaczki) {
        Write-Ok "Instalacja z paczki wydania $(Get-WertisWersja -Katalog $Katalog) — kodu nie pobieram."
    } elseif (-not $zGita) {
        if ((Test-Path $Katalog) -and (Get-ChildItem $Katalog -Force | Select-Object -First 1)) {
            Write-Blad "$Katalog istnieje i nie jest pusty, a nie ma w nim instalacji WERTIS."
            Write-Info "Usuń katalog albo wskaż inny przez -Katalog."
            if (-not $DryRun) { exit 1 }
        }
        if (-not (Test-DryRun "Pobrałbym najnowszą paczkę wydania i rozpakował ją do $Katalog.")) {
            $repoGh = Get-WertisRepoGitHub -Repo $Repo
            $wersjaPaczki = Get-WertisNajnowszaWersja -Repo $repoGh
            if (-not $wersjaPaczki) { Write-Blad "Nie udało się ustalić najnowszego wydania $repoGh."; exit 1 }
            $zip = Get-WertisPaczka -Repo $repoGh -Wersja $wersjaPaczki -Cel (Join-Path ([IO.Path]::GetTempPath()) "wertis-paczki")
            if (-not $zip) { exit 1 }
            Zapewnij-Katalog (Split-Path $Katalog)
            Expand-WertisPaczka -Zip $zip -Cel $Katalog -Wersja $wersjaPaczki
            # Dane od pierwszego dnia poza katalogiem aplikacji: aktualizacja
            # podmienia katalog, a ponowna instalacja po awarii znajdzie je
            # w <katalog>-dane i podepnie, zamiast zaczynać od pustej bazy.
            Move-WertisDaneNaZewnatrz -Katalog $Katalog
            Write-Ok "Wersja $wersjaPaczki rozpakowana w $Katalog."
        }
        $zPaczki = $true
    } elseif (Test-Path (Join-Path $Katalog ".git")) {
        # Ponowne uruchomienie instalatora JEST aktualizacją (DEPLOY.md §7).
        if (-not (Test-DryRun "Zaktualizowałbym repozytorium (git pull).")) {
            Push-Location $Katalog
            & git pull --ff-only origin $Galaz
            $kod = $LASTEXITCODE
            Pop-Location
            if ($kod -ne 0) {
                Write-Blad "git pull nie powiódł się (kod $kod)."
                Write-Info "Najczęstsza przyczyna: lokalne zmiany w $Katalog albo rozjazd z gałęzią $Galaz."
                exit 1
            }
            Write-Ok "Kod zaktualizowany."
        }
    } else {
        # Stan pośredni: katalog jest, ale bez repozytorium. Wyłapujemy go
        # ZANIM git odmówi, bo jego komunikat mówi mniej niż ten.
        if ((Test-Path $Katalog) -and (Get-ChildItem $Katalog -Force | Select-Object -First 1)) {
            Write-Blad "$Katalog istnieje i nie jest pusty, a nie ma w nim repozytorium."
            Write-Info "git clone odmówi. Usuń katalog albo wskaż inny przez -Katalog."
            # Przebieg próbny ma POKAZAĆ problem, a nie go rozstrzygać — inaczej
            # -DryRun na maszynie z istniejącą instalacją kończyłby się błędem
            # zamiast raportem.
            if (-not $DryRun) { exit 1 }
        }
        if (-not (Test-DryRun "Sklonowałbym $Repo do $Katalog.")) {
            Zapewnij-Katalog (Split-Path $Katalog)
            & git clone --branch $Galaz $Repo $Katalog
            # Bez tego sprawdzenia nieudany klon wypisywał „[ok] Kod pobrany"
            # i przewracał się dopiero na `npm ci`, czyli DWA KROKI DALEJ niż
            # przyczyna. Najgorszy rodzaj błędu: taki, który udaje sukces.
            if ($LASTEXITCODE -ne 0) {
                Write-Blad "git clone nie powiódł się (kod $LASTEXITCODE)."
                Write-Info "Sprawdź dostęp do $Repo i połączenie z siecią."
                exit 1
            }
            Write-Ok "Kod pobrany."
        }
    }

    Write-Krok "Budowanie"
    if ($zPaczki) {
        Write-Ok "Paczka jest już zbudowana — pomijam npm ci i build."
    } elseif (-not (Test-DryRun "Uruchomiłbym npm ci i npm run build w $Katalog.")) {
        Push-Location $Katalog
        # Przeglądarki Playwrighta NIE schodzą na produkcję. Od 0.146.0
        # `@playwright/test` jest zależnością deweloperską panelu, a jego
        # instalacja domyślnie dociąga kilkaset megabajtów Chromium — których
        # ta maszyna nigdy nie użyje, bo testy end-to-end biegną u dewelopera
        # i w CI. Bez tej zmiennej aktualizacja w magazynie ciągnie je przez
        # łącze biura, a przy odciętej sieci potrafi się na nich wywrócić.
        # CI ustawia dokładnie to samo (.github/workflows/server.yml).
        $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
        & npm ci
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Blad "npm ci nie powiodło się."; exit 1 }
        & npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Blad "npm run build nie powiodło się."; exit 1 }
        Pop-Location
        Write-Ok "Aplikacja zbudowana."
    }

    Write-Krok "Usługi Windows"
    $nssm = Get-WertisNssm -Katalog $Katalog
    # Node z paczki, gdy jest: podmienia się razem z wydaniem, więc usługa
    # chodzi na wersji, na której paczka przeszła próbę w CI.
    $node = Get-WertisNodeAplikacji -Katalog $Katalog
    Register-WertisUsluga -Nssm $nssm -Nazwa "wertis-api$($instancja.Sufiks)" -Aplikacja $node -Katalog $Katalog `
        -Skrypt (Join-Path $Katalog "server\dist\index.js")
    Register-WertisUsluga -Nssm $nssm -Nazwa "wertis-worker$($instancja.Sufiks)" -Aplikacja $node -Katalog $Katalog `
        -Skrypt (Join-Path $Katalog "server\dist\worker\worker.js")

    Write-Krok "Sieć"
    Add-WertisRegulaZapory -Port $Port -Nazwa $instancja.Zapora

    Write-Krok "Aktualizacja z panelu"
    Register-WertisZadanieAktualizacji -Katalog $Katalog -Nazwa "WERTIS aktualizacja$($instancja.Sufiks)"
} else {
    $nssm = Join-Path $Katalog "tools\nssm.exe"
}

# ═══ ETAPY 2 i 4: kreator konfiguracji i konto SQL ═══════════════════════════

$podlaczacDoSubiekta = -not $Demo
if ($podlaczacDoSubiekta -and -not $DryRun) {
    Write-Krok "Podłączenie do Subiekta"
    Write-Info "Bez tego kroku aplikacja rusza na danych demo i NIC nie trafia do Subiekta."
    Write-Info "To poprawny wariant na pilota (Etap 0 z DEPLOY.md) - zawsze można wrócić"
    Write-Info "i uruchomić instalator z -TylkoKonfiguracja."
    $podlaczacDoSubiekta = Read-Tak "Podłączyć teraz do bazy Subiekta?" -Domyslnie $true
}

if ($podlaczacDoSubiekta) {
    Write-Naglowek "Kreator konfiguracji"

    # Serwer SQL z parametru, bez pytania: WERTIS stawia się na maszynie
    # z Subiektem, więc odpowiedź to prawie zawsze „localhost" (0.496.0).
    $serwer = $SerwerSql
    Write-Info "Serwer SQL: $serwer (inny: -SerwerSql)."
    # `$instancjaSql`, nie `$instancja`: ta druga to obiekt instancji WERTIS
    # (usługi, zapora, SRODOWISKO). Do 0.496.0 kreator nadpisywał ją napisem,
    # więc po podłączeniu do Subiekta usługi nie dostawały restartu, a dev —
    # swojego SRODOWISKO.
    $instancjaSql = if ($InstancjaSql) { $InstancjaSql } else { Select-WertisInstancjaSql -Dostepne (Get-WertisInstancjeSql) }
    if ($instancjaSql) {
        Write-Info "Instancja SQL: $instancjaSql (inna: -InstancjaSql)."
    } else {
        $dostepne = @(Get-WertisInstancjeSql)
        $instancjaSql = if ($dostepne.Count -gt 1) {
            Read-Wybor -Pozycje $dostepne -Pytanie "Instancja SQL Servera"
        } else {
            Read-Tekst "Instancja SQL (Enter = INSERTGT)" -Domyslnie "INSERTGT"
        }
    }

    # ── Wymogi wstępne (docs/subiekt-gt-edu-setup.md §1) ────────────────────
    Write-Krok "Sprawdzam instancję $instancjaSql"
    $stan = Test-WertisWymogiSql -Instancja $instancjaSql
    if (-not $stan.Znaleziona) {
        Write-Uwaga "Nie widzę instancji '$instancjaSql' w rejestrze tej maszyny."
        Write-Info "Jeśli SQL Server stoi na innym komputerze, to normalne - jadę dalej."
    } elseif ($stan.TcpIp -and $stan.Mieszane) {
        Write-Ok "TCP/IP i uwierzytelnianie mieszane są już włączone - restart niepotrzebny."
    } else {
        if (-not $stan.TcpIp)    { Write-Uwaga "TCP/IP na instancji jest wyłączony." }
        if (-not $stan.Mieszane) { Write-Uwaga "Uwierzytelnianie mieszane (login SQL) jest wyłączone." }
        Write-Info "Oba są konieczne: sterownik aplikacji łączy się wyłącznie po TCP,"
        Write-Info "a konto aplikacji to login SQL, nie konto Windows."
        Write-Uwaga "Włączenie wymaga RESTARTU usługi SQL - wszyscy wylecą z Subiekta na kilkanaście sekund."
        if (Read-Tak "Włączyć teraz i zrestartować usługę SQL?" -Domyslnie $false) {
            Enable-WertisWymogiSql -Instancja $instancjaSql -Stan $stan | Out-Null
        } else {
            Write-Uwaga "Pominięte. Bez tego połączenie z bazą się nie uda - dokończ wg DEPLOY.md."
        }
    }

    # ── Połączenie uprawnieniami administratora ─────────────────────────────
    Write-Krok "Łączę się z SQL Serverem"
    $polaczenie = $null
    $bledy = @()
    if (-not (Test-DryRun "Połączyłbym się jako administrator (Windows Auth, w razie czego sa).")) {
        try {
            $polaczenie = Open-WertisPolaczenie -ConnectionString (
                Get-WertisConnectionString -Serwer $serwer -Instancja $instancjaSql -Windows)
            Write-Ok "Połączono jako $env:USERNAME (uwierzytelnianie Windows)."
        } catch {
            $bledy += $_.Exception.Message
            Write-Uwaga "Uwierzytelnianie Windows nie przeszło."
            $saHaslo = Read-Host "   Hasło konta 'sa' (Enter = pomiń)" -AsSecureString
            $jawne = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                [Runtime.InteropServices.Marshal]::SecureStringToBSTR($saHaslo))
            if ($jawne) {
                try {
                    $polaczenie = Open-WertisPolaczenie -ConnectionString (
                        Get-WertisConnectionString -Serwer $serwer -Instancja $instancjaSql `
                            -Uzytkownik "sa" -Haslo $jawne)
                    Write-Ok "Połączono jako sa."
                } catch { $bledy += $_.Exception.Message }
            }
        }
    }

    if (-not $polaczenie -and -not $DryRun) {
        # Furtka: bez połączenia administracyjnego nie ustalimy checklisty ani
        # nie założymy konta, ale instalacja NIE jest zmarnowana - aplikacja
        # zostaje w trybie demo, a wdrożenie kończy się wg DEPLOY.md.
        Write-Blad "Nie udało się połączyć z SQL Serverem."
        foreach ($b in $bledy) { Write-Info $b }
        Write-Uwaga "Zostawiam instalację w trybie demo. Konfigurację dokończysz przez:"
        Write-Info "  .\wertis-instalator.ps1 -TylkoKonfiguracja"
        $podlaczacDoSubiekta = $false
    }
}

if ($podlaczacDoSubiekta) {
    # ── Baza podmiotu ───────────────────────────────────────────────────────
    Write-Krok "Baza podmiotu"
    $baza = $null
    if ($polaczenie) {
        Write-Info "Kopia podmiotu ma te same tabele co baza produkcyjna, więc nazwa nie rozstrzyga."
        Write-Info "Rozstrzyga data ostatniego dokumentu: żywa baza ma dzisiejszą, kopia stoi na dniu zrzutu."
        $bazy = @(Sort-WertisBazy -Bazy (Get-WertisStatystykiBazy -Polaczenie $polaczenie `
            -Bazy (Get-WertisBazy -Polaczenie $polaczenie)))
        if ($bazy.Count -eq 0) {
            Write-Blad "Na tej instancji nie ma ani jednej bazy użytkownika."
            exit 1
        }
        # Jedyna baza nie jest wyborem (0.496.0); ostrzeżenia niżej i tak padną.
        $wybor = if ($bazy.Count -eq 1) {
            Write-Info "Jedyna baza na instancji: $(Format-WertisEtykietaBazy -Baza $bazy[0])"
            $bazy[0]
        } else {
            Read-Wybor -Pozycje $bazy -Pytanie "Numer bazy podmiotu" `
                -Etykieta { param($b) Format-WertisEtykietaBazy -Baza $b } `
                -Domyslny (Get-WertisSugerowanaBaza -Bazy $bazy)
        }
        $baza = $wybor.Nazwa
        $polaczenie.ChangeDatabase($baza)

        # Trzy różne „uważaj" i trzy różne powody — jeden wspólny komunikat
        # kazałby się domyślać, czym ta baza właściwie jest.
        if (-not $wybor.Subiekt) {
            Write-Uwaga "W bazie $baza nie widzę kompletu tabel Subiekta (tw__Towar, dok__Dokument, sl_Magazyn, tw_Stan)."
            if (-not (Read-Tak "Mimo to używać tej bazy?" -Domyslnie $false)) { exit 1 }
        } elseif (Test-WertisBazaPodejrzana -Baza $wybor) {
            $dni = [int](((Get-Date).Date - ([datetime]$wybor.OstatniDokument).Date).TotalDays)
            Write-Uwaga "Ostatni dokument w $baza jest sprzed $dni dni — to wygląda na kopię, nie na bazę produkcyjną."
            Write-Info "Firma z przerwą w wystawianiu dokumentów wygląda tak samo, więc decyzja należy do Ciebie."
            if (-not (Read-Tak "Mimo to używać tej bazy?" -Domyslnie $false)) { exit 1 }
        } elseif (-not $wybor.OstatniDokument) {
            Write-Uwaga "Baza $baza nie ma ani jednego dokumentu — to świeży podmiot albo pusta kopia."
            if (-not (Read-Tak "Mimo to używać tej bazy?" -Domyslnie $false)) { exit 1 }
        } else {
            Write-Ok "Baza $baza — ostatni dokument $(([datetime]$wybor.OstatniDokument).ToString('yyyy-MM-dd'))."
        }
    } else {
        $baza = Read-Tekst "Nazwa bazy podmiotu" -Domyslnie "NAZWA_BAZY"
    }

    # ── Magazyny (checklista §3 a) ──────────────────────────────────────────
    Write-Krok "Magazyny"
    Write-Info "Magazyn skutku rozstrzyga, którym trybem idzie dokument - pomyłka wysyła dostawę do złej zakładki."
    if ($polaczenie) {
        $magazyny = @(Get-WertisMagazyny -Polaczenie $polaczenie)
        $etykieta = { param($m) "{0,-4} {1,-10} {2}{3}" -f $m.mag_Id, $m.mag_Symbol, $m.mag_Nazwa,
                      $(if ($m.mag_Glowny -eq $true -or $m.mag_Glowny -eq 1) { "  (główny)" } else { "" }) }
        $glowny = 0
        for ($i = 0; $i -lt $magazyny.Count; $i++) {
            if ($magazyny[$i].mag_Glowny -eq $true -or $magazyny[$i].mag_Glowny -eq 1) { $glowny = $i }
        }
        $mag = Read-Wybor -Pozycje $magazyny -Pytanie "Magazyn główny (MAG)" -Etykieta $etykieta -Domyslny $glowny
        # Podpowiedź pod Enterem z symbolu albo nazwy (0.496.0) — lista zostaje,
        # bo magazyn skutku rozstrzyga, dokąd idzie dokument.
        $mgp = Read-Wybor -Pozycje $magazyny -Pytanie "Strefa przyjęć (MGP)" -Etykieta $etykieta `
            -Domyslny (Get-WertisSugerowanyMagazyn -Magazyny $magazyny -Wzorzec "MGP|PRZYJ")
        $zwr = Read-Wybor -Pozycje $magazyny -Pytanie "Magazyn Zwroty" -Etykieta $etykieta `
            -Domyslny (Get-WertisSugerowanyMagazyn -Magazyny $magazyny -Wzorzec "ZWR|ZWROT")
        $ustawienia.MAG_ID_MAG    = "$($mag.mag_Id)"
        $ustawienia.MAG_ID_MGP    = "$($mgp.mag_Id)"
        $ustawienia.MAG_ID_ZWROTY = "$($zwr.mag_Id)"
    } else {
        $ustawienia.MAG_ID_MAG    = Read-Tekst "mag_Id magazynu głównego" -Domyslnie "1"
        $ustawienia.MAG_ID_MGP    = Read-Tekst "mag_Id strefy przyjęć"    -Domyslnie "2"
        $ustawienia.MAG_ID_ZWROTY = Read-Tekst "mag_Id zwrotów"           -Domyslnie "3"
    }

    # ── Pole lokalizacji (checklista §3 0) ──────────────────────────────────
    Write-Krok "Pole lokalizacji na kartotece towaru"
    Write-Info "Subiekt w tych wersjach nie ma kolumny 'lokalizacja' - używa się jednego"
    Write-Info "z ośmiu pól własnych. Aplikacja NADPISUJE wybrane pole bezwarunkowo."
    $kolumna = "tw_Pole1"
    if ($polaczenie) {
        $pola = @(Get-WertisPolaDodatkowe -Polaczenie $polaczenie)
        $podpowiedz = Get-WertisSugerowanePole -Pola $pola
        if ($podpowiedz -ge 0 -and $pola[$podpowiedz].Adresy -gt 0) {
            Write-Info "W $($pola[$podpowiedz].Pole) leżą już adresy półek - stąd podpowiedź."
            Write-Info "Wskazanie innego pola zostawiłoby dwa źródła prawdy o lokalizacji."
        }
        $wybrane = Read-Wybor -Pozycje $pola -Pytanie "Które pole ma trzymać lokalizację" `
            -Etykieta { param($p) Format-WertisEtykietaPola -Pole $p } -Domyslny $podpowiedz

        # Bramka pyta o to, co NAPRAWDĘ zniknie. Wartości w kształcie adresu
        # aplikacja przejmuje — to jej własna treść. Straszenie nimi nauczyłoby
        # klikać „tak" także tam, gdzie ostrzeżenie jest prawdziwe.
        $obce = $wybrane.Niepuste - $wybrane.Adresy
        if ($wybrane.Adresy -gt 0) {
            Write-Info "$($wybrane.Pole): $($wybrane.Adresy) wartości to już adresy - aplikacja je przejmuje."
        }
        if ($obce -gt 0) {
            Write-Uwaga "$($wybrane.Pole) ma $obce wartości, które nie wyglądają na adres półki."
            Write-Uwaga "Aplikacja nadpisze je bezwarunkowo i nie da się tego cofnąć."
            if (-not (Read-Tak "Na pewno użyć $($wybrane.Pole)?" -Domyslnie $false)) {
                Write-Blad "Przerwane. Uruchom instalator ponownie i wskaż inne pole."
                exit 1
            }
        }
        $kolumna = $wybrane.Pole
    } else {
        $kolumna = Read-Tekst "Kolumna lokalizacji" -Domyslnie "tw_Pole1"
    }
    $ustawienia.MSSQL_LOC_COLUMN = (Assert-BezpiecznyIdentyfikator -Nazwa $kolumna -Opis "kolumna lokalizacji")

    # ── Ilość już odebrana z zamówienia ─────────────────────────────────────
    # Domyślna nazwa `ob_IloscZrealizowana` została zgadnięta i zgadnięta źle —
    # w tej wersji bazy takiej kolumny nie ma. Kreator sprawdza to sam, bo ma
    # otwarte połączenie, a człowiek dowiadywał się dotąd z /api/health.
    if ($polaczenie) {
        $zrealKolumna = "ob_IloscZrealizowana"
        if (Test-WertisKolumnaIstnieje -Polaczenie $polaczenie -Tabela "dok_Pozycja" -Kolumna $zrealKolumna) {
            $ustawienia.MSSQL_ZD_ZREAL_COLUMN = $zrealKolumna
        } else {
            # PUSTA wartość, nie brak klucza: brak znaczyłby „użyj domyślnej".
            $ustawienia.MSSQL_ZD_ZREAL_COLUMN = ""
            Write-Info "Kolumny $zrealKolumna nie ma w dok_Pozycja - karta poda ilość jako oszacowanie."
        }
    }

    # ── Zdjęcia kartotek na karcie towaru ───────────────────────────────────
    # Kreator nie pyta, tylko sprawdza. Struktura jest ustalona (tw_ZdjecieTw,
    # opis struktury), więc przepisywanie sześciu nazw człowiekowi byłoby
    # przerzucaniem na niego wiedzy, którą instalator ma.
    Write-Krok "Zdjęcia kartotek"
    $zdjecia = if ($polaczenie) { Get-WertisZdjeciaKartotek -Polaczenie $polaczenie }
               else { [pscustomobject]@{ Jest = $true; Zdjec = 0; Kartotek = 0 } }
    if ($zdjecia.Jest) {
        if ($polaczenie) {
            Write-Ok "Znalazłem $($zdjecia.Zdjec) zdjęć na $($zdjecia.Kartotek) kartotekach - włączam."
        } else {
            Write-Info "Bez połączenia zakładam standardową strukturę GT i włączam zdjęcia."
        }
        $ustawienia.ZDJECIA_ZRODLO           = "blob"
        $ustawienia.ZDJECIA_TABELA           = "tw_ZdjecieTw"
        $ustawienia.ZDJECIA_KOLUMNA_KLUCZA   = "zd_IdTowar"
        $ustawienia.ZDJECIA_KOLUMNA          = "zd_Zdjecie"
        $ustawienia.ZDJECIA_KOLUMNA_GLOWNE   = "zd_Glowne"
        $ustawienia.ZDJECIA_KOLUMNA_KOLEJNOSC = "zd_Id"
        Write-Info "Miniatura pojawi się na karcie towaru po wgraniu APK w wersji 0.30.0 lub nowszej."
        if ($ZdjeciaZapis) {
            # Jedyne miejsce, w którym ta aplikacja DOPISUJE wiersz do bazy
            # firmy. Osobny przełącznik, bo takiego prawa nie nadaje się
            # dlatego, że ktoś zaktualizował instalator.
            $ustawienia.ZDJECIA_DODAWANIE = "subiekt"
            Write-Ok "Magazynier będzie mógł dodać zdjęcie z kolektora - trafi do kartoteki."
            Write-Info "To wymaga prawa dopisywania wierszy do tw_ZdjecieTw - nadaję je niżej."
        } else {
            Write-Info "Dodawanie zdjęć z kolektora WYŁĄCZONE (włącza je -ZdjeciaZapis)."
        }
    } else {
        # ŚWIADOMIE nie zerujemy tu ZDJECIA_ZRODLO. Wykrycie nie odróżnia „nie ma
        # tabeli" od „nie dało się sprawdzić", a scalanie pliku nie rusza kluczy,
        # o których kreator nie ma zdania. Gaszenie działającej funkcji na
        # podstawie nieudanego zapytania byłoby gorsze niż jej niewłączenie.
        Write-Info "Nie widzę tabeli tw_ZdjecieTw - zdjęć nie włączam."
        Write-Info "Karta towaru pracuje bez nich; siódmy GRANT też nie zostanie nadany."
    }

    # ── Nazwy poziomów cen ──────────────────────────────────────────────────
    # Tak samo jak przy zdjęciach: kreator sprawdza, zamiast pytać. Bez tego
    # widoku ceny i tak wchodzą — import czyta go osobno i degraduje sam —
    # więc jedyne, co tu rozstrzygamy, to czy grant wolno wpisać do skryptu.
    Write-Krok "Nazwy poziomów cen"
    $poziomyCen = if ($polaczenie) { Get-WertisPoziomyCen -Polaczenie $polaczenie } else { $true }
    if ($poziomyCen) {
        if ($polaczenie) { Write-Ok "Widok vwPoziomyCen jest - nadam prawo do nazw poziomow cen." }
        else { Write-Info "Bez polaczenia zakladam standardowa strukture GT i nadaje prawo." }
    } else {
        Write-Info "Nie widze widoku vwPoziomyCen - tego grantu nie nadaje."
        Write-Info "Ceny wejda mimo to; karta towaru pokaze numer poziomu zamiast nazwy."
    }

    # ── ETAP 4: konto SQL aplikacji ─────────────────────────────────────────
    Write-Krok "Konto SQL aplikacji"
    $login = "wertis"
    $haslo = New-WertisHaslo
    # -Zdjecia i -PoziomyCen rozstrzygają o grantach OPCJONALNYCH. Nadanie
    # któregoś na bazie bez tego obiektu wywala CAŁY skrypt (jeden
    # ExecuteNonQuery) i zostawia konto bez ani jednego uprawnienia.
    # Prawo dopisywania wierszy wchodzi WYŁĄCZNIE razem z -ZdjeciaZapis i tylko
    # wtedy, gdy tabela zdjęć w tej bazie istnieje.
    $zapisZdjec = [bool]($ZdjeciaZapis -and $zdjecia.Jest)
    $skrypt = Get-WertisSkryptUprawnien -Baza $baza -KolumnaLokalizacji $ustawienia.MSSQL_LOC_COLUMN `
        -Login $login -Haslo $haslo -Zdjecia $zdjecia.Jest -PoziomyCen $poziomyCen `
        -ZapisZdjec $zapisZdjec
    $plikSkryptu = Join-Path $Katalog "nadaj-uprawnienia-wertis.sql"

    $zalozone = $false
    if ($polaczenie) {
        $ileTabel = @(Get-WertisTabeleOdczytu -Zdjecia $zdjecia.Jest -PoziomyCen $poziomyCen).Count
        $ileKolumn = @(Get-WertisKolumnyZapisu -KolumnaLokalizacji $ustawienia.MSSQL_LOC_COLUMN).Count
        Write-Info "Zakładam login '$login' z uprawnieniami kolumnowymi: odczyt $ileTabel tabel"
        Write-Info "i zapis $ileKolumn kolumn kartoteki ($($ustawienia.MSSQL_LOC_COLUMN), tw_PodstKodKresk)."
        Write-Info "Zero praw zapisu poza nimi - dokumenty i stany zostaja tylko do odczytu."
        $wynik = Grant-WertisLogin -Polaczenie $polaczenie -Skrypt $skrypt
        if ($wynik.Udalo) {
            if ($DryRun) {
                $zalozone = $true
            } else {
                # Weryfikacja jest obowiązkowa, nie ozdobna: błąd CREATE LOGIN
                # nie przerywa reszty skryptu, więc bez tego sprawdzenia konto
                # mogłoby zostać bez ani jednego grantu, a instalator i tak
                # zameldowałby sukces.
                $upr = @(Get-WertisUprawnienia -Polaczenie $polaczenie -Login $login)
                $ocena = Test-WertisUprawnienia -Uprawnienia $upr `
                    -KolumnaLokalizacji $ustawienia.MSSQL_LOC_COLUMN -Zdjecia $zdjecia.Jest `
                    -PoziomyCen $poziomyCen -ZapisZdjec $zapisZdjec
                if ($ocena.Ok) {
                    # Granty sprawdziliśmy połączeniem ADMINISTRATORA — to mówi,
                    # co konto może, a nie czy da się na nie zalogować. Hasło
                    # potrafi się rozjechać (login przeżywa nieudany przebieg),
                    # a objawem jest dopiero „Login failed" w logu usługi.
                    $proba = Test-WertisLogowanie -Serwer $serwer -Instancja $instancjaSql `
                        -Baza $baza -Login $login -Haslo $haslo
                    if ($proba.Udalo) {
                        Write-Ok "Konto gotowe: $($ocena.TabeleOdczytu) tabel do odczytu, zapis tylko $($ocena.KolumnyZapisu) kolumn kartoteki."
                        Write-Ok "Logowanie jako $login sprawdzone - usługi połączą się z bazą."
                        $zalozone = $true
                    } else {
                        Write-Blad "Konto ma uprawnienia, ale NIE DA SIĘ na nie zalogować."
                        Write-Info $proba.Powod
                        Write-Info "Usługi zgłosiłyby to jako 'Login failed for user' dopiero przy starcie."
                        Write-Info "Napraw w SSMS: ALTER LOGIN [$login] WITH PASSWORD = '<hasło z wertis.env>';"
                    }
                } else {
                    Write-Blad "Konto powstało, ale uprawnienia nie zgadzają się z oczekiwanymi."
                    Write-Info "odczyt: $($ocena.TabeleOdczytu) tabel (ma byc $($ocena.Wymaganych)), zapis do dok__Dokument: $($ocena.ZapisDokumentow) (ma byc 0)"
                    if ($ocena.BrakujaceZapisy.Count -gt 0) {
                        # nazwa kolumny, a nie samo "nie zgadza sie" - to ona
                        # mowi, ktora linia GRANT-a nie weszla
                        Write-Info "brakuje prawa zapisu do kolumn: $($ocena.BrakujaceZapisy -join ', ')"
                    }
                }
            }
        } else {
            Write-Uwaga "Nie udało się założyć konta: $($wynik.Powod)"
        }
    }

    if (-not $zalozone) {
        # Furtka z etapu 4: firma, w której nikt nie wypuszcza 'sa' z rąk,
        # nadal ma z instalatora pożytek - dostaje gotowy skrypt do przekazania.
        if (-not (Test-DryRun "Zapisałbym gotowy skrypt uprawnień do $plikSkryptu.")) {
            Write-WertisPlik -Sciezka $plikSkryptu -Tresc $skrypt
        }
        Write-Uwaga "Zapisałem gotowy skrypt: $plikSkryptu"
        Write-Info "Przekaż go administratorowi SQL - wystarczy wkleić do SSMS i uruchomić."
        Write-Info "Hasło konta jest już w skrypcie i w wertis.env; nic nie trzeba podmieniać."
        Write-Info "Po jego wykonaniu uruchom usługi ponownie (nssm restart wertis-api / wertis-worker)."
        # Konfiguracja i tak idzie kompletna (SGT_MODE=mssql): gdy administrator
        # wykona skrypt, wystarczy restart usług i wszystko zaskoczy bez
        # ponownego kreatora. Skutek uboczny jest taki, że health-check kilka
        # kroków niżej NIE MOŻE się udać - i trzeba to powiedzieć wprost,
        # zamiast zostawiać czerwony komunikat bez wyjaśnienia.
        $kontoCzeka = $true
    }

    $ustawienia.SGT_MODE       = "mssql"
    $ustawienia.MSSQL_SERVER   = $serwer
    $ustawienia.MSSQL_INSTANCE = $instancjaSql
    $ustawienia.MSSQL_DATABASE = $baza
    $ustawienia.MSSQL_USER     = $login
    $ustawienia.MSSQL_PASSWORD = $haslo

    # ── Worker Sfery: dokumenty MM (DEPLOY §6, etap 2) ──────────────────────
    # Pytanie pada TYLKO, gdy exe faktycznie leży na dysku: SFERA_WORKER=1 bez
    # wykonawcy zostawiłoby zadania mm w pending na zawsze (serwer zresztą
    # odmówi startu — bledyKonfiguracji). Obecność exe jest świadomym krokiem
    # człowieka (budowa wg sfera-worker/README.md), więc pytanie tu jedynie
    # potwierdza zamiar.
    $sferaExe = Join-Path $Katalog "sfera-worker\wertis-sfera-worker.exe"
    if (Test-Path $sferaExe) {
        Write-Krok "Worker Sfery (dokumenty MM)"
        if (Read-Tak "Wystawiać dokumenty MM przez Sferę? (wymaga licencji Sfery)" -Domyslnie $true) {
            $ustawienia.SFERA_WORKER = "1"
            Write-Info "Operator Subiekta z prawem wystawiania MM (to konto Subiekta, nie login SQL)."
            $ustawienia.SFERA_OPERATOR       = Read-Tekst "Operator Subiekta"
            $ustawienia.SFERA_OPERATOR_HASLO = Read-Tekst "Hasło operatora"
            Register-WertisUsluga -Nssm $nssm -Nazwa "wertis-sfera" -Katalog $Katalog -Aplikacja $sferaExe
        }
    } else {
        Write-Info "Workera Sfery nie ma ($sferaExe) - dokumenty MM wystawia biuro w Subiekcie."
        Write-Info "Automatyzacja MM: zbuduj exe wg sfera-worker\README.md i uruchom instalator ponownie."
    }

    if ($polaczenie) { $polaczenie.Close() }
} elseif (-not $TylkoKonfiguracja) {
    # Tryb demo: dane z eksportu, zero kontaktu z Subiektem.
    Write-Krok "Dane demonstracyjne"
    if (-not (Test-DryRun "Uruchomiłbym npm run seed.")) {
        Push-Location $Katalog
        & (Get-WertisNpm -Katalog $Katalog) run seed
        Pop-Location
        Write-Ok "Baza demo zasilona."
    }
    if ($Dev) {
        # Katalog scenariuszy S1-S71 z docs/scenariusze-testowe.md — po to jest
        # dev: każdy przypadek brzegowy gotowy do obejrzenia, bez wyklikiwania.
        if (-not (Test-DryRun "Uruchomiłbym npm run seed:scenariusze.")) {
            Push-Location $Katalog
            & (Get-WertisNpm -Katalog $Katalog) run seed:scenariusze
            Pop-Location
            Write-Ok "Scenariusze testowe zasilone."
        }
    }
}

# ═══ Publikacja konfiguracji i start ════════════════════════════════════════

Write-Krok "Zapis konfiguracji"
if ($instancja.Srodowisko) { $ustawienia.SRODOWISKO = $instancja.Srodowisko }
Publish-WertisKonfiguracja -Katalog $Katalog -Ustawienia $ustawienia -Nssm $nssm -Port $Port `
    -Uslugi $instancja.Uslugi

Write-Krok "Uruchamianie usług"
Restart-WertisUslugi -Uslugi $instancja.Uslugi

$health = Test-WertisHealth -Port $Port

# ═══ Konto administratora ═══════════════════════════════════════════════════
#
# Od 0.496.0 instalator o nie NIE pyta. Pierwsze konto zakłada się w panelu:
# pusta instalacja pokazuje zamiast logowania formularz konta administratora
# (`panel/src/ekrany/Logowanie.tsx`). Hasło nie przechodzi przez okno
# PowerShella na serwerze, a instalacja nie czeka na człowieka przy klawiaturze.

$setup = $null
if ($health) {
    try { $setup = Invoke-RestMethod -Uri "http://localhost:$Port/api/setup" -TimeoutSec 5 } catch { }
}

Write-Naglowek "Gotowe"

if ($kontoCzeka) {
    Write-Uwaga "Konfiguracja jest kompletna, ale konto SQL jeszcze nie istnieje."
    Write-Info "Do czasu wykonania $Katalog\nadaj-uprawnienia-wertis.sql aplikacja"
    Write-Info "NIE POŁĄCZY SIĘ z bazą - to oczekiwane, nie usterka instalacji."
    Write-Info "Po jego uruchomieniu: nssm restart wertis-api ; nssm restart wertis-worker"
} elseif ($health) {
    Write-Ok "API odpowiada na http://localhost:$Port/api/health"
    Write-Info "konfiguracja wczytana z: $($health.configZPliku)"
    Write-Host ""
    if ($health.mode -eq "mssql") {
        Write-Ok "Tryb: mssql - aplikacja pracuje na prawdziwych danych Subiekta."
    } elseif ($ustawienia.SGT_MODE -eq "mssql") {
        # ROZJAZD, nie wybór. Kreator właśnie zapisał mssql, a proces wstał na
        # demówce — czyli coś przykryło plik. Dotychczasowy tekst mówił o tym
        # jak o poprawnym wariancie pilotażowym i był tu wprost mylący.
        Write-Blad "BŁĄD: zapisałem SGT_MODE=mssql, a aplikacja wstała w trybie $($health.mode)."
        Write-Info "Konfiguracja z pliku została CZYMŚ PRZYKRYTA - najczęściej zmienną"
        Write-Info "środowiskową usługi, która przeżyła starszą instalację."
        if (@($health.configPrzykryte).Count -gt 0) {
            Write-Info "Przykryte klucze: $(@($health.configPrzykryte) -join ', ')"
        }
        Write-Info "Sprawdź: nssm get wertis-api AppEnvironment"
        Write-Info "Wyczyść: nssm reset wertis-api AppEnvironment (to samo dla wertis-worker)"
    } else {
        Write-Uwaga "Tryb: $($health.mode) - to DANE DEMO. Nic nie trafia do Subiekta."
        Write-Info "Wszystko będzie działać i wyglądać normalnie, łącznie ze zmianą lokalizacji,"
        Write-Info "ale w Subiekcie nie zmieni się nic. Podłączenie: -TylkoKonfiguracja."
    }
    # Worker melduje własny tryb, a API je porównuje — pojedynczy zapis do
    # Subiekta idzie właśnie przez workera, więc bez tego sprawdzenia zielone
    # API mówiłoby tylko o połowie instalacji.
    if ($health.worker.zyje) {
        Write-Ok "Worker działa (tryb: $($health.worker.mode))."
    } else {
        Write-Blad "Worker NIE odpowiada - zapisy będą stały w kolejce."
        Write-Info "Zajrzyj do $Katalog\logs\wertis-worker.err.log"
    }
    # Pole `sfera` istnieje w odpowiedzi tylko przy SFERA_WORKER=1 — wtedy
    # trzeci proces jest częścią instalacji i jego stan podlega tej samej ocenie.
    if ($null -ne $health.sfera) {
        if ($health.sfera.zyje) {
            Write-Ok "Worker Sfery działa (tryb: $($health.sfera.mode))."
        } else {
            Write-Blad "Worker Sfery NIE odpowiada - dokumenty MM będą stały w kolejce."
            Write-Info "Zajrzyj do $Katalog\logs\wertis-sfera.err.log"
        }
    }
    foreach ($p in @($health.problemy)) { if ($p) { Write-Blad $p } }
} elseif (-not $DryRun) {
    Write-Blad "API nie odpowiedziało. Zajrzyj do $Katalog\logs\wertis-api.err.log"
}

$nazwaHosta = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "<IP-serwera>" }
Write-Host ""
Write-Host "  Co dalej:" -ForegroundColor Cyan
Write-Info "1. Adres dla kolektorów: http://$nazwaHosta`:$Port  (albo http://<IP>:$Port)"
if ($DryRun -or ($setup -and $setup.potrzebne)) {
    Write-Info "2. Otwórz panel: http://$nazwaHosta`:$Port/obsluga/ - pusta instalacja"
    Write-Info "   pokaże formularz PIERWSZEGO KONTA (administrator). Resztę kont zakłada on."
} else {
    Write-Info "2. Panel: http://$nazwaHosta`:$Port/obsluga/ (konta już są)."
}
# Do 0.487.0 stała tu prośba o dwa wpisy w Harmonogramie zadań, a bramka
# etapu 4 wdrożenia stała na obu. Serwer robi je dziś sam; zostaje jedyna
# rzecz, której za człowieka nie zrobi — próba odtworzenia z kopii.
Write-Info "3. Kopia bazy i rekoncyliacja chodzą same, co noc między 1:00 a 5:00,"
Write-Info "   oraz przed każdą migracją schematu. Leżą w server\data\kopie."
Write-Info "   Przed pracą na prawdziwych danych SPRAWDŹ JEDNĄ ODTWORZENIEM (DEPLOY.md §7)."
Write-Host ""
