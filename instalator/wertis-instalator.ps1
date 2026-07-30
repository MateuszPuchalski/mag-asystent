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

.PARAMETER Odinstaluj
    Zdejmuje usługi, regułę zapory i katalog aplikacji. NIE rusza Subiekta,
    loginu SQL, rejestru ani Node'a z Gitem — pełna lista na końcu przebiegu.

.PARAMETER UsunDane
    Tylko z -Odinstaluj: kasuje też ślad audytowy i zdjęcia problemów.
    Bez tego przełącznika `server\data` zostaje przeniesiony obok katalogu.

.EXAMPLE
    .\wertis-instalator.ps1
    Pełna instalacja z kreatorem.

.EXAMPLE
    .\wertis-instalator.ps1 -Demo
    Instalacja pilotażowa: działa od razu, Subiekt nietknięty.

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
    [switch]$TylkoKonfiguracja,
    [switch]$DryRun,
    [switch]$Odinstaluj,
    [switch]$UsunDane
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
# MODULY-KONIEC

$script:WertisDryRun = [bool]$DryRun

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
    Write-Krok "Deinstalacja WERTIS"
    Write-Info "Zniknie: usługi wertis-api i wertis-worker, reguła zapory"
    Write-Info "'WERTIS kolektor' oraz katalog $Katalog."
    Write-Host ""
    if ($UsunDane) {
        Write-Uwaga "-UsunDane: ślad audytowy i zdjęcia problemów zostaną SKASOWANE."
        Write-Uwaga "Historii zmian lokalizacji nie da się wtedy odtworzyć."
    } else {
        Write-Info "Dane (ślad audytowy, zdjęcia) zostaną przeniesione OBOK katalogu."
    }
    Write-Host ""

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
    Remove-WertisUslugi -Nssm (Join-Path $Katalog "tools\nssm.exe")
    Remove-WertisRegulaZapory
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
    Write-Info "   i flagi na fakturach ZOSTAJĄ. Odwraca je wyłącznie kopia bazy."
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

# ═══ ETAP 1: instalacja ══════════════════════════════════════════════════════

if (-not $TylkoKonfiguracja) {
    Write-Krok "Zależności: Node.js i Git"
    $okNode = Install-WertisNarzedzie -Polecenie "node" -IdWinget "OpenJS.NodeJS.LTS" `
        -Opis "Node.js LTS" -UrlAwaryjny "https://nodejs.org/dist/v22.11.0/node-v22.11.0-x64.msi"
    $okGit = Install-WertisNarzedzie -Polecenie "git" -IdWinget "Git.Git" -Opis "Git"
    if (-not ($okNode -and $okGit)) { exit 1 }
    if (-not (Test-WertisNode)) { exit 1 }

    Write-Krok "Aplikacja w $Katalog"
    if (Test-Path (Join-Path $Katalog ".git")) {
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
    if (-not (Test-DryRun "Uruchomiłbym npm ci i npm run build w $Katalog.")) {
        Push-Location $Katalog
        & npm ci
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Blad "npm ci nie powiodło się."; exit 1 }
        & npm run build
        if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Blad "npm run build nie powiodło się."; exit 1 }
        Pop-Location
        Write-Ok "Aplikacja zbudowana."
    }

    Write-Krok "Usługi Windows"
    $nssm = Get-WertisNssm -Katalog $Katalog
    $node = if (Test-DryRun) { "node.exe" } else { (Get-Command node).Source }
    Register-WertisUsluga -Nssm $nssm -Nazwa "wertis-api" -Node $node -Katalog $Katalog `
        -Skrypt (Join-Path $Katalog "server\dist\index.js")
    Register-WertisUsluga -Nssm $nssm -Nazwa "wertis-worker" -Node $node -Katalog $Katalog `
        -Skrypt (Join-Path $Katalog "server\dist\worker\worker.js")

    Write-Krok "Sieć"
    Add-WertisRegulaZapory -Port $Port
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

    $serwer    = Read-Tekst "Serwer SQL" -Domyslnie "localhost"
    $instancja = Read-Tekst "Instancja (Enter = INSERTGT)" -Domyslnie "INSERTGT"

    # ── Wymogi wstępne (docs/subiekt-gt-edu-setup.md §1) ────────────────────
    Write-Krok "Sprawdzam instancję $instancja"
    $stan = Test-WertisWymogiSql -Instancja $instancja
    if (-not $stan.Znaleziona) {
        Write-Uwaga "Nie widzę instancji '$instancja' w rejestrze tej maszyny."
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
            Enable-WertisWymogiSql -Instancja $instancja -Stan $stan | Out-Null
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
                Get-WertisConnectionString -Serwer $serwer -Instancja $instancja -Windows)
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
                        Get-WertisConnectionString -Serwer $serwer -Instancja $instancja `
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
        $wybor = Read-Wybor -Pozycje $bazy -Pytanie "Numer bazy podmiotu" `
            -Etykieta { param($b) Format-WertisEtykietaBazy -Baza $b } `
            -Domyslny (Get-WertisSugerowanaBaza -Bazy $bazy)
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
        $mgp = Read-Wybor -Pozycje $magazyny -Pytanie "Strefa przyjęć (MGP)" -Etykieta $etykieta
        $zwr = Read-Wybor -Pozycje $magazyny -Pytanie "Magazyn Zwroty" -Etykieta $etykieta
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

    # ── Flagi faktur (checklista §3 b) ──────────────────────────────────────
    Write-Krok "Flagi sprawdzenia faktury"
    if ($polaczenie) {
        $flagi = @(Get-WertisFlagi -Polaczenie $polaczenie)
        if ($flagi.Count -eq 0) {
            # Wersja edu nie ma flag dokumentów. To nie jest błąd instalacji.
            Write-Uwaga "Ta baza nie ma zdefiniowanych flag dokumentów."
            Write-Info "Zostawiam puste - zadania flagowania po prostu nie powstaną,"
            Write-Info "a cała reszta aplikacji działa normalnie."
        } else {
            $grupy = @(Find-WertisGrupaFlag -Polaczenie $polaczenie)
            if ($grupy.Count -eq 0) {
                Write-Uwaga "Żadna faktura zakupu nie jest jeszcze oflagowana."
                Write-Info "Oflaguj ręcznie jedną fakturę w Subiekcie i uruchom instalator"
                Write-Info "z -TylkoKonfiguracja - dopiero wtedy da się ustalić grupę flag."
            } else {
                $g = Read-Wybor -Pozycje $grupy -Pytanie "Grupa flag faktur" -Domyslny 0 `
                    -Etykieta { param($x) "grupa $($x.flw_IdGrupyFlag), typ obiektu $($x.flw_TypObiektu)  ($($x.ile) oflagowanych faktur)" }
                $ustawienia.MSSQL_FLAG_GRUPA       = "$($g.flw_IdGrupyFlag)"
                $ustawienia.MSSQL_FLAG_TYP_OBIEKTU = "$($g.flw_TypObiektu)"

                $etykietaFlagi = { param($f) "{0,-5} {1}" -f $f.flg_Id, $f.flg_Text }
                $mapa = @(
                    @{ Klucz = "DOC_FLAG_IN_PROGRESS_SGT";  Opis = "dostawa w trakcie rozkładania" },
                    @{ Klucz = "DOC_FLAG_PAUSED_SGT";       Opis = "rozkładanie wstrzymane" },
                    @{ Klucz = "DOC_FLAG_DONE_SGT";         Opis = "dostawa rozłożona" },
                    @{ Klucz = "DOC_FLAG_DONE_ERRORS_SGT";  Opis = "rozłożona z zastrzeżeniami" }
                )
                Write-Info "Dla każdego stanu wskaż flagę (Enter = pomiń ten stan)."
                foreach ($m in $mapa) {
                    $f = Read-Wybor -Pozycje $flagi -Pytanie "Flaga: $($m.Opis)" `
                        -Etykieta $etykietaFlagi -PozwolPominac
                    if ($f) { $ustawienia[$m.Klucz] = "$($f.flg_Id)" }
                }
            }
        }
    }

    # ── ETAP 4: konto SQL aplikacji ─────────────────────────────────────────
    Write-Krok "Konto SQL aplikacji"
    $login = "wertis"
    $haslo = New-WertisHaslo
    $skrypt = Get-WertisSkryptUprawnien -Baza $baza -KolumnaLokalizacji $ustawienia.MSSQL_LOC_COLUMN `
        -Login $login -Haslo $haslo
    $plikSkryptu = Join-Path $Katalog "nadaj-uprawnienia-wertis.sql"

    $zalozone = $false
    if ($polaczenie) {
        Write-Info "Zakładam login '$login' z uprawnieniami kolumnowymi: odczyt siedmiu tabel,"
        Write-Info "zapis JEDNEJ kolumny lokalizacji i tabeli flag. Zero praw do dok__Dokument."
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
                $ocena = Test-WertisUprawnienia -Uprawnienia $upr -KolumnaLokalizacji $ustawienia.MSSQL_LOC_COLUMN
                if ($ocena.Ok) {
                    Write-Ok "Konto gotowe: $($ocena.TabeleOdczytu) tabel do odczytu, zapis tylko $($ustawienia.MSSQL_LOC_COLUMN) i fl_Wartosc."
                    $zalozone = $true
                } else {
                    Write-Blad "Konto powstało, ale uprawnienia nie zgadzają się z oczekiwanymi."
                    Write-Info "odczyt: $($ocena.TabeleOdczytu) tabel (ma być 7), lokalizacja: $($ocena.LokalizacjaOk), zapis do dok__Dokument: $($ocena.ZapisDokumentow) (ma być 0)"
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
    $ustawienia.MSSQL_INSTANCE = $instancja
    $ustawienia.MSSQL_DATABASE = $baza
    $ustawienia.MSSQL_USER     = $login
    $ustawienia.MSSQL_PASSWORD = $haslo

    if ($polaczenie) { $polaczenie.Close() }
} elseif (-not $TylkoKonfiguracja) {
    # Tryb demo: dane z eksportu, zero kontaktu z Subiektem.
    Write-Krok "Dane demonstracyjne"
    if (-not (Test-DryRun "Uruchomiłbym npm run seed.")) {
        Push-Location $Katalog
        & npm run seed
        Pop-Location
        Write-Ok "Baza demo zasilona."
    }
}

# ═══ Publikacja konfiguracji i start ════════════════════════════════════════

Write-Krok "Zapis konfiguracji"
Publish-WertisKonfiguracja -Katalog $Katalog -Ustawienia $ustawienia -Nssm $nssm -Port $Port

Write-Krok "Uruchamianie usług"
Restart-WertisUslugi

$health = Test-WertisHealth -Port $Port
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
    foreach ($p in @($health.problemy)) { if ($p) { Write-Blad $p } }
} elseif (-not $DryRun) {
    Write-Blad "API nie odpowiedziało. Zajrzyj do $Katalog\logs\wertis-api.err.log"
}

$nazwaHosta = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { "<IP-serwera>" }
Write-Host ""
Write-Host "  Co dalej:" -ForegroundColor Cyan
Write-Info "1. Adres dla kolektorów: http://$nazwaHosta`:$Port  (albo http://<IP>:$Port)"
Write-Info "2. Konta pracowników zakłada się Z KOLEKTORA - przycisk ZAŁÓŻ KONTA"
Write-Info "   na ekranie startowym pustej instalacji. Instrukcja: DEPLOY.md §5a."
Write-Info "3. Nocna kopia bazy i rekoncyliacja: DEPLOY.md §7 - ustaw je, ZANIM"
Write-Info "   ruszy praca na prawdziwych danych."
Write-Host ""
