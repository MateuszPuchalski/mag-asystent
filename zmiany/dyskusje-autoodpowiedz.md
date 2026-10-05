---
rodzaj: patch
tytul: automatyczna odpowiedź nie przenosi dyskusji do „Czeka na klienta”
---

**Automatyczne „Dziękujemy za wiadomość” nie zdejmuje już dyskusji z „Do
odpowiedzi”.** Allegro nie uznaje wiadomości automatycznej za odpowiedź
w dyskusji, więc sprawa zostaje w kolejce, a licznik czekania i alarm liczą
dalej od pytania klienta.

Serwer wstaje po aktualizacji także na bazie założonej ze świeżej instalacji
między wersjami 0.528 a 0.564. Migracja kasująca dobór części wywracała
na niej start, a aktualizacja wracała do poprzedniej wersji. Kolumny, których
SQLite nie umie zdjąć, zostają teraz w bazie jako martwe.
