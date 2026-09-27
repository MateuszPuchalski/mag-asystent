---
rodzaj: minor
tytul: pusta kolumna w jednym miejscu, uczciwa kropka synchronizacji, zero naruszeń WCAG
---

**Pusta kolumna mówi w jednym miejscu.** Ikona i zdanie „Wybierz dostawę
z kolejki" stoją razem na środku kolumny. Dotąd ikona wisiała w górnej
połowie, a zdanie trzysta pikseli niżej, w skrzynce, dostawach i koszach.

**Szara kropka przed pierwszą synchronizacją.** Kropka w nagłówku świeciła
na zielono przy kresce zamiast godziny, choć synchronizacja nie odbyła się
ani razu. Teraz jest szara, a dymek mówi to zdaniem.

**Podpowiedź w szukaniu skrzynki mieści się w polu.** Pole pokazywało
„Szukaj: login, treść, prc". Teraz widać całe „Login, treść, prowadzący".

Audyt axe-core (WCAG 2.2 A i AA) w przeglądarce, na czternastu ekranach:
z czterech naruszeń do zera. Wiersz stanu synchronizacji spraw ma czytelny
kontrast, a kolumny tabel bez napisu mają nazwę dla czytnika ekranu. Strażnik
w testach panelu sprawdza odtąd strukturę każdego ekranu przy każdym
przebiegu. Pomiar w przeglądarce robi `tools/audyt-dostepnosci.mjs`.

Pasek „Nowe w panelu" pomija `[wymaga działania]` i wpis 0.544.0, który
opisywał zmiany techniczne, nie widoczne w pracy.
