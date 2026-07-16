# WERTIS · Asystent magazyniera (kolektor)

Prototyp PWA na kolektor (Honeywell / Android, skaner emulujący klawiaturę) dla
magazynu części ogrodniczych pracującego na **Subiekcie GT**. Implementacja
zgodna ze specyfikacją `SPEC magazyn kolektor` oraz projektem UI
`Kolektor_WERTIS` — z **prawdziwymi danymi testowymi**: 3423 kartoteki
z eksportu `mag.xlsx`.

Stack: **React 19 + Vite 6 + Tailwind CSS v4 + shadcn/ui**. Motyw shadcn jest
dostrojony do kolorystyki logo WERTIS (amber `#F7A600`, grafit `#2A2A2C`,
papier `#F6F5F2`). Strefa przyjęć nazywa się **MGP**.

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski (HMR)
# lub produkcyjnie:
npm run build      # -> dist/
npm run preview    # serwuje dist/ na :8080
```

Parametry symulacji workera Sfery (query string):

| Parametr | Działanie |
|---|---|
| `?delay=3` | czas zapisu przez workera Sfery w sekundach (domyślnie 1.8) |
| `?errors=1` | losowe błędy zapisu („kartoteka otwarta w edycji") — test przycisku PONÓW |

Na desktopie aplikacja renderuje się w ramce kolektora (podgląd); na małym
ekranie zajmuje cały ekran. Instaluje się jako PWA (manifest + service worker
przez `vite-plugin-pwa`, działa offline po pierwszym załadowaniu).

## Zakres prototypu (Faza 1–3 frontendu wg spec §10)

- **Splash** — samo logo WERTIS (bez animacji linki), dotknięcie startuje.
- **Skanowanie / wyszukiwarka** — jedno pole z focusem: skan EAN
  (8/12/13/14 cyfr, rozpoznanie po tempie znaków <50 ms), symbol, nazwa,
  końcówka EAN; wyniki z linią stanów MAG/MGP; ostatnio skanowane
  (localStorage); kafle symulacji skanera.
- **Karta towaru** — stany MAG (dostępne / rez. / razem) i **MGP** (strefa
  przyjęć), opis, jednostka, zamówione u dostawcy; chipy lokalizacji
  (pierwsza = pickingowa), licznik znaków pola `tw_Lokalizacja` (limit 50),
  usuwanie lokalizacji, banner oczekujących zapisów w kolejce.
- **Zmiana lokalizacji** — skan towaru → skan lokalizacji; przy ≥2
  lokalizacjach bottom-sheet (shadcn/vaul): zastąp wszystkie / dodaj /
  zastąp jedną z…; walidacje: brak spacji, limit długości pola (twardy błąd).
- **MM MGP → MAG** — cała ilość lub korekta ±, clamp do stanu MGP.
- **⚡ Zasilenie (kombo)** — jedno zadanie: MM całości + nadanie lokalizacji.
- **Kolejka Sfery** — optymistyczne potwierdzenia ⏳ → ✓ / ✗ + PONÓW,
  symulowany worker (pending / processing / done / error),
  pull-to-refresh, badge na zakładce.
- Beep + wibracja przy potwierdzeniach (WebAudio + `navigator.vibrate`).

## Czego prototyp NIE zawiera (backend — kolejne etapy)

Zapis jest symulowany w przeglądarce. Docelowa architektura (spec §3):
serwer API (odczyt SELECT z MSSQL read-only) + kolejka zadań + **worker
Sfery** (COM, Windows) do faktycznych zapisów `set_location` / dokumentów MM.
Moduł rozkładania dostaw (put-away, sesje z FZ/PZ, tryb wózka) — Faza 3/4.

## Dane testowe

`public/data/products.json` — wygenerowane z `mag.xlsx` skryptem
`tools/convert_xlsx.py`:

```bash
pip install openpyxl
python3 tools/convert_xlsx.py mag.xlsx public/data/products.json
```

Eksport zawiera jeden stan łączny, więc skrypt deterministycznie
(hash symbolu) rozdziela dane na potrzeby testów: ~55% towarów
z `Zamówione > 0` dostaje stan na MGP (symulacja dostawy do rozłożenia),
~40% — rezerwacje. W produkcji te liczby pochodzą z `tw_Stan`
(`st_Stan`, `st_StanRez`) dla magazynów MAG i MGP.

## Struktura

```
index.html               entry Vite
vite.config.ts           Vite + React + Tailwind v4 + PWA
src/
  index.css              Tailwind v4 + motyw shadcn (paleta WERTIS)
  main.tsx / App.tsx     powłoka: rama kolektora, topbar, tabbar, ekrany
  components/ui/         komponenty shadcn (button, card, badge, input, drawer)
  components/            glyphs, LocationDialog, Overlays
  screens/               Splash, Home, Product, ScanLoc, MM, Queue
  lib/                   store (stan + symulacja workera), types, feedback, utils
public/
  data/products.json     3423 kartoteki z mag.xlsx
  assets/                logo WERTIS (pełne + kompaktowe), ikona PWA
tools/convert_xlsx.py    konwersja eksportu Subiekta → JSON
```
