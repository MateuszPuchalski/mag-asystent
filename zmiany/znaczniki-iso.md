---
rodzaj: patch
tytul: godzina zakończenia dyskusji bez przesunięcia o dwie godziny
---

**Znaczniki czasu w reklamacjach i dyskusjach w jednym formacie.** Sześć
zapisów wstawiało `datetime('now')`, czyli datę ze spacją zamiast `T`.
Przeglądarka czyta taki zapis jako czas lokalny, więc godzina zakończenia
dyskusji stała w panelu dwie godziny za wcześnie (zimą godzinę). Dotyczyło
to też znacznika „prowadzę", zwrotu towaru i zakończenia wysyłki odpowiedzi
w reklamacji.

- Zapisy idą teraz w ISO, tak jak w reszcie bazy.
- Przy starcie serwer zamienia stare wiersze na ISO. Godzina się nie zmienia,
  tylko jej zapis.
- Strażnik w testach odrzuca `datetime('now'` w kodzie serwera, w zapisie
  i w granicy okna.
