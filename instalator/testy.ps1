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

Sprawdz "nadaje SELECT na osmiu tabelach" {
    # 8, nie 7: doszedł sl_Magazyn, bez którego karta towaru mogłaby pokazać
    # najwyżej `mag_Id = 7` zamiast nazwy magazynu
    $ile = ([regex]::Matches($skrypt, "GRANT SELECT ON")).Count
    Zaloz ($ile -eq 8) "GRANT SELECT jest $ile razy, ma być 8"
}

Sprawdz "czyta slownik magazynow" {
    Zaloz ($skrypt -match "GRANT SELECT ON dbo\.sl_Magazyn") "brak grantu na sl_Magazyn"
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

# ── Wybór bazy podmiotu spośród jej kopii ───────────────────────────────────
# Kopia ma DOKŁADNIE te same tabele co produkcja, więc kontrola „czy to baza
# Subiekta" jej nie odsieje. Pomyłka jest cicha: konto powstaje na kopii,
# aplikacja czyta nieaktualne stany i pisze w martwą bazę, a wszystko wygląda
# poprawnie. Reguły niżej są jedynym, co przed tym broni.

Write-Host ""
Write-Host "Wybór bazy podmiotu"

function Baza {
    param([string]$Nazwa, [object]$Ostatni = $null, [bool]$Subiekt = $true,
          [object]$Ile = $null, [string]$Uwaga = $null, [object]$Utworzona = $null)
    return [pscustomobject]@{
        Nazwa = $Nazwa; Utworzona = $Utworzona; Subiekt = $Subiekt
        OstatniDokument = $Ostatni; Dokumentow = $Ile; Uwaga = $Uwaga
    }
}

$dzis = Get-Date

Sprawdz "etykieta pokazuje datę, licznik i utworzenie" {
    $e = Format-WertisEtykietaBazy -Baza (Baza "WERTIS" ([datetime]"2026-07-29") $true 48210 $null ([datetime]"2019-03-11"))
    Zaloz ($e -match "WERTIS") "brak nazwy"
    Zaloz ($e -match "2026-07-29") "brak daty ostatniego dokumentu"
    Zaloz ($e -match "2019-03-11") "brak daty utworzenia"
}

Sprawdz "etykieta nazywa bazę bez dokumentów, zamiast pokazywać pustkę" {
    $e = Format-WertisEtykietaBazy -Baza (Baza "NOWY_PODMIOT")
    Zaloz ($e -match "brak dokumentów") "pusta baza wygląda jak baza bez danych do pokazania"
}

Sprawdz "etykieta niesie uwagę zamiast liczb, gdy liczb nie ma" {
    $e = Format-WertisEtykietaBazy -Baza (Baza "FK_ARCHIWUM" $null $false $null "nie jest bazą Subiekta")
    Zaloz ($e -match "nie jest bazą Subiekta")
    Zaloz (-not ($e -match "ost\. dokument")) "przy braku danych nie ma czego opisywać"
}

Sprawdz "sortowanie stawia najświeższy podmiot nad kopią" {
    # alfabetycznie KOPIA stoi PRZED WERTIS — i to jest dokładnie ta pułapka
    $lista = @(
        (Baza "AAA_KOPIA" ([datetime]"2026-06-30")),
        (Baza "WERTIS"    ([datetime]"2026-07-29")),
        (Baza "FK"        $null $false)
    )
    $s = Sort-WertisBazy -Bazy $lista
    Zaloz ($s[0].Nazwa -eq "WERTIS") "na górze ma być najświeższa baza, jest $($s[0].Nazwa)"
    Zaloz ($s[2].Nazwa -eq "FK") "baza spoza Subiekta ma być na końcu"
}

Sprawdz "podpowiada bazę o ściśle najświeższym dokumencie" {
    $lista = @(
        (Baza "WERTIS" ([datetime]"2026-07-29")),
        (Baza "KOPIA"  ([datetime]"2026-06-30"))
    )
    Zaloz ((Get-WertisSugerowanaBaza -Bazy $lista) -eq 0)
}

Sprawdz "REMIS dat NIE daje podpowiedzi — to byłby rzut monetą" {
    # Dwie kopie zrobione tego samego dnia. Podpowiedź udawałaby radę,
    # a Enter wybrałby jedną z nich bez żadnej przesłanki.
    $lista = @(
        (Baza "KOPIA_A" ([datetime]"2026-07-29")),
        (Baza "KOPIA_B" ([datetime]"2026-07-29"))
    )
    Zaloz ((Get-WertisSugerowanaBaza -Bazy $lista) -eq -1) "przy remisie nie wolno podpowiadać"
}

Sprawdz "sama godzina nie rozstrzyga remisu — liczy się dzień" {
    $lista = @(
        (Baza "KOPIA_A" ([datetime]"2026-07-29 08:00")),
        (Baza "KOPIA_B" ([datetime]"2026-07-29 17:30"))
    )
    Zaloz ((Get-WertisSugerowanaBaza -Bazy $lista) -eq -1) "dokumenty z tego samego dnia to remis"
}

Sprawdz "brak baz Subiekta — brak podpowiedzi" {
    Zaloz ((Get-WertisSugerowanaBaza -Bazy @((Baza "FK" $null $false))) -eq -1)
}

Sprawdz "baza bez dokumentów nie bywa podpowiadana" {
    Zaloz ((Get-WertisSugerowanaBaza -Bazy @((Baza "NOWY_PODMIOT"))) -eq -1)
}

Sprawdz "dokument sprzed 34 dni wygląda na kopię" {
    $b = Baza "KOPIA" $dzis.AddDays(-34)
    Zaloz (Test-WertisBazaPodejrzana -Baza $b -Teraz $dzis)
}

Sprawdz "dzisiejszy dokument nie budzi podejrzeń" {
    Zaloz (-not (Test-WertisBazaPodejrzana -Baza (Baza "WERTIS" $dzis) -Teraz $dzis))
}

Sprawdz "próg 7 dni: szósty dzień jeszcze przechodzi" {
    Zaloz (-not (Test-WertisBazaPodejrzana -Baza (Baza "WERTIS" $dzis.AddDays(-6)) -Teraz $dzis))
}

Sprawdz "pusty podmiot to NIE kopia — ma własny komunikat" {
    # Pierwsze wdrożenie w świeżej firmie: dokumentów nie ma, bo jeszcze
    # żadnego nie wystawiono. Ostrzeżenie o kopii straszyłoby bez powodu.
    Zaloz (-not (Test-WertisBazaPodejrzana -Baza (Baza "NOWY_PODMIOT") -Teraz $dzis))
}

Sprawdz "baza spoza Subiekta nie jest oceniana pod kątem kopii" {
    Zaloz (-not (Test-WertisBazaPodejrzana -Baza (Baza "FK" $null $false) -Teraz $dzis))
}

# ── Pole lokalizacji na kartotece ───────────────────────────────────────────
# Najgroźniejsze ustawienie całego kreatora: worker nadpisuje wskazaną kolumnę
# BEZWARUNKOWO. Podpowiedź Enterem jest tu realną decyzją, bo prawie nikt jej
# nie zmienia — więc reguła, która ją wybiera, musi mieć asercje.

Write-Host ""
Write-Host "Podpowiedź pola lokalizacji"

function Pole {
    param([string]$Nazwa, [int]$Niepuste = 0, [int]$Adresy = 0, [string[]]$Przyklady = @())
    return [pscustomobject]@{ Pole = $Nazwa; Niepuste = $Niepuste; Adresy = $Adresy; Przyklady = $Przyklady }
}

Sprawdz "pole z adresami wygrywa z pierwszym pustym" {
    # Sedno zmiany. Stara reguła brała tw_Pole1 (puste), zostawiając 841 adresów
    # w tw_Pole3 — dwa źródła prawdy o tej samej lokalizacji.
    $pola = @(
        (Pole "tw_Pole1"),
        (Pole "tw_Pole2" 3412),
        (Pole "tw_Pole3" 847 841)
    )
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq 2) "podpowiedź ma paść na pole z adresami"
}

Sprawdz "BEZ adresów reguła wraca do pierwszego pustego" {
    # Regresja, którą najłatwiej wprowadzić: dopisanie stopnia „adresy" tak,
    # że przestaje działać zachowanie dotychczasowe.
    $pola = @(
        (Pole "tw_Pole1" 3412),
        (Pole "tw_Pole2"),
        (Pole "tw_Pole3")
    )
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq 1) "przy braku adresów wygrywa pierwsze puste"
}

Sprawdz "pole zajęte cudzymi danymi NIE jest podpowiadane" {
    # Stary kod startował z `$wolne = 0` i przy braku pustego pola podpowiadał
    # tw_Pole1 — czyli akurat kasowanie danych firmy.
    $pola = @((Pole "tw_Pole1" 3412), (Pole "tw_Pole2" 12))
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq -1) "tu każda podpowiedź celuje w cudze dane"
}

Sprawdz "REMIS adresów NIE daje podpowiedzi" {
    # Dwa pola z adresami znaczą, że człowiek musi rozstrzygnąć, które obowiązuje.
    $pola = @((Pole "tw_Pole1" 500 500), (Pole "tw_Pole2" 500 500))
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq -1) "przy remisie nie wolno podpowiadać"
}

Sprawdz "więcej adresów wygrywa z mniejszą liczbą adresów" {
    $pola = @((Pole "tw_Pole1" 40 40), (Pole "tw_Pole2" 900 841))
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq 1)
}

Sprawdz "adresy biją pustkę nawet gdy puste pole stoi wcześniej" {
    $pola = @((Pole "tw_Pole1"), (Pole "tw_Pole2" 841 841))
    Zaloz ((Get-WertisSugerowanePole -Pola $pola) -eq 1)
}

Sprawdz "etykieta pokazuje liczbę adresów, nie samą zajętość" {
    # Bez tej liczby pole z adresami wygląda na liście identycznie jak pole
    # z opisami opakowań, a to są dwie przeciwne decyzje.
    $e = Format-WertisEtykietaPola -Pole (Pole "tw_Pole3" 847 841 @("A01-02-03", "B05-01-02"))
    Zaloz ($e -match "tw_Pole3") "brak nazwy pola"
    Zaloz ($e -match "adresy półek: 841") "brak liczby adresów"
    Zaloz ($e -match "A01-02-03") "brak przykładów"
}

Sprawdz "etykieta nazywa pole zajęte BEZ adresów" {
    $e = Format-WertisEtykietaPola -Pole (Pole "tw_Pole2" 3412 0 @("karton 12szt"))
    Zaloz ($e -match "bez adresów półek") "pole z cudzymi danymi ma być opisane wprost"
    Zaloz ($e -match "karton 12szt") "brak przykładów"
}

Sprawdz "etykieta pustego pola nie wymyśla liczb" {
    $e = Format-WertisEtykietaPola -Pole (Pole "tw_Pole1")
    Zaloz ($e -match "puste")
    Zaloz (-not ($e -match "np\.")) "puste pole nie ma przykładów do pokazania"
}

# ── Deinstalacja: co wolno skasować ─────────────────────────────────────────
# NAJGROŹNIEJSZY kod w tym repozytorium. `Remove-Item -Recurse -Force` dostaje
# ścieżkę z parametru, a instalator wywalił się już raz na literówce w takiej
# ścieżce (awaria z 27.07, test na górze tego pliku). Tam kosztowała nieudaną
# instalację — tutaj kosztowałaby dysk.
#
# Dlatego asercje niżej sprawdzają przede wszystkim ODMOWY, a nie sukcesy.

Write-Host ""
Write-Host "Get-WertisPlanDeinstalacji"

Sprawdz "korzeń dysku NIE jest kasowany" {
    # "C:" bez ukośnika stoi tu nieprzypadkowo. Pierwsza wersja rozpoznawała
    # korzeń przez `Split-Path -Leaf`, które dla "C:" NIE zwraca "C:" — więc
    # wzorzec nie trafiał i C:\ przechodziło bramkę. Ta asercja jest jedynym,
    # co to złapało; logika przepisana poza PowerShellem świeciła na zielono.
    foreach ($korzen in @("C:\", "C:", "D:\", "D:/", "c:\", "/", "\", "")) {
        $p = Get-WertisPlanDeinstalacji -Katalog $korzen -Zawartosc @("server", ".git")
        Zaloz (-not $p.Wolno) "zgoda na skasowanie korzenia '$korzen'"
    }
}

Sprawdz "katalog systemowy NIE jest kasowany" {
    # C:\Windows ma podkatalog o nazwie „system", nie „server" — ale nawet
    # gdyby miał, brak .git i wertis.env go ratuje.
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\Windows" -Zawartosc @("System32", "Temp", "explorer.exe")
    Zaloz (-not $p.Wolno) "zgoda na skasowanie C:\Windows"
}

Sprawdz "katalog z samym server\ to za mało - brak znamion instalacji" {
    # Sam `server` bywa w cudzych projektach. Rozpoznanie wymaga DRUGIEGO
    # znamienia, bo inaczej -Katalog wskazujący czyjeś repo przechodzi.
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\projekty\cudze" -Zawartosc @("server", "README.md")
    Zaloz (-not $p.Wolno) "sam server\ wystarczył do zgody"
}

Sprawdz "instalacja z .git przechodzi" {
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis" -Zawartosc @("server", ".git", "tools", "logs")
    Zaloz ($p.Wolno) "prawdziwa instalacja dostała odmowę: $($p.Powod)"
}

Sprawdz "instalacja bez .git, ale z wertis.env, też przechodzi" {
    # Stan po ręcznym wdrożeniu z DEPLOY.md: pliki są, historii gita nie ma.
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis" -Zawartosc @("server", "wertis.env")
    Zaloz ($p.Wolno) "instalacja bez .git dostała odmowę: $($p.Powod)"
}

Sprawdz "domyślnie dane są OCALANE, ze stemplem w nazwie" {
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis" -Zawartosc @("server", ".git") -Stempel "20260730-1530"
    Zaloz ($p.Wolno)
    Zaloz ($p.DaneDo -eq "C:\wertis-dane-20260730-1530") "zła ścieżka danych: '$($p.DaneDo)'"
}

Sprawdz "ukośnik na końcu nie rozdwaja ścieżki danych" {
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis\" -Zawartosc @("server", ".git") -Stempel "20260730-1530"
    Zaloz ($p.DaneDo -eq "C:\wertis-dane-20260730-1530") "zła ścieżka danych: '$($p.DaneDo)'"
}

Sprawdz "-UsunDane kasuje wszystko razem" {
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis" -Zawartosc @("server", ".git") -UsunDane
    Zaloz ($p.Wolno)
    Zaloz ($p.DaneDo -eq "") "z -UsunDane nie ma czego przenosić, a plan wskazuje $($p.DaneDo)"
}

Sprawdz "brak katalogu to NIE błąd - usługi trzeba zdjąć mimo to" {
    # Deinstalacja po ręcznym skasowaniu C:\wertis. Musi dojść do końca,
    # a nie przewrócić się na pierwszym kroku.
    $p = Get-WertisPlanDeinstalacji -Katalog "C:\wertis" -Zawartosc @()
    Zaloz (-not $p.Wolno)
    Zaloz ($p.Powod -match "nie ma") "powód ma nazywać brak katalogu, jest: '$($p.Powod)'"
}

Sprawdz "każda odmowa niesie powód" {
    # Odmowa bez powodu wygląda na awarię skryptu i kończy się skasowaniem
    # katalogu ręką — czyli dokładnie tym, przed czym bramka broni.
    #
    # Bez pętli po tablicy tablic CELOWO: @(@(), @("server")) PowerShell
    # SPŁASZCZA, więc przypadek pustej zawartości zniknąłby po cichu.
    foreach ($p in @(
        (Get-WertisPlanDeinstalacji -Katalog "C:\cos" -Zawartosc @()),
        (Get-WertisPlanDeinstalacji -Katalog "C:\cos" -Zawartosc @("server")),
        (Get-WertisPlanDeinstalacji -Katalog "C:\cos" -Zawartosc @("System32")),
        (Get-WertisPlanDeinstalacji -Katalog "C:\" -Zawartosc @("server", ".git"))
    )) {
        Zaloz (-not $p.Wolno) "zgoda tam, gdzie ma być odmowa"
        Zaloz ([bool]$p.Powod) "odmowa bez powodu dla $($p.Katalog)"
    }
}

# ── Wynik ───────────────────────────────────────────────────────────────────

Write-Host ""
if ($script:bledy) {
    Write-Host "$($script:zdane) zdanych, $($script:bledy) NIEZDANYCH" -ForegroundColor Red
    exit 1
}
Write-Host "$($script:zdane) zdanych, 0 niezdanych" -ForegroundColor Green
exit 0
