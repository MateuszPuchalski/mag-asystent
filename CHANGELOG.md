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
