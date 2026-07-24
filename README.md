# WERTIS · Asystent magazyniera (kolektor) — aplikacja full-stack

System dla magazynu części ogrodniczych pracującego na **Subiekcie GT**,
z **prawdziwymi danymi** (3415 kartotek z eksportu `magmat.xlsx`). Dwa klienty,
każdy do swojej roli:

- **Kolektor = natywna aplikacja Android** ([`android/`](android/README.md),
  Kotlin/Compose): skan sprzętowy (Honeywell DataCollection + Zebra DataWedge),
  trwały offline (Room), kiosk przez Android lock-task/MDM. Wdrożenie:
  [`DEPLOY.md`](DEPLOY.md) §5.
- **Biuro = statyczna strona `/lookup`** (tylko odczyt, przeglądarka desktop) —
  serwowana wprost przez serwer, bez builda frontendu.

To **nie jest mock** — działa realny serwer, baza danych, kolejka i worker
(spec §3, §7, §8). Granica do Subiekta/Sfery jest za adapterami: w tym
środowisku (Linux, bez Subiekta) zasilana z eksportu `magmat.xlsx`, a adaptery
produkcyjne (MSSQL + Sfera COM) są gotowym do podpięcia szkieletem.

## Stack

| Warstwa | Technologia |
|---|---|
| Kolektor (`android/`) | Kotlin · Jetpack Compose · Retrofit · Room — skan sprzętowy Zebra/Honeywell ([README](android/README.md)) |
| Podgląd biurowy (`web/public/`) | statyczny `lookup.html` (vanilla JS + fetch) → `/lookup`, tylko odczyt |
| Backend API (`server/`) | Node.js · Fastify 5 · TypeScript |
| Baza aplikacji | SQLite (better-sqlite3) — kolejka, sesje, events, locki (spec §7) |
| Worker Sfery | osobny proces Node, pętla poll, retry/backoff, `waiting_for_doc` (spec §9) |

Kolorystyka WERTIS: amber `#F7A600`, grafit `#2A2A2C`, papier `#F6F5F2`.
Strefa przyjęć nazywa się **MGP**.

## Architektura (spec §3)

```
Kolektor (Android)  ─┐
Biuro (/lookup)     ─┴─REST/JSON──►  Serwer Fastify
                                       │  SQLite: sfera_queue, putaway_*, events
                                       │  SubiektAdapter (odczyt)  → enqueue
                                       ▼
                                     Worker (poll 1–2 s, sekwencyjnie)
                                       │  SferaAdapter (zapis)
                                       ▼
                         DEV: tabele sgt_* (SQLite, seed z mag.xlsx)
                         PROD: MSSQL SELECT (read-only) + Sfera COM (Windows)
```

Twarde zasady (spec §12) egzekwowane na serwerze: zero zapisu do „SGT" poza
kolejką; stany na ekranie skorygowane o oczekujące MM; walidacja długości
`tw_Lokalizacja` (twardy błąd, nie ucięcie); kody lokalizacji bez spacji;
każda operacja w `events`.

## Uruchomienie

```bash
npm install
npm run seed     # zasila SQLite z web/public/data/products.json (raz; FORCE_SEED=1 nadpisuje)
npm run dev      # api :3001 + worker; podgląd biurowy: http://localhost:3001/lookup
```

Kolektor: build APK w [`android/`](android/README.md) (`./gradlew :app:assembleDebug`
albo artefakt z CI), w aplikacji ustaw adres serwera (emulator: `http://10.0.2.2:3001`).

Produkcyjnie:

```bash
npm run build    # server → server/dist (frontend bez builda — web/public serwowane wprost)
npm start        # Fastify serwuje web/public + API (worker: npm -w server run start:worker)
```

**Wdrożenie w firmie (on-premise):** kompletna instrukcja — maszyna z Subiektem,
usługi Windows (NSSM), DNS/zapora, instalacja APK na kolektorach (MDM/kiosk),
etapy przejścia na MSSQL/Sferę i backup — w [`DEPLOY.md`](DEPLOY.md).

Parametry (env, dev):

| Zmienna | Znaczenie |
|---|---|
| `WORKER_DELAY_MS` | czas „zapisu Sfery" (domyślnie 1500) |
| `WORKER_SIM_ERRORS=1` | losowe błędy zapisu (test ścieżki `error` + PONÓW) |
| `SGT_MODE` | `seeded` (domyślnie) lub `mssql` (prawdziwa baza Subiekta) |
| `SFERA_MODE` | zapis: `dev` (domyślnie), `sql` (UPDATE lokalizacji w MSSQL, edu) lub `com` (Sfera) |
| `LOC_FIELD_LIMIT` | limit pola `tw_Lokalizacja` (domyślnie 50) |

## Funkcje (kolektor — aplikacja Android)

**Podgląd i operacje ad-hoc**
- Skan sprzętowy (Zebra DataWedge / Honeywell DataCollection, fallback
  klawiaturowy) / wyszukiwarka (symbol, nazwa, końcówka EAN) — logika `SELECT`
  na serwerze (spec §5.1).
- Karta towaru: stany MAG (dostępne/rez./razem) i MGP, **skorygowane o kolejkę**
  (`⏳ N szt w drodze`), lokalizacje (pierwsza = pickingowa), limit 50 znaków.
- Zmiana lokalizacji: skan towaru → skan lokalizacji; przy ≥2 lokalizacjach
  bottom-sheet zastąp/dodaj/zastąp jedną; walidacje bez spacji i długości.
- MM MGP→MAG i ⚡ zasilenie (kombo: MM całości + lokalizacja jednym zadaniem).
- Kolejka Sfery: statusy `pending`/`processing`/`waiting_for_doc`/`done`/`error`,
  PONÓW, polling, pull-to-refresh. Wejście przez **pastylkę statusu Sfery** w
  prawym górnym rogu (zielona = OK, amber = ⏳ w kolejce z licznikiem, czerwona =
  błąd) — jest jednocześnie wskaźnikiem stanu; dolny pasek ma 2 zakładki.
- Bufor offline (Room) na zapisy przy zaniku Wi-Fi, pasek COFNIJ (anulowanie
  zadania w oknie łaski), potrząśnięcie = cofnij, asysta niskiej baterii.

**Rozkładanie dostaw (put-away, spec §5.4)** — druga zakładka
- Lista dokumentów FZ/PZ na MGP (14 dni) z postępem sesji; tryb zapasowy
  „Rozkładaj całe MGP".
- Sesja: pozycje **sortowane po lokalizacji docelowej**, `BRAK LOK` na końcu,
  agregacja tego samego towaru, licznik `zostało N/M poz.`.
- Tryb wózka: skan towaru na wózek (domyślna ilość = min(pozostało, stan MGP)),
  potwierdzenie ze skanem lokalizacji, częściowe rozłożenie, pomiń, dodanie
  spoza dokumentu, rozjazd lokalizacji.
- **Zatwierdź wózek → jeden dokument MM + zadania `set_location`** z tej rundy.
- Locki multi-user (TTL 30 min), `waiting_for_doc` gdy dokument w buforze,
  zamknięcie sesji z rozliczeniem (`closed` / `closed_with_deviations`).
- **Dostawa już na MAG** (biuro zrobiło MM MGP→MAG przed rozłożeniem): dokument
  ma plakietkę **„na MAG · do zlokalizowania"** (`onMag`) i nadal jest do
  rozłożenia — w trybie **„tylko lokalizacja"** (skan bez „Brak stanu na MGP",
  zatwierdzenie tworzy **sam `set_location`, bez MM**). Zwykłe dostawy bez zmian.

**Podgląd magazynu (biuro) — `/lookup`**
- Lekka strona **tylko do odczytu** na tym samym serwerze i API, dla przeglądarki
  desktop (biuro). Skan/wyszukiwarka → karta towaru (stany MAG/MGP/Zwroty
  skorygowane o kolejkę, lokalizacje, historia); skan kodu regału → zawartość
  lokalizacji. Klawiaturowa (`Enter`/`↑`/`↓`/`/`/`Esc`), auto-odświeżanie karty
  co 8 s. **Zero operacji zapisu** (brak zmiany lokalizacji, MM, rozkładania).

## Struktura repo

```
android/                   KOLEKTOR — natywna aplikacja (Kotlin/Compose), android/README.md
  core/                    czysta logika JVM (skan, DTO, offline) + testy jednostkowe
  app/                     aplikacja Compose: 10 ekranów, skanery, czujniki
web/public/                statyki serwowane wprost przez serwer (bez builda)
  lookup.html              podgląd magazynu (biuro, read-only) → /lookup
  data/products.json       3415 kartotek z magmat.xlsx (źródło seedu)
server/                    backend (Fastify + SQLite + worker)
  src/db/schema.sql        tabele aplikacji (§7) + read-model sgt_*
  src/db/seed.ts           seed z products.json + dokumenty FZ/PZ per dostawca
  src/adapters/            Subiekt/Sfera: seeded+dev (tu) oraz mssql+com (prod, szkielet)
  src/services/            stock (korekta o kolejkę), putaway, queue, events
  src/routes/              products, mm, queue, putaway (§8)
  src/worker/worker.ts     pętla poll, retry/backoff, waiting_for_doc (§9)
tools/convert_xlsx.py      konwersja eksportu Subiekta → products.json
```

## Dane testowe

`web/public/data/products.json` z eksportu `magmat.xlsx` (`tools/convert_xlsx.py`,
rozpoznaje kolumny po nazwie). Eksport zawiera **prawdziwe** kolumny `Stan`
(MAG), `Rezerwacja`, `MGP` (strefa przyjęć) i `Dostawca`, więc konwerter bierze
je wprost — bez syntetyki (dla starszego, płaskiego eksportu bez tych kolumn
konwerter nadal rozdziela stany deterministycznie hashem). 94 towary mają stan
na MGP. Seed buduje z nich dokumenty FZ/PZ **pogrupowane po realnym dostawcy**
(duże paczki dzielone po ≤20 pozycji, jeden dokument w buforze — test
`waiting_for_doc`). W produkcji stany i dokumenty pochodzą z `tw_Stan` /
`dok__Dokument` przez adapter MSSQL (patrz [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md)).

## Praca z prawdziwym Subiektem GT

Tryb `SGT_MODE=mssql` (Windows z Subiektem, także **wersja edu**): importer
`server/src/adapters/subiekt.mssql.ts` zasila read-model `sgt_*` prosto z bazy
MSSQL Subiekta (przy starcie, co `MSSQL_SYNC_MS`, `POST /api/admin/resync`),
a worker w `SFERA_MODE=sql` zapisuje lokalizacje bezpośrednim UPDATE
(plan B ze spec §9; MM wymaga licencji Sfery — `sfera.com.ts` pozostaje
szkieletem). Instrukcja krok po kroku: [`docs/subiekt-gt-edu-setup.md`](docs/subiekt-gt-edu-setup.md).

W tym środowisku (chmura Linux, bez Subiekta/MSSQL) działa tryb `seeded` —
API, kolejka, worker i rozkładanie realnie na SQLite zasilonym danymi
z eksportu Subiekta.
