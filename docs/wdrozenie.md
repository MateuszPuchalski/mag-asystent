# Wdrożenie na produkcji — sześć etapów

Ten dokument odpowiada na jedno pytanie: **jak wpuścić aplikację do firmy tak,
żeby żaden błąd nie kosztował danych ani zaufania magazynierów**.

Reguła jest jedna. **Każdy etap kończy się zdaniem sprawdzalnym**, a nie
wrażeniem, że wygląda dobrze. Bez spełnionej bramki nie przechodzi się dalej.

Polecenia — instalacja, usługi, zapytania — mieszkają w [`DEPLOY.md`](../DEPLOY.md).
Ten dokument mówi, **w jakiej kolejności** ich użyć i **co ma być prawdą**,
zanim zrobi się następny krok.


Etapy niżej prowadzą PRODUKCJĘ na prawdziwe dane. Stałe środowisko dev
obok produkcji — do rozwoju, gdy magazyn już pracuje — opisuje DEPLOY.md,
rozdział „Środowisko dev obok produkcji".

## Dlaczego etapami

Aplikacja zapisuje do bazy firmy DWA pola kartoteki: lokalizację i podstawowy
kod kreskowy (od 0.37.0). Oba są odwracalne wyłącznie z kopii zapasowej.
Etapy istnieją po to, żeby każdy błąd wyszedł tam, gdzie kosztuje jedno
zapytanie, a nie tam, gdzie kosztuje dzień pracy magazynu.

Na kopii bazy tej firmy wyszły w ten sposób dwie usterki. Pierwsza to kolumna
ilości zrealizowanej, której w tej wersji Subiekta nie ma wcale. Druga to
dokumenty PZ na liście rozkładania, pochodzące z zupełnie innego procesu.

## Najważniejsze narzędzie: zatrzymany worker

`wertis-api` i `wertis-worker` to **dwie osobne usługi Windows**. API czyta bazę
i przyjmuje pracę. Worker jest jedynym procesem, który **zapisuje do Subiekta**.

Zatrzymanie workera daje więc przebieg próbny na żywych danych. Aplikacja czyta
prawdziwą bazę i kolejkuje zamierzone zapisy — **do Subiekta nie idzie nic**.
Kolejka staje się listą tego, co aplikacja zrobiłaby, gdyby jej pozwolić.
Polecenia (zatrzymanie usługi, podgląd kolejki) podaje `DEPLOY.md` §6.

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

**Druga bramka, od 0.52.0:** kolektor po restarcie sam zaproponował wersję
z serwera i zainstalował ją bez `adb`. Wymaga trzech rzeczy przygotowanych
wcześniej — patrz sekcja o APK niżej.

**Wycofanie:** deinstalacja (`DEPLOY.md` §8). Subiekt zostaje nietknięty,
bo ten etap nic do niego nie zapisał. Na maszynie zostaje jednak więcej, niż
widać — patrz sekcja „Jak odinstalować" na końcu.

---

### Etap 1 — kopia bazy, worker zatrzymany

**Cel:** sprawdzić, czy aplikacja **czyta** prawdziwe dane poprawnie.

1. Przywróć kopię bazy produkcyjnej pod inną nazwą.
2. Uruchom instalator z przełącznikiem `-TylkoKonfiguracja` i wskaż **kopię**.
3. Zatrzymaj workera (`DEPLOY.md` §6, „zatrzymany worker").
4. Przejdź listę ustawień `[WERYFIKUJ]` — tabela skutków pomyłki w `DEPLOY.md` §6.

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

1. Uruchom workera z powrotem (`DEPLOY.md` §3).
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

1. Zatrzymaj workera — **przed** przełączeniem na produkcję (`DEPLOY.md` §6).
2. Przestaw `MSSQL_DATABASE` na bazę produkcyjną.
3. Zrestartuj usługę `wertis-api` (`DEPLOY.md` §3).
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

1. Uruchom workera z powrotem (`DEPLOY.md` §3).
2. **Jedna osoba, jeden regał, jeden dzień.** Nie cały magazyn.
3. Wieczorem przejrzyj ślad audytowy i rekoncyliację (`DEPLOY.md` §7).

**Bramka:**

- zero `queue_failed` w `GET /api/events`,
- rekoncyliacja (`DEPLOY.md` §7) bez rozbieżności,
- magazynier nie zgłosił nic, czego nie umiesz wyjaśnić.

**Wycofanie:** zatrzymanie workera zatrzymuje dalsze zapisy natychmiast.
Cofnięcie już wykonanych wymaga kopii zapasowej.

---

### Etap 5 — pełna praca

Bramek nie ma. Zostaje bieżąca obsługa z `DEPLOY.md` §7: nocna kopia,
rekoncyliacja, przegląd `/api/health`.

---

## APK kolektora — trzy rzeczy przed pierwszym wdrożeniem

Od 0.52.0 kolektory aktualizują się same, z serwera WERTIS. Instalator kładzie
plik w `server\data\apk`, urządzenia pytają o niego przy otwarciu aplikacji.
Bez trzech rzeczy poniżej ta droga nie zadziała, a dowiesz się o tym dopiero
przy pierwszej aktualizacji.

**1. Podpis wydania i kopia klucza.** Android odrzuca aktualizację podpisaną
innym kluczem niż zainstalowana aplikacja. Klucz robi się raz i nie leży
w repozytorium (`DEPLOY.md` §5).

> **Kopia klucza jest równie ważna jak kopia bazy.** Bez niej żaden przyszły
> APK nie zainstaluje się nad obecnym, a jedynym wyjściem zostaje obejście
> wszystkich kolektorów z osobna.

**2. Jednorazowa reinstalacja floty.** Urządzenia z buildem debugowym mają inny
podpis i odmówią aktualizacji. Każde trzeba odinstalować i zainstalować od
nowa, a to kasuje adres serwera, listę ostatnio skanowanych i **bufor offline**.

Kolejność na urządzenie:

1. Sprawdź, że bufor offline nie ma nic do wysłania.
2. Odinstaluj aplikację.
3. Zainstaluj wydanie podpisane własnym kluczem.
4. Podaj adres serwera na ekranie startowym.

Rób to po zmianie, urządzenie po urządzeniu. Każda kolejna aktualizacja wchodzi
już po wierzchu i niczego nie kasuje.

**3. Zgoda „Instalowanie nieznanych aplikacji".** Android pyta o nią raz, per
urządzenie; kolektor sam prowadzi do właściwego ekranu. Gdy MDM tego zabrania,
aplikacja powie to wprost i nie pobierze nic — wtedy aktualizacje idą przez MDM,
jak przed 0.52.0. **Sprawdź profil MDM, zanim ruszysz reinstalację floty.**

**Nazwa pliku niesie wersję** (`wertis-kolektor-0.52.0.apk`) i po niej serwer
rozpoznaje, co ma do wydania. Plik o innej nazwie jest po cichu pomijany, więc
literówka wygląda jak brak aktualizacji, a nie jak błąd.

## Dołączenie workera Sfery (dokumenty MM) — osobna ścieżka, te same reguły

Worker Sfery (`sfera-worker/`) automatyzuje dokumenty MM i dochodzi
**po** ustabilizowaniu etapów powyżej. To nowy proces piszący do bazy firmy,
więc każda bramka jest zdaniem sprawdzalnym. Instrukcja instalacji:
`DEPLOY.md` §6, etap 2.

### Piaskownicą NIE jest kopia bazy

Etapy 1 i 2 wyżej idą na kopii i tak zostaje. Worker Sfery jest inny, bo
**na kopii Sfera nie wstaje**. Licencje InsERT-a siedzą w bazie podmiotu
i przywrócenie archiwum pod inną nazwą daje podmiot bez licencji. Taki podmiot
chodzi jako demo, a Sfera w demie nie działa.

Piaskownicą jest **podmiot testowy**, zakładany w oknie wyboru podmiotu:
Nowy → Wersja próbna → dane przykładowe. Działa 45 dni, a próbną Sferę
włącza się na nim osobno, na 15 dni. Tyle wystarczy na bramki niżej.

> ⚠️ Nie ruszaj „wymiany licencji" z programu serwisowego. Ona przenosi
> licencję między podmiotami i potrafi rozbroić produkcję.

Dwie rzeczy, o których trzeba pamiętać przy podmiocie testowym. Ma **własne
identyfikatory** towarów i magazynów, więc `MAG_ID_*` i kartoteki są inne niż
na produkcji. Sprawdzasz na nim **nazwy i zachowanie Sfery**, nie liczby firmy.
Wskazujesz go przez `MSSQL_DATABASE` w osobnym `wertis.env`.

Opis producenta:
[jak włączyć próbną Sferę](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/3332,jak-wlaczyc-probna-wersje-sfery-w-insert-gt.html)
oraz [ograniczenia wersji demo](https://www.insert.com.pl/dla_uzytkownikow/e-pomoc_techniczna/4469,insert-gt-jakie-ograniczenia-posiada-wersja-demo.html).

**Bramki — na podmiocie testowym, zanim cokolwiek dotknie produkcji:**

0. **Sonda nazw** (`sfera-worker\sonda.ps1`): otwiera sesję Subiekta i wypisuje
   nazwy składowych. Niczego nie zapisuje. Robi się ją PRZED usługą, bo zamyka
   większość listy `[WERYFIKUJ]` bez wystawiania dokumentu. Ustalenia wpisz do
   [`sfera-com.md`](sfera-com.md).
1. **Przebieg próbny** (`--dry-run`): pętla działa, `/api/health` pokazuje
   blok `sfera` z `zyje: true`. Zadanie mm przechodzi cykl z numerem
   `MM DRY-RUN/n` — dokument w Subiekcie NIE powstaje.
2. **Jedno prawdziwe MM na kartotece próbnej.** Numer w `sgt_doc_number`
   równa się numerowi dokumentu w Subiekcie. Stany zgadzają się na obu
   magazynach. `queue_applied` w `GET /api/events` niesie autora z kolektora.
3. **Bufor.** MM ze skrótu dostawy, której FZ jest odłożona, stoi
   w `waiting_for_doc`. Wyjęcie dokumentu z bufora → wykonane w ≤ 60 s.
4. **Guard kolejności.** Wpędź zapis lokalizacji w błąd (np. cofnięty GRANT
   na kolumnę) i zleć przesunięcie tego samego towaru. MM ma stać w `pending`,
   a rekoncyliacja wymienia je jako `mm_czeka`. PONÓW lokalizacji → MM wchodzi
   samo, w tej kolejności. To jest niezmiennik „adres przed sprzedawalnością"
   zmierzony, nie zadeklarowany.
5. **Odporność.** Ubij proces w trakcie zapisu. Po restarcie zadanie jest
   w `error` z ostrzeżeniem o możliwym duplikacie, a w Subiekcie NIE ma dwóch
   MM. Zatrzymanie usługi → zdanie o Sferze w `problemy` w `/api/health`.

**Bramka 6 — jedno MM na produkcji.** Wykonaj ją dopiero po piątce i dopiero
po kopii zapasowej podmiotu. Weź kartotekę próbną i jedną sztukę. Numer
dokumentu ma się zgadzać, a stany na obu magazynach mają wrócić do siebie po
usunięciu MM w Subiekcie.

Ta bramka **nie służy do ustalania `mag_Id`** — te są znane i stoją
w `wertis.env` od etapu 1. Służy do czegoś innego: to pierwszy dokument, jaki
Sfera wystawia na podmiocie produkcyjnym.

Zmienia się przy tym wszystko poza kodem. Inna licencja, inny operator, inne
uprawnienia i pierwsze zetknięcie `Zapisz()` z prawdziwymi stanami. Podmiot
testowy odpowiada na pytanie „czy nazwy są dobre", a ten jeden dokument na
pytanie „czy Sfera wpuszcza nas u Was".

**Wycofanie:** `SFERA_WORKER=0` (albo usunięcie wpisu) + restart usług —
zadania mm wracają do dawnego zachowania (czytelny błąd, MM wystawia biuro).
Dokumenty już wystawione cofa się w Subiekcie, jak każde MM.

## Konto SQL, gdy nie ma hasła `sa`

**`sa` nie jest wymagane** — wystarczy dowolne konto, które może założyć login
i nadać uprawnienia. Instalator to przewiduje: zapisuje gotowy skrypt uprawnień
do przekazania administratorowi bazy. Do jego wykonania aplikacja **nie połączy
się z bazą** — to jest oczekiwane, a nie nieudana instalacja. Ścieżkę skryptu
i polecenia podaje `DEPLOY.md` §6.

## Wycofanie zapisu opiera się o kopię bazy

Ślad audytowy zapisuje przy każdej zmianie lokalizacji **starą i nową**
zawartość pola oraz to, z którego ekranu zmiana wyszła. Pytanie „co tam było
przed" ma więc odpowiedź — zapytanie podaje `DEPLOY.md` §7.

**Ale audyt nie jest mechanizmem przywracania.** Mówi, co wpisać; wpisać trzeba
samemu — z kartoteki w Subiekcie albo z kopii bazy. Przy większej liczbie
kartotek kopia jest jedyną rozsądną drogą.

Dlatego kopia zapasowa musi działać **przed etapem 4**, nie po nim.

## Jak odinstalować

Procedurę — polecenie, pułapki i drogę ręczną — podaje `DEPLOY.md` §8.
Z perspektywy wdrożenia liczą się trzy rzeczy:

- **odinstalowanie nie jest cofnięciem pracy aplikacji** — pole lokalizacji
  w Subiekcie zostaje, odwraca je wyłącznie kopia bazy,
- ślad audytowy i zdjęcia problemów **zostają**, przeniesione obok do
  `C:\wertis-dane-<data>` — historia bywa potrzebna długo po aplikacji,
- login SQL `wertis` zostaje; usuwa go administrator bazy (`DEPLOY.md` §8).
