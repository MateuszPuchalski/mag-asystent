---
rodzaj: minor
tytul: zakładka Wymiary — waga i wymiary towarów prosto do Subiekta
---

**Nowa zakładka „Wymiary”.** Pokazuje towary, którym Subiekt nie zna wagi
albo wymiaru, najczęściej sprzedawane na górze. Wpisujesz wagę brutto
i netto w kg oraz wymiary w cm, Enter przechodzi do następnego pola, a po zapisie ekran sam
bierze następny towar. Skan kodu w polu szukania od razu otwiera towar.
Puste pole zostaje w Subiekcie bez zmian.

Pomiar idzie tą samą kolejką co lokalizacja: nowy typ zadania `set_wymiary`
pisze w jednej transakcji wagi do `tw_Masa` (brutto) i `tw_MasaNetto`,
a wymiary do pól własnych w `pw_Dane`. Towarowi bez żadnego pola własnego
dopisuje wiersz z numerem z licznika Subiekta. Netto większe od brutto,
także od brutto już stojącego w kartotece, serwer odrzuca jako zamienione
pola. Każdy zapis zostawia zdarzenie `wymiary_set` z wartościami sprzed
zmiany. W demo pomiar trafia do nowych kolumn `sgt_towar`, więc całą drogę
da się przejść bez Subiekta.

**[wymaga działania]** Wpisz w `wertis.env` klucze `WYMIARY_POLE_DLUGOSC`,
`WYMIARY_POLE_SZEROKOSC` i `WYMIARY_POLE_WYSOKOSC` (kolumny `pwd_TekstNN`,
w bazie firmy Tekst03, Tekst02, Tekst01) i nadaj granty na `tw__Towar`,
`pw_Dane` i `ins_ident` z DEPLOY §6j. Bez kluczy zakładka mówi, że czeka
na konfigurację; reszta działa jak dotąd.
