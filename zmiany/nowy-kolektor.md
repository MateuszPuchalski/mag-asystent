---
rodzaj: minor
tytul: karta „Nowy kolektor" z kodem QR do pobrania aplikacji
---

**Karta „Nowy kolektor" w ustawieniach.** Pierwsza instalacja aplikacji
na kolektorze nie potrzebuje już kabla ani MDM. Kod QR prowadzi do APK na
serwerze (`/api/aktualizacja/apk`, bez logowania, jak dotąd), więc wystarczy
zeskanować go aparatem kolektora. Obok stoi adres serwera dużymi literami —
na wypadek przeprowadzki, bo adres produkcyjny aplikacja ma wbudowany.

- Adres podaje serwer (`GET /api/biuro/kolektor`, biuro i admin), nie pasek
  przeglądarki: panel otwarty na samym serwerze to `localhost`.
- Skaner na ekranie startowym kolektora zostaje wyłączony — pilnuje, żeby
  wpisywane hasło nie pojechało jako skan.
