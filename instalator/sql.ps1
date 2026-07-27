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
    # zwykłą bazą użytkownika.
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT name FROM sys.databases WHERE database_id > 4 AND state = 0 ORDER BY name;
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

function Get-WertisMagazyny {
    param([Parameter(Mandatory)]$Polaczenie)
    return Invoke-WertisZapytanie -Polaczenie $Polaczenie -Sql @"
SELECT mag_Id, mag_Symbol, mag_Nazwa, mag_Glowny FROM sl_Magazyn ORDER BY mag_Id;
"@
}

function Get-WertisPolaDodatkowe {
    <#
        .SYNOPSIS
        Dla tw_Pole1..8: ile kartotek ma je niepuste i trzy przykładowe wartości.
        .DESCRIPTION
        To jest najważniejsze pytanie całego kreatora. Worker nadpisuje wybraną
        kolumnę BEZWARUNKOWO, więc wskazanie pola, w którym firma trzyma coś
        swojego, kasuje te dane bez ostrzeżenia i bez możliwości cofnięcia.
        Sama nazwa kolumny nic nie mówi — dopiero zajętość i przykłady.
    #>
    param([Parameter(Mandatory)]$Polaczenie)

    $czesci = (1..8 | ForEach-Object {
        "SELECT 'tw_Pole$_' AS pole, COUNT(CASE WHEN LTRIM(RTRIM(ISNULL(tw_Pole$_,''))) <> '' THEN 1 END) AS niepuste FROM tw__Towar"
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
            Przyklady = $przyklady
        }
    }
    return $wynik
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
