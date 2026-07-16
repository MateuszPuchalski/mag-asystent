# WERTIS · Asystent magazyniera (kolektor)

Prototyp PWA na kolektor (Honeywell / Android, skaner emulujący klawiaturę) dla
magazynu części ogrodniczych pracującego na **Subiekcie GT**. Implementacja
zgodna ze specyfikacją `SPEC magazyn kolektor` oraz projektem UI
`Kolektor_WERTIS` — z **prawdziwymi danymi testowymi**: 3423 kartoteki
z eksportu `mag.xlsx` (symbol, nazwa, EAN, stany, jednostki, zamówienia,
lokalizacje, opisy).

## Uruchomienie

Aplikacja jest w pełni statyczna — wystarczy dowolny serwer HTTP:

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Parametry symulacji workera Sfery (query string):

| Parametr | Działanie |
|---|---|
| `?delay=3` | czas zapisu przez workera Sfery w sekundach (domyślnie 1.8) |
| `?errors=1` | losowe błędy zapisu („kartoteka otwarta w edycji") — test przycisku PONÓW |

Na desktopie aplikacja renderuje się w ramce kolektora (podgląd); na małym
ekranie (kolektor / telefon) zajmuje cały ekran. Można ją zainstalować jako
PWA (manifest + service worker, działa offline po pierwszym załadowaniu).

## Zakres prototypu (Faza 1–3 frontendu wg spec §10)

- **Splash** z linką startową (pociągnij, aby uruchomić).
- **Skanowanie / wyszukiwarka** — jedno pole z focusem: skan EAN
  (8/12/13/14 cyfr, rozpoznawanie po tempie znaków <50 ms), symbol, nazwa,
  końcówka EAN; wyniki z linią stanów MAG/PRZYJ; ostatnio skanowane
  (localStorage); kafle symulacji skanera.
- **Karta towaru** — stany MAG (dostępne / rez. / razem) i PRZYJ, opis,
  jednostka, zamówione u dostawcy; chipy lokalizacji (pierwsza = pickingowa),
  licznik znaków pola `tw_Lokalizacja` (limit 50), usuwanie lokalizacji,
  banner oczekujących zapisów w kolejce.
- **Zmiana lokalizacji** — skan towaru → skan lokalizacji; przy ≥2
  lokalizacjach dialog: zastąp wszystkie / dodaj / zastąp jedną z…;
  walidacje: brak spacji, limit długości pola (twardy błąd, nie ucięcie).
- **MM PRZYJ → MAG** — cała ilość lub korekta ±, clamp do stanu PRZYJ.
- **⚡ Zasilenie (kombo)** — jedno zadanie: MM całości + nadanie lokalizacji.
- **Kolejka Sfery** — optymistyczne potwierdzenia ⏳ → ✓ / ✗ + PONÓW,
  symulowany worker (statusy pending / processing / done / error),
  pull-to-refresh linką, badge na zakładce.
- Beep + wibracja przy potwierdzeniach (WebAudio + `navigator.vibrate`).

## Czego prototyp NIE zawiera (backend — kolejne etapy)

Zapis jest symulowany w przeglądarce. Docelowa architektura (spec §3):
serwer API (odczyt SELECT z MSSQL read-only) + kolejka zadań + **worker
Sfery** (COM, Windows) do faktycznych zapisów `set_location` / dokumentów MM.
Moduł rozkładania dostaw (put-away, sesje z FZ/PZ, tryb wózka) — Faza 3/4.

## Dane testowe

`data/products.json` — wygenerowane z `mag.xlsx` skryptem
`tools/convert_xlsx.py`:

```bash
pip install openpyxl
python3 tools/convert_xlsx.py mag.xlsx data/products.json
```

Eksport zawiera jeden stan łączny, więc skrypt deterministycznie
(hash symbolu) rozdziela dane na potrzeby testów: ~55% towarów
z `Zamówione > 0` dostaje stan na PRZYJ (symulacja dostawy do rozłożenia),
~40% — rezerwacje. W produkcji te liczby pochodzą z `tw_Stan`
(`st_Stan`, `st_StanRez`) dla magazynów MAG i PRZYJ.

## Struktura

```
index.html            powłoka aplikacji (rama kolektora, topbar, tabbar)
css/app.css           design tokens + style (paleta WERTIS: #F7A600 / #3B3B3D / #F6F5F2)
js/app.js             logika: ekrany, skan, wyszukiwarka, kolejka, symulacja workera
data/products.json    3423 kartoteki z mag.xlsx
tools/convert_xlsx.py konwersja eksportu Subiekta → JSON
manifest.webmanifest  PWA
sw.js                 service worker (offline)
```
