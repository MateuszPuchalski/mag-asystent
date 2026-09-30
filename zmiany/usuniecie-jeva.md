---
rodzaj: patch
tytul: rozpoznawanie wiadomości klientów wraca do Claude, Jev usunięty
---

**Rozpoznawanie wiadomości klientów robi znów tylko Claude.** Klasyfikator Jev
z TypeSafe został usunięty razem z kluczem `TYPESAFE_API_KEY` i ustawieniami
`KLASYFIKATOR_DOSTAWCA` oraz `JEV_MODEL`. Serwer z takim wpisem w `wertis.env`
wstaje normalnie i pomija go z ostrzeżeniem.

Do tej pory instalacja bez klucza TypeSafe nie rozpoznawała wiadomości wcale, a
szkice przed pracą nie ruszały. Teraz oba takty, jeśli są włączone w `wertis.env`
(`COPILOT_AUTO_KLASYFIKACJA` i `COPILOT_PRZED_PRACA`), znów pracują na Claude i
wydają pieniądze w granicach swoich limitów.
