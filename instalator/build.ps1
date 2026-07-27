<#
.SYNOPSIS
    Scala instalator w jeden plik .ps1 (i opcjonalnie w .exe).

.DESCRIPTION
    W repo instalator jest podzielony na cztery pliki, bo inaczej byłby jedną
    ścianą kodu. Do wydania musi być JEDEN plik z dwóch powodów:

      * ps2exe pakuje dokładnie jeden skrypt, a skompilowany .exe nie ma obok
        siebie katalogu instalator/ — dot-source ścieżek względnych rozsypałby
        się dopiero na maszynie klienta;
      * wariant awaryjny „goły .ps1" ma być jednym plikiem do skopiowania na
        maszynę bez sieci, a nie czterema.

    Scalanie polega na podmianie bloku między znacznikami MODULY-POCZATEK
    i MODULY-KONIEC w skrypcie głównym.

.PARAMETER Wyjscie
    Ścieżka scalonego .ps1. Domyślnie dist\WERTIS-Instalator.ps1.

.PARAMETER Exe
    Dodatkowo zbuduj .exe (wymaga modułu ps2exe; działa tylko na Windows).
#>
[CmdletBinding()]
param(
    [string]$Wyjscie = "dist\WERTIS-Instalator.ps1",
    [switch]$Exe
)

$ErrorActionPreference = "Stop"
$zrodlo = Split-Path -Parent $MyInvocation.MyCommand.Path

# Kolejność ma znaczenie: ui.ps1 definiuje Test-DryRun i Write-*, z których
# korzystają pozostałe moduły już przy ładowaniu.
$moduly = @("ui.ps1", "sql.ps1", "uslugi.ps1")

$glowny = Get-Content (Join-Path $zrodlo "wertis-instalator.ps1") -Raw -Encoding UTF8

$tresc = ($moduly | ForEach-Object {
    $plik = Join-Path $zrodlo $_
    # BOM z każdego modułu leci precz — na początku pliku jest znacznikiem
    # kodowania, w środku scalonego skryptu byłby przypadkowym znakiem.
    $t = (Get-Content $plik -Raw -Encoding UTF8) -replace "^﻿", ""
    "# --- $_ " + ("-" * (66 - $_.Length)) + "`r`n" + $t
}) -join "`r`n"

$wzorzec = "(?s)# MODULY-POCZATEK.*?# MODULY-KONIEC"
if ($glowny -notmatch $wzorzec) {
    throw "Nie znalazłem znaczników MODULY-POCZATEK/MODULY-KONIEC w wertis-instalator.ps1."
}
# -replace interpretuje $ i \ w tekście zastępującym; treść modułów jest pełna
# zmiennych PowerShella, więc podmiana idzie przez Regex.Replace z literałem.
$scalony = [regex]::Replace($glowny, $wzorzec, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $tresc })

$pelna = if ([System.IO.Path]::IsPathRooted($Wyjscie)) { $Wyjscie }
         else { Join-Path (Get-Location) $Wyjscie }
$katalogWyjscia = Split-Path -Parent $pelna
if ($katalogWyjscia -and -not (Test-Path $katalogWyjscia)) {
    New-Item -ItemType Directory -Force -Path $katalogWyjscia | Out-Null
}

# UTF-8 Z BOM, świadomie: Windows PowerShell 5.1 czyta skrypt bez BOM jako
# ANSI i polskie znaki w komunikatach zamieniają się w krzaki.
[System.IO.File]::WriteAllText($pelna, $scalony, (New-Object System.Text.UTF8Encoding $true))

Write-Host "Scalono: $Wyjscie ($([math]::Round($scalony.Length / 1KB, 1)) KB)"

# Scalony plik musi się parsować — inaczej błąd wyszedłby dopiero przy
# uruchomieniu .exe u klienta.
$bledy = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($pelna, [ref]$null, [ref]$bledy)
if ($bledy -and $bledy.Count) {
    $bledy | ForEach-Object { Write-Host "  $($_.Extent.StartLineNumber): $($_.Message)" }
    throw "Scalony skrypt się nie parsuje ($($bledy.Count) błędów)."
}
Write-Host "Skladnia scalonego skryptu: OK"

# URUCHOM.cmd jedzie obok scalonego .ps1 — bez niego wariant „goły skrypt"
# odbija się od domyślnej polityki wykonywania, zanim ktokolwiek zajrzy
# do README.
$cmdZrodlo = Join-Path $zrodlo "URUCHOM.cmd"
if (Test-Path $cmdZrodlo) {
    Copy-Item $cmdZrodlo (Join-Path (Split-Path $pelna) "URUCHOM.cmd") -Force
    Write-Host "Skopiowano: URUCHOM.cmd"
}

if ($Exe) {
    if (-not (Get-Module -ListAvailable -Name ps2exe)) {
        Install-Module -Name ps2exe -Force -Scope CurrentUser -AllowClobber
    }
    Import-Module ps2exe
    $exe = [IO.Path]::ChangeExtension($Wyjscie, ".exe")
    Invoke-ps2exe -inputFile $Wyjscie -outputFile $exe `
        -title "WERTIS - instalator" `
        -description "Instalator serwera WERTIS dla maszyny z Subiektem GT" `
        -company "WERTIS" -product "WERTIS" -noConsole:$false -requireAdmin
    Write-Host "Zbudowano: $exe"
}
