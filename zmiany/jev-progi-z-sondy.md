---
rodzaj: patch
tytul: Jev — flagi i progi ustawione z sondy na żywym API
---

Pierwsza sonda Jeva na żywym API TypeSafe potwierdziła kształt odpowiedzi
i trafiła kategorię w 21 z 21 zmyślonych polskich wiadomości. Pokazała też,
że flagi „brak danych towaru” i „wymaga człowieka” zapalały się prawie przy
każdej wiadomości. Jev czyta pytanie dosłownie, a w wątku zawsze czegoś
brakuje.

Trzy flagi dostały wąskie pytanie z opisem odpowiedzi „tak” i „nie”. Progi
stoją teraz na rozkładzie z sondy. Brak danych łapie się od 0,7, a kategoria
dodatkowa od 0,8, bo podziękowanie dostawało „status zamówienia”. Po zmianie
każda flaga w sondzie zapala się tam, gdzie powinna. Decyzje nowej wersji
pytań mają `promptWersja` `jev-j3`.

Sonda (`npm run sonda:jev` w `server/`) wypisuje teraz surowe wartości flag
przy każdej wiadomości, żeby następne strojenie też szło z liczb.
