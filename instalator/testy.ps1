<#
.SYNOPSIS
    Asercje na logice instalatora. Uruchamiane w CI przed przebiegiem próbnym.

.DESCRIPTION
    POWSTAŁO PO AWARII U KLIENTA. Pierwszy przebieg na prawdziwym Windowsie
    wywalił się na `New-Item -Path (Split-Path "C:\wertis")`, czyli na
    `New-Item -Path "C:\"` — a CI świeciło na zielono, bo `-DryRun` sprawdza
    PRZEBIEG STEROWANIA, nie poprawność kroków: każdy krok wykonawczy siedzi
    za `Test-DryRun` i w przebiegu próbnym jest pomijany.

    Ten plik jest odpowiedzią na to, a nie na sam błąd: bierze funkcje, które
    da się wywołać bez dotykania systemu, i sprawdza ich wynik. Nie zastąpi
    przebiegu na Windowsie z Subiektem — usług, zapory ani SQL Servera tu nie
    ma i nie będzie. Lista ręcznych pozycji w README zostaje.

    Uruchomienie: powershell -ExecutionPolicy Bypass -File .\testy.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$zrodlo = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $zrodlo "ui.ps1")
. (Join-Path $zrodlo "sql.ps1")
. (Join-Path $zrodlo "uslugi.ps1")

$script:bledy = 0
$script:zdane = 0

function Sprawdz {
    param([Parameter(Mandatory)][string]$Opis, [Parameter(Mandatory)][scriptblock]$Test)
    try {
        & $Test
        $script:zdane++
        Write-Host "  [ok] $Opis" -ForegroundColor Green
    } catch {
        $script:bledy++
        Write-Host "  [x]  $Opis" -ForegroundColor Red
        Write-Host "       $($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

function Zaloz {
    param([Parameter(Mandatory)][bool]$Warunek, [string]$Komunikat = "warunek nie jest spełniony")
    if (-not $Warunek) { throw $Komunikat }
}

Write-Host ""
Write-Host "Testy instalatora WERTIS" -ForegroundColor Cyan
Write-Host ""

# ── Ścieżki ─────────────────────────────────────────────────────────────────
# Dokładnie ta awaria, którą zgłosił klient.

Write-Host "Zapewnij-Katalog"

Sprawdz "korzeń dysku nie wywraca instalacji (awaria z 27.07)" {
    # Split-Path "C:\wertis" → "C:\", a New-Item na korzeniu dysku rzuca
    # „Ścieżka ma niedozwolony format". Ten test istnieje, bo instalator
    # wywalał się na tym u KAŻDEGO, kto uruchomił go bez -Katalog.
    $korzen = if ($IsWindows -or $null -eq $IsWindows) { "C:\" } else { "/" }
    Zapewnij-Katalog $korzen
}

Sprawdz "istniejący katalog przechodzi bez zmian" {
    $tmp = [System.IO.Path]::GetTempPath()
    Zapewnij-Katalog $tmp
    Zaloz (Test-Path $tmp) "katalog tymczasowy zniknął"
}

Sprawdz "nieistniejący katalog powstaje, także z brakującym rodzicem" {
    $nowy = Join-Path ([System.IO.Path]::GetTempPath()) ("wertis-test-" + [guid]::NewGuid().ToString("N").Substring(0, 8) + "\a\b")
    Zapewnij-Katalog $nowy
    Zaloz (Test-Path $nowy) "katalog nie powstał"
    Remove-Item (Split-Path (Split-Path $nowy)) -Recurse -Force -ErrorAction SilentlyContinue
}

Sprawdz "pusta ścieżka nie rzuca — Split-Path bywa pusty" {
    Zapewnij-Katalog ""
}

# ── Identyfikatory SQL ──────────────────────────────────────────────────────
# Wchodzą do DDL przez sklejanie tekstu, bo parametrów w DDL nie ma.

Write-Host ""
Write-Host "Assert-BezpiecznyIdentyfikator"

Sprawdz "poprawna nazwa kolumny przechodzi" {
    Zaloz ((Assert-BezpiecznyIdentyfikator -Nazwa "tw_Pole1") -eq "tw_Pole1")
}

foreach ($zly in @("tw_Pole1; DROP TABLE tw__Towar", "tw Pole1", "1kolumna", "", "tw_Pole1'")) {
    Sprawdz "odrzuca: $zly" {
        $poszlo = $false
        try { [void](Assert-BezpiecznyIdentyfikator -Nazwa $zly); $poszlo = $true } catch { }
        Zaloz (-not $poszlo) "niebezpieczny identyfikator przeszedł walidację"
    }
}

# ── Hasło konta aplikacji ───────────────────────────────────────────────────
# Trafia do literału SQL, do wertis.env i do środowiska — trzy różne składnie.

Write-Host ""
Write-Host "New-WertisHaslo"

Sprawdz "ma zadaną długość" {
    Zaloz ((New-WertisHaslo -Dlugosc 24).Length -eq 24)
}

Sprawdz "spełnia CHECK_POLICY: cztery kategorie znaków" {
    # 20 losowań, bo to generator — pojedyncze trafienie niczego nie dowodzi
    1..20 | ForEach-Object {
        $h = New-WertisHaslo
        Zaloz ($h -cmatch "[A-Z]") "brak wielkiej litery"
        Zaloz ($h -cmatch "[a-z]") "brak małej litery"
        Zaloz ($h -match "[0-9]") "brak cyfry"
        Zaloz ($h -match "[-_=+@#*?]") "brak znaku specjalnego"
    }
}

Sprawdz "nie zawiera znaków, które psują wertis.env, bash ani literał SQL" {
    1..20 | ForEach-Object {
        $h = New-WertisHaslo
        Zaloz (-not ($h -match "['`"``\s\$;&|<>%^\\]")) "hasło zawiera znak o znaczeniu składniowym: $h"
    }
}

Sprawdz "dwa kolejne hasła się różnią" {
    Zaloz ((New-WertisHaslo) -ne (New-WertisHaslo))
}

# ── Skrypt uprawnień (etap 4) ───────────────────────────────────────────────
# Sedno całego etapu: uprawnienia KOLUMNOWE, zero praw do dok__Dokument.

Write-Host ""
Write-Host "Get-WertisSkryptUprawnien"

$skrypt = Get-WertisSkryptUprawnien -Baza "FIRMA_TEST" -KolumnaLokalizacji "tw_Pole3" -Haslo "Abc-123xyz"

Sprawdz "podstawia wybraną kolumnę do grantu kolumnowego" {
    Zaloz ($skrypt -match "GRANT UPDATE ON dbo\.tw__Towar \(tw_Pole3\)") "brak grantu na wybraną kolumnę"
}

Sprawdz "nadaje SELECT na siedmiu tabelach" {
    $ile = ([regex]::Matches($skrypt, "GRANT SELECT ON")).Count
    Zaloz ($ile -eq 7) "GRANT SELECT jest $ile razy, ma być 7"
}

Sprawdz "NIE nadaje żadnego prawa zapisu do dok__Dokument" {
    # Gdyby to kiedyś wpadło do skryptu, cały sens ograniczenia przepada,
    # a nikt by tego nie zauważył — aplikacja działałaby tak samo.
    Zaloz (-not ($skrypt -match "(INSERT|UPDATE|DELETE)[^;]*dok__Dokument")) "skrypt daje prawo zapisu do dokumentów"
}

Sprawdz "używa nazwy bazy podanej przez kreator" {
    Zaloz ($skrypt -match "USE \[FIRMA_TEST\]")
}

Sprawdz "odrzuca wstrzyknięcie przez nazwę kolumny" {
    $poszlo = $false
    try {
        [void](Get-WertisSkryptUprawnien -Baza "X" -KolumnaLokalizacji "tw_Pole1) TO wertis; DROP TABLE tw__Towar --" -Haslo "A")
        $poszlo = $true
    } catch { }
    Zaloz (-not $poszlo) "nazwa kolumny z wstrzyknięciem przeszła do DDL"
}

Sprawdz "podwaja apostrof w haśle, żeby nie rozerwać literału" {
    $s = Get-WertisSkryptUprawnien -Baza "X" -KolumnaLokalizacji "tw_Pole1" -Haslo "a'b"
    Zaloz ($s -match "PASSWORD = 'a''b'") "apostrof w haśle nie został podwojony"
}

# ── Wynik ───────────────────────────────────────────────────────────────────

Write-Host ""
if ($script:bledy) {
    Write-Host "$($script:zdane) zdanych, $($script:bledy) NIEZDANYCH" -ForegroundColor Red
    exit 1
}
Write-Host "$($script:zdane) zdanych, 0 niezdanych" -ForegroundColor Green
exit 0
