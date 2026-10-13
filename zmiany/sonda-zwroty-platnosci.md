---
rodzaj: minor
tytul: prawdziwy status wypłaty zwrotu z listy zwrotów płatności Allegro
---

**Zwrot znika z kolejki, gdy Allegro potwierdzi wypłatę.** Serwer czyta teraz `GET /payments/refunds`, czyli zwroty płatności z kwotą, statusem i rozbiciem na pozycje, także te zrobione ręką w Sales Center. Zwrot klienta, za który wyszedł zwrot płatności ze statusem `SUCCESS`, dostaje potwierdzenie wypłaty bez pytania o każdą płatność osobno.

Zatrzask jest ostrożny: pomija reklamacje, zwroty częściowe, przelewy sprzed zgłoszenia i zamówienia z dwoma zwrotami. **Wypłata z Allegro na ekranie zwrotu.** W sekcji pieniędzy widać każdy zwrot płatności: status słowami (wypłacone, częściowo, w toku, anulowane), kwotę, datę i rozbicie na produkty z liczbą sztuk albo kwotą oraz dostawę, tak jak w Sales Center.

Sonda (`npm run sonda`) opisuje kształt tej końcówki.
