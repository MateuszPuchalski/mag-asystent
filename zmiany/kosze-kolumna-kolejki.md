---
rodzaj: patch
tytul: kosze — lista w tej samej kolumnie co pozostałe kolejki
---

Lista koszy stoi w tej samej kolumnie co skrzynka, zwroty, reklamacje i dostawy.
Szukanie dostało lupę i krzyżyk, a pusty kubełek ikonę kosza. Pasma kolumny mają
te same odstępy co w dostawach. Lista „Więcej" przy kubełkach koszy ma szerokość
swojej nazwy, jak w pozostałych kolejkach. Podpowiedź w polu szukania wylicza
same klucze, więc mieści się w kolumnie w całości. Błąd odświeżenia koszy stoi
nad listą, a nie pod nią.

Krzyżyk czyszczący szukanie ma 24 px boku w każdej kolejce. Mniejszy nie
spełniał najmniejszego celu wskaźnika z WCAG 2.2.

Filtr kubełków z listą „Więcej" ma już jeden kształt. Tryb rozciągnięty na
resztę rzędu wyszedł z kodu, bo kosze były jego ostatnim ekranem. Klasy kart
pracy i dowodów niosą swój układ kolumny, więc ekrany nie powtarzają go przy
każdej karcie.
