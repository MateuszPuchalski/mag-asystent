---
rodzaj: minor
tytul: wyjątek przy pozycji przeżywa odłożenie, skan po braku odkłada tyle, ile przyjechało
---

**Wyjątek przy pozycji przeżywa odłożenie reszty sztuk.** Po zgłoszeniu
wyjątku magazynier często odkłada resztę, bo uszkodzone sztuki też idą na
półkę. Odłożenie liczyło wtedy status z samej ilości i po cichu zdejmowało
z pozycji wyjątek. Skutki były trzy:

- Dostawa z otwartym zgłoszeniem zamykała się sama po ostatnim odłożeniu,
  wbrew regule „wyjątek czeka na ZAKOŃCZ” z 22 września.
- Licznik wyjątków w postępie dostawy spadał do zera.
- Przy braku ZAKOŃCZ zgłaszał ten sam brak drugi raz. Dostawca dostawał dwie
  reklamacje, a na serwis szło dwa razy tyle sztuk, ile brakowało.

Pozycja zostaje teraz wyjątkiem, a ilość i półka zapisują się jak zawsze.
Pomyłkę w ilości cofa się tak jak dotąd przy odwrotnej kolejności: najpierw
WYCOFAJ ZGŁOSZENIE, potem COFNIJ.

**ZMIEŃ PÓŁKĘ działa też przy wyjątku.** Kolektor chował ten przycisk razem
z COFNIJ, choć półka nie należy do zgłoszenia. Źle zeskanowaną półkę poprawia
się teraz od razu, bez wycofywania zgłoszenia ze zdjęciem.

**Po zgłoszeniu braku skan półki odkłada tyle, ile przyjechało.** Magazynier
zgłaszał „zła ilość 400 z 500”, skanował półkę, a kolektor odkładał 500.
W bazie biura były trzy takie pozycje w dwa dni. Kafel pokazuje teraz ilość
ze zgłoszenia z podpisem „tyle przyjechało wg zgłoszenia”. Serwer liczy
resztę przy zapisie tak samo, więc działa to także ze starszym APK.

- Ręcznie ustawiona liczba wygrywa ze zgłoszeniem.
- Nadmiar zgłoszony przez człowieka liczy się dalej od faktury. Inaczej
  ZAKOŃCZ zgłosiłby go drugi raz jako nadmiar dostawcy.
- Zgłoszenie rozwiązane albo wycofane przywraca resztę z dokumentu.
