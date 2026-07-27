# Wypisywanie i pytania instalatora WERTIS.
#
# Osobny plik, bo korzystają z tego wszystkie trzy pozostałe skrypty, a
# instalator ogląda osoba, która nie zna repo — jednolity format komunikatów
# jest tu funkcją, nie ozdobą. Każdy krok ma widoczny wynik: [ok], [!] albo
# [x]. Cicha instalacja, która „chyba się udała", jest gorsza od takiej, która
# krzyczy.
#
# Ozdobniki są celowo ASCII. Polskie znaki w treści zostają (plik jest UTF-8
# z BOM — patrz instalator/README.md), ale ramek i strzałek unikamy, bo
# w starszej konsoli Windows rozsypują się na krzaki.

# Ustawiany przez skrypt główny (-DryRun). Funkcje wykonujące cokolwiek
# nieodwracalnego pytają o niego SAME — polegać na tym, że wywołujący
# pamiętał sprawdzić, znaczyłoby prędzej czy później zmienić system podczas
# przebiegu próbnego.
$script:WertisDryRun = $false

function Write-Naglowek {
    param([string]$Tekst)
    Write-Host ""
    Write-Host ("=" * 68) -ForegroundColor DarkCyan
    Write-Host "  $Tekst" -ForegroundColor Cyan
    Write-Host ("=" * 68) -ForegroundColor DarkCyan
}

function Write-Krok {
    param([string]$Tekst)
    Write-Host ""
    Write-Host "-- $Tekst" -ForegroundColor Cyan
}

function Write-Ok      { param([string]$T) Write-Host "   [ok] $T" -ForegroundColor Green }
function Write-Info    { param([string]$T) Write-Host "        $T" -ForegroundColor Gray }
function Write-Uwaga   { param([string]$T) Write-Host "   [!]  $T" -ForegroundColor Yellow }
function Write-Blad    { param([string]$T) Write-Host "   [x]  $T" -ForegroundColor Red }

function Write-Proba {
    <#
        .SYNOPSIS
        Komunikat kroku pominiętego w trybie -DryRun.
    #>
    param([string]$T)
    Write-Host "   [--] $T" -ForegroundColor DarkGray
}

function Test-DryRun {
    <#
        .SYNOPSIS
        $true, gdy trwa przebieg próbny. Wypisuje przy okazji, co by się stało.
    #>
    param([string]$Opis)
    if ($script:WertisDryRun) {
        if ($Opis) { Write-Proba $Opis }
        return $true
    }
    return $false
}

function Read-Tak {
    <#
        .SYNOPSIS
        Pytanie tak/nie. W trybie -DryRun nie pyta — zwraca $Domyslnie.
        .DESCRIPTION
        Domyślna odpowiedź jest ZAWSZE bezpieczniejszym wariantem: przy
        pytaniach o zmianę w systemie to „nie". Enter wciśnięty odruchowo nie
        może niczego przestawić.
    #>
    param(
        [Parameter(Mandatory)][string]$Pytanie,
        [bool]$Domyslnie = $false
    )
    if ($script:WertisDryRun) { return $Domyslnie }
    $podpowiedz = if ($Domyslnie) { "[T/n]" } else { "[t/N]" }
    while ($true) {
        $odp = (Read-Host "   $Pytanie $podpowiedz").Trim().ToLowerInvariant()
        if ($odp -eq "")               { return $Domyslnie }
        if ($odp -in @("t", "tak", "y", "yes")) { return $true }
        if ($odp -in @("n", "nie", "no"))       { return $false }
        Write-Uwaga "Odpowiedz 't' albo 'n'."
    }
}

function Read-Wybor {
    <#
        .SYNOPSIS
        Wybór jednej pozycji z listy. Zwraca wybrany obiekt albo $null.
        .PARAMETER Pozycje
        Tablica obiektów.
        .PARAMETER Etykieta
        Scriptblock formatujący pozycję do jednej linii.
        .PARAMETER Domyslny
        Indeks (0-based) podpowiadany Enterem; -1 = brak podpowiedzi.
        .PARAMETER PozwolPominac
        Gdy $true, pusta odpowiedź przy braku podpowiedzi zwraca $null zamiast
        pytać w kółko — dla ustawień, które wolno zostawić niewypełnione.
    #>
    param(
        [Parameter(Mandatory)][object[]]$Pozycje,
        [Parameter(Mandatory)][string]$Pytanie,
        [scriptblock]$Etykieta = { param($p) "$p" },
        [int]$Domyslny = -1,
        [switch]$PozwolPominac
    )
    if ($Pozycje.Count -eq 0) { return $null }

    for ($i = 0; $i -lt $Pozycje.Count; $i++) {
        $znacznik = if ($i -eq $Domyslny) { "*" } else { " " }
        Write-Host ("   {0}{1,3}. {2}" -f $znacznik, ($i + 1), (& $Etykieta $Pozycje[$i]))
    }
    if ($script:WertisDryRun) {
        if ($Domyslny -ge 0) { return $Pozycje[$Domyslny] }
        return $(if ($PozwolPominac) { $null } else { $Pozycje[0] })
    }

    while ($true) {
        $odp = (Read-Host "   $Pytanie").Trim()
        if ($odp -eq "" -and $Domyslny -ge 0)  { return $Pozycje[$Domyslny] }
        if ($odp -eq "" -and $PozwolPominac)   { return $null }
        $n = 0
        if ([int]::TryParse($odp, [ref]$n) -and $n -ge 1 -and $n -le $Pozycje.Count) {
            return $Pozycje[$n - 1]
        }
        Write-Uwaga "Podaj numer z listy (1-$($Pozycje.Count))."
    }
}

function Read-Tekst {
    param(
        [Parameter(Mandatory)][string]$Pytanie,
        [string]$Domyslnie = ""
    )
    if ($script:WertisDryRun) { return $Domyslnie }
    $podpowiedz = if ($Domyslnie) { " [$Domyslnie]" } else { "" }
    $odp = (Read-Host "   $Pytanie$podpowiedz").Trim()
    if ($odp -eq "") { return $Domyslnie }
    return $odp
}

function New-WertisHaslo {
    <#
        .SYNOPSIS
        Losowe hasło dla loginu SQL `wertis`.
        .DESCRIPTION
        Nikt go nie wymyśla ani nie przepisuje — trafia prosto do wertis.env
        i do środowiska obu usług. Zestaw znaków jest przycięty świadomie:
        bez apostrofu (psułby literał w skrypcie SQL i cudzysłów w wertis.env),
        bez spacji i bez znaków, które w cmd.exe albo bashu znaczą coś innego
        niż siebie. Zostaje dość entropii (24 znaki), a hasło przechodzi
        CHECK_POLICY = ON, bo wymuszamy po jednym znaku z każdej kategorii.
    #>
    param([int]$Dlugosc = 24)
    $duze  = "ABCDEFGHJKLMNPQRSTUVWXYZ"      # bez I i O — mylą się z 1 i 0
    $male  = "abcdefghijkmnopqrstuvwxyz"     # bez l
    $cyfry = "23456789"                      # bez 0 i 1
    $znaki = "-_=+@#*?"
    $wszystko = $duze + $male + $cyfry + $znaki

    $bajty = [byte[]]::new($Dlugosc * 4)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bajty)
    $los = { param($zbior, $i) $zbior[[int]($bajty[$i] % $zbior.Length)] }

    $haslo = @(
        (& $los $duze  0), (& $los $male  1), (& $los $cyfry 2), (& $los $znaki 3)
    )
    for ($i = 4; $i -lt $Dlugosc; $i++) { $haslo += (& $los $wszystko $i) }

    # przetasowanie, żeby cztery wymuszone kategorie nie siedziały zawsze na
    # tych samych czterech pozycjach
    $kolejnosc = 0..($Dlugosc - 1) | Sort-Object { $bajty[$Dlugosc + $_] }
    return -join ($kolejnosc | ForEach-Object { $haslo[$_] })
}
