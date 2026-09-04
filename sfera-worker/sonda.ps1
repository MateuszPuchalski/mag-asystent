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
    [string]$HasloSql = "",
    # Trzecia proba logowania, z WIDOCZNYM oknem Subiekta. Rozstrzyga, czy
    # blokuje tryb w tle, czy dane logowania. Domyslnie wylaczona, bo otwiera
    # okno na pulpicie.
    [switch]$ZOknem
)

$ErrorActionPreference = "Continue"

# Nazwy produktow wracaja ze Sfery po polsku. Konsola Windows w stronie kodowej
# 852 robi z nich krzaki - „Biuro" wygladalo jak „?????e" i wygladalo na blad
# odczytu, ktorym nie bylo. Ustawienie jest kosmetyczne, wiec porazka nie ma
# prawa zatrzymac diagnozy.
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

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
        # Definicja METODY niesie liste argumentow, a to jest jedyna rzecz,
        # ktorej sama nazwa nie zdradza. Bez niej wiadomo, ze DodajKFS istnieje,
        # ale nie wiadomo, czy bierze dok_Id, czy wczytany dokument - i zostaje
        # zgadywanie, czyli to, przed czym ta sonda ma bronic.
        $czlonkowie = $obiekt | Get-Member -ErrorAction Stop |
            Where-Object { $_.MemberType -ne "AliasProperty" } |
            ForEach-Object {
                if ($_.MemberType -eq "Method" -and $_.Definition) {
                    "{0,-12} {1}" -f $_.MemberType, ($_.Definition -replace '\s+', ' ')
                } else {
                    "{0,-12} {1}" -f $_.MemberType, $_.Name
                }
            }
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

# O hasle mowimy WYLACZNIE tyle, ile potrzeba do diagnozy: czy jest i czy ma
# ceche, ktora Sfere wywraca. Samego hasla sonda nie wypisuje - wynik wraca
# do repozytorium i trafia do cudzych oczu.
Write-Wynik "  haslo operatora: $(if ($operatorHaslo -ne '') { "ustawione ($($operatorHaslo.Length) znakow)" } else { 'PUSTE' })"
if ($hasloSql -eq "") {
    Write-Wynik "  haslo SQL: PUSTE"
} else {
    $pierwszy = $hasloSql[0]
    $ryzykowny = ($pierwszy -match '[0-9a-fA-F]')
    Write-Wynik "  haslo SQL: ustawione ($($hasloSql.Length) znakow), pierwszy znak $(if ($ryzykowny) { 'HEKSADECYMALNY - to znany problem Sfery' } else { 'poza zakresem 0-9 a-f, w porzadku' })"
    if ($ryzykowny) {
        Write-Wynik "             Sfera odrzuca hasla zaczynajace sie od cyfry albo litery a-f"
        Write-Wynik "             (blad 0x80041329). Zmien haslo na zaczynajace sie od g-z."
    }
}

# Tryby uruchomienia (UruchomEnum, docs/sfera-com.md §2):
#   gtaUruchom 0x0, gtaUruchomNowy 0x2, gtaUruchomWTle 0x4.
Write-Wynik ""
Write-Wynik "PUNKT 3 - Uruchom(dopasuj, tryb)"

$sgt = $null
$kody = @()
$udanyTryb = ""

function Kod($blad) {
    $hr = 0
    try { $hr = $blad.Exception.HResult } catch { }
    return ("0x{0:X8}" -f $hr)
}

# Kolejnosc prob nie jest przypadkowa.
#
# NOWY|W_TLE idzie pierwszy, bo tak brzmi udokumentowane wywolanie producenta,
# i bo usluga i tak POWINNA miec wlasna instancje: podlaczanie sie do Subiekta
# otwartego przez czlowieka wiazaloby dokumenty firmy z czyims pulpitem.
#
# Prob jest trzy, nie szesc. Druga wartosc Autentykacji dostaje jeden strzal,
# bo gdy nie wpuszcza do bazy, tryb uruchomienia nic nie zmieni. Konta SQL
# potrafia sie blokowac po serii nieudanych logowan i to jest ten limit.
$proby = @(
    @{ aut = $autentykacja; tryb = (2 -bor 4); opis = "NOWY|W_TLE" },
    @{ aut = $autentykacja; tryb = (0 -bor 4); opis = "DOPASUJ|W_TLE" },
    @{ aut = $(if ($autentykacja -eq 0) { 1 } else { 0 }); tryb = (2 -bor 4); opis = "NOWY|W_TLE" }
)
foreach ($p in $proby) {
    if ($null -ne $sgt) { break }
    try {
        $gt.Autentykacja = $p.aut
        $sgt = $gt.Uruchom(0, $p.tryb)
        $udanyTryb = "Autentykacja=$($p.aut), tryb $($p.opis) (0x{0:X})" -f $p.tryb
        Write-Wynik "  JEST  sesja otwarta BEZ OKNA — $udanyTryb"
        if ($p.aut -ne $autentykacja) {
            Write-Wynik "        WPISZ TO DO wertis.env: SFERA_AUTENTYKACJA=$($p.aut)"
        }
    } catch {
        $kod = Kod $_
        $kody += "Autentykacja=$($p.aut) $($p.opis) -> $kod"
        Write-Wynik "  BRAK  Autentykacja=$($p.aut), tryb $($p.opis) ($kod): $($_.Exception.Message)"
    }
}

# Ostatnia proba TYLKO na zyczenie: z widocznym oknem. Rozstrzyga, czy blokada
# siedzi w samym trybie w tle, czy w danych logowania. Domyslnie wylaczona,
# bo otwiera okno Subiekta na pulpicie.
if ($null -eq $sgt -and $ZOknem) {
    Write-Wynik ""
    Write-Wynik "  ...  proba z WIDOCZNYM oknem (Autentykacja=$autentykacja, DOPASUJ)"
    try {
        $gt.Autentykacja = $autentykacja
        $sgt = $gt.Uruchom(0, 0)
        $udanyTryb = "Autentykacja=$autentykacja, Z OKNEM"
        Write-Wynik "  JEST  sesja otwarta Z OKNEM. Dane logowania sa dobre, blokuje TRYB W TLE."
        Write-Wynik "        Dla uslugi wertis-sfera to jest problem: usluga nie ma pulpitu."
        Write-Wynik "        Sprawdz, czy Subiekt nie pokazuje czegos przy starcie (komunikat,"
        Write-Wynik "        abonament, KSeF, zmiana hasla) - w tle nie ma tego gdzie kliknac."
    } catch {
        Write-Wynik "  BRAK  takze z oknem ($(Kod $_)): $($_.Exception.Message)"
    }
}

if ($null -eq $sgt) {
    Write-Wynik ""
    Write-Wynik "  BRAK  sesji. Kody po kolei:"
    foreach ($k in $kody) { Write-Wynik "        $k" }
    Write-Wynik ""
    Write-Wynik "        NIE CZYTAJ TRESCI KOMUNIKATU DOSLOWNIE. Kody 0x8004xxxx sa"
    Write-Wynik "        interfejsowe: znaczenie nadaje im biblioteka, ktora je zwrocila."
    Write-Wynik "        Windows dokleja do nich opis Harmonogramu zadan, wiec zdanie"
    Write-Wynik "        o 'aparacie planowania' nie ma ze Sfera nic wspolnego."
    if ($kody -join ' ' -match '0x80041329') {
        Write-Wynik ""
        Write-Wynik "        0x80041329 - SFERA NIE WESZLA DO BAZY. Najczestsza przyczyna to"
        Write-Wynik "        haslo loginu SQL zaczynajace sie od cyfry albo litery a-f."
        Write-Wynik "        Ten sam kod pada przy pustym lub blednym loginie SQL."
    }
    if ($kody -join ' ' -match '0x8004132B') {
        Write-Wynik ""
        Write-Wynik "        0x8004132B - SFERA WESZLA DALEJ i przewrocila sie na URUCHOMIENIU"
        Write-Wynik "        SUBIEKTA W TLE. Patrz na OPERATORA, nie na login SQL:"
        Write-Wynik "          - SFERA_OPERATOR musi byc dokladna nazwa operatora z Subiekta,"
        Write-Wynik "          - SFERA_OPERATOR_HASLO musi byc jego haslem,"
        Write-Wynik "          - ten operator musi miec w Subiekcie prawo do Sfery,"
        Write-Wynik "          - podmiot musi miec WLASNA licencje Sfery."
        Write-Wynik "        Uruchom sonde z -ZOknem: gdy z oknem wchodzi, dane sa dobre,"
        Write-Wynik "        a blokuje sam tryb w tle."
    }
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
foreach ($nazwa in @("DokumentyMagazynoweManager", "DokumentyHandloweManager", "SuDokumentyManager")) {
    Sprawdz-Nazwe $sgt $nazwa 4 | Out-Null
}

# Pierwszy przebieg z otwarta sesja pokazal, ze obu nazw z naszego kodu na
# obiekcie NIE MA, a dokumenty siedza pod `SuDokumentyManager`. Zamiast pytac
# o kolejne zgadniete nazwy, sonda wypisuje SKLADOWE KAZDEGO managera - wtedy
# metody `Dodaj*` widac czarno na bialym i nie trzeba wracac po nie osobno.
Write-Wynik ""
Write-Wynik "--- Skladowe kazdego managera (tu sa metody Dodaj*) ---"
$menedzery = @()
try {
    $menedzery = $sgt | Get-Member -ErrorAction Stop |
        Where-Object { $_.Name -like "*Manager*" } | ForEach-Object { $_.Name }
} catch { }
foreach ($m in $menedzery) {
    try {
        Skladowe $sgt.$m $m
    } catch {
        Write-Wynik "  ($m - nie dalo sie odczytac: $($_.Exception.Message))"
    }
}

# `Dokumenty` nie jest managerem z nazwy, ale nazwa mowi, ze moze niesc
# dokumenty - dlatego dostaje ten sam wypis. Kosztuje jedno wywolanie.
if (Ma-Nazwe $sgt "Dokumenty") {
    try { Skladowe $sgt.Dokumenty "Dokumenty" } catch { }
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
