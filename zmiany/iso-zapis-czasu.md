---
rodzaj: patch
tytul: stemple reklamacji i dyskusji w ISO zamiast datetime() ze spacją
---

**Stemple reklamacji i dyskusji w ISO.** Sześć zapisów wołało
`datetime('now')`, które daje `2026-09-25 08:00:00` ze spacją i bez strefy.
Reszta bazy trzyma `T…Z`. Kolumna miała więc dwa formaty naraz. Porównanie
tekstu stawiało wartość ze spacją przed każdą ISO z tego samego dnia. Panel
czytał ją jako czas lokalny, więc godzina prośby o zakończenie dyskusji
przesuwała się o strefę. Dotyczy to `zakonczenie_at`, `zwrot_towaru_at`
i `prowadzi_at` w `reklamacja_klienta` oraz `finished_at` w
`reklamacja_outbox`. Zapis idzie teraz przez `strftime` w ISO. Migracja przy
starcie przepisuje zastane wartości w kształcie `datetime()`. Innych nie
dotyka, więc drugi przebieg niczego nie zmienia.
