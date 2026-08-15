# Jak pisze się dokumentację WERTIS

Dokumentacja tego repo trzyma się reguł **ASD-STE100** (Simplified Technical
English) w takim zakresie, w jakim da się je przenieść na polski.

Ten plik jest jedynym źródłem tych reguł. Mierzalną ich część sprawdza
[`tools/styl_check.py`](../tools/styl_check.py) przy każdym PR.

## Czego NIE deklarujemy

Nie deklarujemy zgodności z ASD-STE100. Nie da się jej spełnić poza angielskim.

Standard opiera się na słowniku około 900 dopuszczonych **angielskich** słów.
Część jego reguł dotyczy wprost gramatyki angielskiej. Rodzajniki, gerundia
i czasowniki frazowe nie mają polskich odpowiedników.

Pomijamy więc cztery rzeczy: słownik dopuszczonych słów, reguły o rodzajnikach
(STE 5.x), zakaz gerundiów (STE 4.4) i zakaz czasowników frazowych (STE 1.12).

Napisanie tu „zgodne z ASD-STE100" byłoby tym samym błędem, co komentarz
„zgodnie z wersją monorepo" przy trzech rozjeżdżających się numerach wersji.
Deklaracja nie jest mechanizmem.

## Reguły, które stosujemy

| reguła | STE | co to znaczy u nas |
|---|---|---|
| jedna instrukcja = jedno zdanie | 2.1 | krok nie zawiera „i wtedy", „a następnie", „przy okazji" |
| najwyżej 20 wyrazów w kroku procedury | 6.4 | punkty numerowane i pozycje checklisty |
| najwyżej 25 wyrazów w zdaniu opisowym | 6.5 | proza poza procedurami |
| najwyżej 6 zdań w akapicie | 6.2 | dłuższy akapit trzeba podzielić |
| tryb rozkazujący, strona czynna | 3.1, 3.2 | „Uruchom", nie „należy uruchomić" ani „jest uruchamiany" |
| jedno pojęcie = jedno słowo | 1.1–1.5 | słowniczek niżej |
| ostrzeżenie **przed** krokiem | 8.1 | czytelnik ma je zobaczyć, zanim wykona krok |
| kroki sekwencyjne numerowane | 7.x | sekwencja nie jest prozą |
| bez skupisk rzeczowników | 1.14 | „lista loginów kont pracowników" trzeba rozbić |

## Uzasadnienia zostają — ale osobno

Ta dokumentacja wszędzie mówi **dlaczego**, i to jest jej największa wartość.
STE nie każe tego kasować. Każe oddzielić tekst proceduralny od opisowego.

Krok zostaje krótki i rozkazujący. Powód schodzi pod niego do osobnego bloku:

> **Dlaczego.** Wcześniej bramką był tylko ekran kolektora. Dowolne urządzenie
> w sieci hali mogło zmienić lokalizację w Subiekcie.

Trzy dokumenty są **poza zakresem** tych reguł, bo w całości są uzasadnieniami:
[`architektura.md`](architektura.md), [`porownanie-asystent.md`](porownanie-asystent.md)
i [`CHANGELOG.md`](../CHANGELOG.md). Limit 25 wyrazów wyciąłby z nich dokładnie
tę treść, dla której powstały.

## Słowniczek

Kolumna **zamiast** wymienia warianty odrzucone. Puste pole znaczy, że pojęcie
nie ma konkurencji i stoi tu wyłącznie dla ustalenia znaczenia.

Gwiazdka zastępuje końcówkę fleksyjną. Wpis `pol* dodatkow*` łapie jednym
wzorcem `pole dodatkowe`, `polu dodatkowym` i `pól dodatkowych`. Bez gwiazdki
lista wariantów rosłaby o każdy przypadek gramatyczny z osobna.

| termin | znaczenie | zamiast |
|---|---|---|
| **kolektor** | urządzenie Zebra albo Honeywell z aplikacją WERTIS | klien* natywn* |
| **pole własne** | jedna z ośmiu kolumn `tw_Pole1..tw_Pole8` na `tw__Towar` | pol* dodatkow* |
| **APK** | plik instalacyjny aplikacji kolektora | |
| **magazynier**, **biuro**, **admin** | trzy role w systemie; „użytkownik" nie jest rolą | |
| **login** | jawna nazwa konta, np. `jkowalski`; wpisuje ją biuro przy zakładaniu | |
| **hasło** | sekret otwierający sesję; w bazie leży wyłącznie jako hasz | |
| **karta towaru** | ekran ze stanami, lokalizacjami i zamiennikami | |
| **zamówienie u dostawcy** | dokument ZD — towar zamówiony, jeszcze nieprzyjęty; samo „zamówienie" myli się z ZK od klienta | |
| **kreator** | dialog instalatora pytający o bazę Subiekta | |
| **regał** | miejsce o adresie `A01-02-03`; etykieta wisi na jego półce | |
| **kolejka Sfery** | tabela `sfera_queue` i zadania zapisu do Subiekta | |

Nazwy własne zostają bez zmian: Subiekt GT, Sfera, InsERT, NSSM, DataWedge,
DataCollection. Tak samo cytaty komunikatów aplikacji.

## Co sprawdza skrypt, a co człowiek

`tools/styl_check.py` mierzy trzy rzeczy: długość zdania, długość akapitu
i odrzucone warianty ze słowniczka.

Nie mierzy reszty. „Jedna instrukcja = jedno zdanie", strona czynna
i kolejność ostrzeżeń zostają do przeglądu przez człowieka.

To ta sama lekcja, co `-DryRun` w [`instalator/README.md`](../instalator/README.md):
narzędzie ma mówić, czego **nie** dowodzi. Skrypt na zielono nie znaczy, że
tekst jest dobry. Znaczy tylko, że nie łamie trzech mierzalnych reguł.
