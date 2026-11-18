---
rodzaj: patch
tytul: ekran „Do decyzji” nie zamraża serwera
---

**Ekran „Do decyzji” otwiera się od razu.** Licznik zwrotów do decyzji liczy
już tylko kubełki, bez stanu rabatu przy każdej pozycji zwrotu. Na kopii
bazy z magazynu ekran liczy się w około 160 ms zamiast prawie sekundy. Na
żywym serwerze to wstrzymywało wszystkie inne żądania nawet na dwie minuty,
a takty Allegro i Sellasist zgłaszały wtedy fałszywy „brak połączenia”.
Migawka dnia liczy kubełki zwrotów tą samą lżejszą drogą.

Worker nie pada już, gdy nie może zapisać błędu zadania przy zablokowanej
bazie. Błąd czeka w pamięci i wchodzi do bazy w następnym takcie, zanim
worker weźmie kolejne zadanie. Wcześniej proces się wywracał, a zadanie
zostawało w `processing` na zawsze.
