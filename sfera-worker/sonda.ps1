# Sonda Sfery - wypisuje model obiektowy Subiekta, NIE wystawia dokumentow.
#
# Powod: lista [WERYFIKUJ] w README.md ma osiem punktow, a kazda pomylka w nazwie
# wychodzi dzis dopiero w trakcie wystawiania dokumentu - czyli po przebudowaniu
# exe na maszynie z .NET SDK, skopiowaniu go i restarcie uslugi. Jeden przebieg
# tej sondy zamyka cala liste, bez SDK i bez sladu w bazie.
#
# Sonda NICZEGO NIE ZAPISUJE. Otwiera sesje, czyta nazwy skladowych i konczy
# prace. Zadnego Dodaj*, zadnego Zapisz().
#
# Uzycie (PowerShell na maszynie z Subiektem GT i Sfera):
#   powershell -NoProfile -ExecutionPolicy Bypass -File sfera-worker\sonda.ps1
#   powershell ... -File sonda.ps1 -PlikEnv C:\wertis\wertis.env -Wynik C:\wertis\sonda.txt
#
# Wynik idzie na ekran I do pliku - plik jest tym, co wraca do repozytorium
# jako wypelniona lista [WERYFIKUJ].
#
# ASCII bez polskich znakow jest tu SWIADOME: konsola Windows w domyslnym
# kodowaniu zamienia je w krzaki, a to jest narzedzie diagnostyczne czytane
# wlasnie w konsoli. Reszta repo pisze po polsku z ogonkami.

param(
    [string]$PlikEnv = "",
    [string]$Wynik = "sonda-sfery.txt"
)

$ErrorActionPreference = "Continue"

# --- wertis.env: te same reguly co EnvFile.cs (export, cudzyslowy, komentarze) ---
function Wczytaj-Env([string]$sciezka) {
    $mapa = @{}
    if (-not (Test-Path $sciezka)) { return $mapa }
    foreach ($surowa in (Get-Content -LiteralPath $sciezka -Encoding UTF8)) {
        $linia = $surowa.Trim()
        if ($linia.Length -eq 0 -or $linia.StartsWith("#")) { continue }
        $m = [regex]::Match($linia, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
        if (-not $m.Success) { continue }
        $wartosc = $m.Groups[2].Value
        if ($wartosc.Length -gt 0 -and ($wartosc[0] -eq '"' -or $wartosc[0] -eq "'")) {
            $cudzyslow = $wartosc[0]
            $koniec = $wartosc.IndexOf($cudzyslow, 1)
            if ($koniec -eq -1) { $wartosc = $wartosc.Substring(1) }
            else { $wartosc = $wartosc.Substring(1, $koniec - 1) }
        } else {
            $wartosc = ([regex]::Replace($wartosc, '\s+#.*$', '')).Trim()
        }
        $mapa[$m.Groups[1].Value] = $wartosc
    }
    return $mapa
}

function Klucz($mapa, [string]$nazwa, [string]$domyslna = "") {
    if ($mapa.ContainsKey($nazwa) -and $mapa[$nazwa].Length -gt 0) { return $mapa[$nazwa] }
    return $domyslna
}

# Nazwy skladowych obiektu COM. Get-Member na IDispatch dziala tylko wtedy, gdy
# obiekt oddaje informacje o typie; gdy nie odda, mowimy o tym wprost zamiast
# udawac pusta liste.
function Skladowe($obiekt, [string]$etykieta) {
    Write-Wynik ""
    Write-Wynik "--- $etykieta ---"
    try {
        $czlonkowie = $obiekt | Get-Member -ErrorAction Stop |
            Where-Object { $_.MemberType -ne "AliasProperty" } |
            ForEach-Object { "{0,-12} {1}" -f $_.MemberType, $_.Name }
        if ($czlonkowie) { $czlonkowie | ForEach-Object { Write-Wynik "  $_" } }
        else { Write-Wynik "  (obiekt nie oddal listy skladowych)" }
    } catch {
        Write-Wynik "  (Get-Member odmowil: $($_.Exception.Message))"
    }
}

# Czy obiekt zna nazwe - bez jej wywolywania. To jest caly sens sondy:
# odpowiedz TAK/NIE zamiast wystawionego dokumentu.
function Ma-Nazwe($obiekt, [string]$nazwa) {
    if ($null -eq $obiekt) { return $false }
    try { return ($obiekt | Get-Member -Name $nazwa -ErrorAction Stop) -ne $null }
    catch { return $false }
}

function Sprawdz-Nazwe($obiekt, [string]$sciezka, [int]$punkt) {
    $jest = Ma-Nazwe $obiekt $sciezka
    $znak = if ($jest) { "JEST " } else { "BRAK " }
    Write-Wynik ("  {0} {1,-42} (punkt {2} listy [WERYFIKUJ])" -f $znak, $sciezka, $punkt)
    return $jest
}

$script:linie = New-Object System.Collections.Generic.List[string]
function Write-Wynik([string]$tekst) {
    Write-Host $tekst
    $script:linie.Add($tekst) | Out-Null
}

# --- start ---------------------------------------------------------------
if ($PlikEnv -eq "") {
    $tu = Split-Path -Parent $MyInvocation.MyCommand.Path
    foreach ($kandydat in @((Join-Path $tu "wertis.env"), (Join-Path (Split-Path -Parent $tu) "wertis.env"), "wertis.env")) {
        if (Test-Path $kandydat) { $PlikEnv = $kandydat; break }
    }
}

Write-Wynik "=== Sonda Sfery === $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Wynik "wertis.env: $(if ($PlikEnv -ne '' -and (Test-Path $PlikEnv)) { (Resolve-Path $PlikEnv).Path } else { '(nie znaleziono - biore same domyslne)' })"

$env_ = Wczytaj-Env $PlikEnv
$progId = Klucz $env_ "SFERA_PROGID" "InsERT.GT"
$serwer = Klucz $env_ "MSSQL_SERVER" "localhost"
$instancja = Klucz $env_ "MSSQL_INSTANCE" "INSERTGT"
if (-not $serwer.Contains("\") -and $instancja -ne "" -and (Klucz $env_ "MSSQL_PORT") -eq "") {
    $serwer = "$serwer\$instancja"
}
$baza = Klucz $env_ "MSSQL_DATABASE"
$produkt = [int](Klucz $env_ "SFERA_PRODUKT" "1")
$autentykacja = [int](Klucz $env_ "SFERA_AUTENTYKACJA" "0")

Write-Wynik "ProgID=$progId  serwer=$serwer  baza=$baza  produkt=$produkt  autentykacja=$autentykacja"
Write-Wynik ""
Write-Wynik "PUNKT 1 - obiekt GT"

try {
    $gt = New-Object -ComObject $progId -ErrorAction Stop
} catch {
    Write-Wynik "  BRAK  COM '$progId' - Subiekt GT ze Sfera nie jest zainstalowany albo ProgID jest inny."
    Write-Wynik "        Sprawdz w rejestrze: Get-ChildItem 'HKLM:\SOFTWARE\Classes' -Name | Select-String '^InsERT'"
    $script:linie | Set-Content -LiteralPath $Wynik -Encoding UTF8
    Write-Host "`nWynik zapisany: $Wynik"
    exit 1
}
Write-Wynik "  JEST  COM '$progId' utworzony"
Skladowe $gt "GT - wlasciwosci logowania (punkty 1-3)"

Write-Wynik ""
Write-Wynik "PUNKT 2 - logowanie. Sonda ustawia wlasciwosci i probuje Uruchom()."
$gt.Produkt = $produkt
$gt.Serwer = $serwer
$gt.Baza = $baza
$gt.Autentykacja = $autentykacja
$loginSql = Klucz $env_ "SFERA_SQL_LOGIN"
if ($loginSql -ne "") {
    $gt.Uzytkownik = $loginSql
    $gt.UzytkownikHaslo = Klucz $env_ "SFERA_SQL_HASLO"
    Write-Wynik "  login SQL: $loginSql"
} else {
    Write-Wynik "  login SQL: (pusty - przy autentykacji mieszanej Sfera go WYMAGA, ustaw SFERA_SQL_LOGIN)"
}
$gt.Operator = Klucz $env_ "SFERA_OPERATOR"
$gt.OperatorHaslo = Klucz $env_ "SFERA_OPERATOR_HASLO"

# gtaUruchomDopasuj = 0x0; gtaUruchom (0x0) -bor gtaUruchomWTle (0x4) - bez okna
Write-Wynik ""
Write-Wynik "PUNKT 3 - Uruchom(0x0, 0x0 -bor 0x4)"
try {
    $sgt = $gt.Uruchom(0, (0 -bor 4))
    Write-Wynik "  JEST  sesja otwarta, bez okna"
} catch {
    Write-Wynik "  BRAK  Uruchom() odmowil: $($_.Exception.Message)"
    Write-Wynik "        Najczestsze przyczyny: zly login SQL, zly operator, inna wartosc Autentykacji"
    Write-Wynik "        (SFERA_AUTENTYKACJA - mieszana kontra Windows), brak licencji Sfery."
    $script:linie | Set-Content -LiteralPath $Wynik -Encoding UTF8
    Write-Host "`nWynik zapisany: $Wynik"
    exit 1
}

Skladowe $sgt "Subiekt - wszystkie skladowe"
Write-Wynik ""
Write-Wynik "--- Subiekt - same managery ---"
try {
    $sgt | Get-Member -ErrorAction Stop | Where-Object { $_.Name -like "*Manager*" } |
        ForEach-Object { Write-Wynik "  $($_.Name)" }
} catch {
    Write-Wynik "  (nie udalo sie odczytac: $($_.Exception.Message))"
}

Write-Wynik ""
Write-Wynik "PUNKTY 4-8 - nazwy, na ktorych stoi kod (sfera-worker/src/SferaComAdapter.cs)"
$magMenedzer = $null
$hanMenedzer = $null
if (Sprawdz-Nazwe $sgt "DokumentyMagazynoweManager" 4) {
    $magMenedzer = $sgt.DokumentyMagazynoweManager
    Skladowe $magMenedzer "DokumentyMagazynoweManager"
    Sprawdz-Nazwe $magMenedzer "DodajMM" 4 | Out-Null
    Sprawdz-Nazwe $magMenedzer "DodajRW" 8 | Out-Null
}
if (Sprawdz-Nazwe $sgt "DokumentyHandloweManager" 6) {
    $hanMenedzer = $sgt.DokumentyHandloweManager
    Skladowe $hanMenedzer "DokumentyHandloweManager"
    Sprawdz-Nazwe $hanMenedzer "DodajKorekte" 6 | Out-Null
}

Write-Wynik ""
Write-Wynik "Czego sonda NIE rozstrzyga, bo wymaga wystawienia dokumentu:"
Write-Wynik "  - punkt 5: czy Zapisz() daje dokument WYKONANY, czy odklada do bufora"
Write-Wynik "  - nazwy wlasciwosci na SAMYM dokumencie (MagazynZrodlowyId, Pozycje.Dodaj,"
Write-Wynik "    IloscJm, NumerPelny, IloscPoKorekcie, Usun) - te widac dopiero na obiekcie"
Write-Wynik "    dokumentu, a ten powstaje przez Dodaj*, czego sonda nie robi z zalozenia."
Write-Wynik "    Zamyka je bramka 2 z docs/wdrozenie.md: jedno MM na kartotece probnej."
Write-Wynik ""
Write-Wynik "Nastepny krok: wpisz ustalenia do docs/sfera-com.md i zdejmij zamkniete"
Write-Wynik "znaczniki [WERYFIKUJ] z sfera-worker/README.md."

$script:linie | Set-Content -LiteralPath $Wynik -Encoding UTF8
Write-Host "`nWynik zapisany: $Wynik"
