---
rodzaj: minor
tytul: Jev — flagi, krok i progi z sondy, trafność osobno dla każdego klasyfikatora
---

Pierwsza sonda Jeva na żywym API TypeSafe potwierdziła kształt odpowiedzi
i trafiła kategorię w 21 z 21 zmyślonych polskich wiadomości. Pokazała też,
że flagi „brak danych towaru” i „wymaga człowieka” zapalały się prawie przy
każdej wiadomości. Jev czyta pytanie dosłownie, a w wątku zawsze czegoś
brakuje.

Trzy flagi dostały wąskie pytanie z opisem odpowiedzi „tak” i „nie”. Progi
stoją teraz na rozkładzie z sondy. Brak danych łapie się od 0,7, a kategoria
dodatkowa od 0,8, bo podziękowanie dostawało „status zamówienia”. Po zmianie
każda flaga w sondzie zapala się tam, gdzie powinna.

Sonda (`npm run sonda:jev` w `server/`) wypisuje teraz surowe wartości flag
przy każdej wiadomości, żeby następne strojenie też szło z liczb.

Karta „Copilot” za zębatką liczy trafność osobno dla każdego klasyfikatora. Tabela
precyzji dotyczy modelu i wersji instrukcji najnowszej decyzji i mówi to
wprost. Gdy decyzje mają więcej niż jeden klasyfikator, obok stoi tabela
porównania, na przykład Claude i Jeva, ze zgodnością z poprawkami agentów.
Wcześniej obie trafności zlewały się w jedną liczbę.

Następny krok przy Jevie wynika z kategorii i flag, a nie z pytania do
modelu. W sondzie na trzydziestu jeden trudniejszych wiadomościach Jev
pytany wprost wskazywał „pobierz zamówienie” przy dwudziestu dwóch, także
przy anulowaniu i fakturze. Teraz dostawa daje śledzenie przesyłki,
dostępność stan magazynu, a zwrot i reklamacja krok ręczny. Podziękowanie
nie wymaga niczego, a niejasna wiadomość idzie do przejrzenia. Wersja pytań
`jev-j4`.

Opis kategorii „towar wadliwy” ma przykład: pęknięty albo wygięty towar
w całym kartonie. Bez niego Jev brał go za szkodę w transporcie. Opis jest
wspólny z instrukcją Claude, więc jej wersja rośnie do `k5`.
