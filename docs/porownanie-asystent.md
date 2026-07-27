# WERTIS a Firmes+ Asystent Magazyniera — materiał do decyzji

Dokument dla właściciela. Odpowiada na jedno pytanie: **zostajemy przy
Asystencie, wdrażamy WERTIS, czy trzymamy oba.**

> **Jak czytać ten dokument.** Opis Asystenta pochodzi z materiałów producenta
> i InsERT (linki w §10), **nie z testu porównawczego na naszym magazynie**.
> Nie mierzyliśmy obu systemów na tej samej dostawie. Tam, gdzie praktyka
> rozmija się z materiałami producenta, rację ma praktyka — i proszę o korektę.
> Wszystkie liczby po stronie WERTIS pochodzą z uruchomionego kodu.

---

## 1. Streszczenie decyzyjne

**Co jest dziś.** Asystent obsługuje kompletację zamówień, tworzenie dokumentów
magazynowych (WZ, PZ, RW, PW, MM), zamówienia ZK i inwentaryzację. Lokalizację
towaru trzyma w polach własnych kartoteki.

**Co proponujemy.** WERTIS przejmuje **przyjęcie dostawy i wyszukiwanie towaru** —
dwie ścieżki, które w naszej firmie są codzienne i na których rozkładanie jest
zarazem sprawdzaniem faktury. WERTIS zapisuje do Subiekta **wyłącznie dwie
rzeczy**: pole lokalizacji na kartotece i flagę sprawdzenia na fakturze. Zero
tworzenia dokumentów, zero modyfikacji stanów.

**Czego to nie zastępuje.** **Kompletacji zamówień i wydań (WZ) — to zostaje
przy Asystencie i nie planujemy tego przejmować.** Przesunięcia magazynowe (MM)
i inwentaryzacja są w WERTIS zaplanowane, ale dziś ich nie ma.

**Ile to kosztuje.** Asystent: 589 zł netto licencja startowa, 389 zł netto za
każde kolejne urządzenie, licencja roczna. WERTIS: brak opłat licencyjnych, ale
**cały serwis jest po stronie firmy** — nie ma umowy wsparcia ani producenta,
do którego można zadzwonić.

### Rekomendacja

**Oba systemy równolegle, z jasnym podziałem: WERTIS na przyjęciu, Asystent na
wydaniu.** Nie jest to stan przejściowy ani kompromis — to podział, który
wynika z tego, gdzie każdy z systemów jest mocny. Oba zapisują lokalizację
w to samo pole kartoteki, więc **nie rozjadą się na danych**.

Decyzja o rezygnacji z Asystenta byłaby przedwczesna do czasu, aż WERTIS ma
przesunięcia magazynowe i inwentaryzację, a granica produkcyjna do Subiekta
przejdzie test na prawdziwej bazie (§8).

---

## 2. Czym jest każdy z systemów

### Firmes+ Asystent Magazyniera

Dodatek partnerski do Subiekta GT i Subiekta nexo PRO, notowany w katalogu
rozwiązań partnerskich InsERT. Składa się z **aplikacji serwerowej na komputerze
z Subiektem** oraz **aplikacji na urządzeniach mobilnych** (Android), pracujących
w sieci lokalnej po WiFi. Producent podaje zgodność od **Androida 4.1** — czyli
działa również na starszym i tańszym sprzęcie.

Zakres: kontrola kompletacji zamówień (z pokazaniem lokalizacji i zdjęć towaru),
kontrola zgodności towaru z dokumentami WZ/PZ/RW/PW/MM, tworzenie tych
dokumentów oraz zamówień ZK ze skanowanego towaru, podgląd i edycja kartotek,
zarządzanie lokalizacją (mechanizm oparty o **pola własne towaru**),
inwentaryzacja. Licencja jest pobierana automatycznie z serwera licencyjnego
producenta przy uruchomieniu na nowym podmiocie.

### WERTIS

Aplikacja pisana pod ten magazyn: 19 × 18 m, ~3 600 kartotek (z czego ~1 000
aktywnych), 7–8 małych dostaw krajowych tygodniowo i kontener importowy ~4× do
roku.

Architektura: serwer **Fastify + SQLite** na maszynie z Subiektem, **kolejka
i osobny proces workera** do zapisów, klient to **natywna aplikacja Android**
(Kotlin/Compose) ze skanem sprzętowym Zebra/Honeywell. Cała wiedza o Subiekcie
siedzi za dwoma adapterami: odczyt z MSSQL (read-only), zapis przez kolejkę.

Zasada, z której wynika reszta: **WERTIS dokłada Subiektowi jedną brakującą
warstwę — lokalizację — i nic więcej.** Najgorsze, co może zrobić, to wpisać zły
adres w polu tekstowym albo złą flagę. Obie rzeczy cofa jeden `UPDATE`.

---

## 3. Zakres funkcjonalny

Trzy stany: **jest** · **w drodze** (zaplanowane, nie ma tego w kodzie) ·
**—** (nie robimy i nie planujemy).

### Wydania i dokumenty

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Kompletacja zamówień (zbiórka pod ZK) | **jest** | **—** *zostaje przy Asystencie* |
| Tworzenie WZ ze skanowanego towaru | **jest** | **—** *zostaje przy Asystencie* |
| Tworzenie PZ / RW / PW / ZK | **jest** | **—** |
| Przesunięcia magazynowe (MM) | **jest** | **w drodze** — kolejne w kolejce |
| Inwentaryzacja (arkusze ze skanu) | **jest** | **w drodze** — planowana |

### Przyjęcie i rozkładanie

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Kontrola zgodności towaru z dokumentem przyjęcia | **jest** | **jest** |
| Rozkładanie z obowiązkowym skanem półki jako dowodem odłożenia | brak danych | **jest** |
| Postęp zapisywany per pozycja (przerwanie pracy nic nie kosztuje) | brak danych | **jest** |
| Dostawa zamyka się sama, gdy nie ma czego rozkładać | brak danych | **jest** |
| Flaga sprawdzenia faktury wracająca do Subiekta | brak danych | **jest** |
| Zwroty w koszykach + jedno MM per opróżniony koszyk | brak danych | **w drodze** (samo MM) |
| Kontener importowy: sesja z wózkiem, wiele pozycji na rundę | brak danych | **jest** |

### Wyszukiwanie i kartoteka

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Skan EAN → gdzie leży towar | **jest** | **jest** |
| Skan etykiety regału → co na nim stoi | brak danych | **jest** |
| Towar w wielu lokalizacjach naraz | brak danych | **jest** |
| Zdjęcia towaru na kartotece | **jest** | **—** |
| Edycja i zakładanie kartotek z kolektora | **jest** | **—** *świadomie: WERTIS nie tworzy danych w Subiekcie* |
| Zamienniki wycięte z opisu kartoteki | brak danych | **jest** |
| Stany skorygowane o operacje czekające w kolejce | brak danych | **jest** |

### Wyjątki, praca zespołowa, audyt

| Funkcja | Asystent | WERTIS |
|---|---|---|
| Niejednoznaczny kod kreskowy **zatrzymuje** operację (nigdy „pierwsze dopasowanie") | brak danych | **jest** |
| Zgłoszenie wyjątku ze zdjęciem dowodowym | brak danych | **jest** |
| Eksport wyjątków do CSV pod reklamację u dostawcy | brak danych | **jest** |
| Blokada pozycji między osobami (30 min) + przejęcie na PIN | brak danych | **jest** |
| Logowanie skanem plakietki (bez hasła, ~1 s) | logowanie na konto programu | **jest** |
| Praca bez sieci z trwałym buforem i dosłaniem po powrocie | brak danych | **jest** |
| Pełny ślad „kto i kiedy" bez retencji | brak danych | **jest** |
| Raport kolizji kodów kreskowych dla biura | brak danych | **jest** |
| Nocna rekoncyliacja (4 kontrole, alert tylko przy rozjeździe) | brak danych | **jest** |
| Raport przeslotowania (co przenieść do strefy złotej) | brak danych | **jest** |

> **„brak danych" znaczy dokładnie tyle, ile mówi** — materiały producenta tego
> nie opisują, a my tego nie sprawdziliśmy. To nie jest ukryte „nie ma".

---

## 4. Trzy scenariusze

### Scenariusz A: przyjęcie dostawy krajowej

**Sytuacja.** Przyjeżdża paleta na fakturę FZ z ~20 pozycjami. Trzeba rozłożyć
towar na półki i potwierdzić biuru, że faktura się zgadza.

**Jak jest dziś.** Asystent kontroluje zgodność przyjmowanego towaru
z dokumentem PZ/FZ. Potwierdzenie dla biura, że dostawa została sprawdzona,
odbywa się poza aplikacją.

**Jak w WERTIS.**

1. Magazynier skanuje plakietkę — jest zalogowany (~1 s, bez hasła).
2. Wybiera dostawę z listy (widać pasek postępu każdej).
3. Bierze z palety **cokolwiek**, skanuje kod towaru → wiersz na liście rozwija
   się w miejscu z ilością i adresem docelowym.
4. Idzie do regału, skanuje etykietę półki → zapis, wibracja, wiersz zwija się
   jako odłożony.
5. Powtarza. **Dwa skany na pozycję, zero tapnięć.**
6. Gdy nie ma już czego rozkładać, **dostawa zamyka się sama**, a do Subiekta
   wraca flaga *Sprawdzone* (albo *Sprawdzone z błędami*, jeśli była rozbieżność
   ilościowa).

**Co się z tego zmienia.**

- **Kolejność pracy jest dowolna** — lista nie jest kolejką, tylko kontrolą
  kompletności. Bierze się to, co wpadnie w rękę.
- **Skan półki jest jedynym dowodem odłożenia.** Nie da się „zamknąć pozycji
  z pamięci przy biurku" — weryfikacja dzieje się tam, gdzie stoi towar.
- **Przerwanie pracy nic nie kosztuje.** Postęp jest zapisany per pozycja, więc
  po przerwie albo po przejęciu przez kogoś innego nie ma czego powtarzać.
- **Biuro przestaje pytać magazyn o stan dostawy** — widzi flagę na fakturze
  w Subiekcie. Nadpisanie flagi przez biuro wygrywa; aplikacja nie trzyma
  własnej, drugiej prawdy obok stanu z Subiekta.

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
| **Rozbieżność ilościowa** | Osobny przycisk INNA ILOŚĆ, bo to najczęstszy wyjątek — rozkładanie jest sprawdzaniem faktury. |
| **Zeskanowana półka ≠ półka z kartoteki** | Zapis **czeka na decyzję człowieka**: towar przeniesiono czy leży w dwóch miejscach? Serwer tego nie zgadnie. |
| **Dwie osoby na jednej dostawie** | Pozycja jest blokowana na czas rozkładania (30 min). Kolega dostaje „pozycję rozkłada Jan" i idzie dalej. Odebranie jest możliwe, ale wymaga **PIN-u** i zostaje w historii. |
| **Brak zasięgu** | Operacja ląduje w trwałym buforze na urządzeniu i dosyła się po powrocie sieci — z kontem osoby, **która ją wykonała**, a nie tej, która akurat trzyma kolektor. |
| **„Kto to zrobił"** | Każda operacja ma wpis w dzienniku zdarzeń, bez retencji. Logowanie jest skanem plakietki, więc nie ma wariantów tej samej osoby (`Jan`, `jan`, `Jan K`). |

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
| Zapis do Subiekta | tworzy dokumenty magazynowe | **wyłącznie pole lokalizacji + flaga faktury** |

### Ryzyka po stronie WERTIS — wprost

1. **Granica produkcyjna do Subiekta nie była jeszcze uruchomiona.** Aplikacja
   działa dziś na danych z eksportu. Przed przejściem na prawdziwą bazę trzeba
   ustalić trzy rzeczy na miejscu (opisane w `DEPLOY.md` §6 Etap 1): numery
   magazynów, **które z ośmiu pól własnych kartoteki ma trzymać lokalizację**,
   oraz gdzie w bazie siedzą flagi faktur. To jest kilka zapytań SQL, ale
   dopóki nie zostaną wykonane, nie ma dowodu, że całość działa na produkcji.
2. **Przesunięcia magazynowe wymagają Sfery.** Kontrakt jest gotowy w kodzie
   (`server/src/adapters/sfera.ts`), ale sam zapis wykonuje osobny proces na
   Windows. Do czasu jego uruchomienia MM wystawia biuro ręcznie.
3. **Brak testów automatycznych na granicy do Subiekta.** Logika jest pokryta
   (153 testy serwera, 92 testy modułu wspólnego kolektora), ale adaptery do
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

**Uczciwa konkluzja kosztowa:** przy obecnej skali licencja Asystenta nie jest
pozycją, dla której warto go porzucać. Argumentem za WERTIS jest dopasowanie do
procesu, nie oszczędność.

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
| 1 kontener na strefie przyjęć | tryb wózka: wiele pozycji na rundę |
| 1 zbiorczy dokument zwrotów | koszyki zwrotów |
| pozycje **BEZ LOKALIZACJI** w każdym dokumencie | osobna sekcja, wymaga decyzji człowieka |

### Przydatne przy pokazie

```bash
FORCE_SEED=1 npm run seed      # reset danych demo między pokazami
WORKER_SIM_ERRORS=1 npm run dev # losowe błędy zapisu: czerwona pastylka + PONÓW
```

### Kolektor

APK powstaje w CI — artefakt `wertis-kolektor-debug-apk` w zakładce Actions,
w zadaniu `build`. Instalacja:

```bash
adb install -r app-debug.apk
```

Adres serwera wpisuje się **na ekranie startowym** aplikacji
(`ZMIEŃ ADRES SERWERA`): `http://<IP-serwera-w-LAN>:3001`. Na emulatorze
domyślne `http://10.0.2.2:3001` działa bez zmian.

Build z własnej maszyny wymaga Android SDK:

```bash
cd android
./gradlew :core:test           # testy logiki — działają BEZ Android SDK
./gradlew :app:assembleDebug   # APK — wymaga SDK
```

### Kontrole jakości

```bash
npm -w server test                    # 153 testy serwera
./android/gradlew -p android :core:test   # 92 testy modułu wspólnego
python3 tools/docs_check.py           # spójność dokumentacji z kodem
python3 tools/kt_imports_check.py     # importy i nawiasy w kodzie kolektora
```

Pełne wdrożenie produkcyjne (usługi Windows, zapora, DNS, kolektory, etapy
przejścia na prawdziwą bazę) opisuje `DEPLOY.md`.

---

## 8. Stan projektu — czego jeszcze nie ma

WERTIS to projekt młody. Uczciwy obraz:

**Gotowe i działające na danych demo:** przyjęcie dostaw krajowych, zwroty
w koszykach, kontener importowy, wyszukiwanie i karta towaru, podgląd regału,
wyjątki ze zdjęciami i eksportem CSV, kolejka zapisów z ponawianiem, logowanie
plakietką i blokada sesji, praca offline, raport kolizji kodów, nocna
rekoncyliacja, raport przeslotowania.

**W drodze:** przesunięcia magazynowe (MM) — kolejne w kolejce, kontrakt gotowy;
inwentaryzacja — planowana.

**Nie planowane:** kompletacja zamówień i wydania.

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
