---
rodzaj: patch
tytul: anonimizacja kopii — poprawka skanera naprawdę w kodzie narzędzia
---

**Poprawka skanera z poprzedniego wydania nie weszła do narzędzia.** Opis
zmiany trafił do wydania, ale sam kod `anonimizuj-baze.mjs` został na gałęzi,
więc paczka niosła starą wersję. To wydanie dokłada kod: skaner nie szuka już
nazw towarów i modeli, ról, autorów systemowych, krótkich tekstów ani
komentarzy z dziennika biura. Imiona, nazwiska, loginy, adresy, telefony
i pełne treści wiadomości dalej zatrzymują narzędzie.
