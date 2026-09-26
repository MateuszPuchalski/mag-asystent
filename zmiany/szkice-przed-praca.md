---
rodzaj: minor
tytul: szkice przed pracą — zaległość gotowa, zanim przyjdzie biuro
---

**Szkice przed pracą.** Po weekendzie zaległość skrzynki trafiała na sufit
godzinowy Copilota dokładnie wtedy, gdy przychodzili agenci. Teraz w oknie
przed biurem Copilot rozpoznaje i szkicuje zaległość z własnym limitem na
poranek. Najpierw rozmowy PILNE, potem najdłużej czekające, jak w kolejce.

- Trzy nowe ustawienia w grupie Obsługa klienta → Copilot:
  `COPILOT_PRZED_PRACA` (domyślnie wyłączony), `COPILOT_PRZED_PRACA_OKNO`
  (domyślnie `6-8` czasu magazynu) i `COPILOT_PRZED_PRACA_LIMIT`
  (domyślnie sto rozmów na poranek).
- Poranek nie zjada sufitów godzinowych dnia: pierwsza godzina biura
  dostaje swoje szkice w całości. W oknie zwykłe takty Copilota czekają.
- Świeży szkic zostaje. Szkic nieudany z winy rozmowy nie wraca na tę samą
  wiadomość tego ranka. Nic nie idzie do klienta — szkic czeka na agenta.
- Karta pomiaru Copilota pokazuje koszt poranka osobnym wierszem.
