# Projekt widoków biura

Źródła makiet do przeprojektowania `server/src/web/biuro.html` w 0.427.0.
Dziewięć plansz, każda jako osobny plik `.dc.html`. Plik `canvas.json` układa
je na jednej kanwie.

Kanwa: https://claude.ai/artifact/S8UUsFUdepm2HYLYdKQk7C

| plik | ekran |
|---|---|
| `Main.dc.html` | DOSTAWY: lista, reklamacje |
| `Szczegol.dc.html` | DOSTAWY: dokument otwarty, 1280 px i szerzej |
| `Szuflada.dc.html` | DOSTAWY: laptop 1024–1279 px, kontekst w szufladzie |
| `Magazyn.dc.html` | MAGAZYN ZWROTÓW: kosze i pominięte pozycje |
| `Nadzor.dc.html` | STAN SYSTEMU |
| `Dziennik.dc.html` | DZIENNIK |
| `Analiza.dc.html` | ANALIZA |
| `Ustawienia.dc.html` | USTAWIENIA |
| `Jezyk.dc.html` | składniki: przyciski, pastylki, cykl kosza, dymki |

## Czym to nie jest

To nie jest kod biura. Plansze są makietami i żadne kliknięcie nie sięga do
serwera. Dane są przykładowe: dostawcy, numery, symbole i loginy są zmyślone.
Kształt wierszy, etykiety wyjątków i stany pochodzą z kodu biura.

Makiety trzymają się żetonów z `:root` biura. To Barlow i Barlow Condensed,
bursztyn `#F7A600`, atrament `#2A2A2C`, papier `#F6F5F2` i karty o promieniu
14 px. Nowe są dwa składniki: przycisk mały i dymek błędu.

## Reguła wyboru

Dekalog `docs/ergonomia-magazynu.md` mówi w punkcie 10, że sama uroda nie jest
odpowiedzią. Każda zmiana na kanwie nazywa więc punkt dekalogu, któremu służy.
Biuro bierze z dekalogu punkty 1, 2, 5, 6 i 10.

## Decyzje widoczne na ekranie

**Wiersz dostawy ma dwie linie zamiast czterech (pkt 2).** Pierwsza linia
niesie numer, dostawcę i wiek. Druga niesie pasek z licznikiem. Sygnały stoją
w stałej kolumnie po prawej, więc czyta się je ruchem oka w dół. Pastylka
stanu zeszła z wiersza, bo pasek i licznik mówią to samo.

**Grupa CZEKA NA BIURO stoi na górze listy (pkt 5).** Wchodzi do niej dokument
z otwartym wyjątkiem albo z nieprzeczytaną odpowiedzią hali. Bez takiego
dokumentu nagłówków grup nie ma.

**Reklamacje mają blok na dokument (pkt 2).** Nagłówek bloku niesie numer,
dostawcę, licznik i akcje na całą fakturę. Wyjątek jest wierszem z kolumnami:
typ, towar, ilość, kto, zdjęcie i ROZWIĄŻ.

**Pozycje dokumentu mają trzy kolumny zamiast pięciu (pkt 2).** Stan stoi pod
ilością, a osoba pod adresem. W środkowej kolumnie przy 1440 px nic się już nie
łamie na kilka linii.

**Cykl kosza jest paskiem kroków (pkt 2 i 5).** Kroki to OTWARTY, NA HALĘ
i ROZŁOŻONY. Stan dokumentu MM zostaje dopiskiem, bo to osobny tor. Kosz
anulowany nie jest krokiem cyklu i zostaje czerwoną pastylką.

**STAN SYSTEMU zaczyna od tego, co czeka na biuro (pkt 1 i 5).** Najpierw
kolejka zapisów, rekoncyliacja i kolizje kodów, potem miary. Arkusz
lokalizacji zostaje tuż pod kolejką zapisów, bo to ona wykonuje jego skutek.

**Dziennik barwi typ zdarzenia według rodziny (pkt 2).** Rodziny są cztery:
błędy, dostawy, zwroty i reszta. Kolory pochodzą z istniejących żetonów.

**Dymek błędu zostaje do kliknięcia (pkt 6).** Potwierdzenie dalej gaśnie po
sześciu sekundach. Błąd, który sam znika, to błąd, którego nikt nie przeczytał.

## Rozbieżności kanwy i kodu

Kanwa rysuje głowę dokumentu jako przyklejoną. W kodzie była taka już przed
0.427.0, bo od 1024 px przewija się wyłącznie tabela pozycji.

Plansza USTAWIENIA pokazuje pola w siatce. Tej zmiany w 0.427.0 nie ma, bo
nie weszła do zakresu wydania.
