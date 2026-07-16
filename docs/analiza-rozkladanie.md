# Analiza flow rozkładania towaru (MGP → MAG)

Analiza modułu ROZKŁADANIE skonfrontowana z realiami pracy magazyniera na kolektorze.
Stan na: lipiec 2026. Problemy P1–P4 zostały naprawione w tym samym PR, w którym powstał ten dokument.

## 1. Jak działa flow (stan obecny)

1. **Lista dokumentów** (`web/src/screens/putaway/Documents.tsx`) — dokumenty FZ/PZ na MGP z ostatnich 14 dni (`GET /api/putaway/documents`), z paskiem postępu istniejącej sesji. Tryb zapasowy: „ROZKŁADAJ CAŁE MGP" (sesja bez dokumentu, ze wszystkich stanów strefy przyjęć).
2. **Sesja** (`server/src/services/putaway.ts` → `createSession`) — pozycje dokumentu agregowane po `tw_id` (różne partie/ceny → jedna pozycja), lokalizacja docelowa = pierwsza lokalizacja z kartoteki (`sgt_towar.lokalizacja`, lista rozdzielana spacją; pierwsza = lokalizacja pickingowa). Pozycje bez lokalizacji → „BRAK LOK", sortowane na końcu.
3. **Wózek** — dotknięcie pozycji bierze ją na wózek (`scanToCart`): domyślna ilość ograniczona do stanu MGP, blokada per pozycja (TTL 30 min) chroni przed konfliktem dwóch osób w jednej sesji. Można dodać towar spoza dokumentu.
4. **Przy regale** (`confirmItem`) — korekta ilości, skan lokalizacji docelowej (w wersji dev symulowany chipami `DEMO_LOCS`), „POTWIERDŹ NA <lok>", opcjonalnie „Inna lok.", „Pomiń" (z powodem), „Zdejmij".
5. **Zatwierdzenie wózka** (`commitCart`) — jedno zadanie **MM** (MGP→MAG, wszystkie pozycje rundy) plus zadania **set_location** dla pozycji, gdzie zeskanowana lokalizacja różni się od pickingowej (nowa lokalizacja trafia na początek listy; pole ucinane do limitu 50 znaków). Zadania idą do `sfera_queue` — nigdy nie piszemy do Subiekta synchronicznie.
6. **Worker** (`server/src/worker/worker.ts`) — wykonuje zadania sekwencyjnie z retry/backoff (3 próby: 5 s / 30 s / 120 s); dokument w buforze → `waiting_for_doc` i ponawianie. Widoki stanów korygowane o MM „w drodze" (`services/stock.ts`).
7. **Zamknięcie sesji** (`closeSession`) — rozliczenie: `closed` albo `closed_with_deviations` (częściowe/pominięte/nietknięte).

### Co jest zrobione dobrze (nie ruszać)

- **Kolejka zapisów do Sfery** z retry/backoff i `waiting_for_doc` — jedyny bezpieczny sposób integracji z Subiektem; kolektor nigdy nie wisi na COM.
- **Korekta stanów o kolejkę** („⏳ w drodze") — magazynier widzi prawdę, nie stan sprzed minuty.
- **Model wózka rundami** — odpowiada realnej pracy: załaduj wózek na MGP → trasa po regałach → zatwierdź → wróć po następną partię.
- **Agregacja po `tw_id`** — magazynier rozkłada towar, nie pozycje księgowe z partii.
- **Blokady pozycji per użytkownik z TTL** — kilka osób może rozkładać jedną dostawę.
- **Towar spoza dokumentu + tryb „całe MGP"** — bo w realu na palecie leży to, co leży, a nie to, co na dokumencie.
- **Skan lokalizacji przy regale jako potwierdzenie** — właściwy moment weryfikacji (a nie „z pamięci" przy biurku).

## 2. Konfrontacja z realiami pracy — problemy krytyczne (naprawione)

### P1. Pozycje częściowe znikały z listy „Do rozłożenia"

Wózek nie mieści całej pozycji, część jest uszkodzona, brakuje miejsca na półce — częściowe rozłożenie to codzienność. Backend to wspierał (status `partial`, pozycja „zostaje na liście"), ale UI wrzucało `partial` do sekcji „Załatwione", skąd nie dało się jej wziąć na wózek ponownie. Reszta pozycji zostawała na MGP na zawsze albo wymagała nowej sesji.

**Naprawa:** `partial` wraca do „Do rozłożenia" z opisem „zostało X z Y" (`web/src/screens/putaway/Session.tsx`). Konsekwencja: sesji nie da się zamknąć z niedokończoną częściówką bez świadomej decyzji (dokończ albo pomiń z powodem) — i tak ma być.

### P2. Brak walidacji ilości po stronie serwera

`confirmItem` przyjmował dowolne `qty` (0, ujemne, ponad stan), a `commitCart` kolejkował MM bez sprawdzenia stanu MGP pomniejszonego o MM „w drodze". W realu oznacza to: literówka w ilości albo dwie osoby rozkładające ten sam towar → MM pada dopiero w workerze po trzech próbach, a pozycje są już odhaczone jako rozłożone. `scanToCart` potrafił też położyć na wózek pozycję z ilością 0 (zerowy stan MGP).

**Naprawa** (`server/src/services/putaway.ts`):
- `confirmItem`: `qty > 0` (400) oraz `qty ≤ stan MGP − MM w drodze` (409, komunikat z dostępną ilością). Limit `qty_expected` pozostaje miękki (tylko UI) — dostawy bywają większe niż dokument.
- `commitCart`: przed kolejką suma z wózka per towar sprawdzana względem dostępnego stanu (409 z symbolem towaru).
- `scanToCart` / `addOffDocument`: przy dostępnym stanie ≤ 0 → błąd „Brak stanu na MGP", zamiast pozycji z ilością 0.
- Wspólny helper `availableMgp()` korzysta z istniejącego `pendingMmByTw()` (`services/stock.ts`) — ta sama logika co w `/api/mm`.

### P3. Cicha rozbieżność przy błędzie MM

`commitCart` odhacza pozycje natychmiast, a MM idzie asynchronicznie. Gdy zadanie kończyło w statusie `error`, sesja twierdziła „rozłożone", stan w Subiekcie się nie przesunął, a magazynier — już przy innym regale — nie miał jak się o tym dowiedzieć (błąd był widoczny tylko na osobnym ekranie Kolejka). Fizyczny towar na półce + brak MM = rozjazd inwentaryzacyjny.

**Naprawa:** zadania kolejki dostały `session_id` (`sfera_queue.session_id`, migracja w `db.ts`, przekazywane z `commitCart`). `getSession` zwraca `queueAlerts` (zadania sesji w błędzie) i `inFlight` (liczba zadań w drodze). Ekran sesji pokazuje czerwony banner „Nie zapisano w Subiekcie" z przyciskiem PONÓW (istniejący `POST /api/queue/:id/retry`) oraz wskaźnik „⏳ N" w nagłówku.

### P4. „ROZKŁADAJ CAŁE MGP" duplikowało sesje

Wznowienie działało tylko dla sesji dokumentowych — każde dotknięcie przycisku all-MGP tworzyło nową sesję z nakładającymi się pozycjami. Blokady pozycji są per sesja, więc dwie osoby w dwóch sesjach all-MGP mogły „rozłożyć" ten sam towar dwa razy → MM ponad stan.

**Naprawa:** `createSession` wznawia otwartą sesję all-MGP (`source_doc_id IS NULL AND status='open'`), tak samo jak dokumentową.

## 3. Backlog — pomysły do dalszych iteracji

Uporządkowane wg tego, jak bardzo bolą w codziennej pracy:

1. **Prawdziwe skanowanie kolektorem w sesji.** Dziś towar bierze się na wózek dotykiem, a lokalizację „skanuje" chipami `DEMO_LOCS`. Na Honeywellu z rękawicami dotyk jest zawodny; skaner (klawiatura-wedge) jest szybszy i bezbłędny. Wzorzec detekcji skanu już istnieje (`web/src/screens/Home.tsx` — szybkość wpisywania + wzorce EAN); potrzebny globalny listener na ekranie sesji: skan EAN → pozycja na wózek, skan kodu lokalizacji → potwierdzenie aktywnej pozycji. To największa pojedyncza wygrana ergonomiczna.
2. **Ilość z klawiatury numerycznej + przycisk „całość".** Stepper +/− nie nadaje się do korekty z 400 na 250. Dotknięcie liczby powinno otwierać numpad.
3. **Rozróżnienie kodu lokalizacji od EAN towaru.** Dziś każdy zeskanowany ciąg może zostać lokalizacją — pomyłkowy skan etykiety towaru utworzy „lokalizację" o nazwie EAN-u i nadpisze pickingową. Walidacja formatu (np. `^[A-Z]\d{2}-\d{2}-\d{2}$|^PALETA\d+$`) albo słownik lokalizacji.
4. **Sortowanie wózka po lokalizacji docelowej.** Lista „Do rozłożenia" jest sortowana po lokalizacji (trasa marszu), ale wózek już nie — pozycje wyświetlają się w kolejności brania. Po załadowaniu wózka magazynier idzie trasą: wózek też powinien być posortowany po `stage_loc`/`target_loc`.
5. **Podpowiedzi dla BRAK LOK.** Towar bez lokalizacji wymaga znalezienia miejsca. Aplikacja może podpowiadać: pozostałe lokalizacje tego towaru, lokalizacje towarów o podobnym symbolu (ta sama grupa asortymentowa) — zamiast zostawiać człowieka z pustą półką w głowie.
6. **Ekspozycja przełącznika `updateLoc`.** Backend umie zatwierdzić rozłożenie bez nadpisywania lokalizacji pickingowej (dorzucenie do lokalizacji dodatkowej), ale UI zawsze wysyła `updateLoc: true`. Częsty przypadek: dokładka na paletę buforową nie powinna zmieniać lokalizacji pickingowej.
7. **Odporność na dziury Wi-Fi.** Każda akcja to żywy REST; w martwej strefie radiowej potwierdzenie przy regale się nie zapisze. PWA ma service workera tylko do cache. Docelowo: bufor akcji sesji po stronie klienta + sync po odzyskaniu łącza; minimum: czytelny stan „offline" i ponowienie zamiast cichego błędu.
8. **Korekta po zatwierdzeniu.** Pomyłkowo zatwierdzonej pozycji nie da się cofnąć (MM już w kolejce). Przycisk „cofnij" = odwrotne MM + przywrócenie pozycji.
9. **Świeżość sesji all-MGP.** Pozycje sesji to snapshot z chwili otwarcia — nowe przyjęcia w trakcie dnia nie dochodzą. Przycisk „odśwież pozycje" dociągający nowe stany MGP do otwartej sesji.
