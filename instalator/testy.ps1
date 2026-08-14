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

Sprawdz "nadaje SELECT dokladnie na tabelach z listy odczytu" {
    # Liczba NIE jest wpisana z ręki po żadnej ze stron: skrypt generuje granty
    # z `$script:WertisTabeleOdczytu`, a ten test z niej liczy oczekiwanie.
    # Dopisanie tabeli przestawia jedno i drugie naraz.
    $ile = ([regex]::Matches($skrypt, "GRANT SELECT ON")).Count
    $oczekiwane = @($script:WertisTabeleOdczytu).Count
    Zaloz ($ile -eq $oczekiwane) "GRANT SELECT jest $ile razy, a lista ma $oczekiwane pozycji"
    foreach ($t in $script:WertisTabeleOdczytu) {
        Zaloz ($skrypt -match "GRANT SELECT ON dbo\.$($t.Tabela)\b") "brak grantu na $($t.Tabela)"
    }
}

Sprawdz "bez tabeli zdjec siodmy GRANT nie jest nadawany" {
    <#
        Skrypt idzie do bazy JEDNYM ExecuteNonQuery. `GRANT SELECT` na
        nieistniejący obiekt wywala całe wykonanie, więc konto zostawałoby bez
        ANI JEDNEGO uprawnienia — na bazie, na której zdjęć po prostu nie ma.
    #>
    $bez = Get-WertisSkryptUprawnien -Baza "FIRMA_TEST" -KolumnaLokalizacji "tw_Pole3" `
        -Haslo "Abc-123xyz" -Zdjecia $false
    Zaloz (-not ($bez -match "tw_ZdjecieTw")) "grant na tabelę zdjęć został mimo -Zdjecia:false"
    Zaloz ($bez -match "GRANT SELECT ON dbo\.tw__Towar") "reszta grantów ma zostać"
    $ile = ([regex]::Matches($bez, "GRANT SELECT ON")).Count
    $oczekiwane = @(Get-WertisTabeleOdczytu -Zdjecia $false).Count
    Zaloz ($ile -eq $oczekiwane) "GRANT SELECT jest $ile razy, a lista bez zdjęć ma $oczekiwane pozycji"
}

Sprawdz "czyta slownik magazynow i zdjecia kartotek" {
    # Obie tabele mają własne uzasadnienie i obie łatwo przeoczyć przy
    # przepisywaniu skryptu: bez sl_Magazyn karta pokazuje `mag_Id = 7` zamiast
    # nazwy, bez tw_ZdjecieTw slot zdjęcia zostaje pusty bez powodu na ekranie.
    Zaloz ($skrypt -match "GRANT SELECT ON dbo\.sl_Magazyn") "brak grantu na sl_Magazyn"
    Zaloz ($skrypt -match "GRANT SELECT ON dbo\.tw_ZdjecieTw") "brak grantu na tw_ZdjecieTw"
}

# ── Próg sprawdzenia uprawnień kontra własny skrypt ─────────────────────────
# POWSTAŁO PO ZASTANEJ USTERCE. `Test-WertisUprawnienia` żądało `-ge 7`, a
# skrypt nadawał sześć grantów od 0.16.0 (wypadły fl_Wartosc i fl__Flagi).
# Komplet uprawnień nadany WŁASNYM skryptem instalatora był więc meldowany
# jako niekompletny, a kreator wypisywał czerwone zdanie po poprawnej
# instalacji.
#
# Liczba w obu testach jest LICZONA ZE SKRYPTU, nie wpisana z palca — to jest
# jedyny sposób, żeby próg i skrypt nie rozjechały się drugi raz. Dopisanie
# siódmego grantu (np. tabeli ze zdjęciami) przestawi oba naraz.

Write-Host ""
Write-Host "Prog Test-WertisUprawnien"

function Uprawnienia-Atrapa {
    <#
        .SYNOPSIS
        Wiersze udające wynik `Get-WertisUprawnienia`: N grantów SELECT plus
        kolumnowy UPDATE na lokalizacji.
    #>
    param([int]$Select, [string]$Kolumna = "tw_Pole3")
    $wiersze = 1..$Select | ForEach-Object {
        [pscustomobject]@{ permission_name = "SELECT"; state_desc = "GRANT"; obiekt = "tabela$_"; kolumna = $null }
    }
    # Zapisy z tej samej listy, z ktorej nadaje je skrypt - inaczej atrapa
    # opisywalaby komplet sprzed ostatniej zmiany i test przestalby cokolwiek
    # sprawdzac.
    $zapisy = Get-WertisKolumnyZapisu -KolumnaLokalizacji $Kolumna | ForEach-Object {
        [pscustomobject]@{ permission_name = "UPDATE"; state_desc = "GRANT"; obiekt = "tw__Towar"; kolumna = $_.Kolumna }
    }
    return @($wiersze) + @($zapisy)
}

Sprawdz "prog przepuszcza komplet nadany wlasnym skryptem" {
    $ile = ([regex]::Matches($skrypt, "GRANT SELECT ON")).Count
    $ocena = Test-WertisUprawnienia -Uprawnienia (Uprawnienia-Atrapa -Select $ile) -KolumnaLokalizacji "tw_Pole3"
    Zaloz ($ocena.Ok) "prog odrzuca $ile grantow, czyli dokladnie tyle, ile nadaje skrypt"
    Zaloz ($ocena.Wymaganych -eq $ile) "prog mowi, ze wymaga $($ocena.Wymaganych), a skrypt nadaje $ile"
}

Sprawdz "prog odrzuca komplet o jeden GRANT za maly" {
    # Ten test złapał REGRESJĘ przy dodawaniu tw_ZdjecieTw: skrypt urósł do
    # siedmiu grantów, a próg został przy sześciu, więc niepełny komplet
    # znowu przechodził. Dlatego liczba po obu stronach bierze się dziś
    # z jednej listy, a nie z pamięci.
    $ile = ([regex]::Matches($skrypt, "GRANT SELECT ON")).Count - 1
    $ocena = Test-WertisUprawnienia -Uprawnienia (Uprawnienia-Atrapa -Select $ile) -KolumnaLokalizacji "tw_Pole3"
    Zaloz (-not $ocena.Ok) "prog przepuszcza brakujacy GRANT"
}

Sprawdz "prog idzie za ta sama decyzja o zdjeciach, co skrypt" {
    # Gdyby próg został przy siedmiu, komplet nadany ŚWIADOMIE bez zdjęć byłby
    # meldowany jako niekompletny — ta sama usterka co dwa razy wcześniej,
    # tylko od drugiej strony. Obie liczby biorą się z jednej listy.
    $ile = @(Get-WertisTabeleOdczytu -Zdjecia $false).Count
    $upr = Uprawnienia-Atrapa -Select $ile
    $ocena = Test-WertisUprawnienia -Uprawnienia $upr -KolumnaLokalizacji "tw_Pole3" -Zdjecia $false
    Zaloz ($ocena.Ok) "komplet bez zdjęć ma przechodzić przy -Zdjecia:false"
    $zZdjeciami = Test-WertisUprawnienia -Uprawnienia $upr -KolumnaLokalizacji "tw_Pole3" -Zdjecia $true
    Zaloz (-not $zZdjeciami.Ok) "ten sam komplet ma NIE przechodzić, gdy zdjęcia są włączone"
}

Sprawdz "prog odrzuca prawo zapisu do dokumentow" {
    # Ta reguła jest ważniejsza niż liczba tabel: rozluźnienie skryptu o zapis
    # do dok__Dokument nie ma prawa przejść, choćby SELECT-ów było dość.
    $upr = @(Uprawnienia-Atrapa -Select 6) + @(
        [pscustomobject]@{ permission_name = "UPDATE"; state_desc = "GRANT"; obiekt = "dok__Dokument"; kolumna = $null }
    )
    $ocena = Test-WertisUprawnienia -Uprawnienia $upr -KolumnaLokalizacji "tw_Pole3"
    Zaloz (-not $ocena.Ok) "prog przepuszcza prawo zapisu do dok__Dokument"
}

Sprawdz "prawa zapisu to DOKLADNIE kolumny z listy i nic wiecej" {
    # Test na samą dok__Dokument (niżej) przepuściłby kolejny wyjątek dopisany
    # do INNEJ tabeli — dokładnie tak weszła kiedyś flaga faktury. Liczymy więc
    # WSZYSTKIE granty zapisu i porównujemy z listą, z której są nadawane.
    #
    # Do 0.38.0 stała tu liczba 1 wpisana z ręki. Kod kreskowy (0.37.0) dołożył
    # drugą kolumnę po stronie serwera i nikt tego testu nie ruszył, bo
    # instalatora też nikt nie ruszył — a objawem była odmowa uprawnienia na
    # produkcji, długo po „udanej" instalacji.
    $oczekiwane = @(Get-WertisKolumnyZapisu -KolumnaLokalizacji "tw_Pole3").Count
    $zapisy = ([regex]::Matches($skrypt, "GRANT (INSERT|UPDATE|DELETE)")).Count
    Zaloz ($zapisy -eq $oczekiwane) "grantow zapisu jest $zapisy, ma byc $oczekiwane"
}

Sprawdz "nadaje prawo zapisu do kodu kreskowego" {
    # Wdrozenie 0.37.0 potknelo sie o brak tej jednej linii.
    Zaloz ($skrypt -match "GRANT UPDATE ON dbo\.tw__Towar \(tw_PodstKodKresk\)") "brak grantu na kod kreskowy"
}

Sprawdz "prog odrzuca komplet BEZ kodu kreskowego" {
    # Regresja wprost na usterke: uprawnienia sprzed 0.37.0 (sama lokalizacja)
    # maja byc zgloszone jako niekompletne, z nazwa brakujacej kolumny.
    $ile = @(Get-WertisTabeleOdczytu -Zdjecia $true).Count
    $stare = @(1..$ile | ForEach-Object {
        [pscustomobject]@{ permission_name = "SELECT"; state_desc = "GRANT"; obiekt = "tabela$_"; kolumna = $null }
    }) + @(
        [pscustomobject]@{ permission_name = "UPDATE"; state_desc = "GRANT"; obiekt = "tw__Towar"; kolumna = "tw_Pole3" }
    )
    $ocena = Test-WertisUprawnienia -Uprawnienia $stare -KolumnaLokalizacji "tw_Pole3"
    Zaloz (-not $ocena.Ok) "prog przepuszcza uprawnienia sprzed 0.37.0"
    Zaloz ($ocena.BrakujaceZapisy -contains "tw_PodstKodKresk") "prog nie nazywa brakujacej kolumny"
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

Sprawdz "ISTNIEJĄCY login dostaje NOWE hasło, a nie zostaje ze starym" {
    <#
        Awaria u klienta: pierwsze podejście kreatora wywaliło się na literówce
        w nazwie instancji, ale login `wertis` zdążył powstać — jest obiektem
        INSTANCJI, więc przeżył. Drugi przebieg trafił w `IF NOT EXISTS`,
        pominął CREATE LOGIN i ZOSTAWIŁ STARE HASŁO, podczas gdy instalator
        zapisał do wertis.env świeżo wylosowane.

        Kreator zameldował „Konto gotowe". Objawem był dopiero
        `Login failed for user 'wertis'` w logu usługi, przy starcie.
    #>
    Zaloz ($skrypt -match "ALTER LOGIN \[wertis\] WITH PASSWORD") "brak ALTER LOGIN dla istniejącego konta"
    Zaloz ($skrypt -match "ELSE") "gałąź dla istniejącego loginu musi istnieć"
}

Sprawdz "wyłączony login jest z powrotem włączany" {
    # Ten sam objaw i ta sama cisza co przy rozjechanym haśle.
    Zaloz ($skrypt -match "ALTER LOGIN \[wertis\] ENABLE") "brak ALTER LOGIN ... ENABLE"
}

Sprawdz "hasło idzie do OBU gałęzi, nie tylko do CREATE" {
    # Regresja najłatwiejsza do wprowadzenia: poprawka dopisana obok CREATE,
    # ale bez podstawienia hasła — i konto znów zostaje ze starym.
    $s = Get-WertisSkryptUprawnien -Baza "X" -KolumnaLokalizacji "tw_Pole1" -Haslo "Zzz-999abc"
    $ile = ([regex]::Matches($s, [regex]::Escape("'Zzz-999abc'"))).Count
    Zaloz ($ile -eq 2) "hasło ma stać w CREATE LOGIN i w ALTER LOGIN, stoi $ile raz(y)"
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

# ── Co blokuje kasowany katalog ─────────────────────────────────────────────
# Deinstalacja u klienta stanęła na „jakiś proces używa": osierocony node.exe
# przeżył `nssm remove`, a powłoka stała w C:\wertis, bo tak kazały wcześniejsze
# kroki. Ubijanie procesów opiera się na porównaniu ścieżek — i to porównanie
# jest tu najgroźniejszym miejscem w całej zmianie.

Write-Host ""
Write-Host "Test-SciezkaWewnatrz"

Sprawdz "sąsiedni katalog o wspólnym przedrostku NIE jest wewnątrz" {
    # Najdroższy możliwy błąd tej funkcji: bez separatora na końcu prefiksu
    # deinstalacja WERTIS ubija node.exe z cudzej instalacji obok.
    Zaloz (-not (Test-SciezkaWewnatrz -Sciezka "C:\wertis2\node.exe" -Katalog "C:\wertis"))
}

Sprawdz "plik w podkatalogu jest wewnątrz" {
    Zaloz (Test-SciezkaWewnatrz -Sciezka "C:\wertis\server\node.exe" -Katalog "C:\wertis")
}

Sprawdz "sam katalog liczy się jako wewnątrz" {
    # To jest przypadek powłoki: `cd C:\wertis` blokuje kasowanie tak samo
    # jak proces z pliku w środku.
    Zaloz (Test-SciezkaWewnatrz -Sciezka "C:\wertis" -Katalog "C:\wertis")
}

Sprawdz "ukośnik na końcu niczego nie zmienia" {
    Zaloz (Test-SciezkaWewnatrz -Sciezka "C:\wertis\tools" -Katalog "C:\wertis\")
    Zaloz (Test-SciezkaWewnatrz -Sciezka "C:\wertis\" -Katalog "C:\wertis")
}

Sprawdz "wielkość liter nie ma znaczenia" {
    # Windows nie rozróżnia, a Get-Process potrafi zwrócić ścieżkę w innej
    # wielkości niż ta wpisana w -Katalog.
    Zaloz (Test-SciezkaWewnatrz -Sciezka "c:\WERTIS\server\node.exe" -Katalog "C:\wertis")
}

Sprawdz "pusta ścieżka daje fałsz, a nie wyjątek" {
    # Get-Process zwraca procesy bez czytelnej ścieżki. Wyjątek tutaj
    # przerwałby deinstalację na krok przed końcem.
    foreach ($s in @($null, "", "   ")) {
        Zaloz (-not (Test-SciezkaWewnatrz -Sciezka $s -Katalog "C:\wertis")) "'$s' uznane za wewnątrz"
        Zaloz (-not (Test-SciezkaWewnatrz -Sciezka "C:\wertis\a.exe" -Katalog $s)) "pusty katalog przyjął ścieżkę"
    }
}

Write-Host ""
Write-Host "Get-WertisProcesyDoUbicia"

# Namiastka tego, co zwraca Get-Process: liczy się Id, ProcessName i Path.
function Proc { param($Id, $Nazwa, $Sciezka)
    [pscustomobject]@{ Id = $Id; ProcessName = $Nazwa; Path = $Sciezka }
}

Sprawdz "bierze procesy z katalogu, zostawia te z zewnątrz" {
    $do = Get-WertisProcesyDoUbicia -Katalog "C:\wertis" -WlasnyPid 1 -Procesy @(
        (Proc 10 "node" "C:\wertis\server\node.exe"),
        (Proc 11 "node" "C:\Program Files\nodejs\node.exe"),
        (Proc 12 "node" "C:\wertis2\node.exe")
    )
    Zaloz (@($do).Count -eq 1) "wybrano $(@($do).Count) procesów zamiast jednego"
    Zaloz ($do[0].Id -eq 10) "wybrano zły proces: PID $($do[0].Id)"
}

Sprawdz "własny PID nigdy nie trafia na listę" {
    # Instalator uruchomiony z kopii wewnątrz katalogu ubiłby sam siebie
    # w połowie deinstalacji, zostawiając usługi zdjęte, a katalog na miejscu.
    $do = Get-WertisProcesyDoUbicia -Katalog "C:\wertis" -WlasnyPid 99 -Procesy @(
        (Proc 99 "powershell" "C:\wertis\instalator\powershell.exe")
    )
    Zaloz (@($do).Count -eq 0) "instalator wybrał do ubicia samego siebie"
}

Sprawdz "proces bez czytelnej ścieżki jest pomijany, nie wywraca wyboru" {
    $do = Get-WertisProcesyDoUbicia -Katalog "C:\wertis" -WlasnyPid 1 -Procesy @(
        (Proc 20 "System" $null),
        (Proc 21 "csrss" ""),
        (Proc 22 "node" "C:\wertis\server\node.exe")
    )
    Zaloz (@($do).Count -eq 1) "pusta ścieżka zmyliła wybór"
    Zaloz ($do[0].Id -eq 22)
}

Sprawdz "pusta lista procesów to pusty wynik" {
    Zaloz (@(Get-WertisProcesyDoUbicia -Katalog "C:\wertis" -Procesy @()).Count -eq 0)
}

# ── Środowisko usług, które potrafi przykryć wertis.env ─────────────────────
# Wdrożenie przeszło cały kreator i wylądowało na danych demo: instalator
# zapisał SGT_MODE=mssql, plik został wczytany, a proces startował w trybie
# seeded — bo starsza instalacja zostawiła SGT_MODE w AppEnvironment, a kreator
# kasował wyłącznie AppEnvironmentExtra.
#
# Samego `nssm reset` w CI wykonać się nie da (nie ma tu usług). Sprawdzalne
# jest to, CZEGO instalator zamierza dotknąć — i to wystarczy, żeby regresja
# „znowu tylko jedno" nie przeszła po cichu.

Write-Host ""
Write-Host "Klucze środowiska NSSM"

Sprawdz "kasowane są OBA ustawienia, nie tylko Extra" {
    $k = $script:WertisKluczeSrodowiskaNssm
    Zaloz ($k -contains "AppEnvironmentExtra") "brak AppEnvironmentExtra"
    Zaloz ($k -contains "AppEnvironment") "brak AppEnvironment - to była właśnie ta luka"
}

Sprawdz "lista nie zawiera nic ponad te dwa" {
    # `nssm reset` na przypadkowym ustawieniu skasowałby konfigurację usługi,
    # a nie zmienną środowiskową.
    Zaloz (@($script:WertisKluczeSrodowiskaNssm).Count -eq 2) "lista ma mieć dokładnie dwie pozycje"
}

# ── Konto admina: sekret idzie do bazy, nie na dysk ─────────────────────────
# Instalator zakłada jedno konto (rola `admin`), pytając instalującego o hasło.
# Hasło leci przez API i ma zniknąć razem z sesją konsoli. Gdyby trafiło do
# `wertis.env`, zostałoby na dysku serwera na zawsze — w pliku, który czyta się
# przy każdej diagnozie i wysyła w załączniku przy każdym zgłoszeniu.
#
# Uwaga o umiejscowieniu: te testy stoją PRZED sekcją wyniku świadomie. Dwa
# testy dopisane tu w 0.23.0 stały po `exit 0` i nigdy się nie wykonały —
# napisane, zielone w opisie, martwe w praktyce.

Write-Host ""
Write-Host "Konto admina"

Sprawdz "biała lista wertis.env nie zna kluczy od kont" {
    <#
        Test czyta ŹRÓDŁO, a nie zachowanie: chodzi o to, żeby klucz od konta
        nie dał się dopisać do listy przez nieuwagę, zanim ktokolwiek uruchomi
        kreator. Wycinek jest zawężony do samej `$kolejnosc`, bo te same nazwy
        stoją dziś także na liście kluczy NIEPRZEPISYWANYCH z istniejącego
        pliku — czyli dokładnie tam, gdzie mają stać.
    #>
    $zrodlo = Get-Content (Join-Path $PSScriptRoot "uslugi.ps1") -Raw
    $m = [regex]::Match($zrodlo, '(?s)\$kolejnosc = @\((.*?)\r?\n\s*\)')
    Zaloz $m.Success "nie znalazłem definicji `$kolejnosc w uslugi.ps1"
    foreach ($klucz in @("ADMIN_HASLO", "ADMIN_LOGIN", "WERTIS_ADMIN")) {
        Zaloz (-not ($m.Groups[1].Value -match "`"$klucz`"")) "$klucz pojawił się na białej liście"
    }
}

Sprawdz "klucz dopisany ręką przeżywa ponowny przebieg instalatora" {
    <#
        POWSTAŁO PO ZGŁOSZENIU Z WDROŻENIA. `Publish-WertisKonfiguracja`
        odtwarzało plik od zera z ustawień kreatora, więc każdy klucz, o który
        kreator nie pyta — a dokumentacja każe dopisać ręką — znikał przy
        najbliższym `-TylkoKonfiguracja`. Funkcja gasła bez jednego błędu.
    #>
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-scal-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        $plik = Join-Path $katalog "wertis.env"
        Write-WertisPlik -Sciezka $plik -Tresc @"
# stary plik
export SGT_MODE='mssql'
export MSSQL_INSTANCE='INSERTGT'
export DOK_TYPY_DOSTAW='7,8'
export ZDJECIA_ZRODLO='blob'
export ADMIN_HASLO='przeciek'
"@
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE      = "mssql"
            MSSQL_SERVER  = "SERWER"
        }
        $tresc = Get-Content $plik -Raw
        Zaloz ($tresc -match "DOK_TYPY_DOSTAW='7,8'")   "klucz dopisany ręką zniknął przy przepisaniu pliku"
        Zaloz ($tresc -match "ZDJECIA_ZRODLO='blob'")   "znany klucz spoza kreatora zniknął przy przepisaniu pliku"
        Zaloz ($tresc -match "MSSQL_INSTANCE='INSERTGT'") "kreator nie pytał o instancję, a wartość zniknęła"
        Zaloz ($tresc -match "MSSQL_SERVER='SERWER'")   "ustawienie kreatora nie trafiło do pliku"
        Zaloz (-not ($tresc -match "przeciek"))         "hasło admina z pliku zostało przepisane"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "kreator wygrywa z wartością z pliku, także pustą" {
    <#
        Druga połowa reguły scalania. Gdyby zachowanie kluczy działało „stara
        wartość wygrywa, gdy nowa jest pusta", przejście z instancji nazwanej
        na domyślną byłoby niewykonalne przez kreator: człowiek zostawia pole
        puste, a plik dalej wskazuje INSERTGT.
    #>
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-nadp-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        $plik = Join-Path $katalog "wertis.env"
        Write-WertisPlik -Sciezka $plik -Tresc "export MSSQL_INSTANCE='INSERTGT'`nexport MSSQL_USER='stary'`n"
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE       = "mssql"
            MSSQL_INSTANCE = ""
            MSSQL_USER     = "wertis"
        }
        $tresc = Get-Content $plik -Raw
        Zaloz (-not ($tresc -match "INSERTGT")) "pusta wartość z kreatora nie skasowała starej instancji"
        Zaloz ($tresc -match "MSSQL_USER='wertis'") "kreator nie nadpisał loginu"
        Zaloz (-not ($tresc -match "'stary'")) "stary login został obok nowego"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "pusta wartosc kluczy o niepustej domyslnej trafia do pliku wprost" {
    <#
        `MSSQL_ZD_ZREAL_COLUMN` ma domyślną `ob_IloscZrealizowana` — nazwę
        ZGADNIĘTĄ i błędną dla tej wersji bazy. Kreator sprawdza, czy kolumna
        istnieje, i gdy jej nie ma, zapisuje PUSTKĘ. Gdyby pustka oznaczała tu
        „nie ustawiono", klucz nie wyszedłby do pliku, serwer wróciłby do
        wartości domyślnej i dalej pytał o nieistniejącą kolumnę — bez objawu.
    #>
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-pust-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE              = "mssql"
            MSSQL_ZD_ZREAL_COLUMN = ""
            MSSQL_INSTANCE        = ""
            MSSQL_DATABASE        = ""
        }
        $tresc = Get-Content (Join-Path $katalog "wertis.env") -Raw
        Zaloz ($tresc -match "MSSQL_ZD_ZREAL_COLUMN=''") "pusta nazwa kolumny nie trafiła do pliku"
        Zaloz ($tresc -match "MSSQL_INSTANCE=''")        "pusta instancja nie trafiła do pliku"
        # Kontrola przeciwna: zwykły klucz o pustej wartości nadal się nie zapisuje
        Zaloz (-not ($tresc -match "MSSQL_DATABASE"))    "pusty zwykły klucz nie ma prawa się zapisać"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "pusta wartosc wpisana recznie tez przezywa przebieg" {
    # Ten sam klucz, druga droga: dokumentacja każe wpisać `=` bez wartości.
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-pust2-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        $plik = Join-Path $katalog "wertis.env"
        Write-WertisPlik -Sciezka $plik -Tresc "export MSSQL_ZD_ZREAL_COLUMN=`n"
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE = "mssql"
        }
        $tresc = Get-Content $plik -Raw
        Zaloz ($tresc -match "MSSQL_ZD_ZREAL_COLUMN=''") "pusta wartość z pliku przepadła przy przepisaniu"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "parser wertis.env rozumie to samo, co serwer" {
    # Rozjazd z `parseEnvFile` (server/src/env-file.ts) kończy się tym, że
    # instalator nie widzi klucza, którego aplikacja używa - i kasuje go.
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-parse-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        $plik = Join-Path $katalog "wertis.env"
        Write-WertisPlik -Sciezka $plik -Tresc @"
# komentarz pelnej linii
export W_APOSTROFACH='ala ma kota'
BEZ_EXPORT="w cudzyslowie"
GOLA=wartosc   # komentarz doklejony
Z_KRATKA=haslo#7
   ODSTEP = 'z odstepami'
to nie jest przypisanie
"@
        $wpisy = Read-WertisEnv -Sciezka $plik
        Zaloz ($wpisy["W_APOSTROFACH"] -eq "ala ma kota")   "apostrofy nie zostały zdjęte"
        Zaloz ($wpisy["BEZ_EXPORT"] -eq "w cudzyslowie")    "linia bez export nie została wczytana"
        Zaloz ($wpisy["GOLA"] -eq "wartosc")                "komentarz po białym znaku nie został ucięty"
        Zaloz ($wpisy["Z_KRATKA"] -eq "haslo#7")            "kratka bez odstępu ucięła wartość"
        Zaloz ($wpisy["ODSTEP"] -eq "z odstepami")          "odstępy wokół znaku równości psują odczyt"
        Zaloz ($wpisy.Count -eq 5)                          "parser wczytał coś ponad pięć kluczy"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "brak pliku to pusty wynik, a nie błąd" {
    # Pierwsza instalacja niczego jeszcze nie zapisała.
    $wpisy = Read-WertisEnv -Sciezka (Join-Path ([IO.Path]::GetTempPath()) ("nie-ma-" + [Guid]::NewGuid()))
    Zaloz ($wpisy.Count -eq 0) "brakujący plik miał dać pusty słownik"
}

Sprawdz "biala lista przepuszcza klucze zdjec kartotek" {
    # Ustawienia zdjęć wolno podać wywołaniem programistycznym, a nie tylko
    # ręcznym wpisem do pliku — biała lista musi je znać, bo inaczej wartość
    # przekazana w `$Ustawienia` przepadałaby bez śladu.
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-zdj-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE        = "mssql"
            ZDJECIA_ZRODLO  = "blob"
            ZDJECIA_KOLUMNA = "zdj_Dane"
        }
        $tresc = Get-Content (Join-Path $katalog "wertis.env") -Raw
        Zaloz ($tresc -match "ZDJECIA_ZRODLO='blob'") "ZDJECIA_ZRODLO nie zapisalo sie do wertis.env"
        Zaloz ($tresc -match "ZDJECIA_KOLUMNA='zdj_Dane'") "ZDJECIA_KOLUMNA nie zapisalo sie do wertis.env"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "hasło podane w ustawieniach NIE trafia do pliku" {
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-adm-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE    = "mssql"
            ADMIN_HASLO = "tajnehaslo123"
        }
        $tresc = Get-Content (Join-Path $katalog "wertis.env") -Raw
        Zaloz ($tresc -match "SGT_MODE=") "zwykłe ustawienie ma się zapisać"
        Zaloz (-not ($tresc -match "tajnehaslo123")) "hasło admina przeciekło do wertis.env"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "walidacja hasła admina odrzuca za krótkie" {
    # Ta sama reguła co na serwerze (HASLO_MIN = 8). Instalator sprawdza ją
    # SAM, żeby nie odbić się od API po tym, jak człowiek wpisał hasło dwa razy.
    Zaloz (-not (Test-WertisHasloAdmina "krotkie")) "7 znaków ma odpaść"
    Zaloz (Test-WertisHasloAdmina "osiemzna") "8 znaków ma przejść"
}

Sprawdz "przebieg próbny przechodzi krok konta z PUSTYM hasłem" {
    <#
        Regresja, która wywróciła CI przy pierwszym uruchomieniu tego kroku.
        W `-DryRun` nikt o hasło nie pyta, więc do funkcji leci pusty łańcuch —
        a `[Parameter(Mandatory)][string]` odrzuca go w BINDERZE, czyli zanim
        `Test-DryRun` zdąży zwrócić $true. Przebieg próbny wywalał się na kroku,
        który z definicji niczego nie robi.
    #>
    $bylo = $script:WertisDryRun
    $script:WertisDryRun = $true
    try {
        Zaloz (New-WertisKontoAdmina -Login "admin" -Haslo "") "krok próbny ma przejść bez hasła"
    } finally {
        $script:WertisDryRun = $bylo
    }
}

# ── Worker Sfery (usługa wertis-sfera) ──────────────────────────────────────
# Trzecia usługa jest OPCJONALNA (wymaga licencji Sfery i zbudowanego exe),
# więc reguły wokół niej to głównie „nic nie psuj, gdy jej nie ma".

Write-Host ""
Write-Host "Worker Sfery"

Sprawdz "biała lista wertis.env przepuszcza klucze Sfery" {
    # Bez wpisu na białej liście SFERA_WORKER nigdy nie trafiłby do pliku
    # i wybór w kreatorze nie zmieniałby niczego — bez żadnego objawu.
    $katalog = Join-Path ([IO.Path]::GetTempPath()) ("wertis-sfw-" + [Guid]::NewGuid())
    New-Item -ItemType Directory -Path $katalog | Out-Null
    try {
        Publish-WertisKonfiguracja -Katalog $katalog -Nssm "cmd.exe" -Uslugi @() -Ustawienia @{
            SGT_MODE       = "mssql"
            SFERA_WORKER   = "1"
            SFERA_OPERATOR = "Szef"
        }
        $tresc = Get-Content (Join-Path $katalog "wertis.env") -Raw
        Zaloz ($tresc -match "SFERA_WORKER='1'") "SFERA_WORKER nie zapisał się do wertis.env"
        Zaloz ($tresc -match "SFERA_OPERATOR='Szef'") "SFERA_OPERATOR nie zapisał się do wertis.env"
    } finally {
        Remove-Item $katalog -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Sprawdz "rejestracja usługi z samym exe (bez -Skrypt) przechodzi przebieg próbny" {
    <#
        Ta sama klasa regresji co „puste hasło admina": worker Sfery to
        samodzielny exe, więc `-Skrypt` bywa nieobecny — gdyby wrócił do
        [Parameter(Mandatory)], binder odrzuciłby wywołanie ZANIM Test-DryRun
        cokolwiek powie, i przebieg próbny wywracałby się na kroku,
        który z definicji niczego nie robi.
    #>
    $bylo = $script:WertisDryRun
    $script:WertisDryRun = $true
    try {
        Register-WertisUsluga -Nssm "nssm.exe" -Nazwa "wertis-sfera" -Katalog "C:\wertis" `
            -Aplikacja "C:\wertis\sfera-worker\wertis-sfera-worker.exe"
        Zaloz $true "rejestracja bez -Skrypt ma przejść"
    } finally {
        $script:WertisDryRun = $bylo
    }
}

Sprawdz "stare wywołania z -Node nadal działają (alias)" {
    $bylo = $script:WertisDryRun
    $script:WertisDryRun = $true
    try {
        Register-WertisUsluga -Nssm "nssm.exe" -Nazwa "wertis-api" -Katalog "C:\wertis" `
            -Node "node.exe" -Skrypt "server\dist\index.js"
        Zaloz $true "alias -Node ma zostać zgodny wstecz"
    } finally {
        $script:WertisDryRun = $bylo
    }
}

# ── Tryb -Aktualizuj ────────────────────────────────────────────────────────
#
# Sedno tego trybu jest NEGATYWNE: chodzi o to, czego NIE robi. Testy pilnują
# więc głównie nieobecności — bo dopisanie do tej gałęzi jednej linii, która
# rusza konto SQL albo `wertis.env`, nie wywraca niczego przy uruchomieniu
# i wyszłoby dopiero na produkcji, na działającej instalacji.

Write-Host "Get-WertisWersja"

Sprawdz "czyta wersję z package.json" {
    $kat = Join-Path $env:TEMP ("wertis-wer-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $kat -Force | Out-Null
    try {
        Set-Content -Path (Join-Path $kat "package.json") -Value '{"version":"0.43.0"}' -Encoding UTF8
        Zaloz ((Get-WertisWersja -Katalog $kat) -eq "0.43.0")
    } finally { Remove-Item $kat -Recurse -Force -ErrorAction SilentlyContinue }
}

Sprawdz "brak pliku daje '?', a nie wyjątek" {
    # numer wersji jest informacją dla człowieka, nie warunkiem powodzenia —
    # aktualizacja nie ma prawa paść na tym, że nie umie się przedstawić
    Zaloz ((Get-WertisWersja -Katalog (Join-Path $env:TEMP "nie-ma-takiego-katalogu-wertis")) -eq "?")
}

Sprawdz "uszkodzony JSON daje '?', a nie wyjątek" {
    $kat = Join-Path $env:TEMP ("wertis-wer2-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $kat -Force | Out-Null
    try {
        Set-Content -Path (Join-Path $kat "package.json") -Value "{to nie jest json" -Encoding UTF8
        Zaloz ((Get-WertisWersja -Katalog $kat) -eq "?")
    } finally { Remove-Item $kat -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host "-Aktualizuj: czego ta galaz NIE dotyka"

$skrypt = Get-Content (Join-Path $zrodlo "wertis-instalator.ps1") -Raw
$galaz = ""
if ($skrypt -match '(?s)if \(\$Aktualizuj\) \{(.*?)\n\}\r?\n\r?\n# ═══ ETAP 1') {
    $galaz = $Matches[1]
}

Sprawdz "gałąź -Aktualizuj w ogóle istnieje i daje się wyciąć" {
    Zaloz ($galaz.Length -gt 200) "nie znalazłem ciała gałęzi -Aktualizuj"
}

# Sprawdzamy, co gałąź ROBI, a nie co o sobie pisze. Odsiewamy komentarze
# ORAZ linie `Write-*`: i jedne, i drugie wymieniają z nazwy wszystko, czego
# gałąź nie dotyka („Nietkniete: konto SQL i GRANT-y…"), więc szukanie tych
# słów w surowym tekście zapalałoby się na własnej dokumentacji i na własnym
# podsumowaniu dla człowieka. Wypisanie nazwy niczego nie zmienia.
$galazKod = ($galaz -split "\r?\n" |
    Where-Object { $_.TrimStart() -notmatch '^#' -and $_.TrimStart() -notmatch '^Write-' }) -join "`n"

foreach ($zakazane in @(
    "New-WertisKontoAdmina",          # konta użytkowników
    "Publish-WertisKonfiguracja",     # wertis.env i środowisko usług
    "Add-WertisRegulaZapory",         # zapora
    "Register-WertisUsluga",          # rejestracja usług w NSSM
    "Read-Tekst",                     # jakiekolwiek pytanie do człowieka
    "Read-Host",
    "GRANT",
    "CREATE LOGIN",
    "CREATE USER"
)) {
    Sprawdz "nie wywołuje: $zakazane" {
        Zaloz (-not ($galazKod -match [regex]::Escape($zakazane))) `
            "gałąź -Aktualizuj dotyka '$zakazane', a miała tylko wgrać kod"
    }
}

Sprawdz "zatrzymuje DOKŁADNIE te usługi, które potem uruchamia" {
    # Pierwsza wersja stopowała dwie, a startowała trzy: `wertis-sfera`
    # przechodziła aktualizację na chodzie i mogła pisać do SQLite w trakcie
    # migracji schematu. Asymetria wyszła dopiero na wydruku z produkcji.
    foreach ($u in @("wertis-api", "wertis-worker", "wertis-sfera")) {
        Zaloz ($galazKod -match [regex]::Escape($u)) "gałąź nie zatrzymuje $u"
    }
}

Sprawdz "zatrzymuje usługi PRZED budowaniem" {
    # `npm ci` kasuje node_modules — działający worker traciłby moduły w locie
    $stop = $galazKod.IndexOf("Stop-Service")
    $build = $galazKod.IndexOf("npm run build")
    Zaloz ($stop -ge 0 -and $build -ge 0 -and $stop -lt $build) `
        "usługi muszą stanąć przed budowaniem"
}

Sprawdz "nieudany git pull przywraca usługi" {
    # bez tego magazyn stoi po nieudanej próbie, a nikt nie wie dlaczego
    $poBledzie = $galaz.Substring($galaz.IndexOf("git pull nie powiódł"))
    Zaloz ($poBledzie -match "Restart-WertisUslugi") `
        "po nieudanym git pull usługi zostają zatrzymane bez śladu"
}

Sprawdz "nieudane budowanie ZOSTAWIA usługi zatrzymane" {
    # stary dist z nową bazą to dwie wersje naraz — lepiej stać niż zgadywać
    $poBledzie = $galaz.Substring($galaz.IndexOf("Budowanie nie powiodło"))
    $doExit = $poBledzie.Substring(0, $poBledzie.IndexOf("exit 1"))
    Zaloz (-not ($doExit -match "Restart-WertisUslugi")) `
        "po nieudanym budowaniu usługi NIE mają wstawać"
}

# ── Wynik ───────────────────────────────────────────────────────────────────

Write-Host ""
if ($script:bledy) {
    Write-Host "$($script:zdane) zdanych, $($script:bledy) NIEZDANYCH" -ForegroundColor Red
    exit 1
}
Write-Host "$($script:zdane) zdanych, 0 niezdanych" -ForegroundColor Green
exit 0
