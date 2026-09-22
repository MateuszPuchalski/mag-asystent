# Projekt widoków: jeden front

Makiety biura przeniesionego do panelu `panel/` pod `/obsluga`. Decyzja
właściciela i kolejność wydań stoją w `docs/obsluga-klienta.md` §7.

Kanwa: https://claude.ai/artifact/EyBQaCKkn94LK16Hgd7uW6

| plik | ekran |
|---|---|
| `Main.dc.html` | DO DECYZJI — nowy ekran startowy |
| `Dostawy.dc.html` | Dostawy z otwartym dokumentem |
| `Kosze.dc.html` | Kosze zwrotowe z cyklem i zwrotami w koszu |
| `Stan.dc.html` | Stan systemu: integracje, konto Allegro, kolejka zapisów |
| `Analiza.dc.html` | Analiza widziana przez administratora |
| `AnalizaBiuro.dc.html` | Analiza widziana przez rolę biuro |
| `Ustawienia.dc.html` | Ustawienia za zębatką |
| `Naglowek1440.dc.html` | Nagłówek w dwóch rzędach przy 1440 px |
| `Naglowek1180.dc.html` | Ten sam nagłówek przy 1180 px |
| `BrakDostepu.dc.html` | Konto magazyniera, które weszło do biura |

## Czym to nie jest

To nie jest kod panelu. Dane na planszach są przykładowe: dostawcy, numery,
symbole i loginy są zmyślone. Kształt wierszy i stany pochodzą z kodu biura.
Plansze mówią mową wizualną panelu, nie `biuro.html`.

## Reguła wyboru

Cel biura: biuro rozstrzyga to, czego hala nie rozstrzygnie sama — w drodze
towaru przez magazyn. Reszta jest nadzorem albo ustawieniem.

Każda funkcja przechodzi jeden test. Decyzja biura, której hala nie podejmie,
to praca na górnym rzędzie albo w DO DECYZJI. Coś, co trzeba sprawdzać, to
wgląd w dolnym rzędzie. Rzadka zmiana idzie za zębatkę. Reszta wypada.

## Decyzje widoczne na ekranie

**Nagłówek ma dwa rzędy.** Górny niesie pracę: DO DECYZJI i osiem kolejek
panelu. Dolny niesie magazyn i wgląd, a z prawej stan, zębatkę i wyjście.
Zmierzone w Chromium: górny rząd potrzebuje 1145 px, dolny 1068 px. Przy
1180 px nic się nie zawija; poniżej około 1150 px górny rząd zawija się jak dziś.

**DO DECYZJI jest ekranem startowym.** Zbiera sprawy biura ze wszystkich
obszarów: wyjątki dostaw, odpowiedzi hali, kosze, błędy zapisów do Subiekta
i kolizje kodów. Obsługa klienta dostaje tu liczniki z odnośnikami, bo praca
nad klientem dzieje się w jej kolejkach. Lista liczy się w locie z istniejących
tras i nie ma własnej tabeli ani statusu.

**Reklamacje biura nazywają się Rozbieżności.** W panelu Reklamacje to sprawy
Allegro. Jedna nazwa na dwie rzeczy kazałaby zgadywać, o którą chodzi.

**Pomiary obsługi wychodzą z Ustawień.** Eskalacja, pokrycie wiedzy i pomiar
Copilota to wgląd, nie ustawienie. Za zębatką zostaje konfiguracja: dane
firmy, reguły strefy, konta, słownik tagów i logo dostawców.

**Karta wydajności per osoba jest tylko dla administratora.** Serwer nie
wysyła jej roli biuro. Nieużywana trasa `/api/wydajnosc` znika.
