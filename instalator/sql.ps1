# Rozmowa z SQL Serverem Subiekta: checklista [WERYFIKUJ] i konto aplikacji.
#
# ŹRÓDŁEM PRAWDY dla tego pliku jest `docs/subiekt-gt-edu-setup.md`:
#   §1 — TCP/IP i uwierzytelnianie mieszane (wymogi wstępne),
#   §2 — skrypt loginu `wertis` z uprawnieniami kolumnowymi + weryfikacja,
#   §3 — checklista: magazyny, pole lokalizacji, flagi.
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

function Get-WertisFlagi {
    param([Parameter(Mandatory)]$Polaczenie)
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT flg_Id, flg_Text, flg_Numer, flg_IdGrupy FROM fl__Flagi ORDER BY flg_IdGrupy, flg_Numer;
"@
}

function Find-WertisGrupaFlag {
    <#
        .SYNOPSIS
        Kandydaci na MSSQL_FLAG_GRUPA i MSSQL_FLAG_TYP_OBIEKTU.
        .DESCRIPTION
        Flaga nie jest kolumną dokumentu — to wpis w fl_Wartosc pod kluczem
        (grupa, typ obiektu, id obiektu). Sonda jest HEURYSTYCZNA: łączymy
        fl_Wartosc z fakturami zakupu po flw_IdObiektu i patrzymy, która para
        (grupa, typ) trafia najczęściej. Złączenie po samym id może przypadkiem
        trafić obiekt innego typu o tym samym identyfikatorze, dlatego wynik
        jest PROPOZYCJĄ do potwierdzenia przez człowieka, a nie ustaleniem.
        Pusta lista znaczy tyle, że nikt jeszcze nie oflagował faktury.
    #>
    param(
        [Parameter(Mandatory)]$Polaczenie,
        [int]$DokTypFz = 1
    )
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Parametry @{ "@typ" = $DokTypFz } -Sql @"
SELECT w.flw_IdGrupyFlag, w.flw_TypObiektu, COUNT(*) AS ile
FROM fl_Wartosc w
JOIN dok__Dokument d ON d.dok_Id = w.flw_IdObiektu
WHERE d.dok_Typ = @typ
GROUP BY w.flw_IdGrupyFlag, w.flw_TypObiektu
ORDER BY ile DESC;
"@
}

# ── Konto aplikacji (docs/subiekt-gt-edu-setup.md §2) ────────────────────────

function Get-WertisSkryptUprawnien {
    <#
        .SYNOPSIS
        Skrypt zakładający login `wertis` — ten sam, który idzie do wykonania
        i do pliku awaryjnego, żeby nie mogły się rozjechać.
        .DESCRIPTION
        Idempotentny, więc wolno go puścić ponownie po zmianie pola
        lokalizacji. Uprawnienia są KOLUMNOWE i to jest tu cała wartość:
        UPDATE na jednej kolumnie tw__Towar, INSERT/UPDATE na fl_Wartosc
        i ani jednego prawa zapisu do dok__Dokument. Przy przejęciu tego
        credentiala da się zmienić lokalizację towaru i flagę — nic więcej.
    #>
    param(
        [Parameter(Mandatory)][string]$Baza,
        [Parameter(Mandatory)][string]$KolumnaLokalizacji,
        [string]$Login = "wertis",
        [Parameter(Mandatory)][string]$Haslo
    )
    [void](Assert-BezpiecznyIdentyfikator -Nazwa $KolumnaLokalizacji -Opis "kolumna lokalizacji")
    [void](Assert-BezpiecznyIdentyfikator -Nazwa $Login -Opis "login")
    $bazaEsc  = $Baza  -replace "\]", "]]"
    $hasloEsc = $Haslo -replace "'", "''"

    return @"
USE [$bazaEsc];

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '$Login')
    CREATE LOGIN [$Login] WITH PASSWORD = '$hasloEsc', CHECK_POLICY = ON;
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '$Login')
    CREATE USER [$Login] FOR LOGIN [$Login];

-- ODCZYT: wyłącznie tabele potrzebne aplikacji
GRANT SELECT ON dbo.tw__Towar      TO [$Login];
GRANT SELECT ON dbo.tw_Stan        TO [$Login];
GRANT SELECT ON dbo.dok__Dokument  TO [$Login];
GRANT SELECT ON dbo.dok_Pozycja    TO [$Login];
GRANT SELECT ON dbo.kh__Kontrahent TO [$Login];
GRANT SELECT ON dbo.fl_Wartosc     TO [$Login];
GRANT SELECT ON dbo.fl__Flagi      TO [$Login];
GRANT SELECT ON dbo.sl_Magazyn     TO [$Login];   -- nazwy i symbole magazynów

-- ZAPIS: dwie rzeczy i ani jedna więcej.
-- 1) lokalizacja — JEDNA kolumna kartoteki (ta sama, co MSSQL_LOC_COLUMN)
GRANT UPDATE ON dbo.tw__Towar ($KolumnaLokalizacji) TO [$Login];
-- 2) flaga sprawdzenia faktury — tabela przypisań flag; dok__Dokument
--    pozostaje nietykalny, bo flaga nie jest jego kolumną
GRANT INSERT, UPDATE ON dbo.fl_Wartosc TO [$Login];
"@
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
        [Parameter(Mandatory)][string]$KolumnaLokalizacji
    )
    $select = @($Uprawnienia | Where-Object { $_.permission_name -eq "SELECT" -and $_.state_desc -eq "GRANT" })
    $update = @($Uprawnienia | Where-Object { $_.permission_name -eq "UPDATE" -and $_.state_desc -eq "GRANT" })
    $zapisDok = @($Uprawnienia | Where-Object {
        $_.obiekt -eq "dok__Dokument" -and $_.permission_name -in @("UPDATE", "INSERT", "DELETE")
    })
    $lokalizacja = @($update | Where-Object {
        $_.obiekt -eq "tw__Towar" -and $_.kolumna -eq $KolumnaLokalizacji
    })

    return [pscustomobject]@{
        TabeleOdczytu   = $select.Count
        LokalizacjaOk   = ($lokalizacja.Count -eq 1)
        ZapisDokumentow = $zapisDok.Count
        Ok              = ($select.Count -ge 7 -and $lokalizacja.Count -eq 1 -and $zapisDok.Count -eq 0)
    }
}
