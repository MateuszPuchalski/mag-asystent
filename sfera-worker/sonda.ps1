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

# Bez wertis.env sonda tez ma dzialac: na maszynie z Subiektem repozytorium
# stoi zwykle w katalogu domowym, a plik ustawien lezy w C:\wertis. Parametry
# nizej maja pierwszenstwo nad plikiem i pozwalaja odpalic sonde od reki.
param(
    [string]$PlikEnv = "",
    [string]$Wynik = "sonda-sfery.txt",
    [string]$Serwer = "",
    [string]$Baza = "",
    [string]$Operator = "",
    [string]$OperatorHaslo = "",
    [string]$LoginSql = "",
    [string]$HasloSql = ""
)

$ErrorActionPreference = "Continue"

# Nazwy zmiennych w PowerShellu NIE ROZROZNIAJA WIELKOSCI LITER: $Baza i $baza
# to jedna zmienna. Parametry przepisujemy wiec od razu pod wlasne nazwy, bo
# inaczej pozniejsze $baza = ... kasuje to, co podal czlowiek - po cichu,
# a sonda pokazuje puste pole i wysyla go do diagnozowania licencji.
$pSerwer = $Serwer
$pBaza = $Baza
$pOperator = $Operator
$pOperatorHaslo = $OperatorHaslo
$pLoginSql = $LoginSql
$pHasloSql = $HasloSql

# --- wertis.env: te same reguly co EnvFile.cs (export, cudzyslowy, komentarze) ---
function Wczytaj-Env([string]$sciezka) {
    $mapa = @{}
    # Pusta sciezka to normalny przypadek (brak wertis.env), a nie blad. Bez tego
    # warunku Test-Path wysypywal sie na pustym napisie i sonda zaczynala prace
    # od dwoch czerwonych scian tekstu, ktore z niczym nie mialy zwiazku.
    if ($sciezka -eq "" -or -not (Test-Path -LiteralPath $sciezka)) { return $mapa }
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

# Szukanie idzie W GORE, katalog po katalogu, az do korzenia dysku - ta sama
# regula co w Node i w EnvFile.cs. Jeden poziom nie wystarczy: repozytorium bywa
# rozpakowane glebiej, a plik lezy przy jego korzeniu albo w C:\wertis.
function Kandydaci([string]$start) {
    $lista = New-Object System.Collections.Generic.List[string]
    $kat = $start
    while ($null -ne $kat -and $kat -ne "") {
        $lista.Add((Join-Path $kat "wertis.env")) | Out-Null
        $rodzic = Split-Path -Parent $kat
        if ($rodzic -eq $kat) { break }
        $kat = $rodzic
    }
    return $lista
}

$sprawdzone = New-Object System.Collections.Generic.List[string]
if ($PlikEnv -eq "") {
    # $PSScriptRoot to droga kanoniczna i ZAWSZE ustawiona dla skryptu.
    # $MyInvocation.MyCommand.Path bywa pusty zaleznie od sposobu uruchomienia,
    # a wtedy cala lista kandydatow cicho degeneruje sie do katalogu biezacego.
    $tu = $PSScriptRoot
    if ($null -eq $tu -or $tu -eq "") {
        $tu = Split-Path -Parent $MyInvocation.MyCommand.Path
    }
    if ($null -eq $tu -or $tu -eq "") { $tu = (Get-Location).Path }
    foreach ($kandydat in @(Kandydaci $tu) + @(Kandydaci (Get-Location).Path) + @("C:\wertis\wertis.env")) {
        if ($sprawdzone -contains $kandydat) { continue }
        $sprawdzone.Add($kandydat) | Out-Null
        if ($PlikEnv -eq "" -and (Test-Path -LiteralPath $kandydat)) { $PlikEnv = $kandydat }
    }
}

Write-Wynik "=== Sonda Sfery === $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
if ($PlikEnv -ne "" -and (Test-Path -LiteralPath $PlikEnv)) {
    Write-Wynik "wertis.env: $((Resolve-Path $PlikEnv).Path)"
} else {
    # Cisza „nie znaleziono" kosztuje kwadrans zgadywania, wiec sonda pokazuje
    # WPROST, gdzie zagladala. Najczestsza przyczyna to Notatnik, ktory zapisuje
    # plik jako wertis.env.txt, a Eksplorator ukrywa to rozszerzenie.
    Write-Wynik "wertis.env: NIE ZNALEZIONY - biore parametry i domyslne. Szukalem tutaj:"
    foreach ($s in $sprawdzone) { Write-Wynik "            $s" }
    Write-Wynik "            (wskaz wprost: -PlikEnv C:\sciezka\wertis.env)"
}

$env_ = Wczytaj-Env $PlikEnv
$progId = Klucz $env_ "SFERA_PROGID" "InsERT.GT"
$serwer = Klucz $env_ "MSSQL_SERVER" "localhost"
$instancja = Klucz $env_ "MSSQL_INSTANCE" "INSERTGT"
if (-not $serwer.Contains("\") -and $instancja -ne "" -and (Klucz $env_ "MSSQL_PORT") -eq "") {
    $serwer = "$serwer\$instancja"
}
$baza = Klucz $env_ "MSSQL_DATABASE"
# Parametry biora gore nad plikiem - ta sama semantyka co zmienne srodowiskowe
# w workerze (zmienna wygrywa z wertis.env).
if ($pSerwer -ne "") { $serwer = $pSerwer }
if ($pBaza -ne "") { $baza = $pBaza }
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

# ProduktEnum bez logowania: `ProduktNazwa` czyta sie po samym ustawieniu
# `Produkt`, wiec numer gtaProduktSubiekt daje sie potwierdzic tu i teraz.
# Producent publikuje nazwy stalych, nie ich wartosci - to jest droga naokolo.
Write-Wynik ""
Write-Wynik "PUNKT 1b - ktora liczba znaczy Subiekt (ProduktEnum)"
foreach ($i in 0..8) {
    try {
        $gt.Produkt = $i
        $nazwa = $gt.ProduktNazwa
        if ("$nazwa" -ne "") { Write-Wynik ("  Produkt={0} -> {1}" -f $i, $nazwa) }
    } catch {
        # wartosc spoza zakresu - normalne, nie ma czego zglaszac
    }
}

Write-Wynik ""
Write-Wynik "PUNKT 2 - logowanie. Sonda ustawia wlasciwosci i probuje Uruchom()."
$loginSql = if ($pLoginSql -ne "") { $pLoginSql } else { Klucz $env_ "SFERA_SQL_LOGIN" }
$hasloSql = if ($pHasloSql -ne "") { $pHasloSql } else { Klucz $env_ "SFERA_SQL_HASLO" }
$operator = if ($pOperator -ne "") { $pOperator } else { Klucz $env_ "SFERA_OPERATOR" }
$operatorHaslo = if ($pOperatorHaslo -ne "") { $pOperatorHaslo } else { Klucz $env_ "SFERA_OPERATOR_HASLO" }

# Bez nazwy bazy Uruchom() i tak padnie, tylko kodem HRESULT zamiast zdaniem.
# Odmowa TUTAJ jest tansza: mowi, czego brakuje, zanim ktos zacznie diagnozowac
# licencje Sfery.
if ($baza -eq "") {
    Write-Wynik "  BRAK  nie znam nazwy bazy podmiotu - bez niej nie ma do czego sie logowac."
    Write-Wynik "        Wskaz plik:      -PlikEnv C:\wertis\wertis.env"
    Write-Wynik "        albo podaj wprost: -Baza NAZWA_PODMIOTU -Operator Szef -LoginSql sa -HasloSql ***"
    Write-Wynik "        Nazwa podmiotu stoi na pasku tytulu Subiekta."
    $script:linie | Set-Content -LiteralPath $Wynik -Encoding UTF8
    Write-Host "`nWynik zapisany: $Wynik"
    exit 1
}

$gt.Produkt = $produkt
$gt.Serwer = $serwer
$gt.Baza = $baza
$gt.Autentykacja = $autentykacja
if ($loginSql -ne "") {
    $gt.Uzytkownik = $loginSql
    $gt.UzytkownikHaslo = $hasloSql
    Write-Wynik "  login SQL: $loginSql"
} else {
    Write-Wynik "  login SQL: (pusty - przy autentykacji mieszanej Sfera go WYMAGA, ustaw SFERA_SQL_LOGIN)"
}
$gt.Operator = $operator
$gt.OperatorHaslo = $operatorHaslo
Write-Wynik "  operator Subiekta: $(if ($operator -ne '') { $operator } else { '(pusty)' })"

# gtaUruchomDopasuj = 0x0; gtaUruchom (0x0) -bor gtaUruchomWTle (0x4) - bez okna
Write-Wynik ""
Write-Wynik "PUNKT 3 - Uruchom(0x0, 0x0 -bor 0x4)"

$sgt = $null
$ostatniBlad = $null

# Wartosci AutentykacjaEnum nie sa opublikowane, a instalacje roznia sie trybem:
# jedna loguje sie do SQL loginem, druga kontem Windows. Zamiast kazac zgadywac,
# sonda probuje obu wartosci i mowi, ktora dziala. Dwie proby, nie petla - konta
# SQL potrafia sie blokowac po serii nieudanych logowan.
foreach ($aut in @($autentykacja, $(if ($autentykacja -eq 0) { 1 } else { 0 }))) {
    if ($null -ne $sgt) { break }
    try {
        $gt.Autentykacja = $aut
        $sgt = $gt.Uruchom(0, (0 -bor 4))
        Write-Wynik "  JEST  sesja otwarta, bez okna (Autentykacja=$aut)"
        if ($aut -ne $autentykacja) {
            Write-Wynik "        WPISZ TO DO wertis.env: SFERA_AUTENTYKACJA=$aut"
        }
    } catch {
        $ostatniBlad = $_
        Write-Wynik "  BRAK  Autentykacja=$aut odmowila: $($_.Exception.Message)"
    }
}

if ($null -eq $sgt) {
    $hr = 0
    try { $hr = $ostatniBlad.Exception.HResult } catch { }
    $hex = "0x{0:X8}" -f $hr
    Write-Wynik ""
    Write-Wynik "  BRAK  sesji przy obu wartosciach Autentykacji. Ostatni kod: $hex"
    Write-Wynik ""
    Write-Wynik "        NIE CZYTAJ TRESCI KOMUNIKATU DOSLOWNIE. Kody 0x8004xxxx sa"
    Write-Wynik "        interfejsowe: znaczenie nadaje im biblioteka, ktora je zwrocila."
    Write-Wynik "        Windows dokleja do nich opis Harmonogramu zadan, wiec zdanie"
    Write-Wynik "        o 'aparacie planowania' nie ma ze Sfera nic wspolnego."
    if ($hex -eq "0x80041329") {
        Write-Wynik ""
        Write-Wynik "        0x80041329 u Sfery znaczy co innego: HASLO LOGINU SQL zaczyna sie"
        Write-Wynik "        od cyfry albo od litery a-f. Zmien je na zaczynajace sie od g-z."
        Write-Wynik "        Ten sam kod dostaniesz przy pustym lub blednym loginie SQL."
    }
    Write-Wynik ""
    Write-Wynik "        Login SQL to NIE jest login do Subiekta. Operator ('Szef') otwiera"
    Write-Wynik "        program, a Uzytkownik otwiera baze na SQL Serverze - normalnie"
    Write-Wynik "        podaje go sam Subiekt z ustawien podmiotu, wiec nikt go nie wpisuje."
    Write-Wynik "        Przy autentykacji Windows loginu SQL nie ma wcale."
    Write-Wynik ""
    Write-Wynik "        Pozostale czeste przyczyny: zly operator Subiekta albo jego haslo,"
    Write-Wynik "        zla nazwa podmiotu, brak licencji Sfery na tym podmiocie."
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
