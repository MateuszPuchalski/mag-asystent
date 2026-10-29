---
rodzaj: minor
tytul: zakładka Wymiary — waga i wymiary towarów prosto do Subiekta
---

**Nowa zakładka „Wymiary”.** Pokazuje towary, którym Subiekt nie zna wagi
albo wymiaru, najczęściej sprzedawane na górze. Wpisujesz wagę w kg
i wymiary w cm, Enter przechodzi do następnego pola, a po zapisie ekran sam
bierze następny towar. Skan kodu w polu szukania od razu otwiera towar.
Puste pole zostaje w Subiekcie bez zmian.

Pomiar idzie tą samą kolejką co lokalizacja: nowy typ zadania `set_wymiary`
pisze jednym UPDATE-em `tw_Masa` i trzy pola własne. Każdy zapis zostawia
zdarzenie `wymiary_set` z wartościami sprzed zmiany. W demo pomiar trafia do
nowych kolumn `sgt_towar`, więc całą drogę da się przejść bez Subiekta.

**[wymaga działania]** Wpisz w `wertis.env` klucze `WYMIARY_POLE_DLUGOSC`,
`WYMIARY_POLE_SZEROKOSC` i `WYMIARY_POLE_WYSOKOSC` (pola własne `tw_PoleN`)
i nadaj `GRANT UPDATE ON dbo.tw__Towar (tw_Masa, …)` z tymi polami — DEPLOY
§6j. Bez kluczy zakładka mówi, że czeka na konfigurację; reszta działa jak
dotąd.
