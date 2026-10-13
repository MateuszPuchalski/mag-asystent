---
rodzaj: patch
tytul: sonda pyta o zwroty płatności z rozbiciem na pozycje
---

Sonda Allegro (`npm run sonda`) opisuje kształt `GET /payments/refunds`: listę konta oraz zwroty zamówień ze zwrotów klienta. Pozwala sprawdzić na żywym koncie, czy zwrot zrobiony ręką w Sales Center jest widoczny w API razem z pozycjami.
