---
rodzaj: minor
tytul: kubełki „tylko wgląd” pod „Więcej” i jeden „?” w skrzynce
---

**Kubełki do przeglądania schodzą pod „Więcej”.** W reklamacjach Rozstrzygnięte
i Bez ruchu, w dyskusjach Zamknięte stoją teraz w liście „Więcej” z licznikiem.
Na wierzchu zostają kubełki pracy, a klawisze cyfr dalej wybierają każdy kubełek.
Układ ze skrzynki mieszka we wspólnym `ui/FiltrZWiecej.tsx`, więc wszędzie
działa tak samo.

**Jeden „?” w kolejce rozmów.** Słownik znaków i skróty klawiszy otwierają się
jednym przyciskiem i zamykają Escape'em albo kliknięciem obok. Plakietka
„STAN Z” i stopka o niepobranych wierszach zeszły, bo mówił to już baner alarmu
synchronizacji. Strzałka w liście „Więcej” albo w kolejności nie przesuwa już
rozmowy pod kursorem.
