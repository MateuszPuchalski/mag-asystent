# WERTIS · Asystent magazyniera (kolektor) — aplikacja full-stack

Aplikacja PWA na kolektor (Honeywell / Android, skaner emulujący klawiaturę)
dla magazynu części ogrodniczych pracującego na **Subiekcie GT**. Implementacja
zgodna ze specyfikacją (`SPEC magazyn kolektor`) i projektem UI
`Kolektor_WERTIS`, z **prawdziwymi danymi** (3415 kartotek z eksportu
`magmat.xlsx`).

To **nie jest mock** — działa realny serwer, baza danych, kolejka i worker
(spec §3, §7, §8). Granica do Subiekta/Sfery jest za adapterami: w tym
środowisku (Linux, bez Subiekta) zasilana z eksportu `magmat.xlsx`, a adaptery
produkcyjne (MSSQL + Sfera COM) są gotowym do podpięcia szkieletem.

## Stack

| Warstwa | Technologia |
|---|---|
| Frontend (`web/`) | React 19 · Vite 6 · Tailwind CSS v4 · shadcn/ui · TanStack Query · PWA |
| Backend API (`server/`) | Node.js · Fastify 5 · TypeScript |
| Baza aplikacji | SQLite (better-sqlite3) — kolejka, sesje, events, locki (spec §7) |
| Worker Sfery | osobny proces Node, pętla poll, retry/backoff, `waiting_for_doc` (spec §9) |

Motyw shadcn dostrojony do kolorystyki logo WERTIS (amber `#F7A600`, grafit
`#2A2A2C`, papier `#F6F5F2`). Strefa przyjęć nazywa się **MGP**.

## Architektura (spec §3)

```
Kolektor (PWA React)  ──REST/JSON──►  Serwer Fastify
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
npm run dev      # api :3001 + worker + web :5173 (proxy /api → :3001)
```

Produkcyjnie:

```bash
npm run build    # web → web/dist, server → server/dist
npm start        # Fastify serwuje web/dist + API (worker: npm -w server run start:worker)
```

**Wdrożenie w firmie (on-premise):** kompletna instrukcja — maszyna z Subiektem,
usługi Windows (NSSM), DNS/zapora, HTTPS przez Caddy, tryb kiosku na
kolektorach, etapy przejścia na MSSQL/Sferę i backup — w [`DEPLOY.md`](DEPLOY.md).

Parametry (env, dev):

| Zmienna | Znaczenie |
|---|---|
| `WORKER_DELAY_MS` | czas „zapisu Sfery" (domyślnie 1500) |
| `WORKER_SIM_ERRORS=1` | losowe błędy zapisu (test ścieżki `error` + PONÓW) |
| `SGT_MODE` | `seeded` (domyślnie) lub `mssql` (prawdziwa baza Subiekta) |
| `SFERA_MODE` | zapis: `dev` (domyślnie), `sql` (UPDATE lokalizacji w MSSQL, edu) lub `com` (Sfera) |
| `LOC_FIELD_LIMIT` | limit pola `tw_Lokalizacja` (domyślnie 50) |

## Funkcje

**Podgląd i operacje ad-hoc**
- Skan (EAN 8/12/13/14, rozpoznanie po tempie <50 ms) / wyszukiwarka (symbol,
  nazwa, końcówka EAN) — logika `SELECT` na serwerze (spec §5.1).
- Karta towaru: stany MAG (dostępne/rez./razem) i MGP, **skorygowane o kolejkę**
  (`⏳ N szt w drodze`), lokalizacje (pierwsza = pickingowa), limit 50 znaków.
- Zmiana lokalizacji: skan towaru → skan lokalizacji; przy ≥2 lokalizacjach
  bottom-sheet zastąp/dodaj/zastąp jedną; walidacje bez spacji i długości.
- MM MGP→MAG i ⚡ zasilenie (kombo: MM całości + lokalizacja jednym zadaniem).
- Kolejka Sfery: statusy `pending`/`processing`/`waiting_for_doc`/`done`/`error`,
  PONÓW, polling, pull-to-refresh. Wejście przez **pastylkę statusu Sfery** w
  prawym górnym rogu (zielona = OK, amber = ⏳ w kolejce z licznikiem, czerwona =
  błąd) — jest jednocześnie wskaźnikiem stanu; dolny pasek ma 2 zakładki.

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

## Struktura repo

```
web/                       frontend (React/Vite/Tailwind/shadcn)
  src/lib/api.ts           klient REST
  src/lib/hooks.ts         TanStack Query (dane + mutacje)
  src/lib/store.ts         stan UI (nawigacja, feedback)
  src/screens/             Home, Product, ScanLoc, MM, Queue
  src/screens/putaway/     Documents, Session (wózek)
  public/data/products.json  3415 kartotek z magmat.xlsx
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
