# Zależności, usługi Windows, zapora i publikacja konfiguracji.
#
# Odpowiednik rozdziałów 1-4 z DEPLOY.md. Ręczna instrukcja tam zostaje —
# jest referencją tego, co ten plik automatyzuje, i jedyną drogą, gdy coś
# tutaj zawiedzie.

function Test-Administrator {
    if (-not $IsWindows -and $null -ne $IsWindows) { return $false }
    $tozsamosc = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$tozsamosc).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Polecenie {
    param([Parameter(Mandatory)][string]$Nazwa)
    return $null -ne (Get-Command $Nazwa -ErrorAction SilentlyContinue)
}

function Install-WertisNarzedzie {
    <#
        .SYNOPSIS
        Instaluje Node albo Gita, gdy ich nie ma.
        .DESCRIPTION
        Git jest w komplecie CELOWO, mimo że sam instalator go nie potrzebuje
        po pobraniu kodu: cała bieżąca obsługa w DEPLOY.md §7 stoi na
        `git pull` i Git Bashu (backup, reconcile, reslot). Instalator
        wgrywający ZIP-a unieważniłby tamten rozdział i zostawił maszynę bez
        ścieżki aktualizacji.
    #>
    param(
        [Parameter(Mandatory)][string]$Polecenie,
        [Parameter(Mandatory)][string]$IdWinget,
        [Parameter(Mandatory)][string]$Opis,
        [string]$UrlAwaryjny
    )
    if (Test-Polecenie $Polecenie) {
        Write-Ok "$Opis jest już zainstalowany."
        return $true
    }
    if (Test-DryRun "Zainstalowałbym $Opis ($IdWinget).") { return $true }

    if (Test-Polecenie "winget") {
        Write-Info "Instaluję $Opis przez winget..."
        & winget install --id $IdWinget --exact --silent --accept-source-agreements --accept-package-agreements
    } elseif ($UrlAwaryjny) {
        # Starsze Windows Server nie mają wingeta. Instalator MSI działa
        # wszędzie, tylko trzeba go pobrać ręcznie.
        Write-Uwaga "Brak wingeta — pobieram instalator $Opis bezpośrednio."
        $msi = Join-Path $env:TEMP ([IO.Path]::GetFileName($UrlAwaryjny))
        Invoke-WebRequest -Uri $UrlAwaryjny -OutFile $msi -UseBasicParsing
        Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait
    } else {
        Write-Blad "Brak $Opis i brak wingeta. Zainstaluj ręcznie i uruchom instalator ponownie."
        return $false
    }

    # Nowy PATH jest w rejestrze, ale nie w tym procesie — bez odświeżenia
    # kolejny krok nie zobaczyłby świeżo zainstalowanego narzędzia.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Polecenie $Polecenie) {
        Write-Ok "$Opis zainstalowany."
        return $true
    }
    Write-Blad "$Opis nie odpowiada po instalacji. Uruchom instalator ponownie w nowym oknie."
    return $false
}

function Test-WertisNode {
    <#
        .SYNOPSIS
        Czy zainstalowany Node spełnia `engines` z package.json (>= 22.5).
        .DESCRIPTION
        Maszyna z wcześniejszym Node'em przechodzi zwykłe „czy jest node?"
        bez zająknięcia, a wywala się dopiero na `npm ci` albo — gorzej —
        przy starcie usługi, komunikatem o nieznanym module `node:sqlite`.
        Aplikacja używa wbudowanego sterownika SQLite, który pojawił się
        dokładnie w 22.5.
    #>
    param([version]$Minimalna = "22.5.0")
    if (Test-DryRun "Sprawdził(a)bym wersję Node (wymagana >= $Minimalna).") { return $true }
    if (-not (Test-Polecenie "node")) { return $false }

    $surowa = (& node -v) -replace "^v", ""
    $wersja = [version]"0.0.0"
    if (-not [version]::TryParse($surowa, [ref]$wersja)) {
        Write-Uwaga "Nie umiem odczytać wersji Node ('$surowa') - jadę dalej."
        return $true
    }
    if ($wersja -lt $Minimalna) {
        Write-Blad "Node $wersja jest za stary - aplikacja wymaga co najmniej $Minimalna."
        Write-Info "Zaktualizuj Node (winget upgrade OpenJS.NodeJS.LTS) i uruchom instalator ponownie."
        return $false
    }
    Write-Ok "Node $wersja spełnia wymagania (>= $Minimalna)."
    return $true
}

function Get-WertisNssm {
    <#
        .SYNOPSIS
        Ściąga nssm.exe do <katalog>\tools i zwraca ścieżkę.
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    $docelowy = Join-Path $Katalog "tools\nssm.exe"
    if (Test-Path $docelowy) {
        Write-Ok "NSSM już jest ($docelowy)."
        return $docelowy
    }
    if (Test-DryRun "Pobrałbym nssm.exe do $docelowy.") { return $docelowy }

    New-Item -ItemType Directory -Force -Path (Split-Path $docelowy) | Out-Null
    $zip  = Join-Path $env:TEMP "nssm-2.24.zip"
    $rozp = Join-Path $env:TEMP "nssm-2.24-rozpakowany"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip -UseBasicParsing
    if (Test-Path $rozp) { Remove-Item $rozp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $rozp -Force
    Copy-Item (Join-Path $rozp "nssm-2.24\win64\nssm.exe") $docelowy -Force
    Write-Ok "NSSM pobrany."
    return $docelowy
}

function Register-WertisUsluga {
    <#
        .SYNOPSIS
        Rejestruje jedną usługę przez NSSM — parametry jak w DEPLOY.md §3.
        Istniejącą usługę tylko przekonfigurowuje (idempotencja).
    #>
    param(
        [Parameter(Mandatory)][string]$Nssm,
        [Parameter(Mandatory)][string]$Nazwa,
        [Parameter(Mandatory)][string]$Skrypt,
        [Parameter(Mandatory)][string]$Katalog,
        [Parameter(Mandatory)][string]$Node
    )
    if (Test-DryRun "Zarejestrowałbym usługę $Nazwa ($Skrypt).") { return }

    $istnieje = $null -ne (Get-Service -Name $Nazwa -ErrorAction SilentlyContinue)
    if ($istnieje) {
        Write-Info "Usługa $Nazwa już istnieje — przestawiam ustawienia."
        & $Nssm set $Nazwa Application $Node        | Out-Null
        & $Nssm set $Nazwa AppParameters $Skrypt    | Out-Null
    } else {
        & $Nssm install $Nazwa $Node $Skrypt | Out-Null
    }
    $logi = Join-Path $Katalog "logs"
    New-Item -ItemType Directory -Force -Path $logi | Out-Null

    & $Nssm set $Nazwa AppDirectory     $Katalog                                  | Out-Null
    & $Nssm set $Nazwa AppStdout        (Join-Path $logi "$Nazwa.log")            | Out-Null
    & $Nssm set $Nazwa AppStderr        (Join-Path $logi "$Nazwa.err.log")        | Out-Null
    & $Nssm set $Nazwa AppRotateFiles   1                                         | Out-Null
    & $Nssm set $Nazwa AppRotateBytes   10485760                                  | Out-Null
    & $Nssm set $Nazwa Start            SERVICE_AUTO_START                        | Out-Null
    & $Nssm set $Nazwa AppExit Default  Restart                                   | Out-Null
    Write-Ok "Usługa $Nazwa gotowa."
}

function Publish-WertisKonfiguracja {
    <#
        .SYNOPSIS
        Zapisuje ustawienia do wertis.env — JEDYNEGO źródła konfiguracji.
        .DESCRIPTION
        API i worker to osobne procesy; gdy tylko jeden dostanie
        SGT_MODE=mssql, zapisy po cichu lądują w lokalnym SQLite zamiast
        w Subiekcie i zadanie mimo to kończy się sukcesem. Oba czytają dziś
        ten sam plik z dysku (server/src/env-file.ts), więc NSSM nie przenosi
        już żadnej konfiguracji.

        Dlatego ta funkcja robi też drugą rzecz, mniej oczywistą: KASUJE
        AppEnvironmentExtra obu usług. Zmienne środowiskowe mają pierwszeństwo
        nad plikiem, więc pozostałość po starszej instalacji — np. hasło
        sprzed zmiany — po cichu wygrałaby z tym, co instalator właśnie
        zapisał, i to bez żadnego objawu poza „u mnie nie działa".
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [Parameter(Mandatory)][hashtable]$Ustawienia,
        [Parameter(Mandatory)][string]$Nssm,
        [string[]]$Uslugi = @("wertis-api", "wertis-worker"),
        [int]$Port = 3001
    )
    $plik = Join-Path $Katalog "wertis.env"
    $Ustawienia.PORT = "$Port"
    $kolejnosc = @(
        "SGT_MODE",
        "MSSQL_SERVER", "MSSQL_INSTANCE", "MSSQL_PORT", "MSSQL_DATABASE",
        "MSSQL_USER", "MSSQL_PASSWORD",
        "MSSQL_LOC_COLUMN",
        "MAG_ID_MAG", "MAG_ID_MGP", "MAG_ID_ZWROTY",
        "MSSQL_FLAG_GRUPA", "MSSQL_FLAG_TYP_OBIEKTU",
        "DOC_FLAG_IN_PROGRESS_SGT", "DOC_FLAG_PAUSED_SGT",
        "DOC_FLAG_DONE_SGT", "DOC_FLAG_DONE_ERRORS_SGT",
        "PORT"
    )
    $klucze = @($kolejnosc | Where-Object { $Ustawienia.ContainsKey($_) -and "$($Ustawienia[$_])" -ne "" })

    $linie = @(
        "# WERTIS - ustawienia srodowiska. Plik wygenerowany przez instalator.",
        "#",
        "# JEDYNE zrodlo konfiguracji: czytaja go OBA procesy (API i worker)",
        "# wprost z dysku. Po zmianie wystarczy restart uslug:",
        "#   nssm restart wertis-api ; nssm restart wertis-worker",
        "#",
        "# Plik trzyma haslo do bazy - jest w .gitignore i nie ma go w repo.",
        ""
    )
    foreach ($k in $klucze) {
        # apostrofy wokół wartości: hasło może zawierać znaki, które bash
        # zinterpretowałby przy `source wertis.env` (plik ma pozostać
        # wczytywalny obiema drogami)
        $linie += "export $k='$($Ustawienia[$k])'"
    }
    $linie += ""

    if (-not (Test-DryRun "Zapisałbym $plik ($($klucze.Count) ustawień).")) {
        Set-Content -Path $plik -Value $linie -Encoding UTF8
        Write-Ok "Zapisano $plik ($($klucze.Count) ustawień)."
    }

    # Sprzątanie po starszych instalacjach: zmienne w usłudze przykrywają plik.
    foreach ($usluga in $Uslugi) {
        if (Test-DryRun "Wyczyścił(a)bym AppEnvironmentExtra usługi $usluga.") { continue }
        if ($null -eq (Get-Service -Name $usluga -ErrorAction SilentlyContinue)) { continue }
        $stare = (& $Nssm get $usluga AppEnvironmentExtra 2>$null | Out-String).Trim()
        if ($stare) {
            & $Nssm reset $usluga AppEnvironmentExtra | Out-Null
            Write-Uwaga "Usunięto starą konfigurację ze środowiska usługi $usluga - przykrywałaby wertis.env."
        }
    }
}

function Add-WertisRegulaZapory {
    <#
        .SYNOPSIS
        Wpuszcza kolektory na port API — tylko z sieci lokalnej (DEPLOY.md §4).
    #>
    param([int]$Port = 3001, [string]$Nazwa = "WERTIS kolektor")
    if (Test-DryRun "Dodałbym regułę zapory '$Nazwa' na porcie $Port (localsubnet).") { return }

    $istnieje = Get-NetFirewallRule -DisplayName $Nazwa -ErrorAction SilentlyContinue
    if ($istnieje) {
        Write-Ok "Reguła zapory '$Nazwa' już istnieje."
        return
    }
    New-NetFirewallRule -DisplayName $Nazwa -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet | Out-Null
    Write-Ok "Reguła zapory dodana (TCP $Port, tylko sieć lokalna)."
}

function Restart-WertisUslugi {
    param([string[]]$Uslugi = @("wertis-api", "wertis-worker"))
    if (Test-DryRun "Zrestartowałbym usługi: $($Uslugi -join ', ').") { return }
    foreach ($u in $Uslugi) {
        Restart-Service -Name $u -Force -ErrorAction SilentlyContinue
        Start-Service  -Name $u -ErrorAction SilentlyContinue
        Write-Ok "Usługa $u uruchomiona."
    }
}

function Test-WertisHealth {
    <#
        .SYNOPSIS
        Odpytuje /api/health i ZWRACA odpowiedź. Wywołujący ma pokazać `mode`,
        stan workera i listę `problemy`.
        .DESCRIPTION
        Tryb jest tu rzeczą, która naprawdę cokolwiek mówi: "seeded" znaczy, że
        aplikacja pracuje na danych demo i NIC nie dociera do Subiekta — mimo
        że wszystko wygląda normalnie i każdy zapis kończy się sukcesem.

        Odpowiedź obejmuje dziś OBA procesy (worker melduje swój tryb, API je
        porównuje), więc jedno zapytanie wystarcza, żeby stwierdzić, czy
        instalacja jest spójna. Wcześniej ten sam curl raportował wyłącznie
        API i rozjazd z workerem był przez nie niewykrywalny.
    #>
    param([int]$Port = 3001, [int]$Prob = 15)
    if (Test-DryRun "Odpytałbym http://localhost:$Port/api/health.") { return $null }

    for ($i = 1; $i -le $Prob; $i++) {
        try {
            return Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 5
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $null
}
