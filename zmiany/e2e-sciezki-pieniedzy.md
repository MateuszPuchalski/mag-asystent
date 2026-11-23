---
rodzaj: patch
tytul: pasek o dopisku klienta znów działa, testy przeglądarkowe odpowiedzi, zwrotu i reklamacji
---

**Pasek „Klient dopisał nową wiadomość” znów się zapala.** Gdy klient dopisał
coś w trakcie pisania odpowiedzi, skrzynka odświeżała rozmowę po cichu
i odpowiedź na stare pytanie wychodziła bez ostrzeżenia. Panel czytał pola
zdarzenia z innego miejsca, niż wysyła je serwer. Z tego samego powodu
znacznik „kto siedzi przy rozmowie” nie zmieniał się na żywo.

Błąd znalazły nowe testy przeglądarkowe. Przechodzą przez prawdziwy panel
i prawdziwy serwer na świeżej bazie: odpowiedź z oknem cofnięcia, dopisek
klienta w trakcie, werdykt zwrotu, wypłata i werdykt reklamacji. Z serwerem
rozmawia lokalny udawany serwer Allegro, a mur sieci zatrzymuje każde
połączenie poza własną maszynę. Uruchamia się je ręcznie
(`npm run test:e2e` w `panel/`), w CI nie biegną.

Seed scenariuszy zakłada dwie rozmowy, dwa zwroty i reklamację
(`docs/scenariusze-testowe.md`, S90–S94). Na bazie ze sparowanym kontem
Allegro tych spraw nie buduje.
