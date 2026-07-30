# Wdrożenie na produkcji — sześć etapów

Ten dokument odpowiada na jedno pytanie: **jak wpuścić aplikację do firmy tak,
żeby żaden błąd nie kosztował danych ani zaufania magazynierów**.

Reguła jest jedna. **Każdy etap kończy się zdaniem sprawdzalnym**, a nie
wrażeniem, że wygląda dobrze. Bez spełnionej bramki nie przechodzi się dalej.

## Dlaczego etapami

Aplikacja zapisuje do bazy firmy dwie rzeczy: pole lokalizacji na kartotece
i flagę sprawdzenia na fakturze. Obie są odwracalne wyłącznie z kopii zapasowej.
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

**Wycofanie:** odinstalowanie usług. Nic poza tym nie powstało.

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

Trzeci punkt nie jest formalnością. Wycofanie zmiany lokalizacji opiera się
wyłącznie o kopię bazy — patrz sekcja niżej.

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

Ślad audytowy zapisuje przy zmianie lokalizacji **nową** zawartość pola. Nie
zapisuje wartości sprzed zmiany.

Znaczy to tyle, że pojedynczej zmiany **nie da się cofnąć z samego audytu**.
Trzeba albo odtworzyć pole z kopii zapasowej, albo prześledzić cały łańcuch
zdarzeń dla tej kartoteki. Łańcuch ma dziurę wszędzie tam, gdzie pole ustawiło
biuro poza aplikacją.

Dlatego kopia zapasowa musi działać **przed etapem 4**, nie po nim.

## Ustawienia do sprawdzenia przed etapem 3

Część wartości domyślnych to ustalenia, a część **założenia**. Te drugie są
oznaczone w kodzie jako `[WERYFIKUJ]` i wymagają jednego zapytania na własnej
bazie. Zapytania podaje `DEPLOY.md` §6.

| ustawienie | co ustala | czym grozi pomyłka |
|---|---|---|
| `MSSQL_LOC_COLUMN` | pole lokalizacji na kartotece | **nadpisanie cudzych danych** — aplikacja pisze bezwarunkowo |
| `MSSQL_DATABASE` | baza podmiotu | praca na kopii zamiast produkcji, bez objawu |
| `DOK_TYPY_DOSTAW` | typy dokumentów na liście rozkładania | obce dokumenty na liście pracy magazyniera |
| `DOK_DNI_WSTECZ` | okno importu dokumentów | nic nie ginie — niedokończone dostawy zostają mimo okna |
| `MSSQL_ZD_ZREAL_COLUMN` | ilość już odebrana z zamówienia | zawyżone ilości na karcie towaru |
| `DOK_STATUS_ZD_OTWARTE` | które zamówienia uznajemy za otwarte | zamknięte zamówienie wisi na karcie |
| `MSSQL_FLAG_GRUPA`, `MSSQL_FLAG_TYP_OBIEKTU` | flaga sprawdzenia faktury | flagi nie działają wcale |

**Kolumna ilości zrealizowanej może nie istnieć w ogóle.** W wersji sprawdzonej
w tej firmie `dok_Pozycja` nie ma żadnej takiej kolumny. Poprawnym ustawieniem
jest wtedy wartość pusta:

```bash
export MSSQL_ZD_ZREAL_COLUMN=
```

Karta towaru opisze wtedy ilość jako oszacowanie, a `/api/health` przestanie
zgłaszać problem, którego nie da się rozwiązać ustawieniem.
