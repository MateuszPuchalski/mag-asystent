# Projekt widoków: jeden front

Makiety biura przeniesionego do panelu `panel/` pod `/obsluga`. Decyzja
właściciela i kolejność wydań stoją w `docs/obsluga-klienta.md` §7.

Kanwa: https://claude.ai/artifact/EyBQaCKkn94LK16Hgd7uW6

| plik | ekran |
|---|---|
| `Main.dc.html` | DO DECYZJI — ekran-lista jak Moje i Zadania |
| `Dostawy.dc.html` | Dostawy — kolejka, dokument, dowody, jak Zwroty |
| `Kosze.dc.html` | Kosze — kolejka, kosz, zwroty w koszu (miejsce zmienione, patrz niżej) |
| `Stan.dc.html` | Stan systemu — karty jak Ustawienia |
| `Analiza.dc.html` | Analiza widziana przez administratora |
| `AnalizaBiuro.dc.html` | Analiza widziana przez rolę biuro |
| `Ustawienia.dc.html` | Ustawienia za zębatką |
| `Dziennik.dc.html` | Dziennik z filtrami i tabelą wpisów |
| `Naglowek1440.dc.html` | Nagłówek w dwóch rzędach przy 1440 px |
| `Naglowek1180.dc.html` | Ten sam nagłówek przy 1180 px |
| `BrakDostepu.dc.html` | Konto magazyniera, które weszło do biura |

## Czym to nie jest

To nie jest kod panelu. Dane na planszach są przykładowe: dostawcy, numery,
symbole i loginy są zmyślone. Stany i treść wierszy pochodzą z kodu biura.

**Plansze są zbudowane od zera w gramatyce panelu**, decyzją właściciela.
Pierwsza wersja kanwy przenosiła układy `biuro.html` w barwach panelu i została
odrzucona. Każdy kształt tej wersji ma wzór w istniejącym ekranie panelu.

## Reguła wyboru

Cel biura: biuro rozstrzyga to, czego hala nie rozstrzygnie sama — w drodze
towaru przez magazyn. Reszta jest nadzorem albo ustawieniem.

Każda funkcja przechodzi jeden test. Decyzja biura, której hala nie podejmie,
to praca na górnym rzędzie albo w DO DECYZJI. Coś, co trzeba sprawdzać, to
wgląd w dolnym rzędzie. Rzadka zmiana idzie za zębatkę. Reszta wypada.

## Decyzje widoczne na ekranie

**Nagłówek ma dwa rzędy tej samej bieżni.** Górny to dzisiejszy nagłówek
panelu z DO DECYZJI na początku. Dolny niesie magazyn i wgląd, a z prawej stan,
zębatkę i wyjście. Zmierzone w Chromium: górny rząd potrzebuje 1155 px, dolny
1044 px, więc przy 1180 px nic się nie zawija. Nagłówek ma 111 px wysokości.

> **Kosze zmieniły miejsce w 0.438.0, decyzją właściciela.** Plansza rysuje je
> w drugim rzędzie nagłówka; wdrożone mieszkają w zakładce Zwroty, pod
> przełącznikiem Zwroty · Kosze. Układ trzech kolumn zostaje taki, jak na
> planszy — zmieniło się tylko wejście.

**Dostawy i Kosze to ekrany-kolejki jak Zwroty i Reklamacje.** Z lewej stoi
kolejka z kubełkami i pytaniem decyzji, na środku sprawa, z prawej dowody.
Dla dostawy dowodami są zdjęcia z hali, dane dostawcy i notatki z halą. Dla
kosza są nimi zwroty w koszu i stan dokumentu MM.

**DO DECYZJI jest ekranem-listą jak Moje.** Każdy wiersz mówi, co trzeba
rozstrzygnąć, i prowadzi do kolejki, w której ta decyzja zapada. Na liście nie
ma przycisków decyzji, bo decyzja zapada przy dowodach. Lista liczy się w locie
z istniejących tras i nie ma własnej tabeli ani statusu.

**Pomiary obsługi wychodzą z Ustawień.** Eskalacja, pokrycie wiedzy i pomiar
Copilota to wgląd, nie ustawienie. Za zębatką zostaje konfiguracja: dane
firmy, reguły strefy, konta, słownik tagów i logo dostawców.

**Karta wydajności per osoba jest tylko dla administratora.** Serwer nie
wysyła jej roli biuro. Nieużywana trasa `/api/wydajnosc` znika.
