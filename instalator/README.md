# Instalator WERTIS dla Windows

Stawia serwer WERTIS na maszynie z Subiektem GT. Rozpakowuje paczkę wydania,
rejestruje usługi Windows i otwiera port dla kolektorów. Wypełnia
konfigurację, odpytując bazę Subiekta, i zakłada konto SQL o minimalnych
uprawnieniach. Aktualizuje też działającą instalację.

Robi to, co [`DEPLOY.md`](../DEPLOY.md) każe zrobić ręcznie. **Tamta instrukcja
zostaje referencją tego katalogu.** Gdy instalator zawiedzie w połowie, każdy
krok da się dokończyć z palca.

## Uruchomienie

Pobierz `WERTIS-Instalator.exe` z [wydań](https://github.com/MateuszPuchalski/mag-asystent/releases)
i uruchom **jako administrator**. Z repo albo z gołego `.ps1` użyj
**`URUCHOM.cmd`**: prawy przycisk → *Uruchom jako administrator*.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1
```

**`-ExecutionPolicy Bypass` nie jest ozdobnikiem.** Windows domyślnie odmawia
uruchamiania plików `.ps1` (`running scripts is disabled on this system`).
Przełącznik dotyczy **tego jednego uruchomienia** i nie zmienia polityki
systemu.

**Windows PowerShell, nie `pwsh`.** Instalator używa `System.Data.SqlClient`
z .NET Framework, którego w PowerShellu 7 nie ma w komplecie. Plik `.exe` ma
właściwy silnik w środku.

| przełącznik | do czego |
|---|---|
| *(brak)* | pełna instalacja z kreatorem i kontem SQL |
| `-Demo` | instalacja pilotażowa: dane demo, **Subiekt nietknięty** (Etap 0 z `DEPLOY.md` §6) |
| `-Dev` | druga, rozwojowa instancja obok produkcji: usługi z sufiksem `-dev`, dane demo, własny `-Katalog` i `-Port` |
| `-Aktualizuj -Paczka <wersja>` | nowa wersja z paczki wydania (`najnowsza`, numer albo ścieżka ZIP-a) |
| `-Aktualizuj` | nowa wersja na instalacji z Gita (`git pull`, budowanie) |
| `-TylkoKonfiguracja` | sam kreator na działającej instalacji |
| `-ZdjeciaZapis` | pozwala dodać zdjęcie kartoteki z kolektora; kosztuje `GRANT INSERT` do bazy firmy |
| `-DryRun` | wypisuje, co by zrobił, i **nie zmienia niczego**; nie zadaje pytań |
| `-Odinstaluj` | zdejmuje usługi, regułę zapory i katalog; **Subiekta nie rusza** |
| `-UsunDane` | tylko z `-Odinstaluj`: kasuje też ślad audytowy, po drugim potwierdzeniu |
| `-Katalog`, `-Port`, `-Galaz` | odstępstwa od domyślnych `C:\wertis`, `3001`, `main` |
| `-SerwerSql`, `-InstancjaSql` | serwer i instancja SQL, gdy nie `localhost` i nie jedyna instancja |

## Co instalator robi

1. Pobiera paczkę `wertis-<wersja>.zip`, sprawdza sumę i rozpakowuje do `C:\wertis`.
2. Paczka niesie własny Node, więc na serwerze nic się nie instaluje ani nie kompiluje.
3. Dane lądują w `C:\wertis-dane`, a ponowna instalacja po awarii je podpina.
4. Dla `-Galaz` i instalacji z `.git` stawia Node (≥ 22.5) i Git przez `winget`.
5. Rejestruje `wertis-api` i `wertis-worker` w NSSM, z logami i restartem po awarii.
6. Otwiera port API w zaporze, wyłącznie dla sieci lokalnej.
7. Kreator pyta tylko o to, czego nie da się ustalić samemu.
8. Zakłada login SQL `wertis` z losowym hasłem i uprawnieniami kolumnowymi.

Kreator bierze serwer `localhost`, instancję z rejestru (INSERTGT albo jedyną)
i jedyną bazę bez pytania. **Pole lokalizacji zostaje decyzją człowieka**, bo
aplikacja nadpisuje je bezwarunkowo. Na koniec instalator pokazuje z
`/api/health` stan API i workera, bo zapis do Subiekta idzie przez workera.

## Aktualizacja

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Aktualizuj -Paczka najnowsza
```

Zamiast `najnowsza` można podać numer wersji albo ścieżkę ZIP-a z plikiem
`.sha256` obok niego. Nowa wersja rozpakowuje się obok starej, a usługi stoją
tylko na czas zamiany katalogów. Serwer, który nie wstanie, oddaje miejsce
poprzedniej wersji razem z bazą sprzed migracji. To samo robią przycisk
w panelu i automat, przez zadanie Harmonogramu (`zlecenie.ps1`). Kroki
i powody: `DEPLOY.md` §0b.

Aktualizacja **nie zadaje pytań** i nie dotyka bazy, konta SQL, GRANT-ów,
`wertis.env`, kont, zapory ani rejestracji usług. W `server\data` rusza tylko
katalog `apk`: kładzie APK dla kolektorów i kasuje starsze. **Nieudane
pobranie APK nie przerywa aktualizacji**, bo kolektory mogą zostać na swojej
wersji. Aktualizowany jest `-Katalog`, a nie katalog ze skryptem.

`-Aktualizuj` bez `-Paczka` działa tylko na instalacji z Gita. Usługi stoją
wtedy przez całe budowanie, bo `npm ci` kasuje `node_modules` pod workerem.
Nieudane budowanie zostawia je zatrzymane, bo stary `dist` z nową bazą
mieszałby dwie wersje.

## Konfiguracja: jeden plik `wertis.env`

Wszystkie procesy czytają `wertis.env` wprost z dysku
([`server/src/env-file.ts`](../server/src/env-file.ts)). **Zapis jest
scaleniem, nie nadpisaniem**: klucz spoza pytań kreatora zostaje taki, jak
w pliku. `MSSQL_INSTANCE` i `MSSQL_ZD_ZREAL_COLUMN` przy pustej odpowiedzi
dostają `''`, bo ich wartość domyślna nie jest pusta. `ADMIN_LOGIN`
i `ADMIN_HASLO` instalator usuwa, bo sekret konta nie leży na dysku serwera.
Kasuje też środowisko usług w NSSM (`AppEnvironment` i `AppEnvironmentExtra`),
bo zmienna środowiskowa po cichu wygrałaby z plikiem.

## Konto SQL: wartością są uprawnienia

Skrypt z [`docs/subiekt-gt-edu-setup.md`](../docs/subiekt-gt-edu-setup.md) §2
nadaje `SELECT` na tabelach z `Get-WertisTabeleOdczytu` oraz `UPDATE` na
dwóch kolumnach z `Get-WertisKolumnyZapisu`: lokalizacji i `tw_PodstKodKresk`.
`INSERT` na tabelę zdjęć dochodzi wyłącznie z `-ZdjeciaZapis`. Innego prawa
zapisu nie ma. Obiekt opcjonalny (zdjęcia, nazwy poziomów cen) sprawdza się
przed budową skryptu, bo `GRANT` na nieistniejący obiekt przerywa cały skrypt.

Instalator **weryfikuje nadane uprawnienia po fakcie**, bo błąd
`CREATE LOGIN` nie przerywa reszty skryptu. Skrypt jest idempotentny, więc
ponowny kreator dokłada tylko brakujące granty. **Bez praw administratora
bazy** instalator zapisuje gotowy skrypt do
`C:\wertis\nadaj-uprawnienia-wertis.sql` i mówi, komu go przekazać.

## Czego instalator NIE robi

- **Nie zakłada kont.** Pusta instalacja pokazuje w panelu
  (`http://<serwer>:3001/obsluga/`) formularz pierwszego konta z rolą `admin`.
  Resztę kont zakłada się w panelu albo na kolektorze (`DEPLOY.md` §5a).
- **Nie buduje workera Sfery.** Gdy `wertis-sfera-worker.exe` leży
  w `<katalog>\sfera-worker\`, pyta o włączenie i rejestruje usługę
  `wertis-sfera` (`sfera-worker/README.md`).
- **Nie zakłada usługi tła.** `wertis-tlo` rejestruje się ręcznie
  (`tlo-worker/README.md`). Aktualizacja zatrzymuje jednak każdą działającą
  usługę z programem w katalogu instalacji.
- **Nie konfiguruje kopii bazy aplikacji ani rekoncyliacji.** Robi je serwer co
  noc i przed każdą migracją (`DEPLOY.md` §7).
- **Nie robi kopii bazy Subiekta.** Pole lokalizacji cofa wyłącznie kopia
  podmiotu, robiona narzędziami InsERT-a albo SQL Servera.
- **Nie usuwa loginu SQL przy deinstalacji.** Login powstał na poziomie
  instancji, więc skrypt podaje gotowe `DROP USER` i `DROP LOGIN`.
- **Nie cofa tego, co aplikacja zapisała do Subiekta**
  ([`docs/wdrozenie.md`](../docs/wdrozenie.md)).

## Trzy rzeczy, o które instalator pyta osobno

**Baza podmiotu, a nie jej kopia.** Kopia ma te same tabele, a pomyłka jest
cicha: stany byłyby nieaktualne, a adresy szłyby w martwą bazę. Kreator
pokazuje datę ostatniego dokumentu, liczbę dokumentów i datę utworzenia.
Podpowiada tylko ściśle najświeższą bazę i nigdy nie odrzuca bazy sam.

**Restart usługi SQL** wyrzuca wszystkich z Subiekta na kilkanaście sekund.
Wymaga go dopiero włączenie TCP/IP albo uwierzytelniania mieszanego.

**Pole lokalizacji.** Wybrane pole aplikacja nadpisuje bezwarunkowo. Kreator
pokazuje zajętość każdego z ośmiu pól własnych i przy niepustym żąda
potwierdzenia.

## Rozwój

```powershell
.\testy.ps1                 # asercje — najtańsza i najkonkretniejsza bramka
.\proba-podmiany.ps1        # prawdziwa podmiana katalogów i wycofanie, w TEMP
.\build.ps1                 # scalenie do dist\WERTIS-Instalator.ps1 (+ URUCHOM.cmd)
.\build.ps1 -Exe            # dodatkowo .exe (wymaga modułu ps2exe)
.\wertis-instalator.ps1 -DryRun -Katalog C:\proba
```

`wertis-instalator.ps1` to przebieg główny. Moduły `ui.ps1`, `sql.ps1`,
`uslugi.ps1` i `paczka.ps1` `build.ps1` wstawia między znaczniki
`MODULY-POCZATEK` i `MODULY-KONIEC`, bo `ps2exe` pakuje dokładnie jeden plik.
`zlecenie.ps1` wykonuje aktualizację zleconą z panelu.

**Pliki `.ps1` muszą być zapisane w UTF-8 z BOM.** Windows PowerShell 5.1
czyta plik bez BOM jako ANSI i polskie znaki się rozsypują. Pilnuje tego krok
w [`.github/workflows/instalator.yml`](../.github/workflows/instalator.yml).

CI sprawdza kodowanie, składnię, asercje z `testy.ps1`, próbę podmiany,
scalanie i przebieg `-DryRun`. **`-DryRun` dowodzi przebiegu sterowania, nie
poprawności kroków**, bo każdy krok wykonawczy siedzi za `Test-DryRun`.
Bramką na błędy kroków są asercje w `testy.ps1`. Niczego, co wymaga Subiekta,
CI nie sprawdza: połączenia, konta, usług i zapory. Te cztery rzeczy
weryfikuje się ręcznie na Subiekcie edu.

## Antywirus zablokował instalator

**To jest spodziewane i nie znaczy, że plik jest zarażony.** `IDP.Generic`
(AVG/Avast) czy `Trojan:Script/Wacatac` (Defender) to detekcje heurystyczne.
Legalny instalator usługi i dropper wykonują te same czynności: pobierają
archiwum, zakładają usługi i podnoszą uprawnienia.

`.ps1` to czysty tekst: przeczytaj go i sprawdź sumę
(`Get-FileHash -Algorithm SHA256`). Instalator sięga wyłącznie do
`github.com`, `api.github.com`, `nodejs.org` (tylko instalacja z Gita)
i `nssm.cc`. Ciąg base64, `Invoke-Expression`, `-EncodedCommand` albo inny
adres to **nie jest** fałszywy alarm — nie uruchamiaj i zgłoś.

1. Zgłoś fałszywy alarm producentowi antywirusa.
2. Użyj `.ps1` zamiast `.exe`, bo binarka z `ps2exe` jest flagowana częściej.
3. Wykluczenie tylko w ostateczności i wyłącznie na konkretny plik.

**Każdy pobrany plik ma sumę SHA-256 sprawdzaną przed użyciem.** Paczka ma ją
obowiązkowo, bo uruchamia ją usługa jako SYSTEM. Przy APK brak sumy daje
ostrzeżenie, bo Android i tak sprawdzi podpis. Node sprawdza się z
`SHASUMS256.txt`, a NSSM z sumy policzonej w CI.

## Znane ograniczenia

- **`.exe` jest niepodpisany.** SmartScreen pokaże ostrzeżenie („Więcej
  informacji” → „Uruchom mimo to”). Certyfikat code-signing to decyzja
  i koszt po stronie firmy.
- **Instalator zakłada SQL Server na tej samej maszynie.** Zdalna instancja
  zadziała, ale TCP/IP i uwierzytelnianie mieszane trzeba tam ustawić ręcznie.
