---
rodzaj: minor
tytul: Problemy z zakupem w skrzynce
---

**Problemy z zakupem trafiają do skrzynki.** Od 28 października Allegro
zakłada nowe sprawy kupujących jako Problemy z zakupem w Centrum Wiadomości,
a nie jako dyskusje. Rozmowa ma w kolejce i w nagłówku plakietkę „Problem
z zakupem” z powodem i stanem „zamknięty”, gdy Allegro ją zamknie.
Wiadomość doradcy Allegro podpisuje się „Allegro”, nie loginem klienta.
W zamkniętym Problemie edytor nie pozwala wysłać odpowiedzi, a zamykające
zdanie doradcy nie stawia rozmowy w „Czeka na nas”. Pytanie klienta bez
odpowiedzi czeka dalej. Stare dyskusje zostają w swojej kolejce.

**Skrzynka mówi, gdy Problemy z zakupem nie dochodzą.** Nagłówek kolejki
i karta Allegro w „Stan systemu” ostrzegają, gdy Allegro odmówiło nowej
wersji albo gdy jest wyłączona w konfiguracji.

Skrzynka czyta listę wątków w `beta.v1` (`/messaging`, kursor `nextPage`),
bo tylko tam Allegro pokazuje Problemy z zakupem. Typ i podtyp wątku idą
z listy, bez osobnego żądania o wątek. Wiadomości Problemu z zakupem idą
betą, a kierunek daje `author.role`. Wiadomości zwykłego wątku zostają
na `public.v1`. Rozmówcę wątku z bety wylicza `rozmowcaWatku` z uczestników.
Gdy beta odmawia przy pierwszej stronie, przebieg czyta `public.v1`, a beta
czeka sześć godzin. Wysyłka i znacznik „przeczytany” w Problemie z zakupem
idą betą, a zamknięty Problem (422 `THREAD_CLOSED`) mówi o tym zdaniem.
Wiadomość Problemu bez własnego numeru zamówienia dostaje numer wątku, gdy
zamówienie jest jedno. Copilot rozpoznaje ostatnią wiadomość kupującego,
a doradcę widzi w wątku jako `ALLEGRO:`. Nowe kolumny `message.autor_rola`
oraz `beta_wstrzymana_do` i `beta_powod` w `allegro_inbox_sync_state`. Kształt
i znaczniki weryfikacji: `docs/allegro-ksztalt.md`.

**[wymaga działania]** Przed kliknięciem aktualizacji sprawdź na bazie
serwera, czy beta przyjmuje nasze identyfikatory wątków:
`SELECT COUNT(*) FROM allegro_inbox_thread WHERE struktura_at IS NOT NULL;`.
Wynik większy od zera to zgoda na aktualizację. Wynik zero przy wątkach
w skrzynce: najpierw `ALLEGRO_WATKI_BETA=0` w `wertis.env`, potem aktualizacja.
Po pierwszym przebiegu liczba rozmów nie może skoczyć, a stare wątki mają
dostawać `watek_typ`. Inaczej wpisz `ALLEGRO_WATKI_BETA=0` i uruchom usługę
ponownie. Sprawdzenie musi się skończyć przed 28 października.
