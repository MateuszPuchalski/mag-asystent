# Historia zmian WERTIS

Numer wersji stoi w **jednym miejscu** — polu `version` w `package.json`
w korzeniu repo. Bierze go stamtąd serwer (`/api/health`) i APK
(`android/app/build.gradle.kts` czyta ten plik przy budowaniu i wylicza z niego
`versionCode`). Kolektor pokazuje obie wersje na dole ekranu.

Do sierpnia 2026 numer był wpisany w trzech miejscach z komentarzem „zgodnie
z wersją monorepo" — i właśnie tak przestał być zgodny: `0.3.0` przetrwało
sześć zmergowanych zmian, w tym takie, które wymagały nowego uprawnienia SQL.
Komentarz nie jest mechanizmem.

## Kiedy który człon rośnie

Ta skala mierzy **koszt wdrożenia u klienta**, a nie zgodność API. WERTIS nie ma
publicznego API — jedynym klientem jest własny kolektor. Pytanie, na które numer
ma odpowiadać, brzmi: *„czy przy tej aktualizacji muszę coś zrobić ręką?"*

| człon | kiedy | co to znaczy dla wdrożenia |
|---|---|---|
| **MINOR** (`0.X.0`) | nowa funkcja widoczna dla człowieka **albo** zmiana wymagająca działania przy wdrożeniu | przeczytaj wpis: pozycje **[wymaga działania]** mówią, co zrobić poza `git pull` |
| **PATCH** (`0.3.X`) | poprawka błędu, dokumentacja, refaktor bez śladu na ekranie | `git pull`, `npm ci`, `npm run build`, restart usług — nic więcej |
| **MAJOR** (`1.0.0`) | **dopiero gdy system pracuje na produkcji codziennie** | zostaje `0` do tego czasu; podbicie będzie decyzją właściciela, nie skutkiem ubocznym |

**Nowy APK to zawsze osobna czynność.** `git pull` przestawia serwer od razu,
kolektor czeka na rozesłanie przez MDM — dlatego pasek na dole ekranu pokazuje
obie wersje i podświetla rozjazd. To jest stan przejściowy, nie awaria.

---

## 0.5.0 — 27 lipca 2026

Ekran blokady po bezczynności zniknął. Sesja urządzenia nie wygasa sama.

### Zmiana zachowania

- **Kolektor nie pokazuje już ekranu „Sesja zablokowana".** Do tej pory
  dziesięć minut bez ruchu przełączało go na pełnoekranowy komunikat, a powrót
  do pracy kosztował skan badge'a. Kolektor odłożony na regale na całą przerwę
  wraca dziś do otwartej dostawy bez niczego.
- **Sesja kończy się wyłącznie jawną decyzją** — wylogowaniem z Ustawień albo
  przejęciem pracy cudzym badge'em. Blokada nigdy nie gubiła postępu, więc jej
  jedynym mierzalnym skutkiem był ten skan.
- **Tożsamości pilnuje dalej to, co pilnowało naprawdę:** skan cudzego badge'a
  nie przełącza po cichu — pyta człowieka i zapisuje przejęcie w `events`.

**Nowy APK nie jest do tego potrzebny.** Blokadę zgłaszał serwer, więc starsze
kolektory przestają ją pokazywać zaraz po restarcie usług. APK z tego wydania
usuwa już tylko martwy kod po stronie aplikacji.

### Usunięte

- `POST /api/auth/unlock` — trasa nie ma czego odblokowywać.
- Odpowiedzi `/api/auth/badge` i `/api/auth/me` nie niosą już `blokadaMin`
  ani `zablokowana`.
- Bramka `423 Sesja zablokowana` w `context.ts`. Razem z nią odpadł wyjątek dla
  `x-buffered-user`, który istniał wyłącznie po to, żeby wysyłka z bufora
  offline nie ginęła na zablokowanej sesji. Sam nagłówek **zostaje** — dalej
  rozstrzyga, kto podpisuje operację wykonaną poza zasięgiem.
- Stan `SessionState.Zablokowana` i akcja `BadgeAction.Odblokuj` w `:core`.

`device_session.last_seen` zostaje, ale niczego już nie bramkuje: to jedyny
ślad, kiedy dany kolektor się odezwał, i przydaje się przy pytaniu „to jedno
urządzenie czy wszystkie?".

### Pod spodem

- Testy serwera 223 → 220, testy `:core` 92 → 90. W obu miejscach doszła
  regresja na usunięty TTL: sesja bezczynna od godziny **pisze tak samo jak
  świeża**, a wcześniej dostawała 423.

---

## 0.4.1 — 27 lipca 2026

Dokumentacja przepisana według reguł ASD-STE100 w zakresie, jaki da się
przenieść na polski. PATCH, bo na ekranie nic się nie zmienia — `git pull`,
`npm ci`, `npm run build`, restart usług.

### Nowe

- **[`docs/slownik.md`](docs/slownik.md)** — jedno miejsce z regułami pisania
  dokumentacji i słowniczkiem terminów. Mówi też wprost, których reguł STE
  **nie** stosujemy, bo zależą od angielskiego. Zgodności ze standardem nie
  deklarujemy: poza angielskim nie da się jej spełnić.
- **`tools/styl_check.py`** — mierzy trzy reguły ze słownika: długość zdania
  (20 wyrazów w kroku procedury, 25 w prozie), długość akapitu i odrzucone
  warianty terminów. Bramkuje CI obok `docs_check.py`.

### Poprawione

- **Osiem dokumentów przepisanych.** Instrukcja została krótka i rozkazująca,
  a „dlaczego" zeszło pod nią do osobnych bloków. Najdłuższe zdanie w repo
  spadło z 52 do 25 wyrazów, ostrzeżenia stoją teraz **przed** krokiem, a
  40-pozycyjna checklista smoke-testu ma jedną rzecz do sprawdzenia na pozycję.
- **`README.md` mówił `better-sqlite3`** — moduł natywny zniknął w 0.4.0
  na rzecz wbudowanego `node:sqlite`.
- **`instalator/README.md` mówił o `SELECT` na siedmiu tabelach** — od 0.4.0
  jest ich osiem (`sl_Magazyn`).
- **CI nie uruchamiało się przy zmianie samego `DEPLOY.md`.** `docs_check.py`
  czytał ten plik od zawsze, ale nie było go w `paths` workflow — razem
  z `CHANGELOG.md` i `instalator/README.md`.

Poza zakresem świadomie zostały `docs/architektura.md`,
`docs/porownanie-asystent.md` i ten plik: to uzasadnienia decyzji, a limit
długości zdania wycina z nich dokładnie tę treść, dla której powstały.

---

## 0.4.0 — 27 lipca 2026

Pierwsze wydanie z numerem, który cokolwiek znaczy. Zbiera sześć zmian
zmergowanych po `0.3.0`.

### Wymaga działania

- **[wymaga działania] Nowe uprawnienie SQL: `GRANT SELECT ON dbo.sl_Magazyn`.**
  Bez niego karta towaru pokazuje tylko MAG, MGP i Zwroty, a `/api/health`
  mówi o tym w `problemy`. Aplikacja działa dalej — uruchom ponownie skrypt
  z [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md) §2 albo
  instalator z `-TylkoKonfiguracja`.
- **[wymaga działania] API wymaga sesji.** Skrypty i `curl` uderzające w `/api/*`
  potrzebują teraz nagłówka `x-session` — poza czterema trasami
  (`GET /api/health`, `GET /api/setup`, `POST /api/auth/badge`,
  `POST /api/users` przy pustej bazie).
- **[wymaga działania] Konfiguracja przeniesiona do `wertis.env` na dysku.**
  `AppEnvironmentExtra` w usługach przestało być używane; instalator je kasuje,
  bo zmienne środowiskowe przykrywają plik.
- **[wymaga działania] Node ≥ 22.5.** Serwer używa wbudowanego `node:sqlite`.

### Nowe

- **Wszystkie magazyny na karcie towaru** — sekcja „pozostałe magazyny"
  odpowiada na pytanie „gdzie ten towar jeszcze leży". Biuro może wybrane
  ukryć: Ustawienia → Magazyny (konto biura + PIN). MAG, MGP i Zwroty zostają
  zawsze, bo prowadzą rozkładanie.
- **Instalator Windows** — jeden `.exe` zamiast ~500 linii poleceń: usługi,
  zapora, kreator konfiguracji odpytujący bazę Subiekta i konto SQL
  o uprawnieniach kolumnowych. [`instalator/README.md`](instalator/README.md).
- **Wersje widoczne na dole ekranu** — aplikacji i serwera, z podświetleniem
  rozjazdu.

### Poprawione

- **Bramka sesji na całym API.** Wcześniej sesji wymagały trzy trasy;
  `POST /api/products/:id/location` (zmiana lokalizacji w Subiekcie)
  i `GET /api/wydajnosc` (dane per pracownik) przechodziły bez tokenu,
  podpisując operację nagłówkiem `x-user` albo słowem „anonim".
- **`SQLITE_BUSY` przy dwóch procesach** — `busy_timeout` i `BEGIN IMMEDIATE`.
  Objawem były losowe 500 i zadania w statusie `error`, bez wzorca.
- **Żądanie bez pola `action` dawało 500 zamiast 400** — znalezione przez nowe
  testy tras.
- **Instalator wywracał się przy domyślnym `C:\wertis`** — `New-Item` na
  korzeniu dysku. Do tego brak sprawdzenia kodu wyjścia `git clone`, przez co
  nieudany klon meldował sukces i padał dwa kroki dalej.
- **Zero modułów natywnych** — `better-sqlite3` zastąpione wbudowanym
  `node:sqlite`, więc `npm ci` na Windows nie kompiluje już niczego.
- **Rozjazd trybu API i workera widoczny w `/api/health`** — wcześniej worker
  pracujący na danych demo wyglądał identycznie jak poprawny.

### Pod spodem

- Testy serwera 153 → 223, w tym pierwsze testy tras HTTP (`app.inject()`)
  i kolejki Sfery. Instalator dostał 21 asercji.
- `docs_check.py` pilnuje teraz także katalogu `instalator/` i zgodności wersji.

---

## 0.3.0 i wcześniej

Historia sprzed wprowadzenia tego pliku — patrz `git log` oraz opisy PR-ów.
