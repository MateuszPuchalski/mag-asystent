---
rodzaj: patch
tytul: „nie wiem” automatu wiedzy zostaje w księdze i w koszcie
---

**„Nie wiem” automatu wiedzy zostaje w księdze.** Gdy model językowy nie był
pewny marki, zapis do `copilot_wywolanie` łamał warunek kolumny `wynik`.
Przebieg liczył wtedy wiersz jako błąd, a zapłacone wywołanie znikało z księgi.
Teraz taka odpowiedź staje jako `wynik='ok'`. Wiersz niesie też prawdziwą nazwę
modelu zamiast pustej, więc koszt składania kluczy wchodzi do pomiaru Copilota.
