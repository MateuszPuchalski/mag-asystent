---
rodzaj: patch
tytul: dostawy w panelu — poprawki z audytu ekranu
---

**Dostawy w panelu: poprawki z audytu ekranu.** Jeden błąd wysyłał dane do
niewłaściwej faktury. Cztery miejsca mówiły co innego niż fakty.

- **Notatka i zamknięcie zostają przy swojej fakturze.** Przy powrocie do
  faktury już raz otwartej pole notatki i formularz „Rozłożone poza WERTIS”
  przechodziły na nią z poprzedniej. Zmierzone: notatka wpisana przy FZ 9006
  poszła do hali przy FZ 9005. Formularz zamknięcia z powodem „dotyczy 9006”
  pytał już o 9005. Prawa i środkowa kolumna zaczynają teraz od zera przy
  każdej fakturze.
- **Jedna liczba wyjątków.** Kolejka i nagłówek faktury liczą te same
  otwarte wyjątki i mówią „otwarte” wprost. Dotąd nagłówek liczył pozycje
  z wyjątkiem, a sekcja doliczała rozwiązane. Sekcja wyjątków poza pozycjami
  podaje „4 otwarte · 1 rozwiązany”, a rozwiązane stoją na końcu.
- **Rozłożona z otwartym wyjątkiem nie świeci na zielono.** Nagłówek mówi
  „rozłożona · czeka na biuro” na bursztynowo, a pasek w kolejce nie
  zmienia się w zielony, dopóki wyjątek czeka.
- **Zmiana kubełka zamyka fakturę spoza niego.** Dotąd środek pokazywał
  fakturę, której nowa lista nie zawierała, czasem z rozpoczętym
  formularzem zamknięcia. Link do faktury otwiera od razu jej kubełek.
- **Zgubiony plik dowodu jest widoczny.** Zgłoszenie ze zdjęciem, którego
  pliku serwer nie ma, mówi „zdjęcie zgłoszone, pliku brak” na czerwono.
  Dotąd mówiło „bez zdjęcia”, jak zgłoszenie, do którego nikt zdjęcia nie
  robił.

Sześć nowych testów w `ekrany/Dostawy.test.tsx`. Test przechodzenia notatki
pada bez poprawki i przechodzi z nią.
