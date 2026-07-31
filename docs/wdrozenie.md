# Wdrożenie na produkcji — sześć etapów

Ten dokument odpowiada na jedno pytanie: **jak wpuścić aplikację do firmy tak,
żeby żaden błąd nie kosztował danych ani zaufania magazynierów**.

Reguła jest jedna. **Każdy etap kończy się zdaniem sprawdzalnym**, a nie
wrażeniem, że wygląda dobrze. Bez spełnionej bramki nie przechodzi się dalej.

## Dlaczego etapami

Aplikacja zapisuje do bazy firmy JEDNĄ rzecz: pole lokalizacji na kartotece.
Jest odwracalne wyłącznie z kopii zapasowej.
Etapy istnieją po to, żeby każdy błąd wyszedł tam, gdzie kosztuje jedno
zapytanie, a nie tam, gdzie kosztuje dzień pracy magazynu.

Na kopii bazy tej firmy wyszły w ten sposób dwie usterki. Pierwsza to kolumna
ilości zrealizowanej, której w tej wersji Subiekta nie ma wcale. Druga to
dokumenty PZ na liście rozkładania, pochodzące z zupełnie innego procesu.

## Najważniejsze narzędzie: zatrzymany worker

`wertis-api` i `wertis-worker` to **dwie osobne usługi Windows**. API czyta bazę
i przyjmuje pracę. Worker jest jedynym procesem, który **zapisuje do Subiekta**.

Zatrzymanie workera daje więc przebieg próbny na żywych danych:

```powershell
nssm stop wertis-worker
```

Aplikacja czyta prawdziwą bazę i kolejkuje zamierzone zapisy. **Do Subiekta nie
idzie nic.** Kolejka staje się listą tego, co aplikacja zrobiłaby, gdyby jej
pozwolić:

```bash
curl -s -H "x-session: $TOKEN" http://localhost:3001/api/queue | jq '.items[] | {label, detail, status}'
```

`/api/health` zgłosi wtedy zatrzymany worker jako problem. To jest oczekiwane
na etapach 1 i 3, a nie usterka instalacji.

## Etapy

| etap | dane | worker | kto pracuje |
|---|---|---|---|
| **0** | demo | włączony | Ty |
| **1** | kopia bazy | **zatrzymany** | Ty |
| **2** | kopia bazy | włączony | Ty |
| **3** | **produkcja** | **zatrzymany** | Ty |
| **4** | produkcja | włączony | jedna osoba, jeden regał |
| **5** | produkcja | włączony | cały magazyn |

---

### Etap 0 — demo

**Cel:** sprawdzić, czy aplikacja w ogóle działa na tym sprzęcie.

Instalacja z przełącznikiem `-Demo` albo `SGT_MODE=seeded`. Subiekt zostaje
nietknięty.

**Bramka:** magazynier przeszedł pełną ścieżkę na kolektorze. Zeskanował towar,
zobaczył kartę, zapisał lokalizację.

**Wycofanie:** `.\wertis-instalator.ps1 -Odinstaluj`. Subiekt zostaje nietknięty,
bo ten etap nic do niego nie zapisał. Na maszynie zostaje jednak więcej, niż
widać — patrz sekcja „Jak odinstalować" na końcu.

---

### Etap 1 — kopia bazy, worker zatrzymany

**Cel:** sprawdzić, czy aplikacja **czyta** prawdziwe dane poprawnie.

1. Przywróć kopię bazy produkcyjnej pod inną nazwą.
2. Uruchom `.\wertis-instalator.ps1 -TylkoKonfiguracja` i wskaż **kopię**.
3. Zatrzymaj workera: `nssm stop wertis-worker`.
4. Przejdź listę ustawień `[WERYFIKUJ]` z sekcji na końcu tego dokumentu.

**Bramka — trzy zdania naraz:**

- karta towaru zgadza się z Subiektem dla **dziesięciu losowych kartotek**,
- lista rozkładania pokazuje **te dokumenty, których się spodziewasz**,
- `/api/health` nie zgłasza nic poza zatrzymanym workerem.

**Wycofanie:** zatrzymanie usług. Do bazy nie poszedł ani jeden zapis.

> **Uwaga o izolacji.** Kopia bazy nie izoluje wszystkiego. Login `wertis`
> powstaje na poziomie **instancji SQL**, więc dotyczy też produkcji. Izolowane
> są dopiero uprawnienia, nadawane w konkretnej bazie.

---

### Etap 2 — kopia bazy, worker włączony

**Cel:** zobaczyć **zapis** w Subiekcie, zanim dotknie prawdziwych danych.

1. `nssm start wertis-worker`.
2. Zapisz lokalizację jednemu towarowi z kolektora.
3. Otwórz tę kartotekę w Subiekcie i sprawdź pole lokalizacji.

**Bramka:**

- pole w Subiekcie ma nową wartość,
- `GET /api/events?typ=queue_applied` pokazuje ten zapis z godziną i nazwiskiem,
- `queue_failed` nie ma ani jednego.

**Wycofanie:** przywrócenie kopii jeszcze raz. To dlatego etap idzie na kopii.

---

### Etap 3 — produkcja, worker zatrzymany

**Cel:** czytać prawdziwe dane i **obejrzeć zamiary zapisu**, nie wykonując ich.

1. `nssm stop wertis-worker` — **przed** przełączeniem na produkcję.
2. Przestaw `MSSQL_DATABASE` na bazę produkcyjną.
3. `nssm restart wertis-api`.
4. Poproś magazyniera o godzinę zwykłej pracy.

**Bramka:**

- `/api/queue` pokazuje zamiary, które **wyglądają sensownie**,
- `/api/health` nie zgłasza nic poza zatrzymanym workerem,
- **kopia zapasowa z `DEPLOY.md` §7 działa i została sprawdzona odtworzeniem.**

Trzeci punkt nie jest formalnością. Audyt powie, co w polu stało, ale wpisanie
tego z powrotem przy wielu kartotekach robi się kopią — patrz sekcja niżej.

**Wycofanie:** zatrzymanie usług. Kolejka zostaje, ale nic z niej nie poszło.

---

### Etap 4 — produkcja, jedna osoba, jeden regał

**Cel:** pierwszy prawdziwy zapis, w zakresie, który da się obejrzeć ręcznie.

1. `nssm start wertis-worker`.
2. **Jedna osoba, jeden regał, jeden dzień.** Nie cały magazyn.
3. Wieczorem przejrzyj ślad audytowy i rekoncyliację.

**Bramka:**

- zero `queue_failed` w `GET /api/events`,
- rekoncyliacja (`npm run reconcile`) bez rozbieżności,
- magazynier nie zgłosił nic, czego nie umiesz wyjaśnić.

**Wycofanie:** zatrzymanie workera zatrzymuje dalsze zapisy natychmiast.
Cofnięcie już wykonanych wymaga kopii zapasowej.

---

### Etap 5 — pełna praca

Bramek nie ma. Zostaje bieżąca obsługa z `DEPLOY.md` §7: nocna kopia,
rekoncyliacja, przegląd `/api/health`.

## Konto SQL, gdy nie ma hasła `sa`

**`sa` nie jest wymagane.** Wystarczy dowolne konto, które może założyć login
i nadać uprawnienia. W wielu firmach nikt nie wypuszcza `sa` z rąk i instalator
to przewiduje.

Na pytanie o hasło **wciśnij Enter**. Instalator zapisze wtedy gotowy skrypt:

```
C:\wertis\nadaj-uprawnienia-wertis.sql
```

Hasło konta jest już w środku i w `wertis.env`, więc nic nie trzeba podmieniać.
Przekaż plik administratorowi bazy. Po jego wykonaniu wystarczy restart usług:

```powershell
nssm restart wertis-api ; nssm restart wertis-worker
```

Do tego czasu aplikacja **nie połączy się z bazą**. To jest oczekiwane, a nie
nieudana instalacja.

## Wycofanie zapisu opiera się o kopię bazy

Ślad audytowy zapisuje przy każdej zmianie lokalizacji **starą i nową**
zawartość pola oraz to, z którego ekranu zmiana wyszła. Pytanie „co tam było
przed" ma więc odpowiedź:

```bash
curl -s -H "x-session: $TOKEN" \
  'http://localhost:3001/api/events?twId=507&typ=location_set,location_removed' | jq
```

Wartość „przed" jest zapisana **surowa**, dokładnie tak, jak stała w polu.
To celowe: przywrócenie polega na wpisaniu jej z powrotem bez zmian.

**Ale audyt nie jest mechanizmem przywracania.** Mówi, co wpisać; wpisać trzeba
samemu — z kartoteki w Subiekcie albo z kopii bazy. Przy większej liczbie
kartotek kopia jest jedyną rozsądną drogą.

Dlatego kopia zapasowa musi działać **przed etapem 4**, nie po nim.

## Jak odinstalować

Jedno polecenie, uruchomione **jako administrator**:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj
```

> **Dlaczego nie po prostu `.\wertis-instalator.ps1`.** Windows domyślnie
> odmawia uruchamiania plików `.ps1` i odpowiada `running scripts is disabled on
> this system`. `-ExecutionPolicy Bypass` dotyczy **tego jednego uruchomienia** —
> polityka systemowa zostaje nietknięta. Przy instalacji tę samą osłonę daje
> `URUCHOM.cmd` (prawym → „Uruchom jako administrator"), ale deinstalacja
> potrzebuje argumentów, więc idzie wprost.

Zdejmuje usługi `wertis-api` i `wertis-worker`, regułę zapory „WERTIS kolektor"
oraz katalog `C:\wertis`. Pyta o potwierdzenie, zanim cokolwiek ruszy.

Ślad audytowy i zdjęcia problemów **zostają**. Instalator przenosi je obok, do
`C:\wertis-dane-<data>`, i wypisuje tę ścieżkę. Historia zmian lokalizacji bywa
potrzebna długo po tym, jak aplikacja zniknie z maszyny.

Kasowanie także jej wymaga osobnego przełącznika i drugiego potwierdzenia:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -UsunDane
```

Przebieg próbny wypisze plan, nie ruszając niczego:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\wertis-instalator.ps1 -Odinstaluj -DryRun
```

### Instalatora nie uruchamia się z wnętrza kasowanego katalogu

Windows nie pozwoli usunąć katalogu, w którym **stoi powłoka** — a wcześniejsze
etapy każą wpisywać `cd C:\wertis` i `cd C:\wertis\tools`. Komunikat brzmi wtedy
tylko „jakiś proces używa tego folderu" i nie mówi, że tym procesem jesteś ty.

Wynieś instalator poza katalog i uruchom go stamtąd:

```powershell
cd C:\
Copy-Item C:\wertis\instalator C:\wertis-instalator -Recurse
powershell -NoProfile -ExecutionPolicy Bypass `
    -File C:\wertis-instalator\wertis-instalator.ps1 -Odinstaluj -Katalog C:\wertis
```

Ścieżka do `-File` jest tu **pełna**, a powłoka zostaje w `C:\` — dzięki temu
nie trzeba wchodzić do żadnego z tych katalogów.

Deinstalacja ostrzeże, jeśli mimo to wykryje powłokę w środku — zanim zapyta
o zgodę, nie po.

### Gdy katalog zostaje mimo wszystko

Procesy uruchomione z kasowanego katalogu instalator zatrzymuje sam: osierocony
`node.exe` potrafi przeżyć `nssm remove` i trzymać uchwyty na plikach. Zasięg
jest wąski celowo — tylko procesy, których plik wykonywalny leży **wewnątrz**
`C:\wertis`. `node.exe` obsługujący cudzą aplikację zostaje nietknięty.

Gdy katalog nadal nie znika, instalator wypisze nazwy i numery PID tego, co go
trzyma. Ubij je i powtórz:

```powershell
Get-Process | Where-Object { $_.Path -like 'C:\wertis\*' } |
    Select-Object Id, ProcessName, Path
Stop-Process -Id <numer> -Force
```

Pusta lista przy zablokowanym katalogu znaczy, że uchwyt trzyma coś bez własnego
pliku w środku: otwarte okno Eksploratora, edytor albo druga powłoka. Znajdziesz
to w Monitorze zasobów — `resmon`, zakładka **CPU**, sekcja **Skojarzone
dojścia**, szukaj `wertis`.

### Czego deinstalacja NIE cofa

To jest ważniejsze niż sama lista usuwanych rzeczy.

| co zostaje | dlaczego | jak usunąć ręcznie |
|---|---|---|
| **wartości w bazie Subiekta** | aplikacja je tam zapisała — to dane firmy, nie jej własne | wyłącznie z kopii bazy |
| **login SQL `wertis`** | stoi na poziomie **instancji**, nie bazy podmiotu | `DROP USER` i `DROP LOGIN` (niżej) |
| **ustawienia SQL Servera** | inne aplikacje mogą z nich korzystać | ręcznie, świadomie |
| **Node.js i Git** | instalator dokłada je systemowo | `winget uninstall` |

Pierwszy wiersz jest sednem. **Odinstalowanie aplikacji nie jest cofnięciem jej
pracy.** Pole lokalizacji na kartotekach zostaje dokładnie tam, gdzie je
wpisała — tak samo, jakby wpisał je człowiek.

Ustawienia SQL Servera to trzy rzeczy, które kreator przestawił, żeby w ogóle
dało się połączyć: uwierzytelnianie mieszane, protokół TCP i usługa SQL Browser
uruchamiana automatycznie. Zostają włączone. Cofnięcie któregokolwiek odcięłoby
każdą inną aplikację, która się na nim opiera.

Login usuwa administrator bazy, w bazie podmiotu:

```sql
DROP USER [wertis];
DROP LOGIN [wertis];
```

Instalator nie robi tego sam celowo. Login jest obiektem instancji, więc
pomyłka dotknęłaby wszystkich baz na serwerze, nie tylko tej jednej.

### Droga ręczna

Gdy skryptu nie ma pod ręką albo katalog zniknął wcześniej:

```powershell
nssm stop wertis-api ; nssm stop wertis-worker
nssm remove wertis-api confirm ; nssm remove wertis-worker confirm
Remove-NetFirewallRule -DisplayName "WERTIS kolektor"
Remove-Item C:\wertis -Recurse -Force
```

Bez `nssm.exe` (leży w kasowanym katalogu) usługi zdejmuje `sc.exe delete
wertis-api`. Kolejność jest wymuszona: katalog kasuje się **na końcu**, bo
inaczej znika narzędzie, którym usuwa się usługi.

## Ustawienia do sprawdzenia przed etapem 3

Część wartości domyślnych to ustalenia, a część **założenia**. Te drugie są
oznaczone w kodzie jako `[WERYFIKUJ]` i wymagają jednego zapytania na własnej
bazie. Zapytania podaje `DEPLOY.md` §6.

| ustawienie | co ustala | czym grozi pomyłka |
|---|---|---|
| `MSSQL_LOC_COLUMN` | pole lokalizacji na kartotece | **nadpisanie cudzych danych** — aplikacja pisze bezwarunkowo |
| `MSSQL_DATABASE` | baza podmiotu | praca na kopii zamiast produkcji, bez objawu |
| `DOK_TYPY_DOSTAW` | typy dokumentów w zakładce DOSTAWY (domyślnie sama FZ) | obce dokumenty na liście pracy magazyniera |
| `DOK_DNI_WSTECZ` | okno importu i zakres listy dostaw | nic nie ginie — niedokończone dostawy zostają mimo okna |
| `MSSQL_POZ_ID_COLUMN` | klucz wiersza faktury (`dok_Pozycja`) | nie da się wskazać pozycji, gdy towar stoi na fakturze dwa razy |
| **pole „Opis dostawy"** | gdzie biuro trzyma opis różnic przy pozycji faktury | zapis w niewłaściwą komórkę — patrz `docs/subiekt-gt-struktura.md` |
| `MSSQL_ZD_ZREAL_COLUMN` | ilość już odebrana z zamówienia | zawyżone ilości na karcie towaru |
| `DOK_STATUS_ZD_OTWARTE` | które zamówienia uznajemy za otwarte | zamknięte zamówienie wisi na karcie |

**Kolumna ilości zrealizowanej może nie istnieć w ogóle.** W wersji sprawdzonej
w tej firmie `dok_Pozycja` nie ma żadnej takiej kolumny. Poprawnym ustawieniem
jest wtedy wartość pusta:

```bash
export MSSQL_ZD_ZREAL_COLUMN=
```

Karta towaru opisze wtedy ilość jako oszacowanie, a `/api/health` przestanie
zgłaszać problem, którego nie da się rozwiązać ustawieniem.
