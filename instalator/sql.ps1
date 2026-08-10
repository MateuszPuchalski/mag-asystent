# Rozmowa z SQL Serverem Subiekta: checklista [WERYFIKUJ] i konto aplikacji.
#
# ŹRÓDŁEM PRAWDY dla tego pliku jest `docs/subiekt-gt-edu-setup.md`:
#   §1 — TCP/IP i uwierzytelnianie mieszane (wymogi wstępne),
#   §2 — skrypt loginu `wertis` z uprawnieniami kolumnowymi + weryfikacja,
#   §3 — checklista: magazyny i pole lokalizacji.
# Zmiana uprawnień poprawia się W OBU MIEJSCACH. Instalator, który po cichu
# nadałby inne prawa niż dokument, byłby gorszy od braku instalatora — nikt by
# tego nie zauważył, bo aplikacja działałaby tak samo.
#
# Sterownik: System.Data.SqlClient z .NET Framework, czyli Windows PowerShell
# 5.1. Nie Invoke-Sqlcmd — moduł SqlServer nie jest instalowany domyślnie
# i ciągnąłby za sobą PSGallery, czyli internet na maszynie produkcyjnej.

function Initialize-WertisSqlClient {
    <#
        .SYNOPSIS
        Ładuje System.Data i sprawdza, że typ SqlConnection istnieje.
        .DESCRIPTION
        Pod PowerShell 7 (pwsh) tego typu w komplecie NIE MA — SqlClient jest
        tam osobnym pakietem NuGet. Instalator celuje w `powershell.exe` 5.1,
        które jest na każdym Windowsie i którego używa też plik .exe. Lepiej
        powiedzieć to wprost tutaj niż wywalić się później komunikatem
        o „niemożliwym do znalezienia typie".
    #>
    if (-not ("System.Data.SqlClient.SqlConnection" -as [type])) {
        try { Add-Type -AssemblyName "System.Data" -ErrorAction Stop } catch { }
    }
    if (-not ("System.Data.SqlClient.SqlConnection" -as [type])) {
        throw "Brak System.Data.SqlClient. Uruchom instalator przez powershell.exe (Windows PowerShell 5.1), nie pwsh."
    }
}

function Get-WertisConnectionString {
    param(
        [Parameter(Mandatory)][string]$Serwer,
        [string]$Instancja,
        [int]$Port,
        [string]$Baza = "master",
        [string]$Uzytkownik,
        [string]$Haslo,
        [switch]$Windows
    )
    $adres = if ($Port -gt 0) { "$Serwer,$Port" }
             elseif ($Instancja) { "$Serwer\$Instancja" }
             else { $Serwer }
    $auth = if ($Windows) { "Integrated Security=SSPI" }
            else { "User ID=$Uzytkownik;Password=$Haslo" }
    return "Server=$adres;Database=$Baza;$auth;TrustServerCertificate=True;Connect Timeout=10;Application Name=WERTIS-Instalator"
}

function Open-WertisPolaczenie {
    <#
        .SYNOPSIS
        Otwiera połączenie albo rzuca wyjątkiem z czytelnym powodem.
    #>
    param([Parameter(Mandatory)][string]$ConnectionString)
    Initialize-WertisSqlClient
    $conn = New-Object System.Data.SqlClient.SqlConnection $ConnectionString
    $conn.Open()
    return $conn
}

function Invoke-WertisZapytanie {
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [Parameter(Mandatory)][string]$Sql,
        [hashtable]$Parametry = @{}
    )
    $cmd = $Polaczenie.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 30
    foreach ($k in $Parametry.Keys) { [void]$cmd.Parameters.AddWithValue($k, $Parametry[$k]) }
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $tabela = New-Object System.Data.DataTable
    [void]$adapter.Fill($tabela)
    return @($tabela.Rows)
}

function Invoke-WertisPolecenie {
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [Parameter(Mandatory)][string]$Sql
    )
    $cmd = $Polaczenie.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 60
    return $cmd.ExecuteNonQuery()
}

function Assert-BezpiecznyIdentyfikator {
    <#
        .SYNOPSIS
        Nazwa kolumny/loginu wchodzi do DDL przez sklejanie tekstu (parametrów
        w DDL nie ma), więc musi być zwykłym identyfikatorem SQL. Ta sama
        zasada obowiązuje w `server/src/config.ts` przy MSSQL_LOC_COLUMN.
    #>
    param([Parameter(Mandatory)][string]$Nazwa, [string]$Opis = "identyfikator")
    if ($Nazwa -notmatch '^[A-Za-z_][A-Za-z0-9_]{0,62}$') {
        throw "Niepoprawny $Opis : '$Nazwa'. Dozwolone są litery, cyfry i podkreślenie."
    }
    return $Nazwa
}

# ── Wymogi wstępne instancji (docs/subiekt-gt-edu-setup.md §1) ───────────────

function Get-WertisInstancjaKlucz {
    <#
        .SYNOPSIS
        Klucz rejestru instancji, np. MSSQL15.INSERTGT. $null, gdy nie ma
        takiej instancji na tej maszynie.
    #>
    param([Parameter(Mandatory)][string]$Instancja)
    # Rejestru może nie być wcale — gdy SQL Server stoi na innej maszynie albo
    # gdy skrypt jest sprawdzany poza Windowsem. To nie jest błąd, tylko brak
    # odpowiedzi: wywołujący ma wtedy iść dalej, a nie przerwać instalację.
    try {
        $mapa = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\Instance Names\SQL"
        if (-not (Test-Path $mapa)) { return $null }
        $wpis = Get-ItemProperty -Path $mapa -ErrorAction SilentlyContinue
        if (-not $wpis) { return $null }
        return $wpis.$Instancja
    } catch { return $null }
}

function Test-WertisWymogiSql {
    <#
        .SYNOPSIS
        Czy instancja przyjmie połączenie loginem SQL po TCP.
        .DESCRIPTION
        Oba warunki są konieczne i oba wynikają z tego, jak aplikacja się łączy:
        sterownik tedious (pakiet `mssql`) chodzi WYŁĄCZNIE po TCP — pamięci
        współdzielonej nie umie — a konto aplikacji to login SQL, nie konto
        Windows. Zwraca obiekt z polami TcpIp, Mieszane i UsluggaSql.
    #>
    param([Parameter(Mandatory)][string]$Instancja)

    $klucz = Get-WertisInstancjaKlucz -Instancja $Instancja
    if (-not $klucz) {
        return [pscustomobject]@{ Znaleziona = $false; TcpIp = $false; Mieszane = $false; Usluga = $null }
    }
    $baza = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$klucz"
    $tcp = $null; $srv = $null
    try {
        $tcp = Get-ItemProperty -Path "$baza\MSSQLServer\SuperSocketNetLib\Tcp" -ErrorAction SilentlyContinue
        $srv = Get-ItemProperty -Path "$baza\MSSQLServer" -ErrorAction SilentlyContinue
    } catch { }

    return [pscustomobject]@{
        Znaleziona = $true
        Klucz      = $klucz
        TcpIp      = ($tcp -and $tcp.Enabled -eq 1)
        Mieszane   = ($srv -and $srv.LoginMode -eq 2)
        Usluga     = $(if ($Instancja -eq "MSSQLSERVER") { "MSSQLSERVER" } else { "MSSQL`$$Instancja" })
    }
}

function Enable-WertisWymogiSql {
    <#
        .SYNOPSIS
        Włącza TCP/IP i uwierzytelnianie mieszane, po czym restartuje instancję.
        .DESCRIPTION
        JEDYNY krok instalatora o skutku poza samą aplikacją: restart usługi
        SQL wyrzuca z Subiekta wszystkich zalogowanych. Dlatego pyta osobno
        i dlatego wywołujący ma go w ogóle nie wołać, gdy Test-WertisWymogiSql
        mówi, że oba warunki są już spełnione (typowy przypadek).
    #>
    param(
        [Parameter(Mandatory)][string]$Instancja,
        [Parameter(Mandatory)]$Stan
    )
    if (Test-DryRun "Włączyłbym TCP/IP i uwierzytelnianie mieszane, po czym zrestartował usługę $($Stan.Usluga).") {
        return $true
    }
    $baza = "HKLM:\SOFTWARE\Microsoft\Microsoft SQL Server\$($Stan.Klucz)"
    if (-not $Stan.TcpIp) {
        Set-ItemProperty -Path "$baza\MSSQLServer\SuperSocketNetLib\Tcp" -Name Enabled -Value 1 -Type DWord
        Write-Ok "TCP/IP włączony."
    }
    if (-not $Stan.Mieszane) {
        Set-ItemProperty -Path "$baza\MSSQLServer" -Name LoginMode -Value 2 -Type DWord
        Write-Ok "Uwierzytelnianie mieszane (SQL + Windows) włączone."
    }
    Write-Info "Restartuję usługę $($Stan.Usluga) — to rozłączy wszystkich z Subiekta na kilkanaście sekund."
    Restart-Service -Name $Stan.Usluga -Force -ErrorAction Stop
    # SQL Browser jest potrzebny tylko przy łączeniu po NAZWIE instancji (bez
    # stałego portu) — czyli w naszej domyślnej konfiguracji.
    $browser = Get-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
    if ($browser -and $browser.Status -ne "Running") {
        Set-Service -Name "SQLBrowser" -StartupType Automatic -ErrorAction SilentlyContinue
        Start-Service -Name "SQLBrowser" -ErrorAction SilentlyContinue
        Write-Ok "Usługa SQL Browser uruchomiona (wymagana przy łączeniu po nazwie instancji)."
    }
    return $true
}

# ── Checklista [WERYFIKUJ] (docs/subiekt-gt-edu-setup.md §3) ─────────────────

function Get-WertisBazy {
    param([Parameter(Mandatory)]$Polaczenie)
    # database_id > 4 pomija master/tempdb/model/msdb; podmiot Subiekta jest
    # zwykłą bazą użytkownika. `create_date` dochodzi tym samym zapytaniem, bo
    # kopia jest z definicji młodsza od podmiotu, którego jest kopią.
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT name, create_date FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name;
"@
}

function Test-WertisBazaSubiekta {
    <#
        .SYNOPSIS
        Czy w bazie są tabele Subiekta. Chroni przed wybraniem z listy bazy
        zupełnie innej aplikacji — nazwa podmiotu bywa nieoczywista.
    #>
    param([Parameter(Mandatory)]$Polaczenie)
    $r = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT COUNT(*) AS ile FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN ('tw__Towar','dok__Dokument','sl_Magazyn','tw_Stan');
"@
    return ($r.Count -gt 0 -and [int]$r[0].ile -eq 4)
}

# ── Która z tych baz to podmiot, a która jego kopia ─────────────────────────
# Firma trzyma obok podmiotu jego kopie — do testów, do sprawdzenia czegoś,
# po awarii. Kopia ma DOKŁADNIE te same tabele co produkcja, więc
# `Test-WertisBazaSubiekta` jej nie odsieje: ono odpowiada na pytanie „czy to
# jest baza Subiekta", a nie „czy to jest TA baza".
#
# Pomyłka jest cicha i dlatego kosztowna. Instalator założyłby konto na kopii,
# aplikacja czytałaby nieaktualne stany i zapisywała lokalizacje w martwą bazę,
# a wszystko wyglądałoby poprawnie — objawem byłby dopiero magazynier, któremu
# stany nie zgadzają się z półką.
#
# Rozstrzyga DATA OSTATNIEGO DOKUMENTU: żywa baza ma dzisiejszą, kopia stoi na
# dniu zrzutu. To heurystyka, nie dowód — firma z przerwą w wystawianiu
# dokumentów wygląda tak samo — więc instalator nigdy nie odrzuca bazy sam.
# Pokazuje różnicę i pyta.

# Powyżej tylu baz pomijamy sondowanie — kreator ma nie wisieć minuty.
$script:WertisMaksBadanychBaz = 25

function Get-WertisStatystykiBazy {
    <#
        .SYNOPSIS
        Dla każdej bazy z listy: czy to Subiekt, kiedy ostatni dokument, ile ich.
        .DESCRIPTION
        Obie liczby są tanie CELOWO. `TOP 1 ... ORDER BY dok_Id DESC` idzie po
        kluczu głównym; `ORDER BY dok_DataWyst` wymagałoby indeksu, którego nie
        ma gwarancji. Licznik bierzemy z metadanych (`sys.partitions`), bo
        `COUNT(*)` na produkcyjnym serwerze, z którego biuro właśnie korzysta,
        to nie jest cena, którą kreator ma prawo zapłacić za podpowiedź.
    #>
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [Parameter(Mandatory)][object[]]$Bazy,
        [int]$Maks = $script:WertisMaksBadanychBaz
    )
    $wynik = @()
    for ($i = 0; $i -lt $Bazy.Count; $i++) {
        $w = [pscustomobject]@{
            Nazwa           = "$($Bazy[$i].name)"
            Utworzona       = $(if ($Bazy[$i].create_date -is [datetime]) { $Bazy[$i].create_date } else { $null })
            Subiekt         = $false
            OstatniDokument = $null
            Dokumentow      = $null
            Uwaga           = $null
        }
        if ($i -ge $Maks) {
            # Milcząco obcięta lista wyglądałaby jak pełna — stąd adnotacja
            # przy KAŻDEJ pominiętej pozycji, a nie jedno zdanie na górze.
            $w.Uwaga = "nie sprawdzano (ponad $Maks baz)"
            $wynik += $w
            continue
        }
        try {
            $Polaczenie.ChangeDatabase($w.Nazwa)
            if (Test-WertisBazaSubiekta -Polaczenie $Polaczenie) {
                $w.Subiekt = $true
                $ost = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT TOP 1 dok_DataWyst FROM dok__Dokument ORDER BY dok_Id DESC;
"@
                if ($ost.Count -gt 0 -and $ost[0].dok_DataWyst -is [datetime]) {
                    $w.OstatniDokument = $ost[0].dok_DataWyst
                }
                $ile = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT ISNULL(SUM(p.rows), 0) AS ile
FROM sys.partitions p
JOIN sys.objects o ON o.object_id = p.object_id
WHERE o.name = 'dok__Dokument' AND o.schema_id = SCHEMA_ID('dbo') AND p.index_id IN (0, 1);
"@
                if ($ile.Count -gt 0) { $w.Dokumentow = [int64]$ile[0].ile }
            } else {
                $w.Uwaga = "nie jest bazą Subiekta"
            }
        } catch {
            # baza offline, w trakcie odtwarzania albo bez dostępu dla tego konta
            $w.Uwaga = "brak dostępu"
        }
        $wynik += $w
    }
    try { $Polaczenie.ChangeDatabase("master") } catch { }
    return $wynik
}

function Sort-WertisBazy {
    <#
        .SYNOPSIS
        Najświeższy podmiot na górze, bazy spoza Subiekta na dole.
        .DESCRIPTION
        Alfabet nie niesie tu żadnej informacji, a przy sortowaniu po nazwie
        kopia potrafi stanąć NAD produkcyjną. Świeżość jest całą treścią pytania,
        więc to ona porządkuje listę.
    #>
    param([Parameter(Mandatory)][object[]]$Bazy)
    return @($Bazy | Sort-Object `
        @{ Expression = { if ($_.Subiekt) { 0 } else { 1 } } },
        @{ Expression = { if ($_.OstatniDokument) { $_.OstatniDokument } else { [datetime]::MinValue } }; Descending = $true },
        @{ Expression = { $_.Nazwa } })
}

function Get-WertisSugerowanaBaza {
    <#
        .SYNOPSIS
        Indeks bazy do podpowiedzi Enterem; -1 gdy podpowiedź byłaby zgadywaniem.
        .DESCRIPTION
        Podpowiadamy WYŁĄCZNIE bazę o ściśle najświeższym dokumencie. Przy
        remisie — dwie kopie zrobione tego samego dnia — podpowiedź byłaby rzutem
        monetą udającym radę, więc wybór wraca do człowieka.
    #>
    param([Parameter(Mandatory)][object[]]$Bazy)
    $zDokumentem = @($Bazy | Where-Object { $_.Subiekt -and $_.OstatniDokument })
    if ($zDokumentem.Count -eq 0) { return -1 }

    $naj = @($zDokumentem | Sort-Object OstatniDokument -Descending)[0]
    $data = ([datetime]$naj.OstatniDokument).Date
    $remis = @($zDokumentem | Where-Object { ([datetime]$_.OstatniDokument).Date -eq $data })
    if ($remis.Count -gt 1) { return -1 }

    for ($i = 0; $i -lt $Bazy.Count; $i++) {
        if ($Bazy[$i].Nazwa -eq $naj.Nazwa) { return $i }
    }
    return -1
}

# Po tylu dniach bez dokumentu baza wygląda na kopię.
$script:WertisDniPodejrzanejKopii = 7

function Test-WertisBazaPodejrzana {
    <#
        .SYNOPSIS
        Czy wybrana baza wygląda na kopię, a nie na podmiot produkcyjny.
        .PARAMETER Teraz
        Wstrzykiwany czas — inaczej tej reguły nie dałoby się sprawdzić asercją.
    #>
    param(
        [Parameter(Mandatory)]$Baza,
        [int]$Dni = $script:WertisDniPodejrzanejKopii,
        [datetime]$Teraz = (Get-Date)
    )
    if (-not $Baza.Subiekt) { return $false }
    # Świeży podmiot nie ma jeszcze ani jednego dokumentu. To pustka, nie kopia —
    # i ma własny komunikat, żeby nie straszyć przy pierwszym wdrożeniu.
    if (-not $Baza.OstatniDokument) { return $false }
    return ((($Teraz).Date - ([datetime]$Baza.OstatniDokument).Date).TotalDays -gt $Dni)
}

function Format-WertisEtykietaBazy {
    <#
        .SYNOPSIS
        Jedna linia listy wyboru — tak, żeby pomyłka rzucała się w oczy.
    #>
    param([Parameter(Mandatory)]$Baza)
    $nazwa = "{0,-20}" -f $Baza.Nazwa
    if ($Baza.Uwaga) { return "$nazwa ($($Baza.Uwaga))" }

    $ost = if ($Baza.OstatniDokument) { ([datetime]$Baza.OstatniDokument).ToString("yyyy-MM-dd") }
           else { "brak dokumentów" }
    $ile = if ($null -ne $Baza.Dokumentow) { "{0,9:N0}" -f $Baza.Dokumentow } else { "        ?" }
    $utw = if ($Baza.Utworzona) { ([datetime]$Baza.Utworzona).ToString("yyyy-MM-dd") } else { "?" }
    return ("{0} ost. dokument: {1,-16} dok: {2}   utw.: {3}" -f $nazwa, $ost, $ile, $utw)
}

function Get-WertisMagazyny {
    param([Parameter(Mandatory)]$Polaczenie)
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
"@
}

function Get-WertisPolaDodatkowe {
    <#
        .SYNOPSIS
        Dla tw_Pole1..8: zajętość, liczba ADRESÓW PÓŁEK i trzy przykłady.
        .DESCRIPTION
        To jest najważniejsze pytanie całego kreatora. Worker nadpisuje wybraną
        kolumnę BEZWARUNKOWO, więc wskazanie pola, w którym firma trzyma coś
        swojego, kasuje te dane bez ostrzeżenia i bez możliwości cofnięcia.
        Sama nazwa kolumny nic nie mówi — dopiero zajętość i przykłady.

        `Adresy` liczy wartości w kształcie regału (A01-02-03) albo palety
        (PAL-042). To pytanie WAŻNIEJSZE niż zajętość: magazyn, który dziś jakoś
        notuje adresy, robi to najczęściej właśnie w polu własnym. Wskazanie
        wtedy INNEGO pola daje dwa źródła prawdy o tym samym, a starych adresów
        nikt nie skasuje.
    #>
    param([Parameter(Mandatory)]$Polaczenie)

    # Wzorce muszą odpowiadać LOC_FORMAT_* z server/src/config.ts — w składni
    # T-SQL, bo LIKE nie zna wyrażeń regularnych.
    $regal  = "[A-Z][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
    $paleta = "PAL-[0-9][0-9][0-9]"
    $czesci = (1..8 | ForEach-Object {
        $k = "LTRIM(RTRIM(ISNULL(tw_Pole$_,'')))"
        "SELECT 'tw_Pole$_' AS pole," +
        " COUNT(CASE WHEN $k <> '' THEN 1 END) AS niepuste," +
        " COUNT(CASE WHEN $k LIKE '$regal' OR $k LIKE '$paleta' THEN 1 END) AS adresy" +
        " FROM tw__Towar"
    }) -join " UNION ALL "
    $liczby = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql "$czesci;"

    $wynik = @()
    foreach ($w in $liczby) {
        $przyklady = @()
        if ([int]$w.niepuste -gt 0) {
            $p = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT DISTINCT TOP 3 LTRIM(RTRIM($($w.pole))) AS wartosc
FROM tw__Towar WHERE LTRIM(RTRIM(ISNULL($($w.pole),''))) <> '';
"@
            $przyklady = @($p | ForEach-Object { $_.wartosc })
        }
        $wynik += [pscustomobject]@{
            Pole      = [string]$w.pole
            Niepuste  = [int]$w.niepuste
            Adresy    = [int]$w.adresy
            Przyklady = $przyklady
        }
    }
    return $wynik
}

function Get-WertisSugerowanePole {
    <#
        .SYNOPSIS
        Indeks pola do podpowiedzi Enterem; -1 gdy podpowiedź byłaby zgadywaniem.
        .DESCRIPTION
        Reguła ma dwa stopnie, w tej kolejności:

        1. **Pole z adresami wygrywa.** Magazyn, który dziś jakoś notuje adresy,
           robi to najczęściej w polu własnym. Wskazanie wtedy INNEGO pola daje
           dwa źródła prawdy o tym samym, a starych adresów nikt nie skasuje.
        2. Dopiero gdy adresów nie ma nigdzie — pierwsze puste pole.

        Zwracamy -1 zamiast strzelać w dwóch sytuacjach. Remis adresów znaczy, że
        człowiek musi rozstrzygnąć, które pole jest tym prawdziwym. Brak i adresów,
        i pustego pola znaczy, że KAŻDA podpowiedź celuje w cudze dane — a stary
        kod podpowiadał tam `tw_Pole1`, czyli akurat to, czego nie wolno wziąć
        w ciemno.
    #>
    param([Parameter(Mandatory)][object[]]$Pola)

    $zAdresami = @($Pola | Where-Object { $_.Adresy -gt 0 })
    if ($zAdresami.Count -gt 0) {
        $naj = @($zAdresami | Sort-Object Adresy -Descending)[0]
        if (@($zAdresami | Where-Object { $_.Adresy -eq $naj.Adresy }).Count -gt 1) { return -1 }
        for ($i = 0; $i -lt $Pola.Count; $i++) {
            if ($Pola[$i].Pole -eq $naj.Pole) { return $i }
        }
        return -1
    }

    for ($i = 0; $i -lt $Pola.Count; $i++) {
        if ($Pola[$i].Niepuste -eq 0) { return $i }
    }
    return -1
}

function Format-WertisEtykietaPola {
    <#
        .SYNOPSIS
        Jedna linia listy wyboru pola — z liczbą adresów, nie tylko zajętością.
        .DESCRIPTION
        Sama zajętość nie odróżnia pola z adresami półek od pola z opisami
        opakowań, a to są dwie przeciwne decyzje: pierwsze trzeba wziąć,
        drugiego nie wolno ruszyć.
    #>
    param([Parameter(Mandatory)]$Pole)

    $opis = if ($Pole.Adresy -gt 0) {
        "niepuste: $($Pole.Niepuste)   w tym adresy półek: $($Pole.Adresy)"
    } elseif ($Pole.Niepuste -eq 0) {
        "puste - wolne do użycia"
    } else {
        "niepuste: $($Pole.Niepuste)   bez adresów półek"
    }
    $np = if ($Pole.Przyklady -and @($Pole.Przyklady).Count -gt 0) {
        "   np. $(@($Pole.Przyklady) -join ', ')"
    } else { "" }
    return ("{0,-9} {1}{2}" -f $Pole.Pole, $opis, $np)
}

# ── Konto aplikacji (docs/subiekt-gt-edu-setup.md §2) ────────────────────────

<#
    Tabele, z których aplikacja CZYTA — jedno źródło dla skryptu nadającego
    granty i dla sprawdzenia, czy je dostał.

    POWSTAŁO PO DWÓCH ROZJAZDACH POD RZĄD. Liczba grantów żyła osobno od
    skryptu: najpierw został próg `-ge 7`, gdy w 0.16.0 zeszliśmy do sześciu,
    a zaraz potem próg `-ge 6`, gdy w 0.31.0 doszła tabela zdjęć. Za każdym
    razem objawem było zdanie „uprawnienia nie zgadzają się z oczekiwanymi"
    po POPRAWNEJ instalacji — albo, gorzej, jego brak przy niepełnej.

    Dopóki obie strony czytają tę listę, rozjazd nie ma jak powstać.
#>
$script:WertisTabeleOdczytu = @(
    @{ Tabela = "tw__Towar";      Po = "" },
    @{ Tabela = "tw_Stan";        Po = "" },
    @{ Tabela = "dok__Dokument";  Po = "" },
    @{ Tabela = "dok_Pozycja";    Po = "" },
    @{ Tabela = "kh__Kontrahent"; Po = "" },
    @{ Tabela = "sl_Magazyn";     Po = "nazwy i symbole magazynów" },
    # OPCJONALNA: tabela zdjęć jest w bieżących wersjach GT, ale nie w każdej.
    # `GRANT SELECT` na nieistniejący obiekt kończy WYKONANIE CAŁEGO skryptu
    # błędem (idzie jednym ExecuteNonQuery), więc konto zostawałoby bez ani
    # jednego uprawnienia — na bazie, na której zdjęć po prostu nie ma.
    @{ Tabela = "tw_ZdjecieTw";   Po = "zdjęcia kartotek na karcie towaru"; Opcjonalna = $true }
)

function Get-WertisTabeleOdczytu {
    <#
        .SYNOPSIS
        Lista tabel do odczytu dla TEJ bazy. `-Zdjecia:$false` zdejmuje pozycje
        opcjonalne.
        .DESCRIPTION
        Jedno wejście dla skryptu grantów i dla progu sprawdzenia, żeby decyzja
        „nadajemy siódmy grant" i oczekiwanie „ma być siedem" nie mogły się
        rozjechać. Rozjazd tych dwóch liczb był już przyczyną dwóch usterek.
    #>
    param([bool]$Zdjecia = $true)
    return @($script:WertisTabeleOdczytu | Where-Object { $Zdjecia -or -not $_.Opcjonalna })
}

function Get-WertisKolumnyZapisu {
    <#
        .SYNOPSIS
        Kolumny `tw__Towar`, do których konto ma prawo ZAPISU. Nic poza nimi.
        .DESCRIPTION
        Jedno wejście dla skryptu grantów, dla progu sprawdzenia i dla zdania
        pokazywanego człowiekowi — z tego samego powodu, dla którego istnieje
        `Get-WertisTabeleOdczytu`: liczba nadawanych grantów i liczba
        oczekiwanych rozjechały się już dwa razy, a objawem było „niezgodne
        uprawnienia" po POPRAWNEJ instalacji.

        Do 0.37.0 kolumna była JEDNA. Kod kreskowy dołożył drugą i wdrożenie
        potknęło się dokładnie o to: instalator nadawał komplet sprzed zmiany,
        więc nadawanie kodów kończyło się odmową uprawnienia na produkcji.

        `tw_PodstKodKresk` jest kolumną RDZENIOWĄ `tw__Towar` (opis struktury
        InsERT), więc nie wymaga sprawdzania obecności — inaczej niż tabela
        zdjęć, której brak wywalał cały skrypt.
    #>
    param([Parameter(Mandatory)][string]$KolumnaLokalizacji)
    return @(
        @{ Kolumna = $KolumnaLokalizacji; Po = "lokalizacja (MSSQL_LOC_COLUMN)" },
        @{ Kolumna = "tw_PodstKodKresk";  Po = "kod kreskowy nadawany z kolektora (0.37.0)" }
    )
}

function Get-WertisZdjeciaKartotek {
    <#
        .SYNOPSIS
        Czy w tej bazie są zdjęcia kartotek — i ile ich jest.
        .DESCRIPTION
        Kreator o zdjęcia NIE PYTA, tylko sprawdza. Do 0.31.2 sześć kluczy
        `ZDJECIA_*` wpisywało się ręką, bo w chwili powstania funkcji nikt nie
        wiedział, gdzie Subiekt trzyma obraz — nazwy były `[WERYFIKUJ]`.
        Rozpoznanie na bazie firmy zamknęło tamto pytanie (`tw_ZdjecieTw`,
        opis struktury), więc kreator ma dziś komplet odpowiedzi i nie ma
        powodu przepisywać ich człowiekowi.

        Sprawdzane są WSZYSTKIE cztery kolumny, nie sama obecność tabeli.
        Brak `zd_Id` odebrałby porządkowi rozstrzygalność — `zd_IdTowar` jest
        kluczem OBCYM i przy kilku zdjęciach jednej kartoteki nie domyka
        wyboru. Serwer odmawia wtedy startu, więc lepiej tego nie ustawiać.
    #>
    param([Parameter(Mandatory)]$Polaczenie)

    $brak = [pscustomobject]@{ Jest = $false; Zdjec = 0; Kartotek = 0 }
    try {
        $kolumny = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT name FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.tw_ZdjecieTw')
  AND name IN ('zd_Id', 'zd_IdTowar', 'zd_Zdjecie', 'zd_Glowne');
"@
        if (@($kolumny).Count -lt 4) { return $brak }

        $liczby = Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT COUNT(*) AS zdjec, COUNT(DISTINCT zd_IdTowar) AS kartotek FROM dbo.tw_ZdjecieTw;
"@
        return [pscustomobject]@{
            Jest     = $true
            Zdjec    = [int]$liczby[0].zdjec
            Kartotek = [int]$liczby[0].kartotek
        }
    } catch {
        # Brak uprawnień do sys.columns albo zerwane połączenie. Zdjęcia są
        # dodatkiem — cisza tutaj nie może zatrzymać całej instalacji.
        return $brak
    }
}

function Test-WertisKolumnaIstnieje {
    <#
        .SYNOPSIS
        Czy tabela ma kolumnę o tej nazwie. `$true`/`$false`, bez wyjątku.
        .DESCRIPTION
        Używane do `MSSQL_ZD_ZREAL_COLUMN`, którego domyślna wartość
        `ob_IloscZrealizowana` była zgadnięta i zgadnięta ŹLE — w tej wersji
        bazy takiej kolumny nie ma wcale (opis struktury, komplet 57 kolumn
        `dok_Pozycja`). Poprawną wartością jest wtedy PUSTA, a nie brak klucza:
        brak oznacza „użyj domyślnej", czyli wraca do zgadniętej nazwy.
    #>
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [Parameter(Mandatory)][string]$Tabela,
        [Parameter(Mandatory)][string]$Kolumna
    )
    try {
        $w = Invoke-WertisZapytanie -Polaczenie $Polaczenie `
            -Parametry @{ "@k" = $Kolumna } -Sql @"
SELECT name FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.$(Assert-BezpiecznyIdentyfikator -Nazwa $Tabela -Opis "tabela")')
  AND name = @k;
"@
        return (@($w).Count -gt 0)
    } catch {
        return $false
    }
}

function Get-WertisSkryptUprawnien {
    <#
        .SYNOPSIS
        Skrypt zakładający login `wertis` — ten sam, który idzie do wykonania
        i do pliku awaryjnego, żeby nie mogły się rozjechać.
        .DESCRIPTION
        Idempotentny, więc wolno go puścić ponownie — po zmianie pola
        lokalizacji ORAZ po wydaniu, które dokłada kolumnę zapisu. Istniejący
        login dostaje wtedy nowe hasło i brakujące granty, bo `GRANT` powtórzony
        jest bez skutku, a `CREATE LOGIN` stoi za `IF NOT EXISTS`. To jest
        jedyna droga naprawy instalacji zastanej i CHCEMY, żeby taka była.

        Uprawnienie zapisu jest KOLUMNOWE i to jest tu cała wartość: UPDATE
        wyłącznie na kolumnach z `Get-WertisKolumnyZapisu` i ani jednego prawa
        zapisu gdziekolwiek indziej. Przy przejęciu tego credentiala da się
        zmienić lokalizację i podstawowy kod kreskowy towaru — nic więcej.
        Liczby kolumn tu NIE WPISYWAĆ: stała „jedna" przeżyła w tym miejscu
        dołożenie drugiej i o to potknęło się wdrożenie 0.37.0.
    #>
    param(
        [Parameter(Mandatory)][string]$Baza,
        [Parameter(Mandatory)][string]$KolumnaLokalizacji,
        [string]$Login = "wertis",
        [Parameter(Mandatory)][string]$Haslo,
        # $false, gdy w bazie nie ma tabeli zdjęć — patrz Get-WertisZdjeciaKartotek
        [bool]$Zdjecia = $true
    )
    [void](Assert-BezpiecznyIdentyfikator -Nazwa $KolumnaLokalizacji -Opis "kolumna lokalizacji")
    [void](Assert-BezpiecznyIdentyfikator -Nazwa $Login -Opis "login")
    $bazaEsc  = $Baza  -replace "\]", "]]"
    $hasloEsc = $Haslo -replace "'", "''"
    # Granty z jednej listy — patrz $script:WertisTabeleOdczytu
    $granty = (Get-WertisTabeleOdczytu -Zdjecia $Zdjecia | ForEach-Object {
        $linia = "GRANT SELECT ON dbo.{0,-14} TO [{1}];" -f $_.Tabela, $Login
        if ($_.Po) { "$linia   -- $($_.Po)" } else { $linia }
    }) -join "`n"
    # Zapis z tej samej listy, z której idzie próg sprawdzenia — patrz
    # `Get-WertisKolumnyZapisu`.
    $zapisy = (Get-WertisKolumnyZapisu -KolumnaLokalizacji $KolumnaLokalizacji | ForEach-Object {
        "GRANT UPDATE ON dbo.tw__Towar ({0}) TO [{1}];   -- {2}" -f $_.Kolumna, $Login, $_.Po
    }) -join "`n"

    return @"
USE [$bazaEsc];

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$Login')
    CREATE LOGIN [$Login] WITH PASSWORD = '$hasloEsc', CHECK_POLICY = ON;
ELSE
BEGIN
    -- Login przeżył wcześniejsze podejście: jest obiektem INSTANCJI, więc nie
    -- znika ani z bazą, ani z nieudanym przebiegiem kreatora. Samo IF NOT
    -- EXISTS zostawiało wtedy STARE hasło, a instalator zapisywał do
    -- wertis.env świeżo wylosowane — usługa dostawała „Login failed for user"
    -- przy starcie, długo po tym, jak kreator zameldował sukces.
    ALTER LOGIN [$Login] WITH PASSWORD = '$hasloEsc';
    -- Wyłączony login daje DOKŁADNIE ten sam objaw i tę samą ciszę.
    ALTER LOGIN [$Login] ENABLE;
END
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$Login')
    CREATE USER [$Login] FOR LOGIN [$Login];

-- ODCZYT: wyłącznie tabele potrzebne aplikacji
$granty

-- ZAPIS: DWIE kolumny kartoteki i ani jedna więcej. Dokumenty, flagi i stany
-- pozostają dla tego loginu tylko do odczytu.
$zapisy
"@
}

function Test-WertisLogowanie {
    <#
        .SYNOPSIS
        Loguje się JAKO `wertis` — tymi poświadczeniami, które idą do wertis.env.
        .DESCRIPTION
        POWSTAŁO PO INSTALACJI, KTÓRA ZAMELDOWAŁA „Konto gotowe", A USŁUGA NIE
        WSTAŁA. Get-WertisUprawnienia sprawdza granty POŁĄCZENIEM ADMINISTRATORA,
        więc odpowiada na pytanie „czy konto ma prawa", a nie „czy da się na nie
        zalogować". Hasło było wtedy rozjechane i nikt się o tym nie dowiedział
        aż do `Login failed for user 'wertis'` w logu usługi.

        Ta funkcja zamyka tę lukę jedynym sposobem, jaki cokolwiek dowodzi:
        otwiera OSOBNE połączenie na tych samych poświadczeniach, które za
        chwilę trafią do pliku, i wykonuje najtańsze możliwe zapytanie.
    #>
    param(
        [Parameter(Mandatory)][string]$Serwer,
        [string]$Instancja,
        [int]$Port,
        [Parameter(Mandatory)][string]$Baza,
        [Parameter(Mandatory)][string]$Login,
        [Parameter(Mandatory)][string]$Haslo
    )
    if (Test-DryRun "Sprawdziłbym logowanie jako $Login.") {
        return [pscustomobject]@{ Udalo = $true; Powod = $null }
    }
    $cs = Get-WertisConnectionString -Serwer $Serwer -Instancja $Instancja -Port $Port `
        -Baza $Baza -Uzytkownik $Login -Haslo $Haslo
    $conn = $null
    try {
        $conn = Open-WertisPolaczenie -ConnectionString $cs
        [void](Invoke-WertisZapytanie -Polaczenie $conn -Sql "SELECT 1 AS ok;")
        return [pscustomobject]@{ Udalo = $true; Powod = $null }
    } catch {
        return [pscustomobject]@{ Udalo = $false; Powod = $_.Exception.Message }
    } finally {
        if ($conn) { try { $conn.Close() } catch { } }
    }
}

function Grant-WertisLogin {
    <#
        .SYNOPSIS
        Zakłada login i nadaje uprawnienia. Zwraca obiekt z polem Udalo.
        .DESCRIPTION
        Skrypt idzie partiami rozdzielonymi średnikiem-instrukcją, a nie
        jednym ExecuteNonQuery z GO — GO jest poleceniem SSMS, nie serwera.
        Błąd pierwszego polecenia NIE przerywa reszty (tak samo jak w SSMS),
        dlatego wywołujący MUSI potem sprawdzić uprawnienia — bez tego
        „udana" instalacja może zostawić konto bez ani jednego grantu.
    #>
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [Parameter(Mandatory)][string]$Skrypt
    )
    if (Test-DryRun "Założyłbym login SQL i nadał uprawnienia kolumnowe.") {
        return [pscustomobject]@{ Udalo = $true; Powod = "przebieg próbny" }
    }
    try {
        [void](Invoke-WertisPolecenie -Polaczenie $Polaczenie -Sql $Skrypt)
        return [pscustomobject]@{ Udalo = $true; Powod = $null }
    } catch {
        return [pscustomobject]@{ Udalo = $false; Powod = $_.Exception.Message }
    }
}

function Get-WertisUprawnienia {
    <#
        .SYNOPSIS
        Zapytanie weryfikacyjne z §2: co login faktycznie dostał.
    #>
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [string]$Login = "wertis"
    )
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Parametry @{ "@login" = $Login } -Sql @"
SELECT dp.permission_name, dp.state_desc,
       OBJECT_NAME(dp.major_id) AS obiekt,
       c.name AS kolumna
FROM sys.database_permissions dp
LEFT JOIN sys.columns c ON c.object_id = dp.major_id AND c.column_id = dp.minor_id
JOIN sys.database_principals pr ON pr.principal_id = dp.grantee_principal_id
WHERE pr.name = @login
ORDER BY dp.permission_name, obiekt;
"@
}

function Test-WertisUprawnienia {
    <#
        .SYNOPSIS
        Sprawdza, że nadane uprawnienia to dokładnie to, co miało być.
        .DESCRIPTION
        Nie liczy tylko „czy coś jest": pilnuje też, żeby NIE było prawa
        zapisu do dok__Dokument. Gdyby ktoś kiedyś rozluźnił skrypt, ten test
        jest jedynym miejscem, które to zauważy.
    #>
    param(
        [Parameter(Mandatory)][object[]]$Uprawnienia,
        [Parameter(Mandatory)][string]$KolumnaLokalizacji,
        # musi być TĄ SAMĄ wartością, co przy budowie skryptu — inaczej próg
        # żąda grantu, którego świadomie nie nadaliśmy
        [bool]$Zdjecia = $true
    )
    $select = @($Uprawnienia | Where-Object { $_.permission_name -eq "SELECT" -and $_.state_desc -eq "GRANT" })
    $update = @($Uprawnienia | Where-Object { $_.permission_name -eq "UPDATE" -and $_.state_desc -eq "GRANT" })
    $zapisDok = @($Uprawnienia | Where-Object {
        $_.obiekt -eq "dok__Dokument" -and $_.permission_name -in @("UPDATE", "INSERT", "DELETE")
    })
    <#
        Kolumny zapisu sprawdzamy Z TEJ SAMEJ listy, z której są nadawane.
        Do 0.38.0 stało tu wprost „ma być dokładnie jedna kolumna" — i przy
        dołożeniu kodu kreskowego w 0.37.0 nikt tego nie ruszył, więc
        instalator nadawał komplet sprzed zmiany, a produkcja odmawiała
        zapisu kodów. Ta sama usterka co dwa razy wcześniej przy grantach
        odczytu, tylko po stronie zapisu.
    #>
    $oczekiwaneZapisy = @(Get-WertisKolumnyZapisu -KolumnaLokalizacji $KolumnaLokalizacji)
    $brakujaceZapisy = @($oczekiwaneZapisy | Where-Object {
        $kol = $_.Kolumna
        -not @($update | Where-Object { $_.obiekt -eq "tw__Towar" -and $_.kolumna -eq $kol })
    })
    $lokalizacja = @($update | Where-Object {
        $_.obiekt -eq "tw__Towar" -and $_.kolumna -eq $KolumnaLokalizacji
    })

    <#
        Próg NIE jest liczbą wpisaną z ręki — bierze się z tej samej listy,
        z której `Get-WertisSkryptUprawnien` nadaje granty. Dwa razy pod rząd
        te wartości się rozjechały (0.16.0 zdjęło dwa granty, 0.31.0 dodało
        jeden) i za każdym razem objawem było zdanie o niezgodnych
        uprawnieniach po POPRAWNEJ instalacji.
    #>
    $wymagane = @(Get-WertisTabeleOdczytu -Zdjecia $Zdjecia).Count
    return [pscustomobject]@{
        TabeleOdczytu   = $select.Count
        Wymaganych      = $wymagane
        LokalizacjaOk   = ($lokalizacja.Count -eq 1)
        # nazwy kolumn, których zabrakło — komunikat ma powiedzieć KTÓREJ,
        # a nie tylko „coś jest nie tak z uprawnieniami"
        BrakujaceZapisy = @($brakujaceZapisy | ForEach-Object { $_.Kolumna })
        KolumnyZapisu   = $oczekiwaneZapisy.Count
        ZapisDokumentow = $zapisDok.Count
        Ok              = ($select.Count -ge $wymagane -and $brakujaceZapisy.Count -eq 0 -and $zapisDok.Count -eq 0)
    }
}
