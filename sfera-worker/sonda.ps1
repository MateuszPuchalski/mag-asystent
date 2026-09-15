# Sonda Sfery - wypisuje model obiektowy Subiekta, NIE wystawia dokumentow.
#
# Powod: lista [WERYFIKUJ] w README.md ma osiem punktow, a kazda pomylka w nazwie
# wychodzi dzis dopiero w trakcie wystawiania dokumentu - czyli po przebudowaniu
# exe na maszynie z .NET SDK, skopiowaniu go i restarcie uslugi. Jeden przebieg
# tej sondy zamyka cala liste, bez SDK i bez sladu w bazie.
#
# Sonda NICZEGO NIE ZAPISUJE. Otwiera sesje, czyta nazwy skladowych i konczy
# prace. Zadnego Zapisz().
#
# Dwa wyjatki, wlaczane swiadomie: -SzkicMM wola DodajMM(), a -SzkicZW wola
# DodajZW(), zeby zobaczyc wlasciwosci obiektu dokumentu. Dokument zostaje
# w pamieci i nie jest zapisywany, ale to jedyne Dodaj* w calym skrypcie.
# -WzorZW tylko WCZYTUJE istniejacy ZW - odczyt, bez zmiany i bez Zapisz().
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
    [switch]$ZOknem,
    # Tworzy MM jako obiekt w pamieci i wypisuje jego wlasciwosci. NIE wola
    # Zapisz(), wiec dokument nie powstaje - ale to jedyne wywolanie Dodaj*
    # w calej sondzie, wiec wlacza sie je swiadomie.
    [switch]$SzkicMM,
    # Identyfikatory magazynow do szkicu MM. Domyslnie biora sie z wertis.env
    # (MAG_ID_MAG -> MAG_ID_ZWROTY, czyli ten sam kierunek, co MM zwrotu), wiec
    # normalnie nie podaje sie ich wcale. Dotyczy wylacznie -SzkicMM.
    [int]$MagNadawczy = 0,
    [int]$MagOdbiorczy = 0,
    # Kartoteka do szkicu POZYCJI. Wola Pozycje.Dodaj() na dokumencie, ktory
    # i tak nie jest zapisywany - pozycja powstaje w pamieci razem z nim.
    # To zamyka nazwe pola ilosci i podstawe indeksu Element. Dotyczy wylacznie
    # -SzkicMM; bez tego parametru zaden Dodaj na pozycjach nie pada.
    [int]$Towar = 0,
    # Tworzy ZW (zwrot do paragonu) w pamieci i podpina go pod paragon -Paragon.
    # NIE wola Zapisz(). Audyt zwrotow z 15 wrzesnia 2026: biuro wystawia ZW
    # reka, a worker ma to przejac - najpierw trzeba znac nazwy na obiekcie ZW.
    [switch]$SzkicZW,
    # dok_Id paragonu PA, pod ktory idzie szkic ZW. Numer z ekranu nie wystarczy:
    # NaPodstawie bierze identyfikator (SAFEARRAY(int) w wariancie „wielu").
    [int]$Paragon = 0,
    # Ilosci na szkicu ZW, jak biuro wpisuje je w oknie: "Lp=ilosc" po
    # przecinku, np. "1=0,2=1". Nadal w pamieci. Rozstrzyga, czy wartosc
    # i platnosc przeliczaja sie same po zmianie ilosci. Dotyczy -SzkicZW.
    [string]$Ilosci = "",
    # dok_Id ZW wystawionego RECZNIE przez biuro. Sonda go tylko WCZYTUJE,
    # zeby odczytac liczbe, ktora znaczy "zwrot ze sprzedazy". Dotyczy -SzkicZW.
    [int]$WzorZW = 0
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
$pMagNadawczy = $MagNadawczy
$pMagOdbiorczy = $MagOdbiorczy
$pTowar = $Towar

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
        # -InputObject, a NIE potok. Potok ROZWIJA kolekcje: pusta kolekcja COM
        # nie wysyla do Get-Member ani jednego elementu i wraca odmowa „You must
        # specify an object", ktora wyglada jak brak obiektu. Tak wlasnie wygladal
        # pierwszy szkic MM: Pozycje istnialy, tylko byly puste (0.198.9).
        $czlonkowie = Get-Member -InputObject $obiekt -ErrorAction Stop |
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
    # -InputObject z tego samego powodu co w Skladowe: potok rozwinalby kolekcje.
    try { return (Get-Member -InputObject $obiekt -Name $nazwa -ErrorAction Stop) -ne $null }
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
# Magazyny do szkicu MM: z pliku, chyba ze czlowiek podal je parametrem.
# Kierunek jest ten sam, co w kosze-zwrotow.ts - z magazynu sprzedazy do bufora
# zwrotow. Zerowy identyfikator znaczy „nie ustawiaj", a nie magazyn numer zero.
if ($pMagNadawczy -eq 0) { $pMagNadawczy = [int](Klucz $env_ "MAG_ID_MAG" "0") }
if ($pMagOdbiorczy -eq 0) { $pMagOdbiorczy = [int](Klucz $env_ "MAG_ID_ZWROTY" "0") }
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
# --- Szkic MM: ostatnia rzecz, ktorej nie widac bez obiektu dokumentu -------
#
# Sygnatury pokazaly, ze KAZDE `Dodaj*` na SuDokumentyManager jest BEZ
# ARGUMENTOW i zwraca `SuDokument`. Czyli dokument powstaje najpierw jako
# obiekt, a dopiero `Zapisz()` go utrwala - i to jest szansa, zeby zobaczyc
# jego wlasciwosci (magazyny, Pozycje, NumerPelny) BEZ wystawiania czegokolwiek.
# Pierwszy taki przebieg od razu sie zwrocil: magazyny na dokumencie nazywaja
# sie MagazynNadawczyId i MagazynOdbiorczyId, a nie MagazynZrodlowyId, na
# ktorym stal kod.
#
# DOMYSLNIE WYLACZONE i tak zostaje. Sonda ma jedna obietnice - „niczego nie
# zapisuje" - a `DodajMM()` jest pierwszym wywolaniem, ktore tej obietnicy
# dotyka: nie zapisuje, ale tworzy. Czlowiek ma to wlaczyc swiadomie.
if ($SzkicMM) {
    Write-Wynik ""
    Write-Wynik "SZKIC MM - obiekt dokumentu w pamieci, BEZ Zapisz()"
    Write-Wynik "  Uwaga: to jedyne miejsce, gdzie sonda wola Dodaj*. Dokument"
    Write-Wynik "  NIE jest zapisywany; po odczytaniu nazw sesja sie konczy."
    try {
        $mm = $sgt.SuDokumentyManager.DodajMM()
        Skladowe $mm "SuDokument (MM) - wlasciwosci dokumentu"

        # Pierwszy przebieg (0.198.6) pokazal, ze na PUSTYM dokumencie Pozycje
        # jest null - Get-Member odmowil komunikatem o braku obiektu, ktory
        # wyglada na blad sondy, a jest stanem dokumentu. Magazyny z wertis.env
        # pozwalaja sprawdzic, czy kolekcja pojawia sie dopiero po nich; nadal
        # bez Zapisz().
        if ($pMagNadawczy -eq 0 -and $pMagOdbiorczy -eq 0) {
            Write-Wynik "  BRAK  magazynow: nie ma MAG_ID_MAG ani MAG_ID_ZWROTY w wertis.env"
            Write-Wynik "        podaj je wprost, np. -MagNadawczy 1 -MagOdbiorczy 3"
        } else {
            try {
                if ($pMagNadawczy -gt 0) { $mm.MagazynNadawczyId = $pMagNadawczy }
                if ($pMagOdbiorczy -gt 0) { $mm.MagazynOdbiorczyId = $pMagOdbiorczy }
                Write-Wynik ("  JEST  magazyny ustawione: nadawczy={0} odbiorczy={1}" -f $pMagNadawczy, $pMagOdbiorczy)
            } catch {
                Write-Wynik "  BRAK  ustawienie magazynow odmowilo: $($_.Exception.Message)"
            }
        }

        $pozycje = $null
        try { $pozycje = $mm.Pozycje } catch { Write-Wynik "  BRAK  odczyt Pozycje odmowil: $($_.Exception.Message)" }
        if ($null -eq $pozycje) {
            Write-Wynik ""
            Write-Wynik "--- SuDokument.Pozycje ---"
            Write-Wynik "  (null - kolekcja jeszcze nie istnieje mimo magazynow)"
        } else {
            Skladowe $pozycje "SuDokument.Pozycje"
            # Ile pozycji ma pusty dokument - odpowiedz „0" potwierdza, ze kolekcja
            # jest pusta, a nie ze jej nie ma. To byla cala zagadka 0.198.8.
            try { Write-Wynik ("  Liczba pozycji: {0}" -f $pozycje.Liczba) } catch { }

            # Pozycja tez powstaje w PAMIECI - dokument nie jest zapisywany, wiec
            # Dodaj() nie zostawia sladu w bazie. Bez tego nazwa pola ilosci
            # (IloscJm?) zostaje zgadnieta, a to juz kosztowalo cztery wydania.
            if ($pTowar -gt 0) {
                Write-Wynik ""
                Write-Wynik "SZKIC POZYCJI - Pozycje.Dodaj($pTowar), nadal BEZ Zapisz()"
                try {
                    $poz = $pozycje.Dodaj($pTowar)
                    if ($null -eq $poz) {
                        Write-Wynik "  BRAK  Dodaj() oddal null - Variant to chyba nie tw_Id"
                    } else {
                        Skladowe $poz "SuDokument.Pozycje.Element - skladowe POZYCJI"
                    }
                    try { Write-Wynik ("  Liczba pozycji po Dodaj: {0}" -f $pozycje.Liczba) } catch { }
                    # Podstawa indeksu: kod korekty musi wiedziec, czy liczyc od 0,
                    # czy od 1. Zgadniecie tego to blad co drugiego przebiegu petli.
                    foreach ($i in 0..1) {
                        try {
                            $el = $pozycje.Element($i)
                            $czy = if ($null -eq $el) { "null" } else { "obiekt" }
                            Write-Wynik ("  Element({0}) -> {1}" -f $i, $czy)
                        } catch {
                            Write-Wynik ("  Element({0}) -> odmowa: {1}" -f $i, $_.Exception.Message)
                        }
                    }
                } catch {
                    Write-Wynik "  BRAK  Pozycje.Dodaj() odmowil: $($_.Exception.Message)"
                }
            }
        }
    } catch {
        Write-Wynik "  BRAK  DodajMM() odmowil: $($_.Exception.Message)"
    }
}

# --- Szkic ZW: zwrot do paragonu, w pamieci (audyt zwrotow, 15 wrzesnia 2026) --
#
# Biuro wystawia ZW reka: paragon PA, "Wypisz zwrot", zera w pozycjach, ktore
# nie wrocily. Worker ma to przejac, ale DodajZW() znamy wylacznie z nazwy na
# liscie managera - pozycji po NaPodstawie i pol rodzaju zwrotu nikt nie widzial.
# Ta sama droga co przy MM: obiekt w pamieci, zadnego Zapisz().
#
# DANYCH KONTRAHENTA NIE WYPISUJEMY. ZW po powiazaniu niesie nabywce z paragonu,
# a plik wynikowy wraca do repozytorium. Wlasciwosci o kontrahencie, adresie
# i uwagach odsiewa wzorzec $prywatne; zostaje tylko to, czego potrzebuje kod.
if ($SzkicZW) {
    # Wartosc bez wywracania sondy. Brak nazwy to co innego niz null: COM na
    # nieznanej nazwie oddaje w PowerShellu cichy $null.
    function Wartosc($obiekt, [string]$nazwa) {
        if (-not (Ma-Nazwe $obiekt $nazwa)) { return "(brak nazwy)" }
        try {
            $w = $obiekt.$nazwa
            if ($null -eq $w) { return "(null)" }
            return "$w"
        } catch { return "(odmowa: $($_.Exception.Message))" }
    }
    $prywatne = 'Kontrahent|Nabywca|Odbiorca|Adres|Nip|Pesel|Telefon|Email|Mail|Uwagi|Opis|Osoba|Imie|Nazwisko|Bank|Konto'
    function Wlasciwosci-Wg($obiekt, [string]$wzorzec, [string]$etykieta) {
        Write-Wynik ""
        Write-Wynik "--- $etykieta (wartosci) ---"
        try {
            $nazwy = Get-Member -InputObject $obiekt -MemberType Property -ErrorAction Stop |
                Where-Object { $_.Name -match $wzorzec -and $_.Name -notmatch $prywatne } |
                ForEach-Object { $_.Name }
            if (-not $nazwy) { Write-Wynik "  (zadna wlasciwosc nie pasuje)"; return }
            foreach ($n in $nazwy) { Write-Wynik ("  {0,-34} = {1}" -f $n, (Wartosc $obiekt $n)) }
        } catch {
            Write-Wynik "  (Get-Member odmowil: $($_.Exception.Message))"
        }
    }
    $polaDokumentu = 'Rodzaj|Zwrot|Plat|Zaplac|Przelew|Gotow|Kart|Kredyt|Skutek|DoDokumentu|Typ|Kategoria|Magazyn|Wartosc|Kwota|Waluta|Data|Numer'

    Write-Wynik ""
    Write-Wynik "SZKIC ZW - zwrot do paragonu w pamieci, BEZ Zapisz()"
    Write-Wynik "  Uwaga: dokument NIE jest zapisywany; po odczytaniu nazw sesja sie konczy."

    # Sygnatury wszystkiego, co dotyczy zwrotu do paragonu: ZW, ZWn, PAk. Gdyby
    # DodajZW() odmowil, ta lista mowi, jak nazywa sie wlasciwa metoda.
    Write-Wynik ""
    Write-Wynik "--- SuDokumentyManager - metody zwrotow i korekt paragonu ---"
    try {
        Get-Member -InputObject $sgt.SuDokumentyManager -MemberType Method -ErrorAction Stop |
            Where-Object { $_.Name -match 'ZW|PAk|Zwrot' } |
            ForEach-Object { Write-Wynik ("  {0}" -f ($_.Definition -replace '\s+', ' ')) }
    } catch {
        Write-Wynik "  (nie udalo sie odczytac: $($_.Exception.Message))"
    }

    $zw = $null
    try {
        $zw = $sgt.SuDokumentyManager.DodajZW()
        Write-Wynik "  JEST  DodajZW() oddal obiekt dokumentu"
        Wlasciwosci-Wg $zw $polaDokumentu "ZW PRZED powiazaniem"

        if ($Paragon -le 0) {
            Write-Wynik ""
            Write-Wynik "  BRAK  paragonu: podaj -Paragon <dok_Id>, zeby zobaczyc pozycje po NaPodstawie."
            Write-Wynik "        dok_Id znajdziesz w SSMS na bazie podmiotu:"
            Write-Wynik "        SELECT dok_Id, dok_NrPelny FROM dok__Dokument WHERE dok_NrPelny = 'PA 1/MAG/09/2026'"
        } else {
            Write-Wynik ""
            Write-Wynik "NaPodstawie($Paragon) - nadal BEZ Zapisz()"
            $powiazany = $false
            try {
                $zw.NaPodstawie($Paragon)
                $powiazany = $true
                Write-Wynik "  JEST  NaPodstawie przyjal dok_Id paragonu"
            } catch {
                Write-Wynik "  BRAK  NaPodstawie odmowil: $($_.Exception.Message)"
                # Drugi przebieg na tym samym PA (15 wrzesnia 2026) odbil sie od blokady:
                # NaPodstawie BLOKUJE paragon, a do 0.348.3 sonda nie zamykala szkicu.
                # Trzyma ja okno Subiekta z tym paragonem albo niezamkniety szkic.
                if ($_.Exception.Message -match 'zablokowa') {
                    Write-Wynik "        Paragon trzyma inna sesja: zamknij go w Subiekcie albo wez inny PA."
                } elseif ($_.Exception.Message -match 'wystawi. korekty') {
                    # Trzeci przebieg dostal dok_Id WZ zamiast PA - numer w komunikacie
                    # mowi, jaki to dokument, ale nie mowi, gdzie szukac wlasciwego.
                    Write-Wynik "        To nie paragon albo Subiekt nie pozwala go korygowac. Paragon ma dok_Typ = 21:"
                    Write-Wynik "        SELECT dok_Id, dok_NrPelny, dok_Typ FROM dok__Dokument WHERE dok_Id = $Paragon"
                }
            }

            # Bez powiazania ZW jest pusty - drugi wydruk tych samych zer i "Pozycje: 0"
            # wygladalby jak wynik, a jest tylko skutkiem odmowy.
            $pozycjeZw = $null
            if ($powiazany) {
                Wlasciwosci-Wg $zw $polaDokumentu "ZW PO powiazaniu"
                try { $pozycjeZw = $zw.Pozycje } catch { Write-Wynik "  BRAK  odczyt Pozycje odmowil: $($_.Exception.Message)" }
            }
            if (-not $powiazany) {
                Write-Wynik "  (pozycji nie czytam - bez powiazania szkic ZW jest pusty)"
            } elseif ($null -eq $pozycjeZw) {
                Write-Wynik "  (Pozycje null - NaPodstawie nie przepisal pozycji)"
            } else {
                $liczba = 0
                try { $liczba = [int]$pozycjeZw.Liczba } catch { }
                Write-Wynik ""
                Write-Wynik ("--- Pozycje ZW po powiazaniu: {0} ---" -f $liczba)
                # Element liczy OD JEDYNKI - zmierzone przy szkicu MM (docs/sfera-com.md 2l).
                for ($i = 1; $i -le $liczba; $i++) {
                    try {
                        $el = $pozycjeZw.Element($i)
                        Write-Wynik ("  [{0}] TowarId={1} Symbol={2} IloscJm={3} Ilosc={4}" -f $i,
                            (Wartosc $el "TowarId"), (Wartosc $el "TowarSymbol"),
                            (Wartosc $el "IloscJm"), (Wartosc $el "Ilosc"))
                        if ($i -eq 1) {
                            Wlasciwosci-Wg $el 'Ilosc|Cena|Wartosc|Rabat|Vat|Lp|Orygin|Korekt|Magazyn' "Pierwsza pozycja ZW"
                        }
                    } catch {
                        Write-Wynik ("  [{0}] odmowa: {1}" -f $i, $_.Exception.Message)
                    }
                }

                # Biuro zeruje w oknie ZW pozycje, ktore nie wrocily - ilosc z paragonu
                # zostaje przy tych, ktore wrocily (wlasciciel, 15 wrzesnia 2026). Worker
                # zrobi to samo, wiec sprawdzamy dokladnie ten ruch: czy po zerze wartosc
                # i przelew przeliczaja sie same, czy kod musi je ustawic.
                if ($Ilosci) {
                    Write-Wynik ""
                    Write-Wynik "ZMIANA ILOSCI - $Ilosci, nadal BEZ Zapisz()"
                    foreach ($para in ($Ilosci -split ',')) {
                        $czesci = $para.Trim() -split '='
                        if ($czesci.Count -ne 2) { Write-Wynik "  BRAK  zly zapis '$para' - ma byc Lp=ilosc"; continue }
                        try {
                            $lp = [int]$czesci[0]
                            $ile = [decimal]::Parse($czesci[1], [Globalization.CultureInfo]::InvariantCulture)
                            $pozycjeZw.Element($lp).IloscJm = $ile
                            Write-Wynik ("  JEST  [{0}] IloscJm = {1}" -f $lp, $ile)
                        } catch {
                            Write-Wynik ("  BRAK  [{0}] odmowa: {1}" -f $czesci[0], $_.Exception.Message)
                        }
                    }
                    try { $liczba = [int]$pozycjeZw.Liczba } catch { }
                    # Liczba pozycji po zerach mowi, czy zero USUWA wiersz, czy go zostawia.
                    Write-Wynik ("--- Pozycje ZW po zmianie ilosci: {0} ---" -f $liczba)
                    for ($i = 1; $i -le $liczba; $i++) {
                        try {
                            $el = $pozycjeZw.Element($i)
                            Write-Wynik ("  [{0}] TowarId={1} IloscJm={2} WartoscBruttoPoRabacie={3}" -f $i,
                                (Wartosc $el "TowarId"), (Wartosc $el "IloscJm"), (Wartosc $el "WartoscBruttoPoRabacie"))
                        } catch {
                            Write-Wynik ("  [{0}] odmowa: {1}" -f $i, $_.Exception.Message)
                        }
                    }
                    Wlasciwosci-Wg $zw 'Wartosc|Kwota|Plat|Przelew|Gotow|Kart' "ZW PO zmianie ilosci"
                }
            }
        }
    } catch {
        Write-Wynik "  BRAK  DodajZW() odmowil: $($_.Exception.Message)"
    } finally {
        # Zamknij() zwalnia blokade paragonu. Bez tego nastepny przebieg na tym samym
        # PA dostawal "Nie mozna zablokowac obiektu" (sonda-zw.txt, 15:51).
        if ($null -ne $zw) {
            try { $zw.Zamknij() } catch { Write-Wynik "  UWAGA  Zamknij() szkicu ZW odmowil: $($_.Exception.Message)" }
        }
    }

    # ZW wystawiony RECZNIE - jedyne zrodlo liczby "zwrot ze sprzedazy" w polu
    # RodzajZwrotuDetal. Szkic ma tam 0, a zgadniecie wartosci na dokumencie
    # fiskalnym to dokladnie ten blad, ktory w MM kosztowal cztery wydania.
    # WczytajDokument tylko otwiera istniejacy dokument; zadnego Zapisz().
    if ($WzorZW -gt 0) {
        Write-Wynik ""
        Write-Wynik "WZOR ZW - WczytajDokument($WzorZW), tylko odczyt"
        $wzor = $null
        try {
            $wzor = $sgt.SuDokumentyManager.WczytajDokument($WzorZW)
            if ($null -eq $wzor) {
                Write-Wynik "  BRAK  WczytajDokument oddal null - to chyba nie dok_Id"
            } else {
                Wlasciwosci-Wg $wzor $polaDokumentu "ZW wystawiony recznie"
                $pozycjeWzoru = $null
                try { $pozycjeWzoru = $wzor.Pozycje } catch { }
                if ($null -ne $pozycjeWzoru) {
                    $liczbaWzoru = 0
                    try { $liczbaWzoru = [int]$pozycjeWzoru.Liczba } catch { }
                    # Czy biuro zostawia na ZW wiersze z zerem, czy Subiekt je wycina.
                    Write-Wynik ("--- Pozycje recznego ZW: {0} ---" -f $liczbaWzoru)
                    for ($i = 1; $i -le $liczbaWzoru; $i++) {
                        try {
                            $el = $pozycjeWzoru.Element($i)
                            Write-Wynik ("  [{0}] TowarId={1} IloscJm={2} DokHanLp={3}" -f $i,
                                (Wartosc $el "TowarId"), (Wartosc $el "IloscJm"), (Wartosc $el "DokHanLp"))
                        } catch {
                            Write-Wynik ("  [{0}] odmowa: {1}" -f $i, $_.Exception.Message)
                        }
                    }
                }
            }
        } catch {
            Write-Wynik "  BRAK  WczytajDokument odmowil: $($_.Exception.Message)"
        } finally {
            # Wczytany ZW tez jest zablokowany dla biura, dopoki go nie zamkniemy.
            if ($null -ne $wzor) {
                try { $wzor.Zamknij() } catch { Write-Wynik "  UWAGA  Zamknij() wzoru ZW odmowil: $($_.Exception.Message)" }
            }
        }
    }
    Write-Wynik ""
    Write-Wynik "Pytania do wyniku szkicu ZW:"
    Write-Wynik "  - czy NaPodstawie przepisal WSZYSTKIE pozycje paragonu i z jaka iloscia"
    Write-Wynik "  - czy po IloscJm=0 wartosc i PlatnoscPrzelewKwota przeliczyly sie same (-Ilosci)"
    Write-Wynik "  - czy zero usuwa wiersz, czy go zostawia (-Ilosci, -WzorZW)"
    Write-Wynik "  - jaka liczba w RodzajZwrotuDetal znaczy 'zwrot ze sprzedazy' (-WzorZW)"
    Write-Wynik ""
}

Write-Wynik "Czego sonda NIE rozstrzyga, bo wymaga wystawienia dokumentu:"
Write-Wynik "  - punkt 5: czy Zapisz() daje dokument WYKONANY, czy odklada do bufora"
Write-Wynik "  - znaczenie flagi w Usun(bool) - sygnatura jest znana, sens flagi nie"
Write-Wynik "  - czy IloscJm na KOREKCIE znaczy ilosc po korekcie (pozycja ma jedno"
Write-Wynik "    pole ilosci, wiec to pytanie o znaczenie, nie o nazwe)"
Write-Wynik "Zamyka je bramka 2 z docs/wdrozenie.md: jedno MM na kartotece probnej."
Write-Wynik ""
Write-Wynik "Nastepny krok: wpisz ustalenia do docs/sfera-com.md i zdejmij zamkniete"
Write-Wynik "znaczniki [WERYFIKUJ] z sfera-worker/README.md."

# Zakoncz() konczy sesje w tle jawnie. Do 0.348.3 sonda zostawiala to wyjsciu
# z PowerShella, a blokady Subiekta sa przypisane do operatora i stacji - tych
# samych, na ktorych czlowiek ma otwarte okno Subiekta.
if ($null -ne $sgt) {
    try { [void]$sgt.Zakoncz() } catch { Write-Wynik "UWAGA  Zakoncz() odmowil: $($_.Exception.Message)" }
}

$script:linie | Set-Content -LiteralPath $Wynik -Encoding UTF8
Write-Host "`nWynik zapisany: $Wynik"
