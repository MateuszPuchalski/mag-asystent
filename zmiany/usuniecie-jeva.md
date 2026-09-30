---
rodzaj: patch
tytul: rozpoznawanie wiadomości klientów wraca do Claude, Jev usunięty
---

**Rozpoznawanie wiadomości klientów robi znów tylko Claude.** Klasyfikator Jev
z TypeSafe został usunięty razem z kluczem `TYPESAFE_API_KEY` i ustawieniami
`KLASYFIKATOR_DOSTAWCA` oraz `JEV_MODEL`. Serwer z takim wpisem w `wertis.env`
wstaje normalnie i pomija go z ostrzeżeniem. Do tej pory instalacja bez klucza
TypeSafe nie rozpoznawała wiadomości wcale, a szkice przed pracą nie ruszały.
