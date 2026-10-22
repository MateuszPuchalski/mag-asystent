---
rodzaj: minor
tytul: odłożenie po dziurze w Wi-Fi nie udaje błędu
---

**Kolektor nie krzyczy błędem, gdy odłożenie już weszło.** Po przerwie
w Wi-Fi to samo odłożenie potrafiło dojść na serwer dwa razy. Druga kopia
dawała buczenie, „odśwież listę" albo „Operacja z bufora odrzucona", choć
towar był zapisany. Teraz kolektor mówi „już odłożona — zapis wszedł
wcześniej", sam odświeża listę, a kopia z bufora znika bez alarmu.

Wpis „Serwer odrzucił żądanie" w dzienniku pokazuje znowu metodę, ścieżkę,
kod odpowiedzi i powód. Dotąd stało samo „odpowiedź 409", bo opis czytał
klucze, których serwer nie zapisuje.
