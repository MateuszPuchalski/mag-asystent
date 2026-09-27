---
rodzaj: patch
tytul: wyjątek przy rozłożonej pozycji widać w dokumencie dostawy
---

**Wyjątek przy rozłożonej pozycji nie ginie w dokumencie dostawy.** Panel
dzielił pozycje po statusie i na górę wynosił tylko te ze stanem „wyjątek”.
Pozycja rozłożona do końca, a z otwartym zgłoszeniem, trafiała do zwykłej
tabeli, która zgłoszeń nie pokazuje. Tak zostawia ją nadmiar zgłoszony przy
ZAKOŃCZ i odłożenie reszty sztuk po zgłoszeniu. Nagłówek faktury mówił wtedy
„1 otwarty wyjątek”, a w czterdziestu dwóch pozycjach nie było go nigdzie.
Teraz każda pozycja ze zgłoszeniem stoi w „Pozycjach z wyjątkiem”. Pozycje
z otwartym zgłoszeniem idą przed tymi, które mają już tylko rozwiązane.
