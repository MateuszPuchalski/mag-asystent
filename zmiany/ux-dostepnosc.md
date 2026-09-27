---
rodzaj: minor
tytul: okna trzymają klawiaturę, pasek braku połączenia, zero naruszeń WCAG
---

**Klawisz pod otwartym oknem nie działa na sprawie pod spodem.** W zwrotach
`Z` przy otwartej historii klienta oddawało pieniądze za zwrot zasłonięty
nakładką. Teraz skróty kolejek milkną, gdy stoi nad nimi okno: historia,
zdjęcie, lista skrótów, szukanie albo wysyłka zatrzymana. Skan etykiety
działa dalej, bo zwroty słuchają czytnika cały czas.

**Okno bierze kursor i go oddaje.** Otwarte okno przyjmuje klawiaturę,
tabulator krąży w nim, a Escape zamyka tylko to górne. Po zamknięciu kursor
wraca tam, skąd agent przyszedł. Ctrl+K w trakcie pisania wraca więc do
pisanego pola, a „Historia" do swojego przycisku.

**Wysyłka zatrzymana nie pisze w niewidocznym szkicu.** Po Ctrl+Enter okno
konfliktu otwierało się z kursorem dalej w polu odpowiedzi, pod nakładką.
Teraz kursor staje na „Popraw szkic", a Escape wraca do szkicu bez zmian.

**Nowe zadanie dla magazynu zaczyna od tytułu.** Kursor stoi w polu tytułu
od razu. Escape zamyka pusty formularz, a wpisanej instrukcji nie wyrzuca.

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

Drugi audyt, na ekranach z otwartą sprawą, znalazł pięć rodzajów naruszeń,
których pusty seed nie pokazywał. Szary podpis na zaznaczonym wierszu kolejki
miał 3.86:1, biel na zielonych przyciskach 3.77:1, a nieaktywna połowa
przełącznika odpowiedzi 4.34:1. Przycisk kopiowania loginu miał 20 px
wysokości zamiast 24. Dwa okna stały na `aside`, który roli okna nieść nie
może. Wszystkie zeszły do zera na sześciu widokach z danymi i przy otwartych
oknach. Pary barw pilnuje `Kontrast.test.ts`, okna — hak `useOkno`
i strażnik `Okna.test.ts`.

Pasek „Nowe w panelu" pomija `[wymaga działania]` i wpis 0.544.0, który
opisywał zmiany techniczne, nie widoczne w pracy.
