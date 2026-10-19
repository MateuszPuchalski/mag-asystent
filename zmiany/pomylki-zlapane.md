---
rodzaj: minor
tytul: pomyłki zbierania złapane przy pakowaniu
---

**Pomyłki złapane przy pakowaniu.** Zakładka „Pomyłki” pokazuje, ile pomyłek
zbierania wyłapało pakowanie w ostatnich dwóch tygodniach, zanim paczka
wyszła. Obok stoi liczba pomyłek z rejestru z tych samych dni, czyli
przepuszczonych do klienta. Z obu wychodzi, ile wykrytych pomyłek zatrzymało
pakowanie. Liczba na dzień, bez osób. Dane biorą się z Sellasist, ze statusu
ustawionego w `SELLASIST_STATUSY_POMYLKA` (u nas 30, „Brak podczas pakowania”).
Liczenie rusza od doby po wpisaniu statusu, bo wcześniejszego dziennika nikt
z tym statusem nie czytał.

Zamówienie, które dziś weszło w ten status, nie jest już dla szkicu odpowiedzi
brakiem towaru. Towar się donosi, więc „wyślemy dziś” zostaje. Zamówienie
stojące w tym statusie od wczoraj szkic znowu widzi jako brak.

**[wymaga działania]** W panelu: Ustawienia → Konfiguracja, grupa Sellasist.
Wpisz w `SELLASIST_STATUSY_POMYLKA` numer statusu „Brak podczas pakowania”
(u nas 30). Bez niego blok w zakładce „Pomyłki” się nie pokaże.
