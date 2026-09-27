---
rodzaj: minor
tytul: pasek braku połączenia, pusta kolumna w jednym miejscu, zero naruszeń WCAG
---

**Brak połączenia z serwerem mówi to wprost.** Gdy serwer nie odpowiada,
na przykład w minucie aktualizacji, pod nagłówkiem staje czerwony pasek
z godziną ostatniego kontaktu i przyciskiem „Ponów teraz". Panel sam pyta
co 5 sekund i po powrocie odświeża wszystko. Dostawy, kosze i skrzynka nie
mówią już wtedy „nic nie czeka" ani „0" — mówią, że nie wiedzą.

**Pusta kolumna mówi w jednym miejscu.** Ikona i zdanie „Wybierz dostawę
z kolejki" stoją razem na środku kolumny. Dotąd ikona wisiała w górnej
połowie, a zdanie trzysta pikseli niżej, w skrzynce, dostawach i koszach.

**Szara kropka przed pierwszą synchronizacją.** Kropka w nagłówku świeciła
na zielono przy kresce zamiast godziny, choć synchronizacja nie odbyła się
ani razu. Teraz jest szara, a dymek mówi to zdaniem.

**Powiększenie 200% nie chowa zakładek.** Przy powiększonym ekranie zakładki
„Zadania" i „Dostawy" wychodziły za prawą krawędź, a strona przewijała się
w bok. Poniżej 900 px zakładka pokazuje samą ikonę z licznikiem, a nazwę
w dymku. Przy zwykłej szerokości nic się nie zmienia.

**Podpowiedź w szukaniu skrzynki mieści się w polu.** Pole pokazywało
„Szukaj: login, treść, prc". Teraz widać całe „Login, treść, prowadzący".

Audyt axe-core (WCAG 2.2 A i AA) w przeglądarce, na czternastu ekranach:
z czterech naruszeń do zera. Wiersz stanu synchronizacji spraw ma czytelny
kontrast, a kolumny tabel bez napisu mają nazwę dla czytnika ekranu. Strażnik
w testach panelu sprawdza odtąd strukturę każdego ekranu przy każdym
przebiegu. Pomiar w przeglądarce robi `tools/audyt-dostepnosci.mjs`.

Pasek „Nowe w panelu" pomija `[wymaga działania]` i wpis 0.544.0, który
opisywał zmiany techniczne, nie widoczne w pracy.
