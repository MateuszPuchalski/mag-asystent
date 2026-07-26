# Analiza rozkładania towaru — trzy ścieżki

Rozkładanie skonfrontowane z realiami pracy magazyniera na kolektorze.
Dokument opisuje **stan po redesignie v2.0 i module zwrotów**; sekcja 4 mówi,
czym to się różni od pierwszej wersji analizy (lipiec 2026), żeby czytelnik
starszych PR-ów wiedział, co zniknęło i dlaczego.

O tym, **którą ścieżką idzie dokument, rozstrzyga magazyn skutku, nie typ
dokumentu** — i kryteria muszą pozostać rozłączne. Ten sam dokument widoczny
w dwóch zakładkach dałoby się rozłożyć dwiema niekompatybilnymi ścieżkami naraz:
raz z przesunięciem stanu, raz bez.

| magazyn skutku | ścieżka | jednostka pracy | skutek magazynowy |
|---|---|---|---|
| `MAG` | dostawa krajowa | dokument FZ/PZ | sam adres (`set_location`) |
| `Zwroty` | zwroty | **koszyk** | adres + jeden MM na domknięty koszyk |
| `MGP` | kontener importowy | sesja z wózkiem | adres + jeden MM na rundę |

## 1. Dostawa krajowa — dokument jako jednostka pracy

`server/src/services/delivery.ts`, ekrany `android/app/…/ui/delivery/`.

1. **Lista dokumentów** (`listDocuments`) — FZ/PZ na MAG z ostatnich 14 dni
   z paskiem postępu liczonym z `delivery_line`. Dokument **w buforze** też jest
   do wzięcia: skutek magazynowy niesie sam dokument w Subiekcie, więc
   rozkładanie nie czeka na księgowość.
2. **Otwarcie** (`openDelivery`) — pozycje snapshotowane w chwili otwarcia
   i agregowane po `tw_id` (różne partie/ceny → jedna linia robocza). Zmiana
   dokumentu przez księgowość w trakcie pracy nie rozjeżdża postępu.
3. **Dwa skany na pozycję** — skan towaru (`resolveScan`) → karta z ilością
   i lokalizacją docelową → skan etykiety regału (`putawayLine`) → zapis.
   Zero dialogu potwierdzającego, zero tapnięć na ścieżce głównej.
4. **Zapis** — wyłącznie zadanie `set_location` do `sfera_queue`. Żadnego MM,
   żadnego `waiting_for_doc`.
5. **Domknięcie** (`closeIfComplete`) — dostawa zamyka się sama, gdy nie ma już
   czego rozkładać.

## 2. Zwroty — koszyk jako jednostka pracy

Ten sam moduł co dostawy, plus `closeBasket`.

Biuro otwiera zwroty karton po kartonie, przyjmuje towar na magazyn Zwroty
**jednym zbiorczym dokumentem** i układa go w **koszyki opisane numerem zwrotu**.
Podziału na koszyki nie ma w żadnym dokumencie — istnieje wyłącznie fizycznie.
Dla aplikacji koszyk to więc grupa linii domkniętych za jednym podejściem,
otagowana numerem (`delivery_line.koszyk`, wpisywanym ręcznie — koszyki nie mają
kodów kreskowych).

Rozkładanie przebiega dokładnie jak przy dostawie. Różnica jest jedna:
**po opróżnieniu koszyka domyka się go przyciskiem i powstaje jeden dokument MM
Zwroty→MAG** na wszystko, co z niego poszło na półki.

**Rozliczenie idzie ilościami** (`ilosc_odlozona − mm_ilosc`), nie statusem
linii. Ten sam towar bywa w dwóch koszykach, bo dokument zbiorczy agreguje go
w jedną linię — flaga „już w MM" gubiłaby resztę. Z arytmetyki wychodzą trzy
rzeczy naraz: dedupe przy ponownym domknięciu koszyka, poprawne dzielenie linii
między koszyki oraz to, że sztuki odłożone z pozycji zgłoszonej potem jako
uszkodzona i tak jadą na MAG — leżą już na półce.

## 3. Kontener importowy — sesja z wózkiem

`server/src/services/putaway.ts`, ekrany `android/app/…/ui/putaway/`.

Kontener przychodzi ~4× w roku: 1000 kartonów, wiele kursów wózkiem. **To jedyny
proces, który potrzebuje modelu sesji zamiast dokumentu.**

1. **Sesja** (`createSession`) — pozycje agregowane po `tw_id`, lokalizacja
   docelowa = pickingowa z kartoteki, `BRAK LOK` sortowane na końcu.
2. **Wózek** (`scanToCart`) — domyślna ilość ograniczona do stanu MGP
   pomniejszonego o MM „w drodze"; blokada per pozycja (TTL 30 min); można
   dodać towar spoza dokumentu.
3. **Przy regale** (`confirmItem`) — korekta ilości i skan lokalizacji docelowej.
4. **Zatwierdzenie wózka** (`commitCart`) — zadania `set_location` z tej rundy,
   a **na końcu** jeden dokument MM MGP→MAG (patrz niezmiennik niżej).
5. **Zamknięcie sesji** (`closeSession`) — `closed` albo
   `closed_with_deviations` (częściowe / pominięte / nietknięte).

Pusta strefa źródłowa to **błąd**, a nie cicha zmiana trybu: przypadek „towar
leży już na MAG, brakuje mu adresu" obsługuje ścieżka dostaw i dublowanie go
tutaj kosztowało więcej, niż dawało.

## Co działa dobrze — nie ruszać

- **Kolejka zapisów z retry/backoff i `waiting_for_doc`** — jedyny bezpieczny
  sposób integracji z Subiektem; kolektor nigdy nie wisi na COM.
- **Niezmiennik „adres zawsze przed sprzedawalnością".** MM czyni towar
  sprzedawalnym, a worker bierze zadania po `id` rosnąco — więc `set_location`
  MUSI trafić do kolejki wcześniej. Odwrotna kolejność dawała okno, w którym
  towar jest już do sprzedania, a jego adres stary albo pusty; przy nieudanym
  zapisie lokalizacji ten stan był **trwały**. Po odwróceniu najgorszy możliwy
  stan leży po bezpiecznej stronie: towar na półce z poprawnym adresem, jeszcze
  niesprzedawalny, i naprawia się sam po PONÓW.
- **Korekta stanów o kolejkę** („⏳ w drodze") — magazynier widzi prawdę, nie
  stan sprzed minuty.
- **Skan lokalizacji jako dowód.** Jedyne potwierdzenie, że towar trafił tam,
  gdzie system myśli — i właściwy moment weryfikacji, nie „z pamięci" przy biurku.
- **Twarda walidacja adresu.** Kod spoza wzorca (regał `A00-00-00`, paleta
  `PAL-000`) to błąd, nigdy cichy zapis. Bez tego pomyłkowy skan etykiety towaru
  zakładał „lokalizację" o nazwie EAN-u i nadpisywał pickingową.
- **Niejednoznaczny kod kreskowy zatrzymuje operację.** Aplikacja nigdy nie
  bierze „pierwszego dopasowania"; jedyne automatyczne zawężenie to dokładnie
  jeden kandydat obecny w otwartym dokumencie. Kolizje lądują w raporcie dla
  biura — aplikacja mierzy jakość danych, zamiast tylko na niej cierpieć.
- **Flaga sprawdzenia faktury jako jedyna prawda o stanie dostawy.** Rozkładanie
  JEST sprawdzaniem faktury, więc stan nie jest trzymany drugi raz — jest
  wyprowadzany i rzutowany do Subiekta. Magazyn i biuro patrzą na to samo.
- **Wyjątki jako obiekt pierwszej klasy** ze zdjęciem dowodowym. Pozycja
  z wyjątkiem wypada z rutyny, ale nie blokuje domknięcia dostawy — inaczej
  zgłoszenie problemu karałoby zgłaszającego i nikt by go nie zgłaszał.
- **Blokady pozycji per użytkownik z TTL** — przy natłoku jedną dostawę rozkłada
  kilka osób; druga osoba dowiaduje się, kto trzyma linię, zamiast odkładać ten
  sam towar drugi raz.
- **Agregacja po `tw_id`** — magazynier rozkłada towar, nie pozycje księgowe
  z partii.
- **Towar spoza dokumentu** (tryb B) — bo na palecie leży to, co leży, a nie to,
  co na dokumencie.

## 4. Czym to się różni od pierwszej analizy (lipiec 2026)

Tamta wersja opisywała jeden proces (MGP→MAG, sesja z wózkiem) w kliencie PWA.
Zniknęły od tego czasu:

- **klient PWA** — zastąpiony natywnym kolektorem Android, a jego kod usunięty
  z repo; `web/public/` to dziś tylko statyczna strona `/lookup` dla biura,
- **tryb „ROZKŁADAJ CAŁE MGP"** — sesja bez dokumentu; jednostką pracy jest
  dokument, a strefa przyjęć przestała być workiem bez ewidencji,
- **`POST /api/mm`** (MM ad-hoc z karty towaru) — nieużywane, wycięte,
- **ścieżka „tylko lokalizacja"** w trybie B — pusta strefa źródłowa jest dziś
  błędem,
- **strefa źródłowa w trybie B** — zwroty przeszły do ścieżki dokumentowej,
  więc tryb B ma już tylko MGP.

Problemy P1–P4 z tamtej analizy są naprawione, a większość backlogu wykonana:
skanowanie sprzętowe (Zebra/Honeywell) zastąpiło dotyk i chipy `DEMO_LOCS`;
rozróżnienie kodu lokalizacji od EAN-u to dziś twarda walidacja; przełącznik
„zamień / dodaj lokalizację" jest wystawiony jako decyzja człowieka przy
rozjeździe półek; odporność na dziury Wi-Fi daje trwały bufor offline (Room).

## 5. Backlog — co nadal boli

> **Przeslotowanie ma już narzędzie.** `npm run reslot` (opis w README i DEPLOY §7)
> liczy pion, nie odległość: przy 342 m² przejście róg–róg to ~20 s, a pobranie
> z drabiny albo z podłogi 10–25 s wobec ~3 s ze strefy złotej. Klasyczny
> argument za slottingiem ABC „po alejkach" tu się nie broni liczbowo.


1. **Podpowiedzi dla BRAK LOK.** Towar bez lokalizacji wymaga znalezienia
   miejsca. Aplikacja może podpowiadać pozostałe lokalizacje tego towaru albo
   lokalizacje towarów o podobnym symbolu — zamiast zostawiać człowieka z pustą
   półką w głowie.
2. **Korekta po zatwierdzeniu MM.** Pomyłkowej lokalizacji nie trzeba cofać —
   wystarczy zeskanować właściwą półkę (dlatego mechanizm COFNIJ i jego karencja
   zostały usunięte). Ale pomyłkowo domkniętego koszyka ani zatwierdzonego wózka
   odkręcić się nie da — to wymagałoby odwrotnego MM.
3. **Świeżość snapshotu.** Pozycje dostawy i sesji to snapshot z chwili
   otwarcia; korekta dokumentu przez księgowość w trakcie pracy nie dochodzi.
   Świadomy kompromis (postęp się nie rozjeżdża), ale przydałby się sygnał
   „dokument zmieniony od otwarcia".
4. **Dług danych w kartotece — większy, niż się wydawało.** Audyt z 2026-07-26
   naliczył **93 kody adresowe w 158 kartotekach**, których walidator nie
   przyjmuje. Wcześniejszy zapis („około 16 literówek") mylił się nie tylko co do
   skali, ale i co do rodzaju: większość to nie pomyłki, lecz **trzy martwe
   konwencje** (`PALETA22`, `PAL38II`, `KT1`), a literówek jest 21. Żadna z tych
   konwencji nie jest już używana, więc odrzucanie ich jest poprawne — do
   poprawienia po stronie Subiekta, nie aplikacji. Lista:
   [`adresy-do-poprawy.md`](adresy-do-poprawy.md).
5. **Dokumenty MM czekają na workera Sfery.** Do czasu uruchomienia procesu COM
   (etap 2 w [DEPLOY.md](../DEPLOY.md)) MM z wózka i z koszyka wystawia biuro
   ręcznie. Otwarte pytanie: czy wystarczy **import EPP/EDI++**, który obsługuje
   MM bez licencji Sfery — jeden test na instalacji 1.87 SP3 HF1 to rozstrzyga.
