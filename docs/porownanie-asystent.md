# WERTIS a Firmes+ Asystent Magazyniera — materiał do decyzji

Dokument dla właściciela. Odpowiada na jedno pytanie: **zostajemy przy
Asystencie, wdrażamy WERTIS, czy trzymamy oba.**

> **Jak czytać ten dokument.** Opis *możliwości* Asystenta pochodzi z materiałów
> producenta i InsERT (linki w §10), **nie z testu porównawczego na naszym
> magazynie**. Informacja o tym, **z czego firma realnie korzysta**, pochodzi od
> właściciela — i tam, gdzie te dwa źródła się rozmijają, rozstrzyga praktyka.
> Wszystkie liczby po stronie WERTIS pochodzą z uruchomionego kodu.
>
> **To rozróżnienie decyduje o wnioskach.** Katalog funkcji producenta jest
> szerszy niż zakres używany w tej firmie, a porównywanie katalogów prowadzi do
> fałszywego wniosku, że dwa systemy się uzupełniają. Dokument porównuje więc
> **wykonywaną pracę**, nie listy funkcji.

---

## 1. Streszczenie decyzyjne

**Co jest dziś.** Asystent *oferuje* kompletację zamówień, tworzenie dokumentów
magazynowych (WZ, PZ, RW, PW, MM), zamówienia ZK i inwentaryzację. Lokalizację
towaru trzyma w polach własnych kartoteki.

**Ale z wydań w Asystencie nie korzystamy.** To rozstrzyga porównanie i dlatego
stoi tak wysoko. Katalog funkcji producenta jest szerszy niż to, co realnie
pracuje w tej firmie — a płacimy za katalog, nie za użycie. Funkcja, której się
nie używa, **nie jest argumentem za utrzymaniem systemu**; jest pozycją
w cenniku.

**Co proponujemy.** WERTIS przejmuje **przyjęcie dostawy i wyszukiwanie towaru** —
dwie ścieżki, które w naszej firmie są codzienne i na których rozkładanie jest
zarazem sprawdzaniem faktury. WERTIS zapisuje do Subiekta **dwa pola
kartoteki**: lokalizację i podstawowy kod kreskowy (od 0.37.0). Zero tworzenia
dokumentów, zero modyfikacji stanów.

**Czego to nie zastępuje.** Po odjęciu funkcji nieużywanych zostają **dwie
realne**: **inwentaryzacja** i **przesunięcia magazynowe (MM)**. Przesunięcie
jest już w WERTIS: kolektor je zbiera, waliduje i kolejkuje, a dokument tworzy
worker Sfery (`sfera-worker/`) — przełącznik `SFERA_WORKER` jest domyślnie
wyłączony do czasu etapu 2 wdrożenia; do włączenia dokument wystawia biuro.
Inwentaryzacja jest zaplanowana.

**Ile to kosztuje.** Asystent: 589 zł netto licencja startowa, 389 zł netto za
każde kolejne urządzenie, licencja roczna. WERTIS: brak opłat licencyjnych, ale
**cały serwis jest po stronie firmy** — nie ma umowy wsparcia ani producenta,
do którego można zadzwonić.

### Rekomendacja

**WERTIS na przyjęciu i wyszukiwaniu od zaraz. Asystent utrzymywać tylko tak
długo, jak długo realnie coś w nim pracuje.**

Z zestawienia katalogów obu produktów wychodzi wniosek kuszący i fałszywy:
trwały podział ról, WERTIS na przyjęciu, Asystent na wydaniu. **Fałszywy, bo
z wydań nie korzystamy** — podział ról wymagałby, żeby obie role były
obsadzone, a druga jest pusta.

Pytanie „zostajemy przy Asystencie czy nie" zawęża się więc do dwóch rzeczy
i tylko one powinny decydować:

| Pytanie | Jeśli **tak** | Jeśli **nie** |
|---|---|---|
| Czy robicie inwentaryzację przez Asystenta? | trzymać do czasu, aż WERTIS to dostanie | jeden powód mniej |
| Czy wystawiacie MM przez Asystenta? | trzymać do uruchomienia workera Sfery | jeden powód mniej |

Jeśli odpowiedź na oba brzmi „nie", **Asystent nie robi dziś nic, czego nie
zrobi WERTIS** — a wtedy roczna licencja opłaca funkcje leżące odłogiem.

> **Do potwierdzenia.** Nie wiem, czy korzystacie z inwentaryzacji i MM
> w Asystencie. Dokument jest w tym miejscu **warunkowy celowo** — dwie
> odpowiedzi zamieniają go w jednoznaczną rekomendację. Niezależnie od nich
> zostaje warunek techniczny: granica produkcyjna WERTIS do Subiekta nie była
> jeszcze uruchomiona (§8), więc wyłączanie czegokolwiek przed tym testem
> byłoby przedwczesne.

---

## 2. Czym jest każdy z systemów

### Firmes+ Asystent Magazyniera

Dodatek partnerski do Subiekta GT i Subiekta nexo PRO, notowany w katalogu
rozwiązań partnerskich InsERT. Składa się z **aplikacji serwerowej na komputerze
z Subiektem** oraz **aplikacji na urządzeniach mobilnych** (Android), pracujących
w sieci lokalnej po WiFi. Producent podaje zgodność od **Androida 4.1** — czyli
działa również na starszym i tańszym sprzęcie.

Zakres deklarowany przez producenta: kontrola kompletacji zamówień (z pokazaniem
lokalizacji i zdjęć towaru), kontrola zgodności towaru z dokumentami
WZ/PZ/RW/PW/MM, tworzenie tych dokumentów oraz zamówień ZK ze skanowanego towaru,
podgląd i edycja kartotek, zarządzanie lokalizacją (mechanizm oparty o **pola
własne towaru**), inwentaryzacja. Licencja jest pobierana automatycznie z serwera
licencyjnego producenta przy uruchomieniu na nowym podmiocie.

**Z tego zakresu firma nie korzysta z bloku wydań** — kompletacji zamówień ani
tworzenia WZ. Reszta listy pozostaje do potwierdzenia (§1).

### WERTIS

Aplikacja pisana pod ten magazyn: 19 × 18 m, ~3 600 kartotek (z czego ~1 000
aktywnych), 7–8 małych dostaw krajowych tygodniowo i kontener importowy ~4× do
roku.

Architektura: serwer **Fastify + SQLite** na maszynie z Subiektem, **kolejka
i osobny proces workera** do zapisów, klient to **natywna aplikacja Android**
(Kotlin/Compose) ze skanem sprzętowym Zebra/Honeywell. Cała wiedza o Subiekcie
siedzi za dwoma adapterami: odczyt z MSSQL (read-only), zapis przez kolejkę.

Zasada, z której wynika reszta: **WERTIS dokłada Subiektowi brakującą warstwę
magazynową i nic więcej.** Konto SQL aplikacji ma prawo zapisu do dwóch kolumn
kartoteki: pola lokalizacji i podstawowego kodu kreskowego. Najgorsze, co może
zrobić, to wpisać w nie złą wartość. Cofa to jeden `UPDATE`.

---

## 3. Zakres funkcjonalny

Trzy stany: **jest** · **w drodze** (zaplanowane, nie ma tego w kodzie) ·
**—** (nie robimy i nie planujemy).

Kolumna Asystenta rozróżnia **funkcję dostępną** od **funkcji używanej**.
To rozróżnienie jest tu najważniejsze: porównywanie katalogów producentów
odpowiada na pytanie, który program ma dłuższą listę — a nie na pytanie, który
wykonuje pracę wykonywaną w tej firmie.

### Wydania i dokumenty

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Kompletacja zamówień (zbiórka pod ZK) | jest, ale **nieużywane** | **—** |
| Tworzenie WZ ze skanowanego towaru | jest, ale **nieużywane** | **—** |
| Tworzenie PZ / RW / PW / ZK | jest, ale **nieużywane** | **—** |
| Przesunięcia magazynowe (MM) | **jest** | **częściowo** — kolektor zbiera, dokument wystawia biuro |
| Inwentaryzacja (arkusze ze skanu) | **jest** | **w drodze** — planowana |

> Trzy pierwsze wiersze to **cały blok wydań** — i w tej firmie leży on
> odłogiem. Dlatego w porównaniu nie liczy się na korzyść żadnej ze stron.
> Przy dwóch ostatnich wierszach nie wiem, czy są w użyciu; jeśli nie, blok jest
> martwy w całości.

### Przyjęcie i rozkładanie

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Kontrola zgodności towaru z dokumentem przyjęcia | **jest** | **jest** |
| Rozkładanie z obowiązkowym skanem półki jako dowodem odłożenia | brak danych | **jest** |
| Postęp zapisywany per pozycja (przerwanie pracy nic nie kosztuje) | brak danych | **jest** |
| Dostawa zamyka się sama, gdy nie ma czego rozkładać | brak danych | **jest** |
| Kontener importowy: rozkładanie jak każda dostawa + przesunięcie stanu | brak danych | **jest** |

### Wyszukiwanie i kartoteka

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Skan EAN → gdzie leży towar | **jest** | **jest** |
| Skan etykiety regału → co na nim stoi | brak danych | **jest** |
| Towar w wielu lokalizacjach naraz | brak danych | **jest** |
| Zdjęcia towaru na kartotece | **jest** | **jest**, wyłączone do czasu wpisania `ZDJECIA_*` w `wertis.env` |
| Edycja i zakładanie kartotek z kolektora | **jest** | **—** *świadomie: WERTIS nie tworzy danych w Subiekcie* |
| Zamienniki wycięte z opisu kartoteki | brak danych | **jest** |
| Stany skorygowane o operacje czekające w kolejce | brak danych | **jest** |

### Wyjątki, praca zespołowa, audyt

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Niejednoznaczny kod kreskowy **zatrzymuje** operację (nigdy „pierwsze dopasowanie") | brak danych | **jest** |
| Zgłoszenie wyjątku ze zdjęciem dowodowym | brak danych | **jest** |
| Eksport wyjątków do CSV pod reklamację u dostawcy | brak danych | **jest** |
| Logowanie na konto imienne (login i hasło) | logowanie na konto programu | **tak samo** |
| Praca bez sieci z trwałym buforem i dosłaniem po powrocie | brak danych | **jest** |
| Pełny ślad „kto i kiedy" bez retencji | brak danych | **jest** |
| Raport kolizji kodów kreskowych dla biura | brak danych | **jest** |
| Nocna rekoncyliacja (4 kontrole, alert tylko przy rozjeździe) | brak danych | **jest** |
| Raport przeslotowania (co przenieść do strefy złotej) | brak danych | **jest** |
| Kolektor **sam** pobiera nową wersję z serwera w sieci magazynu | brak danych | **jest** |

> **„brak danych" znaczy dokładnie tyle, ile mówi** — materiały producenta tego
> nie opisują, a my tego nie sprawdziliśmy. To nie jest ukryte „nie ma".

Jeden wiersz tej tabeli był do 0.20.0 przewagą i przestał nią być. Logowanie
skanem plakietki zajmowało około sekundy, bez wpisywania czegokolwiek. Firma
woli jeden wzorzec logowania w całym budynku, więc WERTIS zrównał się tu
z Asystentem — świadomie i kosztem tych sekund przy każdej zmianie osoby.

---

## 4. Trzy scenariusze

### Scenariusz A: przyjęcie dostawy krajowej

**Sytuacja.** Przyjeżdża paleta na fakturę FZ z ~20 pozycjami. Trzeba rozłożyć
towar na półki i potwierdzić biuru, że faktura się zgadza.

**Jak jest dziś.** Asystent kontroluje zgodność przyjmowanego towaru
z dokumentem PZ/FZ. Potwierdzenie dla biura, że dostawa została sprawdzona,
odbywa się poza aplikacją.

**Jak w WERTIS.**

1. Magazynier loguje się swoim loginem i hasłem.
2. Wybiera dostawę z listy (widać pasek postępu każdej).
3. Bierze z palety **cokolwiek**, skanuje kod towaru → wiersz na liście rozwija
   się w miejscu z ilością i adresem docelowym.
4. Idzie do regału, skanuje etykietę półki → zapis, wibracja, wiersz zwija się
   jako odłożony.
5. Powtarza. **Dwa skany na pozycję, zero tapnięć.**
6. Gdy nie ma już czego rozkładać, **dostawa zamyka się sama** i schodzi na dół
   listy.

**Co się z tego zmienia.**

- **Kolejność pracy jest dowolna** — lista nie jest kolejką, tylko kontrolą
  kompletności. Bierze się to, co wpadnie w rękę.
- **Skan półki jest jedynym dowodem odłożenia.** Nie da się „zamknąć pozycji
  z pamięci przy biurku" — weryfikacja dzieje się tam, gdzie stoi towar.
- **Przerwanie pracy nic nie kosztuje.** Postęp jest zapisany per pozycja, więc
  po przerwie albo po przejęciu przez kogoś innego nie ma czego powtarzać.
- **Stan dostawy widać na kolektorze, nie w Subiekcie.** Aplikacja nie zapisuje
  do bazy firmy niczego poza lokalizacją, więc biuro pyta o postęp tak samo jak
  dotąd — albo czyta eksport zdarzeń.

### Scenariusz B: znalezienie towaru na półce

**Sytuacja.** Handlowiec pyta, gdzie leży dany towar. Albo odwrotnie: magazynier
stoi przy regale i chce wiedzieć, co powinno na nim być.

**Jak jest dziś.** Asystent informuje o lokalizacji towaru w magazynie; mechanizm
działa na polach własnych kartoteki. Kompletacja pokazuje lokalizację i zdjęcie
towaru.

**Jak w WERTIS.**

- **Skan EAN lub symbolu** → karta towaru: stany na magazynie głównym i w strefie
  przyjęć, lista adresów (pierwszy jest pickingowy), zamienniki wycięte z opisu
  kartoteki.
- **Skan etykiety regału z ekranu głównego** → zawartość tej półki. Nie trzeba
  wcześniej wybierać trybu.
- Towar może mieć **wiele adresów** — przy zapisie aplikacja pyta, czy zastąpić,
  czy dołożyć kolejny.
- **Pusty regał to poprawna odpowiedź**, a nie błąd („Regał A01-02-03 pusty").
- Stany są **skorygowane o operacje czekające w kolejce** — jeśli towar właśnie
  jedzie na inną półkę, widać to jako „⏳ w drodze", zamiast pokazywać stan
  sprzed zmiany.

**Co się z tego zmienia.** Dwie rzeczy, których nie da się zrobić samą kartoteką:
odwrotne pytanie (co leży na tej półce) i informacja, że adres właśnie się
zmienia. Do tego **jedna twarda zasada**: kod, który nie pasuje do wzorca adresu,
adresem **nie jest** — aplikacja nigdy nie „spróbuje mimo wszystko". Nasze
symbole towarów bywają łudząco podobne do adresów regałów (rodzina `B20-40-*`
jest o jeden znak od kształtu adresu), a zapisany widmowy adres to błąd cichy:
nic nie wygląda na zepsute, dopóki ktoś nie pójdzie po ten towar.

### Scenariusz C: wyjątki i praca zespołowa

**Sytuacja.** Karton przyszedł zgnieciony. Kod kreskowy wskazuje dwa różne
towary. Dwie osoby rozkładają tę samą dostawę. W kącie hali nie ma zasięgu.

**Jak jest dziś.** Materiały producenta nie opisują obsługi tych sytuacji.

**Jak w WERTIS.**

| Sytuacja | Co robi aplikacja |
|---|---|
| **Uszkodzony towar** | Zgłoszenie wyjątku z **obowiązkowym zdjęciem**. Bez dowodu nie ma rozmowy z dostawcą, jest tylko wersja. Wyjątki idą do eksportu CSV pod reklamację. |
| **Kod wskazuje dwa towary** | **Operacja staje.** Aplikacja nigdy nie bierze pierwszego dopasowania — pokazuje kandydatów i każe wybrać. Kolizje lądują w raporcie dla biura, żeby dało się je posprzątać w kartotece. |
| **Rozbieżność ilościowa** | Osobny przycisk INNA ILOŚĆ, bo to najczęstszy wyjątek — rozkładanie jest sprawdzaniem faktury. Zgłoszenie niesie ilość zamówioną i faktyczną naraz, więc nikt nie zgaduje, czy „za mało" znaczyło brak, czy niedowóz. |
| **Zeskanowana półka ≠ półka z kartoteki** | Zapis **czeka na decyzję człowieka**: towar przeniesiono czy leży w dwóch miejscach? Serwer tego nie zgadnie. |
| **Dwie osoby na jednej dostawie** | Nikt nikogo nie blokuje. Blokady pozycji wyszły w 0.47.0: przy tej organizacji pracy dostawę rozkłada jedna osoba, a wiszące „zajęte przez" kosztowało więcej niż chroniło. Podwójne odłożenie widać na liście i poprawia je korekta ilości. |
| **Brak zasięgu** | Operacja ląduje w trwałym buforze na urządzeniu i dosyła się po powrocie sieci — z kontem osoby, **która ją wykonała**, a nie tej, która akurat trzyma kolektor. |
| **„Kto to zrobił"** | Każda operacja ma wpis w dzienniku zdarzeń, bez retencji. Logowanie jest kontem imiennym, więc nie ma wariantów tej samej osoby (`Jan`, `jan`, `Jan K`). |

**Co się z tego zmienia.** Wyjątek przestaje być czymś, co się „obchodzi".
Pozycja z wyjątkiem wypada z rutyny, ale **nie blokuje domknięcia dostawy** —
inaczej zgłoszenie problemu karałoby zgłaszającego i nikt by go nie zgłaszał.

---

## 5. Architektura, ryzyko, zależność od dostawcy

|  | Asystent | WERTIS |
|---|---|---|
| Gdzie stoi serwer | maszyna z Subiektem | maszyna z Subiektem |
| Klient | Android (od 4.1) | Android **8.0+** — wymaga nowszego sprzętu |
| Sieć | lokalna WiFi | lokalna WiFi, bez chmury |
| Licencja | roczna, weryfikowana przez serwer licencyjny producenta | brak |
| Wsparcie | producent | **brak — serwis po stronie firmy** |
| Zmiana pod własny proces | przez producenta | własny kod |
| Zapis do Subiekta | tworzy dokumenty magazynowe | **dwa pola kartoteki: lokalizacja i kod kreskowy** |

### Ryzyka po stronie WERTIS — wprost

1. **Granica produkcyjna do Subiekta nie była jeszcze uruchomiona.** Aplikacja
   działa dziś na danych z eksportu. Przed przejściem na prawdziwą bazę trzeba
   ustalić dwie rzeczy na miejscu (opisane w `DEPLOY.md` §6 Etap 1): numery
   magazynów oraz **które z ośmiu pól własnych kartoteki ma trzymać
   lokalizację**. To jest kilka zapytań SQL, ale dopóki nie zostaną wykonane,
   nie ma dowodu, że całość działa na produkcji.
2. **Przesunięcia magazynowe wymagają Sfery.** Kontrakt jest gotowy w kodzie
   (`server/src/adapters/sfera.ts`), ale sam zapis wykonuje osobny proces na
   Windows. Do czasu jego uruchomienia MM wystawia biuro ręcznie.
3. **Brak testów automatycznych na granicy do Subiekta.** Logika jest pokryta
   (650 testów serwera, 200 testów modułu wspólnego kolektora), ale adaptery do
   MSSQL i Sfery weryfikuje dziś tylko przejście ręczne.
4. **Nie ma umowy wsparcia.** Przy Asystencie awarię zgłasza się producentowi.
   Tu nie ma komu.
5. **Sprzęt.** WERTIS wymaga Androida 8.0; Asystent działa od 4.1. Jeśli
   w firmie są starsze kolektory, WERTIS ich nie obsłuży.

### Co przemawia za WERTIS mimo tych ryzyk

Zmiana pod nasz proces kosztuje dzień zamiast kwartału i nie wymaga niczyjej
zgody. Ten dokument powstaje po serii poprawek zgłoszonych z hali — pole adresu
serwera na ekranie startowym, dołożenie drugiej lokalizacji, usunięcie nakładek
zasłaniających adresy, przeniesienie przycisku „wstecz" pod kciuk, przebudowa
rozkładania tak, żeby nie gasiło listy. Każda z nich weszła w dniu zgłoszenia.

---

## 6. Koszty

**Asystent** (publiczny cennik producenta):

| Pozycja | Cena netto |
|---|---|
| Licencja startowa (serwer + terminal mobilny) | 589 zł |
| Licencja startowa z wdrożeniem (pomoc przy instalacji i konfiguracji) | 789 zł |
| Każde kolejne urządzenie mobilne | 389 zł |

Licencja jest roczna.

**WERTIS**: brak opłat licencyjnych. To **nie znaczy „bez kosztu"** — koszt to
sprzęt (kolektory z Androidem 8.0+), czas rozwoju i czas serwisu, który przy
Asystencie kupuje się razem z licencją. Przy jednym czy dwóch urządzeniach różnica
w opłatach jest niewielka; rośnie dopiero przy większej liczbie kolektorów.

**Konkluzja kosztowa.** Sama kwota jest mała i nie o nią tu chodzi. Istotne jest
co innego: **licencja obejmuje cały katalog, a używana jest jego część.** Blok
wydań — kompletacja, WZ, PZ/RW/PW/ZK — jest opłacany i nieużywany.

Nie jest to zarzut wobec Asystenta; tak działa licencjonowanie pakietowe
i w wielu firmach ten blok pracuje. U nas nie. Wniosek praktyczny jest więc
odwrotny niż zwykle przy takim porównaniu: **oszczędność nie jest głównym
argumentem za WERTIS — ale nie jest też argumentem za utrzymaniem Asystenta.**
O jego dalszym losie decyduje wyłącznie to, czy inwentaryzacja i MM są w użyciu
(§1), a nie 589 zł rocznie.

---

## 7. Środowisko dev — jak zobaczyć WERTIS na żywo

### Uruchomienie serwera z danymi demo

```bash
npm install
npm run seed     # 3415 kartotek z eksportu magmat.xlsx
npm run dev      # API :3001 + worker
curl -s http://localhost:3001/api/health
```

Odpowiedź `/api/health` mówi, w jakim trybie stoi system. **W trybie domyślnym
zapis idzie do lokalnej bazy SQLite i nic nie dociera do prawdziwego Subiekta** —
demo jest całkowicie bezpieczne. Można klikać, rozkładać i psuć.

### Co jest w danych demo

Dane pochodzą z realnego eksportu kartotek. Zaseedowanych jest 7 dokumentów,
pokrywających wszystkie ścieżki:

| Co | Do pokazania |
|---|---|
| 4 dostawy krajowe FZ/PZ | ścieżka codzienna: dwa skany na pozycję |
| 1 dostawa **w buforze** Subiekta | dokument nieksięgowany też da się rozłożyć |
| 1 kontener na strefie przyjęć | rozkładanie i przesunięcie stanu na halę |
| 1 zbiorczy dokument zwrotów | rozlicza biuro w Subiekcie |
| pozycje **BEZ LOKALIZACJI** w każdym dokumencie | osobna sekcja, wymaga decyzji człowieka |

### Przydatne przy pokazie

```bash
FORCE_SEED=1 npm run seed      # reset danych demo między pokazami
WORKER_SIM_ERRORS=1 npm run dev # losowe błędy zapisu: czerwona pastylka + PONÓW
```

### Kolektor

APK powstaje w CI, w zadaniu `build`. Są dwa artefakty:
`wertis-kolektor-debug-apk` do pracy nad kodem i `wertis-kolektor-apk`
(podpisany, z gałęzi `main`) na urządzenia. Instalacja pierwszej sztuki:

```bash
adb install -r wertis-kolektor-0.52.0.apk
```

**Kolejnych wersji nie wgrywa się ręcznie.** Plik kładzie na serwerze
instalator, a kolektory proponują go same przy otwarciu aplikacji.

Adres serwera wpisuje się **na ekranie startowym** aplikacji
(`ZMIEŃ ADRES SERWERA`): `http://<IP-serwera-w-LAN>:3001`. Fabrycznie stoi tam
serwer magazynu; na emulatorze trzeba wpisać `http://10.0.2.2:3001`.

Build z własnej maszyny wymaga Android SDK:

```bash
cd android
./gradlew :core:test           # testy logiki — działają BEZ Android SDK
./gradlew :app:assembleDebug   # APK — wymaga SDK
```

### Kontrole jakości

```bash
npm -w server test                    # 650 testów serwera
./android/gradlew -p android :core:test   # 200 testów modułu wspólnego
python3 tools/docs_check.py           # spójność dokumentacji z kodem
python3 tools/kt_imports_check.py     # importy i nawiasy w kodzie kolektora
```

Pełne wdrożenie produkcyjne (usługi Windows, zapora, DNS, kolektory, etapy
przejścia na prawdziwą bazę) opisuje `DEPLOY.md`.

---

## 8. Stan projektu — czego jeszcze nie ma

WERTIS to projekt młody. Uczciwy obraz:

**Gotowe i działające na danych demo:** przyjęcie dostaw krajowych, kontener
importowy, wyszukiwanie i karta towaru, podgląd regału,
wyjątki ze zdjęciami i eksportem CSV, kolejka zapisów z ponawianiem, konta
imienne z hasłem, praca offline, raport kolizji kodów, nocna rekoncyliacja,
raport przeslotowania, notatki biura do dostawy z obowiązkową odpowiedzią,
korekta ilości odłożonej, podgląd biura z zakładką ANALIZA, import zbiórek
z Sellasist z kandydatami do strefy złotej oraz aktualizacja kolektora
z serwera.

**Jest, za przełącznikiem:** przesunięcia magazynowe (MM) — kolektor je zbiera
i kolejkuje, dokument tworzy worker Sfery (`sfera-worker/`); `SFERA_WORKER`
zostaje wyłączony do etapu 2 wdrożenia i do tego czasu dokument wystawia biuro.
**W drodze:** inwentaryzacja — planowana.

**Nie planowane:** kompletacja zamówień i wydania — **bo nie są używane**.
Gdyby firma zaczęła kompletować zamówienia z kolektora, byłaby to decyzja do
podjęcia od nowa, a nie luka do zasypania.

**Do zrobienia przed produkcją:**

1. Ustalenie trzech parametrów na prawdziwej bazie Subiekta (`DEPLOY.md` §6).
2. Uruchomienie procesu zapisującego dokumenty MM przez Sferę.
3. **Formalności przed uruchomieniem raportu wydajności per osoba.** Raport
   istnieje w kodzie, ale jest to **monitoring pracowniczy w rozumieniu art. 22²
   Kodeksu pracy**: wymaga zapisu w regulaminie pracy lub obwieszczeniu,
   **uprzedzenia pracowników na 2 tygodnie przed uruchomieniem** i informacji
   dla nowych osób przed dopuszczeniem do pracy. Kod tego nie blokuje —
   to decyzja i obowiązek pracodawcy. Techniczny audyt „kto zmienił lokalizację"
   to co innego i nie podlega tym wymogom.

**Czego nie pokrywają testy:** tras HTTP, adapterów do Subiekta i całego modułu
aplikacji Android. Weryfikacja tych warstw opiera się dziś na checkliście
przejścia ręcznego na sprzęcie (`android/README.md`).

---

## 9. Sprawa do rozstrzygnięcia: kolizja nazw

Ekran startowy WERTIS podpisuje się **„Asystent magazyniera"** — czyli dokładnie
tak, jak nazywa się produkt Firmes. Ta sama nazwa jest w nagłówku `README.md`
i w nazwie repozytorium.

Dopóki oba systemy mają działać obok siebie, będzie to mylić w każdej rozmowie
(„ale to ten sam program?"). Nazwa produktu należy do właściciela, więc dokument
tylko to zgłasza. Zmiana jest tania: podtytuł na ekranie startowym
(`android/app/src/main/kotlin/pl/wertis/kolektor/ui/splash/SplashScreen.kt`)
i nagłówki dokumentacji.

---

## 10. Źródła

Materiały o Asystencie:

- [Firmes+ Asystent Magazyniera do Subiekt GT](https://www.firmes.pl/oferta/firmes+/asystent-magazyniera) — strona producenta
- [Firmes+ Asystent Magazyniera w katalogu rozwiązań partnerskich InsERT](https://www.insert.com.pl/dla_uzytkownikow/subiekt_gt/dodatki_rozszerzenia/rozwiazania_partnerskie/2001.html)
- [Instrukcja użytkownika, wersja 1.5.9](https://photos.nailpolish.pl/Kolektory/Asystent%20Magazyniera/1.5.9/Firmes+%20Asystent%20Magazyniera%20instrukcja%20obs%C5%82ugi.pdf) (PDF)
- [Asystent magazyniera Subiekt GT/nexo — licencja roczna](https://sklep.multicomp.pl/asystent-magazyniera-subiekt-gtnexo-rok-p-1003.html) — cennik u resellera

Dokumentacja WERTIS:

- `README.md` — realia magazynu, pełna lista funkcji, decyzje projektowe
- `docs/architektura.md` — jak to jest zbudowane i dlaczego tak
- `docs/analiza-rozkladanie.md` — trzy ścieżki rozkładania i backlog
- `DEPLOY.md` — wdrożenie na maszynie z Subiektem, etapy przejścia
- `docs/subiekt-gt-struktura.md` — co dokładnie WERTIS czyta i zapisuje w bazie
