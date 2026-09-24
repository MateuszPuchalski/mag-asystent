# ════════════════════════════════════════════════════════════════════════════
#  AKTUALIZACJA Z PACZKI WYDANIA (0.492.0)
# ════════════════════════════════════════════════════════════════════════════
#
# Do tego wydania `-Aktualizuj` budował aplikację na maszynie z Subiektem:
# `git pull`, `npm ci` na 372 MB i kompilacja, przez cały czas przy
# zatrzymanych usługach. Nieudane budowanie zostawiało usługi zatrzymane
# CELOWO — i magazyn bez aplikacji do czasu, aż ktoś przyjdzie.
#
# Z paczką (`tools/paczka.sh`, dołączana do wydania przez CI) jest inaczej:
#
#   1. paczka i jej suma przychodzą z wydania, suma jest OBOWIĄZKOWA;
#   2. paczka rozpakowuje się OBOK, w `<katalog>.nowa`, a stara wersja
#      dalej pracuje;
#   3. dopiero wtedy usługi stają na kilka sekund, katalogi zamieniają się
#      nazwami, usługi wstają;
#   4. zdrowie z nową wersją — albo wycofanie: stary katalog wraca na
#      miejsce, baza wraca z kopii sprzed migracji (0.487.0).
#
# Ścieżki usług NSSM się nie zmieniają, bo zamieniają się katalogi, nie
# ścieżki. Dane (`server\data`) żyją POZA katalogiem aplikacji
# (`<katalog>-dane`) i wracają do niego dowiązaniem. Bez tego zamiana
# katalogów zabrałaby bazę razem ze starą wersją.

# UWAGA NA CUDZYSŁOWY: PowerShell traktuje „ ” “ jak zwykły `"` i kończy nimi
# napis. W komunikatach nazwy stoją więc w apostrofach; polskie cudzysłowy
# wolno tylko w komentarzach (testy.ps1 pilnuje tego tokenizerem).

function Get-WertisRepoGitHub {
    <#
        .SYNOPSIS
        „właściciel/nazwa" z adresu repozytorium. Pusty napis, gdy to nie GitHub.
    #>
    param([Parameter(Mandatory)][string]$Repo)
    if ($Repo -match 'github\.com[/:]([^/]+)/([^/]+?)(\.git)?/?$') { return "$($Matches[1])/$($Matches[2])" }
    return ""
}

function ConvertTo-WertisWersja {
    <#
        .SYNOPSIS
        „0.492.0" z „v0.492.0" albo „0.492.0". `$null` dla czegokolwiek innego.
        .DESCRIPTION
        Numer trafia do adresu pobrania i do nazwy pliku, więc przechodzi przez
        wąski wzorzec. Zlecenie z panelu niesie go w pliku, a plik w katalogu
        danych mógłby przecież napisać ktoś inny niż serwer.
    #>
    param([AllowEmptyString()][string]$Tekst)
    # `\z`, nie `$`: w .NET `$` pasuje także PRZED końcowym znakiem nowej linii,
    # więc „0.492.0<LF>” przechodziło za numer (test w testy.ps1).
    if ($Tekst -match '^v?(\d{1,4}\.\d{1,5}\.\d{1,6})\z') { return $Matches[1] }
    return $null
}

function Test-WertisWersjaNowsza {
    <#
        .SYNOPSIS
        `$true`, gdy `Nowa` jest wyższa niż `Obecna`. Nieczytelna obecna = `$true`.
        .DESCRIPTION
        Cofnięcie wersji z paczki jest zabronione: stary kod na schemacie po
        migracji nowszej wersji to dokładnie ten stan, którego kopie bazy
        (0.487.0) mają unikać. Do cofnięcia służy `<katalog>.poprzednia`.
        Obecna „?" to instalacja bez `package.json` — tam nie ma czego chronić.
    #>
    param([Parameter(Mandatory)][string]$Nowa, [Parameter(Mandatory)][string]$Obecna)
    $o = $null
    if (-not [version]::TryParse($Obecna, [ref]$o)) { return $true }
    return ([version]$Nowa) -gt $o
}

function Get-WertisAdresyPaczki {
    <#
        .SYNOPSIS
        Adresy ZIP-a i sumy danej wersji w wydaniach GitHuba.
    #>
    param([Parameter(Mandatory)][string]$Repo, [Parameter(Mandatory)][string]$Wersja)
    $baza = "https://github.com/$Repo/releases/download/v$Wersja/wertis-$Wersja.zip"
    return [pscustomobject]@{ Zip = $baza; Suma = "$baza.sha256" }
}

function Get-WertisNajnowszaWersja {
    <#
        .SYNOPSIS
        Numer najnowszego wydania z API GitHuba albo `$null`.
    #>
    param([Parameter(Mandatory)][string]$Repo)
    try {
        $w = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" `
            -Headers @{ "User-Agent" = "WERTIS-instalator" } -UseBasicParsing -ErrorAction Stop
        return ConvertTo-WertisWersja $w.tag_name
    } catch {
        Write-Uwaga "Nie udało się zapytać GitHuba o najnowsze wydanie: $($_.Exception.Message)"
        return $null
    }
}

function Get-WertisKatalogDanych {
    <#
        .SYNOPSIS
        Katalog danych poza katalogiem aplikacji: `C:\wertis` → `C:\wertis-dane`.
        .DESCRIPTION
        Obok, nie w środku i nie w Program Data. Obok znaczy ten sam dysk, więc
        przeniesienie jest zmianą nazwy, a nie kopiowaniem gigabajtów zdjęć.
        Instancja dev (`C:\wertis-dev`) dostaje własny (`C:\wertis-dev-dane`).
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    return ($Katalog.TrimEnd('\', '/')) + "-dane"
}

function Test-WertisDowiazanie {
    <#
        .SYNOPSIS
        `$true`, gdy ścieżka jest dowiązaniem (junction, symlink), a nie katalogiem.
    #>
    param([Parameter(Mandatory)][string]$Sciezka)
    $e = Get-Item -LiteralPath $Sciezka -Force -ErrorAction SilentlyContinue
    return [bool]($e -and ($e.Attributes -band [IO.FileAttributes]::ReparsePoint))
}

function Remove-WertisKatalogAplikacji {
    <#
        .SYNOPSIS
        Kasuje katalog wersji aplikacji (`.poprzednia`, `.nieudana-*`, `.nowa`),
        zdejmując NAJPIERW dowiązanie `server\data`.
        .DESCRIPTION
        Od pierwszej aktualizacji z paczki każdy katalog wersji ma w sobie
        dowiązanie do prawdziwych danych. `Remove-Item -Recurse` w Windows
        PowerShell 5.1 potrafi wejść w dowiązanie i skasować jego CEL. Druga
        aktualizacja, sprzątając `.poprzednia`, wyczyściłaby więc bazę firmy.

        `Directory.Delete` bez rekurencji zdejmuje sam punkt dowiązania. Gdyby
        potraktował go jak katalog, niepusty cel rzuci wyjątek zamiast zniknąć.
    #>
    param([Parameter(Mandatory)][string]$Sciezka)
    if (-not (Test-Path -LiteralPath $Sciezka)) { return }
    $dane = Join-Path $Sciezka "server\data"
    if (Test-WertisDowiazanie -Sciezka $dane) { [IO.Directory]::Delete($dane, $false) }
    if (Test-WertisDowiazanie -Sciezka $dane) { throw "Nie umiem zdjąć dowiązania $dane — nie kasuję $Sciezka." }
    Remove-Item -LiteralPath $Sciezka -Recurse -Force
}

# Co przechodzi ze starej instalacji do nowej. LISTA, a nie „wszystko poza
# kodem", bo w katalogu z repo leży wszystko — źródła, docs, .git — a z
# paczką przyjechała już nowa wersja tego, co jest kodem.
#   wertis.env*        — konfiguracja i jej poprzednia wersja (0.491.0)
#   logs               — dzienniki usług; NSSM pisze tam po starcie
#   tools              — nssm.exe: to jego ścieżkę noszą rejestracje usług
#   sfera-worker, tlo-worker — gotowe exe i model; paczka ich nie niesie
#   nadaj-uprawnienia-wertis.sql — skrypt dla administratora bazy, jeśli czeka
$script:WertisDoPrzeniesienia = @(
    "wertis.env", "wertis.env.poprzedni", "logs", "tools",
    "sfera-worker", "tlo-worker", "nadaj-uprawnienia-wertis.sql"
)

function Get-WertisDoPrzeniesienia {
    <#
        .SYNOPSIS
        Te pozycje listy przeniesienia, które w starej instalacji istnieją.
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    return @($script:WertisDoPrzeniesienia | Where-Object { Test-Path -LiteralPath (Join-Path $Katalog $_) })
}

function Get-WertisKopiaPrzedMigracja {
    <#
        .SYNOPSIS
        Najnowsza kopia bazy zrobiona przy wejściu NA daną wersję, albo `$null`.
        .DESCRIPTION
        Serwer od 0.487.0 robi `przed-<czas>-<stara>-do-<nowa>.db` przy
        pierwszym starcie nowej wersji, zanim ruszy migracja. Przy wycofaniu
        to jest dokładnie ten stan bazy, na którym stara wersja pracowała.
    #>
    param([Parameter(Mandatory)][string]$KatalogKopii, [Parameter(Mandatory)][string]$Wersja)
    if (-not (Test-Path -LiteralPath $KatalogKopii)) { return $null }
    $pasujace = @(Get-ChildItem -LiteralPath $KatalogKopii -Filter "przed-*-do-$Wersja.db" -File |
        Sort-Object Name -Descending)
    if ($pasujace.Count -eq 0) { return $null }
    return $pasujace[0].FullName
}

function Get-WertisKatalogKopii {
    <#
        .SYNOPSIS
        Katalog kopii bazy: `KOPIE_KATALOG` z wertis.env albo `<dane>\kopie`.
    #>
    param([Parameter(Mandatory)][string]$Katalog, [Parameter(Mandatory)][string]$KatalogDanych)
    $env = Read-WertisEnv -Sciezka (Join-Path $Katalog "wertis.env")
    if ($env -and $env.Contains("KOPIE_KATALOG") -and $env["KOPIE_KATALOG"]) { return [string]$env["KOPIE_KATALOG"] }
    return (Join-Path $KatalogDanych "kopie")
}

function Get-WertisPaczka {
    <#
        .SYNOPSIS
        Pobiera paczkę wersji i sprawdza sumę. Ścieżka ZIP-a albo `$null`.
        .DESCRIPTION
        SUMA JEST OBOWIĄZKOWA, inaczej niż przy APK (`Test-WertisSuma`
        przepuszcza pustą z ostrzeżeniem). APK instaluje człowiek na
        kolektorze, a Android i tak sprawdzi podpis. Paczkę uruchamia usługa
        jako SYSTEM na maszynie z bazą firmy — brak sumy to brak pliku.
    #>
    param(
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Wersja,
        [Parameter(Mandatory)][string]$Cel
    )
    $adresy = Get-WertisAdresyPaczki -Repo $Repo -Wersja $Wersja
    Zapewnij-Katalog $Cel
    $zip = Join-Path $Cel "wertis-$Wersja.zip"
    $plikSumy = "$zip.sha256"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $adresy.Suma -OutFile $plikSumy -UseBasicParsing -ErrorAction Stop
        Invoke-WebRequest -Uri $adresy.Zip -OutFile $zip -UseBasicParsing -ErrorAction Stop
    } catch {
        Write-Blad "Nie udało się pobrać paczki ${Wersja}: $($_.Exception.Message)"
        Write-Info "Adres: $($adresy.Zip)"
        Write-Info "Wydanie tej wersji mogło jeszcze nie dostać paczki — CI dokłada ją kilka minut po scaleniu."
        return $null
    }
    $oczekiwana = Get-WertisSumaZPliku -Sciezka $plikSumy
    if (-not $oczekiwana) {
        Write-Blad "Paczka $Wersja przyszła bez czytelnej sumy kontrolnej. Nie instaluję."
        return $null
    }
    if (-not (Test-WertisSuma -Sciezka $zip -Oczekiwana $oczekiwana -Opis "Paczka $Wersja")) { return $null }
    return $zip
}

function Expand-WertisPaczka {
    <#
        .SYNOPSIS
        Rozpakowuje paczkę do `Cel` (katalog zostaje usunięty i założony od nowa).
        .DESCRIPTION
        `ZipFile` z .NET, nie `Expand-Archive`: w Windows PowerShell 5.1 ten
        drugi rozpakowuje kilka tysięcy plików `node_modules` minutami. Paczka
        ma w środku jeden katalog `wertis-<wersja>` — jego treść staje się `Cel`.
    #>
    param([Parameter(Mandatory)][string]$Zip, [Parameter(Mandatory)][string]$Cel, [Parameter(Mandatory)][string]$Wersja)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $tymczasowy = "$Cel.rozpakowanie"
    # Pozostałość przerwanej zamiany może już mieć dowiązanie do danych.
    foreach ($k in @($Cel, $tymczasowy)) { Remove-WertisKatalogAplikacji -Sciezka $k }
    [IO.Compression.ZipFile]::ExtractToDirectory($Zip, $tymczasowy)
    $srodek = Join-Path $tymczasowy "wertis-$Wersja"
    if (-not (Test-Path -LiteralPath (Join-Path $srodek "paczka.json"))) {
        Remove-Item -LiteralPath $tymczasowy -Recurse -Force
        throw "Paczka nie ma w środku katalogu wertis-$Wersja z paczka.json."
    }
    $pieczatka = Get-Content -LiteralPath (Join-Path $srodek "paczka.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]$pieczatka.wersja -ne $Wersja) {
        Remove-Item -LiteralPath $tymczasowy -Recurse -Force
        throw "Paczka mówi o wersji $($pieczatka.wersja), a miała być $Wersja."
    }
    Move-Item -LiteralPath $srodek -Destination $Cel
    Remove-Item -LiteralPath $tymczasowy -Recurse -Force
}

function Move-WertisDaneNaZewnatrz {
    <#
        .SYNOPSIS
        Jednorazowo: `server\data` wychodzi do `<katalog>-dane`, w jego miejscu
        zostaje dowiązanie. Kolejne wywołania nic nie robią.
        .DESCRIPTION
        Wymaga zatrzymanych usług. Move-Item w obrębie jednego dysku to zmiana
        nazwy, więc baza i zdjęcia nie są kopiowane. Katalog docelowy, który już
        istnieje, zatrzymuje krok: dwie wersje danych to pytanie do człowieka.
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    $dane = Join-Path $Katalog "server\data"
    $cel = Get-WertisKatalogDanych -Katalog $Katalog
    if (Test-WertisDowiazanie -Sciezka $dane) { return }
    # Ponowna instalacja po awarii (@wydanie): aplikacji nie ma, dane zostały.
    # Podpinamy je, zamiast zaczynać od pustej bazy.
    if (-not (Test-Path -LiteralPath $dane) -and (Test-Path -LiteralPath $cel)) {
        if (Test-DryRun "Podpiąłbym istniejące dane z $cel.") { return }
        Zapewnij-Katalog (Split-Path $dane)
        New-Item -ItemType Junction -Path $dane -Target $cel | Out-Null
        Write-Ok "Dane z $cel podpięte — baza i zdjęcia sprzed reinstalacji zostają."
        return
    }
    if (Test-Path -LiteralPath $cel) {
        throw "Katalog $cel już istnieje, a $dane jest zwykłym katalogiem. Nie wiem, które dane są prawdziwe — rozstrzygnij ręcznie."
    }
    if (Test-DryRun "Przeniósłbym $dane do $cel i zostawił dowiązanie.") { return }
    if (Test-Path -LiteralPath $dane) {
        Move-Item -LiteralPath $dane -Destination $cel
    } else {
        New-Item -ItemType Directory -Path $cel | Out-Null
    }
    New-Item -ItemType Junction -Path $dane -Target $cel | Out-Null
    Write-Ok "Dane aplikacji mieszkają odtąd w $cel (dowiązanie: $dane)."
}

function Get-WertisNodeAplikacji {
    <#
        .SYNOPSIS
        node.exe dla usług: z paczki (`<katalog>\node`), gdy jest, inaczej z PATH.
        .DESCRIPTION
        Paczka od @wydanie niesie Node. Instalacja z Gita go nie ma i chodzi na
        Nodzie systemowym, jak dotąd. W przebiegu próbnym zwraca samą nazwę.
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    $zPaczki = Join-Path $Katalog "node\node.exe"
    if (Test-Path -LiteralPath $zPaczki) { return $zPaczki }
    if ($script:WertisDryRun) { return "node.exe" }
    $c = Get-Command node -ErrorAction SilentlyContinue
    return $(if ($c) { $c.Source } else { "node.exe" })
}

function Get-WertisNpm {
    <# .SYNOPSIS npm z paczki, gdy jest — bez Noda systemowego `npm` nie istnieje w PATH. #>
    param([Parameter(Mandatory)][string]$Katalog)
    $zPaczki = Join-Path $Katalog "node\npm.cmd"
    return $(if (Test-Path -LiteralPath $zPaczki) { $zPaczki } else { "npm" })
}

function Stop-WertisUslugi {
    param([Parameter(Mandatory)][string[]]$Uslugi)
    foreach ($u in $Uslugi) {
        if ($null -eq (Get-Service -Name $u -ErrorAction SilentlyContinue)) { continue }
        Stop-Service -Name $u -Force -ErrorAction SilentlyContinue
    }
}

function Update-WertisZPaczki {
    <#
        .SYNOPSIS
        Aktualizacja z paczki wydania: pobranie, rozpakowanie obok, zamiana,
        zdrowie, wycofanie. Zwraca kod wyjścia: 0 = nowa wersja pracuje.
        .PARAMETER Paczka
        Numer wersji (`0.492.0`, `v0.492.0`), `najnowsza` albo ścieżka do
        pobranego wcześniej ZIP-a (obok musi leżeć `.sha256`).
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [Parameter(Mandatory)][string]$Repo,
        [Parameter(Mandatory)][string]$Paczka,
        [Parameter(Mandatory)][string[]]$Uslugi,
        [int]$Port = 3001
    )
    $repoGh = Get-WertisRepoGitHub -Repo $Repo
    $obecna = Get-WertisWersja -Katalog $Katalog
    $nowy = "$Katalog.nowa"
    $poprzedni = "$Katalog.poprzednia"
    $pobrane = Join-Path ([IO.Path]::GetTempPath()) "wertis-paczki"

    # ── 1. Która paczka ────────────────────────────────────────────────────
    Write-Krok "Paczka wydania"
    $zip = $null
    if (Test-Path -LiteralPath $Paczka -PathType Leaf) {
        $wersja = ConvertTo-WertisWersja (([IO.Path]::GetFileNameWithoutExtension($Paczka)) -replace '^wertis-', '')
        if (-not $wersja) { Write-Blad "Nazwa pliku ma mieć postać wertis-<wersja>.zip."; return 1 }
        $oczekiwana = Get-WertisSumaZPliku -Sciezka "$Paczka.sha256"
        if (-not $oczekiwana) { Write-Blad "Obok $Paczka nie ma czytelnego pliku .sha256. Nie instaluję."; return 1 }
        if (-not (Test-WertisSuma -Sciezka $Paczka -Oczekiwana $oczekiwana -Opis "Paczka $wersja")) { return 1 }
        $zip = $Paczka
    } else {
        $wersja = if ($Paczka -eq "najnowsza") { Get-WertisNajnowszaWersja -Repo $repoGh } else { ConvertTo-WertisWersja $Paczka }
        if (-not $wersja) { Write-Blad "'$Paczka' nie jest numerem wersji (np. 0.492.0) ani ścieżką paczki."; return 1 }
    }
    if (-not (Test-WertisWersjaNowsza -Nowa $wersja -Obecna $obecna)) {
        Write-Blad "Na serwerze stoi $obecna, a paczka to $wersja. Cofnięcia z paczki nie robię."
        Write-Info "Poprzednia wersja leży w $poprzedni — patrz DEPLOY §7, wycofanie aktualizacji."
        return 1
    }
    Write-Info "Wersja: $obecna -> $wersja"
    if (Test-DryRun "Pobrałbym i sprawdził paczkę $wersja, rozpakował ją do $nowy.") {
        $null = Move-WertisDaneNaZewnatrz -Katalog $Katalog
        Test-DryRun "Zatrzymałbym usługi, zamienił $Katalog z $nowy (stara wersja -> $poprzedni) i uruchomił je z powrotem." | Out-Null
        return 0
    }
    if (-not $zip) {
        $zip = Get-WertisPaczka -Repo $repoGh -Wersja $wersja -Cel $pobrane
        if (-not $zip) { return 1 }
    }

    # ── 2. Rozpakowanie OBOK — stara wersja dalej pracuje ──────────────────
    Write-Krok "Rozpakowanie obok działającej wersji"
    try {
        Expand-WertisPaczka -Zip $zip -Cel $nowy -Wersja $wersja
    } catch {
        Write-Blad "Rozpakowanie nie powiodło się: $($_.Exception.Message)"
        Write-Info "Usługi pracują dalej na $obecna — nic nie zostało zmienione."
        return 1
    }
    Write-Ok "Wersja $wersja rozpakowana w $nowy."

    # ── 3. Zamiana: jedyne sekundy bez usług ───────────────────────────────
    Write-Krok "Zamiana wersji"
    Stop-WertisUslugi -Uslugi $Uslugi
    try {
        Move-WertisDaneNaZewnatrz -Katalog $Katalog
        foreach ($p in (Get-WertisDoPrzeniesienia -Katalog $Katalog)) {
            Copy-Item -LiteralPath (Join-Path $Katalog $p) -Destination (Join-Path $nowy $p) -Recurse -Force
        }
        New-Item -ItemType Junction -Path (Join-Path $nowy "server\data") -Target (Get-WertisKatalogDanych -Katalog $Katalog) | Out-Null
        Remove-WertisKatalogAplikacji -Sciezka $poprzedni
        Rename-Item -LiteralPath $Katalog -NewName (Split-Path -Leaf $poprzedni)
        Rename-Item -LiteralPath $nowy -NewName (Split-Path -Leaf $Katalog)
    } catch {
        # Zamiana nie doszła do końca. Najczęstsza przyczyna: coś trzyma plik
        # w starym katalogu (okno Eksploratora, konsola stojąca w nim).
        Write-Blad "Zamiana katalogów nie powiodła się: $($_.Exception.Message)"
        if (-not (Test-Path -LiteralPath $Katalog) -and (Test-Path -LiteralPath $poprzedni)) {
            Rename-Item -LiteralPath $poprzedni -NewName (Split-Path -Leaf $Katalog)
        }
        Restart-WertisUslugi -Uslugi $Uslugi
        Write-Info "Usługi wróciły na $obecna. Zamknij okna stojące w $Katalog i spróbuj ponownie."
        return 1
    }
    Restart-WertisUslugi -Uslugi $Uslugi

    # ── 4. Zdrowie albo wycofanie ──────────────────────────────────────────
    Write-Krok "Sprawdzenie nowej wersji"
    $health = Test-WertisHealth -Port $Port
    if ($health -and [string]$health.wersja -eq $wersja) {
        Write-Ok "Wersja $wersja pracuje."
        [void](Get-WertisApk -Katalog $Katalog -Wersja $wersja)
        return 0
    }

    Write-Blad "Wersja $wersja nie odpowiedziała poprawnie — wycofuję na $obecna."
    Stop-WertisUslugi -Uslugi $Uslugi
    $nieudana = "$Katalog.nieudana-$wersja"
    Remove-WertisKatalogAplikacji -Sciezka $nieudana
    Rename-Item -LiteralPath $Katalog -NewName (Split-Path -Leaf $nieudana)
    Rename-Item -LiteralPath $poprzedni -NewName (Split-Path -Leaf $Katalog)
    # Nowa wersja mogła zdążyć przebudować schemat. Kopia sprzed migracji to
    # dokładnie baza, na której stara wersja pracowała — ta sama chwila.
    $kopia = Get-WertisKopiaPrzedMigracja -Wersja $wersja -KatalogKopii (
        Get-WertisKatalogKopii -Katalog $Katalog -KatalogDanych (Get-WertisKatalogDanych -Katalog $Katalog))
    if ($kopia) {
        $baza = Join-Path (Get-WertisKatalogDanych -Katalog $Katalog) "wertis.db"
        Copy-Item -LiteralPath $baza -Destination "$baza.nieudana-$wersja" -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath "$baza-wal", "$baza-shm" -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $kopia -Destination $baza -Force
        Write-Info "Baza wróciła z $kopia."
    }
    Restart-WertisUslugi -Uslugi $Uslugi
    Write-Info "Nieudana wersja zostaje do obejrzenia w $nieudana, jej dziennik w $Katalog\logs."
    return 1
}

function Register-WertisZadanieAktualizacji {
    <#
        .SYNOPSIS
        Zadanie Harmonogramu „WERTIS aktualizacja", które uruchamia przycisk
        aktualizacji w panelu.
        .DESCRIPTION
        Serwer nie może zaktualizować się sam: `-Aktualizuj` zatrzymuje jego
        usługę, a NSSM zatrzymując usługę kończy całe drzewo jej procesów —
        aktualizacja zginęłaby w połowie. Zadanie Harmonogramu biegnie poza tym
        drzewem.

        Akcja jest STAŁA: jeden skrypt, bez argumentów. Numer wersji czyta on
        z pliku zlecenia i przepuszcza przez wąski wzorzec, więc serwer nie
        podaje tu żadnej linii poleceń. Bez wyzwalacza — biegnie wyłącznie na
        żądanie (`schtasks /run`), jako SYSTEM, bo zamienia katalog aplikacji
        i steruje usługami.
    #>
    param([Parameter(Mandatory)][string]$Katalog, [string]$Nazwa = "WERTIS aktualizacja")
    $skrypt = Join-Path $Katalog "instalator\zlecenie.ps1"
    if (Test-DryRun "Zarejestrowałbym zadanie '$Nazwa' uruchamiające $skrypt jako SYSTEM.") { return }
    $akcja = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$skrypt`"" -WorkingDirectory $env:TEMP
    $kto = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $ustawienia = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $Nazwa -Action $akcja -Principal $kto -Settings $ustawienia -Force | Out-Null
    Write-Ok "Zadanie '$Nazwa' gotowe — przycisk aktualizacji w panelu ma czym ruszyć."
}
