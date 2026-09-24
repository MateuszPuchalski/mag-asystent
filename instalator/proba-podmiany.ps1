<#
.SYNOPSIS
    Prawdziwa podmiana katalogów i wycofanie na Windowsie, bez usług (0.492.0).

.DESCRIPTION
    `testy.ps1` sprawdza logikę, a `-DryRun` przebieg sterowania. Żadne z nich
    nie przenosi katalogu danych, nie zakłada dowiązania i nie zamienia nazw.
    A to są dokładnie kroki, które przy błędzie zostawiają serwer bez danych.

    Ten skrypt robi to naprawdę, na podrobionej instalacji w katalogu TEMP:
    1. udana aktualizacja: mała atrapa /api/health podaje nową wersję;
    2. nieudana: nikt nie odpowiada, więc instalator musi wszystko cofnąć,
       razem z bazą z kopii sprzed migracji.

    Usług nie ma i nie trzeba ich mieć: instalator pomija nieistniejące.
    Pobierania APK też nie ma, bo atrapa `Get-WertisApk` stoi niżej.

    Uruchomienie (CI, zadanie instalatora): powershell -File .\proba-podmiany.ps1
    Wymaga Node w PATH, bo atrapa zdrowia to trzy linijki JavaScriptu.
#>
$ErrorActionPreference = "Stop"
$zrodlo = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $zrodlo "ui.ps1")
. (Join-Path $zrodlo "sql.ps1")
. (Join-Path $zrodlo "uslugi.ps1")
. (Join-Path $zrodlo "paczka.ps1")
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Po udanej aktualizacji instalator dociąga APK z prawdziwych wydań. Tu nie
# ma czego ściągać, a sieć w tej próbie tylko by ją rozchwiała.
function Get-WertisApk { param($Katalog, $Wersja) return $true }

$PORT = 39124
$korzen = Join-Path ([IO.Path]::GetTempPath()) ("wertis-podmiana-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
$k = Join-Path $korzen "wertis"
$dane = "$k-dane"
New-Item -ItemType Directory -Path $korzen | Out-Null

function Zaloz([bool]$Warunek, [string]$Opis) {
    if (-not $Warunek) { throw "NIE: $Opis" }
    Write-Host "  [ok] $Opis" -ForegroundColor Green
}
function Tresc([string]$Sciezka) { (Get-Content -LiteralPath $Sciezka -Raw).Trim() }

function Nowa-Paczka([string]$Wersja) {
    $src = Join-Path $korzen "zrodlo\wertis-$Wersja"
    New-Item -ItemType Directory -Force -Path (Join-Path $src "server\dist") | Out-Null
    Set-Content -LiteralPath (Join-Path $src "paczka.json") -Value "{`"wersja`": `"$Wersja`"}"
    Set-Content -LiteralPath (Join-Path $src "package.json") -Value "{`"version`": `"$Wersja`"}"
    Set-Content -LiteralPath (Join-Path $src "server\dist\index.js") -Value "// atrapa"
    $zip = Join-Path $korzen "wertis-$Wersja.zip"
    # includeBaseDirectory: ZIP z CI ma w środku katalog wertis-<wersja>\.
    [IO.Compression.ZipFile]::CreateFromDirectory($src, $zip, [IO.Compression.CompressionLevel]::Fastest, $true)
    $suma = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    Set-Content -LiteralPath "$zip.sha256" -Value "$suma  wertis-$Wersja.zip"
    return $zip
}

function Atrapa-Zdrowia([string]$Wersja) {
    $js = Join-Path $korzen "zdrowie.js"
    Set-Content -LiteralPath $js -Value (
        "require('http').createServer((q, r) => { r.setHeader('content-type', 'application/json');" +
        " r.end(JSON.stringify({ ok: true, wersja: '$Wersja' })); }).listen($PORT);")
    # Bez adresu w listen(): Node słucha wtedy na IPv4 i IPv6 naraz. Windows
    # rozwiązuje `localhost` najpierw na ::1, a sama 127.0.0.1 kończyła każde
    # pytanie odmową po IPv6 i czekaniem dłuższym niż limit próby.
    $p = Start-Process -FilePath "node" -ArgumentList "`"$js`"" -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        try { Invoke-RestMethod "http://localhost:$PORT/api/health" -TimeoutSec 5 | Out-Null; return $p } catch { Start-Sleep -Milliseconds 500 }
    }
    throw "Atrapa zdrowia nie wstała."
}

$wynik = 0
try {
    # ── Podrobiona instalacja z Gita: dane w środku, jak przed 0.492.0 ──────
    New-Item -ItemType Directory -Force -Path (Join-Path $k "server\data"), (Join-Path $k "logs") | Out-Null
    Set-Content -LiteralPath (Join-Path $k "package.json") -Value '{"version": "9.0.0"}'
    Set-Content -LiteralPath (Join-Path $k "wertis.env") -Value "export PORT=$PORT"
    Set-Content -LiteralPath (Join-Path $k "logs\wertis-api.log") -Value "stary dziennik"
    Set-Content -LiteralPath (Join-Path $k "znak-starej.txt") -Value "stara"
    Set-Content -LiteralPath (Join-Path $k "server\data\wertis.db") -Value "baza firmy"

    Write-Host "`n1. Udana aktualizacja 9.0.0 -> 9.1.0" -ForegroundColor Cyan
    $zip = Nowa-Paczka "9.1.0"
    $atrapa = Atrapa-Zdrowia "9.1.0"
    try {
        $kod = Update-WertisZPaczki -Katalog $k -Repo "https://github.com/a/b.git" -Paczka $zip `
            -Uslugi @("wertis-proba-brak") -Port $PORT
    } finally { Stop-Process -Id $atrapa.Id -Force -ErrorAction SilentlyContinue }
    Zaloz ($kod -eq 0) "kod wyjścia 0 (dostałem $kod)"
    Zaloz ((Tresc (Join-Path $k "paczka.json")) -match '9\.1\.0') "w katalogu aplikacji stoi nowa wersja"
    Zaloz (-not (Test-Path (Join-Path $k "znak-starej.txt"))) "stare pliki nie przeciekły do nowej wersji"
    Zaloz (Test-Path (Join-Path "$k.poprzednia" "znak-starej.txt")) "poprzednia wersja leży obok"
    Zaloz (-not (Test-Path "$k.nowa")) "katalog roboczy .nowa zniknął"
    Zaloz (Test-WertisDowiazanie -Sciezka (Join-Path $k "server\data")) "server\data jest dowiązaniem"
    Zaloz ((Tresc (Join-Path $dane "wertis.db")) -eq "baza firmy") "baza przeniesiona, nie skopiowana od nowa"
    Zaloz ((Tresc (Join-Path $k "server\data\wertis.db")) -eq "baza firmy") "baza widoczna przez dowiązanie"
    Zaloz ((Tresc (Join-Path $k "wertis.env")) -match "PORT=$PORT") "wertis.env przeszedł do nowej wersji"
    Zaloz (Test-Path (Join-Path $k "logs\wertis-api.log")) "dzienniki przeszły do nowej wersji"

    Write-Host "`n2. Nieudana aktualizacja 9.1.0 -> 9.2.0: wycofanie z bazą" -ForegroundColor Cyan
    # Stan po migracji, którą zdążyła zrobić nowa wersja, i kopia sprzed niej.
    New-Item -ItemType Directory -Force -Path (Join-Path $dane "kopie") | Out-Null
    Set-Content -LiteralPath (Join-Path $dane "kopie\przed-20260924-100000-9.1.0-do-9.2.0.db") -Value "baza sprzed migracji"
    Set-Content -LiteralPath (Join-Path $dane "wertis.db") -Value "baza po migracji"
    Set-Content -LiteralPath (Join-Path $dane "wertis.db-wal") -Value "dziennik po migracji"
    $zip = Nowa-Paczka "9.2.0"
    # Bez atrapy nikt nie odpowiada — instalator czeka pełny limit i cofa.
    $kod = Update-WertisZPaczki -Katalog $k -Repo "https://github.com/a/b.git" -Paczka $zip `
        -Uslugi @("wertis-proba-brak") -Port $PORT
    Zaloz ($kod -eq 1) "kod wyjścia 1 (dostałem $kod)"
    Zaloz ((Tresc (Join-Path $k "paczka.json")) -match '9\.1\.0') "na miejscu znowu 9.1.0"
    Zaloz ((Tresc (Join-Path "$k.nieudana-9.2.0" "paczka.json")) -match '9\.2\.0') "nieudana wersja zostaje do obejrzenia"
    Zaloz ((Tresc (Join-Path $dane "wertis.db")) -eq "baza sprzed migracji") "baza wróciła z kopii sprzed migracji"
    Zaloz ((Tresc (Join-Path $dane "wertis.db.nieudana-9.2.0")) -eq "baza po migracji") "baza po migracji odłożona, nie skasowana"
    Zaloz (-not (Test-Path (Join-Path $dane "wertis.db-wal"))) "dziennik WAL nowej wersji usunięty"
    Zaloz (Test-WertisDowiazanie -Sciezka (Join-Path $k "server\data")) "dowiązanie danych przetrwało wycofanie"

    # Druga i trzecia udana aktualizacja: trzecia kasuje `.poprzednia`, która ma
    # już w sobie dowiązanie. Tu PowerShell 5.1 potrafił skasować cel dowiązania.
    foreach ($w in @("9.3.0", "9.4.0")) {
        Write-Host "`n3. Kolejna udana aktualizacja do $w" -ForegroundColor Cyan
        $zip = Nowa-Paczka $w
        $atrapa = Atrapa-Zdrowia $w
        try {
            $kod = Update-WertisZPaczki -Katalog $k -Repo "https://github.com/a/b.git" -Paczka $zip `
                -Uslugi @("wertis-proba-brak") -Port $PORT
        } finally { Stop-Process -Id $atrapa.Id -Force -ErrorAction SilentlyContinue }
        Zaloz ($kod -eq 0) "kod wyjścia 0 (dostałem $kod)"
        Zaloz ((Tresc (Join-Path $dane "wertis.db")) -eq "baza sprzed migracji") "baza nietknięta po sprzątaniu starej wersji"
        Zaloz (Test-Path (Join-Path $dane "kopie")) "kopie bazy nietknięte"
    }
} catch {
    Write-Host "  [x]  $($_.Exception.Message)" -ForegroundColor Red
    $wynik = 1
} finally {
    # Dowiązania najpierw — ten sam powód co w Remove-WertisKatalogAplikacji.
    Get-ChildItem -LiteralPath $korzen -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-WertisKatalogAplikacji -Sciezka $_.FullName
    }
    Remove-Item -LiteralPath $korzen -Recurse -Force -ErrorAction SilentlyContinue
}
if ($wynik) { Write-Host "`nPróba podmiany: NIEUDANA" -ForegroundColor Red } else { Write-Host "`nPróba podmiany: OK" -ForegroundColor Green }
exit $wynik
