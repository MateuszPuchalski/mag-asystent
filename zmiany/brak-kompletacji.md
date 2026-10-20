---
rodzaj: minor
tytul: brak z kompletacji po godzinie granicznej w „Do zrobienia”
---

**Brak z kompletacji do decyzji biura.** Zamówienie z Allegro, które po
godzinie granicznej dalej stoi w statusie „Brak podczas kompletacji”, staje
w „Do zrobienia”. Godzina graniczna to 12:00 przy kurierze innym niż InPost
i 15:00 przy InPost. Wejście w brak po tej godzinie staje od razu.

Wiersz mówi, czego brakuje i co jeszcze jest w zamówieniu, i prowadzi na
profil klienta. Obok stoi odnośnik do zamówienia w Allegro, gdzie biuro pisze
do klienta. Przycisk „Klient powiadomiony” zamyka wiersz, choć zamówienie
zostaje w statusie braku.

**[wymaga działania]** W panelu: Ustawienia → Konfiguracja, grupa Sellasist.
Wpisz w `SELLASIST_STATUSY_BRAK` numer statusu „Brak podczas kompletacji”
(u nas 12). Godziny graniczne mają już domyślne 12 i 15.
