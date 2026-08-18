# Zależności, usługi Windows, zapora i publikacja konfiguracji.
#
# Odpowiednik rozdziałów 1-4 z DEPLOY.md. Ręczna instrukcja tam zostaje —
# jest referencją tego, co ten plik automatyzuje, i jedyną drogą, gdy coś
# tutaj zawiedzie.

function Zapewnij-Katalog {
    <#
        .SYNOPSIS
        Tworzy katalog, jeśli go nie ma. Bezpieczne dla korzenia dysku.
        .DESCRIPTION
        POWSTAŁO PO AWARII U KLIENTA (27.07). Instalator robił
        `New-Item -ItemType Directory -Force -Path (Split-Path $Katalog)`,
        a dla domyślnego `C:\wertis` daje to `Split-Path` → `C:\`. `New-Item`
        na korzeniu dysku rzuca „Ścieżka ma niedozwolony format", więc
        instalacja wywracała się przy DOMYŚLNYCH ustawieniach — u każdego, kto
        uruchomił instalator bez `-Katalog`.

        Sprawdzenie `Test-Path` załatwia to bez specjalnego kodu na literę
        dysku: korzeń zawsze istnieje, więc po prostu nie ma czego tworzyć.
    #>
    param([string]$Sciezka)
    if (-not $Sciezka) { return }          # Split-Path bywa pusty
    if (Test-Path $Sciezka) { return }     # istnieje — także "C:\"
    New-Item -ItemType Directory -Force -Path $Sciezka | Out-Null
}

function Write-WertisPlik {
    <#
        .SYNOPSIS
        Zapis tekstu jako UTF-8 BEZ BOM.
        .DESCRIPTION
        `Set-Content -Encoding UTF8` w Windows PowerShell 5.1 dokleja BOM.
        Serwer by to przeżył (`parseEnvFile` robi `trim()`, a ten w JS usuwa
        U+FEFF), ale DEPLOY §2a obiecuje, że `wertis.env` zostaje wczytywalny
        TAKŻE przez `source wertis.env` w bashu — a tam BOM przed `#` psuje
        pierwszą linię.
    #>
    param(
        [Parameter(Mandatory)][string]$Sciezka,
        [Parameter(Mandatory)][string]$Tresc
    )
    [System.IO.File]::WriteAllText($Sciezka, $Tresc, (New-Object System.Text.UTF8Encoding $false))
}

function Initialize-WertisSiec {
    <#
        .SYNOPSIS
        Wymusza TLS 1.2 na pobieraniach.
        .DESCRIPTION
        `Invoke-WebRequest` w Windows PowerShell 5.1 bierze protokół
        z ustawień .NET Framework i na części maszyn nadal startuje z TLS 1.0.
        nssm.cc i nodejs.org takie połączenie odrzucają, a komunikat („nie
        można utworzyć bezpiecznego kanału SSL/TLS") nie mówi nic osobie,
        która ma tylko zainstalować program.

        To OSŁONA, nie naprawa zaobserwowanej awarii — nie wiadomo, czy dana
        maszyna by ją trafiła. Kosztuje jedną linię.
    #>
    try {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    } catch {
        # starsze .NET bez Tls12 w enumie — wtedy i tak nic nie poradzimy
    }
}

<#
    Sumy kontrolne pobieranych plików.

    Instalator ściąga dwa pliki z internetu i URUCHAMIA je z uprawnieniami
    administratora: instalator MSI Node'a i nssm.exe. Do sierpnia 2026 robił to
    BEZ ŻADNEJ WERYFIKACJI — czyli przejęcie DNS w sieci klienta albo włamanie
    na serwer wydań wystarczyło, żeby ta maszyna wykonała cudzy kod jako SYSTEM.
    To była realna dziura, nie teoria, i nie ma nic wspólnego z tym, że
    antywirus flaguje instalator heurystycznie.

    Suma Node'a pochodzi z oficjalnego `SHASUMS256.txt` na nodejs.org — to
    źródło autorytatywne, nie „zaobserwowane u nas".
#>
$script:SUMA_NODE_MSI = "9eea480bd30c98ae11a97cb89a9278235cbbbd03c171ee5e5198bd86b7965b4b"

<#
    Suma nssm-2.24.zip, policzona 29.07.2026 przez runnera Windows w CI, który
    pobrał plik wprost z nssm.cc — nie wpisana „z pamięci", bo weryfikacja
    pozorna jest gorsza od jawnego jej braku.

    CZEGO TA SUMA DOWODZI, a czego nie. Nie jest dowodem, że nssm.cc było
    w tamtej chwili nienaruszone — to zaufanie przy pierwszym użyciu. Jest
    natomiast gwarancją, że od tamtej chwili plik SIĘ NIE ZMIENIŁ: każda
    podmiana, po stronie serwera wydań czy po drodze, zatrzyma instalację
    u klienta i budowę w CI.
#>
$script:SUMA_NSSM_ZIP = "727d1e42275c605e0f04aba98095c38a8e1e46def453cdffce42869428aa6743"

<#
    Ustawienia NSSM, którymi da się przykryć wertis.env. OBA, i to nie jest
    nadmiarowość: z nazw nie widać, że są dwa niezależne mechanizmy.

      AppEnvironmentExtra  DOKŁADA zmienne do środowiska procesu
      AppEnvironment       ZASTĘPUJE je w całości

    Do sierpnia 2026 instalator kasował wyłącznie pierwsze. Instalacja, która
    kiedyś użyła drugiego, przechodziła przez kreator NIETKNIĘTA i lądowała na
    danych demo mimo poprawnie zapisanego SGT_MODE=mssql.

    Stała, a nie literał w pętli, bo `instalator/testy.ps1` asertuje jej
    zawartość — samego `nssm reset` w CI wykonać się nie da (brak usług).
#>
$script:WertisKluczeSrodowiskaNssm = @("AppEnvironment", "AppEnvironmentExtra")

<#
    Klucze, których instalator NIE PRZEPISZE z istniejącego `wertis.env`.

    Publikacja konfiguracji zachowuje dziś klucze dopisane ręką (patrz
    `Publish-WertisKonfiguracja`), więc „nieznany" przestał znaczyć „zniknie".
    Dla haseł do kont aplikacji to byłoby cofnięcie wcześniejszej decyzji:
    sekret podany w kreatorze idzie przez API do bazy i nie ma prawa zostać
    na dysku serwera. Gdyby ktoś dopisał go do pliku sam, przebieg instalatora
    jest najlepszą okazją, żeby stamtąd zniknął.

    To NIE JEST biała lista `$kolejnosc` — tamta rozstrzyga, co wolno zapisać
    z ustawień kreatora, ta rozstrzyga, czego nie wolno przepisać z pliku.
#>
$script:WertisKluczeNieprzepisywane = @("ADMIN_LOGIN", "ADMIN_HASLO", "WERTIS_ADMIN")

<#
    Klucze, dla których PUSTA WARTOŚĆ JEST WARTOŚCIĄ, a nie brakiem ustawienia.

    Zwykły klucz o pustej wartości po prostu nie wychodzi do pliku — aplikacja
    weźmie swoją domyślną i to jest w porządku. Te dwa mają domyślne NIEPUSTE
    i właśnie od nich trzeba umieć odejść:

      MSSQL_INSTANCE          domyślnie `INSERTGT`; puste = instancja domyślna
      MSSQL_ZD_ZREAL_COLUMN   domyślnie `ob_IloscZrealizowana`, czyli nazwa
                              ZGADNIĘTA I BŁĘDNA; puste = kolumny nie ma

    Bez tej listy kreator nie miał jak powiedzieć „nie ma tego": zapisywał
    pustkę, funkcja pomijała klucz, a serwer wracał do wartości domyślnej.
    Objawu nie było — po prostu dalej pytał o nieistniejącą kolumnę.
#>
$script:WertisKluczePusteZnaczace = @("MSSQL_INSTANCE", "MSSQL_ZD_ZREAL_COLUMN")

function Read-WertisEnv {
    <#
        .SYNOPSIS
        Wczytuje `wertis.env` do słownika z zachowaniem kolejności kluczy.
        .DESCRIPTION
        Odpowiednik `parseEnvFile` z `server/src/env-file.ts` — ta sama składnia
        musi być rozumiana po obu stronach, bo plik czyta serwer, a zapisuje go
        instalator. Rozjazd parserów kończy się tym, że instalator „nie widzi"
        klucza, który aplikacja stosuje, i kasuje go przy najbliższym przebiegu.

        Obsługuje `export KLUCZ=wartość`, `KLUCZ=wartość`, apostrofy i cudzysłowy,
        komentarze pełne oraz doklejone na końcu linii. Brak pliku to pusty
        słownik, a nie błąd — pierwsza instalacja niczego jeszcze nie zapisała.
    #>
    param([Parameter(Mandatory)][string]$Sciezka)

    $wynik = [ordered]@{}
    if (-not (Test-Path $Sciezka)) { return $wynik }

    foreach ($surowa in [System.IO.File]::ReadAllLines($Sciezka)) {
        $linia = $surowa.Trim()
        if (-not $linia -or $linia.StartsWith("#")) { continue }

        $m = [regex]::Match($linia, '^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
        if (-not $m.Success) { continue }

        $wartosc = $m.Groups[2].Value
        $znak = ""
        if ($wartosc.Length -gt 0) { $znak = $wartosc.Substring(0, 1) }
        if ($znak -eq '"' -or $znak -eq "'") {
            # W cudzysłowie `#` jest zwykłym znakiem - hasło może go zawierać.
            $koniec = $wartosc.IndexOf([char]$znak, 1)
            if ($koniec -lt 0) {
                $wartosc = $wartosc.Substring(1)
            } else {
                $wartosc = $wartosc.Substring(1, $koniec - 1)
            }
        } else {
            # Bez cudzysłowu bash ucina komentarz dopiero po BIAŁYM ZNAKU, więc
            # `haslo#7` zostaje w całości. Ta sama reguła co w env-file.ts.
            $wartosc = ([regex]::Replace($wartosc, '\s+#.*$', '')).Trim()
        }
        $wynik[$m.Groups[1].Value] = $wartosc
    }
    return $wynik
}

function Test-WertisSuma {
    <#
        .SYNOPSIS
        Sprawdza SHA-256 pobranego pliku. `$true` = wolno go użyć.
        .DESCRIPTION
        Pusta suma oczekiwana nie jest błędem, tylko stanem „jeszcze nie
        ustalona" — wtedy leci ostrzeżenie z policzoną wartością, żeby dało się
        ją zapisać. Niezgodność jest błędem TWARDYM: plik, który przyszedł inny
        niż zamówiony, nie zasługuje na drugą szansę.
    #>
    param(
        [Parameter(Mandatory)][string]$Sciezka,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Oczekiwana,
        [Parameter(Mandatory)][string]$Opis
    )
    $suma = (Get-FileHash -Path $Sciezka -Algorithm SHA256).Hash.ToLowerInvariant()
    if (-not $Oczekiwana) {
        Write-Uwaga "$Opis - suma kontrolna nie jest ustalona, pomijam weryfikacje."
        Write-Info  "   Policzona teraz: $suma"
        return $true
    }
    if ($suma -ne $Oczekiwana.ToLowerInvariant()) {
        Write-Blad "$Opis - SUMA KONTROLNA SIE NIE ZGADZA. Przerywam."
        Write-Info "   oczekiwana: $($Oczekiwana.ToLowerInvariant())"
        Write-Info "   otrzymana:  $suma"
        Write-Info "   Plik NIE jest tym, o ktory prosilismy. Nie uruchamiaj go."
        return $false
    }
    Write-Ok "$Opis - suma kontrolna zgodna."
    return $true
}

function Get-WertisSumaZPliku {
    <#
        .SYNOPSIS
        Czyta SHA-256 z pliku `.sha256`. Pusty wynik = nie da sie jej ustalic.
        .DESCRIPTION
        Format jest ten, ktory produkuje `sha256sum`: suma, biale znaki, nazwa
        pliku. Czytamy Z PLIKU, bo tresc pobrana z sieci potrafi przyjsc jako
        tablica bajtow i wtedy pierwszy "wyraz" to kod znaku, nie suma.

        Wynik przechodzi kontrole ksztaltu - 64 znaki szesnastkowe. Suma, ktora
        nie wyglada jak suma, jest gorsza od jej braku: braku nikt nie pomyli
        z weryfikacja, a smiecia porownanie odrzuci razem z dobrym plikiem.
    #>
    param([Parameter(Mandatory)][string]$Sciezka)

    if (-not (Test-Path $Sciezka)) { return "" }
    $tresc = Get-Content -Path $Sciezka -Raw -ErrorAction SilentlyContinue
    if (-not $tresc) { return "" }
    $token = @($tresc -split '\s+' | Where-Object { $_ })
    if ($token.Count -eq 0) { return "" }
    if ($token[0] -notmatch '^[0-9a-fA-F]{64}$') { return "" }
    return $token[0].ToLowerInvariant()
}

function Test-Administrator {
    if (-not $IsWindows -and $null -ne $IsWindows) { return $false }
    $tozsamosc = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$tozsamosc).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-Polecenie {
    param([Parameter(Mandatory)][string]$Nazwa)
    return $null -ne (Get-Command $Nazwa -ErrorAction SilentlyContinue)
}

function Install-WertisNarzedzie {
    <#
        .SYNOPSIS
        Instaluje Node albo Gita, gdy ich nie ma.
        .DESCRIPTION
        Git jest w komplecie CELOWO, mimo że sam instalator go nie potrzebuje
        po pobraniu kodu: cała bieżąca obsługa w DEPLOY.md §7 stoi na
        `git pull` i Git Bashu (backup, reconcile, reslot). Instalator
        wgrywający ZIP-a unieważniłby tamten rozdział i zostawił maszynę bez
        ścieżki aktualizacji.
    #>
    param(
        [Parameter(Mandatory)][string]$Polecenie,
        [Parameter(Mandatory)][string]$IdWinget,
        [Parameter(Mandatory)][string]$Opis,
        [string]$UrlAwaryjny
    )
    if (Test-Polecenie $Polecenie) {
        Write-Ok "$Opis jest już zainstalowany."
        return $true
    }
    if (Test-DryRun "Zainstalowałbym $Opis ($IdWinget).") { return $true }

    if (Test-Polecenie "winget") {
        Write-Info "Instaluję $Opis przez winget..."
        & winget install --id $IdWinget --exact --silent --accept-source-agreements --accept-package-agreements
    } elseif ($UrlAwaryjny) {
        # Starsze Windows Server nie mają wingeta. Instalator MSI działa
        # wszędzie, tylko trzeba go pobrać ręcznie.
        Write-Uwaga "Brak wingeta — pobieram instalator $Opis bezpośrednio."
        Initialize-WertisSiec
        $msi = Join-Path $env:TEMP ([IO.Path]::GetFileName($UrlAwaryjny))
        Invoke-WebRequest -Uri $UrlAwaryjny -OutFile $msi -UseBasicParsing
        # MSI idzie za chwilę do msiexec z uprawnieniami administratora —
        # weryfikacja MUSI być przed uruchomieniem, nie po.
        if (-not (Test-WertisSuma -Sciezka $msi -Oczekiwana $script:SUMA_NODE_MSI -Opis "Instalator Node")) {
            Remove-Item $msi -Force -ErrorAction SilentlyContinue
            return $false
        }
        Start-Process msiexec.exe -ArgumentList "/i", "`"$msi`"", "/qn", "/norestart" -Wait
    } else {
        Write-Blad "Brak $Opis i brak wingeta. Zainstaluj ręcznie i uruchom instalator ponownie."
        return $false
    }

    # Nowy PATH jest w rejestrze, ale nie w tym procesie — bez odświeżenia
    # kolejny krok nie zobaczyłby świeżo zainstalowanego narzędzia.
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Polecenie $Polecenie) {
        Write-Ok "$Opis zainstalowany."
        return $true
    }
    Write-Blad "$Opis nie odpowiada po instalacji. Uruchom instalator ponownie w nowym oknie."
    return $false
}

function Test-WertisNode {
    <#
        .SYNOPSIS
        Czy zainstalowany Node spełnia `engines` z package.json (>= 22.5).
        .DESCRIPTION
        Maszyna z wcześniejszym Node'em przechodzi zwykłe „czy jest node?"
        bez zająknięcia, a wywala się dopiero na `npm ci` albo — gorzej —
        przy starcie usługi, komunikatem o nieznanym module `node:sqlite`.
        Aplikacja używa wbudowanego sterownika SQLite, który pojawił się
        dokładnie w 22.5.
    #>
    param([version]$Minimalna = "22.5.0")
    if (Test-DryRun "Sprawdził(a)bym wersję Node (wymagana >= $Minimalna).") { return $true }
    if (-not (Test-Polecenie "node")) { return $false }

    $surowa = (& node -v) -replace "^v", ""
    $wersja = [version]"0.0.0"
    if (-not [version]::TryParse($surowa, [ref]$wersja)) {
        Write-Uwaga "Nie umiem odczytać wersji Node ('$surowa') - jadę dalej."
        return $true
    }
    if ($wersja -lt $Minimalna) {
        Write-Blad "Node $wersja jest za stary - aplikacja wymaga co najmniej $Minimalna."
        Write-Info "Zaktualizuj Node (winget upgrade OpenJS.NodeJS.LTS) i uruchom instalator ponownie."
        return $false
    }
    Write-Ok "Node $wersja spełnia wymagania (>= $Minimalna)."
    return $true
}

function Get-WertisNssm {
    <#
        .SYNOPSIS
        Ściąga nssm.exe do <katalog>\tools i zwraca ścieżkę.
    #>
    param([Parameter(Mandatory)][string]$Katalog)
    $docelowy = Join-Path $Katalog "tools\nssm.exe"
    if (Test-Path $docelowy) {
        Write-Ok "NSSM już jest ($docelowy)."
        return $docelowy
    }
    if (Test-DryRun "Pobrałbym nssm.exe do $docelowy.") { return $docelowy }

    Zapewnij-Katalog (Split-Path $docelowy)
    Initialize-WertisSiec
    $zip  = Join-Path $env:TEMP "nssm-2.24.zip"
    $rozp = Join-Path $env:TEMP "nssm-2.24-rozpakowany"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip -UseBasicParsing
    # nssm.exe będzie zakładał usługi jako SYSTEM — sprawdzamy, ZANIM go rozpakujemy
    if (-not (Test-WertisSuma -Sciezka $zip -Oczekiwana $script:SUMA_NSSM_ZIP -Opis "NSSM")) {
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        throw "Pobrany nssm-2.24.zip nie przeszedl weryfikacji sumy kontrolnej."
    }
    if (Test-Path $rozp) { Remove-Item $rozp -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $rozp -Force
    Copy-Item (Join-Path $rozp "nssm-2.24\win64\nssm.exe") $docelowy -Force
    Write-Ok "NSSM pobrany."
    return $docelowy
}

function Register-WertisUsluga {
    <#
        .SYNOPSIS
        Rejestruje jedną usługę przez NSSM — parametry jak w DEPLOY.md §3.
        Istniejącą usługę tylko przekonfigurowuje (idempotencja).
        .DESCRIPTION
        `-Aplikacja` to program uruchamiany przez NSSM. Dla usług Node jest to
        node.exe ze skryptem w `-Skrypt`; worker Sfery (C#) jest samodzielnym
        exe i `-Skrypt` zostaje wtedy pusty. Alias `-Node` trzyma zgodność
        z wcześniejszymi wywołaniami.
    #>
    param(
        [Parameter(Mandatory)][string]$Nssm,
        [Parameter(Mandatory)][string]$Nazwa,
        [string]$Skrypt = "",
        [Parameter(Mandatory)][string]$Katalog,
        [Alias("Node")][Parameter(Mandatory)][string]$Aplikacja
    )
    if (Test-DryRun "Zarejestrowałbym usługę $Nazwa ($(if ($Skrypt) { $Skrypt } else { $Aplikacja })).") { return }

    $istnieje = $null -ne (Get-Service -Name $Nazwa -ErrorAction SilentlyContinue)
    if ($istnieje) {
        Write-Info "Usługa $Nazwa już istnieje — przestawiam ustawienia."
        & $Nssm set $Nazwa Application $Aplikacja   | Out-Null
        & $Nssm set $Nazwa AppParameters $Skrypt    | Out-Null
    } elseif ($Skrypt) {
        & $Nssm install $Nazwa $Aplikacja $Skrypt | Out-Null
    } else {
        & $Nssm install $Nazwa $Aplikacja | Out-Null
    }
    $logi = Join-Path $Katalog "logs"
    New-Item -ItemType Directory -Force -Path $logi | Out-Null

    & $Nssm set $Nazwa AppDirectory     $Katalog                                  | Out-Null
    & $Nssm set $Nazwa AppStdout        (Join-Path $logi "$Nazwa.log")            | Out-Null
    & $Nssm set $Nazwa AppStderr        (Join-Path $logi "$Nazwa.err.log")        | Out-Null
    & $Nssm set $Nazwa AppRotateFiles   1                                         | Out-Null
    & $Nssm set $Nazwa AppRotateBytes   10485760                                  | Out-Null
    & $Nssm set $Nazwa Start            SERVICE_AUTO_START                        | Out-Null
    & $Nssm set $Nazwa AppExit Default  Restart                                   | Out-Null
    Write-Ok "Usługa $Nazwa gotowa."
}

function Publish-WertisKonfiguracja {
    <#
        .SYNOPSIS
        Zapisuje ustawienia do wertis.env — JEDYNEGO źródła konfiguracji.
        .DESCRIPTION
        API i worker to osobne procesy; gdy tylko jeden dostanie
        SGT_MODE=mssql, zapisy po cichu lądują w lokalnym SQLite zamiast
        w Subiekcie i zadanie mimo to kończy się sukcesem. Oba czytają dziś
        ten sam plik z dysku (server/src/env-file.ts), więc NSSM nie przenosi
        już żadnej konfiguracji.

        Dlatego ta funkcja robi też drugą rzecz, mniej oczywistą: KASUJE
        środowisko obu usług — `AppEnvironment` ORAZ `AppEnvironmentExtra`.
        Zmienne środowiskowe mają pierwszeństwo nad plikiem, więc pozostałość
        po starszej instalacji — np. hasło sprzed zmiany albo SGT_MODE=seeded —
        po cichu wygrałaby z tym, co instalator właśnie zapisał, i to bez
        żadnego objawu poza „u mnie nie działa".

        ZAPIS JEST SCALENIEM, NIE NADPISANIEM. Do sierpnia 2026 plik powstawał
        od zera z ustawień kreatora, więc każdy klucz dopisany ręką znikał przy
        najbliższym `-TylkoKonfiguracja`. Dotyczyło to rzeczy, których kreator
        z założenia nie zna: `DOK_TYPY_DOSTAW`, `MSSQL_ZD_ZREAL_COLUMN`,
        ustawień zdjęć. Objawem była zgaszona funkcja bez jednego błędu w logu.

        Reguła scalania jest jednozdaniowa: KREATOR WYGRYWA TAM, GDZIE MA
        ZDANIE. Klucz obecny w `$Ustawienia` idzie z kreatora, także wtedy, gdy
        jest pusty — pusta nazwa instancji MSSQL to świadome „instancja domyślna"
        i stara wartość musi wtedy zniknąć. Klucza, o który kreator nie pytał,
        funkcja nie rusza.
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [Parameter(Mandatory)][hashtable]$Ustawienia,
        [Parameter(Mandatory)][string]$Nssm,
        # wertis-sfera jest na liście, choć usługa często nie istnieje —
        # pętla czyszczenia i tak pomija usługi nieobecne (Get-Service)
        [string[]]$Uslugi = @("wertis-api", "wertis-worker", "wertis-sfera"),
        [int]$Port = 3001
    )
    $plik = Join-Path $Katalog "wertis.env"
    $Ustawienia.PORT = "$Port"
    <#
        Lista jest BIAŁĄ LISTĄ USTAWIEŃ KREATORA, nie kolejnością wypisywania.
        Wartość spoza niej nie trafi z `$Ustawienia` do pliku, choćby kreator ją
        zebrał — a nieobecne jest tu wszystko, co dotyczy KONT: hasło admina
        idzie przez API do bazy i nie ma po co lądować w pliku, który zostaje
        na dysku serwera. Pilnuje tego `testy.ps1`.

        Klucza dopisanego RĘKĄ ta lista nie dotyczy: takie przechodzą przez plik
        nietknięte (poza `$script:WertisKluczeNieprzepisywane`). Lista mówi więc
        dziś wyłącznie o tym, co kreator umie ustawić, i o kolejności wypisania.
    #>
    $kolejnosc = @(
        "SGT_MODE",
        "MSSQL_SERVER", "MSSQL_INSTANCE", "MSSQL_PORT", "MSSQL_DATABASE",
        "MSSQL_USER", "MSSQL_PASSWORD",
        "MSSQL_LOC_COLUMN",
        # kolumna ilości już odebranej — kreator SPRAWDZA, czy w ogóle istnieje,
        # i zapisuje pustkę, gdy jej nie ma (patrz klucze puste znaczące)
        "MSSQL_ZD_ZREAL_COLUMN",
        "MAG_ID_MAG", "MAG_ID_MGP", "MAG_ID_ZWROTY",
        # worker Sfery (dokumenty MM) — DEPLOY §6 etap 2, sfera-worker/README.md
        "SFERA_WORKER", "SFERA_OPERATOR", "SFERA_OPERATOR_HASLO",
        # zdjęcia kartotek — kreator o nie nie pyta; są tu dla stałego miejsca
        # w pliku i po to, żeby dało się je podać wywołaniem programistycznym
        "ZDJECIA_ZRODLO", "ZDJECIA_TABELA", "ZDJECIA_KOLUMNA_KLUCZA",
        "ZDJECIA_KOLUMNA", "ZDJECIA_KOLUMNA_GLOWNE", "ZDJECIA_KOLUMNA_KOLEJNOSC",
        "ZDJECIA_KATALOG", "ZDJECIA_WZORZEC_PLIKU", "ZDJECIA_MAX_KB",
        "ZDJECIA_CACHE_MB", "ZDJECIA_TTL_H", "ZDJECIA_BRAK_TTL_H", "ZDJECIA_BLAD_TTL_MIN",
        # strefa do wyświetlania godzin (baza zostaje w UTC)
        "STREFA_CZASU",
        "PORT"
    )
    $poprzednie = Read-WertisEnv -Sciezka $plik

    # Klucze znane instalatorowi. Kreator wygrywa tam, gdzie ma zdanie
    # (`ContainsKey`); o resztę nie pytał, więc zostaje przy wartości z pliku.
    $znane = [ordered]@{}
    foreach ($k in $kolejnosc) {
        $w = ""
        $maZdanie = $false
        if ($Ustawienia.ContainsKey($k)) { $w = "$($Ustawienia[$k])"; $maZdanie = $true }
        elseif ($poprzednie.Contains($k)) { $w = "$($poprzednie[$k])"; $maZdanie = $true }
        <#
            Pusta wartość zwykle znaczy „nie ustawiono" i klucz nie wychodzi do
            pliku — aplikacja weźmie domyślną. Wyjątkiem są klucze, których
            domyślna jest NIEPUSTA: tam pustka musi zostać zapisana wprost,
            inaczej nie da się od tej domyślnej odejść.
        #>
        if ($w -ne "") { $znane[$k] = $w }
        elseif ($maZdanie -and $script:WertisKluczePusteZnaczace -contains $k) { $znane[$k] = "" }
    }

    # Klucze dopisane ręką. Instalator ich nie rozumie i właśnie dlatego ich
    # nie rusza — dokumentacja każe dopisywać tu rzeczy, o które kreator nie
    # pyta (DOK_TYPY_DOSTAW, MSSQL_ZD_ZREAL_COLUMN, ustawienia zdjęć).
    $reczne = [ordered]@{}
    foreach ($k in @($poprzednie.Keys)) {
        if ($kolejnosc -contains $k) { continue }
        if ($script:WertisKluczeNieprzepisywane -contains $k) { continue }
        $reczne[$k] = "$($poprzednie[$k])"
    }

    $linie = @(
        "# WERTIS - ustawienia srodowiska. Plik wygenerowany przez instalator.",
        "#",
        "# JEDYNE zrodlo konfiguracji: czytaja go WSZYSTKIE procesy (API, worker,",
        "# worker Sfery) wprost z dysku. Po zmianie wystarczy restart uslug:",
        "#   nssm restart wertis-api ; nssm restart wertis-worker",
        "#   (i wertis-sfera, jesli wdrozony worker Sfery - DEPLOY par. 6 etap 2)",
        "#",
        "# Instalator SCALA, a nie nadpisuje: klucze dopisane recznie przezywaja",
        "# kolejne przebiegi. Komentarze wlasne jednak nie - plik jest generowany.",
        "#",
        "# Plik trzyma haslo do bazy - jest w .gitignore i nie ma go w repo.",
        ""
    )
    foreach ($k in $znane.Keys) {
        # apostrofy wokół wartości: hasło może zawierać znaki, które bash
        # zinterpretowałby przy `source wertis.env` (plik ma pozostać
        # wczytywalny obiema drogami)
        $linie += "export $k='$($znane[$k])'"
    }
    if ($reczne.Count -gt 0) {
        $linie += @(
            "",
            "# Ponizsze klucze dopisano recznie - kreator o nie nie pyta i ich nie zmienia.",
            "# Opis kazdego z nich jest w wertis.env.example."
        )
        foreach ($k in $reczne.Keys) { $linie += "export $k='$($reczne[$k])'" }
    }
    $linie += ""

    $ile = $znane.Count + $reczne.Count
    $zachowane = if ($reczne.Count -gt 0) { ", w tym $($reczne.Count) dopisanych recznie" } else { "" }
    if (-not (Test-DryRun "Zapisałbym $plik ($ile ustawień$zachowane).")) {
        # Zakończenia linii w stylu Uniksa: plik jest wczytywany także przez
        # `source wertis.env` w Git Bashu, a CR na końcu wartości wjechałby
        # do hasła.
        Write-WertisPlik -Sciezka $plik -Tresc (($linie -join "`n") + "`n")
        Write-Ok "Zapisano $plik ($ile ustawień$zachowane)."
    }

    # Sprzątanie po starszych instalacjach: zmienne w usłudze przykrywają plik.
    #
    # OBA ustawienia, nie jedno — i z nazw tej różnicy nie widać:
    #   AppEnvironmentExtra  DOKŁADA zmienne do środowiska procesu,
    #   AppEnvironment       ZASTĘPUJE je w całości.
    #
    # Do sierpnia 2026 kasowane było wyłącznie to pierwsze. Instalacja, która
    # kiedyś użyła AppEnvironment, przechodziła przez kreator NIETKNIĘTA:
    # kreator zapisywał SGT_MODE=mssql, plik był wczytywany, a proces i tak
    # startował w trybie seeded. Objawu nie było żadnego poza tym, że
    # w Subiekcie nic się nie zmieniało.
    foreach ($usluga in $Uslugi) {
        if (Test-DryRun "Wyczyścił(a)bym AppEnvironment i AppEnvironmentExtra usługi $usluga.") { continue }
        if ($null -eq (Get-Service -Name $usluga -ErrorAction SilentlyContinue)) { continue }
        foreach ($klucz in $script:WertisKluczeSrodowiskaNssm) {
            $stare = (& $Nssm get $usluga $klucz 2>$null | Out-String).Trim()
            if ($stare) {
                & $Nssm reset $usluga $klucz | Out-Null
                Write-Uwaga "Usunięto $klucz usługi $usluga - przykrywałoby wertis.env."
            }
        }
    }
}

function Add-WertisRegulaZapory {
    <#
        .SYNOPSIS
        Wpuszcza kolektory na port API — tylko z sieci lokalnej (DEPLOY.md §4).
    #>
    param([int]$Port = 3001, [string]$Nazwa = "WERTIS kolektor")
    if (Test-DryRun "Dodałbym regułę zapory '$Nazwa' na porcie $Port (localsubnet).") { return }

    $istnieje = Get-NetFirewallRule -DisplayName $Nazwa -ErrorAction SilentlyContinue
    if ($istnieje) {
        Write-Ok "Reguła zapory '$Nazwa' już istnieje."
        return
    }
    New-NetFirewallRule -DisplayName $Nazwa -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -RemoteAddress LocalSubnet | Out-Null
    Write-Ok "Reguła zapory dodana (TCP $Port, tylko sieć lokalna)."
}

function Restart-WertisUslugi {
    param([string[]]$Uslugi = @("wertis-api", "wertis-worker", "wertis-sfera"))
    if (Test-DryRun "Zrestartowałbym usługi: $($Uslugi -join ', ').") { return }
    foreach ($u in $Uslugi) {
        # wertis-sfera istnieje tylko przy wdrożonym workerze Sfery — nieobecna
        # usługa to norma, a nie powód do fałszywego "uruchomiona"
        if ($null -eq (Get-Service -Name $u -ErrorAction SilentlyContinue)) { continue }
        Restart-Service -Name $u -Force -ErrorAction SilentlyContinue
        Start-Service  -Name $u -ErrorAction SilentlyContinue
        Write-Ok "Usługa $u uruchomiona."
    }
}

function Get-WertisWersja {
    <#
    .SYNOPSIS
        Numer wersji z package.json w korzeniu repo.
    .DESCRIPTION
        Aktualizacja bez podania „z czego na co" nie mówi, czy w ogóle się
        odbyła — a to jest pierwsze pytanie po jej zakończeniu. Czytamy JEDYNE
        miejsce, w którym numer stoi (CHANGELOG.md, preambuła).

        Brak pliku albo niepoprawny JSON zwraca "?" zamiast rzucać: numer jest
        informacją dla człowieka, a nie warunkiem powodzenia aktualizacji.
    #>
    param([Parameter(Mandatory)][string]$Katalog)

    $plik = Join-Path $Katalog "package.json"
    if (-not (Test-Path $plik)) { return "?" }
    try {
        $json = Get-Content $plik -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.version) { return [string]$json.version }
        return "?"
    } catch {
        return "?"
    }
}

function Get-WertisApk {
    <#
    .SYNOPSIS
        Sciaga APK kolektora do server\data\apk. `$true` = plik lezy na miejscu.
    .DESCRIPTION
        Od 0.52.0 kolektory aktualizuja sie same, z serwera WERTIS w sieci
        magazynu. Zeby mialy skad, plik musi trafic na serwer - i robi to ten
        krok, razem z aktualizacja kodu.

        NIEUDANE POBRANIE NIE JEST BLEDEM AKTUALIZACJI. Serwer dziala dalej,
        a kolektory zostaja na starym APK - dokladnie tak, jak dzialaly przed
        0.52.0. Zatrzymanie aktualizacji firmy przez plik, ktorego nikt w tej
        minucie nie potrzebuje, byloby gorsze od jego braku.

        Plik jedzie pod nazwa tymczasowa i dostaje wlasciwa dopiero po zgodnej
        sumie SHA-256. Kolektor nie ma prawa zobaczyc pobrania w polowie:
        wystawia je serwer kazdemu, kto zapyta, w tej samej sekundzie.
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [Parameter(Mandatory)][string]$Wersja,
        [string]$Zrodlo = "https://github.com/MateuszPuchalski/mag-asystent/releases/latest/download"
    )

    $katalogApk = Join-Path $Katalog "server\data\apk"
    $nazwa = "wertis-kolektor-$Wersja.apk"
    $cel = Join-Path $katalogApk $nazwa
    if (Test-Path $cel) {
        Write-Ok "APK kolektora $Wersja jest juz na serwerze."
        return $true
    }

    Zapewnij-Katalog $katalogApk
    $tymczasowy = "$cel.czesc"
    try {
        Invoke-WebRequest -Uri "$Zrodlo/$nazwa" -OutFile $tymczasowy -UseBasicParsing -ErrorAction Stop
    } catch {
        Remove-Item $tymczasowy -Force -ErrorAction SilentlyContinue
        Write-Uwaga "Nie udalo sie pobrac APK kolektora ($nazwa)."
        Write-Info  "   Serwer dziala; kolektory zostaja na dotychczasowej wersji."
        Write-Info  "   Plik mozna dolozyc recznie do: $katalogApk"
        return $false
    }

    # Suma jedzie DO PLIKU, a nie przez tresc odpowiedzi. GitHub podaje
    # `.sha256` jako application/octet-stream, wiec PowerShell zwracal tam
    # tablice bajtow - a `-split` na tablicy bral pierwszy element i dawal
    # "102", czyli kod znaku "f". Instalator porownywal wtedy poprawny APK
    # z liczba i przerywal z komunikatem o podmienionym pliku.
    $sumaOczekiwana = ""
    $plikSumy = "$cel.sha256.czesc"
    try {
        Invoke-WebRequest -Uri "$Zrodlo/$nazwa.sha256" -OutFile $plikSumy -UseBasicParsing -ErrorAction Stop
        $sumaOczekiwana = Get-WertisSumaZPliku -Sciezka $plikSumy
        if (-not $sumaOczekiwana) {
            Write-Uwaga "Plik sumy kontrolnej $nazwa.sha256 ma nieoczekiwana tresc."
        }
    } catch {
        Write-Uwaga "Brak pliku sumy kontrolnej dla $nazwa."
    } finally {
        Remove-Item $plikSumy -Force -ErrorAction SilentlyContinue
    }

    if (-not (Test-WertisSuma -Sciezka $tymczasowy -Oczekiwana $sumaOczekiwana -Opis "APK kolektora")) {
        Remove-Item $tymczasowy -Force -ErrorAction SilentlyContinue
        return $false
    }

    Move-Item -Path $tymczasowy -Destination $cel -Force
    # Stare wydania tylko zajmuja miejsce: serwer wystawia najwyzsza wersje
    # i tak, wiec kazdy plik ponizej niej jest juz nieuzywany.
    Get-ChildItem $katalogApk -Filter "wertis-kolektor-*.apk" |
        Where-Object { $_.Name -ne $nazwa } |
        Remove-Item -Force -ErrorAction SilentlyContinue
    Write-Ok "APK kolektora $Wersja gotowy dla kolektorow."
    return $true
}

function Test-WertisHealth {
    <#
        .SYNOPSIS
        Odpytuje /api/health i ZWRACA odpowiedź. Wywołujący ma pokazać `mode`,
        stan workera i listę `problemy`.
        .DESCRIPTION
        Tryb jest tu rzeczą, która naprawdę cokolwiek mówi: "seeded" znaczy, że
        aplikacja pracuje na danych demo i NIC nie dociera do Subiekta — mimo
        że wszystko wygląda normalnie i każdy zapis kończy się sukcesem.

        Odpowiedź obejmuje dziś OBA procesy (worker melduje swój tryb, API je
        porównuje), więc jedno zapytanie wystarcza, żeby stwierdzić, czy
        instalacja jest spójna. Wcześniej ten sam curl raportował wyłącznie
        API i rozjazd z workerem był przez nie niewykrywalny.
    #>
    param([int]$Port = 3001, [int]$Prob = 15)
    if (Test-DryRun "Odpytałbym http://localhost:$Port/api/health.") { return $null }

    for ($i = 1; $i -le $Prob; $i++) {
        try {
            return Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 5
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return $null
}

# ════════════════════════════════════════════════════════════════════════════
#  KONTO ADMINA
# ════════════════════════════════════════════════════════════════════════════
#
# Świeża instalacja nie ma ŻADNEGO konta, a bez konta nie da się ani zalogować
# na kolektorze, ani wejść do podglądu biura. Do 0.23.0 instalator kończył
# pracę na tym miejscu i zostawiał człowieka z kreatorem na kolektorze albo
# z `curl`-em w README.
#
# Hasła NIE generujemy. Człowiek, który właśnie stawia serwer, wpisuje je sam —
# hasło wypisane na monitorze w biurze przepisuje się na karteczkę i zostaje na
# monitorze. To dokładnie ta różnica, dla której `instalator/README.md` mówił
# wcześniej „nie zakłada kont": nie samo zakładanie było problemem, tylko
# wypisywanie sekretu.

function Test-WertisHasloAdmina {
    <#
        .SYNOPSIS
        Czy hasło spełnia regułę serwera. Ta sama liczba co `HASLO_MIN`.
        .DESCRIPTION
        Sprawdzamy TUTAJ, a nie dopiero po odpowiedzi API, bo człowiek wpisuje
        hasło dwa razy (drugi raz na potwierdzenie) i odbicie się od serwera po
        obu wpisaniach jest dwiema stratami zamiast jednej.
    #>
    param([string]$Haslo)
    return ("$Haslo".Length -ge 8)
}

function New-WertisKontoAdmina {
    <#
        .SYNOPSIS
        Zakłada pierwsze konto (rola `admin`) przez API. Zwraca $true przy
        powodzeniu.
        .DESCRIPTION
        Idzie przez `POST /api/users`, a nie prosto do SQLite, z jednego
        powodu: hasło hashuje serwer i tylko serwer wie, jak. Wpisywanie
        wiersza do bazy z zewnątrz oznaczałoby drugą implementację tej samej
        rzeczy — i pierwszą, która się rozjedzie.

        Trasa przepuszcza bez sesji WYŁĄCZNIE przy pustej bazie i sama wymusza
        rolę `admin`. Instalacja na bazie, która konta już ma, dostanie 401 —
        i tak ma być: nie jest zadaniem instalatora dokładać konta do
        działającej firmy.
    #>
    param(
        [Parameter(Mandatory)][string]$Login,
        # `AllowEmptyString`, bo w przebiegu próbnym hasła NIE MA — nikt o nie
        # nie pytał. Bez tego atrybutu walidator parametru odrzuca wywołanie
        # ZANIM `Test-DryRun` zdąży cokolwiek powiedzieć, i `-DryRun` wywala się
        # na kroku, który z założenia niczego nie robi.
        [Parameter(Mandatory)][AllowEmptyString()][string]$Haslo,
        [string]$Nazwa = "Administrator",
        [int]$Port = 3001
    )
    if (Test-DryRun "Założyłbym konto admina „$Login” przez API.") { return $true }

    # Prawdziwy przebieg zostaje ŚCISŁY: pusty łańcuch przechodzi przez binder,
    # ale nie przez to sprawdzenie — inaczej poszedłby w żądaniu do serwera.
    if (-not (Test-WertisHasloAdmina $Haslo)) {
        Write-Blad "Hasło admina jest za krótkie — konta nie zakładam."
        return $false
    }

    $body = @{ name = $Nazwa; login = $Login; haslo = $Haslo } | ConvertTo-Json -Compress
    try {
        $odp = Invoke-RestMethod -Method Post -Uri "http://localhost:$Port/api/users" `
            -ContentType "application/json; charset=utf-8" `
            -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 10
        Write-Ok "Konto „$($odp.user.login)” założone (rola: $($odp.user.role))."
        return $true
    } catch {
        # 401 = baza ma już konta; 409 = ten login jest zajęty. Obie sytuacje są
        # do naprawienia ręcznie i żadna nie jest powodem, żeby przerwać
        # instalację, która poza tym się udała.
        Write-Blad "Nie udało się założyć konta: $($_.Exception.Message)"
        return $false
    }
}

# ════════════════════════════════════════════════════════════════════════════
#  DEINSTALACJA
# ════════════════════════════════════════════════════════════════════════════
#
# Kolejność kroków jest wymuszona przez Windows i NIE wynika z samego kodu:
#
#   1. zatrzymanie usług   — działający node.exe trzyma uchwyty do plików
#   2. nssm remove         — nssm.exe leży WEWNĄTRZ kasowanego katalogu
#   3. reguła zapory
#   4. katalog
#
# Odwrócenie 2 i 4 zostawia usługi zarejestrowane na zawsze, bez narzędzia,
# którym dało się je zdjąć.

function Get-WertisPlanDeinstalacji {
    <#
        .SYNOPSIS
        Rozstrzyga, czy wolno skasować katalog i co z niego ocalić.
        .DESCRIPTION
        `Remove-Item -Recurse -Force` na ścieżce z parametru jest najgroźniejszą
        rzeczą w tym repozytorium. Instalator wywalił się już raz u klienta na
        `New-Item -Path "C:\"` (patrz testy.ps1) — ta sama literówka w -Katalog
        kosztowałaby tutaj dysk, a nie nieudaną instalację.

        Dlatego kasowanie wymaga ROZPOZNANIA instalacji: katalog musi zawierać
        `server` oraz `.git` albo `wertis.env`. Korzeń dysku, C:\Windows i każda
        ścieżka spoza tego wzorca dostają odmowę z powodem.

        Funkcja jest czysta — stan dysku wchodzi przez -Zawartosc, bo inaczej
        nie dałoby się napisać na to asercji (tak samo jak -Teraz
        w Test-WertisBazaPodejrzana).
        .PARAMETER Zawartosc
        Nazwy pozycji w katalogu, np. @("server", ".git", "wertis.env").
        Pusta tablica znaczy: katalogu nie ma albo jest pusty.
        .PARAMETER Stempel
        Znacznik czasu w nazwie katalogu z ocalonymi danymi. Wstrzykiwany,
        żeby wynik funkcji był powtarzalny w teście.
    #>
    param(
        # AllowEmptyString, bo pusta ścieżka ma dostać ODMOWĘ Z POWODEM, a nie
        # wyjątek wiązania parametru. Bez tego gałąź „pusta ścieżka" niżej jest
        # martwym kodem, a wywołujący dostaje komunikat PowerShella zamiast
        # zdania po polsku.
        [Parameter(Mandatory)][AllowEmptyString()][string]$Katalog,
        [string[]]$Zawartosc = @(),
        [switch]$UsunDane,
        [string]$Stempel = (Get-Date -Format "yyyyMMdd-HHmm")
    )

    $plan = [pscustomobject]@{
        Katalog     = $Katalog
        Wolno       = $false
        Powod       = ""
        # Pusty = dane lecą razem z katalogiem.
        DaneDo      = ""
    }

    if (-not $Katalog -or -not $Katalog.Trim()) {
        $plan.Powod = "pusta ścieżka"
        return $plan
    }

    # Korzeń dysku rozpoznajemy po SAMEJ ścieżce, nie przez Split-Path.
    #
    # Stało tu wcześniej `Split-Path $pelna -Leaf` i to był błąd: dla "C:"
    # ta funkcja NIE zwraca "C:", więc wzorzec niżej nie trafiał i `C:\`
    # przechodziło bramkę. Złapała to dopiero asercja na Windowsie — logika
    # przepisana poza PowerShellem dawała inny wynik, bo modelowała
    # Split-Path zgadywanką. Tu nie ma czego zgadywać: po przycięciu
    # ukośników z korzenia zostaje samo "C:", a z "/" pustka.
    $pelna = $Katalog.TrimEnd('\', '/')
    if (-not $pelna -or $pelna -match "^[A-Za-z]:$") {
        $plan.Powod = "to jest korzeń dysku, nie katalog instalacji"
        return $plan
    }

    if (@($Zawartosc).Count -eq 0) {
        # Nie błąd: deinstalacja po ręcznym skasowaniu katalogu ma dojść do
        # końca i zdjąć usługi, a nie przewrócić się na pierwszym kroku.
        $plan.Powod = "katalogu nie ma albo jest pusty - nie ma czego kasować"
        return $plan
    }

    # Dwa znamiona, nie jedno. Sam `server` bywa w cudzych projektach, więc
    # -Katalog wskazujący czyjeś repo przechodziłby bramkę bez drugiego warunku.
    $lista    = @($Zawartosc)
    $maServer = $lista -contains "server"
    $maZnak   = ($lista -contains ".git") -or ($lista -contains "wertis.env")
    if (-not ($maServer -and $maZnak)) {
        $plan.Powod = "to nie wygląda na instalację WERTIS (brak server\ oraz .git\ lub wertis.env)"
        return $plan
    }

    $plan.Wolno = $true
    if (-not $UsunDane) {
        # Ślad audytowy przeżywa deinstalację CELOWO: docs/wdrozenie.md czyni
        # z niego jedyne źródło odpowiedzi na „co stało w polu przed zmianą".
        $plan.DaneDo = "$pelna-dane-$Stempel"
    }
    return $plan
}

function Test-SciezkaWewnatrz {
    <#
        .SYNOPSIS
        Czy $Sciezka leży wewnątrz $Katalog (albo NIM jest)?
        .DESCRIPTION
        Czysta funkcja, bez dotykania dysku — dzięki temu daje się sprawdzić
        asercją w CI, tak samo jak Get-WertisPlanDeinstalacji. Świadomie NIE
        woła Resolve-Path ani GetFullPath: te normalizują względem bieżącego
        systemu, a testy chodzą na Linuksie na ścieżkach „C:\...".

        Porównanie prefiksem MUSI kończyć się separatorem. Bez tego
        "C:\wertis2\node.exe" wypada jako „wewnątrz C:\wertis" i deinstalacja
        ubija cudzy proces. To ta sama klasa błędu co Split-Path na korzeniu
        dysku wyżej: prawie-trafne porównanie ścieżek jest gorsze od żadnego.
    #>
    param(
        [string]$Sciezka,
        [string]$Katalog
    )
    if (-not $Sciezka -or -not $Sciezka.Trim()) { return $false }
    if (-not $Katalog -or -not $Katalog.Trim()) { return $false }

    $s = $Sciezka.Trim().Replace('/', '\')
    $k = $Katalog.Trim().Replace('/', '\').TrimEnd('\')
    if (-not $k) { return $false }

    if ($s.TrimEnd('\') -eq $k) { return $true }
    return $s.StartsWith("$k\", [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-WertisProcesyDoUbicia {
    <#
        .SYNOPSIS
        Wybiera z podanej listy procesy, których plik wykonywalny leży
        wewnątrz $Katalog.
        .DESCRIPTION
        Dostaje GOTOWĄ listę, zamiast wołać Get-Process samodzielnie — to
        cała różnica między funkcją sprawdzalną w CI a taką, której nie da
        się sprawdzić nigdzie poza maszyną klienta.

        Własny PID wypada z listy: instalator nie ma popełnić samobójstwa
        w połowie deinstalacji. Procesy bez czytelnej ścieżki (systemowe,
        bez prawa odczytu) pomijamy cicho — .Path potrafi na nich rzucić.
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [object[]]$Procesy = @(),
        [int]$WlasnyPid = $PID
    )
    $wynik = @()
    foreach ($p in @($Procesy)) {
        if ($null -eq $p) { continue }
        if ($p.Id -eq $WlasnyPid) { continue }

        $sciezka = $null
        try { $sciezka = $p.Path } catch { $sciezka = $null }
        if (-not $sciezka) { continue }

        if (Test-SciezkaWewnatrz -Sciezka $sciezka -Katalog $Katalog) { $wynik += $p }
    }
    return @($wynik)
}

function Stop-WertisProcesyWKatalogu {
    <#
        .SYNOPSIS
        Ubija procesy uruchomione z kasowanego katalogu.
        .DESCRIPTION
        `nssm remove` wyrejestrowuje usługę, ale gdy proces wisiał (a wisiał —
        stąd SERVICE_PAUSED w zgłoszeniu), node.exe zostaje z otwartymi
        uchwytami na plikach i katalog nie daje się skasować.

        Zasięg jest wąski CELOWO: tylko procesy, których plik wykonywalny
        leży wewnątrz kasowanego katalogu. node.exe z C:\Program Files,
        obsługujący cudzą aplikację, jest poza zasięgiem z definicji.
    #>
    param([Parameter(Mandatory)][string]$Katalog)

    $doUbicia = @(Get-WertisProcesyDoUbicia -Katalog $Katalog `
        -Procesy @(Get-Process -ErrorAction SilentlyContinue) -WlasnyPid $PID)

    if ($doUbicia.Count -eq 0) {
        Write-Info "Żaden działający proces nie siedzi w $Katalog."
        return @()
    }
    foreach ($p in $doUbicia) {
        if (Test-DryRun "Zatrzymał(a)bym proces $($p.ProcessName) (PID $($p.Id)) z $($p.Path).") { continue }
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Ok "Zatrzymany proces $($p.ProcessName) (PID $($p.Id))."
    }
    return $doUbicia
}

function Remove-WertisUslugi {
    <#
        .SYNOPSIS
        Zatrzymuje i wyrejestrowuje usługi. Odwrotność Register-WertisUsluga.
        .DESCRIPTION
        `nssm remove <nazwa> confirm` — bez słowa `confirm` NSSM otwiera OKNO
        DIALOGOWE i skrypt wisi w nieskończoność na maszynie bez człowieka.

        Gdy nssm.exe już nie istnieje (ktoś skasował katalog wcześniej), usługi
        zostałyby zarejestrowane na zawsze. Awaryjnie idzie `sc.exe delete` —
        brzydsze, ale to jedyne wyjście z tego stanu.
    #>
    param(
        [string]$Nssm = "",
        [string[]]$Uslugi = @("wertis-api", "wertis-worker", "wertis-sfera")
    )
    foreach ($u in $Uslugi) {
        if (Test-DryRun "Zatrzymał(a)bym i wyrejestrował(a)bym usługę $u.") { continue }
        if ($null -eq (Get-Service -Name $u -ErrorAction SilentlyContinue)) {
            Write-Info "Usługi $u nie ma - pomijam."
            continue
        }
        Stop-Service -Name $u -Force -ErrorAction SilentlyContinue

        if ($Nssm -and (Test-Path $Nssm)) {
            & $Nssm remove $u confirm | Out-Null
        } else {
            Write-Uwaga "Brak nssm.exe - wyrejestrowuję $u przez sc.exe."
            & sc.exe delete $u | Out-Null
        }

        if ($null -eq (Get-Service -Name $u -ErrorAction SilentlyContinue)) {
            Write-Ok "Usługa $u usunięta."
        } else {
            # Windows zwalnia wpis dopiero po zamknięciu wszystkich uchwytów —
            # najczęściej otwartego okna „Usługi". Mówimy to wprost, bo inaczej
            # człowiek uzna deinstalację za nieudaną.
            Write-Uwaga "Usługa $u nadal widnieje. Zamknij okno 'Usługi' i uruchom ponownie."
        }
    }
}

function Remove-WertisRegulaZapory {
    <#
        .SYNOPSIS
        Zdejmuje regułę wpuszczającą kolektory. Odwrotność Add-WertisRegulaZapory.
    #>
    param([string]$Nazwa = "WERTIS kolektor")
    if (Test-DryRun "Usunął(ęła)bym regułę zapory '$Nazwa'.") { return }

    $istnieje = Get-NetFirewallRule -DisplayName $Nazwa -ErrorAction SilentlyContinue
    if (-not $istnieje) {
        Write-Info "Reguły zapory '$Nazwa' nie ma - pomijam."
        return
    }
    Remove-NetFirewallRule -DisplayName $Nazwa -ErrorAction SilentlyContinue
    Write-Ok "Reguła zapory '$Nazwa' usunięta."
}

function Remove-WertisKatalog {
    <#
        .SYNOPSIS
        Kasuje katalog instalacji, ocalając dane — o ile plan na to pozwala.
        .DESCRIPTION
        Decyzję podejmuje Get-WertisPlanDeinstalacji; tutaj zostaje samo
        wykonanie. Podział jest celowy: reguła bezpieczeństwa da się wtedy
        sprawdzić asercją, a tego kroku nie da się w CI wykonać wcale.
    #>
    param(
        [Parameter(Mandatory)][string]$Katalog,
        [switch]$UsunDane
    )
    $zawartosc = if (Test-Path $Katalog) {
        @(Get-ChildItem $Katalog -Force | ForEach-Object { $_.Name })
    } else { @() }

    $plan = Get-WertisPlanDeinstalacji -Katalog $Katalog -Zawartosc $zawartosc -UsunDane:$UsunDane
    if (-not $plan.Wolno) {
        Write-Uwaga "Nie kasuję $Katalog - $($plan.Powod)."
        return $plan
    }

    # PRZED przenoszeniem danych, nie tylko przed kasowaniem: zablokowany plik
    # wywraca także Move-Item, a wtedy ślad audytowy zostaje w katalogu, który
    # za chwilę ma zniknąć.
    Stop-WertisProcesyWKatalogu -Katalog $Katalog | Out-Null

    if ($plan.DaneDo) {
        if (-not (Test-DryRun "Przeniósłbym dane do $($plan.DaneDo), potem skasował resztę $Katalog.")) {
            $dane = Join-Path $Katalog "server\data"
            if (Test-Path $dane) {
                Zapewnij-Katalog (Split-Path $plan.DaneDo)
                Move-Item $dane $plan.DaneDo -Force
                Write-Ok "Dane ocalone: $($plan.DaneDo)"
            } else {
                Write-Info "Nie ma server\data - nie było czego ocalać."
                $plan.DaneDo = ""
            }
        }
    }

    if (Test-DryRun "Skasował(a)bym katalog $Katalog.") { return $plan }
    Remove-Item $Katalog -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $Katalog) {
        Write-Uwaga "Katalog $Katalog nie zniknął w całości - pliki w użyciu."

        # „Pliki w użyciu" bez nazwy winowajcy kończy się kasowaniem katalogu
        # ręką, czyli ominięciem bramki bezpieczeństwa. Mówimy CO trzyma.
        $trzymaja = @(Get-WertisProcesyDoUbicia -Katalog $Katalog `
            -Procesy @(Get-Process -ErrorAction SilentlyContinue) -WlasnyPid $PID)
        if ($trzymaja.Count -gt 0) {
            Write-Info "Trzymają go:"
            foreach ($p in $trzymaja) {
                Write-Info "  $($p.ProcessName) (PID $($p.Id)) - $($p.Path)"
            }
            Write-Info "Ubij je i powtórz deinstalację."
        } else {
            Write-Info "Żaden widoczny proces nie ma tu pliku wykonywalnego, więc uchwyt"
            Write-Info "trzyma co innego: otwarte okno Eksploratora, edytor albo powłoka"
            Write-Info "stojąca w tym katalogu (sprawdź, czy nie ta, w której to piszesz)."
            Write-Info "Znajdziesz to w resmon: CPU > Skojarzone dojścia > szukaj 'wertis'."
        }
    } else {
        Write-Ok "Katalog $Katalog usunięty."
    }
    return $plan
}
