---
rodzaj: patch
tytul: kopiowanie numeru zamówienia w rozmowie działa po zwykłym HTTP
---

Przycisk „Kopiuj numer zamówienia" w rozmowie skrzynki wołał
`navigator.clipboard` wprost. Pod `http://serwer:3001` ten obiekt nie istnieje,
więc przycisk nic nie kopiował i nic o tym nie mówił. Teraz idzie przez
`kopiujDoSchowka` i przy porażce pokazuje „Nie udało się skopiować". Strażnik
źródeł odmawia każdego innego `navigator.clipboard` w panelu.
