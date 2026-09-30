# WERTIS · asystent magazynu i biura

WERTIS to asystent magazynowo-biurowy firmy ogrodniczej pracującej na
**Subiekcie GT**. Subiekt wie, ile towaru jest na magazynie, ale nie wie, gdzie
on leży. WERTIS dokłada tę warstwę: magazynier skanuje towar i półkę
kolektorem, a adres trafia do kartoteki. Biuro ma w jednym panelu dostawy,
wyjątki, zwroty, kosze i obsługę klienta Allegro. Do Subiekta aplikacja pisze
wąsko i przez kolejkę. Granice i ich powody opisuje
[`docs/architektura.md`](docs/architektura.md) §1.

## Realia magazynu — liczby, które rozstrzygają decyzje projektowe

| Fakt | Wartość |
|---|---|
| kartoteki ogółem / **aktywne** | ~3 600 / **~1 000** |
| powierzchnia | 19 × 18 m ≈ **342 m²**, przekątna ~26 m |
| dostawy krajowe | 7–8 małych tygodniowo (kontener importowy ~4×/rok) |
| format adresu regału | `A01-02-03` — litera + trzy pola po dwie cyfry, **2 myślniki** |
| format symbolu towaru | `W32-0203`, `50-111` — **0–1 myślnik**, bywa bez litery |

Dwie rzeczy z tej tabeli zmieniają projekt, a nie tylko go opisują:

- **Formaty adresu i symbolu są rozłączne po liczbie myślników.** To jedyny
  pewny dyskryminator, więc rozpoznawanie skanu opiera się na wzorcu, a nie na
  heurystyce. Szczegóły: [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md).
- **Przy 342 m² optymalizacja drogi poziomej nie ma sensu ekonomicznego.**
  Przejście róg–róg to ~20 s. Realny koszt siedzi w pionie (drabina,
  schylanie) i w ~2 600 martwych kartotekach zajmujących dobre miejsca.

Strefa przyjęć nazywa się **MGP**.

## Składniki

| składnik | co robi | opis |
|---|---|---|
| Serwer (`server/`) | Fastify 5, TypeScript, SQLite (`node:sqlite`): API, kolejka zapisów, worker, takty w tle | [`docs/architektura.md`](docs/architektura.md) |
| Panel (`panel/`) | React i Vite pod `/obsluga`: całe biuro, magazyn i obsługa klienta | [`panel/CLAUDE.md`](panel/CLAUDE.md), [`docs/obsluga-klienta.md`](docs/obsluga-klienta.md) |
| Kolektor (`android/`) | Kotlin i Compose, skan sprzętowy Zebra/Honeywell, bufor offline | [`android/README.md`](android/README.md) |
| Worker Sfery (`sfera-worker/`) | C#/.NET 8: dokumenty w Subiekcie przez COM Sfery, opcjonalny | [`sfera-worker/README.md`](sfera-worker/README.md) |
| Usługa tła (`tlo-worker/`) | C#/.NET 8, ONNX: zdjęcie kartoteki bez tła, opcjonalna | [`tlo-worker/README.md`](tlo-worker/README.md) |
| Instalator (`instalator/`) | PowerShell: instalacja i aktualizacja serwera na Windows | [`instalator/README.md`](instalator/README.md) |

`/` i `/biuro` przekierowują do `/obsluga/`. Operacje magazynowe wykonuje się
wyłącznie na kolektorze. Kolorystyka WERTIS: amber `#F7A600`, grafit `#2A2A2C`,
papier `#F6F5F2`.

## Uruchomienie lokalne

```bash
npm ci                     # W KORZENIU repo — panel/ i server/ to workspace'y npm
npm run seed               # SQLite z server/seed/products.json (raz; FORCE_SEED=1 nadpisuje)
npm run seed:scenariusze   # opcjonalnie: przypadki brzegowe do przeklikania
npm run dev                # api :3001 + worker + panel (Vite :5174, proxy /api na :3001)
```

Sprawdzenie: `http://localhost:3001/api/health`. Panel w trybie dev stoi pod
`http://localhost:5174/obsluga/`. Sam front uruchamia `npm run dev:panel`.
`npm run build` wkłada gotowy panel do `dist/web/obsluga`, skąd serwuje go
proces API.

**Nie uruchamiaj `npm ci` w `panel/` ani w `server/`.** Kasuje wspólne
`node_modules`, a testy serwera pokazują potem setki awarii, których nie ma.

`npm run dev` odpala worker razem z API, bo API wyłącznie kolejkuje zapisy. Bez
workera chip lokalizacji zostaje „w drodze” bez końca. `/api/health` mówi to
wprost: `"ok":false` i zdanie o workerze.

To jest **tryb `seeded`**: dane demo z eksportu `magmat.xlsx`, zero kontaktu
z Subiektem i zero zmiennych do ustawienia. Połączenie z prawdziwą bazą włącza
`SGT_MODE=mssql` wraz z resztą `MSSQL_*` w pliku `wertis.env`
([`DEPLOY.md`](DEPLOY.md) §2a).

Kolektor: build APK w [`android/`](android/README.md) albo artefakt z CI. Adres
fabryczny wskazuje serwer magazynu. Na emulatorze wpisz `http://10.0.2.2:3001`.

### Konto

**W trybie `seeded` konto jest od razu.** Start API na pustej bazie zakłada
konto demo: login `admin`, hasło `admin`. Powstaje wyłącznie przy
`SGT_MODE=seeded` i wyłącznie w bazie bez konta z loginem. Ogrodzeniem jest
tryb, nie hasło, więc na produkcji to konto nie powstaje nigdy.

Inne hasło w demo ustawia `npm run seed` przez `ADMIN_HASLO`. Bez zmiennej
seed losuje hasło i wypisuje je raz. `ADMIN_HASLO` czyta wyłącznie skrypt
seeda, nigdy serwer. Drugi przebieg konta nie dubluje i nie rusza hasła.

Na pustej bazie pierwsze konto da się też założyć bez sesji, z panelu albo
z kreatora na kolektorze. Rola `admin` jest wtedy wymuszona, a furtka zamyka
się po pierwszym koncie z loginem. Procedura z `curl`: [`DEPLOY.md`](DEPLOY.md) §5a.

**API wymaga nagłówka `x-session`** na każdej trasie poza sześcioma:
`GET /api/health`, `GET /api/setup`, `POST /api/auth/login`, `POST /api/users`
przy pustej bazie oraz `GET /api/aktualizacja` i `/api/aktualizacja/apk`.
Kolektor pyta o nową wersję przy otwarciu aplikacji, także bez sesji. Token
bierze się tak samo jak kolektor:

```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'content-type: application/json' -d '{"login":"admin","haslo":"admin"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s http://localhost:3001/api/queue -H "x-session: $TOKEN"
```

### Parametry dev

| Zmienna | Znaczenie |
|---|---|
| `SGT_MODE` | `seeded` (domyślnie) lub `mssql` (prawdziwa baza Subiekta) |
| `WORKER_SIM_ERRORS=1` | losowe błędy zapisu (test ścieżki `error` + PONÓW); przy `mssql` serwer odmawia startu |
| `FORCE_SEED=1` | przeładowuje kartotekę, ale czyści **tylko** tabele `sgt_*`. Pełny reset to usunięcie `server/data/wertis.db` |
| `LOC_FIELD_LIMIT` | limit pola lokalizacji (domyślnie 50) |
| `LOC_FORMAT_STANDARD` / `LOC_FORMAT_PALLET` | wzorce adresu — jedno źródło, kolektor pobiera je z `/api/locations` |
| `LOC_STRICT=0` | wyłącza twarde egzekwowanie wzorca poza rozkładaniem (domyślnie włączone) |
| `MAG_ID_MAG` / `MAG_ID_MGP` / `MAG_ID_ZWROTY` | id magazynów w Subiekcie; MAG i MGP rozstrzygają, co zostaje po rozłożeniu |

## Dane testowe

`server/seed/products.json` powstaje z eksportu `magmat.xlsx` przez
`tools/convert_xlsx.py`, który rozpoznaje kolumny po nazwie. Eksport niesie
prawdziwe kolumny `Stan` (MAG), `Rezerwacja`, `MGP` i `Dostawca`. Starszy,
płaski eksport bez nich konwerter rozdziela deterministycznie hashem.

Seed buduje z towarów na MGP dokumenty FZ/PZ **pogrupowane po realnym
dostawcy**, po najwyżej 20 pozycji. Jeden dokument zostaje w buforze. Dokumenty
stoją na dwóch magazynach skutku: krajowe na `MAG` i jeden kontener na `MGP`.
Magazyn `Zwroty` dostaje same stany.

`npm run seed:scenariusze` dopisuje przypadki brzegowe: kolizje kodów, zadanie
w błędzie, zdjęcie bez pliku, adres spoza wzorca. Kasuje wyłącznie własne
wiersze (`tw_id` od 900001, `dok_id` od 9001, własne konta) i buduje je od
nowa, więc wolno go uruchamiać dowolnie często. Zakłada konta ze znanym hasłem,
dlatego przy `SGT_MODE=mssql` odmawia startu. Zasila też dokumenty WZ, bez
których `npm run reslot -- --demo` nie ma czego liczyć. Katalog scenariuszy:
[`docs/scenariusze-testowe.md`](docs/scenariusze-testowe.md).

## Praca z prawdziwym Subiektem GT

Docelowa wersja w firmie to **Subiekt GT 1.87 SP3 HF1**. Nie ma natywnego pola
lokalizacji, więc WERTIS używa pola własnego `tw_Pole1..8`. Tryb
`SGT_MODE=mssql` działa także na wersji edu i wymaga jednego loginu SQL
o minimalnych uprawnieniach. Tryb zapisu wynika z `SGT_MODE`, osobnego
przełącznika nie ma.

- podpięcie krok po kroku: [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md),
- co WERTIS czyta i pisze w bazie Subiekta: [`docs/subiekt-gt-struktura.md`](docs/subiekt-gt-struktura.md),
- etapy wejścia na produkcję z bramkami: [`docs/wdrozenie.md`](docs/wdrozenie.md),
- instalacja, usługi, sieć, APK, kopie: [`DEPLOY.md`](DEPLOY.md).

## Zasady pracy w repo

Zasady stoją w plikach `CLAUDE.md`: [`CLAUDE.md`](CLAUDE.md) w korzeniu oraz
po jednym w `server/`, `panel/`, `android/` i `sfera-worker/`. Każda zasada ma
strażnika — test albo skrypt, który zatrzyma CI — albo jest oznaczona jako
konwencja. Zmianę opisuje fragment `zmiany/<nazwa>.md`
([`zmiany/README.md`](zmiany/README.md)), a numer wydania nadaje automat po
scaleniu. Przed wypchnięciem przechodzą testy serwera i panelu oraz
`tools/docs_check.py`, `tools/styl_check.py`, `tools/ergonomia_check.py`
i `tools/kt_imports_check.py`.

## Dokumentacja

| plik | o czym |
|---|---|
| [`docs/architektura.md`](docs/architektura.md) | jak to jest zbudowane i dlaczego tak — start dla nowej osoby |
| [`DEPLOY.md`](DEPLOY.md) | wdrożenie on-premise, wydania, aktualizacje, kopie |
| [`docs/analiza-rozkladanie.md`](docs/analiza-rozkladanie.md) | rozkładanie dostaw i przesunięcia stanu |
| [`docs/obsluga-klienta.md`](docs/obsluga-klienta.md) | obsługa klienta Allegro: zakres, prywatność, decyzje |
| [`docs/obsluga-klienta-calosc.md`](docs/obsluga-klienta-calosc.md) | jedna droga klienta przez cztery kolejki |
| [`docs/ergonomia-magazynu.md`](docs/ergonomia-magazynu.md) | dekalog ergonomii ekranów magazynowych |
| [`docs/scenariusze-testowe.md`](docs/scenariusze-testowe.md) | przypadki brzegowe: co seed buduje i czego oczekiwać |
| [`docs/sfera-com.md`](docs/sfera-com.md) | ustalenia o COM Sfery |
| [`docs/slownik.md`](docs/slownik.md) | jak pisze się tę dokumentację i słowniczek terminów |
| [`CHANGELOG.md`](CHANGELOG.md) | co się zmieniło i czy wymaga działania przy wdrożeniu |
