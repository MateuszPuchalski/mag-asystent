---
rodzaj: patch
tytul: dostawy w panelu — drobne poprawki z audytu ekranu
---

**Dostawy w panelu: drobne poprawki z audytu ekranu.** Druga część audytu:
miejsca, w których ekran mówił mniej albo inaczej, niż wiedział.

- **Przy 1024 px kolumna pracy jest najszersza.** Dotąd miała ok. 280 px,
  mniej niż kolumna kontekstu, a opis wyjątku łamał się po dwa słowa.
  Kontekst oddaje jej miejsce na tym progu. Dotyczy wszystkich ekranów
  z trzema kolumnami: dostaw, skrzynki, zwrotów, reklamacji, dyskusji
  i koszy. Kolejka zostaje szeroka, bo kafelki zwrotów potrzebują miejsca.
- **Błędny artykuł czyta się jako zamiana.** Zamiast „policzone: 6 z 6 szt.
  · zamiast 6” stoi „przyszło 6 szt. OEM-77-521 zamiast 6 szt.” zamówionego
  towaru.
- **Wiek dostawy w dniach.** „dziś”, „wczoraj”, „3 dni” zamiast „11 g 51 min”
  liczonych od północy UTC z daty bez godziny.
- **Zdjęcie przy wyjątku tylko w instalacji ze zdjęciami.** Ta sama reguła
  co w tabeli pozycji. Bez niej każdy wyjątek miał kafel „bez zdjęcia”.
- **Poza WERTIS:**
  - wiek słowami zamiast surowej daty;
  - pełny powód zdjęcia z listy;
  - pasek „bez granicy okna importu”, bo ta lista okna nie ma.
- **Mniej szumu:**
  - miejsce na logo tylko wtedy, gdy ktoś na liście je ma;
  - bez plakietki „do zrobienia” przy każdej pozycji;
  - status wyjątku w stałej kolumnie z prawej;
  - zgłoszenie bez towaru opisane wprost jako „bez wskazania towaru”.
- **Czytelniej w kontekście:** reguła notatki pod polem zamiast w uciętej
  podpowiedzi, a podpisy dowodów w dwóch liniach.
