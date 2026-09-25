<#
.SYNOPSIS
    Wykonawca zlecenia aktualizacji z panelu (0.492.0).

.DESCRIPTION
    Uruchamia go zadanie Harmonogramu „WERTIS aktualizacja", jako SYSTEM, po
    kliknięciu w panelu. Serwer zostawia zlecenie w
    `server\data\aktualizacja\zlecenie.json` i woła `schtasks /run` — nic
    więcej. Wszystko, co wykonawcze, dzieje się tutaj, poza procesem serwera.

    Dlaczego nie sam serwer: `-Aktualizuj` zatrzymuje usługę `wertis-api`,
    a NSSM przy zatrzymaniu kończy całe drzewo procesów usługi. Aktualizacja
    uruchomiona przez serwer zginęłaby w połowie, razem z nim.

    Zlecenie jest DANYMI, nie poleceniem. Numer wersji przechodzi przez wąski
    wzorzec, zanim trafi do instalatora; reszta pól idzie tylko do stanu.
    Plik zlecenia znika przed pracą, więc drugie uruchomienie zadania nie
    powtórzy aktualizacji.

    Dziennik pisze się POZA katalogiem danych, do %TEMP%, i trafia do
    `server\data\aktualizacja\ostatnia.log` dopiero na końcu. Pierwsza
    aktualizacja z paczki przenosi `server\data` poza katalog aplikacji,
    a Windows nie przeniesie katalogu z otwartym w nim plikiem.
#>
$ErrorActionPreference = "Stop"

$katalog = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dir = Join-Path $katalog "server\data\aktualizacja"
$plikZlecenia = Join-Path $dir "zlecenie.json"
$plikStanu = Join-Path $dir "stan.json"
# Bieżący krok dla paska w panelu (@wydanie) — pisze go instalator.
$plikPostepu = Join-Path $dir "postep.json"
$robocze = Join-Path $env:TEMP "wertis-aktualizacja"
$dziennikRoboczy = Join-Path $env:TEMP "wertis-aktualizacja.log"
$teraz = { (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ") }

function Zapisz-Stan([hashtable]$Stan) {
    # Przez plik tymczasowy: serwer czyta ten plik przy starcie i w trakcie,
    # a połowa JSON-a to stan, którego nie da się przeczytać wcale.
    $tmp = "$plikStanu.tmp"
    ($Stan | ConvertTo-Json) | Set-Content -LiteralPath $tmp -Encoding UTF8
    Move-Item -LiteralPath $tmp -Destination $plikStanu -Force
}

if (-not (Test-Path -LiteralPath $plikZlecenia)) { exit 0 }
$zlecenie = Get-Content -LiteralPath $plikZlecenia -Raw -Encoding UTF8 | ConvertFrom-Json
Remove-Item -LiteralPath $plikZlecenia -Force

$wersja = [string]$zlecenie.wersja
$kto = [string]$zlecenie.kto
$od = & $teraz
# `\z`, nie `$` — ten sam powód co w ConvertTo-WertisWersja (paczka.ps1).
if ($wersja -notmatch '^\d{1,4}\.\d{1,5}\.\d{1,6}\z') {
    Zapisz-Stan @{ etap = "blad"; wersja = $wersja; kto = $kto; od = $od; do = (& $teraz)
                   komunikat = "Zlecenie bez poprawnego numeru wersji." }
    exit 1
}
# Krok z poprzedniej aktualizacji pokazałby się na pasku nowej, zanim
# instalator zapisze pierwszy własny.
Remove-Item -LiteralPath $plikPostepu -Force -ErrorAction SilentlyContinue
Zapisz-Stan @{ etap = "trwa"; wersja = $wersja; kto = $kto; od = $od }

# Port i instancja z wertis.env tej instalacji — zadanie nie ma argumentów.
$port = 3001; $dev = $false
$plikEnv = Join-Path $katalog "wertis.env"
if (Test-Path -LiteralPath $plikEnv) {
    foreach ($l in Get-Content -LiteralPath $plikEnv -Encoding UTF8) {
        if ($l -match '^\s*(?:export\s+)?PORT\s*=\s*"?(\d+)"?') { $port = [int]$Matches[1] }
        if ($l -match '^\s*(?:export\s+)?SRODOWISKO\s*=\s*"?dev"?\s*$') { $dev = $true }
    }
}

# Instalator z KOPII w %TEMP%: katalog aplikacji zmieni za chwilę nazwę,
# a skrypt uruchomiony z jego wnętrza stałby w nim do końca.
if (Test-Path -LiteralPath $robocze) { Remove-Item -LiteralPath $robocze -Recurse -Force }
New-Item -ItemType Directory -Path $robocze | Out-Null
Copy-Item -Path (Join-Path $katalog "instalator\*.ps1") -Destination $robocze
Set-Location $env:TEMP

$argumenty = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $robocze "wertis-instalator.ps1"),
               "-Aktualizuj", "-Paczka", $wersja, "-Katalog", $katalog, "-Port", "$port",
               "-PlikPostepu", $plikPostepu)
if ($dev) { $argumenty += "-Dev" }
& powershell.exe @argumenty *> $dziennikRoboczy
$kod = $LASTEXITCODE

Copy-Item -LiteralPath $dziennikRoboczy -Destination (Join-Path $dir "ostatnia.log") -Force -ErrorAction SilentlyContinue
Zapisz-Stan @{ etap = $(if ($kod -eq 0) { "gotowe" } else { "blad" }); wersja = $wersja; kto = $kto
               od = $od; do = (& $teraz); kod = $kod }
exit $kod
